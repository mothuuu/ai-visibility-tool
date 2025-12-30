# Phase 0: Database Schema Reality Check

## Overview
Schema documentation based on migration files in `backend/db/`.
Primary migrations: `migrate-citation-network.js`, `migrate-campaign-runs.js`

---

## Table: `business_profiles`

**Migration:** `migrate-citation-network.js`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | UUID | gen_random_uuid() | Primary key |
| `user_id` | INTEGER | - | FK to users(id) |
| `business_name` | VARCHAR(255) | - | Required |
| `website_url` | VARCHAR(500) | - | |
| `phone` | VARCHAR(50) | - | |
| `email` | VARCHAR(255) | - | |
| `address_line1` | VARCHAR(255) | - | |
| `address_line2` | VARCHAR(255) | - | |
| `city` | VARCHAR(100) | - | |
| `state` | VARCHAR(100) | - | |
| `postal_code` | VARCHAR(20) | - | |
| `country` | VARCHAR(100) | 'United States' | |
| `business_description` | TEXT | - | |
| `short_description` | VARCHAR(500) | - | Required for submission |
| `year_founded` | INTEGER | - | |
| `number_of_employees` | VARCHAR(50) | - | |
| `primary_category` | VARCHAR(255) | - | |
| `secondary_categories` | JSONB | '[]' | |
| `social_links` | JSONB | '{}' | |
| `logo_url` | VARCHAR(500) | - | |
| `photos` | JSONB | '[]' | |
| `business_hours` | JSONB | '{}' | |
| `payment_methods` | JSONB | '[]' | |
| `service_areas` | JSONB | '[]' | |
| `certifications` | JSONB | '[]' | |
| `is_complete` | BOOLEAN | false | |
| `completion_percentage` | INTEGER | 0 | |
| `created_at` | TIMESTAMP | CURRENT_TIMESTAMP | |
| `updated_at` | TIMESTAMP | CURRENT_TIMESTAMP | |

**Constraint:** `unique_user_profile UNIQUE (user_id)`

---

## Table: `directory_orders`

**Migration:** `migrate-citation-network.js`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | UUID | gen_random_uuid() | Primary key |
| `user_id` | INTEGER | - | FK to users(id) |
| `business_profile_id` | UUID | - | FK to business_profiles(id) |
| `order_type` | VARCHAR(50) | - | 'starter' ($249) or 'pack' ($99) |
| `stripe_checkout_session_id` | VARCHAR(255) | - | |
| `stripe_payment_intent_id` | VARCHAR(255) | - | |
| `stripe_price_id` | VARCHAR(255) | - | |
| `amount_cents` | INTEGER | - | |
| `currency` | VARCHAR(3) | 'usd' | |
| `directories_allocated` | INTEGER | 100 | |
| `directories_submitted` | INTEGER | 0 | |
| `directories_live` | INTEGER | 0 | |
| `status` | VARCHAR(50) | 'pending' | pending/paid/processing/in_progress/completed/refunded/cancelled |
| `delivery_started_at` | TIMESTAMP | - | |
| `delivery_completed_at` | TIMESTAMP | - | |
| `created_at` | TIMESTAMP | CURRENT_TIMESTAMP | |
| `paid_at` | TIMESTAMP | - | |
| `updated_at` | TIMESTAMP | CURRENT_TIMESTAMP | |

---

## Table: `subscriber_directory_allocations`

**Migration:** `migrate-citation-network.js`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | UUID | gen_random_uuid() | Primary key |
| `user_id` | INTEGER | - | FK to users(id) |
| `period_start` | DATE | - | Start of monthly period |
| `period_end` | DATE | - | End of monthly period |
| `base_allocation` | INTEGER | - | From plan: 10/25/100 |
| `pack_allocation` | INTEGER | 0 | Additional from $99 packs |
| `submissions_used` | INTEGER | 0 | |
| `created_at` | TIMESTAMP | CURRENT_TIMESTAMP | |
| `updated_at` | TIMESTAMP | CURRENT_TIMESTAMP | |

**Constraint:** `unique_user_period UNIQUE (user_id, period_start)`

---

## Table: `directories`

**Migrations:** `migrate-citation-network.js`, `phase3_directory_intelligence.sql`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | SERIAL | - | Primary key |
| `name` | VARCHAR(255) | - | |
| `slug` | VARCHAR(100) | - | UNIQUE |
| `website_url` | VARCHAR(500) | - | |
| `logo_url` | VARCHAR(500) | - | |
| `description` | TEXT | - | |
| `directory_type` | VARCHAR(50) | - | ai_tools/saas_review/startup/business_citation/marketplace/dev_registry |
| `tier` | INTEGER | 2 | 1-3, CHECK constraint |
| `region_scope` | VARCHAR(50) | 'global' | global/us/ca/uk/eu/apac |
| `priority_score` | INTEGER | 50 | 1-100, higher = submit first |
| `submission_mode` | VARCHAR(50) | 'manual' | manual/api/editorial/partner/pull_request |
| `submission_url` | VARCHAR(500) | - | |
| `requires_account` | BOOLEAN | true | |
| `account_creation_url` | VARCHAR(500) | - | |
| `verification_method` | VARCHAR(50) | 'email' | none/email/sms/phone/advanced |
| `requires_customer_account` | BOOLEAN | false | For GBP, Yelp, Apple, etc. |
| `publishes_phone_publicly` | BOOLEAN | false | |
| `requires_phone_verification` | BOOLEAN | false | |
| `required_fields` | JSONB | '["name","url","short_description"]' | |
| `max_description_length` | INTEGER | - | |
| `accepts_logo` | BOOLEAN | true | |
| `category_mapping` | JSONB | - | |
| `approval_type` | VARCHAR(50) | 'review' | instant/review/editorial/paid_only |
| `typical_approval_days` | INTEGER | 7 | |
| `paid_only` | BOOLEAN | false | |
| `pricing_model` | VARCHAR(50) | - | free/freemium/paid (used for filtering) |
| `cost_notes` | TEXT | - | |
| `is_active` | BOOLEAN | true | |
| `validation_status` | VARCHAR(50) | 'unknown' | valid/broken/changed/unknown |
| `last_validated_at` | TIMESTAMP | - | |
| `notes` | TEXT | - | |
| `created_at` | TIMESTAMP | CURRENT_TIMESTAMP | |
| `updated_at` | TIMESTAMP | CURRENT_TIMESTAMP | |
| **Phase 3 Intelligence Columns** ||||
| `search_type` | VARCHAR(50) | NULL | How to check for existing listings. CHECK constraint: NULL, 'none', 'site_search', 'internal_search', 'api_search' |
| `search_url_template` | TEXT | NULL | URL template for internal search. Tokens: `{business_name}`, `{website_domain}`, `{slug}` |
| `requires_captcha` | BOOLEAN | NULL | Whether directory has CAPTCHA. NULL = unknown. |
| `requires_email_verification` | BOOLEAN | NULL | Whether email verification required. NULL = unknown. |
| `requires_payment` | BOOLEAN | NULL | Whether payment required for listing. NULL = unknown. |
| `form_fields_mapping` | JSONB | NULL | Rich field mapping for automation (see schema below) |
| `api_config` | JSONB | NULL | API integration configuration |
| `duplicate_check_config` | JSONB | NULL | Duplicate detection configuration |

### Token Style for `search_url_template`

Use **single curly braces**: `{token_name}`

Supported tokens:
- `{business_name}` - URL-encoded business name
- `{website_domain}` - Domain extracted from website URL
- `{slug}` - URL-friendly slug of business name

Example: `https://www.g2.com/search?query={business_name}`

**Do NOT use double curly braces** (`{{token}}`) - standardize on single.

### `form_fields_mapping` JSON Schema

```json
{
  "version": 1,
  "workflow": "web_form",
  "field_map": [
    {
      "our_field": "name",
      "directory_field": "Product Name",
      "selector": "#product-name",
      "input_type": "text",
      "required": true,
      "constraints": { "max_length": 80 }
    }
  ],
  "alternates": [
    { "our_field": "social_proof", "one_of": ["twitter_url", "linkedin_url"] }
  ],
  "steps": [
    { "name": "Start submission", "url": "https://example.com/submit" }
  ],
  "notes": "Optional notes about submission process"
}
```

- `workflow`: `"web_form" | "email" | "api" | "editorial"`
- `field_map[].input_type`: `"text" | "url" | "textarea" | "file" | "select"`

### Relationship with `required_fields`

- `required_fields` (existing): Simple array for quick validation
- `form_fields_mapping` (Phase 3): Rich structure for automation

Both coexist. If `form_fields_mapping` is NULL, backfill auto-generates a starter mapping from `required_fields`.

---

## Table: `directory_submissions`

**Migrations:** `migrate-citation-network.js`, `migrate-campaign-runs.js`, `phase4_duplicate_detection.sql`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | UUID | gen_random_uuid() | Primary key |
| `order_id` | UUID | - | FK to directory_orders(id) - legacy |
| `campaign_run_id` | UUID | - | FK to campaign_runs(id) - current |
| `user_id` | INTEGER | - | FK to users(id) |
| `business_profile_id` | UUID | - | FK to business_profiles(id) |
| `directory_id` | INTEGER | - | FK to directories(id) |
| `directory_name` | VARCHAR(255) | - | Denormalized |
| `directory_url` | VARCHAR(500) | - | Denormalized |
| `directory_category` | VARCHAR(255) | - | |
| `directory_snapshot` | JSONB | - | Immutable snapshot at queue time |
| `submitted_url` | VARCHAR(500) | - | |
| `listing_url` | VARCHAR(500) | - | |
| `status` | VARCHAR(50) | 'pending' | See status values below |
| `action_type` | VARCHAR(50) | - | none/email/sms/phone/postcard/login/document |
| `action_instructions` | TEXT | - | |
| `action_url` | VARCHAR(500) | - | |
| `action_required_at` | TIMESTAMP | - | |
| `action_deadline` | TIMESTAMP | - | |
| `verification_type` | VARCHAR(50) | - | |
| `verification_status` | VARCHAR(50) | - | |
| `verification_deadline` | TIMESTAMP | - | |
| `verification_attempts` | INTEGER | 0 | |
| `credential_id` | UUID | - | FK to credential_vault(id) |
| `listing_id` | VARCHAR(255) | - | |
| `priority_score` | INTEGER | 50 | |
| `queue_position` | INTEGER | - | |
| `has_credentials` | BOOLEAN | false | |
| `notes` | TEXT | - | |
| `rejection_reason` | TEXT | - | |
| `blocked_reason` | TEXT | - | |
| `error_message` | TEXT | - | |
| `error_code` | VARCHAR(100) | - | |
| `retry_count` | INTEGER | 0 | |
| `last_retry_at` | TIMESTAMP | - | |
| `queued_at` | TIMESTAMP | - | |
| `started_at` | TIMESTAMP | - | |
| `submitted_at` | TIMESTAMP | - | |
| `verified_at` | TIMESTAMP | - | |
| `approved_at` | TIMESTAMP | - | |
| `live_at` | TIMESTAMP | - | |
| `blocked_at` | TIMESTAMP | - | |
| `failed_at` | TIMESTAMP | - | |
| `created_at` | TIMESTAMP | CURRENT_TIMESTAMP | |
| `updated_at` | TIMESTAMP | CURRENT_TIMESTAMP | |
| **Phase 4 Duplicate Detection Columns** ||||
| `duplicate_check_status` | VARCHAR(50) | NULL | not_checked/no_match/possible_match/match_found/skipped/error |
| `duplicate_check_evidence` | JSONB | NULL | Structured proof (search_url, match_reason, etc.) |
| `listing_url` | TEXT | NULL | URL of existing listing if found |
| `listing_found_at` | TIMESTAMP | NULL | When the existing listing was found |
| `duplicate_check_performed_at` | TIMESTAMP | NULL | When duplicate check was performed |
| `duplicate_check_method` | VARCHAR(50) | NULL | internal_search/api_search/site_search/manual/skipped/error |

**Status Values:**
- `queued` - Waiting in queue
- `in_progress` - Worker is processing
- `submitted` - Submitted to directory
- `pending_verification` - Awaiting verification
- `pending_approval` - Awaiting directory approval
- `action_needed` / `needs_action` - User action required
- `verified` - Verification complete
- `live` - Listing is live
- `rejected` - Directory rejected
- `failed` - Processing failed
- `blocked` - Blocked (e.g., deadline missed, duplicate check ambiguous)
- `skipped` - User skipped
- `cancelled` - Cancelled
- `already_listed` - Business already listed in directory (no submission needed)

**Duplicate Check Status Values (Phase 4):**
- `match_found` - Confident match, existing listing found → status set to `already_listed`
- `no_match` - No duplicate found → eligible for submission (status = `queued`)
- `possible_match` - Ambiguous result → status set to `blocked`, needs review
- `error` - Check failed → status set to `blocked`
- `skipped` - Check not performed (e.g., `site_search` not supported) → status set to `blocked`

**Important:** Entitlement is only consumed for `queued` submissions. `already_listed` and `blocked` do not consume entitlement.

---

## Table: `campaign_runs`

**Migration:** `migrate-campaign-runs.js`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | UUID | gen_random_uuid() | Primary key |
| `user_id` | INTEGER | - | FK to users(id) |
| `business_profile_id` | UUID | - | FK to business_profiles(id) |
| `profile_snapshot` | JSONB | - | Immutable snapshot at run start |
| `plan_at_run` | VARCHAR(50) | - | User's plan when run started |
| `entitlement_source` | VARCHAR(50) | - | 'subscription' or 'order' |
| `entitlement_source_id` | VARCHAR(255) | - | |
| `directories_entitled` | INTEGER | - | Available at run start |
| `filters_snapshot` | JSONB | '{}' | User's filter preferences |
| `status` | VARCHAR(50) | 'created' | created/selecting/queued/in_progress/paused/completed/cancelled/failed |
| `directories_selected` | INTEGER | 0 | |
| `directories_queued` | INTEGER | 0 | |
| `directories_in_progress` | INTEGER | 0 | |
| `directories_submitted` | INTEGER | 0 | |
| `directories_live` | INTEGER | 0 | |
| `directories_failed` | INTEGER | 0 | |
| `directories_action_needed` | INTEGER | 0 | |
| `created_at` | TIMESTAMP | NOW() | |
| `started_at` | TIMESTAMP | - | |
| `completed_at` | TIMESTAMP | - | |
| `updated_at` | TIMESTAMP | NOW() | |
| `error_message` | TEXT | - | |
| `error_details` | JSONB | - | |

---

## Table: `credential_vault`

**Migration:** `migrate-campaign-runs.js`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | UUID | gen_random_uuid() | Primary key |
| `user_id` | INTEGER | - | FK to users(id) |
| `directory_id` | INTEGER | - | FK to directories(id) |
| `email` | VARCHAR(255) | - | Account email |
| `username` | VARCHAR(255) | - | Account username |
| `password_encrypted` | TEXT | - | Encrypted password |
| `account_created_at` | TIMESTAMP | - | |
| `last_login_at` | TIMESTAMP | - | |
| `account_status` | VARCHAR(50) | 'active' | |
| `handoff_status` | VARCHAR(50) | 'none' | none/requested/completed |
| `handed_off_at` | TIMESTAMP | - | |
| `handed_off_by_user_id` | INTEGER | - | |
| `handoff_reason` | TEXT | - | |
| `handoff_notes` | TEXT | - | |
| `notes` | TEXT | - | |
| `created_at` | TIMESTAMP | NOW() | |
| `updated_at` | TIMESTAMP | NOW() | |

**Constraint:** `unique_user_directory_cred UNIQUE (user_id, directory_id)`

---

## Table: `credential_access_log` (Security Audit)

**Migration:** `backend/migrations/credential_security_hardening.sql` (if applied)

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | UUID | gen_random_uuid() | Primary key |
| `credential_id` | UUID | - | FK to credential_vault(id) |
| `user_id` | INTEGER | - | |
| `access_type` | VARCHAR(50) | - | handoff_request/password_view/etc |
| `ip_address` | VARCHAR(50) | - | |
| `user_agent` | TEXT | - | |
| `success` | BOOLEAN | - | |
| `failure_reason` | TEXT | - | |
| `created_at` | TIMESTAMP | NOW() | |

---

## Indexes

### directory_orders
- `idx_directory_orders_user` (user_id)
- `idx_directory_orders_status` (status)
- `idx_directory_orders_stripe` (stripe_checkout_session_id)
- `idx_directory_orders_type` (order_type)

### subscriber_directory_allocations
- `idx_allocations_user` (user_id)
- `idx_allocations_period` (period_start)

### directories
- `idx_directories_type` (directory_type)
- `idx_directories_tier` (tier)
- `idx_directories_region` (region_scope)
- `idx_directories_priority` (priority_score DESC)
- `idx_directories_active` (is_active) WHERE is_active = true
- `idx_directories_submission_mode` (submission_mode)
- `idx_directories_verification` (verification_method)

### directory_submissions
- `idx_directory_submissions_order` (order_id)
- `idx_directory_submissions_user` (user_id)
- `idx_directory_submissions_status` (status)
- `idx_directory_submissions_directory` (directory_id)
- `idx_submissions_campaign` (campaign_run_id)
- `idx_submissions_queue` (campaign_run_id, queue_position)
- `idx_submissions_action` (status, action_deadline) WHERE status IN ('action_needed', 'needs_action')
- `idx_submissions_verification` (status, verification_deadline) WHERE status = 'pending_verification'

### campaign_runs
- `idx_campaign_runs_user` (user_id)
- `idx_campaign_runs_status` (status)
- `idx_campaign_runs_created` (created_at DESC)

### credential_vault
- `idx_credentials_user` (user_id)
- `idx_credentials_directory` (directory_id)

---

## Known Schema Issues

1. **Status inconsistency:** Both `action_needed` and `needs_action` exist in code
2. **Missing pricing_model column:** In original migration, `pricing_model` wasn't explicitly added but is used in queries
3. **directories_in_progress column:** May not exist in campaign_runs if migration not run
