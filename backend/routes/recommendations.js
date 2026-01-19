const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

// Import new services
const RefreshCycleService = require('../services/refresh-cycle-service');
const NotificationService = require('../services/notification-service');

// Import repositories for canonical field handling
const recommendationRepo = require('../repositories/recommendationRepository');
const progressRepo = require('../repositories/progressRepository');

// Phase 2: Entitlement services for recommendation visibility cap
const { resolvePlanForRequest } = require('../services/planService');
const { getRecommendationVisibleLimit } = require('../services/scanEntitlementService');

// Canonical recommendation status service for context-safe skip/implement
const { skipRecommendation: canonicalSkipRecommendation } = require('../services/recommendation-status-service');

// ============================================
// POST /api/recommendations/:id/mark-complete
// Mark a recommendation as implemented (completed)
// This sets both unlock_state and status so the 5-day refresh cycle
// can properly replace it with a new recommendation.
// ============================================
router.post('/:id/mark-complete', authenticateToken, async (req, res) => {
  try {
    const recId = req.params.id;
    const userId = req.user.id;

    console.log(`📝 Marking recommendation ${recId} as implemented for user ${userId}`);

    // Check if user is on Free plan (not allowed to mark complete)
    const userPlanCheck = await db.query('SELECT plan FROM users WHERE id = $1', [userId]);
    if (userPlanCheck.rows[0]?.plan === 'free') {
      return res.status(403).json({
        error: 'Upgrade required',
        message: 'Upgrade to DIY plan to track implementation progress',
        upgrade: { plan: 'diy', url: '/checkout.html?plan=diy' }
      });
    }

    // Verify the recommendation belongs to this user
    const recCheck = await db.query(
      `SELECT sr.id, sr.scan_id, sr.unlock_state, sr.status, s.user_id
       FROM scan_recommendations sr
       JOIN scans s ON sr.scan_id = s.id
       WHERE sr.id = $1`,
      [recId]
    );

    if (recCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }

    const rec = recCheck.rows[0];

    if (rec.user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (rec.unlock_state !== 'active') {
      return res.status(400).json({
        error: 'Can only mark active recommendations as implemented'
      });
    }

    // Update recommendation to implemented
    // NOTE: Write to CANONICAL columns only (implemented_at, not marked_complete_at)
    // unlock_state = 'implemented' is the canonical state (not 'completed')
    await db.query(
      `UPDATE scan_recommendations
       SET unlock_state = 'implemented',
           status = 'implemented',
           implemented_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [recId]
    );

    // Update user_progress - increment both completed and implemented counters
    await db.query(
      `UPDATE user_progress
       SET completed_recommendations = completed_recommendations + 1,
           recommendations_implemented = COALESCE(recommendations_implemented, 0) + 1,
           active_recommendations = active_recommendations - 1,
           last_activity_date = CURRENT_DATE
       WHERE scan_id = $1`,
      [rec.scan_id]
    );

    console.log(`   ✅ Recommendation marked as implemented (status + unlock_state updated)`);

    // Get updated progress
    const progressResult = await db.query(
      `SELECT
        total_recommendations,
        active_recommendations,
        completed_recommendations,
        recommendations_implemented,
        verified_recommendations
       FROM user_progress
       WHERE scan_id = $1`,
      [rec.scan_id]
    );

    const progress = progressResult.rows[0];

    res.json({
      success: true,
      message: 'Recommendation marked as implemented',
      progress: {
        total: progress.total_recommendations,
        active: progress.active_recommendations,
        completed: progress.completed_recommendations,
        implemented: progress.recommendations_implemented,
        verified: progress.verified_recommendations
      }
    });

  } catch (error) {
    console.error('❌ Mark complete error:', error);
    res.status(500).json({ error: 'Failed to mark recommendation as implemented' });
  }
});

// ============================================
// POST /api/recommendations/:id/implement
// Alias for mark-complete - explicit "implement" action
// This is the preferred endpoint for marking recommendations as implemented
// Also captures score data for "improved by X points" tracking
// ============================================
router.post('/:id/implement', authenticateToken, async (req, res) => {
  try {
    const recId = req.params.id;
    const userId = req.user.id;

    console.log(`✅ Implementing recommendation ${recId} for user ${userId}`);

    // Check if user is on Free plan (not allowed to implement)
    const userPlanCheck = await db.query('SELECT plan FROM users WHERE id = $1', [userId]);
    if (userPlanCheck.rows[0]?.plan === 'free') {
      return res.status(403).json({
        error: 'Upgrade required',
        message: 'Upgrade to DIY to mark recommendations as implemented',
        upgrade: { plan: 'diy', url: '/checkout.html?plan=diy' }
      });
    }

    // Verify the recommendation belongs to this user and get score data
    const recCheck = await db.query(
      `SELECT sr.id, sr.scan_id, sr.unlock_state, sr.status,
              sr.score_at_creation, sr.source_scan_id, sr.context_id,
              s.user_id, s.total_score as current_score,
              s.domain
       FROM scan_recommendations sr
       JOIN scans s ON sr.scan_id = s.id
       WHERE sr.id = $1`,
      [recId]
    );

    if (recCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }

    const rec = recCheck.rows[0];

    if (rec.user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to modify this recommendation' });
    }

    // Check if already implemented
    if (rec.status === 'implemented') {
      return res.status(400).json({
        error: 'Recommendation is already marked as implemented'
      });
    }

    if (rec.unlock_state !== 'active') {
      return res.status(400).json({
        error: 'Can only implement active recommendations',
        currentState: rec.unlock_state
      });
    }

    // Get the latest scan score for this domain (for accurate score tracking)
    const latestScanResult = await db.query(
      `SELECT id, total_score,
              ai_readability_score, ai_search_readiness_score,
              content_freshness_score, content_structure_score,
              speed_ux_score, technical_setup_score,
              trust_authority_score, voice_optimization_score
       FROM scans
       WHERE user_id = $1 AND domain = $2 AND status = 'completed'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, rec.domain]
    );

    const latestScore = latestScanResult.rows[0]?.total_score || rec.current_score;
    const scoreAtCreation = rec.score_at_creation || null;
    const scoreImprovement = scoreAtCreation ? (latestScore - scoreAtCreation) : null;

    // Update recommendation to implemented
    // NOTE: Write to CANONICAL columns only (implemented_at, not marked_complete_at)
    // unlock_state = 'implemented' is the canonical state (not 'completed')
    await db.query(
      `UPDATE scan_recommendations
       SET unlock_state = 'implemented',
           status = 'implemented',
           implemented_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [recId]
    );

    // Record score history (if table exists)
    try {
      const categoryScores = latestScanResult.rows[0] ? {
        aiReadability: latestScanResult.rows[0].ai_readability_score,
        aiSearchReadiness: latestScanResult.rows[0].ai_search_readiness_score,
        contentFreshness: latestScanResult.rows[0].content_freshness_score,
        contentStructure: latestScanResult.rows[0].content_structure_score,
        speedUX: latestScanResult.rows[0].speed_ux_score,
        technicalSetup: latestScanResult.rows[0].technical_setup_score,
        trustAuthority: latestScanResult.rows[0].trust_authority_score,
        voiceOptimization: latestScanResult.rows[0].voice_optimization_score
      } : null;

      await db.query(
        `INSERT INTO recommendation_score_history
         (recommendation_id, scan_id, context_id, event_type, score_before, score_after, score_delta, category_scores, notes)
         VALUES ($1, $2, $3, 'implemented', $4, $5, $6, $7, $8)`,
        [
          recId,
          latestScanResult.rows[0]?.id || rec.scan_id,
          rec.context_id,
          scoreAtCreation,
          latestScore,
          scoreImprovement,
          categoryScores ? JSON.stringify(categoryScores) : null,
          scoreImprovement ? `Score ${scoreImprovement >= 0 ? 'improved' : 'changed'} by ${scoreImprovement} points` : null
        ]
      );
      console.log(`   📊 Score history recorded: ${scoreAtCreation || '?'} → ${latestScore} (${scoreImprovement >= 0 ? '+' : ''}${scoreImprovement || 'N/A'})`);
    } catch (historyError) {
      // Table might not exist yet - non-critical
      console.log(`   ⚠️  Score history not recorded (table may not exist)`);
    }

    // Update user_progress counters
    await db.query(
      `UPDATE user_progress
       SET completed_recommendations = completed_recommendations + 1,
           recommendations_implemented = COALESCE(recommendations_implemented, 0) + 1,
           active_recommendations = GREATEST(0, active_recommendations - 1),
           last_activity_date = CURRENT_DATE
       WHERE scan_id = $1`,
      [rec.scan_id]
    );

    console.log(`   ✅ Recommendation ${recId} implemented successfully`);

    // Get updated progress
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
      [rec.scan_id]
    );

    const progress = progressResult.rows[0] || {};

    res.json({
      success: true,
      message: 'Recommendation marked as implemented',
      recommendationId: recId,
      scoreTracking: {
        scoreAtCreation: scoreAtCreation,
        scoreAtImplementation: latestScore,
        improvement: scoreImprovement,
        message: scoreImprovement !== null
          ? (scoreImprovement > 0
              ? `Your score improved by ${scoreImprovement} points since this recommendation was created!`
              : scoreImprovement === 0
                ? 'Score unchanged - run another scan after implementing to see the impact'
                : `Score changed by ${scoreImprovement} points`)
          : 'Run another scan to measure the impact of this implementation'
      },
      progress: {
        total: progress.total_recommendations || 0,
        active: progress.active_recommendations || 0,
        completed: progress.completed_recommendations || 0,
        implemented: progress.recommendations_implemented || 0,
        skipped: progress.recommendations_skipped || 0,
        verified: progress.verified_recommendations || 0
      },
      note: 'This recommendation will be replaced with a new one after the 5-day refresh cycle'
    });

  } catch (error) {
    console.error('❌ Implement recommendation error:', error);
    res.status(500).json({ error: 'Failed to implement recommendation' });
  }
});

// ============================================
// GET /api/recommendations/active
// Get all active (unlocked) recommendations for user's scans
// ============================================
router.get('/active', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const scanId = req.query.scan_id; // Optional: filter by specific scan
    
    let query = `
      SELECT
        sr.id, sr.scan_id, sr.category, sr.recommendation_text,
        sr.priority, sr.estimated_impact, sr.estimated_effort,
        sr.action_steps, sr.findings, sr.code_snippet,
        sr.unlock_state, sr.batch_number,
        COALESCE(sr.surfaced_at, sr.unlocked_at) AS surfaced_at,
        COALESCE(sr.implemented_at, sr.marked_complete_at) AS implemented_at,
        sr.verified_at,
        s.url as scan_url, s.total_score
      FROM scan_recommendations sr
      JOIN scans s ON sr.scan_id = s.id
      WHERE s.user_id = $1 AND sr.unlock_state = 'active'
    `;
    
    const params = [userId];
    
    if (scanId) {
      query += ` AND sr.scan_id = $2`;
      params.push(scanId);
    }
    
    query += ` ORDER BY sr.batch_number, sr.priority DESC`;
    
    const result = await db.query(query, params);
    
    res.json({
      success: true,
      recommendations: result.rows
    });
    
  } catch (error) {
    console.error('❌ Get active recommendations error:', error);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// ============================================
// GET /api/recommendations/scan/:scanId
// Get all recommendations for a specific scan
// ============================================
router.get('/scan/:scanId', authenticateToken, async (req, res) => {
  try {
    const scanId = req.params.scanId;
    const userId = req.user.id;

    // Verify scan belongs to user
    const scanCheck = await db.query(
      'SELECT user_id FROM scans WHERE id = $1',
      [scanId]
    );

    if (scanCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    if (scanCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // ============================================
    // ENTITLEMENT CAP: Resolve user's plan for recommendation limit
    // ============================================
    const planResolution = await resolvePlanForRequest({ userId, orgId: null });
    const recommendationVisibleLimit = getRecommendationVisibleLimit(planResolution.plan);

    // Get all recommendations for this scan
    // Use COALESCE for canonical field names with legacy fallbacks
    const result = await db.query(
      `SELECT
        id, category, recommendation_text, priority,
        estimated_impact, estimated_effort, action_steps,
        findings, code_snippet, unlock_state, batch_number,
        COALESCE(surfaced_at, unlocked_at) AS surfaced_at,
        COALESCE(implemented_at, marked_complete_at) AS implemented_at,
        verified_at
       FROM scan_recommendations
       WHERE scan_id = $1
       ORDER BY batch_number, priority DESC`,
      [scanId]
    );

    // Apply entitlement cap to recommendations
    let cappedRecommendations = result.rows;
    if (recommendationVisibleLimit !== -1 && cappedRecommendations.length > recommendationVisibleLimit) {
      console.log(`🔒 [Recs Endpoint] Capping recommendations: ${cappedRecommendations.length} → ${recommendationVisibleLimit} (plan: ${planResolution.plan})`);
      cappedRecommendations = cappedRecommendations.slice(0, recommendationVisibleLimit);
    }

    // Get progress
    const progressResult = await db.query(
      `SELECT
        total_recommendations, active_recommendations,
        completed_recommendations, verified_recommendations,
        current_batch, unlocks_today
       FROM user_progress
       WHERE scan_id = $1`,
      [scanId]
    );

    res.json({
      success: true,
      recommendations: cappedRecommendations,
      progress: progressResult.rows[0] || null
    });

  } catch (error) {
    console.error('❌ Get scan recommendations error:', error);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// ============================================
// POST /api/recommendations/unlock-next
// Unlock the next batch of recommendations
// ============================================
router.post('/unlock-next', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { scan_id } = req.body;
    
    if (!scan_id) {
      return res.status(400).json({ error: 'scan_id is required' });
    }
    
    console.log(`🔓 Attempting to unlock next batch for scan ${scan_id}`);
    
    // Verify scan belongs to user and get user plan
    const userCheck = await db.query(
      `SELECT u.plan, s.id 
       FROM users u 
       JOIN scans s ON s.user_id = u.id 
       WHERE u.id = $1 AND s.id = $2`,
      [userId, scan_id]
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    
    const userPlan = userCheck.rows[0].plan;
    
    // Get user progress
    const progressResult = await db.query(
      `SELECT * FROM user_progress WHERE scan_id = $1`,
      [scan_id]
    );
    
    if (progressResult.rows.length === 0) {
      return res.status(404).json({ error: 'Progress record not found' });
    }
    
    const progress = progressResult.rows[0];
    
    // Check if all active recommendations are completed
    if (progress.active_recommendations > 0) {
      return res.status(400).json({ 
        error: 'Complete all active recommendations before unlocking more',
        active_remaining: progress.active_recommendations
      });
    }
    
    // Check if there are more recommendations to unlock
    const totalLocked = await db.query(
      `SELECT COUNT(*) as count 
       FROM scan_recommendations 
       WHERE scan_id = $1 AND unlock_state = 'locked'`,
      [scan_id]
    );
    
    if (parseInt(totalLocked.rows[0].count) === 0) {
      return res.status(400).json({ 
        error: 'No more recommendations to unlock',
        message: 'All recommendations have been unlocked!'
      });
    }
    
    // Check daily unlock limits (DIY only)
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const lastUnlockDate = progress.last_unlock_date ? 
      new Date(progress.last_unlock_date).toISOString().split('T')[0] : null;
    
    let unlocksToday = progress.unlocks_today || 0;
    
    // Reset counter if new day
    if (lastUnlockDate !== today) {
      unlocksToday = 0;
    }
    
    // DIY plan has daily limit of 1 unlock (5 recommendations)
    if (userPlan === 'diy' && unlocksToday >= 1) {
      return res.status(429).json({ 
        error: 'Daily unlock limit reached',
        message: 'DIY plan allows 1 unlock per day (5 recommendations). Upgrade to Pro for unlimited unlocks!',
        next_unlock_available: 'Tomorrow'
      });
    }
    
    // Pro plan has no limits
    console.log(`   ✅ Unlock allowed (Plan: ${userPlan}, Unlocks today: ${unlocksToday})`);
    
    // Determine batch size
    const batchSize = userPlan === 'pro' ? 10 : 5;
    const nextBatch = progress.current_batch + 1;
    
    // Get next batch of locked recommendations
    const nextRecsResult = await db.query(
      `SELECT id FROM scan_recommendations 
       WHERE scan_id = $1 AND unlock_state = 'locked' AND batch_number = $2
       ORDER BY priority DESC, id
       LIMIT $3`,
      [scan_id, nextBatch, batchSize]
    );
    
    if (nextRecsResult.rows.length === 0) {
      return res.status(400).json({ 
        error: 'No recommendations found in next batch',
        message: 'All recommendations may already be unlocked'
      });
    }
    
    const recIds = nextRecsResult.rows.map(r => r.id);
    
    // Unlock the recommendations
    // Write to CANONICAL columns only (surfaced_at, not unlocked_at)
    await db.query(
      `UPDATE scan_recommendations
       SET unlock_state = 'active',
           surfaced_at = CURRENT_TIMESTAMP,
           skip_available_at = CURRENT_TIMESTAMP + INTERVAL '120 hours',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1)`,
      [recIds]
    );
    
    console.log(`   🔓 Unlocked ${recIds.length} recommendations in batch ${nextBatch}`);
    
    // Update user_progress
    await db.query(
      `UPDATE user_progress 
       SET current_batch = $1,
           active_recommendations = active_recommendations + $2,
           last_unlock_date = CURRENT_DATE,
           unlocks_today = $3,
           last_activity_date = CURRENT_DATE
       WHERE scan_id = $4`,
      [nextBatch, recIds.length, unlocksToday + 1, scan_id]
    );
    
    // Get updated progress
    const updatedProgress = await db.query(
      `SELECT 
        total_recommendations, 
        active_recommendations, 
        completed_recommendations,
        verified_recommendations,
        current_batch,
        unlocks_today
       FROM user_progress 
       WHERE scan_id = $1`,
      [scan_id]
    );
    
    // Get the newly unlocked recommendations
    const newRecs = await db.query(
      `SELECT 
        id, category, recommendation_text, priority,
        estimated_impact, estimated_effort, action_steps,
        findings, code_snippet, batch_number
       FROM scan_recommendations 
       WHERE id = ANY($1)
       ORDER BY priority DESC`,
      [recIds]
    );
    
    res.json({
      success: true,
      message: `Unlocked ${recIds.length} new recommendations!`,
      unlocked_count: recIds.length,
      batch_number: nextBatch,
      recommendations: newRecs.rows,
      progress: updatedProgress.rows[0],
      daily_limit_reached: userPlan === 'diy' && (unlocksToday + 1) >= 1
    });
    
  } catch (error) {
    console.error('❌ Unlock next batch error:', error);
    res.status(500).json({ error: 'Failed to unlock next batch' });
  }
});

// ============================================
// POST /api/recommendations/:id/skip
// Mark a recommendation as skipped
// CANONICAL: Uses shared skip logic for context-safe operation
// ============================================
router.post('/:id/skip', authenticateToken, async (req, res) => {
  try {
    const recId = req.params.id;
    const userId = req.user.id;
    const { feedback, skipData } = req.body;

    console.log(`⏭️ [rec-scoped] Skipping recommendation ${recId} for user ${userId}`);

    // Check if user is on Free plan (not allowed to skip)
    const userPlanCheck = await db.query('SELECT plan FROM users WHERE id = $1', [userId]);
    if (userPlanCheck.rows[0]?.plan === 'free') {
      return res.status(403).json({
        error: 'Upgrade required',
        message: 'Upgrade to DIY to skip recommendations',
        upgrade: { plan: 'diy', url: '/checkout.html?plan=diy' }
      });
    }

    // Use canonical skip logic (handles ownership, validation, and context-safe progress update)
    const result = await canonicalSkipRecommendation(recId, userId, feedback || skipData || null);

    if (!result.success) {
      return res.status(result.status || 400).json({
        error: result.error,
        message: result.message,
        ...(result.skipEnabledAt && { skipEnabledAt: result.skipEnabledAt }),
        ...(result.daysRemaining && { daysRemaining: result.daysRemaining }),
        ...(result.currentState && { currentState: result.currentState })
      });
    }

    console.log(`   ✅ Recommendation skipped (effective scan: ${result.effectiveScanId})`);

    res.json({
      success: true,
      message: result.message,
      progress: result.progress
    });

  } catch (error) {
    console.error('❌ Skip recommendation error:', error);
    res.status(500).json({ error: 'Failed to skip recommendation' });
  }
});

// ============================================
// POST /api/recommendations/:id/implement
// Manually mark a recommendation as implemented
// ============================================
router.post('/:id/implement', authenticateToken, async (req, res) => {
  try {
    const recId = req.params.id;
    const userId = req.user.id;

    console.log(`✅ Implementing recommendation ${recId} for user ${userId}`);

    const recCheck = await db.query(
      `SELECT sr.id, sr.scan_id, sr.status, s.user_id
       FROM scan_recommendations sr
       JOIN scans s ON sr.scan_id = s.id
       WHERE sr.id = $1`,
      [recId]
    );

    if (recCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }

    const rec = recCheck.rows[0];

    if (rec.user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (rec.status === 'implemented') {
      return res.json({ success: true, message: 'Recommendation already implemented' });
    }

    // Update recommendation to implemented
    // Write to CANONICAL columns only (unlock_state = 'implemented', implemented_at)
    await db.query(
      `UPDATE scan_recommendations
       SET unlock_state = 'implemented',
           status = 'implemented',
           implemented_at = COALESCE(implemented_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [recId]
    );

    // Update user_progress
    await db.query(
      `UPDATE user_progress
       SET recommendations_implemented = recommendations_implemented + 1,
           active_recommendations = GREATEST(active_recommendations - 1, 0),
           last_activity_date = CURRENT_DATE
       WHERE scan_id = $1`,
      [rec.scan_id]
    );

    const progressResult = await db.query(
      `SELECT total_recommendations, active_recommendations, completed_recommendations,
              recommendations_implemented, recommendations_skipped
       FROM user_progress WHERE scan_id = $1`,
      [rec.scan_id]
    );

    res.json({
      success: true,
      message: 'Recommendation marked as implemented',
      progress: progressResult.rows[0] || null
    });
  } catch (error) {
    console.error('❌ Implement recommendation error:', error);
    res.status(500).json({ error: 'Failed to implement recommendation' });
  }
});

// ============================================
// POST /api/recommendations/refresh/:scanId
// Manually trigger refresh cycle for a scan
// ============================================
router.post('/refresh/:scanId', authenticateToken, async (req, res) => {
  try {
    const scanId = req.params.scanId;
    const userId = req.user.id;

    console.log(`🔄 Manual refresh triggered for scan ${scanId}`);

    // Verify scan belongs to user
    const scanCheck = await db.query(
      'SELECT user_id FROM scans WHERE id = $1',
      [scanId]
    );

    if (scanCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    if (scanCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Initialize services
    const refreshService = new RefreshCycleService(db.pool);

    // Process refresh
    const result = await refreshService.processRefreshCycle(userId, scanId);

    res.json({
      success: true,
      message: 'Refresh cycle completed',
      ...result
    });

  } catch (error) {
    console.error('❌ Manual refresh error:', error);
    res.status(500).json({
      error: 'Failed to refresh recommendations',
      message: error.message
    });
  }
});

// ============================================
// GET /api/recommendations/refresh-status/:scanId
// Get refresh cycle status for a scan
// ============================================
router.get('/refresh-status/:scanId', authenticateToken, async (req, res) => {
  try {
    const scanId = req.params.scanId;
    const userId = req.user.id;

    // Verify scan belongs to user
    const scanCheck = await db.query(
      'SELECT user_id FROM scans WHERE id = $1',
      [scanId]
    );

    if (scanCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    if (scanCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Get refresh status
    const refreshService = new RefreshCycleService(db.pool);
    const status = await refreshService.getRefreshStatus(userId, scanId);

    res.json({
      success: true,
      refreshStatus: status
    });

  } catch (error) {
    console.error('❌ Get refresh status error:', error);
    res.status(500).json({ error: 'Failed to get refresh status' });
  }
});

// ============================================
// GET /api/recommendations/notifications
// Get user notifications
// ============================================
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, category = null, includeRead = 'false' } = req.query;

    const notificationService = new NotificationService(db.pool);

    const notifications = await notificationService.getAll(userId, {
      limit: parseInt(limit),
      category,
      includeRead: includeRead === 'true'
    });

    const unreadCount = await notificationService.getUnreadCount(userId);

    res.json({
      success: true,
      notifications,
      unreadCount
    });

  } catch (error) {
    console.error('❌ Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// ============================================
// POST /api/recommendations/notifications/:id/read
// Mark notification as read
// ============================================
router.post('/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.id;

    const notificationService = new NotificationService(db.pool);
    await notificationService.markAsRead(notificationId, userId);

    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    console.error('❌ Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// ============================================
// POST /api/recommendations/notifications/:id/dismiss
// Dismiss notification
// ============================================
router.post('/notifications/:id/dismiss', authenticateToken, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.id;

    const notificationService = new NotificationService(db.pool);
    await notificationService.dismiss(notificationId, userId);

    res.json({
      success: true,
      message: 'Notification dismissed'
    });

  } catch (error) {
    console.error('❌ Dismiss notification error:', error);
    res.status(500).json({ error: 'Failed to dismiss notification' });
  }
});

// ============================================
// POST /api/recommendations/notifications/mark-all-read
// Mark all notifications as read
// ============================================
router.post('/notifications/mark-all-read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const notificationService = new NotificationService(db.pool);
    await notificationService.markAllAsRead(userId);

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });

  } catch (error) {
    console.error('❌ Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

module.exports = router;