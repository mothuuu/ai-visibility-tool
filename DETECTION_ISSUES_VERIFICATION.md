# Detection Issues Verification Report

**Date:** 2025-12-11
**Status:** All 9 Issues Verified

---

## Issue 1: Nav & Footer Stripped Too Early

**Code Location**: `backend/analyzers/content-extractor.js:224-229`

**Confirmed**: PARTIAL - FAQs are extracted BEFORE stripping, but other detection IS affected

**Code Snippet**:
```javascript
extractContent($, structuredData = []) {
  // IMPORTANT: Extract FAQs BEFORE removing footer (FAQs are often in footer!)
  const faqs = this.extractFAQs($, structuredData);

  // Remove script, style, and navigation elements
  $('script, style, nav, header, footer, aside').remove();

  // After this line, ALL subsequent operations lose nav/header/footer content
  const headings = { ... };  // Extracted after removal
  $('p').each((idx, el) => { ... });  // Extracted after removal
```

**Impact**:
- FAQ extraction is PROTECTED (runs before removal)
- BUT: Headings, paragraphs, lists, tables, bodyText are all extracted AFTER nav/footer removal
- Blog links in navigation disappear before we can detect them
- "About", "Services", "Contact", "FAQ" navigation links are lost
- Menu structure analysis is impossible

**Example**:
A site with navigation like `<nav><a href="/blog">Blog</a><a href="/faq">FAQ</a></nav>` - the blog and FAQ links are removed before any detection can find them. If the homepage doesn't have Blog or FAQ content itself, we miss that these sections exist on the site.

---

## Issue 2: Blog Detection Only Checks Current Page

**Code Location**: `backend/analyzers/recommendation-engine/fact-extractor.js:101-106`

**Confirmed**: YES - Critical bug

**Code Snippet**:
```javascript
function detectBlog(scanEvidence) {
  const url = scanEvidence.url || '';
  const hasArticleSchema = scanEvidence.technical?.hasArticleSchema || false;

  return /\/blog|\/news|\/articles/i.test(url) || hasArticleSchema;
}
```

**Impact**:
- ONLY checks if the CURRENT page URL contains "/blog", "/news", or "/articles"
- ONLY checks if the CURRENT page has Article/BlogPosting schema
- Does NOT check for blog links in navigation
- Does NOT check if crawler discovered a /blog page
- Does NOT look for "Blog" in headings or anchor text

**Example**:
User scans `https://example.com` (homepage). The homepage has `<nav><a href="/blog">Blog</a></nav>` linking to their blog. The crawler even discovers `/blog` page. But `detectBlog()` returns `false` because:
1. Current URL is "/" not "/blog"
2. Homepage doesn't have Article schema

Result: Site is NOT marked as having a blog, even though it clearly does.

---

## Issue 3: FAQ Detection Ignores Nav/Footer Links

**Code Location**: `backend/analyzers/content-extractor.js:381-511`

**Confirmed**: YES - FAQ detection only looks at on-page content

**Code Snippet**:
```javascript
extractFAQs($, structuredData = []) {
  const faqs = [];

  // Method 0: Extract FAQs from JSON-LD FAQPage schema
  const faqSchemas = structuredData.filter(sd => sd.type === 'FAQPage');

  // Method 1: Detect FAQs with microdata schema markup
  $('[itemtype*="FAQPage"], [itemtype*="Question"]').each(...)

  // Method 2: Detect FAQ sections by class/id
  const faqSelectors = '[class*="faq" i], [id*="faq" i], ...';

  // Method 3: Look for question-like headings
  if (faqs.length === 0) { $('h2, h3, h4').each(...) }
```

**Impact**:
- Does NOT check for "FAQ" links in navigation (`<nav><a href="/faq">FAQ</a></nav>`)
- Does NOT follow links to dedicated FAQ pages
- Only finds FAQs if they're physically present on the scanned page
- Site-wide FAQ detection relies on the crawler visiting the /faq page directly

**Example**:
Homepage has `<nav><a href="/faq">Frequently Asked Questions</a></nav>` but no FAQ content on the homepage itself. The scanner reports 0 FAQs found, even though there's a dedicated FAQ page. If the crawler doesn't happen to visit /faq, we miss it entirely.

---

## Issue 4: Schema in @graph Sometimes Ignored

**Code Location**: `backend/analyzers/content-extractor.js:610-635, 646-671`

**Confirmed**: NO - This is actually handled correctly!

**Code Snippet**:
```javascript
extractAllSchemaTypes(obj, types = new Set()) {
  if (!obj || typeof obj !== 'object') return types;

  if (obj['@type']) {
    const typeValue = obj['@type'];
    if (Array.isArray(typeValue)) {
      typeValue.forEach(t => types.add(t));
    } else {
      types.add(typeValue);
    }
  }

  // Recursively check all properties (including @graph arrays!)
  for (const key in obj) {
    if (key !== '@type' && obj[key] && typeof obj[key] === 'object') {
      if (Array.isArray(obj[key])) {
        obj[key].forEach(item => this.extractAllSchemaTypes(item, types));
      } else {
        this.extractAllSchemaTypes(obj[key], types);
      }
    }
  }
  return types;
}
```

**Impact**:
- NONE - @graph IS handled correctly
- The recursive `extractAllSchemaTypes()` iterates over ALL object properties
- When `@graph` is an array, it loops through each item with `obj[key].forEach()`
- Nested schemas like FAQPage inside @graph ARE detected

**Example**:
```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "name": "..." },
    { "@type": "FAQPage", "mainEntity": [...] }
  ]
}
```
The FAQPage would be correctly detected because the code recursively searches all arrays.

---

## Issue 5: Navigation Scoring Done After Nav Removal

**Code Location**: `backend/analyzers/content-extractor.js:36-38, 229, 516-553`

**Confirmed**: YES - Critical bug!

**Code Snippet**:
```javascript
// In extract() method (lines 36-38):
const evidence = {
  ...
  content: this.extractContent($, technical.structuredData), // Nav removed HERE
  structure: this.extractStructure($),  // Called AFTER nav removal!
  ...
}

// extractContent removes nav at line 229:
$('script, style, nav, header, footer, aside').remove();

// extractStructure is called AFTER, so these are always wrong:
extractStructure($) {
  return {
    hasNav: $('nav').length > 0,       // Always 0!
    hasHeader: $('header').length > 0,  // Always 0!
    hasFooter: $('footer').length > 0,  // Always 0!
    ...
  }
}
```

**Impact**:
- `hasNav`, `hasHeader`, `hasFooter` will ALWAYS be `false`
- Site structure analysis is fundamentally broken
- Cannot accurately report semantic HTML usage
- Navigation quality scoring is impossible

**Example**:
A site with proper semantic HTML:
```html
<header>...</header>
<nav>...</nav>
<main>...</main>
<footer>...</footer>
```
Would be reported as having `hasNav: false, hasHeader: false, hasFooter: false` because these elements are removed before `extractStructure()` runs.

---

## Issue 6: Limited Text Capture (50 paragraphs / 10k chars)

**Code Location**: `backend/analyzers/content-extractor.js:367-373`

**Confirmed**: YES - Hard limits exist

**Code Snippet**:
```javascript
return {
  headings,
  paragraphs: paragraphs.slice(0, 50), // First 50 paragraphs ONLY
  lists,
  tables,
  faqs: faqs,
  wordCount,
  textLength: bodyText.length,
  bodyText: bodyText.substring(0, 10000) // First 10K chars ONLY
};
```

**Additional Limits Found**:
- Images: `images.slice(0, 100)` (line 593) - First 100 images only

**Impact**:
- Long pages have content truncated
- FAQs below paragraph 50 may be missed (if in HTML, not schema)
- Keyword analysis on bodyText misses content after 10K chars
- Question headings late in the page are not counted

**Example**:
A comprehensive service page with 100 paragraphs and 25K characters:
- Only first 50 paragraphs analyzed for readability scoring
- Only first 10K chars used for keyword/entity detection
- Content structure of the latter half is invisible

Content types affected:
- Long-form guides/articles
- Pages with accordion/tab content (if text is in HTML)
- Product pages with extensive descriptions

---

## Issue 7: No JavaScript Rendering

**Code Location**: `backend/analyzers/content-extractor.js:58-183`

**Confirmed**: YES - Uses axios (HTTP client), no headless browser

**Code Snippet**:
```javascript
async fetchHTML() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0...',
    'Mozilla/5.0 (compatible; Googlebot/2.1...',
    ...
  ];

  const response = await axios.get(cacheBustUrl, {
    timeout: this.timeout,
    ...
  });

  return {
    html: response.data,  // Raw HTML, no JS execution
    ...
  };
}
```

**Impact**:
- Single-Page Applications (SPAs) return empty/skeleton HTML
- JavaScript-rendered content is invisible
- Lazy-loaded content not captured
- Accordion/tab content hidden by JS not accessible
- Page builders (Elementor, Divi, Webflow) may render incompletely
- Dynamic FAQ sections not detected
- React/Vue/Angular apps show loading states only

**Example**:
A React SPA:
```html
<div id="root"></div>
<script src="/bundle.js"></script>
```
Scanner sees only the empty div, not the actual content rendered by JavaScript.

**Content Types Missed**:
- SPA content (React, Vue, Angular)
- Infinite scroll content
- Click-to-reveal FAQ accordions (unless using `<details>`)
- Tab content (unless semantic HTML)
- Modal/popup content
- Chat widgets with FAQ content

---

## Issue 8: Detection Relies Heavily on Schema/Keywords

**Code Location**: `backend/analyzers/recommendation-engine/fact-extractor.js:85-118`

**Confirmed**: YES - No navigation structure analysis for page-type detection

**Code Snippet**:
```javascript
function detectFAQ(scanEvidence) {
  const faqs = scanEvidence.content?.faqs || [];
  const h2s = scanEvidence.content?.headings?.h2 || [];
  const hasFAQSchema = scanEvidence.technical?.hasFAQSchema || false;

  // Only checks: on-page FAQs, H2 headings with "faq", or FAQPage schema
  return faqs.length > 0 || h2s.some(h => /faq/i.test(h)) || hasFAQSchema;
}

function detectBlog(scanEvidence) {
  // Only checks: URL path or Article schema
  return /\/blog|\/news|\/articles/i.test(url) || hasArticleSchema;
}

function detectContact(html) {
  // Only checks: keywords in HTML
  return /contact|email|phone|get in touch|reach us/i.test(html);
}
```

**Impact**:
- Site architecture is NOT understood from navigation
- A site with `<nav><a href="/faq">FAQ</a><a href="/blog">Blog</a><a href="/contact">Contact</a></nav>` still requires VISITING those pages to detect them
- Navigation links like "Our Services", "About Us" are not used for detection
- Can't determine site structure without crawling every page

**Example**:
Homepage navigation: `<nav><a href="/services">Services</a><a href="/faq">FAQ</a><a href="/blog">Blog</a></nav>`

Detection relies on:
1. Visiting /services, /faq, /blog individually OR
2. Finding Service/FAQ/Blog schema on current page OR
3. Finding keywords in current page content

It does NOT extract nav links and use them to understand site architecture.

---

## Issue 9: Crawler Results Not Reused in Detection

**Code Location**:
- `backend/analyzers/site-crawler.js:333-368` (URL prioritization)
- `backend/analyzers/v5-enhanced-rubric-engine.js` (scoring)

**Confirmed**: YES - Crawler discovers pages but detection doesn't use this

**Code Snippet**:
```javascript
// site-crawler.js:333-368 - Crawler DOES discover blog/faq URLs
prioritizeUrls(urls) {
  const priorities = {
    home: 10,
    about: 9,
    blog: 8,       // Blog posts prioritized!
    service: 7,
    contact: 6,
    faq: 5,        // FAQ pages prioritized!
    other: 1
  };

  // URLs like /blog, /faq are given higher priority...
  else if (lower.includes('/blog') || lower.includes('/article')) score = priorities.blog;
  else if (lower.includes('/faq')) score = priorities.faq;
}

// BUT siteMetrics doesn't include "discoveredBlogPages" or "discoveredFAQPages"
aggregateEvidence() {
  return {
    siteMetrics: {
      pagesWithQuestionHeadings: ...,
      pagesWithFAQs: ...,           // Only pages actually crawled with FAQ content
      pagesWithFAQSchema: ...,      // Only pages actually crawled with FAQ schema
      // NO: discoveredBlogUrl, discoveredFAQUrl
    }
  }
}
```

**Impact**:
- Crawler may discover `/blog` and `/faq` URLs in sitemap or internal links
- But this information is NOT passed to detection
- Detection only sees evidence from pages that were actually crawled
- If crawler limit (maxPages=15) is reached before /faq is crawled, FAQ is missed
- Blog detection doesn't check if crawler found `/blog` URL

**Example**:
Site sitemap includes: `/`, `/about`, `/services`, `/blog`, `/blog/post-1`, ..., `/faq`

With maxPages=15, crawler might crawl the first 15 pages and never reach `/faq`.

Even though the crawler SAW the `/faq` URL in the sitemap, this information is:
1. Used for URL prioritization (good)
2. NOT used to mark "site has FAQ page" (bad)
3. NOT exposed in siteMetrics (bad)

Detection would report "No FAQ found" even though we KNOW `/faq` exists.

---

## Summary of Confirmed Issues

| # | Issue | Confirmed | Severity |
|---|-------|-----------|----------|
| 1 | Nav & Footer Stripped Too Early | PARTIAL | High |
| 2 | Blog Detection Only Checks Current Page | YES | Critical |
| 3 | FAQ Detection Ignores Nav/Footer Links | YES | High |
| 4 | Schema in @graph Sometimes Ignored | NO | N/A (Working) |
| 5 | Navigation Scoring Done After Nav Removal | YES | Critical |
| 6 | Limited Text Capture (50p/10k chars) | YES | Medium |
| 7 | No JavaScript Rendering | YES | High |
| 8 | Detection Relies Heavily on Schema/Keywords | YES | High |
| 9 | Crawler Results Not Reused in Detection | YES | High |

**8 of 9 issues confirmed** - Only @graph handling is working correctly.

---

## Recommended Fix Order

### Priority 1 - Critical Bugs (Must Fix)
1. **Issue 5**: Move `extractStructure()` BEFORE `$(...).remove()` in `extractContent()`
2. **Issue 2 + 9**: Add `discoveredPages` tracking to crawler, use for blog/faq detection

### Priority 2 - High Impact
3. **Issue 1**: Extract nav links BEFORE removal, store for analysis
4. **Issue 3 + 8**: Add navigation link analysis to detect site sections
5. **Issue 7**: Consider headless browser option for JS-heavy sites

### Priority 3 - Medium Impact
6. **Issue 6**: Increase limits or make configurable for paid tiers

---

**End of Verification Report**
