/**
 * Entitlement Service
 *
 * Calculates and manages directory submission entitlements based on:
 * - Subscription plan (DIY: 10/mo, Pro: 25/mo, Agency: 100/mo)
 * - Order-based allocations ($249 starter, $99 packs)
 */

const db = require('../db/database');
const config = require('../config/citationNetwork');

const PLAN_ALLOCATIONS = config.planAllocations || {
  freemium: 0,
  free: 0,
  diy: 10,
  pro: 25,
  enterprise: 50,
  agency: 100
};

class EntitlementService {

  /**
   * Calculate total directories a user can submit to
   * FIXED: Properly handles subscribers who also have orders
   * Returns: { total, remaining, source, sourceId, breakdown, plan, isSubscriber }
   */
  async calculateEntitlement(userId) {
    const user = await this.getUser(userId);

    if (!user) {
      throw new Error('User not found');
    }

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

    // 1. Check subscription allocation
    const isPaidPlan = ['diy', 'pro', 'enterprise', 'agency'].includes(user.plan);
    const isSubscriber = isPaidPlan && (
      user.stripe_subscription_status === 'active' ||
      (user.stripe_subscription_id && user.stripe_subscription_status !== 'canceled')
    );

    if (isSubscriber) {
      // Get current month's allocation
      const allocation = await this.getMonthlyAllocation(userId, user.plan);
      breakdown.subscription_total = allocation.total;
      breakdown.subscription_used = allocation.used;
      breakdown.subscription_remaining = allocation.remaining;
      primarySource = 'subscription';
      sourceId = user.stripe_subscription_id;
    }

    // 2. Check order-based allocation (always check, even for subscribers)
    const orderAllocation = await this.getOrderAllocation(userId);
    breakdown.orders_total = orderAllocation.total;
    breakdown.orders_used = orderAllocation.used;
    breakdown.orders_remaining = orderAllocation.remaining;

    // If not subscriber but has orders, set primary source
    if (!isSubscriber && orderAllocation.total > 0) {
      primarySource = 'order';
      sourceId = orderAllocation.latestOrderId;
    }

    // 3. Calculate totals (sum both sources)
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
        subscriptionRemaining: breakdown.subscription_remaining,
        orders: breakdown.orders_total,
        ordersUsed: breakdown.orders_used,
        ordersRemaining: breakdown.orders_remaining
      },
      plan: user.plan,
      isSubscriber
    };
  }

  /**
   * Get monthly allocation for subscriber
   */
  async getMonthlyAllocation(userId, plan) {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Check if allocation record exists for this month
    let result = await db.query(`
      SELECT * FROM subscriber_directory_allocations
      WHERE user_id = $1 AND period_start = $2
    `, [userId, periodStart]);

    if (result.rows.length === 0) {
      // Create allocation for current month
      const baseAllocation = PLAN_ALLOCATIONS[plan] || 0;
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      result = await db.query(`
        INSERT INTO subscriber_directory_allocations
        (user_id, period_start, period_end, base_allocation, pack_allocation, submissions_used)
        VALUES ($1, $2, $3, $4, 0, 0)
        RETURNING *
      `, [userId, periodStart, periodEnd, baseAllocation]);
    }

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
   * Get order-based allocation (for non-subscribers or additional packs)
   */
  async getOrderAllocation(userId) {
    const result = await db.query(`
      SELECT
        id,
        directories_allocated,
        directories_submitted
      FROM directory_orders
      WHERE user_id = $1
        AND status IN ('paid', 'processing', 'in_progress', 'completed')
      ORDER BY created_at DESC
    `, [userId]);

    if (result.rows.length === 0) {
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
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

      await db.query(`
        UPDATE subscriber_directory_allocations
        SET submissions_used = submissions_used + $1,
            updated_at = NOW()
        WHERE user_id = $2 AND period_start = $3
      `, [count, userId, periodStart]);
    } else if (source === 'order') {
      // Distribute across orders (FIFO - oldest first)
      let remaining = count;

      const orders = await db.query(`
        SELECT id, directories_allocated, directories_submitted
        FROM directory_orders
        WHERE user_id = $1
          AND status IN ('paid', 'processing', 'in_progress', 'completed')
          AND directories_submitted < directories_allocated
        ORDER BY created_at ASC
      `, [userId]);

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
}

module.exports = new EntitlementService();
