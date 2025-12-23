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
  console.log('[Profile Save] Received request from user:', req.user.id);
  console.log('[Profile Save] Request body keys:', Object.keys(req.body));
  console.log('[Profile Save] business_name:', req.body.business_name);

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
 * POST /api/citation-network/start-submissions
 * Start the directory submission process
 */
router.post('/start-submissions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Check if user has a completed business profile
    const profileResult = await db.query(
      'SELECT id, is_complete, business_name FROM business_profiles WHERE user_id = $1',
      [userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].is_complete) {
      return res.status(400).json({
        error: 'Please complete your business profile first',
        code: 'PROFILE_INCOMPLETE',
        redirect: '/dashboard.html?tab=citation-network&action=profile'
      });
    }

    const businessProfileId = profileResult.rows[0].id;

    // 2. Get user's allocation
    const user = await db.query(
      'SELECT plan, stripe_subscription_status, stripe_subscription_id FROM users WHERE id = $1',
      [userId]
    );

    const isPaidPlan = ['diy', 'pro', 'enterprise', 'agency'].includes(user.rows[0]?.plan);
    const isSubscriber = isPaidPlan && (
      user.rows[0]?.stripe_subscription_status === 'active' ||
      user.rows[0]?.stripe_subscription_id
    );

    let availableSubmissions = 0;
    let orderId = null;

    if (isSubscriber) {
      // Get subscription-based allocation
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const allocation = await db.query(`
        SELECT * FROM subscriber_directory_allocations
        WHERE user_id = $1 AND period_start = $2
      `, [userId, periodStart]);

      if (allocation.rows.length > 0) {
        const alloc = allocation.rows[0];
        const total = (alloc.base_allocation || 0) + (alloc.pack_allocation || 0);
        availableSubmissions = total - (alloc.submissions_used || 0);
      }
    } else {
      // Get order-based allocation
      const orders = await db.query(`
        SELECT id, directories_allocated, directories_submitted
        FROM directory_orders
        WHERE user_id = $1 AND status IN ('paid', 'processing', 'in_progress')
        ORDER BY created_at ASC
      `, [userId]);

      for (const order of orders.rows) {
        const remaining = order.directories_allocated - order.directories_submitted;
        if (remaining > 0) {
          availableSubmissions = remaining;
          orderId = order.id;
          break;
        }
      }
    }

    if (availableSubmissions <= 0) {
      return res.status(400).json({
        error: 'No directory submissions available. Please purchase a pack.',
        code: 'NO_ALLOCATION'
      });
    }

    // 3. Check if submissions are already in progress
    const existingSubmissions = await db.query(`
      SELECT COUNT(*) as count FROM directory_submissions
      WHERE user_id = $1 AND status IN ('queued', 'in_progress', 'submitted', 'pending_approval')
    `, [userId]);

    if (parseInt(existingSubmissions.rows[0].count) > 0) {
      return res.status(400).json({
        error: 'You already have submissions in progress',
        code: 'ALREADY_IN_PROGRESS'
      });
    }

    // 4. Get available directories (prioritized by priority_score, free ones first)
    const directories = await db.query(`
      SELECT id, name, website_url, directory_type, submission_url
      FROM directories
      WHERE is_active = true
        AND pricing_model IN ('free', 'freemium')
        AND id NOT IN (
          SELECT directory_id FROM directory_submissions
          WHERE user_id = $1 AND directory_id IS NOT NULL
        )
      ORDER BY priority_score DESC, tier ASC
      LIMIT $2
    `, [userId, availableSubmissions]);

    if (directories.rows.length === 0) {
      return res.status(400).json({
        error: 'No available directories to submit to',
        code: 'NO_DIRECTORIES'
      });
    }

    // 5. Create submission records
    const submissionValues = directories.rows.map((dir, index) => {
      return `($1, $2, $3, ${dir.id}, '${dir.name.replace(/'/g, "''")}', '${dir.website_url}', '${dir.directory_type}', 'queued', NOW())`;
    }).join(', ');

    await db.query(`
      INSERT INTO directory_submissions
        (order_id, user_id, business_profile_id, directory_id, directory_name, directory_url, directory_category, status, queued_at)
      VALUES ${directories.rows.map((dir, i) =>
        `($1, $2, $3, $${i * 4 + 4}, $${i * 4 + 5}, $${i * 4 + 6}, $${i * 4 + 7}, 'queued', NOW())`
      ).join(', ')}
    `, [
      orderId,
      userId,
      businessProfileId,
      ...directories.rows.flatMap(dir => [dir.id, dir.name, dir.website_url, dir.directory_type])
    ]);

    // 6. Update order status if applicable
    if (orderId) {
      await db.query(`
        UPDATE directory_orders
        SET status = 'in_progress', delivery_started_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `, [orderId]);
    }

    res.json({
      success: true,
      message: 'Directory submissions started',
      submissionsQueued: directories.rows.length,
      directories: directories.rows.map(d => ({
        id: d.id,
        name: d.name,
        type: d.directory_type
      }))
    });

  } catch (error) {
    console.error('Error starting submissions:', error);
    res.status(500).json({ error: 'Failed to start submissions' });
  }
});

/**
 * GET /api/citation-network/submission-progress
 * Get current submission progress
 */
router.get('/submission-progress', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued') as queued,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'submitted') as submitted,
        COUNT(*) FILTER (WHERE status = 'pending_approval') as pending_approval,
        COUNT(*) FILTER (WHERE status = 'live') as live,
        COUNT(*) FILTER (WHERE status = 'needs_action') as action_needed,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) as total
      FROM directory_submissions
      WHERE user_id = $1
    `, [req.user.id]);

    const stats = result.rows[0];

    res.json({
      total: parseInt(stats.total) || 0,
      queued: parseInt(stats.queued) || 0,
      inProgress: parseInt(stats.in_progress) || 0,
      submitted: parseInt(stats.submitted) + parseInt(stats.pending_approval) || 0,
      live: parseInt(stats.live) || 0,
      actionNeeded: parseInt(stats.action_needed) || 0,
      rejected: parseInt(stats.rejected) || 0
    });

  } catch (error) {
    console.error('Error fetching submission progress:', error);
    res.status(500).json({ error: 'Failed to fetch progress' });
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


// ============================================================================
// CAMPAIGN RUN ENDPOINTS
// ============================================================================

const campaignRunService = require('../services/campaignRunService');
const entitlementService = require('../services/entitlementService');

/**
 * POST /api/citation-network/start-submissions
 * Start a new submission campaign
 */
router.post('/start-submissions', authenticateToken, async (req, res) => {
  console.log('[Start Submissions] User ID:', req.user.id);
  console.log('[Start Submissions] User email:', req.user.email);

  try {
    const { filters = {} } = req.body;

    const result = await campaignRunService.startSubmissions(req.user.id, filters);

    res.json({
      success: true,
      message: `Started submissions for ${result.directoriesQueued} directories`,
      ...result
    });

  } catch (error) {
    console.error('Start submissions error:', error);

    // Handle specific errors
    if (error.message === 'PROFILE_REQUIRED') {
      return res.status(400).json({
        error: 'Please complete your business profile first',
        code: 'PROFILE_REQUIRED',
        redirect: '/dashboard.html?tab=citation-network&action=profile'
      });
    }

    if (error.message.startsWith('PROFILE_INCOMPLETE')) {
      const field = error.message.split(':')[1];
      return res.status(400).json({
        error: `Please complete your business profile. Missing: ${field}`,
        code: 'PROFILE_INCOMPLETE',
        missingField: field,
        redirect: '/dashboard.html?tab=citation-network&action=profile'
      });
    }

    if (error.message === 'ACTIVE_CAMPAIGN_EXISTS') {
      return res.status(400).json({
        error: 'You already have an active submission campaign. Please wait for it to complete or pause it first.',
        code: 'ACTIVE_CAMPAIGN_EXISTS'
      });
    }

    if (error.message === 'NO_ENTITLEMENT') {
      return res.status(400).json({
        error: 'No directory submissions available. Please upgrade your plan or purchase a boost.',
        code: 'NO_ENTITLEMENT',
        redirect: '/citation-network.html'
      });
    }

    if (error.message === 'NO_DIRECTORIES_AVAILABLE') {
      return res.status(400).json({
        error: 'No eligible directories found matching your criteria. Try adjusting your filters.',
        code: 'NO_DIRECTORIES_AVAILABLE'
      });
    }

    res.status(500).json({ error: 'Failed to start submissions' });
  }
});

/**
 * GET /api/citation-network/campaign-submissions
 * Get user's directory submissions (campaign-based)
 */
router.get('/campaign-submissions', authenticateToken, async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    const submissions = await campaignRunService.getUserSubmissions(req.user.id, {
      status: status ? status.split(',') : null,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({ submissions });

  } catch (error) {
    console.error('Get submissions error:', error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

/**
 * GET /api/citation-network/submissions/counts
 * Get submission counts by status
 */
router.get('/submissions/counts', authenticateToken, async (req, res) => {
  try {
    const counts = await campaignRunService.getSubmissionCounts(req.user.id);
    res.json({ counts });
  } catch (error) {
    console.error('Get counts error:', error);
    res.status(500).json({ error: 'Failed to fetch counts' });
  }
});

/**
 * GET /api/citation-network/campaign-runs
 * Get user's campaign runs
 */
router.get('/campaign-runs', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    const campaignRuns = await campaignRunService.getCampaignRuns(req.user.id, {
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({ campaignRuns });
  } catch (error) {
    console.error('Get campaign runs error:', error);
    res.status(500).json({ error: 'Failed to fetch campaign runs' });
  }
});

/**
 * GET /api/citation-network/campaign-runs/:id
 * Get specific campaign run with submissions
 */
router.get('/campaign-runs/:id', authenticateToken, async (req, res) => {
  try {
    const campaignRun = await campaignRunService.getCampaignRun(
      req.params.id,
      req.user.id
    );

    if (!campaignRun) {
      return res.status(404).json({ error: 'Campaign run not found' });
    }

    res.json({ campaignRun });
  } catch (error) {
    console.error('Get campaign run error:', error);
    res.status(500).json({ error: 'Failed to fetch campaign run' });
  }
});

/**
 * POST /api/citation-network/campaign-runs/:id/pause
 * Pause a campaign run
 */
router.post('/campaign-runs/:id/pause', authenticateToken, async (req, res) => {
  try {
    const result = await campaignRunService.pauseCampaign(req.params.id, req.user.id);

    if (!result) {
      return res.status(404).json({ error: 'Campaign not found or cannot be paused' });
    }

    res.json({ success: true, campaignRun: result });
  } catch (error) {
    console.error('Pause campaign error:', error);
    res.status(500).json({ error: 'Failed to pause campaign' });
  }
});

/**
 * POST /api/citation-network/campaign-runs/:id/resume
 * Resume a paused campaign
 */
router.post('/campaign-runs/:id/resume', authenticateToken, async (req, res) => {
  try {
    const result = await campaignRunService.resumeCampaign(req.params.id, req.user.id);

    if (!result) {
      return res.status(404).json({ error: 'Campaign not found or cannot be resumed' });
    }

    res.json({ success: true, campaignRun: result });
  } catch (error) {
    console.error('Resume campaign error:', error);
    res.status(500).json({ error: 'Failed to resume campaign' });
  }
});

/**
 * POST /api/citation-network/campaign-runs/:id/cancel
 * Cancel a campaign run
 */
router.post('/campaign-runs/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const result = await campaignRunService.cancelCampaign(req.params.id, req.user.id);

    if (!result) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({ success: true, campaignRun: result });
  } catch (error) {
    console.error('Cancel campaign error:', error);
    res.status(500).json({ error: 'Failed to cancel campaign' });
  }
});

/**
 * GET /api/citation-network/entitlement
 * Get user's current entitlement
 */
router.get('/entitlement', authenticateToken, async (req, res) => {
  try {
    const entitlement = await entitlementService.calculateEntitlement(req.user.id);
    res.json({ entitlement });
  } catch (error) {
    console.error('Get entitlement error:', error);
    res.status(500).json({ error: 'Failed to fetch entitlement' });
  }
});

/**
 * GET /api/citation-network/active-campaign
 * Check if user has an active campaign
 */
router.get('/active-campaign', authenticateToken, async (req, res) => {
  try {
    const activeCampaign = await campaignRunService.getActiveCampaign(req.user.id);
    res.json({
      hasActiveCampaign: !!activeCampaign,
      activeCampaign
    });
  } catch (error) {
    console.error('Get active campaign error:', error);
    res.status(500).json({ error: 'Failed to check active campaign' });
  }
});

/**
 * GET /api/citation-network/directories
 * Get available directories (for preview/filtering)
 */
router.get('/directories', authenticateToken, async (req, res) => {
  try {
    const { type, tier, region, limit = 50 } = req.query;

    let query = `
      SELECT
        id, name, slug, website_url, logo_url, description,
        directory_type, tier, region_scope, priority_score,
        submission_mode, verification_method, approval_type,
        typical_approval_days, pricing_model
      FROM directories
      WHERE is_active = true AND pricing_model IN ('free', 'freemium')
    `;

    const params = [];
    let paramIndex = 1;

    if (type) {
      query += ` AND directory_type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (tier) {
      query += ` AND tier = $${paramIndex}`;
      params.push(parseInt(tier));
      paramIndex++;
    }

    if (region) {
      query += ` AND region_scope = $${paramIndex}`;
      params.push(region);
      paramIndex++;
    }

    query += ` ORDER BY priority_score DESC, tier ASC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const result = await db.query(query, params);
    res.json({ directories: result.rows });

  } catch (error) {
    console.error('Get directories error:', error);
    res.status(500).json({ error: 'Failed to fetch directories' });
  }
});

/**
 * GET /api/citation-network/directories/count
 * Get count of available directories by filters
 */
router.get('/directories/count', authenticateToken, async (req, res) => {
  try {
    const { types, tiers, regions, exclude_customer_owned } = req.query;

    let query = `
      SELECT COUNT(*) as count
      FROM directories d
      WHERE d.is_active = true
        AND d.pricing_model IN ('free', 'freemium')
    `;

    const params = [];
    let paramIndex = 1;

    if (types) {
      const typeArray = types.split(',');
      query += ` AND d.directory_type = ANY($${paramIndex})`;
      params.push(typeArray);
      paramIndex++;
    }

    if (tiers) {
      const tierArray = tiers.split(',').map(t => parseInt(t));
      query += ` AND d.tier = ANY($${paramIndex})`;
      params.push(tierArray);
      paramIndex++;
    }

    if (regions) {
      const regionArray = [...new Set(['global', ...regions.split(',')])];
      query += ` AND d.region_scope = ANY($${paramIndex})`;
      params.push(regionArray);
      paramIndex++;
    }

    if (exclude_customer_owned === 'true') {
      query += ` AND d.requires_customer_account = false`;
    }

    // Exclude already submitted
    query += ` AND NOT EXISTS (
      SELECT 1 FROM directory_submissions ds
      WHERE ds.directory_id = d.id
        AND ds.user_id = $${paramIndex}
        AND ds.status NOT IN ('failed', 'skipped', 'cancelled', 'blocked')
    )`;
    params.push(req.user.id);

    const result = await db.query(query, params);
    res.json({ count: parseInt(result.rows[0]?.count) || 0 });

  } catch (error) {
    console.error('Get directories count error:', error);
    res.status(500).json({ error: 'Failed to count directories' });
  }
});

module.exports = router;
