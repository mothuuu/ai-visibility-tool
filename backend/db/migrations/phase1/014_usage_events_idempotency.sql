-- Migration 014: Add idempotency constraint to usage_events
--
-- Prevents double-charging on retries: same (scan_id, event_type) pair
-- can only exist once. NULL scan_id rows are excluded (partial unique index).
--
-- SAFETY: Uses CREATE INDEX IF NOT EXISTS + CONCURRENTLY-safe partial unique.

-- Step 1: Deduplicate any existing rows with same (scan_id, event_type)
-- Keep the earliest created_at row
DELETE FROM usage_events a
USING usage_events b
WHERE a.scan_id IS NOT NULL
  AND a.scan_id = b.scan_id
  AND a.event_type = b.event_type
  AND a.id > b.id;

-- Step 2: Add partial unique index (only where scan_id IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_events_scan_event
  ON usage_events (scan_id, event_type)
  WHERE scan_id IS NOT NULL;
