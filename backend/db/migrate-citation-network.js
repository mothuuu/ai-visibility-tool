const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function migrateCitationNetwork() {
  try {
    console.log('🔄 Creating Citation Network tables...');

    // Add stripe_subscription_status to users table if not exists
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='users' AND column_name='stripe_subscription_status'
        ) THEN
          ALTER TABLE users ADD COLUMN stripe_subscription_status VARCHAR(50);
        END IF;
      END $$;
    `);
    console.log('✅ Added stripe_subscription_status to users table');

    // Create business_profiles table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS business_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,

        -- Basic Info
        business_name VARCHAR(255) NOT NULL,
        website_url VARCHAR(500),
        phone VARCHAR(50),
        email VARCHAR(255),

        -- Address
        address_line1 VARCHAR(255),
        address_line2 VARCHAR(255),
        city VARCHAR(100),
        state VARCHAR(100),
        postal_code VARCHAR(20),
        country VARCHAR(100) DEFAULT 'United States',

        -- Business Details
        business_description TEXT,
        short_description VARCHAR(500),
        year_founded INTEGER,
        number_of_employees VARCHAR(50),

        -- Categories
        primary_category VARCHAR(255),
        secondary_categories JSONB DEFAULT '[]',

        -- Social & Links
        social_links JSONB DEFAULT '{}',

        -- Media
        logo_url VARCHAR(500),
        photos JSONB DEFAULT '[]',

        -- Hours
        business_hours JSONB DEFAULT '{}',

        -- Additional
        payment_methods JSONB DEFAULT '[]',
        service_areas JSONB DEFAULT '[]',
        certifications JSONB DEFAULT '[]',

        -- Status
        is_complete BOOLEAN DEFAULT false,
        completion_percentage INTEGER DEFAULT 0,

        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT unique_user_profile UNIQUE (user_id)
      );
    `);
    console.log('✅ Business profiles table created');

    // Create directory_orders table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS directory_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id),

        -- Order type
        order_type VARCHAR(50) NOT NULL, -- 'starter' ($249) or 'pack' ($99)

        -- Stripe
        stripe_checkout_session_id VARCHAR(255),
        stripe_payment_intent_id VARCHAR(255),
        stripe_price_id VARCHAR(255),

        -- Pricing
        amount_cents INTEGER NOT NULL,
        currency VARCHAR(3) DEFAULT 'usd',

        -- Allocation
        directories_allocated INTEGER NOT NULL DEFAULT 100,
        directories_submitted INTEGER DEFAULT 0,
        directories_live INTEGER DEFAULT 0,

        -- Status
        status VARCHAR(50) DEFAULT 'pending',
        -- Values: pending, paid, processing, in_progress, completed, refunded, cancelled

        -- Delivery tracking
        delivery_started_at TIMESTAMP,
        delivery_completed_at TIMESTAMP,

        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Directory orders table created');

    // Create subscriber_directory_allocations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriber_directory_allocations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,

        -- Period
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,

        -- Allocation from plan
        base_allocation INTEGER NOT NULL, -- 10 (DIY), 25 (Pro), 100 (Agency)

        -- Additional from $99 packs
        pack_allocation INTEGER DEFAULT 0,

        -- Usage
        submissions_used INTEGER DEFAULT 0,

        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT unique_user_period UNIQUE (user_id, period_start)
      );
    `);
    console.log('✅ Subscriber directory allocations table created');

    // Create directories master table (list of all directories we submit to)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS directories (
        id SERIAL PRIMARY KEY,

        -- Core Identification
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        website_url VARCHAR(500) NOT NULL,
        logo_url VARCHAR(500),
        description TEXT,

        -- Classification
        directory_type VARCHAR(50) NOT NULL,
          -- 'ai_tools', 'saas_review', 'startup', 'business_citation', 'marketplace', 'dev_registry'
        tier INTEGER NOT NULL DEFAULT 2 CHECK (tier BETWEEN 1 AND 3),
          -- 1 = highest authority (G2, Product Hunt)
          -- 2 = medium authority (Capterra, Crunchbase)
          -- 3 = lower authority (niche directories)
        region_scope VARCHAR(50) DEFAULT 'global',
          -- 'global', 'us', 'ca', 'uk', 'eu', 'apac'
        priority_score INTEGER DEFAULT 50 CHECK (priority_score BETWEEN 1 AND 100),
          -- Higher = submit first. Combines tier + strategic value

        -- Submission Operations
        submission_mode VARCHAR(50) NOT NULL DEFAULT 'manual',
          -- 'manual' (form fill), 'api', 'editorial' (pitch/apply), 'partner', 'pull_request'
        submission_url VARCHAR(500),
        requires_account BOOLEAN DEFAULT true,
        account_creation_url VARCHAR(500),

        -- Verification Requirements
        verification_method VARCHAR(50) DEFAULT 'email',
          -- 'none', 'email', 'sms', 'phone', 'advanced' (postcard/video/etc)
        requires_customer_account BOOLEAN DEFAULT false,
          -- true for GBP, Yelp, Apple, Bing, BBB, LinkedIn
        publishes_phone_publicly BOOLEAN DEFAULT false,
        requires_phone_verification BOOLEAN DEFAULT false,

        -- Content Requirements
        required_fields JSONB DEFAULT '["name", "url", "short_description"]',
          -- Which business profile fields are mandatory
        max_description_length INTEGER,
        accepts_logo BOOLEAN DEFAULT true,
        category_mapping JSONB,
          -- Map our categories to their categories

        -- Approval & Timing
        approval_type VARCHAR(50) DEFAULT 'review',
          -- 'instant', 'review', 'editorial', 'paid_only'
        typical_approval_days INTEGER DEFAULT 7,

        -- Cost
        paid_only BOOLEAN DEFAULT false,
        cost_notes TEXT,

        -- Operational Status
        is_active BOOLEAN DEFAULT true,
        validation_status VARCHAR(50) DEFAULT 'unknown',
          -- 'valid', 'broken', 'changed', 'unknown'
        last_validated_at TIMESTAMP,
        notes TEXT,

        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Directories master table created');

    // Create directory_submissions table for tracking individual submissions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS directory_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES directory_orders(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id),
        directory_id INTEGER REFERENCES directories(id),

        -- Directory info (denormalized for convenience)
        directory_name VARCHAR(255) NOT NULL,
        directory_url VARCHAR(500),
        directory_category VARCHAR(255),

        -- Submission details
        submitted_url VARCHAR(500),
        listing_url VARCHAR(500),

        -- Status
        status VARCHAR(50) DEFAULT 'pending',
        -- Values: queued, in_progress, submitted, pending_approval, verified, live, rejected, needs_action, blocked

        -- Action required tracking
        action_type VARCHAR(50),
        -- 'none', 'email', 'sms', 'phone', 'postcard', 'login', 'document'
        action_instructions TEXT,
        action_required_at TIMESTAMP,
        action_deadline TIMESTAMP,

        -- Credentials (if account was created)
        has_credentials BOOLEAN DEFAULT false,

        -- Notes
        notes TEXT,
        rejection_reason TEXT,
        blocked_reason TEXT,

        -- Timestamps
        queued_at TIMESTAMP,
        submitted_at TIMESTAMP,
        verified_at TIMESTAMP,
        approved_at TIMESTAMP,
        live_at TIMESTAMP,
        blocked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Directory submissions table created');

    // Create indexes
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

    console.log('🎉 Citation Network migration complete!');
    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    await pool.end();
    process.exit(1);
  }
}

migrateCitationNetwork();
