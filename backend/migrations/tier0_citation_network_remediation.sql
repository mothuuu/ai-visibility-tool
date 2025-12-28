-- Migration: Tier-0 Citation Network Remediation
-- Date: 2025-01-01
-- Description: Fixes all Tier-0 gaps identified in AUDIT_PHASE1-3_CITATION_NETWORK.md
--
-- This migration is idempotent and can be run multiple times safely.
--
-- TIER-0 RULES ADDRESSED:
--   Rule 4:  Orders remain status='paid' forever (migrate legacy statuses)
--   Rule 5:  UPSERT support via UNIQUE constraint on stripe_checkout_session_id
--   Rule 12: Add pack_type column for PACK_CONFIG lookup
--   Rule 13: Allow NULL stripe_payment_intent_id for async payments
--   Rule 16: BIGSERIAL for PKs, FK columns match referenced PK type

-- ============================================================================
-- 1. Add pack_type column to directory_orders (Rule 12)
-- ============================================================================
ALTER TABLE directory_orders
ADD COLUMN IF NOT EXISTS pack_type VARCHAR(50);

-- Backfill pack_type from order_type for existing records
UPDATE directory_orders
SET pack_type = CASE
  WHEN order_type = 'pack' THEN 'boost'
  WHEN order_type = 'starter' THEN 'starter'
  ELSE order_type
END
WHERE pack_type IS NULL;

-- ============================================================================
-- 2. Add UNIQUE constraint on stripe_checkout_session_id (Rule 5 - UPSERT)
-- ============================================================================
-- Drop existing constraint if name differs
DO $$
BEGIN
  -- Create unique index if not exists (idempotent)
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'directory_orders'
    AND indexname = 'directory_orders_stripe_checkout_session_id_key'
  ) THEN
    -- Check if any constraint exists on this column
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'directory_orders'
        AND ccu.column_name = 'stripe_checkout_session_id'
        AND tc.constraint_type = 'UNIQUE'
    ) THEN
      ALTER TABLE directory_orders
      ADD CONSTRAINT directory_orders_stripe_checkout_session_id_key
      UNIQUE (stripe_checkout_session_id);
      RAISE NOTICE 'Added UNIQUE constraint on stripe_checkout_session_id';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 3. Ensure stripe_payment_intent_id allows NULL (Rule 13)
-- ============================================================================
-- This is typically already nullable, but ensure it is
DO $$
DECLARE
  col_nullable TEXT;
BEGIN
  SELECT is_nullable INTO col_nullable
  FROM information_schema.columns
  WHERE table_name = 'directory_orders'
    AND column_name = 'stripe_payment_intent_id';

  IF col_nullable = 'NO' THEN
    ALTER TABLE directory_orders
    ALTER COLUMN stripe_payment_intent_id DROP NOT NULL;
    RAISE NOTICE 'Made stripe_payment_intent_id nullable';
  END IF;
END $$;

-- ============================================================================
-- 4. Add processed_at column to stripe_events (Rule 6)
-- ============================================================================
ALTER TABLE stripe_events
ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;

-- ============================================================================
-- 5. Migrate legacy order statuses to 'paid' (Rule 4)
-- ============================================================================
-- Orders that are 'processing', 'in_progress', or 'completed' should be 'paid'
-- per Rule 4: Orders remain status='paid' forever once paid.
UPDATE directory_orders
SET status = 'paid',
    updated_at = NOW()
WHERE status IN ('processing', 'in_progress', 'completed');

-- Log how many were migrated
DO $$
DECLARE
  migrated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO migrated_count
  FROM directory_orders
  WHERE status = 'paid';

  RAISE NOTICE 'Migrated orders to paid status. Total paid orders: %', migrated_count;
END $$;

-- ============================================================================
-- 6. Add directories_submitted column if missing (usage tracking)
-- ============================================================================
ALTER TABLE directory_orders
ADD COLUMN IF NOT EXISTS directories_submitted INTEGER NOT NULL DEFAULT 0;

-- ============================================================================
-- 7. Ensure stripe_events has user_id column
-- ============================================================================
DO $$
DECLARE
  user_id_type TEXT;
BEGIN
  -- Get the data type of users.id for FK compatibility
  SELECT data_type INTO user_id_type
  FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'id';

  -- Check if stripe_events.user_id exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stripe_events' AND column_name = 'user_id'
  ) THEN
    IF user_id_type = 'integer' THEN
      ALTER TABLE stripe_events ADD COLUMN user_id INTEGER;
    ELSIF user_id_type = 'bigint' THEN
      ALTER TABLE stripe_events ADD COLUMN user_id BIGINT;
    ELSIF user_id_type = 'uuid' THEN
      ALTER TABLE stripe_events ADD COLUMN user_id UUID;
    ELSE
      ALTER TABLE stripe_events ADD COLUMN user_id INTEGER;
    END IF;
    RAISE NOTICE 'Added user_id column to stripe_events with type %', user_id_type;
  END IF;
END $$;

-- ============================================================================
-- 8. Create indexes for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_directory_orders_user_status
ON directory_orders(user_id, status);

CREATE INDEX IF NOT EXISTS idx_directory_orders_pack_type
ON directory_orders(pack_type);

CREATE INDEX IF NOT EXISTS idx_directory_orders_paid_at
ON directory_orders(paid_at);

CREATE INDEX IF NOT EXISTS idx_stripe_events_processed
ON stripe_events(processed);

CREATE INDEX IF NOT EXISTS idx_stripe_events_event_type
ON stripe_events(event_type);

-- ============================================================================
-- Migration complete
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Tier-0 Citation Network Remediation';
  RAISE NOTICE 'Migration completed successfully';
  RAISE NOTICE '========================================';
END $$;
