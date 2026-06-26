// backend/services/citationMonitoringService.js
// Citation Monitoring persistence service — aligned to 018 prod schema.
//
// Reads/writes: prompt_clusters, citation_test_runs, citation_evidence
// benchmark_stats is not written here (stubs only — no cluster_id FK in 018).
//
// DI-friendly: pass any object that exposes `query(text, params)` (the
// existing `db/database.js` export, a transaction client, or a test fake).
//
// All DB column names are translated to API field names before returning so
// the frontend receives a stable shape regardless of schema evolution.
'use strict';

// Maps engine keys used by ai-testing.js results to 018 CHECK-constraint values.
const ENGINE_MAP = {
  openai: 'chatgpt',
  anthropic: 'claude',
  perplexity: 'perplexity',
  gemini: 'gemini',
};

function defaultDb() {
  return require('../db/database');
}

function asJsonb(value) {
  if (value === undefined || value === null) return '[]';
  return JSON.stringify(value);
}

function createCitationMonitoringService({ db } = {}) {
  const conn = db || defaultDb();

  // -------- prompt_clusters --------

  function translateCluster(row) {
    if (!row) return null;
    const queries = Array.isArray(row.queries) ? row.queries : [];
    return {
      ...row,
      name: row.cluster_name,
      canonical_prompt: queries[0] || null,
      prompt_variants: queries.slice(1),
    };
  }

  // SELECT-then-INSERT/UPDATE because 018 has no UNIQUE constraint on prompt_clusters.
  async function upsertCluster({ userId, clusterName, queries = [], vertical, intentTier, source }) {
    if (!clusterName) throw new Error('clusterName is required');

    const { rows: existing } = await conn.query(
      'SELECT id FROM prompt_clusters WHERE user_id = $1 AND cluster_name = $2',
      [userId, clusterName]
    );

    if (existing[0]) {
      const { rows } = await conn.query(
        `UPDATE prompt_clusters
           SET queries = $1::jsonb, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [asJsonb(queries), existing[0].id]
      );
      return translateCluster(rows[0]);
    }

    const { rows } = await conn.query(
      `INSERT INTO prompt_clusters (user_id, cluster_name, vertical, intent_tier, queries, source)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING *`,
      [userId, clusterName, vertical, intentTier, asJsonb(queries), source]
    );
    return translateCluster(rows[0]);
  }

  async function listClusters({ userId = null, limit = 100 } = {}) {
    const { rows } = await conn.query(
      `SELECT * FROM prompt_clusters
        WHERE active = TRUE
          AND ($1::int IS NULL OR user_id = $1)
        ORDER BY updated_at DESC
        LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 500)]
    );
    return rows.map(translateCluster);
  }

  async function getCluster(id) {
    const { rows } = await conn.query(
      'SELECT * FROM prompt_clusters WHERE id = $1',
      [id]
    );
    return rows[0] ? translateCluster(rows[0]) : null;
  }

  // -------- citation_test_runs --------

  async function createRun({ userId, runType, scanId = null, enginesTested = [], client } = {}) {
    const execConn = client || conn;
    const { rows } = await execConn.query(
      `INSERT INTO citation_test_runs (user_id, run_type, scan_id, engines_tested, status)
       VALUES ($1, $2, $3, $4::text[], 'pending')
       RETURNING *`,
      [userId, runType, scanId, enginesTested]
    );
    return rows[0];
  }

  const VALID_STATUSES = new Set(['pending', 'running', 'completed', 'failed', 'partial']);

  async function updateRunStatus(runId, status) {
    if (runId == null) throw new Error('runId is required');
    if (!VALID_STATUSES.has(status)) throw new Error(`invalid status: ${status}`);
    const setCompleted = status === 'completed' || status === 'failed' || status === 'partial';
    const { rows } = await conn.query(
      `UPDATE citation_test_runs
          SET status = $2${setCompleted ? ', completed_at = NOW()' : ''}
        WHERE id = $1
        RETURNING *`,
      [runId, status]
    );
    return rows[0] || null;
  }

  async function markRunCompleted(runId, { status = 'complete' } = {}) {
    const { rows } = await conn.query(
      `UPDATE citation_test_runs
          SET status = $2, completed_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [runId, status]
    );
    return rows[0] || null;
  }

  async function listRuns({ userId = null, limit = 50 } = {}) {
    const { rows } = await conn.query(
      `SELECT * FROM citation_test_runs
        WHERE ($1::int IS NULL OR user_id = $1)
        ORDER BY created_at DESC
        LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 200)]
    );
    return rows;
  }

  // -------- citation_evidence --------

  // Derives citation_type from result flags.
  // 018 citation_type CHECK ('cited', 'recommended', 'compared', 'absent').
  function deriveCitationType(q) {
    if (q.cited) return 'cited';
    if (q.recommended) return 'recommended';
    if (q.mentioned) return 'compared';
    return 'absent';
  }

  async function persistEvidenceRows({ runId, queries, results }) {
    let persisted = 0;
    const assistants = (results && results.assistants) || {};
    for (const [rawEngine, summary] of Object.entries(assistants)) {
      if (!summary || summary.tested === false) continue;
      const engine = ENGINE_MAP[rawEngine] || rawEngine;
      const queryResults = Array.isArray(summary.queries) ? summary.queries : [];
      for (let i = 0; i < queryResults.length; i++) {
        const q = queryResults[i];
        const queryText = q.query || (queries && queries[i]) || '';
        await conn.query(
          `INSERT INTO citation_evidence
             (test_run_id, query_text, engine, cited, citation_type, response_snippet, domain_mentioned)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            runId,
            queryText,
            engine,
            !!q.cited,
            deriveCitationType(q),
            q.snippet || null,
            !!q.mentioned,
          ]
        );
        persisted++;
      }
    }
    return { persisted };
  }

  function translateEvidence(row) {
    return {
      engine: row.engine,
      prompt_text: row.query_text,
      mentioned: row.domain_mentioned,
      snippet: row.response_snippet,
      cited: row.cited,
      detection_status: row.detection_status || 'skipped',
    };
  }

  async function getEvidence({ runId } = {}) {
    if (!runId) throw new Error('runId is required');
    const { rows } = await conn.query(
      `SELECT query_text, engine, cited, citation_type,
              response_snippet, domain_mentioned, detection_status
         FROM citation_evidence
        WHERE test_run_id = $1
        ORDER BY engine, created_at ASC`,
      [runId]
    );
    return rows.map(translateEvidence);
  }

  // -------- benchmark_stats (stub) --------
  // 018 benchmark_stats is vertical-based, not cluster-based.
  // Full computation is out of scope for this checkpoint.
  async function computeAndStoreBenchmark() {
    return null;
  }

  async function getBenchmark() {
    return null;
  }

  return {
    upsertCluster,
    listClusters,
    getCluster,
    createRun,
    updateRunStatus,
    markRunCompleted,
    listRuns,
    persistEvidenceRows,
    getEvidence,
    computeAndStoreBenchmark,
    getBenchmark,
  };
}

module.exports = { createCitationMonitoringService };
