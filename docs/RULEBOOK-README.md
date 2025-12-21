# Detection & Extraction Rulebook Documentation

This directory contains the official rulebook specifications for the AI Visibility Tool's detection and scoring system.

## Current Version: 2.1

### Rulebook Files

| File | Description |
|------|-------------|
| `detection-extraction-rulebook (3).md` | Main rulebook v2.0 - Core detection and extraction specifications |
| `detection-rulebook-addendum-v1.2.md` | Addendum v1.2 - Extended vocabulary, tri-state scoring, evidence contract |

### Key Specifications

#### Tri-State Scoring (v1.2+)
All scores use tri-state objects:
- `measured`: Score calculated successfully (0-100)
- `not_measured`: Insufficient data to calculate
- `not_applicable`: Metric doesn't apply to this page type

#### Evidence Contract (v2.0.0)
Required namespaces: `url`, `timestamp`, `contractVersion`, `navigation`, `structure`, `content`, `technical`

Expected namespaces: `crawler`, `siteMetrics`

Future namespaces: `aiReadiness`, `trust`, `voice`, `freshness`

#### Global Detection Vocabulary
All detection patterns are centralized in `backend/config/detection-vocabulary.js`:
- URL patterns for page type classification
- Navigation text patterns
- CSS selectors for DOM detection
- Schema type definitions

### Implementation Files

| File | Purpose |
|------|---------|
| `backend/config/detection-vocabulary.js` | Central vocabulary registry |
| `backend/analyzers/evidence-contract.js` | Contract definitions & validation |
| `backend/analyzers/evidence-builder.js` | Evidence construction |
| `backend/analyzers/score-types.js` | Tri-state score utilities |
| `backend/analyzers/content-extractor.js` | Page content extraction |
| `backend/analyzers/site-crawler.js` | Site crawling & sitemap analysis |
| `backend/analyzers/v5-enhanced-rubric-engine.js` | V5 rubric scoring engine |

### Testing

Run unit tests to verify rulebook compliance:
```bash
node --test backend/tests/unit/*.test.js
```

Key test files:
- `tri-state-scoring.test.js` - Score type utilities
- `vocabulary-classification.test.js` - URL/text classification
- `evidence-contract.test.js` - Contract validation
- `render-context.test.js` - Headless rendering budget
