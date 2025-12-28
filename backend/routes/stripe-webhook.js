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
 * T0-9: ATOMIC IDEMPOTENCY
 * - INSERT is the lock (ON CONFLICT DO NOTHING)
 * - On processing failure, DELETE the record so retry can work
 * - On success, mark as processed
 */

const db = require('../db/database');
const { handleCitationNetworkWebhook } = require('../services/citationNetworkWebhookHandler');

/**
 * Main Stripe webhook handler
 * Called directly from server.js with raw body
 *
 * T0-9: Uses atomic INSERT for idempotency with cleanup on failure
 */
async function stripeWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verify webhook signature (if secret is configured)
    if (endpointSecret && process.env.NODE_ENV === 'production') {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } else {
      // Development mode - parse JSON directly
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('[Webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`🔔 [Stripe Webhook] Received event: ${event.type} (${event.id})`);

  // T0-9: ATOMIC idempotency check - INSERT is the lock
  // If INSERT succeeds, we "own" this event and must process it
  // If INSERT fails (conflict), event was already claimed by another handler
  let eventId = null;

  try {
    const eventLogResult = await db.query(`
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
      console.log(`⏭️  [Webhook] Duplicate event ${event.id}, skipping`);
      return res.json({ received: true, duplicate: true });
    }

    eventId = eventLogResult.rows[0].id;
    console.log(`🔒 [Webhook] Acquired lock for event ${event.id} (db id: ${eventId})`);

    // Now safe to process - we hold the "lock"
    let handled = false;

    // Try citation network handler first (for one-time payments)
    const handledByCitationNetwork = await handleCitationNetworkWebhook(event);
    if (handledByCitationNetwork) {
      console.log(`📦 Event ${event.type} handled by Citation Network`);
      handled = true;
    }

    // Handle subscription events if not handled by citation network
    if (!handled) {
      switch (event.type) {
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object, eventId);
          handled = true;
          break;

        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object, eventId);
          handled = true;
          break;

        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object, eventId);
          handled = true;
          break;

        case 'invoice.payment_succeeded':
          await handlePaymentSucceeded(event.data.object, eventId);
          handled = true;
          break;

        case 'customer.subscription.created':
          await handleSubscriptionCreated(event.data.object, eventId);
          handled = true;
          break;

        default:
          console.log(`ℹ️  Unhandled event type: ${event.type}`);
      }
    }

    // Mark event as successfully processed
    await db.query(`
      UPDATE stripe_events
      SET processed = TRUE, processed_at = NOW()
      WHERE id = $1
    `, [eventId]);

    console.log(`✅ [Webhook] Event ${event.id} processed successfully`);
    res.json({ received: true });

  } catch (error) {
    console.error(`❌ [Webhook] Error processing ${event.id}:`, error.message);

    // T0-9: If processing fails, remove the idempotency record so retry can work
    if (eventId) {
      try {
        await db.query('DELETE FROM stripe_events WHERE id = $1', [eventId]);
        console.log(`🔓 [Webhook] Released lock for event ${event.id} (allowing retry)`);
      } catch (cleanupError) {
        console.error(`⚠️  [Webhook] Failed to cleanup event ${event.id}:`, cleanupError.message);
      }
    }

    return res.status(500).json({ error: 'Processing failed' });
  }
}

/**
 * Handle subscription deletion (user canceled)
 */
async function handleSubscriptionDeleted(subscription, eventId) {
  console.log(`🗑️  Subscription deleted: ${subscription.id}`);

  const customerId = subscription.customer;

  // Find user by Stripe customer ID
  const userResult = await db.query(
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
  await db.query(`
    UPDATE users
    SET
      plan = 'free',
      stripe_subscription_id = NULL,
      subscription_cancel_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
  `, [user.id]);

  console.log(`✅ User ${user.email} downgraded from ${oldPlan} to free`);

  // TODO: Send cancellation email
  // await sendEmail(user.email, 'Subscription Cancelled', ...);

  // Update event log with user info
  await db.query(`
    UPDATE stripe_events
    SET user_id = $1
    WHERE id = $2
  `, [user.id, eventId]);
}

/**
 * Handle subscription updates (plan change, payment update)
 */
async function handleSubscriptionUpdated(subscription, eventId) {
  console.log(`🔄 Subscription updated: ${subscription.id}`);

  const customerId = subscription.customer;
  const status = subscription.status;

  // Find user
  const userResult = await db.query(
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
    await db.query(`
      UPDATE users
      SET plan = 'free', updated_at = NOW()
      WHERE id = $1
    `, [user.id]);
    console.log(`❌ User ${user.email} downgraded due to status: ${status}`);
  }

  // Update event log
  await db.query(`
    UPDATE stripe_events
    SET user_id = $1
    WHERE id = $2
  `, [user.id, eventId]);
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice, eventId) {
  console.log(`❌ Payment failed for invoice: ${invoice.id}`);

  const customerId = invoice.customer;

  // Find user
  const userResult = await db.query(
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
    await db.query(`
      UPDATE users
      SET plan = 'free', updated_at = NOW()
      WHERE id = $1
    `, [user.id]);

    console.log(`❌ User ${user.email} downgraded after ${invoice.attempt_count} failed payment attempts`);

    // TODO: Send payment failed email
  } else {
    // TODO: Send payment retry notification
    console.log(`📧 Notifying ${user.email} of failed payment (attempt ${invoice.attempt_count}/3)`);
  }

  // Update event log
  await db.query(`
    UPDATE stripe_events
    SET user_id = $1
    WHERE id = $2
  `, [user.id, eventId]);
}

/**
 * Handle successful payment
 */
async function handlePaymentSucceeded(invoice, eventId) {
  console.log(`✅ Payment succeeded for invoice: ${invoice.id}`);

  const customerId = invoice.customer;

  // Find user
  const userResult = await db.query(
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
  await db.query(`
    UPDATE stripe_events
    SET user_id = $1
    WHERE id = $2
  `, [user.id, eventId]);

  // TODO: Send payment receipt email
}

/**
 * Handle new subscription created
 */
async function handleSubscriptionCreated(subscription, eventId) {
  console.log(`🆕 Subscription created: ${subscription.id}`);

  const customerId = subscription.customer;

  // Find user
  const userResult = await db.query(
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
  await db.query(`
    UPDATE users
    SET stripe_subscription_id = $1, updated_at = NOW()
    WHERE id = $2
  `, [subscription.id, user.id]);

  // Update event log
  await db.query(`
    UPDATE stripe_events
    SET user_id = $1
    WHERE id = $2
  `, [user.id, eventId]);
}

module.exports = { stripeWebhookHandler };
