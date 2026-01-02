/**
 * Phase 5: Submission Engine E2E Tests
 *
 * End-to-end tests for the submission framework.
 *
 * Test scenarios:
 * A) Happy-path: routes → worker → submitted + artifacts + events
 * B) Retry: retryable error → DEFERRED in single transition
 * C) Ownership enforcement: 403 for non-owner
 */

'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createTestApp } = require('../helpers/app');
const { truncateSubmissionTables, getPool } = require('../helpers/db');
const { seedCompleteScenario, seedUser } = require('../helpers/seed');
const { authHeaders } = require('../helpers/auth');
const { TestConnector } = require('../../services/submission/connectors/TestConnector');
const workerService = require('../../services/submission/WorkerService');
const { SUBMISSION_STATUS, ERROR_TYPE } = require('../../constants/submission-enums');

// Test app instance
let app;
let pool;

describe('Submission Engine E2E', async () => {
  before(async () => {
    // Ensure test environment
    process.env.NODE_ENV = 'test';

    // Create test app with test connector registered
    app = createTestApp();
    pool = getPool();
  });

  after(async () => {
    // Don't close pool - let test runner handle cleanup
  });

  beforeEach(async () => {
    // Reset test connector mode
    TestConnector.resetTestMode();

    // Clean up submission tables
    await truncateSubmissionTables();
  });

  afterEach(async () => {
    // Reset test connector
    TestConnector.resetTestMode();
  });

  // ============================================
  // A) HAPPY PATH E2E
  // ============================================

  describe('A) Happy Path E2E', async () => {
    it('should process submission from routes → worker → submitted with artifacts and events', async () => {
      // 1. Seed complete scenario: user, profile, directory, target, run
      const scenario = await seedCompleteScenario();
      const { user, target, run } = scenario;

      // Set test connector to success mode
      TestConnector.setTestMode('success');

      // 2. Verify run is in QUEUED status via API
      const getRes = await request(app)
        .get(`/api/submissions/runs/${run.id}`)
        .set(authHeaders(user.id));

      assert.strictEqual(getRes.status, 200);
      assert.ok(getRes.body.run);
      assert.strictEqual(getRes.body.run.status, SUBMISSION_STATUS.QUEUED);

      // 3. Process the run via worker (deterministic tick)
      const tickResult = await workerService.tickOnce({ batchSize: 1 });

      assert.strictEqual(tickResult.processed, 1);
      assert.strictEqual(tickResult.succeeded, 1);
      assert.strictEqual(tickResult.failed, 0);

      // 4. Verify run is now SUBMITTED
      const afterRes = await request(app)
        .get(`/api/submissions/runs/${run.id}`)
        .set(authHeaders(user.id));

      assert.strictEqual(afterRes.status, 200);
      assert.strictEqual(afterRes.body.run.status, SUBMISSION_STATUS.SUBMITTED);
      assert.strictEqual(afterRes.body.run.attempt_no, 1);
      assert.ok(afterRes.body.run.external_submission_id);

      // 5. Verify events were created
      const eventsRes = await request(app)
        .get(`/api/submissions/runs/${run.id}/events`)
        .set(authHeaders(user.id));

      assert.strictEqual(eventsRes.status, 200);
      assert.ok(eventsRes.body.events);
      assert.ok(eventsRes.body.events.length >= 2);

      // Should have STATUS_CHANGE events for: QUEUED→IN_PROGRESS, IN_PROGRESS→SUBMITTED
      const statusChanges = eventsRes.body.events.filter(e => e.event_type === 'status_change');
      assert.ok(statusChanges.length >= 2);

      // Find the transitions
      const toInProgress = statusChanges.find(
        e => e.from_status === SUBMISSION_STATUS.QUEUED && e.to_status === SUBMISSION_STATUS.IN_PROGRESS
      );
      const toSubmitted = statusChanges.find(
        e => e.from_status === SUBMISSION_STATUS.IN_PROGRESS && e.to_status === SUBMISSION_STATUS.SUBMITTED
      );

      assert.ok(toInProgress, 'Should have QUEUED→IN_PROGRESS transition');
      assert.ok(toSubmitted, 'Should have IN_PROGRESS→SUBMITTED transition');

      // 6. Verify artifacts were created (request and response payloads)
      const artifactsRes = await request(app)
        .get(`/api/submissions/runs/${run.id}/artifacts`)
        .set(authHeaders(user.id));

      assert.strictEqual(artifactsRes.status, 200);
      assert.ok(artifactsRes.body.artifacts);
      assert.ok(artifactsRes.body.artifacts.length >= 2);

      const artifactTypes = artifactsRes.body.artifacts.map(a => a.artifact_type);
      assert.ok(artifactTypes.includes('request_payload'), 'Should have request_payload artifact');
      assert.ok(artifactTypes.includes('response_payload'), 'Should have response_payload artifact');
    });

    it('should handle action_needed result correctly', async () => {
      const scenario = await seedCompleteScenario();
      const { user, run } = scenario;

      // Set test connector to action_needed mode
      TestConnector.setTestMode('action_needed');

      // Process the run
      await workerService.tickOnce({ batchSize: 1 });

      // Verify run is now ACTION_NEEDED
      const res = await request(app)
        .get(`/api/submissions/runs/${run.id}`)
        .set(authHeaders(user.id));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.run.status, SUBMISSION_STATUS.ACTION_NEEDED);
      assert.ok(res.body.run.action_needed_type);
      assert.ok(res.body.run.action_needed_url);

      // Verify ACTION_REQUIRED event was emitted
      const eventsRes = await request(app)
        .get(`/api/submissions/runs/${run.id}/events`)
        .set(authHeaders(user.id));

      const actionEvents = eventsRes.body.events.filter(e => e.event_type === 'action_required');
      assert.strictEqual(actionEvents.length, 1);
    });

    it('should handle already_listed result correctly', async () => {
      const scenario = await seedCompleteScenario();
      const { user, run } = scenario;

      // Set test connector to already_listed mode
      TestConnector.setTestMode('already_listed');

      // Process the run
      await workerService.tickOnce({ batchSize: 1 });

      // Verify run is now ALREADY_LISTED
      const res = await request(app)
        .get(`/api/submissions/runs/${run.id}`)
        .set(authHeaders(user.id));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.run.status, SUBMISSION_STATUS.ALREADY_LISTED);
      assert.ok(res.body.run.external_submission_id);
    });
  });

  // ============================================
  // B) RETRY E2E
  // ============================================

  describe('B) Retry E2E', async () => {
    it('should transition directly to DEFERRED on retryable error (not FAILED then update)', async () => {
      const scenario = await seedCompleteScenario();
      const { user, run } = scenario;

      // Set test connector to error mode with retryable error
      TestConnector.setTestMode('error', {
        errorType: ERROR_TYPE.NETWORK_ERROR,
        retryable: true
      });

      // Process the run
      await workerService.tickOnce({ batchSize: 1 });

      // Verify run is now DEFERRED (not FAILED)
      const res = await request(app)
        .get(`/api/submissions/runs/${run.id}`)
        .set(authHeaders(user.id));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.run.status, SUBMISSION_STATUS.DEFERRED);
      assert.strictEqual(res.body.run.last_error_type, ERROR_TYPE.NETWORK_ERROR);
      assert.ok(res.body.run.next_run_at);

      // Verify events show direct transition to DEFERRED
      const eventsRes = await request(app)
        .get(`/api/submissions/runs/${run.id}/events`)
        .set(authHeaders(user.id));

      const statusChanges = eventsRes.body.events.filter(e => e.event_type === 'status_change');

      // Find transition to DEFERRED - should be directly from IN_PROGRESS
      const toDeferred = statusChanges.find(
        e => e.to_status === SUBMISSION_STATUS.DEFERRED
      );
      assert.ok(toDeferred, 'Should have transition to DEFERRED');
      assert.strictEqual(toDeferred.from_status, SUBMISSION_STATUS.IN_PROGRESS);

      // Should NOT have a transition to FAILED
      const toFailed = statusChanges.find(e => e.to_status === SUBMISSION_STATUS.FAILED);
      assert.strictEqual(toFailed, undefined, 'Should NOT have transition to FAILED');

      // Verify RETRY_SCHEDULED event was emitted
      const retryEvents = eventsRes.body.events.filter(e => e.event_type === 'retry_scheduled');
      assert.strictEqual(retryEvents.length, 1);

      // Verify error log artifact was created
      const artifactsRes = await request(app)
        .get(`/api/submissions/runs/${run.id}/artifacts`)
        .set(authHeaders(user.id));

      const errorLogs = artifactsRes.body.artifacts.filter(a => a.artifact_type === 'error_log');
      assert.strictEqual(errorLogs.length, 1);
    });

    it('should transition to FAILED on non-retryable error', async () => {
      const scenario = await seedCompleteScenario();
      const { user, run } = scenario;

      // Set test connector to error mode with non-retryable error
      TestConnector.setTestMode('error', {
        errorType: ERROR_TYPE.VALIDATION_ERROR,
        retryable: false
      });

      // Process the run
      await workerService.tickOnce({ batchSize: 1 });

      // Verify run is now FAILED
      const res = await request(app)
        .get(`/api/submissions/runs/${run.id}`)
        .set(authHeaders(user.id));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.run.status, SUBMISSION_STATUS.FAILED);
      assert.strictEqual(res.body.run.last_error_type, ERROR_TYPE.VALIDATION_ERROR);
    });

    it('should fail after max attempts', async () => {
      const scenario = await seedCompleteScenario({
        run: { attemptNo: 5 } // Already at max attempts
      });
      const { user, run } = scenario;

      // Set test connector to error mode
      TestConnector.setTestMode('error', {
        errorType: ERROR_TYPE.NETWORK_ERROR,
        retryable: true
      });

      // Process the run
      await workerService.tickOnce({ batchSize: 1 });

      // Should be FAILED even though error is retryable (max attempts exceeded)
      const res = await request(app)
        .get(`/api/submissions/runs/${run.id}`)
        .set(authHeaders(user.id));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.run.status, SUBMISSION_STATUS.FAILED);
    });
  });

  // ============================================
  // C) OWNERSHIP ENFORCEMENT E2E
  // ============================================

  describe('C) Ownership Enforcement E2E', async () => {
    it("should return 403 when accessing another user's run", async () => {
      // Seed scenario for user A
      const scenarioA = await seedCompleteScenario({
        user: { email: 'usera@example.com' }
      });

      // Seed user B (different user)
      const userB = await seedUser({ email: 'userb@example.com' });

      // User B tries to access User A's run
      const res = await request(app)
        .get(`/api/submissions/runs/${scenarioA.run.id}`)
        .set(authHeaders(userB.id));

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Access denied');
    });

    it("should return 403 when accessing another user's target", async () => {
      const scenarioA = await seedCompleteScenario({
        user: { email: 'owner@example.com' }
      });

      const userB = await seedUser({ email: 'intruder@example.com' });

      const res = await request(app)
        .get(`/api/submissions/targets/${scenarioA.target.id}`)
        .set(authHeaders(userB.id));

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Access denied');
    });

    it("should return 403 when pausing another user's run", async () => {
      const scenarioA = await seedCompleteScenario();
      const userB = await seedUser({ email: 'hacker@example.com' });

      const res = await request(app)
        .post(`/api/submissions/runs/${scenarioA.run.id}/pause`)
        .set(authHeaders(userB.id));

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Access denied');
    });

    it("should return 403 when cancelling another user's run", async () => {
      const scenarioA = await seedCompleteScenario();
      const userB = await seedUser({ email: 'attacker@example.com' });

      const res = await request(app)
        .post(`/api/submissions/runs/${scenarioA.run.id}/cancel`)
        .set(authHeaders(userB.id));

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Access denied');
    });

    it("should return 403 when accessing another user's events", async () => {
      const scenarioA = await seedCompleteScenario();
      const userB = await seedUser({ email: 'spy@example.com' });

      const res = await request(app)
        .get(`/api/submissions/runs/${scenarioA.run.id}/events`)
        .set(authHeaders(userB.id));

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Access denied');
    });

    it("should return 403 when accessing another user's artifacts", async () => {
      const scenarioA = await seedCompleteScenario();
      const userB = await seedUser({ email: 'snooper@example.com' });

      const res = await request(app)
        .get(`/api/submissions/runs/${scenarioA.run.id}/artifacts`)
        .set(authHeaders(userB.id));

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Access denied');
    });

    it('should allow owner to access their own run', async () => {
      const scenario = await seedCompleteScenario();
      const { user, run } = scenario;

      const res = await request(app)
        .get(`/api/submissions/runs/${run.id}`)
        .set(authHeaders(user.id));

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.run);
      assert.strictEqual(res.body.run.id, run.id);
    });
  });

  // ============================================
  // D) API ACTIONS E2E
  // ============================================

  describe('D) API Actions E2E', async () => {
    it('should pause and resume a run', async () => {
      const scenario = await seedCompleteScenario();
      const { user, run } = scenario;

      // Pause the run
      const pauseRes = await request(app)
        .post(`/api/submissions/runs/${run.id}/pause`)
        .set(authHeaders(user.id));

      assert.strictEqual(pauseRes.status, 200);
      assert.strictEqual(pauseRes.body.run.status, SUBMISSION_STATUS.PAUSED);

      // Resume the run
      const resumeRes = await request(app)
        .post(`/api/submissions/runs/${run.id}/resume`)
        .set(authHeaders(user.id));

      assert.strictEqual(resumeRes.status, 200);
      assert.strictEqual(resumeRes.body.run.status, SUBMISSION_STATUS.QUEUED);
    });

    it('should cancel a run', async () => {
      const scenario = await seedCompleteScenario();
      const { user, run } = scenario;

      const res = await request(app)
        .post(`/api/submissions/runs/${run.id}/cancel`)
        .set(authHeaders(user.id));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.run.status, SUBMISSION_STATUS.CANCELLED);
    });

    it('should complete action on ACTION_NEEDED run', async () => {
      const scenario = await seedCompleteScenario();
      const { user, run } = scenario;

      // First, process to get to ACTION_NEEDED state
      TestConnector.setTestMode('action_needed');
      await workerService.tickOnce({ batchSize: 1 });

      // Verify it's ACTION_NEEDED
      const checkRes = await request(app)
        .get(`/api/submissions/runs/${run.id}`)
        .set(authHeaders(user.id));
      assert.strictEqual(checkRes.body.run.status, SUBMISSION_STATUS.ACTION_NEEDED);

      // Complete the action
      const res = await request(app)
        .post(`/api/submissions/runs/${run.id}/complete-action`)
        .set(authHeaders(user.id));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.run.status, SUBMISSION_STATUS.SUBMITTED);
    });

    it('should not allow pause from terminal status', async () => {
      const scenario = await seedCompleteScenario();
      const { user, run } = scenario;

      // Process to SUBMITTED (terminal-ish)
      TestConnector.setTestMode('success');
      await workerService.tickOnce({ batchSize: 1 });

      // Try to pause
      const res = await request(app)
        .post(`/api/submissions/runs/${run.id}/pause`)
        .set(authHeaders(user.id));

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Cannot pause from status'));
    });

    it('should not allow resume from non-paused status', async () => {
      const scenario = await seedCompleteScenario();
      const { user, run } = scenario;

      // Try to resume without pausing first
      const res = await request(app)
        .post(`/api/submissions/runs/${run.id}/resume`)
        .set(authHeaders(user.id));

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Must be paused'));
    });
  });

  // ============================================
  // E) LIST ENDPOINTS E2E
  // ============================================

  describe('E) List Endpoints E2E', async () => {
    it("should list only user's own targets", async () => {
      // Create scenarios for two users
      const scenarioA = await seedCompleteScenario({
        user: { email: 'lister-a@example.com' }
      });
      const scenarioB = await seedCompleteScenario({
        user: { email: 'lister-b@example.com' }
      });

      // User A should only see their targets
      const resA = await request(app)
        .get('/api/submissions/targets')
        .set(authHeaders(scenarioA.user.id));

      assert.strictEqual(resA.status, 200);
      assert.strictEqual(resA.body.targets.length, 1);
      assert.strictEqual(resA.body.targets[0].id, scenarioA.target.id);

      // User B should only see their targets
      const resB = await request(app)
        .get('/api/submissions/targets')
        .set(authHeaders(scenarioB.user.id));

      assert.strictEqual(resB.status, 200);
      assert.strictEqual(resB.body.targets.length, 1);
      assert.strictEqual(resB.body.targets[0].id, scenarioB.target.id);
    });
  });
});
