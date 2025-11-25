/**
 * 5-Day Skip Guard Tests
 *
 * Tests the 5-day skip logic for:
 * - Scan-level throttling (currently MISSING - tests will fail)
 * - Unlock-level throttling (currently IMPLEMENTED)
 * - Timezone handling
 * - Edge cases (DST, leap day, concurrent requests)
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../backend/server');
const db = require('../backend/db/database');
const { freezeAt, advanceBy, resetTime } = require('./utils/time');
const { seedUser, seedPlan, seedScan, seedUserProgress, cleanupTestData } = require('./utils/fixtures');

describe('5-Day Skip Guard', () => {
  let authToken;
  let testUser;

  beforeAll(async () => {
    // Use fake timers for all tests
    jest.useFakeTimers();
  });

  beforeEach(async () => {
    // Clean up test data
    await cleanupTestData();

    // Create test user with DIY plan
    testUser = await seedUser({ plan: 'diy' });
    authToken = jwt.sign({ userId: testUser.id }, process.env.JWT_SECRET, { expiresIn: '1d' });

    // Freeze time to known baseline
    freezeAt('2025-11-25T12:00:00Z');
  });

  afterEach(async () => {
    resetTime();
    await cleanupTestData();
  });

  afterAll(async () => {
    jest.useRealTimers();
    await db.end();
  });

  describe('Scan-Level Skip (CURRENTLY MISSING - THESE TESTS WILL FAIL)', () => {
    test('generates on first scan, skips within 5 days, generates after 5 days', async () => {
      const scanUrl = 'https://example.com/test-page';

      // FIRST SCAN → should generate
      freezeAt('2025-11-25T12:00:00Z');
      let res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: scanUrl });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.skipped).toBeFalsy(); // Should NOT be skipped
      expect(res.body.scan).toBeDefined();
      expect(res.body.scan.id).toBeDefined();

      const firstScanId = res.body.scan.id;

      // SECOND SCAN +4d 23h 59m → should SKIP (within 5-day window)
      advanceBy({ days: 4, hours: 23, minutes: 59 });
      res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: scanUrl });

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(true); // ❌ WILL FAIL - feature not implemented
      expect(res.body.reason).toMatch(/within_5d_window/);
      expect(res.body.existingScan).toBeDefined();
      expect(res.body.existingScan.scanId).toBe(firstScanId);
      expect(res.body.message).toMatch(/days ago/);

      // THIRD SCAN +2m (crosses 5-day boundary) → should GENERATE
      advanceBy({ minutes: 2 });
      res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: scanUrl });

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBeFalsy(); // Should generate new scan
      expect(res.body.scan).toBeDefined();
      expect(res.body.scan.id).not.toBe(firstScanId); // Different scan ID
    });

    test('different pages on same domain both generate (no cross-URL skip)', async () => {
      freezeAt('2025-11-25T12:00:00Z');

      // Scan page 1
      let res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/page-1' });

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBeFalsy();

      // Immediately scan page 2 (different URL) - should generate, not skip
      res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/page-2' });

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBeFalsy(); // Different URL, should generate
    });

    test('exact 5-day boundary (120 hours) allows new scan', async () => {
      const scanUrl = 'https://example.com/boundary-test';

      // First scan
      freezeAt('2025-11-25T12:00:00Z');
      let res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: scanUrl });

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBeFalsy();

      // Exactly 120 hours (5 days) later
      advanceBy({ hours: 120 });
      res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: scanUrl });

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBeFalsy(); // Should allow scan at exactly 5 days
    });

    test('119 hours 59 minutes still skips (off-by-one check)', async () => {
      const scanUrl = 'https://example.com/off-by-one';

      // First scan
      freezeAt('2025-11-25T12:00:00Z');
      await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: scanUrl });

      // 119h 59m later (1 minute before 5 days)
      advanceBy({ hours: 119, minutes: 59 });
      const res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: scanUrl });

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(true); // ❌ WILL FAIL - feature not implemented
      expect(res.body.reason).toMatch(/within_5d_window/);
    });
  });

  describe('Unlock-Level Skip (CURRENTLY IMPLEMENTED)', () => {
    test('DIY user can unlock recommendations, then blocked for 5 days', async () => {
      // Create a scan with recommendations
      const scan = await seedScan({ userId: testUser.id, url: 'https://example.com/' });

      // First unlock → should succeed
      freezeAt('2025-11-25T12:00:00Z');
      let res = await request(app)
        .post(`/api/scan/${scan.id}/unlock`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ count: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Record unlock timestamp
      await seedUserProgress({
        userId: testUser.id,
        scanId: scan.id,
        lastUnlockedAt: new Date()
      });

      // Attempt unlock +4d 23h → should be blocked
      advanceBy({ days: 4, hours: 23 });
      res = await request(app)
        .post(`/api/scan/${scan.id}/unlock`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ count: 5 });

      expect(res.status).toBe(429); // Rate limit exceeded
      expect(res.body.error).toMatch(/Unlock interval not met/);
      expect(res.body.daysRemaining).toBeLessThanOrEqual(1);
      expect(res.body.canUnlockAgainAt).toBeDefined();

      // Attempt unlock +5d 1h → should succeed
      advanceBy({ hours: 2 }); // Now 5d 1h total
      res = await request(app)
        .post(`/api/scan/${scan.id}/unlock`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ count: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('Free plan has no unlock throttle', async () => {
      // Create free user
      const freeUser = await seedUser({ plan: 'free' });
      const freeToken = jwt.sign({ userId: freeUser.id }, process.env.JWT_SECRET);
      const scan = await seedScan({ userId: freeUser.id });

      // Unlock
      freezeAt('2025-11-25T12:00:00Z');
      await request(app)
        .post(`/api/scan/${scan.id}/unlock`)
        .set('Authorization', `Bearer ${freeToken}`)
        .send({ count: 3 });

      await seedUserProgress({
        userId: freeUser.id,
        scanId: scan.id,
        lastUnlockedAt: new Date()
      });

      // Immediately attempt another unlock (no 5-day wait for free)
      advanceBy({ hours: 1 });
      const res = await request(app)
        .post(`/api/scan/${scan.id}/unlock`)
        .set('Authorization', `Bearer ${freeToken}`)
        .send({ count: 3 });

      expect(res.status).not.toBe(429); // Should NOT be rate limited
    });
  });

  describe('Timezone & Edge Cases', () => {
    test('DST transition does not break 5-day calculation', async () => {
      // Test across spring DST transition (usually early March or April)
      // Freezing before DST change
      freezeAt('2025-03-08T12:00:00Z'); // Day before DST in US

      const scan = await seedScan({ userId: testUser.id });
      await seedUserProgress({
        userId: testUser.id,
        scanId: scan.id,
        lastUnlockedAt: new Date()
      });

      // Advance 5 days (crosses DST boundary in some timezones)
      advanceBy({ days: 5 });

      const res = await request(app)
        .post(`/api/scan/${scan.id}/unlock`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ count: 5 });

      // Should work regardless of DST (using UTC internally)
      expect(res.status).toBe(200);
    });

    test('Leap day (Feb 29) handled correctly', async () => {
      // 2028 is next leap year
      freezeAt('2028-02-26T12:00:00Z');

      const scan = await seedScan({ userId: testUser.id });
      await seedUserProgress({
        userId: testUser.id,
        scanId: scan.id,
        lastUnlockedAt: new Date()
      });

      // Advance 5 days (Feb 26 → Mar 2, crosses leap day Feb 29)
      advanceBy({ days: 5 });

      const res = await request(app)
        .post(`/api/scan/${scan.id}/unlock`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ count: 5 });

      expect(res.status).toBe(200); // Should work correctly
    });

    test('Concurrent unlock attempts respect 5-day limit', async () => {
      const scan = await seedScan({ userId: testUser.id });

      freezeAt('2025-11-25T12:00:00Z');

      // First unlock
      await request(app)
        .post(`/api/scan/${scan.id}/unlock`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ count: 5 });

      await seedUserProgress({
        userId: testUser.id,
        scanId: scan.id,
        lastUnlockedAt: new Date()
      });

      // Concurrent attempts 1 minute later
      advanceBy({ minutes: 1 });

      const [res1, res2, res3] = await Promise.all([
        request(app)
          .post(`/api/scan/${scan.id}/unlock`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ count: 5 }),
        request(app)
          .post(`/api/scan/${scan.id}/unlock`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ count: 5 }),
        request(app)
          .post(`/api/scan/${scan.id}/unlock`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ count: 5 })
      ]);

      // All should be blocked
      expect(res1.status).toBe(429);
      expect(res2.status).toBe(429);
      expect(res3.status).toBe(429);
    });
  });

  describe('Server Timezone Independence', () => {
    test('Calculation works regardless of server TZ setting', async () => {
      // This test verifies UTC usage regardless of process.env.TZ

      const originalTZ = process.env.TZ;

      try {
        // Set server to different timezone
        process.env.TZ = 'America/New_York';
        freezeAt('2025-11-25T12:00:00Z');

        const scan = await seedScan({ userId: testUser.id });
        await seedUserProgress({
          userId: testUser.id,
          scanId: scan.id,
          lastUnlockedAt: new Date()
        });

        advanceBy({ days: 5 });

        const res = await request(app)
          .post(`/api/scan/${scan.id}/unlock`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ count: 5 });

        expect(res.status).toBe(200); // Should work in any TZ
      } finally {
        process.env.TZ = originalTZ;
      }
    });
  });
});
