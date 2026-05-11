-- 019_citation_test_runs_delta_rollback.sql
DROP INDEX IF EXISTS idx_citation_test_runs_pro_alert_pending;
ALTER TABLE citation_test_runs
  DROP COLUMN IF EXISTS pro_alert_pending,
  DROP COLUMN IF EXISTS delta_summary;
