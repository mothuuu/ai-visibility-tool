-- Migration 020: Visibility Profiles
--
-- Canonical source of truth for a user's confirmed AI-visibility intake profile.
-- Drives findings, monitoring, and competitor analysis in later steps. One per user.
--
-- Distinct from `business_profiles` (directory-submission / citation-network data),
-- which is intentionally left untouched. company_name/location live here and are
-- populated from the scan, not from business_profiles.
--
-- Additive + idempotent: safe to re-run. Reuses the existing
-- update_updated_at_column() function created in 000_infrastructure.sql.

CREATE TABLE IF NOT EXISTS visibility_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

    -- Core identity (company_name/location populated from the scan)
    display_name TEXT,
    company_name TEXT,
    industry TEXT,
    location TEXT,
    business_description TEXT,

    -- Structured intake data
    icps JSONB NOT NULL DEFAULT '[]'::jsonb,
    competitors_business JSONB NOT NULL DEFAULT '[]'::jsonb,    -- ordered list
    competitors_visibility JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ordered list
    tracked_prompts JSONB NOT NULL DEFAULT '[]'::jsonb,         -- [{text, volume nullable, is_monitored bool}]

    avg_customer_value TEXT,
    priority_focus TEXT DEFAULT 'All — optimize for the whole brand',

    -- Draft / completion / scan lifecycle tracking
    draft_generated_at TIMESTAMPTZ,
    draft_source TEXT CHECK (draft_source IN ('auto', 'manual', 'mixed')),
    profile_completed_at TIMESTAMPTZ,
    deeper_scan_triggered_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- UNIQUE(user_id) above already provides the index used for per-user lookups,
-- so no additional explicit index is created (consistent with one-profile-per-user).

-- Reuse the shared updated_at trigger function (created in 000_infrastructure.sql).
-- DROP IF EXISTS makes re-running this migration a clean no-op.
DROP TRIGGER IF EXISTS trg_visibility_profiles_updated_at ON visibility_profiles;
CREATE TRIGGER trg_visibility_profiles_updated_at
    BEFORE UPDATE ON visibility_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
