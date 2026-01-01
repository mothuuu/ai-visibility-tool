/**
 * Phase 5: StateMachineService
 *
 * THE ONLY WAY to change submission_runs.status.
 *
 * Invariants enforced:
 * 1. All status transitions are atomic (within a DB transaction)
 * 2. Every status change emits a canonical STATUS_CHANGE event
 * 3. status_reason always uses STATUS_REASON enum values
 * 4. ACTION_NEEDED requires action_needed_type
 * 5. FAILED/DEFERRED with errors require last_error_type
 * 6. Lock fields are all-or-nothing
 */

'use strict';

const pool = require('../../db/database');
const {
  SUBMISSION_STATUS,
  SUBMISSION_STATUS_META,
  SUBMISSION_EVENT_TYPE,
  STATUS_REASON,
  TRIGGERED_BY,
  ACTION_NEEDED_TYPE,
  ERROR_TYPE,
  ARTIFACT_TYPE,
  isValidTransition,
  isTerminalStatus,
  mapActionNeededToStatusReason,
  RETRY_POLICY,
  calculateRetryDelay
} = require('../../constants/submission-enums');

class StateMachineService {
  /**
   * Transitions a submission run to a new status.
   * This is the ONLY method that should update submission_runs.status.
   *
   * @param {string} runId - UUID of the submission run
   * @param {Object} options - Transition options
   * @param {string} options.toStatus - Target SUBMISSION_STATUS
   * @param {string} options.reason - STATUS_REASON value (must be valid enum)
   * @param {string} options.triggeredBy - TRIGGERED_BY value
   * @param {string} [options.triggeredById] - ID of the triggering entity
   * @param {Object} [options.meta] - Additional metadata
   * @param {Object} [options.meta.actionNeeded] - For ACTION_NEEDED status
   * @param {string} [options.meta.actionNeeded.type] - ACTION_NEEDED_TYPE value (required)
   * @param {string} [options.meta.actionNeeded.url] - URL for action
   * @param {Object} [options.meta.actionNeeded.fields] - Fields required
   * @param {Date} [options.meta.actionNeeded.deadline] - Deadline for action
   * @param {string} [options.meta.errorType] - ERROR_TYPE for failures
   * @param {string} [options.meta.errorCode] - Error code
   * @param {string} [options.meta.errorMessage] - Error message
   * @param {boolean} [options.meta.scheduleRetry] - Whether to schedule retry
   * @param {number} [options.meta.retryDelayMs] - Retry delay in ms
   * @param {Date} [options.meta.nextRunAt] - Specific next run time
   * @param {boolean} [options.meta.clearLock] - Clear lock fields
   * @param {string} [options.meta.externalSubmissionId] - External ID from directory
   * @param {string} [options.meta.rawStatus] - Raw status from directory
   * @param {string} [options.meta.rawStatusMessage] - Raw status message
   * @param {Object} [options.client] - Existing DB client (for external transactions)
   * @returns {Promise<Object>} Updated run object
   */
  async transitionRunStatus(runId, options) {
    const {
      toStatus,
      reason,
      triggeredBy = TRIGGERED_BY.SYSTEM,
      triggeredById = null,
      meta = {},
      client: externalClient = null
    } = options;

    // Validate inputs
    this._validateTransitionInputs(toStatus, reason, meta);

    // Use external client or acquire our own
    const client = externalClient || await pool.connect();
    const isOwnTransaction = !externalClient;

    try {
      if (isOwnTransaction) {
        await client.query('BEGIN');
      }

      // Lock the run row for update
      const runResult = await client.query(
        `SELECT * FROM submission_runs WHERE id = $1 FOR UPDATE`,
        [runId]
      );

      if (runResult.rows.length === 0) {
        throw new Error(`Run not found: ${runId}`);
      }

      const run = runResult.rows[0];
      const fromStatus = run.status;

      // Validate transition is allowed
      if (!isValidTransition(fromStatus, toStatus)) {
        throw new Error(
          `Invalid transition: ${fromStatus} -> ${toStatus}. ` +
          `Allowed: ${SUBMISSION_STATUS_META[fromStatus]?.nextStates?.join(', ') || 'none'}`
        );
      }

      // Pre-transition checks
      await this._preTransitionChecks(client, run, toStatus, meta);

      // Build update fields
      const { fields, values, paramIndex } = this._buildUpdateFields(
        run,
        toStatus,
        reason,
        meta
      );

      // Update the run
      const updateQuery = `
        UPDATE submission_runs
        SET ${fields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;
      values.push(runId);

      const updateResult = await client.query(updateQuery, values);
      const updatedRun = updateResult.rows[0];

      // Insert canonical STATUS_CHANGE event
      await this._insertStatusChangeEvent(client, {
        runId,
        targetId: run.submission_target_id,
        fromStatus,
        toStatus,
        reason,
        triggeredBy,
        triggeredById,
        meta
      });

      // Post-transition actions (non-status-updating)
      await this._postTransitionActions(client, updatedRun, fromStatus, toStatus, meta);

      if (isOwnTransaction) {
        await client.query('COMMIT');
      }

      return updatedRun;

    } catch (error) {
      if (isOwnTransaction) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      if (isOwnTransaction) {
        client.release();
      }
    }
  }

  /**
   * Validates transition inputs
   */
  _validateTransitionInputs(toStatus, reason, meta) {
    // Validate toStatus is a valid SUBMISSION_STATUS
    if (!Object.values(SUBMISSION_STATUS).includes(toStatus)) {
      throw new Error(`Invalid toStatus: ${toStatus}`);
    }

    // Validate reason is a valid STATUS_REASON
    if (reason && !Object.values(STATUS_REASON).includes(reason)) {
      throw new Error(`Invalid status_reason: ${reason}. Must be a STATUS_REASON enum value.`);
    }

    // ACTION_NEEDED requires action_needed_type
    if (toStatus === SUBMISSION_STATUS.ACTION_NEEDED) {
      if (!meta.actionNeeded?.type) {
        throw new Error('ACTION_NEEDED status requires meta.actionNeeded.type');
      }
      if (!Object.values(ACTION_NEEDED_TYPE).includes(meta.actionNeeded.type)) {
        throw new Error(`Invalid action_needed_type: ${meta.actionNeeded.type}`);
      }
    }

    // FAILED requires last_error_type
    if (toStatus === SUBMISSION_STATUS.FAILED) {
      if (!meta.errorType) {
        throw new Error('FAILED status requires meta.errorType');
      }
      if (!Object.values(ERROR_TYPE).includes(meta.errorType)) {
        throw new Error(`Invalid error_type: ${meta.errorType}`);
      }
    }

    // DEFERRED with error info requires valid error_type
    if (toStatus === SUBMISSION_STATUS.DEFERRED && meta.errorType) {
      if (!Object.values(ERROR_TYPE).includes(meta.errorType)) {
        throw new Error(`Invalid error_type: ${meta.errorType}`);
      }
    }
  }

  /**
   * Pre-transition validation checks
   */
  async _preTransitionChecks(client, run, toStatus, meta) {
    // LIVE status requires LIVE_VERIFICATION_RESULT artifact
    if (toStatus === SUBMISSION_STATUS.LIVE) {
      const artifactResult = await client.query(
        `SELECT id FROM submission_artifacts
         WHERE submission_run_id = $1 AND artifact_type = $2`,
        [run.id, ARTIFACT_TYPE.LIVE_VERIFICATION_RESULT]
      );

      if (artifactResult.rows.length === 0) {
        throw new Error(
          'Cannot transition to LIVE without LIVE_VERIFICATION_RESULT artifact'
        );
      }
    }

    // NEEDS_CHANGES retry requires changes_acknowledged
    if (run.status === SUBMISSION_STATUS.NEEDS_CHANGES || run.status === SUBMISSION_STATUS.REJECTED) {
      if (toStatus === SUBMISSION_STATUS.IN_PROGRESS && !run.changes_acknowledged) {
        throw new Error(
          `Cannot retry from ${run.status} without acknowledging changes first`
        );
      }
    }
  }

  /**
   * Builds the UPDATE fields for the run
   */
  _buildUpdateFields(run, toStatus, reason, meta) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    // Always update status and status_changed_at
    fields.push(`status = $${paramIndex++}`);
    values.push(toStatus);

    fields.push(`status_changed_at = NOW()`);

    // Status reason
    if (reason) {
      fields.push(`status_reason = $${paramIndex++}`);
      values.push(reason);
    }

    // Increment attempt_no when transitioning INTO IN_PROGRESS from QUEUED/DEFERRED
    if (toStatus === SUBMISSION_STATUS.IN_PROGRESS) {
      if (run.status === SUBMISSION_STATUS.QUEUED || run.status === SUBMISSION_STATUS.DEFERRED) {
        fields.push(`attempt_no = $${paramIndex++}`);
        values.push((run.attempt_no || 0) + 1);

        fields.push(`started_at = NOW()`);
      }
    }

    // Action needed fields
    if (toStatus === SUBMISSION_STATUS.ACTION_NEEDED && meta.actionNeeded) {
      fields.push(`action_needed_type = $${paramIndex++}`);
      values.push(meta.actionNeeded.type);

      if (meta.actionNeeded.url) {
        fields.push(`action_needed_url = $${paramIndex++}`);
        values.push(meta.actionNeeded.url);
      }

      if (meta.actionNeeded.fields) {
        fields.push(`action_needed_fields = $${paramIndex++}`);
        values.push(JSON.stringify(meta.actionNeeded.fields));
      }

      if (meta.actionNeeded.deadline) {
        fields.push(`action_needed_deadline = $${paramIndex++}`);
        values.push(meta.actionNeeded.deadline);
      }
    }

    // Error fields (for FAILED or DEFERRED with errors)
    if (meta.errorType) {
      fields.push(`last_error_type = $${paramIndex++}`);
      values.push(meta.errorType);

      if (meta.errorCode) {
        fields.push(`last_error_code = $${paramIndex++}`);
        values.push(meta.errorCode);
      }

      if (meta.errorMessage) {
        fields.push(`last_error_message = $${paramIndex++}`);
        values.push(meta.errorMessage);
      }
    }

    // Next run time for DEFERRED
    if (toStatus === SUBMISSION_STATUS.DEFERRED) {
      if (meta.nextRunAt) {
        fields.push(`next_run_at = $${paramIndex++}`);
        values.push(meta.nextRunAt);
      } else if (meta.retryDelayMs) {
        fields.push(`next_run_at = NOW() + interval '${meta.retryDelayMs} milliseconds'`);
      } else if (meta.scheduleRetry) {
        const delay = calculateRetryDelay(run.attempt_no || 1);
        fields.push(`next_run_at = NOW() + interval '${delay} milliseconds'`);
      }
    }

    // Clear lock fields
    if (meta.clearLock) {
      fields.push(`locked_at = NULL`);
      fields.push(`locked_by = NULL`);
      fields.push(`lease_expires_at = NULL`);
    }

    // External submission tracking
    if (meta.externalSubmissionId) {
      fields.push(`external_submission_id = $${paramIndex++}`);
      values.push(meta.externalSubmissionId);
    }

    // Raw status from directory
    if (meta.rawStatus) {
      fields.push(`raw_status = $${paramIndex++}`);
      values.push(meta.rawStatus);
    }

    if (meta.rawStatusMessage) {
      fields.push(`raw_status_message = $${paramIndex++}`);
      values.push(meta.rawStatusMessage);
    }

    // Completed timestamp for terminal states
    if (isTerminalStatus(toStatus)) {
      fields.push(`completed_at = NOW()`);
    }

    // Changes acknowledged tracking
    if (meta.changesAcknowledged) {
      fields.push(`changes_acknowledged = TRUE`);
      fields.push(`changes_acknowledged_at = NOW()`);
      if (meta.acknowledgedBy) {
        fields.push(`changes_acknowledged_by = $${paramIndex++}`);
        values.push(meta.acknowledgedBy);
      }
    }

    return { fields, values, paramIndex };
  }

  /**
   * Inserts the canonical STATUS_CHANGE event
   */
  async _insertStatusChangeEvent(client, params) {
    const {
      runId,
      targetId,
      fromStatus,
      toStatus,
      reason,
      triggeredBy,
      triggeredById,
      meta
    } = params;

    const eventData = {};

    // Include relevant meta in event_data
    if (meta.actionNeeded) {
      eventData.actionNeeded = meta.actionNeeded;
    }
    if (meta.errorType) {
      eventData.errorType = meta.errorType;
      eventData.errorCode = meta.errorCode;
      eventData.errorMessage = meta.errorMessage;
    }
    if (meta.externalSubmissionId) {
      eventData.externalSubmissionId = meta.externalSubmissionId;
    }

    await client.query(
      `INSERT INTO submission_events (
        submission_run_id,
        submission_target_id,
        event_type,
        from_status,
        to_status,
        status_reason,
        triggered_by,
        triggered_by_id,
        event_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        runId,
        targetId,
        SUBMISSION_EVENT_TYPE.STATUS_CHANGE,
        fromStatus,
        toStatus,
        reason || null,
        triggeredBy,
        triggeredById,
        JSON.stringify(eventData)
      ]
    );
  }

  /**
   * Post-transition actions (do NOT update status here!)
   */
  async _postTransitionActions(client, run, fromStatus, toStatus, meta) {
    // Update submission_targets denormalized status
    // (This is now handled by DB trigger, but we can still do it for safety)
    await client.query(
      `UPDATE submission_targets
       SET current_status = $1, current_run_id = $2
       WHERE id = $3`,
      [toStatus, run.id, run.submission_target_id]
    );

    // Emit supplementary events (non-STATUS_CHANGE)
    if (toStatus === SUBMISSION_STATUS.ACTION_NEEDED) {
      await client.query(
        `INSERT INTO submission_events (
          submission_run_id,
          submission_target_id,
          event_type,
          triggered_by,
          event_data
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          run.id,
          run.submission_target_id,
          SUBMISSION_EVENT_TYPE.ACTION_REQUIRED,
          TRIGGERED_BY.SYSTEM,
          JSON.stringify({ actionType: meta.actionNeeded?.type })
        ]
      );
    }

    if (toStatus === SUBMISSION_STATUS.DEFERRED && meta.scheduleRetry) {
      await client.query(
        `INSERT INTO submission_events (
          submission_run_id,
          submission_target_id,
          event_type,
          triggered_by,
          event_data
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          run.id,
          run.submission_target_id,
          SUBMISSION_EVENT_TYPE.RETRY_SCHEDULED,
          TRIGGERED_BY.SYSTEM,
          JSON.stringify({
            attemptNo: run.attempt_no,
            nextRunAt: run.next_run_at || meta.nextRunAt
          })
        ]
      );
    }

    if (toStatus === SUBMISSION_STATUS.LIVE) {
      // Update target with live verification info
      await client.query(
        `UPDATE submission_targets
         SET live_verified_at = NOW()
         WHERE id = $1`,
        [run.submission_target_id]
      );
    }
  }

  /**
   * Acknowledge changes for a run (required before retry from NEEDS_CHANGES/REJECTED)
   */
  async acknowledgeChanges(runId, userId) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE submission_runs
         SET changes_acknowledged = TRUE,
             changes_acknowledged_at = NOW(),
             changes_acknowledged_by = $2
         WHERE id = $1
         RETURNING *`,
        [runId, userId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Run not found: ${runId}`);
      }

      // Insert event
      await client.query(
        `INSERT INTO submission_events (
          submission_run_id,
          submission_target_id,
          event_type,
          triggered_by,
          triggered_by_id,
          event_data
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          runId,
          result.rows[0].submission_target_id,
          SUBMISSION_EVENT_TYPE.USER_CHANGES_ACKNOWLEDGED,
          TRIGGERED_BY.USER,
          userId,
          JSON.stringify({})
        ]
      );

      await client.query('COMMIT');

      return result.rows[0];

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Creates a new submission run for a target
   */
  async createRun(targetId, options = {}) {
    const {
      triggeredBy = TRIGGERED_BY.SYSTEM,
      triggeredById = null,
      previousRunId = null,
      correlationId = null
    } = options;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get previous run info if exists
      let attemptNo = 1;
      let corrId = correlationId;

      if (previousRunId) {
        const prevResult = await client.query(
          `SELECT attempt_no, correlation_id FROM submission_runs WHERE id = $1`,
          [previousRunId]
        );
        if (prevResult.rows.length > 0) {
          attemptNo = (prevResult.rows[0].attempt_no || 0) + 1;
          corrId = corrId || prevResult.rows[0].correlation_id;
        }
      }

      // Insert new run
      const result = await client.query(
        `INSERT INTO submission_runs (
          submission_target_id,
          attempt_no,
          previous_run_id,
          correlation_id,
          status,
          triggered_by,
          triggered_by_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          targetId,
          attemptNo,
          previousRunId,
          corrId,
          SUBMISSION_STATUS.QUEUED,
          triggeredBy,
          triggeredById
        ]
      );

      const run = result.rows[0];

      // Insert CREATED event
      await client.query(
        `INSERT INTO submission_events (
          submission_run_id,
          submission_target_id,
          event_type,
          triggered_by,
          triggered_by_id,
          event_data
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          run.id,
          targetId,
          SUBMISSION_EVENT_TYPE.CREATED,
          triggeredBy,
          triggeredById,
          JSON.stringify({ attemptNo, previousRunId })
        ]
      );

      await client.query('COMMIT');

      return run;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new StateMachineService();
