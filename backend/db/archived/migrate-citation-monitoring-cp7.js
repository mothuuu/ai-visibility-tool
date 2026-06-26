// backend/db/migrate-citation-monitoring-cp7.js
// CP7 Step A — Adds Phase 3 idempotency infrastructure and personal_orgs.
//
// Creates one new table and alters three existing tables (idempotent):
//   personal_orgs       — one-to-one convenience org per user (Phase 3)
//   citation_test_runs  — idempotency_key column + unique partial index
//   citation_evidence   — idempotency_key column + unique partial index
//   prompt_clusters     — UNIQUE (org_id, name) constraint
//
// Run with:
//   node backend/db/migrate-citation-monitoring-cp7.js

const STATEMENTS = [
  // --- personal_orgs ---
  // Personal orgs are a Phase 3 convenience entity — each user gets one on
  // first cluster creation. Intentionally reconcilable with real orgs in
  // the Phase 6 migration.
  `CREATE TABLE IF NOT EXISTS personal_orgs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // --- citation_test_runs: idempotency key ---
  `ALTER TABLE citation_test_runs
     ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_citation_test_runs_idempotency
     ON citation_test_runs (idempotency_key)
     WHERE idempotency_key IS NOT NULL`,

  // --- citation_evidence: idempotency key ---
  // Canonical key value: {run_id}:{engine}:{sha256(prompt_text)} — computed
  // by the application layer, not the DB.
  `ALTER TABLE citation_evidence
     ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_citation_evidence_idempotency
     ON citation_evidence (idempotency_key)
     WHERE idempotency_key IS NOT NULL`,
];

async function migrate() {
  require('dotenv').config();
  const db = require('./database');

  let client;
  try {
    client = await db.getClient();
    console.log('🔄 Citation-monitoring CP7 migration starting...');
    await client.query('BEGIN');

    for (const sql of STATEMENTS) {
      await client.query(sql);
    }

    // --- UNIQUE (org_id, name) constraint on prompt_clusters ---
    // Inspect pg_constraint rather than assuming the constraint name.
    const { rows: constraints } = await client.query(`
      SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
       WHERE t.relname  = 'prompt_clusters'
         AND c.contype  = 'u'
         AND pg_get_constraintdef(c.oid) LIKE '%org_id%'
    `);

    if (constraints.length > 0) {
      console.log(
        `  UNIQUE (org_id, name) constraint already exists (${constraints[0].conname}) — skipping add.`
      );
    } else {
      console.log('  Adding UNIQUE (org_id, name) constraint to prompt_clusters.');
      await client.query(`
        ALTER TABLE prompt_clusters
          ADD CONSTRAINT prompt_clusters_org_name_unique UNIQUE (org_id, name)
      `);
    }

    await client.query('COMMIT');
    console.log('✅ Citation-monitoring CP7 migration complete.');
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    if (client) client.release();
  }
}

// Export the DDL for static introspection in tests, without running it.
module.exports = { STATEMENTS };

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
