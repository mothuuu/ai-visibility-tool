-- Migration 015: Create findings and evidence_snapshots tables
-- These tables store granular scan findings and raw evidence collected during scans.

-- Ensure uuid-ossp extension is available for uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- findings: individual issues discovered during a scan
-- ============================================================================
CREATE TABLE findings (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_id       INTEGER       NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  pillar        VARCHAR(50)   NOT NULL,
  subfactor_key VARCHAR(100)  NOT NULL,
  severity      VARCHAR(20)   NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title         TEXT          NOT NULL,
  description   TEXT,
  impacted_urls JSONB         DEFAULT '[]',
  evidence_data JSONB         DEFAULT '{}',
  suggested_pack_type VARCHAR(50),
  created_at    TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX idx_findings_scan_id  ON findings (scan_id);
CREATE INDEX idx_findings_pillar   ON findings (pillar);
CREATE INDEX idx_findings_severity ON findings (severity);

-- ============================================================================
-- evidence_snapshots: raw page-level evidence captured during a scan
-- ============================================================================
CREATE TABLE evidence_snapshots (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_id           INTEGER       NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  page_url          VARCHAR(500)  NOT NULL,
  schema_found      JSONB         DEFAULT '{}',
  headings          JSONB         DEFAULT '[]',
  meta_data         JSONB         DEFAULT '{}',
  content_analysis  JSONB         DEFAULT '{}',
  technical_signals JSONB         DEFAULT '{}',
  created_at        TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX idx_evidence_snapshots_scan_id ON evidence_snapshots (scan_id);
