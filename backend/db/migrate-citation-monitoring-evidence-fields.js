// backend/db/migrate-citation-monitoring-evidence-fields.js
// SSOT v4.0 — Adds new fields required by the evidence and run schemas.
//
// Alters two existing Phase 3 tables (idempotent):
//   citation_evidence     — snippet, detector_reasoning
//   citation_test_runs    — token_cost, triggered_by_user
//                        — replaces run_type CHECK constraint
//
// Run with:
//   node backend/db/migrate-citation-monitoring-evidence-fields.js

const STATEMENTS = [
  // citation_evidence — new QA / snippet fields
  `ALTER TABLE citation_evidence
     ADD COLUMN IF NOT EXISTS snippet TEXT`,
  `ALTER TABLE citation_evidence
     ADD COLUMN IF NOT EXISTS detector_reasoning TEXT`,

  // citation_test_runs — billing and trigger-origin fields
  `ALTER TABLE citation_test_runs
     ADD COLUMN IF NOT EXISTS token_cost INTEGER`,
  `ALTER TABLE citation_test_runs
     ADD COLUMN IF NOT EXISTS triggered_by_user BOOLEAN DEFAULT TRUE`,
];

async function migrate() {
  require('dotenv').config();
  const db = require('./database');

  let client;
  try {
    client = await db.getClient();
    console.log('🔄 Citation-monitoring evidence-fields migration starting...');
    await client.query('BEGIN');

    for (const sql of STATEMENTS) {
      await client.query(sql);
    }

    // --- run_type CHECK constraint replacement ---
    // Inspect pg_constraint for any existing CHECK constraint that references
    // run_type on citation_test_runs rather than assuming the constraint name.
    const { rows: constraints } = await client.query(`
      SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
       WHERE t.relname   = 'citation_test_runs'
         AND c.contype   = 'c'
         AND pg_get_constraintdef(c.oid) LIKE '%run_type%'
    `);

    if (constraints.length > 0) {
      for (const { conname } of constraints) {
        console.log(`  Dropping existing run_type constraint: ${conname}`);
        await client.query(
          `ALTER TABLE citation_test_runs DROP CONSTRAINT "${conname}"`
        );
      }
    } else {
      console.log('  No existing run_type constraint found — skipping drop.');
    }

    // Only add the new constraint if the run_type column exists; if a
    // previous migration never created it there is nothing to constrain.
    const { rows: cols } = await client.query(`
      SELECT 1
        FROM information_schema.columns
       WHERE table_name  = 'citation_test_runs'
         AND column_name = 'run_type'
    `);

    if (cols.length > 0) {
      console.log("  Adding run_type constraint: ('manual', 'scan_teaser')");
      await client.query(`
        ALTER TABLE citation_test_runs
          ADD CONSTRAINT citation_test_runs_run_type_check
          CHECK (run_type IN ('manual', 'scan_teaser'))
      `);
    } else {
      console.log('  run_type column not present — skipping constraint add.');
    }

    await client.query('COMMIT');
    console.log('✅ Citation-monitoring evidence-fields migration complete.');
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
