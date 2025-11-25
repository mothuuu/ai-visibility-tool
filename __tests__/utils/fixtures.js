/**
 * Test Fixtures and Seed Data
 * Utilities for creating test users, plans, and scans
 */

const db = require('../../backend/db/database');
const bcrypt = require('bcryptjs');

/**
 * Seed a test user
 * @param {object} overrides - User properties to override defaults
 * @returns {object} Created user
 */
async function seedUser(overrides = {}) {
  const defaults = {
    email: `test-${Date.now()}@example.com`,
    password: 'TestPassword123!',
    name: 'Test User',
    plan: 'free',
    scans_used_this_month: 0,
    competitor_scans_used_this_month: 0,
    email_verified: true
  };

  const user = { ...defaults, ...overrides };
  const passwordHash = await bcrypt.hash(user.password, 10);

  const result = await db.query(`
    INSERT INTO users (
      email, password_hash, name, plan, email_verified,
      scans_used_this_month, competitor_scans_used_this_month
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, email, name, plan, scans_used_this_month, competitor_scans_used_this_month
  `, [
    user.email,
    passwordHash,
    user.name,
    user.plan,
    user.email_verified,
    user.scans_used_this_month,
    user.competitor_scans_used_this_month
  ]);

  return result.rows[0];
}

/**
 * Update user's plan
 * @param {number} userId - User ID
 * @param {string} plan - Plan name (free, diy, pro)
 */
async function seedPlan(userId, plan) {
  await db.query(`
    UPDATE users
    SET plan = $1, scans_used_this_month = 0
    WHERE id = $2
  `, [plan, userId]);
}

/**
 * Seed a test scan
 * @param {object} params - Scan parameters
 * @returns {object} Created scan
 */
async function seedScan(params = {}) {
  const {
    userId,
    url = 'https://example.com/',
    status = 'completed',
    totalScore = 75,
    createdAt = new Date()
  } = params;

  const result = await db.query(`
    INSERT INTO scans (
      user_id, url, status, total_score,
      ai_readability_score, ai_search_readiness_score,
      content_freshness_score, content_structure_score,
      speed_ux_score, technical_setup_score,
      trust_authority_score, voice_optimization_score,
      rubric_version, page_count, created_at, completed_at
    )
    VALUES ($1, $2, $3, $4, 70, 80, 65, 75, 60, 85, 70, 75, 'V5', 1, $5, $5)
    RETURNING id, user_id, url, status, total_score, created_at
  `, [userId, url, status, totalScore, createdAt]);

  return result.rows[0];
}

/**
 * Seed user progress with last_unlocked_at timestamp
 * @param {object} params - Progress parameters
 */
async function seedUserProgress(params = {}) {
  const {
    userId,
    scanId,
    lastUnlockedAt = new Date()
  } = params;

  await db.query(`
    INSERT INTO user_progress (
      user_id, scan_id, last_unlocked_at,
      completed_count, skipped_count, implemented_count
    )
    VALUES ($1, $2, $3, 0, 0, 0)
    ON CONFLICT (user_id, scan_id) DO UPDATE
    SET last_unlocked_at = $3
  `, [userId, scanId, lastUnlockedAt]);
}

/**
 * Clean up test data
 */
async function cleanupTestData() {
  // Delete in reverse foreign key order
  await db.query('DELETE FROM scan_recommendations WHERE scan_id IN (SELECT id FROM scans WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1))', ['test-%@example.com']);
  await db.query('DELETE FROM user_progress WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', ['test-%@example.com']);
  await db.query('DELETE FROM scans WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', ['test-%@example.com']);
  await db.query('DELETE FROM users WHERE email LIKE $1', ['test-%@example.com']);
}

module.exports = {
  seedUser,
  seedPlan,
  seedScan,
  seedUserProgress,
  cleanupTestData
};
