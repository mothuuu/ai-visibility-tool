// backend/db/migrate-citation-monitoring-pending-status.js
// Adds 'pending' to the CHECK constraint on citation_test_runs.status (idempotent).
//
// Alters one existing constraint:
//   citation_test_runs  — status CHECK now includes 'pending'
//
// Run with:
//   node backend/db/migrate-citation-monitoring-pending-status.js

const STATEMENTS = [];

async function migrate() {
  require('dotenv').config();
  const db = require('./database');

  let client;
  try {
    client = await db.getClient();
    console.log('🔄 Citation-monitoring pending-status migration starting...');
    await client.query('BEGIN');

    for (const sql of STATEMENTS) {
      await client.query(sql);
    }

    // --- citation_test_runs status CHECK constraint ---
    // Check whether the constraint already includes 'pending' before touching it.
    const { rows: existing } = await client.query(`
      SELECT c.conname, pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
       WHERE t.relname = 'citation_test_runs'
         AND c.conname = 'citation_test_runs_status_check'
    `);

    if (existing.length > 0 && existing[0].def.includes("'pending'")) {
      console.log(
        "  status CHECK constraint already includes 'pending' — skipping."
      );
    } else {
      if (existing.length > 0) {
        console.log(
          `  Dropping existing status constraint: ${existing[0].conname}`
        );
        await client.query(
          `ALTER TABLE citation_test_runs
             DROP CONSTRAINT citation_test_runs_status_check`
        );
      }
      console.log(
        "  Adding status CHECK constraint: ('pending','running','completed','failed','partial')"
      );
      await client.query(`
        ALTER TABLE citation_test_runs
          ADD CONSTRAINT citation_test_runs_status_check
          CHECK (status IN ('pending', 'running', 'completed', 'failed', 'partial'))
      `);
    }

    await client.query('COMMIT');
    console.log('✅ Citation-monitoring pending-status migration complete.');
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
