/**
 * Phase 5: WorkerService
 *
 * Coordinates submission processing with connectors.
 *
 * Invariants:
 * 1. All status changes go through StateMachineService.transitionRunStatus
 * 2. Retries transition to DEFERRED (not FAILED then update)
 * 3. status_reason always uses STATUS_REASON enum values
 * 4. ACTION_NEEDED requires valid action_needed_type
 */

'use strict';

const pool = require('../../db/database');
const stateMachine = require('./StateMachineService');
const lockManager = require('./LockManager');
const connectorRegistry = require('./ConnectorRegistry');
const artifactWriter = require('./ArtifactWriter');
const {
  SUBMISSION_STATUS,
  SUBMISSION_EVENT_TYPE,
  STATUS_REASON,
  TRIGGERED_BY,
  ERROR_TYPE,
  ARTIFACT_TYPE,
  RETRY_POLICY,
  mapActionNeededToStatusReason,
  mapErrorTypeToStatusReason,
  isRetryableError,
  calculateRetryDelay
} = require('../../constants/submission-enums');

class WorkerService {
  constructor() {
    this.workerId = `worker-${process.pid}-${Date.now()}`;
  }

  /**
   * Processes a queued submission run
   *
   * @param {string} runId - UUID of the run to process
   * @returns {Promise<Object>} Processing result
   */
  async processRun(runId) {
    // Acquire lock
    const lockResult = await lockManager.acquireLock(runId, this.workerId);
    if (!lockResult.success) {
      return { success: false, reason: lockResult.reason };
    }

    try {
      // Transition to IN_PROGRESS
      const run = await stateMachine.transitionRunStatus(runId, {
        toStatus: SUBMISSION_STATUS.IN_PROGRESS,
        reason: STATUS_REASON.SCHEDULED,
        triggeredBy: TRIGGERED_BY.WORKER,
        triggeredById: this.workerId
      });

      // Get target and directory info
      const targetResult = await pool.query(
        `SELECT st.*, d.name as directory_name, d.connector_key, d.submission_url,
                d.default_submission_mode, d.rate_limit_rpm, d.capabilities,
                bp.business_name, bp.website, bp.description, bp.address,
                bp.city, bp.state, bp.zip, bp.phone, bp.email
         FROM submission_targets st
         JOIN directories d ON d.id = st.directory_id
         JOIN business_profiles bp ON bp.id = st.business_profile_id
         WHERE st.id = $1`,
        [run.submission_target_id]
      );

      if (targetResult.rows.length === 0) {
        throw new Error(`Target not found for run: ${runId}`);
      }

      const target = targetResult.rows[0];

      // Get connector
      const connector = connectorRegistry.getConnector(target.connector_key);
      if (!connector) {
        throw new Error(`Connector not found: ${target.connector_key}`);
      }

      // Build submission payload
      const payload = this._buildPayload(target);

      // Store request payload artifact
      await artifactWriter.store({
        runId,
        targetId: target.id,
        type: ARTIFACT_TYPE.REQUEST_PAYLOAD,
        content: payload,
        contentType: 'application/json'
      });

      // Execute connector
      const result = await connector.submit(payload, {
        directoryId: target.directory_id,
        connectorKey: target.connector_key,
        submissionUrl: target.submission_url
      });

      // Handle result
      await this.handleSubmitResult(runId, run, target, result);

      return { success: true, runId, result };

    } catch (error) {
      await this._handleError(runId, error);
      return { success: false, runId, error: error.message };
    } finally {
      // Release lock
      await lockManager.releaseLock(runId, this.workerId);
    }
  }

  /**
   * Handles the result of a connector submission
   */
  async handleSubmitResult(runId, run, target, result) {
    // Store response artifact
    if (result.response) {
      await artifactWriter.store({
        runId,
        targetId: target.id,
        type: ARTIFACT_TYPE.RESPONSE_PAYLOAD,
        content: result.response,
        contentType: 'application/json'
      });
    }

    // Handle different result types
    switch (result.status) {
      case 'submitted':
        await this._handleSubmitted(runId, result);
        break;

      case 'action_needed':
        await this._handleActionNeeded(runId, result);
        break;

      case 'already_listed':
        await this._handleAlreadyListed(runId, result);
        break;

      case 'error':
        await this._handleConnectorError(runId, run, result);
        break;

      default:
        throw new Error(`Unknown result status: ${result.status}`);
    }
  }

  /**
   * Handles successful submission
   */
  async _handleSubmitted(runId, result) {
    await stateMachine.transitionRunStatus(runId, {
      toStatus: SUBMISSION_STATUS.SUBMITTED,
      reason: STATUS_REASON.SUBMISSION_ACCEPTED,
      triggeredBy: TRIGGERED_BY.WORKER,
      triggeredById: this.workerId,
      meta: {
        externalSubmissionId: result.externalId,
        rawStatus: result.rawStatus,
        rawStatusMessage: result.rawStatusMessage
      }
    });
  }

  /**
   * Handles action needed result
   * CRITICAL: Uses STATUS_REASON enum values, NOT ACTION_NEEDED_TYPE
   */
  async _handleActionNeeded(runId, result) {
    const actionType = result.actionNeeded?.type;

    if (!actionType) {
      throw new Error('ACTION_NEEDED result must include actionNeeded.type');
    }

    // Map ACTION_NEEDED_TYPE to STATUS_REASON (enum-safe)
    const statusReason = mapActionNeededToStatusReason(actionType);

    // Calculate deadline (default 10 days)
    const deadline = result.actionNeeded.deadline ||
      new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

    await stateMachine.transitionRunStatus(runId, {
      toStatus: SUBMISSION_STATUS.ACTION_NEEDED,
      reason: statusReason, // STATUS_REASON enum value
      triggeredBy: TRIGGERED_BY.WORKER,
      triggeredById: this.workerId,
      meta: {
        actionNeeded: {
          type: actionType, // ACTION_NEEDED_TYPE for the action_needed_type column
          url: result.actionNeeded.url,
          fields: result.actionNeeded.fields,
          deadline
        }
      }
    });

    // Store instructions artifact if provided
    if (result.actionNeeded.instructions) {
      await artifactWriter.store({
        runId,
        type: ARTIFACT_TYPE.INSTRUCTIONS,
        contentText: result.actionNeeded.instructions,
        contentType: 'text/plain'
      });
    }
  }

  /**
   * Handles already listed result
   */
  async _handleAlreadyListed(runId, result) {
    await stateMachine.transitionRunStatus(runId, {
      toStatus: SUBMISSION_STATUS.ALREADY_LISTED,
      reason: STATUS_REASON.ALREADY_EXISTS,
      triggeredBy: TRIGGERED_BY.WORKER,
      triggeredById: this.workerId,
      meta: {
        externalSubmissionId: result.existingListingId,
        rawStatus: 'already_listed'
      }
    });
  }

  /**
   * Handles connector error with proper retry logic
   * CRITICAL: Uses DEFERRED for retryable errors, FAILED for non-retryable
   */
  async _handleConnectorError(runId, run, result) {
    const errorType = result.errorType || ERROR_TYPE.CONNECTOR_ERROR;
    const attemptNo = run.attempt_no || 1;
    const canRetry = isRetryableError(errorType) && attemptNo < RETRY_POLICY.MAX_ATTEMPTS;

    if (canRetry) {
      // Transition directly to DEFERRED (not FAILED then update)
      const retryDelayMs = calculateRetryDelay(attemptNo);
      const statusReason = mapErrorTypeToStatusReason(errorType);

      await stateMachine.transitionRunStatus(runId, {
        toStatus: SUBMISSION_STATUS.DEFERRED,
        reason: statusReason,
        triggeredBy: TRIGGERED_BY.WORKER,
        triggeredById: this.workerId,
        meta: {
          errorType,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          scheduleRetry: true,
          retryDelayMs,
          clearLock: true
        }
      });
    } else {
      // Non-retryable or max attempts reached - transition to FAILED
      await stateMachine.transitionRunStatus(runId, {
        toStatus: SUBMISSION_STATUS.FAILED,
        reason: mapErrorTypeToStatusReason(errorType),
        triggeredBy: TRIGGERED_BY.WORKER,
        triggeredById: this.workerId,
        meta: {
          errorType,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage || `Max attempts (${RETRY_POLICY.MAX_ATTEMPTS}) exceeded`,
          clearLock: true
        }
      });
    }

    // Store error log artifact
    await artifactWriter.store({
      runId,
      type: ARTIFACT_TYPE.ERROR_LOG,
      content: {
        errorType,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        attemptNo,
        canRetry,
        timestamp: new Date().toISOString()
      },
      contentType: 'application/json'
    });
  }

  /**
   * Handles unexpected errors during processing
   */
  async _handleError(runId, error) {
    try {
      // Get run to check attempt count
      const runResult = await pool.query(
        `SELECT attempt_no FROM submission_runs WHERE id = $1`,
        [runId]
      );

      const attemptNo = runResult.rows[0]?.attempt_no || 1;
      const canRetry = attemptNo < RETRY_POLICY.MAX_ATTEMPTS;

      if (canRetry) {
        const retryDelayMs = calculateRetryDelay(attemptNo);

        await stateMachine.transitionRunStatus(runId, {
          toStatus: SUBMISSION_STATUS.DEFERRED,
          reason: STATUS_REASON.CONNECTOR_ERROR,
          triggeredBy: TRIGGERED_BY.WORKER,
          triggeredById: this.workerId,
          meta: {
            errorType: ERROR_TYPE.UNKNOWN,
            errorMessage: error.message,
            scheduleRetry: true,
            retryDelayMs,
            clearLock: true
          }
        });
      } else {
        await stateMachine.transitionRunStatus(runId, {
          toStatus: SUBMISSION_STATUS.FAILED,
          reason: STATUS_REASON.CONNECTOR_ERROR,
          triggeredBy: TRIGGERED_BY.WORKER,
          triggeredById: this.workerId,
          meta: {
            errorType: ERROR_TYPE.UNKNOWN,
            errorMessage: error.message,
            clearLock: true
          }
        });
      }
    } catch (transitionError) {
      console.error(`Failed to transition run ${runId} after error:`, transitionError);
    }
  }

  /**
   * Builds submission payload from target data
   */
  _buildPayload(target) {
    return {
      business: {
        name: target.business_name,
        website: target.website,
        description: target.description,
        address: target.address,
        city: target.city,
        state: target.state,
        zip: target.zip,
        phone: target.phone,
        email: target.email
      },
      directory: {
        id: target.directory_id,
        name: target.directory_name,
        submissionUrl: target.submission_url
      },
      submission: {
        targetId: target.id,
        mode: target.default_submission_mode
      }
    };
  }

  /**
   * Processes deferred runs that are ready for retry
   */
  async processReadyRuns() {
    const readyRuns = await pool.query(
      `SELECT id FROM submission_runs
       WHERE status = $1
         AND next_run_at <= NOW()
         AND (locked_at IS NULL OR lease_expires_at < NOW())
       ORDER BY next_run_at ASC
       LIMIT 10`,
      [SUBMISSION_STATUS.DEFERRED]
    );

    const results = [];

    for (const run of readyRuns.rows) {
      try {
        // Transition from DEFERRED to QUEUED first
        await stateMachine.transitionRunStatus(run.id, {
          toStatus: SUBMISSION_STATUS.QUEUED,
          reason: STATUS_REASON.SCHEDULED,
          triggeredBy: TRIGGERED_BY.SCHEDULER
        });

        // Then process
        const result = await this.processRun(run.id);
        results.push(result);
      } catch (error) {
        console.error(`Failed to process ready run ${run.id}:`, error.message);
        results.push({ success: false, runId: run.id, error: error.message });
      }
    }

    return results;
  }

  /**
   * Deterministic single-tick execution for tests.
   * Processes queued runs without timers or intervals.
   *
   * @param {Object} options - Tick options
   * @param {number} [options.batchSize=10] - Max runs to process
   * @returns {Promise<Object>} Tick results
   */
  async tickOnce(options = {}) {
    const { batchSize = 10 } = options;

    // First, process any ready deferred runs
    const deferredResult = await pool.query(
      `SELECT id FROM submission_runs
       WHERE status = $1
         AND next_run_at <= NOW()
         AND (locked_at IS NULL OR lease_expires_at < NOW())
       ORDER BY next_run_at ASC
       LIMIT $2`,
      [SUBMISSION_STATUS.DEFERRED, batchSize]
    );

    for (const run of deferredResult.rows) {
      try {
        await stateMachine.transitionRunStatus(run.id, {
          toStatus: SUBMISSION_STATUS.QUEUED,
          reason: STATUS_REASON.SCHEDULED,
          triggeredBy: TRIGGERED_BY.SCHEDULER
        });
      } catch (error) {
        console.error(`Failed to requeue deferred run ${run.id}:`, error.message);
      }
    }

    // Now get queued runs
    const queuedResult = await pool.query(
      `SELECT id FROM submission_runs
       WHERE status = $1
         AND (locked_at IS NULL OR lease_expires_at < NOW())
       ORDER BY created_at ASC
       LIMIT $2`,
      [SUBMISSION_STATUS.QUEUED, batchSize]
    );

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      runs: []
    };

    for (const run of queuedResult.rows) {
      try {
        const result = await this.processRun(run.id);
        results.processed++;
        if (result.success) {
          results.succeeded++;
        } else {
          results.failed++;
        }
        results.runs.push(result);
      } catch (error) {
        results.processed++;
        results.failed++;
        results.runs.push({ success: false, runId: run.id, error: error.message });
      }
    }

    return results;
  }
}

// Singleton instance
const workerServiceInstance = new WorkerService();

// Export both the instance and the class for testing
module.exports = workerServiceInstance;
module.exports.WorkerService = WorkerService;
