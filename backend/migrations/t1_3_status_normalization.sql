-- Migration: T1-3 Status Normalization
-- Date: 2025-01-01
-- Description: Normalizes submission status values to canonical names.
--
-- Maps:
--   needs_action -> action_needed
--   pending -> queued
--   processing -> in_progress

-- Normalize legacy status values
UPDATE directory_submissions SET status = 'action_needed' WHERE status = 'needs_action';
UPDATE directory_submissions SET status = 'queued' WHERE status = 'pending';
UPDATE directory_submissions SET status = 'in_progress' WHERE status = 'processing';

-- Log the counts
DO $$
DECLARE
  status_counts RECORD;
BEGIN
  FOR status_counts IN
    SELECT status, COUNT(*) as cnt
    FROM directory_submissions
    GROUP BY status
    ORDER BY cnt DESC
  LOOP
    RAISE NOTICE 'Status %: % rows', status_counts.status, status_counts.cnt;
  END LOOP;
END $$;
