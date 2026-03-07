/**
 * Findings Endpoint Tests
 *
 * Tests for GET /api/scans/:scanId/findings
 * Plan-gated findings with severity/pillar filters.
 *
 * Run with: node --test backend/tests/unit/findings-endpoint.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// =============================================================================
// MOCK SETUP
// =============================================================================

let dbQueryResults = [];
let dbQueryCalls = [];

const mockDb = {
  query: async (sql, params) => {
    dbQueryCalls.push({ sql: sql.trim(), params });
    return dbQueryResults.shift() || { rows: [] };
  }
};

const mockPlanService = {
  getEntitlements: (planName) => {
    const entitlements = {
      free: { hasFindings: 'teaser' },
      starter: { hasFindings: 'full' },
      pro: { hasFindings: 'full' }
    };
    return entitlements[planName] || entitlements.free;
  }
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../db/database' || id.endsWith('/db/database')) {
    return mockDb;
  }
  if (id === '../services/planService' || id.endsWith('/services/planService')) {
    return mockPlanService;
  }
  if (id === '../middleware/auth' || id.endsWith('/middleware/auth')) {
    return {
      authenticateToken: (req, res, next) => {
        if (!req.user) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

// Import express and the router after mocking
const express = require('express');
const findingsRouter = require('../../routes/findings');

// =============================================================================
// HELPERS
// =============================================================================

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/scans', findingsRouter);
  return app;
}

function makeRequest(app, path, user) {
  return new Promise((resolve) => {
    const req = {
      method: 'GET',
      url: path,
      headers: {},
      params: {},
      query: {},
      user: user || null
    };

    // Parse URL
    const [pathname, queryString] = path.split('?');
    if (queryString) {
      const params = new URLSearchParams(queryString);
      for (const [key, val] of params) {
        req.query[key] = val;
      }
    }

    // Match route params
    const match = pathname.match(/\/api\/scans\/(\d+)\/findings/);
    if (match) {
      req.params.scanId = match[1];
    }

    let statusCode = 200;
    let responseBody = null;

    const res = {
      status(code) { statusCode = code; return this; },
      json(body) {
        responseBody = body;
        resolve({ status: statusCode, body: responseBody });
        return this;
      }
    };

    // Simulate express routing by calling the route handler directly
    // We need to use supertest-like approach or call the handler
    // Instead, let's use a simpler approach with the router
    const handler = findingsRouter.stack[0].route.stack.find(l => l.method === 'get');

    // Run middleware chain
    const middlewares = findingsRouter.stack[0].route.stack;
    let idx = 0;
    const next = () => {
      idx++;
      if (idx < middlewares.length) {
        middlewares[idx].handle(req, res, next);
      }
    };
    // Start with first middleware (authenticateToken)
    middlewares[0].handle(req, res, next);
  });
}

// Sample findings data for reuse
function sampleFindings() {
  return [
    { id: 'f1', pillar: 'schema', subfactor_key: 'missing_schema', severity: 'critical', title: 'Missing Schema', description: 'No schema markup', impacted_urls: ['https://a.com', 'https://b.com'], evidence_data: {}, suggested_pack_type: 'schema_pack', created_at: new Date() },
    { id: 'f2', pillar: 'trust', subfactor_key: 'no_reviews', severity: 'high', title: 'No Reviews', description: 'Missing reviews', impacted_urls: ['https://a.com'], evidence_data: {}, suggested_pack_type: 'evidence_trust', created_at: new Date() },
    { id: 'f3', pillar: 'aeo', subfactor_key: 'no_faqs', severity: 'medium', title: 'No FAQs', description: 'Missing FAQs', impacted_urls: null, evidence_data: {}, suggested_pack_type: 'faq_pack', created_at: new Date() },
    { id: 'f4', pillar: 'speed', subfactor_key: 'slow_lcp', severity: 'low', title: 'Slow LCP', description: 'LCP too slow', impacted_urls: [], evidence_data: {}, suggested_pack_type: 'performance_pack', created_at: new Date() },
    { id: 'f5', pillar: 'schema', subfactor_key: 'broken_schema', severity: 'high', title: 'Broken Schema', description: 'Schema errors', impacted_urls: ['https://c.com'], evidence_data: {}, suggested_pack_type: 'schema_pack', created_at: new Date() }
  ];
}

// =============================================================================
// TESTS
// =============================================================================

describe('GET /api/scans/:scanId/findings', () => {

  beforeEach(() => {
    dbQueryResults = [];
    dbQueryCalls = [];
  });

  // =========================================================================
  // AUTHORIZATION
  // =========================================================================

  describe('Authorization', () => {

    it('should return 401 when not authenticated', async () => {
      const result = await makeRequest(null, '/api/scans/1/findings', null);
      assert.strictEqual(result.status, 401);
    });

    it('should return 404 when scan not found or not owned', async () => {
      dbQueryResults.push({ rows: [] }); // ownership check returns empty
      const result = await makeRequest(null, '/api/scans/999/findings', { id: 1, plan: 'pro' });
      assert.strictEqual(result.status, 404);
      assert.ok(result.body.error.includes('Scan not found'));
    });
  });

  // =========================================================================
  // BASIC RESPONSE
  // =========================================================================

  describe('Basic response shape', () => {

    it('should return correct shape with all fields', async () => {
      // Ownership check passes
      dbQueryResults.push({ rows: [{ id: 1 }] });
      // Counts query
      dbQueryResults.push({ rows: [
        { severity: 'critical', count: 1 },
        { severity: 'high', count: 2 },
        { severity: 'medium', count: 1 },
        { severity: 'low', count: 1 }
      ]});
      // Findings query
      dbQueryResults.push({ rows: sampleFindings() });

      const result = await makeRequest(null, '/api/scans/1/findings', { id: 1, plan: 'pro' });

      assert.strictEqual(result.status, 200);
      assert.ok(Array.isArray(result.body.findings));
      assert.strictEqual(typeof result.body.total_count, 'number');
      assert.strictEqual(typeof result.body.severity_counts, 'object');
      assert.strictEqual(typeof result.body.plan_limited, 'boolean');

      // Check severity_counts
      assert.strictEqual(result.body.severity_counts.critical, 1);
      assert.strictEqual(result.body.severity_counts.high, 2);
      assert.strictEqual(result.body.severity_counts.medium, 1);
      assert.strictEqual(result.body.severity_counts.low, 1);
      assert.strictEqual(result.body.total_count, 5);
    });

    it('should return empty results for scan with no findings', async () => {
      dbQueryResults.push({ rows: [{ id: 1 }] }); // ownership
      dbQueryResults.push({ rows: [] }); // counts
      dbQueryResults.push({ rows: [] }); // findings

      const result = await makeRequest(null, '/api/scans/1/findings', { id: 1, plan: 'pro' });

      assert.strictEqual(result.body.findings.length, 0);
      assert.strictEqual(result.body.total_count, 0);
      assert.deepStrictEqual(result.body.severity_counts, { critical: 0, high: 0, medium: 0, low: 0 });
      assert.strictEqual(result.body.plan_limited, false);
    });

    it('should default impacted_urls to empty array when null', async () => {
      dbQueryResults.push({ rows: [{ id: 1 }] }); // ownership
      dbQueryResults.push({ rows: [{ severity: 'medium', count: 1 }] }); // counts
      dbQueryResults.push({ rows: [sampleFindings()[2]] }); // Finding with null impacted_urls

      const result = await makeRequest(null, '/api/scans/1/findings', { id: 1, plan: 'pro' });

      assert.ok(Array.isArray(result.body.findings[0].impacted_urls));
      assert.strictEqual(result.body.findings[0].impacted_urls.length, 0);
      assert.strictEqual(result.body.findings[0].impacted_url_count, 0);
    });

    it('should compute impacted_url_count correctly', async () => {
      dbQueryResults.push({ rows: [{ id: 1 }] });
      dbQueryResults.push({ rows: [{ severity: 'critical', count: 1 }] });
      dbQueryResults.push({ rows: [sampleFindings()[0]] }); // 2 impacted URLs

      const result = await makeRequest(null, '/api/scans/1/findings', { id: 1, plan: 'pro' });

      assert.strictEqual(result.body.findings[0].impacted_url_count, 2);
    });
  });

  // =========================================================================
  // PLAN-BASED TRUNCATION
  // =========================================================================

  describe('Plan-based truncation', () => {

    it('should return only 3 findings for free plan with plan_limited=true', async () => {
      dbQueryResults.push({ rows: [{ id: 1 }] });
      dbQueryResults.push({ rows: [
        { severity: 'critical', count: 1 },
        { severity: 'high', count: 2 },
        { severity: 'medium', count: 1 },
        { severity: 'low', count: 1 }
      ]});
      dbQueryResults.push({ rows: sampleFindings() });

      const result = await makeRequest(null, '/api/scans/1/findings', { id: 1, plan: 'free' });

      assert.strictEqual(result.body.findings.length, 3);
      assert.strictEqual(result.body.total_count, 5); // Full count
      assert.strictEqual(result.body.plan_limited, true);
    });

    it('should return all findings for starter plan with plan_limited=false', async () => {
      dbQueryResults.push({ rows: [{ id: 1 }] });
      dbQueryResults.push({ rows: [{ severity: 'high', count: 5 }] });
      dbQueryResults.push({ rows: sampleFindings() });

      const result = await makeRequest(null, '/api/scans/1/findings', { id: 1, plan: 'starter' });

      assert.strictEqual(result.body.findings.length, 5);
      assert.strictEqual(result.body.plan_limited, false);
    });

    it('should not set plan_limited if free plan has <= 3 findings', async () => {
      const twoFindings = sampleFindings().slice(0, 2);
      dbQueryResults.push({ rows: [{ id: 1 }] });
      dbQueryResults.push({ rows: [{ severity: 'critical', count: 1 }, { severity: 'high', count: 1 }] });
      dbQueryResults.push({ rows: twoFindings });

      const result = await makeRequest(null, '/api/scans/1/findings', { id: 1, plan: 'free' });

      assert.strictEqual(result.body.findings.length, 2);
      assert.strictEqual(result.body.plan_limited, false);
    });

    it('should show full severity_counts even when free plan truncates findings', async () => {
      dbQueryResults.push({ rows: [{ id: 1 }] });
      dbQueryResults.push({ rows: [
        { severity: 'critical', count: 3 },
        { severity: 'high', count: 5 },
        { severity: 'medium', count: 2 },
        { severity: 'low', count: 2 }
      ]});
      dbQueryResults.push({ rows: sampleFindings() });

      const result = await makeRequest(null, '/api/scans/1/findings', { id: 1, plan: 'free' });

      assert.strictEqual(result.body.total_count, 12);
      assert.strictEqual(result.body.severity_counts.critical, 3);
      assert.strictEqual(result.body.severity_counts.high, 5);
      assert.strictEqual(result.body.severity_counts.medium, 2);
      assert.strictEqual(result.body.severity_counts.low, 2);
      assert.strictEqual(result.body.findings.length, 3);
    });
  });

  // =========================================================================
  // FILTERS
  // =========================================================================

  describe('Query param filters', () => {

    it('should filter by severity', async () => {
      dbQueryResults.push({ rows: [{ id: 1 }] });
      dbQueryResults.push({ rows: [
        { severity: 'critical', count: 1 },
        { severity: 'high', count: 2 }
      ]});
      // Only critical findings returned by DB
      dbQueryResults.push({ rows: [sampleFindings()[0]] });

      const result = await makeRequest(null, '/api/scans/1/findings?severity=critical', { id: 1, plan: 'pro' });

      assert.strictEqual(result.status, 200);
      // Verify the SQL included severity filter
      const findingsQuery = dbQueryCalls[2];
      assert.ok(findingsQuery.sql.includes('severity = ANY'));
    });

    it('should filter by pillar', async () => {
      dbQueryResults.push({ rows: [{ id: 1 }] });
      dbQueryResults.push({ rows: [{ severity: 'critical', count: 2 }] });
      dbQueryResults.push({ rows: sampleFindings().slice(0, 2) });

      const result = await makeRequest(null, '/api/scans/1/findings?pillar=schema', { id: 1, plan: 'pro' });

      assert.strictEqual(result.status, 200);
      const findingsQuery = dbQueryCalls[2];
      assert.ok(findingsQuery.sql.includes('LOWER(pillar)'));
    });

    it('should return 400 for invalid severity', async () => {
      dbQueryResults.push({ rows: [{ id: 1 }] }); // ownership check passes

      const result = await makeRequest(null, '/api/scans/1/findings?severity=invalid', { id: 1, plan: 'pro' });

      assert.strictEqual(result.status, 400);
      assert.ok(result.body.error.includes('Invalid severity'));
      assert.ok(result.body.error.includes('invalid'));
    });

    it('should not affect severity_counts when filtering', async () => {
      dbQueryResults.push({ rows: [{ id: 1 }] });
      dbQueryResults.push({ rows: [
        { severity: 'critical', count: 2 },
        { severity: 'high', count: 3 },
        { severity: 'medium', count: 1 }
      ]});
      dbQueryResults.push({ rows: [sampleFindings()[0]] });

      const result = await makeRequest(null, '/api/scans/1/findings?severity=critical', { id: 1, plan: 'pro' });

      // Counts should still reflect ALL findings
      assert.strictEqual(result.body.total_count, 6);
      assert.strictEqual(result.body.severity_counts.critical, 2);
      assert.strictEqual(result.body.severity_counts.high, 3);
      assert.strictEqual(result.body.severity_counts.medium, 1);
    });

    it('should apply plan truncation after filtering as free user', async () => {
      // Free user with severity filter - should get at most 3
      dbQueryResults.push({ rows: [{ id: 1 }] });
      dbQueryResults.push({ rows: [{ severity: 'critical', count: 5 }] });
      // 5 critical findings returned
      const criticals = Array.from({ length: 5 }, (_, i) => ({
        ...sampleFindings()[0],
        id: `fc${i}`
      }));
      dbQueryResults.push({ rows: criticals });

      const result = await makeRequest(null, '/api/scans/1/findings?severity=critical', { id: 1, plan: 'free' });

      assert.strictEqual(result.body.findings.length, 3);
      assert.strictEqual(result.body.plan_limited, true);
    });
  });

  // =========================================================================
  // SORTING
  // =========================================================================

  describe('Sorting', () => {

    it('should request findings ordered by severity priority, pillar, id', async () => {
      dbQueryResults.push({ rows: [{ id: 1 }] });
      dbQueryResults.push({ rows: [] });
      dbQueryResults.push({ rows: [] });

      await makeRequest(null, '/api/scans/1/findings', { id: 1, plan: 'pro' });

      const findingsQuery = dbQueryCalls[2];
      assert.ok(findingsQuery.sql.includes("WHEN 'critical' THEN 1"));
      assert.ok(findingsQuery.sql.includes("WHEN 'high' THEN 2"));
      assert.ok(findingsQuery.sql.includes("WHEN 'medium' THEN 3"));
      assert.ok(findingsQuery.sql.includes("WHEN 'low' THEN 4"));
      assert.ok(findingsQuery.sql.includes('pillar ASC'));
      assert.ok(findingsQuery.sql.includes('id ASC'));
    });
  });

  // =========================================================================
  // INPUT VALIDATION
  // =========================================================================

  describe('Input validation', () => {

    it('should return 400 for non-numeric scan ID', async () => {
      const result = await makeRequest(null, '/api/scans/abc/findings', { id: 1, plan: 'pro' });
      assert.strictEqual(result.status, 400);
      assert.ok(result.body.error.includes('Invalid scan ID'));
    });
  });
});
