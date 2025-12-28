/**
 * Stripe Webhook Handler
 * Automatically handles subscription lifecycle events
 *
 * IMPORTANT: This handler expects req.body to be a raw Buffer (not parsed JSON).
 * It must be mounted in server.js BEFORE any body-parsing middleware:
 *
 *   app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);
 *   app.use(express.json()); // AFTER webhook routes
 *
 * TIER-0 REQUIREMENTS:
 * - Rule 2: ALWAYS verify signature via constructEvent (NEVER JSON.parse in prod)
 * - Rule 6: Idempotency INSERT + side effects + status update in ONE transaction
 * - Rule 9: On failure, ROLLBACK removes idempotency record so retry can work
 */

const db = require('../db/database');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { handleCitationNetworkWebhook } = require('../services/citationNetworkWebhookHandler');

/**
 * Main Stripe webhook handler
 * Called directly from server.js with raw body
 *
 * TIER-0: Uses transactional processing with atomic idempotency
 */
async function stripeWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  // TIER-0 RULE 2: ALWAYS verify signature - NEVER bypass in production
  try {
    if (!endpointSecret) {
      // No secret configured - configuration error in production
      console.error('[Webhook] STRIPE_WEBHOOK_SECRET not configured');
      if (process.env.NODE_ENV === 'production') {
        return res.status(500).json({ error: 'Webhook not configured' });
      }
      // In development only, allow unsigned webhooks with a warning
      console.warn('[Webhook] WARNING: Running without signature verification (dev only)');
      event = JSON.parse(req.body.toString());
    } else {
      // ALWAYS verify signature when secret is available
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    }
  } catch (err) {
    console.error('[Webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`🔔 [Stripe Webhook] Received event: ${event.type} (${event.id})`);

  // TIER-0 RULE 6: ALL processing in ONE transaction
  const client = await db.pool.connect();
  let eventDbId = null;

  try {
    await client.query('BEGIN');

    // Atomic idempotency check - INSERT is the lock
    const eventLogResult = await client.query(`
      INSERT INTO stripe_events (event_id, event_type, customer_id, subscription_id, event_data)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id
    `, [
      event.id,
      event.type,
      event.data.object.customer || null,
      event.data.object.id || null,
      JSON.stringify(event.data.object)
    ]);

    // If nothing returned, this event was already processed (duplicate)
    if (eventLogResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      console.log(`⏭️  [Webhook] Duplicate event ${event.id}, skipping`);
      return res.json({ received: true, duplicate: true });
    }

    eventDbId = eventLogResult.rows[0].id;
    console.log(`🔒 [Webhook] Acquired lock for event ${event.id} (db id: ${eventDbId})`);

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
          await handleSubscriptionDeleted(event.data.object, eventDbId, client);
          handled = true;
          break;

        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object, eventDbId, client);
          handled = true;
          break;

        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object, eventDbId, client);
          handled = true;
          break;

        case 'invoice.payment_succeeded':
          await handlePaymentSucceeded(event.data.object, eventDbId, client);
          handled = true;
          break;

        case 'customer.subscription.created':
          await handleSubscriptionCreated(event.data.object, eventDbId, client);
          handled = true;
          break;

        default:
          console.log(`ℹ️  Unhandled event type: ${event.type}`);
      }
    }

    // Mark event as successfully processed
    await client.query(`
      UPDATE stripe_events
      SET processed = TRUE, processed_at = NOW()
      WHERE id = $1
    `, [eventDbId]);

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
 * TIER-0: Uses transaction client from webhook handler
 */
async function handleSubscriptionDeleted(subscription, eventId, client) {
  console.log(`🗑️  Subscription deleted: ${subscription.id}`);

  const customerId = subscription.customer;
  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  // Find user by Stripe customer ID
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

  // Downgrade user to free plan
  await queryFn(`
    UPDATE users
    SET
      plan = 'free',
      stripe_subscription_id = NULL,
      subscription_cancel_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
  `, [user.id]);

  console.log(`✅ User ${user.email} downgraded from ${oldPlan} to free`);

  // Update event log with user info
  await queryFn(`
    UPDATE stripe_events
    SET user_id = $1
    WHERE id = $2
  `, [user.id, eventId]);
}

/**
 * Handle subscription updates (plan change, payment update)
 * TIER-0: Uses transaction client from webhook handler
 */
async function handleSubscriptionUpdated(subscription, eventId, client) {
  console.log(`🔄 Subscription updated: ${subscription.id}`);

  const customerId = subscription.customer;
  const status = subscription.status;
  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  // Find user
  const userResult = await queryFn(
    'SELECT id, email, plan FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.log(`⚠️  No user found for customer ${customerId}`);
    return;
  }

  const user = userResult.rows[0];

  // Handle subscription status changes
  if (status === 'active' || status === 'trialing') {
    // Subscription is active - ensure user has correct plan
    console.log(`✅ Subscription active for ${user.email}`);
  } else if (status === 'past_due') {
    console.log(`⚠️  Payment past due for ${user.email}`);
    // Give 3-day grace period before downgrading
  } else if (status === 'canceled' || status === 'unpaid') {
    // Downgrade to free
    await queryFn(`
      UPDATE users
      SET plan = 'free', updated_at = NOW()
      WHERE id = $1
    `, [user.id]);
    console.log(`❌ User ${user.email} downgraded due to status: ${status}`);
  }

  // Update event log
  await queryFn(`
    UPDATE stripe_events
    SET user_id = $1
    WHERE id = $2
  `, [user.id, eventId]);
}

/**
 * Handle failed payment
 * TIER-0: Uses transaction client from webhook handler
 */
async function handlePaymentFailed(invoice, eventId, client) {
  console.log(`❌ Payment failed for invoice: ${invoice.id}`);

  const customerId = invoice.customer;
  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  // Find user
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

  // After 3 failed attempts, downgrade to free
  if (invoice.attempt_count >= 3) {
    await queryFn(`
      UPDATE users
      SET plan = 'free', updated_at = NOW()
      WHERE id = $1
    `, [user.id]);

    console.log(`❌ User ${user.email} downgraded after ${invoice.attempt_count} failed payment attempts`);
  } else {
    console.log(`📧 Notifying ${user.email} of failed payment (attempt ${invoice.attempt_count}/3)`);
  }

  // Update event log
  await queryFn(`
    UPDATE stripe_events
    SET user_id = $1
    WHERE id = $2
  `, [user.id, eventId]);
}

/**
 * Handle successful payment
 * TIER-0: Uses transaction client from webhook handler
 */
async function handlePaymentSucceeded(invoice, eventId, client) {
  console.log(`✅ Payment succeeded for invoice: ${invoice.id}`);

  const customerId = invoice.customer;
  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  // Find user
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

  // Update event log
  await queryFn(`
    UPDATE stripe_events
    SET user_id = $1
    WHERE id = $2
  `, [user.id, eventId]);
}

/**
 * Handle new subscription created
 * TIER-0: Uses transaction client from webhook handler
 */
async function handleSubscriptionCreated(subscription, eventId, client) {
  console.log(`🆕 Subscription created: ${subscription.id}`);

  const customerId = subscription.customer;
  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  // Find user
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

  // Update subscription ID
  await queryFn(`
    UPDATE users
    SET stripe_subscription_id = $1, updated_at = NOW()
    WHERE id = $2
  `, [subscription.id, user.id]);

  // Update event log
  await queryFn(`
    UPDATE stripe_events
    SET user_id = $1
    WHERE id = $2
  `, [user.id, eventId]);
}

module.exports = { stripeWebhookHandler };
