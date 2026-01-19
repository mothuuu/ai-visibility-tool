/**
 * Recommendation Status Service
 *
 * Provides canonical logic for recommendation status changes (skip, implement).
 * Handles context scan resolution for proper operation on reused recommendations.
 *
 * Key Problem Solved:
 * When scans reuse recommendations via context_scan_id, the recommendation's
 * scan_id points to the PRIMARY scan, not the viewing scan. Status updates
 * must use rec.scan_id (not the viewing scan_id) for:
 * - Finding the recommendation
 * - Updating user_progress
 */

const db = require('../db/database');

/**
 * Resolve the effective scan ID for recommendation operations.
 *
 * Given a scan ID (e.g., the one the user is viewing), returns the actual
 * scan ID where recommendations live (the primary/context scan).
 *
 * Resolution order:
 * 1. Check scan.recommendations JSON for context_scan_id (legacy)
 * 2. Check context_scan_links -> recommendation_contexts.primary_scan_id (new)
 * 3. Fall back to the original scan ID
 *
 * @param {number} scanId - The scan ID being viewed
 * @returns {Promise<number>} The effective scan ID for recommendations
 */
async function resolveEffectiveScanId(scanId) {
  // Get the scan's recommendations JSON
  const scanResult = await db.query(
    `SELECT id, recommendations FROM scans WHERE id = $1`,
    [scanId]
  );

  if (scanResult.rows.length === 0) {
    return scanId; // Scan not found, return as-is
  }

  const scan = scanResult.rows[0];
  let effectiveScanId = scan.id;

  // Method 1: Check scan.recommendations JSON for context_scan_id (legacy)
  if (scan.recommendations) {
    try {
      const recMeta = typeof scan.recommendations === 'string'
        ? JSON.parse(scan.recommendations)
        : scan.recommendations;
      if (recMeta?.context_scan_id) {
        effectiveScanId = recMeta.context_scan_id;
        console.log(`📎 [resolveEffectiveScanId] Scan ${scanId} → context_scan_id ${effectiveScanId} (from JSON)`);
        return effectiveScanId;
      }
    } catch (parseError) {
      // JSON parse failed, continue to next method
    }
  }

  // Method 2: Check context_scan_links table (new system)
  try {
    const contextLinkResult = await db.query(`
      SELECT rc.primary_scan_id
      FROM context_scan_links csl
      JOIN recommendation_contexts rc ON csl.context_id = rc.id
      WHERE csl.scan_id = $1
      LIMIT 1
    `, [scanId]);

    if (contextLinkResult.rows.length > 0 && contextLinkResult.rows[0].primary_scan_id) {
      effectiveScanId = contextLinkResult.rows[0].primary_scan_id;
      console.log(`📎 [resolveEffectiveScanId] Scan ${scanId} → primary_scan_id ${effectiveScanId} (from context_scan_links)`);
      return effectiveScanId;
    }
  } catch (contextError) {
    // Table might not exist, continue with original scan ID
    console.log(`⚠️ Context lookup failed: ${contextError.message}`);
  }

  return effectiveScanId;
}

/**
 * Verify user owns a recommendation (via scan ownership).
 *
 * @param {number} recId - Recommendation ID
 * @param {number} userId - User ID to verify ownership
 * @returns {Promise<Object|null>} Recommendation details if owned, null otherwise
 */
async function verifyRecommendationOwnership(recId, userId) {
  const result = await db.query(
    `SELECT sr.id, sr.scan_id, sr.unlock_state, sr.status, sr.skip_enabled_at,
            sr.skipped_at, sr.implemented_at, sr.source_scan_id, sr.context_id,
            s.user_id
     FROM scan_recommendations sr
     JOIN scans s ON sr.scan_id = s.id
     WHERE sr.id = $1`,
    [recId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const rec = result.rows[0];
  if (rec.user_id !== userId) {
    return null;
  }

  return rec;
}

/**
 * Canonical skip logic for recommendations.
 *
 * Enforces all skip rules:
 * - User must own the recommendation
 * - Recommendation must not be locked
 * - Recommendation must not already be skipped
 * - Skip must be enabled (skip_enabled_at <= now)
 *
 * Updates:
 * - scan_recommendations.status = 'skipped'
 * - scan_recommendations.unlock_state = 'skipped'
 * - scan_recommendations.skipped_at = NOW()
 * - user_progress for the recommendation's scan_id (NOT the viewing scan)
 *
 * @param {number} recId - Recommendation ID
 * @param {number} userId - User ID
 * @param {string|null} feedback - Optional skip feedback/reason
 * @returns {Promise<Object>} Result with success, error, or progress data
 */
async function skipRecommendation(recId, userId, feedback = null) {
  // Step 1: Verify ownership and get recommendation details
  const rec = await verifyRecommendationOwnership(recId, userId);

  if (!rec) {
    return {
      success: false,
      status: 404,
      error: 'Recommendation not found or not authorized'
    };
  }

  // Step 2: Check if already skipped
  if (rec.skipped_at) {
    return {
      success: false,
      status: 400,
      error: 'Already skipped',
      message: 'This recommendation has already been skipped.'
    };
  }

  // Step 3: Check if recommendation is locked
  if (rec.unlock_state === 'locked') {
    return {
      success: false,
      status: 403,
      error: 'Recommendation not yet unlocked',
      message: 'You can only skip unlocked recommendations.'
    };
  }

  // Step 4: Check if skip is enabled (skip_enabled_at <= now)
  const now = new Date();
  const skipEnabledAt = rec.skip_enabled_at ? new Date(rec.skip_enabled_at) : null;

  if (skipEnabledAt && skipEnabledAt > now) {
    const daysRemaining = Math.ceil((skipEnabledAt - now) / (1000 * 60 * 60 * 24));
    return {
      success: false,
      status: 403,
      error: 'Skip not yet available',
      message: `You can skip this recommendation in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}.`,
      skipEnabledAt: skipEnabledAt.toISOString(),
      daysRemaining
    };
  }

  // Step 5: Perform the skip update (by rec ID only - no scan_id constraint!)
  await db.query(
    `UPDATE scan_recommendations
     SET status = 'skipped',
         unlock_state = 'skipped',
         skipped_at = CURRENT_TIMESTAMP,
         user_feedback = COALESCE($2, user_feedback),
         resurface_at = CURRENT_TIMESTAMP + INTERVAL '30 days',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [recId, feedback]
  );

  // Step 6: Update user_progress for the RECOMMENDATION'S scan_id
  // This is critical - use rec.scan_id, not the viewing scan
  const effectiveScanId = rec.source_scan_id || rec.scan_id;

  await db.query(
    `UPDATE user_progress
     SET completed_recommendations = completed_recommendations + 1,
         recommendations_skipped = COALESCE(recommendations_skipped, 0) + 1,
         active_recommendations = GREATEST(0, active_recommendations - 1),
         last_activity_date = CURRENT_DATE
     WHERE scan_id = $1`,
    [effectiveScanId]
  );

  console.log(`⏭️  User ${userId} skipped recommendation ${recId} (effective scan: ${effectiveScanId})`);

  // Step 7: Return progress
  const progressResult = await db.query(
    `SELECT
      total_recommendations,
      active_recommendations,
      completed_recommendations,
      recommendations_implemented,
      recommendations_skipped
     FROM user_progress
     WHERE scan_id = $1`,
    [effectiveScanId]
  );

  const progress = progressResult.rows[0];

  return {
    success: true,
    message: 'Recommendation skipped. It will appear in your "Skipped" tab.',
    effectiveScanId,
    progress: progress ? {
      total: progress.total_recommendations,
      active: progress.active_recommendations,
      completed: progress.completed_recommendations,
      implemented: progress.recommendations_implemented,
      skipped: progress.recommendations_skipped
    } : null
  };
}

/**
 * Canonical implement logic for recommendations.
 *
 * Similar to skip but marks as implemented instead.
 *
 * @param {number} recId - Recommendation ID
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Result with success, error, or progress data
 */
async function implementRecommendation(recId, userId) {
  // Step 1: Verify ownership
  const rec = await verifyRecommendationOwnership(recId, userId);

  if (!rec) {
    return {
      success: false,
      status: 404,
      error: 'Recommendation not found or not authorized'
    };
  }

  // Step 2: Check if already implemented
  if (rec.status === 'implemented' || rec.implemented_at) {
    return {
      success: true, // Idempotent - already done
      message: 'Recommendation is already marked as implemented'
    };
  }

  // Step 3: Check if can be implemented (must be active)
  if (rec.unlock_state !== 'active') {
    return {
      success: false,
      status: 400,
      error: 'Can only implement active recommendations',
      currentState: rec.unlock_state
    };
  }

  // Step 4: Perform the implement update
  await db.query(
    `UPDATE scan_recommendations
     SET status = 'implemented',
         unlock_state = 'implemented',
         implemented_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [recId]
  );

  // Step 5: Update user_progress for the RECOMMENDATION'S scan_id
  const effectiveScanId = rec.source_scan_id || rec.scan_id;

  await db.query(
    `UPDATE user_progress
     SET completed_recommendations = completed_recommendations + 1,
         recommendations_implemented = COALESCE(recommendations_implemented, 0) + 1,
         active_recommendations = GREATEST(0, active_recommendations - 1),
         last_activity_date = CURRENT_DATE
     WHERE scan_id = $1`,
    [effectiveScanId]
  );

  console.log(`✅ User ${userId} implemented recommendation ${recId} (effective scan: ${effectiveScanId})`);

  // Step 6: Return progress
  const progressResult = await db.query(
    `SELECT
      total_recommendations,
      active_recommendations,
      completed_recommendations,
      recommendations_implemented,
      recommendations_skipped,
      verified_recommendations
     FROM user_progress
     WHERE scan_id = $1`,
    [effectiveScanId]
  );

  const progress = progressResult.rows[0];

  return {
    success: true,
    message: 'Recommendation marked as implemented',
    effectiveScanId,
    progress: progress ? {
      total: progress.total_recommendations,
      active: progress.active_recommendations,
      completed: progress.completed_recommendations,
      implemented: progress.recommendations_implemented,
      skipped: progress.recommendations_skipped,
      verified: progress.verified_recommendations
    } : null
  };
}

module.exports = {
  resolveEffectiveScanId,
  verifyRecommendationOwnership,
  skipRecommendation,
  implementRecommendation
};
