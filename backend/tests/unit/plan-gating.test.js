/**
 * Phase 4A.2.2: Plan-Based Unlock State Tests
 *
 * Tests for plan normalization, unlock limits, and recommendation sorting.
 *
 * Run with: node --test backend/tests/unit/plan-gating.test.js
 */

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// Mock database module before importing service
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../db/database' || id.endsWith('/db/database')) {
    return {
      query: async () => ({ rows: [] })
    };
  }
  return originalRequire.apply(this, arguments);
};

// Import modules under test (after mocking)
const {
  normalizePlan,
  getUnlockLimit,
  priorityToNumeric,
  compareRecommendations,
  mapRendererOutputToDb
} = require('../../services/scan-recommendations-service');

// ========================================
// PLAN NORMALIZATION TESTS
// ========================================

describe('Plan Normalization (Phase 4A.2.2)', () => {

  describe('normalizePlan', () => {

    it('returns free for null/undefined', () => {
      assert.strictEqual(normalizePlan(null), 'free');
      assert.strictEqual(normalizePlan(undefined), 'free');
      assert.strictEqual(normalizePlan(''), 'free');
    });

    it('normalizes known plans to lowercase', () => {
      assert.strictEqual(normalizePlan('FREE'), 'free');
      assert.strictEqual(normalizePlan('Free'), 'free');
      assert.strictEqual(normalizePlan('DIY'), 'diy');
      assert.strictEqual(normalizePlan('Diy'), 'diy');
      assert.strictEqual(normalizePlan('PRO'), 'pro');
      assert.strictEqual(normalizePlan('Pro'), 'pro');
      assert.strictEqual(normalizePlan('AGENCY'), 'agency');
      assert.strictEqual(normalizePlan('Agency'), 'agency');
      assert.strictEqual(normalizePlan('ENTERPRISE'), 'enterprise');
      assert.strictEqual(normalizePlan('Enterprise'), 'enterprise');
    });

    it('handles freemium plan', () => {
      assert.strictEqual(normalizePlan('freemium'), 'freemium');
      assert.strictEqual(normalizePlan('FREEMIUM'), 'freemium');
    });

    it('aliases starter/basic to free', () => {
      assert.strictEqual(normalizePlan('starter'), 'free');
      assert.strictEqual(normalizePlan('basic'), 'free');
      assert.strictEqual(normalizePlan('STARTER'), 'free');
    });

    it('aliases business to pro', () => {
      assert.strictEqual(normalizePlan('business'), 'pro');
      assert.strictEqual(normalizePlan('BUSINESS'), 'pro');
    });

    it('defaults unknown plans to free', () => {
      assert.strictEqual(normalizePlan('platinum'), 'free');
      assert.strictEqual(normalizePlan('gold'), 'free');
      assert.strictEqual(normalizePlan('xyz123'), 'free');
    });

    it('trims whitespace', () => {
      assert.strictEqual(normalizePlan('  pro  '), 'pro');
      assert.strictEqual(normalizePlan('\tfree\n'), 'free');
    });
  });

  describe('getUnlockLimit', () => {

    it('returns 3 for free plans', () => {
      assert.strictEqual(getUnlockLimit('free'), 3);
      assert.strictEqual(getUnlockLimit('freemium'), 3);
    });

    it('returns 5 for diy plan', () => {
      assert.strictEqual(getUnlockLimit('diy'), 5);
    });

    it('returns Infinity for pro+ plans', () => {
      assert.strictEqual(getUnlockLimit('pro'), Infinity);
      assert.strictEqual(getUnlockLimit('agency'), Infinity);
      assert.strictEqual(getUnlockLimit('enterprise'), Infinity);
    });

    it('defaults to 3 for unknown plans', () => {
      assert.strictEqual(getUnlockLimit('unknown'), 3);
      assert.strictEqual(getUnlockLimit(undefined), 3);
    });
  });
});

// ========================================
// RECOMMENDATION SORTING TESTS
// ========================================

describe('Recommendation Sorting (Phase 4A.2.2)', () => {

  describe('priorityToNumeric', () => {

    it('maps P0/high to 1', () => {
      assert.strictEqual(priorityToNumeric('P0'), 1);
      assert.strictEqual(priorityToNumeric('high'), 1);
    });

    it('maps P1/medium to 2', () => {
      assert.strictEqual(priorityToNumeric('P1'), 2);
      assert.strictEqual(priorityToNumeric('medium'), 2);
    });

    it('maps P2/low to 3', () => {
      assert.strictEqual(priorityToNumeric('P2'), 3);
      assert.strictEqual(priorityToNumeric('low'), 3);
    });

    it('defaults to 2 for unknown values', () => {
      assert.strictEqual(priorityToNumeric('xyz'), 2);
      assert.strictEqual(priorityToNumeric(undefined), 2);
      assert.strictEqual(priorityToNumeric(null), 2);
    });
  });

  describe('compareRecommendations', () => {

    it('sorts by priority first (P0 before P1 before P2)', () => {
      const recs = [
        { priority: 'P2', confidence: 0.9, impact: 'High' },
        { priority: 'P0', confidence: 0.5, impact: 'Low' },
        { priority: 'P1', confidence: 0.7, impact: 'Med' }
      ];

      recs.sort(compareRecommendations);

      assert.strictEqual(recs[0].priority, 'P0');
      assert.strictEqual(recs[1].priority, 'P1');
      assert.strictEqual(recs[2].priority, 'P2');
    });

    it('sorts by confidence within same priority (higher first)', () => {
      const recs = [
        { priority: 'P1', confidence: 0.5, impact: 'Med' },
        { priority: 'P1', confidence: 0.9, impact: 'Med' },
        { priority: 'P1', confidence: 0.7, impact: 'Med' }
      ];

      recs.sort(compareRecommendations);

      assert.strictEqual(recs[0].confidence, 0.9);
      assert.strictEqual(recs[1].confidence, 0.7);
      assert.strictEqual(recs[2].confidence, 0.5);
    });

    it('sorts by impact when priority and confidence are equal', () => {
      const recs = [
        { priority: 'P1', confidence: 0.8, impact: 'Low' },
        { priority: 'P1', confidence: 0.8, impact: 'High' },
        { priority: 'P1', confidence: 0.8, impact: 'Med' }
      ];

      recs.sort(compareRecommendations);

      assert.strictEqual(recs[0].impact, 'High');
      assert.strictEqual(recs[1].impact, 'Med');
      assert.strictEqual(recs[2].impact, 'Low');
    });

    it('handles high/medium/low priority format', () => {
      const recs = [
        { priority: 'low', confidence: 0.9 },
        { priority: 'high', confidence: 0.5 },
        { priority: 'medium', confidence: 0.7 }
      ];

      recs.sort(compareRecommendations);

      assert.strictEqual(recs[0].priority, 'high');
      assert.strictEqual(recs[1].priority, 'medium');
      assert.strictEqual(recs[2].priority, 'low');
    });

    it('handles null/undefined confidence (nulls last)', () => {
      const recs = [
        { priority: 'P1', confidence: null },
        { priority: 'P1', confidence: 0.8 },
        { priority: 'P1', confidence: undefined }
      ];

      recs.sort(compareRecommendations);

      assert.strictEqual(recs[0].confidence, 0.8);
      // null and undefined should come after 0.8
      assert.ok(recs[1].confidence === null || recs[1].confidence === undefined);
      assert.ok(recs[2].confidence === null || recs[2].confidence === undefined);
    });
  });
});

// ========================================
// UNLOCK STATE ASSIGNMENT TESTS
// ========================================

describe('Unlock State Assignment (Phase 4A.2.2)', () => {

  it('Free plan unlocks top 3 recommendations', () => {
    const recs = [
      { pillar: 'Tech', subfactor_key: 'a', priority: 'P0', confidence: 0.9 },
      { pillar: 'Tech', subfactor_key: 'b', priority: 'P0', confidence: 0.8 },
      { pillar: 'Tech', subfactor_key: 'c', priority: 'P1', confidence: 0.7 },
      { pillar: 'Tech', subfactor_key: 'd', priority: 'P1', confidence: 0.6 },
      { pillar: 'Tech', subfactor_key: 'e', priority: 'P2', confidence: 0.5 }
    ];

    // Sort and assign unlock_state as persistence service does
    const plan = normalizePlan('free');
    const limit = getUnlockLimit(plan);
    const sorted = [...recs].sort(compareRecommendations);
    sorted.forEach((r, i) => { r._unlock_state = i < limit ? 'unlocked' : 'locked'; });

    assert.strictEqual(sorted[0]._unlock_state, 'unlocked');
    assert.strictEqual(sorted[1]._unlock_state, 'unlocked');
    assert.strictEqual(sorted[2]._unlock_state, 'unlocked');
    assert.strictEqual(sorted[3]._unlock_state, 'locked');
    assert.strictEqual(sorted[4]._unlock_state, 'locked');
  });

  it('DIY plan unlocks top 5 recommendations', () => {
    const recs = [];
    for (let i = 0; i < 8; i++) {
      recs.push({ pillar: 'Tech', subfactor_key: `rec_${i}`, priority: 'P1', confidence: 0.9 - i * 0.1 });
    }

    const plan = normalizePlan('diy');
    const limit = getUnlockLimit(plan);
    const sorted = [...recs].sort(compareRecommendations);
    sorted.forEach((r, i) => { r._unlock_state = i < limit ? 'unlocked' : 'locked'; });

    // First 5 should be unlocked
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(sorted[i]._unlock_state, 'unlocked', `Rec ${i} should be unlocked`);
    }
    // Remaining should be locked
    for (let i = 5; i < 8; i++) {
      assert.strictEqual(sorted[i]._unlock_state, 'locked', `Rec ${i} should be locked`);
    }
  });

  it('Pro plan unlocks all recommendations', () => {
    const recs = [];
    for (let i = 0; i < 12; i++) {
      recs.push({ pillar: 'Tech', subfactor_key: `rec_${i}`, priority: 'P2', confidence: 0.5 });
    }

    const plan = normalizePlan('pro');
    const limit = getUnlockLimit(plan);
    const sorted = [...recs].sort(compareRecommendations);
    sorted.forEach((r, i) => { r._unlock_state = i < limit ? 'unlocked' : 'locked'; });

    // All should be unlocked
    for (const rec of sorted) {
      assert.strictEqual(rec._unlock_state, 'unlocked');
    }
  });

  it('Agency plan unlocks all recommendations', () => {
    const recs = [];
    for (let i = 0; i < 10; i++) {
      recs.push({ pillar: 'Tech', subfactor_key: `rec_${i}`, priority: 'P1' });
    }

    const plan = normalizePlan('agency');
    const limit = getUnlockLimit(plan);
    const sorted = [...recs].sort(compareRecommendations);
    sorted.forEach((r, i) => { r._unlock_state = i < limit ? 'unlocked' : 'locked'; });

    for (const rec of sorted) {
      assert.strictEqual(rec._unlock_state, 'unlocked');
    }
  });

  it('Enterprise plan unlocks all recommendations', () => {
    const recs = [];
    for (let i = 0; i < 15; i++) {
      recs.push({ pillar: 'Tech', subfactor_key: `rec_${i}`, priority: 'P0' });
    }

    const plan = normalizePlan('enterprise');
    const limit = getUnlockLimit(plan);
    const sorted = [...recs].sort(compareRecommendations);
    sorted.forEach((r, i) => { r._unlock_state = i < limit ? 'unlocked' : 'locked'; });

    for (const rec of sorted) {
      assert.strictEqual(rec._unlock_state, 'unlocked');
    }
  });

  it('Ordering matches GET endpoint (priority, confidence, impact)', () => {
    // Create recs where order should be:
    // 1. P0 with confidence 0.8 (highest priority)
    // 2. P1 with confidence 0.95 (P1, but higher confidence than next P1)
    // 3. P1 with confidence 0.7
    // 4. P2 with high impact
    // 5. P2 with low impact
    const recs = [
      { pillar: 'A', subfactor_key: 'should_be_4th', priority: 'P2', confidence: 0.9, impact: 'High' },
      { pillar: 'A', subfactor_key: 'should_be_1st', priority: 'P0', confidence: 0.8, impact: 'Low' },
      { pillar: 'A', subfactor_key: 'should_be_3rd', priority: 'P1', confidence: 0.7, impact: 'High' },
      { pillar: 'A', subfactor_key: 'should_be_5th', priority: 'P2', confidence: 0.9, impact: 'Low' },
      { pillar: 'A', subfactor_key: 'should_be_2nd', priority: 'P1', confidence: 0.95, impact: 'Low' }
    ];

    const sorted = [...recs].sort(compareRecommendations);

    assert.strictEqual(sorted[0].subfactor_key, 'should_be_1st', 'P0 should be first');
    assert.strictEqual(sorted[1].subfactor_key, 'should_be_2nd', 'P1 with higher confidence second');
    assert.strictEqual(sorted[2].subfactor_key, 'should_be_3rd', 'P1 with lower confidence third');
    assert.strictEqual(sorted[3].subfactor_key, 'should_be_4th', 'P2 with high impact fourth');
    assert.strictEqual(sorted[4].subfactor_key, 'should_be_5th', 'P2 with low impact fifth');
  });

  it('Free user gets correct recs unlocked based on sort order', () => {
    // Same as above, but verify unlock assignment follows sort order
    const recs = [
      { pillar: 'A', subfactor_key: 'should_be_4th', priority: 'P2', confidence: 0.9, impact: 'High' },
      { pillar: 'A', subfactor_key: 'should_be_1st', priority: 'P0', confidence: 0.8, impact: 'Low' },
      { pillar: 'A', subfactor_key: 'should_be_3rd', priority: 'P1', confidence: 0.7, impact: 'High' },
      { pillar: 'A', subfactor_key: 'should_be_5th', priority: 'P2', confidence: 0.9, impact: 'Low' },
      { pillar: 'A', subfactor_key: 'should_be_2nd', priority: 'P1', confidence: 0.95, impact: 'Low' }
    ];

    const plan = normalizePlan('free');
    const limit = getUnlockLimit(plan); // 3
    const sorted = [...recs].sort(compareRecommendations);
    sorted.forEach((r, i) => { r._unlock_state = i < limit ? 'unlocked' : 'locked'; });

    // First 3 (by sort order, not original order) should be unlocked
    assert.strictEqual(sorted[0]._unlock_state, 'unlocked', '1st should be unlocked');
    assert.strictEqual(sorted[1]._unlock_state, 'unlocked', '2nd should be unlocked');
    assert.strictEqual(sorted[2]._unlock_state, 'unlocked', '3rd should be unlocked');
    assert.strictEqual(sorted[3]._unlock_state, 'locked', '4th should be locked');
    assert.strictEqual(sorted[4]._unlock_state, 'locked', '5th should be locked');

    // Verify the actual recs that got unlocked
    const unlocked = sorted.filter(r => r._unlock_state === 'unlocked').map(r => r.subfactor_key);
    assert.deepStrictEqual(unlocked, ['should_be_1st', 'should_be_2nd', 'should_be_3rd']);
  });
});

// ========================================
// MAPPING OUTPUT TESTS
// ========================================

describe('mapRendererOutputToDb (Phase 4A.2.2)', () => {

  it('does not include unlock_state in mapped output', () => {
    const rec = {
      pillar: 'Technical Setup',
      subfactor_key: 'technical_setup.sitemap',
      priority: 'P0',
      confidence: 0.9
    };

    const mapped = mapRendererOutputToDb(rec, 'v5.1');

    // unlock_state should NOT be set by mapRendererOutputToDb anymore
    // It's set by persistScanRecommendations based on plan
    assert.ok(!('unlock_state' in mapped) || mapped.unlock_state === undefined,
      'unlock_state should not be hardcoded in mapping');
  });

  it('includes all other required fields', () => {
    const rec = {
      pillar: 'Technical Setup',
      subfactor_key: 'technical_setup.sitemap',
      gap: 'Missing sitemap',
      why_it_matters: 'Important for crawling',
      priority: 'P0',
      confidence: 0.9,
      evidence_quality: 'strong'
    };

    const mapped = mapRendererOutputToDb(rec, 'v5.1');

    assert.ok(mapped.rec_key, 'rec_key should be set');
    assert.strictEqual(mapped.pillar, 'Technical Setup');
    assert.strictEqual(mapped.subfactor_key, 'technical_setup.sitemap');
    assert.strictEqual(mapped.priority, 'high'); // P0 -> high
    assert.strictEqual(mapped.status, 'pending');
    assert.strictEqual(mapped.recommendation_mode, 'optimization');
  });
});
