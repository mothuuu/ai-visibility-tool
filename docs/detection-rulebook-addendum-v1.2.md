# Detection & Extraction Rulebook - Addendum v1.2

**Purpose:** Complete additions to merge into the main Detection & Extraction Rulebook.  
**Audit Date:** December 20, 2025  
**Issues Addressed:** 13 violations with ALL detailed fixes

---

## SECTION 1.5: Mandatory Extraction Sequence

### 1.5.1 The Core Problem

Navigation, header, footer, and aside elements are being removed BEFORE extraction, destroying evidence.

### 1.5.2 Solution: Clone DOM Approach (Preferred)

Create two DOM copies - one for structure/navigation, one for content:

```javascript
async extract(html, url) {
  const cheerio = require('cheerio');
  
  // APPROACH: Clone DOM - one for structure, one for content
  const $full = cheerio.load(html);    // Clone 1: Full DOM
  const $content = cheerio.load(html); // Clone 2: For cleanup
  
  // PHASE A: Extract from FULL DOM (before any removal)
  const navigation = this.extractNavigation($full);
  const structure = this.extractStructure($full);
  const structuredData = this.extractStructuredData($full);
  const faqs = this.extractFAQs($full, structuredData);
  const technical = this.extractTechnicalSignals($full);
  
  // PHASE B: Extract from CLEANED DOM (after removal)
  $content('script, style, nav, header, footer, aside').remove();
  const content = this.extractContent($content);
  
  // PHASE C: Assemble complete evidence object
  return { url, navigation, structure, content: { ...content, faqs }, technical };
}
```

### 1.5.3 Alternative: Sequential Extraction

```javascript
// Extract in strict order BEFORE any removal
const navigation = this.extractNavigation($);  // Step 1
const structure = this.extractStructure($);    // Step 2
const structuredData = this.extractStructuredData($);  // Step 3
const faqs = this.extractFAQs($, structuredData);  // Step 4

// NOW remove elements
$('script, style, nav, header, footer, aside').remove();

// Extract cleaned content
const content = this.extractContent($);  // Step 5
```

---

## SECTION 2.2.6: FAQ Detection - Complete Specification

### Required Evidence Fields

```typescript
interface FAQDetectionEvidence {
  detected: boolean;
  count: number;
  source: 'schema' | 'content' | 'heading' | 'navigation' | 'crawler' | 'none';
  confidence: 'high' | 'medium' | 'low';
  
  // Source-specific evidence (ALL REQUIRED)
  hasFAQSchema: boolean;
  schemaFAQCount: number;
  hasOnPageFAQs: boolean;
  onPageFAQCount: number;
  hasFAQHeading: boolean;
  faqHeadingText: string | null;
  hasFAQNavLink: boolean;           // ← REQUIRED
  faqNavLinkHref: string | null;    // ← REQUIRED
  faqNavLinkText: string | null;    // ← REQUIRED
  crawlerFoundFAQ: boolean;         // ← REQUIRED
  faqPageUrl: string | null;        // ← REQUIRED
  faqPageUrls: string[];            // ← REQUIRED
}
```

### Detection Rule

Accept FAQ presence if ANY of these is true:
- FAQs extracted on current page
- FAQPage schema found anywhere
- nav/footer contains FAQ link text or `/faq`
- crawler found `/faq` or FAQ-like page

---

## SECTION 2.4.4: Blog Detection - Complete Specification

### Extended Vocabulary (Synonyms)

```javascript
const URL_PATTERNS = {
  blog: /\/(blog|news|articles|insights|resources|updates|journal|posts|learn|knowledge-base|help-center|guides|library|content)(\.html?|\/|$)/i,
};

const BLOG_NAV_KEYWORDS = [
  'blog', 'news', 'articles', 'insights', 'resources', 
  'updates', 'journal', 'learn', 'knowledge', 'guides',
  'library', 'content', 'stories', 'perspectives'
];
```

### Required Evidence Fields

```typescript
interface BlogDetectionEvidence {
  detected: boolean;
  source: 'url' | 'schema' | 'navigation' | 'crawler' | 'sitemap' | 'none';
  
  currentPageIsBlog: boolean;
  hasArticleSchema: boolean;
  articleSchemaType: string | null;
  hasBlogNavLink: boolean;           // ← REQUIRED
  blogNavLinkHref: string | null;    // ← REQUIRED
  blogNavLinkText: string | null;    // ← REQUIRED
  crawlerFoundBlog: boolean;         // ← REQUIRED
  blogPageUrl: string | null;        // ← REQUIRED
  blogPageUrls: string[];            // ← REQUIRED
  sitemapFoundBlog: boolean;         // ← NEW
  sitemapBlogUrls: string[];         // ← NEW
}
```

### Multi-Source Detection

Check ALL sources:
1. Nav link text + href patterns
2. Crawler-discovered URLs
3. Sitemap URLs
4. Schema (Article, BlogPosting, NewsArticle)
5. Heading patterns on linked pages

---

## SECTION 3.1.4: JSON-LD @graph Processing with Source Tracking

### Source Location Tracking

Store exact location for debugging:

```javascript
if (jsonLd['@graph'] && Array.isArray(jsonLd['@graph'])) {
  jsonLd['@graph'].forEach((item, graphIndex) => {
    schemas.push({
      type: item['@type'],
      data: item,
      source: 'json-ld-graph',
      sourcePath: `script[${scriptIndex}].@graph[${graphIndex}]`,  // ← REQUIRED
      scriptIndex,
      graphIndex
    });
  });
}
```

---

## SECTION 4.5.2: detectMultiPageIssues() as Default

**Rule:** When crawl data exists, `detectMultiPageIssues()` MUST be the default detection mode.

```javascript
function detectIssues(scanEvidence) {
  const hasCrawlData = scanEvidence.siteMetrics?.totalDiscoveredUrls > 0;
  
  if (hasCrawlData) {
    return detectMultiPageIssues(scanEvidence);  // Site-wide detection
  } else {
    return detectSinglePageIssues(scanEvidence);  // Page-only fallback
  }
}

function detectMultiPageIssues(scanEvidence) {
  const siteMetrics = scanEvidence.siteMetrics || {};
  
  // Site-level confirmations
  const siteHasBlog = siteMetrics.discoveredSections?.hasBlogUrl ||
                      siteMetrics.pagesWithArticleSchema > 0;
  
  const siteHasFAQ = siteMetrics.discoveredSections?.hasFaqUrl ||
                     siteMetrics.totalFAQsFound > 0;
  
  // Only flag as missing if NOT found across ENTIRE site
  const issues = [];
  if (!siteHasBlog) issues.push({ category: 'pillarPages', issue: 'No blog across site' });
  if (!siteHasFAQ) issues.push({ category: 'faqContent', issue: 'No FAQ across site' });
  
  return issues;
}
```

---

## SECTION 7.3: Enhanced Content Extraction

### 7.3.1 Extract List Items as Content Units

```javascript
$('ul li, ol li').each((i, el) => {
  const text = $(el).text().trim();
  if (text.length >= 10) {
    content.listItems.push({
      text,
      type: $(el).parent().is('ol') ? 'ordered' : 'unordered'
    });
  }
});
```

### 7.3.2 Extract Accordion/Tab Content

```javascript
// details/summary elements
$('details').each((i, el) => {
  const summary = $(el).find('summary').text().trim();
  const answer = $(el).clone().find('summary').remove().end().text().trim();
  if (summary && answer) {
    content.accordions.push({ question: summary, answer, source: 'details' });
  }
});

// aria-expanded patterns
$('[aria-expanded]').each((i, el) => {
  const controlsId = $(el).attr('aria-controls');
  const question = $(el).text().trim();
  const answer = $(`#${controlsId}`).text().trim();
  if (question && answer) {
    content.accordions.push({ question, answer, source: 'aria-expanded' });
  }
});

// CSS accordion patterns
$('.accordion-item, .faq-item, [class*="accordion"]').each((i, el) => {
  const header = $(el).find('[class*="header"], [class*="title"]').first().text().trim();
  const body = $(el).find('[class*="body"], [class*="content"]').first().text().trim();
  if (header && body) {
    content.accordions.push({ question: header, answer: body, source: 'css' });
  }
});
```

### 7.3.3 Smart Content Filtering (No Blind <20 Char Discard)

```javascript
filterContent(paragraphs) {
  return paragraphs.filter(p => {
    const text = p.trim();
    
    if (text.length < 20) {
      // Keep if meaningful short content
      if (/\?$/.test(text)) return true;              // Questions
      if (/^[A-Z][^.!?]*$/.test(text)) return true;   // Heading-like
      if (/price|cost|free|contact/i.test(text)) return true;  // Key terms
      return false;
    }
    
    // Discard boilerplate
    if (/^(copyright|all rights reserved|loading)/i.test(text)) return false;
    
    return true;
  });
}
```

### 7.3.4 Adaptive Content Limits by Page Type

```javascript
const CONTENT_LIMITS = {
  default: { maxParagraphs: 100, maxCharsTotal: 25000 },
  homepage: { maxParagraphs: 150, maxCharsTotal: 30000 },
  blog: { maxParagraphs: 200, maxCharsTotal: 50000 },
  faq: { maxParagraphs: 300, maxCharsTotal: 40000 }
};
```

---

## SECTION 7.6: Scoring States (No Default to 50)

### 7.6.1 Valid Score States

```typescript
type ScoreState = 
  | number           // 0-100: Measured score
  | null             // Not measured
  | 'not_measured'   // Explicitly not measured
  | 'not_applicable' // Doesn't apply to this site
  | 'error';         // Measurement failed
```

### 7.6.2 Implementation Rule

```javascript
// ❌ WRONG: Default to 50
geoContentScore: hasGeoSignal ? 100 : 50,

// ✅ CORRECT: Evidence-based with explicit null
geoContentScore: (() => {
  if (hasLocalBusinessSchema) return 100;
  if (hasGeoMeta) return 70;
  if (mentionsLocations) return 50;
  return 0;  // No evidence = 0, not 50
})(),
```

Only score when evidence exists. Use `null` or `'not_measured'` when unable to determine.

---

## SECTION 8.4: JS-Rendered Site Detection

### Detection Thresholds

```javascript
function detectJSRenderedSite($, html) {
  const bodyText = $('body').text().trim();
  
  const indicators = {
    emptyBody: bodyText.length < 500,
    hasReactRoot: $('#root, [data-reactroot]').length > 0,
    hasVueApp: $('[data-v-], [v-cloak]').length > 0,
    hasAngular: $('[ng-app], app-root').length > 0,
    hasLoadingState: /loading\.\.\.|please wait/i.test(bodyText),
    emptyMainContent: $('main, #content, article').text().trim().length < 100
  };
  
  const isJSRendered = indicators.emptyBody ||
                       (indicators.hasReactRoot && indicators.emptyMainContent) ||
                       indicators.hasLoadingState;
  
  return {
    isJSRendered,
    indicators,
    recommendation: isJSRendered 
      ? 'JS-rendered site; scan may be incomplete without headless rendering'
      : null
  };
}
```

### Fallback Headless Rendering

When `isJSRendered === true` and headless is available:
1. Launch Puppeteer/Playwright
2. Wait for `networkidle2` + 2s delay
3. Return rendered HTML
4. Flag `source: 'headless'` in evidence

---

## SECTION 10.5: Complete Evidence Schema

### Full Namespace Structure

```typescript
interface ScanEvidence {
  url: string;
  
  navigation: { keyPages, allNavLinks, footerLinks, hasSemanticNav, hasHeader, hasFooter };
  structure: { hasNav, hasHeader, hasFooter, hasMain, headingHierarchy };
  content: { paragraphs, headings, faqs, listItems, accordions, tabs };
  
  technical: {
    structuredData: Schema[];  // With sourcePath for each
    hasFAQSchema, hasArticleSchema, hasOrganizationSchema, hasLocalBusinessSchema;
    
    canonical: { detected, url, source, matchesUrl };
    hreflang: { detected, languages, defaultLang };
    openGraph: { title, description, image, url, type };
    twitterCard: { card, site, title, description, image };
    indexNow: { detected, keyLocation, keyVerified };
    feeds: { detected, urls, types };
  };
  
  aiReadiness: { questionHeadings, snippetEligibility, answerability };
  trust: { authorBios, testimonials, certifications, thirdPartyProfiles, teamPage, caseStudies };
  voice: { conversationalContent, speakableSchema, longTailKeywords };
  freshness: { lastModified, publishDate, updateFrequency };
  
  crawler: {
    discoveredSections, totalDiscoveredUrls;
    robotsTxt: { found, allowsAllAI, blockedAICrawlers, hasAISpecificRules };
    sitemap: { detected, location, pageCount, source };
    aggregateMetrics: { totalFAQsFound, pagesWithFAQs, pagesWithSchema };
  };
  
  siteMetrics: crawler;  // Alias for backward compatibility
}
```

---

## SECTION 11.4: Technical Signal Detectors

### 11.4.1 Canonical (Tag + Header)

```javascript
function extractCanonical($, headers) {
  // Check <link rel="canonical">
  const tag = $('link[rel="canonical"]').attr('href');
  // Check Link header
  const header = headers?.link?.match(/<([^>]+)>;\s*rel="canonical"/)?.[1];
  return { detected: !!(tag || header), url: tag || header, source: tag ? 'tag' : 'header' };
}
```

### 11.4.2 Open Graph + Twitter

```javascript
function extractOpenGraph($) {
  return {
    title: $('meta[property="og:title"]').attr('content'),
    description: $('meta[property="og:description"]').attr('content'),
    image: $('meta[property="og:image"]').attr('content'),
    url: $('meta[property="og:url"]').attr('content'),
    type: $('meta[property="og:type"]').attr('content')
  };
}

function extractTwitterCard($) {
  return {
    card: $('meta[name="twitter:card"]').attr('content'),
    site: $('meta[name="twitter:site"]').attr('content'),
    title: $('meta[name="twitter:title"]').attr('content'),
    description: $('meta[name="twitter:description"]').attr('content'),
    image: $('meta[name="twitter:image"]').attr('content')
  };
}
```

### 11.4.3 IndexNow + Verification

```javascript
async function detectIndexNow($, baseUrl) {
  const key = $('meta[name="indexnow-key"]').attr('content');
  if (!key) return { detected: false };
  
  // Verify key file exists
  const keyFileUrl = `${baseUrl}/${key}.txt`;
  const verified = await axios.head(keyFileUrl).then(() => true).catch(() => false);
  
  return { detected: true, keyLocation: 'meta', keyVerified: verified };
}
```

### 11.4.4 RSS/Atom Feeds

```javascript
function extractFeeds($) {
  const feeds = [];
  $('link[type="application/rss+xml"]').each((i, el) => feeds.push({ url: $(el).attr('href'), type: 'rss' }));
  $('link[type="application/atom+xml"]').each((i, el) => feeds.push({ url: $(el).attr('href'), type: 'atom' }));
  return { detected: feeds.length > 0, feeds };
}
```

### 11.4.5 Robots.txt AI Crawler Parsing

```javascript
const AI_CRAWLERS = [
  'GPTBot', 'ChatGPT-User', 'Claude-Web', 'Anthropic-AI', 'ClaudeBot',
  'PerplexityBot', 'Google-Extended', 'CCBot', 'Bytespider', 'Amazonbot', 'Cohere-ai'
];

async function parseRobotsTxt(url) {
  const response = await axios.get(url);
  const lines = response.data.split('\n');
  
  const result = { found: true, allowsAllAI: true, blockedAICrawlers: [], hasAISpecificRules: false };
  let currentUA = null;
  
  for (const line of lines) {
    if (line.toLowerCase().startsWith('user-agent:')) {
      currentUA = line.substring(11).trim();
    } else if (line.toLowerCase().startsWith('disallow:') && currentUA) {
      const path = line.substring(9).trim();
      
      for (const crawler of AI_CRAWLERS) {
        if (currentUA.toLowerCase() === crawler.toLowerCase() && (path === '/' || path === '/*')) {
          result.hasAISpecificRules = true;
          result.blockedAICrawlers.push(crawler);
          result.allowsAllAI = false;
        }
      }
    }
  }
  
  return result;
}
```

---

## SECTION 9.5: Third-Party Profile Detection

### sameAs Parsing + Footer Links

```javascript
const KNOWN_PLATFORMS = {
  'linkedin.com': 'LinkedIn', 'g2.com': 'G2', 'capterra.com': 'Capterra',
  'trustpilot.com': 'Trustpilot', 'crunchbase.com': 'Crunchbase',
  'clutch.co': 'Clutch', 'producthunt.com': 'Product Hunt'
};

function extractThirdPartyProfiles(scanEvidence) {
  const profiles = [];
  
  // Source 1: sameAs from Organization schema
  const orgSchema = scanEvidence.technical?.structuredData?.find(s => s.type === 'Organization');
  const sameAs = orgSchema?.data?.sameAs || [];
  (Array.isArray(sameAs) ? sameAs : [sameAs]).forEach(url => {
    const platform = identifyPlatform(url);
    if (platform) profiles.push({ url, platform, source: 'sameAs' });
  });
  
  // Source 2: Footer links
  const footerLinks = scanEvidence.navigation?.footerLinks || [];
  footerLinks.forEach(link => {
    const platform = identifyPlatform(link.href);
    if (platform && !profiles.find(p => p.url === link.href)) {
      profiles.push({ url: link.href, platform, source: 'footer' });
    }
  });
  
  return { detected: profiles.length > 0, profiles };
}

function identifyPlatform(url) {
  for (const [domain, name] of Object.entries(KNOWN_PLATFORMS)) {
    if (url?.includes(domain)) return name;
  }
  return null;
}
```

---

## Implementation Checklist

| # | Fix | Status |
|---|-----|--------|
| 1 | Clone DOM approach for extraction | ☐ |
| 2 | Extended blog vocabulary (insights, resources, learn, etc.) | ☐ |
| 3 | Store all FAQ evidence fields (hasFAQNavLink, faqNavLinkHref, etc.) | ☐ |
| 4 | Store all Blog evidence fields (hasBlogNavLink, etc.) | ☐ |
| 5 | JSON-LD source path tracking (script[2].@graph[5]) | ☐ |
| 6 | detectMultiPageIssues() as default when crawl data exists | ☐ |
| 7 | List item extraction as content units | ☐ |
| 8 | Accordion/details/tab extraction | ☐ |
| 9 | Smart content filtering (no blind <20 char discard) | ☐ |
| 10 | Adaptive content limits by page type | ☐ |
| 11 | JS-rendered site detection + warning | ☐ |
| 12 | Null/not_measured score states (no default 50) | ☐ |
| 13 | Full evidence namespace structure | ☐ |
| 14 | Canonical detection (tag + header) | ☐ |
| 15 | Open Graph detection | ☐ |
| 16 | Twitter Card detection | ☐ |
| 17 | IndexNow detection + key verification | ☐ |
| 18 | RSS/Atom feed detection | ☐ |
| 19 | Robots.txt AI crawler parsing | ☐ |
| 20 | Third-party profile detection (sameAs + footer) | ☐ |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-12 | Initial rulebook |
| 1.1 | 2025-12-20 | Basic addendum |
| 1.2 | 2025-12-20 | **Complete specification** with all 20 implementation items |
