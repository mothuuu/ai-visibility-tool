-- Migration: Phase 1-3 Citation Network Foundation
-- Date: 2025-01-01
-- Description: Complete migration combining all Tier 0-2 fixes for Citation Network.
--
-- This migration is idempotent and can be run multiple times safely.
-- All operations check for existence before modifying.
--
-- Includes:
--   T0-13: FK Type Matching (detect users.id type)
--   T0-14: ENUM-Safe Plan Normalization
--   T0-15: Bidirectional Table Aliases
--   T0-16: Directory ID Type Alignment Check
--   T1-3:  Status Normalization

-- ============================================================================
-- T0-13: FK Type Matching - Create directory_orders with correct FK type
-- ============================================================================
DO $$
DECLARE
  user_id_type TEXT;
BEGIN
  -- Skip if table already exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'directory_orders') THEN
    RAISE NOTICE 'Table directory_orders already exists, skipping creation';
    RETURN;
  END IF;

  -- Get the data type of users.id
  SELECT data_type INTO user_id_type
  FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'id';

  IF user_id_type IS NULL THEN
    RAISE EXCEPTION 'Cannot determine users.id type - table users may not exist';
  END IF;

  RAISE NOTICE 'Detected users.id type: %', user_id_type;

  -- Create directory_orders with matching FK type
  IF user_id_type = 'integer' THEN
    CREATE TABLE directory_orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pack_type VARCHAR(50) NOT NULL,
      stripe_checkout_session_id VARCHAR(255),
      stripe_payment_intent_id VARCHAR(255),
      amount_cents INTEGER NOT NULL,
      directories_purchased INTEGER NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    );
    RAISE NOTICE 'Created directory_orders with INTEGER user_id FK';
  ELSIF user_id_type = 'bigint' THEN
    CREATE TABLE directory_orders (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pack_type VARCHAR(50) NOT NULL,
      stripe_checkout_session_id VARCHAR(255),
      stripe_payment_intent_id VARCHAR(255),
      amount_cents INTEGER NOT NULL,
      directories_purchased INTEGER NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    );
    RAISE NOTICE 'Created directory_orders with BIGINT user_id FK';
  ELSIF user_id_type = 'uuid' THEN
    CREATE TABLE directory_orders (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pack_type VARCHAR(50) NOT NULL,
      stripe_checkout_session_id VARCHAR(255),
      stripe_payment_intent_id VARCHAR(255),
      amount_cents INTEGER NOT NULL,
      directories_purchased INTEGER NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    );
    RAISE NOTICE 'Created directory_orders with UUID user_id FK';
  ELSE
    RAISE EXCEPTION 'Unsupported users.id type: %. Must be integer, bigint, or uuid.', user_id_type;
  END IF;

  -- Add indexes
  CREATE INDEX IF NOT EXISTS idx_directory_orders_user_id ON directory_orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_directory_orders_session_id ON directory_orders(stripe_checkout_session_id);
  CREATE INDEX IF NOT EXISTS idx_directory_orders_status ON directory_orders(status);
END $$;

-- ============================================================================
-- T0-13: FK Type Matching - Create subscriber_directory_allocations with correct FK type
-- ============================================================================
DO $$
DECLARE
  user_id_type TEXT;
BEGIN
  -- Skip if table already exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subscriber_directory_allocations') THEN
    RAISE NOTICE 'Table subscriber_directory_allocations already exists, skipping creation';
    RETURN;
  END IF;

  -- Get the data type of users.id
  SELECT data_type INTO user_id_type
  FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'id';

  IF user_id_type IS NULL THEN
    RAISE EXCEPTION 'Cannot determine users.id type - table users may not exist';
  END IF;

  -- Create table with matching FK type
  IF user_id_type = 'integer' THEN
    CREATE TABLE subscriber_directory_allocations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period_start DATE NOT NULL,
      base_allocation INTEGER NOT NULL DEFAULT 0,
      bonus_allocation INTEGER NOT NULL DEFAULT 0,
      used_allocation INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, period_start)
    );
    RAISE NOTICE 'Created subscriber_directory_allocations with INTEGER user_id FK';
  ELSIF user_id_type = 'bigint' THEN
    CREATE TABLE subscriber_directory_allocations (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period_start DATE NOT NULL,
      base_allocation INTEGER NOT NULL DEFAULT 0,
      bonus_allocation INTEGER NOT NULL DEFAULT 0,
      used_allocation INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, period_start)
    );
    RAISE NOTICE 'Created subscriber_directory_allocations with BIGINT user_id FK';
  ELSIF user_id_type = 'uuid' THEN
    CREATE TABLE subscriber_directory_allocations (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period_start DATE NOT NULL,
      base_allocation INTEGER NOT NULL DEFAULT 0,
      bonus_allocation INTEGER NOT NULL DEFAULT 0,
      used_allocation INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, period_start)
    );
    RAISE NOTICE 'Created subscriber_directory_allocations with UUID user_id FK';
  END IF;

  -- Add indexes
  CREATE INDEX IF NOT EXISTS idx_sda_user_period ON subscriber_directory_allocations(user_id, period_start);
END $$;

-- ============================================================================
-- T0-14: ENUM-Safe Plan Normalization
-- ============================================================================
DO $$
DECLARE
  plan_data_type TEXT;
BEGIN
  -- Get the data type of users.plan
  SELECT data_type INTO plan_data_type
  FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'plan';

  IF plan_data_type IS NULL THEN
    RAISE NOTICE 'Column users.plan does not exist, skipping normalization';
    RETURN;
  END IF;

  RAISE NOTICE 'users.plan data type: %', plan_data_type;

  -- Only normalize if plan is text-like
  -- If USER-DEFINED (enum), values are already constrained
  IF plan_data_type = 'USER-DEFINED' THEN
    RAISE NOTICE 'users.plan is an ENUM type - skipping text normalization';
    RETURN;
  END IF;

  RAISE NOTICE 'Normalizing text-based plan values...';

  -- Step 1: Lowercase and trim all values
  UPDATE users SET plan = LOWER(TRIM(plan)) WHERE plan IS NOT NULL;

  -- Step 2: Normalize known aliases to canonical names
  UPDATE users SET plan = 'diy'
  WHERE plan IN ('diy-plan', 'diy_plan', 'diy-monthly', 'diy_monthly', 'starter', 'basic');

  UPDATE users SET plan = 'pro'
  WHERE plan IN ('pro-plan', 'pro_plan', 'professional', 'pro-monthly', 'growth');

  UPDATE users SET plan = 'agency'
  WHERE plan IN ('agency-plan', 'agency_plan', 'agency-monthly', 'team', 'teams');

  UPDATE users SET plan = 'enterprise'
  WHERE plan IN ('enterprise-plan', 'enterprise_plan', 'business');

  UPDATE users SET plan = 'freemium'
  WHERE plan IN ('freemium-plan', 'free-trial', 'trial');

  -- Step 3: Default unknown values to 'free'
  UPDATE users SET plan = 'free'
  WHERE plan IS NULL
     OR plan = ''
     OR plan NOT IN ('free', 'freemium', 'diy', 'pro', 'agency', 'enterprise');

  RAISE NOTICE 'Plan normalization complete';
END $$;

-- ============================================================================
-- T0-15: Bidirectional Table Aliases
-- ============================================================================

-- directories <-> ai_directories
DO $$
BEGIN
  -- Direction 1: directories -> ai_directories
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'directories' AND table_type = 'BASE TABLE'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'ai_directories' AND table_type = 'BASE TABLE'
    ) THEN
      DROP VIEW IF EXISTS directories;
      CREATE VIEW directories AS SELECT * FROM ai_directories;
      RAISE NOTICE 'Created VIEW directories -> ai_directories';
    END IF;
  END IF;

  -- Direction 2: ai_directories -> directories
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'ai_directories' AND table_type = 'BASE TABLE'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'directories' AND table_type = 'BASE TABLE'
    ) THEN
      DROP VIEW IF EXISTS ai_directories;
      CREATE VIEW ai_directories AS SELECT * FROM directories;
      RAISE NOTICE 'Created VIEW ai_directories -> directories';
    END IF;
  END IF;
END $$;

-- directory_credentials <-> credential_vault
DO $$
BEGIN
  -- Direction 1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'directory_credentials' AND table_type = 'BASE TABLE'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'credential_vault' AND table_type = 'BASE TABLE'
    ) THEN
      DROP VIEW IF EXISTS directory_credentials;
      CREATE VIEW directory_credentials AS SELECT * FROM credential_vault;
      RAISE NOTICE 'Created VIEW directory_credentials -> credential_vault';
    END IF;
  END IF;

  -- Direction 2
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'credential_vault' AND table_type = 'BASE TABLE'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'directory_credentials' AND table_type = 'BASE TABLE'
    ) THEN
      DROP VIEW IF EXISTS credential_vault;
      CREATE VIEW credential_vault AS SELECT * FROM directory_credentials;
      RAISE NOTICE 'Created VIEW credential_vault -> directory_credentials';
    END IF;
  END IF;
END $$;

-- directory_submissions <-> ai_directory_submissions
DO $$
BEGIN
  -- Direction 1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'directory_submissions' AND table_type = 'BASE TABLE'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'ai_directory_submissions' AND table_type = 'BASE TABLE'
    ) THEN
      DROP VIEW IF EXISTS directory_submissions;
      CREATE VIEW directory_submissions AS SELECT * FROM ai_directory_submissions;
      RAISE NOTICE 'Created VIEW directory_submissions -> ai_directory_submissions';
    END IF;
  END IF;

  -- Direction 2
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'ai_directory_submissions' AND table_type = 'BASE TABLE'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'directory_submissions' AND table_type = 'BASE TABLE'
    ) THEN
      DROP VIEW IF EXISTS ai_directory_submissions;
      CREATE VIEW ai_directory_submissions AS SELECT * FROM directory_submissions;
      RAISE NOTICE 'Created VIEW ai_directory_submissions -> directory_submissions';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- T0-16: Directory ID Type Alignment Check
-- ============================================================================
DO $$
DECLARE
  dir_id_type TEXT;
  sub_dir_id_type TEXT;
BEGIN
  -- Get ai_directories.id type
  SELECT data_type INTO dir_id_type
  FROM information_schema.columns
  WHERE table_name = 'ai_directories' AND column_name = 'id';

  -- Get directory_submissions.directory_id type
  SELECT data_type INTO sub_dir_id_type
  FROM information_schema.columns
  WHERE table_name = 'directory_submissions' AND column_name = 'directory_id';

  IF dir_id_type IS NULL THEN
    -- Try 'directories' table instead
    SELECT data_type INTO dir_id_type
    FROM information_schema.columns
    WHERE table_name = 'directories' AND column_name = 'id';
  END IF;

  IF dir_id_type IS NULL OR sub_dir_id_type IS NULL THEN
    RAISE NOTICE 'Could not check directory ID types - tables may not exist yet';
    RETURN;
  END IF;

  RAISE NOTICE 'Directory ID type: %, Submission directory_id type: %', dir_id_type, sub_dir_id_type;

  IF dir_id_type <> sub_dir_id_type THEN
    RAISE WARNING 'TYPE MISMATCH: ai_directories.id (%) != directory_submissions.directory_id (%). FK may break!',
      dir_id_type, sub_dir_id_type;
  ELSE
    RAISE NOTICE 'Directory ID types are aligned correctly';
  END IF;
END $$;

-- ============================================================================
-- T1-3: Status Normalization
-- ============================================================================
DO $$
DECLARE
  status_counts RECORD;
  has_table BOOLEAN;
BEGIN
  -- Check if directory_submissions table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'directory_submissions'
  ) INTO has_table;

  IF NOT has_table THEN
    RAISE NOTICE 'Table directory_submissions does not exist, skipping status normalization';
    RETURN;
  END IF;

  -- Normalize legacy status values
  UPDATE directory_submissions SET status = 'action_needed' WHERE status = 'needs_action';
  UPDATE directory_submissions SET status = 'queued' WHERE status = 'pending';
  UPDATE directory_submissions SET status = 'in_progress' WHERE status = 'processing';

  RAISE NOTICE 'Status normalization complete';

  -- Log the counts
  FOR status_counts IN
    SELECT status, COUNT(*) as cnt
    FROM directory_submissions
    GROUP BY status
    ORDER BY cnt DESC
  LOOP
    RAISE NOTICE 'Status %: % rows', status_counts.status, status_counts.cnt;
  END LOOP;
END $$;

-- ============================================================================
-- Ensure stripe_events table exists for webhook idempotency (T0-9)
-- ============================================================================
CREATE TABLE IF NOT EXISTS stripe_events (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(255) UNIQUE NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  customer_id VARCHAR(255),
  subscription_id VARCHAR(255),
  event_data JSONB,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_event_id ON stripe_events(event_id);
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed ON stripe_events(processed);

-- ============================================================================
-- Migration complete
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Phase 1-3 Citation Network Foundation';
  RAISE NOTICE 'Migration completed successfully';
  RAISE NOTICE '========================================';
END $$;
