/**
 * Phase 5: Submission API Routes
 *
 * API endpoints for submission management.
 *
 * Invariants:
 * 1. All run-mutating endpoints enforce ownership checks
 * 2. All status changes go through StateMachineService
 * 3. Artifacts are only accessible to owners
 */

'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../../db/database');
const { authenticateToken } = require('../../middleware/auth');
const stateMachine = require('../../services/submission/StateMachineService');
const artifactWriter = require('../../services/submission/ArtifactWriter');
const {
  SUBMISSION_STATUS,
  STATUS_REASON,
  TRIGGERED_BY
} = require('../../constants/submission-enums');

// ============================================
// OWNERSHIP HELPERS
// ============================================

/**
 * Verifies that a run is owned by the requesting user
 *
 * @param {string} runId - UUID of the run
 * @param {string} userId - UUID of the user
 * @returns {Promise<Object>} Run object if owned
 * @throws {Error} If not owned or not found
 */
async function assertRunOwnedByUser(runId, userId) {
  const result = await pool.query(
    `SELECT sr.*, st.business_profile_id, bp.user_id
     FROM submission_runs sr
     JOIN submission_targets st ON st.id = sr.submission_target_id
     JOIN business_profiles bp ON bp.id = st.business_profile_id
     WHERE sr.id = $1`,
    [runId]
  );

  if (result.rows.length === 0) {
    const error = new Error('Run not found');
    error.status = 404;
    throw error;
  }

  const run = result.rows[0];

  if (run.user_id !== userId) {
    const error = new Error('Access denied');
    error.status = 403;
    throw error;
  }

  return run;
}

/**
 * Verifies that a target is owned by the requesting user
 *
 * @param {string} targetId - UUID of the target
 * @param {string} userId - UUID of the user
 * @returns {Promise<Object>} Target object if owned
 * @throws {Error} If not owned or not found
 */
async function assertTargetOwnedByUser(targetId, userId) {
  const result = await pool.query(
    `SELECT st.*, bp.user_id
     FROM submission_targets st
     JOIN business_profiles bp ON bp.id = st.business_profile_id
     WHERE st.id = $1`,
    [targetId]
  );

  if (result.rows.length === 0) {
    const error = new Error('Target not found');
    error.status = 404;
    throw error;
  }

  const target = result.rows[0];

  if (target.user_id !== userId) {
    const error = new Error('Access denied');
    error.status = 403;
    throw error;
  }

  return target;
}

// ============================================
// TARGET ENDPOINTS
// ============================================

/**
 * GET /api/submissions/targets
 * List submission targets for the authenticated user
 */
router.get('/targets', authenticateToken, async (req, res) => {
  try {
    const { status, directoryId, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT st.*, d.name as directory_name, d.logo_url as directory_logo
      FROM submission_targets st
      JOIN directories d ON d.id = st.directory_id
      JOIN business_profiles bp ON bp.id = st.business_profile_id
      WHERE bp.user_id = $1
    `;
    const params = [req.user.id];
    let paramIndex = 2;

    if (status) {
      query += ` AND st.current_status = $${paramIndex++}`;
      params.push(status);
    }

    if (directoryId) {
      query += ` AND st.directory_id = $${paramIndex++}`;
      params.push(parseInt(directoryId));
    }

    query += ` ORDER BY st.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    res.json({ targets: result.rows });

  } catch (error) {
    console.error('Error listing targets:', error);
    res.status(500).json({ error: 'Failed to list targets' });
  }
});

/**
 * GET /api/submissions/targets/:targetId
 * Get a specific submission target
 */
router.get('/targets/:targetId', authenticateToken, async (req, res) => {
  try {
    const target = await assertTargetOwnedByUser(req.params.targetId, req.user.id);
    res.json({ target });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ============================================
// RUN ENDPOINTS
// ============================================

/**
 * GET /api/submissions/runs/:runId
 * Get a specific submission run
 */
router.get('/runs/:runId', authenticateToken, async (req, res) => {
  try {
    const run = await assertRunOwnedByUser(req.params.runId, req.user.id);
    res.json({ run });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * GET /api/submissions/runs/:runId/events
 * Get events for a submission run
 */
router.get('/runs/:runId/events', authenticateToken, async (req, res) => {
  try {
    await assertRunOwnedByUser(req.params.runId, req.user.id);

    const result = await pool.query(
      `SELECT * FROM submission_events
       WHERE submission_run_id = $1
       ORDER BY created_at DESC`,
      [req.params.runId]
    );

    res.json({ events: result.rows });

  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * GET /api/submissions/runs/:runId/artifacts
 * Get artifacts for a submission run
 */
router.get('/runs/:runId/artifacts', authenticateToken, async (req, res) => {
  try {
    await assertRunOwnedByUser(req.params.runId, req.user.id);

    const artifacts = await artifactWriter.getRunArtifacts(req.params.runId);
    res.json({ artifacts });

  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * POST /api/submissions/runs/:runId/pause
 * Pause a submission run
 */
router.post('/runs/:runId/pause', authenticateToken, async (req, res) => {
  try {
    const run = await assertRunOwnedByUser(req.params.runId, req.user.id);

    // Validate current status allows pause
    const pausableStatuses = [
      SUBMISSION_STATUS.QUEUED,
      SUBMISSION_STATUS.DEFERRED,
      SUBMISSION_STATUS.IN_PROGRESS,
      SUBMISSION_STATUS.ACTION_NEEDED
    ];

    if (!pausableStatuses.includes(run.status)) {
      return res.status(400).json({
        error: `Cannot pause from status: ${run.status}`
      });
    }

    const updatedRun = await stateMachine.transitionRunStatus(req.params.runId, {
      toStatus: SUBMISSION_STATUS.PAUSED,
      reason: STATUS_REASON.MANUAL_PAUSE,
      triggeredBy: TRIGGERED_BY.USER,
      triggeredById: req.user.id
    });

    res.json({ run: updatedRun });

  } catch (error) {
    console.error('Error pausing run:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * POST /api/submissions/runs/:runId/resume
 * Resume a paused submission run
 */
router.post('/runs/:runId/resume', authenticateToken, async (req, res) => {
  try {
    const run = await assertRunOwnedByUser(req.params.runId, req.user.id);

    if (run.status !== SUBMISSION_STATUS.PAUSED) {
      return res.status(400).json({
        error: `Cannot resume from status: ${run.status}. Must be paused.`
      });
    }

    const updatedRun = await stateMachine.transitionRunStatus(req.params.runId, {
      toStatus: SUBMISSION_STATUS.QUEUED,
      reason: STATUS_REASON.MANUAL_RESUME,
      triggeredBy: TRIGGERED_BY.USER,
      triggeredById: req.user.id
    });

    res.json({ run: updatedRun });

  } catch (error) {
    console.error('Error resuming run:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * POST /api/submissions/runs/:runId/cancel
 * Cancel a submission run
 */
router.post('/runs/:runId/cancel', authenticateToken, async (req, res) => {
  try {
    const run = await assertRunOwnedByUser(req.params.runId, req.user.id);

    // Validate current status allows cancellation
    const cancellableStatuses = [
      SUBMISSION_STATUS.QUEUED,
      SUBMISSION_STATUS.DEFERRED,
      SUBMISSION_STATUS.PAUSED,
      SUBMISSION_STATUS.IN_PROGRESS,
      SUBMISSION_STATUS.ACTION_NEEDED,
      SUBMISSION_STATUS.NEEDS_CHANGES
    ];

    if (!cancellableStatuses.includes(run.status)) {
      return res.status(400).json({
        error: `Cannot cancel from status: ${run.status}`
      });
    }

    const updatedRun = await stateMachine.transitionRunStatus(req.params.runId, {
      toStatus: SUBMISSION_STATUS.CANCELLED,
      reason: STATUS_REASON.MANUAL_CANCEL,
      triggeredBy: TRIGGERED_BY.USER,
      triggeredById: req.user.id
    });

    res.json({ run: updatedRun });

  } catch (error) {
    console.error('Error cancelling run:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * POST /api/submissions/runs/:runId/acknowledge-changes
 * Acknowledge changes required by directory (required before retry)
 */
router.post('/runs/:runId/acknowledge-changes', authenticateToken, async (req, res) => {
  try {
    const run = await assertRunOwnedByUser(req.params.runId, req.user.id);

    if (run.status !== SUBMISSION_STATUS.NEEDS_CHANGES && run.status !== SUBMISSION_STATUS.REJECTED) {
      return res.status(400).json({
        error: `Cannot acknowledge changes from status: ${run.status}`
      });
    }

    const updatedRun = await stateMachine.acknowledgeChanges(
      req.params.runId,
      req.user.id
    );

    res.json({ run: updatedRun });

  } catch (error) {
    console.error('Error acknowledging changes:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * POST /api/submissions/runs/:runId/retry
 * Retry a submission from NEEDS_CHANGES or terminal state
 */
router.post('/runs/:runId/retry', authenticateToken, async (req, res) => {
  try {
    const run = await assertRunOwnedByUser(req.params.runId, req.user.id);

    const retryableStatuses = [
      SUBMISSION_STATUS.NEEDS_CHANGES,
      SUBMISSION_STATUS.FAILED,
      SUBMISSION_STATUS.BLOCKED,
      SUBMISSION_STATUS.DISABLED,
      SUBMISSION_STATUS.EXPIRED
    ];

    if (!retryableStatuses.includes(run.status)) {
      return res.status(400).json({
        error: `Cannot retry from status: ${run.status}`
      });
    }

    // For NEEDS_CHANGES, require acknowledgment
    if (run.status === SUBMISSION_STATUS.NEEDS_CHANGES && !run.changes_acknowledged) {
      return res.status(400).json({
        error: 'Must acknowledge changes before retrying'
      });
    }

    // Create new run for retry
    const newRun = await stateMachine.createRun(run.submission_target_id, {
      triggeredBy: TRIGGERED_BY.USER,
      triggeredById: req.user.id,
      previousRunId: run.id,
      correlationId: run.correlation_id
    });

    res.json({ run: newRun, previousRunId: run.id });

  } catch (error) {
    console.error('Error retrying run:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * POST /api/submissions/runs/:runId/complete-action
 * Mark an action as completed by the user
 */
router.post('/runs/:runId/complete-action', authenticateToken, async (req, res) => {
  try {
    const run = await assertRunOwnedByUser(req.params.runId, req.user.id);

    if (run.status !== SUBMISSION_STATUS.ACTION_NEEDED) {
      return res.status(400).json({
        error: `Cannot complete action from status: ${run.status}`
      });
    }

    // User claims they completed the action, transition to SUBMITTED
    const updatedRun = await stateMachine.transitionRunStatus(req.params.runId, {
      toStatus: SUBMISSION_STATUS.SUBMITTED,
      reason: STATUS_REASON.SUBMISSION_ACCEPTED,
      triggeredBy: TRIGGERED_BY.USER,
      triggeredById: req.user.id,
      meta: {
        rawStatus: 'user_completed'
      }
    });

    res.json({ run: updatedRun });

  } catch (error) {
    console.error('Error completing action:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ============================================
// HISTORY ENDPOINTS
// ============================================

/**
 * GET /api/submissions/runs/:runId/lineage
 * Get the retry lineage for a run
 */
router.get('/runs/:runId/lineage', authenticateToken, async (req, res) => {
  try {
    await assertRunOwnedByUser(req.params.runId, req.user.id);

    const result = await pool.query(
      `SELECT * FROM get_run_lineage($1)`,
      [req.params.runId]
    );

    res.json({ lineage: result.rows });

  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

module.exports = router;
