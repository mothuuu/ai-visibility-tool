// backend/db/migrate-citation-monitoring-detection-status.js
// Adds detection_status to citation_evidence (idempotent).
//
// Alters one existing table:
//   citation_evidence  — detection_status TEXT NOT NULL DEFAULT 'skipped'
//                        CHECK (detection_status IN ('detected','failed','skipped'))
//
// Run with:
//   node backend/db/migrate-citation-monitoring-detection-status.js

const STATEMENTS = [
  `ALTER TABLE citation_evidence
     ADD COLUMN IF NOT EXISTS detection_status TEXT NOT NULL DEFAULT 'skipped'`,
];

async function migrate() {
  require('dotenv').config();
  const db = require('./database');

  let client;
  try {
    client = await db.getClient();
    console.log('🔄 Citation-monitoring detection-status migration starting...');
    await client.query('BEGIN');

    for (const sql of STATEMENTS) {
      await client.query(sql);
    }

    // --- detection_status CHECK constraint ---
    // Inspect pg_constraint for any existing CHECK constraint that references
    // detection_status on citation_evidence rather than assuming a name.
    const { rows: constraints } = await client.query(`
      SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
       WHERE t.relname   = 'citation_evidence'
         AND c.contype   = 'c'
         AND pg_get_constraintdef(c.oid) LIKE '%detection_status%'
    `);

    if (constraints.length > 0) {
      console.log(
        `  detection_status CHECK constraint already exists (${constraints[0].conname}) — skipping add.`
      );
    } else {
      console.log(
        "  Adding detection_status CHECK constraint: ('detected','failed','skipped')"
      );
      await client.query(`
        ALTER TABLE citation_evidence
          ADD CONSTRAINT citation_evidence_detection_status_check
          CHECK (detection_status IN ('detected', 'failed', 'skipped'))
      `);
    }

    await client.query('COMMIT');
    console.log('✅ Citation-monitoring detection-status migration complete.');
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
