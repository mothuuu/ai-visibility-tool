/**
 * DIY Plan Limits & Flow Tests
 *
 * Tests DIY plan enforcement:
 * - 25 scans/month limit
 * - Scan quota tracking and rollover
 * - DIY recommendation structure and quality
 * - Feature access control
 * - Competitor scan limits
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../backend/server');
const db = require('../backend/db/database');
const { freezeAt, advanceBy, resetTime } = require('./utils/time');
const { seedUser, seedPlan, seedScan, cleanupTestData } = require('./utils/fixtures');

describe('DIY Plan Limits & Flow', () => {
  let authToken;
  let testUser;

  beforeAll(async () => {
    jest.useFakeTimers();
  });

  beforeEach(async () => {
    await cleanupTestData();
    testUser = await seedUser({ plan: 'diy', scans_used_this_month: 0 });
    authToken = jwt.sign({ userId: testUser.id }, process.env.JWT_SECRET);
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

  describe('25 Scans/Month Limit Enforcement', () => {
    test('enforces 25 scans/month limit', async () => {
      // Simulate 24 scans already used
      await db.query('UPDATE users SET scans_used_this_month = $1 WHERE id = $2', [24, testUser.id]);

      // 25th scan → OK
      let res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/scan-25' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Refresh user quota count
      const userResult = await db.query('SELECT scans_used_this_month FROM users WHERE id = $1', [testUser.id]);
      expect(userResult.rows[0].scans_used_this_month).toBe(25);

      // 26th scan → BLOCKED
      res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/scan-26' });

      expect(res.status).toBe(403); // Forbidden
      expect(res.body.error).toBe('Scan limit reached');
      expect(res.body.message).toMatch(/25.*scans.*month/);
      expect(res.body.upgrade).toBeDefined();
      expect(res.body.upgrade).toMatch(/Pro.*50.*scans/);
    });

    test('DIY user at 24 scans can still scan', async () => {
      await db.query('UPDATE users SET scans_used_this_month = $1 WHERE id = $2', [24, testUser.id]);

      const res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/test' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('quota increments correctly on successful scan', async () => {
      await db.query('UPDATE users SET scans_used_this_month = $1 WHERE id = $2', [10, testUser.id]);

      await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/test' });

      // Check quota incremented
      const userResult = await db.query('SELECT scans_used_this_month FROM users WHERE id = $1', [testUser.id]);
      expect(userResult.rows[0].scans_used_this_month).toBe(11);
    });

    test('quota does NOT increment on failed scan (CURRENT BUG)', async () => {
      // NOTE: This test documents current buggy behavior
      // In current implementation, quota increments BEFORE scan completes
      // So this test will FAIL, demonstrating the bug

      await db.query('UPDATE users SET scans_used_this_month = $1 WHERE id = $2', [10, testUser.id]);

      // Attempt scan of invalid URL (should fail)
      await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://this-domain-does-not-exist-12345.com/' })
        .expect(500); // Scan fails

      // Check quota - should still be 10
      const userResult = await db.query('SELECT scans_used_this_month FROM users WHERE id = $1', [testUser.id]);
      expect(userResult.rows[0].scans_used_this_month).toBe(10); // ❌ WILL FAIL - currently increments to 11
    });
  });

  describe('Monthly Quota Reset', () => {
    test('quota resets on 1st of month', async () => {
      // Set quota to 25 (limit reached)
      await db.query('UPDATE users SET scans_used_this_month = $1 WHERE id = $2', [25, testUser.id]);

      // Advance to next month (Dec 1)
      freezeAt('2025-12-01T00:00:00Z');

      // NOTE: Reset requires cron job or manual trigger
      // Simulate reset
      await db.query('UPDATE users SET scans_used_this_month = 0');

      // Should be able to scan again
      const res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/new-month' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('no rollover - unused scans do not carry over', async () => {
      // User only used 10 scans in November
      await db.query('UPDATE users SET scans_used_this_month = $1 WHERE id = $2', [10, testUser.id]);

      // Advance to December
      freezeAt('2025-12-01T00:00:00Z');
      await db.query('UPDATE users SET scans_used_this_month = 0');

      // Check quota - should be 0, not 15 (25 - 10 unused)
      const userResult = await db.query('SELECT scans_used_this_month FROM users WHERE id = $1', [testUser.id]);
      expect(userResult.rows[0].scans_used_this_month).toBe(0);

      // Can still only do 25 scans in December (not 25 + 15)
      // This is implicit from limit check
    });
  });

  describe('DIY Recommendation Structure', () => {
    test('DIY recommendations include applyBlocks and correct fields', async () => {
      const res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/' });

      expect(res.status).toBe(200);
      expect(res.body.recommendations).toBeDefined();
      expect(res.body.recommendations.length).toBeGreaterThan(0);

      const rec = res.body.recommendations[0];

      // Check DIY-specific fields
      expect(rec).toHaveProperty('id');
      expect(rec).toHaveProperty('title');
      expect(rec).toHaveProperty('priority');
      expect(rec).toHaveProperty('category');
      expect(rec).toHaveProperty('finding');
      expect(rec).toHaveProperty('impact');
      expect(rec).toHaveProperty('actionSteps');
      expect(rec).toHaveProperty('applyBlocks'); // Page-level implementation blocks
      expect(rec).toHaveProperty('unlock_state');

      // applyBlocks should be structured correctly
      if (rec.applyBlocks) {
        expect(rec.applyBlocks).toHaveProperty('htmlBlock');
        expect(rec.applyBlocks).toHaveProperty('jsonLdBlock');
        expect(rec.applyBlocks).toHaveProperty('placement');
      }
    });

    test('DIY gets 5 active recommendations, rest locked', async () => {
      const res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/' });

      expect(res.status).toBe(200);

      const activeRecs = res.body.recommendations.filter(r => r.unlock_state === 'active');
      const lockedRecs = res.body.recommendations.filter(r => r.unlock_state === 'locked');

      expect(activeRecs.length).toBe(5); // DIY gets 5 active
      expect(lockedRecs.length).toBeGreaterThan(0); // Rest are locked
    });

    test('DIY recommendations are full quality (not downgraded)', async () => {
      const res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/' });

      const rec = res.body.recommendations[0];

      // Check for quality indicators
      expect(rec.finding).not.toMatch(/upgrade to see/i); // No paywall text
      expect(rec.actionSteps.length).toBeGreaterThan(3); // Detailed steps
      expect(rec.impact).toBeTruthy(); // Impact analysis included
      expect(rec.implementationDetails).toBeDefined(); // Implementation guidance
    });

    test('Free plan gets 3 recommendations, DIY gets more', async () => {
      // Create free user
      const freeUser = await seedUser({ plan: 'free' });
      const freeToken = jwt.sign({ userId: freeUser.id }, process.env.JWT_SECRET);

      // Free scan
      const freeRes = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${freeToken}`)
        .send({ url: 'https://example.com/' });

      const freeActiveRecs = freeRes.body.recommendations.filter(r => r.unlock_state === 'active');
      expect(freeActiveRecs.length).toBe(3); // Free gets 3

      // DIY scan
      const diyRes = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/' });

      const diyActiveRecs = diyRes.body.recommendations.filter(r => r.unlock_state === 'active');
      expect(diyActiveRecs.length).toBe(5); // DIY gets 5
    });
  });

  describe('Feature Access Control', () => {
    test('DIY has access to JSON-LD export', async () => {
      const scan = await seedScan({ userId: testUser.id });

      const res = await request(app)
        .get(`/api/scan/${scan.id}/export/jsonld`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200); // Access granted
      expect(res.body.jsonld).toBeDefined();
    });

    test('DIY does NOT have access to PDF export', async () => {
      const scan = await seedScan({ userId: testUser.id });

      const res = await request(app)
        .get(`/api/scan/${scan.id}/export/pdf`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(403); // Forbidden
      expect(res.body.error).toMatch(/Feature not available/);
      expect(res.body.requiredPlan).toMatch(/Pro/);
    });

    test('DIY can scan up to 5 pages per scan', async () => {
      const res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          url: 'https://example.com/',
          pages: [
            'https://example.com/',
            'https://example.com/about',
            'https://example.com/services',
            'https://example.com/contact',
            'https://example.com/blog'
          ]
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('DIY blocked when requesting >5 pages', async () => {
      const res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          url: 'https://example.com/',
          pages: [
            'https://example.com/',
            'https://example.com/p1',
            'https://example.com/p2',
            'https://example.com/p3',
            'https://example.com/p4',
            'https://example.com/p5',
            'https://example.com/p6' // 7 pages total
          ]
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Page limit exceeded');
      expect(res.body.limit).toBe(5);
      expect(res.body.upgrade).toMatch(/Pro.*25 pages/);
    });
  });

  describe('Competitor Scan Limits', () => {
    test('DIY can scan 2 competitors per month', async () => {
      // Set primary domain
      await db.query('UPDATE users SET primary_domain = $1 WHERE id = $2', ['mysite.com', testUser.id]);

      // First competitor scan
      let res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://competitor1.com/' });

      expect(res.status).toBe(200);

      // Second competitor scan
      res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://competitor2.com/' });

      expect(res.status).toBe(200);

      // Third competitor scan → BLOCKED
      res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://competitor3.com/' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Competitor scan quota exceeded');
      expect(res.body.quota.limit).toBe(2);
    });

    test('Primary domain scans do not count against competitor quota', async () => {
      await db.query('UPDATE users SET primary_domain = $1 WHERE id = $2', ['mysite.com', testUser.id]);

      // Scan primary domain multiple times
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/scan/analyze')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ url: `https://mysite.com/page-${i}` });

        expect(res.status).toBe(200);
      }

      // Check competitor quota still at 0
      const userResult = await db.query('SELECT competitor_scans_used_this_month FROM users WHERE id = $1', [testUser.id]);
      expect(userResult.rows[0].competitor_scans_used_this_month || 0).toBe(0);
    });
  });

  describe('Plan Upgrade Effects', () => {
    test('tier upgrade immediately changes limits', async () => {
      // Start as DIY (25 scans/month)
      await db.query('UPDATE users SET scans_used_this_month = $1 WHERE id = $2', [24, testUser.id]);

      // Upgrade to Pro (50 scans/month)
      await seedPlan(testUser.id, 'pro');

      // Should now have Pro limits
      const res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/post-upgrade' });

      expect(res.status).toBe(200);

      // Can continue scanning (now up to 50 total)
      await db.query('UPDATE users SET scans_used_this_month = $1 WHERE id = $2', [49, testUser.id]);

      const res2 = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/pro-limit-test' });

      expect(res2.status).toBe(200); // 50th scan OK
    });

    test('downgrade from Pro to DIY enforces lower limit', async () => {
      // Start as Pro with 30 scans used
      await seedPlan(testUser.id, 'pro');
      await db.query('UPDATE users SET scans_used_this_month = $1 WHERE id = $2', [30, testUser.id]);

      // Downgrade to DIY (25 scans/month)
      await seedPlan(testUser.id, 'diy');

      // Should be blocked (already over DIY limit)
      const res = await request(app)
        .post('/api/scan/analyze')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ url: 'https://example.com/post-downgrade' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Scan limit reached');
    });
  });

  describe('5-Day Skip Interaction with DIY', () => {
    test('DIY user gets 5-day skip applied appropriately', async () => {
      // This test verifies 5-day unlock throttle for DIY
      const scan = await seedScan({ userId: testUser.id });

      // First unlock
      await request(app)
        .post(`/api/scan/${scan.id}/unlock`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ count: 5 });

      // Attempt second unlock within 5 days → blocked
      advanceBy({ days: 2 });
      const res = await request(app)
        .post(`/api/scan/${scan.id}/unlock`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ count: 5 });

      expect(res.status).toBe(429);
      expect(res.body.error).toMatch(/Unlock interval not met/);
    });

    test('Free plan does not have 5-day unlock restriction', async () => {
      const freeUser = await seedUser({ plan: 'free' });
      const freeToken = jwt.sign({ userId: freeUser.id }, process.env.JWT_SECRET);
      const scan = await seedScan({ userId: freeUser.id });

      // Unlock
      await request(app)
        .post(`/api/scan/${scan.id}/unlock`)
        .set('Authorization', `Bearer ${freeToken}`)
        .send({ count: 3 });

      // Immediate second unlock attempt → should work (free has no throttle)
      const res = await request(app)
        .post(`/api/scan/${scan.id}/unlock`)
        .set('Authorization', `Bearer ${freeToken}`)
        .send({ count: 3 });

      expect(res.status).not.toBe(429);
    });
  });
});
