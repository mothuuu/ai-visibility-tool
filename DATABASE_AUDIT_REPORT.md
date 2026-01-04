# Visible2AI Database Audit Report

**Generated:** 2026-01-04
**Database:** Render PostgreSQL
**Purpose:** Phase 1 Migration Planning

---

## 1. Table Inventory

Based on schema analysis from migration files and setup scripts:

```
Table Name                              | Type
----------------------------------------|----------
admin_sessions                          | BASE TABLE
ai_directories                          | VIEW (alias)
ai_directory_submissions                | VIEW (alias)
audit_log                               | BASE TABLE
brand_facts                             | BASE TABLE
business_profiles                       | BASE TABLE
campaign_runs                           | BASE TABLE
competitive_alerts                      | BASE TABLE
competitive_tracking                    | BASE TABLE
context_scan_links                      | BASE TABLE
credential_access_log                   | BASE TABLE
credential_vault                        | BASE TABLE
directories                             | BASE TABLE
directory_credentials                   | VIEW (alias)
directory_orders                        | BASE TABLE
directory_submissions                   | BASE TABLE
implementation_detections               | BASE TABLE
ip_whitelist                            | BASE TABLE
landing_page_content                    | BASE TABLE
mode_transition_history                 | BASE TABLE
page_analysis                           | BASE TABLE
page_priorities                         | BASE TABLE
page_selection_history                  | BASE TABLE
processed_stripe_events                 | BASE TABLE
recommendation_contexts                 | BASE TABLE
recommendation_curation                 | BASE TABLE
recommendation_feedback                 | BASE TABLE
recommendation_interactions             | BASE TABLE
recommendation_quality_metrics          | BASE TABLE
recommendation_refresh_cycles           | BASE TABLE
recommendation_validation_history       | BASE TABLE
scan_pages                              | BASE TABLE
scan_recommendations                    | BASE TABLE
scans                                   | BASE TABLE
score_history                           | BASE TABLE
stripe_events                           | BASE TABLE
submission_artifacts                    | BASE TABLE
submission_events                       | BASE TABLE
submission_runs                         | BASE TABLE
submission_targets                      | BASE TABLE
subscriber_directory_allocations        | BASE TABLE
training_examples                       | BASE TABLE
training_negative_examples              | BASE TABLE
usage_logs                              | BASE TABLE
user_modes                              | BASE TABLE
user_notification_preferences           | BASE TABLE
user_notifications                      | BASE TABLE
user_progress                           | BASE TABLE
user_recommendation_mode                | BASE TABLE
users                                   | BASE TABLE
waitlist                                | BASE TABLE
```

**Total Tables:** ~45+ BASE TABLEs + several VIEWs

## 2. Data Volumes

> **Note:** Actual row counts require DATABASE_URL connection. Run the audit script with:
> ```bash
> DATABASE_URL="your-connection-string" node backend/scripts/database-audit.js
> ```

```
Table                    | Row Count
-------------------------|----------
users                    | [REQUIRES DB CONNECTION]
scans                    | [REQUIRES DB CONNECTION]
scan_recommendations     | [REQUIRES DB CONNECTION]
scan_pages               | [REQUIRES DB CONNECTION]
business_profiles        | [REQUIRES DB CONNECTION]
directories              | [REQUIRES DB CONNECTION]
directory_orders         | [REQUIRES DB CONNECTION]
directory_submissions    | [REQUIRES DB CONNECTION]
```

## 3. Users Table Schema

From `backend/db/setup.js` and migration files:

```
Column Name                    | Data Type           | Nullable | Default
-------------------------------|---------------------|----------|--------
id                             | SERIAL (integer)    | NO       | AUTO
email                          | VARCHAR(255)        | NO       | -
password_hash                  | VARCHAR(255)        | NO       | -
name                           | VARCHAR(255)        | YES      | -
plan                           | VARCHAR(50)         | YES      | 'free'
primary_domain                 | VARCHAR(255)        | YES      | -
stripe_customer_id             | VARCHAR(255)        | YES      | -
stripe_subscription_id         | VARCHAR(255)        | YES      | -
scans_used_this_month          | INTEGER             | YES      | 0
competitor_scans_used_this_month| INTEGER            | YES      | 0
role                           | VARCHAR(50)         | YES      | 'user'
email_verified                 | BOOLEAN             | YES      | FALSE
verification_token             | VARCHAR(255)        | YES      | -
reset_token                    | VARCHAR(255)        | YES      | -
reset_token_expires            | TIMESTAMP           | YES      | -
last_login                     | TIMESTAMP           | YES      | -
last_ip                        | VARCHAR(50)         | YES      | -
last_login_location            | VARCHAR(255)        | YES      | -
created_at                     | TIMESTAMP           | YES      | CURRENT_TIMESTAMP
updated_at                     | TIMESTAMP           | YES      | CURRENT_TIMESTAMP
```

## 4. Scans Table Schema

From `backend/db/migrate-scans.js`:

```
Column Name                    | Data Type           | Nullable | Default
-------------------------------|---------------------|----------|--------
id                             | SERIAL (integer)    | NO       | AUTO
user_id                        | INTEGER             | NO       | - (FK users)
brand_id                       | UUID                | YES      | - (FK brand_facts)
url                            | VARCHAR(500)        | NO       | -
domain                         | VARCHAR(255)        | YES      | -
extracted_domain               | VARCHAR(255)        | YES      | -
domain_type                    | VARCHAR(50)         | YES      | -
status                         | VARCHAR(50)         | YES      | 'pending'
previous_scan_id               | INTEGER             | YES      | - (FK scans)
total_score                    | INTEGER             | YES      | -
ai_readability_score           | INTEGER             | YES      | -
ai_search_readiness_score      | INTEGER             | YES      | -
content_freshness_score        | INTEGER             | YES      | -
content_structure_score        | INTEGER             | YES      | -
speed_ux_score                 | INTEGER             | YES      | -
technical_setup_score          | INTEGER             | YES      | -
trust_authority_score          | INTEGER             | YES      | -
voice_optimization_score       | INTEGER             | YES      | -
rubric_version                 | VARCHAR(10)         | YES      | 'V5'
industry                       | VARCHAR(100)        | YES      | -
page_count                     | INTEGER             | YES      | 1
pages_analyzed                 | JSONB               | YES      | '[]'
detailed_analysis              | JSONB               | YES      | -
recommendations                | JSONB               | YES      | -
comparison_data                | JSONB               | YES      | -
is_competitor_scan             | BOOLEAN             | YES      | FALSE
created_at                     | TIMESTAMP           | YES      | CURRENT_TIMESTAMP
completed_at                   | TIMESTAMP           | YES      | -
updated_at                     | TIMESTAMP           | YES      | CURRENT_TIMESTAMP
```

## 5. Recommendations Table Schema

From `backend/db/migrate-scans.js` and `migrate-recommendation-delivery-system.js`:

```
Column Name                    | Data Type           | Nullable | Default
-------------------------------|---------------------|----------|--------
id                             | SERIAL              | NO       | AUTO
scan_id                        | INTEGER             | NO       | - (FK scans)
category                       | VARCHAR(100)        | NO       | -
recommendation_text            | TEXT                | NO       | -
recommendation_type            | VARCHAR(50)         | YES      | -
page_url                       | VARCHAR(500)        | YES      | -
priority                       | VARCHAR(20)         | YES      | 'medium'
estimated_impact               | INTEGER             | YES      | -
estimated_effort               | VARCHAR(50)         | YES      | -
status                         | VARCHAR(50)         | YES      | 'pending'
unlock_state                   | VARCHAR(20)         | YES      | -
batch_number                   | INTEGER             | YES      | -
unlocked_at                    | TIMESTAMP           | YES      | -
marked_complete_at             | TIMESTAMP           | YES      | -
impact_score                   | DECIMAL             | YES      | -
implementation_difficulty      | VARCHAR(20)         | YES      | -
compounding_effect_score       | DECIMAL             | YES      | -
industry_relevance_score       | DECIMAL             | YES      | -
last_refresh_date              | DATE                | YES      | -
next_refresh_date              | DATE                | YES      | -
refresh_cycle_number           | INTEGER             | YES      | -
implementation_progress        | DECIMAL             | YES      | -
validation_status              | VARCHAR(50)         | YES      | -
validation_errors              | JSONB               | YES      | -
last_validated_at              | TIMESTAMP           | YES      | -
affected_pages                 | JSONB               | YES      | -
pages_implemented              | JSONB               | YES      | -
action_steps                   | JSONB               | YES      | -
findings                       | TEXT                | YES      | -
implemented_at                 | TIMESTAMP           | YES      | -
user_feedback                  | TEXT                | YES      | -
user_rating                    | INTEGER             | YES      | -
created_at                     | TIMESTAMP           | YES      | CURRENT_TIMESTAMP
updated_at                     | TIMESTAMP           | YES      | CURRENT_TIMESTAMP
```

**subfactor column exists:** NO (subfactor is used in code logic, not as a database column)

## 6. Target v2.1 Table Status

```
Table                    | Exists
-------------------------|--------
organizations            | NO
organization_members     | NO
organization_invites     | NO
organization_billing     | NO
```

**Current Organization-like Structure:**
- `business_profiles` table exists and links to users
- No multi-tenant organization model exists

## 7. Existing Constraints (Key Tables)

```
Table                    | Constraint Name                    | Type
-------------------------|------------------------------------|-----------
users                    | users_pkey                         | PRIMARY KEY
users                    | users_email_key                    | UNIQUE
scans                    | scans_pkey                         | PRIMARY KEY
scans                    | scans_user_id_fkey                 | FOREIGN KEY
scans                    | scans_brand_id_fkey                | FOREIGN KEY
scans                    | scans_previous_scan_id_fkey        | FOREIGN KEY
scan_recommendations     | scan_recommendations_pkey          | PRIMARY KEY
scan_recommendations     | scan_recommendations_scan_id_fkey  | FOREIGN KEY
scan_pages               | scan_pages_pkey                    | PRIMARY KEY
scan_pages               | scan_pages_scan_id_fkey            | FOREIGN KEY
submission_targets       | submission_targets_unique_business_directory | UNIQUE
submission_runs          | submission_runs_action_needed_requires_type | CHECK
submission_runs          | submission_runs_failed_requires_error_type | CHECK
submission_runs          | submission_runs_lock_fields_consistent | CHECK
```

## 8. Existing Indexes (Key Tables)

```
users: idx_users_email
users: idx_users_email_verified
scans: idx_scans_user_id
scans: idx_scans_status
scans: idx_scans_created_at
scan_recommendations: idx_scan_recommendations_scan_id
scan_recommendations: idx_recommendations_status
scan_recommendations: idx_recommendations_impact_score
scan_pages: idx_scan_pages_scan_id
directories: idx_directories_tier_num
directories: idx_directories_regions
directories: idx_directories_priority
directories: idx_directories_active (partial)
submission_runs: idx_submission_runs_dequeue (partial)
submission_runs: idx_submission_runs_locks (partial)
submission_events: idx_submission_events_run
```

## 9. Existing Functions

```
get_run_lineage(UUID) (FUNCTION) - Returns full attempt history for submission runs
can_acquire_lock(UUID, VARCHAR, INTEGER) (FUNCTION) - Check lock acquisition eligibility
prevent_submission_events_modification() (FUNCTION) - Immutability trigger
sync_submission_target_current_from_run() (FUNCTION) - Denormalization sync
touch_updated_at() (FUNCTION) - Auto-update timestamps
```

## 10. Existing Enums

From `backend/migrations/phase5_step1_migration_v1.1.0.sql`:

```
submission_status: queued, deferred, paused, in_progress, action_needed, submitted, awaiting_review, approved, live, needs_changes, failed, rejected, blocked, disabled, expired, already_listed, cancelled

triggered_by: worker, user, admin, webhook, scheduler, system

action_needed_type: captcha, reauth, mfa, login_required, manual_review, content_fix, missing_fields, consent_required, payment_required, verification, claim_listing, other

error_type: network_error, timeout, rate_limited, server_error, temporary_failure, validation_error, auth_error, not_found, forbidden, duplicate, tos_violation, invalid_payload, unsupported, connector_error, config_error, lock_error, redaction_error, unknown

artifact_type: request_payload, response_payload, screenshot_pre, screenshot_post, screenshot_error, confirmation_email, submission_receipt, external_id, listing_url, duplicate_check, validation_result, live_verification_result, error_log, retry_log, raw_status, submission_packet, instructions, (and more...)

submission_event_type: status_change, created, started, completed, connector_called, connector_response, connector_error, validation_started, validation_passed, validation_failed, submitted, duplicate_found, retry_scheduled, retry_attempted, lock_acquired, lock_released, action_required, action_resolved, user_paused, user_resumed, user_cancelled, error_occurred, (and more...)

integration_bucket: A, B, C, D

submission_mode: api, form, browser, assisted, manual

status_reason: rate_limited, backoff, scheduled, validation_failed, missing_required_fields, invalid_data, duplicate_found, already_exists, auth_expired, auth_failed, reauth_required, captcha_required, mfa_required, login_required, directory_approved, directory_rejected, network_error, timeout, server_error, circuit_open, manual_pause, manual_resume, submission_accepted, live_verified, lock_acquired, lock_released, (and more...)
```

## 11. User Distribution by Plan

> **Requires DATABASE_URL connection to query actual data**

Expected plan values (from normalization migration):
- `free` (default)
- `freemium`
- `diy`
- `pro`
- `agency`
- `enterprise`

## 12. Scan Status Distribution

> **Requires DATABASE_URL connection to query actual data**

Expected status values:
- `pending`
- `processing`
- `completed`
- `failed`

## 13. Billing Data Location

```
Table                    | Column
-------------------------|---------------------------
users                    | stripe_customer_id
users                    | stripe_subscription_id
directory_orders         | stripe_checkout_session_id
directory_orders         | stripe_payment_intent_id
directory_orders         | stripe_price_id
directory_orders         | amount_cents
stripe_events            | event_id
stripe_events            | customer_id
stripe_events            | subscription_id
```

## 14. Org Columns on Scans

```
No organization columns found on scans table
```

Current ownership model: `scans.user_id` -> `users.id`

## 15. Sample Recommendation Data

> **Requires DATABASE_URL connection to query actual data**

Expected structure:
- Categories: AI Readability, AI Search Readiness, Content Freshness, Content Structure, Speed & UX, Technical Setup, Trust & Authority, Voice Optimization
- Types: `site-wide`, `page-specific`
- Priorities: `high`, `medium`, `low`
- Statuses: `pending`, `active`, `implemented`, `skipped`, `auto_detected`, `archived`

---

## Summary: Migration Risks

### Tables to CREATE (don't exist):
- `organizations` - Core multi-tenant organization entity
- `organization_members` - User-to-organization membership with roles
- `organization_invites` - Pending organization invitations
- `organization_billing` - Organization-level billing (migrate Stripe data from users)

### Tables to ALTER (exist but need columns):
- `users` - Add `organization_id` FK, possibly `default_organization_id`
- `scans` - Add `organization_id` FK for org-level scan ownership
- `business_profiles` - Add `organization_id` FK (currently user-owned)
- `directory_orders` - Add `organization_id` FK
- `scan_recommendations` - Consider adding `subfactor` column for better categorization

### Data Backfill Required:
- [ ] Create a default organization for each existing user
- [ ] Set `users.organization_id` to their default organization
- [ ] Migrate `scans.user_id` ownership to `scans.organization_id`
- [ ] Migrate plan data from `users.plan` to `organization_billing`
- [ ] Migrate Stripe customer/subscription IDs from users to organization_billing
- [ ] Update `business_profiles` to link to organizations instead of users
- [ ] Update `directory_orders` to link to organizations

### Potential Conflicts:
- `users.plan` is VARCHAR, not ENUM - may need conversion if moving to org-level plans
- `users.id` is INTEGER in some tables, need to verify FK type consistency
- No `organization_id` column exists on any table yet - clean slate for implementation
- `business_profiles` currently links directly to users - needs migration strategy
- Stripe billing is user-level, not organization-level

### Recommended Migration Order:
1. **Phase 1A:** Create `organizations` table with UUID primary key
2. **Phase 1B:** Create `organization_members` table
3. **Phase 1C:** Create `organization_billing` table
4. **Phase 2A:** Add `organization_id` to `users` (nullable initially)
5. **Phase 2B:** Backfill - create default org for each user
6. **Phase 2C:** Update users with their organization_id
7. **Phase 3A:** Add `organization_id` to `scans` (nullable initially)
8. **Phase 3B:** Backfill scans.organization_id from user's organization
9. **Phase 4:** Migrate billing data to organization_billing
10. **Phase 5:** Add FK constraints and make organization_id NOT NULL

### Data Volume Considerations:
> Run `DATABASE_URL="..." node backend/scripts/database-audit.js` to get actual counts

- User count impacts organization creation backfill time
- Scan count impacts organization assignment backfill time
- Stripe customer count impacts billing migration complexity

---

## Appendix: Audit Script Location

A complete audit script has been created at:
```
backend/scripts/database-audit.js
```

To run with actual database connection:
```bash
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" node backend/scripts/database-audit.js
```

This will generate a complete report with actual row counts and live schema data.
