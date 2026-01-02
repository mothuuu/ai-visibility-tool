/**
 * Test Auth Helpers
 *
 * Provides utilities for authenticating test requests.
 * Uses the test auth bypass when NODE_ENV==='test'.
 */

'use strict';

/**
 * Creates auth headers for a test user
 *
 * @param {string} userId - User ID to authenticate as
 * @param {Object} [options] - Additional options
 * @param {string} [options.email] - User email
 * @param {string} [options.name] - User name
 * @param {string} [options.role] - User role
 * @param {string} [options.plan] - User plan
 * @returns {Object} Headers object
 */
function authHeaders(userId, options = {}) {
  const headers = {
    'x-test-user-id': userId
  };

  if (options.email) {
    headers['x-test-user-email'] = options.email;
  }
  if (options.name) {
    headers['x-test-user-name'] = options.name;
  }
  if (options.role) {
    headers['x-test-user-role'] = options.role;
  }
  if (options.plan) {
    headers['x-test-user-plan'] = options.plan;
  }

  return headers;
}

/**
 * Sets auth headers on a supertest agent
 *
 * @param {Object} agent - Supertest agent
 * @param {string} userId - User ID
 * @param {Object} [options] - Auth options
 * @returns {Object} Agent with auth headers
 */
function withAuth(agent, userId, options = {}) {
  const headers = authHeaders(userId, options);

  for (const [key, value] of Object.entries(headers)) {
    agent.set(key, value);
  }

  return agent;
}

module.exports = {
  authHeaders,
  withAuth
};
