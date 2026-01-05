/**
 * Entitlements V2 Service
 *
 * Org-scoped entitlements using the v2 usage_events table.
 * This service reads from the event-sourced usage system.
 *
 * Phase 2D: When USAGE_V2_READ_ENABLED=true, this service is used
 * to check limits and get quota information instead of legacy user-level tracking.
 *
 * IMPORTANT: v2 mode is only safe when BOTH read AND dual-write are enabled.
 * If read is on but dual-write is off, we fall back to legacy to prevent drift.
 *
 * Depends on DB functions from 008_usage_foundation.sql:
 *   - check_usage_limit(org_id, event_type)
 *   - get_usage_summary(org_id)
 */

const db = require('../db/database');
const { USAGE_EVENT_TYPES } = require('../constants/usageEventTypes');

// Module-level flag to prevent spamming the guardrail warning
let _warnedAboutMismatchedFlags = false;

/**
 * Check if v2 read is enabled (raw flag check)
 * @returns {boolean}
 */
function isUsageV2ReadEnabled() {
  return process.env.USAGE_V2_READ_ENABLED === 'true';
}

/**
 * Check if v2 dual-write is enabled
 * @returns {boolean}
 */
function isUsageV2DualWriteEnabled() {
  return process.env.USAGE_V2_DUAL_WRITE_ENABLED === 'true';
}

/**
 * Check if v2 mode is SAFELY enabled.
 * v2 is only safe when BOTH read AND dual-write are on.
 * This prevents stale enforcement (reading from v2 while not writing to it).
 *
 * @returns {boolean}
 */
function isV2ModeSafelyEnabled() {
  const readEnabled = isUsageV2ReadEnabled();
  const dualWriteEnabled = isUsageV2DualWriteEnabled();

  // Guardrail: warn once if read is on but dual-write is off
  if (readEnabled && !dualWriteEnabled && !_warnedAboutMismatchedFlags) {
    console.warn('⚠️ USAGE_V2_READ_ENABLED is true but USAGE_V2_DUAL_WRITE_ENABLED is not; falling back to legacy quota enforcement.');
    _warnedAboutMismatchedFlags = true;
  }

  return readEnabled && dualWriteEnabled;
}

/**
 * Resolve the quota mode for a request.
 * Returns the mode and orgId to use for quota operations.
 *
 * @param {object} req - Express request object
 * @returns {{ mode: 'v2' | 'legacy' | 'legacy_fallback', orgId: number | null }}
 */
function resolveQuotaMode(req) {
  const orgId = req.orgId ?? req.org?.id ?? null;

  // v2 mode requires:
  // 1. Both read AND dual-write enabled (safe config)
  // 2. An organization context
  if (isV2ModeSafelyEnabled() && orgId) {
    return { mode: 'v2', orgId };
  }

  // If read is enabled but dual-write is not, use legacy_fallback
  if (isUsageV2ReadEnabled() && !isUsageV2DualWriteEnabled()) {
    return { mode: 'legacy_fallback', orgId };
  }

  return { mode: 'legacy', orgId };
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

/**
 * Build a legacy quota response object.
 * Used when v2 is not enabled or as a fallback.
 *
 * @param {object} user - User object with scans_used_this_month, competitor_scans_used_this_month
 * @param {object} planLimits - Plan limits object with scansPerMonth, competitorScans
 * @param {object} options - Options like { pendingPrimaryScan, pendingCompetitorScan }
 * @param {string} source - 'legacy' or 'legacy_fallback'
 * @returns {object}
 */
function buildLegacyQuotaResponse(user, planLimits, options = {}, source = 'legacy') {
  const { pendingPrimaryScan = false, pendingCompetitorScan = false } = options;

  return {
    scansUsed: (user.scans_used_this_month || 0) + (pendingPrimaryScan ? 1 : 0),
    scansLimit: planLimits?.scansPerMonth ?? null,
    competitorScansUsed: (user.competitor_scans_used_this_month || 0) + (pendingCompetitorScan ? 1 : 0),
    competitorScansLimit: planLimits?.competitorScans ?? null,
    periodStart: null,
    periodEnd: null,
    plan: user.plan,
    source
  };
}

/**
 * Build the full quota response for scan endpoints.
 * Includes both the v2 quota (or legacy) AND the legacy quota for backwards compat.
 *
 * @param {object} req - Express request object
 * @param {object} user - User object
 * @param {object} planLimits - Plan limits object
 * @param {object} options - { pendingPrimaryScan, pendingCompetitorScan }
 * @returns {Promise<{ quota: object, quotaLegacy: object }>}
 */
async function buildScanQuotaResponse(req, user, planLimits, options = {}) {
  const { mode, orgId } = resolveQuotaMode(req);
  const { pendingPrimaryScan = false, pendingCompetitorScan = false } = options;

  // Always build legacy quota for backwards compatibility
  const legacyQuota = buildLegacyQuotaResponse(user, planLimits, options, mode === 'legacy_fallback' ? 'legacy_fallback' : 'legacy');

  if (mode === 'v2') {
    // Get v2 quota
    const v2Quota = await getQuotaResponse(orgId);

    // Adjust for pending scan (not yet written to DB)
    if (pendingPrimaryScan) {
      v2Quota.scansUsed = (v2Quota.scansUsed || 0) + 1;
    }
    if (pendingCompetitorScan) {
      v2Quota.competitorScansUsed = (v2Quota.competitorScansUsed || 0) + 1;
    }

    return {
      quota: v2Quota,
      quotaLegacy: {
        primary: {
          used: legacyQuota.scansUsed,
          limit: legacyQuota.scansLimit
        },
        competitor: {
          used: legacyQuota.competitorScansUsed,
          limit: legacyQuota.competitorScansLimit
        }
      }
    };
  }

  // Legacy mode: return legacy quota in v2 format shape for consistency
  return {
    quota: legacyQuota,
    quotaLegacy: null
  };
}

module.exports = {
  isUsageV2ReadEnabled,
  isUsageV2DualWriteEnabled,
  isV2ModeSafelyEnabled,
  resolveQuotaMode,
  checkOrgLimit,
  getOrgQuota,
  checkScanLimitV2,
  getQuotaResponse,
  buildLegacyQuotaResponse,
  buildScanQuotaResponse,
  USAGE_EVENT_TYPES
};
