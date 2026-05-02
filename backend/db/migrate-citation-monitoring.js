// backend/db/migrate-citation-monitoring.js
// Phase 3 — Citation Monitoring persistence backbone.
//
// Creates four tables (idempotent):
//   prompt_clusters       — prompt + variant definitions per org
//   citation_test_runs    — per-run metadata
//   citation_evidence     — per (run × engine × prompt variant) result
//   benchmark_stats       — rolled-up metrics per cluster × window
//
// This is INTENTIONALLY separate from the directory-submissions
// "AI Citation Network" tables (citation_* under /api/citation-network).
// Do not reuse those.
//
// Run with:
//   node backend/db/migrate-citation-monitoring.js
// Heavy requires (pg, dotenv) are deferred to inside `migrate()` so that
// `require('./migrate-citation-monitoring')` is cheap and dependency-free
// — tests introspect STATEMENTS without needing pg installed.

const STATEMENTS = [
  // ---------- prompt_clusters ----------
  `CREATE TABLE IF NOT EXISTS prompt_clusters (
    id BIGSERIAL PRIMARY KEY,
    org_id INTEGER,
    user_id INTEGER,
    name TEXT NOT NULL,
    canonical_prompt TEXT NOT NULL,
    prompt_variants JSONB NOT NULL DEFAULT '[]'::jsonb,
    industry TEXT,
    persona TEXT,
    funnel_stage TEXT,
    competitor_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_clusters_org
     ON prompt_clusters (org_id, is_archived, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_clusters_user
     ON prompt_clusters (user_id, is_archived, updated_at DESC)`,

  // ---------- citation_test_runs ----------
  `CREATE TABLE IF NOT EXISTS citation_test_runs (
    id BIGSERIAL PRIMARY KEY,
    cluster_id BIGINT NOT NULL
      REFERENCES prompt_clusters (id) ON DELETE CASCADE,
    initiated_by_user_id INTEGER,
    initiated_by_org_id INTEGER,
    engines_tested JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'running'
      CHECK (status IN ('running','completed','failed','partial')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    cost_estimate_cents INTEGER,
    notes TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_citation_test_runs_cluster
     ON citation_test_runs (cluster_id, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_citation_test_runs_status
     ON citation_test_runs (status, started_at DESC)`,

  // ---------- citation_evidence ----------
  `CREATE TABLE IF NOT EXISTS citation_evidence (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL
      REFERENCES citation_test_runs (id) ON DELETE CASCADE,
    cluster_id BIGINT NOT NULL
      REFERENCES prompt_clusters (id) ON DELETE CASCADE,
    engine TEXT NOT NULL,
    model TEXT,
    prompt_text TEXT NOT NULL,
    response_text TEXT,
    citations_raw JSONB NOT NULL DEFAULT '[]'::jsonb,
    citations_normalized JSONB NOT NULL DEFAULT '[]'::jsonb,
    mentioned BOOLEAN NOT NULL DEFAULT FALSE,
    recommended BOOLEAN NOT NULL DEFAULT FALSE,
    cited BOOLEAN NOT NULL DEFAULT FALSE,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_citation_evidence_run
     ON citation_evidence (run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_citation_evidence_cluster_engine_time
     ON citation_evidence (cluster_id, engine, created_at DESC)`,

  // ---------- benchmark_stats ----------
  `CREATE TABLE IF NOT EXISTS benchmark_stats (
    id BIGSERIAL PRIMARY KEY,
    cluster_id BIGINT NOT NULL
      REFERENCES prompt_clusters (id) ON DELETE CASCADE,
    window TEXT NOT NULL,
    sample_size INTEGER NOT NULL DEFAULT 0,
    prompt_volume_index NUMERIC,
    citation_rate NUMERIC,
    citation_sov NUMERIC,
    mention_rate NUMERIC,
    recommendation_rate NUMERIC,
    top_cited_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cluster_id, window)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_benchmark_stats_cluster_window
     ON benchmark_stats (cluster_id, window, updated_at DESC)`,
];

async function migrate() {
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
        ? { rejectUnauthorized: false }
        : false,
  });

  let client;
  try {
    client = await pool.connect();
    console.log('🔄 Phase 3 citation-monitoring migration starting...');
    await client.query('BEGIN');

    for (const sql of STATEMENTS) {
      await client.query(sql);
    }

    await client.query('COMMIT');
    console.log('✅ Phase 3 citation-monitoring migration complete.');
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

// Export the DDL for static introspection in tests, without running it.
module.exports = { STATEMENTS };

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
