-- Add missing Stripe period fields to organizations table
-- These are needed for org-first plan resolution

BEGIN;

-- Add stripe_price_id (maps to plan)
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);

-- Add period fields (for billing cycle detection)
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS stripe_current_period_start TIMESTAMPTZ;

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS stripe_current_period_end TIMESTAMPTZ;

-- Add manual override fields (for Option A)
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS plan_source TEXT NOT NULL DEFAULT 'stripe';

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS plan_override TEXT;

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS plan_override_set_at TIMESTAMPTZ;

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS plan_override_set_by INTEGER;

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS plan_override_reason TEXT;

-- Add CHECK constraints
ALTER TABLE organizations
ADD CONSTRAINT IF NOT EXISTS chk_plan_source
CHECK (plan_source IN ('stripe', 'manual'));

ALTER TABLE organizations
ADD CONSTRAINT IF NOT EXISTS chk_plan_override
CHECK (plan_override IS NULL OR plan_override IN ('free', 'freemium', 'diy', 'pro', 'agency'));

COMMIT;
