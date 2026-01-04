ALTER TABLE scans DROP COLUMN IF EXISTS domain_id;
DROP FUNCTION IF EXISTS generate_domain_verification_token();
DROP TRIGGER IF EXISTS trg_domains_updated_at ON domains;
DROP INDEX IF EXISTS uq_domains_primary_per_org;
DROP TABLE IF EXISTS domains;
DROP TYPE IF EXISTS domain_verification_method;
DROP TYPE IF EXISTS domain_verification_status;
