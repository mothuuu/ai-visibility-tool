# Phase 0: Frontend Mock/Placeholder Inventory

## Overview

This document identifies mock data, placeholders, and localStorage usage in the frontend that could cause issues or data bleed.

---

## localStorage Keys Used

### Citation Network Specific

| Key Pattern | Purpose | User-Scoped? |
|-------------|---------|--------------|
| `businessProfile:${userId}` | Cached business profile | ✅ Yes |
| `citationNetworkState:${userId}` | Cached citation state | ✅ Yes |
| `authToken` | JWT authentication token | N/A (per-session) |
| `token` | Legacy auth token | N/A (per-session) |
| `user` | User object (JSON) | N/A (per-session) |
| `primaryDomain` | User's primary domain | ❌ NOT scoped |

### User-Scoping Implementation

**Location:** `frontend/dashboard.js` lines 150-220

```javascript
// User-scoped key generation
function getScopedKey(baseKey, userId) {
  return userId ? `${baseKey}:${userId}` : baseKey;
}

// Keys that get cleared on user switch
const USER_SCOPED_KEYS = [
  'businessProfile',
  'citationNetworkState',
  // ... more keys
];
```

**Good:** The implementation properly scopes sensitive data per-user.

**Risk:** `primaryDomain` is NOT scoped and could leak between users.

---

## citationNetworkState Object

**Location:** `frontend/dashboard.js` line 1772

```javascript
const citationNetworkState = {
  // Loaded from API, no hardcoded mocks
  submissions: [],
  blockedSubmissions: [],
  credentials: [],

  // Computed state
  hasBusinessProfile: false,
  includedStatus: 'loading',
  includedProgress: { total: 0, submitted: 0, live: 0, pending: 0, actionNeeded: 0 },

  // Filter preferences
  phonePolicy: {
    allowPhoneOnListings: true,
    allowPhoneVerification: false
  },

  // Boost tracking
  boostsUsedThisYear: 0,
  boostsRemaining: 2,
  hasActiveBoost: false
};
```

**Status:** No hardcoded mock data. All data loaded from API.

---

## Mock/Placeholder Search Results

### No Citation Network Mocks Found

Searched for: `mockSubmissions`, `mockCredentials`, `mockDirectories`
**Result:** No matches

Searched for: `placeholder` in dashboard.js
**Result:** Only CSS class references (`.directory-logo-placeholder`)

Searched for: hardcoded arrays
**Result:** Only empty initialization (`submissions: []`)

---

## Fallback Behaviors

### API Failure Fallbacks

**Location:** `frontend/dashboard.js` lines 2760-2835

```javascript
// If submissions API fails
try {
  const response = await fetch('/api/citation-network/campaign-submissions', ...);
  if (response.ok) {
    citationNetworkState.submissions = submissions.map(...);
  } else {
    citationNetworkState.submissions = [];
    citationNetworkState.blockedSubmissions = [];
  }
} catch (error) {
  citationNetworkState.submissions = [];
  citationNetworkState.blockedSubmissions = [];
}
```

**Behavior:** On API failure, shows empty state (not mock data).

---

## Logo Placeholder

**Location:** `frontend/js/start-submissions.js` line 410

```javascript
${dirLogo ? `<img src="${dirLogo}" alt="" class="directory-logo" />` : '<div class="directory-logo-placeholder"></div>'}
```

**Purpose:** Visual placeholder when directory has no logo URL.

---

## Potential Issues

### 1. primaryDomain Not User-Scoped

```javascript
// checkout.html line 964
const domain = localStorage.getItem('primaryDomain');
```

If multiple users share a device, this could show wrong domain.

**Fix:** Use `getScopedKey('primaryDomain', userId)`

### 2. User Object Parsing

```javascript
// waitlist.html line 357
const userData = JSON.parse(localStorage.getItem('user') || '{}');
```

If `user` is malformed JSON, this could throw.

**Status:** Using `|| '{}'` fallback is safe.

---

## How-It-Works Page Mockups

**Location:** `frontend/how-it-works.html`

The "how-it-works" page contains visual mockups for marketing purposes:
- `.mockup-container` - Browser window frame
- `.mockup-header` - Window header with red/yellow/green dots
- `.mockup-body` - Content area

These are **visual demos only**, not functional mocks that affect the application.

---

## Blog Placeholder Images

**Location:** `frontend/blog/ai-visibility-score-launch-announcement.html`

Uses `.publication-logo-placeholder` for press logos that don't load.

**Purpose:** Graceful degradation for external image failures.

---

## Summary

| Category | Risk Level | Status |
|----------|------------|--------|
| Mock submission data | ✅ None | No mocks found |
| Mock credential data | ✅ None | No mocks found |
| localStorage scoping | ⚠️ Low | Mostly scoped, except `primaryDomain` |
| API failure fallback | ✅ Safe | Shows empty state, not fake data |
| Visual placeholders | ✅ Safe | Only for missing images |

**Overall:** The frontend does NOT use mock data for the Citation Network feature. All data comes from API calls with proper empty-state fallbacks.
