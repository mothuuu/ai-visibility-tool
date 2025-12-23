/**
 * Start Submissions Diagnostics
 *
 * Run this to debug issues with the Start Submissions flow
 */

const db = require('./database');

async function runDiagnostics() {
  console.log('='.repeat(60));
  console.log('START SUBMISSIONS DIAGNOSTICS');
  console.log('='.repeat(60));
  console.log('');

  try {
    // 1. Check required columns exist
    console.log('1. CHECKING REQUIRED COLUMNS IN directories TABLE');
    console.log('-'.repeat(60));

    const columnsResult = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'directories'
      AND column_name IN ('tier_num', 'regions', 'priority_score', 'pricing_model',
                          'directory_type', 'verification_method', 'requires_customer_account',
                          'is_active', 'requires_phone_verification', 'publishes_phone_publicly')
      ORDER BY column_name
    `);

    const requiredColumns = ['tier_num', 'regions', 'priority_score', 'pricing_model',
                             'directory_type', 'verification_method', 'requires_customer_account', 'is_active'];
    const foundColumns = columnsResult.rows.map(r => r.column_name);
    const missingColumns = requiredColumns.filter(c => !foundColumns.includes(c));

    if (missingColumns.length > 0) {
      console.log('❌ MISSING COLUMNS:', missingColumns.join(', '));
      console.log('   Run: node db/migrate-schema-alignment.js');
    } else {
      console.log('✓ All required columns exist');
    }

    console.log('\nFound columns:');
    columnsResult.rows.forEach(r => {
      console.log(`  - ${r.column_name}: ${r.data_type} (nullable: ${r.is_nullable}, default: ${r.column_default || 'none'})`);
    });

    // 2. Check directory counts
    console.log('\n');
    console.log('2. DIRECTORY AVAILABILITY');
    console.log('-'.repeat(60));

    const countsResult = await db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = true) as active,
        COUNT(*) FILTER (WHERE is_active IS NULL) as active_null,
        COUNT(*) FILTER (WHERE pricing_model IN ('free', 'freemium')) as free_freemium,
        COUNT(*) FILTER (WHERE pricing_model IS NULL) as pricing_null,
        COUNT(*) FILTER (WHERE requires_customer_account = false) as not_customer_owned,
        COUNT(*) FILTER (WHERE requires_customer_account IS NULL) as customer_owned_null,
        COUNT(*) FILTER (WHERE tier_num IS NOT NULL) as has_tier_num,
        COUNT(*) FILTER (WHERE regions IS NOT NULL) as has_regions,
        COUNT(*) FILTER (WHERE priority_score IS NOT NULL) as has_priority
      FROM directories
    `);

    const counts = countsResult.rows[0];
    console.log(`Total directories: ${counts.total}`);
    console.log(`  - Active (is_active=true): ${counts.active} (NULL: ${counts.active_null})`);
    console.log(`  - Free/Freemium: ${counts.free_freemium} (NULL pricing: ${counts.pricing_null})`);
    console.log(`  - Not customer-owned: ${counts.not_customer_owned} (NULL: ${counts.customer_owned_null})`);
    console.log(`  - Has tier_num: ${counts.has_tier_num}`);
    console.log(`  - Has regions[]: ${counts.has_regions}`);
    console.log(`  - Has priority_score: ${counts.has_priority}`);

    if (parseInt(counts.active) === 0) {
      console.log('\n❌ NO ACTIVE DIRECTORIES! Run migration to set is_active = true');
    }
    if (parseInt(counts.free_freemium) === 0) {
      console.log('\n❌ NO FREE/FREEMIUM DIRECTORIES! Run migration to set pricing_model');
    }

    // 3. Check sample directories
    console.log('\n');
    console.log('3. SAMPLE DIRECTORIES (first 5)');
    console.log('-'.repeat(60));

    const sampleResult = await db.query(`
      SELECT id, name, is_active, pricing_model, tier_num, requires_customer_account,
             COALESCE(priority_score, 0) as priority_score,
             regions[1] as first_region
      FROM directories
      LIMIT 5
    `);

    sampleResult.rows.forEach(r => {
      console.log(`  ${r.id}: ${r.name}`);
      console.log(`      active=${r.is_active}, pricing=${r.pricing_model}, tier=${r.tier_num}, customer_owned=${r.requires_customer_account}, priority=${r.priority_score}`);
    });

    // 4. Check recent campaign runs
    console.log('\n');
    console.log('4. RECENT CAMPAIGN RUNS');
    console.log('-'.repeat(60));

    const campaignsResult = await db.query(`
      SELECT id, user_id, status, error_message, directories_queued,
             created_at, updated_at
      FROM campaign_runs
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if (campaignsResult.rows.length === 0) {
      console.log('No campaign runs found');
    } else {
      campaignsResult.rows.forEach(r => {
        console.log(`  Campaign ${r.id}:`);
        console.log(`    Status: ${r.status}, Queued: ${r.directories_queued || 0}`);
        console.log(`    Created: ${r.created_at}`);
        if (r.error_message) {
          console.log(`    Error: ${r.error_message}`);
        }
      });
    }

    // 5. Check if a test selection would work
    console.log('\n');
    console.log('5. TEST DIRECTORY SELECTION QUERY');
    console.log('-'.repeat(60));

    try {
      const testSelectResult = await db.query(`
        SELECT COUNT(*) as selectable
        FROM directories d
        WHERE d.is_active = true
          AND d.pricing_model IN ('free', 'freemium')
          AND d.requires_customer_account = false
      `);

      console.log(`Directories that would be selected: ${testSelectResult.rows[0].selectable}`);

      if (parseInt(testSelectResult.rows[0].selectable) === 0) {
        console.log('\n❌ NO DIRECTORIES MATCH SELECTION CRITERIA!');
        console.log('   Checking why...');

        // Detailed breakdown
        const breakdownResult = await db.query(`
          SELECT
            'is_active = true' as condition,
            COUNT(*) FILTER (WHERE is_active = true) as matches
          FROM directories
          UNION ALL
          SELECT
            'pricing_model IN (free, freemium)',
            COUNT(*) FILTER (WHERE pricing_model IN ('free', 'freemium'))
          FROM directories
          UNION ALL
          SELECT
            'requires_customer_account = false',
            COUNT(*) FILTER (WHERE requires_customer_account = false)
          FROM directories
        `);

        breakdownResult.rows.forEach(r => {
          console.log(`   ${r.condition}: ${r.matches} match`);
        });
      }
    } catch (e) {
      console.log(`❌ Query failed: ${e.message}`);
      console.log('   This likely means columns are missing. Run the migration first.');
    }

    // 6. Check unique index
    console.log('\n');
    console.log('6. RACE CONDITION PROTECTION');
    console.log('-'.repeat(60));

    const indexResult = await db.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'campaign_runs'
      AND indexname = 'uniq_active_campaign_per_user'
    `);

    if (indexResult.rows.length > 0) {
      console.log('✓ Unique partial index exists');
    } else {
      console.log('❌ Unique partial index missing. Run migration.');
    }

    console.log('\n');
    console.log('='.repeat(60));
    console.log('DIAGNOSTICS COMPLETE');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Diagnostics failed:', error);
  }
}

// Run if called directly
if (require.main === module) {
  runDiagnostics()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runDiagnostics };
