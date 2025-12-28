# Phase 0: Directory Dataset Audit

## Overview
The `directories` table stores the master list of all directories the system can submit to.

---

## Schema Summary

The directories table has columns for:
- **Core Identification:** name, slug, website_url, logo_url, description
- **Classification:** directory_type, tier (1-3), region_scope, priority_score (1-100)
- **Submission Operations:** submission_mode, submission_url, requires_account, account_creation_url
- **Verification:** verification_method, requires_customer_account, publishes_phone_publicly, requires_phone_verification
- **Content Requirements:** required_fields (JSONB), max_description_length, accepts_logo, category_mapping
- **Approval:** approval_type, typical_approval_days, paid_only, pricing_model
- **Operational:** is_active, validation_status, last_validated_at, notes

---

## Directory Types

Based on code analysis:
- `ai_tools` - AI-focused tool directories
- `saas_review` - SaaS review sites
- `startup` - Startup directories
- `business_citation` - Business citation/listing sites
- `marketplace` - Marketplaces
- `dev_registry` - Developer registries

---

## Tier System

| Tier | Description | Examples (Expected) |
|------|-------------|---------------------|
| 1 | Highest authority | G2, Product Hunt, Capterra |
| 2 | Medium authority | Crunchbase, AlternativeTo |
| 3 | Lower authority/niche | Niche directories |

---

## Submission Modes

| Mode | Description |
|------|-------------|
| `manual` | Default. Worker marks as action_needed for user to submit |
| `api` | Automated via API (placeholder - not implemented) |
| `editorial` | Requires pitch/application |
| `partner` | Partner integration |
| `pull_request` | GitHub-based submissions |

---

## Verification Methods

| Method | Description |
|--------|-------------|
| `none` | No verification required |
| `email` | Email verification |
| `sms` | SMS code verification |
| `phone` | Phone call verification |
| `advanced` | Postcard, video, or other advanced verification |

---

## Pricing Models (for filtering)

| Model | Description |
|-------|-------------|
| `free` | Completely free to list |
| `freemium` | Basic listing free, premium features paid |
| `paid` | Paid-only directories (excluded from auto-submission) |

---

## Query: Selection Logic

From `campaignRunService.selectDirectoriesTx()`:

```sql
SELECT d.*
FROM directories d
WHERE d.is_active = true
  AND d.pricing_model IN ('free', 'freemium')
  AND d.region_scope = ANY($1::text[])  -- includes 'global'
  AND d.tier = ANY($2::int[])
  -- Optionally: directory_types, phone_policy filters
  AND NOT EXISTS (
    SELECT 1 FROM directory_submissions ds
    WHERE ds.directory_id = d.id
      AND ds.user_id = $N
      AND ds.status NOT IN ('failed', 'skipped', 'blocked', 'rejected')
  )
ORDER BY
  COALESCE(d.priority_score, 0) DESC,
  d.tier ASC,
  d.name ASC
LIMIT $N
```

---

## Seeding Status

**CRITICAL:** The directories table must be seeded with actual directory data for the system to function.

The code checks for seeding in `campaignRunService.checkDirectoriesSeeded()`:
```javascript
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE is_active = true) as active,
  COUNT(*) FILTER (WHERE is_active = true AND pricing_model IN ('free', 'freemium')) as eligible
FROM directories
```

If no eligible directories exist, the error `DIRECTORIES_NOT_SEEDED` (503) is returned.

---

## Data Quality Checks Needed

To verify data quality, run these queries on the live database:

```sql
-- Total directories
SELECT COUNT(*) as total_directories FROM directories;

-- Active vs inactive
SELECT is_active, COUNT(*) FROM directories GROUP BY is_active;

-- By tier
SELECT tier, COUNT(*) FROM directories GROUP BY tier ORDER BY tier;

-- By submission_mode
SELECT submission_mode, COUNT(*) FROM directories GROUP BY submission_mode;

-- By pricing_model
SELECT pricing_model, COUNT(*) FROM directories GROUP BY pricing_model;

-- Fields completeness
SELECT
  COUNT(*) as total,
  COUNT(submission_url) as has_submission_url,
  COUNT(website_url) as has_website_url,
  COUNT(logo_url) as has_logo,
  COUNT(required_fields) as has_required_fields,
  COUNT(account_creation_url) as has_account_url
FROM directories;

-- Sample directories
SELECT id, name, slug, tier, submission_url, submission_mode, is_active, pricing_model
FROM directories
ORDER BY priority_score DESC
LIMIT 10;
```

---

## Migration Files

- **Creation:** `backend/db/migrate-citation-network.js` (lines 156-221)
- **Additional columns:** May be added by `migrate-directories-schema.js`

---

## Potential Gaps

1. **pricing_model column:** Not in original migration but used in queries
2. **Seeding script:** Need to verify if directories are actually seeded
3. **Validation:** `validation_status` and `last_validated_at` may not be maintained
