/**
 * Plan Utilities - Single Source of Truth for Plan Allocations
 *
 * This module provides the canonical definitions for:
 * - Plan names and normalization
 * - Monthly directory allocations per plan
 * - Plan classification (paid vs free)
 */

/**
 * PLAN_ALLOCATIONS - The ONLY source of truth for monthly directory allocations
 * All other code should import from here, not define their own.
 */
const PLAN_ALLOCATIONS = {
  // Free tiers
  free: 0,
  freemium: 0,

  // Paid tiers
  diy: 10,
  pro: 25,
  enterprise: 100,
  agency: 100
};

/**
 * PAID_PLANS - List of plans that grant subscription-based entitlement
 */
const PAID_PLANS = ['diy', 'pro', 'enterprise', 'agency'];

/**
 * Plan aliases for normalization
 * Maps legacy/variant plan names to canonical names
 */
const PLAN_ALIASES = {
  'plan_diy': 'diy',
  'plan_pro': 'pro',
  'plan_enterprise': 'enterprise',
  'plan_agency': 'agency',
  'plan_free': 'free',
  'plan_freemium': 'freemium',
  'starter': 'diy',
  'basic': 'diy',
  'professional': 'pro',
  'business': 'enterprise',
  'team': 'agency',
  'teams': 'agency',
  '': 'free',
  'null': 'free',
  'undefined': 'free'
};

/**
 * Normalize a plan string to its canonical form
 * Handles: null, undefined, case variations, whitespace, plan_ prefix, aliases
 *
 * @param {string|null|undefined} plan - Raw plan value
 * @returns {string} Normalized plan name (lowercase, canonical)
 */
function normalizePlan(plan) {
  // Handle null/undefined
  if (plan === null || plan === undefined) {
    return 'free';
  }

  // Convert to string, lowercase, trim
  let normalized = String(plan).toLowerCase().trim();

  // Strip 'plan_' prefix if present
  if (normalized.startsWith('plan_')) {
    normalized = normalized.substring(5);
  }

  // Check aliases
  if (PLAN_ALIASES[normalized]) {
    return PLAN_ALIASES[normalized];
  }

  // Return as-is if it's a known plan, otherwise default to 'free'
  if (PLAN_ALLOCATIONS.hasOwnProperty(normalized)) {
    return normalized;
  }

  // Unknown plan - log warning and default to free
  if (process.env.CITATION_DEBUG === '1') {
    console.warn(`[planUtils] Unknown plan "${plan}" normalized to "free"`);
  }

  return 'free';
}

/**
 * Check if a normalized plan is a paid plan
 *
 * @param {string} normalizedPlan - Already normalized plan string
 * @returns {boolean} True if plan grants subscription entitlement
 */
function isPaidPlan(normalizedPlan) {
  return PAID_PLANS.includes(normalizedPlan);
}

/**
 * Get the monthly directory allocation for a plan
 *
 * @param {string} normalizedPlan - Already normalized plan string
 * @returns {number} Monthly allocation (0 if unknown)
 */
function getPlanAllocation(normalizedPlan) {
  return PLAN_ALLOCATIONS[normalizedPlan] || 0;
}

/**
 * Debug helper - get full plan info
 *
 * @param {string|null|undefined} rawPlan - Raw plan value
 * @returns {object} Full plan analysis
 */
function analyzePlan(rawPlan) {
  const normalized = normalizePlan(rawPlan);
  return {
    raw: rawPlan,
    normalized,
    isPaid: isPaidPlan(normalized),
    allocation: getPlanAllocation(normalized),
    isKnown: PLAN_ALLOCATIONS.hasOwnProperty(normalized)
  };
}

module.exports = {
  PLAN_ALLOCATIONS,
  PAID_PLANS,
  PLAN_ALIASES,
  normalizePlan,
  isPaidPlan,
  getPlanAllocation,
  analyzePlan
};
