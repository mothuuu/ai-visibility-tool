-- Backfill Missing Usage Events - Phase DIY-002
--
-- This script backfills missing usage_events for completed scans in the CURRENT period.
-- It is idempotent - safe to run multiple times.
--
-- Run for a specific org:
--   psql $DATABASE_URL -v org_id=37 -f scripts/backfill_missing_usage_events.sql
--
-- Or replace :org_id with a literal number if not using psql -v

-- ============================================================================
-- 1) Backfill missing competitor_scan events
-- ============================================================================
INSERT INTO usage_events (organization_id, period_id, user_id, event_type, scan_id, metadata, created_at)
SELECT
    s.organization_id,
    up.id as period_id,
    s.user_id,
    'competitor_scan' as event_type,
    s.id as scan_id,
    '{"backfilled": true, "source": "diy_stability_fix"}'::JSONB as metadata,
    COALESCE(s.completed_at, s.created_at) as created_at
FROM scans s
JOIN usage_periods up ON up.organization_id = s.organization_id AND up.is_current = true
WHERE s.organization_id = :org_id
  AND s.domain_type = 'competitor'
  AND s.status = 'completed'
  AND s.completed_at >= up.period_start
  AND s.completed_at < up.period_end
  AND up.id IS NOT NULL  -- Ensure we have a valid period_id
  AND NOT EXISTS (
      SELECT 1 FROM usage_events ue
      WHERE ue.organization_id = s.organization_id
        AND ue.period_id = up.id
        AND ue.scan_id = s.id
        AND ue.event_type = 'competitor_scan'
  );

-- ============================================================================
-- 2) Backfill missing scan_completed events (primary scans)
-- ============================================================================
INSERT INTO usage_events (organization_id, period_id, user_id, event_type, scan_id, metadata, created_at)
SELECT
    s.organization_id,
    up.id as period_id,
    s.user_id,
    'scan_completed' as event_type,
    s.id as scan_id,
    '{"backfilled": true, "source": "diy_stability_fix"}'::JSONB as metadata,
    COALESCE(s.completed_at, s.created_at) as created_at
FROM scans s
JOIN usage_periods up ON up.organization_id = s.organization_id AND up.is_current = true
WHERE s.organization_id = :org_id
  AND s.domain_type = 'primary'
  AND s.status = 'completed'
  AND s.completed_at >= up.period_start
  AND s.completed_at < up.period_end
  AND up.id IS NOT NULL  -- Ensure we have a valid period_id
  AND NOT EXISTS (
      SELECT 1 FROM usage_events ue
      WHERE ue.organization_id = s.organization_id
        AND ue.period_id = up.id
        AND ue.scan_id = s.id
        AND ue.event_type = 'scan_completed'
  );

-- ============================================================================
-- 3) Summary
-- ============================================================================
DO $$
DECLARE
    v_competitor_backfilled INTEGER;
    v_primary_backfilled INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_competitor_backfilled
    FROM usage_events
    WHERE (metadata->>'source') = 'diy_stability_fix'
      AND event_type = 'competitor_scan';

    SELECT COUNT(*) INTO v_primary_backfilled
    FROM usage_events
    WHERE (metadata->>'source') = 'diy_stability_fix'
      AND event_type = 'scan_completed';

    RAISE NOTICE 'Backfill complete: % competitor events, % primary events (with source=diy_stability_fix)',
        v_competitor_backfilled, v_primary_backfilled;
END $$;
