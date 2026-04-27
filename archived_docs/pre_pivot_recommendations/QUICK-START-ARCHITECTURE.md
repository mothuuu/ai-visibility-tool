> ⚠️ **ARCHIVED (Pre-Pivot)** — This document describes the old recommendation lifecycle system that was removed in Phase 1. It does not reflect the current production architecture. For current documentation, see DOCS_INDEX.md at repo root.

---

# AI Visibility Tool - Quick Start Architecture Guide

## What You Have

A sophisticated system for analyzing websites and generating recommendations. The system is built in 5 major layers:

### Layer 1: Extraction (Site Crawler → Content Extractor → Entity Analyzer)
- Crawls up to 15 pages of your site
- Extracts metadata, HTML structure, JSON-LD schemas, FAQs, media, entities
- Aggregates evidence across all pages

### Layer 2: Scoring (V5 Enhanced Rubric Engine)
- Scores 8 categories: AI Readability, Search Readiness, Content, Structure, Speed, Technical, Trust, Voice
- Each category has 4-9 subfactors (50+ total)
- Produces a 0-100 score (displayed as 0-1000 on frontend)

### Layer 3: Issue Detection (Issue Detector)
- Compares each score against thresholds
- Detects problems (score < threshold)
- Calculates priority and severity
- Produces a prioritized list of issues

### Layer 4: Recommendations (Hybrid Generator)
- Top 5 issues: AI-generated (ChatGPT) with code snippets
- Issues 6+: Template-based (fast, no AI)
- DIY+: Generates customized FAQ schema from industry libraries

### Layer 5: Filtering & Delivery (Tier Filter)
- Guest: No recommendations
- Free: Top 3 only
- DIY: Progressive unlock (5 every 5 days)
- Pro: All recommendations immediately

---

## Key Files by Purpose

### If you want to understand...

**How websites are analyzed:**
- `/backend/analyzers/site-crawler.js` - Site discovery
- `/backend/analyzers/content-extractor.js` - Content parsing
- `/backend/analyzers/entity-analyzer.js` - Entity recognition

**How scores are calculated:**
- `/backend/analyzers/v5-enhanced-rubric-engine.js` - Main scoring
- `/backend/routes/scan.js` - API orchestration

**How recommendations are generated:**
- `/backend/analyzers/recommendation-generator.js` - Main orchestrator
- `/backend/analyzers/recommendation-engine/issue-detector.js` - Issue detection
- `/backend/analyzers/recommendation-engine/rec-generator.js` - Hybrid generation
- `/backend/analyzers/recommendation-engine/faq-customizer.js` - FAQ generation

**How the system handles different user types:**
- `/backend/analyzers/recommendation-engine/tier-filter.js` - Tier-based filtering

**Where libraries are stored:**
- `/backend/analyzers/recommendation-engine/faq-libraries/` - 14 industry FAQ libraries
- `/backend/analyzers/recommendation-engine/faq-library-loader.js` - Library loading

---

## For Your Certification Library

You have a perfect model already built: the **FAQ Library System**.

### Current FAQ Library Structure
Each industry gets a JSON file with:
- Industry name and ID
- Version and last updated date
- List of FAQs with:
  - Priority (critical/high/medium/low)
  - Impact estimate (+XX points)
  - Question + human-friendly answer
  - Factual backend answer with {{placeholders}}
  - Extraction rules (how to find values on website)
  - Fallback values if extraction fails

### To Add Certification Library

You have 3 options (listed by recommended order):

#### Option 1: Extend Trust & Authority Scoring (RECOMMENDED)
Currently there's a `certificationsScore` subfactor in the Trust & Authority category.

```javascript
// In v5-enhanced-rubric-engine.js, analyzeTrustAuthority():
// Add detection:
- Extract from schema.org (Person/Organization credentials)
- Scan text for certification keywords
- Look for certification badge images
- Score: % of industry-relevant certs found / expected

// Add to ISSUE_THRESHOLDS (issue-detector.js):
trustAuthority: {
  certificationsScore: 55  // Below 55 = issue
}

// Generate recommendations from library:
// Create certification-libraries/ following FAQ library structure
// industires: healthcare.json, finance.json, security.json, ucaas.json, etc.
```

**Pros:**
- Integrates seamlessly with existing scoring
- Reuses library architecture
- Automatic issue detection
- Follows established patterns

#### Option 2: Create Separate Module
Create `/backend/analyzers/certification-detector.js` that:
- Detects certifications from evidence
- Maps to industry requirements
- Generates recommendations

#### Option 3: Template-Based
Add certification templates to `RECOMMENDATION_TEMPLATES` in `rec-generator.js`

---

## Data Flow in One Picture

```
Website URL
    ↓
[Crawl 15 pages] → Extract content/schema/entities
    ↓
[Aggregate] → Site-wide metrics (% pages with X)
    ↓
[Score] → 8 categories × 50+ subfactors (0-100 each)
    ↓
[Detect Issues] → Compare vs thresholds
    ↓
[Generate Recs] → AI for top 5, templates for rest
    ↓
[Generate FAQ] → Library-based or AI fallback
    ↓
[Filter by Tier] → Guest/Free/DIY/Pro
    ↓
[Return to user] → Score + recommendations + FAQ
```

---

## Current Scores & Thresholds

Example from Trust & Authority category (12% of total score):

```
If certificationsScore = 30 (below threshold of 55)
  Gap = 25
  Severity = high
  Priority = (12 × 25) / 10 = 30
  Action = Create issue + recommendation
  
  Recommendation: "Add your industry certifications"
  Finding: "You're not displaying key certifications..."
  Impact: "+18 points if added"
  Action Steps: [...]
  Code Snippet: [JSON-LD + badge markup]
```

---

## Adding New Schema.org Types

The system **already handles any schema.org type automatically**:

1. **Detection**: Recursively extracts all `@type` values
2. **Scoring**: Add to relevant category analyzer
3. **Issues**: Add threshold to ISSUE_THRESHOLDS
4. **Recommendations**: Add template to RECOMMENDATION_TEMPLATES

No manual registration needed!

---

## Industry-Specific Features

14 industries with custom FAQ libraries:
- Cloud Communications/UCaaS
- Marketing Agencies
- Cybersecurity
- Finance (Fintech)
- Healthcare (implied by Person/Organization certs)
- Telecom Service Providers
- Telecom Software
- AI Infrastructure
- Digital Infrastructure
- Data Center
- Managed Service Providers
- AI Startups
- Mobile Connectivity/eSIM
- SaaS B2B

Each library contains:
- Industry-specific FAQs with proven effectiveness
- Factual anchors with extraction rules
- Fallback answers when data can't be extracted
- JSON-LD schema generation

---

## Next Steps for Certification Library

1. **Design the library structure** - Follow FAQ library format
   - Define critical/important/relevant certs per industry
   - Create extraction rules (where to look, what patterns)
   - Define score calculation

2. **Implement detection** - Extend EntityAnalyzer or create CertificationDetector
   - Scan for certification keywords/names
   - Look in schema.org (Person credentials, Organization sameAs)
   - Pattern scan for certifications

3. **Add to scoring** - Integrate into Trust & Authority analysis
   - Calculate score based on detected certs
   - Compare against industry expectations

4. **Generate recommendations** - Use existing recommendation framework
   - Detect missing critical certs
   - Show impact of adding each cert
   - Provide JSON-LD markup code

5. **Create library files** - JSON files per industry
   - Follow faq-libraries/ structure
   - Include priority, impact, extraction rules

---

## Key Insight: Flexibility

This system is **extremely flexible** for adding new data types:

- **Detection**: Automatic for schema.org via recursive extraction
- **Scoring**: Add analyzer method + thresholds
- **Issues**: Threshold-based (no custom logic needed)
- **Recommendations**: Template + library support
- **Libraries**: JSON-based, no code changes needed

Want to add support for "Product Schema"? Add 3 lines of code to score it, and the rest happens automatically.

Want to add certifications? Use the exact same pattern as FAQs, just with different content.

---

## Architecture Files Reference

Two new files have been created for you:

1. **ARCHITECTURE-OVERVIEW.md** (20KB)
   - Complete detailed breakdown of each system
   - Code examples and integration points
   - Library design recommendations
   - All 50+ scoring subfactors listed

2. **ARCHITECTURE-DIAGRAM.txt** (29KB)
   - Visual ASCII diagrams of data flow
   - Layer-by-layer breakdown
   - Decision trees and scoring examples
   - Library system architecture

Read these alongside the code to understand:
- Exactly where each component fits
- How data flows through the system
- What functions to call and in what order
- Where and how to add your certification library

---

## Testing & Validation

When you add the certification library:

1. **Detection**: Scan test websites with known certifications
2. **Scoring**: Verify scores match expected ranges
3. **Issues**: Confirm thresholds trigger appropriately
4. **Recommendations**: Check quality and relevance
5. **FAQ**: Validate placeholder extraction and customization

---

## Questions to Ask Yourself

When designing the certification system:

1. **Which certifications matter per industry?**
   - Critical (required/expected)
   - Important (valuable)
   - Relevant (nice to have)

2. **How should we detect certifications?**
   - Text patterns ("HIPAA certified")
   - Schema.org Person/Organization fields
   - Badge images (alt text, src patterns)
   - Badge URLs (specific domains)

3. **How to score?**
   - % of critical certs found?
   - Count-based (more = better)?
   - Weighted by importance?

4. **Impact estimates**
   - How many points per certification?
   - Varies by industry?
   - Total possible score contribution?

---

End of Quick Start Guide

For detailed information, see:
- ARCHITECTURE-OVERVIEW.md - Comprehensive breakdown
- ARCHITECTURE-DIAGRAM.txt - Visual diagrams
- Source files referenced throughout

