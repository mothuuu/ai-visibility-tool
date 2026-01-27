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
| `backend/analyzers/recommendation-engine/tier-filter.js` | DIY→Pro upgrade CTA | "8 active recommendations (vs 5)" | Aligned |

## Model A Invariants

- `model: "A"` - Dynamic Top-N with no cooldown
- `batch_unlock: false` - No batch unlock UI
- `nextBatchUnlock` always `null` in API response
- Skip/Implement actions refill Active list immediately (page reload)

## Golden Fixtures (2026-01-27)

| Fixture ID | Plan | Cap | Returned | Notes |
|------------|------|-----|----------|-------|
| `_sample_template` | free | 3 | 3 | Template fixture |
| `viewer_free_plan` | free | 3 | 3 | Synthetic, Model A |
| `viewer_diy_plan` | diy | 5 | 5 | Synthetic, Model A |
| `viewer_pro_plan` | pro | 8 | 8 | Synthetic, Model A |
| `viewer_agency_plan` | agency | -1 | 12 | Synthetic, unlimited |
| `viewer_enterprise_plan` | enterprise | -1 | 12 | Synthetic, unlimited |
