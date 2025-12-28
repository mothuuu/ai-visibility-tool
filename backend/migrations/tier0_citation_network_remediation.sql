-- Migration: Tier-0 Citation Network Remediation
-- Date: 2025-01-01
-- Description: Fixes all Tier-0 gaps for P0 requirements
--
-- This migration is idempotent and can be run multiple times safely.
--
-- P0 REQUIREMENTS ADDRESSED:
--   FIX 1: No changes needed (code-only)
--   FIX 2: Create processed_stripe_events table with event_id PK, payload JSONB
--   FIX 3: UNIQUE index on stripe_checkout_session_id for UPSERT
--   Rule 4:  Orders remain status='paid' forever (migrate legacy statuses)
--   Rule 12: Add pack_type column for PACK_CONFIG lookup
--   Rule 13: Allow NULL stripe_payment_intent_id for async payments

-- ============================================================================
-- 1. Create processed_stripe_events table (P0 FIX 2)
-- ============================================================================
-- This is the NEW table for webhook idempotency with FULL event payload
CREATE TABLE IF NOT EXISTS processed_stripe_events (
  event_id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payload JSONB
);

-- Migrate data from old stripe_events table if it exists and has data
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'stripe_events'
  ) THEN
    -- Migrate any existing events that aren't already in processed_stripe_events
    INSERT INTO processed_stripe_events (event_id, event_type, processed_at, payload)
    SELECT
      event_id,
      event_type,
      COALESCE(processed_at, created_at, NOW()),
      event_data
    FROM stripe_events
    WHERE event_id IS NOT NULL
    ON CONFLICT (event_id) DO NOTHING;

    RAISE NOTICE 'Migrated existing stripe_events to processed_stripe_events';
  END IF;
END $$;

-- ============================================================================
-- 2. Add pack_type column to directory_orders (Rule 12)
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
-- 3. Add UNIQUE index on stripe_checkout_session_id (P0 FIX 3)
-- ============================================================================
-- Use native IF NOT EXISTS guard for unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_directory_orders_stripe_session_id
ON directory_orders(stripe_checkout_session_id)
WHERE stripe_checkout_session_id IS NOT NULL;

-- ============================================================================
-- 4. Ensure stripe_payment_intent_id allows NULL (Rule 13)
-- ============================================================================
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
-- 5. Add directories_submitted column if missing (usage tracking)
-- ============================================================================
ALTER TABLE directory_orders
ADD COLUMN IF NOT EXISTS directories_submitted INTEGER NOT NULL DEFAULT 0;

-- ============================================================================
-- 6. Add paid_at column if missing
-- ============================================================================
ALTER TABLE directory_orders
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;

-- ============================================================================
-- 7. Add updated_at column if missing
-- ============================================================================
ALTER TABLE directory_orders
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- ============================================================================
-- 8. Migrate legacy order statuses to 'paid' (Rule 4)
-- ============================================================================
-- Orders that are 'processing', 'in_progress', or 'completed' should be 'paid'
-- per Rule 4: Orders remain status='paid' forever once paid.
UPDATE directory_orders
SET status = 'paid',
    updated_at = NOW()
WHERE status IN ('processing', 'in_progress', 'completed');

-- ============================================================================
-- 9. Create additional indexes for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_directory_orders_user_status
ON directory_orders(user_id, status);

CREATE INDEX IF NOT EXISTS idx_directory_orders_pack_type
ON directory_orders(pack_type);

CREATE INDEX IF NOT EXISTS idx_directory_orders_paid_at
ON directory_orders(paid_at);

CREATE INDEX IF NOT EXISTS idx_processed_stripe_events_type
ON processed_stripe_events(event_type);

-- ============================================================================
-- Migration complete
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0 Tier-0 Citation Network Remediation';
  RAISE NOTICE 'Migration completed successfully';
  RAISE NOTICE '========================================';
END $$;
