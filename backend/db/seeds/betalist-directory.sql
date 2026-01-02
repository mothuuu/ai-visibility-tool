-- ============================================
-- BetaList Directory Seed
-- Phase 5 Step 3A: Bucket B Manual-First Connector
-- ============================================
--
-- Run with: psql "$DATABASE_URL" -f backend/db/seeds/betalist-directory.sql
--
-- Notes:
-- - TOS does not explicitly allow automation
-- - Manual submission packet is the default behavior
-- - Rate limits are conservative (5 submissions/day)
-- ============================================

INSERT INTO directories (
  name,
  slug,
  website_url,
  submission_url,
  description,
  directory_type,
  tier,
  priority_score,
  integration_bucket,
  default_submission_mode,
  connector_key,
  connector_version,
  tos_allows_automation,
  tos_reviewed_at,
  tos_notes,
  rate_limit_rpm,
  rate_limit_rpd,
  avg_approval_days,
  typical_approval_days,
  capabilities,
  field_requirements,
  is_active,
  created_at,
  updated_at
) VALUES (
  'BetaList',
  'betalist',
  'https://betalist.com',
  'https://betalist.com/submit',
  'Discover and get early access to tomorrow''s startups',
  'startup',
  '1',
  85,
  'B',
  'form',
  'betalist-v1',
  '1.0.0',
  false,
  NOW(),
  'Manual submission recommended. Form-based submission, no public API. Automation not enabled by default due to TOS uncertainty.',
  2,
  5,
  3,
  3,
  '["validate", "submit"]'::jsonb,
  '{
    "business_name": {
      "required": true,
      "maxLength": 100,
      "label": "Startup Name"
    },
    "short_description": {
      "required": true,
      "maxLength": 60,
      "label": "Tagline",
      "hint": "A short, catchy description (max 60 chars)"
    },
    "long_description": {
      "required": true,
      "minLength": 160,
      "maxLength": 500,
      "label": "Description",
      "hint": "Detailed description of your startup (160-500 chars)"
    },
    "website_url": {
      "required": true,
      "type": "url",
      "label": "Website URL"
    },
    "contact_email": {
      "required": true,
      "type": "email",
      "label": "Contact Email"
    },
    "logo_url": {
      "required": false,
      "recommended": true,
      "type": "url",
      "label": "Logo URL",
      "hint": "Square logo recommended (PNG or JPG)"
    },
    "categories": {
      "required": true,
      "type": "array",
      "minItems": 1,
      "label": "Markets/Categories",
      "hint": "Select at least one category"
    }
  }'::jsonb,
  true,
  NOW(),
  NOW()
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  website_url = EXCLUDED.website_url,
  submission_url = EXCLUDED.submission_url,
  description = EXCLUDED.description,
  directory_type = EXCLUDED.directory_type,
  tier = EXCLUDED.tier,
  priority_score = EXCLUDED.priority_score,
  integration_bucket = EXCLUDED.integration_bucket,
  default_submission_mode = EXCLUDED.default_submission_mode,
  connector_key = EXCLUDED.connector_key,
  connector_version = EXCLUDED.connector_version,
  tos_allows_automation = EXCLUDED.tos_allows_automation,
  tos_reviewed_at = EXCLUDED.tos_reviewed_at,
  tos_notes = EXCLUDED.tos_notes,
  rate_limit_rpm = EXCLUDED.rate_limit_rpm,
  rate_limit_rpd = EXCLUDED.rate_limit_rpd,
  avg_approval_days = EXCLUDED.avg_approval_days,
  typical_approval_days = EXCLUDED.typical_approval_days,
  capabilities = EXCLUDED.capabilities,
  field_requirements = EXCLUDED.field_requirements,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Verify the insert/update
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM directories WHERE slug = 'betalist';
  IF v_count = 1 THEN
    RAISE NOTICE '✓ BetaList directory seeded successfully';
  ELSE
    RAISE WARNING '⚠ BetaList directory seed may have failed';
  END IF;
END $$;
