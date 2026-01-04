# Visible2AI - Critical Bugs Triage
## Current Issues from Bugs & Fixes Sheet

**Version:** 1.1  
**Date:** 2026-01-03

---

## Summary

| Severity | Open | Resolved | In Progress |
|----------|------|----------|-------------|
| Critical | 2 | 4 | 0 |
| High | 5 | 4 | 2 |
| Medium | 8 | 5 | 0 |
| Low | 4 | 0 | 0 |

---

## Critical Issues (Must Fix)

### BF004: Scan Cards Not Clickable ⚠️ OPEN
**Category:** Frontend  
**Status:** Open  
**Impact:** Users cannot initiate scans via dashboard cards

**Description:**
Single/Multi-page scan option cards on dashboard are non-functional - no click handlers.

**Root Cause:**
Missing event listeners on scan type selection cards.

**Workaround:**
If alternative scan initiation exists (e.g., URL input field with submit button, or direct API access), users can still scan. Verify alternate paths exist before classifying as P0.

**Fix in Rebuild:**
Phase 5 (Frontend) - Dashboard redesign with proper scan initiation flow.

**Stopgap:**
Add click handlers to existing cards if needed before rebuild.

---

### BF033: Recommendations Endpoint Returns Empty Array ⚠️ OPEN
**Category:** Recommendations / API  
**Status:** Open  
**Impact:** Critical - Users see "no recommendations" despite issues detected

**Description:**
The `/scans/{id}/recommendations` endpoint sometimes returns an empty array (`[]`) even when the scan detected issues. This violates the **Never Zero Recommendations** contract.

**Known Causes:**
1. Plan-based filtering applied at API level (incorrectly filters all recs for Free users)
2. `recommendationsVisible` limit misused as API filter instead of UI cap
3. Detection engine finds issues but recommendation generation fails silently
4. AI provider timeout causes rec generation to be skipped entirely
5. DB schema mismatch / rec table missing columns (e.g., `subfactor` column errors seen previously)

**Contract Violation:**
- API must ALWAYS return all recommendations (`recommendationsMaxReturn: -1`)
- Locked recs should be returned with `is_locked: true`, not filtered out
- If zero issues detected, return positive-framing locked recs (not empty array)

**Fix in Rebuild:**
- Phase 4: Implement "Never Zero" guardrails in recommendation service
- Store all recs, apply visibility as UI concern only
- Fallback to locked template recs if generation fails

**Validation:**
```javascript
// NEVER return empty array
if (recommendations.length === 0) {
  logger.error('Never Zero violation', { scan_id, request_id });
  recommendations = getDefaultLockedRecommendations(scan);
}
```

---

## High Priority Issues

### BF006: OpenAI API Timeout ⚠️ OPEN
**Category:** API  
**Status:** Open  
**Impact:** Scan failures when AI calls exceed 30s

**Description:**
Requests exceeding 30-second timeout limit causing scan failures.

**Fix in Rebuild:**
- Phase 3: Async job pipeline with proper timeout handling
- Phase 4: AI service with retry + exponential backoff
- Fallback to templates if all AI calls fail

---

### BF008: Generic Recommendations ⚠️ IN PROGRESS
**Category:** Recommendations  
**Status:** In Progress  
**Impact:** Low-quality output, user trust damaged

**Description:**
Only 1 of 23 recommendations high-quality, rest are generic templates due to API failures.

**Fix in Rebuild:**
- Phase 4: Complete recommendation engine rebuild
- Canonical issues library with quality templates
- Marketing/technical/exec copy for each issue
- Evidence-based recommendations

---

### BF009: FAQ Library Not Loading ⚠️ IN PROGRESS
**Category:** Recommendations  
**Status:** In Progress  
**Impact:** Generic FAQs instead of industry-specific

**Description:**
Industry FAQ templates (14 industries) not being pulled, showing generic JSON instead.

**Fix in Rebuild:**
- Phase 4: Proper template loading system
- Phase 1: Seed data for industry templates

---

### BF012: Inconsistent Scores Same URL ⚠️ OPEN
**Category:** Scanning  
**Status:** Open  
**Impact:** User confusion, trust issues

**Description:**
Different URL formats (www vs non-www) producing different scores for same website.

**Note on BF013:**
BF013 ("URL Canonicalization Missing") was marked resolved because `canonicalizeURL()` function was added. However, the function is **not consistently applied** across all code paths:
- Scan creation may not canonicalize before storing
- Evidence fetching may use raw URL
- Duplicate detection not enforcing canonical matching

**Root Cause:**
Canonicalization function exists but not enforced at all entry points.

**Fix in Rebuild:**
- Phase 3: URL canonicalization enforced at scan creation (single entry point)
- Store by canonical URL only
- Duplicate detection uses canonical form
- All evidence fetch uses canonical URL

---

### BF024: Database Capacity Warning ⚠️ OPEN
**Category:** Infrastructure  
**Status:** Open  
**Impact:** Potential outage when capacity exceeded

**Description:**
PostgreSQL at 85% capacity (8.5GB of 10GB) - needs upgrade or cleanup.

**Immediate Action Required:**
1. Upgrade database plan on Render
2. Implement data retention policy
3. Archive old scan evidence

**Retention Target:**
- `scan_evidence` / `scan_data` JSONB: retain 30–90 days, then archive or delete
- `scans` (metadata + scores): retain indefinitely
- `recommendations`: retain with parent scan

---

### BF025: No Queue Management ⚠️ OPEN
**Category:** Infrastructure  
**Status:** Open  
**Impact:** System overwhelmed by concurrent users

**Description:**
Concurrent users overwhelming the system - no job queue for scans.

**Fix in Rebuild:**
- Phase 3: Bull/BullMQ with Redis for scan job queue
- Concurrency limits
- Progress tracking

---

### BF026: Stripe Webhook Not Production-Ready ⚠️ OPEN
**Category:** Payments  
**Status:** Open  
**Impact:** Duplicate charges, missed events

**Description:**
Missing error handling, retry logic, and idempotency checks for webhooks.

**Fix in Rebuild:**
- Phase 2: Idempotent webhook handler
- `webhook_events` table for deduplication
- Proper error handling and retry logic

---

## Medium Priority Issues

### BF010: Smart Templates Too Generic
**Status:** Open  
Fallback templates not using real scan evidence.
→ Fix in Phase 4

### BF014: Unnecessary Redirect to Page Selector
**Status:** Open  
Single page scans redirect unnecessarily.
→ Fix in Phase 5

### BF015: Chatbot Markdown Not Rendering
**Status:** Open  
Raw asterisks showing instead of bold.
→ Fix in Phase 5

### BF016: Sample Questions Not Hiding
**Status:** Open  
Chatbot sample questions stay visible.
→ Fix in Phase 5

### BF020: Upgrade Button Not Visible
**Status:** Open  
Free users can't upgrade until hitting limit.
→ Fix in Phase 5

### BF027: Mobile Responsiveness Issues
**Status:** Open  
Layout breaks on smaller screens.
→ Fix in Phase 5

### BF028: UTM Links Not Tracking
**Status:** Open  
Campaign tracking not working.
→ Fix in Phase 5 or later

### BF032: Free Plan Has DIY Features
**Status:** Open  
Business logic violation.
→ Fix in Phase 2 (entitlements enforcement)

---

## Low Priority Issues

### BF018: Priority Shows Numeric Score
Shows "66" instead of "HIGH".
→ Fix in Phase 5

### BF019: Generic Companies Placeholder
Placeholder text in recommendations.
→ Fix in Phase 4

### BF029: Validation Logic Only Logs
Doesn't update statuses.
→ Fix in Phase 4

### BF030: Partial Implementation Thresholds
Edge case at rescan.
→ Fix in Phase 4

---

## Resolved Issues (Reference)

| ID | Issue | Resolution |
|----|-------|------------|
| BF001 | Database Connection Failure | Fixed DB settings |
| BF002 | Auth Broken After Code Change | Rollback + incremental changes |
| BF003 | 500 Error on Login | Fixed DB connection |
| BF005 | Claude API 429 Rate Limits | ChatGPT fallback + delays |
| BF007 | Scan Timeout (5+ minutes) | Added timeout limits |
| BF011 | Nested Steps Not Extracted | Updated prompt format |
| BF013 | URL Canonicalization Missing | Added canonicalizeURL function |
| BF017 | HTML Tags Stripped from Steps | Added escapeAngleBrackets |
| BF021 | Must Login Before Purchase | Added auth check |
| BF022 | Email Verification Blocking | Fixed email service |
| BF023 | Scan Quota Exceeded Premature | Fixed quota counting |

---

## Issues Fixed By Rebuild Phase

### Phase 2 (Core Services)
- BF026: Stripe Webhook → Idempotent handler
- BF032: Free Plan Features → Entitlements enforcement
- Quota reset issues → Period-based usage

### Phase 3 (Scanning Pipeline)
- BF006: API Timeout → Async + retry
- BF012: Inconsistent Scores → URL canonicalization
- BF025: No Queue → Bull/BullMQ
- Scan reliability → Job state machine

### Phase 4 (Recommendations)
- BF008: Generic Recommendations → Quality engine
- BF009: FAQ Library → Proper template system
- BF010: Templates Too Generic → Evidence-based
- Zero recommendations → Guardrails

### Phase 5 (Frontend)
- BF004: Scan Cards → New dashboard
- BF014: Unnecessary Redirect → Proper flow
- BF015: Markdown → Proper rendering
- BF016: Sample Questions → State management
- BF018: Priority Display → Label mapping
- BF020: Upgrade Button → Visible CTAs
- BF027: Mobile → Responsive design
- BF028: UTM Tracking → Analytics integration

---

## Immediate Actions (Before Rebuild)

### 1. Database Capacity (BF024) - URGENT
```sql
-- Check current size
SELECT pg_size_pretty(pg_database_size('visible2ai'));

-- Identify large tables
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 10;
```

**Options:**
1. Upgrade Render database plan
2. Archive old scan_data JSONB (> 90 days)
3. Compress evidence data

### 2. Scan Cards (BF004) - Quick Fix
If users are blocked from scanning, add minimal click handlers:
```javascript
document.querySelectorAll('.scan-card').forEach(card => {
  card.addEventListener('click', () => {
    const scanType = card.dataset.scanType;
    initiateScan(scanType);
  });
});
```

### 3. Communication
Prepare user communication for known issues:
- "We're aware of X issue and working on a fix"
- Direct users to support with request_id for tracking

---

## Bug Tracking Going Forward

After rebuild, all bugs should:
1. Have correlation ID from user report
2. Link to relevant Phase/Task
3. Have clear severity and impact
4. Have "fixed by" version tag
