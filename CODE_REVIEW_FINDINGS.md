# Code Review Findings: 5-Day Skip, Optimization Mode, and DIY Flow

**Date:** 2025-11-25
**Reviewer:** Claude Code Analysis
**Repository:** AI Visibility Tool

---

## Executive Summary

This code review analyzed the 5-day skip guard, Optimization Mode, and DIY plan implementation. **Critical findings indicate that the "5-day skip" is ONLY implemented for recommendation unlocking, NOT for scan generation or recommendation refresh.** No "Optimization Mode" feature flag or content caching system exists in the current implementation.

---

## 1. FINDINGS: 5-Day Skip Logic

### A) Location & Implementation

**File:** `backend/routes/scan.js:1065-1083`
**Function:** Recommendation unlock throttling (NOT scan throttling)
**Scope:** DIY plan only

```javascript
// Calculate days since last unlock
let daysSinceLastUnlock = 0;
if (lastUnlock) {
  daysSinceLastUnlock = Math.floor((now - lastUnlock) / (1000 * 60 * 60 * 24));
}

// Check 5-day interval requirement (DIY tier only)
if (user.plan === 'diy' && lastUnlock && daysSinceLastUnlock < 5) {
  const daysRemaining = 5 - daysSinceLastUnlock;
  const nextUnlockDate = new Date(lastUnlock);
  nextUnlockDate.setDate(nextUnlockDate.getDate() + 5);

  return res.status(429).json({
    error: 'Unlock interval not met',
    message: `You can unlock 5 new recommendations every 5 days...`,
    canUnlockAgainAt: nextUnlockDate.toISOString(),
    daysRemaining: daysRemaining
  });
}
```

**Timestamp Field:** `lastUnlock` from database query (assumed to be `last_unlocked_at` or similar)
**Calculation Method:** JavaScript millisecond math: `Math.floor((now - lastUnlock) / (1000 * 60 * 60 * 24))`
**Timezone:** Uses `Date.now()` and `new Date()` - **server timezone dependent** (not explicitly UTC)

### B) Issues Identified

#### ❌ **CRITICAL: No scan-level 5-day skip**
- **Expected:** Prevent re-scanning same URL within 5 days to save resources
- **Actual:** Users can scan the same URL unlimited times (subject only to monthly quota)
- **Impact:** No cost optimization or rate limiting for duplicate scans
- **Location:** `backend/routes/scan.js:144-550` (analyze endpoint) - **missing skip logic**

#### ⚠️ **Timezone Ambiguity**
- **Issue:** Uses `Date.now()` and `new Date()` without explicit UTC conversion
- **Risk:** DST transitions or server timezone changes could cause off-by-one-day errors
- **Recommendation:** Use `Date.UTC()` or store timestamps as UTC

#### ⚠️ **Inconsistent Skip Scope**
- **Issue:** Unclear if skip is per-URL, per-domain, or per-user-global
- **Current:** Appears to be user-global (based on `last_unlocked_at` query)
- **Spec Ambiguity:** Task description mentions "page-scoped or domain-scoped" but implementation is user-scoped

### C) Refresh Cycle Service (Different System)

**File:** `backend/services/refresh-cycle-service.js:22-393`
**Purpose:** 5-day recommendation **replacement** cycle (not skip guard)
**Mechanism:**
- Replaces implemented/skipped recommendations every 5 days
- Uses SQL `INTERVAL '5 days'` and `CURRENT_DATE`
- Separate from the unlock throttle

```javascript
this.REFRESH_CYCLE_DAYS = 5;

// Next refresh date calculation (line 207)
next_refresh_date = CURRENT_DATE + INTERVAL '5 days'
```

**This is NOT the same as scan throttling** - it's a recommendation rotation system.

---

## 2. FINDINGS: Optimization Mode

### ❌ **CRITICAL: No Optimization Mode Implementation Found**

**Search Results:** Searched for:
- `OPTIMIZATION_MODE` flag: **NOT FOUND**
- `USE_CACHE` flag: **NOT FOUND**
- `contentHash` comparison: **NOT FOUND**
- `LIGHT_MODEL_DETECTION`: **NOT FOUND**
- `HYBRID_RECS`: **NOT FOUND**

**What Exists Instead:**
1. **Cache-Busting** (opposite of caching)
   - File: `backend/analyzers/content-extractor.js:76-82`
   - Adds `?_cb=${Date.now()}` to bypass CDN caches
   - Forces **fresh content** on every scan

```javascript
const cacheBustUrl = this.url.includes('?')
  ? `${this.url}&_cb=${Date.now()}`
  : `${this.url}?_cb=${Date.now()}`;
```

2. **No Content Hash Storage**
   - Database schema review: No `content_hash` or `content_digest` columns found
   - No ETag comparison logic

3. **No Token-Saving Path**
   - All scans use full V5 rubric engine
   - No "light model" vs "heavy model" branching

### Conclusion
**Optimization Mode does not exist.** Every scan performs full content extraction, rubric analysis, and recommendation generation regardless of whether content changed.

---

## 3. FINDINGS: DIY Plan Limits & Flow

### A) Plan Limits Definition

**File:** `backend/middleware/usageLimits.js:17-28`

```javascript
diy: {
  scansPerMonth: 25,        // ✅ Correct
  pagesPerScan: 5,          // ✅ Correct (homepage + 4)
  competitorScans: 2,       // ✅ Correct
  multiPageScan: true,      // ✅ Enabled
  pageSelection: true,      // ✅ User chooses pages
  competitorAnalysis: false,// ✅ Score-only (not full analysis)
  pdfExport: false,         // ✅ Disabled
  jsonLdExport: true,       // ✅ Enabled
  progressTracking: true,   // ✅ Enabled
  pageTodoLists: true,      // ✅ Page-level recs
  brandVisibilityIndex: false // ✅ Disabled
}
```

### B) Limit Enforcement

**File:** `backend/middleware/usageLimits.js:46-103`

```javascript
// Check if user exceeded monthly limit (line 80)
if (req.user.scans_used_this_month >= limits.scansPerMonth) {
  return res.status(403).json({
    error: 'Scan limit reached',
    message: `You've used ${req.user.scans_used_this_month}/${limits.scansPerMonth} scans this month.`,
    currentPlan: userPlan,
    upgrade: upgradeMessage
  });
}

// Increment usage (line 92-95)
await db.query(
  'UPDATE users SET scans_used_this_month = scans_used_this_month + 1 WHERE id = $1',
  [userId]
);
```

**Enforcement Mechanism:**
- ✅ Checks `scans_used_this_month` against `scansPerMonth` limit
- ✅ Returns HTTP 403 when limit exceeded
- ✅ Increments counter atomically in database
- ⚠️ **No rollback on scan failure** - counter increments before scan completes

### C) DIY Recommendation Flow

**File:** `backend/routes/scan.js:144-550` (analyze endpoint)

**Tier Filtering:**
- Uses `tier-filter.js` to limit recommendations by plan
- DIY gets "progressive unlock" (5 active, rest locked)
- Unlock throttling enforced via 5-day rule (see Section 1)

**Quality Assurance:**
- ✅ DIY receives full V5 rubric analysis (no downgrade)
- ✅ Page-scoped JSON-LD generation
- ✅ Action blocks with copy-paste code
- ✅ Industry-specific FAQ schemas

### D) Issues Identified

#### ⚠️ **Race Condition: Scan Counter Increment**
- **Issue:** Counter increments before scan completes
- **Scenario:** If scan fails after counter increment, user loses a scan credit
- **File:** `backend/middleware/usageLimits.js:92-95`
- **Fix:** Move increment to scan completion hook

#### ⚠️ **No Monthly Reset Automation**
- **Issue:** Quota reset requires manual script execution
- **File:** `backend/scripts/reset-quota.js:35-39`
- **Risk:** If cron job fails, users remain quota-blocked
- **Recommendation:** Add database trigger or server startup check

---

## 4. TRUTH TABLE: 5-Day Skip & Optimization Mode

| Scenario | Content Changed | Since Last Gen | Since Last Unlock | Plan | **Expected Behavior** | **Actual Behavior** | Pass? |
|----------|-----------------|----------------|-------------------|------|-----------------------|---------------------|-------|
| **A** | false | 4d 23h | 4d 23h | diy | Skip scan (within 5d window) | ✅ Scan runs, unlock blocked | ❌ **BUG** |
| **B** | false | 5d 1h | 5d 1h | diy | Generate new scan | ✅ Scan runs, unlock allowed | ⚠️ No skip |
| **C** | true | 2d | 2d | diy | Generate (content changed) | ✅ Scan runs, unlock blocked | ⚠️ No detection |
| **D** | false | 4d 23h | N/A | free | Skip not applicable | ✅ Scan runs (no unlock limit) | ✅ |
| **E** | false | 0d | 0d | diy | First scan → generate | ✅ Scan runs, first unlock | ✅ |
| **F** | N/A | N/A | 4d 23h | diy | Optimization Mode? | ❌ No such mode | ❌ **Missing** |
| **G** | false (hash match) | 2d | 2d | diy | Use cached recs | ❌ Full generation | ❌ **Missing** |
| **H** | Same URL | 1h | 1h | diy | Skip duplicate scan | ❌ Scan runs | ❌ **BUG** |

### Summary
- ✅ **Unlock throttling works** (DIY can't unlock more recs within 5 days)
- ❌ **Scan throttling missing** (no duplicate scan prevention)
- ❌ **Optimization Mode missing** (no content hash caching)
- ❌ **Content change detection missing** (no hash comparison)

---

## 5. PATCHES & RECOMMENDATIONS

### Patch 1: Add Scan-Level 5-Day Skip

**File:** `backend/routes/scan.js` (insert after line 250)

```javascript
// ============================================
// 5-DAY SCAN SKIP GUARD
// ============================================
async function checkScanSkip(userId, url) {
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

  const recentScan = await db.query(`
    SELECT id, created_at, total_score
    FROM scans
    WHERE user_id = $1
      AND url = $2
      AND created_at > $3
      AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1
  `, [userId, url, fiveDaysAgo.toISOString()]);

  if (recentScan.rows.length > 0) {
    const scan = recentScan.rows[0];
    const age = Date.now() - new Date(scan.created_at).getTime();
    const daysAgo = Math.ceil(age / (1000 * 60 * 60 * 24));
    const daysUntilNext = 5 - daysAgo;

    return {
      skip: true,
      scanId: scan.id,
      lastScore: scan.total_score,
      scannedDaysAgo: daysAgo,
      canScanAgainIn: daysUntilNext,
      nextScanDate: new Date(new Date(scan.created_at).getTime() + 5 * 24 * 60 * 60 * 1000)
    };
  }

  return { skip: false };
}

// In POST /api/scan/analyze (line 170):
const skipCheck = await checkScanSkip(userId, url);
if (skipCheck.skip) {
  return res.status(200).json({
    success: true,
    skipped: true,
    reason: 'within_5d_window',
    message: `This URL was scanned ${skipCheck.scannedDaysAgo} days ago. You can scan it again in ${skipCheck.canScanAgainIn} days.`,
    existingScan: {
      scanId: skipCheck.scanId,
      score: skipCheck.lastScore,
      scannedAt: skipCheck.lastScannedAt
    },
    nextScanAvailable: skipCheck.nextScanDate.toISOString()
  });
}
```

### Patch 2: Fix Timezone Consistency

**File:** `backend/routes/scan.js:1068`

```javascript
// OLD (timezone-dependent):
daysSinceLastUnlock = Math.floor((now - lastUnlock) / (1000 * 60 * 60 * 24));

// NEW (UTC-explicit):
const nowUTC = Date.now();
const lastUnlockUTC = new Date(lastUnlock).getTime();
daysSinceLastUnlock = Math.floor((nowUTC - lastUnlockUTC) / (1000 * 60 * 60 * 24));

// Store timestamps as UTC in database:
// ALTER TABLE user_progress ALTER COLUMN last_unlocked_at TYPE TIMESTAMPTZ;
```

### Patch 3: Move Scan Counter Increment to Completion

**File:** `backend/middleware/usageLimits.js:92-95`

```javascript
// REMOVE from checkScanLimit middleware:
// await db.query(
//   'UPDATE users SET scans_used_this_month = scans_used_this_month + 1 WHERE id = $1',
//   [userId]
// );

// ADD to scan completion hook (backend/services/scan-completion-hook.js):
async onScanComplete(userId, scanId) {
  // ... existing completion logic ...

  // Increment counter ONLY on successful completion
  await this.pool.query(`
    UPDATE users
    SET scans_used_this_month = scans_used_this_month + 1
    WHERE id = $1
  `, [userId]);

  console.log(`✅ Scan ${scanId} completed - quota incremented for user ${userId}`);
}
```

---

## 6. TEST SUITE REQUIREMENTS

Based on findings, tests must verify:

1. **Scan Skip Guard:**
   - First scan → generates
   - Re-scan within 5 days → skips (returns existing scan ID)
   - Re-scan after 5 days → generates new scan
   - Different URLs → both generate (no cross-URL skip)

2. **Unlock Throttle:**
   - DIY user unlocks 5 recs → success
   - Attempts 6th unlock within 5 days → 429 error
   - Attempts unlock after 5 days → success

3. **DIY Limits:**
   - 24 scans in month → success
   - 25th scan → success
   - 26th scan → 403 error with upgrade CTA

4. **Quota Integrity:**
   - Scan fails → quota NOT incremented
   - Scan succeeds → quota incremented exactly once

---

## 7. PRIORITY RECOMMENDATIONS

### P0 - Critical (Implement Immediately)
1. ✅ **Add scan-level 5-day skip** (Patch 1)
2. ✅ **Move quota increment to completion** (Patch 3)
3. ✅ **Fix timezone handling** (Patch 2)

### P1 - High (Next Sprint)
4. ⚠️ **Add automated monthly quota reset** (cron + health check)
5. ⚠️ **Add content hash storage** (enable future optimization mode)
6. ⚠️ **Add scan deduplication** (hash-based, not just time-based)

### P2 - Medium (Backlog)
7. 📋 **Implement Optimization Mode** (cache recs if content unchanged)
8. 📋 **Add scan result caching** (serve cached results for 24h)
9. 📋 **Add per-URL skip tracking** (not just user-global)

---

## 8. CONCLUSION

**Current State:**
- ✅ DIY plan limits correctly enforced (25 scans/month)
- ✅ Unlock throttling works (5-day interval for DIY)
- ✅ Recommendation quality maintained for DIY tier
- ❌ **No scan-level 5-day skip** (major gap)
- ❌ **No Optimization Mode** (all scans full-cost)
- ❌ **Scan quota increments before completion** (lose credits on failures)

**Risk Assessment:**
- **High:** Users can spam-scan same URL (cost explosion)
- **Medium:** Quota tracking race condition (user experience issue)
- **Low:** Timezone edge cases (rare DST bugs)

**Next Steps:**
1. Implement scan skip guard (Patch 1)
2. Write comprehensive test suite (see Section 6)
3. Fix quota increment timing (Patch 3)
4. Add monitoring for duplicate scans
5. Plan Optimization Mode implementation (Phase 2)

---

**Report Generated:** 2025-11-25
**Reviewed Codebase:** `/home/user/ai-visibility-tool/backend`
**Files Analyzed:** 15+ routes, services, middleware, analyzers
**Lines Reviewed:** ~5000 LOC
