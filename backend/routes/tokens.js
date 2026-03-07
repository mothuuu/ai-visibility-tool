/**
 * Token Routes
 *
 * REST endpoints for token balance, transaction history, and top-up purchases.
 * All endpoints require authentication (authenticateToken).
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const tokenService = require('../services/tokenService');
const { getEntitlements } = require('../services/planService');
const { authenticateToken } = require('../middleware/auth');

// Stripe — lazy-init so the module loads even if STRIPE_SECRET_KEY is not set
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

// =============================================================================
// RATE LIMITER (stricter for purchase endpoint)
// =============================================================================

const purchaseRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator: (req) => `token_purchase_${req.user?.id || req.ip}`,
  message: {
    error: 'Too many purchase requests. Please try again in a minute.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// =============================================================================
// BUNDLE → PRICE ID MAPPING
// =============================================================================

const VALID_BUNDLES = [20, 50, 120, 250];

const BUNDLE_TO_ENV_KEY = {
  20:  'STRIPE_TOPUP_20_PRICE_ID',
  50:  'STRIPE_TOPUP_50_PRICE_ID',
  120: 'STRIPE_TOPUP_120_PRICE_ID',
  250: 'STRIPE_TOPUP_250_PRICE_ID'
};

// =============================================================================
// GET /api/tokens/balance
// =============================================================================

router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const balance = await tokenService.getBalance(req.user.id);
    res.json(balance);
  } catch (error) {
    console.error('[Tokens] Balance fetch error:', error.message);
    res.status(500).json({ error: 'Failed to fetch token balance' });
  }
});

// =============================================================================
// GET /api/tokens/transactions
// =============================================================================

router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);

    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    if (limit > 100) limit = 100;

    const offset = (page - 1) * limit;

    const [countResult, txResult] = await Promise.all([
      db.query(
        'SELECT count(*) FROM token_transactions WHERE user_id = $1',
        [req.user.id]
      ),
      db.query(
        `SELECT id, type, amount, balance_after, reference_type, reference_id, created_at
         FROM token_transactions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      )
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    res.json({
      transactions: txResult.rows,
      total,
      page,
      limit,
      hasMore: (page * limit) < total
    });
  } catch (error) {
    console.error('[Tokens] Transactions fetch error:', error.message);
    res.status(500).json({ error: 'Failed to fetch token transactions' });
  }
});

// =============================================================================
// POST /api/tokens/purchase
// =============================================================================

router.post('/purchase', authenticateToken, purchaseRateLimiter, async (req, res) => {
  try {
    // Validate bundle
    const tokenAmount = parseInt(req.body.bundle, 10);
    if (!VALID_BUNDLES.includes(tokenAmount)) {
      return res.status(400).json({
        error: `Invalid bundle. Must be one of: ${VALID_BUNDLES.join(', ')}`
      });
    }

    // Plan gate: only starter/pro (canPurchaseTokens === true)
    const entitlements = getEntitlements(req.user.plan);
    if (!entitlements.canPurchaseTokens) {
      return res.status(403).json({ error: 'Upgrade required to purchase tokens' });
    }

    // Resolve Stripe price ID from env
    const envKey = BUNDLE_TO_ENV_KEY[tokenAmount];
    const priceId = process.env[envKey];
    if (!priceId) {
      console.error(`[Tokens] Missing env var ${envKey} for bundle ${tokenAmount}`);
      return res.status(500).json({ error: 'Token bundle unavailable' });
    }

    // Get or create Stripe customer
    let customerId = req.user.stripe_customer_id;
    const stripe = getStripe();

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: { userId: String(req.user.id) }
      });
      customerId = customer.id;

      await db.query(
        'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
        [customerId, req.user.id]
      );
    }

    // Create one-time checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(req.user.id),
      metadata: {
        user_id: String(req.user.id),
        token_amount: String(tokenAmount),
        type: 'token_topup'
      },
      success_url: `${process.env.FRONTEND_URL}/token-purchase-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/tokens.html?cancelled=true`
    });

    console.log(`[Tokens] Checkout session created: ${session.id} for user ${req.user.id}, bundle ${tokenAmount}`);
    res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('[Tokens] Purchase error:', error.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

module.exports = router;
