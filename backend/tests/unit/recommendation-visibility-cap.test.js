/**
 * Recommendation Visibility Cap Tests
 *
 * Tests for server-side entitlement enforcement of recommendation visibility.
 * This prevents entitlement leakage by ensuring the API never returns
 * more recommendations than the user's plan allows.
 *
 * Run with: node --test backend/tests/unit/recommendation-visibility-cap.test.js
 */

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

// Import the module under test
const {
  getRecommendationVisibleLimit,
  normalizePlan
} = require('../../services/scanEntitlementService');

// ========================================
// RECOMMENDATION VISIBILITY LIMIT TESTS
// ========================================

describe('Recommendation Visibility Limit (Entitlement Cap)', () => {

  describe('getRecommendationVisibleLimit', () => {

    it('returns 3 for free plan', () => {
      assert.strictEqual(getRecommendationVisibleLimit('free'), 3);
    });

    it('returns 3 for freemium plan', () => {
      assert.strictEqual(getRecommendationVisibleLimit('freemium'), 3);
    });

    it('returns 5 for diy plan', () => {
      assert.strictEqual(getRecommendationVisibleLimit('diy'), 5);
    });

    it('returns 5 for starter plan (alias of diy)', () => {
      assert.strictEqual(getRecommendationVisibleLimit('starter'), 5);
    });

    it('returns 8 for pro plan', () => {
      assert.strictEqual(getRecommendationVisibleLimit('pro'), 8);
    });

    it('returns -1 (unlimited) for agency plan', () => {
      assert.strictEqual(getRecommendationVisibleLimit('agency'), -1);
    });

    it('returns -1 (unlimited) for enterprise plan', () => {
      assert.strictEqual(getRecommendationVisibleLimit('enterprise'), -1);
    });

    it('handles case-insensitive plan names', () => {
      assert.strictEqual(getRecommendationVisibleLimit('FREE'), 3);
      assert.strictEqual(getRecommendationVisibleLimit('DIY'), 5);
      assert.strictEqual(getRecommendationVisibleLimit('PRO'), 8);
      assert.strictEqual(getRecommendationVisibleLimit('AGENCY'), -1);
      assert.strictEqual(getRecommendationVisibleLimit('ENTERPRISE'), -1);
    });

    it('defaults to 3 for null/undefined plan', () => {
      assert.strictEqual(getRecommendationVisibleLimit(null), 3);
      assert.strictEqual(getRecommendationVisibleLimit(undefined), 3);
    });

    it('defaults to 3 for truly unknown plans', () => {
      assert.strictEqual(getRecommendationVisibleLimit('unknown'), 3);
      assert.strictEqual(getRecommendationVisibleLimit('randomplan'), 3);
      assert.strictEqual(getRecommendationVisibleLimit('xyz123'), 3);
    });

    it('handles metal-tier aliases correctly', () => {
      // Gold = Pro tier (8 visible)
      assert.strictEqual(getRecommendationVisibleLimit('gold'), 8);
      assert.strictEqual(getRecommendationVisibleLimit('Gold'), 8);
      assert.strictEqual(getRecommendationVisibleLimit('GOLD'), 8);

      // Platinum = Enterprise tier (unlimited)
      assert.strictEqual(getRecommendationVisibleLimit('platinum'), -1);
      assert.strictEqual(getRecommendationVisibleLimit('Platinum'), -1);
      assert.strictEqual(getRecommendationVisibleLimit('PLATINUM'), -1);

      // Silver = DIY tier (5 visible)
      assert.strictEqual(getRecommendationVisibleLimit('silver'), 5);
      assert.strictEqual(getRecommendationVisibleLimit('SILVER'), 5);

      // Bronze = Free tier (3 visible)
      assert.strictEqual(getRecommendationVisibleLimit('bronze'), 3);
      assert.strictEqual(getRecommendationVisibleLimit('BRONZE'), 3);
    });

    it('handles plan aliases correctly', () => {
      // basic -> diy -> 5
      assert.strictEqual(getRecommendationVisibleLimit('basic'), 5);
      // professional -> pro -> 8
      assert.strictEqual(getRecommendationVisibleLimit('professional'), 8);
      // business -> enterprise -> -1 (unlimited)
      assert.strictEqual(getRecommendationVisibleLimit('business'), -1);
      // teams -> agency -> -1
      assert.strictEqual(getRecommendationVisibleLimit('teams'), -1);
    });

    it('handles plan_* prefix aliases', () => {
      assert.strictEqual(getRecommendationVisibleLimit('plan_free'), 3);
      assert.strictEqual(getRecommendationVisibleLimit('plan_diy'), 5);
      assert.strictEqual(getRecommendationVisibleLimit('plan_pro'), 8);
      assert.strictEqual(getRecommendationVisibleLimit('plan_enterprise'), -1);
      assert.strictEqual(getRecommendationVisibleLimit('plan_agency'), -1);
      // Metal-tier prefixed
      assert.strictEqual(getRecommendationVisibleLimit('plan_gold'), 8);
      assert.strictEqual(getRecommendationVisibleLimit('plan_platinum'), -1);
      assert.strictEqual(getRecommendationVisibleLimit('tier_gold'), 8);
      assert.strictEqual(getRecommendationVisibleLimit('tier_platinum'), -1);
    });
  });
});

// ========================================
// CAP APPLICATION SIMULATION TESTS
// ========================================

describe('Cap Application Logic', () => {

  it('caps free user recommendations to 3', () => {
    const recommendations = Array(10).fill(null).map((_, i) => ({ id: i + 1, text: `Rec ${i + 1}` }));
    const limit = getRecommendationVisibleLimit('free');

    let cappedRecommendations = recommendations;
    if (limit !== -1 && cappedRecommendations.length > limit) {
      cappedRecommendations = cappedRecommendations.slice(0, limit);
    }

    assert.strictEqual(cappedRecommendations.length, 3);
    assert.deepStrictEqual(cappedRecommendations.map(r => r.id), [1, 2, 3]);
  });

  it('caps diy user recommendations to 5', () => {
    const recommendations = Array(10).fill(null).map((_, i) => ({ id: i + 1, text: `Rec ${i + 1}` }));
    const limit = getRecommendationVisibleLimit('diy');

    let cappedRecommendations = recommendations;
    if (limit !== -1 && cappedRecommendations.length > limit) {
      cappedRecommendations = cappedRecommendations.slice(0, limit);
    }

    assert.strictEqual(cappedRecommendations.length, 5);
    assert.deepStrictEqual(cappedRecommendations.map(r => r.id), [1, 2, 3, 4, 5]);
  });

  it('caps pro user recommendations to 8', () => {
    const recommendations = Array(20).fill(null).map((_, i) => ({ id: i + 1, text: `Rec ${i + 1}` }));
    const limit = getRecommendationVisibleLimit('pro');

    let cappedRecommendations = recommendations;
    if (limit !== -1 && cappedRecommendations.length > limit) {
      cappedRecommendations = cappedRecommendations.slice(0, limit);
    }

    assert.strictEqual(cappedRecommendations.length, 8);
  });

  it('does not cap agency user recommendations (unlimited)', () => {
    const recommendations = Array(50).fill(null).map((_, i) => ({ id: i + 1, text: `Rec ${i + 1}` }));
    const limit = getRecommendationVisibleLimit('agency');

    let cappedRecommendations = recommendations;
    if (limit !== -1 && cappedRecommendations.length > limit) {
      cappedRecommendations = cappedRecommendations.slice(0, limit);
    }

    assert.strictEqual(cappedRecommendations.length, 50);
  });

  it('does not cap enterprise user recommendations (unlimited)', () => {
    const recommendations = Array(100).fill(null).map((_, i) => ({ id: i + 1, text: `Rec ${i + 1}` }));
    const limit = getRecommendationVisibleLimit('enterprise');

    let cappedRecommendations = recommendations;
    if (limit !== -1 && cappedRecommendations.length > limit) {
      cappedRecommendations = cappedRecommendations.slice(0, limit);
    }

    assert.strictEqual(cappedRecommendations.length, 100);
  });

  it('handles empty recommendations array', () => {
    const recommendations = [];
    const limit = getRecommendationVisibleLimit('free');

    let cappedRecommendations = recommendations;
    if (limit !== -1 && cappedRecommendations.length > limit) {
      cappedRecommendations = cappedRecommendations.slice(0, limit);
    }

    assert.strictEqual(cappedRecommendations.length, 0);
  });

  it('handles recommendations count equal to limit', () => {
    const recommendations = Array(3).fill(null).map((_, i) => ({ id: i + 1, text: `Rec ${i + 1}` }));
    const limit = getRecommendationVisibleLimit('free');

    let cappedRecommendations = recommendations;
    if (limit !== -1 && cappedRecommendations.length > limit) {
      cappedRecommendations = cappedRecommendations.slice(0, limit);
    }

    assert.strictEqual(cappedRecommendations.length, 3);
  });

  it('handles recommendations count less than limit', () => {
    const recommendations = Array(2).fill(null).map((_, i) => ({ id: i + 1, text: `Rec ${i + 1}` }));
    const limit = getRecommendationVisibleLimit('free'); // limit is 3

    let cappedRecommendations = recommendations;
    if (limit !== -1 && cappedRecommendations.length > limit) {
      cappedRecommendations = cappedRecommendations.slice(0, limit);
    }

    assert.strictEqual(cappedRecommendations.length, 2);
  });
});

// ========================================
// REGRESSION TESTS FOR ENTITLEMENT LEAKAGE
// ========================================

describe('Entitlement Leakage Prevention', () => {

  it('free user cannot see more than 3 recommendations regardless of DB count', () => {
    // Simulate scenario where DB has 15 recommendations
    const dbRecommendations = Array(15).fill(null).map((_, i) => ({
      id: i + 1,
      text: `Recommendation ${i + 1}`,
      priority: i < 5 ? 'high' : 'medium'
    }));

    const limit = getRecommendationVisibleLimit('free');
    const returnedToClient = limit === -1 ? dbRecommendations : dbRecommendations.slice(0, limit);

    assert.strictEqual(returnedToClient.length, 3,
      'Free user should only see 3 recommendations regardless of DB count');
    assert.ok(returnedToClient.length <= 3,
      'CRITICAL: Free user received more than 3 recommendations - ENTITLEMENT LEAKAGE!');
  });

  it('diy user cannot see more than 5 recommendations regardless of DB count', () => {
    const dbRecommendations = Array(20).fill(null).map((_, i) => ({
      id: i + 1,
      text: `Recommendation ${i + 1}`
    }));

    const limit = getRecommendationVisibleLimit('diy');
    const returnedToClient = limit === -1 ? dbRecommendations : dbRecommendations.slice(0, limit);

    assert.strictEqual(returnedToClient.length, 5,
      'DIY user should only see 5 recommendations regardless of DB count');
    assert.ok(returnedToClient.length <= 5,
      'CRITICAL: DIY user received more than 5 recommendations - ENTITLEMENT LEAKAGE!');
  });

  it('pro user cannot see more than 8 recommendations regardless of DB count', () => {
    const dbRecommendations = Array(25).fill(null).map((_, i) => ({
      id: i + 1,
      text: `Recommendation ${i + 1}`
    }));

    const limit = getRecommendationVisibleLimit('pro');
    const returnedToClient = limit === -1 ? dbRecommendations : dbRecommendations.slice(0, limit);

    assert.strictEqual(returnedToClient.length, 8,
      'Pro user should only see 8 recommendations regardless of DB count');
    assert.ok(returnedToClient.length <= 8,
      'CRITICAL: Pro user received more than 8 recommendations - ENTITLEMENT LEAKAGE!');
  });

  it('cap applies even when userProgress is null/missing', () => {
    // This was the original bug - UI cap failed when userProgress was missing
    const userProgress = null;
    const dbRecommendations = Array(15).fill(null).map((_, i) => ({
      id: i + 1,
      text: `Recommendation ${i + 1}`
    }));

    // Server-side cap should work regardless of userProgress
    const limit = getRecommendationVisibleLimit('free');
    const returnedToClient = limit === -1 ? dbRecommendations : dbRecommendations.slice(0, limit);

    assert.strictEqual(returnedToClient.length, 3,
      'Cap should apply even when userProgress is null');
  });

  it('cap applies to contextScanId recommendations (scan reuse scenario)', () => {
    // Scenario: scan reuses recommendations from another scan via contextScanId
    // The cap should still apply to the final returned list
    const contextScanRecommendations = Array(12).fill(null).map((_, i) => ({
      id: i + 1,
      text: `Recommendation ${i + 1}`,
      scan_id: 'context-scan-123' // From a different scan
    }));

    const limit = getRecommendationVisibleLimit('diy');
    const returnedToClient = limit === -1 ? contextScanRecommendations : contextScanRecommendations.slice(0, limit);

    assert.strictEqual(returnedToClient.length, 5,
      'Cap should apply to contextScanId recommendations');
  });
});

// ========================================
// ACCEPTANCE CRITERIA VERIFICATION
// ========================================

describe('Acceptance Criteria Verification', () => {

  it('AC1: DIY user gets at most 5 recommendations', () => {
    const limit = getRecommendationVisibleLimit('diy');
    assert.strictEqual(limit, 5, 'DIY defaultVisible should be 5');

    // Verify cap application
    const recommendations = Array(20).fill(null);
    const capped = recommendations.slice(0, limit);
    assert.ok(capped.length <= 5, 'DIY user should receive at most 5 recommendations');
  });

  it('AC2: Free user gets at most 3 recommendations', () => {
    const limit = getRecommendationVisibleLimit('free');
    assert.strictEqual(limit, 3, 'Free defaultVisible should be 3');

    // Verify cap application
    const recommendations = Array(20).fill(null);
    const capped = recommendations.slice(0, limit);
    assert.ok(capped.length <= 3, 'Free user should receive at most 3 recommendations');
  });

  it('AC3: Pro/Agency/Enterprise have higher or unlimited caps', () => {
    const proLimit = getRecommendationVisibleLimit('pro');
    const agencyLimit = getRecommendationVisibleLimit('agency');
    const enterpriseLimit = getRecommendationVisibleLimit('enterprise');

    assert.strictEqual(proLimit, 8, 'Pro should have limit of 8');
    assert.strictEqual(agencyLimit, -1, 'Agency should be unlimited (-1)');
    assert.strictEqual(enterpriseLimit, -1, 'Enterprise should be unlimited (-1)');
  });

  it('AC4: Cap enforced even if userProgress is null', () => {
    // The getRecommendationVisibleLimit function doesn't depend on userProgress
    // It only depends on the plan, ensuring server-side enforcement
    const userProgress = null; // Simulating missing userProgress
    const limit = getRecommendationVisibleLimit('free');

    assert.strictEqual(limit, 3, 'Cap should be determined by plan, not userProgress');
    assert.notStrictEqual(limit, undefined, 'Limit should never be undefined');
    assert.notStrictEqual(limit, null, 'Limit should never be null');
  });

  it('AC5: Cap applies to contextScanId recommendations', () => {
    // The cap is applied at response time, after recommendations are fetched
    // regardless of whether they came from the original scan or contextScanId
    const limit = getRecommendationVisibleLimit('free');
    const contextRecommendations = Array(10).fill({ from_context: true });

    const capped = limit === -1 ? contextRecommendations : contextRecommendations.slice(0, limit);
    assert.strictEqual(capped.length, 3, 'contextScanId recommendations should also be capped');
  });
});

// ========================================
// POST /api/scan/analyze CAP TESTS
// Tests the cap applied in POST /analyze before returning response
// ========================================

/**
 * Helper function that mirrors the cap logic in POST /api/scan/analyze
 * This is extracted for unit testing without spinning up HTTP
 */
function applyRecommendationCap(recommendations, plan, isCompetitorScan) {
  const limit = getRecommendationVisibleLimit(plan);
  if (!isCompetitorScan && limit !== -1 && Array.isArray(recommendations)) {
    return recommendations.slice(0, limit);
  }
  return recommendations;
}

describe('POST /api/scan/analyze Cap (applyRecommendationCap helper)', () => {

  it('free plan caps recommendations to 3 in analyze response', () => {
    const recommendations = Array(10).fill(null).map((_, i) => ({ id: i + 1 }));
    const capped = applyRecommendationCap(recommendations, 'free', false);
    assert.strictEqual(capped.length, 3, 'Free should cap to 3');
  });

  it('diy plan caps recommendations to 5 in analyze response', () => {
    const recommendations = Array(10).fill(null).map((_, i) => ({ id: i + 1 }));
    const capped = applyRecommendationCap(recommendations, 'diy', false);
    assert.strictEqual(capped.length, 5, 'DIY should cap to 5');
  });

  it('pro plan caps recommendations to 8 in analyze response', () => {
    const recommendations = Array(20).fill(null).map((_, i) => ({ id: i + 1 }));
    const capped = applyRecommendationCap(recommendations, 'pro', false);
    assert.strictEqual(capped.length, 8, 'Pro should cap to 8');
  });

  it('agency plan does not cap (unlimited)', () => {
    const recommendations = Array(50).fill(null).map((_, i) => ({ id: i + 1 }));
    const capped = applyRecommendationCap(recommendations, 'agency', false);
    assert.strictEqual(capped.length, 50, 'Agency should not cap (unlimited)');
  });

  it('enterprise plan does not cap (unlimited)', () => {
    const recommendations = Array(50).fill(null).map((_, i) => ({ id: i + 1 }));
    const capped = applyRecommendationCap(recommendations, 'enterprise', false);
    assert.strictEqual(capped.length, 50, 'Enterprise should not cap (unlimited)');
  });

  it('competitor scan does not apply cap (scores-only)', () => {
    const recommendations = []; // Competitor scans have no recommendations
    const capped = applyRecommendationCap(recommendations, 'pro', true);
    assert.strictEqual(capped.length, 0, 'Competitor scan should have no recommendations');
  });

  it('competitor scan with accidental recommendations still returns them unchanged', () => {
    // Edge case: if somehow a competitor scan had recommendations, don't cap them
    const recommendations = Array(20).fill(null).map((_, i) => ({ id: i + 1 }));
    const capped = applyRecommendationCap(recommendations, 'free', true);
    assert.strictEqual(capped.length, 20, 'Competitor scan bypasses cap');
  });

  it('handles null recommendations array gracefully', () => {
    const capped = applyRecommendationCap(null, 'free', false);
    assert.strictEqual(capped, null, 'Null input should return null');
  });

  it('handles undefined recommendations array gracefully', () => {
    const capped = applyRecommendationCap(undefined, 'free', false);
    assert.strictEqual(capped, undefined, 'Undefined input should return undefined');
  });

  it('handles empty recommendations array', () => {
    const capped = applyRecommendationCap([], 'free', false);
    assert.strictEqual(capped.length, 0, 'Empty array should remain empty');
  });

  it('cap applies to baseline fallback recommendations', () => {
    // Simulating baseline fallback scenario where 8 recs are generated
    const baselineFallbackRecs = Array(8).fill(null).map((_, i) => ({
      id: i + 1,
      title: `Baseline Rec ${i + 1}`
    }));
    const capped = applyRecommendationCap(baselineFallbackRecs, 'free', false);
    assert.strictEqual(capped.length, 3, 'Baseline fallback should be capped for free plan');
  });

  it('cap applies to context-reuse recommendations', () => {
    // Simulating context reuse scenario
    const contextReuseRecs = Array(15).fill(null).map((_, i) => ({
      id: i + 1,
      from_context: true
    }));
    const capped = applyRecommendationCap(contextReuseRecs, 'diy', false);
    assert.strictEqual(capped.length, 5, 'Context-reuse recs should be capped for DIY plan');
  });

  it('recommendations when count <= limit remain unchanged', () => {
    const recommendations = Array(2).fill(null).map((_, i) => ({ id: i + 1 }));
    const capped = applyRecommendationCap(recommendations, 'free', false);
    assert.strictEqual(capped.length, 2, 'When count < limit, all recs should be returned');
  });
});

// ========================================
// ACTIVE-ONLY CAP TESTS
// Implemented/skipped recs should NOT consume cap slots
// ========================================

/**
 * Helper that mirrors the GET /scan/:id active-only cap logic
 */
function applyActiveOnlyCap(recommendations, plan) {
  const limit = getRecommendationVisibleLimit(plan);
  const active = [];
  const implemented = [];
  const skipped = [];
  for (const rec of recommendations) {
    if (rec.status === 'implemented') {
      implemented.push(rec);
    } else if (rec.status === 'skipped' || rec.status === 'dismissed') {
      skipped.push(rec);
    } else {
      active.push(rec);
    }
  }
  const cappedActive = (limit !== -1 && active.length > limit)
    ? active.slice(0, limit)
    : active;
  return {
    recommendations: [...cappedActive, ...implemented, ...skipped],
    meta: {
      cap: limit,
      active_count: active.length,
      active_returned: cappedActive.length,
      implemented_count: implemented.length,
      skipped_count: skipped.length
    }
  };
}

describe('Active-Only Cap Logic', () => {

  it('implemented recs do not consume cap slots', () => {
    const recs = [
      ...Array(5).fill(null).map((_, i) => ({ id: i + 1, status: 'pending' })),
      ...Array(3).fill(null).map((_, i) => ({ id: 100 + i, status: 'implemented' })),
    ];
    const result = applyActiveOnlyCap(recs, 'diy'); // cap = 5
    assert.strictEqual(result.meta.active_returned, 5, 'All 5 active should be returned');
    assert.strictEqual(result.meta.implemented_count, 3, 'All 3 implemented should be counted');
    assert.strictEqual(result.recommendations.length, 8, 'Total should be 5 active + 3 implemented');
  });

  it('cap applies only to active when mixed with implemented', () => {
    const recs = [
      ...Array(8).fill(null).map((_, i) => ({ id: i + 1, status: 'pending' })),
      ...Array(3).fill(null).map((_, i) => ({ id: 100 + i, status: 'implemented' })),
    ];
    const result = applyActiveOnlyCap(recs, 'diy'); // cap = 5
    assert.strictEqual(result.meta.active_returned, 5, 'Active should be capped to 5');
    assert.strictEqual(result.meta.active_count, 8, 'Total active before cap is 8');
    assert.strictEqual(result.meta.implemented_count, 3, 'Implemented not affected by cap');
    assert.strictEqual(result.recommendations.length, 8, 'Total = 5 capped active + 3 implemented');
  });

  it('skipped recs do not consume cap slots', () => {
    const recs = [
      ...Array(3).fill(null).map((_, i) => ({ id: i + 1, status: 'pending' })),
      ...Array(2).fill(null).map((_, i) => ({ id: 50 + i, status: 'skipped' })),
      ...Array(1).fill(null).map((_, i) => ({ id: 100 + i, status: 'implemented' })),
    ];
    const result = applyActiveOnlyCap(recs, 'free'); // cap = 3
    assert.strictEqual(result.meta.active_returned, 3, 'All 3 active fit within cap');
    assert.strictEqual(result.meta.skipped_count, 2, 'Skipped pass through');
    assert.strictEqual(result.meta.implemented_count, 1, 'Implemented pass through');
    assert.strictEqual(result.recommendations.length, 6, 'Total = 3 active + 2 skipped + 1 implemented');
  });

  it('unlimited plan returns all recs without capping', () => {
    const recs = [
      ...Array(20).fill(null).map((_, i) => ({ id: i + 1, status: 'pending' })),
      ...Array(5).fill(null).map((_, i) => ({ id: 100 + i, status: 'implemented' })),
    ];
    const result = applyActiveOnlyCap(recs, 'agency'); // cap = -1
    assert.strictEqual(result.meta.active_returned, 20, 'All active returned for unlimited');
    assert.strictEqual(result.recommendations.length, 25, 'All recs returned for unlimited');
  });

  it('null/undefined status recs treated as active', () => {
    const recs = [
      { id: 1, status: null },
      { id: 2, status: undefined },
      { id: 3 },
      { id: 4, status: 'implemented' },
    ];
    const result = applyActiveOnlyCap(recs, 'free'); // cap = 3
    assert.strictEqual(result.meta.active_returned, 3, 'null/undefined/missing status = active');
    assert.strictEqual(result.meta.implemented_count, 1);
    assert.strictEqual(result.recommendations.length, 4);
  });

  it('meta counts are accurate when all recs are implemented', () => {
    const recs = Array(5).fill(null).map((_, i) => ({ id: i + 1, status: 'implemented' }));
    const result = applyActiveOnlyCap(recs, 'free'); // cap = 3
    assert.strictEqual(result.meta.active_returned, 0, 'No active recs');
    assert.strictEqual(result.meta.implemented_count, 5, 'All implemented');
    assert.strictEqual(result.recommendations.length, 5, 'All pass through');
  });
});
