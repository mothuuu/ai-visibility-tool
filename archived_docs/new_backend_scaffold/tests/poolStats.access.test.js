// ---------------------------------------------------------
// Regression tests for /pool-stats access control.
//
// Mounts the requireInternalAccess middleware on a throwaway Express
// app + a stub handler. Asserts:
//   1. No header                 → 401 UNAUTHORIZED
//   2. Wrong header               → 401 UNAUTHORIZED
//   3. INTERNAL_METRICS_KEY unset → 401 UNAUTHORIZED (fail-closed)
//   4. Correct header             → 200 with stub payload
// ---------------------------------------------------------
'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const express = require(path.join(ROOT, 'node_modules', 'express'));

function freshMiddleware() {
  // Re-require so each scenario picks up the current env value.
  delete require.cache[require.resolve(path.join(ROOT, 'middleware', 'requireInternalAccess'))];
  return require(path.join(ROOT, 'middleware', 'requireInternalAccess'));
}

function request({ port, headers }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/pool-stats',
        method: 'GET',
        headers: headers || {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function startApp() {
  const requireInternalAccess = freshMiddleware();
  const app = express();
  app.get('/pool-stats', requireInternalAccess, (req, res) => {
    res.json({ total: 1, idle: 1, waiting: 0 });
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withApp(fn) {
  const server = await startApp();
  try {
    await fn(server.address().port);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

(async () => {
  let failed = false;
  const KEY = 'this-is-a-very-long-test-only-metrics-key-32b';

  // 1) No header → 401
  try {
    process.env.INTERNAL_METRICS_KEY = KEY;
    await withApp(async (port) => {
      const r = await request({ port });
      assert.strictEqual(r.status, 401);
      const body = JSON.parse(r.body);
      assert.strictEqual(body.code, 'UNAUTHORIZED');
    });
    console.log('✅ no header → 401 UNAUTHORIZED');
  } catch (err) {
    failed = true;
    console.error('❌ scenario 1 (no header):', err.message);
  }

  // 2) Wrong header → 401
  try {
    process.env.INTERNAL_METRICS_KEY = KEY;
    await withApp(async (port) => {
      const r = await request({
        port,
        headers: { 'x-metrics-key': 'definitely-not-the-key' },
      });
      assert.strictEqual(r.status, 401);
      const body = JSON.parse(r.body);
      assert.strictEqual(body.code, 'UNAUTHORIZED');
    });
    console.log('✅ wrong header → 401 UNAUTHORIZED');
  } catch (err) {
    failed = true;
    console.error('❌ scenario 2 (wrong header):', err.message);
  }

  // 3) Env unset → 401 (fail-closed)
  try {
    delete process.env.INTERNAL_METRICS_KEY;
    await withApp(async (port) => {
      const r = await request({
        port,
        headers: { 'x-metrics-key': KEY },
      });
      assert.strictEqual(r.status, 401);
    });
    console.log('✅ env unset → 401 UNAUTHORIZED (fail-closed)');
  } catch (err) {
    failed = true;
    console.error('❌ scenario 3 (env unset):', err.message);
  }

  // 4) Correct header → 200
  try {
    process.env.INTERNAL_METRICS_KEY = KEY;
    await withApp(async (port) => {
      const r = await request({
        port,
        headers: { 'x-metrics-key': KEY },
      });
      assert.strictEqual(r.status, 200, `expected 200, got ${r.status}`);
      const body = JSON.parse(r.body);
      assert.strictEqual(body.total, 1);
    });
    console.log('✅ correct header → 200');
  } catch (err) {
    failed = true;
    console.error('❌ scenario 4 (correct header):', err.message);
  }

  process.exit(failed ? 1 : 0);
})();

process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection:', reason);
  process.exit(1);
});
