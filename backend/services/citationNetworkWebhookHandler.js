/**
 * AI Citation Network Webhook Handler
 *
 * Handles payment webhooks for citation network orders
 */

const db = require('../db/database');
const config = require('../config/citationNetwork');

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
  console.log(`📦 Processing citation network payment success for order ${orderId}`);

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
  const user = await db.query(
    'SELECT plan, stripe_subscription_status, stripe_subscription_id FROM users WHERE id = $1',
    [userId]
  );

  const isPaidPlan = ['diy', 'pro', 'enterprise', 'agency'].includes(user.rows[0]?.plan);
  const isSubscriber = isPaidPlan && (
    user.rows[0]?.stripe_subscription_status === 'active' ||
    user.rows[0]?.stripe_subscription_id
  );

  if (isSubscriber) {
    // Add to current month's allocation
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Get base allocation for plan
    const baseAllocation = config.planAllocations[user.rows[0].plan] || 0;

    await db.query(`
      INSERT INTO subscriber_directory_allocations (
        user_id, period_start, period_end, base_allocation, pack_allocation
      ) VALUES ($1, $2, $3, $4, 100)
      ON CONFLICT (user_id, period_start)
      DO UPDATE SET
        pack_allocation = subscriber_directory_allocations.pack_allocation + 100,
        updated_at = NOW()
    `, [userId, periodStart, periodEnd, baseAllocation]);

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
