-- Rollback for Migration 020: Visibility Profiles
--
-- Drops the trigger and table created by this migration.
-- The update_updated_at_column() function is intentionally NOT dropped: it
-- pre-existed (created in 000_infrastructure.sql) and is shared by other tables.

DROP TRIGGER IF EXISTS trg_visibility_profiles_updated_at ON visibility_profiles;
DROP TABLE IF EXISTS visibility_profiles;
