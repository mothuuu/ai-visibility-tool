/**
 * Cleanup Stuck Campaigns
 *
 * Cancels campaigns that are in active states but have no directories queued.
 * Run this to clean up any stuck/orphaned campaign runs.
 */

const db = require('./database');

async function cleanupStuckCampaigns() {
  console.log('Cleaning up stuck campaigns...\n');

  try {
    // Cancel campaigns with no directories queued
    const result = await db.query(`
      UPDATE campaign_runs
      SET status = 'cancelled',
          error_message = 'Cancelled: No directories were queued',
          updated_at = NOW()
      WHERE status IN ('created', 'selecting', 'queued', 'in_progress')
        AND (directories_queued = 0 OR directories_queued IS NULL)
      RETURNING id, user_id, status, created_at
    `);

    if (result.rows.length === 0) {
      console.log('No stuck campaigns found.');
    } else {
      console.log(`Cancelled ${result.rows.length} stuck campaign(s):`);
      result.rows.forEach(row => {
        console.log(`  - Campaign ${row.id} (user: ${row.user_id}, created: ${row.created_at})`);
      });
    }

    // Also show current active campaigns for reference
    const activeResult = await db.query(`
      SELECT id, user_id, status, directories_queued, directories_submitted, created_at
      FROM campaign_runs
      WHERE status IN ('created', 'selecting', 'queued', 'in_progress', 'paused')
      ORDER BY created_at DESC
      LIMIT 10
    `);

    if (activeResult.rows.length > 0) {
      console.log(`\nRemaining active campaigns (${activeResult.rows.length}):`);
      activeResult.rows.forEach(row => {
        console.log(`  - Campaign ${row.id}: ${row.status} (queued: ${row.directories_queued || 0}, submitted: ${row.directories_submitted || 0})`);
      });
    } else {
      console.log('\nNo active campaigns remaining.');
    }

    console.log('\nCleanup complete.');

  } catch (error) {
    console.error('Cleanup failed:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  cleanupStuckCampaigns()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { cleanupStuckCampaigns };
