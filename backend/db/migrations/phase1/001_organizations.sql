-- Migration 001: Organizations

CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100),
    org_type VARCHAR(50) DEFAULT 'personal' CHECK (org_type IN ('personal', 'team', 'agency')),
    plan VARCHAR(50) DEFAULT 'free' CHECK (plan IN ('free', 'diy', 'pro', 'enterprise', 'agency')),
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    stripe_subscription_status VARCHAR(50),
    subscription_started_at TIMESTAMPTZ,
    subscription_ends_at TIMESTAMPTZ,
    owner_user_id INTEGER,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_plan ON organizations(plan);
CREATE INDEX IF NOT EXISTS idx_organizations_stripe ON organizations(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id INTEGER;
