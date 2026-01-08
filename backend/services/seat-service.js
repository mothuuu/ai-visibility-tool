/**
 * Seat Service - Phase 3B.2A
 *
 * Single source of truth for seat limit policy and seat usage calculations.
 *
 * Seat limit rules:
 * - If organizations.seat_limit is NOT NULL → use it (set via Stripe/admin)
 * - Else derive from org plan:
 *   - free: 1
 *   - diy: 1
 *   - pro: 3
 *   - enterprise: 10
 *   - agency: 3
 *
 * Seat usage = active members + pending invites (prevents invite spam)
 */

const db = require('../db/database');

// Default seat limits by plan (when seat_limit column is NULL)
const PLAN_SEAT_LIMITS = {
  free: 1,
  diy: 1,
  pro: 3,
  enterprise: 10,
  agency: 3
};

/**
 * Get seat limit for an organization
 * @param {number} orgId - Organization ID
 * @returns {Promise<number>} - Seat limit
 */
async function getSeatLimit(orgId) {
  const result = await db.query(
    `SELECT seat_limit, plan FROM organizations WHERE id = $1`,
    [orgId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Organization ${orgId} not found`);
  }

  const { seat_limit, plan } = result.rows[0];

  // If seat_limit is explicitly set, use it
  if (seat_limit !== null) {
    return seat_limit;
  }

  // Otherwise derive from plan
  return PLAN_SEAT_LIMITS[plan] || PLAN_SEAT_LIMITS.free;
}

/**
 * Get seat usage for an organization
 * @param {number} orgId - Organization ID
 * @returns {Promise<{activeMembers: number, pendingInvites: number, seatsUsed: number}>}
 */
async function getSeatUsage(orgId) {
  // Count active members (status = 'active')
  const membersResult = await db.query(
    `SELECT COUNT(*) as count
     FROM organization_members
     WHERE organization_id = $1
       AND status = 'active'`,
    [orgId]
  );
  const activeMembers = parseInt(membersResult.rows[0].count, 10);

  // Count pending invites (not expired, not revoked, not accepted)
  const invitesResult = await db.query(
    `SELECT COUNT(*) as count
     FROM organization_members
     WHERE organization_id = $1
       AND status = 'pending'
       AND revoked_at IS NULL
       AND accepted_at IS NULL
       AND (invitation_expires_at IS NULL OR invitation_expires_at > NOW())`,
    [orgId]
  );
  const pendingInvites = parseInt(invitesResult.rows[0].count, 10);

  return {
    activeMembers,
    pendingInvites,
    seatsUsed: activeMembers + pendingInvites
  };
}

/**
 * Get full seat info for an organization (limit + usage + can invite)
 * @param {number} orgId - Organization ID
 * @returns {Promise<{seatLimit: number, activeMembers: number, pendingInvites: number, seatsUsed: number, canInvite: boolean}>}
 */
async function getSeatInfo(orgId) {
  const [seatLimit, usage] = await Promise.all([
    getSeatLimit(orgId),
    getSeatUsage(orgId)
  ]);

  return {
    seatLimit,
    activeMembers: usage.activeMembers,
    pendingInvites: usage.pendingInvites,
    seatsUsed: usage.seatsUsed,
    canInvite: usage.seatsUsed < seatLimit
  };
}

/**
 * Check if organization can add a new invite/member
 * @param {number} orgId - Organization ID
 * @returns {Promise<{canInvite: boolean, seatLimit: number, seatsUsed: number}>}
 */
async function canAddSeat(orgId) {
  const seatInfo = await getSeatInfo(orgId);
  return {
    canInvite: seatInfo.canInvite,
    seatLimit: seatInfo.seatLimit,
    seatsUsed: seatInfo.seatsUsed
  };
}

module.exports = {
  PLAN_SEAT_LIMITS,
  getSeatLimit,
  getSeatUsage,
  getSeatInfo,
  canAddSeat
};
