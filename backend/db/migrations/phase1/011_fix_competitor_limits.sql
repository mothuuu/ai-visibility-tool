-- Migration 011: Fix competitor scan limits in existing usage_periods
--
-- Updates the limits JSONB to match the corrected plan limits:
-- - free: 0 competitor scans (unchanged)
-- - diy: 2 competitor scans (was 0)
-- - pro: 3 competitor scans (was 5)
-- - agency: 0 competitor scans (was unlimited/-1)
-- - enterprise: 10 competitor scans (was unlimited/-1)
--
-- Also updates the get_or_create_usage_period function with correct limits.

-- Update existing usage_periods rows with corrected limits
UPDATE usage_periods
SET limits = jsonb_set(
    jsonb_set(limits, '{scans}', '25'),
    '{competitor_scans}', '2'
)
WHERE plan = 'diy';

UPDATE usage_periods
SET limits = jsonb_set(
    jsonb_set(limits, '{scans}', '50'),
    '{competitor_scans}', '3'
)
WHERE plan = 'pro';

UPDATE usage_periods
SET limits = jsonb_set(limits, '{competitor_scans}', '0')
WHERE plan = 'agency';

UPDATE usage_periods
SET limits = jsonb_set(limits, '{competitor_scans}', '10')
WHERE plan = 'enterprise';

-- Recreate the function with corrected limits
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
        WHEN 'diy' THEN '{"scans": 25, "competitor_scans": 2, "pages_per_scan": 5}'
        WHEN 'pro' THEN '{"scans": 50, "competitor_scans": 3, "pages_per_scan": 25}'
        WHEN 'agency' THEN '{"scans": -1, "competitor_scans": 0, "pages_per_scan": -1}'
        WHEN 'enterprise' THEN '{"scans": -1, "competitor_scans": 10, "pages_per_scan": -1}'
        ELSE '{"scans": 2, "competitor_scans": 0, "pages_per_scan": 1}'
    END::JSONB;

    INSERT INTO usage_periods (organization_id, period_start, period_end, plan, limits, is_current)
    VALUES (p_org_id, date_trunc('month', NOW()), date_trunc('month', NOW()) + INTERVAL '1 month', p_plan, v_limits, true)
    ON CONFLICT (organization_id, period_start) DO UPDATE SET is_current = true
    RETURNING * INTO v_period;

    RETURN v_period;
END;
$$ LANGUAGE plpgsql;
