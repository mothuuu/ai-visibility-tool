/**
 * AI Citation Network Configuration
 *
 * SINGLE SOURCE OF TRUTH for:
 * - Plan definitions and normalization
 * - Directory allocations
 * - Pack configurations
 * - Status values
 * - Error codes
 *
 * Two products:
 * - Starter ($249): Non-subscribers, first purchase - 100 directories
 * - Boost ($99): Subscribers OR anyone who already bought starter - 25 additional directories
 */

// =============================================================================
// PLAN DEFINITIONS
// =============================================================================

/**
 * Canonical plan names - only these are valid after normalization
 */
const CANONICAL_PLANS = ['free', 'freemium', 'diy', 'pro', 'agency', 'enterprise'];

/**
 * Plans that grant subscription-based monthly entitlement
 */
const SUBSCRIBER_PLANS = ['diy', 'pro', 'agency', 'enterprise'];

/**
 * Monthly directory allocations per plan
 * IMPORTANT: This is the source of truth - use getPlanAllocation() to access
 */
const PLAN_ALLOCATIONS = {
  free: 0,
  freemium: 0,
  diy: 10,
  pro: 25,
  agency: 25,
  enterprise: 100
};

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
  'teams': 'agency'
};

// =============================================================================
// PACK CONFIGURATION
// =============================================================================

const PACK_CONFIG = {
  starter: {
    price: 24900,           // $249 in cents
    directories: 100,
    name: 'Starter Pack',
    subscriberOnly: false   // Non-subscribers only (first purchase)
  },
  boost: {
    price: 9900,            // $99 in cents
    directories: 100,       // Same as starter - 100 directories
    name: 'Boost Pack',
    subscriberOnly: true    // Subscribers OR returning buyers
  }
};

// =============================================================================
// STRIPE CONFIGURATION
// =============================================================================

/**
 * Stripe Price IDs (from environment)
 */
const prices = {
  STARTER_249: process.env.STRIPE_PRICE_SPRINT_249,
  PACK_99: process.env.STRIPE_PRICE_PACK_99
};

/**
 * Valid Stripe subscription statuses that grant subscriber benefits
 * CRITICAL: null/undefined are NOT valid - must have explicit active status
 */
const ALLOWED_STRIPE_STATUSES = ['active', 'trialing'];

/**
 * Stripe statuses that indicate subscription is ending/ended
 */
const CANCELED_STRIPE_STATUSES = ['canceled', 'cancelled', 'unpaid', 'incomplete_expired'];

// =============================================================================
// LIMITS
// =============================================================================

const LIMITS = {
  maxPacksPerYear: 2,       // Max $99 packs per year (for subscribers)
  maxPacksPerStarter: 2,    // Max $99 add-ons per $249 starter
  directoriesPerPurchase: 100
};

// =============================================================================
// STATUS DEFINITIONS
// =============================================================================

/**
 * Directory submission statuses
 * IMPORTANT: Use normalizeStatus() to handle legacy values
 */
const SUBMISSION_STATUSES = {
  QUEUED: 'queued',
  IN_PROGRESS: 'in_progress',
  ACTION_NEEDED: 'action_needed',
  SUBMITTED: 'submitted',
  PENDING_APPROVAL: 'pending_approval',
  LIVE: 'live',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  ALREADY_LISTED: 'already_listed'
};

/**
 * Directory order statuses
 */
const ORDER_STATUSES = {
  PENDING: 'pending',
  PAID: 'paid',
  PROCESSING: 'processing',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled'
};

/**
 * Order statuses that count toward entitlement
 *
 * TIER-0 RULE 4: NEW orders remain status='paid' forever.
 * Usage tracked via directories_submitted < directories_allocated.
 *
 * Legacy statuses ('processing', 'in_progress', 'completed') included for
 * backward compatibility with existing data. New code should only set 'paid'.
 */
const USABLE_ORDER_STATUSES = ['paid', 'processing', 'in_progress', 'completed'];

/**
 * Billable submission statuses - statuses that consume entitlement
 *
 * PHASE 4 RULE: Entitlement is ONLY consumed for statuses that represent
 * actual submission work. already_listed and blocked do NOT consume.
 *
 * - queued: In queue, work will be done
 * - in_progress: Worker is processing
 * - submitted: Successfully submitted to directory
 * - pending_approval: Awaiting directory approval
 * - action_needed: User action required (work was done)
 * - live: Listing is live
 * - verified: Verification complete
 * - rejected: Directory rejected (work was done, counts as attempt)
 * - failed: Submission failed (work was attempted)
 *
 * NOT BILLABLE:
 * - already_listed: No submission needed, business already exists
 * - blocked: Blocked before any work was done (e.g., ambiguous duplicate check)
 * - cancelled: Cancelled by user before processing
 * - skipped: User skipped this directory
 */
const BILLABLE_STATUSES = [
  'queued',
  'in_progress',
  'submitted',
  'pending_approval',
  'action_needed',
  'live',
  'verified',
  'rejected',
  'failed'
];

// =============================================================================
// ERROR CODES
// =============================================================================

const ERROR_CODES = {
  NO_ENTITLEMENT: 'NO_ENTITLEMENT',
  NO_ELIGIBLE_DIRECTORIES: 'NO_ELIGIBLE_DIRECTORIES',
  PROFILE_REQUIRED: 'PROFILE_REQUIRED',
  PROFILE_INCOMPLETE: 'PROFILE_INCOMPLETE',
  ACTIVE_CAMPAIGN_EXISTS: 'ACTIVE_CAMPAIGN_EXISTS',
  DIRECTORIES_NOT_SEEDED: 'DIRECTORIES_NOT_SEEDED',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  PACK_NOT_AVAILABLE: 'PACK_NOT_AVAILABLE',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_PACK_TYPE: 'INVALID_PACK_TYPE',
  CONFIG_ERROR: 'CONFIG_ERROR',
  STRIPE_ERROR: 'STRIPE_ERROR'
};

// =============================================================================
// NORMALIZATION FUNCTIONS
// =============================================================================

/**
 * Normalize a plan string to its canonical form
 * Handles: null, undefined, case variations, whitespace, plan_ prefix, aliases
 *
 * @param {string|null|undefined} plan - Raw plan value
 * @returns {string} Normalized plan name (lowercase, canonical)
 */
function normalizePlan(plan) {
  // Handle null/undefined/empty
  if (plan === null || plan === undefined || plan === '') {
    return 'free';
  }

  // Convert to string, lowercase, trim
  let normalized = String(plan).toLowerCase().trim();

  // Handle empty after trim
  if (!normalized) {
    return 'free';
  }

  // Strip 'plan_' prefix if present
  if (normalized.startsWith('plan_')) {
    normalized = normalized.substring(5);
  }

  // Check aliases first
  if (PLAN_ALIASES[normalized]) {
    return PLAN_ALIASES[normalized];
  }

  // Return if it's a canonical plan
  if (CANONICAL_PLANS.includes(normalized)) {
    return normalized;
  }

  // Unknown plan - default to 'free'
  if (process.env.CITATION_DEBUG === '1') {
    console.warn(`[citationNetwork] Unknown plan "${plan}" normalized to "free"`);
  }
  return 'free';
}

/**
 * Normalize a submission status to its canonical form
 * Handles legacy values like 'needs_action' → 'action_needed'
 *
 * @param {string|null|undefined} status - Raw status value
 * @returns {string} Normalized status
 */
function normalizeStatus(status) {
  const mapping = {
    'needs_action': 'action_needed',
    'pending': 'queued',
    'processing': 'in_progress'
  };

  const s = (status || 'queued').toLowerCase().trim();
  return mapping[s] || s;
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
 * Check if a normalized plan is a subscriber plan (grants monthly entitlement)
 *
 * @param {string} normalizedPlan - Already normalized plan string
 * @returns {boolean} True if plan is a subscriber plan
 */
function isSubscriberPlan(normalizedPlan) {
  return SUBSCRIBER_PLANS.includes(normalizedPlan);
}

// =============================================================================
// SUBSCRIBER ELIGIBILITY
// =============================================================================

/**
 * Check if a user is an active subscriber
 *
 * CRITICAL: This function fixes the "null treated as subscriber" bug.
 * A user is ONLY a subscriber if:
 * 1. They have a paid plan (diy, pro, agency, enterprise)
 * 2. AND their stripe_subscription_status is explicitly 'active' or 'trialing'
 * 3. OR they have a manual override (for enterprise deals)
 *
 * @param {object} user - User object with plan and stripe fields
 * @returns {boolean} True if user is an active subscriber
 */
function isActiveSubscriber(user) {
  if (!user) return false;

  const planNormalized = normalizePlan(user.plan);

  // Manual override takes precedence (for enterprise deals, admin grants)
  if (user.subscription_manual_override === true) {
    return SUBSCRIBER_PLANS.includes(planNormalized);
  }

  // Must have a subscriber plan
  if (!SUBSCRIBER_PLANS.includes(planNormalized)) {
    return false;
  }

  // Must have an explicitly active Stripe status
  // CRITICAL: null/undefined is NOT valid - user must have verified active subscription
  const stripeStatus = (user.stripe_subscription_status || '').toLowerCase().trim();

  return ALLOWED_STRIPE_STATUSES.includes(stripeStatus);
}

// =============================================================================
// LEGACY COMPATIBILITY
// =============================================================================

// Keep old structure for backward compatibility during transition
const CITATION_NETWORK_CONFIG = {
  prices,
  directoriesPerPurchase: LIMITS.directoriesPerPurchase,
  maxPacksPerYear: LIMITS.maxPacksPerYear,
  maxPacksPerStarter: LIMITS.maxPacksPerStarter,
  planAllocations: PLAN_ALLOCATIONS,
  orderStatuses: ORDER_STATUSES,
  submissionStatuses: SUBMISSION_STATUSES
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Legacy default export for backward compatibility
  ...CITATION_NETWORK_CONFIG,

  // Plan definitions
  CANONICAL_PLANS,
  SUBSCRIBER_PLANS,
  PLAN_ALLOCATIONS,
  PLAN_ALIASES,

  // Pack configuration
  PACK_CONFIG,

  // Stripe configuration
  prices,
  ALLOWED_STRIPE_STATUSES,
  CANCELED_STRIPE_STATUSES,

  // Limits
  LIMITS,

  // Status definitions
  SUBMISSION_STATUSES,
  ORDER_STATUSES,
  USABLE_ORDER_STATUSES,
  BILLABLE_STATUSES,

  // Error codes
  ERROR_CODES,

  // Functions
  normalizePlan,
  normalizeStatus,
  getPlanAllocation,
  isSubscriberPlan,
  isActiveSubscriber
};
