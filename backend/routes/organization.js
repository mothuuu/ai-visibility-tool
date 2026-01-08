/**
 * Organization Routes - Phase 3B Team Management
 *
 * Endpoints:
 *   POST /api/org/invites         - Create invite (owner/admin)
 *   GET  /api/org/invites         - List pending invites (owner/admin)
 *   POST /api/org/invites/accept  - Accept invite (auth optional)
 *   POST /api/org/invites/revoke  - Revoke invite (owner/admin)
 *   GET  /api/org/members         - List org members (any member)
 *   GET  /api/org/seats           - Get seat usage info (owner/admin)
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db/database');
const { authenticateToken, authenticateTokenOptional } = require('../middleware/auth');
const { loadOrgContext, requireOrgContext, requireOrgRole } = require('../middleware/orgContext');
const { rateLimitInviteCreate, rateLimitInviteAccept } = require('../middleware/inviteRateLimit');
const { getSeatInfo, canAddSeat } = require('../services/seat-service');

// Invite token expiry (7 days)
const INVITE_EXPIRY_DAYS = 7;

// Get APP_URL for invite links
const getAppUrl = () => process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';

/**
 * Generate a secure invite token
 */
function generateInviteToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Normalize email to lowercase
 */
function normalizeEmail(email) {
  return email?.toLowerCase().trim();
}

/**
 * Get role ID by name
 */
async function getRoleIdByName(roleName) {
  const result = await db.query(
    `SELECT id FROM roles WHERE name = $1 AND is_system = true`,
    [roleName]
  );
  return result.rows[0]?.id || null;
}

// ============================================================================
// POST /api/org/invites - Create invite (owner/admin only)
// ============================================================================
router.post('/invites', authenticateToken, loadOrgContext, requireOrgContext, requireOrgRole(['owner', 'admin']), rateLimitInviteCreate, async (req, res) => {
  try {
    const { email, role = 'member' } = req.body;
    const orgId = req.orgId;
    const invitedBy = req.user.id;

    // Validate email first (before checking seats - fast fail)
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    const normalizedEmail = normalizeEmail(email);

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if user already a member (fast path - no seat consumed)
    const existingMember = await db.query(
      `SELECT om.id, om.status, u.email
       FROM organization_members om
       JOIN users u ON om.user_id = u.id
       WHERE om.organization_id = $1 AND u.email = $2 AND om.status = 'active'`,
      [orgId, normalizedEmail]
    );

    if (existingMember.rows.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'User is already a member of this organization',
        alreadyMember: true
      });
    }

    // Check for existing pending invite (idempotent - returns existing, no new seat)
    const existingInvite = await db.query(
      `SELECT id, invitation_token, invited_email, status, role_id
       FROM organization_members
       WHERE organization_id = $1
         AND invited_email = $2
         AND status = 'pending'
         AND (invitation_expires_at IS NULL OR invitation_expires_at > NOW())
         AND revoked_at IS NULL
         AND accepted_at IS NULL`,
      [orgId, normalizedEmail]
    );

    if (existingInvite.rows.length > 0) {
      const existing = existingInvite.rows[0];
      const inviteLink = `${getAppUrl()}/invite.html?token=${existing.invitation_token}`;

      return res.status(200).json({
        success: true,
        message: 'Invite already exists',
        inviteId: existing.id,
        email: existing.invited_email,
        inviteLink,
        existingInvite: true
      });
    }

    // Phase 3B.2A: Seat limit enforcement
    // Only check when creating a NEW invite (idempotent path above bypasses this)
    const seatCheck = await canAddSeat(orgId);
    if (!seatCheck.canInvite) {
      return res.status(409).json({
        error: 'SEAT_LIMIT_REACHED',
        message: 'Seat limit reached. Upgrade to add more teammates.',
        seatLimit: seatCheck.seatLimit,
        seatsUsed: seatCheck.seatsUsed
      });
    }

    // Validate role - only owner can create admin, admin can only create member
    const allowedRoles = ['member', 'admin'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Allowed: member, admin' });
    }

    // Admin can only invite members, not other admins
    if (req.orgRole === 'admin' && role === 'admin') {
      return res.status(403).json({ error: 'Admins can only invite members' });
    }

    // Get role ID
    const roleId = await getRoleIdByName(role);
    if (!roleId) {
      return res.status(500).json({ error: 'Role not found' });
    }

    // Generate invite token and expiry
    const inviteToken = generateInviteToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

    // Create invite record
    const result = await db.query(
      `INSERT INTO organization_members (
        organization_id, role_id, invited_email, invitation_token,
        invitation_expires_at, status, invited_at, invited_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), $6)
      RETURNING id, invited_email, status, invited_at`,
      [orgId, roleId, normalizedEmail, inviteToken, expiresAt, invitedBy]
    );

    const invite = result.rows[0];
    const inviteLink = `${getAppUrl()}/invite.html?token=${inviteToken}`;

    console.log(`✅ Invite created: ${normalizedEmail} to org ${orgId} by user ${invitedBy}`);

    res.status(201).json({
      success: true,
      inviteId: invite.id,
      email: invite.invited_email,
      role,
      inviteLink,
      expiresAt
    });

  } catch (error) {
    console.error('❌ Create invite error:', error);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

// ============================================================================
// GET /api/org/invites - List pending invites (owner/admin only)
// ============================================================================
router.get('/invites', authenticateToken, loadOrgContext, requireOrgContext, requireOrgRole(['owner', 'admin']), async (req, res) => {
  try {
    const orgId = req.orgId;

    const result = await db.query(
      `SELECT
        om.id,
        om.invited_email as email,
        r.name as role,
        om.status,
        om.invited_at as created_at,
        om.invitation_expires_at as expires_at,
        om.invitation_token as token,
        u.name as invited_by_name,
        u.email as invited_by_email
       FROM organization_members om
       JOIN roles r ON om.role_id = r.id
       LEFT JOIN users u ON om.invited_by_user_id = u.id
       WHERE om.organization_id = $1
         AND om.status = 'pending'
         AND om.revoked_at IS NULL
       ORDER BY om.invited_at DESC`,
      [orgId]
    );

    // Build invite links
    const invites = result.rows.map(invite => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      status: invite.status,
      createdAt: invite.created_at,
      expiresAt: invite.expires_at,
      inviteLink: `${getAppUrl()}/invite.html?token=${invite.token}`,
      invitedBy: invite.invited_by_name || invite.invited_by_email || 'Unknown'
    }));

    res.json({
      success: true,
      invites
    });

  } catch (error) {
    console.error('❌ List invites error:', error);
    res.status(500).json({ error: 'Failed to list invites' });
  }
});

// ============================================================================
// POST /api/org/invites/accept - Accept invite (auth optional)
// ============================================================================
router.post('/invites/accept', rateLimitInviteAccept, authenticateTokenOptional, async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Invite token is required' });
    }

    // Find the invite
    const inviteResult = await db.query(
      `SELECT
        om.id, om.organization_id, om.role_id, om.invited_email,
        om.status, om.invitation_expires_at, om.revoked_at, om.accepted_at,
        o.id as org_id, o.name as org_name, o.slug as org_slug,
        r.name as role_name
       FROM organization_members om
       JOIN organizations o ON om.organization_id = o.id
       JOIN roles r ON om.role_id = r.id
       WHERE om.invitation_token = $1`,
      [token]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invite not found or invalid token' });
    }

    const invite = inviteResult.rows[0];

    // Check if already accepted
    if (invite.accepted_at) {
      return res.status(400).json({
        error: 'Invite has already been accepted',
        code: 'ALREADY_ACCEPTED'
      });
    }

    // Check if revoked
    if (invite.revoked_at || invite.status === 'removed') {
      return res.status(400).json({
        error: 'Invite has been revoked',
        code: 'REVOKED'
      });
    }

    // Check if expired
    if (invite.invitation_expires_at && new Date(invite.invitation_expires_at) < new Date()) {
      return res.status(400).json({
        error: 'Invite has expired',
        code: 'EXPIRED'
      });
    }

    // Check if status is pending
    if (invite.status !== 'pending') {
      return res.status(400).json({ error: 'Invite is no longer pending' });
    }

    // If user not authenticated, return needsAuth
    // SECURITY: Do NOT leak org name/id when unauthenticated
    if (!req.user) {
      return res.status(200).json({
        needsAuth: true,
        email: invite.invited_email
      });
    }

    // Verify authenticated user email matches invited email
    const userEmail = normalizeEmail(req.user.email);
    if (userEmail !== invite.invited_email) {
      return res.status(403).json({
        error: 'Email mismatch',
        message: `This invite was sent to ${invite.invited_email}. Please log in with that email address.`,
        invitedEmail: invite.invited_email
      });
    }

    // Check if user is already in another org
    const userOrgResult = await db.query(
      `SELECT organization_id FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (userOrgResult.rows[0]?.organization_id && userOrgResult.rows[0].organization_id !== invite.organization_id) {
      // User is in a different org - for now, move them to the new org
      // In future, might want different handling
      console.log(`⚠️ User ${req.user.id} moving from org ${userOrgResult.rows[0].organization_id} to ${invite.organization_id}`);
    }

    // Start transaction to accept invite
    await db.query('BEGIN');

    try {
      // Update invite record with user_id and mark accepted
      await db.query(
        `UPDATE organization_members
         SET user_id = $1, status = 'active', accepted_at = NOW()
         WHERE id = $2`,
        [req.user.id, invite.id]
      );

      // Update user's organization_id
      await db.query(
        `UPDATE users SET organization_id = $1 WHERE id = $2`,
        [invite.organization_id, req.user.id]
      );

      await db.query('COMMIT');

      console.log(`✅ Invite accepted: user ${req.user.id} joined org ${invite.organization_id} as ${invite.role_name}`);

      res.json({
        success: true,
        organization: {
          id: invite.org_id,
          name: invite.org_name,
          slug: invite.org_slug
        },
        role: invite.role_name,
        message: `You have joined ${invite.org_name} as ${invite.role_name}`
      });

    } catch (txError) {
      await db.query('ROLLBACK');
      throw txError;
    }

  } catch (error) {
    console.error('❌ Accept invite error:', error);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// ============================================================================
// POST /api/org/invites/revoke - Revoke invite (owner/admin only)
// ============================================================================
router.post('/invites/revoke', authenticateToken, loadOrgContext, requireOrgContext, requireOrgRole(['owner', 'admin']), async (req, res) => {
  try {
    const { inviteId } = req.body;
    const orgId = req.orgId;

    if (!inviteId) {
      return res.status(400).json({ error: 'Invite ID is required' });
    }

    // Verify invite belongs to this org and is pending
    const inviteResult = await db.query(
      `SELECT id, status, invited_email
       FROM organization_members
       WHERE id = $1 AND organization_id = $2`,
      [inviteId, orgId]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    const invite = inviteResult.rows[0];

    // Check if already accepted - cannot revoke accepted invites
    if (invite.status === 'active') {
      return res.status(409).json({
        error: 'Cannot revoke an accepted invite',
        code: 'ALREADY_ACCEPTED',
        alreadyAccepted: true
      });
    }

    // Already revoked - idempotent success
    if (invite.status === 'removed') {
      return res.status(200).json({
        success: true,
        message: 'Invite was already revoked',
        alreadyRevoked: true
      });
    }

    // Not pending - some other state
    if (invite.status !== 'pending') {
      return res.status(200).json({
        success: true,
        message: 'Invite is no longer pending',
        alreadyRevoked: true
      });
    }

    // Revoke the invite
    await db.query(
      `UPDATE organization_members
       SET status = 'removed', revoked_at = NOW()
       WHERE id = $1`,
      [inviteId]
    );

    console.log(`✅ Invite revoked: ${invite.invited_email} from org ${orgId}`);

    res.json({
      success: true,
      message: 'Invite revoked successfully'
    });

  } catch (error) {
    console.error('❌ Revoke invite error:', error);
    res.status(500).json({ error: 'Failed to revoke invite' });
  }
});

// ============================================================================
// GET /api/org/members - List org members (any authenticated member)
// ============================================================================
router.get('/members', authenticateToken, loadOrgContext, requireOrgContext, async (req, res) => {
  try {
    const orgId = req.orgId;

    const result = await db.query(
      `SELECT
        om.id as membership_id,
        u.id as user_id,
        u.email,
        u.name,
        r.name as role,
        om.accepted_at as joined_at,
        CASE WHEN o.owner_user_id = u.id THEN true ELSE false END as is_owner
       FROM organization_members om
       JOIN users u ON om.user_id = u.id
       JOIN roles r ON om.role_id = r.id
       JOIN organizations o ON om.organization_id = o.id
       WHERE om.organization_id = $1
         AND om.status = 'active'
       ORDER BY
         CASE WHEN o.owner_user_id = u.id THEN 0 ELSE 1 END,
         om.accepted_at ASC`,
      [orgId]
    );

    res.json({
      success: true,
      members: result.rows.map(m => ({
        id: m.membership_id,
        userId: m.user_id,
        email: m.email,
        name: m.name,
        role: m.role,
        joinedAt: m.joined_at,
        isOwner: m.is_owner
      }))
    });

  } catch (error) {
    console.error('❌ List members error:', error);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

// ============================================================================
// GET /api/org/seats - Get seat usage info (owner/admin only)
// ============================================================================
router.get('/seats', authenticateToken, loadOrgContext, requireOrgContext, requireOrgRole(['owner', 'admin']), async (req, res) => {
  try {
    const orgId = req.orgId;
    const seatInfo = await getSeatInfo(orgId);

    res.json({
      success: true,
      seatLimit: seatInfo.seatLimit,
      activeMembers: seatInfo.activeMembers,
      pendingInvites: seatInfo.pendingInvites,
      seatsUsed: seatInfo.seatsUsed,
      canInvite: seatInfo.canInvite
    });

  } catch (error) {
    console.error('❌ Get seats error:', error);
    res.status(500).json({ error: 'Failed to get seat info' });
  }
});

module.exports = router;
