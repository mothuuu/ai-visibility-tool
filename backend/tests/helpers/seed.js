/**
 * Test Seed Helpers
 *
 * Provides utilities for seeding test data:
 * - Users
 * - Business profiles
 * - Directories (with test connector)
 * - Submission targets and runs
 */

'use strict';

const pool = require('../../db/database');
const crypto = require('crypto');

/**
 * Generates a UUID for tests
 *
 * @returns {string} UUID
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Seeds a test user
 *
 * @param {Object} [options] - User options
 * @param {string} [options.email] - User email
 * @param {string} [options.name] - User name
 * @param {string} [options.plan] - User plan
 * @returns {Promise<Object>} Created user
 */
async function seedUser(options = {}) {
  const id = generateUUID();
  const email = options.email || `test-${id.substring(0, 8)}@example.com`;
  const name = options.name || 'Test User';
  const plan = options.plan || 'pro';

  const result = await pool.query(
    `INSERT INTO users (id, email, name, plan, email_verified, password_hash, created_at)
     VALUES ($1, $2, $3, $4, true, 'test-hash', NOW())
     ON CONFLICT (email) DO UPDATE SET name = $3
     RETURNING *`,
    [id, email, name, plan]
  );

  return result.rows[0];
}

/**
 * Seeds a business profile for a user
 *
 * @param {string} userId - User ID
 * @param {Object} [options] - Profile options
 * @returns {Promise<Object>} Created profile
 */
async function seedBusinessProfile(userId, options = {}) {
  const id = generateUUID();

  const result = await pool.query(
    `INSERT INTO business_profiles (
      id, user_id, business_name, website, description,
      address, city, state, zip, phone, email, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    RETURNING *`,
    [
      id,
      userId,
      options.businessName || 'Test Business',
      options.website || 'https://test-business.example.com',
      options.description || 'A test business for E2E testing',
      options.address || '123 Test Street',
      options.city || 'Test City',
      options.state || 'TS',
      options.zip || '12345',
      options.phone || '555-123-4567',
      options.email || 'contact@test-business.example.com'
    ]
  );

  return result.rows[0];
}

/**
 * Seeds a test directory with test-connector-v1
 *
 * @param {Object} [options] - Directory options
 * @returns {Promise<Object>} Created/updated directory
 */
async function seedTestDirectory(options = {}) {
  const name = options.name || 'Test Directory';
  const slug = options.slug || 'test-directory';

  // First try to find existing directory
  let result = await pool.query(
    `SELECT * FROM directories WHERE slug = $1`,
    [slug]
  );

  if (result.rows.length > 0) {
    // Update existing directory with test connector
    result = await pool.query(
      `UPDATE directories
       SET connector_key = 'test-connector-v1',
           default_submission_mode = 'api',
           submission_url = $2,
           updated_at = NOW()
       WHERE slug = $1
       RETURNING *`,
      [slug, options.submissionUrl || 'https://test-directory.example.com/submit']
    );
    return result.rows[0];
  }

  // Create new directory
  result = await pool.query(
    `INSERT INTO directories (
      name, slug, website_url, submission_url, connector_key,
      default_submission_mode, da_score, traffic_estimate, is_active, priority
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 50)
    RETURNING *`,
    [
      name,
      slug,
      options.websiteUrl || 'https://test-directory.example.com',
      options.submissionUrl || 'https://test-directory.example.com/submit',
      'test-connector-v1',
      'api',
      options.daScore || 50,
      options.trafficEstimate || 10000
    ]
  );

  return result.rows[0];
}

/**
 * Seeds a submission target
 *
 * @param {string} profileId - Business profile ID
 * @param {number} directoryId - Directory ID
 * @param {Object} [options] - Target options
 * @returns {Promise<Object>} Created target
 */
async function seedSubmissionTarget(profileId, directoryId, options = {}) {
  const id = generateUUID();

  const result = await pool.query(
    `INSERT INTO submission_targets (
      id, business_profile_id, directory_id, submission_mode,
      priority, current_status, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    RETURNING *`,
    [
      id,
      profileId,
      directoryId,
      options.submissionMode || 'api',
      options.priority || 50,
      options.status || 'queued'
    ]
  );

  return result.rows[0];
}

/**
 * Seeds a submission run
 *
 * @param {string} targetId - Submission target ID
 * @param {Object} [options] - Run options
 * @returns {Promise<Object>} Created run
 */
async function seedSubmissionRun(targetId, options = {}) {
  const id = generateUUID();

  const result = await pool.query(
    `INSERT INTO submission_runs (
      id, submission_target_id, status, attempt_no,
      triggered_by, created_at
    ) VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING *`,
    [
      id,
      targetId,
      options.status || 'queued',
      options.attemptNo || 1,
      options.triggeredBy || 'system'
    ]
  );

  // Update target's current_run_id
  await pool.query(
    `UPDATE submission_targets SET current_run_id = $1, current_status = $2 WHERE id = $3`,
    [id, options.status || 'queued', targetId]
  );

  return result.rows[0];
}

/**
 * Seeds a complete test scenario with user, profile, directory, target, and run
 *
 * @param {Object} [options] - Scenario options
 * @returns {Promise<Object>} All created entities
 */
async function seedCompleteScenario(options = {}) {
  const user = await seedUser(options.user);
  const profile = await seedBusinessProfile(user.id, options.profile);
  const directory = await seedTestDirectory(options.directory);
  const target = await seedSubmissionTarget(profile.id, directory.id, options.target);
  const run = await seedSubmissionRun(target.id, options.run);

  return { user, profile, directory, target, run };
}

module.exports = {
  generateUUID,
  seedUser,
  seedBusinessProfile,
  seedTestDirectory,
  seedSubmissionTarget,
  seedSubmissionRun,
  seedCompleteScenario
};
