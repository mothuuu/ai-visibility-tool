/**
 * AI Citation Network Routes
 *
 * Handles checkout, orders, and allocation endpoints
 */

const express = require('express');
const router = express.Router();
const citationNetworkStripe = require('../services/citationNetworkStripeService');
const { authenticateToken, authenticateTokenOptional } = require('../middleware/auth');
const db = require('../db/database');
const config = require('../config/citationNetwork');

/**
 * GET /api/citation-network/checkout-info
 * Get what checkout option the user should see
 */
router.get('/checkout-info', authenticateTokenOptional, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const info = await citationNetworkStripe.getCheckoutInfo(userId);
    res.json(info);
  } catch (error) {
    console.error('Error getting checkout info:', error);
    res.status(500).json({ error: 'Failed to get checkout info' });
  }
});

/**
 * POST /api/citation-network/checkout
 * Create checkout session (smart routing to $249 or $99)
 */
router.post('/checkout', authenticateTokenOptional, async (req, res) => {
  try {
    const { email } = req.body;
    const userId = req.user?.id || null;

    // Email required if not logged in
    if (!userId && !email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const result = await citationNetworkStripe.createCheckout(userId, email || req.user?.email);
    res.json(result);

  } catch (error) {
    console.error('Checkout error:', error);

    if (error.message === 'PROFILE_REQUIRED') {
      return res.status(400).json({
        error: 'Please complete your business profile first',
        code: 'PROFILE_REQUIRED',
        redirect: '/dashboard.html?tab=citation-network&action=profile'
      });
    }

    if (error.message.includes('Maximum')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to create checkout' });
  }
});

/**
 * GET /api/citation-network/orders
 * Get user's citation network orders
 */
router.get('/orders', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        o.*,
        (SELECT COUNT(*) FROM directory_submissions WHERE order_id = o.id) as submissions_count,
        (SELECT COUNT(*) FROM directory_submissions WHERE order_id = o.id AND status = 'live') as live_count
      FROM directory_orders o
      WHERE o.user_id = $1 AND o.status != 'pending'
      ORDER BY o.created_at DESC
    `, [req.user.id]);

    res.json({ orders: result.rows });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

/**
 * GET /api/citation-network/orders/:id
 * Get specific order
 */
router.get('/orders/:id', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM directory_orders
      WHERE id = $1 AND user_id = $2
    `, [req.params.id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ order: result.rows[0] });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

/**
 * GET /api/citation-network/allocation
 * Get current allocation for user
 */
router.get('/allocation', authenticateToken, async (req, res) => {
  try {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get user's plan
    const user = await db.query(
      'SELECT plan, stripe_subscription_status, stripe_subscription_id FROM users WHERE id = $1',
      [req.user.id]
    );

    const isPaidPlan = ['diy', 'pro', 'enterprise', 'agency'].includes(user.rows[0]?.plan);
    const isSubscriber = isPaidPlan && (
      user.rows[0]?.stripe_subscription_status === 'active' ||
      user.rows[0]?.stripe_subscription_id
    );

    if (!isSubscriber) {
      // Non-subscriber: return order-based allocation
      const orders = await db.query(`
        SELECT
          SUM(directories_allocated) as total_allocated,
          SUM(directories_submitted) as total_submitted,
          SUM(directories_live) as total_live
        FROM directory_orders
        WHERE user_id = $1 AND status IN ('paid', 'processing', 'in_progress', 'completed')
      `, [req.user.id]);

      return res.json({
        type: 'order_based',
        allocation: {
          total: parseInt(orders.rows[0]?.total_allocated) || 0,
          submitted: parseInt(orders.rows[0]?.total_submitted) || 0,
          live: parseInt(orders.rows[0]?.total_live) || 0,
          remaining: (parseInt(orders.rows[0]?.total_allocated) || 0) -
                     (parseInt(orders.rows[0]?.total_submitted) || 0)
        }
      });
    }

    // Subscriber: return monthly allocation
    let allocation = await db.query(`
      SELECT * FROM subscriber_directory_allocations
      WHERE user_id = $1 AND period_start = $2
    `, [req.user.id, periodStart]);

    if (allocation.rows.length === 0) {
      // Create allocation for current month
      const baseAllocation = config.planAllocations[user.rows[0].plan] || 0;
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      allocation = await db.query(`
        INSERT INTO subscriber_directory_allocations
        (user_id, period_start, period_end, base_allocation, pack_allocation, submissions_used)
        VALUES ($1, $2, $3, $4, 0, 0)
        RETURNING *
      `, [req.user.id, periodStart, periodEnd, baseAllocation]);
    }

    const alloc = allocation.rows[0];
    const total = (alloc.base_allocation || 0) + (alloc.pack_allocation || 0);

    res.json({
      type: 'subscription',
      plan: user.rows[0].plan,
      allocation: {
        base: alloc.base_allocation,
        packs: alloc.pack_allocation,
        total: total,
        used: alloc.submissions_used,
        remaining: total - alloc.submissions_used,
        periodStart: alloc.period_start,
        periodEnd: alloc.period_end
      }
    });
  } catch (error) {
    console.error('Error fetching allocation:', error);
    res.status(500).json({ error: 'Failed to fetch allocation' });
  }
});

/**
 * GET /api/citation-network/submissions
 * Get user's directory submissions
 */
router.get('/submissions', authenticateToken, async (req, res) => {
  try {
    const { status, order_id } = req.query;

    let query = `
      SELECT ds.*, d.directory_name, d.directory_url
      FROM directory_submissions ds
      LEFT JOIN directory_orders d ON ds.order_id = d.id
      WHERE ds.user_id = $1
    `;
    const params = [req.user.id];

    if (status) {
      query += ` AND ds.status = $${params.length + 1}`;
      params.push(status);
    }

    if (order_id) {
      query += ` AND ds.order_id = $${params.length + 1}`;
      params.push(order_id);
    }

    query += ' ORDER BY ds.created_at DESC';

    const result = await db.query(query, params);
    res.json({ submissions: result.rows });
  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

/**
 * GET /api/citation-network/profile
 * Get user's business profile
 */
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM business_profiles WHERE user_id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.json({ profile: null, hasProfile: false });
    }

    res.json({ profile: result.rows[0], hasProfile: true });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * POST /api/citation-network/profile
 * Create or update business profile
 */
router.post('/profile', authenticateToken, async (req, res) => {
  try {
    const {
      business_name,
      website_url,
      phone,
      email,
      address_line1,
      address_line2,
      city,
      state,
      postal_code,
      country,
      business_description,
      short_description,
      year_founded,
      number_of_employees,
      primary_category,
      secondary_categories,
      social_links,
      logo_url,
      photos,
      business_hours,
      payment_methods,
      service_areas,
      certifications
    } = req.body;

    if (!business_name) {
      return res.status(400).json({ error: 'Business name is required' });
    }

    // Calculate completion percentage
    const fields = [
      business_name, website_url, phone, email, address_line1, city, state,
      postal_code, business_description, primary_category
    ];
    const filledFields = fields.filter(f => f && f.toString().trim()).length;
    const completionPercentage = Math.round((filledFields / fields.length) * 100);
    const isComplete = completionPercentage >= 80;

    // Check if profile exists
    const existing = await db.query(
      'SELECT id FROM business_profiles WHERE user_id = $1',
      [req.user.id]
    );

    let result;
    if (existing.rows.length > 0) {
      // Update existing profile
      result = await db.query(`
        UPDATE business_profiles SET
          business_name = $1,
          website_url = $2,
          phone = $3,
          email = $4,
          address_line1 = $5,
          address_line2 = $6,
          city = $7,
          state = $8,
          postal_code = $9,
          country = $10,
          business_description = $11,
          short_description = $12,
          year_founded = $13,
          number_of_employees = $14,
          primary_category = $15,
          secondary_categories = $16,
          social_links = $17,
          logo_url = $18,
          photos = $19,
          business_hours = $20,
          payment_methods = $21,
          service_areas = $22,
          certifications = $23,
          is_complete = $24,
          completion_percentage = $25,
          updated_at = NOW()
        WHERE user_id = $26
        RETURNING *
      `, [
        business_name, website_url, phone, email, address_line1, address_line2,
        city, state, postal_code, country || 'United States', business_description,
        short_description, year_founded, number_of_employees, primary_category,
        JSON.stringify(secondary_categories || []), JSON.stringify(social_links || {}),
        logo_url, JSON.stringify(photos || []), JSON.stringify(business_hours || {}),
        JSON.stringify(payment_methods || []), JSON.stringify(service_areas || []),
        JSON.stringify(certifications || []), isComplete, completionPercentage, req.user.id
      ]);
    } else {
      // Create new profile
      result = await db.query(`
        INSERT INTO business_profiles (
          user_id, business_name, website_url, phone, email, address_line1,
          address_line2, city, state, postal_code, country, business_description,
          short_description, year_founded, number_of_employees, primary_category,
          secondary_categories, social_links, logo_url, photos, business_hours,
          payment_methods, service_areas, certifications, is_complete, completion_percentage
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
        )
        RETURNING *
      `, [
        req.user.id, business_name, website_url, phone, email, address_line1,
        address_line2, city, state, postal_code, country || 'United States',
        business_description, short_description, year_founded, number_of_employees,
        primary_category, JSON.stringify(secondary_categories || []),
        JSON.stringify(social_links || {}), logo_url, JSON.stringify(photos || []),
        JSON.stringify(business_hours || {}), JSON.stringify(payment_methods || []),
        JSON.stringify(service_areas || []), JSON.stringify(certifications || []),
        isComplete, completionPercentage
      ]);
    }

    res.json({
      profile: result.rows[0],
      isComplete,
      completionPercentage
    });
  } catch (error) {
    console.error('Error saving profile:', error);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

/**
 * GET /api/citation-network/stats
 * Get citation network stats for dashboard
 */
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    // Get order stats
    const orderStats = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('paid', 'processing', 'in_progress', 'completed')) as total_orders,
        SUM(directories_allocated) FILTER (WHERE status IN ('paid', 'processing', 'in_progress', 'completed')) as total_directories,
        SUM(directories_submitted) FILTER (WHERE status IN ('paid', 'processing', 'in_progress', 'completed')) as total_submitted,
        SUM(directories_live) FILTER (WHERE status IN ('paid', 'processing', 'in_progress', 'completed')) as total_live
      FROM directory_orders
      WHERE user_id = $1
    `, [req.user.id]);

    // Get profile status
    const profile = await db.query(
      'SELECT is_complete, completion_percentage FROM business_profiles WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      orders: parseInt(orderStats.rows[0]?.total_orders) || 0,
      directories: {
        allocated: parseInt(orderStats.rows[0]?.total_directories) || 0,
        submitted: parseInt(orderStats.rows[0]?.total_submitted) || 0,
        live: parseInt(orderStats.rows[0]?.total_live) || 0
      },
      profile: {
        hasProfile: profile.rows.length > 0,
        isComplete: profile.rows[0]?.is_complete || false,
        completionPercentage: profile.rows[0]?.completion_percentage || 0
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
