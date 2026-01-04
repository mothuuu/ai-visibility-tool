-- Migration 006: Domains Table

DO $$ BEGIN CREATE TYPE domain_verification_status AS ENUM ('unverified', 'pending', 'verified', 'lapsed', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE domain_verification_method AS ENUM ('dns_txt', 'dns_cname', 'meta_tag', 'file_upload'); EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS domains (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    verification_status domain_verification_status DEFAULT 'unverified',
    verification_method domain_verification_method,
    verification_token VARCHAR(64),
    verified_at TIMESTAMPTZ,
    verification_expires_at TIMESTAMPTZ,
    verification_attempts INTEGER DEFAULT 0,
    last_verification_attempt_at TIMESTAMPTZ,
    is_reachable BOOLEAN,
    reachability_checked_at TIMESTAMPTZ,
    reachability_fail_count INTEGER DEFAULT 0,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_domains_org_domain UNIQUE (organization_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_domains_org ON domains(organization_id);
CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain);

-- Enforce exactly ONE primary domain per org
CREATE UNIQUE INDEX IF NOT EXISTS uq_domains_primary_per_org
    ON domains(organization_id) WHERE is_primary = true;

DROP TRIGGER IF EXISTS trg_domains_updated_at ON domains;
CREATE TRIGGER trg_domains_updated_at BEFORE UPDATE ON domains FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Token generator with pgcrypto fallback
CREATE OR REPLACE FUNCTION generate_domain_verification_token() RETURNS VARCHAR(64) AS $$
BEGIN
  BEGIN
    RETURN encode(gen_random_bytes(32), 'hex');
  EXCEPTION WHEN undefined_function THEN
    RETURN md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text);
  END;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE scans ADD COLUMN IF NOT EXISTS domain_id INTEGER;
