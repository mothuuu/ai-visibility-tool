-- Migration 009: Backfill Usage Events
-- ⚠️ DATA-CREATING BACKFILL - Rollback will DELETE usage data!

INSERT INTO usage_periods (organization_id, period_start, period_end, plan, limits, is_current)
SELECT o.id, date_trunc('month', NOW()), date_trunc('month', NOW()) + INTERVAL '1 month', o.plan,
    CASE o.plan
        WHEN 'free' THEN '{"scans": 2, "competitor_scans": 0, "pages_per_scan": 1}'
        WHEN 'diy' THEN '{"scans": -1, "competitor_scans": 0, "pages_per_scan": 5}'
        WHEN 'pro' THEN '{"scans": -1, "competitor_scans": 5, "pages_per_scan": 25}'
        ELSE '{"scans": 2, "competitor_scans": 0, "pages_per_scan": 1}'
    END::JSONB, true
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM usage_periods up WHERE up.organization_id = o.id AND up.is_current = true)
ON CONFLICT (organization_id, period_start) DO NOTHING;

INSERT INTO usage_events (organization_id, period_id, user_id, event_type, scan_id, metadata, created_at)
SELECT s.organization_id, up.id, s.user_id,
    CASE WHEN s.is_competitor_scan THEN 'competitor_scan' ELSE 'scan_completed' END,
    s.id, '{"backfilled": true}'::JSONB, COALESCE(s.completed_at, s.created_at)
FROM scans s
JOIN usage_periods up ON up.organization_id = s.organization_id AND up.is_current = true
WHERE s.status = 'completed' AND s.completed_at >= date_trunc('month', NOW()) AND s.organization_id IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM usage_events ue WHERE ue.scan_id = s.id);

DO $$
DECLARE v_periods INTEGER; v_events INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_periods FROM usage_periods WHERE is_current = true;
    SELECT COUNT(*) INTO v_events FROM usage_events WHERE (metadata->>'backfilled')::boolean = true;
    RAISE NOTICE 'Usage backfill: % periods, % events', v_periods, v_events;
END $$;
