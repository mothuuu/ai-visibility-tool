const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function migrateDirectoriesSchema() {
  try {
    console.log('🔄 Updating directories table schema...');

    // 1. Add new pricing fields if they don't exist
    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS pricing_model VARCHAR(50) DEFAULT 'free';
    `);
    console.log('✅ Added pricing_model column');

    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS free_tier_limitations TEXT;
    `);
    console.log('✅ Added free_tier_limitations column');

    // 2. Remove old paid_only and cost_notes columns if they exist
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='directories' AND column_name='paid_only'
        ) THEN
          ALTER TABLE directories DROP COLUMN paid_only;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='directories' AND column_name='cost_notes'
        ) THEN
          ALTER TABLE directories DROP COLUMN cost_notes;
        END IF;
      END $$;
    `);
    console.log('✅ Removed old paid_only and cost_notes columns');

    // 3. Ensure all required columns exist with correct types
    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS submission_url VARCHAR(500);
    `);

    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS account_creation_url VARCHAR(500);
    `);

    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS requires_customer_account BOOLEAN DEFAULT false;
    `);

    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS publishes_phone_publicly BOOLEAN DEFAULT false;
    `);

    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS requires_phone_verification BOOLEAN DEFAULT false;
    `);

    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS required_fields JSONB DEFAULT '["name", "url", "short_description"]';
    `);

    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS max_description_length INTEGER;
    `);

    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS accepts_logo BOOLEAN DEFAULT true;
    `);

    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS category_mapping JSONB;
    `);

    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS typical_approval_days INTEGER DEFAULT 7;
    `);

    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS validation_status VARCHAR(50) DEFAULT 'unknown';
    `);

    await pool.query(`
      ALTER TABLE directories
      ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMP;
    `);
    console.log('✅ Ensured all required columns exist');

    // 4. Create indexes if they don't exist
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_directories_type ON directories(directory_type);
      CREATE INDEX IF NOT EXISTS idx_directories_tier ON directories(tier);
      CREATE INDEX IF NOT EXISTS idx_directories_region ON directories(region_scope);
      CREATE INDEX IF NOT EXISTS idx_directories_priority ON directories(priority_score DESC);
      CREATE INDEX IF NOT EXISTS idx_directories_active ON directories(is_active) WHERE is_active = true;
      CREATE INDEX IF NOT EXISTS idx_directories_pricing ON directories(pricing_model);
    `);
    console.log('✅ Created indexes');

    console.log('🎉 Directories schema migration complete!');
    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    await pool.end();
    process.exit(1);
  }
}

migrateDirectoriesSchema();
