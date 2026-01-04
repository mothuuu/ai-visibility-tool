ALTER TABLE users DROP COLUMN IF EXISTS organization_id;
DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
DROP TABLE IF EXISTS organizations;
