/**
 * Plan Service
 *
 * SINGLE SOURCE OF TRUTH for plan resolution.
 * Phase 2.1: Org-first plan resolution with manual override support.
 *
 * Precedence (Option A):
 * 1. Manual override: org.plan_source='manual' AND org.plan_override set
 * 2. Stripe: org stripe_subscription_status active/trialing AND stripe_price_id maps
 * 3. Fallback: org.plan (DB default is 'free')
 * 4. Last resort: user.plan if org missing
 *
 * IMPORTANT:
 * - 'freemium' is normalized to 'free' everywhere
 * - Do NOT require subscription_id (some legacy records missing it)
 * - DO require price_id for Stripe mapping (otherwise impossible)
 */

const db = require('../db/database');

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

/**
 * Valid canonical plan names
 */
const VALID_PLANS = ['free', 'diy', 'pro', 'agency', 'enterprise'];

// =============================================================================
// PLAN NORMALIZATION
// =============================================================================

/**
 * Normalize plan to canonical form
 * IMPORTANT: 'freemium' -> 'free', unknown -> 'free'
 *
 * @param {string} plan - Raw plan string
 * @returns {'free' | 'diy' | 'pro' | 'agency' | 'enterprise'}
 */
function normalizePlan(plan) {
  if (!plan) return 'free';

  const lowered = String(plan).toLowerCase().trim();

  // Explicit freemium -> free conversion
  if (lowered === 'freemium') return 'free';

  // Check if valid
  if (VALID_PLANS.includes(lowered)) {
    return lowered;
  }

  // Handle aliases (keep in sync with scanEntitlementService.js PLAN_ALIASES)
  const aliases = {
    // Prefixed variants
    'plan_diy': 'diy',
    'plan_pro': 'pro',
    'plan_enterprise': 'enterprise',
    'plan_agency': 'agency',
    'plan_free': 'free',
    'plan_starter': 'diy',
    'plan_gold': 'pro',
    'plan_platinum': 'enterprise',
    'plan_silver': 'diy',
    'plan_bronze': 'free',
    // Tier-prefixed variants
    'tier_gold': 'pro',
    'tier_platinum': 'enterprise',
    'tier_silver': 'diy',
    'tier_bronze': 'free',
    // Legacy/alternative names
    'starter': 'diy',
    'basic': 'diy',
    'professional': 'pro',
    'business': 'enterprise',
    'team': 'agency',
    'teams': 'agency',
    // Metal-tier naming
    'gold': 'pro',
    'platinum': 'enterprise',
    'silver': 'diy',
    'bronze': 'free'
  };

  if (aliases[lowered]) {
    return aliases[lowered];
  }

  // Unknown -> free
  console.warn(`[PlanService] Unknown plan '${plan}' normalized to 'free'`);
  return 'free';
}

// =============================================================================
// STRIPE FIELD RESOLUTION (low-level)
// =============================================================================

/**
 * Resolve plan from Stripe fields ONLY
 * Returns null if Stripe cannot determine plan (missing price_id or inactive status)
 *
 * IMPORTANT: Does NOT require subscription_id (legacy records may be missing it)
 * DOES require price_id for mapping
 *
 * @param {{ stripe_subscription_status?: string, stripe_price_id?: string }} row
 * @returns {string | null} - Plan name or null if cannot resolve via Stripe
 */
function resolvePlanFromStripeFields(row) {
  const status = row.stripe_subscription_status;
  const priceId = row.stripe_price_id;

  // Must have active status AND price_id for Stripe resolution
  if (!status || !ACTIVE_SUBSCRIPTION_STATUSES.includes(status)) {
    return null;
  }

  if (!priceId) {
    return null;
  }

  // Map price ID to plan
  const plan = VALID_PRICE_TO_PLAN[priceId];
  if (!plan) {
    console.warn(`[PlanService] Unknown price_id '${priceId}' - cannot map to plan`);
    return null;
  }

  return plan;
}

// =============================================================================
// ORGANIZATION ROW FETCHING
// =============================================================================

/**
 * Get organization row with all plan-relevant fields
 *
 * @param {number} orgId - Organization ID
 * @returns {Promise<object | null>} - Org row or null if not found
 */
async function getOrgRow(orgId) {
  if (!orgId) return null;

  try {
    const result = await db.query(`
      SELECT
        id,
        plan,
        plan_source,
        plan_override,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_subscription_status,
        stripe_price_id,
        stripe_current_period_start,
        stripe_current_period_end
      FROM organizations
      WHERE id = $1
    `, [orgId]);

    return result.rows[0] || null;
  } catch (error) {
    // Handle case where new columns don't exist yet
    if (error.code === '42703') { // undefined_column
      console.warn(`[PlanService] Missing org columns, using fallback query: ${error.message}`);
      try {
        const fallbackResult = await db.query(`
          SELECT
            id,
            plan,
            stripe_customer_id,
            stripe_subscription_id,
            stripe_subscription_status
          FROM organizations
          WHERE id = $1
        `, [orgId]);

        const row = fallbackResult.rows[0];
        if (row) {
          // Add defaults for missing columns
          row.plan_source = 'stripe';
          row.plan_override = null;
          row.stripe_price_id = null;
          row.stripe_current_period_start = null;
          row.stripe_current_period_end = null;
        }
        return row || null;
      } catch (fallbackError) {
        console.error(`[PlanService] Fallback query failed: ${fallbackError.message}`);
        return null;
      }
    }
    console.error(`[PlanService] getOrgRow error: ${error.message}`);
    return null;
  }
}

// =============================================================================
// ORG PLAN RESOLUTION (Option A precedence)
// =============================================================================

/**
 * Resolve plan for an organization row
 *
 * Precedence:
 * A) Manual override: plan_source='manual' AND plan_override set
 * B) Stripe: active/trialing status AND price_id maps
 * C) Fallback: org.plan column
 *
 * @param {object} orgRow - Organization row from getOrgRow()
 * @returns {{ plan: string, source: string, details?: object }}
 */
function resolveOrgPlan(orgRow) {
  if (!orgRow) {
    return { plan: 'free', source: 'no_org_row' };
  }

  // A) Manual override takes highest precedence
  if (orgRow.plan_source === 'manual' && orgRow.plan_override) {
    const plan = normalizePlan(orgRow.plan_override);
    console.log(`[PlanService] Org ${orgRow.id}: manual override -> ${plan}`);
    return {
      plan,
      source: 'manual_override',
      details: {
        plan_override: orgRow.plan_override,
        plan_source: orgRow.plan_source
      }
    };
  }

  // B) Stripe resolution
  const stripePlan = resolvePlanFromStripeFields(orgRow);
  if (stripePlan) {
    const plan = normalizePlan(stripePlan);
    console.log(`[PlanService] Org ${orgRow.id}: stripe -> ${plan} (price: ${orgRow.stripe_price_id})`);
    return {
      plan,
      source: 'stripe',
      details: {
        stripe_price_id: orgRow.stripe_price_id,
        stripe_subscription_status: orgRow.stripe_subscription_status
      }
    };
  }

  // C) Fallback to org.plan column
  const plan = normalizePlan(orgRow.plan);
  console.log(`[PlanService] Org ${orgRow.id}: fallback -> ${plan} (stored: ${orgRow.plan})`);
  return {
    plan,
    source: 'org_plan_fallback',
    details: {
      stored_plan: orgRow.plan,
      stripe_status: orgRow.stripe_subscription_status || 'none'
    }
  };
}

// =============================================================================
// REQUEST-LEVEL PLAN RESOLUTION (main entry point)
// =============================================================================

/**
 * Resolve plan for a request context
 * This is the MAIN entry point for plan resolution.
 *
 * @param {{ userId?: number, orgId?: number }} context
 * @returns {Promise<{ plan: string, source: string, orgId?: number, userId?: number, details?: object }>}
 */
async function resolvePlanForRequest({ userId, orgId }) {
  // Try org-first resolution
  if (orgId) {
    const orgRow = await getOrgRow(orgId);
    if (orgRow) {
      const result = resolveOrgPlan(orgRow);
      return {
        ...result,
        orgId,
        userId,
        orgRow: {
          stripePeriodStart: orgRow.stripe_current_period_start,
          stripePeriodEnd: orgRow.stripe_current_period_end,
          stripeSubscriptionStatus: orgRow.stripe_subscription_status
        }
      };
    }
  }

  // Fallback: try to get orgId from user
  if (userId && !orgId) {
    try {
      const userResult = await db.query(
        'SELECT organization_id FROM users WHERE id = $1',
        [userId]
      );
      const userOrgId = userResult.rows[0]?.organization_id;

      if (userOrgId) {
        const orgRow = await getOrgRow(userOrgId);
        if (orgRow) {
          const result = resolveOrgPlan(orgRow);
          return {
            ...result,
            orgId: userOrgId,
            userId,
            orgRow: {
              stripePeriodStart: orgRow.stripe_current_period_start,
              stripePeriodEnd: orgRow.stripe_current_period_end,
              stripeSubscriptionStatus: orgRow.stripe_subscription_status
            }
          };
        }
      }
    } catch (error) {
      console.warn(`[PlanService] Could not get user org: ${error.message}`);
    }
  }

  // Last resort: user-level plan resolution (legacy path)
  if (userId) {
    try {
      const userPlan = await getUserPlan(userId);
      return {
        plan: userPlan.plan,
        source: `user_fallback_${userPlan.source}`,
        userId,
        details: userPlan
      };
    } catch (error) {
      console.warn(`[PlanService] getUserPlan failed: ${error.message}`);
    }
  }

  // Absolute fallback
  return {
    plan: 'free',
    source: 'no_context',
    userId,
    orgId
  };
}

// =============================================================================
// LEGACY USER-LEVEL PLAN RESOLUTION
// =============================================================================

/**
 * Resolve the effective plan from Stripe subscription state (USER level)
 * This is the LEGACY path - prefer resolvePlanForRequest() for new code.
 *
 * @param {object} userRow - User row from database
 * @returns {{ plan: string, corrected: boolean, storedPlan: string, subscriptionStatus: string|null, source: string }}
 */
function resolvePlanFromStripe(userRow) {
  const storedPlan = userRow.plan || 'free';
  const subStatus = userRow.stripe_subscription_status;
  const subId = userRow.stripe_subscription_id;
  const priceId = userRow.stripe_price_id;

  // No subscription at all → use stored plan
  if (!subId && !priceId) {
    return {
      plan: normalizePlan(storedPlan),
      corrected: false,
      storedPlan,
      subscriptionStatus: null,
      source: 'no_subscription'
    };
  }

  // Has subscription but status is inactive → free
  if (subStatus && INACTIVE_SUBSCRIPTION_STATUSES.includes(subStatus)) {
    const resolvedPlan = 'free';
    return {
      plan: resolvedPlan,
      corrected: normalizePlan(storedPlan) !== resolvedPlan,
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
        corrected: normalizePlan(storedPlan) !== resolvedPlan,
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

    // Active sub but no valid price mapping and stored plan is free → warning + free
    console.error(`[PlanService] WARN: Active subscription but no valid plan mapping. User: ${userRow.id}, priceId: ${priceId}`);
    return {
      plan: 'free',
      corrected: true,
      storedPlan,
      subscriptionStatus: subStatus,
      source: 'unmapped_price_fallback'
    };
  }

  // Has subscription ID but no status (shouldn't happen, but handle gracefully)
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
 * Get user's resolved plan from database (LEGACY - prefer resolvePlanForRequest)
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

// =============================================================================
// STRIPE WEBHOOK HELPERS
// =============================================================================

/**
 * Upsert org Stripe fields from webhook
 * Does NOT touch plan_override if plan_source='manual'
 *
 * @param {string} stripeCustomerId - Stripe customer ID
 * @param {object} subscription - Stripe subscription object
 * @param {object} [client] - Optional DB client for transactions
 * @returns {Promise<{ success: boolean, orgId?: number }>}
 */
async function upsertOrgStripeFields(stripeCustomerId, subscription, client = null) {
  if (!stripeCustomerId) {
    return { success: false, reason: 'no_customer_id' };
  }

  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  // Extract subscription details
  const status = subscription.status || null;
  const priceId = subscription.items?.data?.[0]?.price?.id || null;
  const periodStart = subscription.current_period_start
    ? new Date(subscription.current_period_start * 1000)
    : null;
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  try {
    const result = await queryFn(`
      UPDATE organizations
      SET
        stripe_subscription_id = $1,
        stripe_subscription_status = $2,
        stripe_price_id = $3,
        stripe_current_period_start = $4,
        stripe_current_period_end = $5,
        updated_at = NOW()
      WHERE stripe_customer_id = $6
      RETURNING id, plan_source, plan_override
    `, [
      subscription.id,
      status,
      priceId,
      periodStart,
      periodEnd,
      stripeCustomerId
    ]);

    if (result.rows.length === 0) {
      console.log(`[PlanService] No org found for Stripe customer ${stripeCustomerId}`);
      return { success: false, reason: 'org_not_found' };
    }

    const org = result.rows[0];
    console.log(`[PlanService] Org ${org.id} Stripe fields updated (status: ${status}, price: ${priceId})`);

    // Log if manual override is active (Stripe fields still updated, but override preserved)
    if (org.plan_source === 'manual' && org.plan_override) {
      console.log(`[PlanService] Org ${org.id} has manual override (${org.plan_override}) - Stripe fields updated but override preserved`);
    }

    return { success: true, orgId: org.id };
  } catch (error) {
    // Handle missing columns gracefully
    if (error.code === '42703') { // undefined_column
      console.warn(`[PlanService] upsertOrgStripeFields: missing columns, trying fallback`);
      try {
        const fallbackResult = await queryFn(`
          UPDATE organizations
          SET
            stripe_subscription_id = $1,
            stripe_subscription_status = $2,
            updated_at = NOW()
          WHERE stripe_customer_id = $3
          RETURNING id
        `, [subscription.id, status, stripeCustomerId]);

        if (fallbackResult.rows.length > 0) {
          console.log(`[PlanService] Org ${fallbackResult.rows[0].id} basic Stripe fields updated (fallback)`);
          return { success: true, orgId: fallbackResult.rows[0].id };
        }
        return { success: false, reason: 'org_not_found_fallback' };
      } catch (fallbackError) {
        console.error(`[PlanService] Fallback upsert failed: ${fallbackError.message}`);
        return { success: false, reason: 'fallback_error' };
      }
    }
    console.error(`[PlanService] upsertOrgStripeFields error: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

/**
 * Clear org Stripe fields on subscription deletion
 *
 * @param {string} stripeCustomerId - Stripe customer ID
 * @param {object} [client] - Optional DB client for transactions
 * @returns {Promise<{ success: boolean, orgId?: number }>}
 */
async function clearOrgStripeFields(stripeCustomerId, client = null) {
  if (!stripeCustomerId) {
    return { success: false, reason: 'no_customer_id' };
  }

  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  try {
    const result = await queryFn(`
      UPDATE organizations
      SET
        stripe_subscription_status = 'canceled',
        stripe_price_id = NULL,
        stripe_current_period_start = NULL,
        stripe_current_period_end = NULL,
        updated_at = NOW()
      WHERE stripe_customer_id = $1
      RETURNING id, plan_source, plan_override
    `, [stripeCustomerId]);

    if (result.rows.length === 0) {
      return { success: false, reason: 'org_not_found' };
    }

    const org = result.rows[0];
    console.log(`[PlanService] Org ${org.id} Stripe fields cleared (subscription deleted)`);

    // Note: manual override preserved
    if (org.plan_source === 'manual' && org.plan_override) {
      console.log(`[PlanService] Org ${org.id} manual override (${org.plan_override}) preserved after cancellation`);
    }

    return { success: true, orgId: org.id };
  } catch (error) {
    if (error.code === '42703') { // undefined_column
      try {
        const fallbackResult = await queryFn(`
          UPDATE organizations
          SET stripe_subscription_status = 'canceled', updated_at = NOW()
          WHERE stripe_customer_id = $1
          RETURNING id
        `, [stripeCustomerId]);

        if (fallbackResult.rows.length > 0) {
          return { success: true, orgId: fallbackResult.rows[0].id };
        }
        return { success: false, reason: 'org_not_found_fallback' };
      } catch (fallbackError) {
        return { success: false, reason: 'fallback_error' };
      }
    }
    return { success: false, reason: error.message };
  }
}

// =============================================================================
// LEGACY WEBHOOK SYNC (preserved for backwards compatibility)
// =============================================================================

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
// ADMIN HELPERS
// =============================================================================

/**
 * Set manual plan override for an organization
 *
 * @param {number} orgId - Organization ID
 * @param {string|null} planOverride - Plan to set (null to clear)
 * @param {number} setByUserId - Admin user ID setting the override
 * @param {string} reason - Reason for override
 * @returns {Promise<{ success: boolean, org?: object, error?: string }>}
 */
async function setOrgPlanOverride(orgId, planOverride, setByUserId, reason) {
  if (!orgId) {
    return { success: false, error: 'orgId required' };
  }

  // Validate plan if provided
  if (planOverride !== null) {
    const normalized = normalizePlan(planOverride);
    if (!['free', 'diy', 'pro', 'agency', 'enterprise'].includes(normalized)) {
      return { success: false, error: `Invalid plan: ${planOverride}` };
    }
    planOverride = normalized;
  }

  try {
    let result;

    if (planOverride) {
      // Setting override
      result = await db.query(`
        UPDATE organizations
        SET
          plan_source = 'manual',
          plan_override = $1,
          plan_override_set_at = NOW(),
          plan_override_set_by = $2,
          plan_override_reason = $3,
          updated_at = NOW()
        WHERE id = $4
        RETURNING id, plan, plan_source, plan_override, plan_override_set_at
      `, [planOverride, setByUserId, reason, orgId]);
    } else {
      // Clearing override (revert to Stripe)
      result = await db.query(`
        UPDATE organizations
        SET
          plan_source = 'stripe',
          plan_override = NULL,
          plan_override_set_at = NOW(),
          plan_override_set_by = $1,
          plan_override_reason = $2,
          updated_at = NOW()
        WHERE id = $3
        RETURNING id, plan, plan_source, plan_override, stripe_subscription_status, stripe_price_id
      `, [setByUserId, reason, orgId]);
    }

    if (result.rows.length === 0) {
      return { success: false, error: 'Organization not found' };
    }

    const org = result.rows[0];
    console.log(`[PlanService] Org ${orgId} plan override ${planOverride ? `set to ${planOverride}` : 'cleared'} by user ${setByUserId}`);

    return {
      success: true,
      org: {
        id: org.id,
        plan: org.plan,
        plan_source: org.plan_source,
        plan_override: org.plan_override,
        effective_plan: planOverride || (org.stripe_price_id ? VALID_PRICE_TO_PLAN[org.stripe_price_id] : org.plan) || 'free'
      }
    };
  } catch (error) {
    console.error(`[PlanService] setOrgPlanOverride error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// FEATURE-MATRIX ENTITLEMENTS (Phase 1 pivot)
// =============================================================================

/**
 * SSOT feature matrix for the new plan tiers.
 * Keys are effective plan names (free, starter, pro).
 * -1 means unlimited.
 */
const PLAN_ENTITLEMENTS = Object.freeze({
  free: Object.freeze({
    scansPerMonth:     1,
    pagesPerScan:      1,
    tokensPerCycle:    0,
    canPurchaseTokens: false,
    hasFindings:       'teaser',
    hasCitation:       'teaser',
    hasCompetitor:     false,
    hasExports:        false
  }),
  starter: Object.freeze({
    scansPerMonth:     4,
    pagesPerScan:      3,
    tokensPerCycle:    60,
    canPurchaseTokens: true,
    hasFindings:       'full',
    hasCitation:       'standard',
    hasCompetitor:     false,
    hasExports:        false
  }),
  pro: Object.freeze({
    scansPerMonth:     -1,
    pagesPerScan:      10,
    tokensPerCycle:    200,
    canPurchaseTokens: true,
    hasFindings:       'full',
    hasCitation:       'pro',
    hasCompetitor:     true,
    hasExports:        true
  })
});

/**
 * Normalize a plan name: trim, lowercase, null/empty → 'free'.
 *
 * This is a lightweight normalizer for the new entitlement layer.
 * It does NOT apply legacy aliases — use getEffectivePlan() for that.
 *
 * @param {string|null|undefined} planName
 * @returns {string}
 */
function normalizePlanName(planName) {
  if (!planName) return 'free';
  return String(planName).trim().toLowerCase() || 'free';
}

/**
 * Map a normalized plan name to the effective plan used for entitlement lookup.
 *
 * Backward-compat mappings:
 *   'diy'      → 'starter'
 *   'freemium' → 'free'
 *
 * @param {string|null|undefined} planName - Raw or normalized plan name
 * @returns {string} Effective plan key (matches PLAN_ENTITLEMENTS keys)
 */
function getEffectivePlan(planName) {
  const normalized = normalizePlanName(planName);

  if (normalized === 'diy')      return 'starter';
  if (normalized === 'freemium') return 'free';

  return normalized;
}

/**
 * Get feature-matrix entitlements for a plan.
 *
 * Uses getEffectivePlan() to resolve aliases first.
 * Unknown plans log a warning and return free-tier entitlements (never crashes).
 *
 * @param {string|null|undefined} planName
 * @returns {Readonly<{scansPerMonth:number, pagesPerScan:number, tokensPerCycle:number, canPurchaseTokens:boolean, hasFindings:string, hasCitation:string, hasCompetitor:boolean, hasExports:boolean}>}
 */
function getEntitlements(planName) {
  const effective = getEffectivePlan(planName);
  const entitlements = PLAN_ENTITLEMENTS[effective];

  if (!entitlements) {
    console.warn(`[PlanService] Unknown effective plan '${effective}' (raw: '${planName}') — returning free entitlements`);
    return PLAN_ENTITLEMENTS.free;
  }

  return entitlements;
}

/**
 * Check whether a plan grants access to a named feature.
 *
 * Supports both boolean keys (hasCompetitor, hasExports, canPurchaseTokens)
 * and access-level keys (hasFindings, hasCitation) — for access-level keys
 * any truthy non-'teaser' value is considered full access.
 *
 * @param {string|null|undefined} planName
 * @param {string} featureName - Key in PLAN_ENTITLEMENTS (e.g. 'hasCompetitor')
 * @returns {boolean}
 */
function canAccessFeature(planName, featureName) {
  const ent = getEntitlements(planName);
  const value = ent[featureName];

  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  // Access-level strings: 'full', 'standard', 'pro' → true; 'teaser' → false
  if (typeof value === 'string') return value !== 'teaser';
  // Numeric (e.g. tokensPerCycle): truthy if > 0
  return value > 0;
}

/**
 * Get the token allowance for a plan.
 *
 * @param {string|null|undefined} planName
 * @returns {number} tokensPerCycle (0 for free)
 */
function getTokenAllowance(planName) {
  return getEntitlements(planName).tokensPerCycle;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Phase 2.1: Org-first resolution
  normalizePlan,
  resolvePlanFromStripeFields,
  getOrgRow,
  resolveOrgPlan,
  resolvePlanForRequest,

  // Org Stripe field management
  upsertOrgStripeFields,
  clearOrgStripeFields,

  // Admin helpers
  setOrgPlanOverride,

  // Legacy user-level functions (backwards compatible)
  resolvePlanFromStripe,
  getUserPlan,
  syncPlanFromWebhook,
  handleSubscriptionDeleted,
  hasActiveSubscription,

  // Utilities
  getPriceToPlanMapping,

  // Feature-matrix entitlements (Phase 1 pivot)
  PLAN_ENTITLEMENTS,
  normalizePlanName,
  getEffectivePlan,
  getEntitlements,
  canAccessFeature,
  getTokenAllowance,

  // Constants
  ACTIVE_SUBSCRIPTION_STATUSES,
  INACTIVE_SUBSCRIPTION_STATUSES,
  VALID_PLANS
};
