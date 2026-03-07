/**
 * Token Expiry Cron Job Tests
 *
 * Tests for jobs/tokenExpiry.js — daily safety-net that expires tokens
 * for users whose billing cycle has ended.
 *
 * Run with: node --test backend/tests/unit/token-expiry-job.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// =============================================================================
// MOCK SETUP
// =============================================================================

let dbQueryResults = [];
let dbQueryCalls = [];
let tokenServiceCalls = [];
let tokenServiceErrors = {};

const mockDb = {
  query: async (sql, params) => {
    dbQueryCalls.push({ sql, params });
    const result = dbQueryResults.shift() || { rows: [] };
    return result;
  }
};

const mockTokenService = {
  expireAllTokens: async (userId) => {
    if (tokenServiceErrors[userId]) {
      tokenServiceCalls.push({ userId, error: true });
      throw new Error(tokenServiceErrors[userId]);
    }
    tokenServiceCalls.push({ userId, error: false });
  }
};

const mockCron = {
  schedule: (pattern, fn) => {
    mockCron._lastSchedule = { pattern, fn };
    return { stop: () => {} };
  },
  _lastSchedule: null
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../db/database' || id.endsWith('/db/database')) {
    return mockDb;
  }
  if (id === '../services/tokenService' || id.endsWith('/services/tokenService')) {
    return mockTokenService;
  }
  if (id === 'node-cron') {
    return mockCron;
  }
  return originalRequire.apply(this, arguments);
};

const { startTokenExpiryCron, runTokenExpiryJob } = require('../../jobs/tokenExpiry');

// =============================================================================
// TESTS
// =============================================================================

describe('Token Expiry Job', () => {

  beforeEach(() => {
    dbQueryResults = [];
    dbQueryCalls = [];
    tokenServiceCalls = [];
    tokenServiceErrors = {};
    mockCron._lastSchedule = null;
    delete process.env.DISABLE_TOKEN_EXPIRY_CRON;
  });

  // =========================================================================
  // runTokenExpiryJob
  // =========================================================================

  describe('runTokenExpiryJob', () => {

    it('should expire tokens for users with expired cycles', async () => {
      const yesterday = new Date(Date.now() - 86400000);
      dbQueryResults.push({
        rows: [
          { user_id: 1, monthly_remaining: 30, purchased_balance: 10, cycle_end_date: yesterday },
          { user_id: 2, monthly_remaining: 5, purchased_balance: 0, cycle_end_date: yesterday }
        ]
      });

      const result = await runTokenExpiryJob();

      assert.strictEqual(result.processed, 2);
      assert.strictEqual(result.errors, 0);
      assert.strictEqual(tokenServiceCalls.length, 2);
      assert.strictEqual(tokenServiceCalls[0].userId, 1);
      assert.strictEqual(tokenServiceCalls[1].userId, 2);
    });

    it('should return 0 processed when no expired cycles found', async () => {
      dbQueryResults.push({ rows: [] });

      const result = await runTokenExpiryJob();

      assert.strictEqual(result.processed, 0);
      assert.strictEqual(result.errors, 0);
      assert.strictEqual(tokenServiceCalls.length, 0);
    });

    it('should continue processing after individual user errors', async () => {
      const yesterday = new Date(Date.now() - 86400000);
      tokenServiceErrors[2] = 'DB lock timeout';

      dbQueryResults.push({
        rows: [
          { user_id: 1, monthly_remaining: 10, purchased_balance: 0, cycle_end_date: yesterday },
          { user_id: 2, monthly_remaining: 20, purchased_balance: 5, cycle_end_date: yesterday },
          { user_id: 3, monthly_remaining: 15, purchased_balance: 0, cycle_end_date: yesterday }
        ]
      });

      const result = await runTokenExpiryJob();

      assert.strictEqual(result.processed, 2); // users 1 and 3
      assert.strictEqual(result.errors, 1);    // user 2 failed
      assert.strictEqual(tokenServiceCalls.length, 3);
    });

    it('should process multiple batches', async () => {
      // First batch: full (simulating BATCH_SIZE rows — we use 2 to test the loop)
      const yesterday = new Date(Date.now() - 86400000);

      // Create 500 rows for first batch
      const batch1 = [];
      for (let i = 1; i <= 500; i++) {
        batch1.push({ user_id: i, monthly_remaining: 10, purchased_balance: 0, cycle_end_date: yesterday });
      }
      dbQueryResults.push({ rows: batch1 });

      // Second batch: partial (fewer than BATCH_SIZE, signals end)
      dbQueryResults.push({
        rows: [
          { user_id: 501, monthly_remaining: 5, purchased_balance: 0, cycle_end_date: yesterday }
        ]
      });

      const result = await runTokenExpiryJob();

      assert.strictEqual(result.processed, 501);
      assert.strictEqual(result.errors, 0);
      assert.strictEqual(dbQueryCalls.length, 2); // Two batch queries
    });

    it('should query with correct WHERE clause', async () => {
      dbQueryResults.push({ rows: [] });

      await runTokenExpiryJob();

      assert.strictEqual(dbQueryCalls.length, 1);
      const { sql } = dbQueryCalls[0];
      assert.ok(sql.includes('cycle_end_date < NOW()'), 'Should filter by expired cycle');
      assert.ok(sql.includes('monthly_remaining > 0 OR purchased_balance > 0'), 'Should filter non-zero balances');
      assert.ok(sql.includes('ORDER BY cycle_end_date ASC'), 'Should order by oldest first');
      assert.ok(sql.includes('LIMIT'), 'Should use batch limit');
    });
  });

  // =========================================================================
  // startTokenExpiryCron
  // =========================================================================

  describe('startTokenExpiryCron', () => {

    it('should schedule at midnight UTC', () => {
      startTokenExpiryCron();

      assert.ok(mockCron._lastSchedule, 'Should schedule a cron job');
      assert.strictEqual(mockCron._lastSchedule.pattern, '0 0 * * *');
    });

    it('should not schedule when DISABLE_TOKEN_EXPIRY_CRON=true', () => {
      process.env.DISABLE_TOKEN_EXPIRY_CRON = 'true';

      const result = startTokenExpiryCron();

      assert.strictEqual(result, null);
      assert.strictEqual(mockCron._lastSchedule, null, 'Should not schedule any cron job');
    });

    it('should schedule when DISABLE_TOKEN_EXPIRY_CRON is not set', () => {
      delete process.env.DISABLE_TOKEN_EXPIRY_CRON;

      const result = startTokenExpiryCron();

      assert.ok(result !== null, 'Should return the cron task');
      assert.ok(mockCron._lastSchedule, 'Should schedule a cron job');
    });
  });

  // =========================================================================
  // Idempotency
  // =========================================================================

  describe('Idempotency', () => {

    it('should be safe to run twice — second run finds no rows if first succeeded', async () => {
      const yesterday = new Date(Date.now() - 86400000);

      // First run: finds users
      dbQueryResults.push({
        rows: [{ user_id: 1, monthly_remaining: 30, purchased_balance: 10, cycle_end_date: yesterday }]
      });
      const result1 = await runTokenExpiryJob();
      assert.strictEqual(result1.processed, 1);

      // Second run: no rows (balances are now 0 so WHERE clause doesn't match)
      dbQueryResults.push({ rows: [] });
      const result2 = await runTokenExpiryJob();
      assert.strictEqual(result2.processed, 0);
    });
  });
});
