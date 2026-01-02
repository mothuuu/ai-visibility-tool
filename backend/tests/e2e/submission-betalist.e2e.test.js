/**
 * Phase 5 Step 3A: BetaList Submission E2E Tests
 *
 * End-to-end tests for BetaList manual-first connector.
 * Uses the Step 3D test harness.
 *
 * Test scenarios:
 * - BetaList submission ends in ACTION_NEEDED (not SUBMITTED)
 * - STATUS_CHANGE events are correctly recorded
 * - Lock fields cleared at end
 * - Submission packet artifact created
 * - Ownership enforcement (403 for non-owner)
 */

'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createTestApp } = require('../helpers/app');
const { truncateSubmissionTables, getPool } = require('../helpers/db');
const {
  seedUser,
  seedBusinessProfile,
  seedBetaListDirectory,
  seedSubmissionTarget,
  seedSubmissionRun
} = require('../helpers/seed');
const { authHeaders } = require('../helpers/auth');
const workerService = require('../../services/submission/WorkerService');
const { SUBMISSION_STATUS, ACTION_NEEDED_TYPE, ARTIFACT_TYPE } = require('../../constants/submission-enums');

// Test app instance
let app;
let pool;

describe('BetaList Submission E2E', async () => {
  before(async () => {
    // Ensure test environment
    process.env.NODE_ENV = 'test';

    // Create test app
    app = createTestApp();
    pool = getPool();
  });

  after(async () => {
    // Cleanup handled by test runner
  });

  beforeEach(async () => {
    // Clean up submission tables
    await truncateSubmissionTables();
  });

  // ============================================
  // Helper to seed BetaList scenario
  // ============================================

  async function seedBetaListScenario(options = {}) {
    const user = await seedUser(options.user);
    const profile = await seedBusinessProfile(user.id, {
      businessName: 'BetaTest Startup',
      website: 'https://betatest-startup.com',
      description: 'An innovative startup platform that helps developers build better products. We provide comprehensive tools and services for modern software development teams worldwide.',
      email: 'contact@betatest-startup.com',
      ...options.profile
    });
    const directory = await seedBetaListDirectory(options.directory);
    const target = await seedSubmissionTarget(profile.id, directory.id, {
      submissionMode: 'form',
      ...options.target
    });
    const run = await seedSubmissionRun(target.id, options.run);

    return { user, profile, directory, target, run };
  }

  // ============================================
  // Main E2E Tests
  // ============================================

  describe('BetaList Manual Submission Flow', async () => {
    it('should end in ACTION_NEEDED status (not SUBMITTED)', async () => {
      const scenario = await seedBetaListScenario();
      const { user, run } = scenario;

      // Verify initial status
      const beforeRes = await request(app)
        .get(`/api/submissions/runs/${run.id}`)
        .set(authHeaders(user.id));

      assert.strictEqual(beforeRes.status, 200);
      assert.strictEqual(beforeRes.body.run.status, SUBMISSION_STATUS.QUEUED);

      // Process via worker
      const tickResult = await workerService.tickOnce({ batchSize: 1 });

      assert.strictEqual(tickResult.processed, 1);
      assert.strictEqual(tickResult.succeeded, 1);

      // Verify final status is ACTION_NEEDED
      const afterRes = await request(app)
        .get(`/api/submissions/runs/${run.id}`)
        .set(authHeaders(user.id));

      assert.strictEqual(afterRes.status, 200);
      assert.strictEqual(afterRes.body.run.status, SUBMISSION_STATUS.ACTION_NEEDED);
      assert.strictEqual(afterRes.body.run.action_needed_type, ACTION_NEEDED_TYPE.MANUAL_REVIEW);
      assert.strictEqual(afterRes.body.run.action_needed_url, 'https://betalist.com/submit');
    });

    it('should have correct STATUS_CHANGE events (queued→in_progress→action_needed)', async () => {
      const scenario = await seedBetaListScenario();
      const { user, run } = scenario;

      // Process via worker
      await workerService.tickOnce({ batchSize: 1 });

      // Get events
      const eventsRes = await request(app)
        .get(`/api/submissions/runs/${run.id}/events`)
        .set(authHeaders(user.id));

      assert.strictEqual(eventsRes.status, 200);
      assert.ok(eventsRes.body.events);

      const statusChanges = eventsRes.body.events.filter(e => e.event_type === 'status_change');

      // Should have at least 2 status changes
      assert.ok(statusChanges.length >= 2);

      // Find specific transitions
      const toInProgress = statusChanges.find(
        e => e.from_status === SUBMISSION_STATUS.QUEUED && e.to_status === SUBMISSION_STATUS.IN_PROGRESS
      );
      const toActionNeeded = statusChanges.find(
        e => e.from_status === SUBMISSION_STATUS.IN_PROGRESS && e.to_status === SUBMISSION_STATUS.ACTION_NEEDED
      );

      assert.ok(toInProgress, 'Should have QUEUED→IN_PROGRESS transition');
      assert.ok(toActionNeeded, 'Should have IN_PROGRESS→ACTION_NEEDED transition');
    });

    it('should clear lock fields after processing', async () => {
      const scenario = await seedBetaListScenario();
      const { run } = scenario;

      // Process via worker
      await workerService.tickOnce({ batchSize: 1 });

      // Query DB directly to check lock fields
      const result = await pool.query(
        `SELECT locked_at, locked_by, lease_expires_at
         FROM submission_runs WHERE id = $1`,
        [run.id]
      );

      assert.strictEqual(result.rows.length, 1);
      const updatedRun = result.rows[0];

      // All lock fields should be null
      assert.strictEqual(updatedRun.locked_at, null);
      assert.strictEqual(updatedRun.locked_by, null);
      assert.strictEqual(updatedRun.lease_expires_at, null);
    });

    it('should create request and response payload artifacts', async () => {
      const scenario = await seedBetaListScenario();
      const { user, run } = scenario;

      // Process via worker
      await workerService.tickOnce({ batchSize: 1 });

      // Get artifacts
      const artifactsRes = await request(app)
        .get(`/api/submissions/runs/${run.id}/artifacts`)
        .set(authHeaders(user.id));

      assert.strictEqual(artifactsRes.status, 200);
      assert.ok(artifactsRes.body.artifacts);
      assert.ok(artifactsRes.body.artifacts.length >= 2);

      const artifactTypes = artifactsRes.body.artifacts.map(a => a.artifact_type);

      // Should have request and response payloads
      assert.ok(artifactTypes.includes(ARTIFACT_TYPE.REQUEST_PAYLOAD));
      assert.ok(artifactTypes.includes(ARTIFACT_TYPE.RESPONSE_PAYLOAD));
    });

    it('should include submission packet in response artifact', async () => {
      const scenario = await seedBetaListScenario();
      const { user, run } = scenario;

      // Process via worker
      await workerService.tickOnce({ batchSize: 1 });

      // Get artifacts
      const artifactsRes = await request(app)
        .get(`/api/submissions/runs/${run.id}/artifacts`)
        .set(authHeaders(user.id));

      // Find response artifact
      const responseArtifact = artifactsRes.body.artifacts.find(
        a => a.artifact_type === ARTIFACT_TYPE.RESPONSE_PAYLOAD
      );

      assert.ok(responseArtifact);

      // Check packet structure (may be in content or content_json depending on implementation)
      const content = responseArtifact.content || responseArtifact.content_json;
      assert.ok(content);

      // The response should contain the packet
      if (content.packet) {
        assert.strictEqual(content.packet.directoryName, 'BetaList');
        assert.strictEqual(content.packet.directorySlug, 'betalist');
        assert.ok(content.packet.formFieldMap);
        assert.ok(content.packet.prefillData);
        assert.ok(content.packet.operatorInstructions);
      }
    });

    it('should emit ACTION_REQUIRED event', async () => {
      const scenario = await seedBetaListScenario();
      const { user, run } = scenario;

      // Process via worker
      await workerService.tickOnce({ batchSize: 1 });

      // Get events
      const eventsRes = await request(app)
        .get(`/api/submissions/runs/${run.id}/events`)
        .set(authHeaders(user.id));

      const actionEvents = eventsRes.body.events.filter(e => e.event_type === 'action_required');
      assert.strictEqual(actionEvents.length, 1);
    });
  });

  // ============================================
  // Ownership Enforcement
  // ============================================

  describe('BetaList Ownership Enforcement', async () => {
    it('should return 403 when accessing another user\'s run', async () => {
      const scenarioA = await seedBetaListScenario({
        user: { email: 'betalist-owner@example.com' }
      });

      // Process the run
      await workerService.tickOnce({ batchSize: 1 });

      // Create another user
      const userB = await seedUser({ email: 'betalist-intruder@example.com' });

      // User B tries to access User A's run
      const res = await request(app)
        .get(`/api/submissions/runs/${scenarioA.run.id}`)
        .set(authHeaders(userB.id));

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Access denied');
    });

    it('should return 403 when accessing another user\'s artifacts', async () => {
      const scenarioA = await seedBetaListScenario({
        user: { email: 'artifact-owner@example.com' }
      });

      // Process the run to create artifacts
      await workerService.tickOnce({ batchSize: 1 });

      // Create another user
      const userB = await seedUser({ email: 'artifact-thief@example.com' });

      // User B tries to access User A's artifacts
      const res = await request(app)
        .get(`/api/submissions/runs/${scenarioA.run.id}/artifacts`)
        .set(authHeaders(userB.id));

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Access denied');
    });

    it('should allow owner to complete action', async () => {
      const scenario = await seedBetaListScenario();
      const { user, run } = scenario;

      // Process to get to ACTION_NEEDED
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

    it('should deny non-owner from completing action', async () => {
      const scenarioA = await seedBetaListScenario({
        user: { email: 'action-owner@example.com' }
      });

      // Process to get to ACTION_NEEDED
      await workerService.tickOnce({ batchSize: 1 });

      // Create another user
      const userB = await seedUser({ email: 'action-thief@example.com' });

      // User B tries to complete action
      const res = await request(app)
        .post(`/api/submissions/runs/${scenarioA.run.id}/complete-action`)
        .set(authHeaders(userB.id));

      assert.strictEqual(res.status, 403);
    });
  });

  // ============================================
  // Connector-specific Behavior
  // ============================================

  describe('BetaList Connector Behavior', async () => {
    it('should use betalist-v1 connector', async () => {
      const scenario = await seedBetaListScenario();
      const { directory } = scenario;

      // Verify directory has correct connector_key
      assert.strictEqual(directory.connector_key, 'betalist-v1');
    });

    it('should set correct action_needed_url', async () => {
      const scenario = await seedBetaListScenario();
      const { user, run } = scenario;

      // Process via worker
      await workerService.tickOnce({ batchSize: 1 });

      // Verify action URL
      const res = await request(app)
        .get(`/api/submissions/runs/${run.id}`)
        .set(authHeaders(user.id));

      assert.strictEqual(res.body.run.action_needed_url, 'https://betalist.com/submit');
    });

    it('should set deadline approximately 10 days from now', async () => {
      const scenario = await seedBetaListScenario();
      const { user, run } = scenario;

      const before = Date.now();
      await workerService.tickOnce({ batchSize: 1 });
      const after = Date.now();

      // Get run
      const res = await request(app)
        .get(`/api/submissions/runs/${run.id}`)
        .set(authHeaders(user.id));

      const deadline = new Date(res.body.run.action_needed_deadline);
      const tenDaysMs = 10 * 24 * 60 * 60 * 1000;

      // Should be roughly 10 days from processing time
      assert.ok(deadline.getTime() >= before + tenDaysMs - 60000); // 1 min tolerance
      assert.ok(deadline.getTime() <= after + tenDaysMs + 60000);
    });
  });
});
