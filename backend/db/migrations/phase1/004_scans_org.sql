-- Migration 004: Add organization_id to Scans

ALTER TABLE scans ADD COLUMN IF NOT EXISTS organization_id INTEGER;

UPDATE scans s SET organization_id = u.organization_id
FROM users u WHERE s.user_id = u.id AND s.organization_id IS NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_scans_organization') THEN
        ALTER TABLE scans ADD CONSTRAINT fk_scans_organization
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scans_organization_id ON scans(organization_id);

DO $$
DECLARE v_total INTEGER; v_linked INTEGER;
BEGIN
    SELECT COUNT(*), COUNT(organization_id) INTO v_total, v_linked FROM scans;
    RAISE NOTICE 'Scans: % total, % linked', v_total, v_linked;
END $$;
