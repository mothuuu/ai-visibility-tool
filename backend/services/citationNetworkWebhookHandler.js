/**
 * AI Citation Network Webhook Handler
 *
 * Handles payment webhooks for citation network orders
 *
 * T0-10: Only grants pack allocation when payment_status === 'paid'
 */

const db = require('../db/database');
const config = require('../config/citationNetwork');
const { isActiveSubscriber, getPlanAllocation } = require('../config/citationNetwork');

/**
 * Handle Citation Network payment webhooks
 * Call this from your main Stripe webhook handler
 * @param {Object} event - Stripe webhook event
 * @returns {boolean} - Whether the event was handled
 */
async function handleCitationNetworkWebhook(event) {
  const session = event.data.object;
  const metadata = session.metadata || {};

  // Only handle citation network orders
  if (metadata.product !== 'citation_network' ||
      !metadata.order_id ||
      !['starter', 'pack'].includes(metadata.order_type)) {
    return false; // Not a citation network order
  }

  const orderId = metadata.order_id;

  switch (event.type) {
    case 'checkout.session.completed':
      await handlePaymentSuccess(orderId, session);
      return true;

    case 'checkout.session.expired':
      await handlePaymentExpired(orderId);
      return true;

    default:
      return false;
  }
}

async function handlePaymentSuccess(orderId, session) {
  console.log(`📦 Processing citation network payment for order ${orderId}`);

  // T0-10: CRITICAL - Only grant entitlement if actually paid
  // checkout.session.completed doesn't guarantee payment succeeded
  if (session.payment_status !== 'paid') {
    console.log(`⚠️  [CitationNetwork] Session ${session.id} not paid (status: ${session.payment_status}), skipping order ${orderId}`);
    return;
  }

  // T0-10: Also verify it's a one-time payment (not subscription)
  if (session.mode !== 'payment') {
    console.log(`⚠️  [CitationNetwork] Session ${session.id} is not payment mode (mode: ${session.mode}), skipping order ${orderId}`);
    return;
  }

  console.log(`✅ [CitationNetwork] Payment verified for order ${orderId} (status: paid, mode: payment)`);

  // 1. Update order status
  await db.query(`
    UPDATE directory_orders
    SET status = 'paid',
        paid_at = NOW(),
        stripe_payment_intent_id = $1,
        updated_at = NOW()
    WHERE id = $2
  `, [session.payment_intent, orderId]);

  // 2. Get order details
  const orderResult = await db.query(
    'SELECT * FROM directory_orders WHERE id = $1',
    [orderId]
  );
  const order = orderResult.rows[0];

  if (!order) {
    console.error(`❌ Order ${orderId} not found`);
    return;
  }

  // 3. Handle user creation for guest checkout (starter only)
  let userId = order.user_id;

  if (!userId && session.customer_details?.email) {
    userId = await createOrGetUser(session);

    // Update order with user ID
    await db.query(
      'UPDATE directory_orders SET user_id = $1 WHERE id = $2',
      [userId, orderId]
    );
  }

  // 4. Handle allocation based on order type
  if (order.order_type === 'pack' && userId) {
    await addPackAllocation(userId, order);
  }

  // 5. Mark as processing (ready for submissions)
  await db.query(`
    UPDATE directory_orders
    SET status = 'processing',
        delivery_started_at = NOW()
    WHERE id = $1
  `, [orderId]);

  // 6. Update user's stripe_subscription_status if needed
  if (session.customer) {
    await db.query(`
      UPDATE users
      SET stripe_customer_id = COALESCE(stripe_customer_id, $1),
          updated_at = NOW()
      WHERE id = $2
    `, [session.customer, userId]);
  }

  console.log(`✅ Order ${orderId} processed successfully for user ${userId}`);
}

async function createOrGetUser(session) {
  const email = session.customer_details.email.toLowerCase();

  // Check if user exists
  const existing = await db.query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );

  if (existing.rows.length > 0) {
    // Update with Stripe customer ID if needed
    await db.query(
      'UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, $1) WHERE id = $2',
      [session.customer, existing.rows[0].id]
    );
    return existing.rows[0].id;
  }

  // Create new user with placeholder password (they'll need to set it via email)
  const crypto = require('crypto');
  const tempPassword = crypto.randomBytes(32).toString('hex');

  const newUser = await db.query(`
    INSERT INTO users (email, password_hash, plan, email_verified, stripe_customer_id, created_at)
    VALUES ($1, $2, 'freemium', false, $3, NOW())
    RETURNING id
  `, [email, tempPassword, session.customer]);

  console.log(`👤 Created new user ${newUser.rows[0].id} for email ${email}`);

  // TODO: Send welcome email with password setup link
  // await sendWelcomeEmail(email, newUser.rows[0].id);

  return newUser.rows[0].id;
}

async function addPackAllocation(userId, order) {
  // Get user to check if subscriber
  const userResult = await db.query(
    'SELECT * FROM users WHERE id = $1',
    [userId]
  );

  const user = userResult.rows[0];
  if (!user) {
    console.error(`❌ User ${userId} not found for pack allocation`);
    return;
  }

  // T0-5: Use central isActiveSubscriber function for consistent eligibility check
  const isSubscriber = isActiveSubscriber(user);

  if (isSubscriber) {
    // Add to current month's allocation using DATE_TRUNC for consistency (T0-6)
    const baseAllocation = getPlanAllocation(user.plan);

    await db.query(`
      INSERT INTO subscriber_directory_allocations (
        user_id, period_start, period_end, base_allocation, pack_allocation
      ) VALUES (
        $1,
        DATE_TRUNC('month', NOW())::date,
        (DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 day')::date,
        $2,
        100
      )
      ON CONFLICT (user_id, period_start)
      DO UPDATE SET
        pack_allocation = subscriber_directory_allocations.pack_allocation + 100,
        updated_at = NOW()
    `, [userId, baseAllocation]);

    console.log(`📊 Added pack allocation for subscriber ${userId}`);
  }

  // For non-subscribers, the order itself tracks the allocation
}

async function handlePaymentExpired(orderId) {
  console.log(`⏰ Citation network checkout expired for order ${orderId}`);

  await db.query(`
    UPDATE directory_orders
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE id = $1 AND status = 'pending'
  `, [orderId]);
}

module.exports = { handleCitationNetworkWebhook };
