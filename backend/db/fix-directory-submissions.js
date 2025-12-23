const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function fixDirectorySubmissions() {
  try {
    console.log('🔄 Fixing directory_submissions table...');

    // Add directory_id column if missing
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='directory_submissions' AND column_name='directory_id'
        ) THEN
          ALTER TABLE directory_submissions ADD COLUMN directory_id INTEGER REFERENCES directories(id);
        END IF;
      END $$;
    `);
    console.log('✅ directory_id column ensured');

    // Create indexes (safe to run - IF NOT EXISTS)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_directory_orders_user ON directory_orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_directory_orders_status ON directory_orders(status);
      CREATE INDEX IF NOT EXISTS idx_directory_orders_stripe ON directory_orders(stripe_checkout_session_id);
      CREATE INDEX IF NOT EXISTS idx_directory_orders_type ON directory_orders(order_type);

      CREATE INDEX IF NOT EXISTS idx_allocations_user ON subscriber_directory_allocations(user_id);
      CREATE INDEX IF NOT EXISTS idx_allocations_period ON subscriber_directory_allocations(period_start);

      CREATE INDEX IF NOT EXISTS idx_business_profiles_user ON business_profiles(user_id);

      CREATE INDEX IF NOT EXISTS idx_directories_type ON directories(directory_type);
      CREATE INDEX IF NOT EXISTS idx_directories_tier ON directories(tier);
      CREATE INDEX IF NOT EXISTS idx_directories_region ON directories(region_scope);
      CREATE INDEX IF NOT EXISTS idx_directories_priority ON directories(priority_score DESC);
      CREATE INDEX IF NOT EXISTS idx_directories_active ON directories(is_active) WHERE is_active = true;
      CREATE INDEX IF NOT EXISTS idx_directories_submission_mode ON directories(submission_mode);
      CREATE INDEX IF NOT EXISTS idx_directories_verification ON directories(verification_method);

      CREATE INDEX IF NOT EXISTS idx_directory_submissions_order ON directory_submissions(order_id);
      CREATE INDEX IF NOT EXISTS idx_directory_submissions_user ON directory_submissions(user_id);
      CREATE INDEX IF NOT EXISTS idx_directory_submissions_status ON directory_submissions(status);
      CREATE INDEX IF NOT EXISTS idx_directory_submissions_directory ON directory_submissions(directory_id);
    `);
    console.log('✅ Indexes created');

    console.log('🎉 Fix complete!');
    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Fix failed:', error);
    await pool.end();
    process.exit(1);
  }
}

fixDirectorySubmissions();
