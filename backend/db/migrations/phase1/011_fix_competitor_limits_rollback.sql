-- Rollback Migration 011: Revert competitor scan limits
--
-- Note: This restores the previous incorrect limits. Only use if needed.

-- Revert existing usage_periods rows to old limits
UPDATE usage_periods
SET limits = jsonb_set(
    jsonb_set(limits, '{scans}', '-1'),
    '{competitor_scans}', '0'
)
WHERE plan = 'diy';

UPDATE usage_periods
SET limits = jsonb_set(
    jsonb_set(limits, '{scans}', '-1'),
    '{competitor_scans}', '5'
)
WHERE plan = 'pro';

UPDATE usage_periods
SET limits = jsonb_set(limits, '{competitor_scans}', '-1')
WHERE plan = 'agency';

UPDATE usage_periods
SET limits = jsonb_set(limits, '{competitor_scans}', '-1')
WHERE plan = 'enterprise';

-- Recreate the function with old limits
CREATE OR REPLACE FUNCTION get_or_create_usage_period(p_org_id INTEGER, p_plan VARCHAR(50) DEFAULT 'free')
RETURNS usage_periods AS $$
DECLARE
    v_period usage_periods;
    v_limits JSONB;
    v_lock_acquired BOOLEAN;
BEGIN
    SELECT * INTO v_period FROM usage_periods
    WHERE organization_id = p_org_id AND is_current = true AND period_end > NOW();
    IF FOUND THEN RETURN v_period; END IF;

    SELECT pg_try_advisory_xact_lock(hashtext('usage_period_' || p_org_id::text)) INTO v_lock_acquired;
    IF NOT v_lock_acquired THEN
        PERFORM pg_sleep(0.1);
        SELECT * INTO v_period FROM usage_periods
        WHERE organization_id = p_org_id AND is_current = true AND period_end > NOW();
        IF FOUND THEN RETURN v_period; END IF;
    END IF;

    UPDATE usage_periods SET is_current = false WHERE organization_id = p_org_id AND is_current = true;

    v_limits := CASE p_plan
        WHEN 'free' THEN '{"scans": 2, "competitor_scans": 0, "pages_per_scan": 1}'
        WHEN 'diy' THEN '{"scans": -1, "competitor_scans": 0, "pages_per_scan": 5}'
        WHEN 'pro' THEN '{"scans": -1, "competitor_scans": 5, "pages_per_scan": 25}'
        WHEN 'enterprise' THEN '{"scans": -1, "competitor_scans": -1, "pages_per_scan": -1}'
        WHEN 'agency' THEN '{"scans": -1, "competitor_scans": -1, "pages_per_scan": -1}'
        ELSE '{"scans": 2, "competitor_scans": 0, "pages_per_scan": 1}'
    END::JSONB;

    INSERT INTO usage_periods (organization_id, period_start, period_end, plan, limits, is_current)
    VALUES (p_org_id, date_trunc('month', NOW()), date_trunc('month', NOW()) + INTERVAL '1 month', p_plan, v_limits, true)
    ON CONFLICT (organization_id, period_start) DO UPDATE SET is_current = true
    RETURNING * INTO v_period;

    RETURN v_period;
END;
$$ LANGUAGE plpgsql;
