-- Migration: P2 Request ID Idempotency
-- Date: 2025-01-01
-- Description: Add request_id column for campaign idempotency (T0-7, T0-8)
--
-- P2 REQUIREMENTS:
-- - T0-7: request_id column for duplicate request prevention
-- - T0-8: Unique index for atomic idempotency check
--
-- This migration is idempotent and can be run multiple times safely.

-- ============================================================================
-- 1. Add request_id column to campaign_runs (T0-7)
-- ============================================================================
ALTER TABLE campaign_runs
ADD COLUMN IF NOT EXISTS request_id VARCHAR(255);

COMMENT ON COLUMN campaign_runs.request_id IS 'Idempotency key for duplicate request prevention (T0-7)';

-- ============================================================================
-- 2. Create unique partial index for idempotency (T0-8)
-- ============================================================================
-- This index enables atomic duplicate detection:
-- INSERT will fail with unique constraint violation if same user submits
-- same request_id, preventing double-spend race conditions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_runs_user_request_id
ON campaign_runs(user_id, request_id)
WHERE request_id IS NOT NULL;

-- ============================================================================
-- 3. Create index for active campaign lookup optimization
-- ============================================================================
-- Used by getActiveCampaignWithLock for efficient filtering
CREATE INDEX IF NOT EXISTS idx_campaign_runs_user_active_status
ON campaign_runs(user_id, status)
WHERE status IN ('created', 'selecting', 'queued', 'in_progress', 'paused');

-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
  -- Verify request_id column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaign_runs' AND column_name = 'request_id'
  ) THEN
    RAISE WARNING 'request_id column was not created on campaign_runs';
  END IF;

  -- Verify unique index exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'campaign_runs' AND indexname = 'idx_campaign_runs_user_request_id'
  ) THEN
    RAISE WARNING 'idx_campaign_runs_user_request_id index was not created';
  END IF;

  RAISE NOTICE '======================================';
  RAISE NOTICE 'P2 Request ID Idempotency Migration';
  RAISE NOTICE 'Completed successfully';
  RAISE NOTICE '======================================';
END $$;
