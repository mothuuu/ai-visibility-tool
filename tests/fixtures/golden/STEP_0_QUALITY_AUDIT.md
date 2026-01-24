# Phase 4A.3 Step 0 — Recommendation Quality Audit (READ-ONLY)

**Date:** 2026-01-24
**Phase:** 4A.3 (Recommendation Quality Overhaul)
**Status:** Audit Complete

---

## Executive Summary

### What's Working

1. **Entitlement gating is correct** — Viewer-based caps enforced properly (Free=3, DIY=5, Pro=10, Enterprise=unlimited)
2. **Evidence gating infrastructure exists** — `evidenceGating.js` assesses quality with STRONG/MEDIUM/WEAK/AMBIGUOUS states
3. **34 playbook templates fully populated** — All have `why_it_matters_template`, `action_items_template`, `examples_template`
4. **3 generation hooks working** — Organization schema, FAQ schema, OG tags auto-generation
5. **FAQ false-positive detection** — 14 regex patterns catch navigation menu toggles
6. **Plan-based feature gating** — Code snippets hidden for free tier, FAQs for DIY+ only

### What's Broken/Missing

| Issue | Severity | Root Cause | Likely Fix Location |
|-------|----------|------------|---------------------|
| **Missing "recommendation" section** | CRITICAL | No field generated; UI shows finding + why_it_matters only | `renderer.js`, `subfactorPlaybookMap.js` |
| **Unresolved placeholders in output** | HIGH | Fallback returns `[placeholder_name]` instead of error | `renderer.js:272` |
| **No formal detection_state lifecycle** | MEDIUM | Evidence quality used instead of NOT_FOUND/CONTENT_NO_SCHEMA/COMPLETE | `evidenceGating.js` |
| **Phase 4A vs Hybrid system overlap** | MEDIUM | Two separate rec systems write to same table | `recommendation-generator.js`, `rec-generator.js` |
| **Confidence threshold not enforced** | LOW | Confidence calculated but not gating recommendations | `evidenceGating.js:329` |

---

## Step 0.2: Database State Audit

### Schema: `scan_recommendations` Table

Key fields from migrations:

| Field | Type | Purpose | Populated? |
|-------|------|---------|------------|
| `rec_key` | VARCHAR | Unique identifier | YES (upsert key) |
| `pillar` | VARCHAR | Category pillar | YES |
| `subfactor_key` | VARCHAR | Template key | YES |
| `title` | TEXT | Display title | YES |
| `finding` | TEXT | What was detected | YES |
| `why_it_matters` | TEXT | Impact explanation | YES |
| `recommendation` | TEXT | What to do | **UNCLEAR** |
| `action_steps` | JSONB | Implementation steps | YES |
| `generated_assets` | JSONB | Auto-generated content | CONDITIONAL |
| `evidence_json` | JSONB | Detection evidence | YES |
| `confidence` | DECIMAL | Evidence confidence | YES |
| `evidence_quality` | VARCHAR | STRONG/MEDIUM/WEAK/AMBIGUOUS | YES |
| `automation_level` | VARCHAR | generate/draft/guide/manual | YES |

### Key Finding

The `recommendation` field exists in schema but the renderer produces:
- `gap` (from `playbook_gap`)
- `why_it_matters` (from template)
- `action_items` (from template)
- `examples` (from template)

**No explicit `recommendation` field is generated** — the UI displays `finding` + `why_it_matters` as the "recommendation."

---

## Step 0.3: Renderer Output Audit

### Location

`backend/recommendations/renderer.js` (728 lines)

### Key Function: `renderRecommendations()`

**Lines 412-607**

```
Input: { scan, rubricResult, scanEvidence, context }
Output: Array of recommendation objects
```

### Pipeline Flow

1. **Extract failing subfactors** (Lines 420-423)
   - Calls `extractFailingSubfactors(rubricResult)`
   - Score threshold: 70 (below triggers recommendation)

2. **Map to playbook** (Lines 432-441)
   - Calls `getPlaybookEntry(subfactorKey, category)`
   - Falls back to generic template if not found

3. **Sort by priority/impact** (Line 444)
   - P0=100, P1=50, P2=25 weights
   - Impact: High=40, Med-High=30, Med=20, Low-Med=10

4. **Build placeholder context** (Line 447)
   - Extracts company_name, site_url, industry from evidence

5. **For each subfactor** (Lines 450-604):
   - Assess evidence quality
   - Check skip conditions
   - Resolve placeholders in templates
   - Build evidence JSON
   - Execute generation hooks if applicable

### Placeholder Resolution

**Location:** Lines 256-277

```javascript
// Pattern: {{placeholder}}
// Fallback: Returns [placeholder_name] if unresolved
```

**Issue:** Unresolved placeholders appear in output as `[company_name]` instead of being caught.

### Output Fields Generated

| Field | Source | Template? |
|-------|--------|-----------|
| `gap` | `playbookEntry.playbook_gap` | Static |
| `why_it_matters` | `playbookEntry.why_it_matters_template` | YES |
| `action_items` | `playbookEntry.action_items_template` | YES |
| `examples` | `playbookEntry.examples_template` | YES |
| `generated_assets` | Generation hooks output | Conditional |
| `evidence_json` | Built from selectors | Computed |

**Missing: Explicit `recommendation` or `what_to_do` field**

---

## Step 0.4: Playbook Map Inventory

### Location

`backend/recommendations/subfactorPlaybookMap.js` (917 lines)

### Template Count: 34 Entries

| Pillar | Weight | Templates | Key Subfactors |
|--------|--------|-----------|----------------|
| Technical Setup | 18% | 6 | organization_schema, structured_data_coverage, sitemap_indexing, social_meta_tags, canonical_hreflang, crawler_access |
| AI Search Readiness | 20% | 5 | icp_faqs, query_intent_alignment, evidence_proof_points, pillar_pages, scannability |
| Trust & Authority | 12% | 4 | author_bios, professional_certifications, third_party_profiles, thought_leadership |
| AI Readability | 10% | 2 | alt_text_coverage, media_accessibility |
| Content Structure | 15% | 3 | semantic_heading_structure, navigation_clarity, entity_cues |
| Voice Optimization | 12% | 2 | conversational_content, local_intent |
| Content Freshness | 8% | 1 | last_updated |
| Speed & UX | 5% | 1 | performance |

### PlaybookEntry Schema

```javascript
{
  playbook_category: string,        // Display name
  playbook_gap: string,             // Human-readable gap
  priority: 'P0'|'P1'|'P2',
  effort: 'S'|'S-M'|'M'|'M-L'|'L',
  impact: 'High'|'Med-High'|'Med'|'Low-Med',
  automation_level: 'generate'|'draft'|'guide'|'manual',
  generator_hook_key?: string,
  why_it_matters_template: string,
  action_items_template: string[],
  examples_template: string[],
  evidence_selectors: string[]
}
```

### Template Completeness

All 34 entries have:
- `playbook_gap`
- `why_it_matters_template`
- `action_items_template`
- `examples_template`
- `evidence_selectors`

### Common Placeholders Used

| Placeholder | Usage | Source |
|-------------|-------|--------|
| `{{company_name}}` | 28 templates | Evidence metadata |
| `{{industry}}` | 15 templates | Context |
| `{{site_url}}` | 12 templates | Scan URL |
| `{{icp_roles}}` | 8 templates | Context |
| `{{total_images}}` | 2 templates | Evidence metrics |
| `{{schema_count}}` | 3 templates | Evidence metrics |

---

## Step 0.5: Generation Hooks Audit

### Location

`backend/recommendations/generationHooks.js` (710 lines)

### Registry: 3 Production Hooks

| Hook Key | Function | Output Asset Type | When Invoked |
|----------|----------|-------------------|--------------|
| `technical_setup.organization_schema` | `generateOrganizationSchema()` | `jsonld.organization` | When org schema missing |
| `ai_search_readiness.icp_faqs` | `generateICPFaqs()` | `jsonld.faqpage` | When FAQ schema missing + industry context |
| `technical_setup.social_meta_tags` | `generateOpenGraphTags()` | `meta.opengraph` | When OG tags incomplete |

### Hook A: Organization Schema (Lines 301-369)

**Inputs:** scanEvidence, context

**Generation Logic:**
1. Infer company name (from schema, metadata, H1, or domain)
2. Infer logo URL (from Organization schema or OG image)
3. Extract social links from entities
4. Build Organization, WebSite, WebPage schemas

**Output:**
```javascript
{
  asset_type: 'jsonld.organization',
  content: { /* JSON-LD schema */ },
  implementation_notes: string[]
}
```

### Hook B: ICP FAQs (Lines 378-534)

**Inputs:** scanEvidence, context (industry, icp_roles)

**Generation Logic:**
1. Load industry-specific FAQ library (or fallback)
2. Template replacement from context
3. Generate up to 10 FAQs with deduplication
4. Build FAQPage JSON-LD

**Output:**
```javascript
{
  asset_type: 'jsonld.faqpage',
  content: {
    faqs: [{question, answer, category}],
    jsonLd: /* FAQPage schema */
  },
  implementation_notes: string[]
}
```

### Hook C: Open Graph Tags (Lines 543-622)

**Inputs:** scanEvidence, context

**Generation Logic:**
1. Infer page title, description, image
2. Generate OG + Twitter meta tags
3. Produce HTML snippet

**Output:**
```javascript
{
  asset_type: 'meta.opengraph',
  content: {
    metaTags: {openGraph, twitter},
    htmlSnippet: string
  },
  implementation_notes: string[]
}
```

---

## Step 0.6: Evidence Structure Audit

### Location

`scans.detailed_analysis` JSONB column

### Contract v2.0 Structure

```
{
  contractVersion: "2.0.0",
  url: string,
  timestamp: string,

  metadata: {
    title, description, keywords,
    ogTitle, ogDescription, ogImage,
    twitterCard, twitterTitle
  },

  content: {
    headings: [...],
    paragraphs: [...],
    bodyText: string,
    wordCount: number,
    lists: [...],
    tables: [...],
    faqs: [...]         // FAQ content if detected
  },

  structure: {
    hasMain: boolean,
    hasArticle: boolean,
    headingCount: number,
    headingHierarchy: [...]
  },

  technical: {
    structuredData: [...],
    hasOrganizationSchema: boolean,
    hasFAQSchema: boolean,        // FAQ schema detection
    hasArticleSchema: boolean
  },

  crawler: {
    discoveredSections: {
      hasFaqUrl: boolean          // /faq page found
    },
    robotsTxt: {...},
    sitemap: {...}
  },

  siteMetrics: {
    totalDiscoveredUrls: number,
    sitemap: {
      hasFaqUrls: boolean         // FAQ URLs in sitemap
    }
  }
}
```

### FAQ Evidence Paths

| Path | Description |
|------|-------------|
| `content.faqs` | Extracted FAQ content |
| `technical.hasFAQSchema` | FAQPage schema present |
| `crawler.discoveredSections.hasFaqUrl` | /faq page discovered |
| `siteMetrics.sitemap.hasFaqUrls` | FAQ URLs in sitemap |

---

## Step 0.7: Detection State Mapping Audit

### Current Implementation

Evidence quality used instead of formal detection states:

| Quality | Confidence | Meaning |
|---------|------------|---------|
| STRONG | 0.85 | High-confidence detection |
| MEDIUM | 0.60 | Moderate evidence |
| WEAK | 0.40 | Low evidence |
| AMBIGUOUS | 0.35 | Conflicting signals |

### Expected Detection States (Not Implemented)

| State | When | Example |
|-------|------|---------|
| `NOT_FOUND` | Feature absent | No FAQ content or schema |
| `CONTENT_NO_SCHEMA` | Content exists, no markup | FAQ text but no FAQPage schema |
| `SCHEMA_INVALID` | Markup exists but broken | Malformed JSON-LD |
| `COMPLETE` | Fully implemented | FAQ content + valid FAQPage schema |

### Gap

No `detection_state` enum defined in code. The renderer uses `evidence_quality` instead, which doesn't capture the specific state transitions needed for smart recommendations.

---

## Step 0.9: Pipeline Trace — `faq_schema` End-to-End

### 1. Detection

**File:** `backend/analyzers/v5-enhanced-rubric-engine.js`

- Checks `scanEvidence.technical.hasFAQSchema`
- Scores subfactor `ai_search_readiness.icp_faqs`

### 2. Candidate Creation

**File:** `backend/recommendations/renderer.js:420-423`

```javascript
const failingSubfactors = extractFailingSubfactors(rubricResult);
// Returns subfactors with score < 70
```

### 3. Evidence Assembly

**File:** `backend/recommendations/renderer.js:520-524`

```javascript
const evidenceJson = buildEvidenceJson(playbookEntry, scanEvidence, context);
// Extracts paths from evidence_selectors
```

### 4. Template Selection

**File:** `backend/recommendations/subfactorPlaybookMap.js:154-180`

```javascript
// Entry for ai_search_readiness.icp_faqs
{
  playbook_gap: "No FAQ or Q&A content optimized for AI search...",
  why_it_matters_template: "AI systems like ChatGPT...",
  action_items_template: [...],
  generator_hook_key: 'ai_search_readiness.icp_faqs'
}
```

### 5. Placeholder Resolution

**File:** `backend/recommendations/renderer.js:503-506`

```javascript
const whyItMatters = resolvePlaceholders(entry.why_it_matters_template, context);
const actionItems = resolvePlaceholdersInArray(entry.action_items_template, context);
```

### 6. Generation Hook Execution

**File:** `backend/recommendations/renderer.js:549-591`

```javascript
if (playbookEntry.automation_level === 'generate' && hookKey) {
  const generated = await executeHook(hookKey, scanEvidence, context);
  // Attaches generated FAQs + JSON-LD to recommendation
}
```

### 7. Final Output

| Field | Value |
|-------|-------|
| `gap` | "No FAQ or Q&A content..." |
| `why_it_matters` | "AI systems like ChatGPT..." (resolved) |
| `action_items` | [...] (resolved) |
| `generated_assets` | `{faqs, jsonLd}` |
| `evidence_json` | `{hasFAQSchema, faqs, ...}` |

---

## Step 0.10: Frontend Display Audit

### Location

`frontend/results.js` (1000+ lines)

### Recommendation Card Fields Displayed

**Lines 870-969**

| UI Element | Source Field | Fallback |
|------------|--------------|----------|
| Title | `recommendation_text` | `title` |
| Finding | `findings` | `finding` |
| Why It Matters | `impact_description` | `impact` |
| Action Steps | `action_steps` | `actionSteps` |
| Code Snippet | `code_snippet` | (hidden for free) |
| Customized Implementation | `customized_implementation` | (DIY+ only) |
| Ready-to-Use Content | `ready_to_use_content` | (DIY+ only) |

### Key Observation

**There is no "Recommendation" or "What to Do" section displayed.**

The UI shows:
1. Finding (what's wrong)
2. Why It Matters (impact)
3. How to Implement (action steps)

The "recommendation" section mentioned in the prompt spec does not exist in either:
- The renderer output
- The frontend display

---

## Safety Check: Fixture PII Scan

### Scan Results

```bash
grep -rE "email|Bearer|phone" tests/fixtures/golden/ --include="*.json"
# Result: No unredacted PII patterns found
```

All fixtures pass PII validation.

---

## Root Causes Summary

### Issue 1: Missing "Recommendation" Section

**Root Cause:** The playbook templates have `why_it_matters_template` and `action_items_template` but no `recommendation_template` or `what_to_do_template`.

**Files to Change:**
- `backend/recommendations/subfactorPlaybookMap.js` — Add template field
- `backend/recommendations/renderer.js` — Generate field from template
- `frontend/results.js` — Display the new field

### Issue 2: Unresolved Placeholders

**Root Cause:** `resolvePlaceholders()` returns `[placeholder_name]` as fallback instead of throwing or logging error.

**File:** `backend/recommendations/renderer.js:272`

**Fix:** Add validation step after resolution to flag unresolved placeholders.

### Issue 3: No Detection State Lifecycle

**Root Cause:** Evidence gating uses quality levels (STRONG/MEDIUM/WEAK) instead of semantic states (NOT_FOUND/CONTENT_NO_SCHEMA/COMPLETE).

**File:** `backend/recommendations/evidenceGating.js`

**Fix:** Add `determineDetectionState()` function that maps evidence to semantic states.

### Issue 4: Dual Recommendation Systems

**Root Cause:** `recommendation-generator.js` (Phase 4A) and `rec-generator.js` (Hybrid) both exist and may conflict.

**Files:**
- `backend/analyzers/recommendation-generator.js`
- `backend/analyzers/rec-generator.js`

**Fix:** Consolidate or clearly route between systems.

---

## Recommendations for Phase 4A.3 Implementation

1. **Add `recommendation_template` to playbook entries** — Explicit "what to do" text
2. **Add placeholder validation** — Fail or warn if unresolved after resolution
3. **Add detection_state field** — Map evidence to semantic states
4. **Consolidate recommendation systems** — Single source of truth
5. **Add confidence threshold gating** — Skip recommendations below threshold

---

## Files Likely to Change in Phase 4A.3

| File | Change Type |
|------|-------------|
| `backend/recommendations/subfactorPlaybookMap.js` | Add recommendation_template |
| `backend/recommendations/renderer.js` | Generate recommendation field, validate placeholders |
| `backend/recommendations/evidenceGating.js` | Add detection_state logic |
| `frontend/results.js` | Display recommendation section |
| `backend/analyzers/recommendation-generator.js` | Integrate detection_state |
