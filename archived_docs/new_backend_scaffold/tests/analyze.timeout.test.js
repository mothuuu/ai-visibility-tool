// ---------------------------------------------------------
// Regression tests for analyze-route timeouts + partial results.
//
// Scenarios:
//   1. scoring never resolves         → 504 { code: UPSTREAM_TIMEOUT }
//   2. scoring ok, recommender hangs  → 200 with
//                                       recommendations_status: 'timeout'
//                                       and analysis persisted as 'partial'
//
// Runs with plain Node — no test framework, no real network calls.
// Process exits non-zero on failure.
// ---------------------------------------------------------
'use strict';

// Tighten timeouts so the suite finishes fast.
process.env.UPSTREAM_SCORER_TIMEOUT_MS = '150';
process.env.UPSTREAM_RECOMMENDER_TIMEOUT_MS = '150';
process.env.UPSTREAM_FETCH_TIMEOUT_MS = '150';
process.env.ANALYZE_DEADLINE_MS = '2000';

const assert = require('assert');
const http = require('http');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const express = require(path.join(ROOT, 'node_modules', 'express'));

// ---------- module stubbing harness ----------
const originalLoad = Module._load;
let activeStubs = {};

Module._load = function patchedLoad(request, parent, ...rest) {
  if (parent && Object.prototype.hasOwnProperty.call(activeStubs, request)) {
    return activeStubs[request];
  }
  return originalLoad.call(this, request, parent, ...rest);
};

function clearRouteCache() {
  // Force a fresh require so stubs from the previous scenario are picked up.
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}routes${path.sep}analyze.js`) ||
      key.includes(`${path.sep}utils${path.sep}withTimeout.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function loadRouterWithStubs(stubs) {
  activeStubs = stubs;
  clearRouteCache();
  return require(path.join(ROOT, 'routes', 'analyze'));
}

function mountAndPost(router, payload) {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/analyze', router);
    const server = app.listen(0, () => {
      const { port } = server.address();
      const body = JSON.stringify(payload);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/v1/analyze',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, body: data });
          });
        }
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.write(body);
      req.end();
    });
  });
}

// ---------- shared fake DB ----------
function makeFakePool() {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: sql.trim().split('\n')[0], params });
      // INSERT INTO analyses ... RETURNING id
      if (/INSERT INTO analyses/.test(sql)) {
        return { rows: [{ id: 4242 }] };
      }
      return { rows: [] };
    },
  };
}

const dbStub = (pool) => ({
  getPool: () => pool,
  connectDB: async () => pool,
  closePool: async () => {},
  healthCheck: async () => ({ healthy: true, timestamp: new Date() }),
  getPoolStats: () => null,
});

// ---------- Scenario 1: scoring hangs → 504 UPSTREAM_TIMEOUT ----------
async function scenarioScoringTimeout() {
  const fakePool = makeFakePool();

  const router = loadRouterWithStubs({
    '../services/scorer': {
      runRubricScoring: () => new Promise(() => {}), // never resolves
    },
    '../services/recommender': {
      generateRecommendations: async () => [],
    },
    '../db/connect': dbStub(fakePool),
  });

  const t0 = Date.now();
  const result = await mountAndPost(router, {
    url: 'https://example.com',
    vertical: 'default',
  });
  const elapsed = Date.now() - t0;

  assert.strictEqual(
    result.status,
    504,
    `expected 504 on scoring timeout, got ${result.status}`
  );
  const parsed = JSON.parse(result.body);
  assert.strictEqual(parsed.code, 'UPSTREAM_TIMEOUT');
  assert.strictEqual(parsed.step, 'scoring');
  assert.ok(
    elapsed < 1500,
    `expected timeout to trip well before deadline, took ${elapsed}ms`
  );
  assert.strictEqual(
    fakePool.calls.length,
    0,
    'scoring timeout should not persist anything'
  );
  console.log(`✅ scenario 1: scoring timeout → 504 UPSTREAM_TIMEOUT (${elapsed}ms)`);
}

// ---------- Scenario 2: scoring ok, recs hang → 200 partial ----------
async function scenarioPartialRecommendations() {
  const fakePool = makeFakePool();
  const fakeRubric = {
    overall_score: 73,
    categories: { 'Technical Setup & Structured Data': 12 },
    evidence: { 'Technical Setup & Structured Data': ['ok'] },
    extracted: { fetch_status: 200 },
  };

  const router = loadRouterWithStubs({
    '../services/scorer': {
      runRubricScoring: async () => fakeRubric,
    },
    '../services/recommender': {
      generateRecommendations: () => new Promise(() => {}), // hangs
    },
    '../db/connect': dbStub(fakePool),
  });

  const result = await mountAndPost(router, {
    url: 'https://example.com',
    vertical: 'default',
  });

  assert.strictEqual(
    result.status,
    200,
    `expected 200 partial on recs timeout, got ${result.status}`
  );
  const parsed = JSON.parse(result.body);
  assert.strictEqual(parsed.scoring_status, 'success');
  assert.strictEqual(parsed.recommendations_status, 'timeout');
  assert.strictEqual(parsed.status, 'partial');
  assert.strictEqual(parsed.score, 73);
  assert.deepStrictEqual(parsed.recommendations, []);
  assert.strictEqual(parsed.analysis_id, 4242);

  // Exactly one INSERT (the analyses row); no recommendations persisted.
  const inserts = fakePool.calls.filter((c) => /INSERT INTO/.test(c.sql));
  assert.strictEqual(
    inserts.length,
    1,
    `expected 1 insert (analysis only), got ${inserts.length}`
  );
  assert.match(inserts[0].sql, /INSERT INTO analyses/);
  // Status param should be 'partial'.
  assert.strictEqual(inserts[0].params[1], 'partial');
  console.log('✅ scenario 2: partial results persisted with status=partial');
}

// ---------- runner ----------
(async () => {
  let failed = false;
  for (const [name, fn] of [
    ['scoring-timeout', scenarioScoringTimeout],
    ['partial-recommendations', scenarioPartialRecommendations],
  ]) {
    try {
      await fn();
    } catch (err) {
      failed = true;
      console.error(`❌ ${name} failed:`, err.message);
      if (err.stack) console.error(err.stack);
    }
  }
  process.exit(failed ? 1 : 0);
})();

// Don't let stray rejections in stub closures hide test failures.
process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection:', reason);
  process.exit(1);
});
