-- 017_pack_runs_artifacts.sql
-- Pack execution: purchases, runs, and generated artifacts.
--
-- pack_purchases: a user's purchase of a pack (token-paid).
-- pack_runs:      one generation attempt for a purchase (versioned for re-runs).
-- pack_artifacts: deliverables produced by a run.
--
-- Note: input_snapshot_id is UUID because evidence_snapshots.id is UUID
-- (see 015_findings_evidence_snapshots.sql).

CREATE TABLE IF NOT EXISTS pack_purchases (
    id                       SERIAL        PRIMARY KEY,
    user_id                  INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scan_id                  INTEGER       REFERENCES scans(id) ON DELETE SET NULL,
    pack_type                VARCHAR(50)   NOT NULL,
    tokens_spent             INTEGER       NOT NULL,
    status                   VARCHAR(20)   NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'complete', 'failed', 'refunded')),
    stripe_payment_intent_id VARCHAR(255),
    created_at               TIMESTAMPTZ   DEFAULT NOW(),
    updated_at               TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pack_purchases_user_id ON pack_purchases (user_id);
CREATE INDEX IF NOT EXISTS idx_pack_purchases_scan_id ON pack_purchases (scan_id);

CREATE TABLE IF NOT EXISTS pack_runs (
    id                  SERIAL        PRIMARY KEY,
    pack_purchase_id    INTEGER       NOT NULL REFERENCES pack_purchases(id) ON DELETE CASCADE,
    version             INTEGER       NOT NULL DEFAULT 1,
    input_scan_id       INTEGER       REFERENCES scans(id) ON DELETE SET NULL,
    input_snapshot_id   UUID          REFERENCES evidence_snapshots(id) ON DELETE SET NULL,
    generation_params   JSONB         DEFAULT '{}',
    ai_model_used       VARCHAR(50),
    status              VARCHAR(20)   NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'generating', 'complete', 'failed')),
    error_message       TEXT,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pack_runs_pack_purchase_id ON pack_runs (pack_purchase_id);
CREATE INDEX IF NOT EXISTS idx_pack_runs_input_scan_id    ON pack_runs (input_scan_id);
CREATE INDEX IF NOT EXISTS idx_pack_runs_status           ON pack_runs (status);

CREATE TABLE IF NOT EXISTS pack_artifacts (
    id              SERIAL        PRIMARY KEY,
    pack_run_id     INTEGER       NOT NULL REFERENCES pack_runs(id) ON DELETE CASCADE,
    artifact_type   VARCHAR(30)   NOT NULL
                       CHECK (artifact_type IN
                         ('json_ld', 'document', 'pdf', 'checklist',
                          'spreadsheet', 'markdown', 'html')),
    file_url        VARCHAR(500),
    content_preview TEXT,
    content_full    JSONB,
    file_size_bytes INTEGER,
    created_at      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pack_artifacts_pack_run_id ON pack_artifacts (pack_run_id);
