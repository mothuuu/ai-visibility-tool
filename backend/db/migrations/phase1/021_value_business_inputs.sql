-- Migration 021: Value-scoring business inputs on visibility_profiles
--
-- Adds two CUSTOMER-SUPPLIED business-economics fields that ground the per-prompt
-- Value score (Layer 2). Value = how much winning a prompt is worth to THIS
-- business; it is reasoned from real inputs, never guessed. Both columns are
-- nullable: a profile without them yields a "pending" value (the scorer refuses
-- to invent economics).
--
-- These live alongside the other business basics already on visibility_profiles
-- (business_description, icps, competitors_*, avg_customer_value, priority_focus)
-- — there is no separate business-profile JSONB for scalar settings, so two
-- columns is the correct, isolated home.
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS + guarded CHECK constraints).
-- NULL is always allowed (not-yet-provided). No prompt-level change: the `value`
-- property is a NEW key inside the existing tracked_prompts JSONB elements and
-- needs no migration.

ALTER TABLE visibility_profiles
  ADD COLUMN IF NOT EXISTS deal_size_band TEXT,
  ADD COLUMN IF NOT EXISTS sales_model    TEXT;

-- Enum guards added separately + idempotently so re-running is a clean no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'visibility_profiles_deal_size_band_check'
  ) THEN
    ALTER TABLE visibility_profiles
      ADD CONSTRAINT visibility_profiles_deal_size_band_check
      CHECK (deal_size_band IS NULL OR deal_size_band IN
        ('under_1k', '1k_10k', '10k_50k', '50k_250k', 'over_250k'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'visibility_profiles_sales_model_check'
  ) THEN
    ALTER TABLE visibility_profiles
      ADD CONSTRAINT visibility_profiles_sales_model_check
      CHECK (sales_model IS NULL OR sales_model IN
        ('self_serve', 'smb', 'mid_market', 'enterprise'));
  END IF;
END$$;
