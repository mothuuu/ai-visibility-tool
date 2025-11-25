const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db/database');
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../middleware/auth');

// Price IDs from your Stripe dashboard
const PRICE_IDS = {
  diy: process.env.STRIPE_PRICE_DIY || 'price_diy_monthly',
  pro: process.env.STRIPE_PRICE_PRO || 'price_pro_monthly',
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || 'price_enterprise_monthly',
  agency: process.env.STRIPE_PRICE_AGENCY || 'price_agency_monthly'
};

// Test endpoint to verify routes are loaded
router.get('/test', (req, res) => {
  res.json({
    message: 'Subscription routes are working!',
    timestamp: new Date().toISOString()
  });
});

// Create Checkout Session - NOW REQUIRES AUTHENTICATION
router.post('/create-checkout-session', authenticateToken, async (req, res) => {
  try {
    console.log('📥 Received create-checkout-session request');
    console.log('Request body:', req.body);
    console.log('User from auth:', req.user);

    const { domain, plan = 'diy' } = req.body;
    const userId = req.user.id;
    const email = req.user.email;

    console.log(`🛒 Checkout request: User ${userId} (${email}) for ${plan} plan`);

    if (!domain) {
      return res.status(400).json({ error: 'Domain required' });
    }

    if (!['diy', 'pro', 'enterprise', 'agency'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Get or create Stripe customer
    let customerId = req.user.stripe_customer_id;
    
    if (!customerId) {
      console.log(`📝 Creating new Stripe customer for user ${userId}`);
      const customer = await stripe.customers.create({
        email: email,
        metadata: { userId: userId.toString(), domain }
      });
      customerId = customer.id;
      
      await db.query(
        'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
        [customerId, userId]
      );
      console.log(`✅ Stripe customer created: ${customerId}`);
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: PRICE_IDS[plan],
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/checkout.html?plan=${plan}`,
      metadata: {
        userId: userId.toString(),
        domain,
        plan
      },
      subscription_data: {
        metadata: {
          userId: userId.toString(),
          domain,
          plan
        }
      }
    });

    console.log(`✅ Checkout session created: ${session.id}`);
    res.json({ url: session.url });
  } catch (error) {
    console.error('❌ Checkout session creation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stripe Webhook Handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`📥 Webhook received: ${event.type} [${event.id}]`);

  try {
    let result;
    switch (event.type) {
      case 'checkout.session.completed':
        result = await handleCheckoutComplete(event.data.object);
        break;
      
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        result = await handleSubscriptionChange(event.data.object);
        break;
      
      case 'invoice.payment_succeeded':
        result = await handlePaymentSuccess(event.data.object);
        break;
      
      case 'invoice.payment_failed':
        result = await handlePaymentFailed(event.data.object);
        break;
      
      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
        return res.json({ received: true });
    }

    console.log(`✅ Webhook ${event.type} processed successfully`);
    res.json({ received: true, result });

  } catch (error) {
    console.error('❌ Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed', details: error.message });
  }
});

// Webhook Handlers
async function handleCheckoutComplete(session) {
  console.log('🎉 Processing checkout.session.completed');
  console.log('Session ID:', session.id);
  console.log('Session metadata:', session.metadata);
  
  const userId = session.metadata.userId;
  const plan = session.metadata.plan;
  const subscriptionId = session.subscription;

  if (!userId) {
    console.error('❌ No userId in session metadata!');
    return { error: 'No userId found' };
  }

  if (!plan) {
    console.error('❌ No plan in session metadata!');
    return { error: 'No plan found' };
  }

  try {
    // Update user plan in database
    const result = await db.query(
      `UPDATE users 
       SET plan = $1, 
           stripe_subscription_id = $2,
           scans_used_this_month = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, email, plan`,
      [plan, subscriptionId, userId]
    );

    if (result.rows.length === 0) {
      console.error('❌ User not found:', userId);
      return { error: 'User not found' };
    }

    const updatedUser = result.rows[0];
    console.log('✅ User plan updated successfully:');
    console.log('   User ID:', updatedUser.id);
    console.log('   Email:', updatedUser.email);
    console.log('   New Plan:', updatedUser.plan);
    console.log('   Subscription ID:', subscriptionId);

    return { userId, success: true };

  } catch (error) {
    console.error('❌ Database update failed:', error);
    throw error;
  }
}

async function handleSubscriptionChange(subscription) {
  console.log('🔄 Processing subscription change');
  console.log('Subscription ID:', subscription.id);
  console.log('Status:', subscription.status);

  const customerId = subscription.customer;

  const userResult = await db.query(
    'SELECT id, email FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.error('❌ No user found for customer:', customerId);
    return { error: 'User not found' };
  }

  const userId = userResult.rows[0].id;
  const userEmail = userResult.rows[0].email;
  const isActive = subscription.status === 'active';

  // Determine plan from price ID (handles upgrades/downgrades via Customer Portal)
  let plan = 'free';
  if (isActive && subscription.items && subscription.items.data && subscription.items.data.length > 0) {
    const priceId = subscription.items.data[0].price.id;
    console.log('📋 Price ID from subscription:', priceId);

    // Match price ID to plan
    if (priceId === PRICE_IDS.pro || priceId === process.env.STRIPE_PRICE_PRO) {
      plan = 'pro';
    } else if (priceId === PRICE_IDS.diy || priceId === process.env.STRIPE_PRICE_DIY) {
      plan = 'diy';
    } else if (priceId === PRICE_IDS.enterprise || priceId === process.env.STRIPE_PRICE_ENTERPRISE) {
      plan = 'enterprise';
    } else if (priceId === PRICE_IDS.agency || priceId === process.env.STRIPE_PRICE_AGENCY) {
      plan = 'agency';
    } else {
      // Fallback to metadata if price ID doesn't match
      plan = subscription.metadata.plan || 'free';
      console.warn('⚠️ Unknown price ID, using metadata fallback:', plan);
    }
  }

  console.log(`📊 Determined plan: ${plan} (active: ${isActive})`);

  try {
    const result = await db.query(
      `UPDATE users
       SET plan = $1,
           stripe_subscription_id = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, email, plan`,
      [plan, subscription.id, userId]
    );

    console.log('✅ Subscription updated for user:', userEmail);
    console.log('   New plan:', plan);
    console.log('   Status:', subscription.status);

    return { userId, success: true };

  } catch (error) {
    console.error('❌ Subscription update failed:', error);
    throw error;
  }
}

async function handlePaymentSuccess(invoice) {
  console.log('💳 Processing payment success');
  console.log('Invoice ID:', invoice.id);
  
  const customerId = invoice.customer;
  
  const userResult = await db.query(
    'SELECT id, email FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.error('❌ No user found for customer:', customerId);
    return { error: 'User not found' };
  }

  const userId = userResult.rows[0].id;

  await db.query(
    'UPDATE users SET scans_used_this_month = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [userId]
  );

  console.log('✅ Payment processed for user:', userResult.rows[0].email);
  console.log('   Scans counter reset to 0');

  return { userId, success: true };
}

async function handlePaymentFailed(invoice) {
  console.log('❌ Processing payment failure');
  console.log('Invoice ID:', invoice.id);
  
  const customerId = invoice.customer;
  
  const userResult = await db.query(
    'SELECT id, email FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.error('❌ No user found for customer:', customerId);
    return { error: 'User not found' };
  }

  console.log('⚠️ Payment failed for user:', userResult.rows[0].email);
  // Don't downgrade immediately - give them grace period
  // Stripe will retry payment automatically

  return { userId: userResult.rows[0].id, success: true };
}

// Get subscription status
router.get('/status', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const result = await db.query(
      `SELECT plan, stripe_subscription_id, scans_used_this_month 
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    let subscriptionStatus = null;

    if (user.stripe_subscription_id) {
      const subscription = await stripe.subscriptions.retrieve(
        user.stripe_subscription_id
      );
      subscriptionStatus = {
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end
      };
    }

    res.json({
      plan: user.plan,
      scansUsed: user.scans_used_this_month,
      subscription: subscriptionStatus
    });
  } catch (error) {
    console.error('Status check failed:', error);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

// Cancel subscription
router.post('/cancel', async (req, res) => {
  try {
    console.log('🚫 [Cancel Subscription] Request received');

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      console.log('❌ [Cancel Subscription] No token provided');
      return res.status(401).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log(`👤 [Cancel Subscription] User ID: ${decoded.userId}`);

    const result = await db.query(
      'SELECT stripe_subscription_id, email FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      console.log('❌ [Cancel Subscription] User not found');
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    if (!user.stripe_subscription_id) {
      console.log(`❌ [Cancel Subscription] No active subscription for user ${user.email}`);
      return res.status(404).json({ error: 'No active subscription' });
    }

    console.log(`📋 [Cancel Subscription] Cancelling subscription: ${user.stripe_subscription_id}`);

    // Cancel at period end (don't cancel immediately)
    const subscription = await stripe.subscriptions.update(
      user.stripe_subscription_id,
      { cancel_at_period_end: true }
    );

    console.log(`✅ [Cancel Subscription] Successfully cancelled for ${user.email}`);
    console.log(`📅 [Cancel Subscription] Period ends: ${new Date(subscription.current_period_end * 1000).toLocaleDateString()}`);

    res.json({
      message: 'Subscription will be cancelled at period end',
      periodEnd: subscription.current_period_end
    });
  } catch (error) {
    console.error('❌ [Cancel Subscription] Failed:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Add this endpoint to backend/routes/subscription.js if it doesn't exist

// Verify session - used by success page to check if webhook has processed
router.post('/verify-session', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check if payment is complete
    if (session.payment_status !== 'paid') {
      return res.json({ verified: false, status: session.payment_status });
    }

    // Get user ID from session metadata
    const userId = session.metadata.userId;

    if (!userId) {
      return res.json({ verified: false, error: 'No user ID in session' });
    }

    // Check if user's plan was upgraded in database
    const result = await db.query(
      'SELECT plan, stripe_subscription_id FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ verified: false, error: 'User not found' });
    }

    const user = result.rows[0];
    const plan = session.metadata.plan;

    // Verify that user's plan matches what they paid for
    if (user.plan === plan && user.stripe_subscription_id === session.subscription) {
      return res.json({
        verified: true,
        plan: user.plan,
        domain: session.metadata.domain
      });
    }

    // Not yet processed by webhook
    return res.json({ verified: false, status: 'processing' });

  } catch (error) {
    console.error('Session verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Get Stripe Customer Portal URL
router.get('/portal', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    console.log('📋 Portal request for user:', userId);

    // Get user's Stripe customer ID
    const result = await db.query(
      'SELECT stripe_customer_id FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].stripe_customer_id) {
      console.log('ℹ️ No Stripe customer ID - redirecting to checkout page');
      // User is on free plan, redirect them to choose a plan
      return res.json({
        url: `${process.env.FRONTEND_URL}/checkout.html`
      });
    }

    const customerId = result.rows[0].stripe_customer_id;
    console.log('✅ Found Stripe customer ID:', customerId);

    // Create Stripe Customer Portal session
    // NOTE: To enable plan upgrades/downgrades in the portal:
    // 1. Go to Stripe Dashboard > Settings > Billing > Customer Portal
    // 2. Enable "Allow customers to switch plans"
    // 3. Select which plans customers can switch to
    console.log('🔄 Creating portal session...');
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.FRONTEND_URL}/dashboard.html`,
    });

    console.log('✅ Portal session created:', session.id);
    res.json({ url: session.url });

  } catch (error) {
    console.error('❌ Portal creation failed:', error.message);
    console.error('Full error:', error);

    // Provide more helpful error messages
    if (error.message && error.message.includes('billing portal')) {
      return res.status(500).json({
        error: 'Stripe Customer Portal is not activated. Please activate it in your Stripe Dashboard under Settings > Billing > Customer Portal.'
      });
    }

    res.status(500).json({ error: 'Failed to create portal session: ' + error.message });
  }
});

module.exports = router;