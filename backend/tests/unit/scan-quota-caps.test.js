/**
 * Tests for scan quota caps SSOT and enforcement logic.
 *
 * Covers:
 * - scanQuotaCaps.js: PLAN_SCAN_CAPS, normalizePlanForQuota, getMonthlyScanCap
 * - Enforcement logic: free=2 blocks at cap, allows under cap
 * - Idempotency: duplicate scan_id + event_type should not double-count
 * - period_id: free user always gets valid period_id via record_usage_event
 * - Frontend quota consistency
 */

const { PLAN_SCAN_CAPS, normalizePlanForQuota, getMonthlyScanCap } = require('../../config/scanQuotaCaps');
const { canScan, getEntitlements, normalizePlan, SCAN_ENTITLEMENTS } = require('../../services/scanEntitlementService');

// ============================================================================
// scanQuotaCaps.js — SSOT unit tests
// ============================================================================

describe('scanQuotaCaps SSOT', () => {
  test('free plan cap is 2', () => {
    expect(getMonthlyScanCap('free')).toBe(2);
  });

  test('diy plan cap is 25', () => {
    expect(getMonthlyScanCap('diy')).toBe(25);
  });

  test('pro plan cap is 50', () => {
    expect(getMonthlyScanCap('pro')).toBe(50);
  });

  test('agency plan cap is unlimited (-1)', () => {
    expect(getMonthlyScanCap('agency')).toBe(-1);
  });

  test('enterprise plan cap is unlimited (-1)', () => {
    expect(getMonthlyScanCap('enterprise')).toBe(-1);
  });

  test('null/undefined plan defaults to free (2)', () => {
    expect(getMonthlyScanCap(null)).toBe(2);
    expect(getMonthlyScanCap(undefined)).toBe(2);
    expect(getMonthlyScanCap('')).toBe(2);
  });

  test('unknown plan defaults to free (2)', () => {
    expect(getMonthlyScanCap('mystery_plan')).toBe(2);
  });

  test('freemium plan cap is 2', () => {
    expect(getMonthlyScanCap('freemium')).toBe(2);
  });

  test('starter alias resolves to diy (25)', () => {
    expect(getMonthlyScanCap('starter')).toBe(25);
  });
});

describe('normalizePlanForQuota', () => {
  test('normalizes common aliases', () => {
    expect(normalizePlanForQuota('basic')).toBe('diy');
    expect(normalizePlanForQuota('silver')).toBe('diy');
    expect(normalizePlanForQuota('gold')).toBe('pro');
    expect(normalizePlanForQuota('professional')).toBe('pro');
    expect(normalizePlanForQuota('platinum')).toBe('enterprise');
    expect(normalizePlanForQuota('business')).toBe('enterprise');
    expect(normalizePlanForQuota('team')).toBe('agency');
    expect(normalizePlanForQuota('teams')).toBe('agency');
    expect(normalizePlanForQuota('bronze')).toBe('free');
  });

  test('normalizes plan_ prefixed names', () => {
    expect(normalizePlanForQuota('plan_diy')).toBe('diy');
    expect(normalizePlanForQuota('plan_pro')).toBe('pro');
    expect(normalizePlanForQuota('plan_agency')).toBe('agency');
    expect(normalizePlanForQuota('plan_enterprise')).toBe('enterprise');
    expect(normalizePlanForQuota('plan_free')).toBe('free');
    expect(normalizePlanForQuota('plan_starter')).toBe('diy');
  });

  test('case insensitive', () => {
    expect(normalizePlanForQuota('FREE')).toBe('free');
    expect(normalizePlanForQuota('Pro')).toBe('pro');
    expect(normalizePlanForQuota('DIY')).toBe('diy');
  });
});

// ============================================================================
// SSOT consistency: scanQuotaCaps matches scanEntitlementService
// ============================================================================

describe('SSOT consistency: scanQuotaCaps matches scanEntitlementService', () => {
  const plansToCheck = ['free', 'diy', 'pro', 'agency', 'enterprise'];

  plansToCheck.forEach(plan => {
    test(`${plan}: scan cap matches entitlements scans_per_period`, () => {
      const capFromQuotaCaps = getMonthlyScanCap(plan);
      const entitlements = getEntitlements(plan);
      expect(capFromQuotaCaps).toBe(entitlements.scans_per_period);
    });
  });
});

// ============================================================================
// Enforcement logic (canScan from scanEntitlementService)
// ============================================================================

describe('canScan enforcement', () => {
  test('free used=2 cap=2 → blocked', () => {
    const entitlements = getEntitlements('free');
    const usage = { scansUsed: 2, competitorScansUsed: 0 };
    const result = canScan(entitlements, usage, false);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.limit).toBe(2);
    expect(result.used).toBe(2);
  });

  test('free used=1 cap=2 → allowed', () => {
    const entitlements = getEntitlements('free');
    const usage = { scansUsed: 1, competitorScansUsed: 0 };
    const result = canScan(entitlements, usage, false);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  test('free used=0 cap=2 → allowed with remaining=2', () => {
    const entitlements = getEntitlements('free');
    const usage = { scansUsed: 0, competitorScansUsed: 0 };
    const result = canScan(entitlements, usage, false);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  test('free used=3 cap=2 → blocked (over limit)', () => {
    const entitlements = getEntitlements('free');
    const usage = { scansUsed: 3, competitorScansUsed: 0 };
    const result = canScan(entitlements, usage, false);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  test('>= guard: used==cap blocks', () => {
    const entitlements = getEntitlements('diy');
    const usage = { scansUsed: 25, competitorScansUsed: 0 };
    const result = canScan(entitlements, usage, false);
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(25);
    expect(result.limit).toBe(25);
  });

  test('agency (unlimited) always allows', () => {
    const entitlements = getEntitlements('agency');
    const usage = { scansUsed: 999, competitorScansUsed: 0 };
    const result = canScan(entitlements, usage, false);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(-1);
  });

  test('pro user at 49/50 → allowed with remaining=1', () => {
    const entitlements = getEntitlements('pro');
    const usage = { scansUsed: 49, competitorScansUsed: 0 };
    const result = canScan(entitlements, usage, false);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  test('pro user at 50/50 → blocked', () => {
    const entitlements = getEntitlements('pro');
    const usage = { scansUsed: 50, competitorScansUsed: 0 };
    const result = canScan(entitlements, usage, false);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

// ============================================================================
// Competitor scan enforcement
// ============================================================================

describe('competitor scan enforcement', () => {
  test('free has 0 competitor scans', () => {
    const entitlements = getEntitlements('free');
    const usage = { scansUsed: 0, competitorScansUsed: 0 };
    const result = canScan(entitlements, usage, true);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
  });

  test('diy has 1 competitor scan', () => {
    const entitlements = getEntitlements('diy');
    const usage = { scansUsed: 0, competitorScansUsed: 0 };
    const result = canScan(entitlements, usage, true);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(1);
    expect(result.remaining).toBe(1);
  });

  test('diy competitor used=1 → blocked', () => {
    const entitlements = getEntitlements('diy');
    const usage = { scansUsed: 0, competitorScansUsed: 1 };
    const result = canScan(entitlements, usage, true);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

// ============================================================================
// Recommendation caps NOT affected by this change
// ============================================================================

describe('recommendation caps unchanged', () => {
  test('planCaps.js free rec cap is still 3', () => {
    const { PLAN_CAPS } = require('../../config/planCaps');
    expect(PLAN_CAPS.free).toBe(3);
  });

  test('planCaps.js diy rec cap is still 5', () => {
    const { PLAN_CAPS } = require('../../config/planCaps');
    expect(PLAN_CAPS.diy).toBe(5);
  });

  test('planCaps.js pro rec cap is still 8', () => {
    const { PLAN_CAPS } = require('../../config/planCaps');
    expect(PLAN_CAPS.pro).toBe(8);
  });

  test('planCaps.js agency rec cap is unlimited (-1)', () => {
    const { PLAN_CAPS } = require('../../config/planCaps');
    expect(PLAN_CAPS.agency).toBe(-1);
  });
});

// ============================================================================
// usageService.incrementUsageEvent — period_id fix verification
// ============================================================================

describe('usageService incrementUsageEvent uses record_usage_event', () => {
  // This is a code-level verification that the raw INSERT was replaced.
  // We read the source and check it uses the DB function.
  const fs = require('fs');
  const path = require('path');
  const usageServiceSource = fs.readFileSync(
    path.join(__dirname, '../../services/usageService.js'),
    'utf-8'
  );

  test('does NOT use raw INSERT INTO usage_events', () => {
    // The old broken pattern was:
    //   INSERT INTO usage_events (organization_id, user_id, event_type, scan_id, created_at)
    expect(usageServiceSource).not.toMatch(
      /INSERT INTO usage_events\s*\(organization_id,\s*user_id,\s*event_type,\s*scan_id,\s*created_at\)/
    );
  });

  test('uses record_usage_event DB function', () => {
    expect(usageServiceSource).toMatch(/record_usage_event/);
  });

  test('handles unique_violation (23505) for idempotency', () => {
    expect(usageServiceSource).toMatch(/23505/);
  });
});

// ============================================================================
// Migration 014 — idempotency constraint exists
// ============================================================================

describe('idempotency migration exists', () => {
  const fs = require('fs');
  const path = require('path');

  test('014_usage_events_idempotency.sql exists', () => {
    const migrationPath = path.join(
      __dirname, '../../db/migrations/phase1/014_usage_events_idempotency.sql'
    );
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  test('migration creates unique index on (scan_id, event_type)', () => {
    const migrationPath = path.join(
      __dirname, '../../db/migrations/phase1/014_usage_events_idempotency.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toMatch(/UNIQUE INDEX.*uq_usage_events_scan_event/i);
    expect(sql).toMatch(/scan_id.*event_type/);
  });

  test('migration deduplicates before adding constraint', () => {
    const migrationPath = path.join(
      __dirname, '../../db/migrations/phase1/014_usage_events_idempotency.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toMatch(/DELETE FROM usage_events/);
  });

  test('rollback drops the index', () => {
    const rollbackPath = path.join(
      __dirname, '../../db/migrations/phase1/014_usage_events_idempotency_rollback.sql'
    );
    const sql = fs.readFileSync(rollbackPath, 'utf-8');
    expect(sql).toMatch(/DROP INDEX.*uq_usage_events_scan_event/i);
  });
});

// ============================================================================
// Frontend quota.js consistency
// ============================================================================

describe('frontend quota.js plan limits match backend', () => {
  // Read the frontend file and verify the PLAN_LIMITS inside getQuotaFromUser
  const fs = require('fs');
  const path = require('path');
  const quotaSource = fs.readFileSync(
    path.join(__dirname, '../../../frontend/utils/quota.js'),
    'utf-8'
  );

  test('free primary limit is 2', () => {
    expect(quotaSource).toMatch(/free:\s*\{\s*primary:\s*2/);
  });

  test('diy competitor limit is 1 (not 2)', () => {
    expect(quotaSource).toMatch(/diy:\s*\{\s*primary:\s*25,\s*competitor:\s*1\s*\}/);
  });

  test('agency competitor limit is 10', () => {
    expect(quotaSource).toMatch(/agency:\s*\{\s*primary:\s*-1,\s*competitor:\s*10\s*\}/);
  });
});
