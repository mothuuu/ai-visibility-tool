/**
 * AI Citation Network Stripe Service
 *
 * Handles checkout creation and product routing:
 * - Non-subscriber → $249 Starter (100 directories)
 * - Subscriber → $99 Boost Pack (25 directories)
 *
 * P1 ENTITLEMENT CORRECTNESS:
 * - Starter: NON-SUBSCRIBERS ONLY
 * - Boost: SUBSCRIBERS ONLY (requires active/trialing subscription)
 *
 * TIER-0 REQUIREMENTS:
 * - Rule 4: Orders remain status='paid' forever
 * - Rule 12: Use PACK_CONFIG for directories
 * - Rule 14: Use authenticated user_id (req.user.id) for metadata
 * - Rule 15: Always include pack_type in metadata
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db/database');
const config = require('../config/citationNetwork');
const { PACK_CONFIG, ERROR_CODES } = require('../config/citationNetwork');

class CitationNetworkStripeService {

  /**
   * Determine which product the user should see and create checkout
   *
   * P1 ENTITLEMENT CORRECTNESS:
   * - Starter: NON-SUBSCRIBERS ONLY (first purchase)
   * - Boost: SUBSCRIBERS ONLY (requires active subscription)
   */
  async createCheckout(userId, email) {
    // 1. Get user info (if logged in)
    let user = null;
    let isSubscriber = false;

    if (userId) {
      user = await this.getUser(userId);
      isSubscriber = this.isActiveSubscriber(user);
    }

    // 2. P1: Strict pack eligibility - starter for non-subscribers, boost for subscribers
    if (isSubscriber) {
      // Subscriber → $99 Boost Pack ONLY
      return this.createBoostCheckout(userId, user);
    } else {
      // Non-subscriber → $249 Starter ONLY
      return this.createStarterCheckout(userId, email, user);
    }
  }

  /**
   * Create $249 Starter checkout (non-subscribers, first purchase)
   */
  async createStarterCheckout(userId, email, user) {
    // 1. Create or get Stripe customer
    let customerId = user?.stripe_customer_id;

    // Verify existing customer is valid in Stripe
    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch (err) {
        // Customer doesn't exist in Stripe (maybe from different environment)
        console.log(`Stripe customer ${customerId} not found, will create new one`);
        customerId = null;
      }
    }

    // Create new customer if needed
    if (!customerId && email) {
      const customer = await stripe.customers.create({
        email: email,
        metadata: { user_id: userId ? userId.toString() : 'guest' }
      });
      customerId = customer.id;

      // Update user if logged in
      if (userId) {
        await db.query(
          'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
          [customerId, userId]
        );
      }
    }

    // TIER-0 RULE 12: Get directories from PACK_CONFIG
    const starterPack = PACK_CONFIG.starter;

    // Validate price ID is configured
    const starterPriceId = config.prices.STARTER_249;
    if (!starterPriceId) {
      console.warn('[CitationNetwork] STRIPE_PRICE_SPRINT_249 not set, will use price_data');
    }

    // 2. Create order record
    const order = await db.query(`
      INSERT INTO directory_orders (
        user_id, pack_type, order_type, amount_cents, directories_allocated,
        stripe_price_id, status
      ) VALUES ($1, 'starter', 'starter', $2, $3, $4, 'pending')
      RETURNING id
    `, [userId, starterPack.price, starterPack.directories, starterPriceId || 'dynamic']);

    const orderId = order.rows[0].id;

    // 3. Create checkout session
    // TIER-0 RULE 14/15: Use authenticated user_id, include pack_type
    // Build line_items based on whether price ID is configured
    const lineItems = starterPriceId
      ? [{ price: starterPriceId, quantity: 1 }]
      : [{
          price_data: {
            currency: 'usd',
            unit_amount: starterPack.price, // 24900 = $249
            product_data: {
              name: 'AI Citation Network - Starter Pack',
              description: `${starterPack.directories} directory submissions`
            }
          },
          quantity: 1
        }];

    const sessionConfig = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      metadata: {
        user_id: userId ? String(userId) : 'guest',
        pack_type: 'starter',
        order_type: 'starter', // Legacy compatibility
        directories_allocated: String(starterPack.directories),
        product: 'citation_network'
      },
      success_url: `${process.env.FRONTEND_URL}/citation-network-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/citation-network.html?cancelled=true`
    };

    if (customerId) {
      sessionConfig.customer = customerId;
    } else if (email) {
      sessionConfig.customer_email = email;
      sessionConfig.customer_creation = 'always';
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    // 4. Update order with session ID
    await db.query(
      'UPDATE directory_orders SET stripe_checkout_session_id = $1 WHERE id = $2',
      [session.id, orderId]
    );

    return {
      sessionId: session.id,
      url: session.url,
      orderId,
      orderType: 'starter',
      amount: 249
    };
  }

  /**
   * Create $99 Boost checkout (SUBSCRIBERS ONLY)
   *
   * P1 ENTITLEMENT CORRECTNESS:
   * - Boost packs are ONLY available to active subscribers
   * - Non-subscribers must purchase Starter pack instead
   */
  async createBoostCheckout(userId, user) {
    if (!userId || !user) {
      throw new Error('Must be logged in to purchase boost pack');
    }

    // P1: STRICT - Boost is SUBSCRIBERS ONLY
    const isSubscriber = this.isActiveSubscriber(user);
    if (!isSubscriber) {
      throw new Error(ERROR_CODES.PACK_NOT_AVAILABLE);
    }

    // 1. Verify business profile exists
    const profile = await this.getBusinessProfile(userId);
    if (!profile) {
      throw new Error(ERROR_CODES.PROFILE_REQUIRED);
    }

    // 2. Check pack limits (subscribers: max 2 packs per year)
    const packsThisYear = await this.getPacksThisYear(userId);
    if (packsThisYear >= config.maxPacksPerYear) {
      throw new Error(`Maximum ${config.maxPacksPerYear} packs per year. You've used ${packsThisYear}.`);
    }

    // TIER-0 RULE 12: Get directories from PACK_CONFIG
    const boostPack = PACK_CONFIG.boost;

    // Validate price ID is configured
    const boostPriceId = config.prices.PACK_99;
    if (!boostPriceId) {
      console.warn('[CitationNetwork] STRIPE_PRICE_PACK_99 not set, will use price_data');
    }

    // 3. Create order record
    const order = await db.query(`
      INSERT INTO directory_orders (
        user_id, business_profile_id, pack_type, order_type, amount_cents,
        directories_allocated, stripe_price_id, status
      ) VALUES ($1, $2, 'boost', 'boost', $3, $4, $5, 'pending')
      RETURNING id
    `, [userId, profile.id, boostPack.price, boostPack.directories, boostPriceId || 'dynamic']);

    const orderId = order.rows[0].id;

    // 4. Create checkout session
    let customerId = user.stripe_customer_id;

    // Verify Stripe customer exists, or create new one
    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch (err) {
        // Customer doesn't exist in Stripe (maybe from different environment)
        console.log(`Stripe customer ${customerId} not found, creating new one`);
        customerId = null;
      }
    }

    // Create Stripe customer if doesn't exist or was invalid
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: String(userId) }
      });
      customerId = customer.id;

      await db.query(
        'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
        [customerId, userId]
      );
    }

    // TIER-0 RULE 14/15: Use authenticated user_id, include pack_type
    // Build line_items based on whether price ID is configured
    const lineItems = boostPriceId
      ? [{ price: boostPriceId, quantity: 1 }]
      : [{
          price_data: {
            currency: 'usd',
            unit_amount: boostPack.price, // 9900 = $99
            product_data: {
              name: 'AI Citation Network - Boost Pack',
              description: `Add ${boostPack.directories} directory submissions`
            }
          },
          quantity: 1
        }];

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      metadata: {
        user_id: String(userId),
        pack_type: 'boost',
        order_type: 'boost', // Legacy compatibility (was 'pack')
        directories_allocated: String(boostPack.directories),
        product: 'citation_network'
      },
      success_url: `${process.env.FRONTEND_URL}/dashboard.html?tab=citation-network&success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard.html?tab=citation-network&cancelled=true`
    });

    // 5. Update order
    await db.query(
      'UPDATE directory_orders SET stripe_checkout_session_id = $1 WHERE id = $2',
      [session.id, orderId]
    );

    return {
      sessionId: session.id,
      url: session.url,
      orderId,
      orderType: 'pack',
      amount: 99
    };
  }

  /**
   * Get what the user should see (for UI display)
   *
   * P1 ENTITLEMENT CORRECTNESS:
   * - Non-subscribers see Starter ($249, 100 directories)
   * - Subscribers see Boost ($99, 25 directories)
   */
  async getCheckoutInfo(userId) {
    let user = null;
    let isSubscriber = false;

    if (userId) {
      user = await this.getUser(userId);
      isSubscriber = this.isActiveSubscriber(user);
    }

    // P1: Strict eligibility - starter for non-subscribers, boost for subscribers
    if (!isSubscriber) {
      // Non-subscriber → Starter pack
      const hasStarterPurchase = userId ? await this.hasStarterPurchase(userId) : false;

      return {
        product: 'starter',
        price: 249,
        priceId: config.prices.STARTER_249,
        directories: PACK_CONFIG.starter.directories,
        description: `Get listed on ${PACK_CONFIG.starter.directories}+ directories`,
        canPurchase: !hasStarterPurchase,
        reason: hasStarterPurchase ? 'You already have a Starter pack. Subscribe for more directories.' : null,
        isSubscriber: false,
        hasProfile: false
      };
    } else {
      // Subscriber → Boost pack
      let canPurchase = true;
      let reason = null;

      // Check pack limits
      const packsThisYear = await this.getPacksThisYear(userId);
      if (packsThisYear >= config.maxPacksPerYear) {
        canPurchase = false;
        reason = `Maximum ${config.maxPacksPerYear} packs per year reached`;
      }

      // Check for business profile
      const profile = await this.getBusinessProfile(userId);
      if (!profile && canPurchase) {
        canPurchase = false;
        reason = 'Complete your business profile first';
      }

      return {
        product: 'boost',
        price: 99,
        priceId: config.prices.PACK_99,
        directories: PACK_CONFIG.boost.directories,
        description: `Add ${PACK_CONFIG.boost.directories} more directories`,
        canPurchase,
        reason,
        isSubscriber: true,
        hasProfile: !!profile
      };
    }
  }

  // ============ Helper Methods ============

  async getUser(userId) {
    const result = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    return result.rows[0] || null;
  }

  isActiveSubscriber(user) {
    // FIX T0-5: Use centralized isActiveSubscriber from config
    // This properly requires 'active' or 'trialing' status, not just stripe_subscription_id
    return config.isActiveSubscriber(user);
  }

  // TIER-0 RULE 4: New orders only have 'paid', but include legacy statuses for compatibility
  async hasStarterPurchase(userId) {
    const result = await db.query(`
      SELECT id FROM directory_orders
      WHERE user_id = $1
        AND (order_type = 'starter' OR pack_type = 'starter')
        AND status IN ('paid', 'processing', 'in_progress', 'completed')
      LIMIT 1
    `, [userId]);
    return result.rows.length > 0;
  }

  // TIER-0 RULE 4: New orders only have 'paid', but include legacy statuses for compatibility
  async getPacksThisYear(userId) {
    const result = await db.query(`
      SELECT COUNT(*) as count
      FROM directory_orders
      WHERE user_id = $1
        AND (order_type IN ('pack', 'boost') OR pack_type = 'boost')
        AND status IN ('paid', 'processing', 'in_progress', 'completed')
        AND created_at >= date_trunc('year', NOW())
    `, [userId]);
    return parseInt(result.rows[0].count);
  }

  // TIER-0 RULE 4: New orders only have 'paid', but include legacy statuses for compatibility
  async getTotalPacks(userId) {
    const result = await db.query(`
      SELECT COUNT(*) as count
      FROM directory_orders
      WHERE user_id = $1
        AND (order_type IN ('pack', 'boost') OR pack_type = 'boost')
        AND status IN ('paid', 'processing', 'in_progress', 'completed')
    `, [userId]);
    return parseInt(result.rows[0].count);
  }

  async getBusinessProfile(userId) {
    const result = await db.query(`
      SELECT * FROM business_profiles
      WHERE user_id = $1
      ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
      LIMIT 1
    `, [userId]);
    return result.rows[0] || null;
  }
}

module.exports = new CitationNetworkStripeService();
