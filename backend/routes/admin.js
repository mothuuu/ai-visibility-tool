/**
 * Admin Routes
 * Phase 2.1: Admin endpoints for org and plan management
 *
 * All routes require admin authentication
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticateAdmin, authenticateSuperAdmin, createAuditLog } = require('../middleware/adminAuth');
const { setOrgPlanOverride, resolvePlanForRequest, getOrgRow } = require('../services/planService');
const { getEntitlements } = require('../services/scanEntitlementService');

// ============================================
// GET /api/admin/orgs/:orgId - Get organization details
// ============================================
router.get('/orgs/:orgId', authenticateAdmin, async (req, res) => {
  try {
    const { orgId } = req.params;

    const result = await db.query(`
      SELECT
        o.id,
        o.name,
        o.slug,
        o.org_type,
        o.plan,
        o.plan_source,
        o.plan_override,
        o.plan_override_set_at,
        o.plan_override_set_by,
        o.plan_override_reason,
        o.stripe_customer_id,
        o.stripe_subscription_id,
        o.stripe_subscription_status,
        o.stripe_price_id,
        o.stripe_current_period_start,
        o.stripe_current_period_end,
        o.seat_limit,
        o.owner_user_id,
        o.created_at,
        o.updated_at,
        u.email as owner_email
      FROM organizations o
      LEFT JOIN users u ON o.owner_user_id = u.id
      WHERE o.id = $1
    `, [orgId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const org = result.rows[0];

    // Resolve effective plan
    const planResolution = await resolvePlanForRequest({ orgId: parseInt(orgId) });

    res.json({
      success: true,
      organization: org,
      effectivePlan: {
        plan: planResolution.plan,
        source: planResolution.source
      },
      entitlements: getEntitlements(planResolution.plan)
    });
  } catch (error) {
    console.error('Admin get org error:', error);
    res.status(500).json({ error: 'Failed to get organization', details: error.message });
  }
});

// ============================================
// POST /api/admin/orgs/:orgId/plan-override - Set/clear plan override
// ============================================
router.post('/orgs/:orgId/plan-override', authenticateSuperAdmin, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { plan_override, reason } = req.body;
    const adminUserId = req.user.id;

    // Validate input
    if (plan_override !== null && plan_override !== undefined) {
      const validPlans = ['free', 'diy', 'pro', 'agency', 'enterprise'];
      if (!validPlans.includes(plan_override.toLowerCase())) {
        return res.status(400).json({
          error: 'Invalid plan',
          message: `Plan must be one of: ${validPlans.join(', ')}`
        });
      }
    }

    if (!reason) {
      return res.status(400).json({
        error: 'Reason required',
        message: 'Please provide a reason for setting/clearing the override'
      });
    }

    // Get org before update for audit log
    const orgBefore = await getOrgRow(parseInt(orgId));
    if (!orgBefore) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Set the override
    const result = await setOrgPlanOverride(
      parseInt(orgId),
      plan_override || null,
      adminUserId,
      reason
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Resolve effective plan after update
    const planResolution = await resolvePlanForRequest({ orgId: parseInt(orgId) });

    // Create audit log
    await createAuditLog(
      req.user,
      plan_override ? 'SET_PLAN_OVERRIDE' : 'CLEAR_PLAN_OVERRIDE',
      'organization',
      orgId,
      `${plan_override ? `Set plan override to ${plan_override}` : 'Cleared plan override'}: ${reason}`,
      {
        before: {
          plan_source: orgBefore.plan_source,
          plan_override: orgBefore.plan_override
        },
        after: {
          plan_source: result.org.plan_source,
          plan_override: result.org.plan_override
        }
      }
    );

    console.log(`[Admin] Org ${orgId} plan override ${plan_override ? `set to ${plan_override}` : 'cleared'} by ${req.user.email}`);

    res.json({
      success: true,
      orgId: parseInt(orgId),
      plan_source: result.org.plan_source,
      plan_override: result.org.plan_override,
      effective_plan: planResolution.plan,
      effective_source: planResolution.source,
      entitlements: getEntitlements(planResolution.plan)
    });
  } catch (error) {
    console.error('Admin set plan override error:', error);
    res.status(500).json({ error: 'Failed to set plan override', details: error.message });
  }
});

// ============================================
// GET /api/admin/users/:userId/plan - Get user's effective plan
// ============================================
router.get('/users/:userId/plan', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user with org
    const userResult = await db.query(`
      SELECT u.id, u.email, u.plan as user_plan, u.organization_id,
             o.id as org_id, o.name as org_name, o.plan as org_plan,
             o.plan_source, o.plan_override
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE u.id = $1
    `, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Resolve effective plan
    const planResolution = await resolvePlanForRequest({
      userId: parseInt(userId),
      orgId: user.organization_id
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        user_plan: user.user_plan,
        organization_id: user.organization_id
      },
      organization: user.org_id ? {
        id: user.org_id,
        name: user.org_name,
        org_plan: user.org_plan,
        plan_source: user.plan_source,
        plan_override: user.plan_override
      } : null,
      effectivePlan: {
        plan: planResolution.plan,
        source: planResolution.source
      },
      entitlements: getEntitlements(planResolution.plan)
    });
  } catch (error) {
    console.error('Admin get user plan error:', error);
    res.status(500).json({ error: 'Failed to get user plan', details: error.message });
  }
});

// ============================================
// GET /api/admin/health - Admin API health check
// ============================================
router.get('/health', authenticateAdmin, async (req, res) => {
  res.json({
    success: true,
    message: 'Admin API healthy',
    admin: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role
    }
  });
});

module.exports = router;
