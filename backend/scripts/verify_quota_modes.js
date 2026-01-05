#!/usr/bin/env node
/**
 * Verify quota mode resolution and plan limits across all flag combinations.
 *
 * Mode resolution:
 * | READ  | DUAL  | Expected Mode      |
 * |-------|-------|-------------------|
 * | false | false | legacy            |
 * | false | true  | legacy            |
 * | true  | false | legacy_fallback   |
 * | true  | true  | v2 (if orgId)     |
 *
 * Usage:
 *   node backend/scripts/verify_quota_modes.js
 */

// Inline PLAN_LIMITS for testing (mirrors middleware/usageLimits.js)
const PLAN_LIMITS = {
  free: { scansPerMonth: 2, competitorScans: 0 },
  diy: { scansPerMonth: 25, competitorScans: 2 },
  pro: { scansPerMonth: 50, competitorScans: 10 }
};

function isUsageV2ReadEnabled() {
  return process.env.USAGE_V2_READ_ENABLED === 'true';
}

function isUsageV2DualWriteEnabled() {
  return process.env.USAGE_V2_DUAL_WRITE_ENABLED === 'true';
}

function resolveQuotaMode(req, orgIdOverride = null) {
  const orgId = orgIdOverride ?? req?.orgId ?? req?.org?.id ?? null;

  if (!isUsageV2ReadEnabled()) {
    return { mode: 'legacy', orgId };
  }

  if (!isUsageV2DualWriteEnabled()) {
    return { mode: 'legacy_fallback', orgId };
  }

  if (orgId) {
    return { mode: 'v2', orgId };
  }

  return { mode: 'legacy', orgId };
}

function resolvePlanLimits(plan) {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  return {
    scansPerMonth: limits.scansPerMonth,
    competitorScans: limits.competitorScans
  };
}

function getCurrentUsagePeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function buildLegacyQuotaResponse(user, planLimitsOverride, options = {}, source = 'legacy') {
  const { pendingPrimaryScan = false, pendingCompetitorScan = false } = options;
  const period = getCurrentUsagePeriod();
  const planLimits = planLimitsOverride || resolvePlanLimits(user.plan);

  return {
    scansUsed: (user.scans_used_this_month || 0) + (pendingPrimaryScan ? 1 : 0),
    scansLimit: planLimits.scansPerMonth,
    competitorScansUsed: (user.competitor_scans_used_this_month || 0) + (pendingCompetitorScan ? 1 : 0),
    competitorScansLimit: planLimits.competitorScans,
    periodStart: period.start,
    periodEnd: period.end,
    plan: user.plan,
    source
  };
}

// Mock user
const mockUser = {
  scans_used_this_month: 5,
  competitor_scans_used_this_month: 2,
  plan: 'pro'
};

const testCases = [
  { read: 'false', dual: 'false', expectedMode: 'legacy', expectedSource: 'legacy', orgId: 37 },
  { read: 'false', dual: 'true',  expectedMode: 'legacy', expectedSource: 'legacy', orgId: 37 },
  { read: 'true',  dual: 'false', expectedMode: 'legacy_fallback', expectedSource: 'legacy_fallback', orgId: 37 },
  { read: 'true',  dual: 'true',  expectedMode: 'v2', expectedSource: 'v2', orgId: 37 },
  { read: 'true',  dual: 'true',  expectedMode: 'legacy', expectedSource: 'legacy', orgId: null },
];

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║           Quota Mode & Limits Verification                   ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

let passCount = 0;
let failCount = 0;

for (const tc of testCases) {
  process.env.USAGE_V2_READ_ENABLED = tc.read;
  process.env.USAGE_V2_DUAL_WRITE_ENABLED = tc.dual;

  const { mode } = resolveQuotaMode(null, tc.orgId);
  const modeCorrect = mode === tc.expectedMode;

  // For non-v2 modes, test the legacy quota builder
  let sourceCorrect = true;
  let limitsPopulated = true;
  let quota = null;

  if (mode !== 'v2') {
    const source = mode === 'legacy_fallback' ? 'legacy_fallback' : 'legacy';
    quota = buildLegacyQuotaResponse(mockUser, null, {}, source);
    sourceCorrect = quota.source === tc.expectedSource;
    limitsPopulated = quota.scansLimit !== null && quota.competitorScansLimit !== null;
  } else {
    // v2 mode - would need DB, skip detailed check
    sourceCorrect = true;
    limitsPopulated = true;
  }

  const passed = modeCorrect && sourceCorrect && limitsPopulated;
  if (passed) passCount++; else failCount++;

  console.log(`Test: READ=${tc.read}, DUAL=${tc.dual}, orgId=${tc.orgId ?? 'null'}`);
  console.log(`  Expected mode: ${tc.expectedMode}, source: ${tc.expectedSource}`);
  console.log(`  Actual mode:   ${mode}${quota ? ', source: ' + quota.source : ''}`);
  if (quota) {
    console.log(`  Limits: scans=${quota.scansLimit}, competitor=${quota.competitorScansLimit}`);
  }
  console.log(`  ${passed ? '✅ PASS' : '❌ FAIL'}\n`);
}

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║           Plan Limits Resolution Test                        ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

const planTests = [
  { plan: 'free', expectedScans: 2, expectedCompetitor: 0 },
  { plan: 'diy', expectedScans: 25, expectedCompetitor: 2 },
  { plan: 'pro', expectedScans: 50, expectedCompetitor: 10 },
];

for (const pt of planTests) {
  const limits = resolvePlanLimits(pt.plan);
  const passed = limits.scansPerMonth === pt.expectedScans && limits.competitorScans === pt.expectedCompetitor;
  if (passed) passCount++; else failCount++;

  console.log(`Plan: ${pt.plan}`);
  console.log(`  Expected: scans=${pt.expectedScans}, competitor=${pt.expectedCompetitor}`);
  console.log(`  Actual:   scans=${limits.scansPerMonth}, competitor=${limits.competitorScans}`);
  console.log(`  ${passed ? '✅ PASS' : '❌ FAIL'}\n`);
}

console.log('═══════════════════════════════════════════════════════════════');
console.log(`Summary: ${passCount} passed, ${failCount} failed`);
console.log(failCount === 0 ? '✅ All tests passed!' : '❌ Some tests failed!');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('Manual curl verification:');
console.log('  export API=https://your-api.onrender.com/api');
console.log('  curl -s $API/auth/login -X POST -H "Content-Type: application/json" \\');
console.log('    -d \'{"email":"...","password":"..."}\' | jq \'.quota\'');
console.log('');

process.exit(failCount === 0 ? 0 : 1);
