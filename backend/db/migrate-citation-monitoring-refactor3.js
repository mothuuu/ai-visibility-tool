// backend/db/migrate-citation-monitoring-refactor3.js
// CM-Refactor-3 — Fixes the citation_test_runs.run_type CHECK constraint.
//
// Background:
//   018_citation_monitoring_benchmarks.sql created:
//     CHECK (run_type IN ('scan_time', 'scheduled'))
//   migrate-citation-monitoring-evidence-fields.js replaced it with:
//     CHECK (run_type IN ('manual', 'scan_teaser'))          ← drops scan_time/scheduled
//
//   This migration replaces whatever constraint exists with the full set:
//     CHECK (run_type IN ('scan_time', 'scheduled', 'manual', 'scan_teaser'))
//
// Idempotent: safe to run twice. The DROP is dynamic (finds existing constraint
// by column reference), so re-running drops the constraint we added and re-adds it.
//
// Run with:
//   node backend/db/migrate-citation-monitoring-refactor3.js

// STATEMENTS covers only static, context-free DDL; the constraint replacement
// requires sequential conditional queries and is handled inside migrate() below.
const STATEMENTS = [];

async function migrate() {
  require('dotenv').config();
  const db = require('./database');

  let client;
  try {
    client = await db.getClient();
    console.log('🔄 CM-Refactor-3: run_type constraint fix starting...');
    await client.query('BEGIN');

    // Step 1 — discover any existing CHECK constraint that references run_type
    // on citation_test_runs.  We look up by column reference rather than
    // assuming a constraint name, so this handles whatever state the DB is in.
    const { rows: existing } = await client.query(`
      SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class     t ON c.conrelid = t.oid
       WHERE t.relname = 'citation_test_runs'
         AND c.contype = 'c'
         AND pg_get_constraintdef(c.oid) LIKE '%run_type%'
    `);

    if (existing.length > 0) {
      for (const { conname } of existing) {
        console.log(`  Dropping existing run_type constraint: "${conname}"`);
        await client.query(
          `ALTER TABLE citation_test_runs DROP CONSTRAINT "${conname}"`
        );
      }
    } else {
      console.log('  No existing run_type constraint found — nothing to drop.');
    }

    // Step 2 — verify the column exists before adding the new constraint
    const { rows: cols } = await client.query(`
      SELECT 1
        FROM information_schema.columns
       WHERE table_name  = 'citation_test_runs'
         AND column_name = 'run_type'
    `);

    if (cols.length === 0) {
      console.log('  run_type column not present — skipping constraint add.');
    } else {
      console.log(
        "  Adding run_type constraint: ('scan_time', 'scheduled', 'manual', 'scan_teaser')"
      );
      await client.query(`
        ALTER TABLE citation_test_runs
          ADD CONSTRAINT citation_test_runs_run_type_check
          CHECK (run_type IN ('scan_time', 'scheduled', 'manual', 'scan_teaser'))
      `);
    }

    await client.query('COMMIT');
    console.log('✅ CM-Refactor-3: run_type constraint fix complete.');
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

module.exports = { STATEMENTS };

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
