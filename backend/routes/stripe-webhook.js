/**
 * Stripe Webhook Handler
 * Automatically handles subscription lifecycle events
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { handleCitationNetworkWebhook } = require('../services/citationNetworkWebhookHandler');

// POST /api/webhooks/stripe - Handle Stripe webhook events
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
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

    console.log(`🔔 [Stripe Webhook] Received event: ${event.type}`);

    // Log event to database
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

    // Skip if we've already processed this event
    if (eventLogResult.rows.length === 0) {
      console.log(`⏭️  Event ${event.id} already processed`);
      return res.json({ received: true });
    }

    const eventId = eventLogResult.rows[0].id;

    // Try citation network handler first (for one-time payments)
    try {
      const handledByCitationNetwork = await handleCitationNetworkWebhook(event);
      if (handledByCitationNetwork) {
        console.log(`📦 Event ${event.type} handled by Citation Network`);
        await db.query(`
          UPDATE stripe_events
          SET processed = TRUE, processed_at = NOW()
          WHERE id = $1
        `, [eventId]);
        return res.json({ received: true });
      }
    } catch (cnError) {
      console.error('❌ Citation Network webhook error:', cnError.message);
    }

    // Handle the event (subscription events)
    switch (event.type) {
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object, eventId);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object, eventId);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object, eventId);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object, eventId);
        break;

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object, eventId);
        break;

      default:
        console.log(`ℹ️  Unhandled event type: ${event.type}`);
    }

    // Mark event as processed
    await db.query(`
      UPDATE stripe_events
      SET processed = TRUE, processed_at = NOW()
      WHERE id = $1
    `, [eventId]);

    res.json({ received: true });

  } catch (error) {
    console.error('❌ [Stripe Webhook] Error:', error.message);
    return res.status(400).json({ error: 'Webhook error' });
  }
});

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

module.exports = router;
