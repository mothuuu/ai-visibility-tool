-- Migration: P3 Schema Portability + FK Type Validation
-- Date: 2025-01-01
-- Description: Comprehensive schema fixes for Tier-0 tables
--
-- P3 REQUIREMENTS:
-- - FIX 8: FK type matching with FAIL LOUDLY on mismatch (T0-3, T0-13)
-- - FIX 10: Status normalization for directory_submissions
-- - FIX 11: Add expires_at to directory_orders
-- - FIX 12: Unique seatbelt on directory_submissions
--
-- NOTE: FIX 7 (migration mechanism), FIX 9 (enum-safe plan) already done in existing migrations.
--       FIX 10 alias views already done in t0_15_bidirectional_table_aliases.sql
--
-- This migration is idempotent and can be run multiple times safely.

-- ============================================================================
-- FIX 8: FK TYPE MATCHING WITH FAIL LOUDLY
-- ============================================================================
-- Validates that FK columns match their referenced PK types.
-- RAISES EXCEPTION on mismatch (not just WARNING).

DO $$
DECLARE
  users_id_type TEXT;
  directories_id_type TEXT;
  campaign_runs_id_type TEXT;
  fk_type TEXT;
  base_table_name TEXT;
  v_table_type TEXT;
BEGIN
  RAISE NOTICE '============================================';
  RAISE NOTICE 'P3 FIX 8: FK Type Matching Validation';
  RAISE NOTICE '============================================';

  -- =========================================================================
  -- Step 1: Get users.id type (always needed)
  -- =========================================================================
  SELECT data_type INTO users_id_type
  FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'id';

  IF users_id_type IS NULL THEN
    RAISE EXCEPTION 'CRITICAL: users table does not exist or has no id column!';
  END IF;

  RAISE NOTICE 'users.id type: %', users_id_type;

  -- =========================================================================
  -- Step 2: Determine directories base table (may be VIEW)
  -- =========================================================================
  SELECT table_type INTO v_table_type
  FROM information_schema.tables
  WHERE table_name = 'directories';

  IF v_table_type = 'VIEW' THEN
    -- directories is a VIEW, check if ai_directories is the base table
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'ai_directories' AND table_type = 'BASE TABLE'
    ) THEN
      base_table_name := 'ai_directories';
      RAISE NOTICE 'directories is VIEW → base table is ai_directories';
    ELSE
      RAISE EXCEPTION 'directories is VIEW but ai_directories BASE TABLE not found!';
    END IF;
  ELSIF v_table_type = 'BASE TABLE' THEN
    base_table_name := 'directories';
    RAISE NOTICE 'directories is BASE TABLE';
  ELSE
    -- Neither exists yet - this is OK for fresh installs
    RAISE NOTICE 'directories table does not exist yet (will be created)';
    base_table_name := NULL;
  END IF;

  -- Get directories.id type from the base table
  IF base_table_name IS NOT NULL THEN
    EXECUTE format('SELECT data_type FROM information_schema.columns WHERE table_name = %L AND column_name = ''id''', base_table_name)
    INTO directories_id_type;
    RAISE NOTICE '%.id type: %', base_table_name, COALESCE(directories_id_type, 'NOT FOUND');
  END IF;

  -- Get campaign_runs.id type
  SELECT data_type INTO campaign_runs_id_type
  FROM information_schema.columns
  WHERE table_name = 'campaign_runs' AND column_name = 'id';

  RAISE NOTICE 'campaign_runs.id type: %', COALESCE(campaign_runs_id_type, 'NOT FOUND');

  -- =========================================================================
  -- Step 3: Validate FK columns match their referenced types
  -- =========================================================================

  -- Check business_profiles.user_id → users.id
  SELECT data_type INTO fk_type
  FROM information_schema.columns
  WHERE table_name = 'business_profiles' AND column_name = 'user_id';

  IF fk_type IS NOT NULL AND fk_type IS DISTINCT FROM users_id_type THEN
    RAISE EXCEPTION 'TYPE MISMATCH: business_profiles.user_id (%) != users.id (%). FK will break!',
      fk_type, users_id_type;
  END IF;

  -- Check subscriber_directory_allocations.user_id → users.id
  SELECT data_type INTO fk_type
  FROM information_schema.columns
  WHERE table_name = 'subscriber_directory_allocations' AND column_name = 'user_id';

  IF fk_type IS NOT NULL AND fk_type IS DISTINCT FROM users_id_type THEN
    RAISE EXCEPTION 'TYPE MISMATCH: subscriber_directory_allocations.user_id (%) != users.id (%). FK will break!',
      fk_type, users_id_type;
  END IF;

  -- Check campaign_runs.user_id → users.id
  SELECT data_type INTO fk_type
  FROM information_schema.columns
  WHERE table_name = 'campaign_runs' AND column_name = 'user_id';

  IF fk_type IS NOT NULL AND fk_type IS DISTINCT FROM users_id_type THEN
    RAISE EXCEPTION 'TYPE MISMATCH: campaign_runs.user_id (%) != users.id (%). FK will break!',
      fk_type, users_id_type;
  END IF;

  -- Check credential_vault.user_id → users.id
  SELECT data_type INTO fk_type
  FROM information_schema.columns
  WHERE table_name = 'credential_vault' AND column_name = 'user_id';

  IF fk_type IS NOT NULL AND fk_type IS DISTINCT FROM users_id_type THEN
    RAISE EXCEPTION 'TYPE MISMATCH: credential_vault.user_id (%) != users.id (%). FK will break!',
      fk_type, users_id_type;
  END IF;

  -- Check directory_orders.user_id → users.id
  SELECT data_type INTO fk_type
  FROM information_schema.columns
  WHERE table_name = 'directory_orders' AND column_name = 'user_id';

  IF fk_type IS NOT NULL AND fk_type IS DISTINCT FROM users_id_type THEN
    RAISE EXCEPTION 'TYPE MISMATCH: directory_orders.user_id (%) != users.id (%). FK will break!',
      fk_type, users_id_type;
  END IF;

  -- Check directory_submissions.user_id → users.id
  SELECT data_type INTO fk_type
  FROM information_schema.columns
  WHERE table_name = 'directory_submissions' AND column_name = 'user_id';

  IF fk_type IS NOT NULL AND fk_type IS DISTINCT FROM users_id_type THEN
    RAISE EXCEPTION 'TYPE MISMATCH: directory_submissions.user_id (%) != users.id (%). FK will break!',
      fk_type, users_id_type;
  END IF;

  -- Check directory_submissions.directory_id → directories.id
  IF directories_id_type IS NOT NULL THEN
    SELECT data_type INTO fk_type
    FROM information_schema.columns
    WHERE table_name = 'directory_submissions' AND column_name = 'directory_id';

    IF fk_type IS NOT NULL AND fk_type IS DISTINCT FROM directories_id_type THEN
      RAISE EXCEPTION 'TYPE MISMATCH: directory_submissions.directory_id (%) != %.id (%). FK will break!',
        fk_type, base_table_name, directories_id_type;
    END IF;
  END IF;

  -- Check directory_submissions.campaign_run_id → campaign_runs.id
  IF campaign_runs_id_type IS NOT NULL THEN
    SELECT data_type INTO fk_type
    FROM information_schema.columns
    WHERE table_name = 'directory_submissions' AND column_name = 'campaign_run_id';

    IF fk_type IS NOT NULL AND fk_type IS DISTINCT FROM campaign_runs_id_type THEN
      RAISE EXCEPTION 'TYPE MISMATCH: directory_submissions.campaign_run_id (%) != campaign_runs.id (%). FK will break!',
        fk_type, campaign_runs_id_type;
    END IF;
  END IF;

  RAISE NOTICE '✅ All FK types validated successfully';
END $$;

-- ============================================================================
-- FIX 10 (partial): Status normalization for directory_submissions
-- ============================================================================
-- Normalize legacy status values to canonical forms:
-- - needs_action → action_needed
-- - pending → queued
-- - processing → in_progress

DO $$
BEGIN
  -- Only run if directory_submissions table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'directory_submissions' AND table_type IN ('BASE TABLE', 'VIEW')
  ) THEN
    RAISE NOTICE 'Normalizing directory_submissions status values...';

    -- needs_action → action_needed
    UPDATE directory_submissions
    SET status = 'action_needed', updated_at = NOW()
    WHERE status = 'needs_action';

    -- pending → queued
    UPDATE directory_submissions
    SET status = 'queued', updated_at = NOW()
    WHERE status = 'pending';

    -- processing → in_progress
    UPDATE directory_submissions
    SET status = 'in_progress', updated_at = NOW()
    WHERE status = 'processing';

    RAISE NOTICE '✅ Status normalization complete';
  ELSE
    RAISE NOTICE 'directory_submissions table does not exist, skipping status normalization';
  END IF;
END $$;

-- ============================================================================
-- FIX 11: Add expires_at to directory_orders
-- ============================================================================
ALTER TABLE directory_orders
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

COMMENT ON COLUMN directory_orders.expires_at IS 'Order expiration timestamp (for time-limited offers)';

-- ============================================================================
-- FIX 12: Unique seatbelt on directory_submissions
-- ============================================================================
-- Prevents duplicate submissions for same user+directory combination.
-- Partial index excludes failed/skipped/cancelled submissions.

CREATE UNIQUE INDEX IF NOT EXISTS idx_directory_submissions_user_directory_unique
ON directory_submissions(user_id, directory_id)
WHERE status NOT IN ('failed', 'skipped', 'cancelled', 'blocked', 'rejected');

COMMENT ON INDEX idx_directory_submissions_user_directory_unique IS
  'Prevents duplicate active submissions for same user+directory (T0-12)';

-- Also create a non-unique index for lookup performance (if not exists)
CREATE INDEX IF NOT EXISTS idx_directory_submissions_user_directory
ON directory_submissions(user_id, directory_id);

-- ============================================================================
-- Verify request_id column exists on campaign_runs (from P2 migration)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaign_runs' AND column_name = 'request_id'
  ) THEN
    -- Add it if missing (P2 migration may not have run yet)
    ALTER TABLE campaign_runs ADD COLUMN request_id VARCHAR(255);
    RAISE NOTICE 'Added request_id column to campaign_runs';
  ELSE
    RAISE NOTICE 'campaign_runs.request_id already exists';
  END IF;
END $$;

-- Ensure unique index exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_runs_user_request_id
ON campaign_runs(user_id, request_id)
WHERE request_id IS NOT NULL;

-- ============================================================================
-- Summary
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'P3 Schema Portability Migration';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'FIX 8: FK type validation - PASSED';
  RAISE NOTICE 'FIX 10: Status normalization - DONE';
  RAISE NOTICE 'FIX 11: expires_at column - ADDED';
  RAISE NOTICE 'FIX 12: Unique seatbelt - CREATED';
  RAISE NOTICE 'Migration completed successfully';
  RAISE NOTICE '========================================';
END $$;
