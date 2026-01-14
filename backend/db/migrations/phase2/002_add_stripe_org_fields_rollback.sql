-- Rollback: Remove Stripe period fields + manual override from organizations
-- Phase 2.1 rollback

BEGIN;

-- Drop constraints first
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS chk_org_plan_override;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS chk_org_plan_source;

-- Drop audit trail columns
ALTER TABLE organizations DROP COLUMN IF EXISTS plan_override_reason;
ALTER TABLE organizations DROP COLUMN IF EXISTS plan_override_set_by;
ALTER TABLE organizations DROP COLUMN IF EXISTS plan_override_set_at;

-- Drop override columns
ALTER TABLE organizations DROP COLUMN IF EXISTS plan_override;
ALTER TABLE organizations DROP COLUMN IF EXISTS plan_source;

-- Drop Stripe period columns
ALTER TABLE organizations DROP COLUMN IF EXISTS stripe_current_period_end;
ALTER TABLE organizations DROP COLUMN IF EXISTS stripe_current_period_start;
ALTER TABLE organizations DROP COLUMN IF EXISTS stripe_price_id;

COMMIT;
