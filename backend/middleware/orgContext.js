/**
 * Organization Context Middleware
 *
 * THE SINGLE SOURCE OF TRUTH for org context in requests.
 *
 * IMPORTANT: This middleware MUST run AFTER authenticateToken
 * because it depends on req.user being set.
 *
 * Sets on req:
 *   req.orgId       - Organization ID (number or null)
 *   req.org         - Organization object (or null)
 *   req.orgRole     - User's role name in the org (or null)
 *
 * Feature flags:
 *   ORG_CONTEXT_ENABLED - Enable/disable (default: false)
 *   ORG_CONTEXT_DEBUG   - Log when context loads (default: false)
 *
 * Operational note:
 *   When ORG_CONTEXT_ENABLED=true, this adds ONE DB query per request
 *   for routes where this middleware is mounted (Pattern B), or globally
 *   for protected routes (Pattern A). This is expected for Phase 2A.
 */

const db = require('../db/database');

/**
 * Load organization context after authentication.
 *
 * REQUIRES: req.user to be set by authenticateToken middleware.
 * Also supports req.userId for compatibility with routes that set userId directly.
 * Non-blocking: errors log warning but don't fail the request.
 */
async function loadOrgContext(req, res, next) {
  // Skip if feature flag disabled (safe default - no behavior change)
  if (process.env.ORG_CONTEXT_ENABLED !== 'true') {
    return next();
  }

  // Support both req.user.id (central auth middleware) and req.userId (scan routes)
  const userId = req.user?.id || req.userId;

  // Skip if no authenticated user (authenticateToken didn't run or user not logged in)
  if (!userId) {
    return next();
  }

  try {
    // Query org data (intentionally NOT including Stripe fields for safety)
    const result = await db.query(`
      SELECT
        o.id,
        o.name,
        o.slug,
        o.org_type,
        o.plan,
        o.settings,
        om.role_id,
        r.name as role_name
      FROM users u
      JOIN organizations o ON u.organization_id = o.id
      LEFT JOIN organization_members om ON om.organization_id = o.id
        AND om.user_id = u.id
        AND om.status = 'active'
      LEFT JOIN roles r ON om.role_id = r.id
      WHERE u.id = $1
    `, [userId]);

    if (result.rows.length > 0) {
      const row = result.rows[0];
      req.org = {
        id: row.id,
        name: row.name,
        slug: row.slug,
        type: row.org_type,
        plan: row.plan,
        settings: row.settings || {}
        // NOTE: Stripe fields intentionally omitted - add in later phase if needed
      };

      // Defensive: ensure orgId is always a valid number or null
      const orgId = Number(row.id);
      req.orgId = Number.isFinite(orgId) ? orgId : null;

      req.orgRole = row.role_name || 'owner';

      // Debug logging (enable temporarily to verify middleware runs)
      // Does not log user ID for privacy
      if (process.env.ORG_CONTEXT_DEBUG === 'true') {
        console.log('🔵 OrgContext loaded', {
          hasUser: true,
          orgId: req.orgId,
          role: req.orgRole
        });
      }
    } else {
      // User has no organization - shouldn't happen after Phase 1
      console.warn('⚠️ User has no organization - check Phase 1 backfill');
      req.org = null;
      req.orgId = null;
      req.orgRole = null;
    }

    next();
  } catch (error) {
    console.error('❌ Failed to load org context:', error.message);
    // Don't fail the request - just continue without org context
    req.org = null;
    req.orgId = null;
    req.orgRole = null;
    next();
  }
}

/**
 * Require organization context (for use in Phase 2B+).
 * Use on routes that MUST have org scoping.
 */
function requireOrgContext(req, res, next) {
  // Skip enforcement if feature flag disabled
  if (process.env.ORG_CONTEXT_ENABLED !== 'true') {
    return next();
  }

  // IMPORTANT: check null/undefined only (avoid false negatives for "0")
  if (req.orgId == null) {
    console.error('🚨 requireOrgContext failed - no org context');
    return res.status(403).json({
      error: 'Organization context required',
      code: 'NO_ORG_CONTEXT',
      message: 'Your account is not associated with an organization.'
    });
  }

  next();
}

module.exports = {
  loadOrgContext,
  requireOrgContext
};
