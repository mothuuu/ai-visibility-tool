/**
 * Schema Alignment Migration
 *
 * CRITICAL: Run this BEFORE deploying the Start Submissions flow
 *
 * Fixes:
 * - Adds missing operational columns to directories table
 * - Aligns tier_num (INT) from tier (TEXT)
 * - Adds regions TEXT[] array for array overlap queries
 * - Adds priority_score with sensible defaults
 * - Adds verification/operational metadata columns
 * - Adds unique partial index to prevent race conditions
 */

const db = require('./database');

async function runMigration() {
  console.log('Starting Schema Alignment Migration...\n');

  try {
    // ============================================================
    // TASK 1: Align Directories Table Schema
    // ============================================================
    console.log('Task 1: Aligning directories table schema...');

    // 1. Add tier_num (numeric version of tier)
    console.log('  Adding tier_num column...');
    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS tier_num SMALLINT
    `);

    // Backfill tier_num from existing tier column (handles integer or text values)
    console.log('  Backfilling tier_num from tier...');
    await db.query(`UPDATE directories SET tier_num = 1 WHERE tier_num IS NULL AND (tier::text ILIKE '%1%')`);
    await db.query(`UPDATE directories SET tier_num = 2 WHERE tier_num IS NULL AND (tier::text ILIKE '%2%')`);
    await db.query(`UPDATE directories SET tier_num = 3 WHERE tier_num IS NULL AND (tier::text ILIKE '%3%')`);
    await db.query(`UPDATE directories SET tier_num = 2 WHERE tier_num IS NULL`); // Default to tier 2

    // Make tier_num NOT NULL with default
    await db.query(`ALTER TABLE directories ALTER COLUMN tier_num SET DEFAULT 2`);
    // Note: SET NOT NULL may fail if there are still NULLs - handle gracefully
    try {
      await db.query(`ALTER TABLE directories ALTER COLUMN tier_num SET NOT NULL`);
    } catch (e) {
      console.log('  (tier_num already NOT NULL or has NULLs, continuing...)');
    }

    // 2. Add regions array (normalized from region_market if it exists)
    console.log('  Adding regions TEXT[] column...');
    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS regions TEXT[]
    `);

    // Check if region_market column exists
    const regionMarketCheck = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'directories' AND column_name = 'region_market'
    `);
    const hasRegionMarket = regionMarketCheck.rows.length > 0;

    // Backfill regions
    console.log('  Backfilling regions array...');
    if (hasRegionMarket) {
      console.log('    Found region_market column, parsing values...');
      await db.query(`UPDATE directories SET regions = ARRAY['global'] WHERE region_market IS NULL AND regions IS NULL`);
      await db.query(`UPDATE directories SET regions = ARRAY['global'] WHERE region_market ILIKE '%global%' AND regions IS NULL`);

      // Parse comma-separated region_market into array
      await db.query(`
        UPDATE directories SET regions =
          ARRAY(
            SELECT DISTINCT LOWER(TRIM(r))
            FROM unnest(string_to_array(region_market, ',')) AS r
          )
        WHERE region_market IS NOT NULL AND regions IS NULL
      `);

      // Normalize common patterns
      await db.query(`
        UPDATE directories SET regions = ARRAY['global']
        WHERE regions @> ARRAY['worldwide'] OR regions @> ARRAY['international']
      `);
    } else {
      console.log('    No region_market column found, defaulting all to global...');
    }

    // Ensure 'global' is in all regions arrays
    await db.query(`
      UPDATE directories SET regions = array_append(regions, 'global')
      WHERE regions IS NOT NULL AND NOT ('global' = ANY(regions))
    `);

    // Default any remaining NULLs
    await db.query(`UPDATE directories SET regions = ARRAY['global'] WHERE regions IS NULL`);

    // 3. Add priority_score with sensible defaults
    console.log('  Adding priority_score column...');
    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS priority_score INTEGER DEFAULT 50
    `);

    // Check if domain_rating column exists
    const domainRatingCheck = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'directories' AND column_name = 'domain_rating'
    `);
    const hasDomainRating = domainRatingCheck.rows.length > 0;

    // Backfill priority_score based on tier (and domain_rating if available)
    console.log('  Backfilling priority_score...');
    if (hasDomainRating) {
      await db.query(`
        UPDATE directories SET priority_score =
          CASE
            WHEN tier_num = 1 THEN 80 + COALESCE(domain_rating::int / 5, 0)
            WHEN tier_num = 2 THEN 60 + COALESCE(domain_rating::int / 5, 0)
            WHEN tier_num = 3 THEN 40 + COALESCE(domain_rating::int / 5, 0)
            ELSE 50
          END
        WHERE priority_score IS NULL OR priority_score = 50
      `);
    } else {
      console.log('    No domain_rating column, using tier-based priority only...');
      await db.query(`
        UPDATE directories SET priority_score =
          CASE
            WHEN tier_num = 1 THEN 80
            WHEN tier_num = 2 THEN 60
            WHEN tier_num = 3 THEN 40
            ELSE 50
          END
        WHERE priority_score IS NULL OR priority_score = 50
      `);
    }

    // Ensure no NULLs
    await db.query(`UPDATE directories SET priority_score = 50 WHERE priority_score IS NULL`);

    // 4. Add pricing_model (map from pricing_type if it exists)
    console.log('  Adding pricing_model column...');
    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS pricing_model VARCHAR(50) DEFAULT 'free'
    `);

    // Check if pricing_type column exists
    const pricingTypeCheck = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'directories' AND column_name = 'pricing_type'
    `);
    const hasPricingType = pricingTypeCheck.rows.length > 0;

    // Backfill from existing pricing_type if available
    if (hasPricingType) {
      console.log('    Found pricing_type column, mapping values...');
      await db.query(`
        UPDATE directories SET pricing_model =
          CASE
            WHEN pricing_type ILIKE '%free%' THEN 'free'
            WHEN pricing_type ILIKE '%freemium%' THEN 'freemium'
            WHEN pricing_type ILIKE '%paid%' THEN 'paid_only'
            ELSE 'free'
          END
        WHERE pricing_model IS NULL OR pricing_model = 'free'
      `);
    } else {
      console.log('    No pricing_type column, defaulting all to free...');
      await db.query(`UPDATE directories SET pricing_model = 'free' WHERE pricing_model IS NULL`);
    }

    // 5. Add region_scope (for backward compatibility with service code)
    console.log('  Adding region_scope column...');
    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS region_scope VARCHAR(50) DEFAULT 'global'
    `);

    // Backfill from regions array (use first region or 'global')
    await db.query(`
      UPDATE directories SET region_scope =
        COALESCE(regions[1], 'global')
      WHERE region_scope IS NULL OR region_scope = 'global'
    `);

    // 6. Add directory_type (map from category if it exists)
    console.log('  Adding directory_type column...');
    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS directory_type VARCHAR(50) DEFAULT 'saas_review'
    `);

    // Check if category column exists
    const categoryCheck = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'directories' AND column_name = 'category'
    `);
    const hasCategory = categoryCheck.rows.length > 0;

    // Backfill from category if available
    if (hasCategory) {
      console.log('    Found category column, mapping values...');
      await db.query(`
        UPDATE directories SET directory_type =
          CASE
            WHEN category ILIKE '%ai%' OR category ILIKE '%artificial%' THEN 'ai_tools'
            WHEN category ILIKE '%saas%' OR category ILIKE '%software%' OR category ILIKE '%review%' THEN 'saas_review'
            WHEN category ILIKE '%startup%' OR category ILIKE '%product%hunt%' THEN 'startup'
            WHEN category ILIKE '%business%' OR category ILIKE '%local%' OR category ILIKE '%citation%' THEN 'business_citation'
            WHEN category ILIKE '%dev%' OR category ILIKE '%open%source%' OR category ILIKE '%github%' THEN 'dev_registry'
            WHEN category ILIKE '%market%' OR category ILIKE '%alternative%' THEN 'marketplace'
            ELSE 'saas_review'
          END
        WHERE directory_type IS NULL
      `);
    } else {
      console.log('    No category column, defaulting all to saas_review...');
      await db.query(`UPDATE directories SET directory_type = 'saas_review' WHERE directory_type IS NULL`);
    }

    // 7. Add verification columns
    console.log('  Adding verification columns...');
    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS verification_method VARCHAR(50) DEFAULT 'email'
    `);

    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS requires_customer_account BOOLEAN DEFAULT false
    `);

    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS requires_phone_verification BOOLEAN DEFAULT false
    `);

    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS publishes_phone_publicly BOOLEAN DEFAULT false
    `);

    // Set known customer-owned directories
    console.log('  Setting customer-owned directory flags...');
    await db.query(`
      UPDATE directories SET
        requires_customer_account = true,
        verification_method = 'advanced'
      WHERE LOWER(name) IN ('google business profile', 'google my business', 'gbp')
    `);

    await db.query(`
      UPDATE directories SET
        requires_customer_account = true,
        requires_phone_verification = true,
        publishes_phone_publicly = true,
        verification_method = 'phone'
      WHERE LOWER(name) IN ('yelp', 'yelp for business')
    `);

    await db.query(`
      UPDATE directories SET
        requires_customer_account = true,
        verification_method = 'email'
      WHERE LOWER(name) IN ('bing places', 'bing places for business')
    `);

    await db.query(`
      UPDATE directories SET
        requires_customer_account = true,
        requires_phone_verification = true,
        verification_method = 'phone'
      WHERE LOWER(name) IN ('apple business connect', 'apple maps')
    `);

    // 8. Add account_creation_url if missing
    console.log('  Adding account_creation_url column...');
    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS account_creation_url VARCHAR(500)
    `);

    // 9. Add required_fields JSONB
    console.log('  Adding required_fields column...');
    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS required_fields JSONB DEFAULT '["name", "url", "short_description"]'
    `);

    // 10. Add free_tier_limitations
    console.log('  Adding free_tier_limitations column...');
    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS free_tier_limitations TEXT
    `);

    // Update freemium directories
    await db.query(`
      UPDATE directories SET free_tier_limitations = 'Free: basic listing. Paid: premium features, analytics, leads'
      WHERE pricing_model = 'freemium' AND free_tier_limitations IS NULL
    `);

    // 11. Add typical_approval_days if missing
    console.log('  Adding typical_approval_days column...');
    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS typical_approval_days INTEGER DEFAULT 7
    `);

    // 12. Add validation columns if missing
    console.log('  Adding validation columns...');
    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS validation_status VARCHAR(50) DEFAULT 'unknown'
    `);

    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMP
    `);

    // 13. Ensure is_active exists and has default
    console.log('  Ensuring is_active column...');
    await db.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true
    `);

    await db.query(`UPDATE directories SET is_active = true WHERE is_active IS NULL`);

    console.log('  ✓ Task 1 complete: directories table aligned\n');

    // ============================================================
    // TASK 2: Create Performance Indexes
    // ============================================================
    console.log('Task 2: Creating performance indexes...');

    const indexes = [
      { name: 'idx_directories_tier_num', sql: 'CREATE INDEX IF NOT EXISTS idx_directories_tier_num ON directories(tier_num)' },
      { name: 'idx_directories_regions', sql: 'CREATE INDEX IF NOT EXISTS idx_directories_regions ON directories USING GIN(regions)' },
      { name: 'idx_directories_priority', sql: 'CREATE INDEX IF NOT EXISTS idx_directories_priority ON directories(priority_score DESC)' },
      { name: 'idx_directories_pricing', sql: 'CREATE INDEX IF NOT EXISTS idx_directories_pricing ON directories(pricing_model)' },
      { name: 'idx_directories_directory_type', sql: 'CREATE INDEX IF NOT EXISTS idx_directories_directory_type ON directories(directory_type)' },
      { name: 'idx_directories_verification', sql: 'CREATE INDEX IF NOT EXISTS idx_directories_verification ON directories(verification_method)' },
      { name: 'idx_directories_customer_owned', sql: 'CREATE INDEX IF NOT EXISTS idx_directories_customer_owned ON directories(requires_customer_account)' },
      { name: 'idx_directories_active', sql: 'CREATE INDEX IF NOT EXISTS idx_directories_active ON directories(is_active) WHERE is_active = true' }
    ];

    for (const idx of indexes) {
      try {
        await db.query(idx.sql);
        console.log(`  ✓ Created ${idx.name}`);
      } catch (e) {
        console.log(`  (${idx.name} already exists or failed: ${e.message})`);
      }
    }

    console.log('  ✓ Task 2 complete: indexes created\n');

    // ============================================================
    // TASK 3: Add Race Condition Protection
    // ============================================================
    console.log('Task 3: Adding race condition protection...');

    try {
      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_campaign_per_user
        ON campaign_runs(user_id)
        WHERE status IN ('created', 'selecting', 'queued', 'in_progress', 'paused')
      `);
      console.log('  ✓ Created unique partial index for active campaigns');
    } catch (e) {
      console.log(`  (Index may already exist: ${e.message})`);
    }

    console.log('  ✓ Task 3 complete: race condition protection added\n');

    // ============================================================
    // TASK 4: Add status comment documentation
    // ============================================================
    console.log('Task 4: Adding status documentation...');

    try {
      await db.query(`
        COMMENT ON COLUMN directory_submissions.status IS
        'Valid values: queued, in_progress, submitted, pending_verification, action_needed, live, rejected, failed, blocked, skipped, cancelled'
      `);
      console.log('  ✓ Added status column documentation');
    } catch (e) {
      console.log(`  (Could not add comment: ${e.message})`);
    }

    console.log('  ✓ Task 4 complete\n');

    // ============================================================
    // Verification
    // ============================================================
    console.log('Running verification queries...\n');

    // Check tier_num populated
    const tierCheck = await db.query(`
      SELECT tier, tier_num, COUNT(*) as count
      FROM directories
      GROUP BY tier, tier_num
      ORDER BY tier_num
    `);
    console.log('Tier distribution:');
    tierCheck.rows.forEach(r => console.log(`  tier="${r.tier}" tier_num=${r.tier_num}: ${r.count} directories`));

    // Check pricing_model
    const pricingCheck = await db.query(`
      SELECT pricing_model, COUNT(*) as count
      FROM directories
      GROUP BY pricing_model
    `);
    console.log('\nPricing model distribution:');
    pricingCheck.rows.forEach(r => console.log(`  ${r.pricing_model}: ${r.count} directories`));

    // Check customer-owned
    const customerOwnedCheck = await db.query(`
      SELECT name, requires_customer_account, verification_method
      FROM directories
      WHERE requires_customer_account = true
    `);
    console.log('\nCustomer-owned directories:');
    if (customerOwnedCheck.rows.length === 0) {
      console.log('  (none flagged)');
    } else {
      customerOwnedCheck.rows.forEach(r => console.log(`  ${r.name}: ${r.verification_method}`));
    }

    // Check unique index
    const indexCheck = await db.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'campaign_runs'
      AND indexname = 'uniq_active_campaign_per_user'
    `);
    console.log('\nRace condition protection:');
    console.log(`  uniq_active_campaign_per_user: ${indexCheck.rows.length > 0 ? '✓ exists' : '✗ missing'}`);

    console.log('\n============================================================');
    console.log('SCHEMA ALIGNMENT MIGRATION COMPLETE');
    console.log('============================================================\n');

  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { runMigration };
