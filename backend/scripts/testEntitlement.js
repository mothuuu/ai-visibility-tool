#!/usr/bin/env node
/**
 * Test Entitlement Script
 *
 * Usage:
 *   node backend/scripts/testEntitlement.js <userId>
 *   node backend/scripts/testEntitlement.js <userId> --reset  # DEV ONLY: reset allocation
 *   node backend/scripts/testEntitlement.js --email <email>
 *
 * Examples:
 *   node backend/scripts/testEntitlement.js 11
 *   node backend/scripts/testEntitlement.js --email test@xeo.marketing
 *   node backend/scripts/testEntitlement.js 11 --reset
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../db/database');
const entitlementService = require('../services/entitlementService');
const { normalizePlan, isPaidPlan, getPlanAllocation, analyzePlan } = require('../utils/planUtils');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Usage:
  node backend/scripts/testEntitlement.js <userId>
  node backend/scripts/testEntitlement.js --email <email>
  node backend/scripts/testEntitlement.js <userId> --reset  # DEV ONLY

Examples:
  node backend/scripts/testEntitlement.js 11
  node backend/scripts/testEntitlement.js --email test@example.com
`);
    process.exit(0);
  }

  let userId = null;
  let email = null;
  let doReset = args.includes('--reset');

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) {
      email = args[i + 1];
      i++;
    } else if (args[i] !== '--reset' && !isNaN(parseInt(args[i]))) {
      userId = parseInt(args[i]);
    }
  }

  try {
    // If email provided, look up user ID
    if (email && !userId) {
      const userResult = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (userResult.rows.length === 0) {
        console.error(`\n❌ No user found with email: ${email}`);
        process.exit(1);
      }
      userId = userResult.rows[0].id;
      console.log(`\nFound user ID ${userId} for email: ${email}`);
    }

    if (!userId) {
      console.error('\n❌ Please provide a userId or --email');
      process.exit(1);
    }

    console.log('\n' + '='.repeat(60));
    console.log('ENTITLEMENT TEST REPORT');
    console.log('='.repeat(60));
    console.log(`User ID: ${userId}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('='.repeat(60));

    // 1. Get user record
    console.log('\n📋 USER RECORD:');
    const userResult = await db.query(`
      SELECT id, email, plan, stripe_subscription_status, stripe_subscription_id, created_at
      FROM users WHERE id = $1
    `, [userId]);

    if (userResult.rows.length === 0) {
      console.error(`\n❌ User ${userId} not found`);
      process.exit(1);
    }

    const user = userResult.rows[0];
    console.log(`  Email: ${user.email}`);
    console.log(`  Plan (raw): ${user.plan}`);
    console.log(`  Plan (normalized): ${normalizePlan(user.plan)}`);
    console.log(`  Stripe status: ${user.stripe_subscription_status || 'null'}`);
    console.log(`  Stripe sub ID: ${user.stripe_subscription_id ? 'present' : 'null'}`);
    console.log(`  Created: ${user.created_at}`);

    // 2. Plan analysis
    console.log('\n📊 PLAN ANALYSIS:');
    const planInfo = analyzePlan(user.plan);
    console.log(`  Normalized: ${planInfo.normalized}`);
    console.log(`  Is paid plan: ${planInfo.isPaid}`);
    console.log(`  Base allocation: ${planInfo.allocation}/month`);
    console.log(`  Is known plan: ${planInfo.isKnown}`);

    // 3. Current month allocation
    console.log('\n📅 CURRENT MONTH ALLOCATION:');
    const now = new Date();
    const periodStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;

    const allocResult = await db.query(`
      SELECT * FROM subscriber_directory_allocations
      WHERE user_id = $1 AND period_start = $2::date
    `, [userId, periodStart]);

    if (allocResult.rows.length === 0) {
      console.log('  No allocation record exists for this month');
      console.log(`  (Will be auto-created on next entitlement check)`);
    } else {
      const alloc = allocResult.rows[0];
      console.log(`  Period: ${alloc.period_start} to ${alloc.period_end}`);
      console.log(`  Base allocation: ${alloc.base_allocation}`);
      console.log(`  Pack allocation: ${alloc.pack_allocation || 0}`);
      console.log(`  Submissions used: ${alloc.submissions_used}`);
      console.log(`  Remaining: ${alloc.base_allocation + (alloc.pack_allocation || 0) - alloc.submissions_used}`);
      console.log(`  Created: ${alloc.created_at}`);
      console.log(`  Updated: ${alloc.updated_at}`);
    }

    // 4. Order-based allocation
    console.log('\n🛒 ORDER-BASED ALLOCATION:');
    const ordersResult = await db.query(`
      SELECT id, status, directories_allocated, directories_submitted, created_at
      FROM directory_orders
      WHERE user_id = $1 AND status IN ('paid', 'processing', 'in_progress', 'completed')
      ORDER BY created_at DESC
    `, [userId]);

    if (ordersResult.rows.length === 0) {
      console.log('  No active orders found');
    } else {
      let totalAllocated = 0;
      let totalSubmitted = 0;
      for (const order of ordersResult.rows) {
        console.log(`  Order #${order.id}: ${order.directories_allocated} allocated, ${order.directories_submitted} submitted (${order.status})`);
        totalAllocated += order.directories_allocated;
        totalSubmitted += order.directories_submitted;
      }
      console.log(`  Total: ${totalAllocated} allocated, ${totalSubmitted} submitted, ${totalAllocated - totalSubmitted} remaining`);
    }

    // 5. Calculate entitlement
    console.log('\n🎯 ENTITLEMENT CALCULATION:');
    const entitlement = await entitlementService.calculateEntitlement(userId);
    console.log(`  Total: ${entitlement.total}`);
    console.log(`  Used: ${entitlement.used}`);
    console.log(`  Remaining: ${entitlement.remaining}`);
    console.log(`  Source: ${entitlement.source}`);
    console.log(`  Is subscriber: ${entitlement.isSubscriber}`);
    console.log(`  Plan: ${entitlement.plan}`);
    console.log('\n  Breakdown:');
    console.log(`    Subscription: ${entitlement.breakdown.subscription} total, ${entitlement.breakdown.subscriptionRemaining} remaining`);
    console.log(`    Orders: ${entitlement.breakdown.orders} total, ${entitlement.breakdown.ordersRemaining} remaining`);

    // 6. Check for potential issues
    console.log('\n⚠️  POTENTIAL ISSUES:');
    let issueCount = 0;

    if (planInfo.isPaid && !entitlement.isSubscriber) {
      console.log(`  [!] User has paid plan (${planInfo.normalized}) but isSubscriber=false`);
      console.log(`      Stripe status: ${user.stripe_subscription_status}`);
      issueCount++;
    }

    if (entitlement.isSubscriber && entitlement.breakdown.subscription === 0) {
      console.log(`  [!] User is subscriber but subscription allocation is 0`);
      issueCount++;
    }

    if (allocResult.rows.length > 0 && allocResult.rows[0].base_allocation !== planInfo.allocation && planInfo.isPaid) {
      console.log(`  [!] Allocation mismatch: DB has ${allocResult.rows[0].base_allocation}, plan should have ${planInfo.allocation}`);
      issueCount++;
    }

    if (issueCount === 0) {
      console.log('  ✓ No issues detected');
    }

    // 7. Reset option (DEV ONLY)
    if (doReset && allocResult.rows.length > 0) {
      console.log('\n🔄 RESET (DEV ONLY):');
      console.log('  Resetting submissions_used to 0...');

      await db.query(`
        UPDATE subscriber_directory_allocations
        SET submissions_used = 0, updated_at = NOW()
        WHERE user_id = $1 AND period_start = $2::date
      `, [userId, periodStart]);

      console.log('  ✓ Reset complete');

      // Recalculate
      const newEntitlement = await entitlementService.calculateEntitlement(userId);
      console.log(`  New remaining: ${newEntitlement.remaining}`);
    }

    // 8. Directory check
    console.log('\n📂 DIRECTORIES CHECK:');
    const dirResult = await db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = true) as active,
        COUNT(*) FILTER (WHERE is_active = true AND pricing_model IN ('free', 'freemium')) as eligible
      FROM directories
    `);
    const dirs = dirResult.rows[0];
    console.log(`  Total: ${dirs.total}`);
    console.log(`  Active: ${dirs.active}`);
    console.log(`  Eligible (free/freemium): ${dirs.eligible}`);

    if (parseInt(dirs.eligible) === 0) {
      console.log('  ⚠️  WARNING: No eligible directories! Submissions will fail.');
    }

    console.log('\n' + '='.repeat(60));
    console.log('END OF REPORT');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
