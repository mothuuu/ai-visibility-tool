# Visible2AI - Detection & Extraction Rulebook

**Version:** 2.2  
**Date:** 2026-01-03  
**Purpose:** Complete specification for what to detect, extract, store, and display

---

## Table of Contents

### Core Sections
1. [Overview](#overview)
2. [Detection Architecture](#detection-architecture)
3. [Extraction Principles](#extraction-principles)
4. [Data Storage Schema](#data-storage-schema)

### Pillar Detection Specifications
5. [Pillar 1: Content Structure](#pillar-1-content-structure)
6. [Pillar 2: Trust & Authority](#pillar-2-trust--authority)
7. [Pillar 3: Entity Recognition](#pillar-3-entity-recognition)
8. [Pillar 4: Schema Markup](#pillar-4-schema-markup)
9. [Pillar 5: Technical Setup](#pillar-5-technical-setup)
10. [Pillar 6: Speed & UX](#pillar-6-speed--ux)
11. [Pillar 7: Voice Optimization](#pillar-7-voice-optimization)
12. [Pillar 8: Citation Worthiness](#pillar-8-citation-worthiness)

### Advanced Detection Logic
13. [Evidence Confidence & Conflict Resolution](#evidence-confidence--conflict-resolution)
14. [Site-Level vs Page-Level Separation](#site-level-vs-page-level-separation)
15. [Detection State Lifecycle](#detection-state-lifecycle)
16. [Negative & Anti-Patterns Detection](#negative--anti-patterns-detection)
17. [Entity Disambiguation & Identity Resolution](#entity-disambiguation--identity-resolution)
18. [AI Consumption Readiness (Answerability Layer)](#ai-consumption-readiness-answerability-layer)

### System Infrastructure
19. [Global Detection Vocabulary Registry](#global-detection-vocabulary-registry)
20. [Diagnostic Output Contract](#diagnostic-output-contract)
21. [Weight Override & Future-Proofing](#weight-override--future-proofing)

### Implementation
22. [Cross-Cutting Rules](#cross-cutting-rules)
23. [Dynamic Text Templates](#dynamic-text-templates)
24. [Scoring Calculation](#scoring-calculation)
25. [Implementation Checklist](#implementation-checklist)
26. [Document History](#document-history)

---

## Overview

### Purpose of This Document

This rulebook defines exactly:
1. **WHAT** to detect (feature presence)
2. **WHERE** to look (sources)
3. **HOW** to score (0–125 per pillar, 0–1000 total — see Score Boundary Rules)
4. **WHAT** to extract (specific data)
5. **HOW** to store (data structure)
6. **WHAT** to display (dynamic text)

### Detection vs Extraction

| Aspect | Detection | Extraction |
|--------|-----------|------------|
| Question | Does it exist? | What exactly is there? |
| Output | Boolean/Score | Structured data |
| Example | `hasFAQ: true` | `faqs: [{q: "...", a: "..."}]` |
| Use | Scoring | Evidence, dynamic text, debugging |

### Canonical Pillar IDs

All detection results use these internal IDs (never change):

| Internal ID | Canonical Name | Marketing Headline |
|-------------|----------------|-------------------|
| `content_structure` | Content Structure | Content AI Can Use |
| `trust_authority` | Trust & Authority | Be Trusted |
| `entity_recognition` | Entity Recognition | Be Found |
| `schema_markup` | Schema Markup | Speak AI's Language |
| `technical_setup` | Technical Setup | Solid Foundation |
| `speed_ux` | Speed & UX | Be Fast & Frictionless |
| `voice_optimization` | Voice Optimization | Own the Conversation |
| `citation_worthiness` | Citation Worthiness | Be Worth Quoting |

---

## Detection Architecture

### Detection Pipeline

```
STAGE 1: PRE-EXTRACTION (Before any DOM removal)
├── Clone DOM for structure extraction
├── Extract navigation links
├── Extract site structure flags
├── Store for later use
│
STAGE 2: SCHEMA EXTRACTION
├── Parse all JSON-LD
├── Recurse into @graph and nested objects
├── Extract all @type values with source paths
├── Extract all property values
│
STAGE 3: CONTENT EXTRACTION
├── Extract FAQs (schema + HTML + accordions)
├── Extract headings
├── Extract paragraphs
├── Extract images with alt text
├── Extract list items
│
STAGE 4: ELEMENT REMOVAL (After extraction)
├── Remove script, style
├── Remove nav, header, footer (already extracted)
│
STAGE 5: EXTERNAL CHECKS
├── Fetch /sitemap.xml
├── Fetch /robots.txt
├── Check AI crawler rules
│
STAGE 6: CRAWLER INTEGRATION
├── Receive discovered URLs
├── Analyze URL patterns
├── Merge with page detection
```

### Detection Sources (Priority Order)

| Priority | Source | Description |
|----------|--------|-------------|
| 1 | JSON-LD Schema | Structured data in script tags |
| 2 | Microdata | itemtype/itemprop attributes |
| 3 | HTML Content | Visible elements and text |
| 4 | Navigation | Links in nav/header/footer |
| 5 | Meta Tags | Meta elements in head |
| 6 | Crawler Data | Discovered URLs |
| 7 | External Files | sitemap.xml, robots.txt |
| 8 | HTTP Headers | Response headers |

---

## Extraction Principles

### Principle 1: Clone DOM Before Removal

**The Core Problem:** Navigation, header, footer, and aside elements are removed BEFORE extraction, destroying evidence.

**Solution: Clone DOM Approach**

```javascript
async extract(html, url) {
  const cheerio = require('cheerio');
  
  // Clone DOM - one for structure, one for content
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

### Principle 2: Extract Everything Relevant

Don't just detect presence — capture the actual data for:
- Evidence display to user
- Dynamic recommendation text
- Debugging and support
- Future features (comparison, tracking)

### Principle 3: Normalize Data

Store data in consistent, predictable structures:

```javascript
// Good: Normalized
faqs: [
  { question: "What is X?", answer: "X is...", source: "schema" },
  { question: "How does Y?", answer: "Y works by...", source: "html" }
]

// Bad: Mixed formats
faqs: "Found 3 FAQs"  // Loses the actual data
```

### Principle 4: Track Source Location

Store where each piece of evidence was found:

```javascript
schemas.push({
  type: item['@type'],
  data: item,
  source: 'json-ld-graph',
  sourcePath: `script[${scriptIndex}].@graph[${graphIndex}]`
});
```

---

## Data Storage Schema

### Complete Evidence Namespace

```typescript
interface ScanEvidence {
  url: string;
  scannedAt: string;
  
  navigation: {
    keyPages: { about: string | null; contact: string | null; faq: string | null; blog: string | null };
    allNavLinks: { href: string; text: string; location: 'nav' | 'header' | 'footer' }[];
    footerLinks: { href: string; text: string }[];
    hasSemanticNav: boolean;
    hasHeader: boolean;
    hasFooter: boolean;
  };
  
  structure: {
    hasNav: boolean;
    hasHeader: boolean;
    hasFooter: boolean;
    hasMain: boolean;
    headingHierarchy: { level: number; text: string }[];
  };
  
  content: {
    paragraphs: { text: string; wordCount: number }[];
    headings: { level: number; text: string }[];
    faqs: { question: string; answer: string; source: string }[];
    listItems: { text: string; type: 'ordered' | 'unordered' }[];
    accordions: { question: string; answer: string; source: string }[];
  };
  
  technical: {
    structuredData: Schema[];
    hasFAQSchema: boolean;
    hasArticleSchema: boolean;
    hasOrganizationSchema: boolean;
    hasLocalBusinessSchema: boolean;
    
    canonical: { detected: boolean; url: string | null; source: 'tag' | 'header' };
    hreflang: { detected: boolean; languages: string[]; defaultLang: string | null };
    openGraph: { title: string | null; description: string | null; image: string | null; url: string | null; type: string | null };
    twitterCard: { card: string | null; site: string | null; title: string | null; description: string | null; image: string | null };
    indexNow: { detected: boolean; keyLocation: string | null; keyVerified: boolean };
    feeds: { detected: boolean; urls: string[]; types: string[] };
  };
  
  aiReadiness: {
    questionHeadings: number;
    snippetEligibility: number;
    answerability: number;
  };
  
  trust: {
    authorBios: { name: string; bio: string; credentials: string[] }[];
    testimonials: { text: string; author: string; company: string | null }[];
    certifications: string[];
    thirdPartyProfiles: { platform: string; url: string; source: 'sameAs' | 'footer' }[];
    teamPage: { detected: boolean; url: string | null };
    caseStudies: { detected: boolean; count: number; urls: string[] };
  };
  
  voice: {
    conversationalContent: number;
    speakableSchema: boolean;
    longTailKeywords: string[];
  };
  
  freshness: {
    lastModified: string | null;
    publishDate: string | null;
    updateFrequency: 'daily' | 'weekly' | 'monthly' | 'unknown';
  };
  
  crawler: {
    discoveredSections: { hasBlogUrl: boolean; hasFaqUrl: boolean; hasAboutUrl: boolean };
    totalDiscoveredUrls: number;
    robotsTxt: { found: boolean; allowsAllAI: boolean; blockedAICrawlers: string[]; hasAISpecificRules: boolean };
    sitemap: { detected: boolean; location: string | null; pageCount: number; source: 'robots' | 'default' | 'crawl' };
    aggregateMetrics: { totalFAQsFound: number; pagesWithFAQs: number; pagesWithSchema: number };
  };
  
  siteMetrics: crawler; // Alias for backward compatibility
}
```

---

## Pillar 1: Content Structure

**Internal ID:** `content_structure`  
**Marketing Headline:** Content AI Can Use  
**Weight:** 15%

### What We Detect

| Signal | Detection Method | Weight |
|--------|------------------|--------|
| H1 presence | `document.querySelector('h1')` | High |
| H1 count | Count of H1 tags (should be 1) | Medium |
| Heading hierarchy | H1 → H2 → H3 order without skips | Medium |
| Paragraph structure | Avg paragraph length, reading level | Low |
| FAQ sections | Schema + HTML patterns + accordions | High |
| List content | `<ul>`, `<ol>` presence | Low |
| Table content | `<table>` presence | Low |

### Detection Logic

```javascript
function detectContentStructure($full) {
  const evidence = {
    h1: {
      count: $full('h1').length,
      text: $full('h1').first().text().trim(),
      present: $full('h1').length > 0
    },
    headings: {
      h2_count: $full('h2').length,
      h3_count: $full('h3').length,
      hierarchy_valid: checkHeadingHierarchy($full)
    },
    paragraphs: {
      count: $full('p').length,
      avg_length: calculateAvgParagraphLength($full),
      total_words: countTotalWords($full)
    },
    faq: detectFAQComplete($full),
    lists: {
      ul_count: $full('ul').length,
      ol_count: $full('ol').length
    }
  };
  
  return evidence;
}
```

### FAQ Detection - Complete Specification

**Required Evidence Fields:**

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
  hasFAQNavLink: boolean;
  faqNavLinkHref: string | null;
  faqNavLinkText: string | null;
  crawlerFoundFAQ: boolean;
  faqPageUrl: string | null;
  faqPageUrls: string[];
}
```

**Detection Rule:** Accept FAQ presence if ANY of these is true:
- FAQs extracted on current page
- FAQPage schema found anywhere
- nav/footer contains FAQ link text or /faq
- crawler found /faq or FAQ-like page

**Accordion/Details Extraction:**

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

### Issues Generated

| Issue Code | Trigger Condition | Recommendation |
|------------|-------------------|----------------|
| `CS001` | No H1 tag | Add a single H1 describing the page |
| `CS002` | Multiple H1 tags | Reduce to exactly one H1 |
| `CS003` | Heading hierarchy skips | Fix heading levels (H1→H2→H3) |
| `CS004` | No FAQ content | Add FAQ section with schema |
| `CS005` | Short paragraphs only | Add detailed explanatory content |

---

## Pillar 2: Trust & Authority

**Internal ID:** `trust_authority`  
**Marketing Headline:** Be Trusted  
**Weight:** 12%

### What We Detect

| Signal | Detection Method | Weight |
|--------|------------------|--------|
| Author information | Schema + byline patterns | High |
| Company credentials | About page, certifications | High |
| Testimonials/reviews | Review schema + testimonial patterns | Medium |
| Security signals | HTTPS, trust badges | Medium |
| Third-party profiles | sameAs schema + footer links | Medium |
| Team page | /team, /about-us detection | Low |
| Case studies | /case-studies URL patterns | Low |

### Detection Logic

```javascript
function detectTrustAuthority($full, crawlerData) {
  return {
    author: detectAuthorInfo($full),
    credentials: detectCredentials($full),
    testimonials: detectTestimonials($full),
    security: detectSecuritySignals($full),
    thirdPartyProfiles: extractThirdPartyProfiles($full, crawlerData),
    teamPage: crawlerData?.discoveredSections?.hasTeamUrl || false,
    caseStudies: detectCaseStudies($full, crawlerData)
  };
}
```

### Third-Party Profile Detection

```javascript
const KNOWN_PLATFORMS = {
  'linkedin.com': 'LinkedIn', 
  'g2.com': 'G2', 
  'capterra.com': 'Capterra',
  'trustpilot.com': 'Trustpilot', 
  'crunchbase.com': 'Crunchbase',
  'clutch.co': 'Clutch', 
  'producthunt.com': 'Product Hunt'
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
```

### Issues Generated

| Issue Code | Trigger Condition | Recommendation |
|------------|-------------------|----------------|
| `TA001` | No author info | Add author bio with credentials |
| `TA002` | No testimonials | Add customer testimonials |
| `TA003` | No third-party profiles | Add links to G2, Capterra, LinkedIn |
| `TA004` | No team page | Create About/Team page |
| `TA005` | No case studies | Add case study content |

---

## Pillar 3: Entity Recognition

**Internal ID:** `entity_recognition`  
**Marketing Headline:** Be Found  
**Weight:** 12%

### What We Detect

| Signal | Detection Method | Weight |
|--------|------------------|--------|
| Organization schema | JSON-LD Organization type | High |
| Brand mentions | Consistent brand name usage | Medium |
| Industry keywords | Category-relevant terms | Medium |
| Competitor differentiation | Unique value propositions | Low |

### Detection Logic

```javascript
function detectEntityRecognition($full, structuredData) {
  return {
    hasOrganization: structuredData.some(s => s.type === 'Organization'),
    organizationData: extractOrganizationData(structuredData),
    brandMentions: countBrandMentions($full),
    industryKeywords: extractIndustryKeywords($full)
  };
}

function extractOrganizationData(structuredData) {
  const org = structuredData.find(s => s.type === 'Organization');
  if (!org) return null;
  
  return {
    name: org.data.name,
    url: org.data.url,
    logo: org.data.logo,
    description: org.data.description,
    sameAs: org.data.sameAs,
    address: org.data.address,
    sourcePath: org.sourcePath
  };
}
```

### Issues Generated

| Issue Code | Trigger Condition | Recommendation |
|------------|-------------------|----------------|
| `ER001` | No Organization schema | Add Organization JSON-LD |
| `ER002` | Missing company name in schema | Add name to Organization |
| `ER003` | No sameAs links | Add social/directory links |
| `ER004` | Inconsistent brand mentions | Standardize brand name usage |

---

## Pillar 4: Schema Markup

**Internal ID:** `schema_markup`  
**Marketing Headline:** Speak AI's Language  
**Weight:** 15%

### What We Detect

| Signal | Detection Method | Weight |
|--------|------------------|--------|
| Any JSON-LD | Script type="application/ld+json" | High |
| Organization type | @type: Organization | High |
| FAQPage type | @type: FAQPage | High |
| LocalBusiness type | @type: LocalBusiness | Medium |
| Article types | BlogPosting, NewsArticle, Article | Medium |
| Product type | @type: Product | Medium |
| Breadcrumb | @type: BreadcrumbList | Low |

### Detection Logic with Source Tracking

```javascript
function extractStructuredData($full) {
  const schemas = [];
  
  $full('script[type="application/ld+json"]').each((scriptIndex, el) => {
    try {
      const jsonLd = JSON.parse($(el).html());
      
      // Handle @graph arrays
      if (jsonLd['@graph'] && Array.isArray(jsonLd['@graph'])) {
        jsonLd['@graph'].forEach((item, graphIndex) => {
          schemas.push({
            type: item['@type'],
            data: item,
            source: 'json-ld-graph',
            sourcePath: `script[${scriptIndex}].@graph[${graphIndex}]`,
            scriptIndex,
            graphIndex
          });
        });
      } else {
        schemas.push({
          type: jsonLd['@type'],
          data: jsonLd,
          source: 'json-ld',
          sourcePath: `script[${scriptIndex}]`,
          scriptIndex
        });
      }
    } catch (e) {
      // Invalid JSON-LD
    }
  });
  
  return schemas;
}
```

### Issues Generated

| Issue Code | Trigger Condition | Recommendation |
|------------|-------------------|----------------|
| `SM001` | No JSON-LD at all | Add structured data |
| `SM002` | No Organization | Add Organization schema |
| `SM003` | No FAQPage (has FAQ content) | Wrap FAQs in FAQPage schema |
| `SM004` | Invalid JSON-LD | Fix JSON syntax errors |
| `SM005` | Missing required properties | Complete schema properties |

---

## Pillar 5: Technical Setup

**Internal ID:** `technical_setup`  
**Marketing Headline:** Solid Foundation  
**Weight:** 18%

### What We Detect

| Signal | Detection Method | Weight |
|--------|------------------|--------|
| Sitemap presence | /sitemap.xml fetch | High |
| Robots.txt | /robots.txt fetch | High |
| Canonical tag | link rel="canonical" or header | High |
| Meta robots | noindex, nofollow detection | High |
| HTTPS | Protocol check | Medium |
| Mobile viewport | meta viewport tag | Medium |
| IndexNow | meta tag + key verification | Low |
| RSS/Atom feeds | link rel="alternate" | Low |

### Detection Logic

```javascript
function extractTechnicalSignals($full, headers, baseUrl) {
  return {
    canonical: extractCanonical($full, headers),
    metaRobots: extractMetaRobots($full),
    viewport: $full('meta[name="viewport"]').attr('content') || null,
    openGraph: extractOpenGraph($full),
    twitterCard: extractTwitterCard($full),
    indexNow: detectIndexNow($full, baseUrl),
    feeds: extractFeeds($full),
    hreflang: extractHreflang($full)
  };
}

function extractCanonical($, headers) {
  const tag = $('link[rel="canonical"]').attr('href');
  const header = headers?.link?.match(/<([^>]+)>;\s*rel="canonical"/)?.[1];
  return { 
    detected: !!(tag || header), 
    url: tag || header, 
    source: tag ? 'tag' : 'header' 
  };
}

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

async function detectIndexNow($, baseUrl) {
  const key = $('meta[name="indexnow-key"]').attr('content');
  if (!key) return { detected: false };
  
  const keyFileUrl = `${baseUrl}/${key}.txt`;
  const verified = await axios.head(keyFileUrl).then(() => true).catch(() => false);
  
  return { detected: true, keyLocation: 'meta', keyVerified: verified };
}

function extractFeeds($) {
  const feeds = [];
  $('link[type="application/rss+xml"]').each((i, el) => feeds.push({ url: $(el).attr('href'), type: 'rss' }));
  $('link[type="application/atom+xml"]').each((i, el) => feeds.push({ url: $(el).attr('href'), type: 'atom' }));
  return { detected: feeds.length > 0, feeds };
}
```

### Robots.txt AI Crawler Parsing

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

### Issues Generated

| Issue Code | Trigger Condition | Recommendation |
|------------|-------------------|----------------|
| `TS001` | No sitemap | Create XML sitemap |
| `TS002` | No robots.txt | Create robots.txt |
| `TS003` | Missing canonical | Add canonical tag |
| `TS004` | noindex detected | Remove noindex if not intentional |
| `TS005` | AI crawlers blocked | Allow AI crawlers in robots.txt |
| `TS006` | No Open Graph tags | Add OG meta tags |
| `TS007` | No Twitter Card | Add Twitter meta tags |

---

## Pillar 6: Speed & UX

**Internal ID:** `speed_ux`  
**Marketing Headline:** Be Fast & Frictionless  
**Weight:** 5%

### What We Detect

| Signal | Detection Method | Weight |
|--------|------------------|--------|
| Page size | Response size measurement | Medium |
| Image optimization | Image count, formats | Medium |
| Mobile-friendly | Viewport tag, responsive signals | Medium |
| Core Web Vitals | External API (optional) | Low |

### Detection Logic

```javascript
function detectSpeedUX($full, responseData) {
  return {
    pageSize: responseData.contentLength || 0,
    imageCount: $full('img').length,
    hasLazyLoad: $full('img[loading="lazy"]').length > 0,
    hasViewport: !!$full('meta[name="viewport"]').length,
    isResponsive: detectResponsiveDesign($full)
  };
}
```

### Issues Generated

| Issue Code | Trigger Condition | Recommendation |
|------------|-------------------|----------------|
| `SU001` | Large page size (>3MB) | Optimize page size |
| `SU002` | Many unoptimized images | Add lazy loading |
| `SU003` | No viewport meta | Add mobile viewport |

---

## Pillar 7: Voice Optimization

**Internal ID:** `voice_optimization`  
**Marketing Headline:** Own the Conversation  
**Weight:** 12%

### What We Detect

| Signal | Detection Method | Weight |
|--------|------------------|--------|
| Question-format headings | H2/H3 starting with How/What/Why | High |
| Conversational content | Natural language patterns | Medium |
| Speakable schema | @type: SpeakableSpecification | Medium |
| Long-tail keywords | Question phrases in content | Low |

### Detection Logic

```javascript
function detectVoiceOptimization($full, structuredData) {
  const questionHeadings = $full('h2, h3, h4').filter((i, el) => {
    const text = $(el).text().toLowerCase();
    return /^(what|how|why|when|where|who|which|can|does|is|are|should|will)\b/.test(text) ||
           text.includes('?');
  }).length;
  
  return {
    questionHeadings,
    hasQuestionFormat: questionHeadings >= 3,
    hasSpeakable: structuredData.some(s => s.type === 'SpeakableSpecification'),
    conversationalScore: analyzeConversationalTone($full)
  };
}
```

### Issues Generated

| Issue Code | Trigger Condition | Recommendation |
|------------|-------------------|----------------|
| `VO001` | No question headings | Add "How to..." style headings |
| `VO002` | No speakable schema | Add Speakable schema |
| `VO003` | Formal/technical tone only | Add conversational content |

---

## Pillar 8: Citation Worthiness

**Internal ID:** `citation_worthiness`  
**Marketing Headline:** Be Worth Quoting  
**Weight:** 11%

### What We Detect

| Signal | Detection Method | Weight |
|--------|------------------|--------|
| Original research/data | Statistics, percentages | High |
| Unique insights | First-party data indicators | High |
| Expert attribution | Author credentials | Medium |
| Source citations | Outbound authoritative links | Medium |
| Last updated date | dateModified, visible dates | Low |

### Detection Logic

```javascript
function detectCitationWorthiness($full, structuredData) {
  return {
    hasStatistics: detectStatistics($full),
    hasOriginalData: detectOriginalResearch($full),
    hasExpertAttribution: detectExpertCredentials($full),
    hasCitations: countOutboundLinks($full),
    lastUpdated: extractLastUpdated($full, structuredData)
  };
}

function detectStatistics($full) {
  const text = $full('body').text();
  const statPatterns = /\d+%|\d+\s*(million|billion|thousand)|survey of \d+|study (of|with) \d+/gi;
  const matches = text.match(statPatterns) || [];
  return { detected: matches.length > 0, count: matches.length, examples: matches.slice(0, 5) };
}
```

### Issues Generated

| Issue Code | Trigger Condition | Recommendation |
|------------|-------------------|----------------|
| `CW001` | No original data/stats | Add research, surveys, or data |
| `CW002` | No date/freshness signal | Add last updated date |
| `CW003` | No expert attribution | Add author credentials |
| `CW004` | No outbound citations | Add links to authoritative sources |

---

## Evidence Confidence & Conflict Resolution

### Confidence Levels

| Level | Definition | Example |
|-------|------------|---------|
| `high` | Definitive structured signal | JSON-LD schema found |
| `medium` | Strong HTML pattern | FAQ section with clear markup |
| `low` | Heuristic/inference | Text patterns suggesting FAQ |

### Conflict Resolution Rules

When multiple sources disagree:

1. **Schema > HTML > Inference** - Structured data wins
2. **Explicit > Implicit** - Clear signals beat patterns
3. **Crawler > Page** - Site-wide evidence beats single page
4. **Most Recent Wins** - For temporal data

```javascript
function resolveConflict(sources) {
  const priority = ['schema', 'html', 'navigation', 'crawler', 'inference'];
  
  for (const source of priority) {
    const match = sources.find(s => s.source === source);
    if (match) return match;
  }
  
  return sources[0];
}
```

---

## Site-Level vs Page-Level Separation

### Rule: detectMultiPageIssues() as Default

When crawl data exists, use site-wide detection:

```javascript
function detectIssues(scanEvidence) {
  const hasCrawlData = scanEvidence.siteMetrics?.totalDiscoveredUrls > 0;
  
  if (hasCrawlData) {
    return detectMultiPageIssues(scanEvidence); // Site-wide detection
  } else {
    return detectSinglePageIssues(scanEvidence); // Page-only fallback
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
  if (!siteHasBlog) issues.push({ category: 'content_structure', issue: 'No blog across site' });
  if (!siteHasFAQ) issues.push({ category: 'content_structure', issue: 'No FAQ across site' });
  
  return issues;
}
```

---

## Detection State Lifecycle

### States

```
PENDING → SCANNING → EXTRACTING → SCORING → COMPLETE
                ↓           ↓          ↓
              FAILED     FAILED     FAILED
```

### Scoring States

Only score when evidence exists:

```typescript
type ScoreState =
  | number         // 0-100: Measured score
  | null           // Not measured
  | 'not_measured' // Explicitly not measured
  | 'not_applicable' // Doesn't apply to this site
  | 'error';       // Measurement failed

// ❌ WRONG: Default to 50
geoContentScore: hasGeoSignal ? 100 : 50,

// ✅ CORRECT: Evidence-based with explicit states
geoContentScore: (() => {
  if (hasLocalBusinessSchema) return 100;
  if (hasGeoMeta) return 70;
  if (mentionsLocations) return 50;
  return 0; // No evidence = 0, not 50
})(),
```

---

## Negative & Anti-Patterns Detection

### What to Flag

| Anti-Pattern | Detection | Impact |
|--------------|-----------|--------|
| Thin content | < 300 words main content | Negative |
| Duplicate titles | Same title across pages | Negative |
| Blocked AI crawlers | robots.txt disallow | Negative |
| noindex on key pages | Meta robots detection | Negative |
| Broken schema | Invalid JSON-LD | Negative |

---

## Entity Disambiguation & Identity Resolution

### When Multiple Entities Found

```javascript
function resolveOrganization(schemas) {
  const orgs = schemas.filter(s => 
    s.type === 'Organization' || s.type === 'LocalBusiness'
  );
  
  if (orgs.length === 0) return null;
  if (orgs.length === 1) return orgs[0];
  
  // Prefer LocalBusiness over generic Organization
  const local = orgs.find(o => o.type === 'LocalBusiness');
  if (local) return local;
  
  // Prefer the one with more properties
  return orgs.sort((a, b) => 
    Object.keys(b.data).length - Object.keys(a.data).length
  )[0];
}
```

---

## AI Consumption Readiness (Answerability Layer)

### Answerability Scoring

How likely is this content to be used by AI assistants?

```javascript
function scoreAnswerability(evidence) {
  let score = 0;
  
  // Question-format content (+30)
  if (evidence.content.faqs.length >= 3) score += 30;
  
  // Clear structure (+20)
  if (evidence.structure.headingHierarchy.length >= 5) score += 20;
  
  // Snippet-eligible paragraphs (+20)
  const snippetParagraphs = evidence.content.paragraphs.filter(
    p => p.wordCount >= 40 && p.wordCount <= 100
  ).length;
  if (snippetParagraphs >= 3) score += 20;
  
  // Schema markup (+15)
  if (evidence.technical.hasFAQSchema) score += 15;
  
  // Freshness (+15)
  if (evidence.freshness.lastModified) score += 15;
  
  return score;
}
```

---

## Global Detection Vocabulary Registry

### Blog Detection Vocabulary

```javascript
const URL_PATTERNS = {
  blog: /\/(blog|news|articles|insights|resources|updates|journal|posts|learn|knowledge-base|help-center|guides|library|content)(\/|$)/i
};

const BLOG_NAV_KEYWORDS = [
  'blog', 'news', 'articles', 'insights', 'resources',
  'updates', 'journal', 'learn', 'knowledge', 'guides',
  'library', 'content', 'stories', 'perspectives'
];
```

### FAQ Detection Vocabulary

```javascript
const FAQ_PATTERNS = [
  /faq/i,
  /frequently\s+asked/i,
  /questions/i,
  /help\s+center/i,
  /support/i
];
```

---

## Diagnostic Output Contract

### Standard Diagnostic Format

```javascript
{
  pillar: 'content_structure',
  issue_code: 'CS004',
  severity: 'high',
  detected: false,
  evidence: {
    searched: ['schema', 'html', 'navigation', 'crawler'],
    found: null,
    confidence: 'high'
  },
  recommendation: {
    marketing_copy: "Help AI find answers on your site",
    technical_copy: "Add FAQPage schema with Q&A pairs",
    effort: 'medium',
    impact: 'high'
  }
}
```

---

## Weight Override & Future-Proofing

### Configuration-Driven Weights

```javascript
const PILLAR_WEIGHTS = {
  content_structure: 0.15,
  trust_authority: 0.12,
  entity_recognition: 0.12,
  schema_markup: 0.15,
  technical_setup: 0.18,
  speed_ux: 0.05,
  voice_optimization: 0.12,
  citation_worthiness: 0.11
};

// Weights stored in config, not hardcoded
// Can be overridden per industry/plan
```

---

## Cross-Cutting Rules

### Rule 1: Extract BEFORE Remove

```javascript
// ✅ CORRECT ORDER
const navigation = extractNavigation($);  // FIRST
const structure = extractStructure($);    // SECOND
$('nav, header, footer').remove();        // THEN remove
const content = extractContent($);        // FINALLY extract cleaned
```

### Rule 2: Recursive Schema Parsing

```javascript
function extractAllTypes(jsonLd, path = '') {
  const types = [];
  
  if (jsonLd['@type']) {
    types.push({ type: jsonLd['@type'], path });
  }
  
  // Recurse into @graph
  if (jsonLd['@graph']) {
    jsonLd['@graph'].forEach((item, i) => {
      types.push(...extractAllTypes(item, `${path}.@graph[${i}]`));
    });
  }
  
  // Recurse into nested objects
  Object.entries(jsonLd).forEach(([key, value]) => {
    if (typeof value === 'object' && value !== null && key !== '@graph') {
      types.push(...extractAllTypes(value, `${path}.${key}`));
    }
  });
  
  return types;
}
```

### Rule 3: Smart Content Filtering

```javascript
function filterContent(paragraphs) {
  return paragraphs.filter(p => {
    const text = p.trim();
    
    if (text.length < 20) {
      // Keep if meaningful short content
      if (/\?$/.test(text)) return true; // Questions
      if (/^[A-Z][^.!?]*$/.test(text)) return true; // Heading-like
      if (/price|cost|free|contact/i.test(text)) return true; // Key terms
      return false;
    }
    
    // Discard boilerplate
    if (/^(copyright|all rights reserved|loading)/i.test(text)) return false;
    
    return true;
  });
}
```

### Rule 4: Adaptive Content Limits

```javascript
const CONTENT_LIMITS = {
  default: { maxParagraphs: 100, maxCharsTotal: 25000 },
  homepage: { maxParagraphs: 150, maxCharsTotal: 30000 },
  blog: { maxParagraphs: 200, maxCharsTotal: 50000 },
  faq: { maxParagraphs: 300, maxCharsTotal: 40000 }
};
```

### Rule 5: JS-Rendered Site Detection

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

---

## Dynamic Text Templates

### Template Interpolation

```javascript
function generateDynamicText(pillar, detected, evidence) {
  const templates = PILLAR_TEMPLATES[pillar];
  const template = detected ? templates.detected : templates.missing;
  
  return interpolate(template, evidence);
}

function interpolate(template, data) {
  return template.replace(/\{([^}]+)\}/g, (match, path) => {
    return getNestedValue(data, path) || match;
  });
}
```

### Example Templates

```javascript
const FAQ_TEMPLATES = {
  detected: "✅ {count} FAQs found via {source}",
  missing: "Add FAQ content to help AI answer customer questions"
};

const SCHEMA_TEMPLATES = {
  detected: "✅ {types.length} schema types: {types.join(', ')}",
  missing: "Add structured data so AI understands your business"
};
```

---

## Scoring Calculation

### Score Scales & Boundaries

| Scale | Range | Where Used | Boundary |
|-------|-------|------------|----------|
| **Raw pillar** | 0–100 | Engine internal ONLY | ⛔ Never leaks past scoring function |
| **Display pillar** | 0–125 | DB, API, UI, Recommendations | ✅ External contract |
| **Total score** | 0–1000 | DB, API, UI | ✅ External contract |

### ⚠️ CRITICAL: Score Boundary Rules

**Product Principle:** "Score scale: 0–1000 everywhere" (see 01-product-principles.md)

**What this means:**
1. **Raw 0–100 is internal only** — exists only inside `calculatePillarScore()` and must be converted before leaving the scoring module
2. **Everything external uses 0–1000 system:**
   - Database storage → pillar scores as 0–125, total as 0–1000
   - API responses → pillar scores as 0–125, total as 0–1000
   - Recommendation thresholds → defined against 0–125 pillar scores
   - UI display → 0–125 per pillar, 0–1000 total
3. **Only exception:** Raw 0–100 may appear in `diagnostics.raw_scores` for debugging (never in production API responses)

**Governance:** `diagnostics` field is server-side only or restricted to admin/internal roles. See `entitlements-config.js` — if a `diagnostics` scope is ever exposed via API, gate it behind `plan: 'enterprise'` or `role: 'admin'`.

**Why this matters:**
- Prevents "recommendations don't trigger" bugs (thresholds expecting 0–125 but receiving 0–100)
- Ensures consistent mental model across all systems
- Makes threshold configuration intuitive (e.g., "trigger if pillar < 60" means < 60/125)

### Implementation Pattern

```javascript
// INTERNAL: Scoring module only
function calculatePillarScore(pillarId, evidence) {
  const signals = PILLAR_SIGNALS[pillarId];
  let score = 0;
  let maxScore = 0;
  
  for (const signal of signals) {
    maxScore += signal.weight;
    if (evaluateSignal(evidence, signal)) {
      score += signal.weight;
    }
  }
  
  const rawScore = Math.round((score / maxScore) * 100); // Raw: 0-100 (internal)
  return toDisplayScore(rawScore); // ALWAYS convert before returning: 0-125 (external)
}

// Convert raw pillar score (0-100) to display score (0-125)
function toDisplayScore(rawScore) {
  if (rawScore === null || rawScore === 'not_measured') return null;
  return Math.round(rawScore * 1.25);
}

// Calculate overall score from display scores (0-125 each)
function calculateOverallScore(pillarDisplayScores) {
  let totalScore = 0;
  
  for (const [pillar, displayScore] of Object.entries(pillarDisplayScores)) {
    if (displayScore !== null && displayScore !== 'not_measured') {
      // Convert display (0-125) back to raw (0-100) for weighted calculation
      const rawScore = displayScore / 1.25;
      totalScore += rawScore * PILLAR_WEIGHTS[pillar];
    }
  }
  
  // Scale to 0-1000
  return Math.round(totalScore * 10);
}
```

### Storage Contract

```javascript
// What gets stored in DB / returned by API
{
  total_score: 742,           // 0-1000
  pillar_scores: {
    content_structure: 95,    // 0-125
    trust_authority: 88,      // 0-125
    entity_recognition: 102,  // 0-125
    schema_markup: 75,        // 0-125
    technical_setup: 110,     // 0-125
    speed_ux: 92,             // 0-125
    voice_optimization: 85,   // 0-125
    citation_worthiness: 95   // 0-125
  }
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

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-11 | Initial detection rulebook |
| 1.1 | 2025-12-20 | Basic addendum |
| 1.2 | 2025-12-20 | Complete specification with all 20 implementation items |
| 2.0 | 2026-01-03 | Merged into Phase 0 deliverables, added advanced sections, aligned pillar IDs |
| 2.1 | 2026-01-03 | **Alignment fixes:** Clarified scoring scales (raw 0–100 → display 0–125 → total 0–1000); fixed technical_setup headline to "Solid Foundation"; added toDisplayScore() helper |
| 2.2 | 2026-01-03 | **Score boundary rules:** Raw 0–100 is internal ONLY, must never leak past scoring module; all external systems use 0–125/0–1000; added storage contract example; prevents "recommendations don't trigger" bug class |

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `02-success-criteria.md` | Pass/fail conditions |
| `01-product-principles.md` | Core product decisions |
| `13-pillar-display-map.json` | Pillar name mappings |

---

*End of Detection & Extraction Rulebook*
