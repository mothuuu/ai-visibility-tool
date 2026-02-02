-- Rollback Migration 014: Remove idempotency constraint
DROP INDEX IF EXISTS uq_usage_events_scan_event;
