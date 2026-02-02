# Phase: Scan Quota Enforcement — Discovery Notes

## Problem Statement
Free plan allows 2 scans/month, but:
- UI shows "3/2 used" (150%)
- Free users can still start scans beyond the cap
- `usage_events` INSERT fails when `period_id` is NULL (for free/no-Stripe users)

## Root Causes
1. **Server-side enforcement is not authoritative** — scan quota is checked via legacy counters (`scans_used_this_month`) but the counter can drift if resets fail or usage_events writes fail.
2. **`usage_events` INSERT in `usageService.js:308` omits `period_id`** — the column is `NOT NULL` with an FK to `usage_periods.id`, so the INSERT fails silently. The v2 dual-write path silently catches this error and continues, causing the legacy counter to diverge from v2 events.

---

## Discovery Findings

### 0A) Scan Creation Route
- **POST `/api/scan/analyze`** — `backend/routes/scan.js:299`
  - Authenticated with `authenticateToken` + `loadOrgContext`
  - Checks quota at lines 464–486 via `canScan(entitlements, usageSummary, false)`
  - Creates scan record at line 515 (status `processing`)
  - Increments usage at line 762 via `incrementUsageEvent()` — **AFTER** scan completes
  - Current debit timing: **scan_completed** (not scan_started)

### 0B) Dashboard Endpoint
- **GET `/api/auth/me/usage`** — `backend/routes/auth.js:270`
  - Calls `getUsageSummary()` which reads from legacy `scans_used_this_month` (fallback) or v2 `usage_events` (if enabled)
  - Uses same `checkAndResetLegacyIfNeeded()` before reading
  - Returns: `usage.scans.{used, limit, remaining}`

### 0C) usage_events INSERT Paths
1. **`usageService.js:308`** — Missing `period_id`! Uses raw INSERT without period resolution.
2. **`usage-tracker-service.js:57`** — Uses `record_usage_event()` PL/pgSQL function which handles period creation automatically. This is the correct path.
3. **Migration `008_usage_foundation.sql`** — `record_usage_event()` calls `get_or_create_usage_period()` to auto-resolve period_id.

### 0D) Schema
- **`period_id`**: `INTEGER NOT NULL` FK to `usage_periods.id` (SERIAL)
- **`scan_id`**: `INTEGER` (nullable, no FK constraint to scans table)
- **`usage_periods`** table exists with `is_current` flag and calendar-month periods
- No unique constraint on `(user_id, period_id, scan_id, event_type)` — duplicates possible

### 0E) Existing SSOT locations for scan caps
- `scanEntitlementService.js` — `SCAN_ENTITLEMENTS.free.scans_per_period = 2` (primary SSOT)
- `usageLimits.js` — `PLAN_LIMITS.free.scansPerMonth = 2` (legacy middleware copy)
- `frontend/utils/quota.js` — `PLAN_LIMITS.free.primary = 2` (frontend fallback)
- `008_usage_foundation.sql` — `get_or_create_usage_period()` hardcodes `"scans": 2` for free

All four locations agree: **free = 2 scans/month**.

---

## Debit Timing Decision
**Keep existing: debit on `scan_completed`** (not `scan_started`).

Rationale:
- Current codebase already debits after successful scan at line 762
- Failed scans naturally don't consume quota (no reconciliation needed)
- Simpler — no need for `non_billable` flag or reversal logic
- Risk of user starting more scans than cap during concurrent requests is minimal for free tier (2 cap, sequential UI)

For idempotency: we add a UNIQUE constraint on `(scan_id, event_type)` in usage_events to prevent double-counting on retries.

---

## Plan

1. Create `scanQuotaCaps.js` — SSOT for scan/month caps (separate from rec caps)
2. Fix `usageService.js` `incrementUsageEvent()` — use `record_usage_event()` DB function instead of raw INSERT
3. Add UNIQUE constraint on usage_events for idempotency
4. Ensure dashboard reads from same source as enforcement
5. Add tests
