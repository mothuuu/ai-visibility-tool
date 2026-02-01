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
 * with dedup, priority ordering, and unlock_state promotion
 */
function applyActiveOnlyCap(recommendations, plan) {
  const limit = getRecommendationVisibleLimit(plan);
  const implemented = [];
  const skipped = [];
  const activePool = [];
  for (const rec of recommendations) {
    if (rec.status === 'implemented') {
      implemented.push(rec);
    } else if (rec.status === 'skipped' || rec.status === 'dismissed') {
      skipped.push(rec);
    } else {
      activePool.push(rec);
    }
  }

  // Dedup: remove titles from active that already appear in implemented
  const norm = (s) => (s || '').toLowerCase().trim();
  const implementedTitles = new Set(
    implemented.map(r => norm(r.recommendation_text))
  );
  const dedupedActive = activePool.filter(r => !implementedTitles.has(norm(r.recommendation_text)));

  // Sort by priority DESC, impact DESC
  const pr = (r) => -(r.priority ?? 0);
  const imp = (r) => -(r.impact_score ?? r.estimated_impact ?? 0);
  dedupedActive.sort((a, b) => pr(a) - pr(b) || imp(a) - imp(b));

  const activeTotal = dedupedActive.length;
  const cappedActive = (limit !== -1 && dedupedActive.length > limit)
    ? dedupedActive.slice(0, limit)
    : dedupedActive;

  // Promote unlock_state
  for (const rec of cappedActive) {
    rec.unlock_state = 'active';
  }

  return {
    recommendations: [...cappedActive, ...implemented, ...skipped],
    meta: {
      cap: limit,
      active_total: activeTotal,
      active_returned: cappedActive.length,
      implemented_count: implemented.length,
      skipped_count: skipped.length
    }
  };
}

describe('Active-Only Cap Logic', () => {

  it('implemented recs do not consume cap slots', () => {
    const recs = [
      ...Array(5).fill(null).map((_, i) => ({ id: i + 1, status: 'pending', recommendation_text: `Active Rec ${i}` })),
      ...Array(3).fill(null).map((_, i) => ({ id: 100 + i, status: 'implemented', recommendation_text: `Impl Rec ${i}` })),
    ];
    const result = applyActiveOnlyCap(recs, 'diy'); // cap = 5
    assert.strictEqual(result.meta.active_returned, 5, 'All 5 active should be returned');
    assert.strictEqual(result.meta.implemented_count, 3, 'All 3 implemented should be counted');
    assert.strictEqual(result.recommendations.length, 8, 'Total should be 5 active + 3 implemented');
  });

  it('cap applies only to active when mixed with implemented', () => {
    const recs = [
      ...Array(8).fill(null).map((_, i) => ({ id: i + 1, status: 'pending', recommendation_text: `Active Rec ${i}` })),
      ...Array(3).fill(null).map((_, i) => ({ id: 100 + i, status: 'implemented', recommendation_text: `Impl Rec ${i}` })),
    ];
    const result = applyActiveOnlyCap(recs, 'diy'); // cap = 5
    assert.strictEqual(result.meta.active_returned, 5, 'Active should be capped to 5');
    assert.strictEqual(result.meta.active_total, 8, 'Total active before cap is 8');
    assert.strictEqual(result.meta.implemented_count, 3, 'Implemented not affected by cap');
    assert.strictEqual(result.recommendations.length, 8, 'Total = 5 capped active + 3 implemented');
  });

  it('skipped recs do not consume cap slots', () => {
    const recs = [
      ...Array(3).fill(null).map((_, i) => ({ id: i + 1, status: 'pending', recommendation_text: `Active Rec ${i}` })),
      ...Array(2).fill(null).map((_, i) => ({ id: 50 + i, status: 'skipped', recommendation_text: `Skipped Rec ${i}` })),
      ...Array(1).fill(null).map((_, i) => ({ id: 100 + i, status: 'implemented', recommendation_text: `Impl Rec ${i}` })),
    ];
    const result = applyActiveOnlyCap(recs, 'free'); // cap = 3
    assert.strictEqual(result.meta.active_returned, 3, 'All 3 active fit within cap');
    assert.strictEqual(result.meta.skipped_count, 2, 'Skipped pass through');
    assert.strictEqual(result.meta.implemented_count, 1, 'Implemented pass through');
    assert.strictEqual(result.recommendations.length, 6, 'Total = 3 active + 2 skipped + 1 implemented');
  });

  it('unlimited plan returns all recs without capping', () => {
    const recs = [
      ...Array(20).fill(null).map((_, i) => ({ id: i + 1, status: 'pending', recommendation_text: `Active Rec ${i}` })),
      ...Array(5).fill(null).map((_, i) => ({ id: 100 + i, status: 'implemented', recommendation_text: `Impl Rec ${i}` })),
    ];
    const result = applyActiveOnlyCap(recs, 'agency'); // cap = -1
    assert.strictEqual(result.meta.active_returned, 20, 'All active returned for unlimited');
    assert.strictEqual(result.recommendations.length, 25, 'All recs returned for unlimited');
  });

  it('null/undefined status recs treated as active', () => {
    const recs = [
      { id: 1, status: null, recommendation_text: 'Rec A' },
      { id: 2, status: undefined, recommendation_text: 'Rec B' },
      { id: 3, recommendation_text: 'Rec C' },
      { id: 4, status: 'implemented', recommendation_text: 'Impl Rec D' },
    ];
    const result = applyActiveOnlyCap(recs, 'free'); // cap = 3
    assert.strictEqual(result.meta.active_returned, 3, 'null/undefined/missing status = active');
    assert.strictEqual(result.meta.implemented_count, 1);
    assert.strictEqual(result.recommendations.length, 4);
  });

  it('meta counts are accurate when all recs are implemented', () => {
    const recs = Array(5).fill(null).map((_, i) => ({ id: i + 1, status: 'implemented', recommendation_text: `Impl Rec ${i}` }));
    const result = applyActiveOnlyCap(recs, 'free'); // cap = 3
    assert.strictEqual(result.meta.active_returned, 0, 'No active recs');
    assert.strictEqual(result.meta.implemented_count, 5, 'All implemented');
    assert.strictEqual(result.recommendations.length, 5, 'All pass through');
  });
});

// ========================================
// REFILL + DEDUP + ORDERING TESTS
// After COMPLETE resolution, active should refill to cap from pool
// ========================================

describe('Refill After Resolution', () => {

  it('pool 12, 3 implemented, cap=8 => active=8, implemented=3 (refill from pool)', () => {
    const recs = [
      ...Array(12).fill(null).map((_, i) => ({
        id: i + 1,
        status: i < 3 ? 'implemented' : 'pending',
        recommendation_text: i < 3 ? `Impl Rec ${i}` : `Active Rec ${i}`,
        priority: 100 - i,
        unlock_state: i < 5 ? 'active' : 'locked'
      }))
    ];
    const result = applyActiveOnlyCap(recs, 'pro'); // cap = 8
    assert.strictEqual(result.meta.active_returned, 8, 'Active should refill to cap from pool');
    assert.strictEqual(result.meta.implemented_count, 3, 'Implemented count correct');
    assert.strictEqual(result.recommendations.length, 11, 'Total = 8 active + 3 implemented');
    // Verify all returned active have unlock_state promoted
    const returnedActive = result.recommendations.filter(r => r.status !== 'implemented');
    assert.ok(returnedActive.every(r => r.unlock_state === 'active'), 'All active recs should have unlock_state=active');
  });

  it('pool 5, 4 implemented, cap=8 => active=1, implemented=4 (pool smaller than cap)', () => {
    const recs = [
      ...Array(4).fill(null).map((_, i) => ({
        id: i + 1, status: 'implemented', recommendation_text: `Impl Rec ${i}`
      })),
      { id: 5, status: 'pending', recommendation_text: 'Only Active Rec' }
    ];
    const result = applyActiveOnlyCap(recs, 'pro'); // cap = 8
    assert.strictEqual(result.meta.active_returned, 1, 'Only 1 active available');
    assert.strictEqual(result.meta.implemented_count, 4, 'All 4 implemented');
    assert.strictEqual(result.recommendations.length, 5);
  });

  it('pool 15, 0 implemented, cap=5 => active=5 (normal capping)', () => {
    const recs = Array(15).fill(null).map((_, i) => ({
      id: i + 1, status: 'pending', recommendation_text: `Rec ${i}`, priority: 100 - i
    }));
    const result = applyActiveOnlyCap(recs, 'diy'); // cap = 5
    assert.strictEqual(result.meta.active_returned, 5);
    assert.strictEqual(result.meta.active_total, 15);
    assert.strictEqual(result.recommendations.length, 5);
  });

  it('dedup: duplicate title in active and implemented => removed from active', () => {
    const recs = [
      { id: 1, status: 'implemented', recommendation_text: 'Add FAQ Schema Markup' },
      { id: 2, status: 'pending', recommendation_text: 'Add FAQ Schema Markup' }, // duplicate
      { id: 3, status: 'pending', recommendation_text: 'Improve Alt Text Coverage' },
      { id: 4, status: 'pending', recommendation_text: 'Add Organization Schema' },
    ];
    const result = applyActiveOnlyCap(recs, 'free'); // cap = 3
    assert.strictEqual(result.meta.active_returned, 2, 'Duplicate removed, only 2 unique active');
    assert.strictEqual(result.meta.implemented_count, 1);
    // Verify the duplicate title is NOT in active
    const activeRecs = result.recommendations.filter(r => r.status !== 'implemented');
    assert.ok(!activeRecs.some(r => r.recommendation_text === 'Add FAQ Schema Markup'),
      'Duplicate title should not appear in active');
  });

  it('dedup is case-insensitive', () => {
    const recs = [
      { id: 1, status: 'implemented', recommendation_text: 'add faq schema markup' },
      { id: 2, status: 'pending', recommendation_text: 'Add FAQ Schema Markup' }, // same title, different case
      { id: 3, status: 'pending', recommendation_text: 'Unique Rec' },
    ];
    const result = applyActiveOnlyCap(recs, 'free'); // cap = 3
    assert.strictEqual(result.meta.active_returned, 1, 'Case-insensitive dedup removes duplicate');
  });

  it('active preserves priority ordering (higher priority first)', () => {
    const recs = [
      { id: 1, status: 'pending', recommendation_text: 'Low Priority', priority: 10 },
      { id: 2, status: 'pending', recommendation_text: 'High Priority', priority: 90 },
      { id: 3, status: 'pending', recommendation_text: 'Medium Priority', priority: 50 },
    ];
    const result = applyActiveOnlyCap(recs, 'free'); // cap = 3
    const titles = result.recommendations.map(r => r.recommendation_text);
    assert.deepStrictEqual(titles, ['High Priority', 'Medium Priority', 'Low Priority'],
      'Should be sorted by priority DESC');
  });

  it('locked recs get promoted to active when within cap', () => {
    const recs = [
      { id: 1, status: 'implemented', recommendation_text: 'Resolved Item', unlock_state: 'active' },
      { id: 2, status: 'pending', recommendation_text: 'Active Item', unlock_state: 'active', priority: 80 },
      { id: 3, status: 'pending', recommendation_text: 'Locked Item 1', unlock_state: 'locked', priority: 70 },
      { id: 4, status: 'pending', recommendation_text: 'Locked Item 2', unlock_state: 'locked', priority: 60 },
    ];
    const result = applyActiveOnlyCap(recs, 'free'); // cap = 3
    assert.strictEqual(result.meta.active_returned, 3, 'Locked items promoted to fill cap');
    const activeRecs = result.recommendations.filter(r => r.status !== 'implemented');
    assert.ok(activeRecs.every(r => r.unlock_state === 'active'),
      'All returned active recs should have unlock_state=active');
  });

  it('returned list has active first, then implemented', () => {
    const recs = [
      { id: 1, status: 'implemented', recommendation_text: 'Impl A' },
      { id: 2, status: 'pending', recommendation_text: 'Active A', priority: 90 },
      { id: 3, status: 'pending', recommendation_text: 'Active B', priority: 80 },
    ];
    const result = applyActiveOnlyCap(recs, 'free'); // cap = 3
    const activeSlice = result.recommendations.slice(0, 2);
    assert.ok(activeSlice.every(r => r.status !== 'implemented'),
      'Active recs should come before implemented in the array');
    assert.strictEqual(result.recommendations[2].status, 'implemented',
      'Implemented should be at the end');
  });
});
