// ---------------------------------------------------------
// Smoke test: analyze route does not crash when the DB pool is
// uninitialized, and returns a clean 503 with code DB_UNAVAILABLE.
//
// This is a regression guard for the bug where `pool` was destructured
// from `../db/connect` (which doesn't export `pool`), causing
// `pool.query(...)` to throw `Cannot read properties of undefined`
// on every live request.
//
// Run with:  node "new backend/tests/analyze.smoke.test.js"
// (No external test framework required — exits non-zero on failure.)
// ---------------------------------------------------------
'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');

// Stub out the AI service modules so requiring the route does not
// pull in OpenAI / network dependencies.
const Module = require('module');
const originalResolve = Module._resolveFilename;
const stubs = {
  '../services/scorer': { runRubricScoring: async () => ({}) },
  '../services/recommender': { generateRecommendations: async () => [] },
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, ...rest) {
  if (parent && stubs[request]) return stubs[request];
  return originalLoad.call(this, request, parent, ...rest);
};

// Important: do NOT call connectDB() — we want the pool to be
// uninitialized so we can verify graceful failure.
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));
const analyzeRouter = require(path.join(__dirname, '..', 'routes', 'analyze'));

// 1) The route module must export a router (no crash at require-time).
assert.ok(analyzeRouter, 'analyze router should be exported');
assert.strictEqual(typeof analyzeRouter, 'function', 'router must be a function');

// 2) Mount on a throwaway app and hit it with a valid-looking payload.
const app = express();
app.use(express.json());
app.use('/api/v1/analyze', analyzeRouter);

const server = app.listen(0, async () => {
  const { port } = server.address();

  const body = JSON.stringify({ url: 'https://example.com', vertical: 'default' });

  const result = await new Promise((resolve, reject) => {
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
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  try {
    // Without connectDB(), getPool() throws — route must catch and 503.
    assert.strictEqual(
      result.status,
      503,
      `expected 503 when pool is uninitialized, got ${result.status}`
    );
    const parsed = JSON.parse(result.body);
    assert.strictEqual(parsed.code, 'DB_UNAVAILABLE', 'expected code=DB_UNAVAILABLE');
    console.log('✅ analyze route fails gracefully when pool is uninitialized');
    server.close(() => process.exit(0));
  } catch (err) {
    console.error('❌ smoke test failed:', err.message);
    server.close(() => process.exit(1));
  }
});
