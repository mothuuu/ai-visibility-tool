-- Phase 4: Duplicate Detection - Evidence + Status support
-- Additive only. Postgres.

-- Columns
ALTER TABLE directory_submissions
  ADD COLUMN IF NOT EXISTS listing_url TEXT;

ALTER TABLE directory_submissions
  ADD COLUMN IF NOT EXISTS listing_found_at TIMESTAMP;

ALTER TABLE directory_submissions
  ADD COLUMN IF NOT EXISTS duplicate_check_performed_at TIMESTAMP;

ALTER TABLE directory_submissions
  ADD COLUMN IF NOT EXISTS duplicate_check_method VARCHAR(50);

ALTER TABLE directory_submissions
  ADD COLUMN IF NOT EXISTS duplicate_check_status VARCHAR(50);

ALTER TABLE directory_submissions
  ADD COLUMN IF NOT EXISTS duplicate_check_evidence JSONB;

-- CHECK: duplicate_check_method
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_directory_submissions_dupe_method') THEN
    ALTER TABLE directory_submissions ADD CONSTRAINT chk_directory_submissions_dupe_method
      CHECK (
        duplicate_check_method IS NULL OR
        duplicate_check_method IN ('internal_search', 'api_search', 'site_search', 'manual', 'skipped', 'error')
      );
  END IF;
END $$;

-- CHECK: duplicate_check_status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_directory_submissions_dupe_status') THEN
    ALTER TABLE directory_submissions ADD CONSTRAINT chk_directory_submissions_dupe_status
      CHECK (
        duplicate_check_status IS NULL OR
        duplicate_check_status IN ('not_checked', 'no_match', 'possible_match', 'match_found', 'skipped', 'error')
      );
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_directory_submissions_listing_url
  ON directory_submissions(listing_url)
  WHERE listing_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_directory_submissions_dupe_status
  ON directory_submissions(duplicate_check_status)
  WHERE duplicate_check_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_directory_submissions_status_already_listed
  ON directory_submissions(status)
  WHERE status = 'already_listed';

-- Update existing status CHECK constraint (if present) to include 'already_listed'
DO $$
DECLARE
  c RECORD;
  constraint_def TEXT;
BEGIN
  FOR c IN
    SELECT conname, pg_get_constraintdef(pg_constraint.oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'directory_submissions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(pg_constraint.oid) ILIKE '%status%'
      AND pg_get_constraintdef(pg_constraint.oid) NOT ILIKE '%duplicate_check_status%'
  LOOP
    constraint_def := c.def;

    -- Only handle constraints that look like an IN (...) list on status
    IF constraint_def ILIKE '%status%IN%' AND constraint_def NOT ILIKE '%already_listed%' THEN
      EXECUTE format('ALTER TABLE directory_submissions DROP CONSTRAINT %I', c.conname);

      EXECUTE
        'ALTER TABLE directory_submissions ADD CONSTRAINT ' || quote_ident(c.conname) || ' ' ||
        regexp_replace(constraint_def, '\)\s*$', ', ''already_listed'')', 1, 1);

      RAISE NOTICE 'Updated status CHECK constraint % to include already_listed', c.conname;
    END IF;
  END LOOP;
END $$;
