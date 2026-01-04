-- Migration 007: Backfill Domains from Scans
-- ⚠️ DATA-CREATING BACKFILL - Rollback will DELETE domains!

-- Null-safe domain extraction from URL
CREATE OR REPLACE FUNCTION extract_domain_from_url(url TEXT)
RETURNS TEXT AS $$
DECLARE
    result TEXT;
BEGIN
    IF url IS NULL OR url = '' THEN
        RETURN NULL;
    END IF;

    result := regexp_replace(url, '^https?://', '', 'i');
    result := split_part(result, '/', 1);
    result := split_part(result, ':', 1);
    result := regexp_replace(result, '^www\.', '', 'i');
    result := LOWER(result);

    IF result = '' THEN
        RETURN NULL;
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create domains from scans
INSERT INTO domains (organization_id, domain, display_name, is_primary, created_at)
SELECT DISTINCT ON (s.organization_id, derived_domain)
    s.organization_id,
    derived_domain,
    derived_domain,
    false,
    MIN(s.created_at) OVER (PARTITION BY s.organization_id, derived_domain)
FROM (
    SELECT
        s.organization_id,
        s.created_at,
        COALESCE(
            NULLIF(LOWER(TRIM(s.domain)), ''),
            NULLIF(LOWER(TRIM(s.extracted_domain)), ''),
            extract_domain_from_url(s.url)
        ) as derived_domain
    FROM scans s
    WHERE s.organization_id IS NOT NULL
    AND (
        (s.domain IS NOT NULL AND TRIM(s.domain) <> '')
        OR (s.extracted_domain IS NOT NULL AND TRIM(s.extracted_domain) <> '')
        OR (s.url IS NOT NULL AND TRIM(s.url) <> '')
    )
) s
WHERE s.derived_domain IS NOT NULL
AND s.derived_domain <> ''
AND NOT EXISTS (
    SELECT 1 FROM domains d
    WHERE d.organization_id = s.organization_id
    AND d.domain = s.derived_domain
)
ORDER BY s.organization_id, derived_domain, s.created_at;

-- Reset all primaries before setting new ones (ensures single primary per org)
UPDATE domains SET is_primary = false WHERE is_primary = true;

-- Set primary domain (most scanned)
WITH domain_counts AS (
    SELECT
        d.id,
        d.organization_id,
        COUNT(s.id) as scan_count,
        ROW_NUMBER() OVER (PARTITION BY d.organization_id ORDER BY COUNT(s.id) DESC, d.created_at ASC) as rn
    FROM domains d
    LEFT JOIN scans s ON (
        d.domain = COALESCE(
            NULLIF(LOWER(TRIM(s.domain)), ''),
            NULLIF(LOWER(TRIM(s.extracted_domain)), ''),
            extract_domain_from_url(s.url)
        )
        AND d.organization_id = s.organization_id
    )
    GROUP BY d.id, d.organization_id
)
UPDATE domains d SET is_primary = true FROM domain_counts dc WHERE d.id = dc.id AND dc.rn = 1;

-- Link scans to domains
UPDATE scans s SET domain_id = d.id
FROM domains d
WHERE d.organization_id = s.organization_id
AND d.domain = COALESCE(
    NULLIF(LOWER(TRIM(s.domain)), ''),
    NULLIF(LOWER(TRIM(s.extracted_domain)), ''),
    extract_domain_from_url(s.url)
)
AND s.domain_id IS NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_scans_domain') THEN
        ALTER TABLE scans ADD CONSTRAINT fk_scans_domain FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scans_domain_id ON scans(domain_id);

DO $$
DECLARE v_domains INTEGER; v_linked INTEGER; v_unlinked INTEGER; v_multi_primary INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_domains FROM domains;
    SELECT COUNT(*) INTO v_linked FROM scans WHERE domain_id IS NOT NULL;
    SELECT COUNT(*) INTO v_unlinked FROM scans WHERE domain_id IS NULL AND organization_id IS NOT NULL;
    SELECT COUNT(*) INTO v_multi_primary FROM (
        SELECT organization_id FROM domains WHERE is_primary = true GROUP BY organization_id HAVING COUNT(*) > 1
    ) x;
    RAISE NOTICE 'Domains: %, scans linked: %, scans unlinked: %', v_domains, v_linked, v_unlinked;
    IF v_multi_primary > 0 THEN
        RAISE WARNING '% orgs have multiple primary domains!', v_multi_primary;
    END IF;
END $$;
