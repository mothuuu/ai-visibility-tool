-- Phase 4A.2: Add recommendation engine v2 columns (content-aware, evidence-gated)
--
-- This migration adds new columns to support the v5.1 recommendation engine:
-- - rec_key: Stable idempotency key for upsert operations
-- - subfactor_key: Canonical V5.1 subfactor identifier
-- - pillar: 8-pillar category name
-- - Evidence gating fields (confidence, evidence_quality, evidence_summary)
-- - Automation level and targeting fields
-- - Generated assets and examples (JSONB)

-- Add rec_key for idempotent upserts
ALTER TABLE scan_recommendations
  ADD COLUMN IF NOT EXISTS rec_key TEXT;

-- Add v2 content-aware recommendation fields
ALTER TABLE scan_recommendations
  ADD COLUMN IF NOT EXISTS subfactor_key TEXT,
  ADD COLUMN IF NOT EXISTS pillar TEXT,
  ADD COLUMN IF NOT EXISTS gap TEXT,
  ADD COLUMN IF NOT EXISTS why_it_matters TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS evidence_quality VARCHAR(20),
  ADD COLUMN IF NOT EXISTS evidence_summary TEXT,
  ADD COLUMN IF NOT EXISTS automation_level VARCHAR(20),
  ADD COLUMN IF NOT EXISTS target_level VARCHAR(10),
  ADD COLUMN IF NOT EXISTS target_url TEXT,
  ADD COLUMN IF NOT EXISTS engine_version VARCHAR(10) DEFAULT 'v5.1',
  ADD COLUMN IF NOT EXISTS evidence_json JSONB,
  ADD COLUMN IF NOT EXISTS generated_assets JSONB,
  ADD COLUMN IF NOT EXISTS examples JSONB;

-- Partial unique index: v2 idempotency (only applies when rec_key is not null)
-- This enables ON CONFLICT upsert for v2 recommendations
CREATE UNIQUE INDEX IF NOT EXISTS scan_recommendations_scan_rec_key_uniq
  ON scan_recommendations (scan_id, rec_key)
  WHERE rec_key IS NOT NULL;

-- Index for version-based queries (filtering by engine version)
CREATE INDEX IF NOT EXISTS idx_scan_rec_engine_version
  ON scan_recommendations (engine_version)
  WHERE engine_version IS NOT NULL;

-- Index for pillar-based filtering
CREATE INDEX IF NOT EXISTS idx_scan_rec_pillar
  ON scan_recommendations (pillar)
  WHERE pillar IS NOT NULL;

-- Index for evidence quality filtering
CREATE INDEX IF NOT EXISTS idx_scan_rec_evidence_quality
  ON scan_recommendations (evidence_quality)
  WHERE evidence_quality IS NOT NULL;

-- Composite index for common query pattern (scan + pillar + confidence)
CREATE INDEX IF NOT EXISTS idx_scan_rec_scan_pillar_confidence
  ON scan_recommendations (scan_id, pillar, confidence DESC NULLS LAST)
  WHERE pillar IS NOT NULL;
