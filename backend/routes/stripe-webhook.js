/**
 * Stripe Webhook Handler
 * Automatically handles subscription lifecycle events
 *
 * IMPORTANT: This handler expects req.body to be a raw Buffer (not parsed JSON).
 * It must be mounted in server.js BEFORE any body-parsing middleware:
 *
 *   app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '2mb' }), handleStripeWebhook);
 *   app.use(express.json()); // AFTER webhook routes
 *
 * P0 REQUIREMENTS:
 * - T0-1: ALWAYS verify signature via constructEvent (NO dev-mode bypass)
 * - T0-9: Idempotency INSERT + side effects + status update in ONE transaction
 * - Store FULL event in payload (not just data.object)
 * - Guard missing stripe-signature header
 */

const db = require('../db/database');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { handleCitationNetworkWebhook } = require('../services/citationNetworkWebhookHandler');

// Phase 2: Import planService for centralized plan management
// Phase 2.1: Add org dual-write functions for subscription events
const {
  syncPlanFromWebhook,
  handleSubscriptionDeleted: handleSubDeleted,
  upsertOrgStripeFields,
  clearOrgStripeFields,
  getEntitlements
} = require('../services/planService');

// Phase 1.8: Import TokenService for token top-up and renewal grants
const TokenService = require('../services/tokenService');

// Valid token top-up amounts
const VALID_TOKEN_AMOUNTS = [20, 50, 120, 250];

/**
 * Main Stripe webhook handler
 * Exported as a function (not router) for direct mounting in server.js
 *
 * P0: Uses transactional processing with atomic idempotency
 *
 * @param {Request} req - Express request (body must be raw Buffer)
 * @param {Response} res - Express response
 */
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // P0: Guard missing stripe-signature header
  if (!sig) {
    console.error('[Webhook] Missing stripe-signature header');
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  // P0: Guard missing webhook secret configuration
  if (!endpointSecret) {
    console.error('[Webhook] STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  let event;

  // P0 T0-1: ALWAYS verify signature - NO dev-mode bypass
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('[Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  console.log(`🔔 [Stripe Webhook] Received event: ${event.type} (${event.id})`);

  // P0 T0-9: ALL processing in ONE transaction
  const client = await db.pool.connect();
  let eventDbId = null;

  try {
    await client.query('BEGIN');

    // Atomic idempotency check - INSERT is the lock
    // P0: Store FULL event in payload (not just data.object)
    const eventLogResult = await client.query(`
      INSERT INTO processed_stripe_events (event_id, event_type, processed_at, payload)
      VALUES ($1, $2, NOW(), $3::jsonb)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id
    `, [
      event.id,
      event.type,
      JSON.stringify(event) // Store FULL event
    ]);

    // If nothing returned, this event was already processed (duplicate)
    if (eventLogResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      console.log(`⏭️  [Webhook] Duplicate event ${event.id}, skipping`);
      return res.json({ received: true, duplicate: true });
    }

    eventDbId = eventLogResult.rows[0].event_id;
    console.log(`🔒 [Webhook] Acquired lock for event ${event.id}`);

    // Process event - all handlers receive the transaction client
    let handled = false;

    // Try citation network handler first (for one-time payments)
    const handledByCitationNetwork = await handleCitationNetworkWebhook(event, client);
    if (handledByCitationNetwork) {
      console.log(`📦 Event ${event.type} handled by Citation Network`);
      handled = true;
    }

    // Handle subscription events if not handled by citation network
    if (!handled) {
      switch (event.type) {
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object, client);
          handled = true;
          break;

        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object, client);
          handled = true;
          break;

        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object, client);
          handled = true;
          break;

        case 'invoice.payment_succeeded':
          await handlePaymentSucceeded(event.data.object, client);
          handled = true;
          break;

        case 'customer.subscription.created':
          await handleSubscriptionCreated(event.data.object, client);
          handled = true;
          break;

        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object, client);
          handled = true;
          break;

        default:
          console.log(`ℹ️  Unhandled event type: ${event.type}`);
      }
    }

    // COMMIT the entire transaction
    await client.query('COMMIT');
    console.log(`✅ [Webhook] Event ${event.id} processed successfully`);
    res.json({ received: true });

  } catch (error) {
    // ROLLBACK on any error - this removes the idempotency record automatically
    await client.query('ROLLBACK');
    console.error(`❌ [Webhook] Error processing ${event.id}:`, error.message);
    console.log(`🔓 [Webhook] Transaction rolled back for event ${event.id} (allowing retry)`);

    return res.status(500).json({ error: 'Processing failed' });
  } finally {
    client.release();
  }
}

/**
 * Handle subscription deletion (user canceled)
 * Phase 2: Uses planService for centralized handling
 * Phase 2.1: Dual-write to organizations
 */
async function handleSubscriptionDeleted(subscription, client) {
  console.log(`🗑️  Subscription deleted: ${subscription.id}`);

  const customerId = subscription.customer;
  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  const userResult = await queryFn(
    'SELECT id, email, plan FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.log(`⚠️  No user found for customer ${customerId}`);
    // Phase 2.1: Still try to update org even if user not found
    await clearOrgStripeFields(customerId, client);
    return;
  }

  const user = userResult.rows[0];
  const oldPlan = user.plan;

  // Phase 2: Update all Stripe-related fields including period info
  await queryFn(`
    UPDATE users
    SET
      plan = 'free',
      stripe_subscription_id = NULL,
      stripe_subscription_status = 'canceled',
      stripe_price_id = NULL,
      stripe_current_period_start = NULL,
      stripe_current_period_end = NULL,
      subscription_cancel_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
  `, [user.id]);

  console.log(`✅ User ${user.email} downgraded from ${oldPlan} to free`);

  // Phase 1.8: Expire all tokens on subscription cancellation
  try {
    await TokenService.expireAllTokens(user.id);
    console.log(`[Token] Expired all tokens for user ${user.id} on subscription cancellation`);
  } catch (tokenErr) {
    console.error(`[Token] Failed to expire tokens for user ${user.id}:`, tokenErr.message);
    // Don't break subscription handling — token expiry failure is non-fatal
  }

  // Phase 2.1: Dual-write to organizations
  const orgResult = await clearOrgStripeFields(customerId, client);
  if (orgResult.success) {
    console.log(`✅ Org ${orgResult.orgId} Stripe fields cleared (subscription deleted)`);
  }
}

/**
 * Handle subscription updates (plan change, payment update)
 * Phase 2: Uses syncPlanFromWebhook for centralized plan resolution
 * Phase 2.1: Dual-write to organizations
 */
async function handleSubscriptionUpdated(subscription, client) {
  console.log(`🔄 Subscription updated: ${subscription.id}`);

  const customerId = subscription.customer;
  const status = subscription.status;
  const priceId = subscription.items?.data?.[0]?.price?.id || null;
  const periodStart = subscription.current_period_start
    ? new Date(subscription.current_period_start * 1000)
    : null;
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  const userResult = await queryFn(
    'SELECT id, email, plan FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.log(`⚠️  No user found for customer ${customerId}`);
    // Phase 2.1: Still try to update org even if user not found
    await upsertOrgStripeFields(customerId, subscription, client);
    return;
  }

  const user = userResult.rows[0];

  // Phase 2: Update all Stripe fields including price ID and period
  await queryFn(`
    UPDATE users
    SET stripe_subscription_status = $1,
        stripe_subscription_id = $2,
        stripe_price_id = $3,
        stripe_current_period_start = $4,
        stripe_current_period_end = $5,
        updated_at = NOW()
    WHERE id = $6
  `, [status, subscription.id, priceId, periodStart, periodEnd, user.id]);

  if (status === 'active' || status === 'trialing') {
    console.log(`✅ Subscription active for ${user.email} (price: ${priceId})`);
  } else if (status === 'past_due') {
    console.log(`⚠️  Payment past due for ${user.email}`);
  } else if (status === 'canceled' || status === 'unpaid') {
    await queryFn(`
      UPDATE users
      SET plan = 'free', updated_at = NOW()
      WHERE id = $1
    `, [user.id]);
    console.log(`❌ User ${user.email} downgraded due to status: ${status}`);
  }

  // Phase 2.1: Dual-write to organizations
  const orgResult = await upsertOrgStripeFields(customerId, subscription, client);
  if (orgResult.success) {
    console.log(`✅ Org ${orgResult.orgId} Stripe fields updated (status: ${status}, price: ${priceId})`);
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice, client) {
  console.log(`❌ Payment failed for invoice: ${invoice.id}`);

  const customerId = invoice.customer;
  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  const userResult = await queryFn(
    'SELECT id, email, plan FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.log(`⚠️  No user found for customer ${customerId}`);
    return;
  }

  const user = userResult.rows[0];
  console.log(`⚠️  Payment failed for ${user.email} - attempt ${invoice.attempt_count}`);

  if (invoice.attempt_count >= 3) {
    await queryFn(`
      UPDATE users
      SET plan = 'free', updated_at = NOW()
      WHERE id = $1
    `, [user.id]);
    console.log(`❌ User ${user.email} downgraded after ${invoice.attempt_count} failed payment attempts`);
  }
}

/**
 * Handle successful payment
 * Phase 1.8: Also handles monthly token grants on subscription renewal
 */
async function handlePaymentSucceeded(invoice, client) {
  console.log(`✅ Payment succeeded for invoice: ${invoice.id}`);

  const customerId = invoice.customer;
  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  const userResult = await queryFn(
    'SELECT id, email, plan FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.log(`⚠️  No user found for customer ${customerId}`);
    return;
  }

  const user = userResult.rows[0];
  console.log(`💰 Payment succeeded for ${user.email}: $${(invoice.amount_paid / 100).toFixed(2)}`);

  // Phase 1.8: Grant monthly tokens on subscription renewal
  if (invoice.billing_reason === 'subscription_cycle') {
    try {
      await handleRenewalTokenGrant(invoice, user, queryFn);
    } catch (tokenErr) {
      console.error(`[Token] Failed to grant renewal tokens for user ${user.id}:`, tokenErr.message);
      // Don't break payment handling — token grant failure is non-fatal
    }
  }
}

/**
 * Handle new subscription created
 * Phase 2: Stores all Stripe fields including price ID and period for usage tracking
 * Phase 2.1: Dual-write to organizations
 */
async function handleSubscriptionCreated(subscription, client) {
  console.log(`🆕 Subscription created: ${subscription.id}`);

  const customerId = subscription.customer;
  const priceId = subscription.items?.data?.[0]?.price?.id || null;
  const periodStart = subscription.current_period_start
    ? new Date(subscription.current_period_start * 1000)
    : null;
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  const userResult = await queryFn(
    'SELECT id, email, plan FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.log(`⚠️  No user found for customer ${customerId}`);
    // Phase 2.1: Still try to update org even if user not found
    await upsertOrgStripeFields(customerId, subscription, client);
    return;
  }

  const user = userResult.rows[0];
  console.log(`✅ New subscription for ${user.email} (price: ${priceId})`);

  // Phase 2: Store all Stripe fields for plan resolution and usage period
  await queryFn(`
    UPDATE users
    SET stripe_subscription_id = $1,
        stripe_subscription_status = $2,
        stripe_price_id = $3,
        stripe_current_period_start = $4,
        stripe_current_period_end = $5,
        updated_at = NOW()
    WHERE id = $6
  `, [subscription.id, subscription.status, priceId, periodStart, periodEnd, user.id]);

  // Phase 2.1: Dual-write to organizations
  const orgResult = await upsertOrgStripeFields(customerId, subscription, client);
  if (orgResult.success) {
    console.log(`✅ Org ${orgResult.orgId} Stripe fields updated (new subscription, status: ${subscription.status})`);
  }
}

// =============================================================================
// Phase 1.8: Token Top-Up and Renewal Token Grant Handlers
// =============================================================================

/**
 * Handle checkout.session.completed for token top-ups.
 * Only processes sessions with mode='payment' and metadata.type='token_topup'.
 * Non-topup checkout sessions are ignored (existing flows handle those).
 */
async function handleCheckoutCompleted(session, client) {
  const metadata = session.metadata || {};

  // Only handle token top-ups — let other checkout flows pass through
  if (session.mode !== 'payment' || metadata.type !== 'token_topup') {
    console.log(`[Token] checkout.session.completed is not a token top-up (mode=${session.mode}, type=${metadata.type}), skipping`);
    return;
  }

  // Verify payment status
  if (session.payment_status !== 'paid') {
    console.warn(`[Token] Token top-up session ${session.id} not paid (status=${session.payment_status}), skipping`);
    return;
  }

  // Idempotency: check token_transactions for duplicate crediting
  const queryFn = client ? client.query.bind(client) : db.query.bind(db);
  const dupCheck = await queryFn(
    `SELECT id FROM token_transactions WHERE reference_type = 'stripe_checkout_session' AND reference_id = $1 LIMIT 1`,
    [session.id]
  );
  if (dupCheck.rows.length > 0) {
    console.log(`[Token] Already credited session ${session.id}, skipping`);
    return;
  }

  // Extract and validate userId
  const userId = parseInt(metadata.user_id, 10);
  if (!userId || isNaN(userId)) {
    console.error(`[Token] Invalid user_id in metadata for session ${session.id}:`, JSON.stringify(metadata));
    return; // Return 200 — don't make Stripe retry bad data
  }

  // Cross-check client_reference_id if set
  if (session.client_reference_id && session.client_reference_id !== String(userId)) {
    console.error(`[Token] client_reference_id mismatch: ${session.client_reference_id} vs metadata.user_id ${userId} for session ${session.id}`);
    return;
  }

  // Validate user exists
  const userResult = await queryFn('SELECT id FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) {
    console.error(`[Token] User ${userId} not found in DB for session ${session.id}`);
    return;
  }

  // Extract and validate token amount
  const tokenAmount = parseInt(metadata.token_amount, 10);
  if (!tokenAmount || isNaN(tokenAmount) || !VALID_TOKEN_AMOUNTS.includes(tokenAmount)) {
    console.error(`[Token] Invalid token_amount ${metadata.token_amount} for session ${session.id}. Valid amounts: ${VALID_TOKEN_AMOUNTS.join(', ')}`);
    return;
  }

  // Credit tokens
  await TokenService.creditPurchasedTokens(userId, tokenAmount, 'stripe_checkout_session', session.id);
  console.log(`[Token] Credited ${tokenAmount} tokens to user ${userId} from session ${session.id}`);
}

/**
 * Handle monthly token grant on subscription renewal.
 * Called from handlePaymentSucceeded when billing_reason === 'subscription_cycle'.
 */
async function handleRenewalTokenGrant(invoice, user, queryFn) {
  // Idempotency: check token_transactions for duplicate grant
  const dupCheck = await queryFn(
    `SELECT id FROM token_transactions WHERE reference_type = 'stripe_invoice' AND reference_id = $1 LIMIT 1`,
    [invoice.id]
  );
  if (dupCheck.rows.length > 0) {
    console.log(`[Token] Already granted tokens for invoice ${invoice.id}, skipping`);
    return;
  }

  // Determine plan entitlements
  const entitlements = getEntitlements(user.plan);
  const tokensPerCycle = entitlements.tokensPerCycle;

  if (!tokensPerCycle || tokensPerCycle === 0) {
    console.log(`[Token] Plan '${user.plan}' has 0 tokensPerCycle, skipping renewal grant for user ${user.id}`);
    return;
  }

  // Convert invoice period timestamps to dates
  const cycleStartDate = invoice.period_start
    ? new Date(invoice.period_start * 1000)
    : new Date();
  const cycleEndDate = invoice.period_end
    ? new Date(invoice.period_end * 1000)
    : new Date();

  // Expire remaining monthly tokens from previous cycle
  await TokenService.expireMonthlyTokens(user.id);

  // Grant new monthly tokens
  await TokenService.grantMonthlyTokens(user.id, tokensPerCycle, cycleStartDate, cycleEndDate);

  console.log(`[Token] Granted ${tokensPerCycle} monthly tokens to user ${user.id} for cycle ${cycleStartDate.toISOString()} to ${cycleEndDate.toISOString()}`);
}

// Export as function (not object with named export)
module.exports = handleStripeWebhook;
