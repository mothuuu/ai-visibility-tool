/**
 * Usage Service
 *
 * SINGLE SOURCE OF TRUTH for usage tracking and enforcement.
 * Fixes the "monthly reset broken" bug by ensuring reset is ALWAYS checked.
 *
 * Phase 2: Hybrid approach for safety:
 * - Primary: usage_periods + usage_events (if tables exist)
 * - Fallback: legacy users.scans_used_this_month
 * - Dual-write where possible to prevent drift
 *
 * CRITICAL FIX: Scan route MUST call checkAndResetIfNeeded() BEFORE reading usage.
 */

const db = require('../db/database');
const { getEntitlements } = require('./scanEntitlementService');
const { USAGE_EVENT_TYPES } = require('../constants/usageEventTypes');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Check if v2 usage tables exist and should be used
 */
let _v2TablesChecked = false;
let _v2TablesExist = false;

async function checkV2TablesExist() {
  if (_v2TablesChecked) return _v2TablesExist;

  try {
    const result = await db.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('usage_periods', 'usage_events')
    `);
    _v2TablesExist = parseInt(result.rows[0].count) === 2;
    _v2TablesChecked = true;
    console.log(`[UsageService] v2 tables exist: ${_v2TablesExist}`);
  } catch (error) {
    console.error('[UsageService] Error checking v2 tables:', error.message);
    _v2TablesExist = false;
    _v2TablesChecked = true;
  }

  return _v2TablesExist;
}

/**
 * Check if dual-write is enabled
 */
function isDualWriteEnabled() {
  return process.env.USAGE_V2_DUAL_WRITE_ENABLED === 'true';
}

// =============================================================================
// BILLING PERIOD
// =============================================================================

/**
 * Get billing period bounds for a user
 * Uses Stripe period if available, else calendar month
 *
 * @param {object} params
 * @param {object} params.userRow - User row from database
 * @param {string} params.planId - Plan ID (for determining period type)
 * @param {Date} params.now - Current date (optional, defaults to now)
 * @returns {{ start: Date, end: Date, source: string }}
 */
function getPeriodBounds({ userRow, planId, now = new Date() }) {
  // For paid plans with Stripe period, use Stripe dates
  const isPaidPlan = ['diy', 'pro', 'agency', 'enterprise'].includes(planId);

  if (isPaidPlan && userRow.stripe_current_period_start && userRow.stripe_current_period_end) {
    return {
      start: new Date(userRow.stripe_current_period_start),
      end: new Date(userRow.stripe_current_period_end),
      source: 'stripe'
    };
  }

  // Fall back to calendar month
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 1, 0, 0, 0, 0);

  return {
    start,
    end,
    source: 'calendar_month'
  };
}

// =============================================================================
// RESET LOGIC (CRITICAL FIX)
// =============================================================================

/**
 * Check if legacy counters need reset and reset if needed.
 * This is the CRITICAL fix for "monthly reset broken".
 *
 * MUST be called BEFORE reading scans_used_this_month.
 *
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} - True if reset was performed
 */
async function checkAndResetLegacyIfNeeded(userId) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Get current user state
  const result = await db.query(
    'SELECT quota_reset_date, scans_used_this_month FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  const user = result.rows[0];
  const quotaResetDate = user.quota_reset_date;

  // Parse last reset date to get its month
  let lastResetMonth = null;
  if (quotaResetDate) {
    const resetDate = new Date(quotaResetDate);
    lastResetMonth = `${resetDate.getFullYear()}-${String(resetDate.getMonth() + 1).padStart(2, '0')}`;
  }

  // If different month (or never reset), reset the counters
  if (lastResetMonth !== currentMonth) {
    console.log(`[UsageService] 🔄 Monthly reset for user ${userId}: ${lastResetMonth || 'never'} → ${currentMonth}`);

    await db.query(`
      UPDATE users
      SET scans_used_this_month = 0,
          competitor_scans_used_this_month = 0,
          recs_generated_this_month = 0,
          quota_reset_date = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [userId]);

    return true;
  }

  return false;
}

// =============================================================================
// USAGE READING
// =============================================================================

/**
 * Get usage for current period
 *
 * @param {object} params
 * @param {number} params.userId - User ID
 * @param {number|null} params.orgId - Organization ID (optional)
 * @param {Date} params.start - Period start date
 * @returns {Promise<{ scansUsed: number, competitorScansUsed: number, source: string }>}
 */
async function getUsageThisPeriod({ userId, orgId, start }) {
  const v2Exists = await checkV2TablesExist();

  // Try v2 first if available and org context exists
  if (v2Exists && orgId && isDualWriteEnabled()) {
    try {
      const result = await db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN event_type = $1 THEN 1 ELSE 0 END), 0) as scans_used,
          COALESCE(SUM(CASE WHEN event_type = $2 THEN 1 ELSE 0 END), 0) as competitor_scans_used
        FROM usage_events
        WHERE organization_id = $3
          AND created_at >= $4
      `, [
        USAGE_EVENT_TYPES.SCAN_COMPLETED,
        USAGE_EVENT_TYPES.COMPETITOR_SCAN,
        orgId,
        start
      ]);

      return {
        scansUsed: parseInt(result.rows[0].scans_used) || 0,
        competitorScansUsed: parseInt(result.rows[0].competitor_scans_used) || 0,
        source: 'v2_events'
      };
    } catch (error) {
      console.error('[UsageService] v2 query failed, falling back to legacy:', error.message);
    }
  }

  // Fall back to legacy counters (with reset check first!)
  await checkAndResetLegacyIfNeeded(userId);

  const result = await db.query(
    'SELECT scans_used_this_month, competitor_scans_used_this_month FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return { scansUsed: 0, competitorScansUsed: 0, source: 'legacy_not_found' };
  }

  return {
    scansUsed: result.rows[0].scans_used_this_month || 0,
    competitorScansUsed: result.rows[0].competitor_scans_used_this_month || 0,
    source: 'legacy'
  };
}

/**
 * Get full usage summary including limits and period info
 *
 * @param {object} params
 * @param {number} params.userId - User ID
 * @param {number|null} params.orgId - Organization ID (optional)
 * @param {string} params.planId - Plan ID
 * @param {object} params.userRow - Full user row (optional, for period bounds)
 * @returns {Promise<object>}
 */
async function getUsageSummary({ userId, orgId, planId, userRow }) {
  const entitlements = getEntitlements(planId);
  const now = new Date();

  // Get period bounds
  let periodBounds;
  if (userRow) {
    periodBounds = getPeriodBounds({ userRow, planId, now });
  } else {
    // Fetch user row if not provided
    const result = await db.query(
      'SELECT stripe_current_period_start, stripe_current_period_end FROM users WHERE id = $1',
      [userId]
    );
    periodBounds = getPeriodBounds({
      userRow: result.rows[0] || {},
      planId,
      now
    });
  }

  // Get usage
  const usage = await getUsageThisPeriod({ userId, orgId, start: periodBounds.start });

  return {
    scans: {
      used: usage.scansUsed,
      limit: entitlements.scans_per_period,
      remaining: entitlements.scans_per_period === -1
        ? -1
        : Math.max(0, entitlements.scans_per_period - usage.scansUsed)
    },
    competitorScans: {
      used: usage.competitorScansUsed,
      limit: entitlements.competitor_scans,
      remaining: Math.max(0, entitlements.competitor_scans - usage.competitorScansUsed)
    },
    period: {
      start: periodBounds.start.toISOString(),
      end: periodBounds.end.toISOString(),
      source: periodBounds.source
    },
    plan: planId,
    source: usage.source
  };
}

// =============================================================================
// USAGE WRITING
// =============================================================================

/**
 * Increment a usage event
 * Dual-writes to both v2 and legacy if enabled
 *
 * @param {object} params
 * @param {number} params.userId - User ID
 * @param {number|null} params.orgId - Organization ID
 * @param {string} params.eventType - Event type (from USAGE_EVENT_TYPES)
 * @param {number|null} params.scanId - Associated scan ID (optional)
 * @returns {Promise<{ success: boolean, newCount: number }>}
 */
async function incrementUsageEvent({ userId, orgId, eventType, scanId = null }) {
  const isCompetitor = eventType === USAGE_EVENT_TYPES.COMPETITOR_SCAN;
  const v2Exists = await checkV2TablesExist();

  // Always update legacy counters first (most reliable)
  const column = isCompetitor ? 'competitor_scans_used_this_month' : 'scans_used_this_month';

  const legacyResult = await db.query(`
    UPDATE users
    SET ${column} = ${column} + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING ${column} as new_count
  `, [userId]);

  const newCount = legacyResult.rows[0]?.new_count || 0;

  // Dual-write to v2 if enabled and org context exists
  // Uses record_usage_event() DB function which auto-resolves period_id
  // via get_or_create_usage_period() — fixes NULL period_id failures
  if (v2Exists && orgId && isDualWriteEnabled()) {
    try {
      await db.query(
        `SELECT * FROM record_usage_event($1, $2, $3, $4, $5)`,
        [orgId, eventType, userId, scanId, JSON.stringify({})]
      );

      console.log(`[UsageService] v2 event recorded: ${eventType} for org ${orgId}`);
    } catch (error) {
      // 23505 = unique_violation → idempotent retry, not an error
      if (error.code === '23505') {
        console.log(`[UsageService] v2 event already exists (idempotent): ${eventType} scan=${scanId}`);
      } else {
        console.error('[UsageService] v2 write failed (continuing with legacy):', error.message);
      }
    }
  }

  return { success: true, newCount };
}

/**
 * Reset usage for a user (for manual intervention or testing)
 *
 * @param {number} userId - User ID
 * @param {string} type - 'primary' | 'competitor' | 'all'
 * @returns {Promise<{ success: boolean }>}
 */
async function resetUsage(userId, type = 'all') {
  let updateFields = [];

  if (type === 'all' || type === 'primary') {
    updateFields.push('scans_used_this_month = 0');
  }
  if (type === 'all' || type === 'competitor') {
    updateFields.push('competitor_scans_used_this_month = 0');
  }

  if (updateFields.length === 0) {
    return { success: false };
  }

  await db.query(`
    UPDATE users
    SET ${updateFields.join(', ')},
        quota_reset_date = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [userId]);

  console.log(`[UsageService] Reset ${type} usage for user ${userId}`);

  return { success: true };
}

// =============================================================================
// ENFORCEMENT
// =============================================================================

/**
 * Check if user can perform a scan (combines reset check + limit check)
 * This is the main function scan routes should use.
 *
 * @param {object} params
 * @param {number} params.userId - User ID
 * @param {number|null} params.orgId - Organization ID
 * @param {string} params.planId - Plan ID
 * @param {boolean} params.isCompetitor - Is this a competitor scan?
 * @param {object} params.userRow - Full user row (optional)
 * @returns {Promise<{ allowed: boolean, reason: string, usage: object }>}
 */
async function canPerformScan({ userId, orgId, planId, isCompetitor = false, userRow }) {
  // CRITICAL: Always check reset first
  await checkAndResetLegacyIfNeeded(userId);

  // Get current usage
  const summary = await getUsageSummary({ userId, orgId, planId, userRow });

  // Check limits
  const usageToCheck = isCompetitor ? summary.competitorScans : summary.scans;

  // Unlimited check
  if (usageToCheck.limit === -1) {
    return {
      allowed: true,
      reason: 'Unlimited scans',
      usage: summary
    };
  }

  // At or over limit
  if (usageToCheck.used >= usageToCheck.limit) {
    const scanType = isCompetitor ? 'Competitor scan' : 'Scan';
    return {
      allowed: false,
      reason: `${scanType} limit reached (${usageToCheck.used}/${usageToCheck.limit})`,
      usage: summary
    };
  }

  return {
    allowed: true,
    reason: 'Within limit',
    usage: summary
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Period helpers
  getPeriodBounds,

  // Reset (CRITICAL)
  checkAndResetLegacyIfNeeded,

  // Usage reading
  getUsageThisPeriod,
  getUsageSummary,

  // Usage writing
  incrementUsageEvent,
  resetUsage,

  // Enforcement (main entry point)
  canPerformScan,

  // Internal helpers (for testing)
  checkV2TablesExist,
  isDualWriteEnabled
};
