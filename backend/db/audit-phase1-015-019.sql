-- ============================================================================
-- Read-only audit: are migrations 015-019's objects already present?
-- ============================================================================
-- Purpose: the schema_migrations ledger drifted behind the actual DB schema,
-- so the sequential runner is blocked at 015 (bare CREATE TABLE findings on an
-- already-existing table). Before "baselining" 015-019 (marking them applied
-- without re-running), confirm every object each migration creates already
-- exists. This script ONLY reads catalogs — it makes no changes.
--
-- Run:  psql "$DATABASE_URL" -f db/audit-phase1-015-019.sql
--
-- Reads three reports:
--   1. Per-object presence detail
--   2. Per-migration verdict (SAFE TO BASELINE only if ALL its objects exist)
--   3. A ready-to-run baseline INSERT covering ONLY the fully-present migrations
-- ============================================================================

WITH expected(version, kind, obj) AS (
  VALUES
    -- 015_findings_evidence_snapshots
    ('015','extension','uuid-ossp'),
    ('015','table','findings'),
    ('015','table','evidence_snapshots'),
    ('015','index','idx_findings_scan_id'),
    ('015','index','idx_findings_pillar'),
    ('015','index','idx_findings_severity'),
    ('015','index','idx_evidence_snapshots_scan_id'),
    -- 016_token_balances_transactions
    ('016','table','token_balances'),
    ('016','table','token_transactions'),
    ('016','index','idx_token_balances_user_id'),
    ('016','index','idx_token_transactions_user_id'),
    ('016','index','idx_token_transactions_type'),
    ('016','index','idx_token_transactions_created_at'),
    -- 017_pack_runs_artifacts
    ('017','table','pack_purchases'),
    ('017','table','pack_runs'),
    ('017','table','pack_artifacts'),
    ('017','index','idx_pack_purchases_user_id'),
    ('017','index','idx_pack_purchases_scan_id'),
    ('017','index','idx_pack_runs_pack_purchase_id'),
    ('017','index','idx_pack_runs_input_scan_id'),
    ('017','index','idx_pack_runs_status'),
    ('017','index','idx_pack_artifacts_pack_run_id'),
    -- 018_citation_monitoring_benchmarks
    ('018','table','citation_test_runs'),
    ('018','table','citation_evidence'),
    ('018','table','prompt_clusters'),
    ('018','table','benchmark_stats'),
    ('018','index','idx_citation_test_runs_user_created'),
    ('018','index','idx_citation_test_runs_scan_id'),
    ('018','index','idx_citation_test_runs_status'),
    ('018','index','idx_citation_evidence_test_run_id'),
    ('018','index','idx_citation_evidence_engine'),
    ('018','index','idx_citation_evidence_cited'),
    ('018','index','idx_prompt_clusters_user_id'),
    ('018','index','idx_prompt_clusters_vertical'),
    ('018','index','idx_prompt_clusters_source'),
    ('018','index','idx_benchmark_stats_vertical'),
    ('018','index','idx_benchmark_stats_computed_at'),
    -- 019_citation_test_runs_delta (additive columns + partial index)
    ('019','column','citation_test_runs.delta_summary'),
    ('019','column','citation_test_runs.pro_alert_pending'),
    ('019','index','idx_citation_test_runs_pro_alert_pending')
),
names(version, name) AS (
  VALUES
    ('015','015_findings_evidence_snapshots.sql'),
    ('016','016_token_balances_transactions.sql'),
    ('017','017_pack_runs_artifacts.sql'),
    ('018','018_citation_monitoring_benchmarks.sql'),
    ('019','019_citation_test_runs_delta.sql')
),
checked AS (
  SELECT
    version,
    kind,
    obj,
    CASE kind
      WHEN 'table'     THEN to_regclass('public.' || obj) IS NOT NULL
      WHEN 'index'     THEN to_regclass('public.' || obj) IS NOT NULL
      WHEN 'extension' THEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = obj)
      WHEN 'column'    THEN EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name  = split_part(obj, '.', 1)
                              AND column_name = split_part(obj, '.', 2)
                          )
    END AS present
  FROM expected
)
-- Report 1: per-object detail ------------------------------------------------
SELECT version,
       kind,
       obj AS object,
       CASE WHEN present THEN 'present' ELSE 'MISSING' END AS status
FROM checked
ORDER BY version, kind, obj;

WITH expected(version, kind, obj) AS (
  VALUES
    ('015','extension','uuid-ossp'),
    ('015','table','findings'),
    ('015','table','evidence_snapshots'),
    ('015','index','idx_findings_scan_id'),
    ('015','index','idx_findings_pillar'),
    ('015','index','idx_findings_severity'),
    ('015','index','idx_evidence_snapshots_scan_id'),
    ('016','table','token_balances'),
    ('016','table','token_transactions'),
    ('016','index','idx_token_balances_user_id'),
    ('016','index','idx_token_transactions_user_id'),
    ('016','index','idx_token_transactions_type'),
    ('016','index','idx_token_transactions_created_at'),
    ('017','table','pack_purchases'),
    ('017','table','pack_runs'),
    ('017','table','pack_artifacts'),
    ('017','index','idx_pack_purchases_user_id'),
    ('017','index','idx_pack_purchases_scan_id'),
    ('017','index','idx_pack_runs_pack_purchase_id'),
    ('017','index','idx_pack_runs_input_scan_id'),
    ('017','index','idx_pack_runs_status'),
    ('017','index','idx_pack_artifacts_pack_run_id'),
    ('018','table','citation_test_runs'),
    ('018','table','citation_evidence'),
    ('018','table','prompt_clusters'),
    ('018','table','benchmark_stats'),
    ('018','index','idx_citation_test_runs_user_created'),
    ('018','index','idx_citation_test_runs_scan_id'),
    ('018','index','idx_citation_test_runs_status'),
    ('018','index','idx_citation_evidence_test_run_id'),
    ('018','index','idx_citation_evidence_engine'),
    ('018','index','idx_citation_evidence_cited'),
    ('018','index','idx_prompt_clusters_user_id'),
    ('018','index','idx_prompt_clusters_vertical'),
    ('018','index','idx_prompt_clusters_source'),
    ('018','index','idx_benchmark_stats_vertical'),
    ('018','index','idx_benchmark_stats_computed_at'),
    ('019','column','citation_test_runs.delta_summary'),
    ('019','column','citation_test_runs.pro_alert_pending'),
    ('019','index','idx_citation_test_runs_pro_alert_pending')
),
checked AS (
  SELECT version,
    CASE kind
      WHEN 'table'     THEN to_regclass('public.' || obj) IS NOT NULL
      WHEN 'index'     THEN to_regclass('public.' || obj) IS NOT NULL
      WHEN 'extension' THEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = obj)
      WHEN 'column'    THEN EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name  = split_part(obj, '.', 1)
                              AND column_name = split_part(obj, '.', 2)
                          )
    END AS present
  FROM expected
)
-- Report 2: per-migration verdict -------------------------------------------
SELECT version,
       count(*)                          AS objects,
       count(*) FILTER (WHERE present)   AS present,
       count(*) FILTER (WHERE NOT present) AS missing,
       CASE WHEN bool_and(present)
            THEN 'SAFE TO BASELINE'
            ELSE 'DO NOT BASELINE — objects missing, run the real migration' END AS verdict
FROM checked
GROUP BY version
ORDER BY version;

-- Report 3: ready-to-run baseline INSERT for ONLY the fully-present migrations
-- (Copy/paste the emitted statement; it records those versions as applied.)
WITH expected(version, kind, obj) AS (
  VALUES
    ('015','extension','uuid-ossp'),('015','table','findings'),('015','table','evidence_snapshots'),
    ('015','index','idx_findings_scan_id'),('015','index','idx_findings_pillar'),
    ('015','index','idx_findings_severity'),('015','index','idx_evidence_snapshots_scan_id'),
    ('016','table','token_balances'),('016','table','token_transactions'),
    ('016','index','idx_token_balances_user_id'),('016','index','idx_token_transactions_user_id'),
    ('016','index','idx_token_transactions_type'),('016','index','idx_token_transactions_created_at'),
    ('017','table','pack_purchases'),('017','table','pack_runs'),('017','table','pack_artifacts'),
    ('017','index','idx_pack_purchases_user_id'),('017','index','idx_pack_purchases_scan_id'),
    ('017','index','idx_pack_runs_pack_purchase_id'),('017','index','idx_pack_runs_input_scan_id'),
    ('017','index','idx_pack_runs_status'),('017','index','idx_pack_artifacts_pack_run_id'),
    ('018','table','citation_test_runs'),('018','table','citation_evidence'),
    ('018','table','prompt_clusters'),('018','table','benchmark_stats'),
    ('018','index','idx_citation_test_runs_user_created'),('018','index','idx_citation_test_runs_scan_id'),
    ('018','index','idx_citation_test_runs_status'),('018','index','idx_citation_evidence_test_run_id'),
    ('018','index','idx_citation_evidence_engine'),('018','index','idx_citation_evidence_cited'),
    ('018','index','idx_prompt_clusters_user_id'),('018','index','idx_prompt_clusters_vertical'),
    ('018','index','idx_prompt_clusters_source'),('018','index','idx_benchmark_stats_vertical'),
    ('018','index','idx_benchmark_stats_computed_at'),
    ('019','column','citation_test_runs.delta_summary'),
    ('019','column','citation_test_runs.pro_alert_pending'),
    ('019','index','idx_citation_test_runs_pro_alert_pending')
),
names(version, name) AS (
  VALUES
    ('015','015_findings_evidence_snapshots.sql'),
    ('016','016_token_balances_transactions.sql'),
    ('017','017_pack_runs_artifacts.sql'),
    ('018','018_citation_monitoring_benchmarks.sql'),
    ('019','019_citation_test_runs_delta.sql')
),
checked AS (
  SELECT version,
    CASE kind
      WHEN 'table'     THEN to_regclass('public.' || obj) IS NOT NULL
      WHEN 'index'     THEN to_regclass('public.' || obj) IS NOT NULL
      WHEN 'extension' THEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = obj)
      WHEN 'column'    THEN EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name  = split_part(obj, '.', 1)
                              AND column_name = split_part(obj, '.', 2)
                          )
    END AS present
  FROM expected
),
safe AS (
  SELECT version FROM checked GROUP BY version HAVING bool_and(present)
)
SELECT
  CASE WHEN count(*) = 0
    THEN '-- No migration is fully present; nothing safe to baseline yet.'
    ELSE 'INSERT INTO schema_migrations (version, name, category) VALUES '
         || string_agg(format('(%L, %L, %L)', s.version, n.name, 'schema'), ', ' ORDER BY s.version)
         || ' ON CONFLICT (version) DO NOTHING;'
  END AS baseline_sql_to_run
FROM safe s
JOIN names n USING (version);
