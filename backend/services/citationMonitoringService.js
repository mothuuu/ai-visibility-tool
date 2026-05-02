// backend/services/citationMonitoringService.js
// Phase 3 — Citation Monitoring persistence service.
//
// Reads/writes:
//   prompt_clusters, citation_test_runs, citation_evidence, benchmark_stats
//
// DI-friendly: pass any object that exposes `query(text, params)` (the
// existing `db/database.js` export, a transaction client, or a test fake).
//
// NOTE: this service is intentionally separate from the directory
// submissions / "AI Citation Network" feature. Do not reuse those tables.
'use strict';

const ALLOWED_WINDOWS = new Set(['7d', '14d', '30d', '90d']);
const WINDOW_TO_INTERVAL = {
  '7d': '7 days',
  '14d': '14 days',
  '30d': '30 days',
  '90d': '90 days',
};

function defaultDb() {
  // Lazy require so unit tests can avoid requiring pg.
  return require('../db/database');
}

function asJsonb(value, fallback = '[]') {
  if (value === undefined || value === null) return fallback;
  return JSON.stringify(value);
}

function extractDomain(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const u = new URL(rawUrl);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    // Allow bare domain strings from upstream parsers.
    const trimmed = rawUrl.trim().toLowerCase();
    return trimmed && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)
      ? trimmed.replace(/^www\./, '')
      : null;
  }
}

function createCitationMonitoringService({ db } = {}) {
  const conn = db || defaultDb();

  // -------- prompt_clusters --------
  async function upsertCluster({
    id,
    orgId = null,
    userId = null,
    name,
    canonicalPrompt,
    promptVariants = [],
    industry = null,
    persona = null,
    funnelStage = null,
    competitorDomains = [],
  }) {
    if (!name || !canonicalPrompt) {
      throw new Error('name and canonicalPrompt are required');
    }

    if (id) {
      const { rows } = await conn.query(
        `UPDATE prompt_clusters
           SET name = $2,
               canonical_prompt = $3,
               prompt_variants = $4::jsonb,
               industry = $5,
               persona = $6,
               funnel_stage = $7,
               competitor_domains = $8::jsonb,
               updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          name,
          canonicalPrompt,
          asJsonb(promptVariants),
          industry,
          persona,
          funnelStage,
          asJsonb(competitorDomains),
        ]
      );
      if (!rows[0]) throw new Error(`prompt_cluster ${id} not found`);
      return rows[0];
    }

    const { rows } = await conn.query(
      `INSERT INTO prompt_clusters
         (org_id, user_id, name, canonical_prompt, prompt_variants,
          industry, persona, funnel_stage, competitor_domains)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb)
       RETURNING *`,
      [
        orgId,
        userId,
        name,
        canonicalPrompt,
        asJsonb(promptVariants),
        industry,
        persona,
        funnelStage,
        asJsonb(competitorDomains),
      ]
    );
    return rows[0];
  }

  async function listClusters({ orgId = null, userId = null, limit = 100 } = {}) {
    const { rows } = await conn.query(
      `SELECT *
         FROM prompt_clusters
        WHERE is_archived = FALSE
          AND ($1::int IS NULL OR org_id = $1)
          AND ($2::int IS NULL OR user_id = $2)
        ORDER BY updated_at DESC
        LIMIT $3`,
      [orgId, userId, Math.min(Math.max(limit, 1), 500)]
    );
    return rows;
  }

  async function getCluster(id) {
    const { rows } = await conn.query(
      'SELECT * FROM prompt_clusters WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  }

  // -------- citation_test_runs --------
  async function createRun({
    clusterId,
    initiatedByUserId = null,
    initiatedByOrgId = null,
    enginesTested = [],
    costEstimateCents = null,
    notes = null,
  }) {
    if (!clusterId) throw new Error('clusterId is required');
    const { rows } = await conn.query(
      `INSERT INTO citation_test_runs
         (cluster_id, initiated_by_user_id, initiated_by_org_id,
          engines_tested, status, cost_estimate_cents, notes)
       VALUES ($1, $2, $3, $4::jsonb, 'running', $5, $6)
       RETURNING *`,
      [
        clusterId,
        initiatedByUserId,
        initiatedByOrgId,
        asJsonb(enginesTested),
        costEstimateCents,
        notes,
      ]
    );
    return rows[0];
  }

  async function markRunCompleted(runId, { status = 'completed' } = {}) {
    const { rows } = await conn.query(
      `UPDATE citation_test_runs
          SET status = $2, completed_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [runId, status]
    );
    return rows[0] || null;
  }

  async function listRuns({ clusterId, limit = 50 } = {}) {
    if (!clusterId) throw new Error('clusterId is required');
    const { rows } = await conn.query(
      `SELECT *
         FROM citation_test_runs
        WHERE cluster_id = $1
        ORDER BY started_at DESC
        LIMIT $2`,
      [clusterId, Math.min(Math.max(limit, 1), 200)]
    );
    return rows;
  }

  // -------- citation_evidence --------
  async function recordEvidenceBatch(rows = []) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const inserted = [];
    // Per-row insert keeps the SQL small and lets one bad row fail in
    // isolation. Volume per run is bounded (engines × prompts).
    for (const r of rows) {
      const {
        runId,
        clusterId,
        engine,
        model = null,
        promptText,
        responseText = null,
        citationsRaw = [],
        citationsNormalized = [],
        mentioned = false,
        recommended = false,
        cited = false,
        error = null,
      } = r;

      if (!runId || !clusterId || !engine || !promptText) {
        throw new Error(
          'runId, clusterId, engine, promptText are required for evidence'
        );
      }

      const { rows: out } = await conn.query(
        `INSERT INTO citation_evidence
           (run_id, cluster_id, engine, model, prompt_text, response_text,
            citations_raw, citations_normalized,
            mentioned, recommended, cited, error)
         VALUES ($1, $2, $3, $4, $5, $6,
                 $7::jsonb, $8::jsonb,
                 $9, $10, $11, $12)
         RETURNING id, run_id, cluster_id, engine, mentioned, recommended,
                   cited, created_at`,
        [
          runId,
          clusterId,
          engine,
          model,
          promptText,
          responseText,
          asJsonb(citationsRaw),
          asJsonb(citationsNormalized),
          !!mentioned,
          !!recommended,
          !!cited,
          error,
        ]
      );
      inserted.push(out[0]);
    }
    return inserted;
  }

  // -------- benchmark_stats --------
  async function computeAndStoreBenchmark({ clusterId, window = '30d' } = {}) {
    if (!clusterId) throw new Error('clusterId is required');
    if (!ALLOWED_WINDOWS.has(window)) {
      throw new Error(`unsupported window: ${window}`);
    }
    const interval = WINDOW_TO_INTERVAL[window];

    const { rows } = await conn.query(
      `SELECT mentioned, recommended, cited, citations_normalized
         FROM citation_evidence
        WHERE cluster_id = $1
          AND created_at >= NOW() - $2::interval`,
      [clusterId, interval]
    );

    const sampleSize = rows.length;
    let mentions = 0;
    let recs = 0;
    let cites = 0;
    const domainCounts = new Map();

    for (const ev of rows) {
      if (ev.mentioned) mentions += 1;
      if (ev.recommended) recs += 1;
      if (ev.cited) cites += 1;
      const list = Array.isArray(ev.citations_normalized)
        ? ev.citations_normalized
        : [];
      for (const entry of list) {
        const url = typeof entry === 'string' ? entry : entry && entry.url;
        const domain = extractDomain(url);
        if (!domain) continue;
        domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
      }
    }

    const totalCitations = Array.from(domainCounts.values()).reduce(
      (s, n) => s + n,
      0
    );
    const topCitedDomains = Array.from(domainCounts.entries())
      .map(([domain, count]) => ({
        domain,
        count,
        share: totalCitations ? count / totalCitations : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const citationRate = sampleSize ? cites / sampleSize : null;
    const mentionRate = sampleSize ? mentions / sampleSize : null;
    const recommendationRate = sampleSize ? recs / sampleSize : null;
    const citationSov =
      topCitedDomains.length && totalCitations
        ? topCitedDomains[0].share
        : null;

    const { rows: upserted } = await conn.query(
      `INSERT INTO benchmark_stats
         (cluster_id, window, sample_size, citation_rate, citation_sov,
          mention_rate, recommendation_rate, top_cited_domains, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
       ON CONFLICT (cluster_id, window) DO UPDATE
         SET sample_size = EXCLUDED.sample_size,
             citation_rate = EXCLUDED.citation_rate,
             citation_sov = EXCLUDED.citation_sov,
             mention_rate = EXCLUDED.mention_rate,
             recommendation_rate = EXCLUDED.recommendation_rate,
             top_cited_domains = EXCLUDED.top_cited_domains,
             updated_at = NOW()
       RETURNING *`,
      [
        clusterId,
        window,
        sampleSize,
        citationRate,
        citationSov,
        mentionRate,
        recommendationRate,
        asJsonb(topCitedDomains),
      ]
    );
    return upserted[0];
  }

  async function getBenchmark({ clusterId, window = '30d' } = {}) {
    const { rows } = await conn.query(
      `SELECT * FROM benchmark_stats
        WHERE cluster_id = $1 AND window = $2`,
      [clusterId, window]
    );
    return rows[0] || null;
  }

  return {
    // clusters
    upsertCluster,
    listClusters,
    getCluster,
    // runs
    createRun,
    markRunCompleted,
    listRuns,
    // evidence
    recordEvidenceBatch,
    // stats
    computeAndStoreBenchmark,
    getBenchmark,
  };
}

// ---------------- orchestration helpers ----------------
// These wrap the service for the /api/test-ai-visibility persistence flow.
// They live here (rather than in the route) so they can be unit-tested
// without pulling in Express middleware / pg.

function buildEvidenceRows({ runId, clusterId, queries, results }) {
  const rows = [];
  const assistants = (results && results.assistants) || {};
  for (const [engine, summary] of Object.entries(assistants)) {
    if (!summary || summary.tested === false) continue;
    const queryResults = Array.isArray(summary.queries) ? summary.queries : [];
    for (let i = 0; i < queryResults.length; i++) {
      const q = queryResults[i];
      const promptText = q.query || (queries && queries[i]) || '';
      rows.push({
        runId,
        clusterId,
        engine,
        model: summary.model || null,
        promptText,
        // Response text intentionally omitted to keep arbitrary upstream
        // content out of the DB; raw citations are the auditable artifact.
        responseText: null,
        citationsRaw: q.citations || [],
        citationsNormalized: q.citationsNormalized || [],
        mentioned: !!q.mentioned,
        recommended: !!q.recommended,
        cited: !!q.cited,
        error: q.error || null,
      });
    }
  }
  return rows;
}

async function persistCitationRun({
  clusterId,
  url,
  queries,
  results,
  initiatedByUserId = null,
  initiatedByOrgId = null,
  service,
}) {
  const svc = service || createCitationMonitoringService();
  try {
    const cluster = await svc.getCluster(clusterId);
    if (!cluster) return { ok: false, error: 'cluster_not_found' };

    const enginesTested = Object.keys(results.assistants || {});
    let target = null;
    try {
      target = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      /* leave target null */
    }

    const run = await svc.createRun({
      clusterId,
      initiatedByUserId,
      initiatedByOrgId,
      enginesTested,
      notes: target ? `target=${target}` : null,
    });

    const rows = buildEvidenceRows({
      runId: run.id,
      clusterId,
      queries,
      results,
    });
    if (rows.length) await svc.recordEvidenceBatch(rows);

    const allEnginesFailed =
      enginesTested.length > 0 &&
      enginesTested.every(
        (k) =>
          results.assistants[k] && results.assistants[k].tested === false
      );
    await svc.markRunCompleted(run.id, {
      status: allEnginesFailed ? 'failed' : 'completed',
    });

    const benchmark = await svc.computeAndStoreBenchmark({
      clusterId,
      window: '30d',
    });

    return {
      ok: true,
      runId: run.id,
      evidenceCount: rows.length,
      benchmarkUpdatedAt: benchmark && benchmark.updated_at,
    };
  } catch (err) {
    // Don't surface SQL details / payloads to callers.
    // eslint-disable-next-line no-console
    console.error('Citation persistence failed:', err.message);
    return { ok: false, error: 'persistence_failed' };
  }
}

module.exports = {
  createCitationMonitoringService,
  ALLOWED_WINDOWS,
  buildEvidenceRows,
  persistCitationRun,
  // exposed for tests
  _internals: { extractDomain },
};
