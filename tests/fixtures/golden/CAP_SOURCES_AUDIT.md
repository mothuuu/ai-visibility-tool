# Cap Sources Audit

**Date:** 2026-01-27
**Phase:** 4A.3b (Model A - Dynamic Top-N, No Cooldown)
**Single Source of Truth:** `backend/config/planCaps.js`

## Confirmed Product Contract

| Plan       | Active Cap | Notes                    |
|------------|------------|--------------------------|
| free       | 3          | Verified                 |
| freemium   | 3          | Normalized to free       |
| diy        | 5          | Verified                 |
| starter    | 5          | Alias of diy             |
| pro        | **8**      | Corrected from 10 -> 8   |
| agency     | -1         | Unlimited (sentinel)     |
| enterprise | -1         | Unlimited (sentinel)     |

## All Cap Sources (Post-Reconciliation)

| File | Symbol/Object | Value | Status |
|------|---------------|-------|--------|
| `backend/config/planCaps.js` | `PLAN_CAPS.pro` | 8 | SSOT |
| `backend/services/scanEntitlementService.js` | `getRecommendationVisibleLimit()` | Imports from `planCaps.js` | Aligned |
| `backend/services/scanEntitlementService.js` | `SCAN_ENTITLEMENTS.pro.recs_per_cycle` | 8 | Aligned |
| `backend/services/scanEntitlementService.js` | `SCAN_ENTITLEMENTS.pro.batch_size` | 8 | Aligned |
| `backend/analyzers/recommendation-engine/tier-filter.js` | `TIER_LIMITS.pro.maxRecommendations` | 8 | Aligned |
| `backend/repositories/progressRepository.js` | `PLAN_LIMITS.pro.batch_size` | 8 | Aligned |
| `frontend/results.js` | `tierCaps.pro` | 8 | Aligned |
| `tests/fixtures/golden/fixture_manifest.json` | `plan_caps.pro` | 8 | Aligned |

## Model A Invariants

- `model: "A"` - Dynamic Top-N with no cooldown
- `batch_unlock: false` - No batch unlock UI
- `nextBatchUnlock` always `null` in API response
- Skip/Implement actions refill Active list immediately (page reload)
