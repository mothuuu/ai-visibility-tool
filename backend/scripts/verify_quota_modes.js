#!/usr/bin/env node
/**
 * Verify quota mode resolution across all flag combinations.
 *
 * This script tests the mode resolution logic to ensure correct
 * mode/source assignment for all flag combinations:
 *
 * | READ  | DUAL  | Expected Mode      |
 * |-------|-------|-------------------|
 * | false | false | legacy            |
 * | false | true  | legacy            |
 * | true  | false | legacy_fallback   |
 * | true  | true  | v2 (if orgId)     |
 *
 * Usage:
 *   node backend/scripts/verify_quota_modes.js
 *
 * For curl-based verification against running server:
 *   # Set flags, restart server, then:
 *   curl -s http://localhost:3000/api/auth/login -X POST \
 *     -H "Content-Type: application/json" \
 *     -d '{"email":"test@example.com","password":"test123"}' \
 *     | jq '.quota.source'
 */

// Inline implementation of the mode resolution logic for testing
// (avoids loading the full module which requires database)

function isUsageV2ReadEnabled() {
  return process.env.USAGE_V2_READ_ENABLED === 'true';
}

function isUsageV2DualWriteEnabled() {
  return process.env.USAGE_V2_DUAL_WRITE_ENABLED === 'true';
}

function resolveQuotaMode(req, orgIdOverride = null) {
  const orgId = orgIdOverride ?? req?.orgId ?? req?.org?.id ?? null;

  // First check: is READ even enabled?
  if (!isUsageV2ReadEnabled()) {
    // READ=false => always legacy mode (regardless of DUAL_WRITE)
    return { mode: 'legacy', orgId };
  }

  // READ=true from here on
  // Check if DUAL_WRITE is also enabled
  if (!isUsageV2DualWriteEnabled()) {
    // READ=true, DUAL=false => legacy_fallback
    return { mode: 'legacy_fallback', orgId };
  }

  // READ=true, DUAL=true
  // v2 mode requires an organization context
  if (orgId) {
    return { mode: 'v2', orgId };
  }

  // READ=true, DUAL=true, but no org => fall back to legacy
  return { mode: 'legacy', orgId };
}

function getCurrentUsagePeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

function buildLegacyQuotaResponse(user, planLimits, options = {}, source = 'legacy') {
  const { pendingPrimaryScan = false, pendingCompetitorScan = false } = options;
  const period = getCurrentUsagePeriod();

  return {
    scansUsed: (user.scans_used_this_month || 0) + (pendingPrimaryScan ? 1 : 0),
    scansLimit: planLimits?.scansPerMonth ?? null,
    competitorScansUsed: (user.competitor_scans_used_this_month || 0) + (pendingCompetitorScan ? 1 : 0),
    competitorScansLimit: planLimits?.competitorScans ?? null,
    periodStart: period.start,
    periodEnd: period.end,
    plan: user.plan,
    source
  };
}

// Mock user for testing
const mockUser = {
  scans_used_this_month: 5,
  competitor_scans_used_this_month: 2,
  plan: 'pro'
};

const testCases = [
  { read: 'false', dual: 'false', expectedMode: 'legacy', orgId: 37, desc: 'Both flags off' },
  { read: 'false', dual: 'true',  expectedMode: 'legacy', orgId: 37, desc: 'READ off, DUAL on' },
  { read: 'true',  dual: 'false', expectedMode: 'legacy_fallback', orgId: 37, desc: 'READ on, DUAL off (unsafe config)' },
  { read: 'true',  dual: 'true',  expectedMode: 'v2', orgId: 37, desc: 'Both flags on with org' },
  { read: 'true',  dual: 'true',  expectedMode: 'legacy', orgId: null, desc: 'Both flags on but no org' },
];

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║           Quota Mode Resolution Verification                 ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

let allPassed = true;
let passCount = 0;
let failCount = 0;

for (const tc of testCases) {
  // Set environment variables
  process.env.USAGE_V2_READ_ENABLED = tc.read;
  process.env.USAGE_V2_DUAL_WRITE_ENABLED = tc.dual;

  const result = resolveQuotaMode(null, tc.orgId);
  const passed = result.mode === tc.expectedMode;

  if (passed) {
    passCount++;
  } else {
    failCount++;
    allPassed = false;
  }

  console.log(`Test: ${tc.desc}`);
  console.log(`  Config: READ=${tc.read}, DUAL=${tc.dual}, orgId=${tc.orgId ?? 'null'}`);
  console.log(`  Expected mode: ${tc.expectedMode}`);
  console.log(`  Actual mode:   ${result.mode}`);
  console.log(`  ${passed ? '✅ PASS' : '❌ FAIL'}\n`);
}

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║           Legacy Quota Source Verification                   ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

const sourceTests = [
  { read: 'false', dual: 'false', expectedSource: 'legacy' },
  { read: 'true',  dual: 'false', expectedSource: 'legacy_fallback' },
];

for (const tc of sourceTests) {
  process.env.USAGE_V2_READ_ENABLED = tc.read;
  process.env.USAGE_V2_DUAL_WRITE_ENABLED = tc.dual;

  const { mode } = resolveQuotaMode(null, 37);
  const source = mode === 'legacy_fallback' ? 'legacy_fallback' : 'legacy';
  const legacyQuota = buildLegacyQuotaResponse(mockUser, null, {}, source);

  const correctSource = legacyQuota.source === tc.expectedSource;
  const hasPeriod = !!legacyQuota.periodStart && !!legacyQuota.periodEnd;

  if (correctSource && hasPeriod) {
    passCount++;
  } else {
    failCount++;
    allPassed = false;
  }

  console.log(`Test: Legacy quota with READ=${tc.read}, DUAL=${tc.dual}`);
  console.log(`  Expected source: ${tc.expectedSource}`);
  console.log(`  Actual source:   ${legacyQuota.source}`);
  console.log(`  Has period dates: ${hasPeriod ? 'yes' : 'no'}`);
  console.log(`  ${correctSource && hasPeriod ? '✅ PASS' : '❌ FAIL'}\n`);
}

console.log('═══════════════════════════════════════════════════════════════');
console.log(`Summary: ${passCount} passed, ${failCount} failed`);
console.log(allPassed ? '✅ All tests passed!' : '❌ Some tests failed!');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('Manual verification with curl:');
console.log('  1. Set flags in .env and restart server');
console.log('  2. Login and check quota.source:');
console.log('     curl -s $API/auth/login -X POST \\');
console.log('       -H "Content-Type: application/json" \\');
console.log('       -d \'{"email":"...","password":"..."}\' | jq \'.quota.source\'');
console.log('  3. Expected sources:');
console.log('     - READ=false, DUAL=false → "legacy"');
console.log('     - READ=true,  DUAL=false → "legacy_fallback"');
console.log('     - READ=true,  DUAL=true  → "v2"\n');

process.exit(allPassed ? 0 : 1);
