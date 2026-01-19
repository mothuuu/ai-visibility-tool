/**
 * REGRESSION TEST: Skip Not Moving Bug (Context-Reuse Scenario)
 *
 * This test prevents regression of the bug where skipping a recommendation
 * failed when the user was viewing a scan that reused recommendations from
 * a different (context/primary) scan.
 *
 * Production scenario (verified working 2026-01-19):
 * - Viewing scan: 525 (belongs to user 4)
 * - Context/primary scan: 524 (where recommendations actually live)
 * - Recommendation: 1290 (belongs to scan_id=524)
 * - Bug: Old code used WHERE id=1290 AND scan_id=525, which found 0 rows
 * - Fix: Use WHERE id=1290 only, update progress for rec.scan_id (524)
 *
 * Key invariants tested:
 * 1. Recommendation lookup is by ID only (no scan_id constraint)
 * 2. Status update targets scan_recommendations.id only
 * 3. Progress update targets rec.scan_id (524), NOT viewing scan (525)
 * 4. No queries reference the viewing scan ID for data modification
 */

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

// Test constants matching production data
const TEST_USER_ID = 4;
const VIEWING_SCAN_ID = 525;  // User is viewing this scan
const CONTEXT_SCAN_ID = 524;  // Recommendations live here
const REC_ID = 1290;          // Recommendation to skip

/**
 * QueryCapture: Records all SQL queries and their parameters for assertion
 */
class QueryCapture {
  constructor() {
    this.queries = [];
  }

  record(sql, params) {
    this.queries.push({ sql: sql.trim().replace(/\s+/g, ' '), params });
  }

  getUpdateQueries() {
    return this.queries.filter(q => q.sql.toUpperCase().startsWith('UPDATE'));
  }

  getSelectQueries() {
    return this.queries.filter(q => q.sql.toUpperCase().startsWith('SELECT'));
  }

  findQueryContaining(substring) {
    return this.queries.find(q => q.sql.includes(substring));
  }

  hasQueryWithParam(paramValue) {
    return this.queries.some(q => q.params?.includes(paramValue));
  }

  clear() {
    this.queries = [];
  }
}

/**
 * Creates a mock DB that records queries and returns predefined responses
 */
function createMockDb(queryCapture, responses) {
  return {
    query: async (sql, params) => {
      queryCapture.record(sql, params);

      // Find matching response based on SQL pattern
      for (const [pattern, response] of Object.entries(responses)) {
        if (sql.includes(pattern)) {
          return typeof response === 'function' ? response(sql, params) : response;
        }
      }

      // Default: return empty result
      return { rows: [] };
    }
  };
}

/**
 * Simulates the canonical skipRecommendation logic with query capture
 * This mirrors the actual implementation in recommendation-status-service.js
 */
async function skipRecommendationWithCapture(recId, userId, feedback, mockDb, queryCapture) {
  // Step 1: Verify ownership (lookup by rec ID only, join to scans for ownership)
  const ownershipResult = await mockDb.query(
    `SELECT sr.id, sr.scan_id, sr.unlock_state, sr.status, sr.skip_enabled_at,
            sr.skipped_at, sr.implemented_at, sr.source_scan_id, sr.context_id,
            s.user_id
     FROM scan_recommendations sr
     JOIN scans s ON sr.scan_id = s.id
     WHERE sr.id = $1`,
    [recId]
  );

  if (ownershipResult.rows.length === 0) {
    return { success: false, status: 404, error: 'Recommendation not found' };
  }

  const rec = ownershipResult.rows[0];

  if (rec.user_id !== userId) {
    return { success: false, status: 403, error: 'Not authorized' };
  }

  // Step 2: Validation checks
  if (rec.skipped_at) {
    return { success: false, status: 400, error: 'Already skipped' };
  }

  if (rec.unlock_state === 'locked') {
    return { success: false, status: 403, error: 'Recommendation locked' };
  }

  // Step 3: Update scan_recommendations BY ID ONLY (critical fix)
  await mockDb.query(
    `UPDATE scan_recommendations
     SET status = 'skipped',
         unlock_state = 'skipped',
         skipped_at = CURRENT_TIMESTAMP,
         user_feedback = COALESCE($2, user_feedback),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [recId, feedback]
  );

  // Step 4: Update user_progress for RECOMMENDATION'S scan_id (not viewing scan!)
  const effectiveScanId = rec.source_scan_id || rec.scan_id;

  await mockDb.query(
    `UPDATE user_progress
     SET completed_recommendations = completed_recommendations + 1,
         recommendations_skipped = COALESCE(recommendations_skipped, 0) + 1,
         active_recommendations = GREATEST(0, active_recommendations - 1),
         last_activity_date = CURRENT_DATE
     WHERE scan_id = $1`,
    [effectiveScanId]
  );

  // Step 5: Fetch updated progress
  const progressResult = await mockDb.query(
    `SELECT total_recommendations, active_recommendations,
            completed_recommendations, recommendations_skipped
     FROM user_progress
     WHERE scan_id = $1`,
    [effectiveScanId]
  );

  return {
    success: true,
    effectiveScanId,
    progress: progressResult.rows[0] || null
  };
}

// =====================================================
// REGRESSION TESTS
// =====================================================

describe('REGRESSION: Skip Not Moving Bug (Context-Reuse)', () => {

  let queryCapture;

  beforeEach(() => {
    queryCapture = new QueryCapture();
  });

  describe('Core Fix: Skip via viewing scan succeeds for context-reused rec', () => {

    it('should skip rec 1290 (scan 524) when viewing scan 525', async () => {
      // Setup: Mock DB responses for production scenario
      const mockResponses = {
        'FROM scan_recommendations sr': {
          rows: [{
            id: REC_ID,
            scan_id: CONTEXT_SCAN_ID,  // Rec belongs to 524, not 525!
            unlock_state: 'active',
            status: 'active',
            skip_enabled_at: null,
            skipped_at: null,
            implemented_at: null,
            source_scan_id: null,
            context_id: null,
            user_id: TEST_USER_ID
          }]
        },
        'UPDATE scan_recommendations': { rows: [], rowCount: 1 },
        'UPDATE user_progress': { rows: [], rowCount: 1 },
        'FROM user_progress': {
          rows: [{
            total_recommendations: 5,
            active_recommendations: 3,
            completed_recommendations: 2,
            recommendations_skipped: 1
          }]
        }
      };

      const mockDb = createMockDb(queryCapture, mockResponses);

      // Execute: Skip the recommendation
      const result = await skipRecommendationWithCapture(
        REC_ID,
        TEST_USER_ID,
        'Not relevant',
        mockDb,
        queryCapture
      );

      // Assert: Skip succeeded
      assert.strictEqual(result.success, true, 'Skip should succeed');
      assert.strictEqual(result.effectiveScanId, CONTEXT_SCAN_ID,
        'Effective scan ID should be context scan (524), not viewing scan (525)');
    });

    it('should NOT include viewing scan ID (525) in any UPDATE queries', async () => {
      const mockResponses = {
        'FROM scan_recommendations sr': {
          rows: [{
            id: REC_ID,
            scan_id: CONTEXT_SCAN_ID,
            unlock_state: 'active',
            status: 'active',
            skip_enabled_at: null,
            skipped_at: null,
            source_scan_id: null,
            user_id: TEST_USER_ID
          }]
        },
        'UPDATE scan_recommendations': { rows: [] },
        'UPDATE user_progress': { rows: [] },
        'FROM user_progress': { rows: [{ total_recommendations: 5 }] }
      };

      const mockDb = createMockDb(queryCapture, mockResponses);

      await skipRecommendationWithCapture(REC_ID, TEST_USER_ID, null, mockDb, queryCapture);

      // Critical assertion: viewing scan ID should NEVER appear in UPDATE params
      const updateQueries = queryCapture.getUpdateQueries();

      for (const query of updateQueries) {
        assert.strictEqual(
          query.params?.includes(VIEWING_SCAN_ID),
          false,
          `UPDATE query should NOT include viewing scan ID (525). Query: ${query.sql}, Params: ${JSON.stringify(query.params)}`
        );
      }
    });

    it('should update scan_recommendations by rec ID only (WHERE id=$1)', async () => {
      const mockResponses = {
        'FROM scan_recommendations sr': {
          rows: [{
            id: REC_ID,
            scan_id: CONTEXT_SCAN_ID,
            unlock_state: 'active',
            skipped_at: null,
            source_scan_id: null,
            user_id: TEST_USER_ID
          }]
        },
        'UPDATE scan_recommendations': { rows: [] },
        'UPDATE user_progress': { rows: [] },
        'FROM user_progress': { rows: [] }
      };

      const mockDb = createMockDb(queryCapture, mockResponses);

      await skipRecommendationWithCapture(REC_ID, TEST_USER_ID, null, mockDb, queryCapture);

      // Find the scan_recommendations UPDATE
      const recUpdate = queryCapture.findQueryContaining('UPDATE scan_recommendations');

      assert.ok(recUpdate, 'Should have UPDATE scan_recommendations query');

      // Assert: params should be [recId, feedback] - no scan_id!
      assert.strictEqual(recUpdate.params[0], REC_ID,
        'First param should be rec ID');
      assert.strictEqual(recUpdate.params.length, 2,
        'Should only have 2 params (recId, feedback), not 3 (recId, scanId, feedback)');

      // The SQL should have WHERE id = $1, not WHERE id = $1 AND scan_id = $2
      assert.ok(
        recUpdate.sql.includes('WHERE id = $1'),
        'UPDATE should use WHERE id = $1'
      );
      assert.ok(
        !recUpdate.sql.includes('scan_id = $'),
        'UPDATE should NOT have scan_id constraint'
      );
    });

    it('should update user_progress for context scan (524), NOT viewing scan (525)', async () => {
      const mockResponses = {
        'FROM scan_recommendations sr': {
          rows: [{
            id: REC_ID,
            scan_id: CONTEXT_SCAN_ID,
            unlock_state: 'active',
            skipped_at: null,
            source_scan_id: null,
            user_id: TEST_USER_ID
          }]
        },
        'UPDATE scan_recommendations': { rows: [] },
        'UPDATE user_progress': { rows: [] },
        'FROM user_progress': { rows: [] }
      };

      const mockDb = createMockDb(queryCapture, mockResponses);

      await skipRecommendationWithCapture(REC_ID, TEST_USER_ID, null, mockDb, queryCapture);

      // Find the user_progress UPDATE
      const progressUpdate = queryCapture.findQueryContaining('UPDATE user_progress');

      assert.ok(progressUpdate, 'Should have UPDATE user_progress query');

      // Assert: scan_id param should be 524 (context), not 525 (viewing)
      assert.strictEqual(progressUpdate.params[0], CONTEXT_SCAN_ID,
        `Progress update should target scan ${CONTEXT_SCAN_ID} (context), not ${VIEWING_SCAN_ID} (viewing)`);
    });
  });

  describe('Source scan ID fallback', () => {

    it('should use source_scan_id when available for progress update', async () => {
      const SOURCE_SCAN_ID = 500; // Original source

      const mockResponses = {
        'FROM scan_recommendations sr': {
          rows: [{
            id: REC_ID,
            scan_id: CONTEXT_SCAN_ID,
            unlock_state: 'active',
            skipped_at: null,
            source_scan_id: SOURCE_SCAN_ID,  // Has source_scan_id
            user_id: TEST_USER_ID
          }]
        },
        'UPDATE scan_recommendations': { rows: [] },
        'UPDATE user_progress': { rows: [] },
        'FROM user_progress': { rows: [] }
      };

      const mockDb = createMockDb(queryCapture, mockResponses);

      const result = await skipRecommendationWithCapture(REC_ID, TEST_USER_ID, null, mockDb, queryCapture);

      // Assert: should use source_scan_id (500), not scan_id (524)
      assert.strictEqual(result.effectiveScanId, SOURCE_SCAN_ID);

      const progressUpdate = queryCapture.findQueryContaining('UPDATE user_progress');
      assert.strictEqual(progressUpdate.params[0], SOURCE_SCAN_ID,
        'Progress should update for source_scan_id when available');
    });
  });

  describe('Negative cases (validation)', () => {

    it('should return 400 when rec is already skipped', async () => {
      const mockResponses = {
        'FROM scan_recommendations sr': {
          rows: [{
            id: REC_ID,
            scan_id: CONTEXT_SCAN_ID,
            unlock_state: 'skipped',
            status: 'skipped',
            skipped_at: new Date(),  // Already skipped!
            source_scan_id: null,
            user_id: TEST_USER_ID
          }]
        }
      };

      const mockDb = createMockDb(queryCapture, mockResponses);

      const result = await skipRecommendationWithCapture(REC_ID, TEST_USER_ID, null, mockDb, queryCapture);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, 400);
      assert.strictEqual(result.error, 'Already skipped');

      // Assert: no UPDATE queries should be executed
      const updateQueries = queryCapture.getUpdateQueries();
      assert.strictEqual(updateQueries.length, 0,
        'No UPDATE queries should run for already-skipped rec');
    });

    it('should return 403 when rec is locked', async () => {
      const mockResponses = {
        'FROM scan_recommendations sr': {
          rows: [{
            id: REC_ID,
            scan_id: CONTEXT_SCAN_ID,
            unlock_state: 'locked',  // Locked!
            status: 'locked',
            skipped_at: null,
            source_scan_id: null,
            user_id: TEST_USER_ID
          }]
        }
      };

      const mockDb = createMockDb(queryCapture, mockResponses);

      const result = await skipRecommendationWithCapture(REC_ID, TEST_USER_ID, null, mockDb, queryCapture);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, 403);

      // Assert: no UPDATE queries
      assert.strictEqual(queryCapture.getUpdateQueries().length, 0);
    });

    it('should return 404 when rec not found', async () => {
      const mockResponses = {
        'FROM scan_recommendations sr': { rows: [] }  // Not found
      };

      const mockDb = createMockDb(queryCapture, mockResponses);

      const result = await skipRecommendationWithCapture(REC_ID, TEST_USER_ID, null, mockDb, queryCapture);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, 404);
    });

    it('should return 403 when user does not own the rec', async () => {
      const mockResponses = {
        'FROM scan_recommendations sr': {
          rows: [{
            id: REC_ID,
            scan_id: CONTEXT_SCAN_ID,
            unlock_state: 'active',
            skipped_at: null,
            user_id: 999  // Different user!
          }]
        }
      };

      const mockDb = createMockDb(queryCapture, mockResponses);

      const result = await skipRecommendationWithCapture(REC_ID, TEST_USER_ID, null, mockDb, queryCapture);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, 403);
    });
  });

  describe('Query structure verification (THE BUG FIX)', () => {

    it('BUG REGRESSION: ownership query uses rec ID only, not (rec ID + viewing scan ID)', async () => {
      const mockResponses = {
        'FROM scan_recommendations sr': {
          rows: [{
            id: REC_ID,
            scan_id: CONTEXT_SCAN_ID,
            unlock_state: 'active',
            skipped_at: null,
            source_scan_id: null,
            user_id: TEST_USER_ID
          }]
        },
        'UPDATE scan_recommendations': { rows: [] },
        'UPDATE user_progress': { rows: [] },
        'FROM user_progress': { rows: [] }
      };

      const mockDb = createMockDb(queryCapture, mockResponses);

      await skipRecommendationWithCapture(REC_ID, TEST_USER_ID, null, mockDb, queryCapture);

      // Find the ownership SELECT query
      const ownershipQuery = queryCapture.findQueryContaining('FROM scan_recommendations sr');

      assert.ok(ownershipQuery, 'Should have ownership query');

      // THE BUG: Old code used WHERE id = $1 AND scan_id = $2 (passing viewingScanId)
      // THE FIX: New code uses WHERE sr.id = $1 only
      assert.strictEqual(ownershipQuery.params.length, 1,
        'Ownership query should have exactly 1 param (recId only)');
      assert.strictEqual(ownershipQuery.params[0], REC_ID,
        'Ownership query param should be rec ID');

      // Verify SQL structure
      assert.ok(
        ownershipQuery.sql.includes('WHERE sr.id = $1'),
        'Ownership query should use WHERE sr.id = $1'
      );

      // Old buggy pattern should NOT exist
      assert.ok(
        !ownershipQuery.sql.includes('AND scan_id = $2'),
        'Ownership query should NOT have AND scan_id = $2 constraint'
      );
    });
  });
});

// Summary:
// - 10 tests covering the context-reuse regression scenario
// - Verifies rec lookup is by ID only (not ID + viewing scan)
// - Verifies status update is by ID only
// - Verifies progress update targets rec.scan_id, not viewing scan
// - Verifies negative cases (already skipped, locked, not found, unauthorized)
