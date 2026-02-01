# Phase 4A.3c Debug Report: Top 10 Rendering Fix-Forward

**Date:** 2026-02-01
**Branch:** `claude/refine-prompt-safety-2e4d4`

## Problem Statement

Live scan output (scanId 684/685/693/694) shows legacy behavior:
- Only 3 sections render (Finding + Why + How to Implement)
- Recommendation + What to Include sections missing for Top10 keys
- Finding shows generic template text instead of evidence-based finding
- PDFs also show legacy 3-section format

DevTools confirmed actual DB row shape:
- `rec_key`: **null**
- `subfactor_key`: **null**
- `evidence_json`: **null**
- `why_it_matters`: **null** (v2 column exists but never populated)
- `category`: human label like "AI Search Readiness"
- `recommendation_text`: title like "Add FAQ Schema Markup"

## Root Cause Analysis

### Chain of Evidence

Traced the full pipeline: **Renderer → Persistence → DB Row → GET Endpoint → Frontend**

#### 1. Renderer Output (CORRECT)

`backend/recommendations/renderer.js` correctly produces all 5 sections for Top 10 recs.
All 10 Top10 playbook entries confirmed present with all templates.
199 tests pass.

#### 2. Persistence Layer (BUG #1 — keys never stored, fields lost)

`backend/services/scan-recommendations-service.js` → `mapRendererOutputToDb()`:

| Renderer Field | DB Column | What Was Stored | Bug? |
|---------------|-----------|-----------------|------|
| `finding` | `findings` | `rec.evidence_summary` | **YES — evidence_summary overwrites finding** |
| `recommendation` | (none) | Not stored | **YES — dropped entirely** |
| `what_to_include` | (none) | Not stored | **YES — dropped entirely** |
| `rec_key` | `rec_key` | Generated but... | Keys end up null in DB |
| `subfactor_key` | `subfactor_key` | Generated but... | Keys end up null in DB |

**Critical finding:** Even with persistence fixes, **existing rows have null keys**.
Canonical key matching based on `rec_key`/`subfactor_key` will always fail for existing data.

#### 3. GET Endpoint (BUG #2 — no enrichment at all)

`backend/routes/scan.js` → `GET /api/scan/:id`:

- SELECT queries originally excluded v2 columns entirely
- No enrichment logic existed — raw DB rows returned as-is
- Previous fix attempt used canonical key matching, but keys are null in DB → always missed

#### 4. Frontend Mapping (BUG #3 — wrong field precedence)

`frontend/results.js` → `createRecommendationCard()`:

| UI Section | Code | What Rendered | Bug? |
|-----------|------|---------------|------|
| Finding | `rec.findings \|\| rec.finding` | generic template text | **YES — not evidence-based** |
| Why It Matters | `rec.impact_description \|\| ...` | generic template text | **YES — not evidence-based** |
| Recommendation | `rec.recommendation` | Empty (never stored) | **YES — always empty** |
| What to Include | `rec.what_to_include` | Empty (never stored) | **YES — always empty** |

## Solution: GET-Time Legacy Adapter

Since DB rows have null keys, the fix must work at **GET time** using the only reliable
identifier available: the **recommendation title** (`recommendation_text`).

### Architecture

```
GET /api/scan/:id
  ↓
  load scan + recommendations from DB (rows have null keys)
  ↓
  enrichLegacyRecommendations({recommendations, detailedAnalysis, scan, debug})
    ├── for each rec: match title → canonical Top10 key
    │   ├── Strategy 1: Exact title match (33-entry normalized dictionary)
    │   ├── Strategy 2: rec_key/subfactor_key if populated (future-proofing)
    │   └── Strategy 3: Conservative keyword fallback
    ├── for matched recs: call renderSingleTop10(key, evidence, scan)
    │   ├── getPlaybookEntry(key) → playbook templates
    │   ├── getDetectionState(key, evidence) → state-keyed resolution
    │   ├── shouldSuppressRecommendation(state) → skip if COMPLETE
    │   └── resolveTemplate(templates, mergedContext, opts) → 5 sections
    ├── write into LEGACY fields: findings, impact_description, action_steps
    └── write into V2 fields: finding, recommendation, what_to_include, etc.
  ↓
  apply entitlement cap → res.json()
```

### Why Title-Based Matching

- 144 distinct titles audited from production DB
- 33 mapped to 9 of 10 Top10 keys (query_intent_alignment unmapped — no title seen yet)
- Normalized matching handles case/whitespace/punctuation variations
- Keyword fallback catches slight title variations not in dictionary
- Debug mode tracks unmatched titles for dictionary expansion

## Files Changed

| File | Change |
|------|--------|
| `backend/recommendations/legacyTop10Adapter.js` | NEW — title map, key resolution, GET-time enrichment |
| `backend/tests/unit/legacy-top10-adapter.test.js` | NEW — 29 unit tests |
| `backend/routes/scan.js` | Wire adapter into GET endpoint, admin debug |
| `backend/services/scan-recommendations-service.js` | Persistence fixes (finding field, evidence_json embedding) |
| `frontend/results.js` | Field precedence fix for 5-section rendering |
| `backend/recommendations/canonicalKey.js` | Key normalization (used by persistence layer) |
| `backend/tests/unit/canonical-key.test.js` | 18 unit tests for canonical key |

## Test Results

- 344 recommendation-related tests pass (315 existing + 29 new)
- 0 regressions
- 131 Phase 4A.3c evidence-based tests still green

## Verification Checklist

- [ ] Hit scan endpoint with `?debug=1` as admin: Top10 recs show `_debug_renderer_path = top10`
- [ ] Fields present: finding, why_it_matters, recommendation, what_to_include, how_to_implement
- [ ] Legacy fields updated: findings (evidence-based), impact_description, action_steps
- [ ] UI shows improved Finding + Why content immediately (legacy field writes)
- [ ] PDF export (window.print) shows improved content
- [ ] No placeholder leaks (`{{...}}`, `[placeholder]`, `undefined`, `null`)
- [ ] `_debug.unmatched_titles` shows which titles still need mapping
- [ ] Frontend update to render Recommendation + What to Include sections (separate task)

## Non-Changes (preserved)

- Model A behavior (no cooldown) — untouched
- Plan caps / gating — untouched
- Ranking/dedupe/selection logic — untouched
- Existing test assertions — untouched
- No new console.log statements in production paths (error catch only for renderer failures)
