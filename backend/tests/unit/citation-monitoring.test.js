// backend/tests/unit/citation-monitoring.test.js
//
// Phase 3 — Citation Monitoring persistence backbone.
//
// What this verifies (no real Postgres, no real network):
//   1. The migration script defines all four Phase 3 tables and their
//      indexes (static SQL introspection).
//   2. citationMonitoringService persists clusters, runs, evidence, and
//      a benchmark rollup against a fake DB that records every query.
//   3. The /api/test-ai-visibility persistence flow wires those service
//      calls together and produces the expected row shape — exercised
//      via the route's exported `_internals.persistCitationRun` with an
//      injected fake service.
//
// Run with: node --test backend/tests/unit/citation-monitoring.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  STATEMENTS,
} = require('../../db/migrate-citation-monitoring');
const {
  createCitationMonitoringService,
} = require('../../services/citationMonitoringService');

// ----------- fake DB ----------
function makeFakeDb() {
  // Records every query for assertions; returns canned rows based on SQL prefix.
  const inserted = {
    prompt_clusters: [],
    citation_test_runs: [],
    citation_evidence: [],
    benchmark_stats: [],
  };
  let id = 1;
  const calls = [];

  const query = async (sql, params) => {
    calls.push({ sql: sql.trim().split('\n')[0], params });
    const trimmed = sql.trim();

    if (/^INSERT INTO prompt_clusters/i.test(trimmed)) {
      const row = {
        id: id++,
        org_id: params[0],
        user_id: params[1],
        name: params[2],
        canonical_prompt: params[3],
        prompt_variants: JSON.parse(params[4]),
        industry: params[5],
        persona: params[6],
        funnel_stage: params[7],
        competitor_domains: JSON.parse(params[8]),
        is_archived: false,
        created_at: new Date(),
        updated_at: new Date(),
      };
      inserted.prompt_clusters.push(row);
      return { rows: [row] };
    }

    if (/^SELECT \* FROM prompt_clusters WHERE id/i.test(trimmed)) {
      const row = inserted.prompt_clusters.find((r) => r.id === params[0]);
      return { rows: row ? [row] : [] };
    }

    if (/^INSERT INTO citation_test_runs/i.test(trimmed)) {
      const row = {
        id: id++,
        cluster_id: params[0],
        initiated_by_user_id: params[1],
        initiated_by_org_id: params[2],
        engines_tested: JSON.parse(params[3]),
        status: 'running',
        started_at: new Date(),
        completed_at: null,
        cost_estimate_cents: params[4],
        notes: params[5],
      };
      inserted.citation_test_runs.push(row);
      return { rows: [row] };
    }

    if (/^UPDATE citation_test_runs/i.test(trimmed)) {
      const row = inserted.citation_test_runs.find((r) => r.id === params[0]);
      if (row) {
        row.status = params[1];
        row.completed_at = new Date();
      }
      return { rows: row ? [row] : [] };
    }

    if (/^INSERT INTO citation_evidence/i.test(trimmed)) {
      const row = {
        id: id++,
        run_id: params[0],
        cluster_id: params[1],
        engine: params[2],
        model: params[3],
        prompt_text: params[4],
        response_text: params[5],
        citations_raw: JSON.parse(params[6]),
        citations_normalized: JSON.parse(params[7]),
        mentioned: params[8],
        recommended: params[9],
        cited: params[10],
        error: params[11],
        created_at: new Date(),
      };
      inserted.citation_evidence.push(row);
      return { rows: [row] };
    }

    if (/^SELECT mentioned, recommended, cited/i.test(trimmed)) {
      const clusterId = params[0];
      const rows = inserted.citation_evidence
        .filter((e) => e.cluster_id === clusterId)
        .map((e) => ({
          mentioned: e.mentioned,
          recommended: e.recommended,
          cited: e.cited,
          citations_normalized: e.citations_normalized,
        }));
      return { rows };
    }

    if (/^INSERT INTO benchmark_stats/i.test(trimmed)) {
      const row = {
        id: id++,
        cluster_id: params[0],
        window: params[1],
        sample_size: params[2],
        citation_rate: params[3],
        citation_sov: params[4],
        mention_rate: params[5],
        recommendation_rate: params[6],
        top_cited_domains: JSON.parse(params[7]),
        updated_at: new Date(),
      };
      // Replace existing row for the same (cluster_id, window).
      inserted.benchmark_stats = inserted.benchmark_stats.filter(
        (b) => !(b.cluster_id === row.cluster_id && b.window === row.window)
      );
      inserted.benchmark_stats.push(row);
      return { rows: [row] };
    }

    if (/^SELECT \* FROM benchmark_stats/i.test(trimmed)) {
      const row = inserted.benchmark_stats.find(
        (b) => b.cluster_id === params[0] && b.window === params[1]
      );
      return { rows: row ? [row] : [] };
    }

    if (/^SELECT \*\s+FROM citation_test_runs/i.test(trimmed)) {
      const rows = inserted.citation_test_runs
        .filter((r) => r.cluster_id === params[0])
        .sort((a, b) => b.started_at - a.started_at);
      return { rows };
    }

    if (/^SELECT \*\s+FROM prompt_clusters/i.test(trimmed)) {
      return {
        rows: inserted.prompt_clusters.filter((c) => !c.is_archived),
      };
    }

    throw new Error(`Unhandled SQL in fake db: ${trimmed.slice(0, 80)}`);
  };

  return { query, inserted, calls };
}

// ----------- migration static check ----------
describe('phase 3 migration DDL', () => {
  it('defines the four citation-monitoring tables', () => {
    const joined = STATEMENTS.join('\n').toLowerCase();
    for (const table of [
      'prompt_clusters',
      'citation_test_runs',
      'citation_evidence',
      'benchmark_stats',
    ]) {
      assert.match(
        joined,
        new RegExp(`create table if not exists ${table}\\b`),
        `expected CREATE TABLE for ${table}`
      );
    }
  });

  it('declares foreign keys back to prompt_clusters', () => {
    const joined = STATEMENTS.join('\n');
    // Three child tables reference prompt_clusters(id) ON DELETE CASCADE.
    const fkCount = (
      joined.match(/REFERENCES prompt_clusters \(id\) ON DELETE CASCADE/g) || []
    ).length;
    assert.strictEqual(fkCount, 3, 'expected 3 FKs into prompt_clusters');
  });

  it('declares the indexes the read paths rely on', () => {
    const joined = STATEMENTS.join('\n').toLowerCase();
    for (const idx of [
      'idx_citation_test_runs_cluster',
      'idx_citation_evidence_run',
      'idx_citation_evidence_cluster_engine_time',
      'idx_benchmark_stats_cluster_window',
    ]) {
      assert.match(
        joined,
        new RegExp(idx),
        `expected index ${idx}`
      );
    }
  });

  it('enforces uniqueness of (cluster_id, window) on benchmark_stats', () => {
    const joined = STATEMENTS.join('\n').toLowerCase();
    assert.match(joined, /unique \(cluster_id, window\)/);
  });
});

// ----------- service flow ----------
describe('citationMonitoringService end-to-end', () => {
  it('persists cluster → run → evidence → benchmark and rolls up correctly', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });

    const cluster = await svc.upsertCluster({
      orgId: 7,
      userId: 42,
      name: 'B2B procurement: vendor selection',
      canonicalPrompt: 'Best vendors for procurement automation?',
      promptVariants: [
        'Top procurement automation vendors',
        'Who leads procurement automation in 2025?',
      ],
      industry: 'B2B SaaS',
      competitorDomains: ['acme.com', 'globex.com'],
    });
    assert.strictEqual(typeof cluster.id, 'number');

    const run = await svc.createRun({
      clusterId: cluster.id,
      initiatedByUserId: 42,
      enginesTested: ['openai', 'perplexity'],
      notes: 'target=example.com',
    });
    assert.strictEqual(run.status, 'running');
    assert.strictEqual(run.cluster_id, cluster.id);

    const evidence = await svc.recordEvidenceBatch([
      {
        runId: run.id,
        clusterId: cluster.id,
        engine: 'openai',
        promptText: 'Top procurement automation vendors',
        citationsNormalized: [{ url: 'https://example.com/post' }],
        mentioned: true,
        recommended: true,
        cited: true,
      },
      {
        runId: run.id,
        clusterId: cluster.id,
        engine: 'openai',
        promptText: 'Who leads procurement automation in 2025?',
        citationsNormalized: [{ url: 'https://acme.com/blog' }],
        mentioned: false,
        recommended: false,
        cited: true,
      },
      {
        runId: run.id,
        clusterId: cluster.id,
        engine: 'perplexity',
        promptText: 'Top procurement automation vendors',
        citationsNormalized: [
          { url: 'https://example.com/post' },
          { url: 'https://www.example.com/another' },
        ],
        mentioned: true,
        recommended: false,
        cited: true,
      },
      {
        runId: run.id,
        clusterId: cluster.id,
        engine: 'perplexity',
        promptText: 'Who leads procurement automation in 2025?',
        citationsNormalized: [],
        mentioned: false,
        recommended: false,
        cited: false,
      },
    ]);
    assert.strictEqual(evidence.length, 4);

    await svc.markRunCompleted(run.id);
    assert.strictEqual(
      db.inserted.citation_test_runs[0].status,
      'completed'
    );

    const bench = await svc.computeAndStoreBenchmark({
      clusterId: cluster.id,
      window: '30d',
    });
    assert.strictEqual(bench.sample_size, 4);
    // 3/4 evidence rows had cited=true.
    assert.strictEqual(Number(bench.citation_rate), 0.75);
    // Top-cited domain should be example.com (3 citations, beats acme.com).
    const top = bench.top_cited_domains[0];
    assert.strictEqual(top.domain, 'example.com');
    assert.strictEqual(top.count, 3);
    assert.ok(Math.abs(top.share - 0.75) < 1e-9);

    // Mention rate (2/4) and recommendation rate (1/4).
    assert.strictEqual(Number(bench.mention_rate), 0.5);
    assert.strictEqual(Number(bench.recommendation_rate), 0.25);

    // Re-running rolls up over the same window in place.
    const bench2 = await svc.computeAndStoreBenchmark({
      clusterId: cluster.id,
      window: '30d',
    });
    assert.strictEqual(db.inserted.benchmark_stats.length, 1);
    assert.strictEqual(bench2.sample_size, 4);
  });

  it('rejects unsupported windows', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });
    await assert.rejects(
      () => svc.computeAndStoreBenchmark({ clusterId: 1, window: '1y' }),
      /unsupported window/
    );
  });
});

// ----------- route persistence wire-up ----------
describe('/api/test-ai-visibility persistence wire-up', () => {
  it('creates a run, evidence rows, and a benchmark from engine results', async () => {
    // Seed a cluster in a fake db, then exercise the route's exported
    // persistCitationRun with a real service bound to the same db.
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });
    const cluster = await svc.upsertCluster({
      name: 'test',
      canonicalPrompt: 'test prompt',
    });

    const {
      persistCitationRun,
    } = require('../../services/citationMonitoringService');
    assert.ok(persistCitationRun, 'persistCitationRun must be exported');

    const fakeEngineResults = {
      overall: { mentionRate: 50, recommendationRate: 25, citationRate: 50 },
      assistants: {
        openai: {
          name: 'openai',
          tested: true,
          metrics: { mentionRate: 50, recommendationRate: 25, citationRate: 50 },
          queries: [
            {
              query: 'q1',
              mentioned: true,
              recommended: true,
              cited: true,
              citationsNormalized: [{ url: 'https://example.com/a' }],
            },
            {
              query: 'q2',
              mentioned: false,
              recommended: false,
              cited: false,
            },
          ],
        },
        perplexity: {
          name: 'perplexity',
          tested: false,
          reason: 'API key not configured',
        },
      },
      testedQueries: 2,
    };

    const result = await persistCitationRun({
      clusterId: cluster.id,
      url: 'https://example.com/landing',
      queries: ['q1', 'q2'],
      results: fakeEngineResults,
      initiatedByUserId: 42,
      service: svc,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(typeof result.runId, 'number');
    // 2 evidence rows for openai; perplexity skipped (tested=false).
    assert.strictEqual(result.evidenceCount, 2);
    assert.strictEqual(db.inserted.citation_evidence.length, 2);
    assert.strictEqual(db.inserted.citation_test_runs[0].status, 'completed');
    assert.strictEqual(db.inserted.benchmark_stats.length, 1);

    const bench = db.inserted.benchmark_stats[0];
    assert.strictEqual(bench.sample_size, 2);
    assert.strictEqual(Number(bench.citation_rate), 0.5);
    assert.strictEqual(bench.top_cited_domains[0].domain, 'example.com');
  });

  it('returns persistence_failed gracefully when the cluster does not exist', async () => {
    const db = makeFakeDb();
    const svc = createCitationMonitoringService({ db });

    const {
      persistCitationRun,
    } = require('../../services/citationMonitoringService');
    const result = await persistCitationRun({
      clusterId: 9999,
      url: 'https://example.com/',
      queries: ['q'],
      results: { assistants: {} },
      service: svc,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'cluster_not_found');
    assert.strictEqual(db.inserted.citation_test_runs.length, 0);
    assert.strictEqual(db.inserted.citation_evidence.length, 0);
  });
});
