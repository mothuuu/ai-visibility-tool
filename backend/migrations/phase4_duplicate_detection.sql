-- Phase 4: Duplicate Detection Migration
-- Date: 2025-12-30
-- Description: Add columns to directory_submissions for storing duplicate check outcomes
--
-- Outcomes:
--   match_found: Confident duplicate exists - can mark already_listed
--   no_match: No duplicate found - eligible for submission
--   possible_match: Ambiguous result - do not queue, do not consume entitlement
--   error: Check failed - do not queue, do not consume entitlement
--   skipped: Check not performed (e.g., site_search not supported) - do not queue

-- ============================================================================
-- Add duplicate check columns to directory_submissions
-- ============================================================================

-- Status of the duplicate check (tri-state outcome)
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS duplicate_check_status VARCHAR(50);

-- Evidence/proof for the duplicate check outcome
-- Schema: { search_url, match_reason, excerpt, confidence, method, checked_at, response_time_ms }
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS duplicate_check_evidence JSONB;

-- URL of the existing listing (if found)
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS existing_listing_url TEXT;

-- Timestamp when duplicate check was performed
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS duplicate_checked_at TIMESTAMP;

-- ============================================================================
-- Add CHECK constraint for duplicate_check_status enum
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_duplicate_check_status') THEN
    ALTER TABLE directory_submissions ADD CONSTRAINT chk_duplicate_check_status
      CHECK (duplicate_check_status IS NULL OR duplicate_check_status IN (
        'match_found',
        'no_match',
        'possible_match',
        'error',
        'skipped'
      ));
  END IF;
END $$;

-- ============================================================================
-- Create index for querying by duplicate check status
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_submissions_duplicate_check_status
ON directory_submissions(duplicate_check_status)
WHERE duplicate_check_status IS NOT NULL;

-- Index for finding already_listed submissions efficiently
CREATE INDEX IF NOT EXISTS idx_submissions_already_listed
ON directory_submissions(status, user_id)
WHERE status = 'already_listed';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  col_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'directory_submissions'
    AND column_name IN ('duplicate_check_status', 'duplicate_check_evidence', 'existing_listing_url', 'duplicate_checked_at');

  IF col_count = 4 THEN
    RAISE NOTICE 'Phase 4 Duplicate Detection migration completed successfully. All 4 columns added.';
  ELSE
    RAISE WARNING 'Phase 4 migration incomplete. Expected 4 columns, found %', col_count;
  END IF;
END $$;
