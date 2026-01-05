-- Migration 008: Usage Foundation (Event-Sourced)

CREATE TABLE IF NOT EXISTS usage_periods (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    plan VARCHAR(50) NOT NULL,
    limits JSONB NOT NULL DEFAULT '{}',
    is_current BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_period_dates CHECK (period_end > period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_periods_org_start ON usage_periods(organization_id, period_start);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_periods_current ON usage_periods(organization_id) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_usage_periods_org ON usage_periods(organization_id);

CREATE TABLE IF NOT EXISTS usage_events (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_id INTEGER NOT NULL REFERENCES usage_periods(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('scan_started', 'scan_completed', 'scan_failed', 'competitor_scan', 'recommendation_generated', 'recommendation_unlocked', 'export_pdf', 'export_csv', 'api_call', 'content_generated')),
    scan_id INTEGER,
    recommendation_id INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_org ON usage_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_period ON usage_events(period_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_type ON usage_events(event_type);
CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at DESC);

-- Race-safe period creation with advisory lock
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
        WHEN 'diy' THEN '{"scans": 25, "competitor_scans": 1, "pages_per_scan": 5}'
        WHEN 'pro' THEN '{"scans": 50, "competitor_scans": 3, "pages_per_scan": 25}'
        WHEN 'agency' THEN '{"scans": -1, "competitor_scans": 10, "pages_per_scan": -1}'
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

CREATE OR REPLACE FUNCTION record_usage_event(p_org_id INTEGER, p_event_type VARCHAR(50), p_user_id INTEGER DEFAULT NULL, p_scan_id INTEGER DEFAULT NULL, p_metadata JSONB DEFAULT '{}')
RETURNS usage_events AS $$
DECLARE v_period usage_periods; v_event usage_events; v_plan VARCHAR(50);
BEGIN
    SELECT plan INTO v_plan FROM organizations WHERE id = p_org_id;
    v_period := get_or_create_usage_period(p_org_id, COALESCE(v_plan, 'free'));
    INSERT INTO usage_events (organization_id, period_id, user_id, event_type, scan_id, metadata)
    VALUES (p_org_id, v_period.id, p_user_id, p_event_type, p_scan_id, p_metadata)
    RETURNING * INTO v_event;
    RETURN v_event;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_usage_summary(p_org_id INTEGER)
RETURNS TABLE (period_id INTEGER, period_start TIMESTAMPTZ, period_end TIMESTAMPTZ, plan VARCHAR(50), limits JSONB, scans_used BIGINT, competitor_scans_used BIGINT, recommendations_generated BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT up.id, up.period_start, up.period_end, up.plan, up.limits,
        COUNT(*) FILTER (WHERE ue.event_type = 'scan_completed'),
        COUNT(*) FILTER (WHERE ue.event_type = 'competitor_scan'),
        COUNT(*) FILTER (WHERE ue.event_type = 'recommendation_generated')
    FROM usage_periods up
    LEFT JOIN usage_events ue ON ue.period_id = up.id
    WHERE up.organization_id = p_org_id AND up.is_current = true
    GROUP BY up.id;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION check_usage_limit(p_org_id INTEGER, p_event_type VARCHAR(50))
RETURNS TABLE (allowed BOOLEAN, current_usage BIGINT, limit_value INTEGER, message TEXT) AS $$
DECLARE v_summary RECORD; v_limit_key TEXT; v_current BIGINT; v_limit INTEGER;
BEGIN
    SELECT * INTO v_summary FROM get_usage_summary(p_org_id);
    IF v_summary IS NULL THEN RETURN QUERY SELECT true, 0::BIGINT, -1, 'No period'::TEXT; RETURN; END IF;

    v_limit_key := CASE p_event_type
        WHEN 'scan_started' THEN 'scans'
        WHEN 'scan_completed' THEN 'scans'
        WHEN 'competitor_scan' THEN 'competitor_scans'
        ELSE NULL
    END;
    IF v_limit_key IS NULL THEN RETURN QUERY SELECT true, 0::BIGINT, -1, 'No limit'::TEXT; RETURN; END IF;

    v_current := CASE v_limit_key
        WHEN 'scans' THEN v_summary.scans_used
        WHEN 'competitor_scans' THEN v_summary.competitor_scans_used
    END;

    -- Handle NULL limit keys safely (default to unlimited)
    v_limit := COALESCE((v_summary.limits->>v_limit_key)::INTEGER, -1);

    IF v_limit = -1 THEN
        RETURN QUERY SELECT true, v_current, -1, 'Unlimited'::TEXT;
    ELSIF v_current >= v_limit THEN
        RETURN QUERY SELECT false, v_current, v_limit, 'Limit reached'::TEXT;
    ELSE
        RETURN QUERY SELECT true, v_current, v_limit, 'OK'::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;
