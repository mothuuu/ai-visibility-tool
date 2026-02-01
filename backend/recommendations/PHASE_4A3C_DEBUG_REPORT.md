# Phase 4A.3c Debug Report: Top 10 Rendering Fix-Forward

**Date:** 2026-02-01
**Branch:** `claude/refine-prompt-safety-2e4d4`

## Problem Statement

Live scan output (scanId 684/685) shows legacy behavior:
- Only 3 sections render (Finding + Why + How to Implement)
- Recommendation + What to Include sections missing for Top10 keys
- Finding shows generic `evidence_summary` instead of evidence-based finding
- PDFs also show legacy 3-section format

## Root Cause Analysis

### Chain of Evidence

Traced the full pipeline: **Renderer → Persistence → GET Endpoint → Frontend**

#### 1. Renderer Output (CORRECT)

`backend/recommendations/renderer.js` correctly produces all 5 sections for Top 10 recs:

| Field | Source | Status |
|-------|--------|--------|
| `finding` | State-keyed `finding_templates` | Produced correctly |
| `why_it_matters` | `why_it_matters_template` | Produced correctly |
| `recommendation` | State-keyed `recommendation_template` | Produced correctly |
| `what_to_include` | `what_to_include_template` | Produced correctly |
| `action_items` / `how_to_implement` | `action_items_template` | Produced correctly |

#### 2. Persistence Layer (BUG #1 — fields lost)

`backend/services/scan-recommendations-service.js` → `mapRendererOutputToDb()`:

| Renderer Field | DB Column | What Was Stored | Bug? |
|---------------|-----------|-----------------|------|
| `finding` | `findings` | `rec.evidence_summary` | **YES — evidence_summary overwrites finding** |
| `why_it_matters` | `why_it_matters` | `rec.why_it_matters` | OK (v2 column) |
| `recommendation` | (none) | Not stored | **YES — dropped entirely** |
| `what_to_include` | (none) | Not stored | **YES — dropped entirely** |
| `action_items` | `action_steps` | JSON string | OK |

**Root cause:** `mapRendererOutputToDb()` line 265 maps `findings: rec.evidence_summary` instead of `rec.finding`. The `recommendation` and `what_to_include` fields have no corresponding DB columns and were silently dropped.

#### 3. GET Endpoint (BUG #2 — fields not selected)

`backend/routes/scan.js` → `GET /api/scan/:id`:

- SELECT queries did not include v2 columns: `subfactor_key`, `rec_key`, `why_it_matters`, `evidence_json`, `confidence`, `evidence_quality`, `engine_version`
- Even if persistence was correct, the API response would not include the new fields

#### 4. Frontend Mapping (BUG #3 — wrong field precedence)

`frontend/results.js` → `createRecommendationCard()`:

| UI Section | Code | What Rendered | Bug? |
|-----------|------|---------------|------|
| Finding | `rec.findings \|\| rec.finding` | `evidence_summary` (not finding) | **YES — wrong source** |
| Why It Matters | `rec.impact_description \|\| rec.impact \|\| rec.why_it_matters` | `why_it_matters` (via impact_description) | OK (but indirect) |
| Recommendation | `rec.recommendation` | Empty (never stored) | **YES — always empty** |
| What to Include | `rec.what_to_include` | Empty (never stored) | **YES — always empty** |
| How to Implement | `rec.action_steps \|\| ...` | action_items JSON string | Partially OK |

#### 5. PDF Export Path

PDF export uses `window.print()` — renders whatever the HTML shows. No separate PDF generation path. Fixing the HTML rendering fixes PDF.

## Fixes Applied

### Fix 1: Persistence — Store Phase 4A.3c fields in evidence_json

In `mapRendererOutputToDb()`:
- `findings` now maps to `rec.finding || rec.evidence_summary` (Top10 finding wins)
- Added `buildEvidenceJsonWithPhase4a3c()` that embeds `finding`, `recommendation`, `what_to_include`, `how_to_implement` inside `evidence_json.phase4a3c` for Top 10 recs

### Fix 2: GET Endpoint — SELECT v2 columns + enrich response

- Both SELECT queries now include: `subfactor_key`, `rec_key`, `why_it_matters`, `evidence_json`, `confidence`, `evidence_quality`, `engine_version`
- Added enrichment loop that extracts `phase4a3c` fields from `evidence_json` and merges into response
- Top 10 fields take precedence over legacy fields

### Fix 3: Admin-Gated Debug Mode

- `?debug=1` query param + admin role → `_debug` payload in response
- Per-rec debug: `_debug_renderer_path`, `_debug_canonical_key`, `_debug_is_top10`
- No console.log in prod; only response enrichment when gated

### Fix 4: Canonical Key Normalization

- `backend/recommendations/canonicalKey.js` with `getCanonicalKey(rec)` and `isTop10(rec)`
- 4 matching rules: exact subfactor_key → rec_key base → constructed pillar.suffix → unique suffix
- Unit tests covering all rules + negatives

### Fix 5: Frontend Field Precedence

- `finding` now: `rec.finding || rec.findings` (enriched field first)
- `impact` now: `rec.why_it_matters || rec.impact_description || rec.impact` (v2 first)
- `actionSteps` now safely parses JSON strings from `action_steps`

## Files Changed

| File | Change |
|------|--------|
| `backend/recommendations/canonicalKey.js` | NEW — canonical key normalization |
| `backend/tests/unit/canonical-key.test.js` | NEW — unit tests for canonical key |
| `backend/services/scan-recommendations-service.js` | Fix persistence mapping + embed phase4a3c in evidence_json |
| `backend/routes/scan.js` | Add v2 SELECT columns, enrichment loop, admin debug mode |
| `frontend/results.js` | Fix field precedence for 5-section rendering |
| `backend/recommendations/PHASE_4A3C_DEBUG_REPORT.md` | This report |

## Verification Checklist

- [ ] Hit scan endpoint with `?debug=1` as admin: Top10 recs show `renderer_path = top10`
- [ ] Fields present: finding, why_it_matters, recommendation, what_to_include, how_to_implement
- [ ] UI shows 5 sections for Top10 recs
- [ ] Finding and Why are distinct and in correct UI blocks
- [ ] PDF export (window.print) shows 5 sections
- [ ] No placeholder leaks (`{{...}}`, `[placeholder]`, `undefined`, `null`)
- [ ] `npm test` passes
- [ ] `node scripts/fixtures/validate-fixtures.js` passes

## Non-Changes (preserved)

- Model A behavior (no cooldown) — untouched
- Plan caps / gating — untouched
- Ranking/dedupe/selection logic — untouched
- Existing test assertions — untouched
- No new console.log statements in production paths
