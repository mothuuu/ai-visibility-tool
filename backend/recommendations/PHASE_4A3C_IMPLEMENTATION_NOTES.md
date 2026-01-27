# Phase 4A.3c Implementation Notes

## Key Files

| File | Purpose |
|------|---------|
| `backend/recommendations/subfactorPlaybookMap.js` | Playbook map (updated: Top 10 entries now have `finding_templates`, `recommendation_template`, `what_to_include_template`) |
| `backend/recommendations/renderer.js` | Main renderer (updated: 5-section output for Top 10, strict placeholder resolver, detection state gating) |
| `backend/recommendations/placeholderResolver.js` | **NEW** — Strict placeholder resolver with zero-leak guarantee |
| `backend/recommendations/evidenceHelpers.js` | **NEW** — Safe accessor utilities for scan evidence / detailed_analysis |
| `backend/recommendations/detectionStates.top10.js` | **NEW** — Semantic detection states for Top 10 subfactors |
| `backend/recommendations/topSubfactors.phase4a3c.json` | **NEW** — Top 10 subfactor list (by priority * impact) |
| `frontend/results.js` | Frontend card rendering (updated: displays Recommendation + What to Include sections) |
| `backend/tests/unit/phase-4a3c-evidence-recs.test.js` | **NEW** — 131 tests for Phase 4A.3c |

## Top 10 Subfactors

1. `technical_setup.organization_schema` (P0 High)
2. `technical_setup.structured_data_coverage` (P0 High)
3. `technical_setup.sitemap_indexing` (P0 High)
4. `technical_setup.crawler_access` (P0 High)
5. `ai_search_readiness.icp_faqs` (P0 High)
6. `ai_search_readiness.query_intent_alignment` (P1 High)
7. `technical_setup.social_meta_tags` (P1 Med-High)
8. `ai_search_readiness.evidence_proof_points` (P1 Med-High)
9. `trust_authority.author_bios` (P1 Med-High)
10. `ai_readability.alt_text_coverage` (P1 Med-High)

## 5-Section Output (Top 10 only)

1. **finding** — Evidence-based description of what was detected (state-keyed)
2. **why_it_matters** — Business impact explanation
3. **recommendation** — Actionable recommendation text (state-keyed) — **NEW**
4. **what_to_include** — What to include in the fix — **NEW**
5. **how_to_implement** — Step-by-step action items (alias of `action_items`)

## Detection State Flow

```
Evidence → getDetectionState(key, evidence) → state
  COMPLETE → suppress recommendation (return null)
  NOT_FOUND / PARTIAL / etc. → select template variant → resolve → render
```

## Backward Compatibility

- `action_items` field preserved (aliased as `how_to_implement`)
- `gap`, `examples`, `evidence_json` unchanged
- Non-Top10 subfactors use legacy renderer path
- New fields (`finding`, `recommendation`, `what_to_include`) added but empty for non-Top10
