# Golden Fixture Set — Phase 4A.3 Recommendation Quality Overhaul

## Purpose

This directory contains **golden fixtures** used as regression tripwires for the recommendation pipeline. They capture:

- Representative scan scenarios covering key evidence states and plan contexts
- Current API response structure (not exact text)
- Structure invariants that MUST be preserved across refactoring

## What is Frozen (Structure Invariants)

- **Returned count range** — Number of recommendations returned for a given plan/evidence state
- **Top N rec_keys order** — First N recommendations should maintain relative priority
- **Section presence flags** — Required sections (finding, why_it_matters, recommendation, etc.)
- **Placeholder resolution** — No unresolved `{{placeholder}}` patterns in output
- **Evidence JSON structure** — Presence of key fields like `detection_state`, `pages_checked`

## What Can Evolve (Not Frozen)

- **Exact text wording** — Narrative content may change
- **Action item count/content** — Specific implementation steps may be refined
- **Generated asset content** — Schema JSON, FAQ content, etc.
- **Detailed phrasing** — Error messages, descriptions

## Directory Structure

```
tests/fixtures/golden/
├── README.md                  # This file
├── fixture_manifest.json      # Index of all fixtures with scenario descriptions
├── STEP_0_AUDIT_NOTES.md      # Schema discovery and current behavior documentation
│
├── <fixture_id>/
│   ├── metadata.json          # Scan/user/org context (redacted)
│   ├── api_response.json      # Full API response (PII stripped)
│   ├── invariants.json        # Structure assertions
│   └── pipeline_counts.json   # Recommendation pipeline metrics
```

## Fixture Types

### Evidence States
- `no_faq_at_all` — FAQ detection returns NOT_FOUND
- `faq_content_no_schema` — FAQ content exists but no FAQPage schema
- `faq_complete` — Full FAQ implementation

### Plan Contexts (Viewer-Based Entitlements)
- `viewer_free_plan` — Viewer on Free plan (cap=3)
- `viewer_diy_plan` — Viewer on DIY plan (cap=5)
- `viewer_pro_plan` — Viewer on Pro plan (cap=10)
- `viewer_enterprise_plan` — Viewer on Enterprise (cap=unlimited)

### Edge Cases
- `multi_issue_site` — High recommendation volume (12+ candidates)
- `org_with_override` — Manual plan override active
- `minimal_evidence` — Weak evidence payloads

## How to Update Fixtures Intentionally

When making intentional changes to recommendation logic:

1. Run `node scripts/fixtures/capture-fixture.js --all --outDir tests/fixtures/golden`
2. Review diffs in `api_response.json` and `invariants.json`
3. Update `invariants.json` if structure changes are intentional
4. Commit with message describing the intentional change

## Scripts

- `scripts/fixtures/capture-fixture.js` — Capture new fixtures from DB
- `scripts/fixtures/validate-fixtures.js` — Validate fixture integrity

## Important Invariants (v1.2)

1. **Entitlements are based on the viewer's effective plan** — The authenticated user making the request determines the recommendation cap, not the scan owner.

2. **Context reuse does not change entitlements** — If `source_scan_id` points to another scan's data, the viewer's plan still gates visibility.

3. **No PII in fixtures** — Emails, tokens, names, addresses, phone numbers must be redacted or omitted.

## Created

- Date: 2026-01-24
- Phase: 4A.3 Step 0.0
- Author: Claude Code
