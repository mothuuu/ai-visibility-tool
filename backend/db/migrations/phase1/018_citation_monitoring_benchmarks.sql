-- 018_citation_monitoring_benchmarks.sql
-- Citation monitoring (citation_test_runs, citation_evidence, prompt_clusters)
-- and vertical benchmarking (benchmark_stats).
--
-- FK type review:
--   users.id          INTEGER (serial)  -> citation_test_runs.user_id, prompt_clusters.user_id
--   scans.id          INTEGER (serial)  -> citation_test_runs.scan_id
--   pack_runs.id      INTEGER (serial)  -> prompt_clusters.pack_run_id  (migration 017)

CREATE TABLE IF NOT EXISTS citation_test_runs (
    id                SERIAL        PRIMARY KEY,
    user_id           INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_type          VARCHAR(20)   NOT NULL CHECK (run_type IN ('scan_time', 'scheduled')),
    scan_id           INTEGER       REFERENCES scans(id) ON DELETE SET NULL,
    engines_tested    TEXT[]        DEFAULT '{}',
    prompts_tested    INTEGER       DEFAULT 0,
    cited_count       INTEGER       DEFAULT 0,
    not_cited_count   INTEGER       DEFAULT 0,
    status            VARCHAR(20)   NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'running', 'complete', 'failed')),
    error_message     TEXT,
    started_at        TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_citation_test_runs_user_created
    ON citation_test_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_citation_test_runs_scan_id
    ON citation_test_runs (scan_id);
CREATE INDEX IF NOT EXISTS idx_citation_test_runs_status
    ON citation_test_runs (status);

CREATE TABLE IF NOT EXISTS citation_evidence (
    id                 SERIAL        PRIMARY KEY,
    test_run_id        INTEGER       NOT NULL REFERENCES citation_test_runs(id) ON DELETE CASCADE,
    query_text         TEXT          NOT NULL,
    engine             VARCHAR(30)   NOT NULL
                           CHECK (engine IN ('chatgpt', 'claude', 'perplexity', 'gemini')),
    cited              BOOLEAN       NOT NULL DEFAULT false,
    citation_type      VARCHAR(20)   CHECK (citation_type IN ('cited', 'recommended', 'compared', 'absent')),
    response_snippet   TEXT,
    competitor_cited   TEXT[]        DEFAULT '{}',
    domain_mentioned   BOOLEAN       DEFAULT false,
    created_at         TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_citation_evidence_test_run_id
    ON citation_evidence (test_run_id);
CREATE INDEX IF NOT EXISTS idx_citation_evidence_engine
    ON citation_evidence (engine);
CREATE INDEX IF NOT EXISTS idx_citation_evidence_cited
    ON citation_evidence (cited);

CREATE TABLE IF NOT EXISTS prompt_clusters (
    id              SERIAL        PRIMARY KEY,
    user_id         INTEGER       REFERENCES users(id) ON DELETE CASCADE,
    cluster_name    VARCHAR(100)  NOT NULL,
    vertical        VARCHAR(50)   NOT NULL,
    intent_tier     VARCHAR(20)   NOT NULL
                       CHECK (intent_tier IN ('explore', 'compare', 'buy')),
    queries         JSONB         NOT NULL DEFAULT '[]',
    source          VARCHAR(30)   NOT NULL
                       CHECK (source IN ('faq_library', 'baseline_pack', 'manual')),
    pack_run_id     INTEGER       REFERENCES pack_runs(id) ON DELETE SET NULL,
    active          BOOLEAN       DEFAULT true,
    created_at      TIMESTAMPTZ   DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_clusters_user_id   ON prompt_clusters (user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_clusters_vertical  ON prompt_clusters (vertical);
CREATE INDEX IF NOT EXISTS idx_prompt_clusters_source    ON prompt_clusters (source);

CREATE TABLE IF NOT EXISTS benchmark_stats (
    id           SERIAL         PRIMARY KEY,
    vertical     VARCHAR(50)    NOT NULL,
    sample_size  INTEGER        NOT NULL DEFAULT 0,
    overall_avg  NUMERIC(6,2),
    overall_p25  NUMERIC(6,2),
    overall_p50  NUMERIC(6,2),
    overall_p75  NUMERIC(6,2),
    overall_p90  NUMERIC(6,2),
    pillar_stats JSONB          DEFAULT '{}',
    computed_at  TIMESTAMPTZ    DEFAULT NOW(),
    UNIQUE (vertical, computed_at)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_stats_vertical    ON benchmark_stats (vertical);
CREATE INDEX IF NOT EXISTS idx_benchmark_stats_computed_at ON benchmark_stats (computed_at DESC);
