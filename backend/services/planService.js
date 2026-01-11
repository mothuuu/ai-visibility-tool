/**
 * Plan Service
 *
 * SINGLE SOURCE OF TRUTH for plan resolution.
 * Resolves user's effective plan from Stripe subscription state.
 *
 * Phase 2: Ensures plan resolution is consistent across all endpoints.
 *
 * Rules:
 * 1. Webhooks update Stripe fields on the user (stripe_customer_id, stripe_subscription_id, etc.)
 * 2. Runtime plan is resolved from webhook-persisted state via resolvePlanFromStripe()
 * 3. Active statuses: 'active', 'trialing'
 * 4. No active sub → 'freemium'
 * 5. Active sub → map stripe_price_id → plan
 */

const db = require('../db/database');
const { normalizePlan } = require('./scanEntitlementService');

// =============================================================================
// STRIPE CONFIGURATION
// =============================================================================

/**
 * Map Stripe price IDs to plan names
 * Supports both test and production price IDs via environment variables
 */
const PRICE_TO_PLAN = {
  // DIY/Starter plan
  [process.env.STRIPE_PRICE_DIY]: 'diy',
  [process.env.STRIPE_PRICE_DIY_MONTHLY]: 'diy',
  [process.env.STRIPE_PRICE_DIY_ANNUAL]: 'diy',

  // Pro plan
  [process.env.STRIPE_PRICE_PRO]: 'pro',
  [process.env.STRIPE_PRICE_PRO_MONTHLY]: 'pro',
  [process.env.STRIPE_PRICE_PRO_ANNUAL]: 'pro',

  // Enterprise plan
  [process.env.STRIPE_PRICE_ENTERPRISE]: 'enterprise',
  [process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY]: 'enterprise',
  [process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL]: 'enterprise',

  // Agency plan
  [process.env.STRIPE_PRICE_AGENCY]: 'agency',
  [process.env.STRIPE_PRICE_AGENCY_MONTHLY]: 'agency',
  [process.env.STRIPE_PRICE_AGENCY_ANNUAL]: 'agency'
};

// Filter out undefined keys from env vars that aren't set
const VALID_PRICE_TO_PLAN = Object.fromEntries(
  Object.entries(PRICE_TO_PLAN).filter(([key]) => key && key !== 'undefined')
);

/**
 * Subscription statuses that grant paid plan access
 */
const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];

/**
 * Subscription statuses that indicate plan should be free
 */
const INACTIVE_SUBSCRIPTION_STATUSES = ['canceled', 'cancelled', 'unpaid', 'past_due', 'incomplete', 'incomplete_expired'];

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Resolve the effective plan from Stripe subscription state
 * This is the runtime determination of what plan the user should have.
 *
 * @param {object} userRow - User row from database
 * @returns {{ plan: string, corrected: boolean, storedPlan: string, subscriptionStatus: string|null, source: string }}
 */
function resolvePlanFromStripe(userRow) {
  const storedPlan = userRow.plan || 'freemium';
  const subStatus = userRow.stripe_subscription_status;
  const subId = userRow.stripe_subscription_id;
  const priceId = userRow.stripe_price_id;

  // No subscription at all → use stored plan (which should be freemium)
  if (!subId) {
    return {
      plan: normalizePlan(storedPlan),
      corrected: false,
      storedPlan,
      subscriptionStatus: null,
      source: 'no_subscription'
    };
  }

  // Has subscription but status is inactive → freemium
  if (subStatus && INACTIVE_SUBSCRIPTION_STATUSES.includes(subStatus)) {
    const resolvedPlan = 'freemium';
    return {
      plan: resolvedPlan,
      corrected: storedPlan !== resolvedPlan,
      storedPlan,
      subscriptionStatus: subStatus,
      source: 'subscription_inactive'
    };
  }

  // Has subscription with active status
  if (subStatus && ACTIVE_SUBSCRIPTION_STATUSES.includes(subStatus)) {
    // Try to map price ID to plan
    if (priceId && VALID_PRICE_TO_PLAN[priceId]) {
      const resolvedPlan = VALID_PRICE_TO_PLAN[priceId];
      return {
        plan: resolvedPlan,
        corrected: storedPlan !== resolvedPlan,
        storedPlan,
        subscriptionStatus: subStatus,
        source: 'stripe_price_id'
      };
    }

    // Price ID not mapped - use stored plan if it's a paid plan
    const normalizedStored = normalizePlan(storedPlan);
    const isPaidPlan = ['diy', 'pro', 'agency', 'enterprise'].includes(normalizedStored);

    if (isPaidPlan) {
      console.warn(`[PlanService] Price ID ${priceId} not mapped, using stored plan: ${normalizedStored}`);
      return {
        plan: normalizedStored,
        corrected: false,
        storedPlan,
        subscriptionStatus: subStatus,
        source: 'stored_plan_fallback'
      };
    }

    // Active sub but no valid price mapping and stored plan is free → warning + freemium
    console.error(`[PlanService] WARN: Active subscription but no valid plan mapping. User: ${userRow.id}, priceId: ${priceId}`);
    return {
      plan: 'freemium',
      corrected: true,
      storedPlan,
      subscriptionStatus: subStatus,
      source: 'unmapped_price_fallback'
    };
  }

  // Has subscription ID but no status (shouldn't happen, but handle gracefully)
  // Treat as no active subscription
  console.warn(`[PlanService] Subscription ${subId} has no status for user ${userRow.id}`);
  return {
    plan: normalizePlan(storedPlan),
    corrected: false,
    storedPlan,
    subscriptionStatus: null,
    source: 'no_status'
  };
}

/**
 * Get user's resolved plan from database
 *
 * @param {number} userId - User ID
 * @returns {Promise<{ plan: string, corrected: boolean, storedPlan: string, subscriptionStatus: string|null, source: string, user: object }>}
 */
async function getUserPlan(userId) {
  const result = await db.query(`
    SELECT id, email, plan, stripe_customer_id, stripe_subscription_id,
           stripe_subscription_status, stripe_price_id,
           stripe_current_period_start, stripe_current_period_end
    FROM users
    WHERE id = $1
  `, [userId]);

  if (result.rows.length === 0) {
    throw new Error(`User ${userId} not found`);
  }

  const user = result.rows[0];
  const resolved = resolvePlanFromStripe(user);

  return {
    ...resolved,
    user: {
      id: user.id,
      email: user.email,
      stripeCustomerId: user.stripe_customer_id,
      stripePeriodStart: user.stripe_current_period_start,
      stripePeriodEnd: user.stripe_current_period_end
    }
  };
}

/**
 * Sync plan from Stripe webhook subscription event
 * Updates user's Stripe fields and plan based on subscription state
 *
 * @param {string} stripeCustomerId - Stripe customer ID
 * @param {object} subscription - Stripe subscription object
 * @returns {Promise<{ success: boolean, userId: number|null, oldPlan: string|null, newPlan: string|null }>}
 */
async function syncPlanFromWebhook(stripeCustomerId, subscription) {
  // Find user by Stripe customer ID
  const userResult = await db.query(
    'SELECT id, email, plan FROM users WHERE stripe_customer_id = $1',
    [stripeCustomerId]
  );

  if (userResult.rows.length === 0) {
    console.log(`[PlanService] No user found for Stripe customer ${stripeCustomerId}`);
    return { success: false, userId: null, oldPlan: null, newPlan: null };
  }

  const user = userResult.rows[0];
  const oldPlan = user.plan;

  // Extract subscription details
  const status = subscription.status;
  const priceId = subscription.items?.data?.[0]?.price?.id || null;
  const periodStart = subscription.current_period_start
    ? new Date(subscription.current_period_start * 1000)
    : null;
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  // Determine new plan based on status and price
  let newPlan = oldPlan;

  if (ACTIVE_SUBSCRIPTION_STATUSES.includes(status)) {
    // Active subscription - resolve plan from price ID
    if (priceId && VALID_PRICE_TO_PLAN[priceId]) {
      newPlan = VALID_PRICE_TO_PLAN[priceId];
    } else if (priceId) {
      // Unknown price ID - keep current plan if it's paid, else warn
      const normalizedOld = normalizePlan(oldPlan);
      const isPaid = ['diy', 'pro', 'agency', 'enterprise'].includes(normalizedOld);
      if (!isPaid) {
        console.warn(`[PlanService] Unknown price ${priceId} and current plan is ${oldPlan}`);
        newPlan = 'diy'; // Default to DIY for unknown paid subscriptions
      }
    }
  } else if (INACTIVE_SUBSCRIPTION_STATUSES.includes(status)) {
    // Inactive subscription - downgrade to free
    newPlan = 'free';
  }

  // Update user record
  await db.query(`
    UPDATE users
    SET stripe_subscription_id = $1,
        stripe_subscription_status = $2,
        stripe_price_id = $3,
        stripe_current_period_start = $4,
        stripe_current_period_end = $5,
        plan = $6,
        updated_at = NOW()
    WHERE id = $7
  `, [
    subscription.id,
    status,
    priceId,
    periodStart,
    periodEnd,
    newPlan,
    user.id
  ]);

  console.log(`[PlanService] Synced plan for user ${user.email}: ${oldPlan} → ${newPlan} (status: ${status})`);

  return {
    success: true,
    userId: user.id,
    oldPlan,
    newPlan
  };
}

/**
 * Handle subscription deleted event
 * Downgrades user to free plan
 *
 * @param {string} subscriptionId - Stripe subscription ID
 * @returns {Promise<{ success: boolean, userId: number|null }>}
 */
async function handleSubscriptionDeleted(subscriptionId) {
  const userResult = await db.query(
    'SELECT id, email, plan FROM users WHERE stripe_subscription_id = $1',
    [subscriptionId]
  );

  if (userResult.rows.length === 0) {
    console.log(`[PlanService] No user found for subscription ${subscriptionId}`);
    return { success: false, userId: null };
  }

  const user = userResult.rows[0];

  await db.query(`
    UPDATE users
    SET plan = 'free',
        stripe_subscription_status = 'canceled',
        updated_at = NOW()
    WHERE id = $1
  `, [user.id]);

  console.log(`[PlanService] Subscription deleted for user ${user.email}, downgraded to free`);

  return {
    success: true,
    userId: user.id
  };
}

/**
 * Check if a user has an active paid subscription
 *
 * @param {object} userRow - User row from database
 * @returns {boolean}
 */
function hasActiveSubscription(userRow) {
  const status = userRow.stripe_subscription_status;
  return status && ACTIVE_SUBSCRIPTION_STATUSES.includes(status);
}

/**
 * Get price ID to plan mapping (for debugging/admin)
 *
 * @returns {object}
 */
function getPriceToPlanMapping() {
  return { ...VALID_PRICE_TO_PLAN };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Core functions
  resolvePlanFromStripe,
  getUserPlan,
  syncPlanFromWebhook,
  handleSubscriptionDeleted,
  hasActiveSubscription,

  // Utilities
  getPriceToPlanMapping,
  normalizePlan,

  // Constants
  ACTIVE_SUBSCRIPTION_STATUSES,
  INACTIVE_SUBSCRIPTION_STATUSES
};
