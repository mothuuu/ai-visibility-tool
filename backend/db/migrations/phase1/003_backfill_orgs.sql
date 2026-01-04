-- Migration 003: Backfill Organizations from Users
-- ⚠️ DATA-CREATING BACKFILL - Rollback will DELETE organizations!

INSERT INTO organizations (name, slug, org_type, plan, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, owner_user_id, created_at)
SELECT
    COALESCE(u.name, split_part(u.email, '@', 1)) || '''s Workspace',
    'user-' || u.id,
    'personal',
    COALESCE(u.plan, 'free'),
    u.stripe_customer_id,
    u.stripe_subscription_id,
    u.stripe_subscription_status,
    u.id,
    u.created_at
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.owner_user_id = u.id);

UPDATE users u SET organization_id = o.id
FROM organizations o
WHERE o.owner_user_id = u.id AND u.organization_id IS NULL;

INSERT INTO organization_members (organization_id, user_id, role_id, status, accepted_at)
SELECT o.id, u.id, (SELECT id FROM roles WHERE name = 'owner' AND is_system = true), 'active', NOW()
FROM users u
JOIN organizations o ON o.owner_user_id = u.id
WHERE NOT EXISTS (SELECT 1 FROM organization_members om WHERE om.organization_id = o.id AND om.user_id = u.id);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_organizations_owner') THEN
        ALTER TABLE organizations ADD CONSTRAINT fk_organizations_owner
            FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_organization') THEN
        ALTER TABLE users ADD CONSTRAINT fk_users_organization
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_org_members_user') THEN
        ALTER TABLE organization_members ADD CONSTRAINT fk_org_members_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
DECLARE v_users INTEGER; v_orgs INTEGER; v_unlinked INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_users FROM users;
    SELECT COUNT(*) INTO v_orgs FROM organizations;
    SELECT COUNT(*) INTO v_unlinked FROM users WHERE organization_id IS NULL;
    RAISE NOTICE 'Backfill: % users → % orgs, % unlinked', v_users, v_orgs, v_unlinked;
    IF v_unlinked > 0 THEN RAISE WARNING '% users have no organization!', v_unlinked; END IF;
END $$;
