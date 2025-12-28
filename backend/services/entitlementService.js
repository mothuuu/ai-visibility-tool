/**
 * Entitlement Service
 *
 * Calculates and manages directory submission entitlements based on:
 * - Subscription plan (DIY: 10/mo, Pro: 25/mo, Agency: 100/mo)
 * - Order-based allocations ($249 starter, $99 packs)
 *
 * UPDATED: Uses citationNetwork config as single source of truth
 * FIX T0-5: Uses isActiveSubscriber() to properly check subscription status
 *           (null/undefined stripe_subscription_status is no longer treated as valid)
 */

const db = require('../db/database');
const {
  PLAN_ALLOCATIONS,
  USABLE_ORDER_STATUSES,
  normalizePlan,
  getPlanAllocation,
  isActiveSubscriber,
  isSubscriberPlan,
  ALLOWED_STRIPE_STATUSES
} = require('../config/citationNetwork');

// Debug logging helper - only logs when CITATION_DEBUG=1
function debugLog(requestId, ...args) {
  if (process.env.CITATION_DEBUG === '1') {
    const prefix = requestId ? `[Entitlement:${requestId}]` : '[Entitlement]';
    console.log(prefix, ...args);
  }
}

// Note: USABLE_ORDER_STATUSES is now imported from citationNetwork config

class EntitlementService {

  /**
   * Calculate total directories a user can submit to
   * FIXED: Properly handles subscribers who also have orders
   * Returns: { total, remaining, source, sourceId, breakdown, plan, isSubscriber }
   *
   * @param {number} userId - User ID
   * @param {object} options - Options including requestId for logging
   */
  async calculateEntitlement(userId, options = {}) {
    const requestId = options.requestId || null;
    const user = await this.getUser(userId);

    if (!user) {
      throw new Error('User not found');
    }

    // Step 1: Normalize plan using planUtils (single source of truth)
    const normalizedPlan = normalizePlan(user.plan);

    debugLog(requestId, 'Calculating for user:', userId);
    debugLog(requestId, 'User data:', {
      planRaw: user.plan,
      planNormalized: normalizedPlan,
      stripe_subscription_status: user.stripe_subscription_status,
      stripe_subscription_id: user.stripe_subscription_id ? 'present' : 'null'
    });

    const breakdown = {
      subscription_total: 0,
      subscription_used: 0,
      subscription_remaining: 0,
      orders_total: 0,
      orders_used: 0,
      orders_remaining: 0
    };

    let primarySource = 'none';
    let sourceId = null;

    // Step 2: Check subscriber status using isActiveSubscriber()
    // FIX T0-5: CRITICAL - null/undefined stripe_subscription_status is NO LONGER treated as valid
    // User must have explicit 'active' or 'trialing' status to be considered a subscriber
    const isSubscriber = isActiveSubscriber(user);
    const paidPlan = isSubscriberPlan(normalizedPlan);

    debugLog(requestId, 'Subscriber check:', {
      normalizedPlan,
      isSubscriberPlan: paidPlan,
      stripeStatus: user.stripe_subscription_status,
      stripeSubId: user.stripe_subscription_id ? 'present' : 'null',
      manualOverride: user.subscription_manual_override || false,
      isSubscriber
    });

    let allocation = null;

    if (isSubscriber) {
      // Step 3: Get current month's allocation (auto-creates if missing)
      allocation = await this.getMonthlyAllocation(userId, normalizedPlan, { requestId });
      breakdown.subscription_total = allocation.total;
      breakdown.subscription_used = allocation.used;
      breakdown.subscription_remaining = allocation.remaining;
      primarySource = 'subscription';
      sourceId = user.stripe_subscription_id;

      debugLog(requestId, 'Subscription allocation:', {
        base: allocation.base,
        packs: allocation.packs,
        total: allocation.total,
        used: allocation.used,
        remaining: allocation.remaining
      });
    }

    // Check order-based allocation (always check, even for subscribers)
    const orderAllocation = await this.getOrderAllocation(userId, { requestId });
    breakdown.orders_total = orderAllocation.total;
    breakdown.orders_used = orderAllocation.used;
    breakdown.orders_remaining = orderAllocation.remaining;

    debugLog(requestId, 'Order allocation:', {
      total: orderAllocation.total,
      used: orderAllocation.used,
      remaining: orderAllocation.remaining,
      latestOrderId: orderAllocation.latestOrderId
    });

    // If not subscriber but has orders, set primary source
    if (!isSubscriber && orderAllocation.total > 0) {
      primarySource = 'order';
      sourceId = orderAllocation.latestOrderId;
    }

    // Calculate totals (sum both sources)
    const total = breakdown.subscription_total + breakdown.orders_total;
    const used = breakdown.subscription_used + breakdown.orders_used;
    const remaining = breakdown.subscription_remaining + breakdown.orders_remaining;

    const result = {
      total,
      used,
      remaining: Math.max(0, remaining),
      source: primarySource,
      sourceId,
      breakdown: {
        subscription: breakdown.subscription_total,
        subscriptionUsed: breakdown.subscription_used,
        subscription_remaining: breakdown.subscription_remaining,
        subscriptionRemaining: breakdown.subscription_remaining,
        orders: breakdown.orders_total,
        ordersUsed: breakdown.orders_used,
        orders_remaining: breakdown.orders_remaining,
        ordersRemaining: breakdown.orders_remaining
      },
      plan: normalizedPlan,
      isSubscriber
    };

    // Always log when entitlement is 0, or when debug is on
    if (result.remaining <= 0) {
      console.log('[Entitlement] WARNING - Zero remaining:', {
        userId,
        requestId,
        planRaw: user.plan,
        planNormalized: normalizedPlan,
        stripeStatus: user.stripe_subscription_status,
        isSubscriber,
        allocationExists: !!allocation,
        subscriptionRemaining: breakdown.subscription_remaining,
        ordersRemaining: breakdown.orders_remaining,
        totalRemaining: result.remaining
      });
    }

    debugLog(requestId, 'Final result:', {
      total,
      used,
      remaining: result.remaining,
      source: primarySource,
      isSubscriber
    });

    return result;
  }

  /**
   * Get monthly allocation for subscriber (create-on-read with UPSERT)
   * Uses planUtils.getPlanAllocation for the base allocation
   */
  async getMonthlyAllocation(userId, plan, options = {}) {
    const requestId = options.requestId || null;
    const normalizedPlan = normalizePlan(plan);
    const now = new Date();

    // Use UTC dates for consistency
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const periodStartStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const periodEndStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Get base allocation from planUtils (single source of truth)
    const baseAllocation = getPlanAllocation(normalizedPlan);

    debugLog(requestId, 'getMonthlyAllocation:', {
      userId,
      plan: normalizedPlan,
      baseAllocation,
      period: `${periodStartStr} to ${periodEndStr}`
    });

    if (baseAllocation === 0) {
      debugLog(requestId, `Plan ${normalizedPlan} has 0 base allocation`);
      return { base: 0, packs: 0, total: 0, used: 0, remaining: 0 };
    }

    try {
      // Use UPSERT pattern with ON CONFLICT ON CONSTRAINT
      // GREATEST ensures upgrades increase allocation but downgrades don't reduce mid-month
      const result = await db.query(`
        INSERT INTO subscriber_directory_allocations
        (user_id, period_start, period_end, base_allocation, pack_allocation, submissions_used, created_at, updated_at)
        VALUES ($1, $2::date, $3::date, $4, 0, 0, NOW(), NOW())
        ON CONFLICT ON CONSTRAINT unique_user_period
        DO UPDATE SET
          base_allocation = GREATEST(subscriber_directory_allocations.base_allocation, EXCLUDED.base_allocation),
          updated_at = NOW()
        RETURNING *
      `, [userId, periodStartStr, periodEndStr, baseAllocation]);

      const alloc = result.rows[0];

      debugLog(requestId, 'Allocation record:', {
        id: alloc.id,
        base: alloc.base_allocation,
        packs: alloc.pack_allocation,
        used: alloc.submissions_used
      });

      return {
        base: alloc.base_allocation || 0,
        packs: alloc.pack_allocation || 0,
        total: (alloc.base_allocation || 0) + (alloc.pack_allocation || 0),
        used: alloc.submissions_used || 0,
        remaining: (alloc.base_allocation || 0) + (alloc.pack_allocation || 0) - (alloc.submissions_used || 0)
      };
    } catch (error) {
      console.error(`[Entitlement:${requestId}] ERROR in getMonthlyAllocation:`, error.message);
      console.error(`[Entitlement:${requestId}] Query params:`, { userId, periodStartStr, baseAllocation });

      // Fallback: try simple SELECT in case UPSERT failed
      try {
        const fallbackResult = await db.query(`
          SELECT * FROM subscriber_directory_allocations
          WHERE user_id = $1 AND period_start = $2::date
        `, [userId, periodStartStr]);

        if (fallbackResult.rows.length > 0) {
          const alloc = fallbackResult.rows[0];
          debugLog(requestId, 'Fallback found existing allocation:', alloc.id);
          return {
            base: alloc.base_allocation || 0,
            packs: alloc.pack_allocation || 0,
            total: (alloc.base_allocation || 0) + (alloc.pack_allocation || 0),
            used: alloc.submissions_used || 0,
            remaining: (alloc.base_allocation || 0) + (alloc.pack_allocation || 0) - (alloc.submissions_used || 0)
          };
        }
      } catch (fallbackError) {
        console.error(`[Entitlement:${requestId}] Fallback SELECT also failed:`, fallbackError.message);
      }

      // Last resort: return plan-based allocation without DB record
      console.log(`[Entitlement:${requestId}] Using plan-based fallback: ${baseAllocation} directories`);
      return {
        base: baseAllocation,
        packs: 0,
        total: baseAllocation,
        used: 0,
        remaining: baseAllocation
      };
    }
  }

  /**
   * Get order-based allocation using unified status definitions
   */
  async getOrderAllocation(userId, options = {}) {
    const requestId = options.requestId || null;

    const result = await db.query(`
      SELECT
        id,
        directories_allocated,
        directories_submitted
      FROM directory_orders
      WHERE user_id = $1
        AND status = ANY($2::text[])
      ORDER BY created_at DESC
    `, [userId, USABLE_ORDER_STATUSES]);

    if (result.rows.length === 0) {
      debugLog(requestId, 'No orders found for user');
      return { total: 0, used: 0, remaining: 0, latestOrderId: null };
    }

    const total = result.rows.reduce((sum, o) => sum + (o.directories_allocated || 0), 0);
    const used = result.rows.reduce((sum, o) => sum + (o.directories_submitted || 0), 0);

    return {
      total,
      used,
      remaining: Math.max(0, total - used),
      latestOrderId: result.rows[0].id
    };
  }

  /**
   * Consume entitlement (after creating submissions)
   */
  async consumeEntitlement(userId, count, source, sourceId) {
    if (count <= 0) return;

    if (source === 'subscription') {
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth();
      const periodStartStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;

      await db.query(`
        UPDATE subscriber_directory_allocations
        SET submissions_used = submissions_used + $1,
            updated_at = NOW()
        WHERE user_id = $2 AND period_start = $3::date
      `, [count, userId, periodStartStr]);
    } else if (source === 'order') {
      // Distribute across orders (FIFO - oldest first)
      let remaining = count;

      const orders = await db.query(`
        SELECT id, directories_allocated, directories_submitted
        FROM directory_orders
        WHERE user_id = $1
          AND status = ANY($2::text[])
          AND directories_submitted < directories_allocated
        ORDER BY created_at ASC
      `, [userId, USABLE_ORDER_STATUSES]);

      for (const order of orders.rows) {
        if (remaining <= 0) break;

        const available = order.directories_allocated - order.directories_submitted;
        const toConsume = Math.min(available, remaining);

        await db.query(`
          UPDATE directory_orders
          SET directories_submitted = directories_submitted + $1,
              updated_at = NOW()
          WHERE id = $2
        `, [toConsume, order.id]);

        remaining -= toConsume;
      }
    }
  }

  /**
   * Reserve entitlement (before actually consuming, for transactional safety)
   * Returns the count that was successfully reserved
   */
  async reserveEntitlement(userId, requestedCount) {
    const entitlement = await this.calculateEntitlement(userId);
    const reserveCount = Math.min(requestedCount, entitlement.remaining);

    if (reserveCount <= 0) {
      return { reserved: 0, source: 'none', sourceId: null };
    }

    return {
      reserved: reserveCount,
      source: entitlement.source,
      sourceId: entitlement.sourceId
    };
  }

  /**
   * Get user record
   */
  async getUser(userId) {
    const result = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Check if user has any remaining entitlement
   */
  async hasEntitlement(userId) {
    const entitlement = await this.calculateEntitlement(userId);
    return entitlement.remaining > 0;
  }

  /**
   * Get entitlement summary for display
   */
  async getEntitlementSummary(userId) {
    const entitlement = await this.calculateEntitlement(userId);

    let sourceLabel = 'None';
    if (entitlement.isSubscriber) {
      sourceLabel = `${entitlement.plan.toUpperCase()} subscription`;
    } else if (entitlement.source === 'order') {
      sourceLabel = 'Directory pack';
    }

    return {
      remaining: entitlement.remaining,
      total: entitlement.total,
      source: sourceLabel,
      isSubscriber: entitlement.isSubscriber,
      plan: entitlement.plan,
      breakdown: entitlement.breakdown
    };
  }

  // ===========================================================================
  // T0-6 & T0-7: Client-based methods for transactional operations
  // ===========================================================================

  /**
   * T0-6: Get or create monthly allocation using provided client (for transactions)
   * Uses DATE_TRUNC for proper date handling
   *
   * @param {object} client - Database client from pool.connect()
   * @param {number} userId - User ID
   * @param {string} plan - User's plan (will be normalized)
   * @param {object} options - Options including requestId
   */
  async getOrCreateMonthlyAllocationWithClient(client, userId, plan, options = {}) {
    const requestId = options.requestId || null;
    const normalizedPlan = normalizePlan(plan);
    const baseAllocation = getPlanAllocation(normalizedPlan);

    debugLog(requestId, 'getOrCreateMonthlyAllocationWithClient:', {
      userId,
      plan: normalizedPlan,
      baseAllocation
    });

    if (baseAllocation === 0) {
      return { base: 0, packs: 0, total: 0, used: 0, remaining: 0 };
    }

    // T0-6: Use DATE_TRUNC for proper period_start handling
    const result = await client.query(`
      INSERT INTO subscriber_directory_allocations (
        user_id, period_start, period_end, base_allocation, pack_allocation, submissions_used, created_at, updated_at
      ) VALUES (
        $1,
        DATE_TRUNC('month', NOW())::date,
        (DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 day')::date,
        $2,
        0,
        0,
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id, period_start)
      DO UPDATE SET
        base_allocation = GREATEST(subscriber_directory_allocations.base_allocation, EXCLUDED.base_allocation),
        updated_at = NOW()
      RETURNING *
    `, [userId, baseAllocation]);

    const alloc = result.rows[0];

    return {
      base: alloc.base_allocation || 0,
      packs: alloc.pack_allocation || 0,
      total: (alloc.base_allocation || 0) + (alloc.pack_allocation || 0),
      used: alloc.submissions_used || 0,
      remaining: (alloc.base_allocation || 0) + (alloc.pack_allocation || 0) - (alloc.submissions_used || 0)
    };
  }

  /**
   * T0-7: Calculate entitlement using provided client (for transactions)
   * Used within a transaction that has already locked the user row
   *
   * @param {object} client - Database client from pool.connect()
   * @param {number} userId - User ID
   * @param {object} user - User object (already fetched with FOR UPDATE)
   * @param {object} options - Options including requestId
   */
  async calculateEntitlementWithClient(client, userId, user, options = {}) {
    const requestId = options.requestId || null;
    const normalizedPlan = normalizePlan(user.plan);

    debugLog(requestId, 'calculateEntitlementWithClient:', { userId, plan: normalizedPlan });

    const breakdown = {
      subscription_total: 0,
      subscription_used: 0,
      subscription_remaining: 0,
      orders_total: 0,
      orders_used: 0,
      orders_remaining: 0
    };

    let primarySource = 'none';
    let sourceId = null;

    // Check subscriber status
    const isSubscriber = isActiveSubscriber(user);

    let allocation = null;

    if (isSubscriber) {
      // Get/create allocation using client
      allocation = await this.getOrCreateMonthlyAllocationWithClient(client, userId, normalizedPlan, { requestId });
      breakdown.subscription_total = allocation.total;
      breakdown.subscription_used = allocation.used;
      breakdown.subscription_remaining = allocation.remaining;
      primarySource = 'subscription';
      sourceId = user.stripe_subscription_id;
    }

    // Get order allocation using client
    const orderResult = await client.query(`
      SELECT id, directories_allocated, directories_submitted
      FROM directory_orders
      WHERE user_id = $1
        AND status = ANY($2::text[])
      ORDER BY created_at DESC
    `, [userId, USABLE_ORDER_STATUSES]);

    if (orderResult.rows.length > 0) {
      breakdown.orders_total = orderResult.rows.reduce((sum, o) => sum + (o.directories_allocated || 0), 0);
      breakdown.orders_used = orderResult.rows.reduce((sum, o) => sum + (o.directories_submitted || 0), 0);
      breakdown.orders_remaining = Math.max(0, breakdown.orders_total - breakdown.orders_used);

      if (!isSubscriber && breakdown.orders_total > 0) {
        primarySource = 'order';
        sourceId = orderResult.rows[0].id;
      }
    }

    // Calculate totals
    const total = breakdown.subscription_total + breakdown.orders_total;
    const used = breakdown.subscription_used + breakdown.orders_used;
    const remaining = breakdown.subscription_remaining + breakdown.orders_remaining;

    return {
      total,
      used,
      remaining: Math.max(0, remaining),
      source: primarySource,
      sourceId,
      breakdown: {
        subscription: breakdown.subscription_total,
        subscriptionUsed: breakdown.subscription_used,
        subscription_remaining: breakdown.subscription_remaining,
        subscriptionRemaining: breakdown.subscription_remaining,
        orders: breakdown.orders_total,
        ordersUsed: breakdown.orders_used,
        orders_remaining: breakdown.orders_remaining,
        ordersRemaining: breakdown.orders_remaining
      },
      plan: normalizedPlan,
      isSubscriber
    };
  }

  /**
   * T0-7: Consume entitlement using provided client with row locks
   * Consumes from subscription first, then orders (FIFO)
   *
   * @param {object} client - Database client from pool.connect()
   * @param {number} userId - User ID
   * @param {number} count - Number of submissions to consume
   * @param {object} entitlement - Entitlement object from calculateEntitlementWithClient
   */
  async consumeEntitlementWithClient(client, userId, count, entitlement) {
    if (count <= 0) return { remaining: entitlement.remaining };

    let remaining = count;
    let subscriptionConsumed = 0;
    let ordersConsumed = 0;

    // 1. Consume from subscription first (if subscriber)
    if (entitlement.isSubscriber && remaining > 0) {
      const subscriptionAvailable = entitlement.breakdown?.subscriptionRemaining || 0;
      const toConsume = Math.min(subscriptionAvailable, remaining);

      if (toConsume > 0) {
        // Lock and update allocation row
        await client.query(`
          UPDATE subscriber_directory_allocations
          SET submissions_used = submissions_used + $1,
              updated_at = NOW()
          WHERE user_id = $2
            AND period_start = DATE_TRUNC('month', NOW())::date
        `, [toConsume, userId]);

        remaining -= toConsume;
        subscriptionConsumed = toConsume;
      }
    }

    // 2. Consume remaining from orders (FIFO with row locks)
    if (remaining > 0) {
      const orders = await client.query(`
        SELECT id, directories_allocated, directories_submitted
        FROM directory_orders
        WHERE user_id = $1
          AND status = ANY($2::text[])
          AND directories_submitted < directories_allocated
        ORDER BY created_at ASC
        FOR UPDATE
      `, [userId, USABLE_ORDER_STATUSES]);

      for (const order of orders.rows) {
        if (remaining <= 0) break;

        const available = order.directories_allocated - order.directories_submitted;
        const toConsume = Math.min(available, remaining);

        await client.query(`
          UPDATE directory_orders
          SET directories_submitted = directories_submitted + $1,
              updated_at = NOW()
          WHERE id = $2
        `, [toConsume, order.id]);

        remaining -= toConsume;
        ordersConsumed += toConsume;
      }
    }

    return {
      consumed: count - remaining,
      subscriptionConsumed,
      ordersConsumed,
      subscriptionRemaining: (entitlement.breakdown?.subscriptionRemaining || 0) - subscriptionConsumed,
      ordersRemaining: (entitlement.breakdown?.ordersRemaining || 0) - ordersConsumed,
      remaining: entitlement.remaining - (count - remaining)
    };
  }
}

// Export both the service instance and the helper functions
module.exports = new EntitlementService();
module.exports.normalizePlan = normalizePlan;
module.exports.isActiveSubscriber = isActiveSubscriber;
module.exports.USABLE_ORDER_STATUSES = USABLE_ORDER_STATUSES;
module.exports.PLAN_ALLOCATIONS = PLAN_ALLOCATIONS;
