// backend/db/migrate-citation-monitoring-backfill.js
// One-time backfill: create prompt_clusters rows for users who confirmed their
// visibility profile before the deeperScan bridge existed.
//
// Uses the 018 schema via triggerDeeperScan, which calls upsertCluster with
// SELECT-then-INSERT/UPDATE (no UNIQUE constraint dependency).
// Safe to re-run: upsertCluster matches on (user_id, cluster_name) and updates
// in-place if found.
//
// Usage:
//   node backend/db/migrate-citation-monitoring-backfill.js            # live
//   node backend/db/migrate-citation-monitoring-backfill.js --dry-run  # read-only preview

require('dotenv').config();
const { Pool } = require('pg');
const { triggerDeeperScan } = require('../services/deeperScanService');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

async function migrate() {
  const isDryRun = process.argv.includes('--dry-run');

  if (isDryRun) {
    console.log('[DRY RUN] Citation monitoring backfill — reads only, no writes will be performed.');
  } else {
    console.log('🔄 Citation monitoring backfill starting...');
  }

  let queryClient;
  try {
    // Single connection for the profile query.
    queryClient = await pool.connect();
    const { rows } = await queryClient.query(`
      SELECT user_id, tracked_prompts
        FROM visibility_profiles
       WHERE profile_completed_at IS NOT NULL
         AND tracked_prompts IS NOT NULL
         AND jsonb_typeof(tracked_prompts) = 'array'
         AND jsonb_array_length(tracked_prompts) > 0
       ORDER BY user_id
    `);
    queryClient.release();
    queryClient = null;

    console.log(`Found ${rows.length} completed profile(s) with non-empty tracked_prompts.`);

    let processed = 0;
    let skipped   = 0;
    let failed    = 0;
    const failures = [];

    for (const row of rows) {
      const { user_id, tracked_prompts } = row;

      // Validate: pg driver parses JSONB into a JS value, but guard the type
      // in case a direct DB write produced something unexpected.
      if (!Array.isArray(tracked_prompts)) {
        failed++;
        const reason = 'tracked_prompts parsed as non-array';
        failures.push({ userId: user_id, reason });
        if (!isDryRun) console.log(`  [FAIL] user_id=${user_id}: ${reason}`);
        continue;
      }

      // Validate individual items have the expected text field.
      const badIdx = tracked_prompts.findIndex(
        (p) => !p || typeof p.text !== 'string'
      );
      if (badIdx !== -1) {
        failed++;
        const reason = `item at index ${badIdx} is missing or has a non-string text field`;
        failures.push({ userId: user_id, reason });
        if (!isDryRun) console.log(`  [FAIL] user_id=${user_id}: ${reason}`);
        continue;
      }

      // Deterministic classification — not inferred from log output.
      const monitored = tracked_prompts.filter((p) => p.is_monitored === true);
      if (monitored.length === 0) {
        skipped++;
        if (!isDryRun) console.log(`  [SKIP] user_id=${user_id}: no monitored prompts`);
        continue;
      }

      if (isDryRun) {
        // Dry run: count what would be processed without touching the DB.
        processed++;
        continue;
      }

      // Live mode: upsert in its own transaction so one bad row cannot abort
      // the whole script.
      let txClient;
      try {
        txClient = await pool.connect();
        await txClient.query('BEGIN');

        await triggerDeeperScan({
          userId: user_id,
          profile: { tracked_prompts, icps: [] },
          plan: 'backfill',
          client: txClient,
        });

        await txClient.query('COMMIT');
        processed++;
        console.log(`  [OK]   user_id=${user_id}: cluster upserted`);
      } catch (err) {
        if (txClient) {
          try { await txClient.query('ROLLBACK'); } catch {}
        }
        failed++;
        failures.push({ userId: user_id, reason: err.message });
        console.log(`  [FAIL] user_id=${user_id}: ${err.message}`);
      } finally {
        if (txClient) txClient.release();
      }
    }

    // Summary.
    const header = isDryRun ? '\n[DRY RUN] Summary:' : '\n--- Backfill summary ---';
    console.log(header);
    console.log(`  Total profiles found: ${rows.length}`);
    console.log(`  Processed:            ${processed}`);
    console.log(`  Skipped:              ${skipped} (zero monitored prompts)`);
    console.log(`  Failed:               ${failed}`);
    if (failures.length > 0) {
      console.log('  Failures:');
      for (const f of failures) {
        console.log(`    user_id=${f.userId}: ${f.reason}`);
      }
    }
  } finally {
    if (queryClient) queryClient.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal:', err.message);
      process.exit(1);
    });
}
