-- Migration: Add Stripe period fields + manual override to organizations
-- Phase 2.1: Org-first plan resolution with Option A (manual override)
--
-- These fields enable:
-- 1. Stripe parity: org-level subscription tracking
-- 2. Manual override: safe plan override without breaking Stripe billing
--
-- Safety: All operations are additive (ADD COLUMN IF NOT EXISTS)

BEGIN;

-- ============================================
-- Stripe parity fields on organizations
-- ============================================

-- stripe_price_id: Maps to plan via PRICE_TO_PLAN lookup
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);

-- stripe_current_period_start: Billing period start from Stripe webhook
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS stripe_current_period_start TIMESTAMPTZ;

-- stripe_current_period_end: Billing period end from Stripe webhook
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS stripe_current_period_end TIMESTAMPTZ;

-- ============================================
-- Manual override fields (Option A)
-- ============================================

-- plan_source: 'stripe' (default) or 'manual' - determines resolution path
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS plan_source TEXT NOT NULL DEFAULT 'stripe';

-- plan_override: The override plan when plan_source='manual'
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS plan_override TEXT;

-- Audit trail for manual overrides
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS plan_override_set_at TIMESTAMPTZ;

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS plan_override_set_by INTEGER;

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS plan_override_reason TEXT;

-- ============================================
-- Constraints (idempotent via DO blocks)
-- ============================================

-- Constraint: plan_source must be 'stripe' or 'manual'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_plan_source'
  ) THEN
    ALTER TABLE organizations
    ADD CONSTRAINT chk_org_plan_source
    CHECK (plan_source IN ('stripe', 'manual'));
  END IF;
END $$;

-- Constraint: plan_override must be a valid plan (no 'freemium' - normalized in code)
-- NOTE: 'freemium' is intentionally excluded; code normalizes to 'free'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_plan_override'
  ) THEN
    ALTER TABLE organizations
    ADD CONSTRAINT chk_org_plan_override
    CHECK (plan_override IS NULL OR plan_override IN ('free', 'diy', 'pro', 'agency', 'enterprise'));
  END IF;
END $$;

-- ============================================
-- Verification (shows what was created)
-- ============================================
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'organizations'
  AND column_name IN (
    'stripe_price_id',
    'stripe_current_period_start',
    'stripe_current_period_end',
    'plan_source',
    'plan_override',
    'plan_override_set_at',
    'plan_override_set_by',
    'plan_override_reason'
  )
ORDER BY column_name;

COMMIT;
