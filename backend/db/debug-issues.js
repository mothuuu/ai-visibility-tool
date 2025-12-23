/**
 * Debug Script: Logo Upload + Start Submissions
 */

const db = require('./database');

async function debug() {
  console.log('='.repeat(60));
  console.log('DEBUGGING LOGO UPLOAD + START SUBMISSIONS');
  console.log('='.repeat(60));

  try {
    // Bug 1: Check logo_url in business_profiles
    console.log('\n1. CHECKING LOGO_URL IN BUSINESS PROFILES');
    console.log('-'.repeat(60));

    const profileResult = await db.query(`
      SELECT id, user_id, business_name, logo_url, created_at, updated_at
      FROM business_profiles
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if (profileResult.rows.length === 0) {
      console.log('No business profiles found');
    } else {
      profileResult.rows.forEach(row => {
        console.log(`  Profile ${row.id} (user: ${row.user_id}):`);
        console.log(`    Business: ${row.business_name}`);
        console.log(`    Logo URL: ${row.logo_url || '(null/empty)'}`);
        console.log(`    Updated: ${row.updated_at}`);
      });
    }

    // Bug 2: Check campaign_runs
    console.log('\n2. CHECKING CAMPAIGN RUNS');
    console.log('-'.repeat(60));

    const campaignResult = await db.query(`
      SELECT id, user_id, status, error_message, directories_entitled,
             directories_selected, directories_queued, created_at
      FROM campaign_runs
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if (campaignResult.rows.length === 0) {
      console.log('No campaign runs found');
    } else {
      campaignResult.rows.forEach(row => {
        console.log(`  Campaign ${row.id} (user: ${row.user_id}):`);
        console.log(`    Status: ${row.status}`);
        console.log(`    Entitled: ${row.directories_entitled}, Selected: ${row.directories_selected}, Queued: ${row.directories_queued}`);
        console.log(`    Created: ${row.created_at}`);
        if (row.error_message) {
          console.log(`    ERROR: ${row.error_message}`);
        }
      });
    }

    // Check directory_submissions for the latest campaign
    if (campaignResult.rows.length > 0) {
      const latestCampaign = campaignResult.rows[0];
      console.log('\n3. CHECKING SUBMISSIONS FOR LATEST CAMPAIGN');
      console.log('-'.repeat(60));

      const submissionsResult = await db.query(`
        SELECT id, directory_name, status, queue_position
        FROM directory_submissions
        WHERE campaign_run_id = $1
        ORDER BY queue_position
        LIMIT 10
      `, [latestCampaign.id]);

      console.log(`  Campaign ${latestCampaign.id} has ${submissionsResult.rows.length} submissions:`);
      submissionsResult.rows.forEach(row => {
        console.log(`    #${row.queue_position}: ${row.directory_name} - ${row.status}`);
      });
    }

    // Check if business_profiles table has logo_url column
    console.log('\n4. CHECKING BUSINESS_PROFILES SCHEMA');
    console.log('-'.repeat(60));

    const schemaResult = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'business_profiles'
      AND column_name = 'logo_url'
    `);

    if (schemaResult.rows.length === 0) {
      console.log('  ❌ logo_url column DOES NOT EXIST in business_profiles!');
    } else {
      console.log(`  ✓ logo_url column exists: ${schemaResult.rows[0].data_type} (nullable: ${schemaResult.rows[0].is_nullable})`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('DEBUG COMPLETE');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Debug failed:', error);
  }
}

if (require.main === module) {
  debug()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { debug };
