/**
 * Database Test Helpers
 *
 * Provides utilities for test database operations:
 * - Connection management
 * - Table truncation (FK-safe order)
 * - Transaction helpers
 */

'use strict';

const pool = require('../../db/database');

/**
 * Truncates submission-related tables in FK-safe order.
 * Uses RESTART IDENTITY CASCADE for clean state.
 *
 * @param {Object} [client] - Optional DB client (for transactions)
 */
async function truncateSubmissionTables(client) {
  const db = client || pool;

  // Order matters: children before parents
  const tables = [
    'submission_artifacts',
    'submission_events',
    'submission_runs',
    'submission_targets'
  ];

  for (const table of tables) {
    try {
      await db.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
    } catch (error) {
      // Table might not exist in test environment
      if (error.code !== '42P01') { // relation does not exist
        throw error;
      }
    }
  }
}

/**
 * Truncates all test-related tables including users, profiles, directories.
 * Use with caution - this wipes all data.
 *
 * @param {Object} [client] - Optional DB client
 */
async function truncateAllTestTables(client) {
  const db = client || pool;

  // Order matters: children before parents
  const tables = [
    'submission_artifacts',
    'submission_events',
    'submission_runs',
    'submission_targets',
    'business_profiles',
    // Don't truncate directories - they may have seed data
    // Don't truncate users - handled separately
  ];

  for (const table of tables) {
    try {
      await db.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
    } catch (error) {
      if (error.code !== '42P01') {
        throw error;
      }
    }
  }
}

/**
 * Cleans up test data by ID (safer than truncate)
 *
 * @param {Object} ids - IDs of entities to delete
 * @param {string} [ids.userId] - User ID
 * @param {string} [ids.profileId] - Business profile ID
 * @param {string} [ids.targetId] - Submission target ID
 * @param {string} [ids.runId] - Submission run ID
 */
async function cleanupTestData(ids) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete in FK-safe order
    if (ids.runId) {
      await client.query('DELETE FROM submission_artifacts WHERE submission_run_id = $1', [ids.runId]);
      await client.query('DELETE FROM submission_events WHERE submission_run_id = $1', [ids.runId]);
      await client.query('DELETE FROM submission_runs WHERE id = $1', [ids.runId]);
    }

    if (ids.targetId) {
      await client.query('DELETE FROM submission_artifacts WHERE submission_target_id = $1', [ids.targetId]);
      await client.query('DELETE FROM submission_events WHERE submission_target_id = $1', [ids.targetId]);
      await client.query('DELETE FROM submission_runs WHERE submission_target_id = $1', [ids.targetId]);
      await client.query('DELETE FROM submission_targets WHERE id = $1', [ids.targetId]);
    }

    if (ids.profileId) {
      await client.query('DELETE FROM submission_targets WHERE business_profile_id = $1', [ids.profileId]);
      await client.query('DELETE FROM business_profiles WHERE id = $1', [ids.profileId]);
    }

    if (ids.userId) {
      await client.query('DELETE FROM business_profiles WHERE user_id = $1', [ids.userId]);
      await client.query('DELETE FROM users WHERE id = $1', [ids.userId]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Gets the database pool for direct queries
 *
 * @returns {Object} Database pool
 */
function getPool() {
  return pool;
}

/**
 * Ends the database pool (call in afterAll)
 */
async function endPool() {
  await pool.end();
}

module.exports = {
  truncateSubmissionTables,
  truncateAllTestTables,
  cleanupTestData,
  getPool,
  endPool
};
