-- Phase 4 Status Cleanup: Fix incorrectly blocked submissions
-- Run after deploying Phase 4 status handling fixes

-- A) Fix possible_match stuck in blocked → action_needed/duplicate_review
UPDATE directory_submissions
SET
  status = 'action_needed',
  action_type = 'duplicate_review',
  action_url = COALESCE(
    action_url,
    duplicate_check_evidence->>'searchUrl',
    duplicate_check_evidence->>'search_url'
  ),
  action_instructions = COALESCE(
    action_instructions,
    'Possible existing listing detected. Please verify manually.'
  ),
  blocked_reason = NULL,
  blocked_at = NULL,
  updated_at = NOW()
WHERE status = 'blocked'
  AND duplicate_check_status = 'possible_match';

-- B) Fix skipped/error stuck in blocked → action_needed/manual_submission
UPDATE directory_submissions ds
SET
  status = 'action_needed',
  action_type = COALESCE(ds.action_type, 'manual_submission'),
  action_url = COALESCE(ds.action_url, d.submission_url, d.website_url),
  action_instructions = COALESCE(
    ds.action_instructions,
    'Automatic duplicate check was ' || ds.duplicate_check_status || '. Please submit manually at ' || d.name || '.'
  ),
  blocked_reason = NULL,
  blocked_at = NULL,
  updated_at = NOW()
FROM directories d
WHERE ds.directory_id = d.id
  AND ds.status = 'blocked'
  AND ds.duplicate_check_status IN ('skipped', 'error');

-- C) Backfill any action_needed missing action_url/action_instructions
UPDATE directory_submissions ds
SET
  action_type = COALESCE(ds.action_type, 'manual_submission'),
  action_url = COALESCE(ds.action_url, d.submission_url, d.website_url),
  action_instructions = COALESCE(
    ds.action_instructions,
    'Please submit your business listing manually at ' || d.name || '.'
  ),
  updated_at = NOW()
FROM directories d
WHERE ds.directory_id = d.id
  AND ds.status = 'action_needed'
  AND (ds.action_url IS NULL OR ds.action_instructions IS NULL);

-- D) Fix low-confidence match_found stuck in blocked → action_needed/duplicate_review
UPDATE directory_submissions
SET
  status = 'action_needed',
  action_type = 'duplicate_review',
  action_url = COALESCE(
    action_url,
    duplicate_check_evidence->>'searchUrl',
    duplicate_check_evidence->>'listingUrl',
    duplicate_check_evidence->>'search_url'
  ),
  action_instructions = COALESCE(
    action_instructions,
    'Possible existing listing detected (confidence below threshold). Please verify manually.'
  ),
  blocked_reason = NULL,
  blocked_at = NULL,
  updated_at = NOW()
WHERE status = 'blocked'
  AND duplicate_check_status = 'match_found'
  AND (
    duplicate_check_evidence->>'confidence' IS NULL
    OR (duplicate_check_evidence->>'confidence')::numeric < 0.85
  );
