/**
 * Citation Run Cleanup Cron Job
 *
 * Runs every 5 minutes. Finds manual citation_test_runs that have been
 * in 'pending' status for more than 10 minutes (orphaned — post-COMMIT
 * failure before the run could be finalized), marks them as failed, and
 * refunds the tokens to the user.
 *
 * Schedule: '*\/5 * * * *' (every 5 minutes)
 * Disable: DISABLE_CITATION_CLEANUP_CRON=true
 *
 * Idempotent: the UPDATE uses WHERE status='pending' so a run that was
 * already processed by another worker produces rowCount=0 and is skipped.
 */

const cron = require('node-cron');
const db = require('../db/database');
const tokenService = require('../services/tokenService');
const { CITATION_TEST_TOKEN_COST } = require('../config/platform-config');

// In-memory overlap protection
let isRunning = false;

/**
 * Core job logic — exported separately for testing and manual invocation.
 * @returns {{ processed: number, errors: number }}
 */
async function runCitationRunCleanupJob() {
  if (isRunning) {
    console.log('[CitationRunCleanup] Job already running, skipping');
    return { processed: 0, errors: 0, skipped: true };
  }

  isRunning = true;
  let processed = 0;
  let errors = 0;

  try {
    console.log('[CitationRunCleanup] Starting orphaned run sweep...');

    const { rows: orphaned } = await db.query(`
      SELECT id, user_id FROM citation_test_runs
       WHERE run_type = 'manual'
         AND status = 'pending'
         AND created_at < NOW() - INTERVAL '10 minutes'
    `);

    for (const run of orphaned) {
      try {
        // Idempotency: only update if still pending; rowCount=0 means another
        // worker already processed this run — skip the refund.
        const result = await db.query(
          `UPDATE citation_test_runs
              SET status = 'failed',
                  error_message = 'Run timed out — tokens refunded',
                  completed_at = NOW()
            WHERE id = $1 AND status = 'pending'`,
          [run.id]
        );

        if (result.rowCount === 0) {
          continue;
        }

        await tokenService.refundCitationTokens(run.user_id, CITATION_TEST_TOKEN_COST, run.id.toString());
        console.log(`[CitationRunCleanup] processed run_id=${run.id} user_id=${run.user_id}`);
        processed++;
      } catch (err) {
        errors++;
        console.error(`[CitationRunCleanup] Error processing run ${run.id}:`, err.message);
      }
    }

    console.log(`[CitationRunCleanup] Sweep complete: ${processed} processed, ${errors} errors`);
    return { processed, errors };
  } finally {
    isRunning = false;
  }
}

/**
 * Start the citation run cleanup cron schedule.
 * Call once during server startup after DB is ready.
 */
function startCitationRunCleanupCron() {
  if (process.env.DISABLE_CITATION_CLEANUP_CRON === 'true') {
    console.log('[CitationRunCleanup] Cron disabled (DISABLE_CITATION_CLEANUP_CRON=true)');
    return null;
  }

  console.log('[CitationRunCleanup] Scheduling orphaned run cleanup (every 5 minutes)...');
  const task = cron.schedule('*/5 * * * *', async () => {
    console.log('[Cron] Running citation run cleanup...');
    try {
      const result = await runCitationRunCleanupJob();
      console.log('[Cron] Citation run cleanup complete:', result);
    } catch (err) {
      console.error('[Cron] Citation run cleanup failed:', err);
    }
  });

  return task;
}

module.exports = { startCitationRunCleanupCron, runCitationRunCleanupJob };
