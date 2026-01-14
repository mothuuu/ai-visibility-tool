-- Rollback: Remove Stripe period fields from organizations table

BEGIN;

-- Drop CHECK constraints first
ALTER TABLE organizations
DROP CONSTRAINT IF EXISTS chk_plan_override;

ALTER TABLE organizations
DROP CONSTRAINT IF EXISTS chk_plan_source;

-- Drop manual override fields
ALTER TABLE organizations
DROP COLUMN IF EXISTS plan_override_reason;

ALTER TABLE organizations
DROP COLUMN IF EXISTS plan_override_set_by;

ALTER TABLE organizations
DROP COLUMN IF EXISTS plan_override_set_at;

ALTER TABLE organizations
DROP COLUMN IF EXISTS plan_override;

ALTER TABLE organizations
DROP COLUMN IF EXISTS plan_source;

-- Drop period fields
ALTER TABLE organizations
DROP COLUMN IF EXISTS stripe_current_period_end;

ALTER TABLE organizations
DROP COLUMN IF EXISTS stripe_current_period_start;

-- Drop stripe_price_id
ALTER TABLE organizations
DROP COLUMN IF EXISTS stripe_price_id;

COMMIT;
