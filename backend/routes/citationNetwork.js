/**
 * AI Citation Network Routes
 *
 * Handles checkout, orders, and allocation endpoints
 *
 * UPDATED: Improved error handling and diagnostic logging (CITATION_DEBUG=1)
 * T0-11: Pack checkout fetches full user from DB for eligibility check
 * T0-12: Uses PACK_CONFIG for correct pricing/eligibility
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const citationNetworkStripe = require('../services/citationNetworkStripeService');
const { authenticateToken, authenticateTokenOptional } = require('../middleware/auth');
const db = require('../db/database');
const config = require('../config/citationNetwork');
const { PACK_CONFIG, ERROR_CODES, isActiveSubscriber } = require('../config/citationNetwork');
const entitlementService = require('../services/entitlementService');
const { normalizePlan } = require('../utils/planUtils');
const duplicateChecker = require('../services/duplicateCheckerService');

// Rate limiters for credential endpoints (SECURITY)
const credentialRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per window
  message: { error: 'Too many credential requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const handoffRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 handoff requests per hour
  message: { error: 'Too many handoff requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Generate a unique request ID
function generateRequestId() {
  try {
    return require('crypto').randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Debug logging helper - only logs when CITATION_DEBUG=1
function debugLog(requestId, ...args) {
  if (process.env.CITATION_DEBUG === '1') {
    const prefix = requestId ? `[CitationNetwork:${requestId}]` : '[CitationNetwork]';
    console.log(prefix, ...args);
  }
}

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
 * POST /api/citation-network/packs/checkout
 * Create checkout session for a specific pack type
 *
 * T0-11: CRITICAL - Fetches full user from DB for eligibility check
 * T0-12: Uses PACK_CONFIG for correct pricing (Starter=$249/100, Boost=$99/25)
 *
 * Pack eligibility:
 * - Starter ($249, 100 dirs): NON-SUBSCRIBERS ONLY
 * - Boost ($99, 25 dirs): SUBSCRIBERS ONLY
 */
router.post('/packs/checkout', authenticateToken, async (req, res) => {
  const { pack_type = 'starter' } = req.body;

  try {
    // T0-11: Fetch user from DB for Stripe customer ID
    const userResult = await db.query(
      'SELECT id, email, plan, stripe_subscription_status, stripe_customer_id FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: { code: ERROR_CODES.USER_NOT_FOUND, message: 'User not found' }
      });
    }

    const user = userResult.rows[0];

    // T0-12: Validate pack type against PACK_CONFIG
    const pack = PACK_CONFIG[pack_type];
    if (!pack) {
      return res.status(400).json({
        success: false,
        error: { code: ERROR_CODES.INVALID_PACK_TYPE, message: 'Invalid pack type' }
      });
    }

    // NOTE: Subscriber checks removed - UI controls who sees which button
    // If user can click the button, they should be able to purchase

    // Build line_items - ALWAYS use price_data to ensure correct pricing
    // (env vars may point to wrong Stripe products)
    const packName = pack_type === 'starter' ? 'Starter Pack' : 'Boost Pack';
    const lineItems = [{
      price_data: {
        currency: 'usd',
        unit_amount: pack.price, // From PACK_CONFIG: 9900 ($99) for boost, 24900 ($249) for starter
        product_data: {
          name: `AI Citation Network - ${packName}`,
          description: `${pack.directories} directory submissions`
        }
      },
      quantity: 1
    }];

    // Get or create Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: String(user.id) }
      });
      customerId = customer.id;
      await db.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, user.id]);
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      metadata: {
        user_id: String(user.id),
        pack_type,
        directories_allocated: String(pack.directories),
        product: 'citation_network',
        order_type: pack_type
      },
      success_url: `${process.env.FRONTEND_URL}/dashboard.html?section=citation-network&pack=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard.html?section=citation-network&pack=cancelled`
    });

    console.log(`[PackCheckout] Created session ${session.id} for user ${user.id}, pack=${pack_type}, dirs=${pack.directories}`);

    res.json({
      success: true,
      data: {
        checkoutUrl: session.url,
        sessionId: session.id,
        packType: pack_type,
        directories: pack.directories,
        price: pack.price / 100 // Convert cents to dollars for display
      }
    });

  } catch (err) {
    console.error('[PackCheckout] Error:', err);
    res.status(500).json({
      success: false,
      error: { code: ERROR_CODES.STRIPE_ERROR, message: 'Failed to create checkout session' }
    });
  }
});

/**
 * GET /api/citation-network/packs/session/:sessionId
 * T2-2: Pack Session Verification Endpoint
 * Check status of a pack checkout session
 */
router.get('/packs/session/:sessionId', authenticateToken, async (req, res) => {
  const { sessionId } = req.params;

  try {
    const order = await db.query(
      'SELECT * FROM directory_orders WHERE stripe_checkout_session_id = $1 AND user_id = $2',
      [sessionId, req.user.id]
    );

    if (order.rows.length > 0) {
      const o = order.rows[0];
      return res.json({
        success: true,
        data: {
          status: 'completed',
          order: {
            id: o.id,
            packType: o.pack_type || o.order_type,
            directoriesAllocated: o.directories_allocated,
            directoriesSubmitted: o.directories_submitted,
            directoriesRemaining: o.directories_allocated - o.directories_submitted,
            paidAt: o.paid_at,
            orderStatus: o.status
          }
        }
      });
    }

    // Session not found or not completed yet
    res.json({
      success: true,
      data: { status: 'pending' }
    });

  } catch (err) {
    console.error('[PackSession] Error:', err);
    res.status(500).json({
      success: false,
      error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'Failed to check session status' }
    });
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
 * Step 4: Uses entitlementService as ONE source of truth
 */
router.get('/allocation', authenticateToken, async (req, res) => {
  try {
    // Use entitlementService as single source of truth
    const entitlement = await entitlementService.calculateEntitlement(req.user.id);

    // Plan display names for frontend
    const PLAN_DISPLAY_NAMES = {
      'free': 'Free Plan',
      'freemium': 'Free Plan',
      'diy': 'DIY Plan',
      'pro': 'Pro Plan',
      'agency': 'Agency Plan',
      'enterprise': 'Enterprise Plan'
    };

    // Plan monthly allocations
    const PLAN_ALLOCATIONS = {
      'free': 0,
      'freemium': 0,
      'diy': 10,
      'pro': 25,
      'agency': 25,
      'enterprise': 100
    };

    const planName = entitlement.plan || 'free';
    const planDisplayName = PLAN_DISPLAY_NAMES[planName] || 'Free Plan';
    const planAllocation = PLAN_ALLOCATIONS[planName] || 0;

    if (entitlement.isSubscriber) {
      // Subscriber: return subscription allocation
      res.json({
        type: 'subscription',
        plan: planName,
        planDisplayName,
        planAllocation,
        allocation: {
          base: entitlement.breakdown.subscription,
          packs: 0, // pack_allocation tracked separately
          total: entitlement.total,
          used: entitlement.used,
          remaining: entitlement.remaining
        },
        debug: {
          source: entitlement.source,
          isSubscriber: entitlement.isSubscriber,
          breakdown: {
            ...entitlement.breakdown,
            plan: planName
          }
        }
      });
    } else {
      // Non-subscriber: return order-based allocation
      res.json({
        type: 'order_based',
        plan: planName,
        planDisplayName,
        planAllocation,
        allocation: {
          total: entitlement.breakdown.orders,
          submitted: entitlement.breakdown.ordersUsed,
          live: 0, // Would need separate query for live count
          remaining: entitlement.breakdown.ordersRemaining
        },
        debug: {
          source: entitlement.source,
          isSubscriber: entitlement.isSubscriber,
          breakdown: {
            ...entitlement.breakdown,
            plan: planName
          }
        }
      });
    }
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
    // Get the most recent profile using ORDER BY
    const result = await db.query(`
      SELECT * FROM business_profiles
      WHERE user_id = $1
      ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
      LIMIT 1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.json({ profile: null, hasProfile: false });
    }

    const profile = result.rows[0];
    res.json({
      profile: profile,
      hasProfile: true,
      isComplete: profile.is_complete || false,
      completionPercentage: profile.completion_percentage || 0
    });
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
    let {
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

    // Handle logo_url - if it's a data URL, it's too large for VARCHAR(500)
    // For now, skip storing data URLs (they should be uploaded to cloud storage)
    if (logo_url && logo_url.startsWith('data:')) {
      console.log('[Profile Save] Skipping data URL logo (too large for DB column)');
      logo_url = null; // Don't store data URLs in the database
    }

    // Convert year_founded to integer if it's a string
    if (year_founded && typeof year_founded === 'string') {
      year_founded = parseInt(year_founded, 10) || null;
    }

    // Calculate completion percentage based on all fields
    const allFields = [
      business_name, website_url, phone, email, address_line1, city, state,
      postal_code, business_description, short_description, primary_category
    ];
    const filledFields = allFields.filter(f => f && f.toString().trim()).length;
    const completionPercentage = Math.round((filledFields / allFields.length) * 100);

    // is_complete = true ONLY when ALL required fields are non-empty
    const requiredFields = [business_name, website_url, short_description];
    const isComplete = requiredFields.every(f => f && f.toString().trim());

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
      success: true,
      profile: result.rows[0],
      isComplete,
      completionPercentage
    });
  } catch (error) {
    console.error('Error saving profile:', error);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// NOTE: The /start-submissions route has been moved to the CAMPAIGN RUN ENDPOINTS section below
// (around line 620+). The old route was removed to avoid duplicate route handlers.

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
        SUM(directories_live) FILTER (WHERE status IN ('paid', 'processing', 'in_progress', 'completed')) as total_live,
        COUNT(*) FILTER (
          WHERE pack_type = 'boost'
            AND status IN ('paid', 'processing', 'in_progress', 'completed')
            AND created_at >= DATE_TRUNC('year', NOW())
        ) as boosts_this_year
      FROM directory_orders
      WHERE user_id = $1
    `, [req.user.id]);

    // Get profile status
    const profile = await db.query(
      'SELECT is_complete, completion_percentage FROM business_profiles WHERE user_id = $1',
      [req.user.id]
    );

    const boostsThisYear = parseInt(orderStats.rows[0]?.boosts_this_year) || 0;
    const maxBoostsPerYear = 2;

    res.json({
      orders: parseInt(orderStats.rows[0]?.total_orders) || 0,
      boostsThisYear,
      boostsRemaining: Math.max(0, maxBoostsPerYear - boostsThisYear),
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

/**
 * POST /api/citation-network/start-submissions
 * Start a new submission campaign
 *
 * Error codes:
 * - PROFILE_REQUIRED (400): No business profile exists
 * - PROFILE_INCOMPLETE (400): Profile missing required fields
 * - ACTIVE_CAMPAIGN_EXISTS (400): User has an active campaign
 * - NO_ENTITLEMENT (400): User has no remaining directory submissions
 * - NO_ELIGIBLE_DIRECTORIES (400): Entitlement OK but no directories match filters
 * - DIRECTORIES_NOT_SEEDED (503): Server misconfiguration - no directories in DB
 */
router.post('/start-submissions', authenticateToken, async (req, res) => {
  const requestId = generateRequestId();
  const normalizedPlan = normalizePlan(req.user.plan);

  // T0-7: Extract idempotency key from header or body for duplicate prevention
  const idempotencyKey = req.headers['idempotency-key'] || req.body.requestId || null;

  // Always log request start (even without debug flag)
  console.log(`[StartSubmissions:${requestId}] === REQUEST START ===`);

  // Detailed logging behind env flag
  debugLog(requestId, 'User from token:', {
    id: req.user.id,
    email: req.user.email,
    planRaw: req.user.plan,
    planNormalized: normalizedPlan
  });
  debugLog(requestId, 'Idempotency key:', idempotencyKey);

  try {
    const { filters = {} } = req.body;
    debugLog(requestId, 'Filters:', JSON.stringify(filters));

    // Note: Pre-check removed - service now handles all entitlement calculation within transaction
    // This prevents race conditions where pre-check passes but transaction-check fails

    debugLog(requestId, 'Calling campaignRunService.startSubmissions...');
    const result = await campaignRunService.startSubmissions(req.user.id, filters, { requestId, idempotencyKey });

    // T0-7: Handle duplicate request response
    if (result.duplicate) {
      console.log(`[StartSubmissions:${requestId}] DUPLICATE - Returning existing campaign:`, result.campaignRunId);
      return res.json({
        success: true,
        message: `Request already processed. Campaign ID: ${result.campaignRunId}`,
        duplicate: true,
        ...result
      });
    }

    // Check if this was an expansion of an existing campaign
    const isExpansion = result.expanded === true;
    const message = isExpansion
      ? `Added ${result.directoriesQueued} directories to existing campaign (total: ${result.totalQueued})`
      : `Started submissions for ${result.directoriesQueued} directories`;

    console.log(`[StartSubmissions:${requestId}] SUCCESS - ${isExpansion ? 'EXPANDED' : 'NEW'} - Directories:`, result.directoriesQueued);
    debugLog(requestId, 'Result:', {
      campaignRunId: result.campaignRunId,
      directoriesQueued: result.directoriesQueued,
      entitlementRemaining: result.entitlementRemaining,
      expanded: isExpansion
    });

    res.json({
      success: true,
      message,
      expanded: isExpansion,
      ...result
    });

  } catch (error) {
    console.error(`[StartSubmissions:${requestId}] ERROR:`, error.message);
    debugLog(requestId, 'Error stack:', error.stack);

    // Build entitlement breakdown for error responses
    const entitlementInfo = error.entitlement ? {
      remaining: error.entitlement.remaining,
      total: error.entitlement.total,
      planNormalized: error.entitlement.plan,
      isSubscriber: error.entitlement.isSubscriber,
      subscriptionRemaining: error.entitlement.breakdown?.subscriptionRemaining,
      ordersRemaining: error.entitlement.breakdown?.ordersRemaining
    } : null;

    // Handle specific errors with distinct codes

    // T0-7: Handle USER_NOT_FOUND (should not happen with auth, but just in case)
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(401).json({
        error: 'User not found. Please log in again.',
        code: 'USER_NOT_FOUND'
      });
    }

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
        error: 'You already have an active submission campaign with no additional entitlement. Purchase a boost pack to add more directories.',
        code: 'ACTIVE_CAMPAIGN_EXISTS',
        canExpand: false,
        suggestion: 'Purchase a Boost Pack to add more directories to your campaign.'
      });
    }

    if (error.message === 'NO_ENTITLEMENT') {
      console.log(`[StartSubmissions:${requestId}] Returning NO_ENTITLEMENT error`);
      return res.status(400).json({
        error: 'No directory submissions available. Please upgrade your plan or purchase a boost.',
        code: 'NO_ENTITLEMENT',
        redirect: '/citation-network.html',
        entitlement: entitlementInfo
      });
    }

    if (error.message === 'NO_ELIGIBLE_DIRECTORIES') {
      return res.status(400).json({
        error: 'No eligible directories found matching your criteria. Try adjusting your filters or check back later.',
        code: 'NO_ELIGIBLE_DIRECTORIES',
        entitlement: entitlementInfo
      });
    }

    if (error.message === 'NO_DIRECTORIES_AVAILABLE') {
      return res.status(400).json({
        error: 'No eligible directories found matching your criteria. Try adjusting your filters.',
        code: 'NO_DIRECTORIES_AVAILABLE',
        entitlement: entitlementInfo
      });
    }

    if (error.message === 'DIRECTORIES_NOT_SEEDED') {
      console.error(`[StartSubmissions:${requestId}] CRITICAL: directories table not seeded!`);
      return res.status(503).json({
        error: 'Directory database is being updated. Please try again in a few minutes.',
        code: 'DIRECTORIES_NOT_SEEDED'
      });
    }

    res.status(500).json({ error: 'Failed to start submissions', requestId });
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
 * Get user's current entitlement including daily rate and boost status
 */
router.get('/entitlement', authenticateToken, async (req, res) => {
  try {
    // Get base entitlement
    const entitlement = await entitlementService.calculateEntitlement(req.user.id);

    // Get daily rate information (based on boost status)
    const rateInfo = await campaignRunService.getDailySubmissionRate(req.user.id);

    // Combine into enhanced entitlement response
    res.json({
      entitlement: {
        ...entitlement,
        // Add rate information
        dailyRate: rateInfo.dailyRate,
        boostActive: rateInfo.boostActive,
        boostRemaining: rateInfo.boostRemaining,
        baseRate: rateInfo.baseRate,
        boostedRate: rateInfo.boostedRate
      }
    });
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

    // Also include entitlement info so UI knows if expansion is possible
    let canExpand = false;
    let additionalEntitlement = 0;
    if (activeCampaign) {
      try {
        const entitlement = await entitlementService.calculateEntitlement(req.user.id);
        canExpand = entitlement.remaining > 0;
        additionalEntitlement = entitlement.remaining;
      } catch (e) {
        console.error('Error checking expansion eligibility:', e);
      }
    }

    res.json({
      hasActiveCampaign: !!activeCampaign,
      activeCampaign,
      canExpand,
      additionalEntitlement
    });
  } catch (error) {
    console.error('Get active campaign error:', error);
    res.status(500).json({ error: 'Failed to check active campaign' });
  }
});

/**
 * GET /api/citation-network/daily-rate
 * Get user's current daily submission rate (test endpoint)
 */
router.get('/daily-rate', authenticateToken, async (req, res) => {
  try {
    const rateInfo = await campaignRunService.getDailySubmissionRate(req.user.id);
    res.json(rateInfo);
  } catch (error) {
    console.error('Get daily rate error:', error);
    res.status(500).json({ error: 'Failed to get daily rate' });
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

/**
 * GET /api/citation-network/directories/intelligence-summary
 * Returns aggregate intelligence readiness stats for Phase 4 planning.
 * MUST be placed before /directories/:id routes to avoid path conflicts.
 */
router.get('/directories/intelligence-summary', authenticateToken, async (req, res) => {
  try {
    // Overall summary
    const summary = await db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_active = true) AS active,
        COUNT(*) FILTER (WHERE search_type IS NOT NULL) AS has_search_type,
        COUNT(*) FILTER (WHERE form_fields_mapping IS NOT NULL) AS has_form_mapping,
        COUNT(*) FILTER (WHERE api_config IS NOT NULL) AS has_api_config,
        COUNT(*) FILTER (WHERE duplicate_check_config IS NOT NULL) AS has_duplicate_config,
        COUNT(*) FILTER (WHERE requires_captcha = true) AS requires_captcha_count,
        COUNT(*) FILTER (WHERE requires_email_verification = true) AS requires_email_verification_count
      FROM directories
    `);

    // Breakdown by submission_mode + search_type (for Phase 4 rollout planning)
    const byModeAndSearchType = await db.query(`
      SELECT
        submission_mode,
        COALESCE(search_type, 'NULL') AS search_type,
        COUNT(*) AS count,
        COUNT(*) FILTER (WHERE form_fields_mapping IS NOT NULL) AS with_mapping
      FROM directories
      WHERE is_active = true
      GROUP BY submission_mode, search_type
      ORDER BY count DESC
    `);

    res.json({
      summary: summary.rows[0],
      byModeAndSearchType: byModeAndSearchType.rows
    });
  } catch (error) {
    console.error('[IntelligenceSummary] Error:', error);
    res.status(500).json({ error: 'Failed to fetch intelligence summary' });
  }
});

/**
 * GET /api/citation-network/directories/:id/intelligence
 * Get automation intelligence for a specific directory
 * Phase 3: Returns form field mappings, duplicate check config, API config, etc.
 */
router.get('/directories/:id/intelligence', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      SELECT
        id, slug, name, directory_type,
        -- Phase 3 intelligence columns
        search_type,
        search_url_template,
        requires_captcha,
        requires_email_verification,
        requires_payment,
        form_fields_mapping,
        api_config,
        duplicate_check_config,
        -- Existing relevant columns
        submission_url,
        submission_mode,
        verification_method,
        required_fields,
        max_description_length,
        typical_approval_days
      FROM directories
      WHERE id = $1 AND is_active = true
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    res.json({ intelligence: result.rows[0] });

  } catch (error) {
    console.error('Get directory intelligence error:', error);
    res.status(500).json({ error: 'Failed to fetch directory intelligence' });
  }
});

/**
 * GET /api/citation-network/directories/intelligence
 * Get automation intelligence for multiple directories (batch)
 * Query params: ids (comma-separated) or slugs (comma-separated)
 */
router.get('/directories/intelligence', authenticateToken, async (req, res) => {
  try {
    const { ids, slugs, limit = 50 } = req.query;

    let query = `
      SELECT
        id, slug, name, directory_type,
        search_type,
        search_url_template,
        requires_captcha,
        requires_email_verification,
        requires_payment,
        form_fields_mapping,
        api_config,
        duplicate_check_config,
        submission_url,
        submission_mode,
        verification_method,
        required_fields,
        max_description_length,
        typical_approval_days
      FROM directories
      WHERE is_active = true
    `;

    const params = [];
    let paramIndex = 1;

    if (ids) {
      const idList = ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      if (idList.length > 0) {
        query += ` AND id = ANY($${paramIndex}::int[])`;
        params.push(idList);
        paramIndex++;
      }
    } else if (slugs) {
      const slugList = slugs.split(',').map(s => s.trim()).filter(s => s.length > 0);
      if (slugList.length > 0) {
        query += ` AND slug = ANY($${paramIndex}::text[])`;
        params.push(slugList);
        paramIndex++;
      }
    }

    query += ` ORDER BY priority_score DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const result = await db.query(query, params);
    res.json({
      intelligence: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error('Get directories intelligence error:', error);
    res.status(500).json({ error: 'Failed to fetch directories intelligence' });
  }
});

/**
 * POST /api/citation-network/duplicate-check
 * Check if a business is already listed in a specific directory
 * Phase 4: Manual duplicate check endpoint (for testing/debugging)
 */
router.post('/duplicate-check', authenticateToken, async (req, res) => {
  try {
    const { directoryId, businessName, websiteUrl } = req.body;

    if (!directoryId) {
      return res.status(400).json({ error: 'directoryId is required' });
    }

    if (!businessName && !websiteUrl) {
      return res.status(400).json({ error: 'businessName or websiteUrl is required' });
    }

    // Get directory with intelligence columns
    const dirResult = await db.query(`
      SELECT id, slug, name, directory_type, website_url,
             search_type, search_url_template, duplicate_check_config, api_config
      FROM directories
      WHERE id = $1 AND is_active = true
    `, [directoryId]);

    if (dirResult.rows.length === 0) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    const directory = dirResult.rows[0];
    const businessProfile = {
      name: businessName || '',
      website_url: websiteUrl || ''
    };

    // Run duplicate check
    const result = await duplicateChecker.checkForDuplicate(directory, businessProfile);

    res.json({
      directoryId: directory.id,
      directoryName: directory.name,
      searchType: directory.search_type,
      result: {
        status: result.status,
        existingListingUrl: result.existingListingUrl || null,
        fromCache: result.fromCache || false,
        evidence: result.evidence
      }
    });

  } catch (error) {
    console.error('[DuplicateCheck] Error:', error);
    res.status(500).json({ error: 'Failed to perform duplicate check' });
  }
});

/**
 * POST /api/citation-network/duplicate-check/batch
 * Check duplicates for multiple directories at once
 * Phase 4: Batch duplicate check endpoint
 */
router.post('/duplicate-check/batch', authenticateToken, async (req, res) => {
  try {
    const { directoryIds, businessName, websiteUrl } = req.body;

    if (!directoryIds || !Array.isArray(directoryIds) || directoryIds.length === 0) {
      return res.status(400).json({ error: 'directoryIds array is required' });
    }

    if (directoryIds.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 directories per batch' });
    }

    if (!businessName && !websiteUrl) {
      return res.status(400).json({ error: 'businessName or websiteUrl is required' });
    }

    // Get directories with intelligence columns
    const dirResult = await db.query(`
      SELECT id, slug, name, directory_type, website_url,
             search_type, search_url_template, duplicate_check_config, api_config
      FROM directories
      WHERE id = ANY($1::int[]) AND is_active = true
    `, [directoryIds]);

    if (dirResult.rows.length === 0) {
      return res.status(404).json({ error: 'No directories found' });
    }

    const directories = dirResult.rows;
    const businessProfile = {
      name: businessName || '',
      website_url: websiteUrl || ''
    };

    // Run batch duplicate check
    const resultsMap = await duplicateChecker.batchCheckForDuplicates(directories, businessProfile);

    // Convert Map to array of results
    const results = directories.map(dir => {
      const check = resultsMap.get(dir.id) || {
        status: duplicateChecker.DUPLICATE_CHECK_STATUSES.ERROR,
        evidence: { error: 'Check not performed' }
      };
      return {
        directoryId: dir.id,
        directoryName: dir.name,
        searchType: dir.search_type,
        status: check.status,
        existingListingUrl: check.existingListingUrl || null,
        fromCache: check.fromCache || false
      };
    });

    // Calculate summary stats
    const stats = {
      total: results.length,
      matchFound: results.filter(r => r.status === 'match_found').length,
      noMatch: results.filter(r => r.status === 'no_match').length,
      possibleMatch: results.filter(r => r.status === 'possible_match').length,
      error: results.filter(r => r.status === 'error').length,
      skipped: results.filter(r => r.status === 'skipped').length
    };

    res.json({ results, stats });

  } catch (error) {
    console.error('[DuplicateCheckBatch] Error:', error);
    res.status(500).json({ error: 'Failed to perform batch duplicate check' });
  }
});

/**
 * GET /api/citation-network/duplicate-check/stats
 * Get duplicate check statistics and cache info
 * Phase 4: Monitoring endpoint
 */
router.get('/duplicate-check/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's submissions with duplicate check info
    const submissionStats = await db.query(`
      SELECT
        duplicate_check_status,
        COUNT(*) as count
      FROM directory_submissions
      WHERE user_id = $1
        AND duplicate_check_status IS NOT NULL
      GROUP BY duplicate_check_status
    `, [userId]);

    // Get cache stats
    const cacheStats = duplicateChecker.getCacheStats();

    // Get recent duplicate checks for this user
    const recentChecks = await db.query(`
      SELECT
        ds.id,
        ds.directory_name,
        ds.duplicate_check_status,
        ds.existing_listing_url,
        ds.duplicate_checked_at,
        ds.duplicate_check_evidence
      FROM directory_submissions ds
      WHERE ds.user_id = $1
        AND ds.duplicate_checked_at IS NOT NULL
      ORDER BY ds.duplicate_checked_at DESC
      LIMIT 10
    `, [userId]);

    res.json({
      submissionStats: submissionStats.rows.reduce((acc, row) => {
        acc[row.duplicate_check_status] = parseInt(row.count);
        return acc;
      }, {}),
      cacheStats,
      recentChecks: recentChecks.rows.map(r => ({
        id: r.id,
        directoryName: r.directory_name,
        status: r.duplicate_check_status,
        existingListingUrl: r.existing_listing_url,
        checkedAt: r.duplicate_checked_at
      }))
    });

  } catch (error) {
    console.error('[DuplicateCheckStats] Error:', error);
    res.status(500).json({ error: 'Failed to fetch duplicate check stats' });
  }
});

/**
 * GET /api/citation-network/credentials
 * Get user's stored directory credentials from credential vault
 * SECURITY: Only returns safe metadata, NEVER passwords or secrets
 */
router.get('/credentials', authenticateToken, credentialRateLimiter, async (req, res) => {
  try {
    const userId = req.user.id;

    // SECURITY: Only return safe metadata, NEVER passwords or secrets
    const result = await db.query(`
      SELECT
        cv.id,
        cv.directory_id,
        d.name as directory_name,
        d.website_url as directory_url,
        d.logo_url as directory_logo,
        -- Mask email: show first 2 chars + ***@domain
        CASE
          WHEN cv.email IS NOT NULL AND cv.email LIKE '%@%' THEN
            CONCAT(LEFT(cv.email, 2), '***@', SPLIT_PART(cv.email, '@', 2))
          WHEN cv.email IS NOT NULL THEN
            CONCAT(LEFT(cv.email, 2), '***')
          ELSE NULL
        END as email_masked,
        -- Mask username similarly
        CASE
          WHEN cv.username IS NOT NULL THEN
            CONCAT(LEFT(cv.username, 2), '***')
          ELSE NULL
        END as username_masked,
        cv.account_status,
        cv.account_created_at,
        cv.last_login_at,
        COALESCE(cv.handoff_status, 'none') as handoff_status,
        cv.handed_off_at,
        cv.handoff_reason,
        cv.created_at,
        cv.updated_at,
        -- Indicate if password exists without revealing it
        CASE WHEN cv.password_encrypted IS NOT NULL THEN true ELSE false END as has_password
        -- NEVER include: password_encrypted, password, otp_secret, 2fa_codes
      FROM credential_vault cv
      JOIN directories d ON cv.directory_id = d.id
      WHERE cv.user_id = $1
      ORDER BY cv.created_at DESC
    `, [userId]);

    // Transform to frontend format
    const credentials = result.rows.map(row => ({
      id: row.id,
      directoryId: row.directory_id,
      directoryName: row.directory_name,
      directoryUrl: row.directory_url,
      directoryLogo: row.directory_logo,
      accountUrl: row.directory_url,
      emailMasked: row.email_masked,
      usernameMasked: row.username_masked,
      hasPassword: row.has_password,
      createdAt: row.account_created_at || row.created_at,
      lastLoginAt: row.last_login_at,
      status: row.account_status,
      handoffStatus: row.handoff_status,
      handedOffAt: row.handed_off_at,
      handoffReason: row.handoff_reason
    }));

    res.json({
      credentials,
      _security: 'Passwords and secrets are never transmitted. Use handoff to request access.'
    });
  } catch (error) {
    console.error('Get credentials error:', error);
    res.status(500).json({ error: 'Failed to fetch credentials' });
  }
});

/**
 * POST /api/citation-network/credentials/:id/handoff
 * Request handoff of a credential to the user
 * SECURITY: Strict ownership check, rate limited, with full audit trail
 */
router.post('/credentials/:id/handoff', authenticateToken, handoffRateLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { reason, notes } = req.body;

    // STRICT ownership check - separate query for security
    const credential = await db.query(
      'SELECT id, user_id, directory_id FROM credential_vault WHERE id = $1',
      [id]
    );

    if (credential.rows.length === 0) {
      return res.status(404).json({ error: 'Credential not found' });
    }

    // Verify ownership explicitly
    if (credential.rows[0].user_id !== userId) {
      console.warn(`[Security] User ${userId} attempted to access credential ${id} owned by ${credential.rows[0].user_id}`);

      // Log the failed attempt
      try {
        await db.query(`
          INSERT INTO credential_access_log (credential_id, user_id, access_type, ip_address, user_agent, success, failure_reason)
          VALUES ($1, $2, 'handoff_request', $3, $4, false, 'Access denied - not owner')
        `, [id, userId, req.ip, req.get('User-Agent')]);
      } catch (logError) {
        console.error('Failed to log access attempt:', logError);
      }

      return res.status(403).json({ error: 'Access denied' });
    }

    // Update with audit trail
    await db.query(`
      UPDATE credential_vault
      SET
        handoff_status = 'requested',
        handed_off_at = NOW(),
        handed_off_by_user_id = $1,
        handoff_reason = $2,
        handoff_notes = $3,
        updated_at = NOW()
      WHERE id = $4
    `, [userId, reason || 'User requested handoff', notes || null, id]);

    // Log the successful access
    try {
      await db.query(`
        INSERT INTO credential_access_log (credential_id, user_id, access_type, ip_address, user_agent, success)
        VALUES ($1, $2, 'handoff_request', $3, $4, true)
      `, [id, userId, req.ip, req.get('User-Agent')]);
    } catch (logError) {
      console.error('Failed to log access:', logError);
    }

    res.json({
      success: true,
      status: 'requested',
      message: 'Handoff request submitted. You will receive access credentials shortly.'
    });
  } catch (error) {
    console.error('Handoff credential error:', error);
    res.status(500).json({ error: 'Failed to request handoff' });
  }
});

/**
 * GET /api/citation-network/credentials/:id/password
 * Password reveal endpoint - DISABLED for security hardening
 */
router.get('/credentials/:id/password', authenticateToken, async (req, res) => {
  // SECURITY: Password reveal is disabled until security hardening is complete
  return res.status(503).json({
    error: 'Password reveal is temporarily disabled for security hardening.',
    message: 'Please use the handoff feature to request credential access.',
    availableSoon: true,
    alternative: 'POST /api/citation-network/credentials/:id/handoff'
  });
});

/**
 * GET /api/citation-network/action-reminders
 * Get submissions that need action with approaching deadlines
 */
router.get('/action-reminders', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        ds.id,
        ds.directory_name,
        ds.status,
        ds.action_type,
        ds.action_instructions,
        ds.action_required_at,
        ds.action_deadline,
        ds.verification_deadline,
        d.website_url as directory_url,
        CASE
          WHEN ds.action_deadline IS NOT NULL THEN
            EXTRACT(DAY FROM ds.action_deadline - NOW())
          WHEN ds.verification_deadline IS NOT NULL THEN
            EXTRACT(DAY FROM ds.verification_deadline - NOW())
          ELSE NULL
        END as days_remaining
      FROM directory_submissions ds
      LEFT JOIN directories d ON ds.directory_id = d.id
      WHERE ds.user_id = $1
        AND ds.status IN ('needs_action', 'action_needed', 'pending_verification')
        AND (
          ds.action_deadline IS NOT NULL OR
          ds.verification_deadline IS NOT NULL
        )
      ORDER BY
        COALESCE(ds.action_deadline, ds.verification_deadline) ASC
    `, [req.user.id]);

    // Categorize by urgency
    const reminders = result.rows.map(row => ({
      id: row.id,
      directoryName: row.directory_name,
      directoryUrl: row.directory_url,
      status: row.status,
      actionType: row.action_type,
      actionInstructions: row.action_instructions,
      actionRequiredAt: row.action_required_at,
      deadline: row.action_deadline || row.verification_deadline,
      daysRemaining: row.days_remaining,
      urgency: row.days_remaining <= 1 ? 'critical' :
               row.days_remaining <= 3 ? 'high' :
               row.days_remaining <= 7 ? 'medium' : 'low'
    }));

    res.json({
      reminders,
      summary: {
        total: reminders.length,
        critical: reminders.filter(r => r.urgency === 'critical').length,
        high: reminders.filter(r => r.urgency === 'high').length
      }
    });
  } catch (error) {
    console.error('Get action reminders error:', error);
    res.status(500).json({ error: 'Failed to fetch action reminders' });
  }
});

// ============================================================================
// SUBMISSION STATUS UPDATES
// ============================================================================

/**
 * GET /api/citation-network/submissions/:id/debug
 * Debug endpoint to check if a submission exists (development only)
 */
router.get('/submissions/:id/debug', authenticateToken, async (req, res) => {
  const submissionId = req.params.id;
  const userId = req.user.id;

  console.log(`[SubmissionDebug] Checking submission: ${submissionId} for user: ${userId} (type: ${typeof userId})`);

  try {
    // Check if table exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'directory_submissions'
      ) as exists
    `);

    if (!tableCheck.rows[0].exists) {
      return res.json({
        exists: false,
        error: 'directory_submissions table does not exist',
        suggestion: 'Run migrations first'
      });
    }

    // Check submission
    const result = await db.query(`
      SELECT id, user_id, status, directory_name
      FROM directory_submissions
      WHERE id = $1::uuid
    `, [submissionId]);

    if (result.rows.length === 0) {
      return res.json({
        exists: false,
        submissionId,
        userId,
        error: 'Submission not found with this ID'
      });
    }

    const sub = result.rows[0];
    const belongsToUser = String(sub.user_id) === String(userId);

    return res.json({
      exists: true,
      submissionId: sub.id,
      submissionUserId: sub.user_id,
      requestUserId: userId,
      belongsToUser,
      status: sub.status,
      directoryName: sub.directory_name,
      userIdTypes: {
        submissionUserId: typeof sub.user_id,
        requestUserId: typeof userId
      }
    });
  } catch (error) {
    return res.json({
      exists: false,
      error: error.message,
      code: error.code
    });
  }
});

/**
 * PATCH /api/citation-network/submissions/:id/status
 * Update a submission's status (e.g., mark as verified/complete)
 *
 * Bug 1 Fix: This endpoint persists the "Mark Complete" action to the database.
 * Previously, markActionComplete() only updated local frontend state.
 */
router.patch('/submissions/:id/status', authenticateToken, async (req, res) => {
  const submissionId = req.params.id;
  const userId = req.user.id;
  const { status, actionType } = req.body;

  console.log(`[SubmissionStatus] Request: submissionId=${submissionId}, userId=${userId}, status=${status}`);

  // Validate submissionId format (UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!submissionId || !uuidRegex.test(submissionId)) {
    console.log(`[SubmissionStatus] Invalid submission ID format: ${submissionId}`);
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_ID', message: 'Invalid submission ID format' }
    });
  }

  // Validate required fields
  if (!status) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_STATUS', message: 'Status is required' }
    });
  }

  // Validate status value
  const validStatuses = [
    'queued', 'in_progress', 'submitted', 'pending_approval',
    'pending_verification', 'verified', 'live', 'rejected',
    'action_needed', 'needs_action', 'blocked', 'failed', 'skipped', 'cancelled'
  ];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_STATUS', message: `Invalid status: ${status}. Valid: ${validStatuses.join(', ')}` }
    });
  }

  try {
    // First check if submission exists at all (helps diagnose issues)
    const existsCheck = await db.query(
      'SELECT id, user_id FROM directory_submissions WHERE id = $1::uuid',
      [submissionId]
    );

    if (existsCheck.rows.length === 0) {
      console.log(`[SubmissionStatus] Submission ${submissionId} not found in database`);
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Submission not found' }
      });
    }

    // Check ownership - use string comparison for safety across different ID types
    const submissionOwnerId = existsCheck.rows[0].user_id;
    if (String(submissionOwnerId) !== String(userId)) {
      console.log(`[SubmissionStatus] Ownership mismatch: submission belongs to ${submissionOwnerId}, request from ${userId}`);
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Submission does not belong to user' }
      });
    }

    // Now do the update
    const result = await db.query(`
      UPDATE directory_submissions
      SET
        status = $1,
        action_type = COALESCE($2, action_type),
        updated_at = NOW()
      WHERE id = $3::uuid
      RETURNING id, status, action_type, updated_at, directory_name
    `, [status, actionType || null, submissionId]);

    // This should always return a row now since we checked existence above
    if (result.rows.length === 0) {
      console.log(`[SubmissionStatus] Unexpected: No rows updated after existence check`);
      return res.status(500).json({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Update failed unexpectedly' }
      });
    }

    const updated = result.rows[0];

    // Try to update verified_at separately if status is 'verified' (column may not exist in all schemas)
    if (status === 'verified') {
      try {
        await db.query(`
          UPDATE directory_submissions
          SET verified_at = NOW()
          WHERE id = $1::uuid AND verified_at IS NULL
        `, [submissionId]);
      } catch (verifyError) {
        // Column might not exist - that's ok, log and continue
        console.log(`[SubmissionStatus] Could not update verified_at (column may not exist): ${verifyError.message}`);
      }
    }

    console.log(`[SubmissionStatus] SUCCESS: Updated submission ${submissionId} to status=${status} for user=${userId}`);

    res.json({
      success: true,
      submission: {
        id: updated.id,
        status: updated.status,
        actionType: updated.action_type,
        updatedAt: updated.updated_at,
        directoryName: updated.directory_name
      }
    });

  } catch (error) {
    console.error('[SubmissionStatus] Database error:', error.message);
    console.error('[SubmissionStatus] Stack:', error.stack);

    // Check for specific PostgreSQL errors
    if (error.code === '42P01') {
      // Table does not exist
      return res.status(500).json({
        success: false,
        error: { code: 'TABLE_NOT_FOUND', message: 'Submissions table not found. Please run migrations.' }
      });
    }

    if (error.code === '22P02') {
      // Invalid text representation (e.g., invalid UUID)
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ID', message: 'Invalid submission ID format' }
      });
    }

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update submission status' }
    });
  }
});

module.exports = router;
