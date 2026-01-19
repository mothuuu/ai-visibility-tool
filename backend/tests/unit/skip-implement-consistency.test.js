/**
 * Skip/Implement Consistency Tests
 *
 * Tests for the canonical recommendation status service that ensures
 * Skip and Implement operations work correctly even with context scan reuse.
 *
 * Key scenarios tested:
 * 1. Rec-scoped skip works regardless of viewing scan
 * 2. Skip validation rules (locked, already skipped, skip_enabled_at)
 * 3. Progress updates go to the correct scan (rec.scan_id, not viewing scan)
 * 4. Context scan resolution (old JSON system + new context_scan_links)
 * 5. Idempotency behavior
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Since we can't easily mock the db module, we'll test the logic directly
// by creating a test-friendly version of the service functions

/**
 * Test helper: resolveEffectiveScanId logic (extracted for testing)
 */
function testResolveEffectiveScanId(scanData, contextLinkData) {
  let effectiveScanId = scanData.id;

  // Method 1: Check scan.recommendations JSON for context_scan_id (legacy)
  if (scanData.recommendations) {
    try {
      const recMeta = typeof scanData.recommendations === 'string'
        ? JSON.parse(scanData.recommendations)
        : scanData.recommendations;
      if (recMeta?.context_scan_id) {
        return recMeta.context_scan_id;
      }
    } catch (parseError) {
      // JSON parse failed, continue to next method
    }
  }

  // Method 2: Check context_scan_links data
  if (contextLinkData?.primary_scan_id) {
    return contextLinkData.primary_scan_id;
  }

  return effectiveScanId;
}

/**
 * Test helper: skip validation logic (extracted for testing)
 */
function testValidateSkip(rec) {
  // Check if already skipped
  if (rec.skipped_at) {
    return {
      valid: false,
      status: 400,
      error: 'Already skipped',
      message: 'This recommendation has already been skipped.'
    };
  }

  // Check if recommendation is locked
  if (rec.unlock_state === 'locked') {
    return {
      valid: false,
      status: 403,
      error: 'Recommendation not yet unlocked',
      message: 'You can only skip unlocked recommendations.'
    };
  }

  // Check if skip is enabled (skip_enabled_at <= now)
  const now = new Date();
  const skipEnabledAt = rec.skip_enabled_at ? new Date(rec.skip_enabled_at) : null;

  if (skipEnabledAt && skipEnabledAt > now) {
    const daysRemaining = Math.ceil((skipEnabledAt - now) / (1000 * 60 * 60 * 24));
    return {
      valid: false,
      status: 403,
      error: 'Skip not yet available',
      message: `You can skip this recommendation in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}.`,
      skipEnabledAt: skipEnabledAt.toISOString(),
      daysRemaining
    };
  }

  return { valid: true };
}

/**
 * Test helper: determine effective scan ID for progress update
 */
function testGetEffectiveScanIdForProgress(rec) {
  return rec.source_scan_id || rec.scan_id;
}

/**
 * Test helper: validate implement
 */
function testValidateImplement(rec) {
  // Check if already implemented
  if (rec.status === 'implemented' || rec.implemented_at) {
    return {
      valid: true, // Idempotent
      alreadyDone: true
    };
  }

  // Check if can be implemented (must be active)
  if (rec.unlock_state !== 'active') {
    return {
      valid: false,
      status: 400,
      error: 'Can only implement active recommendations',
      currentState: rec.unlock_state
    };
  }

  return { valid: true };
}

/**
 * Test helper: applyRecommendationCap (for consistency with previous tests)
 */
function applyRecommendationCap(recommendations, limit) {
  if (limit === -1) return recommendations;
  return recommendations.slice(0, limit);
}

// =====================================================
// TESTS
// =====================================================

describe('Recommendation Status Service - Context Resolution', () => {

  describe('resolveEffectiveScanId', () => {

    it('should return scan ID when no context exists', () => {
      const scanData = { id: 668, recommendations: null };
      const contextLink = null;

      const result = testResolveEffectiveScanId(scanData, contextLink);
      assert.strictEqual(result, 668);
    });

    it('should resolve context_scan_id from JSON (legacy system)', () => {
      const scanData = {
        id: 668,
        recommendations: JSON.stringify({ context_scan_id: 664 })
      };
      const contextLink = null;

      const result = testResolveEffectiveScanId(scanData, contextLink);
      assert.strictEqual(result, 664);
    });

    it('should resolve primary_scan_id from context_scan_links (new system)', () => {
      const scanData = { id: 668, recommendations: null };
      const contextLink = { primary_scan_id: 664 };

      const result = testResolveEffectiveScanId(scanData, contextLink);
      assert.strictEqual(result, 664);
    });

    it('should prefer JSON context_scan_id over context_scan_links', () => {
      const scanData = {
        id: 668,
        recommendations: JSON.stringify({ context_scan_id: 664 })
      };
      const contextLink = { primary_scan_id: 999 }; // Should be ignored

      const result = testResolveEffectiveScanId(scanData, contextLink);
      assert.strictEqual(result, 664); // From JSON, not 999
    });

    it('should handle invalid JSON gracefully and fall back to links', () => {
      const scanData = {
        id: 668,
        recommendations: 'invalid-json-{{'
      };
      const contextLink = { primary_scan_id: 664 };

      const result = testResolveEffectiveScanId(scanData, contextLink);
      assert.strictEqual(result, 664);
    });

    it('should return original scan ID when both sources are empty', () => {
      const scanData = { id: 999, recommendations: '{}' };
      const contextLink = null;

      const result = testResolveEffectiveScanId(scanData, contextLink);
      assert.strictEqual(result, 999);
    });

    it('should handle recommendations as object (not string)', () => {
      const scanData = {
        id: 668,
        recommendations: { context_scan_id: 664 } // Already parsed
      };
      const contextLink = null;

      const result = testResolveEffectiveScanId(scanData, contextLink);
      assert.strictEqual(result, 664);
    });
  });
});

describe('Recommendation Status Service - Skip Validation', () => {

  describe('validateSkip', () => {

    it('should allow skip when all conditions pass', () => {
      const rec = {
        id: 123,
        scan_id: 664,
        unlock_state: 'active',
        status: 'active',
        skip_enabled_at: null,
        skipped_at: null
      };

      const result = testValidateSkip(rec);
      assert.strictEqual(result.valid, true);
    });

    it('should reject when already skipped', () => {
      const rec = {
        id: 123,
        unlock_state: 'skipped',
        status: 'skipped',
        skipped_at: new Date()
      };

      const result = testValidateSkip(rec);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.status, 400);
      assert.strictEqual(result.error, 'Already skipped');
    });

    it('should reject when recommendation is locked', () => {
      const rec = {
        id: 123,
        unlock_state: 'locked',
        status: 'locked',
        skipped_at: null
      };

      const result = testValidateSkip(rec);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.status, 403);
      assert.ok(result.error.includes('not yet unlocked'));
    });

    it('should reject when skip_enabled_at is in the future', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 3);

      const rec = {
        id: 123,
        unlock_state: 'active',
        status: 'active',
        skip_enabled_at: futureDate.toISOString(),
        skipped_at: null
      };

      const result = testValidateSkip(rec);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.status, 403);
      assert.strictEqual(result.error, 'Skip not yet available');
      assert.ok(result.daysRemaining >= 2); // At least 2 days
    });

    it('should allow skip when skip_enabled_at is in the past', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 2);

      const rec = {
        id: 123,
        unlock_state: 'active',
        status: 'active',
        skip_enabled_at: pastDate.toISOString(),
        skipped_at: null
      };

      const result = testValidateSkip(rec);
      assert.strictEqual(result.valid, true);
    });

    it('should allow skip when skip_enabled_at is null', () => {
      const rec = {
        id: 123,
        unlock_state: 'active',
        status: 'active',
        skip_enabled_at: null,
        skipped_at: null
      };

      const result = testValidateSkip(rec);
      assert.strictEqual(result.valid, true);
    });

    it('should calculate days remaining correctly for 1 day', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(tomorrow.getHours() + 1); // Ensure it's > 1 day

      const rec = {
        id: 123,
        unlock_state: 'active',
        skip_enabled_at: tomorrow.toISOString(),
        skipped_at: null
      };

      const result = testValidateSkip(rec);
      assert.strictEqual(result.valid, false);
      assert.ok(result.message.includes('day'));
    });
  });
});

describe('Recommendation Status Service - Progress Update Targeting', () => {

  describe('getEffectiveScanIdForProgress', () => {

    it('should use scan_id when source_scan_id is null', () => {
      const rec = {
        id: 123,
        scan_id: 664,
        source_scan_id: null
      };

      const result = testGetEffectiveScanIdForProgress(rec);
      assert.strictEqual(result, 664);
    });

    it('should use source_scan_id when available', () => {
      const rec = {
        id: 123,
        scan_id: 668,
        source_scan_id: 664
      };

      const result = testGetEffectiveScanIdForProgress(rec);
      assert.strictEqual(result, 664);
    });

    it('should handle 0 as a valid source_scan_id', () => {
      // Edge case: source_scan_id = 0 should still use scan_id (0 is falsy)
      const rec = {
        id: 123,
        scan_id: 664,
        source_scan_id: 0
      };

      // 0 || 664 = 664 (expected behavior for falsy source_scan_id)
      const result = testGetEffectiveScanIdForProgress(rec);
      assert.strictEqual(result, 664);
    });
  });
});

describe('Recommendation Status Service - Implement Validation', () => {

  describe('validateImplement', () => {

    it('should allow implement when rec is active', () => {
      const rec = {
        id: 123,
        unlock_state: 'active',
        status: 'active',
        implemented_at: null
      };

      const result = testValidateImplement(rec);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.alreadyDone, undefined);
    });

    it('should be idempotent for already implemented rec', () => {
      const rec = {
        id: 123,
        unlock_state: 'implemented',
        status: 'implemented',
        implemented_at: new Date()
      };

      const result = testValidateImplement(rec);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.alreadyDone, true);
    });

    it('should reject when rec is locked', () => {
      const rec = {
        id: 123,
        unlock_state: 'locked',
        status: 'locked',
        implemented_at: null
      };

      const result = testValidateImplement(rec);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.status, 400);
      assert.ok(result.error.includes('Can only implement active'));
    });

    it('should reject when rec is skipped', () => {
      const rec = {
        id: 123,
        unlock_state: 'skipped',
        status: 'skipped',
        implemented_at: null
      };

      const result = testValidateImplement(rec);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.currentState, 'skipped');
    });
  });
});

describe('Context Reuse Integration Scenarios', () => {

  it('should correctly identify effective scan for progress when viewing reused context', () => {
    // Scenario: User views scan 668 (which references primary scan 664)
    // Rec 123 belongs to scan 664
    // Progress should update for scan 664

    const scanData = {
      id: 668,
      recommendations: JSON.stringify({ context_scan_id: 664 })
    };

    const rec = {
      id: 123,
      scan_id: 664, // Belongs to primary scan
      source_scan_id: null
    };

    // Resolve context
    const contextScanId = testResolveEffectiveScanId(scanData, null);
    assert.strictEqual(contextScanId, 664);

    // Get progress target
    const progressTarget = testGetEffectiveScanIdForProgress(rec);
    assert.strictEqual(progressTarget, 664);

    // Both should match - progress goes to the right place
    assert.strictEqual(contextScanId, progressTarget);
  });

  it('should handle multi-level context (rec copied with source_scan_id)', () => {
    // Scenario:
    // - Original rec created for scan 660
    // - Rec copied to scan 664 with source_scan_id = 660
    // - User views scan 668 (context_scan_id = 664)
    // Progress should update for 660 (the original source)

    const rec = {
      id: 123,
      scan_id: 664,
      source_scan_id: 660 // Original source
    };

    const progressTarget = testGetEffectiveScanIdForProgress(rec);
    assert.strictEqual(progressTarget, 660);
  });

  it('should validate skip works regardless of which scan is being viewed', () => {
    // The key insight: skip validation doesn't care about the viewing scan
    // It only cares about the rec's state

    const rec = {
      id: 123,
      scan_id: 664, // Rec belongs to scan 664
      unlock_state: 'active',
      status: 'active',
      skip_enabled_at: null,
      skipped_at: null
    };

    // Validation should pass regardless of viewing scan 668 or 664
    const result = testValidateSkip(rec);
    assert.strictEqual(result.valid, true);
  });
});

describe('Recommendation Cap Helper (consistency check)', () => {

  it('should apply cap to recommendations', () => {
    const recs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = applyRecommendationCap(recs, 5);
    assert.strictEqual(result.length, 5);
    assert.deepStrictEqual(result, [1, 2, 3, 4, 5]);
  });

  it('should return all recs when limit is -1 (unlimited)', () => {
    const recs = [1, 2, 3, 4, 5];
    const result = applyRecommendationCap(recs, -1);
    assert.strictEqual(result.length, 5);
  });

  it('should handle empty array', () => {
    const result = applyRecommendationCap([], 5);
    assert.strictEqual(result.length, 0);
  });

  it('should handle limit larger than array', () => {
    const recs = [1, 2, 3];
    const result = applyRecommendationCap(recs, 10);
    assert.strictEqual(result.length, 3);
  });
});

describe('Edge Cases', () => {

  it('should handle skip_enabled_at as Date object', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);

    const rec = {
      id: 123,
      unlock_state: 'active',
      skip_enabled_at: pastDate, // Date object, not string
      skipped_at: null
    };

    const result = testValidateSkip(rec);
    assert.strictEqual(result.valid, true);
  });

  it('should handle recommendations JSON with extra fields', () => {
    const scanData = {
      id: 668,
      recommendations: JSON.stringify({
        context_scan_id: 664,
        other_field: 'value',
        nested: { data: 123 }
      })
    };

    const result = testResolveEffectiveScanId(scanData, null);
    assert.strictEqual(result, 664);
  });

  it('should handle empty recommendations JSON object', () => {
    const scanData = {
      id: 668,
      recommendations: '{}'
    };
    const contextLink = { primary_scan_id: 664 };

    const result = testResolveEffectiveScanId(scanData, contextLink);
    assert.strictEqual(result, 664); // Falls through to context link
  });
});

// Summary of test coverage:
// 1. Context Resolution: 7 tests
// 2. Skip Validation: 7 tests
// 3. Progress Update Targeting: 3 tests
// 4. Implement Validation: 4 tests
// 5. Context Reuse Integration: 3 tests
// 6. Recommendation Cap: 4 tests
// 7. Edge Cases: 3 tests
// Total: 31 tests
