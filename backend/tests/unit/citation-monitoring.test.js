// backend/tests/unit/citation-monitoring.test.js
//
// Citation Monitoring persistence tests — aligned to 018 prod schema.
//
// What this verifies (no real Postgres, no real network):
//   1. citationMonitoringService persists clusters, runs, and evidence
//      against a fake DB shaped like the 018 schema.
//   2. The /api/prompt-clusters route wires through correctly.
//
// Run with: node --test backend/tests/unit/citation-monitoring.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  createCitationMonitoringService,
} = require('../../services/citationMonitoringService');

// ----------- fake DB (018 schema) ----------
function makeFakeDb() {
  const inserted = {
    prompt_clusters: [],
    citation_test_runs: [],
    citation_evidence: [],
  };
  let id = 1;
  const calls = [];

  const query = async (sql, params) => {
    calls.push({ sql: sql.trim().split('\n')[0], params });
    const trimmed = sql.trim();

    // prompt_clusters — SELECT for upsert (SELECT-then-INSERT/UPDATE pattern)
    if (/^SELECT id FROM prompt_clusters WHERE user_id/i.test(trimmed)) {
      const row = inserted.prompt_clusters.find(
        (r) => r.user_id === params[0] && r.cluster_name === params[1]
      );
      return { rows: row ? [{ id: row.id }] : [] };
    }

    // prompt_clusters — SELECT * (listClusters / getCluster)
    if (/^SELECT \* FROM prompt_clusters WHERE id/i.test(trimmed)) {
      const row = inserted.prompt_clusters.find((r) => r.id === params[0]);
      return { rows: row ? [row] : [] };
    }

    if (/^SELECT \* FROM prompt_clusters/i.test(trimmed)) {
      const userId = params[0];
      const rows = inserted.prompt_clusters.filter(
        (c) => c.active && (userId == null || c.user_id === userId)
      );
      return { rows };
    }

    // prompt_clusters — INSERT
    if (/^INSERT INTO prompt_clusters/i.test(trimmed)) {
      const row = {
        id: id++,
        user_id: params[0],
        cluster_name: params[1],
        vertical: params[2],
        intent_tier: params[3],
        queries: JSON.parse(params[4]),
        source: params[5],
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      inserted.prompt_clusters.push(row);
      return { rows: [row] };
    }

    // prompt_clusters — UPDATE (upsert update path)
    if (/^UPDATE prompt_clusters/i.test(trimmed)) {
      const rowId = params[params.length - 1];
      const row = inserted.prompt_clusters.find((r) => r.id === rowId);
      if (row) {
        row.queries = JSON.parse(params[0]);
        row.updated_at = new Date();
        return { rows: [row] };
      }
      return { rows: [] };
    }

    // citation_test_runs — INSERT
    if (/^INSERT INTO citation_test_runs/i.test(trimmed)) {
      const row = {
        id: id++,
        user_id: params[0],
        run_type: params[1],
        scan_id: params[2] || null,
        engines_tested: params[3],
        status: 'pending',
        created_at: new Date(),
        completed_at: null,
      };
      inserted.citation_test_runs.push(row);
      return { rows: [row] };
    }

    // citation_test_runs — UPDATE status
    if (/^UPDATE citation_test_runs/i.test(trimmed)) {
      const row = inserted.citation_test_runs.find((r) => r.id === params[0]);
      if (row) {
        row.status = params[1];
        row.completed_at = new Date();
      }
      return { rows: row ? [row] : [] };
    }

    // citation_test_runs — SELECT * (listRuns)
    if (/^SELECT \* FROM citation_test_runs/i.test(trimmed)) {
      const userId = params[0];
      const rows = inserted.citation_test_runs
        .filter((r) => userId == null || r.user_id === userId)
        .sort((a, b) => b.created_at - a.created_at);
      return { rows };
    }

    // citation_evidence — INSERT
    if (/^INSERT INTO citation_evidence/i.test(trimmed)) {
      const row = {
        id: id++,
        test_run_id: params[0],
        query_text: params[1],
        engine: params[2],
        cited: params[3],
        citation_type: params[4] || null,
        response_snippet: params[5] || null,
        domain_mentioned: params[6] || false,
        detection_status: params[3] ? 'cited' : (params[6] ? 'mentioned' : 'not_found'),
        created_at: new Date(),
      };
      inserted.citation_evidence.push(row);
      return { rows: [row], rowCount: 1 };
    }

    // citation_evidence — SELECT (getEvidence)
    if (/^SELECT query_text/i.test(trimmed)) {
      const runId = params[0];
      const rows = inserted.citation_evidence
        .filter((e) => e.test_run_id === runId)
        .sort((a, b) => a.engine.localeCompare(b.engine));
      return { rows };
    }

    // BEGIN / COMMIT / ROLLBACK
    if (/^BEGIN$/i.test(trimmed) || /^COMMIT$/i.test(trimmed) || /^ROLLBACK$/i.test(trimmed)) {
      return { rows: [] };
    }

    throw new Error(`Unhandled SQL in fake db: ${trimmed.slice(0, 80)}`);
  };

  return { query, inserted, calls };
}

// ----------- service tests (018 schema) ----------
describe('citationMonitoringService — 018 schema', () => {
  it('upsertCluster creates a new cluster and translates column names', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });

    const cluster = await svc.upsertCluster({
      userId: 42,
      clusterName: 'Vendor selection',
      queries: ['Best vendors for procurement?', 'Top procurement tools?'],
      vertical: 'b2b-saas',
      intentTier: 'explore',
      source: 'manual',
    });

    assert.strictEqual(typeof cluster.id, 'number');
    assert.strictEqual(cluster.name, 'Vendor selection');
    assert.strictEqual(cluster.canonical_prompt, 'Best vendors for procurement?');
    assert.deepStrictEqual(cluster.prompt_variants, ['Top procurement tools?']);
    assert.strictEqual(db.inserted.prompt_clusters.length, 1);
  });

  it('upsertCluster updates the existing row on second call with same user + name', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });

    await svc.upsertCluster({
      userId: 42, clusterName: 'Test', queries: ['original'],
      vertical: 'general', intentTier: 'explore', source: 'manual',
    });
    const updated = await svc.upsertCluster({
      userId: 42, clusterName: 'Test', queries: ['updated-q1', 'updated-q2'],
      vertical: 'general', intentTier: 'explore', source: 'manual',
    });

    assert.strictEqual(db.inserted.prompt_clusters.length, 1);
    assert.strictEqual(updated.canonical_prompt, 'updated-q1');
    assert.deepStrictEqual(updated.prompt_variants, ['updated-q2']);
  });

  it('upsertCluster treats different users as separate rows', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });

    await svc.upsertCluster({
      userId: 1, clusterName: 'Test', queries: ['q1'],
      vertical: 'general', intentTier: 'explore', source: 'manual',
    });
    await svc.upsertCluster({
      userId: 2, clusterName: 'Test', queries: ['q2'],
      vertical: 'general', intentTier: 'explore', source: 'manual',
    });

    assert.strictEqual(db.inserted.prompt_clusters.length, 2);
  });

  it('listClusters returns only active rows for the given user', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });

    await svc.upsertCluster({ userId: 42, clusterName: 'A', queries: ['q'], vertical: 'general', intentTier: 'explore', source: 'manual' });
    await svc.upsertCluster({ userId: 99, clusterName: 'B', queries: ['q'], vertical: 'general', intentTier: 'explore', source: 'manual' });

    const rows = await svc.listClusters({ userId: 42 });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].name, 'A');
  });

  it('createRun inserts with status pending', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });

    const run = await svc.createRun({
      userId: 42,
      runType: 'scan_time',
      enginesTested: ['chatgpt', 'claude'],
      client: db,
    });

    assert.strictEqual(run.status, 'pending');
    assert.strictEqual(typeof run.id, 'number');
    assert.strictEqual(db.inserted.citation_test_runs.length, 1);
  });

  it('updateRunStatus accepts "completed" and stores it as-is', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });

    const run = await svc.createRun({ userId: 42, runType: 'scan_time', client: db });
    await svc.updateRunStatus(run.id, 'completed');

    assert.strictEqual(db.inserted.citation_test_runs[0].status, 'completed');
  });

  it('updateRunStatus rejects unknown statuses', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });

    const run = await svc.createRun({ userId: 42, runType: 'scan_time', client: db });
    await assert.rejects(
      () => svc.updateRunStatus(run.id, 'unknown'),
      /invalid status/
    );
  });

  it('persistEvidenceRows maps engine names and inserts rows', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });

    const run = await svc.createRun({ userId: 42, runType: 'scan_time', client: db });

    const results = {
      assistants: {
        openai: {
          tested: true,
          queries: [
            { query: 'q1', mentioned: true,  cited: true,  snippet: 'excerpt' },
            { query: 'q2', mentioned: false, cited: false, snippet: null },
          ],
        },
        anthropic: {
          tested: true,
          queries: [{ query: 'q1', mentioned: false, cited: false, snippet: null }],
        },
        perplexity: { tested: false },
      },
    };

    const outcome = await svc.persistEvidenceRows({ runId: run.id, queries: ['q1', 'q2'], results });

    assert.strictEqual(outcome.persisted, 3);
    assert.strictEqual(db.inserted.citation_evidence.length, 3);

    // openai → chatgpt
    const chatgptRows = db.inserted.citation_evidence.filter((e) => e.engine === 'chatgpt');
    assert.strictEqual(chatgptRows.length, 2);

    // anthropic → claude
    const claudeRows = db.inserted.citation_evidence.filter((e) => e.engine === 'claude');
    assert.strictEqual(claudeRows.length, 1);

    // perplexity (tested=false) → no rows
    const perplexityRows = db.inserted.citation_evidence.filter((e) => e.engine === 'perplexity');
    assert.strictEqual(perplexityRows.length, 0);

    // cited row has citation_type 'cited'; snippet preserved
    const citedRow = chatgptRows.find((e) => e.cited);
    assert.strictEqual(citedRow.citation_type, 'cited');
    assert.strictEqual(citedRow.response_snippet, 'excerpt');
    assert.strictEqual(citedRow.domain_mentioned, true);

    // not-cited, not-mentioned row has citation_type 'absent'
    const absentRow = chatgptRows.find((e) => !e.cited);
    assert.strictEqual(absentRow.citation_type, 'absent');
  });

  it('getEvidence translates DB column names to API field names', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });

    const run = await svc.createRun({ userId: 42, runType: 'scan_time', client: db });
    const results = {
      assistants: {
        openai: { tested: true, queries: [{ query: 'q1', mentioned: true, cited: true, snippet: 'text' }] },
      },
    };
    await svc.persistEvidenceRows({ runId: run.id, queries: ['q1'], results });

    const evidence = await svc.getEvidence({ runId: run.id });
    assert.strictEqual(evidence.length, 1);

    const ev = evidence[0];
    assert.strictEqual(ev.engine, 'chatgpt');
    assert.strictEqual(ev.prompt_text, 'q1');
    assert.strictEqual(ev.mentioned, true);
    assert.strictEqual(ev.snippet, 'text');
    assert.strictEqual(ev.cited, true);
    assert.strictEqual(ev.detection_status, 'cited');
  });

  it('getEvidence derives detection_status: mentioned-only → "mentioned"', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });

    const run = await svc.createRun({ userId: 42, runType: 'scan_time', client: db });
    const results = {
      assistants: {
        openai: { tested: true, queries: [{ query: 'q1', mentioned: true, cited: false, snippet: null }] },
      },
    };
    await svc.persistEvidenceRows({ runId: run.id, queries: ['q1'], results });

    const evidence = await svc.getEvidence({ runId: run.id });
    assert.strictEqual(evidence[0].detection_status, 'mentioned');
  });

  it('getEvidence derives detection_status: not found → "not_found"', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });

    const run = await svc.createRun({ userId: 42, runType: 'scan_time', client: db });
    const results = {
      assistants: {
        openai: { tested: true, queries: [{ query: 'q1', mentioned: false, cited: false, snippet: null }] },
      },
    };
    await svc.persistEvidenceRows({ runId: run.id, queries: ['q1'], results });

    const evidence = await svc.getEvidence({ runId: run.id });
    assert.strictEqual(evidence[0].detection_status, 'not_found');
  });

  it('computeAndStoreBenchmark is a stub returning null', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });
    const result = await svc.computeAndStoreBenchmark({ clusterId: 1 });
    assert.strictEqual(result, null);
  });

  it('getBenchmark is a stub returning null', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });
    const result = await svc.getBenchmark({ clusterId: 1 });
    assert.strictEqual(result, null);
  });
});

// ----------- route tests ----------
// Patch Module.prototype.require before the route is loaded so it captures our stubs.
const Module = require('module');

const _authStub = {
  authenticateToken: (req, _res, next) => {
    req.user = { id: 42, organization_id: null };
    next();
  },
  authenticateTokenOptional: (_req, _res, next) => next(),
};

const _origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../middleware/auth' || id.endsWith('/middleware/auth')) {
    return _authStub;
  }
  return _origRequire.apply(this, arguments);
};
const _citationRouter = require('../../routes/citation-monitoring');
Module.prototype.require = _origRequire;

describe('POST /api/prompt-clusters', () => {
  const supertest = require('supertest');
  const express = require('express');

  function buildApp() {
    const app = express();
    app.use(express.json());
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });
    const router = _citationRouter.buildRouter({ service: svc });
    app.use('/api', router);
    return app;
  }

  it('returns 201 with the created cluster', async () => {
    const res = await supertest(buildApp())
      .post('/api/prompt-clusters')
      .send({ name: 'Vendor selection', canonicalPrompt: 'Best vendors?' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.name, 'Vendor selection');
    assert.strictEqual(res.body.data.canonical_prompt, 'Best vendors?');
  });

  it('returns 400 when name or canonicalPrompt is missing', async () => {
    const res = await supertest(buildApp())
      .post('/api/prompt-clusters')
      .send({ name: 'Only name' });
    assert.strictEqual(res.status, 400);
  });
});

describe('GET /api/benchmark-stats', () => {
  const supertest = require('supertest');
  const express = require('express');

  it('returns { success: true, data: null }', async () => {
    const app = express();
    app.use(express.json());
    const svc = createCitationMonitoringService({ db: makeFakeDb() });
    app.use('/api', _citationRouter.buildRouter({ service: svc }));

    const res = await supertest(app).get('/api/benchmark-stats');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data, null);
  });
});
