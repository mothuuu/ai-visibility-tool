# Phase 4A.3 Step 0.0 — Schema Discovery & Audit Notes

**Created:** 2026-01-24
**Phase:** 4A.3 (Recommendation Quality Overhaul)
**Status:** Step 0.0 Complete

---

## 1. Database Schema Summary

### 1.1 `scans` Table

**Location:** `backend/db/migrate-scans.js`

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | Scan identifier |
| `user_id` | INTEGER FK → users(id) | Owner of the scan |
| `url` | TEXT | Scanned URL |
| `status` | VARCHAR(50) | 'pending', 'complete', 'failed' |
| `total_score` | INTEGER | Overall AI visibility score (0-100) |
| `rubric_version` | VARCHAR(10) | Default 'V5' |
| `ai_readability_score` | INTEGER | Category score (0-100) |
| `ai_search_readiness_score` | INTEGER | Category score (0-100) |
| `content_freshness_score` | INTEGER | Category score (0-100) |
| `content_structure_score` | INTEGER | Category score (0-100) |
| `speed_ux_score` | INTEGER | Category score (0-100) |
| `technical_setup_score` | INTEGER | Category score (0-100) |
| `trust_authority_score` | INTEGER | Category score (0-100) |
| `voice_optimization_score` | INTEGER | Category score (0-100) |
| `industry` | VARCHAR(100) | Detected industry |
| `page_count` | INTEGER | Number of pages analyzed |
| `pages_analyzed` | JSONB | Page-level data |
| `detailed_analysis` | JSONB | Full analysis results |
| `recommendations` | JSONB | Legacy: inline recommendations |
| `created_at` | TIMESTAMP | Scan creation time |
| `completed_at` | TIMESTAMP | Scan completion time |

**Notes:**
- `detailed_analysis` contains the rubric result with category/subfactor scores
- `recommendations` is legacy JSONB; current recommendations are in `scan_recommendations` table
- `domain` field may exist (added later) for domain grouping

### 1.2 `scan_recommendations` Table

**Location:** `backend/db/migrate-scans.js`, `backend/db/migrate-recommendation-delivery-system.js`

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | Recommendation identifier |
| `scan_id` | INTEGER FK → scans(id) | Parent scan |
| `category` | VARCHAR(100) | Pillar/category (legacy) |
| `pillar_key` | VARCHAR(100) | Canonical pillar key |
| `recommendation_text` | TEXT | Recommendation content |
| `priority` | VARCHAR(20) | 'high', 'medium', 'low' |
| `estimated_impact` | INTEGER | Impact score |
| `estimated_effort` | VARCHAR(20) | Effort estimate |
| `status` | VARCHAR(50) | 'active', 'implemented', 'skipped' |
| `unlock_state` | VARCHAR(50) | 'locked', 'active', 'implemented', 'skipped', 'dismissed' |
| `batch_number` | INTEGER | Surfacing batch number |
| `surfaced_at` | TIMESTAMP | When recommendation became active (canonical) |
| `unlocked_at` | TIMESTAMP | Legacy: when unlocked |
| `implemented_at` | TIMESTAMP | When marked implemented (canonical) |
| `marked_complete_at` | TIMESTAMP | Legacy: when marked complete |
| `skip_available_at` | TIMESTAMP | When skip becomes available (canonical) |
| `skip_enabled_at` | TIMESTAMP | Legacy: when skip enabled |
| `skipped_at` | TIMESTAMP | When skipped |
| `impact_score` | DECIMAL | Computed impact score |
| `recommendation_mode` | VARCHAR(50) | 'optimization' or 'elite' |

**Additional columns from delivery system migration:**
- `implementation_progress`, `previous_findings`, `is_partial_implementation`
- `validation_status`, `validation_errors`, `last_validated_at`
- `affected_pages`, `pages_implemented`

### 1.3 `users` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | User identifier |
| `email` | VARCHAR | User email (PII - do not expose) |
| `organization_id` | INTEGER FK → organizations(id) | User's org |
| `plan` | VARCHAR | User-level plan (legacy) |
| `stripe_customer_id` | VARCHAR | Stripe customer |
| `stripe_subscription_id` | VARCHAR | Stripe subscription |
| `stripe_subscription_status` | VARCHAR | 'active', 'canceled', etc. |
| `stripe_price_id` | VARCHAR | Stripe price ID |
| `stripe_current_period_start` | TIMESTAMP | Billing period start |
| `stripe_current_period_end` | TIMESTAMP | Billing period end |

### 1.4 `organizations` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | Org identifier |
| `name` | VARCHAR | Org name |
| `plan` | VARCHAR | Fallback plan |
| `plan_source` | VARCHAR | 'manual' or 'stripe' |
| `plan_override` | VARCHAR | Manual override value |
| `plan_override_set_at` | TIMESTAMP | When override was set |
| `plan_override_set_by` | INTEGER | Admin who set it |
| `plan_override_reason` | TEXT | Reason for override |
| `stripe_customer_id` | VARCHAR | Stripe customer |
| `stripe_subscription_id` | VARCHAR | Stripe subscription |
| `stripe_subscription_status` | VARCHAR | Subscription status |
| `stripe_price_id` | VARCHAR | Price ID for plan mapping |
| `stripe_current_period_start` | TIMESTAMP | Period start |
| `stripe_current_period_end` | TIMESTAMP | Period end |

---

## 2. Evidence Structure (Contract v2.0)

**Location:** `backend/recommendations/__fixtures__/sampleScanEvidence.json`

The evidence contract contains:

```
{
  "contractVersion": "2.0.0",
  "url": "https://...",
  "timestamp": "...",

  "metadata": { title, description, keywords, ogTitle, ogDescription, ... },
  "content": { headings, paragraphs, bodyText, wordCount, lists, tables, faqs },
  "structure": { hasMain, hasArticle, headingCount, headingHierarchy, ... },
  "navigation": { keyPages, allNavLinks, hasSemanticNav, headerLinks, ... },
  "media": { images, imageCount, imagesWithAlt, videos, ... },
  "technical": { structuredData, hasOrganizationSchema, hasFAQSchema, ... },
  "performance": { ttfb, responseTime, contentLength, ... },
  "accessibility": { ariaLabels, imagesWithAlt, hasLangAttribute, ... },
  "entities": { entities, metrics, knowledgeGraph },
  "crawler": { discoveredSections, robotsTxt, sitemap },
  "siteMetrics": { totalDiscoveredUrls, sitemap }
}
```

**FAQ Evidence Fields:**
- `content.faqs` — Array of FAQ objects (if detected)
- `technical.hasFAQSchema` — Boolean: true if FAQPage schema found
- `crawler.discoveredSections.hasFaqUrl` — Boolean: true if /faq page found
- `siteMetrics.sitemap.hasFaqUrls` — Boolean: true if FAQ URLs in sitemap

---

## 3. Plan Entitlement System

### 3.1 Plan Resolution (planService.js)

**Precedence Order (Option A):**
1. Manual override: `org.plan_source='manual' AND org.plan_override` set
2. Stripe: `org.stripe_subscription_status` active/trialing AND `stripe_price_id` maps to plan
3. Fallback: `org.plan` column
4. Last resort: `user.plan` if org missing

### 3.2 Recommendation Visibility Caps (scanEntitlementService.js)

| Plan | Cap | Notes |
|------|-----|-------|
| `free` | 3 | Default for unauthenticated/unknown |
| `freemium` | 3 | Normalized to 'free' |
| `diy` | 5 | Starter tier |
| `starter` | 5 | Alias for DIY |
| `pro` | 10 | Professional tier |
| `agency` | -1 | Unlimited |
| `enterprise` | -1 | Unlimited |

**CRITICAL:** Entitlements are based on the **viewer's** effective plan (the authenticated user making the request), NOT the scan owner's plan.

### 3.3 Plan Aliases

The system normalizes various plan names:
- `plan_gold`, `tier_gold`, `gold` → `pro`
- `plan_platinum`, `tier_platinum`, `platinum` → `enterprise`
- `plan_silver`, `tier_silver`, `silver` → `diy`
- `plan_bronze`, `tier_bronze`, `bronze` → `free`
- `starter`, `basic` → `diy`
- `professional`, `business` → `pro` / `enterprise`

---

## 4. Recommendation Pipeline

### 4.1 Pipeline Flow

1. **Extraction** — `extractFailingSubfactors()` from rubricResult
2. **Mapping** — `getPlaybookEntry()` for each subfactor
3. **Sorting** — By priority (P0 > P1 > P2) and impact
4. **Evidence Assessment** — `assessEvidenceQuality()` returns STRONG/MEDIUM/WEAK/AMBIGUOUS
5. **Noise Filtering** — `shouldSkipRecommendation()` for weak evidence
6. **Template Resolution** — `resolvePlaceholders()` fills templates
7. **Generation Hooks** — `executeHook()` for automation_level='generate'
8. **Deduplication** — By `dedup_key` or `cluster_id`
9. **Entitlement Gating** — Cap based on viewer's plan

### 4.2 Current Known Issue (Bug #8)

The current pipeline returns 8 recommendations to free-tier users instead of 3. This is the bug we're fixing in Phase 4A.3.

**Root cause (hypothesis):**
- Entitlement cap may be applied incorrectly or inconsistently
- May be checking wrong user/plan context
- Step 0.0 fixtures will capture this baseline for regression testing

### 4.3 Pipeline Stage Counts

In Step 0.0, we cannot capture all pipeline stage counts without modifying code. The following are available:

| Stage | Available in Step 0.0? | Source |
|-------|------------------------|--------|
| `total_candidates` | YES | COUNT(*) from scan_recommendations WHERE scan_id=X |
| `after_ranking` | NO | Would require pipeline instrumentation |
| `after_dedupe` | NO | Would require pipeline instrumentation |
| `after_gating` | NO | Would require pipeline instrumentation |
| `returned` | YES | Length of API response array |

---

## 5. API Endpoints

### 5.1 Primary Recommendation Endpoint

**Route:** `GET /api/recommendations/scan/:scanId`

**Location:** `backend/routes/recommendations.js:364-433`

**Flow:**
1. Authenticate user via `authenticateToken` middleware
2. Verify scan ownership via `scans.user_id = req.user.id`
3. Resolve user's plan via `resolvePlanForRequest({ userId, orgId: null })`
4. Get visibility cap via `getRecommendationVisibleLimit(plan)`
5. Query recommendations with COALESCE for canonical fields
6. Apply entitlement cap: `slice(0, visibleLimit)`
7. Return capped recommendations

**Entitlement Cap Application (lines 406-410):**
```javascript
if (recommendationVisibleLimit !== -1 && cappedRecommendations.length > recommendationVisibleLimit) {
  console.log(`Capping recommendations: ${cappedRecommendations.length} → ${recommendationVisibleLimit} (plan: ${planResolution.plan})`);
  cappedRecommendations = cappedRecommendations.slice(0, recommendationVisibleLimit);
}
```

---

## 6. Fixture Selection Criteria

### 6.1 Required Coverage

| Scenario | Priority | Rationale |
|----------|----------|-----------|
| Free plan viewer | HIGH | Most common, validates cap=3 |
| DIY plan viewer | HIGH | Validates cap=5 |
| Pro plan viewer | MEDIUM | Validates cap=10 |
| Enterprise viewer | MEDIUM | Validates unlimited |
| Multi-issue site | HIGH | Tests prioritization |
| No FAQs detected | MEDIUM | Evidence state coverage |
| FAQ content, no schema | MEDIUM | Evidence state coverage |
| Org with manual override | MEDIUM | Tests plan precedence |
| Minimal evidence | LOW | Edge case |

### 6.2 Candidate Selection Queries

See scripts in `scripts/fixtures/` for query implementations.

---

## 7. Open Questions for Phase 4A.3

1. **Where exactly is the bug?** — Is the cap not being applied, or is plan resolution wrong?
2. **Context reuse behavior** — Does `source_scan_id` affect entitlement incorrectly?
3. **Pipeline stage visibility** — Can we add non-invasive logging later?

---

## 8. Files Modified in Step 0.0

**Created (read-only, no pipeline changes):**
- `tests/fixtures/golden/README.md`
- `tests/fixtures/golden/STEP_0_AUDIT_NOTES.md`
- `tests/fixtures/golden/fixture_manifest.json`
- `tests/fixtures/golden/<fixture_id>/metadata.json`
- `tests/fixtures/golden/<fixture_id>/api_response.json`
- `tests/fixtures/golden/<fixture_id>/invariants.json`
- `tests/fixtures/golden/<fixture_id>/pipeline_counts.json`
- `scripts/fixtures/capture-fixture.js`
- `scripts/fixtures/validate-fixtures.js`

**NOT modified:**
- Any recommendation pipeline code
- Any entitlement logic
- Any API route handlers
