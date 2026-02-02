/**
 * One-time backfill: regenerate recommendations for scans 701–709
 *
 * These scans may have 0 rows in scan_recommendations if
 * generateAndPersistRecommendations() was broken during the window
 * when the recommendation-orchestrator had a SyntaxError.
 *
 * IDEMPOTENT: skips any scan that already has recommendation rows.
 * SEQUENTIAL: processes one scan at a time to avoid load spikes.
 *
 * Usage:
 *   node backend/scripts/backfill-recs-701-709.js
 *
 * Pre-flight check (run first to see which scans are affected):
 *   node backend/scripts/backfill-recs-701-709.js --dry-run
 */

const db = require('../db/database');
const { generateAndPersistRecommendations } = require('../services/recommendation-orchestrator');

const AFFECTED_SCAN_IDS = [701, 702, 703, 704, 705, 706, 707, 708, 709];
const DRY_RUN = process.argv.includes('--dry-run');

async function hasRecs(scanId) {
  const r = await db.query(
    'SELECT COUNT(*)::int AS c FROM scan_recommendations WHERE scan_id = $1',
    [scanId]
  );
  return r.rows[0]?.c > 0;
}

async function backfill() {
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Backfilling recommendations for ${AFFECTED_SCAN_IDS.length} scans...`);

  let skipped = 0;
  let generated = 0;
  let failed = 0;

  for (const scanId of AFFECTED_SCAN_IDS) {
    try {
      const exists = await hasRecs(scanId);
      if (exists) {
        console.log(`  Scan ${scanId}: SKIP (already has recs)`);
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  Scan ${scanId}: WOULD GENERATE (0 recs found)`);
        continue;
      }

      console.log(`  Scan ${scanId}: generating...`);
      const result = await generateAndPersistRecommendations(scanId);

      const nowExists = await hasRecs(scanId);
      if (nowExists) {
        console.log(`  Scan ${scanId}: OK (generated)`);
        generated++;
      } else {
        console.log(`  Scan ${scanId}: FAILED (still 0 recs) result=${JSON.stringify(result)}`);
        failed++;
      }
    } catch (e) {
      console.error(`  Scan ${scanId}: ERROR ${e.message}`);
      failed++;
    }
  }

  console.log(`\nBackfill complete: ${generated} generated, ${skipped} skipped, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

backfill();
