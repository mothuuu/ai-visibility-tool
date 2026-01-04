-- ⚠️ DANGER: This will DELETE all organizations!
ALTER TABLE organization_members DROP CONSTRAINT IF EXISTS fk_org_members_user;
ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_organization;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS fk_organizations_owner;
DELETE FROM organization_members;
UPDATE users SET organization_id = NULL;
DELETE FROM organizations;
