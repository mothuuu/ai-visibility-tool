-- 019_citation_test_runs_delta.sql
-- Adds delta_summary (JSONB) and pro_alert_pending columns to
-- citation_test_runs so the scheduled monitoring job (Step 3.5) can
-- record cited/uncited deltas between consecutive runs and flag Pro
-- users whose results changed for the upcoming email job (Step 3.10).
--
-- Additive: existing rows get NULL delta_summary and FALSE flag.

ALTER TABLE citation_test_runs
  ADD COLUMN IF NOT EXISTS delta_summary     JSONB,
  ADD COLUMN IF NOT EXISTS pro_alert_pending BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_citation_test_runs_pro_alert_pending
  ON citation_test_runs (pro_alert_pending) WHERE pro_alert_pending = true;
