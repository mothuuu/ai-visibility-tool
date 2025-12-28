# Phase 0: Migrations Audit

## Overview

This document inventories all database migrations and identifies which may not have been executed in production.

---

## Table Name Clarification

**CONFIRMED CANONICAL NAMES:**

| Expected | Actual | Status |
|----------|--------|--------|
| `directories` or `ai_directories` | `directories` | ✅ Confirmed |
| `credential_vault` or `directory_credentials` | `credential_vault` | ✅ Confirmed |

All code references use `directories` and `credential_vault`. There are **NO** references to `ai_directories` or `directory_credentials` in the codebase.

---

## Database Engine

**Engine:** PostgreSQL

Evidence:
- `DATE_TRUNC('month', NOW())` used in queries
- `gen_random_uuid()` for UUID generation
- `ON CONFLICT ... DO UPDATE` syntax
- `FOR UPDATE SKIP LOCKED` in worker
- `INTERVAL '1 hour'` syntax

**No SQLite compatibility required.**

---

## Migration Files Inventory

### Core Schema Migrations (backend/db/)

| File | Tables Created/Modified | Critical | Likely Executed |
|------|------------------------|----------|-----------------|
| `migrate-citation-network.js` | business_profiles, directory_orders, subscriber_directory_allocations, directories, directory_submissions | Yes | Likely ✅ |
| `migrate-campaign-runs.js` | campaign_runs, credential_vault, directory_submissions (new columns) | Yes | Likely ✅ |

### SQL Migrations (backend/migrations/)

| File | Purpose | Critical | Likely Executed |
|------|---------|----------|-----------------|
| `fix_entitlement_system.sql` | Normalize user plans, add unique constraint | Yes | Unknown ⚠️ |
| `credential_security_hardening.sql` | Add handoff columns to credential_vault, create credential_access_log | Medium | Unknown ⚠️ |
| `notification_deduplication.sql` | Create citation_notification_events, user_notification_preferences | Low | Unknown ⚠️ |
| `add_campaign_run_columns.sql` | Add directories_in_progress, directories_action_needed, etc. | Yes | Unknown ⚠️ |
| `add_submission_action_columns.sql` | Add action_type, action_instructions, action_url, etc. | Yes | Unknown ⚠️ |
| `create_waitlist_table.sql` | Create waitlist table | Low | Unknown |
| `add_impact_description.sql` | Add impact description column | Low | Unknown |
| `add_missing_user_progress_columns.sql` | Add user progress columns | Low | Unknown |
| `reset_monthly_quota.sql` | Reset quota logic | Low | Unknown |

---

## Critical Missing Columns (if migrations not run)

These columns are REQUIRED by the worker but may not exist:

### campaign_runs table
```sql
-- From add_campaign_run_columns.sql
directories_in_progress INTEGER DEFAULT 0
directories_action_needed INTEGER DEFAULT 0
directories_failed INTEGER DEFAULT 0
directories_submitted INTEGER DEFAULT 0
directories_live INTEGER DEFAULT 0
```

### directory_submissions table
```sql
-- From add_submission_action_columns.sql
action_type VARCHAR(50)
action_instructions TEXT
action_url TEXT
action_deadline TIMESTAMP
action_required_at TIMESTAMP
started_at TIMESTAMP
failed_at TIMESTAMP
blocked_at TIMESTAMP
blocked_reason TEXT
error_code VARCHAR(50)
error_message TEXT
retry_count INTEGER DEFAULT 0
queue_position INTEGER
submitted_at TIMESTAMP
live_at TIMESTAMP
verified_at TIMESTAMP
listing_url TEXT
```

### credential_vault table
```sql
-- From credential_security_hardening.sql
handoff_status VARCHAR(50) DEFAULT 'none'
handed_off_at TIMESTAMP
handed_off_by_user_id INTEGER
handoff_reason TEXT
handoff_notes TEXT
handoff_completed_at TIMESTAMP
```

---

## Verification Queries

Run these to check if migrations have been applied:

```sql
-- Check campaign_runs columns
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'campaign_runs'
  AND column_name IN ('directories_in_progress', 'directories_action_needed');

-- Check directory_submissions columns
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'directory_submissions'
  AND column_name IN ('action_type', 'action_url', 'queue_position', 'retry_count');

-- Check credential_vault columns
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'credential_vault'
  AND column_name IN ('handoff_status', 'handed_off_at');

-- Check tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'credential_access_log',
    'citation_notification_events',
    'user_notification_preferences'
  );
```

---

## Migration Execution Order

If migrations need to be run, execute in this order:

1. `migrate-citation-network.js` - Core tables
2. `migrate-campaign-runs.js` - Campaign system
3. `fix_entitlement_system.sql` - Plan normalization
4. `add_campaign_run_columns.sql` - Worker counters
5. `add_submission_action_columns.sql` - Submission tracking
6. `credential_security_hardening.sql` - Security features
7. `notification_deduplication.sql` - Notifications (optional)

---

## High-Risk Issues

### 1. Worker Column Dependencies

The submission worker (`submissionWorker.js`) will fail if these columns don't exist:
- `directory_submissions.action_type`
- `directory_submissions.action_url`
- `directory_submissions.action_deadline`
- `directory_submissions.action_required_at`
- `directory_submissions.started_at`
- `directory_submissions.queue_position`
- `directory_submissions.retry_count`
- `campaign_runs.directories_in_progress`
- `campaign_runs.directories_action_needed`

### 2. No Migration Tracking System

There's no `schema_migrations` or similar table to track which migrations have been run. This makes it impossible to know the current schema state without querying `information_schema`.

**Recommendation:** Add a migration tracking table or adopt a migration tool (knex, prisma, node-pg-migrate).

---

## Directories Table: pricing_model Column

The `directories` table requires a `pricing_model` column for filtering, but it's NOT in the original migration:

```sql
-- Expected by campaignRunService.selectDirectoriesTx()
WHERE d.pricing_model IN ('free', 'freemium')
```

This column may need to be added:
```sql
ALTER TABLE directories
ADD COLUMN IF NOT EXISTS pricing_model VARCHAR(50) DEFAULT 'free';
```

And seeded:
```sql
UPDATE directories
SET pricing_model = 'free'
WHERE pricing_model IS NULL AND paid_only = false;

UPDATE directories
SET pricing_model = 'paid'
WHERE pricing_model IS NULL AND paid_only = true;
```
