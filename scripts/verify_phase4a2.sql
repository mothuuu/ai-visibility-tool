-- Phase 4A.2 Verification Queries
-- Run these queries to verify the migration and backfill were successful

-- ============================================================
-- 1) Confirm new columns exist on scan_recommendations
-- ============================================================
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'scan_recommendations'
  AND column_name IN ('rec_key', 'subfactor_key', 'pillar', 'confidence',
                      'evidence_quality', 'automation_level', 'generated_assets',
                      'target_level', 'target_url', 'engine_version', 'evidence_json',
                      'gap', 'why_it_matters', 'examples')
ORDER BY column_name;

-- Expected: 14 rows, all columns should exist

-- ============================================================
-- 2) Confirm unique index exists for idempotent upserts
-- ============================================================
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'scan_recommendations'
  AND indexname LIKE '%rec_key%';

-- Expected: scan_recommendations_scan_rec_key_uniq partial unique index

-- ============================================================
-- 3) Confirm scan markers exist
-- ============================================================
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'scans'
  AND column_name IN ('recommendations_generated_at', 'recommendations_engine_version',
                      'recommendations_count')
ORDER BY column_name;

-- Expected: 3 rows for tracking columns

-- ============================================================
-- 4) Check for duplicate rec_keys (should be 0 rows)
-- ============================================================
SELECT scan_id, rec_key, COUNT(*) as dupes
FROM scan_recommendations
WHERE rec_key IS NOT NULL
GROUP BY scan_id, rec_key
HAVING COUNT(*) > 1;

-- Expected: 0 rows (no duplicates)

-- ============================================================
-- 5) Backfill candidates count
-- ============================================================
SELECT COUNT(*) as backfill_candidates
FROM scans
WHERE status = 'completed'
  AND user_id IS NOT NULL
  AND COALESCE(domain_type, '') <> 'competitor'
  AND (recommendations_generated_at IS NULL OR recommendations_count = 0 OR recommendations_count IS NULL);

-- Shows how many scans still need backfill

-- ============================================================
-- 6) Recent generation stats (last 7 days)
-- ============================================================
SELECT
  DATE(recommendations_generated_at) as date,
  COUNT(*) as scans,
  ROUND(AVG(recommendations_count)::numeric, 1) as avg_recs,
  SUM(recommendations_count) as total_recs
FROM scans
WHERE recommendations_generated_at IS NOT NULL
GROUP BY DATE(recommendations_generated_at)
ORDER BY 1 DESC
LIMIT 7;

-- Shows recommendation generation activity by day

-- ============================================================
-- 7) Sample v2 recommendations (most recent)
-- ============================================================
SELECT
  id, scan_id, rec_key, pillar, subfactor_key,
  confidence, evidence_quality, automation_level,
  target_level, target_url, engine_version
FROM scan_recommendations
WHERE rec_key IS NOT NULL
  AND engine_version = 'v5.1'
ORDER BY created_at DESC
LIMIT 10;

-- Shows sample v2 recommendations

-- ============================================================
-- 8) Distribution by automation level
-- ============================================================
SELECT
  automation_level,
  COUNT(*) as count,
  ROUND(AVG(confidence)::numeric, 3) as avg_confidence
FROM scan_recommendations
WHERE engine_version = 'v5.1'
  AND automation_level IS NOT NULL
GROUP BY automation_level
ORDER BY count DESC;

-- Shows breakdown of recommendations by automation level

-- ============================================================
-- 9) Distribution by pillar
-- ============================================================
SELECT
  pillar,
  COUNT(*) as count,
  ROUND(AVG(confidence)::numeric, 3) as avg_confidence
FROM scan_recommendations
WHERE engine_version = 'v5.1'
  AND pillar IS NOT NULL
GROUP BY pillar
ORDER BY count DESC;

-- Shows breakdown of recommendations by pillar

-- ============================================================
-- 10) Distribution by evidence quality
-- ============================================================
SELECT
  evidence_quality,
  COUNT(*) as count,
  ROUND(AVG(confidence)::numeric, 3) as avg_confidence
FROM scan_recommendations
WHERE engine_version = 'v5.1'
  AND evidence_quality IS NOT NULL
GROUP BY evidence_quality
ORDER BY count DESC;

-- Shows breakdown by evidence quality assessment

-- ============================================================
-- 11) Target level distribution
-- ============================================================
SELECT
  target_level,
  COUNT(*) as count
FROM scan_recommendations
WHERE engine_version = 'v5.1'
  AND target_level IS NOT NULL
GROUP BY target_level
ORDER BY count DESC;

-- Shows site vs page vs both distribution

-- ============================================================
-- 12) v2 vs legacy recommendations comparison
-- ============================================================
SELECT
  CASE
    WHEN engine_version = 'v5.1' THEN 'v2 (Phase 4A)'
    WHEN rec_key IS NOT NULL THEN 'v2 (other)'
    ELSE 'v1 (legacy)'
  END as rec_type,
  COUNT(*) as count
FROM scan_recommendations
GROUP BY 1
ORDER BY count DESC;

-- Shows distribution between v2 and legacy recommendations
