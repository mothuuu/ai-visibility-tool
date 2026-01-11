-- ============================================================================
-- PHASE 1 MIGRATION B: Concurrent Index Creation
-- RUN: psql $DATABASE_URL -f backend/db/phase1-migrations/002_migration_B.sql
--
-- ⚠️  DO NOT wrap in BEGIN/COMMIT - CONCURRENTLY requires no transaction
-- ============================================================================

-- Index 1: Primary query (scope + state)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scan_recs_org_domain_state
  ON scan_recommendations(organization_id, domain_id, unlock_state);

-- Index 2: Batch/cycle queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scan_recs_org_domain_batch
  ON scan_recommendations(organization_id, domain_id, batch_number);

-- Index 3: Dedup support
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scan_recs_org_domain_dedup
  ON scan_recommendations(organization_id, domain_id, dedup_key);

-- Index 4: Scan traceability
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scan_recs_scan_id
  ON scan_recommendations(scan_id);

-- Index 5: Locked pool selection (partial index)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scan_recs_locked_pool_priority
  ON scan_recommendations(organization_id, domain_id, priority_score DESC)
  WHERE unlock_state = 'locked';

-- Index 6: recommendation_progress lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rec_progress_org_domain
  ON recommendation_progress(organization_id, domain_id);

-- ============================================================================
-- MIGRATION B COMPLETE
-- ============================================================================
