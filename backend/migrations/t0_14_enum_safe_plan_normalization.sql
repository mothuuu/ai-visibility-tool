-- Migration: T0-14 ENUM-Safe Plan Normalization
-- Date: 2025-01-01
-- Description: Normalizes plan values only if the column is text-based.
--              If plan is an ENUM (USER-DEFINED), values are already constrained.
--
-- CRITICAL: Updating ENUM columns with text functions (LOWER, TRIM) fails
-- because you're assigning text back into an enum column.

DO $$
DECLARE
  plan_data_type TEXT;
BEGIN
  -- Get the data type of users.plan
  SELECT data_type INTO plan_data_type
  FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'plan';

  IF plan_data_type IS NULL THEN
    RAISE NOTICE 'Column users.plan does not exist, skipping normalization';
    RETURN;
  END IF;

  RAISE NOTICE 'users.plan data type: %', plan_data_type;

  -- Only normalize/migrate if plan is text-like (character varying, text, etc.)
  -- If it's USER-DEFINED (enum), values are already constrained; skip text normalization.
  IF plan_data_type = 'USER-DEFINED' THEN
    RAISE NOTICE 'users.plan is an ENUM type - skipping text normalization (values already constrained)';
    RETURN;
  END IF;

  -- For text-based columns, normalize values
  RAISE NOTICE 'Normalizing text-based plan values...';

  -- Step 1: Lowercase and trim all values
  UPDATE users SET plan = LOWER(TRIM(plan)) WHERE plan IS NOT NULL;

  -- Step 2: Normalize known aliases to canonical names
  UPDATE users SET plan = 'diy'
  WHERE plan IN ('diy-plan', 'diy_plan', 'diy-monthly', 'diy_monthly', 'starter', 'basic');

  UPDATE users SET plan = 'pro'
  WHERE plan IN ('pro-plan', 'pro_plan', 'professional', 'pro-monthly', 'growth');

  UPDATE users SET plan = 'agency'
  WHERE plan IN ('agency-plan', 'agency_plan', 'agency-monthly', 'team', 'teams');

  UPDATE users SET plan = 'enterprise'
  WHERE plan IN ('enterprise-plan', 'enterprise_plan', 'business');

  UPDATE users SET plan = 'freemium'
  WHERE plan IN ('freemium-plan', 'free-trial', 'trial');

  -- Step 3: Default unknown values to 'free'
  UPDATE users SET plan = 'free'
  WHERE plan IS NULL
     OR plan = ''
     OR plan NOT IN ('free', 'freemium', 'diy', 'pro', 'agency', 'enterprise');

  RAISE NOTICE 'Plan normalization complete';
END $$;
