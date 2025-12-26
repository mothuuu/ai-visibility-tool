-- ============================================================================
-- Migration: Fix Entitlement System
-- Date: 2025-12-26
-- Description: Phased fix for AI Citation Network entitlement/start-submissions issues
-- ============================================================================

-- ============================================================================
-- PHASE 1: Normalize users.plan values
-- ============================================================================

-- First, show current plan distribution (for diagnostics)
DO $$
BEGIN
  RAISE NOTICE '=== BEFORE NORMALIZATION ===';
  RAISE NOTICE 'Current plan distribution:';
END $$;

SELECT plan, COUNT(*) as count
FROM users
GROUP BY plan
ORDER BY count DESC;

-- Normalize plan values: lowercase, strip 'plan_' prefix
UPDATE users
SET plan = LOWER(TRIM(
  CASE
    WHEN plan ILIKE 'plan_%' THEN SUBSTRING(plan FROM 6)
    ELSE plan
  END
))
WHERE plan IS NOT NULL
  AND plan != LOWER(TRIM(
    CASE
      WHEN plan ILIKE 'plan_%' THEN SUBSTRING(plan FROM 6)
      ELSE plan
    END
  ));

-- Map known aliases to canonical values
UPDATE users
SET plan = CASE
  WHEN LOWER(plan) = 'starter' THEN 'diy'
  WHEN LOWER(plan) = 'basic' THEN 'diy'
  WHEN LOWER(plan) = 'professional' THEN 'pro'
  WHEN LOWER(plan) = 'business' THEN 'enterprise'
  WHEN LOWER(plan) = 'team' THEN 'agency'
  WHEN LOWER(plan) = 'teams' THEN 'agency'
  ELSE plan
END
WHERE LOWER(plan) IN ('starter', 'basic', 'professional', 'business', 'team', 'teams');

-- Set NULL plans to 'free'
UPDATE users
SET plan = 'free'
WHERE plan IS NULL OR TRIM(plan) = '';

-- Show plan distribution after normalization
DO $$
BEGIN
  RAISE NOTICE '=== AFTER NORMALIZATION ===';
  RAISE NOTICE 'Plan distribution after normalization:';
END $$;

SELECT plan, COUNT(*) as count
FROM users
GROUP BY plan
ORDER BY count DESC;

-- ============================================================================
-- PHASE 3: Monthly allocation robustness
-- ============================================================================

-- Step 9: Ensure period_start/period_end are DATE type (if they're TIMESTAMP)
-- Check current column types
DO $$
DECLARE
  start_type text;
  end_type text;
BEGIN
  SELECT data_type INTO start_type
  FROM information_schema.columns
  WHERE table_name = 'subscriber_directory_allocations' AND column_name = 'period_start';

  SELECT data_type INTO end_type
  FROM information_schema.columns
  WHERE table_name = 'subscriber_directory_allocations' AND column_name = 'period_end';

  RAISE NOTICE 'period_start type: %, period_end type: %', start_type, end_type;

  -- Convert to DATE if they're timestamp types
  IF start_type LIKE 'timestamp%' THEN
    RAISE NOTICE 'Converting period_start from TIMESTAMP to DATE...';
    ALTER TABLE subscriber_directory_allocations
    ALTER COLUMN period_start TYPE DATE USING period_start::date;
  END IF;

  IF end_type LIKE 'timestamp%' THEN
    RAISE NOTICE 'Converting period_end from TIMESTAMP to DATE...';
    ALTER TABLE subscriber_directory_allocations
    ALTER COLUMN period_end TYPE DATE USING period_end::date;
  END IF;
END $$;

-- Step 10: Deduplicate before adding unique constraint
-- Keep the row with highest (base_allocation + pack_allocation), or newest if tied
-- First, identify and log duplicates
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT user_id, period_start, COUNT(*) as cnt
    FROM subscriber_directory_allocations
    GROUP BY user_id, period_start
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE NOTICE 'Found % user/period combinations with duplicates - deduplicating...', dup_count;
  ELSE
    RAISE NOTICE 'No duplicates found in subscriber_directory_allocations';
  END IF;
END $$;

-- Delete duplicates, keeping the one with max allocation (or newest)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, period_start
           ORDER BY (base_allocation + COALESCE(pack_allocation, 0)) DESC,
                    COALESCE(updated_at, created_at) DESC,
                    id DESC
         ) as rn
  FROM subscriber_directory_allocations
)
DELETE FROM subscriber_directory_allocations
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_user_period'
  ) THEN
    RAISE NOTICE 'Adding unique constraint unique_user_period...';
    ALTER TABLE subscriber_directory_allocations
    ADD CONSTRAINT unique_user_period UNIQUE (user_id, period_start);
  ELSE
    RAISE NOTICE 'Constraint unique_user_period already exists';
  END IF;
END $$;

-- ============================================================================
-- Verification queries (run these to confirm migration)
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=== VERIFICATION ===';
END $$;

-- Show users with paid plans
SELECT
  id, email, plan,
  stripe_subscription_status,
  CASE WHEN stripe_subscription_id IS NOT NULL THEN 'present' ELSE 'null' END as has_sub_id
FROM users
WHERE plan IN ('diy', 'pro', 'enterprise', 'agency')
ORDER BY plan, id
LIMIT 20;

-- Show current month allocations
SELECT
  sda.user_id,
  u.email,
  u.plan,
  sda.period_start,
  sda.base_allocation,
  sda.pack_allocation,
  sda.submissions_used,
  (sda.base_allocation + COALESCE(sda.pack_allocation, 0) - sda.submissions_used) as remaining
FROM subscriber_directory_allocations sda
JOIN users u ON sda.user_id = u.id
WHERE sda.period_start >= DATE_TRUNC('month', CURRENT_DATE)::date
ORDER BY sda.user_id;

-- Directory counts
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE is_active = true) as active,
  COUNT(*) FILTER (WHERE is_active = true AND pricing_model IN ('free', 'freemium')) as eligible
FROM directories;

DO $$
BEGIN
  RAISE NOTICE '=== MIGRATION COMPLETE ===';
END $$;
