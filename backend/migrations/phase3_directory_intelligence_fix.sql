-- Phase 3 Fix: Make intelligence columns nullable + enforce search_type enum
-- Safe to run on existing data
-- Date: 2025-12-29

-- ============================================================================
-- 1) Remove DEFAULTs from columns (make truly nullable)
-- ============================================================================

ALTER TABLE directories ALTER COLUMN search_type DROP DEFAULT;
ALTER TABLE directories ALTER COLUMN requires_captcha DROP DEFAULT;
ALTER TABLE directories ALTER COLUMN requires_email_verification DROP DEFAULT;
ALTER TABLE directories ALTER COLUMN requires_payment DROP DEFAULT;

-- ============================================================================
-- 2) Revert auto-defaulted values back to NULL
-- Only affects rows that got default values from the original migration
-- Directories with intentionally set values will be re-populated by backfill
-- ============================================================================

UPDATE directories SET search_type = NULL WHERE search_type = 'none';
UPDATE directories SET requires_captcha = NULL WHERE requires_captcha = false;
UPDATE directories SET requires_email_verification = NULL WHERE requires_email_verification = false;
UPDATE directories SET requires_payment = NULL WHERE requires_payment = false;

-- ============================================================================
-- 3) Add CHECK constraint for search_type enum (allow NULL)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_directories_search_type') THEN
    ALTER TABLE directories ADD CONSTRAINT chk_directories_search_type
      CHECK (search_type IS NULL OR search_type IN ('none', 'site_search', 'internal_search', 'api_search'));
  END IF;
END $$;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM directories WHERE search_type IS NULL;
  RAISE NOTICE 'Phase 3 Fix complete. Directories with NULL search_type: %', null_count;
END $$;
