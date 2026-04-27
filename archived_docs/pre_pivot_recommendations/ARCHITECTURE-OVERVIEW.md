> ⚠️ **ARCHIVED (Pre-Pivot)** — This document describes the old recommendation lifecycle system that was removed in Phase 1. It does not reflect the current production architecture. For current documentation, see DOCS_INDEX.md at repo root.

---

# AI Visibility Tool - Complete Architectural Overview

## Executive Summary

The AI Visibility Tool implements a sophisticated pipeline that:
1. **Extracts** structured data from websites (schema.org, FAQs, content, technical metadata)
2. **Scores** sites across 8 categories using a V5 Enhanced Rubric (0-100 scale)
3. **Detects** specific issues by comparing scores against thresholds
4. **Generates** recommendations from a hybrid system (libraries → AI → templates)
5. **Filters** results by user tier (guest/free/DIY/pro)

---

## 1. DATA EXTRACTION PIPELINE

### Flow: Scraping → Parsing → Aggregation

```
Website URL
    ↓
[SiteCrawler] - Multi-page discovery
    ├─ Fetch sitemap.xml (multiple locations tried)
    ├─ Extract internal links from homepage
    └─ Prioritize URLs (homepage → about → blog → other)
    ↓
[ContentExtractor] - Single page analysis (per URL)
    ├─ Fetch HTML (with 3 fallback user agents)
    ├─ Extract Metadata (title, description, OG tags, etc)
    ├─ Extract Technical (JSON-LD, schema types, canonical, etc)
    ├─ Extract Content (headings, paragraphs, FAQs, lists, tables)
    ├─ Extract Structure (semantic HTML, ARIA, landmarks)
    ├─ Extract Media (images with alt text, videos, audio)
    ├─ Extract Accessibility (aria labels, form labels, etc)
    └─ Performance metrics (TTFB, cache headers)
    ↓
[EntityAnalyzer] - Named entity recognition
    ├─ Extract from schema.org markup
    ├─ Extract from text content (people, orgs, places)
    ├─ Map entity relationships
    ├─ Geographic entity analysis
    └─ Professional credentials verification
    ↓
[Evidence Aggregation] - Combine all pages
    └─ Site-wide metrics (% pages with FAQs, schema, etc)
```

### Key Extraction Classes

**SiteCrawler** (site-crawler.js)
- Crawls up to 15 pages (configurable)
- Detects sitemap.xml automatically
- Prioritizes diverse content types
- Aggregates metrics across all pages

**ContentExtractor** (content-extractor.js)
- Fetches HTML with cache-busting
- Extracts JSON-LD schema (with recursive nested type detection)
- Extracts FAQs in 4 ways:
  1. JSON-LD FAQPage schema (most reliable)
  2. Microdata schema markup
  3. HTML class/id patterns (.faq, [role="accordion"], `<details>`)
  4. Question-like headings (ends with "?")

**EntityAnalyzer** (entity-analyzer.js)
- Extracts Person, Organization, Place entities
- Maps relationships and knowledge graphs
- Identifies geographic entities
- Verifies professional credentials

---

## 2. STRUCTURED DATA EXTRACTION (Schema.org)

### JSON-LD Detection
```javascript
// ContentExtractor.extractTechnical() finds:
- script[type="application/ld+json"] tags
- Recursively extracts all @type values (including nested ones)
- Examples detected:
  * Organization, LocalBusiness
  * FAQPage, Article, BlogPosting
  * BreadcrumbList, Product, Place
  * Person with credentials
```

### Detected Schema Types
The system tracks all schema types including nested ones:
- **Organization types**: Organization, LocalBusiness, Corporation
- **Content types**: Article, BlogPosting, NewsArticle, ScholarlyArticle
- **Dynamic content**: FAQPage, VideoObject, AudioObject
- **Trust signals**: Person (author), credentials, affiliations
- **Geographic**: Place, GeoCoordinates, PostalAddress

### Certifications in Current System
Currently tracked via:
1. **Person schema** - jobTitle, affiliation fields
2. **Organization schema** - sameAs for social proof
3. **Text pattern scanning** - keywords like "certified", "accredited"
4. **Authority signals** - domain authority estimation

---

## 3. SCORING SYSTEM (V5 Enhanced Rubric)

### Architecture: Category → Subfactors → Scores

```
V5EnhancedRubricEngine.analyze()
├─ Crawl site (15 pages)
├─ Score 8 Categories
│  ├─ AI Readability (10%)
│  │  ├─ altTextScore
│  │  ├─ captionsTranscriptsScore
│  │  ├─ interactiveAccessScore
│  │  └─ crossMediaScore
│  ├─ AI Search Readiness (20%)
│  │  ├─ questionHeadingsScore
│  │  ├─ scannabilityScore
│  │  ├─ readabilityScore
│  │  ├─ faqScore
│  │  ├─ snippetEligibleScore
│  │  ├─ pillarPagesScore
│  │  ├─ linkedSubpagesScore
│  │  ├─ painPointsScore
│  │  └─ geoContentScore
│  ├─ Content Freshness (8%)
│  │  ├─ lastUpdatedScore
│  │  ├─ versioningScore
│  │  ├─ timeSensitiveScore
│  │  ├─ auditProcessScore
│  │  ├─ liveDataScore
│  │  ├─ httpFreshnessScore
│  │  └─ editorialCalendarScore
│  ├─ Content Structure (15%)
│  │  ├─ headingHierarchyScore
│  │  ├─ navigationScore
│  │  ├─ entityCuesScore
│  │  ├─ accessibilityScore
│  │  └─ geoMetaScore
│  ├─ Speed & UX (5%)
│  │  ├─ lcpScore
│  │  ├─ clsScore
│  │  ├─ inpScore
│  │  ├─ mobileScore
│  │  └─ crawlerResponseScore
│  ├─ Technical Setup (18%)
│  │  ├─ crawlerAccessScore
│  │  ├─ structuredDataScore
│  │  ├─ canonicalHreflangScore
│  │  ├─ openGraphScore
│  │  ├─ sitemapScore
│  │  ├─ indexNowScore
│  │  └─ rssFeedScore
│  ├─ Trust & Authority (12%)
│  │  ├─ authorBiosScore
│  │  ├─ certificationsScore ← KEY FOR CERTIFICATION LIBRARY
│  │  ├─ domainAuthorityScore
│  │  ├─ thoughtLeadershipScore
│  │  └─ thirdPartyProfilesScore
│  └─ Voice Optimization (12%)
│     ├─ longTailScore
│     ├─ localIntentScore
│     ├─ conversationalTermsScore
│     ├─ snippetFormatScore
│     └─ multiTurnScore
└─ Calculate weighted total (0-100)
```

### Scoring Details
- **Each subfactor**: 0-100 scale
- **Categories**: Weighted average of subfactors
- **Total score**: Sum of (category score × weight)
- **Range**: 0-100 displayed as 0-1000 on frontend

---

## 4. ISSUE DETECTION → RECOMMENDATION GENERATION

### Flow: Scores → Issues → Recommendations

```
V5 Scores (0-100 for each subfactor)
    ↓
[IssueDetector] - Compare against thresholds
    ├─ Each subfactor has a THRESHOLD
    ├─ If score < threshold → CREATE ISSUE
    └─ Calculate priority & severity
    ↓
Issues Array
    [
      {
        category: "technicalSetup",
        subfactor: "structuredDataScore",
        currentScore: 45,
        threshold: 75,
        gap: 30,
        severity: "high",
        priority: 54,
        evidence: {...}
      },
      ...
    ]
    ↓
[RecommendationGenerator] - Hybrid approach (5 AI + rest templates)
    ├─ For each issue:
    │  ├─ Step 1: Check Library (industry-specific pre-curated)
    │  ├─ Step 2: Use AI (ChatGPT/Claude for top 5 issues)
    │  ├─ Step 3: Use Templates (deterministic for others)
    │  └─ Format output with code snippets & evidence
    ↓
Recommendations Array
    [
      {
        id: uuid,
        category: "technicalSetup",
        title: "Implement Structured Data Schema",
        finding: "Schema markup helps AI understand your content...",
        impact: "AI Understanding & Rich Results",
        actionSteps: [...],
        codeSnippet: "<script type='application/ld+json'>...",
        estimatedScoreGain: 18,
        difficulty: "Easy",
        customizedImplementation: "..."
      },
      ...
    ]
```

### Issue Thresholds (Issue Detection)
```javascript
ISSUE_THRESHOLDS = {
  aiReadability: {
    altTextScore: 70,           // Below 70 → needs alt text
    captionsTranscriptsScore: 60,
    ...
  },
  technicalSetup: {
    structuredDataScore: 75,    // Below 75 → missing schemas
    sitemapScore: 80,           // Below 80 → sitemap problems
    ...
  },
  trustAuthority: {
    certificationsScore: 55,    // Below 55 → no certifications
    ...
  },
  ...
}
```

### Priority Calculation
```javascript
priority = (categoryWeight × gapSize) / 10

Example:
- Category: technicalSetup (weight 18)
- Current: 45, Threshold: 75
- Gap: 30
- Priority = (18 × 30) / 10 = 54

Higher priority = more important to fix
```

---

## 5. RECOMMENDATION GENERATION (Hybrid System)

### Orchestration
```
generateCompleteRecommendations()
├─ Step 1: Detect Issues
│  └─ detectPageIssues() or detectMultiPageIssues()
├─ Step 2: Generate Recommendations (HYBRID)
│  └─ Top 5 issues: AI-generated, Rest: templates
├─ Step 3: Generate FAQ (industry-specific, if DIY+)
│  └─ Uses FAQ Library OR Claude fallback
└─ Step 4: Apply Tier Filtering
   └─ Guest: 0 recs, Free: 3 recs, DIY: 5/batch, Pro: all
```

### Recommendation Generation Strategies

**Strategy 1: Curated Library (Future Enhancement)**
- Per-industry FAQ library (already implemented!)
- Pre-curated Q&A pairs
- High-quality, fact-checked answers
- Currently used for FAQ schema only

**Strategy 2: Programmatic (Deterministic)**
- JSON-LD schema building (no AI needed)
- Open Graph tags
- Question headings
- Heading hierarchy fixes

**Strategy 3: AI Generation (ChatGPT)**
- Used for top 5 issues only
- High-quality, context-aware
- Code snippets with explanations
- Customized to website content

**Strategy 4: Smart Templates (Fallback)**
- Pre-written templates for common issues
- Fast, no API calls
- Good enough for free tier
- Can be overridden by AI

### Library-Based FAQ Generation
```javascript
generateCustomizedFAQ(industry, siteData)
├─ Check if library exists for industry
├─ If YES:
│  ├─ Load library (FAQs with metadata)
│  ├─ Select top N by priority
│  ├─ Extract company facts from website
│  ├─ Customize each FAQ with Claude
│  └─ Fill placeholders: {{company_name}}, {{uptime}}
├─ If NO:
│  └─ Generate with Claude fallback
└─ Return JSON-LD schema + implementation guide
```

---

## 6. LIBRARY STRUCTURE FOR CERTIFICATIONS

### Current FAQ Library Structure
Location: `backend/analyzers/recommendation-engine/faq-libraries/`

Example: `ucaas.json`
```json
{
  "faq_library": {
    "industry": "Cloud Communications/UCaaS",
    "industry_id": "cloud_communications_ucaas",
    "version": "1.0",
    "metadata": {
      "total_faqs": 5,
      "completion_status": "production_ready",
      "anti_hallucination_enabled": true,
      "confidence_tracking": true
    },
    "faqs": [
      {
        "id": "faq_001",
        "priority": "critical",
        "found_on_percent": 92,
        "expected_impact": "+19-24 points",
        "question": "How reliable is your system?",
        "answer_human_friendly": {...},
        "answer_factual_backend": {
          "text": "...with {{uptime_percentage}}% uptime...",
          "factual_anchors": [
            {
              "claim": "{{uptime_percentage}}% uptime",
              "type": "service_metric",
              "extraction_field": "uptime_percentage",
              "fallback": "99.9% uptime"
            }
          ]
        },
        "extraction_rules": {...}
      }
    ]
  }
}
```

### Where Certification Library Fits

**Option 1: Extend Trust & Authority Scoring**
- Add `certificationsLibrary.json` with industry-standard certifications
- Detect certifications in existing schema/text
- Score based on which certifications are present
- Generate recommendations to add missing certs

**Option 2: Separate Certification Library**
- Create `certification-library.js` module
- Returns recommendations for industry certifications
- Integrates into recommendation-generator.js
- Shows which certs are relevant by industry

**Option 3: Inline in Recommendation Engine**
- Add certification detection to issue-detector.js
- Create template recommendations for common certifications
- Maps to each industry (medical→HIPAA, finance→SOC2, etc)

---

## 7. DATA FLOW END-TO-END

```
USER REQUEST: Scan website.com
    ↓
[POST /api/scan/analyze] - Auth required
    ├─ Check plan limits
    ├─ Determine domain type (primary vs competitor)
    └─ Set plan-appropriate limits (pages, recommendations)
    ↓
[performV5Scan(url, plan, pages, userIndustry)]
    ├─ V5EnhancedRubricEngine.analyze()
    │  ├─ SiteCrawler.crawl()
    │  │  ├─ Fetch sitemap + internal links
    │  │  └─ Priority sort + cap at 15 pages
    │  ├─ For each page: ContentExtractor.extract()
    │  │  ├─ Fetch HTML
    │  │  ├─ Parse JSON-LD, meta tags, content
    │  │  └─ EntityAnalyzer
    │  ├─ Aggregate evidence across all pages
    │  └─ Score all 8 categories
    ├─ Transform V5 scores to subfactor format
    ├─ generateCompleteRecommendations()
    │  ├─ detectPageIssues() - find problems
    │  ├─ generateRecommendations() - create fixes
    │  │  ├─ Top 5: AI-generated
    │  │  └─ Rest: Templates
    │  ├─ generateCustomizedFAQ() - if DIY+
    │  │  └─ Uses library OR Claude
    │  └─ filterByTier() - apply plan restrictions
    └─ Return results
    ↓
[Save to Database]
    ├─ Store scan results (scores, industry, etc)
    ├─ Store recommendations
    ├─ Create user_progress for DIY
    └─ Calculate unlock schedule
    ↓
[RESPONSE to user]
{
  success: true,
  scan: {
    id: scan_id,
    url: "...",
    total_score: 68,
    categories: {...},
    recommendations: [...], // Tier-filtered
    faq: {...},             // Tier-filtered
    unlock_schedule: {...}  // DIY only
  }
}
```

---

## 8. SYSTEM FLEXIBILITY FOR NEW STRUCTURED DATA TYPES

### Adding Support for New Schema.org Types

**Step 1: Detection** (ContentExtractor.extractTechnical)
```javascript
// Already handles recursive extraction:
- Scans all script[type="application/ld+json"]
- Extracts @type (string or array)
- Handles nested types automatically
// No changes needed - automatically detected!
```

**Step 2: Scoring** (V5EnhancedRubricEngine)
```javascript
// Add to relevant category analyzer, e.g.:
analyzeYourCategory() {
  const metrics = this.siteData.siteMetrics;
  const hasYourSchema = metrics.pagesWithYourSchema || 0;
  
  const subfactors = {
    yourSchemaScore: (hasYourSchema / this.siteData.pageCount) * 100
  };
  
  return { score: subfactors.yourSchemaScore * 100, subfactors };
}
```

**Step 3: Issue Detection** (IssueDetector)
```javascript
ISSUE_THRESHOLDS.yourCategory = {
  yourSchemaScore: 70  // Below 70 = issue
};
// Issues automatically detected from thresholds
```

**Step 4: Recommendation** (RecommendationGenerator)
```javascript
// Add to RECOMMENDATION_TEMPLATES:
yourSchemaScore: {
  title: "Add Your Schema Markup",
  impactArea: "...",
  whyItMatters: "...",
  difficulty: "Easy",
  estimatedGain: 12
}
// Automatically generates recommendation
```

---

## 9. CERTIFICATION LIBRARY DESIGN

### Recommended Structure for Certifications

**File: `certification-library.js`**
```javascript
const INDUSTRY_CERTIFICATIONS = {
  'Healthcare': {
    critical: ['HIPAA', 'HITECH Act'],
    important: ['ISO 27001', 'SOC 2 Type II'],
    relevant: ['HL7 compliance']
  },
  'Finance': {
    critical: ['PCI-DSS', 'SOC 2 Type II'],
    important: ['ISO 27001', 'GLBA compliance'],
    relevant: ['FCA regulated']
  },
  'Cybersecurity': {
    critical: ['ISO 27001', 'SOC 2 Type II'],
    important: ['CISSP', 'CEH'],
    relevant: ['Bug bounty program']
  },
  'UCaaS': {
    critical: ['SOC 2 Type II', 'ISO 27001'],
    important: ['GDPR compliance', 'HIPAA Ready'],
    relevant: ['ISO 9001']
  },
  // ... other industries
};

// Detection function
function detectCertifications(evidence) {
  const found = [];
  // Scan schema, text, headers for cert names/logos
  return found;
}

// Scoring function
function calculateCertificationsScore(detectedCerts, industryCerts) {
  // Score based on % of critical/important certs present
  return score;
}

// Recommendation function
function generateCertificationRecommendations(industry, detected) {
  const recommended = INDUSTRY_CERTIFICATIONS[industry];
  const missing = recommended.filter(c => !detected.includes(c));
  return missing.map(cert => ({
    title: `Display ${cert} Certification`,
    why: `${cert} is critical for ${industry} companies...`,
    codeSnippet: buildCertificationMarkup(cert)
  }));
}
```

### Integration Points
1. **Detection**: Add to `ContentExtractor.extractTechnical()`
2. **Scoring**: Add to `analyzeTrustAuthority()` in `V5EnhancedRubricEngine`
3. **Issues**: Add to `ISSUE_THRESHOLDS.trustAuthority.certificationsScore`
4. **Recommendations**: Add certification-specific templates to `rec-generator.js`

---

## 10. KEY FILES REFERENCE

### Core Extraction
- `/backend/analyzers/site-crawler.js` - Multi-page discovery & aggregation
- `/backend/analyzers/content-extractor.js` - HTML parsing & metadata extraction
- `/backend/analyzers/entity-analyzer.js` - Named entity recognition
- `/backend/analyzers/recommendation-engine/jsonld.js` - Schema.org builders

### Scoring
- `/backend/analyzers/v5-enhanced-rubric-engine.js` - Main scoring engine
- `/backend/routes/scan.js` - API orchestration & score transformation

### Recommendations
- `/backend/analyzers/recommendation-generator.js` - Main orchestrator
- `/backend/analyzers/recommendation-engine/issue-detector.js` - Issue detection + thresholds
- `/backend/analyzers/recommendation-engine/rec-generator.js` - Hybrid recommendation generation
- `/backend/analyzers/recommendation-engine/faq-customizer.js` - FAQ generation
- `/backend/analyzers/recommendation-engine/tier-filter.js` - Tier-based filtering

### Libraries & Configuration
- `/backend/analyzers/recommendation-engine/faq-libraries/` - Industry FAQ libraries (14 industries)
- `/backend/analyzers/recommendation-engine/faq-library-loader.js` - Library loading & mapping
- `/backend/config/industry-list.js` - Industry definitions

### Database
- `/backend/routes/scan.js` - Scan API (lines 254-356 show schema)
- Schema tables: scans, scan_recommendations, user_progress

---

## 11. TIER SYSTEM & PROGRESSIVE UNLOCK

### Tier Limits
```javascript
TIER_LIMITS = {
  guest: { maxRecommendations: 0 },    // No recs, sign up CTA
  free: { maxRecommendations: 3 },     // Top 3 only
  diy: {
    progressiveUnlock: true,
    maxPerUnlock: 5,
    unlockInterval: 5 days
  },
  pro: { maxRecommendations: 300 }     // All recs immediately
}
```

### DIY Progressive Unlock
- Generates 20 recs, shows 5 at a time
- User can unlock 5 more every 5 days
- Tracks in `user_progress` table
- Auto-unlocks batches based on schedule

---

## Summary: Complete Data Flow

```
Website URL
    ↓ Crawl & Extract (SiteCrawler + ContentExtractor)
    ↓ Aggregate Evidence (15 pages)
    ↓ Extract Entities (EntityAnalyzer)
    ↓ Score (V5EnhancedRubricEngine - 8 categories × 50+ subfactors)
    ↓ Detect Issues (IssueDetector - compare vs thresholds)
    ↓ Generate Recommendations (Hybrid: Library → AI → Templates)
    ↓ Generate FAQ (Library-based customization)
    ↓ Apply Tier Filtering (Guest/Free/DIY/Pro)
    ↓ Save to Database
    ↓ Return to User
```

**Certification Library** fits best in:
1. **Detection layer**: Extend ContentExtractor or add certification-detector.js
2. **Scoring layer**: Add certificationsScore to analyzeTrustAuthority()
3. **Issues layer**: Add threshold in ISSUE_THRESHOLDS
4. **Recommendations layer**: Add certification templates to rec-generator.js
5. **Library layer**: Add certification-libraries/ with industry mappings

