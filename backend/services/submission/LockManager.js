/**
 * Phase 5: LockManager
 *
 * Manages distributed locks for submission runs.
 *
 * Invariants:
 * 1. Lock fields are all-or-nothing (enforced by DB constraint)
 * 2. Expired lock cleanup uses StateMachineService.transitionRunStatus
 * 3. Never directly updates status outside of StateMachineService
 */

'use strict';

const pool = require('../../db/database');
const stateMachine = require('./StateMachineService');
const {
  SUBMISSION_STATUS,
  SUBMISSION_EVENT_TYPE,
  STATUS_REASON,
  TRIGGERED_BY,
  ERROR_TYPE
} = require('../../constants/submission-enums');

const DEFAULT_LEASE_DURATION_MS = 30000; // 30 seconds
const LOCK_GRACE_PERIOD_MS = 5000; // 5 seconds grace before considering expired

class LockManager {
  /**
   * Attempts to acquire a lock on a submission run
   *
   * @param {string} runId - UUID of the submission run
   * @param {string} workerId - Identifier for the worker acquiring the lock
   * @param {number} [leaseDurationMs] - How long the lock is valid
   * @returns {Promise<Object>} Lock result with success status
   */
  async acquireLock(runId, workerId, leaseDurationMs = DEFAULT_LEASE_DURATION_MS) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Try to acquire lock with optimistic locking
      const result = await client.query(
        `UPDATE submission_runs
         SET locked_at = NOW(),
             locked_by = $2,
             lease_expires_at = NOW() + interval '${leaseDurationMs} milliseconds'
         WHERE id = $1
           AND status = $3
           AND (locked_at IS NULL OR lease_expires_at < NOW() - interval '${LOCK_GRACE_PERIOD_MS} milliseconds')
         RETURNING *`,
        [runId, workerId, SUBMISSION_STATUS.QUEUED]
      );

      if (result.rows.length === 0) {
        // Check why we couldn't acquire
        const checkResult = await client.query(
          `SELECT id, status, locked_by, lease_expires_at
           FROM submission_runs WHERE id = $1`,
          [runId]
        );

        await client.query('ROLLBACK');

        if (checkResult.rows.length === 0) {
          return { success: false, reason: 'not_found' };
        }

        const run = checkResult.rows[0];

        if (run.status !== SUBMISSION_STATUS.QUEUED) {
          return { success: false, reason: 'invalid_status', status: run.status };
        }

        if (run.locked_by === workerId) {
          return { success: true, reason: 'already_held', run };
        }

        return {
          success: false,
          reason: 'lock_held',
          holder: run.locked_by,
          expiresAt: run.lease_expires_at
        };
      }

      // Insert LOCK_ACQUIRED event
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
          SUBMISSION_EVENT_TYPE.LOCK_ACQUIRED,
          TRIGGERED_BY.WORKER,
          workerId,
          JSON.stringify({ leaseDurationMs })
        ]
      );

      await client.query('COMMIT');

      return { success: true, reason: 'acquired', run: result.rows[0] };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Releases a lock on a submission run
   *
   * @param {string} runId - UUID of the submission run
   * @param {string} workerId - Identifier for the worker releasing the lock
   * @returns {Promise<Object>} Release result
   */
  async releaseLock(runId, workerId) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE submission_runs
         SET locked_at = NULL,
             locked_by = NULL,
             lease_expires_at = NULL
         WHERE id = $1 AND locked_by = $2
         RETURNING *`,
        [runId, workerId]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'not_holder' };
      }

      // Insert LOCK_RELEASED event
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
          SUBMISSION_EVENT_TYPE.LOCK_RELEASED,
          TRIGGERED_BY.WORKER,
          workerId,
          JSON.stringify({})
        ]
      );

      await client.query('COMMIT');

      return { success: true, run: result.rows[0] };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Extends a lock lease
   *
   * @param {string} runId - UUID of the submission run
   * @param {string} workerId - Identifier for the worker holding the lock
   * @param {number} [extensionMs] - How long to extend
   * @returns {Promise<Object>} Extension result
   */
  async extendLease(runId, workerId, extensionMs = DEFAULT_LEASE_DURATION_MS) {
    const result = await pool.query(
      `UPDATE submission_runs
       SET lease_expires_at = NOW() + interval '${extensionMs} milliseconds'
       WHERE id = $1 AND locked_by = $2
       RETURNING *`,
      [runId, workerId]
    );

    if (result.rows.length === 0) {
      return { success: false, reason: 'not_holder' };
    }

    return { success: true, run: result.rows[0] };
  }

  /**
   * Cleans up expired locks by transitioning runs to DEFERRED status.
   * DOES NOT directly update status - uses StateMachineService.
   *
   * @returns {Promise<number>} Number of expired locks cleaned up
   */
  async cleanupExpiredLocks() {
    // Find runs with expired locks
    const expiredResult = await pool.query(
      `SELECT id, locked_by, attempt_no
       FROM submission_runs
       WHERE status = $1
         AND locked_at IS NOT NULL
         AND lease_expires_at < NOW() - interval '${LOCK_GRACE_PERIOD_MS} milliseconds'
       LIMIT 100`,
      [SUBMISSION_STATUS.IN_PROGRESS]
    );

    let cleanedCount = 0;

    for (const run of expiredResult.rows) {
      try {
        // Use StateMachineService to transition - NEVER directly update status
        await stateMachine.transitionRunStatus(run.id, {
          toStatus: SUBMISSION_STATUS.DEFERRED,
          reason: STATUS_REASON.LOCK_EXPIRED,
          triggeredBy: TRIGGERED_BY.SYSTEM,
          meta: {
            errorType: ERROR_TYPE.LOCK_ERROR,
            errorMessage: `Lock expired for worker: ${run.locked_by}`,
            scheduleRetry: true,
            clearLock: true
          }
        });

        cleanedCount++;

      } catch (error) {
        console.error(`Failed to cleanup expired lock for run ${run.id}:`, error.message);
        // Continue with other runs
      }
    }

    return cleanedCount;
  }

  /**
   * Checks if a lock can be acquired
   *
   * @param {string} runId - UUID of the submission run
   * @param {string} workerId - Identifier for the worker
   * @returns {Promise<Object>} Lock check result
   */
  async canAcquireLock(runId, workerId) {
    const result = await pool.query(
      `SELECT can_lock, reason, current_holder, expires_at
       FROM can_acquire_lock($1, $2, $3)`,
      [runId, workerId, LOCK_GRACE_PERIOD_MS]
    );

    if (result.rows.length === 0) {
      return { canLock: false, reason: 'not_found' };
    }

    return result.rows[0];
  }
}

module.exports = new LockManager();
