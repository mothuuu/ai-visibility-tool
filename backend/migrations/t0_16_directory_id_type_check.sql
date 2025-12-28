-- Migration: T0-16 Directory ID Type Alignment Check
-- Date: 2025-01-01
-- Description: Checks that ai_directories.id and directory_submissions.directory_id
--              have matching types. Type mismatch will cause FK failures.
--
-- NOTE: This migration only CHECKS and WARNS. Manual intervention may be needed
--       if types don't match.

DO $$
DECLARE
  dir_id_type TEXT;
  sub_dir_id_type TEXT;
BEGIN
  -- Get ai_directories.id type
  SELECT data_type INTO dir_id_type
  FROM information_schema.columns
  WHERE table_name = 'ai_directories' AND column_name = 'id';

  -- Try 'directories' table if ai_directories doesn't exist
  IF dir_id_type IS NULL THEN
    SELECT data_type INTO dir_id_type
    FROM information_schema.columns
    WHERE table_name = 'directories' AND column_name = 'id';
  END IF;

  -- Get directory_submissions.directory_id type
  SELECT data_type INTO sub_dir_id_type
  FROM information_schema.columns
  WHERE table_name = 'directory_submissions' AND column_name = 'directory_id';

  RAISE NOTICE 'T0-16 Type Check:';
  RAISE NOTICE '  directories.id type: %', COALESCE(dir_id_type, 'NOT FOUND');
  RAISE NOTICE '  directory_submissions.directory_id type: %', COALESCE(sub_dir_id_type, 'NOT FOUND');

  -- Check for mismatch
  IF dir_id_type IS NOT NULL AND sub_dir_id_type IS NOT NULL THEN
    IF dir_id_type IS DISTINCT FROM sub_dir_id_type THEN
      RAISE WARNING '⚠️  TYPE MISMATCH: directories.id (%) != directory_submissions.directory_id (%). Manual intervention may be required.', dir_id_type, sub_dir_id_type;
    ELSE
      RAISE NOTICE '✅ Types match: %', dir_id_type;
    END IF;
  ELSIF dir_id_type IS NULL AND sub_dir_id_type IS NULL THEN
    RAISE NOTICE 'Neither table exists yet - will be created with matching types';
  ELSIF dir_id_type IS NULL THEN
    RAISE NOTICE 'directories table does not exist yet';
  ELSE
    RAISE NOTICE 'directory_submissions table does not exist yet';
  END IF;
END $$;
