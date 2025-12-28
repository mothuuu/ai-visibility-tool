-- Migration: T0-15 Bidirectional Table Aliases
-- Date: 2025-01-01
-- Description: Creates bidirectional VIEW aliases for table names that may differ
--              between environments (e.g., directories <-> ai_directories).
--
-- CRITICAL: Only creating VIEW in one direction breaks the other direction.
-- This migration creates both directions.

-- ============================================================================
-- directories <-> ai_directories (BIDIRECTIONAL)
-- ============================================================================
DO $$
BEGIN
  -- Direction 1: If 'directories' doesn't exist as BASE TABLE but 'ai_directories' does
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'directories' AND table_type = 'BASE TABLE'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'ai_directories' AND table_type = 'BASE TABLE'
    ) THEN
      -- Drop any existing view first
      DROP VIEW IF EXISTS directories;
      CREATE VIEW directories AS SELECT * FROM ai_directories;
      RAISE NOTICE 'Created VIEW directories -> ai_directories';
    END IF;
  END IF;

  -- Direction 2 (REVERSE): If 'ai_directories' doesn't exist as BASE TABLE but 'directories' does
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'ai_directories' AND table_type = 'BASE TABLE'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'directories' AND table_type = 'BASE TABLE'
    ) THEN
      -- Drop any existing view first
      DROP VIEW IF EXISTS ai_directories;
      CREATE VIEW ai_directories AS SELECT * FROM directories;
      RAISE NOTICE 'Created VIEW ai_directories -> directories';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- directory_credentials <-> credential_vault (BIDIRECTIONAL)
-- ============================================================================
DO $$
BEGIN
  -- Direction 1: If 'directory_credentials' doesn't exist as BASE TABLE but 'credential_vault' does
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'directory_credentials' AND table_type = 'BASE TABLE'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'credential_vault' AND table_type = 'BASE TABLE'
    ) THEN
      DROP VIEW IF EXISTS directory_credentials;
      CREATE VIEW directory_credentials AS SELECT * FROM credential_vault;
      RAISE NOTICE 'Created VIEW directory_credentials -> credential_vault';
    END IF;
  END IF;

  -- Direction 2 (REVERSE): If 'credential_vault' doesn't exist as BASE TABLE but 'directory_credentials' does
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'credential_vault' AND table_type = 'BASE TABLE'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'directory_credentials' AND table_type = 'BASE TABLE'
    ) THEN
      DROP VIEW IF EXISTS credential_vault;
      CREATE VIEW credential_vault AS SELECT * FROM directory_credentials;
      RAISE NOTICE 'Created VIEW credential_vault -> directory_credentials';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- directory_submissions <-> ai_directory_submissions (BIDIRECTIONAL)
-- ============================================================================
DO $$
BEGIN
  -- Direction 1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'directory_submissions' AND table_type = 'BASE TABLE'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'ai_directory_submissions' AND table_type = 'BASE TABLE'
    ) THEN
      DROP VIEW IF EXISTS directory_submissions;
      CREATE VIEW directory_submissions AS SELECT * FROM ai_directory_submissions;
      RAISE NOTICE 'Created VIEW directory_submissions -> ai_directory_submissions';
    END IF;
  END IF;

  -- Direction 2 (REVERSE)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'ai_directory_submissions' AND table_type = 'BASE TABLE'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'directory_submissions' AND table_type = 'BASE TABLE'
    ) THEN
      DROP VIEW IF EXISTS ai_directory_submissions;
      CREATE VIEW ai_directory_submissions AS SELECT * FROM directory_submissions;
      RAISE NOTICE 'Created VIEW ai_directory_submissions -> directory_submissions';
    END IF;
  END IF;
END $$;
