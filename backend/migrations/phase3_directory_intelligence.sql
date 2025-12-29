-- Migration: Phase 3 Directory Intelligence
-- Date: 2025-12-29
-- Description: Add intelligence columns to directories table for automation support
--
-- These columns enable:
-- 1. Form automation (form_fields_mapping)
-- 2. Duplicate detection (search_type, search_url_template, duplicate_check_config)
-- 3. Submission requirements (requires_captcha, requires_email_verification, requires_payment)
-- 4. API integrations (api_config)

-- ============================================================================
-- Add intelligence columns to directories table
-- ============================================================================

-- Form field mapping for automation
-- Example: {"name": "company_name", "url": "website_url", "description": "company_description"}
ALTER TABLE directories
ADD COLUMN IF NOT EXISTS form_fields_mapping JSONB;

-- Search type for duplicate checking
-- Values: 'none', 'name_search', 'url_search'
ALTER TABLE directories
ADD COLUMN IF NOT EXISTS search_type VARCHAR(50) DEFAULT 'none';

-- URL template for searching existing listings
-- Example: "https://example.com/search?q={{business_name}}"
ALTER TABLE directories
ADD COLUMN IF NOT EXISTS search_url_template TEXT;

-- Whether directory requires CAPTCHA during submission
ALTER TABLE directories
ADD COLUMN IF NOT EXISTS requires_captcha BOOLEAN DEFAULT false;

-- Whether directory requires email verification
ALTER TABLE directories
ADD COLUMN IF NOT EXISTS requires_email_verification BOOLEAN DEFAULT false;

-- Whether directory requires payment to submit (beyond freemium)
ALTER TABLE directories
ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT false;

-- API configuration for directories with API submission support
-- Example: {"endpoint": "https://api.example.com/submit", "auth_type": "api_key", "rate_limit": 10}
ALTER TABLE directories
ADD COLUMN IF NOT EXISTS api_config JSONB;

-- Configuration for duplicate checking logic
-- Example: {"match_threshold": 0.8, "match_fields": ["name", "url"], "action": "skip"}
ALTER TABLE directories
ADD COLUMN IF NOT EXISTS duplicate_check_config JSONB;

-- ============================================================================
-- Create indexes for commonly queried intelligence columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_directories_search_type
ON directories(search_type)
WHERE search_type IS NOT NULL AND search_type != 'none';

CREATE INDEX IF NOT EXISTS idx_directories_requires_captcha
ON directories(requires_captcha)
WHERE requires_captcha = true;

CREATE INDEX IF NOT EXISTS idx_directories_has_api
ON directories((api_config IS NOT NULL))
WHERE api_config IS NOT NULL;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  missing_columns TEXT := '';
BEGIN
  -- Check each expected column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'directories' AND column_name = 'form_fields_mapping'
  ) THEN
    missing_columns := missing_columns || 'form_fields_mapping, ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'directories' AND column_name = 'search_type'
  ) THEN
    missing_columns := missing_columns || 'search_type, ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'directories' AND column_name = 'api_config'
  ) THEN
    missing_columns := missing_columns || 'api_config, ';
  END IF;

  IF missing_columns != '' THEN
    RAISE WARNING 'Missing columns after migration: %', missing_columns;
  ELSE
    RAISE NOTICE 'Phase 3 Directory Intelligence migration completed successfully';
  END IF;
END $$;
