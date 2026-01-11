-- ============================================================================
-- PHASE 1 MIGRATION A: Transaction-Safe Schema Additions
-- RUN: psql $DATABASE_URL -f backend/db/phase1-migrations/001_migration_A.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Add foundational columns (may already exist from prior migration)
-- ============================================================================

-- organization_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN organization_id INTEGER;
    RAISE NOTICE 'ADDED: organization_id';
  ELSE
    RAISE NOTICE 'EXISTS: organization_id';
  END IF;
END $$;

-- domain_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'domain_id'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN domain_id INTEGER;
    RAISE NOTICE 'ADDED: domain_id';
  ELSE
    RAISE NOTICE 'EXISTS: domain_id';
  END IF;
END $$;

-- pillar_key (Doc 18 canonical pillar ID)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'pillar_key'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN pillar_key TEXT;
    RAISE NOTICE 'ADDED: pillar_key';
  ELSE
    RAISE NOTICE 'EXISTS: pillar_key';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Add Doc 17 lifecycle columns
-- ============================================================================

-- rec_type: actionable | diagnostic
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'rec_type'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN rec_type TEXT DEFAULT 'actionable' NOT NULL;
    RAISE NOTICE 'ADDED: rec_type';
  ELSE
    RAISE NOTICE 'EXISTS: rec_type';
  END IF;
END $$;

-- surfaced_at (canonical - keep unlocked_at as legacy)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'surfaced_at'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN surfaced_at TIMESTAMP;
    RAISE NOTICE 'ADDED: surfaced_at';
  ELSE
    RAISE NOTICE 'EXISTS: surfaced_at';
  END IF;
END $$;

-- skip_available_at (canonical)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'skip_available_at'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN skip_available_at TIMESTAMP;
    RAISE NOTICE 'ADDED: skip_available_at';
  ELSE
    RAISE NOTICE 'EXISTS: skip_available_at';
  END IF;
END $$;

-- implemented_at (canonical - maps from marked_complete_at)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'implemented_at'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN implemented_at TIMESTAMP;
    RAISE NOTICE 'ADDED: implemented_at';
  ELSE
    RAISE NOTICE 'EXISTS: implemented_at';
  END IF;
END $$;

-- skipped_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'skipped_at'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN skipped_at TIMESTAMP;
    RAISE NOTICE 'ADDED: skipped_at';
  ELSE
    RAISE NOTICE 'EXISTS: skipped_at';
  END IF;
END $$;

-- dismissed_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'dismissed_at'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN dismissed_at TIMESTAMP;
    RAISE NOTICE 'ADDED: dismissed_at';
  ELSE
    RAISE NOTICE 'EXISTS: dismissed_at';
  END IF;
END $$;

-- resurface_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'resurface_at'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN resurface_at TIMESTAMP;
    RAISE NOTICE 'ADDED: resurface_at';
  ELSE
    RAISE NOTICE 'EXISTS: resurface_at';
  END IF;
END $$;

-- priority_score
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'priority_score'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN priority_score INTEGER DEFAULT 0;
    RAISE NOTICE 'ADDED: priority_score';
  ELSE
    RAISE NOTICE 'EXISTS: priority_score';
  END IF;
END $$;

-- ============================================================================
-- STEP 2B: Fix unlock_state (backfill + NOT NULL + CHECK)
-- ============================================================================

-- Backfill NULL -> 'locked'
UPDATE scan_recommendations
SET unlock_state = 'locked'
WHERE unlock_state IS NULL;

-- Set NOT NULL (unlock_state may already exist from prior migration)
ALTER TABLE scan_recommendations
  ALTER COLUMN unlock_state SET NOT NULL;

ALTER TABLE scan_recommendations
  ALTER COLUMN unlock_state SET DEFAULT 'locked';

-- Add CHECK constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scan_recommendations_unlock_state_check'
  ) THEN
    ALTER TABLE scan_recommendations
      ADD CONSTRAINT scan_recommendations_unlock_state_check
      CHECK (unlock_state IN ('locked', 'active', 'implemented', 'skipped', 'dismissed'));
    RAISE NOTICE 'ADDED: CHECK constraint on unlock_state';
  ELSE
    RAISE NOTICE 'EXISTS: CHECK constraint on unlock_state';
  END IF;
END $$;

-- ============================================================================
-- STEP 2C: Sync canonical from legacy
-- ============================================================================

-- Sync surfaced_at from unlocked_at
UPDATE scan_recommendations
SET surfaced_at = unlocked_at
WHERE surfaced_at IS NULL AND unlocked_at IS NOT NULL;

-- Sync implemented_at from marked_complete_at
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'marked_complete_at'
  ) THEN
    UPDATE scan_recommendations
    SET implemented_at = marked_complete_at
    WHERE implemented_at IS NULL AND marked_complete_at IS NOT NULL;
    RAISE NOTICE 'SYNCED: implemented_at <- marked_complete_at';
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Add Doc 18 content columns
-- ============================================================================

-- title
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'title'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN title TEXT;
    RAISE NOTICE 'ADDED: title';
  ELSE
    RAISE NOTICE 'EXISTS: title';
  END IF;
END $$;

-- marketing_copy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'marketing_copy'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN marketing_copy TEXT;
    RAISE NOTICE 'ADDED: marketing_copy';
  ELSE
    RAISE NOTICE 'EXISTS: marketing_copy';
  END IF;
END $$;

-- technical_copy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'technical_copy'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN technical_copy TEXT;
    RAISE NOTICE 'ADDED: technical_copy';
  ELSE
    RAISE NOTICE 'EXISTS: technical_copy';
  END IF;
END $$;

-- exec_copy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'exec_copy'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN exec_copy TEXT;
    RAISE NOTICE 'ADDED: exec_copy';
  ELSE
    RAISE NOTICE 'EXISTS: exec_copy';
  END IF;
END $$;

-- why_it_matters
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'why_it_matters'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN why_it_matters TEXT;
    RAISE NOTICE 'ADDED: why_it_matters';
  ELSE
    RAISE NOTICE 'EXISTS: why_it_matters';
  END IF;
END $$;

-- what_to_do (JSONB)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'what_to_do'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN what_to_do JSONB;
    RAISE NOTICE 'ADDED: what_to_do';
  ELSE
    RAISE NOTICE 'EXISTS: what_to_do';
  END IF;
END $$;

-- how_to_do (JSONB)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'how_to_do'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN how_to_do JSONB;
    RAISE NOTICE 'ADDED: how_to_do';
  ELSE
    RAISE NOTICE 'EXISTS: how_to_do';
  END IF;
END $$;

-- confidence_score
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'confidence_score'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN confidence_score NUMERIC;
    RAISE NOTICE 'ADDED: confidence_score';
  ELSE
    RAISE NOTICE 'EXISTS: confidence_score';
  END IF;
END $$;

-- engine_version
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'engine_version'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN engine_version TEXT;
    RAISE NOTICE 'ADDED: engine_version';
  ELSE
    RAISE NOTICE 'EXISTS: engine_version';
  END IF;
END $$;

-- evidence (JSONB)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'evidence'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN evidence JSONB DEFAULT '{}'::jsonb;
    RAISE NOTICE 'ADDED: evidence';
  ELSE
    RAISE NOTICE 'EXISTS: evidence';
  END IF;
END $$;

-- dedup_key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'dedup_key'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN dedup_key TEXT;
    RAISE NOTICE 'ADDED: dedup_key';
  ELSE
    RAISE NOTICE 'EXISTS: dedup_key';
  END IF;
END $$;

-- cluster_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'cluster_id'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN cluster_id TEXT;
    RAISE NOTICE 'ADDED: cluster_id';
  ELSE
    RAISE NOTICE 'EXISTS: cluster_id';
  END IF;
END $$;

-- secondary_pillars (JSONB)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'secondary_pillars'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN secondary_pillars JSONB;
    RAISE NOTICE 'ADDED: secondary_pillars';
  ELSE
    RAISE NOTICE 'EXISTS: secondary_pillars';
  END IF;
END $$;

-- suggested_faqs (JSONB)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'suggested_faqs'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN suggested_faqs JSONB;
    RAISE NOTICE 'ADDED: suggested_faqs';
  ELSE
    RAISE NOTICE 'EXISTS: suggested_faqs';
  END IF;
END $$;

-- suggested_certifications (JSONB)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'suggested_certifications'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN suggested_certifications JSONB;
    RAISE NOTICE 'ADDED: suggested_certifications';
  ELSE
    RAISE NOTICE 'EXISTS: suggested_certifications';
  END IF;
END $$;

-- suggested_schema (JSONB)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'suggested_schema'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN suggested_schema JSONB;
    RAISE NOTICE 'ADDED: suggested_schema';
  ELSE
    RAISE NOTICE 'EXISTS: suggested_schema';
  END IF;
END $$;

-- industry_enrichment_applied
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'industry_enrichment_applied'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN industry_enrichment_applied BOOLEAN DEFAULT false NOT NULL;
    RAISE NOTICE 'ADDED: industry_enrichment_applied';
  ELSE
    RAISE NOTICE 'EXISTS: industry_enrichment_applied';
  END IF;
END $$;

-- company_type_applied
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scan_recommendations' AND column_name = 'company_type_applied'
  ) THEN
    ALTER TABLE scan_recommendations ADD COLUMN company_type_applied TEXT;
    RAISE NOTICE 'ADDED: company_type_applied';
  ELSE
    RAISE NOTICE 'EXISTS: company_type_applied';
  END IF;
END $$;

-- ============================================================================
-- STEP 3B: Backfill evidence and marketing_copy
-- ============================================================================

UPDATE scan_recommendations
SET evidence = '{}'::jsonb
WHERE evidence IS NULL;

UPDATE scan_recommendations
SET marketing_copy = 'We found an opportunity to improve AI visibility. Expand to see details.'
WHERE marketing_copy IS NULL
  AND rec_type = 'actionable';

-- ============================================================================
-- STEP 4: Create recommendation_progress table (org+domain scope)
-- ============================================================================

CREATE TABLE IF NOT EXISTS recommendation_progress (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  domain_id INTEGER,

  cycle_number INTEGER NOT NULL DEFAULT 1,
  cycle_started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  next_cycle_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '5 days'),

  batch_size INTEGER NOT NULL DEFAULT 5,
  cycle_days INTEGER NOT NULL DEFAULT 5,
  surfaced_in_cycle INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recommendation_progress_org_domain_unique'
  ) THEN
    ALTER TABLE recommendation_progress
      ADD CONSTRAINT recommendation_progress_org_domain_unique
      UNIQUE(organization_id, domain_id);
    RAISE NOTICE 'ADDED: UNIQUE(org, domain)';
  ELSE
    RAISE NOTICE 'EXISTS: UNIQUE(org, domain)';
  END IF;
END $$;

-- Add FK to organizations (NOT VALID = no lock)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'recommendation_progress_org_fk'
    ) THEN
      ALTER TABLE recommendation_progress
        ADD CONSTRAINT recommendation_progress_org_fk
        FOREIGN KEY (organization_id) REFERENCES organizations(id) NOT VALID;
      RAISE NOTICE 'ADDED: FK to organizations (NOT VALID)';
    END IF;
  END IF;
END $$;

-- Add FK to domains (NOT VALID = no lock)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'domains') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'recommendation_progress_domain_fk'
    ) THEN
      ALTER TABLE recommendation_progress
        ADD CONSTRAINT recommendation_progress_domain_fk
        FOREIGN KEY (domain_id) REFERENCES domains(id) NOT VALID;
      RAISE NOTICE 'ADDED: FK to domains (NOT VALID)';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- STEP 5: Add company_type to org tables
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'organizations' AND column_name = 'company_type'
    ) THEN
      ALTER TABLE organizations ADD COLUMN company_type TEXT;
      RAISE NOTICE 'ADDED: organizations.company_type';
    END IF;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- MIGRATION A COMPLETE
-- Next: Run 002_migration_B.sql (concurrent indexes)
-- ============================================================================
