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
    return;
  }

  const user = userResult.rows[0];
  const oldPlan = user.plan;

  await queryFn(`
    UPDATE users
    SET
      plan = 'free',
      stripe_subscription_id = NULL,
      stripe_subscription_status = 'canceled',
      subscription_cancel_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
  `, [user.id]);

  console.log(`✅ User ${user.email} downgraded from ${oldPlan} to free`);
}

/**
 * Handle subscription updates (plan change, payment update)
 */
async function handleSubscriptionUpdated(subscription, client) {
  console.log(`🔄 Subscription updated: ${subscription.id}`);

  const customerId = subscription.customer;
  const status = subscription.status;
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

  // Update stripe_subscription_status
  await queryFn(`
    UPDATE users
    SET stripe_subscription_status = $1, updated_at = NOW()
    WHERE id = $2
  `, [status, user.id]);

  if (status === 'active' || status === 'trialing') {
    console.log(`✅ Subscription active for ${user.email}`);
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
 */
async function handlePaymentSucceeded(invoice, client) {
  console.log(`✅ Payment succeeded for invoice: ${invoice.id}`);

  const customerId = invoice.customer;
  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  const userResult = await queryFn(
    'SELECT id, email FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.log(`⚠️  No user found for customer ${customerId}`);
    return;
  }

  const user = userResult.rows[0];
  console.log(`💰 Payment succeeded for ${user.email}: $${(invoice.amount_paid / 100).toFixed(2)}`);
}

/**
 * Handle new subscription created
 */
async function handleSubscriptionCreated(subscription, client) {
  console.log(`🆕 Subscription created: ${subscription.id}`);

  const customerId = subscription.customer;
  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  const userResult = await queryFn(
    'SELECT id, email FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.log(`⚠️  No user found for customer ${customerId}`);
    return;
  }

  const user = userResult.rows[0];
  console.log(`✅ New subscription for ${user.email}`);

  await queryFn(`
    UPDATE users
    SET stripe_subscription_id = $1, stripe_subscription_status = $2, updated_at = NOW()
    WHERE id = $3
  `, [subscription.id, subscription.status, user.id]);
}

// Export as function (not object with named export)
module.exports = handleStripeWebhook;
