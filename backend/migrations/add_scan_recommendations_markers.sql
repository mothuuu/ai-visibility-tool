-- Phase 4A.2: Scan recommendation generation tracking
--
-- This migration adds columns to track recommendation generation status on scans:
-- - recommendations_generated_at: When v2 recommendations were generated
-- - recommendations_engine_version: Which engine version was used
-- - recommendations_count: Number of recommendations generated
--
-- These fields enable:
-- - Backfill queries to find scans needing recommendation generation
-- - Version tracking for phased rollouts
-- - Monitoring and debugging

-- Add recommendation tracking columns to scans table
ALTER TABLE scans
  ADD COLUMN IF NOT EXISTS recommendations_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recommendations_engine_version VARCHAR(10),
  ADD COLUMN IF NOT EXISTS recommendations_count INTEGER DEFAULT 0;

-- Index for backfill queries: find completed scans that need recommendation generation
-- Filtered to only include user scans (not anonymous) that are completed
CREATE INDEX IF NOT EXISTS idx_scans_rec_backfill
  ON scans (status, recommendations_generated_at)
  WHERE status = 'completed' AND user_id IS NOT NULL;

-- Index for monitoring: find scans by engine version
CREATE INDEX IF NOT EXISTS idx_scans_rec_engine_version
  ON scans (recommendations_engine_version)
  WHERE recommendations_engine_version IS NOT NULL;
