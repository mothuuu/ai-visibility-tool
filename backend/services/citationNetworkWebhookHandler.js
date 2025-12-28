/**
 * AI Citation Network Webhook Handler
 *
 * Handles payment webhooks for citation network orders
 *
 * TIER-0 REQUIREMENTS:
 * - Rule 4: Orders remain status='paid' forever. NO 'processing' transitions.
 * - Rule 5: Option B - UPSERT in webhook (checkout pre-creates pending orders)
 * - Rule 6: Uses transaction client from main webhook handler
 * - Rule 10: Only grant on payment_status === 'paid'
 * - Rule 12: Use PACK_CONFIG for directories, not Stripe metadata
 * - Rule 13: Handle async_payment_succeeded; allow NULL payment_intent
 * - Rule 15: Validate metadata.user_id and pack_type before processing
 */

const db = require('../db/database');
const config = require('../config/citationNetwork');
const { PACK_CONFIG, isActiveSubscriber, getPlanAllocation } = require('../config/citationNetwork');

/**
 * Handle Citation Network payment webhooks
 * Called from main Stripe webhook handler with transaction client
 *
 * TIER-0: Receives transaction client for atomic processing
 *
 * @param {Object} event - Stripe webhook event
 * @param {Object} client - Database transaction client (optional, for backward compat)
 * @returns {boolean} - Whether the event was handled
 */
async function handleCitationNetworkWebhook(event, client) {
  const session = event.data.object;
  const metadata = session.metadata || {};

  // Only handle citation network orders
  if (metadata.product !== 'citation_network') {
    return false; // Not a citation network order
  }

  // TIER-0 RULE 15: Validate required metadata fields
  const userId = metadata.user_id;
  const packType = metadata.pack_type || metadata.order_type;

  if (!userId || userId === '' || userId === 'null' || userId === 'undefined') {
    console.error(`❌ [CitationNetwork] Missing or invalid user_id in metadata for session ${session.id}`);
    // Don't return false - this IS a citation network order, just malformed
    // Log and skip to prevent creating orders with NULL user_id
    return true; // Mark as handled to prevent retry loops
  }

  if (!packType || !['starter', 'boost', 'pack'].includes(packType)) {
    console.error(`❌ [CitationNetwork] Invalid pack_type "${packType}" in metadata for session ${session.id}`);
    return true; // Mark as handled to prevent retry loops
  }

  // Normalize pack_type: 'pack' is legacy for 'boost'
  const normalizedPackType = packType === 'pack' ? 'boost' : packType;

  switch (event.type) {
    // TIER-0 RULE 13: Handle both completed and async_payment_succeeded
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await handlePaymentSuccess(session, userId, normalizedPackType, client);
      return true;

    case 'checkout.session.expired':
      await handlePaymentExpired(session, client);
      return true;

    default:
      return false;
  }
}

/**
 * Handle successful payment
 *
 * TIER-0:
 * - Rule 4: Set status='paid' ONLY. Never transition to 'processing'.
 * - Rule 5 Option B: UPSERT - checkout pre-creates with status='pending'
 * - Rule 10: Only proceed if payment_status === 'paid'
 * - Rule 12: Get directories from PACK_CONFIG, not from Stripe/DB
 * - Rule 13: payment_intent may be NULL for async payments
 */
async function handlePaymentSuccess(session, userId, packType, client) {
  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  console.log(`📦 [CitationNetwork] Processing payment for user ${userId}, pack ${packType}`);

  // TIER-0 RULE 10: CRITICAL - Only grant entitlement if actually paid
  if (session.payment_status !== 'paid') {
    console.log(`⚠️  [CitationNetwork] Session ${session.id} not paid (status: ${session.payment_status}), skipping`);
    return;
  }

  // Verify it's a one-time payment (not subscription)
  if (session.mode !== 'payment') {
    console.log(`⚠️  [CitationNetwork] Session ${session.id} is not payment mode (mode: ${session.mode}), skipping`);
    return;
  }

  console.log(`✅ [CitationNetwork] Payment verified for session ${session.id} (status: paid, mode: payment)`);

  // TIER-0 RULE 12: Get directories from PACK_CONFIG, not from Stripe metadata
  const pack = PACK_CONFIG[packType];
  if (!pack) {
    console.error(`❌ [CitationNetwork] Unknown pack type: ${packType}`);
    return;
  }
  const directoriesAllocated = pack.directories;

  // TIER-0 RULE 5 Option B: UPSERT - checkout pre-creates pending orders
  // If order exists with this session ID, update it to 'paid'
  // If not, create new order (fallback for edge cases)
  //
  // TIER-0 RULE 4: Set status='paid' ONLY. Orders stay 'paid' forever.
  // Usage is tracked via directories_submitted < directories_allocated.
  //
  // TIER-0 RULE 13: payment_intent may be NULL for async payments
  const upsertResult = await queryFn(`
    INSERT INTO directory_orders (
      user_id,
      pack_type,
      order_type,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      amount_cents,
      directories_allocated,
      directories_submitted,
      status,
      paid_at,
      created_at,
      updated_at
    ) VALUES (
      $1, $2, $2, $3, $4, $5, $6, 0, 'paid', NOW(), NOW(), NOW()
    )
    ON CONFLICT (stripe_checkout_session_id)
    DO UPDATE SET
      status = 'paid',
      paid_at = COALESCE(directory_orders.paid_at, NOW()),
      stripe_payment_intent_id = COALESCE($4, directory_orders.stripe_payment_intent_id),
      directories_allocated = $6,
      updated_at = NOW()
    WHERE directory_orders.status = 'pending'
    RETURNING id, user_id
  `, [
    userId,
    packType,
    session.id,
    session.payment_intent || null, // RULE 13: May be NULL
    session.amount_total || pack.price,
    directoriesAllocated
  ]);

  if (upsertResult.rows.length === 0) {
    // Order already paid (idempotent - this is fine)
    console.log(`ℹ️  [CitationNetwork] Order for session ${session.id} already paid, skipping`);
    return;
  }

  const orderId = upsertResult.rows[0].id;
  const orderUserId = upsertResult.rows[0].user_id;

  console.log(`✅ [CitationNetwork] Order ${orderId} marked as paid for user ${orderUserId}`);

  // Handle pack allocation for subscribers
  if (packType === 'boost') {
    await addPackAllocation(orderUserId, directoriesAllocated, queryFn);
  }

  // Update user's stripe_customer_id if provided
  if (session.customer) {
    await queryFn(`
      UPDATE users
      SET stripe_customer_id = COALESCE(stripe_customer_id, $1),
          updated_at = NOW()
      WHERE id = $2
    `, [session.customer, orderUserId]);
  }

  console.log(`✅ [CitationNetwork] Order ${orderId} processed successfully for user ${orderUserId}`);
}

/**
 * Add pack allocation for subscribers
 * For non-subscribers, the order itself tracks allocation
 *
 * TIER-0 RULE 10: Use GREATEST() for upgrades (rule 10 says upgrades immediate)
 */
async function addPackAllocation(userId, directories, queryFn) {
  // Get user to check if subscriber
  const userResult = await queryFn(
    'SELECT id, plan, stripe_subscription_status, subscription_manual_override FROM users WHERE id = $1',
    [userId]
  );

  const user = userResult.rows[0];
  if (!user) {
    console.error(`❌ [CitationNetwork] User ${userId} not found for pack allocation`);
    return;
  }

  // Only add to subscriber_directory_allocations for active subscribers
  const isSubscriber = isActiveSubscriber(user);

  if (isSubscriber) {
    const baseAllocation = getPlanAllocation(user.plan);

    // TIER-0 RULE 10: Use GREATEST for immediate upgrades
    await queryFn(`
      INSERT INTO subscriber_directory_allocations (
        user_id, period_start, period_end, base_allocation, pack_allocation
      ) VALUES (
        $1,
        DATE_TRUNC('month', NOW())::date,
        (DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 day')::date,
        GREATEST($2, 0),
        $3
      )
      ON CONFLICT (user_id, period_start)
      DO UPDATE SET
        base_allocation = GREATEST(subscriber_directory_allocations.base_allocation, $2),
        pack_allocation = subscriber_directory_allocations.pack_allocation + $3,
        updated_at = NOW()
    `, [userId, baseAllocation, directories]);

    console.log(`📊 [CitationNetwork] Added ${directories} pack allocation for subscriber ${userId}`);
  } else {
    console.log(`ℹ️  [CitationNetwork] User ${userId} is not subscriber, allocation tracked in order`);
  }
}

/**
 * Handle expired checkout session
 */
async function handlePaymentExpired(session, client) {
  const queryFn = client ? client.query.bind(client) : db.query.bind(db);

  console.log(`⏰ [CitationNetwork] Checkout expired for session ${session.id}`);

  // Only cancel pending orders (don't touch paid ones)
  await queryFn(`
    UPDATE directory_orders
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE stripe_checkout_session_id = $1
      AND status = 'pending'
  `, [session.id]);
}

module.exports = { handleCitationNetworkWebhook };
