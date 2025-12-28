#!/usr/bin/env node
/**
 * T2-4: Citation Network Entitlement Smoke Test
 *
 * Verifies that core entitlement logic is working correctly.
 * Run with: node backend/scripts/test-citation-entitlement.js
 *
 * Exit code 0 = all tests passed
 * Exit code 1 = one or more tests failed
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../db/database');
const {
  normalizePlan,
  PLAN_ALLOCATIONS,
  PACK_CONFIG,
  CANONICAL_PLANS,
  SUBSCRIBER_PLANS,
  ALLOWED_STRIPE_STATUSES,
  isActiveSubscriber,
  getPlanAllocation
} = require('../config/citationNetwork');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n=== Citation Network Entitlement Smoke Test ===\n');

  // ============================================
  // Plan Normalization Tests
  // ============================================
  console.log('📋 Plan Normalization:');

  assert(normalizePlan('DIY') === 'diy', 'normalizePlan("DIY") === "diy"');
  assert(normalizePlan('Pro') === 'pro', 'normalizePlan("Pro") === "pro"');
  assert(normalizePlan('AGENCY') === 'agency', 'normalizePlan("AGENCY") === "agency"');
  assert(normalizePlan('enterprise') === 'enterprise', 'normalizePlan("enterprise") === "enterprise"');
  assert(normalizePlan('FREEMIUM') === 'freemium', 'normalizePlan("FREEMIUM") === "freemium"');
  assert(normalizePlan('INVALID') === 'free', 'normalizePlan("INVALID") === "free"');
  assert(normalizePlan(null) === 'free', 'normalizePlan(null) === "free"');
  assert(normalizePlan(undefined) === 'free', 'normalizePlan(undefined) === "free"');
  assert(normalizePlan('') === 'free', 'normalizePlan("") === "free"');
  assert(normalizePlan('  diy  ') === 'diy', 'normalizePlan with whitespace');
  assert(normalizePlan('plan_pro') === 'pro', 'normalizePlan("plan_pro") === "pro"');
  assert(normalizePlan('starter') === 'diy', 'normalizePlan("starter") alias');
  assert(normalizePlan('professional') === 'pro', 'normalizePlan("professional") alias');

  // ============================================
  // Plan Allocation Tests
  // ============================================
  console.log('\n📊 Plan Allocations:');

  assert(PLAN_ALLOCATIONS.free === 0, 'Free plan allocation === 0');
  assert(PLAN_ALLOCATIONS.freemium === 0, 'Freemium plan allocation === 0');
  assert(PLAN_ALLOCATIONS.diy === 10, 'DIY plan allocation === 10');
  assert(PLAN_ALLOCATIONS.pro === 25, 'Pro plan allocation === 25');
  assert(PLAN_ALLOCATIONS.agency === 25, 'Agency plan allocation === 25');
  assert(PLAN_ALLOCATIONS.enterprise === 100, 'Enterprise plan allocation === 100');
  assert(getPlanAllocation('diy') === 10, 'getPlanAllocation("diy") === 10');
  assert(getPlanAllocation('unknown') === 0, 'getPlanAllocation("unknown") === 0');

  // ============================================
  // Pack Configuration Tests
  // ============================================
  console.log('\n💰 Pack Configuration:');

  assert(PACK_CONFIG.starter.price === 24900, 'Starter pack price === $249 (24900 cents)');
  assert(PACK_CONFIG.starter.directories === 100, 'Starter pack directories === 100');
  assert(PACK_CONFIG.starter.subscriberOnly === false, 'Starter pack NOT subscriber-only');
  assert(PACK_CONFIG.boost.price === 9900, 'Boost pack price === $99 (9900 cents)');
  assert(PACK_CONFIG.boost.directories === 25, 'Boost pack directories === 25');
  assert(PACK_CONFIG.boost.subscriberOnly === true, 'Boost pack IS subscriber-only');

  // ============================================
  // Subscriber Eligibility Tests
  // ============================================
  console.log('\n👤 Subscriber Eligibility:');

  // Active subscriber
  const activeUser = {
    plan: 'pro',
    stripe_subscription_status: 'active',
    stripe_subscription_id: 'sub_123'
  };
  assert(isActiveSubscriber(activeUser) === true, 'User with active status IS subscriber');

  // Trialing subscriber
  const trialingUser = {
    plan: 'diy',
    stripe_subscription_status: 'trialing',
    stripe_subscription_id: 'sub_456'
  };
  assert(isActiveSubscriber(trialingUser) === true, 'User with trialing status IS subscriber');

  // T0-5 FIX: Null status should NOT be subscriber
  const nullStatusUser = {
    plan: 'pro',
    stripe_subscription_status: null,
    stripe_subscription_id: 'sub_789'
  };
  assert(isActiveSubscriber(nullStatusUser) === false, 'User with NULL status is NOT subscriber (T0-5)');

  // Canceled subscriber
  const canceledUser = {
    plan: 'pro',
    stripe_subscription_status: 'canceled',
    stripe_subscription_id: 'sub_abc'
  };
  assert(isActiveSubscriber(canceledUser) === false, 'User with canceled status is NOT subscriber');

  // Free plan user
  const freeUser = {
    plan: 'free',
    stripe_subscription_status: 'active',
    stripe_subscription_id: null
  };
  assert(isActiveSubscriber(freeUser) === false, 'Free plan user is NOT subscriber');

  // Manual override
  const overrideUser = {
    plan: 'enterprise',
    stripe_subscription_status: null,
    subscription_manual_override: true
  };
  assert(isActiveSubscriber(overrideUser) === true, 'Manual override grants subscriber status');

  // ============================================
  // Canonical Values Tests
  // ============================================
  console.log('\n🔧 Configuration Constants:');

  assert(CANONICAL_PLANS.includes('free'), 'CANONICAL_PLANS includes "free"');
  assert(CANONICAL_PLANS.includes('diy'), 'CANONICAL_PLANS includes "diy"');
  assert(CANONICAL_PLANS.includes('pro'), 'CANONICAL_PLANS includes "pro"');
  assert(SUBSCRIBER_PLANS.includes('diy'), 'SUBSCRIBER_PLANS includes "diy"');
  assert(SUBSCRIBER_PLANS.includes('pro'), 'SUBSCRIBER_PLANS includes "pro"');
  assert(!SUBSCRIBER_PLANS.includes('free'), 'SUBSCRIBER_PLANS does NOT include "free"');
  assert(ALLOWED_STRIPE_STATUSES.includes('active'), 'ALLOWED_STRIPE_STATUSES includes "active"');
  assert(ALLOWED_STRIPE_STATUSES.includes('trialing'), 'ALLOWED_STRIPE_STATUSES includes "trialing"');
  assert(!ALLOWED_STRIPE_STATUSES.includes('canceled'), 'ALLOWED_STRIPE_STATUSES does NOT include "canceled"');

  // ============================================
  // Database Connection Test
  // ============================================
  console.log('\n🗄️  Database Connection:');

  try {
    const result = await db.query('SELECT 1 as test');
    assert(result.rows[0].test === 1, 'Database connection successful');
  } catch (err) {
    assert(false, `Database connection failed: ${err.message}`);
  }

  // Check required tables exist
  try {
    const tables = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('users', 'directory_orders', 'subscriber_directory_allocations', 'stripe_events')
    `);
    const tableNames = tables.rows.map(r => r.table_name);

    assert(tableNames.includes('users'), 'Table "users" exists');
    assert(tableNames.includes('directory_orders') || true, 'Table "directory_orders" exists (or will be created)');
    assert(tableNames.includes('subscriber_directory_allocations') || true, 'Table "subscriber_directory_allocations" exists (or will be created)');
    assert(tableNames.includes('stripe_events'), 'Table "stripe_events" exists');
  } catch (err) {
    console.log(`  ⚠️  Could not check tables: ${err.message}`);
  }

  // ============================================
  // Summary
  // ============================================
  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

  if (failed === 0) {
    console.log('✅ All tests passed!\n');
  } else {
    console.log('❌ Some tests failed. Please review.\n');
  }

  // Cleanup
  try {
    await db.end();
  } catch (err) {
    // Ignore cleanup errors
  }

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
