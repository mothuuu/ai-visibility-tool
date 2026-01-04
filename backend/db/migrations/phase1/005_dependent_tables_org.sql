-- Migration 005: Add organization_id to Dependent Tables
-- LINKAGE BACKFILL - Rollback removes columns but doesn't delete core business data

-- scan_recommendations
ALTER TABLE scan_recommendations ADD COLUMN IF NOT EXISTS organization_id INTEGER;
UPDATE scan_recommendations sr SET organization_id = s.organization_id FROM scans s WHERE sr.scan_id = s.id AND sr.organization_id IS NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_scan_recommendations_org') THEN ALTER TABLE scan_recommendations ADD CONSTRAINT fk_scan_recommendations_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE; END IF; END $$;
CREATE INDEX IF NOT EXISTS idx_scan_recommendations_org ON scan_recommendations(organization_id);

-- usage_logs
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS organization_id INTEGER;
UPDATE usage_logs ul SET organization_id = u.organization_id FROM users u WHERE ul.user_id = u.id AND ul.organization_id IS NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_usage_logs_org') THEN ALTER TABLE usage_logs ADD CONSTRAINT fk_usage_logs_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE; END IF; END $$;
CREATE INDEX IF NOT EXISTS idx_usage_logs_org ON usage_logs(organization_id);

-- user_progress
ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS organization_id INTEGER;
UPDATE user_progress up SET organization_id = u.organization_id FROM users u WHERE up.user_id = u.id AND up.organization_id IS NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_progress_org') THEN ALTER TABLE user_progress ADD CONSTRAINT fk_user_progress_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE; END IF; END $$;
CREATE INDEX IF NOT EXISTS idx_user_progress_org ON user_progress(organization_id);

-- recommendation_refresh_cycles
ALTER TABLE recommendation_refresh_cycles ADD COLUMN IF NOT EXISTS organization_id INTEGER;
UPDATE recommendation_refresh_cycles rrc SET organization_id = s.organization_id FROM scans s WHERE rrc.scan_id = s.id AND rrc.organization_id IS NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rec_refresh_cycles_org') THEN ALTER TABLE recommendation_refresh_cycles ADD CONSTRAINT fk_rec_refresh_cycles_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE; END IF; END $$;
CREATE INDEX IF NOT EXISTS idx_rec_refresh_cycles_org ON recommendation_refresh_cycles(organization_id);

DO $$
DECLARE v_recs INTEGER; v_logs INTEGER; v_prog INTEGER; v_cycles INTEGER;
BEGIN
    SELECT COUNT(organization_id) INTO v_recs FROM scan_recommendations;
    SELECT COUNT(organization_id) INTO v_logs FROM usage_logs;
    SELECT COUNT(organization_id) INTO v_prog FROM user_progress;
    SELECT COUNT(organization_id) INTO v_cycles FROM recommendation_refresh_cycles;
    RAISE NOTICE 'Org backfill - recs: %, logs: %, progress: %, cycles: %', v_recs, v_logs, v_prog, v_cycles;
END $$;
