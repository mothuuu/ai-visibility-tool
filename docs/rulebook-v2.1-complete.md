# Detection Rulebook v2.1 - Complete Requirements

## Changelog from v2.0
- Added URL canonicalization policy (redirect handling, prefer site's canonical)
- Added SSRF protection requirements
- Added tier invariance rule with explicit examples
- Added tri-state aggregation + UI requirements
- Added crawl policy (budgets, traps, deduplication)
- Added test matrix requirement with fixture list
- Strengthened explainability requirements

---

# 1. Evidence Contract Specification

## 1.1 Contract Versioning

```
Current Version: 2.0.0
```

**RULE:** Contract version MUST be included in every evidence object. Version changes:
- PATCH (2.0.x): Additions to optional fields, documentation changes
- MINOR (2.x.0): New optional namespaces, new fields in existing namespaces
- MAJOR (x.0.0): Removed namespaces, changed required fields, breaking changes

**RULE:** Consumers MUST check `contractVersion` and handle version mismatches gracefully.

## 1.2 Required Namespaces

| Namespace | Required | Validation |
|-----------|----------|------------|
| `url` | ✅ YES | Non-empty string |
| `timestamp` | ✅ YES | ISO8601 format |
| `contractVersion` | ✅ YES | Semver string |
| `navigation` | ✅ YES | Object with keyPages |
| `structure` | ✅ YES | Object with hasNav, hasHeader, etc. |
| `content` | ✅ YES | Object with paragraphs, wordCount |
| `technical` | ✅ YES | Object with structuredData, schema flags |

## 1.3 Expected Namespaces

| Namespace | Expected | Impact if Missing |
|-----------|----------|-------------------|
| `crawler` | ⚠️ YES | Site-wide detection limited |
| `siteMetrics` | ⚠️ YES | Sitemap-based detection unavailable |

## 1.4 Future Namespaces (Defined Shape)

These MUST exist in evidence (even if empty) to prevent ad-hoc field invention:

```javascript
aiReadiness: {
  questionHeadings: null,
  snippetEligibility: null,
  answerability: null
}

trust: {
  authorBios: null,
  testimonials: null,
  thirdPartyProfiles: null,
  teamPage: null,
  caseStudies: null
}

voice: {
  speakableContent: null,
  conversationalQueries: null
}

freshness: {
  lastModified: null,
  publishDate: null,
  updateFrequency: null
}
```

**RULE:** Detectors CANNOT invent new top-level fields. All fields must come from the contract.

## 1.5 Attribution Format

Every detected signal MUST include attribution:

```typescript
interface Attribution {
  source: 'header' | 'nav' | 'footer' | 'schema' | 'sitemap' | 'crawler' | 'content' | 'meta';
  sourcePath?: string;  // e.g., 'script[0].@graph[2]', 'footer a[5]'
  confidence: 'high' | 'medium' | 'low';
}
```

## 1.6 Validation Enforcement

**RULE:** `validateEvidence()` MUST be called after evidence construction.

| Environment | Behavior on Invalid |
|-------------|---------------------|
| Development | THROW error |
| Test | THROW error |
| Production | LOG warning, continue |

---

# 2. URL Canonicalization Policy

## 2.1 Canonicalization Flow

```
User Input URL
    ↓
Normalize (add scheme, lowercase host, remove tracking params)
    ↓
Follow Redirects (max 5)
    ↓
Check <link rel="canonical">
    ↓
Final Canonical URL = canonical tag || final redirect URL || normalized URL
```

## 2.2 What Gets Stored

```javascript
metadata: {
  requestedUrl: "www.example.com",           // What user entered
  normalizedUrl: "https://www.example.com",  // After basic normalization
  finalUrl: "https://example.com",           // After redirects
  canonicalUrl: "https://example.com",       // What site declares (or finalUrl)
  redirectCount: 1
}
```

## 2.3 Rules

**RULE:** Do NOT force `www` removal. Prefer what the site declares.

**RULE:** Use `canonicalUrl` as:
- Cache key
- Database primary key
- Crawler deduplication key
- Evidence `url` field

**RULE:** Store `requestedUrl` for debugging but never use it for comparisons.

## 2.4 Tracking Parameters to Strip

```
utm_source, utm_medium, utm_campaign, utm_term, utm_content
fbclid, gclid, msclkid, dclid
ref, source, mc_cid, mc_eid
```

---

# 3. Multi-Source Detection Standards

## 3.1 Source Precedence

For each detection, check sources in order. Stop when found with HIGH confidence.

### Blog Detection

| Priority | Source | Confidence | Evidence Path |
|----------|--------|------------|---------------|
| 1 | Sitemap classification | HIGH | `siteMetrics.sitemap.blogUrls` |
| 2 | Crawler discoveredSections | HIGH | `crawler.discoveredSections.hasBlogUrl` |
| 3 | Nav/header links | MEDIUM | `navigation.keyPages.blog` |
| 4 | Footer links | MEDIUM | `navigation.footerLinks` |
| 5 | Article schema | MEDIUM | `technical.hasArticleSchema` |
| 6 | Current URL pattern | LOW | URL matching `/blog/` |

### FAQ Detection

| Priority | Source | Confidence | Evidence Path |
|----------|--------|------------|---------------|
| 1 | FAQPage schema | HIGH | `technical.hasFAQSchema` |
| 2 | Sitemap classification | HIGH | `siteMetrics.sitemap.faqUrls` |
| 3 | Crawler discoveredSections | HIGH | `crawler.discoveredSections.hasFaqUrl` |
| 4 | On-page FAQ content | MEDIUM | `content.faqs` |
| 5 | Nav/footer FAQ link | MEDIUM | `navigation.keyPages.faq` |
| 6 | FAQ-style headings | LOW | H2 containing "FAQ" |

## 3.2 Detection Output Shape

Every detector MUST return:

```typescript
interface DetectorResult {
  detected: boolean;
  confidence: 'high' | 'medium' | 'low' | 'none';
  sources: {
    name: string;
    checked: boolean;
    found: boolean;
    value?: any;
    evidenceRef: string;
  }[];
  summary: string;
}
```

## 3.3 Confidence Requirements for Issues

| Issue Severity | Minimum Source Confidence to NOT Generate Issue |
|----------------|------------------------------------------------|
| HIGH | Any source at LOW or above → do not generate |
| MEDIUM | Any source at MEDIUM or above → do not generate |
| LOW | Only HIGH confidence → do not generate |

**Translation:** Only generate "missing blog" if NO source found it at MEDIUM+ confidence.

---

# 4. Tier Behavior Rules

## 4.1 Core Principle

**RULE:** Detection MUST be consistent across all tiers. Payment tier affects OUTPUT, not TRUTH.

## 4.2 Tier Invariance Examples

```javascript
// CORRECT: Same detection, different output
function processIssues(issues, tier) {
  // Detection already happened - same for all tiers
  
  if (tier === 'freemium') {
    return issues.slice(0, 3).map(i => ({
      ...i,
      evidence: undefined,  // Hide detailed evidence
      sources: undefined    // Hide source breakdown
    }));
  }
  
  return issues;  // Full detail for paid tiers
}

// WRONG: Different detection based on tier
function detectIssues(evidence, tier) {
  if (tier === 'freemium') {
    return detectPageIssues(evidence);  // ❌ WRONG
  }
  return detectSiteWideIssues(evidence);
}
```

## 4.3 What Tiers CAN Limit

| Aspect | Free | DIY | Premium | Agency |
|--------|------|-----|---------|--------|
| Crawl depth (pages) | 1 | 5 | 25 | 100 |
| Issues shown | 3 | 10 | All | All |
| Evidence detail | Hidden | Summary | Full | Full + Debug |
| Export formats | None | PDF | PDF + CSV | All |
| Historical data | None | None | 3 months | 12 months |

## 4.4 What Tiers CANNOT Change

- Detection algorithm selection (if crawl data exists, use site-wide)
- Score calculation formula
- Issue identification logic
- Evidence collection scope

---

# 5. Tri-State Scoring Rules

## 5.1 Score States

| State | Score Value | When to Use |
|-------|-------------|-------------|
| `measured` | 0-100 | Data available, calculation performed |
| `not_measured` | null | Insufficient data to calculate |
| `not_applicable` | null | Metric doesn't apply to site type |

## 5.2 Never Use Defaults

**RULE:** Never use neutral values (like 50) to fill missing data.

```javascript
// WRONG
if (!hasEnoughData) return 50;

// CORRECT  
if (!hasEnoughData) return notMeasured('Insufficient data');
```

## 5.3 Aggregation Rules

When calculating category/pillar scores:

```javascript
function aggregateScores(subfactors) {
  const measured = subfactors.filter(s => s.state === 'measured');
  
  if (measured.length === 0) {
    return { score: null, state: 'not_measured', reason: 'No subfactors measured' };
  }
  
  // Calculate from MEASURED only, renormalize weights
  const average = measured.reduce((sum, s) => sum + s.score, 0) / measured.length;
  
  return {
    score: Math.round(average),
    state: 'measured',
    measuredCount: measured.length,
    totalCount: subfactors.length
  };
}
```

## 5.4 UI Display Requirements

| State | Display | Color | Include in Average |
|-------|---------|-------|-------------------|
| `measured` | "75" | Green/Yellow/Red based on value | YES |
| `not_measured` | "Not measured" | Gray | NO |
| `not_applicable` | "N/A" | Light gray | NO |

**RULE:** UI must visually distinguish low score (e.g., 20) from not measured. They are NOT the same.

---

# 6. Security & Safety

## 6.1 SSRF Protection

All outbound HTTP requests MUST:

1. **Block private IP ranges after DNS resolution:**
   ```
   127.0.0.0/8    (loopback)
   10.0.0.0/8     (private A)
   172.16.0.0/12  (private B)
   192.168.0.0/16 (private C)
   169.254.0.0/16 (link-local)
   ```

2. **Limit redirects:** Max 5

3. **Enforce timeouts:** Max 10s per request

4. **Validate domain:** Only verify against same registrable domain as scan target

## 6.2 Applied To

- IndexNow key file verification
- Sitemap fetching
- robots.txt fetching
- Any future outbound verification

---

# 7. Crawl Scope & Policy

## 7.1 Crawl Limits by Tier

| Parameter | Free | DIY | Premium | Agency |
|-----------|------|-----|---------|--------|
| Max pages | 1 | 5 | 25 | 100 |
| Max depth | 0 | 2 | 3 | 4 |
| Timeout per page | 10s | 15s | 20s | 30s |
| Total timeout | 30s | 2min | 5min | 15min |

## 7.2 Politeness

```
Delay between requests: 500ms minimum
Respect robots.txt: YES
User-Agent: AIVisibilityBot/1.0 (+https://visible2ai.com/bot)
```

## 7.3 Trap Avoidance

Detect and skip:

| Trap | Pattern | Action |
|------|---------|--------|
| Infinite calendars | `?year=`, `?month=`, `?date=` | Skip after 3 dates |
| Pagination | `?page=`, `?p=` | Limit to 3 pages |
| Search results | `?q=`, `?search=` | Skip entirely |
| Filter combinatorics | Multiple filter params | Skip after 5 combinations |

## 7.4 Deduplication

Before visiting URL:
1. Canonicalize using rules from Section 2
2. Check against visited set
3. Check fragment-only variations
4. Limit query param variations to 3 per base path

---

# 8. JS Rendering Policy

## 8.1 Render Triggers

Render with headless browser when ALL true:
- `isJSRendered === true`
- Main content word count < 50
- Render budget not exhausted

## 8.2 Render Budget by Tier

| Tier | Max Pages Rendered | Timeout |
|------|-------------------|---------|
| Free | 0 | N/A |
| DIY | 2 | 15s |
| Premium | 5 | 20s |
| Agency | 10 | 30s |

## 8.3 Evidence Flags

After rendering:
```javascript
technical: {
  rendered: true,
  renderSource: 'headless',
  renderFallbackReason: 'js_rendered_with_insufficient_content',
  staticContentLength: 45,
  renderedContentLength: 2500
}
```

---

# 9. Explainability Requirements

## 9.1 Core Principle

**RULE:** Every issue MUST include enough information for the user to verify the finding.

## 9.2 Required Issue Fields

```typescript
interface ExplainableIssue {
  // Identity
  id: string;
  category: string;
  subfactor: string;
  
  // Finding
  issue: string;
  severity: 'high' | 'medium' | 'low';
  
  // Explainability (REQUIRED for high/medium)
  sources: {
    name: string;
    checked: boolean;
    found: boolean;
    evidenceRef: string;
  }[];
  evidenceRefs: string[];
  summary: string;  // Human-readable explanation
  
  // Recommendation
  recommendation: string;
}
```

## 9.3 UI Must Show

For each issue:
1. What was checked (list of sources)
2. Which sources found/didn't find the signal
3. Confidence level
4. Link to raw evidence (debug mode)

---

# 10. Test Matrix Requirements

## 10.1 Unit Tests Required

Every detector MUST have tests for:
- All sources present → detected (high confidence)
- Single source present → detected (appropriate confidence)
- No sources present → not detected
- Malformed data handling
- @graph schema parsing

## 10.2 Integration Fixtures

Maintain these canonical test sites:

| Fixture | Pattern | Expected Behavior |
|---------|---------|-------------------|
| `blog-off-homepage` | Blog only linked from /about | Blog detected via crawler |
| `faq-in-graph` | FAQPage only in @graph array | FAQ detected from schema |
| `js-rendered` | React SPA with client routing | Headless triggered |
| `sitemap-index` | Sitemap pointing to child sitemaps | All sitemaps parsed |
| `robots-blocks-ai` | Disallow GPTBot | AI blocker detected |
| `multi-language` | hreflang tags | Languages noted |
| `accordion-faqs` | FAQs in details/summary | FAQs extracted |
| `tabbed-content` | Content in role="tablist" | Tabs extracted |
| `footer-social` | Social links only in footer | Source: 'footer' |
| `empty-page` | Minimal content | Scores are not_measured |
| `www-redirect` | www → non-www redirect | Same canonical URL |
| `canonical-mismatch` | Canonical tag differs from URL | Uses canonical tag |

## 10.3 Fixture Format

Each fixture includes:
```
fixtures/
├── blog-off-homepage/
│   ├── index.html
│   ├── about.html (contains /blog link)
│   ├── blog.html
│   └── expected.json
```

`expected.json`:
```json
{
  "crawler.discoveredSections.hasBlogUrl": true,
  "navigation.keyPages.blog": false,
  "detectors.blog.detected": true,
  "detectors.blog.confidence": "high",
  "detectors.blog.sources.crawler.found": true
}
```

---

# 11. Central Vocabulary

## 11.1 Single Source of Truth

All URL pattern matching MUST use `detection-vocabulary.js`:

```javascript
const URL_PATTERNS = {
  blog: /\/(blog|news|articles|insights|...).../i,
  faq: /\/(faq|faqs|help|support|...).../i,
  // ... etc
};
```

## 11.2 Usage

- Nav link classification
- Sitemap URL classification
- Crawler URL classification
- Current URL detection

**RULE:** No ad-hoc regex patterns in detectors. All patterns from vocabulary.

---

# 12. hasCrawlData Definition

## 12.1 Robust Check

Treat crawl data as present if ANY of:
- `crawler.totalDiscoveredUrls > 0`
- `crawler.discoveredSections` has any `hasXUrl: true`
- `siteMetrics.sitemap.urls.length > 0`
- `crawler.sitemap.detected === true`

```javascript
function hasCrawlData(evidence) {
  if (evidence.crawler?.totalDiscoveredUrls > 0) return true;
  if (evidence.siteMetrics?.sitemap?.urls?.length > 0) return true;
  
  const sections = evidence.crawler?.discoveredSections || {};
  return Object.keys(sections).some(k => k.startsWith('has') && sections[k] === true);
}
```

---

# Summary Checklist

| Requirement | Section | Enforced By |
|-------------|---------|-------------|
| Contract versioning | 1.1 | `validateEvidence()` |
| Required namespaces | 1.2 | `validateEvidence()` |
| Attribution format | 1.5 | Code review |
| URL canonicalization | 2 | `canonicalizeWithRedirects()` |
| Multi-source detection | 3 | Detector output shape |
| Tier invariance | 4 | Code structure |
| Tri-state scoring | 5 | `score-types.js` |
| SSRF protection | 6 | `safe-http.js` |
| Crawl limits | 7 | Crawler config |
| JS render policy | 8 | Extractor config |
| Explainability | 9 | Issue output shape |
| Test fixtures | 10 | CI/CD |
| Central vocabulary | 11 | Import enforcement |
| hasCrawlData | 12 | `evidence-builder.js` |
