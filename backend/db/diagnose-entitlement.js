/**
 * Diagnose Entitlement Issues
 * Run: node db/diagnose-entitlement.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('./database');

async function diagnose() {
  try {
    console.log('=== ENTITLEMENT DIAGNOSIS ===\n');

    // 1. Check all users with their plans
    console.log('1. All Users with Plans:');
    const users = await db.query(`
      SELECT id, email, plan, stripe_subscription_status, stripe_subscription_id
      FROM users
      ORDER BY id
    `);
    console.table(users.rows);

    // 2. Check subscriber_directory_allocations table
    console.log('\n2. Subscriber Directory Allocations:');
    const allocations = await db.query(`SELECT * FROM subscriber_directory_allocations ORDER BY period_start DESC`);
    if (allocations.rows.length === 0) {
      console.log('   ❌ NO ALLOCATIONS FOUND');
    } else {
      console.table(allocations.rows);
    }

    // 3. Check directory_orders table
    console.log('\n3. Directory Orders:');
    const orders = await db.query(`SELECT * FROM directory_orders ORDER BY created_at DESC`);
    if (orders.rows.length === 0) {
      console.log('   ❌ NO ORDERS FOUND');
    } else {
      console.table(orders.rows);
    }

    // 4. Check specific test users
    console.log('\n4. Test/Xeo Users:');
    const testUsers = await db.query(`
      SELECT * FROM users
      WHERE email ILIKE '%xeo%' OR email ILIKE '%test%' OR email ILIKE '%monali%'
    `);
    if (testUsers.rows.length === 0) {
      console.log('   No test users found');
    } else {
      testUsers.rows.forEach(u => {
        console.log(`   User ID: ${u.id}`);
        console.log(`   Email: ${u.email}`);
        console.log(`   Plan: ${u.plan}`);
        console.log(`   Stripe Status: ${u.stripe_subscription_status}`);
        console.log(`   Stripe Sub ID: ${u.stripe_subscription_id}`);
        console.log('   ---');
      });
    }

    // 5. Simulate entitlement check for each user
    console.log('\n5. Simulated Entitlement Check:');
    const PLAN_ALLOCATIONS = {
      freemium: 0,
      free: 0,
      diy: 10,
      pro: 25,
      enterprise: 50,
      agency: 100
    };

    for (const user of users.rows) {
      const isPaidPlan = ['diy', 'pro', 'enterprise', 'agency'].includes(user.plan);
      const isNotCanceled = user.stripe_subscription_status !== 'canceled' &&
                            user.stripe_subscription_status !== 'unpaid' &&
                            user.stripe_subscription_status !== 'past_due';
      const isSubscriber = isPaidPlan && isNotCanceled;
      const baseAllocation = PLAN_ALLOCATIONS[user.plan] || 0;

      console.log(`   User ${user.id} (${user.email}):`);
      console.log(`     plan: "${user.plan}" | isPaidPlan: ${isPaidPlan}`);
      console.log(`     stripe_status: "${user.stripe_subscription_status}" | isNotCanceled: ${isNotCanceled}`);
      console.log(`     isSubscriber: ${isSubscriber} | baseAllocation: ${baseAllocation}`);

      if (isSubscriber) {
        // Check if allocation exists for this month
        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const alloc = await db.query(`
          SELECT * FROM subscriber_directory_allocations
          WHERE user_id = $1 AND period_start = $2
        `, [user.id, periodStart]);

        if (alloc.rows.length === 0) {
          console.log(`     ⚠️  NO ALLOCATION RECORD for this month (would be auto-created)`);
        } else {
          console.log(`     ✓ Has allocation: ${alloc.rows[0].base_allocation} base, ${alloc.rows[0].submissions_used} used`);
        }
      }
      console.log('');
    }

    console.log('\n=== END DIAGNOSIS ===');

  } catch (error) {
    console.error('Diagnosis error:', error);
  } finally {
    process.exit(0);
  }
}

diagnose();
