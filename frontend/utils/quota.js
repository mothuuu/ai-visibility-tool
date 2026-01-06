/**
 * Quota Normalization Helper
 *
 * Normalizes quota responses from backend to a unified v2-shaped object.
 * This is the SINGLE SOURCE OF TRUTH for quota display across the frontend.
 *
 * Usage:
 *   const normalizedQuota = getQuotaDisplay(quota, quotaLegacy);
 *   if (normalizedQuota) {
 *     console.log(normalizedQuota.primary.remaining);
 *   }
 */

/**
 * Safely convert a value to an integer
 * @param {unknown} n - Value to convert
 * @param {number} fallback - Fallback value if conversion fails
 * @returns {number}
 */
function toInt(n, fallback = 0) {
  const x = typeof n === 'number' ? n : parseInt(String(n ?? ''), 10);
  return Number.isFinite(x) ? x : fallback;
}

/**
 * Calculate remaining quota
 * @param {number} limit - Quota limit (-1 means unlimited)
 * @param {number} used - Amount used
 * @returns {number} - Remaining (-1 if unlimited)
 */
function calcRemaining(limit, used) {
  if (limit === -1) return -1; // unlimited
  return Math.max(0, limit - used);
}

/**
 * Normalize quota to unified v2 shape
 *
 * @param {Object|null} quota - v2 quota object from backend (may have primary/competitor)
 * @param {Object|null} quotaLegacy - Legacy quota object (flat structure)
 * @returns {Object|null} - Normalized quota or null if no data
 *
 * Returned shape:
 * {
 *   source: string,
 *   primary: { used: number, limit: number, remaining: number },
 *   competitor: { used: number, limit: number, remaining: number }
 * }
 */
function getQuotaDisplay(quota, quotaLegacy) {
  // Prefer v2 shape if present
  if (quota && quota.primary && quota.competitor) {
    const pUsed = toInt(quota.primary.used, 0);
    const pLimit = toInt(quota.primary.limit, 0);
    const cUsed = toInt(quota.competitor.used, 0);
    const cLimit = toInt(quota.competitor.limit, 0);

    return {
      ...quota,
      primary: { used: pUsed, limit: pLimit, remaining: calcRemaining(pLimit, pUsed) },
      competitor: { used: cUsed, limit: cLimit, remaining: calcRemaining(cLimit, cUsed) }
    };
  }

  // Legacy fallback mapping → v2 shape
  if (quotaLegacy) {
    const pUsed = toInt(quotaLegacy.scansUsedThisMonth ?? quotaLegacy.scans_used_this_month ?? quotaLegacy.scansUsed, 0);
    const pLimit = toInt(quotaLegacy.scansLimit ?? quotaLegacy.scan_limit ?? quotaLegacy.scanLimit, 0);

    const cUsed = toInt(quotaLegacy.competitorScansUsed ?? quotaLegacy.competitor_scans_used ?? quotaLegacy.competitorScansUsedThisMonth, 0);
    const cLimit = toInt(quotaLegacy.competitorScansLimit ?? quotaLegacy.competitor_scan_limit ?? quotaLegacy.competitorScanLimit, 0);

    return {
      source: 'legacy_mapped',
      primary: { used: pUsed, limit: pLimit, remaining: calcRemaining(pLimit, pUsed) },
      competitor: { used: cUsed, limit: cLimit, remaining: calcRemaining(cLimit, cUsed) }
    };
  }

  return null;
}

/**
 * Build quota from user object (fallback when no quota in response)
 * Uses plan-based limits as defaults
 *
 * @param {Object} user - User object with plan and usage info
 * @returns {Object|null} - Normalized quota or null
 */
function getQuotaFromUser(user) {
  if (!user) return null;

  // Plan-based limits (matches backend PLAN_LIMITS)
  const PLAN_LIMITS = {
    free: { primary: 2, competitor: 0 },
    diy: { primary: 25, competitor: 2 },
    pro: { primary: 50, competitor: 3 },
    agency: { primary: -1, competitor: 0 },
    enterprise: { primary: -1, competitor: 10 }
  };

  const limits = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
  const pUsed = toInt(user.scans_used_this_month, 0);
  const cUsed = toInt(user.competitor_scans_used_this_month, 0);

  return {
    source: 'user_fallback',
    primary: { used: pUsed, limit: limits.primary, remaining: calcRemaining(limits.primary, pUsed) },
    competitor: { used: cUsed, limit: limits.competitor, remaining: calcRemaining(limits.competitor, cUsed) }
  };
}

/**
 * Format quota for display (e.g., "23/50" or "Unlimited")
 * @param {number} used
 * @param {number} limit
 * @returns {string}
 */
function formatQuota(used, limit) {
  if (limit === -1) return `${used} (Unlimited)`;
  return `${used}/${limit}`;
}

/**
 * Calculate percentage used
 * @param {number} used
 * @param {number} limit
 * @returns {number} - 0-100
 */
function getQuotaPercent(used, limit) {
  if (limit === -1) return 0; // unlimited shows as 0%
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

// Export for use in other files
if (typeof window !== 'undefined') {
  window.QuotaUtils = {
    getQuotaDisplay,
    getQuotaFromUser,
    formatQuota,
    getQuotaPercent,
    toInt,
    calcRemaining
  };
}
