/**
 * Token Expiry Cron Job
 *
 * Safety-net job that runs daily at midnight UTC to expire tokens for users
 * whose billing cycle has ended. Catches edge cases where webhook-based
 * cycle handling was delayed or missed.
 *
 * Schedule: '0 0 * * *' (midnight UTC)
 * Disable: DISABLE_TOKEN_EXPIRY_CRON=true
 *
 * Idempotent: safe to run repeatedly. If balances are already 0,
 * TokenService.expireAllTokens no-ops.
 */

const cron = require('node-cron');
const db = require('../db/database');
const TokenService = require('../services/tokenService');

const BATCH_SIZE = 500;

// In-memory overlap protection
let isRunning = false;

/**
 * Core job logic — exported separately for testing and manual invocation.
 * @returns {{ processed: number, errors: number }}
 */
async function runTokenExpiryJob() {
  if (isRunning) {
    console.log('[TokenExpiry] Job already running, skipping');
    return { processed: 0, errors: 0, skipped: true };
  }

  isRunning = true;
  let totalProcessed = 0;
  let totalErrors = 0;

  try {
    console.log('[TokenExpiry] Starting token expiry sweep...');

    // Process in batches to avoid memory spikes
    let hasMore = true;
    while (hasMore) {
      const result = await db.query(`
        SELECT user_id, monthly_remaining, purchased_balance, cycle_end_date
        FROM token_balances
        WHERE cycle_end_date < NOW()
          AND (monthly_remaining > 0 OR purchased_balance > 0)
        ORDER BY cycle_end_date ASC
        LIMIT $1
      `, [BATCH_SIZE]);

      const rows = result.rows;
      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of rows) {
        try {
          await TokenService.expireAllTokens(row.user_id);
          totalProcessed++;
          console.log(
            `[TokenExpiry] Expired tokens for user ${row.user_id} ` +
            `(cycle ended ${row.cycle_end_date.toISOString()}, ` +
            `prev monthly=${row.monthly_remaining}, prev purchased=${row.purchased_balance})`
          );
        } catch (err) {
          totalErrors++;
          console.error(`[TokenExpiry] Error expiring tokens for user ${row.user_id}:`, err.message);
        }
      }

      // If we got fewer than BATCH_SIZE, we're done
      if (rows.length < BATCH_SIZE) {
        hasMore = false;
      }
    }

    console.log(`[TokenExpiry] Token expiry job complete: ${totalProcessed} users processed, ${totalErrors} errors`);
    return { processed: totalProcessed, errors: totalErrors };
  } finally {
    isRunning = false;
  }
}

/**
 * Start the token expiry cron schedule.
 * Call once during server startup after DB is ready.
 */
function startTokenExpiryCron() {
  if (process.env.DISABLE_TOKEN_EXPIRY_CRON === 'true') {
    console.log('[TokenExpiry] Cron disabled (DISABLE_TOKEN_EXPIRY_CRON=true)');
    return null;
  }

  console.log('[TokenExpiry] Scheduling daily token expiry (midnight UTC)...');
  const task = cron.schedule('0 0 * * *', async () => {
    console.log('[Cron] Running token expiry job...');
    try {
      const result = await runTokenExpiryJob();
      console.log('[Cron] Token expiry complete:', result);
    } catch (error) {
      console.error('[Cron] Token expiry job failed:', error);
    }
  });

  return task;
}

module.exports = { startTokenExpiryCron, runTokenExpiryJob };
