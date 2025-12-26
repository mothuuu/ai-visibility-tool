-- Migration: Add missing campaign_runs columns
-- Date: 2025-12-26
-- Description: Add columns needed by submission worker

-- ============================================================================
-- Add missing columns to campaign_runs table
-- ============================================================================

-- Track submissions currently being processed
ALTER TABLE campaign_runs
ADD COLUMN IF NOT EXISTS directories_in_progress INTEGER DEFAULT 0;

-- Track submissions that need user action
ALTER TABLE campaign_runs
ADD COLUMN IF NOT EXISTS directories_action_needed INTEGER DEFAULT 0;

-- Track failed submissions
ALTER TABLE campaign_runs
ADD COLUMN IF NOT EXISTS directories_failed INTEGER DEFAULT 0;

-- Track submitted (completed) submissions
ALTER TABLE campaign_runs
ADD COLUMN IF NOT EXISTS directories_submitted INTEGER DEFAULT 0;

-- Track live/verified submissions
ALTER TABLE campaign_runs
ADD COLUMN IF NOT EXISTS directories_live INTEGER DEFAULT 0;

-- ============================================================================
-- Sync counts with actual submission statuses (for existing campaigns)
-- ============================================================================

UPDATE campaign_runs cr
SET
  directories_in_progress = COALESCE((
    SELECT COUNT(*) FROM directory_submissions ds
    WHERE ds.campaign_run_id = cr.id AND ds.status = 'in_progress'
  ), 0),
  directories_action_needed = COALESCE((
    SELECT COUNT(*) FROM directory_submissions ds
    WHERE ds.campaign_run_id = cr.id AND ds.status IN ('action_needed', 'needs_action')
  ), 0),
  directories_failed = COALESCE((
    SELECT COUNT(*) FROM directory_submissions ds
    WHERE ds.campaign_run_id = cr.id AND ds.status = 'failed'
  ), 0),
  directories_submitted = COALESCE((
    SELECT COUNT(*) FROM directory_submissions ds
    WHERE ds.campaign_run_id = cr.id AND ds.status = 'submitted'
  ), 0),
  directories_live = COALESCE((
    SELECT COUNT(*) FROM directory_submissions ds
    WHERE ds.campaign_run_id = cr.id AND ds.status IN ('live', 'verified')
  ), 0)
WHERE EXISTS (SELECT 1 FROM directory_submissions WHERE campaign_run_id = cr.id);

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaign_runs' AND column_name = 'directories_in_progress'
  ) THEN
    RAISE WARNING 'directories_in_progress column was not created';
  END IF;
END $$;
