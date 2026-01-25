/**
 * Model A (Dynamic Top-N No Cooldown) Tests
 *
 * Tests for Phase 4A.3b implementation - Model A behavior.
 * Ensures batch unlock UI and cooldown logic are removed.
 *
 * Run with: node --test backend/tests/unit/model-a-no-cooldown.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Import modules under test
const { filterByTier, TIER_LIMITS } = require('../../analyzers/recommendation-engine/tier-filter');
const { getRecommendationVisibleLimit } = require('../../services/scanEntitlementService');

// ========================================
// MODEL A: NO BATCH UNLOCK TESTS
// ========================================

describe('Model A: No Batch Unlock/Cooldown', () => {

  describe('TIER_LIMITS structure', () => {

    it('DIY tier does not have progressiveUnlock property', () => {
      const diyLimits = TIER_LIMITS.diy;
      assert.strictEqual(diyLimits.progressiveUnlock, undefined,
        'DIY tier should not have progressiveUnlock - Model A uses cap-based logic');
    });

    it('DIY tier does not have unlockIntervalDays property', () => {
      const diyLimits = TIER_LIMITS.diy;
      assert.strictEqual(diyLimits.unlockIntervalDays, undefined,
        'DIY tier should not have unlockIntervalDays - no cooldown in Model A');
    });

    it('DIY tier does not have maxRecommendationsPerUnlock property', () => {
      const diyLimits = TIER_LIMITS.diy;
      assert.strictEqual(diyLimits.maxRecommendationsPerUnlock, undefined,
        'DIY tier should not have maxRecommendationsPerUnlock - use maxRecommendations instead');
    });

    it('DIY tier has maxRecommendations property', () => {
      const diyLimits = TIER_LIMITS.diy;
      assert.strictEqual(diyLimits.maxRecommendations, 5,
        'DIY tier should have maxRecommendations = 5 for Model A cap-based logic');
    });

    it('Pro tier has maxRecommendations property', () => {
      const proLimits = TIER_LIMITS.pro;
      assert.strictEqual(proLimits.maxRecommendations, 300,
        'Pro tier should have maxRecommendations defined');
    });
  });

  describe('filterByTier Model A behavior', () => {

    it('DIY tier returns capped recommendations without unlock timing info', () => {
      const recommendations = Array(10).fill(null).map((_, i) => ({
        id: i + 1,
        title: `Rec ${i + 1}`,
        priorityScore: 100 - i
      }));

      const result = filterByTier(recommendations, null, 'diy', {}, null);

      // Should cap to 5 recommendations
      assert.strictEqual(result.recommendations.length, 5,
        'DIY should return exactly 5 recommendations (cap)');

      // Should NOT have unlock timing info
      assert.strictEqual(result.limits.canUnlockMore, undefined,
        'Model A should not have canUnlockMore property');
      assert.strictEqual(result.limits.daysUntilNextUnlock, undefined,
        'Model A should not have daysUntilNextUnlock property');

      // Should have cap info instead
      assert.strictEqual(result.limits.cap, 5,
        'Model A should report cap in limits');
    });

    it('Free tier returns 3 recommendations', () => {
      const recommendations = Array(10).fill(null).map((_, i) => ({
        id: i + 1,
        title: `Rec ${i + 1}`,
        priorityScore: 100 - i
      }));

      const result = filterByTier(recommendations, null, 'free', {}, null);

      assert.strictEqual(result.recommendations.length, 3,
        'Free should return exactly 3 recommendations');
    });

    it('Pro tier returns up to maxRecommendations', () => {
      const recommendations = Array(20).fill(null).map((_, i) => ({
        id: i + 1,
        title: `Rec ${i + 1}`,
        priorityScore: 100 - i
      }));

      const result = filterByTier(recommendations, null, 'pro', {}, null);

      assert.strictEqual(result.recommendations.length, 20,
        'Pro should return all 20 recommendations (under 300 cap)');
    });

    it('Guest tier returns no recommendations', () => {
      const recommendations = Array(10).fill(null).map((_, i) => ({
        id: i + 1,
        title: `Rec ${i + 1}`,
        priorityScore: 100 - i
      }));

      const result = filterByTier(recommendations, null, 'guest', {}, null);

      assert.strictEqual(result.recommendations.length, 0,
        'Guest should return 0 recommendations');
    });

    it('DIY works correctly even when userProgress is null', () => {
      const recommendations = Array(10).fill(null).map((_, i) => ({
        id: i + 1,
        title: `Rec ${i + 1}`,
        priorityScore: 100 - i
      }));

      // Pass null userProgress - should still work with Model A cap-based logic
      const result = filterByTier(recommendations, null, 'diy', {}, null);

      assert.strictEqual(result.recommendations.length, 5,
        'DIY should return 5 recommendations even with null userProgress');
    });

    it('DIY works correctly with empty userProgress object', () => {
      const recommendations = Array(10).fill(null).map((_, i) => ({
        id: i + 1,
        title: `Rec ${i + 1}`,
        priorityScore: 100 - i
      }));

      // Pass empty userProgress - should still work with Model A cap-based logic
      const result = filterByTier(recommendations, null, 'diy', {}, {});

      assert.strictEqual(result.recommendations.length, 5,
        'DIY should return 5 recommendations even with empty userProgress');
    });
  });
});

// ========================================
// MODEL A: UNIFIED UI BEHAVIOR TESTS
// ========================================

describe('Model A: Unified DIY/Pro UI Behavior', () => {

  it('DIY and Pro use same cap-based recommendation logic', () => {
    const recommendations = Array(15).fill(null).map((_, i) => ({
      id: i + 1,
      title: `Rec ${i + 1}`,
      priorityScore: 100 - i
    }));

    const diyResult = filterByTier(recommendations, null, 'diy', {}, null);
    const proResult = filterByTier(recommendations, null, 'pro', {}, null);

    // Both should use cap-based logic (different caps, same approach)
    assert.strictEqual(diyResult.limits.cap, 5, 'DIY cap should be 5');
    assert.strictEqual(proResult.limits.cap, 300, 'Pro cap should be 300');

    // Neither should have unlock timing info
    assert.strictEqual(diyResult.limits.canUnlockMore, undefined);
    assert.strictEqual(diyResult.limits.daysUntilNextUnlock, undefined);
    assert.strictEqual(proResult.limits.canUnlockMore, undefined);
    assert.strictEqual(proResult.limits.daysUntilNextUnlock, undefined);
  });

  it('Both DIY and Pro recommendations are sorted by priority', () => {
    const recommendations = [
      { id: 1, title: 'Low priority', priorityScore: 10 },
      { id: 2, title: 'High priority', priorityScore: 90 },
      { id: 3, title: 'Medium priority', priorityScore: 50 }
    ];

    const diyResult = filterByTier(recommendations, null, 'diy', {}, null);
    const proResult = filterByTier(recommendations, null, 'pro', {}, null);

    // Both should sort by priorityScore descending
    assert.strictEqual(diyResult.recommendations[0].id, 2, 'DIY should have high priority first');
    assert.strictEqual(proResult.recommendations[0].id, 2, 'Pro should have high priority first');
  });
});

// ========================================
// ENTITLEMENT SERVICE CONSISTENCY TESTS
// ========================================

describe('Entitlement Service Consistency with Model A', () => {

  it('DIY visible limit matches tier-filter cap', () => {
    const entitlementLimit = getRecommendationVisibleLimit('diy');
    const tierFilterCap = TIER_LIMITS.diy.maxRecommendations;

    assert.strictEqual(entitlementLimit, tierFilterCap,
      'Entitlement service and tier-filter should have same DIY cap');
  });

  it('Free visible limit is 3', () => {
    const limit = getRecommendationVisibleLimit('free');
    assert.strictEqual(limit, 3);
  });

  it('Pro visible limit is 10', () => {
    const limit = getRecommendationVisibleLimit('pro');
    assert.strictEqual(limit, 10);
  });

  it('Agency visible limit is unlimited', () => {
    const limit = getRecommendationVisibleLimit('agency');
    assert.strictEqual(limit, -1);
  });

  it('Enterprise visible limit is unlimited', () => {
    const limit = getRecommendationVisibleLimit('enterprise');
    assert.strictEqual(limit, -1);
  });
});

// ========================================
// REGRESSION PREVENTION TESTS
// ========================================

describe('Model A Regression Prevention', () => {

  it('CRITICAL: DIY tier must not use progressive unlock logic', () => {
    // This test ensures we don't accidentally reintroduce progressive unlock
    const diyLimits = TIER_LIMITS.diy;

    // These properties should NOT exist in Model A
    const forbiddenProps = [
      'progressiveUnlock',
      'unlockIntervalDays',
      'maxRecommendationsPerUnlock'
    ];

    for (const prop of forbiddenProps) {
      assert.strictEqual(diyLimits[prop], undefined,
        `REGRESSION: DIY tier has forbidden property "${prop}" - Model A does not use batch unlock!`);
    }
  });

  it('CRITICAL: filterByTier response must not contain unlock timing for DIY', () => {
    const recommendations = Array(10).fill(null).map((_, i) => ({
      id: i + 1,
      title: `Rec ${i + 1}`,
      priorityScore: 100 - i
    }));

    const result = filterByTier(recommendations, null, 'diy', {}, { last_unlock_date: new Date() });

    // These properties should NOT exist in Model A response
    const forbiddenResponseProps = ['canUnlockMore', 'daysUntilNextUnlock'];

    for (const prop of forbiddenResponseProps) {
      assert.strictEqual(result.limits[prop], undefined,
        `REGRESSION: Response contains "${prop}" - Model A should not have unlock timing!`);
    }
  });

  it('CRITICAL: "Next Batch Unlock" concept must not exist in tier features', () => {
    const diyFeatures = TIER_LIMITS.diy;

    // Check that batch unlock language is not in description
    assert.ok(!diyFeatures.description?.includes('every 5 days'),
      'REGRESSION: DIY description mentions "every 5 days" batch unlock!');

    assert.ok(!diyFeatures.description?.includes('unlock'),
      'REGRESSION: DIY description mentions "unlock" which implies batch unlock!');
  });
});

// ========================================
// IMMEDIATE REFILL BEHAVIOR TESTS
// ========================================

describe('Model A: Immediate Refill on Skip/Implement', () => {

  it('Active count stays at cap when recommendations exceed cap', () => {
    // Simulate: User has 10 recommendations, cap is 5
    // After skip/implement, next rec should immediately surface
    const recommendations = Array(10).fill(null).map((_, i) => ({
      id: i + 1,
      title: `Rec ${i + 1}`,
      priorityScore: 100 - i,
      status: i === 0 ? 'skipped' : 'active' // First one is skipped
    }));

    // Filter to active only (simulating what UI does)
    const activeRecs = recommendations.filter(r => r.status === 'active');
    const result = filterByTier(activeRecs, null, 'diy', {}, null);

    assert.strictEqual(result.recommendations.length, 5,
      'After skip, should still show 5 recommendations (cap)');

    // The 6th rec (id=7, since id=1 was skipped) should now be visible
    assert.strictEqual(result.recommendations[4].id, 6,
      'The next highest priority rec should fill the slot');
  });

  it('handles case when fewer recs than cap exist', () => {
    // If user has only 3 recommendations and cap is 5
    const recommendations = Array(3).fill(null).map((_, i) => ({
      id: i + 1,
      title: `Rec ${i + 1}`,
      priorityScore: 100 - i
    }));

    const result = filterByTier(recommendations, null, 'diy', {}, null);

    assert.strictEqual(result.recommendations.length, 3,
      'Should return all available recs when fewer than cap');
  });
});
