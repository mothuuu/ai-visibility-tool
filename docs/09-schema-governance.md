# Visible2AI - Schema Governance
## Rules for Database Schema Management

**Version:** 1.1  
**Date:** 2026-01-03  
**Status:** LOCKED

---

## Overview

The foundation schema (v2.1) is the **single source of truth** for all database structure. This document defines how schema changes are proposed, reviewed, and deployed.

---

## Current Schema Reference

| Document | Version | Location |
|----------|---------|----------|
| Foundation Schema | v2.1 | `visible2ai-foundation-schema-final.md` |
| This Governance Doc | v1.1 | `visible2ai-schema-governance.md` |

---

## Core Principles

### 1. Schema is a Contract
- The schema defines the contract between backend and database
- All code must conform to the schema, not vice versa
- Breaking changes require versioned migration

### 2. Additive Over Destructive
- Prefer adding columns/tables over modifying existing
- Never drop columns without deprecation period
- Never rename columns (add new, migrate data, deprecate old)

### 3. Deprecation Window
- **Breaking changes require at least one release where old + new fields coexist**
- Exception: Security incidents or critical data integrity issues
- Minimum deprecation period: 30 days (or 2 releases, whichever is longer)
- Deprecation must be announced in release notes

### 4. Version Everything
- Every schema change gets a version bump
- Migrations are numbered and sequential
- Rollback scripts required for every migration

### 5. Future-Proof by Default
- Create tables for future features now (even if empty)
- Use JSONB for flexible data structures
- Include `created_at`, `updated_at` on all tables

---

## Schema Versioning

### Version Format
```
MAJOR.MINOR.PATCH

- MAJOR: Breaking changes (column removal, type change)
- MINOR: New tables or columns
- PATCH: Index changes, constraint fixes
```

### Current Version
```
v2.1.0 (Foundation)
```

### Version History

| Version | Date | Description |
|---------|------|-------------|
| 2.1.0 | 2026-01-03 | Foundation schema with recommendation quality layer |
| 2.0.0 | 2026-01-02 | Added multi-tenant, org-centric architecture |
| 1.0.0 | 2025-xx-xx | Original schema (deprecated) |

---

## Change Request Process

### Step 1: Propose Change
Create a Change Request (CR) document:

```markdown
## Schema Change Request: CR-XXX

**Requestor:** [Name]
**Date:** [Date]
**Priority:** Low / Medium / High / Critical

### Change Description
[What is being added/modified/removed]

### Rationale
[Why this change is needed]

### Affected Tables
- table_1: [changes]
- table_2: [changes]

### Migration Strategy
[How existing data will be handled]

### Rollback Plan
[How to undo if issues arise]

### Dependencies
[What code changes are required]
```

### Step 2: Review
- Technical review by Arhan
- Product review by Monali (if affects features)
- Security review (if affects auth/sensitive data)

### Step 3: Approve
Both reviewers must approve before implementation.

### Step 4: Implement
1. Write migration script (up + down)
2. Test on staging with production data copy
3. Update schema documentation
4. Bump version number
5. Deploy during maintenance window

### Step 5: Verify
- Run validation script
- Confirm all FKs and indexes
- Test affected features

---

## Migration Standards

### Naming Convention
```
migrations/
├── 001_initial_schema.sql
├── 002_add_organizations.sql
├── 003_add_usage_periods.sql
├── 004_add_recommendation_quality.sql
└── ...
```

### Migration File Structure
```sql
-- Migration: 004_add_recommendation_quality.sql
-- Version: 2.1.0
-- Date: 2026-01-03
-- Author: [Name]
-- Description: Add recommendation quality tables

-- ═══════════════════════════════════════════════════════════════════════════
-- UP MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Add new table
CREATE TABLE IF NOT EXISTS recommendation_issues (
    id SERIAL PRIMARY KEY,
    issue_code VARCHAR(100) UNIQUE NOT NULL,
    -- ... columns
);

-- Add column to existing table
ALTER TABLE recommendations 
    ADD COLUMN IF NOT EXISTS issue_id INTEGER REFERENCES recommendation_issues(id);

-- Create index
CREATE INDEX IF NOT EXISTS idx_recommendations_issue 
    ON recommendations(issue_id);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- DOWN MIGRATION (ROLLBACK)
-- ═══════════════════════════════════════════════════════════════════════════

-- BEGIN;
-- DROP INDEX IF EXISTS idx_recommendations_issue;
-- ALTER TABLE recommendations DROP COLUMN IF EXISTS issue_id;
-- DROP TABLE IF EXISTS recommendation_issues;
-- COMMIT;
```

**Rollback Delivery Options:**
Choose one approach and stay consistent across all migrations:
- **Option A:** Separate `004_add_recommendation_quality_down.sql` file
- **Option B:** Clearly delimited `-- DOWN MIGRATION` section in same file (as shown above)

If using a migration runner (Prisma, Flyway, golang-migrate), follow its conventions for up/down file naming.

### Migration Rules
1. Always wrap in transaction (`BEGIN`/`COMMIT`)
2. Use `IF NOT EXISTS` / `IF EXISTS` for idempotency
3. Include rollback script (commented out)
4. Test on empty DB and populated DB
5. Estimate execution time for large tables

**Transaction Exceptions:**
- If your migration runner (e.g., Prisma, Flyway) auto-wraps transactions, omit manual `BEGIN`/`COMMIT`
- Some DDL is non-transactional in Postgres: `CREATE INDEX CONCURRENTLY`, `ALTER TYPE ADD VALUE`
- For non-transactional DDL, document rollback steps separately and test carefully

---

## Prohibited Changes

### Never Do Without Full Review
- ❌ Drop tables
- ❌ Drop columns
- ❌ Change column types
- ❌ Rename tables or columns
- ❌ Remove constraints
- ❌ Modify primary keys

### Requires Deprecation Period (30 days)
- Removing unused columns
- Dropping unused tables
- Changing default values

### Safe Changes (Standard Review)
- Adding new tables
- Adding new columns (nullable or with default)
- Adding indexes
- Adding constraints (if data already compliant)

---

## Data Type Standards

### Required Extensions
```sql
-- Run once per database (typically in migration 001)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

**Standard:** Use `uuid-ossp` with `uuid_generate_v4()` for all UUID generation.
Do not mix with `pgcrypto.gen_random_uuid()` — pick one and stay consistent.

### IDs
```sql
id SERIAL PRIMARY KEY              -- Internal IDs
uuid UUID DEFAULT uuid_generate_v4() -- External/API IDs
```

### Strings
```sql
VARCHAR(255)  -- Names, titles
VARCHAR(500)  -- URLs
TEXT          -- Long content (no limit)
```

### Numbers
```sql
INTEGER       -- Counts, scores (0-1000)
BIGINT        -- Large counters
DECIMAL(10,2) -- Money
```

### Timestamps
```sql
TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- Always use TIMESTAMP
-- Never use DATE for timestamps
-- Always include timezone awareness in application
```

### JSON
```sql
JSONB         -- Always JSONB, never JSON
-- Use for: flexible config, metadata, evidence
-- Don't use for: frequently queried fields (use columns instead)
```

### Booleans
```sql
BOOLEAN DEFAULT false  -- Always explicit default
-- Never NULL booleans (confusing three-state)
```

---

## Index Standards

### Naming Convention
```sql
idx_{table}_{column}           -- Single column
idx_{table}_{col1}_{col2}      -- Composite
idx_{table}_{column}_partial   -- Partial index
```

### When to Index
- Foreign keys (always)
- Frequently filtered columns
- Columns in ORDER BY
- Columns in JOIN conditions

### When NOT to Index
- Small tables (< 1000 rows)
- Columns with low cardinality
- Frequently updated columns
- JSONB columns (use GIN for specific keys instead)

---

## Constraint Standards

### Foreign Keys
```sql
REFERENCES other_table(id) ON DELETE CASCADE  -- If child should be deleted
REFERENCES other_table(id) ON DELETE SET NULL -- If child should remain
REFERENCES other_table(id) ON DELETE RESTRICT -- If deletion should fail
```

### Check Constraints
```sql
CHECK (score >= 0 AND score <= 1000)
CHECK (status IN ('active', 'inactive', 'deleted'))
CHECK (plan IN ('free', 'diy', 'pro', 'enterprise', 'agency'))
```

### Unique Constraints
```sql
UNIQUE(organization_id, domain)  -- Composite unique
UNIQUE(email)                    -- Single column
```

---

## Validation Script

**CI Requirement:** CI must run schema validation against a clean DB before merge. Failing validation blocks deployment.

Run after every deployment:

```sql
-- validate_schema.sql

-- Check all foreign keys exist
SELECT 
    tc.table_name, 
    kcu.column_name,
    ccu.table_name AS foreign_table
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY';

-- Check for missing indexes on foreign keys
SELECT
    t.relname AS table_name,
    a.attname AS column_name
FROM pg_constraint c
JOIN pg_class t ON c.conrelid = t.oid
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'f'
AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = t.oid
    AND a.attnum = ANY(i.indkey)
);

-- Check for tables without updated_at trigger
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE'
AND table_name NOT IN (
    SELECT event_object_table 
    FROM information_schema.triggers 
    WHERE trigger_name LIKE 'update_%_updated_at'
);
```

**Note:** The trigger pattern `update_%_updated_at` assumes a naming convention. Align this query with your actual trigger naming (e.g., `set_updated_at_%` or `trg_%_updated_at`) once established.

---

## Emergency Changes

For production issues requiring immediate schema changes:

1. **Notify team** immediately
2. **Document the emergency** (what, why, impact)
3. **Apply minimal fix** (additive only if possible)
4. **Create proper migration** within 24 hours
5. **Post-mortem** to prevent recurrence

Emergency changes still require:
- Transaction wrapping
- Rollback script
- Documentation (can be brief initially)

---

## Schema Freeze Periods

No schema changes during:
- Active incidents
- Major releases (24h before/after)
- Holiday periods
- Without both reviewers available

---

## Process Notes

### Adding New Fields/IDs
- **Before code uses a new internal ID or field**, ensure it is listed in this governance doc or the foundation schema
- This keeps everyone on the same page and prevents undocumented schema drift

### Keeping This Doc Current
- Attach changelog entries when governance rules change
- Reference related spec versions (entitlements, OpenAPI) when they affect schema
- Review quarterly to ensure alignment with actual practice

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.1 | 2026-01-03 | Added deprecation window principle, CI validation requirement, process notes, transaction exceptions, UUID extension requirement |
| 1.0 | 2026-01-03 | Initial governance document |

---

## Sign-off

This governance document is effective immediately.

| Role | Name | Date | Approved |
|------|------|------|----------|
| CEO | Monali | | [ ] |
| Tech Lead | Arhan | | [ ] |
