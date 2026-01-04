-- Migration 002: Roles and Organization Members

CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '{}',
    is_system BOOLEAN DEFAULT false,
    org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_system_role_name
    ON roles(name) WHERE is_system = true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_role_name
    ON roles(name, org_id) WHERE org_id IS NOT NULL;

INSERT INTO roles (name, description, permissions, is_system) VALUES
('owner', 'Full access to everything', '{"*": ["*"]}', true),
('admin', 'Manage team and settings', '{"scans": ["*"], "recommendations": ["*"], "domains": ["*"], "members": ["read", "invite"], "settings": ["read", "update"]}', true),
('member', 'Standard team member', '{"scans": ["create", "read"], "recommendations": ["read", "update"], "domains": ["read"]}', true),
('viewer', 'Read-only access', '{"scans": ["read"], "recommendations": ["read"], "domains": ["read"]}', true),
('client', 'Agency client (limited)', '{"scans": ["read"], "recommendations": ["read"]}', true)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS organization_members (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    invited_email VARCHAR(255),
    invitation_token VARCHAR(255),
    invitation_expires_at TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended', 'removed')),
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    accepted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_member_user
    ON organization_members(organization_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_member_invited_email
    ON organization_members(organization_id, invited_email) WHERE invited_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_members_status ON organization_members(status);
