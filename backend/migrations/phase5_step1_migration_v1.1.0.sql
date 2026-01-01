-- ============================================
-- PHASE 5: SUBMISSION FRAMEWORK (UPDATED)
-- Step 1: Database Migration (v1.1.0)
-- ============================================
--
-- Version: 1.1.0
-- Date: 2024-12-31
-- Depends on: submission-enums-v2.4.js
--
-- Adds / fixes vs v1.0.0:
--  A) Ensures gen_random_uuid() works via pgcrypto extension
--  B) Adds updated_at auto-touch triggers (targets, runs, directories)
--  C) Adds state-dependent CHECK constraints (action_needed, failed, lock fields, changes_ack)
--  D) Adds STATUS_REASON as a DB enum + constrains status_reason columns
--  E) Adds DB trigger to keep submission_targets.current_status/current_run_id in sync
--
-- Notes:
--  - Idempotent: safe to run on an already-migrated schema
--  - If you already have rows with status_reason values not in STATUS_REASON, the enum cast will fail.
--    In that case: fix bad values first OR keep status_reason as VARCHAR and skip Section D.
--
-- ============================================

BEGIN;

-- ============================================
-- SECTION 0: REQUIRED EXTENSIONS
-- ============================================

-- gen_random_uuid() comes from pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- SECTION 1: POSTGRESQL ENUM TYPES (core)
-- Mirror submission-enums-v2.4.js
-- ============================================

DO $$
BEGIN
  -- Submission status (17 states)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_status') THEN
    CREATE TYPE submission_status AS ENUM (
      'queued',
      'deferred',
      'paused',
      'in_progress',
      'action_needed',
      'submitted',
      'awaiting_review',
      'approved',
      'live',
      'needs_changes',
      'failed',
      'rejected',
      'blocked',
      'disabled',
      'expired',
      'already_listed',
      'cancelled'
    );
  END IF;

  -- Triggered by (6 values)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'triggered_by') THEN
    CREATE TYPE triggered_by AS ENUM (
      'worker',
      'user',
      'admin',
      'webhook',
      'scheduler',
      'system'
    );
  END IF;

  -- Action needed type (12 types)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'action_needed_type') THEN
    CREATE TYPE action_needed_type AS ENUM (
      'captcha',
      'reauth',
      'mfa',
      'login_required',
      'manual_review',
      'content_fix',
      'missing_fields',
      'consent_required',
      'payment_required',
      'verification',
      'claim_listing',
      'other'
    );
  END IF;

  -- Error type (18 types)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'error_type') THEN
    CREATE TYPE error_type AS ENUM (
      'network_error',
      'timeout',
      'rate_limited',
      'server_error',
      'temporary_failure',
      'validation_error',
      'auth_error',
      'not_found',
      'forbidden',
      'duplicate',
      'tos_violation',
      'invalid_payload',
      'unsupported',
      'connector_error',
      'config_error',
      'lock_error',
      'redaction_error',
      'unknown'
    );
  END IF;

  -- Artifact type (22 types)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'artifact_type') THEN
    CREATE TYPE artifact_type AS ENUM (
      'request_payload',
      'response_payload',
      'status_check_request',
      'status_check_response',
      'webhook_payload',
      'payload_mapping_result',
      'screenshot_pre',
      'screenshot_post',
      'screenshot_error',
      'screenshot_listing',
      'confirmation_email',
      'submission_receipt',
      'external_id',
      'listing_url',
      'duplicate_check',
      'validation_result',
      'live_verification_result',
      'error_log',
      'retry_log',
      'raw_status',
      'submission_packet',
      'instructions'
    );
  END IF;

  -- Submission event type (46 types)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_event_type') THEN
    CREATE TYPE submission_event_type AS ENUM (
      'status_change',
      'created',
      'started',
      'completed',
      'connector_called',
      'connector_response',
      'connector_error',
      'validation_started',
      'validation_passed',
      'validation_failed',
      'field_mapping_completed',
      'submitted',
      'duplicate_found',
      'external_id_received',
      'status_check_started',
      'status_check_completed',
      'webhook_received',
      'live_verification_started',
      'live_verified',
      'live_verification_failed',
      'artifact_stored',
      'artifact_redacted',
      'artifact_redaction_failed',
      'retry_scheduled',
      'retry_attempted',
      'retry_blocked_no_changes',
      'rate_limited',
      'backoff_applied',
      'circuit_opened',
      'circuit_closed',
      'circuit_half_open',
      'lock_acquired',
      'lock_released',
      'lock_expired',
      'lock_contention',
      'action_required',
      'action_resolved',
      'action_expired',
      'user_paused',
      'user_resumed',
      'user_cancelled',
      'user_changes_acknowledged',
      'manual_re_enabled',
      'new_run_created',
      'error_occurred',
      'auth_failed',
      'timeout'
    );
  END IF;

  -- Integration bucket (4 types)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'integration_bucket') THEN
    CREATE TYPE integration_bucket AS ENUM ('A', 'B', 'C', 'D');
  END IF;

  -- Submission mode (5 modes)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_mode') THEN
    CREATE TYPE submission_mode AS ENUM ('api', 'form', 'browser', 'assisted', 'manual');
  END IF;

  -- Live verification method (6 methods)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'live_verification_method') THEN
    CREATE TYPE live_verification_method AS ENUM (
      'api_confirmation',
      'scrape_check',
      'directory_search',
      'listing_url_200',
      'manual_confirmation',
      'webhook_confirmed'
    );
  END IF;

  -- Status check strategy (6 strategies)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_check_strategy') THEN
    CREATE TYPE status_check_strategy AS ENUM ('poll', 'webhook', 'hybrid', 'email', 'portal', 'none');
  END IF;

  -- Artifact redaction mode (3 modes)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'artifact_redaction_mode') THEN
    CREATE TYPE artifact_redaction_mode AS ENUM ('strict_fail_on_leak', 'best_effort', 'skip');
  END IF;
END $$;

-- ============================================
-- SECTION 1B: STATUS_REASON (DB ENUM)
-- Matches STATUS_REASON in JS (submission-enums-v2.4.js)
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_reason') THEN
    CREATE TYPE status_reason AS ENUM (
      -- Scheduling
      'rate_limited',
      'backoff',
      'scheduled',

      -- Validation
      'validation_failed',
      'missing_required_fields',
      'invalid_data',

      -- Duplicate
      'duplicate_found',
      'already_exists',

      -- Auth
      'auth_expired',
      'auth_failed',
      'reauth_required',

      -- Action needed
      'captcha_required',
      'mfa_required',
      'login_required',
      'consent_required',
      'payment_required',
      'verification_required',

      -- Directory response
      'directory_approved',
      'directory_rejected',
      'directory_changes_requested',
      'directory_blocked',

      -- Technical
      'network_error',
      'timeout',
      'server_error',
      'connector_error',

      -- Circuit breaker
      'circuit_open',
      'circuit_closed',

      -- User/Admin actions
      'manual_pause',
      'manual_resume',
      'manual_cancel',
      'manual_re_enable',
      'changes_acknowledged',

      -- Success
      'submission_accepted',
      'live_verified',

      -- Expiry
      'action_deadline_expired',
      'review_window_expired',

      -- Lock
      'lock_acquired',
      'lock_released',
      'lock_expired',
      'lock_contention'
    );
  END IF;
END $$;

-- ============================================
-- SECTION 2: DIRECTORIES TABLE UPDATES
-- Adds Phase 5 columns if not present + updated_at touch trigger
-- ============================================

ALTER TABLE directories
  ADD COLUMN IF NOT EXISTS integration_bucket integration_bucket,
  ADD COLUMN IF NOT EXISTS default_submission_mode submission_mode DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS status_check_strategy status_check_strategy DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS supports_webhooks BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS connector_key VARCHAR(64),
  ADD COLUMN IF NOT EXISTS connector_version VARCHAR(16),
  ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '[]';

ALTER TABLE directories
  ADD COLUMN IF NOT EXISTS api_docs_url TEXT,
  ADD COLUMN IF NOT EXISTS auth_method VARCHAR(32); -- left as varchar intentionally (not part of gaps list)

ALTER TABLE directories
  ADD COLUMN IF NOT EXISTS tos_allows_automation BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tos_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tos_notes TEXT;

ALTER TABLE directories
  ADD COLUMN IF NOT EXISTS rate_limit_rpm INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS rate_limit_rpd INTEGER DEFAULT 100;

ALTER TABLE directories
  ADD COLUMN IF NOT EXISTS avg_approval_days INTEGER,
  ADD COLUMN IF NOT EXISTS field_requirements JSONB DEFAULT '{}';

-- Ensure directories.updated_at exists (many schemas already have it; safe either way)
ALTER TABLE directories
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ============================================
-- SECTION 3: CORE TABLES (create if not exists)
-- submission_targets, submission_runs, submission_events, submission_artifacts
-- ============================================

CREATE TABLE IF NOT EXISTS submission_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  directory_id INTEGER NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,

  -- Configuration
  connector_key VARCHAR(64),
  submission_mode submission_mode NOT NULL DEFAULT 'manual',
  priority INTEGER NOT NULL DEFAULT 50,

  -- Scheduling
  scheduled_for TIMESTAMPTZ,
  sla_deadline TIMESTAMPTZ,

  -- Current state (denormalized)
  current_status submission_status NOT NULL DEFAULT 'queued',
  current_run_id UUID, -- FK added after submission_runs

  -- External tracking
  external_listing_id VARCHAR(255),
  external_listing_url TEXT,

  -- Live verification
  live_verified_at TIMESTAMPTZ,
  live_verification_method live_verification_method,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT submission_targets_priority_range CHECK (priority BETWEEN 1 AND 100),
  CONSTRAINT submission_targets_unique_business_directory UNIQUE (business_profile_id, directory_id)
);

COMMENT ON TABLE submission_targets IS 'Links a business profile to a directory for submission tracking';
COMMENT ON COLUMN submission_targets.current_status IS 'Denormalized from latest run for efficient queries';
COMMENT ON COLUMN submission_targets.current_run_id IS 'Points to the active/latest submission run';

CREATE TABLE IF NOT EXISTS submission_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_target_id UUID NOT NULL REFERENCES submission_targets(id) ON DELETE CASCADE,

  -- Attempt tracking
  attempt_no INTEGER NOT NULL DEFAULT 1,
  previous_run_id UUID REFERENCES submission_runs(id) ON DELETE SET NULL,

  -- Status
  status submission_status NOT NULL DEFAULT 'queued',
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_reason VARCHAR(64), -- will be converted to status_reason enum below

  -- Scheduling
  next_run_at TIMESTAMPTZ,

  -- Lock fields
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(64),
  lease_expires_at TIMESTAMPTZ,

  -- Correlation
  correlation_id UUID DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(128),

  -- External tracking
  external_submission_id VARCHAR(255),

  -- Error tracking
  last_error_type error_type,
  last_error_code VARCHAR(64),
  last_error_message TEXT,

  -- Action needed
  action_needed_type action_needed_type,
  action_needed_url TEXT,
  action_needed_fields JSONB,
  action_needed_deadline TIMESTAMPTZ,

  -- Raw directory response
  raw_status VARCHAR(64),
  raw_status_message TEXT,

  -- Retry semantics
  changes_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  changes_acknowledged_at TIMESTAMPTZ,
  changes_acknowledged_by VARCHAR(64),

  -- Who triggered
  triggered_by triggered_by NOT NULL DEFAULT 'system',
  triggered_by_id VARCHAR(64),

  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT submission_runs_attempt_positive CHECK (attempt_no >= 1)
);

COMMENT ON TABLE submission_runs IS 'Each submission attempt with full state tracking';
COMMENT ON COLUMN submission_runs.previous_run_id IS 'Links to prior attempt for retry lineage';
COMMENT ON COLUMN submission_runs.correlation_id IS 'Shared across retry chain for tracing';
COMMENT ON COLUMN submission_runs.changes_acknowledged IS 'Required true for retry from REJECTED/NEEDS_CHANGES';

-- FK: submission_targets.current_run_id -> submission_runs.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_submission_targets_current_run'
  ) THEN
    ALTER TABLE submission_targets
      ADD CONSTRAINT fk_submission_targets_current_run
      FOREIGN KEY (current_run_id) REFERENCES submission_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS submission_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  submission_run_id UUID NOT NULL REFERENCES submission_runs(id) ON DELETE CASCADE,
  submission_target_id UUID NOT NULL REFERENCES submission_targets(id) ON DELETE CASCADE,

  event_type submission_event_type NOT NULL,

  -- Status change specific
  from_status submission_status,
  to_status submission_status,
  status_reason VARCHAR(64), -- will be converted to status_reason enum below

  triggered_by triggered_by NOT NULL DEFAULT 'system',
  triggered_by_id VARCHAR(64),

  event_data JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE submission_events IS 'Immutable audit log - no updates or deletes allowed';
COMMENT ON COLUMN submission_events.event_data IS 'Flexible JSON payload for event-specific data';

CREATE TABLE IF NOT EXISTS submission_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  submission_run_id UUID REFERENCES submission_runs(id) ON DELETE CASCADE,
  submission_target_id UUID REFERENCES submission_targets(id) ON DELETE CASCADE,

  artifact_type artifact_type NOT NULL,

  content_type VARCHAR(128) NOT NULL DEFAULT 'application/json',
  content JSONB,
  content_text TEXT,
  content_url TEXT,
  size_bytes INTEGER,
  checksum VARCHAR(64),

  redaction_mode artifact_redaction_mode NOT NULL DEFAULT 'best_effort',
  redaction_applied BOOLEAN NOT NULL DEFAULT FALSE,
  redaction_leaks_count INTEGER DEFAULT 0,

  metadata JSONB NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT artifact_must_have_link CHECK (
    submission_run_id IS NOT NULL OR submission_target_id IS NOT NULL
  ),
  CONSTRAINT artifact_must_have_content CHECK (
    content IS NOT NULL OR content_text IS NOT NULL OR content_url IS NOT NULL
  )
);

COMMENT ON TABLE submission_artifacts IS 'Evidence storage for submission payloads, screenshots, etc.';
COMMENT ON COLUMN submission_artifacts.redaction_mode IS 'How sensitive data was handled (strict/best_effort/skip)';
COMMENT ON COLUMN submission_artifacts.redaction_leaks_count IS 'Number of potential leaks detected (for telemetry)';

-- ============================================
-- SECTION 4: IMMUTABILITY TRIGGER (events)
-- ============================================

CREATE OR REPLACE FUNCTION prevent_submission_events_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'submission_events table is append-only. Updates and deletes are not permitted.';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'submission_events_immutable_trigger'
  ) THEN
    CREATE TRIGGER submission_events_immutable_trigger
      BEFORE UPDATE OR DELETE ON submission_events
      FOR EACH ROW
      EXECUTE FUNCTION prevent_submission_events_modification();
  END IF;
END $$;

-- ============================================
-- SECTION 5: STATUS_REASON COLUMN HARDENING (ENUM + CAST)
-- ============================================

-- Convert submission_runs.status_reason to status_reason enum (if still varchar)
DO $$
DECLARE
  v_data_type TEXT;
BEGIN
  SELECT data_type INTO v_data_type
  FROM information_schema.columns
  WHERE table_name = 'submission_runs' AND column_name = 'status_reason';

  IF v_data_type = 'character varying' OR v_data_type = 'text' THEN
    -- Will fail if existing values are outside enum list
    EXECUTE 'ALTER TABLE submission_runs
             ALTER COLUMN status_reason TYPE status_reason
             USING NULLIF(status_reason, '''')::status_reason';
  END IF;
END $$;

-- Convert submission_events.status_reason to status_reason enum (if still varchar)
DO $$
DECLARE
  v_data_type TEXT;
BEGIN
  SELECT data_type INTO v_data_type
  FROM information_schema.columns
  WHERE table_name = 'submission_events' AND column_name = 'status_reason';

  IF v_data_type = 'character varying' OR v_data_type = 'text' THEN
    -- Should typically be NULL for non-status_change events; cast still safe
    EXECUTE 'ALTER TABLE submission_events
             ALTER COLUMN status_reason TYPE status_reason
             USING NULLIF(status_reason, '''')::status_reason';
  END IF;
END $$;

-- ============================================
-- SECTION 6: UPDATED_AT AUTO-TOUCH TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- submission_targets.updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_submission_targets_touch_updated_at') THEN
    CREATE TRIGGER trg_submission_targets_touch_updated_at
      BEFORE UPDATE ON submission_targets
      FOR EACH ROW
      EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- submission_runs.updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_submission_runs_touch_updated_at') THEN
    CREATE TRIGGER trg_submission_runs_touch_updated_at
      BEFORE UPDATE ON submission_runs
      FOR EACH ROW
      EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- directories.updated_at (optional but useful)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_directories_touch_updated_at') THEN
    CREATE TRIGGER trg_directories_touch_updated_at
      BEFORE UPDATE ON directories
      FOR EACH ROW
      EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- ============================================
-- SECTION 7: STATE-DEPENDENT CHECK CONSTRAINTS
-- ============================================

-- 7A) ACTION_NEEDED must have action_needed_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'submission_runs_action_needed_requires_type') THEN
    ALTER TABLE submission_runs
      ADD CONSTRAINT submission_runs_action_needed_requires_type
      CHECK (
        status <> 'action_needed'
        OR action_needed_type IS NOT NULL
      );
  END IF;
END $$;

-- 7B) FAILED must have last_error_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'submission_runs_failed_requires_error_type') THEN
    ALTER TABLE submission_runs
      ADD CONSTRAINT submission_runs_failed_requires_error_type
      CHECK (
        status <> 'failed'
        OR last_error_type IS NOT NULL
      );
  END IF;
END $$;

-- 7C) Lock fields must be consistent
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'submission_runs_lock_fields_consistent') THEN
    ALTER TABLE submission_runs
      ADD CONSTRAINT submission_runs_lock_fields_consistent
      CHECK (
        (locked_at IS NULL AND locked_by IS NULL AND lease_expires_at IS NULL)
        OR (locked_at IS NOT NULL AND locked_by IS NOT NULL AND lease_expires_at IS NOT NULL)
      );
  END IF;
END $$;

-- 7D) changes_acknowledged_at implies changes_acknowledged = true
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'submission_runs_changes_ack_timestamp_consistent') THEN
    ALTER TABLE submission_runs
      ADD CONSTRAINT submission_runs_changes_ack_timestamp_consistent
      CHECK (
        changes_acknowledged_at IS NULL
        OR changes_acknowledged = TRUE
      );
  END IF;
END $$;

-- 7E) changes_acknowledged_by implies changes_acknowledged = true
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'submission_runs_changes_ack_by_consistent') THEN
    ALTER TABLE submission_runs
      ADD CONSTRAINT submission_runs_changes_ack_by_consistent
      CHECK (
        changes_acknowledged_by IS NULL
        OR changes_acknowledged = TRUE
      );
  END IF;
END $$;

-- ============================================
-- SECTION 8: DENORMALIZATION SYNC (targets.current_status/current_run_id)
-- Keeps targets in sync with inserts/updates to runs
-- ============================================

CREATE OR REPLACE FUNCTION sync_submission_target_current_from_run()
RETURNS TRIGGER AS $$
DECLARE
  v_current_run_created_at TIMESTAMPTZ;
BEGIN
  -- If target has no current run, always set it
  IF (SELECT current_run_id FROM submission_targets WHERE id = NEW.submission_target_id) IS NULL THEN
    UPDATE submission_targets
    SET current_run_id = NEW.id,
        current_status = NEW.status
    WHERE id = NEW.submission_target_id;
    RETURN NEW;
  END IF;

  -- If this is an UPDATE, only sync if this run is already the target's current run
  IF TG_OP = 'UPDATE' THEN
    UPDATE submission_targets
    SET current_status = NEW.status
    WHERE id = NEW.submission_target_id
      AND current_run_id = NEW.id;
    RETURN NEW;
  END IF;

  -- TG_OP = 'INSERT': only replace current_run_id if this run is newer than current run
  SELECT r.created_at
    INTO v_current_run_created_at
  FROM submission_targets t
  JOIN submission_runs r ON r.id = t.current_run_id
  WHERE t.id = NEW.submission_target_id;

  IF v_current_run_created_at IS NULL OR NEW.created_at >= v_current_run_created_at THEN
    UPDATE submission_targets
    SET current_run_id = NEW.id,
        current_status = NEW.status
    WHERE id = NEW.submission_target_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: after INSERT on submission_runs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_runs_sync_target_on_insert') THEN
    CREATE TRIGGER trg_runs_sync_target_on_insert
      AFTER INSERT ON submission_runs
      FOR EACH ROW
      EXECUTE FUNCTION sync_submission_target_current_from_run();
  END IF;
END $$;

-- Trigger: after UPDATE of status on submission_runs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_runs_sync_target_on_status_update') THEN
    CREATE TRIGGER trg_runs_sync_target_on_status_update
      AFTER UPDATE OF status ON submission_runs
      FOR EACH ROW
      EXECUTE FUNCTION sync_submission_target_current_from_run();
  END IF;
END $$;

-- ============================================
-- SECTION 9: INDEXES (same as v1.0.0 + safe adds)
-- ============================================

-- === submission_targets ===
CREATE INDEX IF NOT EXISTS idx_submission_targets_directory
  ON submission_targets(directory_id, current_status);

CREATE INDEX IF NOT EXISTS idx_submission_targets_business
  ON submission_targets(business_profile_id, current_status);

CREATE INDEX IF NOT EXISTS idx_submission_targets_order
  ON submission_targets(order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submission_targets_scheduled
  ON submission_targets(scheduled_for)
  WHERE scheduled_for IS NOT NULL AND current_status = 'queued';

-- === submission_runs ===
CREATE INDEX IF NOT EXISTS idx_submission_runs_dequeue
  ON submission_runs(status, next_run_at)
  WHERE status IN ('queued', 'deferred');

CREATE INDEX IF NOT EXISTS idx_submission_runs_deferred_due
  ON submission_runs(next_run_at)
  WHERE status = 'deferred' AND next_run_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submission_runs_locks
  ON submission_runs(locked_by, lease_expires_at)
  WHERE locked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submission_runs_lock_check
  ON submission_runs(id)
  WHERE status = 'in_progress' AND locked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submission_runs_expired_locks
  ON submission_runs(lease_expires_at)
  WHERE status = 'in_progress' AND locked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submission_runs_target
  ON submission_runs(submission_target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_submission_runs_status
  ON submission_runs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_submission_runs_action_needed
  ON submission_runs(action_needed_type, action_needed_deadline)
  WHERE status = 'action_needed';

CREATE INDEX IF NOT EXISTS idx_submission_runs_failed
  ON submission_runs(last_error_type, created_at DESC)
  WHERE status = 'failed';

CREATE INDEX IF NOT EXISTS idx_submission_runs_correlation
  ON submission_runs(correlation_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_submission_runs_idempotency
  ON submission_runs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- === submission_events ===
CREATE INDEX IF NOT EXISTS idx_submission_events_run
  ON submission_events(submission_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_submission_events_target
  ON submission_events(submission_target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_submission_events_type
  ON submission_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_submission_events_status_changes
  ON submission_events(submission_run_id, created_at)
  WHERE event_type = 'status_change';

CREATE INDEX IF NOT EXISTS idx_submission_events_triggered_by
  ON submission_events(triggered_by, triggered_by_id, created_at DESC)
  WHERE triggered_by_id IS NOT NULL;

-- === submission_artifacts ===
CREATE INDEX IF NOT EXISTS idx_submission_artifacts_run
  ON submission_artifacts(submission_run_id, artifact_type)
  WHERE submission_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submission_artifacts_target
  ON submission_artifacts(submission_target_id, artifact_type)
  WHERE submission_target_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submission_artifacts_expired
  ON submission_artifacts(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submission_artifacts_leaks
  ON submission_artifacts(redaction_leaks_count, created_at DESC)
  WHERE redaction_leaks_count > 0;

-- === directories ===
CREATE INDEX IF NOT EXISTS idx_directories_integration_bucket
  ON directories(integration_bucket)
  WHERE integration_bucket IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_directories_connector
  ON directories(connector_key)
  WHERE connector_key IS NOT NULL;

-- ============================================
-- SECTION 10: HELPER FUNCTIONS (same as v1.0.0)
-- ============================================

CREATE OR REPLACE FUNCTION get_run_lineage(p_run_id UUID)
RETURNS TABLE (
  id UUID,
  previous_run_id UUID,
  attempt_no INTEGER,
  status submission_status,
  created_at TIMESTAMPTZ,
  depth INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE lineage AS (
    SELECT
      r.id,
      r.previous_run_id,
      r.attempt_no,
      r.status,
      r.created_at,
      0 as depth
    FROM submission_runs r
    WHERE r.id = p_run_id

    UNION ALL

    SELECT
      r.id,
      r.previous_run_id,
      r.attempt_no,
      r.status,
      r.created_at,
      l.depth + 1
    FROM submission_runs r
    JOIN lineage l ON r.id = l.previous_run_id
    WHERE l.depth < 100
  )
  SELECT * FROM lineage ORDER BY attempt_no ASC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_run_lineage IS 'Returns full attempt history for a run by walking previous_run_id chain';

CREATE OR REPLACE FUNCTION can_acquire_lock(
  p_run_id UUID,
  p_worker_id VARCHAR(64),
  p_grace_ms INTEGER DEFAULT 30000
)
RETURNS TABLE (
  can_lock BOOLEAN,
  reason VARCHAR(32),
  current_holder VARCHAR(64),
  expires_at TIMESTAMPTZ
) AS $$
DECLARE
  v_run RECORD;
BEGIN
  SELECT locked_at, locked_by, lease_expires_at
  INTO v_run
  FROM submission_runs
  WHERE id = p_run_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'not_found'::VARCHAR(32), NULL::VARCHAR(64), NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_run.locked_at IS NULL OR v_run.locked_by IS NULL THEN
    RETURN QUERY SELECT TRUE, 'available'::VARCHAR(32), NULL::VARCHAR(64), NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_run.locked_by = p_worker_id THEN
    RETURN QUERY SELECT TRUE, 'already_held'::VARCHAR(32), v_run.locked_by, v_run.lease_expires_at;
    RETURN;
  END IF;

  IF v_run.lease_expires_at < NOW() - (p_grace_ms || ' milliseconds')::INTERVAL THEN
    RETURN QUERY SELECT TRUE, 'lease_expired'::VARCHAR(32), v_run.locked_by, v_run.lease_expires_at;
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE, 'lock_held'::VARCHAR(32), v_run.locked_by, v_run.lease_expires_at;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION can_acquire_lock IS 'Check if a worker can acquire lock on a run';

-- ============================================
-- SECTION 11: VERIFICATION QUICK CHECKS (server notices)
-- ============================================

DO $$
DECLARE
  v_missing TEXT := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_status') THEN v_missing := v_missing || 'submission_status, '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'triggered_by') THEN v_missing := v_missing || 'triggered_by, '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'action_needed_type') THEN v_missing := v_missing || 'action_needed_type, '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'error_type') THEN v_missing := v_missing || 'error_type, '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'artifact_type') THEN v_missing := v_missing || 'artifact_type, '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_event_type') THEN v_missing := v_missing || 'submission_event_type, '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'integration_bucket') THEN v_missing := v_missing || 'integration_bucket, '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_mode') THEN v_missing := v_missing || 'submission_mode, '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_reason') THEN v_missing := v_missing || 'status_reason, '; END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'Missing enum types: %', v_missing;
  ELSE
    RAISE NOTICE '✓ Enum types present (including status_reason)';
  END IF;
END $$;

DO $$
DECLARE
  v_missing TEXT := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'submission_targets') THEN v_missing := v_missing || 'submission_targets, '; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'submission_runs') THEN v_missing := v_missing || 'submission_runs, '; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'submission_events') THEN v_missing := v_missing || 'submission_events, '; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'submission_artifacts') THEN v_missing := v_missing || 'submission_artifacts, '; END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'Missing tables: %', v_missing;
  ELSE
    RAISE NOTICE '✓ Core tables present';
  END IF;
END $$;

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_indexes
  WHERE indexname LIKE 'idx_submission_%';

  RAISE NOTICE '✓ Found % submission-related indexes', v_count;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'submission_events_immutable_trigger') THEN
    RAISE NOTICE '✓ Events immutability trigger active';
  ELSE
    RAISE WARNING '⚠ Events immutability trigger NOT found';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_runs_sync_target_on_insert') THEN
    RAISE NOTICE '✓ Target denormalization sync trigger active';
  ELSE
    RAISE WARNING '⚠ Target denormalization sync trigger NOT found';
  END IF;
END $$;

COMMIT;
