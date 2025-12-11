# Detection System Audit Report

**Date:** 2025-12-11
**Auditor:** AI Assistant
**Status:** COMPREHENSIVE CODE AUDIT COMPLETE

---

## Executive Summary

This comprehensive audit traces the complete detection pipeline from URL input to final recommendation output. The analysis reveals that the **core detection pipeline is functional**, with a proper transformation layer bridging V5 scoring to issue detection. However, several **feature gaps** exist that prevent detection of certain content types.

### Key Findings

| Category | Status | Severity | Description |
|----------|--------|----------|-------------|
| **Score Transformation** | WORKING | N/A | `transformV5ToSubfactors()` properly bridges V5→Issue detection |
| **Schema Detection** | FUNCTIONAL | Low | Properly extracts JSON-LD including nested types |
| **FAQ Schema Detection** | FUNCTIONAL | Low | Correctly parses FAQPage from JSON-LD |
| **FAQ Content Detection** | PARTIAL | Medium | May miss visible FAQs when schema FAQs exist |
| **Sitemap Detection** | FUNCTIONAL | Low | Multiple detection paths work but could desync |
| **Blog Detection** | NOT IMPLEMENTED | **Critical** | No blog section detection exists anywhere |
| **Geo Detection** | FUNCTIONAL | Low | Properly extracts geo meta tags and schema |
| **Team/Contact Detection** | NOT IMPLEMENTED | Medium | Only basic author meta tag checked |
| **Testimonial Detection** | NOT IMPLEMENTED | Low | No Review schema or testimonial section detection |

### Summary

The detection system's **core pipeline is sound**. The V5 scoring engine, transformation layer, and issue detection are properly integrated. The main gaps are **missing feature detectors** (blog, team, testimonials) rather than pipeline bugs. The most critical gap is **blog detection**, which is completely unimplemented despite being a common feature users expect to track.

---

## Part 1: Complete Detection Architecture Map

### 1.1 Detection Points Inventory

#### Category: Technical Setup
| Feature | File | Function | Detection Method | Scoring Location |
|---------|------|----------|------------------|------------------|
| XML Sitemap | `site-crawler.js:124-242` | `fetchSitemapUrls()` | HTTP requests to common sitemap URLs | `v5-enhanced-rubric-engine.js:655-661` |
| robots.txt | Not directly fetched | N/A | Assumed working if crawl succeeds | `v5-enhanced-rubric-engine.js:639` |
| Canonical URLs | `content-extractor.js:696-697` | `extractTechnical()` | `link[rel="canonical"]` selector | Passed through but not scored directly |
| Hreflang tags | `content-extractor.js:692-693` | `extractTechnical()` | `link[rel="alternate"][hreflang]` selector | Not scored directly |
| Open Graph tags | `content-extractor.js:198-202` | `extractMetadata()` | `meta[property="og:*"]` selectors | `v5-enhanced-rubric-engine.js:818-819` |
| Twitter Card tags | `content-extractor.js:205-207` | `extractMetadata()` | `meta[name="twitter:*"]` selectors | Combined with OG in scoring |
| Structured Data | `content-extractor.js:641-721` | `extractTechnical()` | JSON-LD script parsing | `v5-enhanced-rubric-engine.js:681-720` |
| IndexNow | Not implemented | N/A | N/A | Returns 0 in issue-detector |
| RSS Feed | `content-extractor.js:703-704` | `extractTechnical()` | `link[type="application/rss+xml"]` | Not scored directly |

#### Category: Schema Detection
| Feature | File | Function | Detection Method | Returns |
|---------|------|----------|------------------|---------|
| Organization | `content-extractor.js:685` | `extractTechnical()` | `allSchemaTypes.has('Organization')` | Boolean |
| LocalBusiness | `content-extractor.js:686` | `extractTechnical()` | `allSchemaTypes.has('LocalBusiness')` | Boolean |
| FAQPage | `content-extractor.js:687` | `extractTechnical()` | `allSchemaTypes.has('FAQPage')` | Boolean |
| PostalAddress | `content-extractor.js:610-635` | `extractAllSchemaTypes()` | Recursive nested type extraction | Included in allSchemaTypes |
| GeoCoordinates | `content-extractor.js:610-635` | `extractAllSchemaTypes()` | Recursive nested type extraction | Included in allSchemaTypes |
| Place | `content-extractor.js:610-635` | `extractAllSchemaTypes()` | Recursive nested type extraction | Included in allSchemaTypes |
| Person | Not explicitly checked | Via allSchemaTypes | Part of recursive extraction | Not used in scoring |
| Product | Not explicitly checked | Via allSchemaTypes | Part of recursive extraction | Not used in scoring |
| Article | `content-extractor.js:688` | `extractTechnical()` | `allSchemaTypes.has('Article')` | Boolean |
| BreadcrumbList | `content-extractor.js:689` | `extractTechnical()` | `allSchemaTypes.has('BreadcrumbList')` | Boolean |
| WebSite | Not explicitly checked | Via allSchemaTypes | Part of recursive extraction | Not used in scoring |

#### Category: Content Detection
| Feature | File | Function | Detection Method | Returns |
|---------|------|----------|------------------|---------|
| FAQ (visible HTML) | `content-extractor.js:381-511` | `extractFAQs()` | Multiple patterns (schema, class/id, details, headings) | Array of {question, answer, source} |
| Blog section | NOT IMPLEMENTED | N/A | No explicit blog detection | N/A |
| Question headings | `site-crawler.js:504-516` | `hasQuestionHeadings()` | Checks for question words in h1-h3 | Boolean |
| Author bios | `content-extractor.js:193` | `extractMetadata()` | `meta[name="author"]` only | String or empty |
| Team page | NOT IMPLEMENTED | N/A | No explicit detection | N/A |
| About page | `site-crawler.js:350` | `prioritizeUrls()` | URL pattern matching only | Priority score |
| Contact info | Not explicitly detected | N/A | N/A | N/A |
| Certifications | `certification-detector.js` | `detectCertifications()` | Text pattern matching | Object with found certs |
| Testimonials | NOT IMPLEMENTED | N/A | No explicit detection | N/A |

#### Category: Technical Analysis
| Feature | File | Function | Detection Method | Returns |
|---------|------|----------|------------------|---------|
| Page speed (TTFB) | `content-extractor.js:727-760` | `checkPerformance()` | HEAD request timing | {ttfb, responseTime} |
| Mobile responsiveness | `content-extractor.js:707-708` | `extractTechnical()` | Viewport meta presence | Boolean |
| Heading hierarchy | `content-extractor.js:231-246` | `extractContent()` | Count of h1-h6 tags | Object with arrays |
| Internal linking | `content-extractor.js:541-542` | `extractStructure()` | Link href pattern matching | Number count |
| Image alt text | `content-extractor.js:559-601` | `extractMedia()` | img[alt] presence | Coverage percentage |
| Accessibility | `content-extractor.js:765-797` | `extractAccessibility()` | ARIA attributes count | Object with metrics |

---

## Part 2: Complete Data Flow Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STAGE 1: URL INPUT                                                       │
│ Location: routes/scan.js                                                 │
│ Input: User-provided URL string                                          │
│ Output: Normalized URL                                                   │
│ Potential Issues: None identified                                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STAGE 2: MULTI-PAGE CRAWL                                                │
│ Location: site-crawler.js                                                │
│ Steps:                                                                   │
│   1. Try sitemap URLs (sitemap.xml, wp-sitemap.xml, etc.)               │
│   2. Fall back to internal link crawling                                 │
│   3. Crawl up to maxPages (default 15)                                   │
│ Output: Array of page URLs + sitemap detection status                    │
│ Potential Issues:                                                        │
│   - Sitemap detection stored in this.sitemapDetected but may not        │
│     propagate correctly to final evidence                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STAGE 3: CONTENT EXTRACTION (per page)                                   │
│ Location: content-extractor.js                                           │
│ Steps:                                                                   │
│   1. fetchHTML() with multiple user-agent fallbacks                     │
│   2. extractMetadata() - meta tags, OG, Twitter                         │
│   3. extractTechnical() - JSON-LD, canonical, hreflang                  │
│   4. extractContent() - headings, paragraphs, FAQs, lists               │
│   5. extractStructure() - semantic HTML, links                          │
│   6. extractMedia() - images, videos, alt text                          │
│   7. checkPerformance() - TTFB measurement                              │
│   8. extractAccessibility() - ARIA, labels                              │
│ Output: Evidence object per page                                         │
│ Potential Issues:                                                        │
│   - FAQs extracted BEFORE footer removal (correct!)                      │
│   - BUT: Header/nav/footer then removed, which could affect             │
│     blog detection if blog links are in nav                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STAGE 4: EVIDENCE AGGREGATION                                            │
│ Location: site-crawler.js:411-484                                        │
│ Steps:                                                                   │
│   1. aggregateEvidence() combines all page evidences                    │
│   2. Calculate site-wide metrics (percentages, averages)                │
│   3. Store sitemapDetected status                                        │
│ Output: Aggregated siteData object with siteMetrics                      │
│ Potential Issues:                                                        │
│   - pagesWithFAQSchema checks e.technical.hasFAQSchema                  │
│   - pagesWithFAQs checks e.content.faqs.length > 0                      │
│   - These are separate checks that could both pass/fail independently   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STAGE 5: V5 SCORING                                                      │
│ Location: v5-enhanced-rubric-engine.js                                   │
│ Steps:                                                                   │
│   1. analyze() orchestrates all category scoring                        │
│   2. analyzeAISearchReadiness() - FAQ schema + content split            │
│   3. analyzeTechnicalSetup() - sitemap scoring                          │
│   4. analyzeTrustAuthority() - certifications                           │
│   5. etc. for all 8 categories                                          │
│ Output: categoryScores object with subfactors                            │
│ Potential Issues:                                                        │
│   - FAQ scoring split into faqSchema and faqContent factors             │
│   - Sitemap scoring at line 655-661 uses this.siteData.sitemapDetected  │
│   - These factor names MUST match issue-detector thresholds             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STAGE 6: ISSUE DETECTION                                                 │
│ Location: issue-detector.js                                              │
│ Steps:                                                                   │
│   1. detectPageIssues() compares scores to thresholds                   │
│   2. Each subfactor has a threshold in ISSUE_THRESHOLDS                 │
│   3. Scores below threshold become issues                               │
│ Output: Array of issue objects                                           │
│ CRITICAL ISSUES IDENTIFIED:                                              │
│   - ISSUE_THRESHOLDS uses faqSchemaScore and faqContentScore            │
│   - V5 engine creates factors.faqSchema and factors.faqContent          │
│   - These names don't include "Score" suffix - POTENTIAL MISMATCH!      │
│   - sitemapScore threshold is 80, uses technicalSetup.sitemapScore      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STAGE 7: RECOMMENDATION GENERATION                                       │
│ Location: rec-generator.js                                               │
│ Steps:                                                                   │
│   1. generateRecommendations() processes top 5 issues                   │
│   2. Check for programmatic generators (FAQ, certifications)            │
│   3. Fall back to ChatGPT or templates                                  │
│ Output: Array of recommendation objects                                  │
│ Potential Issues:                                                        │
│   - Only top 5 issues get recommendations (BATCH_SIZE = 5)              │
│   - If FAQ issue is at position 6+, it won't get a recommendation       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STAGE 8: TIER FILTERING & OUTPUT                                         │
│ Location: tier-filter.js                                                 │
│ Steps:                                                                   │
│   1. filterByTier() applies tier limits                                 │
│   2. Sort recommendations by priority                                   │
│   3. Limit count based on tier                                          │
│ Output: Final API response                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Part 3: Identified Root Causes

### FINDING A: Subfactor Name Transformation (RESOLVED)

**Status: WORKING CORRECTLY**

The system has a transformation layer (`transformV5ToSubfactors()` in `scan.js:1626-1752`) that bridges the V5 engine output to the issue detector's expected format:

```javascript
// V5 engine creates (v5-enhanced-rubric-engine.js):
factors.faqSchema = faqSchemaScore;      // Line 265
factors.faqContent = faqContentScore;    // Line 266

// Transformation layer (scan.js:1650-1651) maps to:
faqSchemaScore: (directAnswer.factors?.faqSchema || 0) * 50,  // 0-2 → 0-100
faqContentScore: (directAnswer.factors?.faqContent || 0) * 50, // 0-2 → 0-100

// issue-detector.js receives (correctly named):
aiSearchReadiness: {
  faqSchemaScore: 70,   // Threshold - matches transformed name
  faqContentScore: 70,  // Threshold - matches transformed name
}
```

**KEY:** The transformation layer properly converts:
- Factor names (adds "Score" suffix where needed)
- Score scales (0-2 → 0-100, 0-1.8 → 0-100, etc.)
- Nested structures to flat objects

**Sitemap Transformation (scan.js:1712):**
```javascript
sitemapScore: (crawler.factors?.sitemap || 0) * 55.6,  // 0-1.8 → 0-100
```

### FAILURE CATEGORY B: Sitemap Detection Pipeline Gap

**Severity: HIGH**

Sitemap detection happens in multiple places with potential gaps:

1. **site-crawler.js:93-94** - Sets `this.sitemapDetected = true` when sitemap found
2. **site-crawler.js:422-423** - Passes to aggregated evidence as `sitemapDetected`
3. **v5-enhanced-rubric-engine.js:86-89** - Copies to `this.evidence.technical.hasSitemap`
4. **v5-enhanced-rubric-engine.js:655-661** - Scores based on `this.siteData.sitemapDetected`

**Potential Issue:** The evidence object has both:
- `this.siteData.sitemapDetected` (used for scoring)
- `this.evidence.technical.hasSitemap` (may not be used)

This redundancy could cause confusion and bugs if one is set but not the other.

### FAILURE CATEGORY C: Blog/Navigation Detection Not Implemented

**Severity: CRITICAL**

There is **NO explicit detection** for:
- Blog section presence
- Blog link in navigation
- Blog page count
- Blog post schema (Article, BlogPosting, NewsArticle)

The only blog-related logic is in `site-crawler.js:351`:
```javascript
else if (lower.includes('/blog') || lower.includes('/article')) score = priorities.blog;
```

This only affects URL prioritization, not detection or scoring!

**Impact:** The system cannot report whether a site has a blog section.

### FAILURE CATEGORY D: FAQ Content Detection Completeness

**Severity: MEDIUM**

The FAQ extraction in `content-extractor.js:381-511` uses 4 methods:
1. JSON-LD FAQPage schema (Method 0)
2. Microdata schema markup (Method 1)
3. FAQ sections by class/id (Method 2)
4. Question-like headings (Method 3)

**Potential Issues:**
- Method 2 selectors may miss modern frameworks (React, Vue component classes)
- Method 3 only runs if `faqs.length === 0` - so if schema FAQs exist, visible FAQs won't be scanned
- Details/summary detection may miss nested structures

### FINDING E: Score-to-Issue Transformation (RESOLVED)

**Status: WORKING CORRECTLY**

The transformation layer in `scan.js:1626-1752` properly flattens the V5 nested structure:

```javascript
// V5 engine returns nested structure:
{
  aiSearchReadiness: {
    score: 75,
    weight: 0.20,
    subfactors: {
      directAnswerStructure: { score: 80, factors: {...} },
      topicalAuthority: { score: 70, factors: {...} }
    }
  }
}

// transformV5ToSubfactors() (scan.js:1640-1658) outputs flat structure:
{
  aiSearchReadiness: {
    questionHeadingsScore: 50,
    scannabilityScore: 60,
    readabilityScore: 70,
    faqSchemaScore: 0,
    faqContentScore: 40,
    snippetEligibleScore: 50,
    pillarPagesScore: 30,
    linkedSubpagesScore: 40,
    painPointsScore: 50,
    geoContentScore: 50
  }
}
```

**KEY:** The transformation layer is explicitly called at `scan.js:1802`:
```javascript
const subfactorScores = transformV5ToSubfactors(v5Results.categories);
```

This flattened `subfactorScores` object is then passed to the recommendation generator.

### FAILURE CATEGORY F: Issue-to-Recommendation Mapping

**Severity: MEDIUM**

The recommendation generator only processes top 5 issues:
```javascript
const BATCH_SIZE = 5;
const issuesToProcess = issues.slice(0, BATCH_SIZE);
```

If FAQ issues are detected but ranked 6th or lower, they won't get recommendations.

Also, the generator checks for specific subfactor names:
```javascript
if (issue.subfactor === 'faqSchemaScore') {  // Line 282
if (issue.subfactor === 'faqContentScore') { // Line 295
```

These must match the names coming from the issue detector.

---

## Part 4: Missing Detection Features

### Features Not Implemented

1. **Blog Detection**
   - No detection of blog section/page
   - No counting of blog posts
   - No analysis of blog content frequency

2. **Team Page Detection**
   - Only basic author meta tag checked
   - No detection of Team/About Us pages with team members
   - No Person schema analysis for team

3. **Contact Information Detection**
   - No explicit contact page detection
   - No phone/email/address extraction from content
   - No LocalBusiness contactPoint analysis

4. **Testimonials/Reviews Detection**
   - No Review schema detection
   - No testimonial section detection
   - No rating/review aggregate detection

5. **Social Proof Detection**
   - sameAs links counted but not scored meaningfully
   - No client logo detection
   - No case study detection

6. **Service Area Detection**
   - GeoCoordinates detected but not analyzed
   - No areaServed schema analysis
   - No service area page detection

---

## Part 5: Prioritized Fix Recommendations

### P0 - Critical Pipeline Fixes

**GOOD NEWS:** The critical score transformation layer EXISTS and is WORKING!
- `transformV5ToSubfactors()` in `scan.js:1626-1752` properly bridges V5 to issue detection
- Subfactor naming is consistent between transformer and issue detector
- Scale conversions (0-2 → 0-100, etc.) are handled correctly

No P0 critical fixes needed for the transformation pipeline.

### P1 - High Priority Detection Fixes

1. **Add Blog Detection** ⚠️ NOT IMPLEMENTED
   - Location: `content-extractor.js`, `v5-enhanced-rubric-engine.js`
   - Issue: No blog section detection exists anywhere in the codebase
   - Impact: Cannot report or score blog presence
   - Fix: Add blog link detection, article count, blog schema detection (BlogPosting, NewsArticle)
   - Estimated effort: 4-6 hours

2. **Consolidate Sitemap Detection**
   - Location: `site-crawler.js`, `v5-enhanced-rubric-engine.js`
   - Issue: Multiple sitemap detection paths that could desync
   - Impact: May report inconsistent sitemap status
   - Fix: Single source of truth for sitemap status
   - Estimated effort: 2-3 hours

### P2 - Medium Priority Enhancements

3. **Improve FAQ Content Detection**
   - Location: `content-extractor.js:381-511`
   - Issue: Method 3 (question headings) only runs if `faqs.length === 0`
   - Impact: May miss visible FAQs when schema FAQs exist
   - Fix: Always scan for visible FAQs regardless of schema FAQs
   - Estimated effort: 1-2 hours

4. **Add Team/Contact Detection**
   - Location: `content-extractor.js`
   - Issue: No team page or contact detection
   - Fix: Add Person schema analysis, team section detection
   - Estimated effort: 3-4 hours

5. **Verify Geo Detection Pipeline**
   - Location: `content-extractor.js`, `v5-enhanced-rubric-engine.js`
   - Issue: GeoCoordinates extracted but check scoring path
   - Fix: Trace geoContentScore calculation end-to-end
   - Estimated effort: 1 hour

### P3 - Lower Priority Improvements

6. **Add Testimonial/Review Detection**
   - No Review schema detection
   - No testimonial section detection
   - Estimated effort: 2-3 hours

7. **Add Service Area Analysis**
   - areaServed schema not analyzed
   - Service area page detection missing
   - Estimated effort: 2-3 hours

8. **Improve Social Proof Detection**
   - sameAs links counted but not scored meaningfully
   - Client logo detection missing
   - Estimated effort: 2-3 hours

---

## Part 6: Test Matrix

### Tests Needed

| Test Case | Feature | Input | Expected Output | File to Modify |
|-----------|---------|-------|-----------------|----------------|
| T1 | FAQ Schema | Page with FAQPage JSON-LD | hasFAQSchema = true, faqSchemaScore > 0 | content-extractor.js |
| T2 | FAQ Content | Page with visible FAQ accordion | faqs.length > 0, faqContentScore > 0 | content-extractor.js |
| T3 | Sitemap | Site with sitemap.xml | sitemapDetected = true, sitemapScore > 0 | site-crawler.js |
| T4 | Blog | Site with /blog page | blogDetected = true (NOT IMPLEMENTED) | N/A |
| T5 | Geo | Site with LocalBusiness + GeoCoordinates | geoCoordinatesSchema = true | content-extractor.js |
| T6 | Issue Detection | V5 scores below threshold | Issues array populated | issue-detector.js |
| T7 | Recommendations | Issues array | Recommendations generated | rec-generator.js |

---

## Appendix A: File Reference

| File | Location | Purpose |
|------|----------|---------|
| content-extractor.js | `backend/analyzers/` | Extract all content from HTML |
| site-crawler.js | `backend/analyzers/` | Multi-page crawling and aggregation |
| v5-enhanced-rubric-engine.js | `backend/analyzers/` | Main scoring engine |
| issue-detector.js | `backend/analyzers/recommendation-engine/` | Detect issues from scores |
| rec-generator.js | `backend/analyzers/recommendation-engine/` | Generate recommendations |
| tier-filter.js | `backend/analyzers/recommendation-engine/` | Filter output by user tier |
| entity-analyzer.js | `backend/analyzers/` | Entity recognition and knowledge graph |
| scan.js | `backend/routes/` | API endpoint for scans |

---

## Appendix B: Detection Audit Test Script

A comprehensive test script has been created at:
`backend/tests/detection-audit.js`

This script tests detection across multiple sites and compares expected vs. actual results.

---

**End of Audit Report**
