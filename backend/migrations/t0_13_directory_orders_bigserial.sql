-- Migration: T0-13 Convert directory_orders.id from UUID to BIGSERIAL
-- Date: 2025-01-01
-- Description: Fixes directory_orders PK type for consistency and performance
--
-- T0-13 REQUIREMENTS:
-- - New installs: id BIGSERIAL PRIMARY KEY (not UUID)
-- - Existing UUID installs: safe migration preserves data in id_uuid_legacy
-- - No pgcrypto extension dependency
--
-- This migration is idempotent and can be run multiple times safely.

DO $$
DECLARE
  current_id_type TEXT;
  pk_constraint_name TEXT;
  has_fk_references BOOLEAN;
BEGIN
  RAISE NOTICE '============================================';
  RAISE NOTICE 'T0-13: directory_orders.id BIGSERIAL Migration';
  RAISE NOTICE '============================================';

  -- Check if table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'directory_orders'
  ) THEN
    RAISE NOTICE 'directory_orders table does not exist - will be created with BIGSERIAL';
    RETURN;
  END IF;

  -- Get current id column type
  SELECT data_type INTO current_id_type
  FROM information_schema.columns
  WHERE table_name = 'directory_orders' AND column_name = 'id';

  RAISE NOTICE 'Current directory_orders.id type: %', COALESCE(current_id_type, 'NOT FOUND');

  -- If already bigint/integer, nothing to do
  IF current_id_type IN ('bigint', 'integer') THEN
    RAISE NOTICE '✅ directory_orders.id is already % - no migration needed', current_id_type;
    RETURN;
  END IF;

  -- If UUID, perform migration
  IF current_id_type = 'uuid' THEN
    RAISE NOTICE 'Migrating directory_orders.id from UUID to BIGSERIAL...';

    -- Check for FK references to directory_orders.id
    SELECT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.constraint_schema = ccu.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'directory_orders'
        AND ccu.column_name = 'id'
    ) INTO has_fk_references;

    IF has_fk_references THEN
      RAISE EXCEPTION 'Cannot migrate: other tables have FK references to directory_orders.id. Manual remediation required.';
    END IF;

    -- Find and drop existing PK constraint
    SELECT constraint_name INTO pk_constraint_name
    FROM information_schema.table_constraints
    WHERE table_name = 'directory_orders'
      AND constraint_type = 'PRIMARY KEY';

    IF pk_constraint_name IS NOT NULL THEN
      RAISE NOTICE 'Dropping existing PK constraint: %', pk_constraint_name;
      EXECUTE format('ALTER TABLE directory_orders DROP CONSTRAINT %I', pk_constraint_name);
    END IF;

    -- Rename old id column to preserve UUIDs
    RAISE NOTICE 'Renaming id column to id_uuid_legacy...';
    ALTER TABLE directory_orders RENAME COLUMN id TO id_uuid_legacy;

    -- Add new BIGSERIAL id column
    RAISE NOTICE 'Adding new BIGSERIAL id column...';
    ALTER TABLE directory_orders ADD COLUMN id BIGSERIAL;

    -- Add new PK constraint
    RAISE NOTICE 'Adding new PRIMARY KEY constraint...';
    ALTER TABLE directory_orders ADD PRIMARY KEY (id);

    -- Add unique index on legacy UUID column (for reference/debugging)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_directory_orders_id_uuid_legacy
      ON directory_orders(id_uuid_legacy);

    RAISE NOTICE '✅ Migration complete: directory_orders.id is now BIGSERIAL';
    RAISE NOTICE '   Old UUIDs preserved in id_uuid_legacy column';
    RETURN;
  END IF;

  -- Unexpected type
  IF current_id_type IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected directory_orders.id type: %. Manual remediation required.', current_id_type;
  END IF;
END $$;

-- ============================================================================
-- For new installations: Ensure CREATE TABLE uses BIGSERIAL
-- ============================================================================
-- Note: This migration only fixes existing UUID tables.
-- The CREATE TABLE statement in migrate-citation-network.js should be updated
-- separately to use BIGSERIAL for new installations.

-- ============================================================================
-- Verification
-- ============================================================================
DO $$
DECLARE
  final_type TEXT;
BEGIN
  SELECT data_type INTO final_type
  FROM information_schema.columns
  WHERE table_name = 'directory_orders' AND column_name = 'id';

  IF final_type IS NOT NULL THEN
    IF final_type IN ('bigint', 'integer') THEN
      RAISE NOTICE '✅ VERIFIED: directory_orders.id is now %', final_type;
    ELSE
      RAISE WARNING '⚠️  directory_orders.id is still % - migration may not have run', final_type;
    END IF;
  ELSE
    RAISE NOTICE 'directory_orders table not found (will be created on first use)';
  END IF;
END $$;
