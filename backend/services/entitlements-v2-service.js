/**
 * Entitlements V2 Service
 *
 * Org-scoped entitlements using the v2 usage_events table.
 * This service reads from the event-sourced usage system.
 *
 * Phase 2D: When USAGE_V2_READ_ENABLED=true, this service is used
 * to check limits and get quota information instead of legacy user-level tracking.
 *
 * Depends on DB functions from 008_usage_foundation.sql:
 *   - check_usage_limit(org_id, event_type)
 *   - get_usage_summary(org_id)
 */

const db = require('../db/database');
const { USAGE_EVENT_TYPES } = require('../constants/usageEventTypes');

/**
 * Check if v2 read is enabled
 * @returns {boolean}
 */
function isUsageV2ReadEnabled() {
  return process.env.USAGE_V2_READ_ENABLED === 'true';
}

/**
 * Check if an organization can perform a specific action.
 * Uses the v2 usage_events table for limit checking.
 *
 * @param {number} orgId - Organization ID
 * @param {string} eventType - Event type (from USAGE_EVENT_TYPES)
 * @returns {Promise<{allowed: boolean, used: number, limit: number, message: string}>}
 */
async function checkOrgLimit(orgId, eventType) {
  // Validate inputs
  if (!orgId) {
    return {
      allowed: false,
      used: 0,
      limit: 0,
      message: 'Organization context required'
    };
  }

  try {
    const result = await db.query(
      `SELECT * FROM check_usage_limit($1, $2)`,
      [orgId, eventType]
    );

    if (result.rows.length === 0) {
      // No period exists - allow (will be created on first event)
      return {
        allowed: true,
        used: 0,
        limit: -1,
        message: 'No usage period'
      };
    }

    const row = result.rows[0];
    return {
      allowed: row.allowed,
      used: Number(row.current_usage) || 0,
      limit: row.limit_value,
      message: row.message
    };
  } catch (error) {
    console.error(`❌ checkOrgLimit failed for org ${orgId}:`, error.message);
    // Fail open - don't block users on DB errors
    return {
      allowed: true,
      used: 0,
      limit: -1,
      message: 'Error checking limit'
    };
  }
}

/**
 * Get the full usage quota summary for an organization.
 * Returns current period info and usage counts.
 *
 * @param {number} orgId - Organization ID
 * @returns {Promise<{period: object, usage: object, limits: object} | null>}
 */
async function getOrgQuota(orgId) {
  if (!orgId) {
    return null;
  }

  try {
    const result = await db.query(
      `SELECT * FROM get_usage_summary($1)`,
      [orgId]
    );

    if (result.rows.length === 0) {
      // No usage period exists yet
      return {
        period: null,
        usage: {
          scans: 0,
          competitorScans: 0,
          recommendationsGenerated: 0
        },
        limits: null
      };
    }

    const row = result.rows[0];
    return {
      period: {
        id: row.period_id,
        start: row.period_start,
        end: row.period_end,
        plan: row.plan
      },
      usage: {
        scans: Number(row.scans_used) || 0,
        competitorScans: Number(row.competitor_scans_used) || 0,
        recommendationsGenerated: Number(row.recommendations_generated) || 0
      },
      limits: row.limits || {}
    };
  } catch (error) {
    console.error(`❌ getOrgQuota failed for org ${orgId}:`, error.message);
    return null;
  }
}

/**
 * Check scan limit for an organization (convenience wrapper).
 *
 * @param {number} orgId - Organization ID
 * @param {string} scanType - 'primary' or 'competitor'
 * @returns {Promise<{allowed: boolean, used: number, limit: number, message: string}>}
 */
async function checkScanLimitV2(orgId, scanType = 'primary') {
  const eventType = scanType === 'competitor'
    ? USAGE_EVENT_TYPES.COMPETITOR_SCAN
    : USAGE_EVENT_TYPES.SCAN_COMPLETED;

  return checkOrgLimit(orgId, eventType);
}

/**
 * Get formatted quota response for API endpoints.
 * Used by /me and other endpoints that return usage info.
 *
 * @param {number} orgId - Organization ID
 * @returns {Promise<object>}
 */
async function getQuotaResponse(orgId) {
  const quota = await getOrgQuota(orgId);

  if (!quota) {
    return {
      scansUsed: 0,
      scansLimit: null,
      competitorScansUsed: 0,
      competitorScansLimit: null,
      source: 'v2'
    };
  }

  return {
    scansUsed: quota.usage.scans,
    scansLimit: quota.limits?.scans ?? null,
    competitorScansUsed: quota.usage.competitorScans,
    competitorScansLimit: quota.limits?.competitor_scans ?? null,
    periodStart: quota.period?.start,
    periodEnd: quota.period?.end,
    plan: quota.period?.plan,
    source: 'v2'
  };
}

module.exports = {
  isUsageV2ReadEnabled,
  checkOrgLimit,
  getOrgQuota,
  checkScanLimitV2,
  getQuotaResponse,
  USAGE_EVENT_TYPES
};
