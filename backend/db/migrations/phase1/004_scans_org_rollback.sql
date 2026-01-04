DROP INDEX IF EXISTS idx_scans_organization_id;
ALTER TABLE scans DROP CONSTRAINT IF EXISTS fk_scans_organization;
ALTER TABLE scans DROP COLUMN IF EXISTS organization_id;
