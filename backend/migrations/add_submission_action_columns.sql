-- Migration: Add missing directory_submissions columns for submission worker
-- Date: 2025-12-27
-- Description: Add action columns needed by submission worker

-- ============================================================================
-- Add missing columns to directory_submissions table
-- ============================================================================

-- Action type (what kind of action is needed)
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS action_type VARCHAR(50);

-- Action instructions (what the user needs to do)
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS action_instructions TEXT;

-- Action URL (where to complete the action)
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS action_url TEXT;

-- Action deadline (when the action expires)
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS action_deadline TIMESTAMP;

-- Action required at (when action was first required)
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS action_required_at TIMESTAMP;

-- Started at (when worker picked up the submission)
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;

-- Failed at (when submission failed)
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;

-- Blocked at (when submission was blocked)
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMP;

-- Blocked reason
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

-- Error code for programmatic handling
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS error_code VARCHAR(50);

-- Error message for display
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Retry count
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Queue position
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS queue_position INTEGER;

-- Submitted at
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP;

-- Live at
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS live_at TIMESTAMP;

-- Verified at
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;

-- Listing URL (the live listing URL)
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS listing_url TEXT;

-- ============================================================================
-- Reset failed submissions so worker can retry with new schema
-- ============================================================================

UPDATE directory_submissions
SET status = 'queued',
    error_message = NULL,
    error_code = NULL,
    retry_count = 0,
    failed_at = NULL,
    started_at = NULL
WHERE status = 'failed'
  OR status = 'in_progress';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'directory_submissions' AND column_name = 'action_type'
  ) THEN
    RAISE WARNING 'action_type column was not created';
  END IF;
END $$;
