-- Rollback for Migration 021: Value-scoring business inputs
--
-- Drops the two enum guards and the two columns. The tracked_prompts `value`
-- property (a JSONB key) is unaffected by this migration and is intentionally
-- left as-is on rollback.

ALTER TABLE visibility_profiles
  DROP CONSTRAINT IF EXISTS visibility_profiles_deal_size_band_check,
  DROP CONSTRAINT IF EXISTS visibility_profiles_sales_model_check;

ALTER TABLE visibility_profiles
  DROP COLUMN IF EXISTS deal_size_band,
  DROP COLUMN IF EXISTS sales_model;
