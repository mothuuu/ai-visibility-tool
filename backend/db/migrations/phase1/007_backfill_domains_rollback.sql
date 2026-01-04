-- ⚠️ DANGER: This will DELETE all domain data!
DROP INDEX IF EXISTS idx_scans_domain_id;
ALTER TABLE scans DROP CONSTRAINT IF EXISTS fk_scans_domain;
UPDATE scans SET domain_id = NULL;
DELETE FROM domains;
DROP FUNCTION IF EXISTS extract_domain_from_url(TEXT);
