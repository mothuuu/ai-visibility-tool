-- Migration 022: competitor-gap summary on visibility_profiles
--
-- A profile-level, facts-only summary of the "declared vs. actually-cited
-- competitors" gap, derived by the Opportunity evidence pass from the typed
-- cited field across high-value prompts. Stored here (not per-prompt) so the
-- dashboard can read one object:
--   { declared_competitors, cited_competitors, declared_but_not_cited,
--     cited_but_not_declared, generated_at }
--
-- Additive + idempotent. Nullable: a profile without a completed evidence pass
-- simply has NULL. No score/band/weight is stored — facts only.

ALTER TABLE visibility_profiles
  ADD COLUMN IF NOT EXISTS competitor_gap_summary JSONB;
