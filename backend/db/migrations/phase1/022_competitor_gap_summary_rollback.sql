-- Rollback for Migration 022: competitor-gap summary
ALTER TABLE visibility_profiles
  DROP COLUMN IF EXISTS competitor_gap_summary;
