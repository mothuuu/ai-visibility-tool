const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function migrateCampaignRuns() {
  try {
    console.log('🔄 Creating Campaign Runs and related tables...');

    // 1. Create campaign_runs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS campaign_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,

        -- ========== SNAPSHOT: Business Profile ==========
        business_profile_id UUID REFERENCES business_profiles(id),
        profile_snapshot JSONB NOT NULL,

        -- ========== SNAPSHOT: Plan & Entitlement ==========
        plan_at_run VARCHAR(50) NOT NULL,
        entitlement_source VARCHAR(50) NOT NULL,
        entitlement_source_id VARCHAR(255),
        directories_entitled INTEGER NOT NULL,

        -- ========== SNAPSHOT: User Preferences/Filters ==========
        filters_snapshot JSONB NOT NULL DEFAULT '{}',

        -- ========== RUN STATUS ==========
        status VARCHAR(50) NOT NULL DEFAULT 'created',

        -- ========== COUNTS (denormalized for quick access) ==========
        directories_selected INTEGER DEFAULT 0,
        directories_queued INTEGER DEFAULT 0,
        directories_submitted INTEGER DEFAULT 0,
        directories_live INTEGER DEFAULT 0,
        directories_failed INTEGER DEFAULT 0,
        directories_action_needed INTEGER DEFAULT 0,

        -- ========== TIMESTAMPS ==========
        created_at TIMESTAMP DEFAULT NOW(),
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT NOW(),

        -- ========== ERROR TRACKING ==========
        error_message TEXT,
        error_details JSONB
      );
    `);
    console.log('✅ Campaign runs table created');

    // 2. Create credential_vault table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS credential_vault (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        directory_id INTEGER REFERENCES directories(id) NOT NULL,

        -- ========== CREDENTIALS ==========
        email VARCHAR(255),
        username VARCHAR(255),
        password_encrypted TEXT,

        -- ========== ACCOUNT INFO ==========
        account_created_at TIMESTAMP,
        last_login_at TIMESTAMP,
        account_status VARCHAR(50) DEFAULT 'active',

        -- ========== METADATA ==========
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),

        CONSTRAINT unique_user_directory_cred UNIQUE (user_id, directory_id)
      );
    `);
    console.log('✅ Credential vault table created');

    // 3. Add new columns to directory_submissions if they don't exist
    const columnsToAdd = [
      { name: 'campaign_run_id', type: 'UUID REFERENCES campaign_runs(id) ON DELETE CASCADE' },
      { name: 'directory_snapshot', type: 'JSONB' },
      { name: 'verification_type', type: 'VARCHAR(50)' },
      { name: 'verification_status', type: 'VARCHAR(50)' },
      { name: 'verification_deadline', type: 'TIMESTAMP' },
      { name: 'verification_attempts', type: 'INTEGER DEFAULT 0' },
      { name: 'action_url', type: 'VARCHAR(500)' },
      { name: 'credential_id', type: 'UUID REFERENCES credential_vault(id)' },
      { name: 'listing_id', type: 'VARCHAR(255)' },
      { name: 'priority_score', type: 'INTEGER DEFAULT 50' },
      { name: 'queue_position', type: 'INTEGER' },
      { name: 'started_at', type: 'TIMESTAMP' },
      { name: 'error_code', type: 'VARCHAR(100)' },
      { name: 'retry_count', type: 'INTEGER DEFAULT 0' },
      { name: 'last_retry_at', type: 'TIMESTAMP' },
      { name: 'failed_at', type: 'TIMESTAMP' }
    ];

    for (const col of columnsToAdd) {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='directory_submissions' AND column_name='${col.name}'
          ) THEN
            ALTER TABLE directory_submissions ADD COLUMN ${col.name} ${col.type};
          END IF;
        END $$;
      `);
    }
    console.log('✅ Added new columns to directory_submissions');

    // 4. Add error_message column if it doesn't exist (rename notes to error_message pattern)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='directory_submissions' AND column_name='error_message'
        ) THEN
          ALTER TABLE directory_submissions ADD COLUMN error_message TEXT;
        END IF;
      END $$;
    `);
    console.log('✅ Added error_message column to directory_submissions');

    // 5. Update directory_submissions listing_url to be VARCHAR(500) if it exists
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='directory_submissions' AND column_name='listing_url'
        ) THEN
          ALTER TABLE directory_submissions ALTER COLUMN listing_url TYPE VARCHAR(500);
        END IF;
      END $$;
    `);

    // 6. Create indexes for campaign_runs
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_campaign_runs_user ON campaign_runs(user_id);
      CREATE INDEX IF NOT EXISTS idx_campaign_runs_status ON campaign_runs(status);
      CREATE INDEX IF NOT EXISTS idx_campaign_runs_created ON campaign_runs(created_at DESC);
    `);
    console.log('✅ Created indexes for campaign_runs');

    // 7. Create indexes for credential_vault
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_credentials_user ON credential_vault(user_id);
      CREATE INDEX IF NOT EXISTS idx_credentials_directory ON credential_vault(directory_id);
    `);
    console.log('✅ Created indexes for credential_vault');

    // 8. Create new indexes for directory_submissions
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_campaign ON directory_submissions(campaign_run_id);
      CREATE INDEX IF NOT EXISTS idx_submissions_queue ON directory_submissions(campaign_run_id, queue_position);
    `);
    console.log('✅ Created new indexes for directory_submissions');

    // 9. Create partial indexes for action_needed and verification status
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_action ON directory_submissions(status, action_deadline)
        WHERE status = 'action_needed' OR status = 'needs_action';
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_verification ON directory_submissions(status, verification_deadline)
        WHERE status = 'pending_verification';
    `);
    console.log('✅ Created partial indexes for directory_submissions');

    console.log('🎉 Campaign Runs migration complete!');
    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    await pool.end();
    process.exit(1);
  }
}

migrateCampaignRuns();
