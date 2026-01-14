/**
 * Scan Entitlement Service
 *
 * SINGLE SOURCE OF TRUTH for scan-related entitlements.
 * This is the ONLY place where plan limits for scans should be defined.
 *
 * Phase 2: Centralizes all scan entitlement logic to prevent scattered hardcoding.
 *
 * IMPORTANT: All route handlers should use this service instead of accessing
 * PLAN_LIMITS directly from middleware/usageLimits.js
 */

// =============================================================================
// PLAN ENTITLEMENTS - SINGLE SOURCE OF TRUTH
// =============================================================================

/**
 * Canonical plan entitlements for scans.
 * DO NOT access this directly - use getEntitlements(planId) instead.
 */
const SCAN_ENTITLEMENTS = {
  free: {
    scans_per_period: 2,
    pages_per_scan: 1,
    competitor_scans: 0,
    recs_per_cycle: 3,
    cycle_days: 30,
    batch_size: 3,
    max_domains: 1,
    max_team_seats: 1,
    features: {
      multi_page_scan: false,
      page_selection: false,
      competitor_analysis: false,
      pdf_export: false,
      json_ld_export: false,
      progress_tracking: true,
      page_todo_lists: false,
      brand_visibility_index: false,
      outside_in_crawl: false
    }
  },
  freemium: {
    scans_per_period: 1,
    pages_per_scan: 1,
    competitor_scans: 0,
    recs_per_cycle: 3,
    cycle_days: 30,
    batch_size: 3,
    max_domains: 1,
    max_team_seats: 1,
    features: {
      multi_page_scan: false,
      page_selection: false,
      competitor_analysis: false,
      pdf_export: false,
      json_ld_export: false,
      progress_tracking: false,
      page_todo_lists: false,
      brand_visibility_index: false,
      outside_in_crawl: false
    }
  },
  diy: {
    scans_per_period: 25,
    pages_per_scan: 5,
    competitor_scans: 1,
    recs_per_cycle: 5,
    cycle_days: 5,
    batch_size: 5,
    max_domains: 1,
    max_team_seats: 1,
    features: {
      multi_page_scan: true,
      page_selection: true,
      competitor_analysis: false,
      pdf_export: false,
      json_ld_export: true,
      progress_tracking: true,
      page_todo_lists: true,
      brand_visibility_index: false,
      outside_in_crawl: false
    }
  },
  starter: {
    // Alias for DIY
    scans_per_period: 25,
    pages_per_scan: 5,
    competitor_scans: 1,
    recs_per_cycle: 5,
    cycle_days: 5,
    batch_size: 5,
    max_domains: 1,
    max_team_seats: 1,
    features: {
      multi_page_scan: true,
      page_selection: true,
      competitor_analysis: false,
      pdf_export: false,
      json_ld_export: true,
      progress_tracking: true,
      page_todo_lists: true,
      brand_visibility_index: false,
      outside_in_crawl: false
    }
  },
  pro: {
    scans_per_period: 50,
    pages_per_scan: 25,
    competitor_scans: 3,
    recs_per_cycle: 10,
    cycle_days: 5,
    batch_size: 10,
    max_domains: 1,
    max_team_seats: 3,
    features: {
      multi_page_scan: true,
      page_selection: true,
      competitor_analysis: true,
      pdf_export: true,
      json_ld_export: true,
      progress_tracking: true,
      page_todo_lists: true,
      brand_visibility_index: true,
      outside_in_crawl: true
    }
  },
  agency: {
    scans_per_period: -1, // Unlimited
    pages_per_scan: -1,   // Unlimited
    competitor_scans: 10,
    recs_per_cycle: 15,
    cycle_days: 3,
    batch_size: 15,
    max_domains: 10,
    max_team_seats: -1, // Unlimited
    features: {
      multi_page_scan: true,
      page_selection: true,
      competitor_analysis: true,
      pdf_export: true,
      json_ld_export: true,
      progress_tracking: true,
      page_todo_lists: true,
      brand_visibility_index: true,
      outside_in_crawl: true
    }
  },
  enterprise: {
    scans_per_period: -1, // Unlimited
    pages_per_scan: -1,   // Unlimited
    competitor_scans: 10,
    recs_per_cycle: 15,
    cycle_days: 3,
    batch_size: 15,
    max_domains: 10,
    max_team_seats: 5,
    features: {
      multi_page_scan: true,
      page_selection: true,
      competitor_analysis: true,
      pdf_export: true,
      json_ld_export: true,
      progress_tracking: true,
      page_todo_lists: true,
      brand_visibility_index: true,
      outside_in_crawl: true
    }
  }
};

// Plan aliases for normalization
const PLAN_ALIASES = {
  'plan_diy': 'diy',
  'plan_pro': 'pro',
  'plan_enterprise': 'enterprise',
  'plan_agency': 'agency',
  'plan_free': 'free',
  'plan_freemium': 'freemium',
  'basic': 'diy',
  'professional': 'pro',
  'business': 'enterprise',
  'team': 'agency',
  'teams': 'agency'
};

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Normalize plan ID to canonical form
 * @param {string} planId - Raw plan ID
 * @returns {string} - Normalized plan ID (defaults to 'free' if unknown)
 *
 * NOTE: 'freemium' is normalized to 'free' for consistency.
 * The 'freemium' key still exists in SCAN_ENTITLEMENTS for backwards compatibility
 * but should be treated as equivalent to 'free'.
 */
function normalizePlan(planId) {
  if (!planId) return 'free';

  const lowered = String(planId).toLowerCase().trim();

  // Explicit freemium -> free normalization
  if (lowered === 'freemium') return 'free';

  // Check aliases first
  if (PLAN_ALIASES[lowered]) {
    return PLAN_ALIASES[lowered];
  }

  // Check if it's already a valid plan
  if (SCAN_ENTITLEMENTS[lowered]) {
    return lowered;
  }

  // Unknown plan → free
  console.warn(`[ScanEntitlementService] Unknown plan '${planId}' normalized to 'free'`);
  return 'free';
}

/**
 * Get entitlements for a plan
 * @param {string} planId - Plan ID (will be normalized)
 * @returns {object} - Full entitlements object
 */
function getEntitlements(planId) {
  const normalizedPlan = normalizePlan(planId);
  const entitlements = SCAN_ENTITLEMENTS[normalizedPlan];

  // Return a copy with the plan ID included
  return {
    ...entitlements,
    plan: normalizedPlan
  };
}

/**
 * Check if user can perform a scan
 * @param {object} entitlements - Entitlements from getEntitlements()
 * @param {object} usageSummary - Usage summary { scansUsed, competitorScansUsed }
 * @param {boolean} isCompetitor - Whether this is a competitor scan
 * @returns {{ allowed: boolean, reason: string, remaining: number, limit: number, used: number }}
 */
function canScan(entitlements, usageSummary, isCompetitor = false) {
  const limit = isCompetitor ? entitlements.competitor_scans : entitlements.scans_per_period;
  const used = isCompetitor ? (usageSummary.competitorScansUsed || 0) : (usageSummary.scansUsed || 0);

  // Unlimited (-1) always allows
  if (limit === -1) {
    return {
      allowed: true,
      reason: 'Unlimited scans',
      remaining: -1,
      limit: -1,
      used
    };
  }

  const remaining = Math.max(0, limit - used);

  if (used >= limit) {
    const scanType = isCompetitor ? 'competitor scan' : 'scan';
    return {
      allowed: false,
      reason: `${scanType.charAt(0).toUpperCase() + scanType.slice(1)} limit reached (${used}/${limit})`,
      remaining: 0,
      limit,
      used
    };
  }

  return {
    allowed: true,
    reason: 'Within limit',
    remaining,
    limit,
    used
  };
}

/**
 * Check if user can scan requested number of pages
 * @param {object} entitlements - Entitlements from getEntitlements()
 * @param {number} requestedPageCount - Number of pages requested
 * @returns {{ allowed: boolean, reason: string, maxPages: number }}
 */
function canScanPages(entitlements, requestedPageCount) {
  const maxPages = entitlements.pages_per_scan;

  // Unlimited (-1) always allows
  if (maxPages === -1) {
    return {
      allowed: true,
      reason: 'Unlimited pages',
      maxPages: -1
    };
  }

  if (requestedPageCount > maxPages) {
    return {
      allowed: false,
      reason: `Page limit exceeded (${requestedPageCount}/${maxPages})`,
      maxPages
    };
  }

  return {
    allowed: true,
    reason: 'Within page limit',
    maxPages
  };
}

/**
 * Get recommendation limits for a plan
 * @param {string} planId - Plan ID
 * @returns {{ recsPerCycle: number, cycleDays: number, batchSize: number }}
 */
function getRecommendationLimits(planId) {
  const entitlements = getEntitlements(planId);
  return {
    recsPerCycle: entitlements.recs_per_cycle,
    cycleDays: entitlements.cycle_days,
    batchSize: entitlements.batch_size
  };
}

/**
 * Check if plan has a specific feature
 * @param {object} entitlements - Entitlements from getEntitlements()
 * @param {string} featureKey - Feature key (snake_case)
 * @returns {boolean}
 */
function hasFeature(entitlements, featureKey) {
  return entitlements.features?.[featureKey] === true;
}

/**
 * Get upgrade suggestion for a plan
 * @param {string} currentPlan - Current plan ID
 * @returns {{ nextPlan: string, message: string, ctaUrl: string } | null}
 */
function getUpgradeSuggestion(currentPlan) {
  const normalized = normalizePlan(currentPlan);

  switch (normalized) {
    case 'free':
    case 'freemium':
      return {
        nextPlan: 'diy',
        message: 'Upgrade to DIY for 25 scans/month and 5 pages per scan',
        ctaUrl: '/checkout.html?plan=diy'
      };
    case 'diy':
    case 'starter':
      return {
        nextPlan: 'pro',
        message: 'Upgrade to Pro for 50 scans/month and competitor analysis',
        ctaUrl: '/checkout.html?plan=pro'
      };
    case 'pro':
      return {
        nextPlan: 'enterprise',
        message: 'Contact sales for Enterprise features',
        ctaUrl: '/contact-sales'
      };
    default:
      return null;
  }
}

/**
 * Validate entitlements shape at boot time
 * Logs warnings for missing required keys
 */
function validateEntitlementsShape() {
  const requiredKeys = [
    'scans_per_period',
    'pages_per_scan',
    'competitor_scans',
    'recs_per_cycle',
    'cycle_days',
    'batch_size',
    'max_domains',
    'max_team_seats',
    'features'
  ];

  const requiredFeatures = [
    'multi_page_scan',
    'page_selection',
    'competitor_analysis',
    'pdf_export',
    'json_ld_export',
    'progress_tracking'
  ];

  let hasErrors = false;

  for (const [plan, entitlements] of Object.entries(SCAN_ENTITLEMENTS)) {
    for (const key of requiredKeys) {
      if (entitlements[key] === undefined) {
        console.error(`[ScanEntitlementService] MISSING KEY: ${plan}.${key}`);
        hasErrors = true;
      }
    }

    if (entitlements.features) {
      for (const feature of requiredFeatures) {
        if (entitlements.features[feature] === undefined) {
          console.error(`[ScanEntitlementService] MISSING FEATURE: ${plan}.features.${feature}`);
          hasErrors = true;
        }
      }
    }
  }

  if (hasErrors) {
    console.error('[ScanEntitlementService] ⚠️ Entitlements validation failed - check configuration!');
  } else {
    console.log('[ScanEntitlementService] ✓ Entitlements validation passed');
  }

  return !hasErrors;
}

// =============================================================================
// LEGACY COMPATIBILITY
// =============================================================================

/**
 * Get PLAN_LIMITS compatible object for legacy code
 * @deprecated Use getEntitlements() instead
 */
function getLegacyPlanLimits(planId) {
  const e = getEntitlements(planId);
  return {
    scansPerMonth: e.scans_per_period,
    pagesPerScan: e.pages_per_scan,
    competitorScans: e.competitor_scans,
    multiPageScan: e.features.multi_page_scan,
    pageSelection: e.features.page_selection,
    competitorAnalysis: e.features.competitor_analysis,
    pdfExport: e.features.pdf_export,
    jsonLdExport: e.features.json_ld_export,
    progressTracking: e.features.progress_tracking,
    pageTodoLists: e.features.page_todo_lists,
    brandVisibilityIndex: e.features.brand_visibility_index,
    outsideInCrawl: e.features.outside_in_crawl
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Core functions
  normalizePlan,
  getEntitlements,
  canScan,
  canScanPages,
  getRecommendationLimits,
  hasFeature,
  getUpgradeSuggestion,
  validateEntitlementsShape,

  // Legacy compatibility
  getLegacyPlanLimits,

  // Constants (for advanced use cases only)
  SCAN_ENTITLEMENTS,
  PLAN_ALIASES
};
