# AI Visibility Score — Detection & Extraction Rulebook

**Version:** 2.0  
**Date:** December 11, 2025  
**Purpose:** Complete specification for what to detect, extract, store, and display

---

## Table of Contents

### Core Sections
1. [Overview](#overview)
2. [Detection Architecture](#detection-architecture)
3. [Extraction Principles](#extraction-principles)
4. [Data Storage Schema](#data-storage-schema)

### Category Specifications
5. [Category 1: Technical Setup (18%)](#category-1-technical-setup)
6. [Category 2: AI Search Readiness (20%)](#category-2-ai-search-readiness)
7. [Category 3: Trust & Authority (12%)](#category-3-trust--authority)
8. [Category 4: Content Structure (15%)](#category-4-content-structure)
9. [Category 5: Voice Optimization (12%)](#category-5-voice-optimization)
10. [Category 6: AI Readability (10%)](#category-6-ai-readability)
11. [Category 7: Content Freshness (8%)](#category-7-content-freshness)
12. [Category 8: Speed & UX (5%)](#category-8-speed--ux)

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
24. [Implementation Checklist](#implementation-checklist)
25. [Document History](#document-history)

---

## Overview

### Purpose of This Document

This rulebook defines exactly:
1. **WHAT** to detect (feature presence)
2. **WHERE** to look (sources)
3. **HOW** to score (0-100 calculation)
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

---

## Detection Architecture

### Detection Pipeline

```
STAGE 1: PRE-EXTRACTION (Before any removal)
├── Extract navigation links
├── Extract site structure flags
├── Store for later use
│
STAGE 2: SCHEMA EXTRACTION
├── Parse all JSON-LD
├── Recurse into @graph and nested objects
├── Extract all @type values
├── Extract all property values
│
STAGE 3: CONTENT EXTRACTION
├── Extract FAQs (schema + HTML)
├── Extract headings
├── Extract paragraphs
├── Extract images with alt text
│
STAGE 4: ELEMENT REMOVAL
├── Remove script, style
├── Remove nav, header, footer (already extracted)
│
STAGE 5: EXTERNAL CHECKS
├── Fetch /sitemap.xml
├── Fetch /robots.txt
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

### Principle 1: Extract Everything Relevant

Don't just detect presence — capture the actual data for:
- Evidence display
- Dynamic recommendation text
- Debugging
- Future features (comparison, tracking)

### Principle 2: Normalize Data

Store data in consistent, predictable structures:
```javascript
// Good: Normalized
faqs: [
  { question: "What is X?", answer: "X is...", source: "schema" },
  { question: "How does Y?", answer: "Y works by...", source: "html" }
]

// Bad: Inconsistent
faqs: "Found 2 FAQs"
```

### Principle 3: Preserve Source Information

Track WHERE data came from:
```javascript
{
  value: "Xeo Marketing",
  source: "schema",           // Where found
  location: "Organization.name", // Specific path
  confidence: "high"          // Detection confidence
}
```

### Principle 4: Capture for Dynamic Text

Extract fields needed for recommendation text:
```javascript
// Extraction
sitemap: {
  detected: true,
  url: "/sitemap.xml",
  pageCount: 47
}

// Dynamic text uses extracted data
"✅ Sitemap detected at /sitemap.xml with 47 pages indexed"
```

---

## Data Storage Schema

### Master Evidence Object

```javascript
scanEvidence = {
  // Metadata
  url: string,                    // Scanned URL
  canonicalUrl: string,           // Canonical version
  domain: string,                 // Domain name
  scanDate: string,               // ISO timestamp
  scanDuration: number,           // Milliseconds
  
  // Category 1: Technical Setup
  technical: {
    sitemap: SitemapEvidence,
    robotsTxt: RobotsTxtEvidence,
    structuredData: StructuredDataEvidence,
    orgSchema: OrganizationEvidence,
    canonical: CanonicalEvidence,
    openGraph: OpenGraphEvidence,
    indexNow: IndexNowEvidence,
    rssFeed: RssFeedEvidence,
  },
  
  // Category 2: AI Search Readiness
  aiReadiness: {
    faqSchema: FAQSchemaEvidence,
    faqContent: FAQContentEvidence,
    questionHeadings: QuestionHeadingsEvidence,
    scannability: ScannabilityEvidence,
    readability: ReadabilityEvidence,
    snippetEligible: SnippetEvidence,
    pillarPages: PillarEvidence,
    linkedSubpages: LinkingEvidence,
    painPoints: PainPointsEvidence,
    geoContent: GeoContentEvidence,
  },
  
  // Category 3: Trust & Authority
  trust: {
    authorBios: AuthorEvidence,
    certifications: CertificationEvidence,
    teamCredentials: TeamEvidence,
    industryMemberships: MembershipEvidence,
    domainAuthority: AuthorityEvidence,
    thoughtLeadership: ThoughtLeadershipEvidence,
    thirdPartyProfiles: ProfilesEvidence,
  },
  
  // Category 4: Content Structure
  structure: {
    headingHierarchy: HeadingEvidence,
    navigation: NavigationEvidence,
    entityCues: EntityEvidence,
    accessibility: AccessibilityEvidence,
    geoMeta: GeoSchemaEvidence,
  },
  
  // Category 5: Voice Optimization
  voice: {
    conversational: ConversationalEvidence,
    speakable: SpeakableEvidence,
    featuredSnippet: FeaturedSnippetEvidence,
    localVoice: LocalVoiceEvidence,
  },
  
  // Category 6: AI Readability
  readability: {
    definitions: DefinitionsEvidence,
    structuredAnswers: AnswersEvidence,
    citationReady: CitationEvidence,
    topicClarity: TopicEvidence,
  },
  
  // Category 7: Content Freshness
  freshness: {
    lastUpdated: UpdatedEvidence,
    publicationDate: PublishedEvidence,
    versioning: VersionEvidence,
  },
  
  // Category 8: Speed & UX
  performance: {
    pageSpeed: SpeedEvidence,
    mobile: MobileEvidence,
    coreWebVitals: VitalsEvidence,
  },
  
  // Crawler Intelligence
  crawler: {
    discoveredUrls: string[],
    discoveredSections: DiscoveredSections,
    crawledPages: CrawledPage[],
    siteMetrics: SiteMetrics,
  },
}
```

---

## Category 1: Technical Setup

**Weight:** 18%  
**Purpose:** Foundation for AI crawlers to discover and parse content

---

### 1.1 XML Sitemap

**Subfactor:** `sitemapScore`  
**Threshold:** 80

#### Detection

| Source | Check | Priority |
|--------|-------|----------|
| robots.txt | `Sitemap:` directive | 1 |
| Direct URL | `/sitemap.xml` | 2 |
| Direct URL | `/sitemap_index.xml` | 3 |
| HTML head | `<link rel="sitemap">` | 4 |

#### Detection Rules

```javascript
async function detectSitemap(baseUrl) {
  // 1. Check robots.txt first
  const robotsUrl = new URL('/robots.txt', baseUrl).href;
  const robotsResponse = await fetch(robotsUrl, { redirect: 'follow' });
  
  if (robotsResponse.ok) {
    const robotsText = await robotsResponse.text();
    const sitemapMatch = robotsText.match(/Sitemap:\s*(\S+)/i);
    if (sitemapMatch) {
      return await verifySitemap(sitemapMatch[1]);
    }
  }
  
  // 2. Try common URLs
  const urls = [
    '/sitemap.xml',
    '/sitemap_index.xml',
    '/sitemap/sitemap.xml'
  ];
  
  for (const path of urls) {
    const result = await verifySitemap(new URL(path, baseUrl).href);
    if (result.detected) return result;
  }
  
  return { detected: false };
}

async function verifySitemap(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) return { detected: false };
  
  const text = await response.text();
  const isValid = text.includes('<urlset') || text.includes('<sitemapindex');
  
  if (!isValid) return { detected: false };
  
  // Extract data
  const urls = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const lastmods = [...text.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(m => m[1]);
  
  return {
    detected: true,
    url: url,
    pageCount: urls.length,
    pages: urls.slice(0, 100), // Store first 100
    mostRecentLastmod: lastmods.sort().reverse()[0] || null,
    isSitemapIndex: text.includes('<sitemapindex')
  };
}
```

#### Extraction Schema

```typescript
interface SitemapEvidence {
  detected: boolean;
  url: string | null;
  pageCount: number;
  pages: string[];              // All URLs found (max 100)
  mostRecentLastmod: string | null;
  isSitemapIndex: boolean;      // Is it an index pointing to other sitemaps?
  sourceMethod: 'robots.txt' | 'direct' | 'html-link';
  responseTime: number;         // MS to fetch
  contentType: string;          // Response content-type
}
```

#### Score Calculation

| Condition | Score |
|-----------|-------|
| No sitemap found | 0 |
| Sitemap exists, < 10 pages | 50 |
| Sitemap exists, 10-50 pages | 75 |
| Sitemap exists, > 50 pages | 100 |

#### Dynamic Text

**When Detected:**
```
✅ Sitemap Detected!

Your sitemap was found at {url} with {pageCount} pages indexed.
{mostRecentLastmod ? `Last updated: ${mostRecentLastmod}` : ''}

Next Steps:
• Ensure all important pages are included
• Submit to Google Search Console and Bing Webmaster Tools  
• Set up automatic updates when pages change
```

**When Missing:**
```
❌ No XML Sitemap Found

Your site is missing an XML sitemap. AI crawlers cannot efficiently discover your pages.

Why It Matters:
• Faster discovery: New content indexed 2-5x faster
• Complete coverage: Ensures all pages get crawled
• AI training: Better indexed pages more likely in AI training data

Impact: +56 points potential
```

---

### 1.2 Robots.txt

**Subfactor:** `robotsTxtScore`  
**Threshold:** 70

#### Detection

| Source | Check |
|--------|-------|
| Direct URL | `/robots.txt` |

#### Detection Rules

```javascript
async function detectRobotsTxt(baseUrl) {
  const url = new URL('/robots.txt', baseUrl).href;
  const response = await fetch(url, { redirect: 'follow' });
  
  if (!response.ok) {
    return { detected: false, status: response.status };
  }
  
  const text = await response.text();
  
  // Parse directives
  const directives = parseRobotsTxt(text);
  
  // Check AI crawler access
  const aiCrawlers = ['GPTBot', 'ChatGPT-User', 'Claude-Web', 'Anthropic', 'CCBot', 'Google-Extended'];
  const blockedCrawlers = [];
  const allowedCrawlers = [];
  
  for (const crawler of aiCrawlers) {
    if (isBlocked(directives, crawler)) {
      blockedCrawlers.push(crawler);
    } else {
      allowedCrawlers.push(crawler);
    }
  }
  
  return {
    detected: true,
    url: url,
    content: text,
    directives: directives,
    sitemapUrl: directives.sitemap || null,
    blockedCrawlers: blockedCrawlers,
    allowedCrawlers: allowedCrawlers,
    blocksAllAI: blockedCrawlers.length === aiCrawlers.length,
    allowsAllAI: blockedCrawlers.length === 0
  };
}
```

#### Extraction Schema

```typescript
interface RobotsTxtEvidence {
  detected: boolean;
  url: string | null;
  status: number;               // HTTP status
  content: string;              // Full robots.txt content
  sitemapUrl: string | null;    // Sitemap directive value
  directives: RobotsDirective[];
  blockedCrawlers: string[];    // AI crawlers blocked
  allowedCrawlers: string[];    // AI crawlers allowed
  blocksAllAI: boolean;
  allowsAllAI: boolean;
  hasWildcardBlock: boolean;    // Disallow: / for all
}

interface RobotsDirective {
  userAgent: string;
  rules: { type: 'allow' | 'disallow'; path: string }[];
}
```

#### Score Calculation

| Condition | Score |
|-----------|-------|
| No robots.txt | 50 |
| Exists, allows all AI crawlers | 100 |
| Exists, blocks some AI crawlers | 25 |
| Exists, blocks all AI crawlers | 0 |

#### Dynamic Text

**When Optimal:**
```
✅ Robots.txt Configured Correctly

Your robots.txt allows AI crawlers to access your content.
Allowed crawlers: {allowedCrawlers.join(', ')}
{sitemapUrl ? `Sitemap reference: ${sitemapUrl}` : ''}
```

**When Blocking AI:**
```
⚠️ Robots.txt Blocking AI Crawlers

Your robots.txt is blocking these AI crawlers: {blockedCrawlers.join(', ')}

This prevents AI assistants from indexing your content and recommending your business.

How to Fix:
Remove or modify these directives in your robots.txt file.
```

---

### 1.3 Structured Data

**Subfactor:** `structuredDataScore`  
**Threshold:** 70

#### Detection

| Source | Check |
|--------|-------|
| JSON-LD | `<script type="application/ld+json">` |
| Microdata | `itemtype`, `itemprop` attributes |
| RDFa | `typeof`, `property` attributes |

#### Detection Rules

```javascript
function detectStructuredData($, html) {
  const schemas = [];
  
  // 1. Parse JSON-LD
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const json = JSON.parse($(el).html());
      schemas.push({
        format: 'json-ld',
        data: json,
        types: extractAllTypes(json),
        raw: $(el).html()
      });
    } catch (e) {
      // Invalid JSON
    }
  });
  
  // 2. Check Microdata
  const microdataTypes = new Set();
  $('[itemtype]').each((i, el) => {
    microdataTypes.add($(el).attr('itemtype'));
  });
  
  // 3. Extract ALL types recursively
  const allTypes = new Set();
  schemas.forEach(s => s.types.forEach(t => allTypes.add(t)));
  
  return {
    detected: schemas.length > 0 || microdataTypes.size > 0,
    jsonLdCount: schemas.length,
    schemas: schemas,
    allTypes: Array.from(allTypes),
    microdataTypes: Array.from(microdataTypes),
    hasOrganization: allTypes.has('Organization') || allTypes.has('LocalBusiness'),
    hasFAQPage: allTypes.has('FAQPage'),
    hasArticle: allTypes.has('Article') || allTypes.has('BlogPosting'),
    hasProduct: allTypes.has('Product'),
    hasService: allTypes.has('Service'),
    hasWebSite: allTypes.has('WebSite'),
    hasBreadcrumb: allTypes.has('BreadcrumbList'),
    hasPostalAddress: allTypes.has('PostalAddress'),
    hasGeoCoordinates: allTypes.has('GeoCoordinates'),
    hasPerson: allTypes.has('Person'),
  };
}

function extractAllTypes(obj, types = new Set()) {
  if (!obj || typeof obj !== 'object') return types;
  
  if (obj['@type']) {
    const typeVal = obj['@type'];
    if (Array.isArray(typeVal)) {
      typeVal.forEach(t => types.add(t));
    } else {
      types.add(typeVal);
    }
  }
  
  // Recurse into ALL properties including @graph
  for (const key in obj) {
    if (Array.isArray(obj[key])) {
      obj[key].forEach(item => extractAllTypes(item, types));
    } else if (typeof obj[key] === 'object') {
      extractAllTypes(obj[key], types);
    }
  }
  
  return types;
}
```

#### Extraction Schema

```typescript
interface StructuredDataEvidence {
  detected: boolean;
  jsonLdCount: number;
  schemas: ParsedSchema[];
  allTypes: string[];           // All @type values found
  microdataTypes: string[];     // Microdata itemtypes
  
  // Quick flags for common types
  hasOrganization: boolean;
  hasFAQPage: boolean;
  hasArticle: boolean;
  hasProduct: boolean;
  hasService: boolean;
  hasWebSite: boolean;
  hasBreadcrumb: boolean;
  hasPostalAddress: boolean;
  hasGeoCoordinates: boolean;
  hasPerson: boolean;
  hasLocalBusiness: boolean;
  hasPlace: boolean;
}

interface ParsedSchema {
  format: 'json-ld' | 'microdata' | 'rdfa';
  data: object;                 // Parsed JSON
  types: string[];              // Types in this schema
  raw: string;                  // Raw script content
  valid: boolean;               // JSON parsed successfully
  errors: string[];             // Parse errors if any
}
```

#### Score Calculation

| Condition | Score |
|-----------|-------|
| No structured data | 0 |
| 1-2 schema types | 40 |
| 3-5 schema types | 70 |
| 6+ types including Organization | 100 |

#### Dynamic Text

**When Rich:**
```
✅ Structured Data Detected!

Found {jsonLdCount} JSON-LD schemas with {allTypes.length} types:
{allTypes.join(', ')}

Your structured data helps AI understand your business entity and content.
```

**When Missing:**
```
❌ No Structured Data Found

Your site lacks JSON-LD schema markup. AI assistants cannot reliably understand:
• What your business is
• What services you offer
• How to contact you

Impact: AI cannot confidently recommend your business
```

---

### 1.4 Organization Schema

**Subfactor:** `orgSchemaScore`  
**Threshold:** 70

#### Detection

| Source | Check |
|--------|-------|
| JSON-LD | @type: Organization, LocalBusiness, Corporation |
| Nested | Inside @graph array |

#### Detection Rules

```javascript
function detectOrganization(schemas) {
  const orgTypes = ['Organization', 'LocalBusiness', 'Corporation', 
                    'Restaurant', 'Store', 'MedicalBusiness', 'LegalService',
                    'FinancialService', 'RealEstateAgent', 'TravelAgency'];
  
  for (const schema of schemas) {
    const org = findSchemaByType(schema.data, orgTypes);
    if (org) {
      return {
        detected: true,
        type: org['@type'],
        name: org.name || null,
        url: org.url || null,
        logo: extractLogo(org),
        description: org.description || null,
        telephone: org.telephone || null,
        email: org.email || null,
        address: extractAddress(org.address),
        geo: extractGeo(org.geo || org.location),
        sameAs: org.sameAs || [],
        foundingDate: org.foundingDate || null,
        founders: extractFounders(org.founder || org.founders),
        contactPoint: extractContactPoint(org.contactPoint),
        areaServed: org.areaServed || null,
        hasValidUrl: org.url && isValidUrl(org.url),
        hasLogo: !!extractLogo(org),
        hasAddress: !!org.address,
        hasContact: !!(org.telephone || org.email || org.contactPoint),
        hasSocial: Array.isArray(org.sameAs) && org.sameAs.length > 0,
        completeness: calculateCompleteness(org)
      };
    }
  }
  
  return { detected: false };
}

function calculateCompleteness(org) {
  const fields = ['name', 'url', 'logo', 'description', 'telephone', 
                  'email', 'address', 'sameAs'];
  const present = fields.filter(f => org[f]).length;
  return Math.round((present / fields.length) * 100);
}
```

#### Extraction Schema

```typescript
interface OrganizationEvidence {
  detected: boolean;
  type: string;                 // Organization, LocalBusiness, etc.
  name: string | null;
  url: string | null;
  logo: LogoData | null;
  description: string | null;
  telephone: string | null;
  email: string | null;
  address: AddressData | null;
  geo: GeoData | null;
  sameAs: string[];             // Social/profile links
  foundingDate: string | null;
  founders: PersonData[];
  contactPoint: ContactPointData | null;
  areaServed: string | null;
  
  // Validation flags
  hasValidUrl: boolean;
  hasLogo: boolean;
  hasAddress: boolean;
  hasContact: boolean;
  hasSocial: boolean;
  completeness: number;         // 0-100 percentage
}

interface AddressData {
  streetAddress: string | null;
  addressLocality: string | null;   // City
  addressRegion: string | null;     // State/Province
  postalCode: string | null;
  addressCountry: string | null;
  formatted: string;                // Full formatted address
}

interface GeoData {
  latitude: number | null;
  longitude: number | null;
  hasCoordinates: boolean;
}

interface LogoData {
  url: string;
  width: number | null;
  height: number | null;
}

interface PersonData {
  name: string;
  jobTitle: string | null;
  url: string | null;
}

interface ContactPointData {
  telephone: string | null;
  email: string | null;
  contactType: string | null;
  areaServed: string | null;
  availableLanguage: string[];
}
```

#### Score Calculation

| Condition | Score |
|-----------|-------|
| No Organization schema | 0 |
| Organization with name + url only | 50 |
| + logo + description | 75 |
| + address + contact + sameAs | 100 |

#### Dynamic Text

**When Complete:**
```
✅ Organization Schema Detected!

Business: {name}
Type: {type}
{address.formatted ? `Address: ${address.formatted}` : ''}
{telephone ? `Phone: ${telephone}` : ''}
{sameAs.length ? `Profiles: ${sameAs.length} linked` : ''}

Completeness: {completeness}%
```

**When Incomplete:**
```
⚠️ Organization Schema Incomplete

Found {type} schema for "{name}" but missing key fields:
{!hasLogo ? '• Logo' : ''}
{!hasAddress ? '• Address' : ''}
{!hasContact ? '• Contact information' : ''}
{!hasSocial ? '• Social/profile links (sameAs)' : ''}

Adding these helps AI confidently identify and recommend your business.
```

---

### 1.5 Canonical & Hreflang

**Subfactor:** `canonicalHreflangScore`  
**Threshold:** 70

#### Detection

| Source | Check |
|--------|-------|
| HTML head | `<link rel="canonical">` |
| HTML head | `<link rel="alternate" hreflang="x">` |
| HTTP header | `Link:` header |

#### Detection Rules

```javascript
function detectCanonical($, responseHeaders, currentUrl) {
  // Canonical
  const canonicalTag = $('link[rel="canonical"]').attr('href');
  const canonicalHeader = parseHeaderLink(responseHeaders['link'], 'canonical');
  const canonical = canonicalTag || canonicalHeader;
  
  // Hreflang
  const hreflangs = [];
  $('link[rel="alternate"][hreflang]').each((i, el) => {
    hreflangs.push({
      lang: $(el).attr('hreflang'),
      href: $(el).attr('href')
    });
  });
  
  // Validation
  const canonicalValid = canonical && isAbsoluteUrl(canonical);
  const canonicalMatchesCurrent = canonical === currentUrl || 
                                   canonical === currentUrl.replace(/\/$/, '');
  const hasXDefault = hreflangs.some(h => h.lang === 'x-default');
  
  return {
    detected: !!canonical,
    canonical: canonical,
    canonicalSource: canonicalTag ? 'html' : (canonicalHeader ? 'header' : null),
    isAbsolute: canonicalValid,
    matchesCurrentUrl: canonicalMatchesCurrent,
    isHttps: canonical?.startsWith('https://'),
    hreflangs: hreflangs,
    hreflangCount: hreflangs.length,
    hasXDefault: hasXDefault,
    languages: hreflangs.map(h => h.lang).filter(l => l !== 'x-default')
  };
}
```

#### Extraction Schema

```typescript
interface CanonicalEvidence {
  detected: boolean;
  canonical: string | null;
  canonicalSource: 'html' | 'header' | null;
  isAbsolute: boolean;
  matchesCurrentUrl: boolean;
  isHttps: boolean;
  hreflangs: HreflangData[];
  hreflangCount: number;
  hasXDefault: boolean;
  languages: string[];
}

interface HreflangData {
  lang: string;                 // e.g., "en-US", "fr", "x-default"
  href: string;
}
```

#### Score Calculation

| Condition | Score |
|-----------|-------|
| No canonical | 0 |
| Canonical present, valid | 70 |
| Canonical + hreflang | 100 |

---

### 1.6 Open Graph Tags

**Subfactor:** `openGraphScore`  
**Threshold:** 70

#### Detection

| Source | Check |
|--------|-------|
| Meta tags | `<meta property="og:*">` |
| Meta tags | `<meta name="twitter:*">` |

#### Detection Rules

```javascript
function detectOpenGraph($) {
  const og = {};
  const twitter = {};
  
  // Open Graph
  $('meta[property^="og:"]').each((i, el) => {
    const prop = $(el).attr('property').replace('og:', '');
    og[prop] = $(el).attr('content');
  });
  
  // Twitter Cards
  $('meta[name^="twitter:"]').each((i, el) => {
    const prop = $(el).attr('name').replace('twitter:', '');
    twitter[prop] = $(el).attr('content');
  });
  
  const required = ['title', 'description', 'image', 'url'];
  const hasRequired = required.filter(f => og[f]);
  
  return {
    detected: Object.keys(og).length > 0,
    openGraph: og,
    twitter: twitter,
    
    // Individual checks
    hasTitle: !!og.title,
    hasDescription: !!og.description,
    hasImage: !!og.image,
    hasUrl: !!og.url,
    hasType: !!og.type,
    hasSiteName: !!og.site_name,
    
    // Twitter
    hasTwitterCard: !!twitter.card,
    twitterCardType: twitter.card || null,
    
    // Completeness
    requiredCount: hasRequired.length,
    requiredTotal: required.length,
    completeness: Math.round((hasRequired.length / required.length) * 100)
  };
}
```

#### Extraction Schema

```typescript
interface OpenGraphEvidence {
  detected: boolean;
  openGraph: {
    title: string | null;
    description: string | null;
    image: string | null;
    url: string | null;
    type: string | null;
    site_name: string | null;
    locale: string | null;
    [key: string]: string | null;
  };
  twitter: {
    card: string | null;
    title: string | null;
    description: string | null;
    image: string | null;
    site: string | null;
    creator: string | null;
    [key: string]: string | null;
  };
  
  // Validation
  hasTitle: boolean;
  hasDescription: boolean;
  hasImage: boolean;
  hasUrl: boolean;
  hasTwitterCard: boolean;
  completeness: number;
}
```

#### Score Calculation

| Condition | Score |
|-----------|-------|
| No OG tags | 0 |
| title + description only | 50 |
| All 4 required | 80 |
| OG + Twitter cards | 100 |

---

### 1.7 IndexNow

**Subfactor:** `indexNowScore`  
**Threshold:** 50

#### Detection & Extraction

```javascript
function detectIndexNow($, baseUrl) {
  // Check meta tag
  const metaKey = $('meta[name="indexnow-key"]').attr('content');
  
  // Check for key file (would need to try common patterns)
  let keyFileFound = false;
  let keyFileUrl = null;
  
  if (metaKey) {
    // Verify key file exists
    const keyUrl = new URL(`/${metaKey}.txt`, baseUrl).href;
    // Would need async check
  }
  
  return {
    detected: !!metaKey,
    key: metaKey || null,
    keySource: metaKey ? 'meta-tag' : null,
    keyFileVerified: keyFileFound,
    keyFileUrl: keyFileUrl
  };
}
```

#### Extraction Schema

```typescript
interface IndexNowEvidence {
  detected: boolean;
  key: string | null;
  keySource: 'meta-tag' | 'key-file' | null;
  keyFileVerified: boolean;
  keyFileUrl: string | null;
}
```

---

### 1.8 RSS Feed

**Subfactor:** `rssFeedScore`  
**Threshold:** 50

#### Detection & Extraction

```javascript
function detectRssFeed($, baseUrl) {
  // Check link tags
  const rssLinks = [];
  
  $('link[rel="alternate"][type="application/rss+xml"]').each((i, el) => {
    rssLinks.push({
      type: 'rss',
      href: $(el).attr('href'),
      title: $(el).attr('title')
    });
  });
  
  $('link[rel="alternate"][type="application/atom+xml"]').each((i, el) => {
    rssLinks.push({
      type: 'atom',
      href: $(el).attr('href'),
      title: $(el).attr('title')
    });
  });
  
  return {
    detected: rssLinks.length > 0,
    feeds: rssLinks,
    feedCount: rssLinks.length,
    primaryFeed: rssLinks[0] || null
  };
}
```

#### Extraction Schema

```typescript
interface RssFeedEvidence {
  detected: boolean;
  feeds: FeedData[];
  feedCount: number;
  primaryFeed: FeedData | null;
}

interface FeedData {
  type: 'rss' | 'atom';
  href: string;
  title: string | null;
}
```

---

## Category 2: AI Search Readiness

**Weight:** 20%  
**Purpose:** Content optimization for AI comprehension and citation

---

### 2.1 FAQ Schema

**Subfactor:** `faqSchemaScore`  
**Threshold:** 70

#### Detection

| Source | Check |
|--------|-------|
| JSON-LD | @type: FAQPage |
| JSON-LD | mainEntity with Question items |
| Nested | Inside @graph |

#### Detection Rules

```javascript
function detectFAQSchema(schemas) {
  for (const schema of schemas) {
    const faqPage = findSchemaByType(schema.data, ['FAQPage']);
    if (faqPage && faqPage.mainEntity) {
      const questions = Array.isArray(faqPage.mainEntity) 
        ? faqPage.mainEntity 
        : [faqPage.mainEntity];
      
      const faqs = questions
        .filter(q => q['@type'] === 'Question')
        .map(q => ({
          question: q.name || '',
          answer: extractAnswerText(q.acceptedAnswer),
          answerLength: extractAnswerText(q.acceptedAnswer).length
        }));
      
      return {
        detected: true,
        count: faqs.length,
        faqs: faqs,
        averageAnswerLength: average(faqs.map(f => f.answerLength)),
        hasSubstantialAnswers: faqs.every(f => f.answerLength > 50)
      };
    }
  }
  
  return { detected: false, count: 0, faqs: [] };
}

function extractAnswerText(answer) {
  if (!answer) return '';
  if (typeof answer === 'string') return answer;
  if (answer.text) return answer.text;
  if (answer['@type'] === 'Answer') return answer.text || '';
  return '';
}
```

#### Extraction Schema

```typescript
interface FAQSchemaEvidence {
  detected: boolean;
  count: number;
  faqs: FAQItem[];
  averageAnswerLength: number;
  hasSubstantialAnswers: boolean;   // All answers > 50 chars
}

interface FAQItem {
  question: string;
  answer: string;
  answerLength: number;
  source: 'schema' | 'html' | 'details' | 'heading';
}
```

#### Score Calculation

| Condition | Score |
|-----------|-------|
| No FAQPage schema | 0 |
| FAQPage with 1-2 questions | 40 |
| FAQPage with 3-5 questions | 70 |
| FAQPage with 6+ questions | 100 |

#### Dynamic Text

**When Detected:**
```
✅ FAQ Schema Detected!

Found FAQPage schema with {count} questions:
{faqs.slice(0, 3).map(f => `• ${f.question}`).join('\n')}
{count > 3 ? `...and ${count - 3} more` : ''}

Average answer length: {averageAnswerLength} characters
```

**When Missing:**
```
❌ No FAQ Schema Found

Adding FAQPage schema helps AI assistants:
• Extract your FAQs for direct answers
• Match user questions to your content
• Display rich results in search

Impact: +40-70 points potential
```

---

### 2.2 FAQ Content (Visible)

**Subfactor:** `faqContentScore`  
**Threshold:** 70

#### Detection

| Source | Check | Priority |
|--------|-------|----------|
| HTML | `<details><summary>` | 1 |
| HTML | class/id containing "faq" | 2 |
| HTML | Accordion patterns | 3 |
| HTML | Headings with "?" | 4 |
| Navigation | Link to /faq | 5 |
| Crawler | Discovered /faq URL | 6 |

#### Detection Rules

```javascript
function detectFAQContent($, navigation, crawlerData) {
  const faqs = [];
  
  // Method 1: details/summary (semantic HTML)
  $('details').each((i, el) => {
    const question = $(el).find('summary').text().trim();
    const answer = $(el).clone().find('summary').remove().end().text().trim();
    if (question && answer) {
      faqs.push({ question, answer, source: 'details', answerLength: answer.length });
    }
  });
  
  // Method 2: FAQ section by class/id
  const faqContainers = $('[class*="faq" i], [id*="faq" i], [class*="accordion" i]');
  faqContainers.find('.faq-item, .accordion-item, [class*="question"]').each((i, el) => {
    const question = $(el).find('[class*="question"], h3, h4, button').first().text().trim();
    const answer = $(el).find('[class*="answer"], [class*="content"], p').text().trim();
    if (question && answer && !faqs.find(f => f.question === question)) {
      faqs.push({ question, answer, source: 'html', answerLength: answer.length });
    }
  });
  
  // Method 3: Question headings (H2/H3 with ?)
  $('h2, h3, h4').each((i, el) => {
    const text = $(el).text().trim();
    if (text.includes('?')) {
      const nextP = $(el).next('p').text().trim();
      if (nextP && nextP.length > 30) {
        faqs.push({ question: text, answer: nextP, source: 'heading', answerLength: nextP.length });
      }
    }
  });
  
  // Method 4: Check navigation for FAQ link
  const hasFAQNavLink = navigation.links.some(l => 
    /\/faq/i.test(l.href) || /faq|frequently asked/i.test(l.text)
  );
  
  // Method 5: Check crawler discoveries
  const crawlerFoundFAQ = crawlerData.discoveredSections?.hasFaqUrl || false;
  const faqPageUrl = crawlerData.discoveredSections?.faqUrls?.[0] || null;
  
  return {
    detected: faqs.length > 0 || hasFAQNavLink || crawlerFoundFAQ,
    onPageCount: faqs.length,
    faqs: faqs,
    hasFAQNavLink: hasFAQNavLink,
    faqNavLinkHref: navigation.links.find(l => /\/faq/i.test(l.href))?.href || null,
    crawlerFoundFAQ: crawlerFoundFAQ,
    faqPageUrl: faqPageUrl,
    sources: {
      details: faqs.filter(f => f.source === 'details').length,
      html: faqs.filter(f => f.source === 'html').length,
      heading: faqs.filter(f => f.source === 'heading').length
    },
    averageAnswerLength: faqs.length ? average(faqs.map(f => f.answerLength)) : 0
  };
}
```

#### Extraction Schema

```typescript
interface FAQContentEvidence {
  detected: boolean;
  onPageCount: number;          // FAQs visible on current page
  faqs: FAQItem[];              // Extracted Q&A pairs
  
  // Site-wide FAQ indicators
  hasFAQNavLink: boolean;       // "FAQ" in navigation
  faqNavLinkHref: string | null;
  crawlerFoundFAQ: boolean;     // Crawler found /faq URL
  faqPageUrl: string | null;    // URL of FAQ page if found
  
  // Source breakdown
  sources: {
    details: number;            // From <details>/<summary>
    html: number;               // From FAQ classes/sections
    heading: number;            // From question headings
  };
  
  averageAnswerLength: number;
}
```

#### Score Calculation

| Condition | Score |
|-----------|-------|
| No FAQ anywhere | 0 |
| FAQ page exists (link/crawler) but not on current page | 40 |
| 1-2 visible FAQs | 60 |
| 3-5 visible FAQs | 80 |
| 6+ visible FAQs | 100 |

#### Dynamic Text

**When On-Page FAQs Found:**
```
✅ FAQ Content Detected!

Found {onPageCount} FAQs on this page:
{faqs.slice(0, 3).map(f => `• ${f.question}`).join('\n')}

Sources: {sources.details} from accordions, {sources.html} from sections, {sources.heading} from headings
```

**When Only Site-Wide FAQ:**
```
⚠️ FAQ Page Found, But Not On This Page

Your site has an FAQ at {faqPageUrl}, but this page has no FAQ content.

Consider adding relevant FAQs to this page for better AI visibility.
```

**When Missing:**
```
❌ No FAQ Content Detected

No visible FAQ section found on this page or your site.

Why FAQs Matter:
• AI assistants extract FAQ answers for direct responses
• Users scanning your page find answers quickly
• Increases time on site and reduces bounce

Impact: +60-100 points potential
```

---

### 2.3 Question-Based Headings

**Subfactor:** `questionHeadingsScore`  
**Threshold:** 70

#### Detection Rules

```javascript
function detectQuestionHeadings($) {
  const headings = { h1: [], h2: [], h3: [], h4: [] };
  const questionHeadings = [];
  
  const questionPatterns = [
    /\?$/,                                    // Ends with ?
    /^(what|why|how|when|where|who|which)\b/i, // Starts with question word
    /^(can|should|do|does|is|are|will)\b/i     // Starts with auxiliary verb
  ];
  
  ['h1', 'h2', 'h3', 'h4'].forEach(tag => {
    $(tag).each((i, el) => {
      const text = $(el).text().trim();
      headings[tag].push(text);
      
      if (questionPatterns.some(p => p.test(text))) {
        questionHeadings.push({
          level: tag,
          text: text,
          hasQuestionMark: text.includes('?'),
          startsWithQuestionWord: /^(what|why|how|when|where|who|which)\b/i.test(text)
        });
      }
    });
  });
  
  const totalHeadings = Object.values(headings).flat().length;
  const questionPercent = totalHeadings > 0 
    ? (questionHeadings.length / totalHeadings) * 100 
    : 0;
  
  return {
    detected: questionHeadings.length > 0,
    totalHeadings: totalHeadings,
    questionHeadingCount: questionHeadings.length,
    questionHeadings: questionHeadings,
    questionPercent: Math.round(questionPercent),
    byLevel: {
      h1: headings.h1.length,
      h2: headings.h2.length,
      h3: headings.h3.length,
      h4: headings.h4.length
    },
    questionsByLevel: {
      h1: questionHeadings.filter(h => h.level === 'h1').length,
      h2: questionHeadings.filter(h => h.level === 'h2').length,
      h3: questionHeadings.filter(h => h.level === 'h3').length,
      h4: questionHeadings.filter(h => h.level === 'h4').length
    }
  };
}
```

#### Extraction Schema

```typescript
interface QuestionHeadingsEvidence {
  detected: boolean;
  totalHeadings: number;
  questionHeadingCount: number;
  questionHeadings: QuestionHeading[];
  questionPercent: number;      // Percentage of headings that are questions
  byLevel: { h1: number; h2: number; h3: number; h4: number };
  questionsByLevel: { h1: number; h2: number; h3: number; h4: number };
}

interface QuestionHeading {
  level: 'h1' | 'h2' | 'h3' | 'h4';
  text: string;
  hasQuestionMark: boolean;
  startsWithQuestionWord: boolean;
}
```

#### Score Calculation

| Condition | Score |
|-----------|-------|
| 0% question headings | 0 |
| 1-10% | 40 |
| 11-25% | 70 |
| 26%+ | 100 |

---

### 2.4 Blog Presence

**Subfactor:** `blogScore`  
**Threshold:** 60

#### Detection

| Source | Check | Priority |
|--------|-------|----------|
| Current URL | Contains /blog, /news, /articles | 1 |
| Schema | Article, BlogPosting, NewsArticle | 2 |
| Navigation | Link to /blog | 3 |
| Crawler | Discovered /blog URLs | 4 |
| Sitemap | Contains /blog/* URLs | 5 |

#### Detection Rules

```javascript
function detectBlog(url, schemas, navigation, crawlerData) {
  // Method 1: Current page IS blog
  const currentPageIsBlog = /\/(blog|news|articles)(\/|$)/i.test(url);
  
  // Method 2: Has article schema
  const hasArticleSchema = schemas.some(s => 
    ['Article', 'BlogPosting', 'NewsArticle'].some(type => 
      s.allTypes.includes(type)
    )
  );
  
  // Method 3: Navigation link to blog
  const blogNavLink = navigation.links.find(l => 
    /\/(blog|news|articles)(\/|$)/i.test(l.href) ||
    /^(blog|news|articles)$/i.test(l.text)
  );
  const hasBlogNavLink = !!blogNavLink;
  
  // Method 4: Crawler found blog
  const crawlerFoundBlog = crawlerData.discoveredSections?.hasBlogUrl || false;
  const blogUrls = crawlerData.discoveredSections?.blogUrls || [];
  
  // Extract article metadata if on blog page
  let articleData = null;
  if (currentPageIsBlog || hasArticleSchema) {
    const articleSchema = schemas.find(s => 
      s.allTypes.includes('Article') || s.allTypes.includes('BlogPosting')
    );
    if (articleSchema) {
      articleData = {
        headline: articleSchema.data.headline,
        datePublished: articleSchema.data.datePublished,
        dateModified: articleSchema.data.dateModified,
        author: extractAuthor(articleSchema.data.author)
      };
    }
  }
  
  return {
    detected: currentPageIsBlog || hasArticleSchema || hasBlogNavLink || crawlerFoundBlog,
    currentPageIsBlog: currentPageIsBlog,
    hasArticleSchema: hasArticleSchema,
    hasBlogNavLink: hasBlogNavLink,
    blogNavLinkHref: blogNavLink?.href || null,
    crawlerFoundBlog: crawlerFoundBlog,
    blogUrls: blogUrls,
    blogUrlCount: blogUrls.length,
    articleData: articleData,
    
    // Determine blog URL
    blogUrl: blogNavLink?.href || blogUrls[0] || null
  };
}
```

#### Extraction Schema

```typescript
interface BlogEvidence {
  detected: boolean;
  currentPageIsBlog: boolean;
  hasArticleSchema: boolean;
  hasBlogNavLink: boolean;
  blogNavLinkHref: string | null;
  crawlerFoundBlog: boolean;
  blogUrls: string[];
  blogUrlCount: number;
  blogUrl: string | null;        // Best guess at blog URL
  articleData: ArticleData | null;
}

interface ArticleData {
  headline: string | null;
  datePublished: string | null;
  dateModified: string | null;
  author: PersonData | null;
}
```

#### Dynamic Text

**When Detected:**
```
✅ Blog Detected!

{currentPageIsBlog ? 'This page is a blog post.' : `Blog found at ${blogUrl}`}
{blogUrlCount > 0 ? `${blogUrlCount} blog URLs discovered on your site.` : ''}
{hasArticleSchema ? 'Article schema properly implemented.' : ''}

Thought leadership content builds authority with AI assistants.
```

**When Missing:**
```
❌ No Blog Detected

No blog, news, or articles section found on your site.

Why Blogs Matter for AI Visibility:
• Demonstrates expertise and thought leadership
• Creates content AI can cite and reference
• Builds topical authority in your industry

Consider adding a blog to establish subject matter expertise.
```

---

### 2.5 Pillar Pages

**Subfactor:** `pillarPagesScore`  
**Threshold:** 60

#### Detection Rules

```javascript
function detectPillarPage($, wordCount) {
  // Check content depth
  const isLongForm = wordCount >= 2000;
  
  // Check for table of contents
  const hasTOC = $('[class*="toc"], [id*="toc"], [class*="table-of-contents"], nav[aria-label*="content"]').length > 0;
  const hasAnchorNav = $('a[href^="#"]').length >= 5;
  
  // Check section structure
  const h2Count = $('h2').length;
  const hasMultipleSections = h2Count >= 5;
  
  // Check internal linking to subtopics
  const internalLinks = $('a[href^="/"], a[href^="./"]').length;
  const hasSubtopicLinks = internalLinks >= 10;
  
  return {
    detected: isLongForm && (hasTOC || hasMultipleSections),
    wordCount: wordCount,
    isLongForm: isLongForm,
    hasTOC: hasTOC || hasAnchorNav,
    h2Count: h2Count,
    hasMultipleSections: hasMultipleSections,
    internalLinkCount: internalLinks,
    hasSubtopicLinks: hasSubtopicLinks,
    pillarScore: calculatePillarScore({
      isLongForm, hasTOC, hasMultipleSections, hasSubtopicLinks
    })
  };
}

function calculatePillarScore(factors) {
  let score = 0;
  if (factors.isLongForm) score += 40;
  if (factors.hasTOC) score += 20;
  if (factors.hasMultipleSections) score += 25;
  if (factors.hasSubtopicLinks) score += 15;
  return score;
}
```

#### Extraction Schema

```typescript
interface PillarPagesEvidence {
  detected: boolean;
  wordCount: number;
  isLongForm: boolean;          // >= 2000 words
  hasTOC: boolean;              // Table of contents
  h2Count: number;
  hasMultipleSections: boolean; // 5+ H2s
  internalLinkCount: number;
  hasSubtopicLinks: boolean;    // 10+ internal links
  pillarScore: number;          // Composite score
}
```

---

### 2.6 Linked Subpages (Internal Linking)

**Subfactor:** `linkedSubpagesScore`  
**Threshold:** 70

#### Detection Rules

```javascript
function detectInternalLinking($, currentUrl, navigation) {
  const currentDomain = new URL(currentUrl).hostname;
  const internalLinks = [];
  const externalLinks = [];
  
  // Extract ALL links (run BEFORE nav removal)
  $('a[href]').each((i, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    const inNav = $(el).closest('nav, header, footer').length > 0;
    
    try {
      const linkUrl = new URL(href, currentUrl);
      const isInternal = linkUrl.hostname === currentDomain || 
                         href.startsWith('/') || 
                         href.startsWith('./');
      
      if (isInternal) {
        internalLinks.push({
          href: linkUrl.pathname,
          text: text,
          inNav: inNav,
          inContent: !inNav
        });
      } else {
        externalLinks.push({ href: linkUrl.href, text: text });
      }
    } catch (e) {
      // Invalid URL
    }
  });
  
  // Dedupe by path
  const uniqueInternalPaths = [...new Set(internalLinks.map(l => l.href))];
  
  // Content links (most valuable)
  const contentLinks = internalLinks.filter(l => l.inContent);
  const navLinks = internalLinks.filter(l => l.inNav);
  
  return {
    detected: internalLinks.length > 0,
    totalInternalLinks: internalLinks.length,
    uniqueInternalPages: uniqueInternalPaths.length,
    contentLinkCount: contentLinks.length,
    navLinkCount: navLinks.length,
    externalLinkCount: externalLinks.length,
    
    // Link details
    internalLinks: internalLinks.slice(0, 50),  // Store first 50
    externalLinks: externalLinks.slice(0, 20),  // Store first 20
    
    // Quality indicators
    hasContentLinks: contentLinks.length >= 3,
    linkDensity: Math.round((internalLinks.length / ($('p').length || 1)) * 10) / 10
  };
}
```

#### Extraction Schema

```typescript
interface LinkingEvidence {
  detected: boolean;
  totalInternalLinks: number;
  uniqueInternalPages: number;
  contentLinkCount: number;     // Links in body content
  navLinkCount: number;         // Links in nav/header/footer
  externalLinkCount: number;
  internalLinks: LinkData[];
  externalLinks: LinkData[];
  hasContentLinks: boolean;
  linkDensity: number;          // Links per paragraph
}

interface LinkData {
  href: string;
  text: string;
  inNav: boolean;
  inContent: boolean;
}
```

---

### 2.7-2.10 Additional AI Readiness Subfactors

#### Scannability (`scannabilityScore`)

```typescript
interface ScannabilityEvidence {
  detected: boolean;
  hasProperH1: boolean;         // Exactly 1 H1
  headingHierarchyValid: boolean;
  avgParagraphLength: number;   // Words
  hasShortParagraphs: boolean;  // Most < 150 words
  listCount: number;
  hasLists: boolean;
  emphasisCount: number;        // <strong>, <b> count
}
```

#### Readability (`readabilityScore`)

```typescript
interface ReadabilityEvidence {
  detected: boolean;
  fleschKincaidGrade: number;
  fleschReadingEase: number;
  avgSentenceLength: number;
  avgSyllablesPerWord: number;
  wordCount: number;
  sentenceCount: number;
  readabilityLevel: 'easy' | 'standard' | 'difficult' | 'very-difficult';
}
```

#### Snippet Eligibility (`snippetEligibleScore`)

```typescript
interface SnippetEvidence {
  detected: boolean;
  definitionPatterns: number;   // "What is X?" + answer
  listPatterns: number;         // Numbered/bulleted lists
  tablePatterns: number;        // Data tables
  stepPatterns: number;         // How-to steps
  conciseAnswers: number;       // 40-60 word answers after questions
  patterns: SnippetPattern[];
}

interface SnippetPattern {
  type: 'definition' | 'list' | 'table' | 'steps' | 'concise-answer';
  heading: string;
  preview: string;
}
```

#### Pain Points (`painPointsScore`)

```typescript
interface PainPointsEvidence {
  detected: boolean;
  problemMentions: number;
  solutionMentions: number;
  howToCount: number;
  problemSolutionPairs: number;
  keywords: {
    problems: string[];
    solutions: string[];
  };
}
```

#### Geographic Content (`geoContentScore`)

```typescript
interface GeoContentEvidence {
  detected: boolean;
  cityMentions: string[];
  regionMentions: string[];
  countryMentions: string[];
  addressVisible: boolean;
  addressText: string | null;
  serviceAreaMentions: string[];
  localKeywords: string[];      // "near me", "in [city]"
}
```

---

## Category 3: Trust & Authority

**Weight:** 12%  
**Purpose:** E-E-A-T signals for credibility

---

### 3.1 Author Bios

**Subfactor:** `authorBiosScore`  
**Threshold:** 60

#### Detection Rules

```javascript
function detectAuthorBios($, schemas) {
  // Check schema for author
  let schemaAuthor = null;
  for (const schema of schemas) {
    const article = findSchemaByType(schema.data, ['Article', 'BlogPosting']);
    if (article?.author) {
      schemaAuthor = extractAuthor(article.author);
    }
  }
  
  // Check HTML patterns
  const authorPatterns = [
    { selector: '[class*="author"]', type: 'class' },
    { selector: '[rel="author"]', type: 'rel' },
    { selector: '.byline', type: 'byline' },
    { selector: '[itemprop="author"]', type: 'microdata' }
  ];
  
  let htmlAuthor = null;
  for (const pattern of authorPatterns) {
    const el = $(pattern.selector).first();
    if (el.length) {
      htmlAuthor = {
        name: el.text().trim().replace(/^by\s+/i, ''),
        element: pattern.type,
        hasImage: el.find('img').length > 0,
        hasBio: el.text().length > 100,
        hasLink: el.find('a').length > 0
      };
      break;
    }
  }
  
  // Check for author page link
  const authorPageLink = $('a[href*="/author/"], a[href*="/team/"]').first().attr('href');
  
  return {
    detected: !!(schemaAuthor || htmlAuthor),
    schemaAuthor: schemaAuthor,
    htmlAuthor: htmlAuthor,
    hasAuthorSchema: !!schemaAuthor,
    hasAuthorHTML: !!htmlAuthor,
    authorName: schemaAuthor?.name || htmlAuthor?.name || null,
    hasAuthorImage: htmlAuthor?.hasImage || false,
    hasAuthorBio: htmlAuthor?.hasBio || false,
    hasAuthorLink: !!authorPageLink,
    authorPageUrl: authorPageLink || null,
    hasCredentials: detectCredentials(schemaAuthor, htmlAuthor)
  };
}
```

#### Extraction Schema

```typescript
interface AuthorEvidence {
  detected: boolean;
  schemaAuthor: PersonData | null;
  htmlAuthor: HTMLAuthorData | null;
  hasAuthorSchema: boolean;
  hasAuthorHTML: boolean;
  authorName: string | null;
  hasAuthorImage: boolean;
  hasAuthorBio: boolean;
  hasAuthorLink: boolean;
  authorPageUrl: string | null;
  hasCredentials: boolean;
}

interface HTMLAuthorData {
  name: string;
  element: string;
  hasImage: boolean;
  hasBio: boolean;
  hasLink: boolean;
}
```

---

### 3.2-3.7 Additional Trust Subfactors

#### Certifications (`certificationsScore`)

```typescript
interface CertificationEvidence {
  detected: boolean;
  certifications: CertificationData[];
  certificationCount: number;
  hasBadgeImages: boolean;
  hasCredentialSchema: boolean;
  industryRelevant: boolean;
}

interface CertificationData {
  name: string;
  source: 'text' | 'image' | 'schema';
  imageUrl: string | null;
  verified: boolean;
}
```

#### Team Credentials (`teamCredentialsScore`)

```typescript
interface TeamEvidence {
  detected: boolean;
  hasTeamPage: boolean;
  teamPageUrl: string | null;
  teamMembers: TeamMemberData[];
  memberCount: number;
  hasPersonSchema: boolean;
  avgCredentialCount: number;
}

interface TeamMemberData {
  name: string;
  title: string | null;
  bio: string | null;
  credentials: string[];
  hasImage: boolean;
  hasLinkedIn: boolean;
}
```

#### Industry Memberships (`industryMembershipsScore`)

```typescript
interface MembershipEvidence {
  detected: boolean;
  memberships: MembershipData[];
  membershipCount: number;
  hasLogos: boolean;
  hasMemberOfSchema: boolean;
}

interface MembershipData {
  organization: string;
  source: 'text' | 'logo' | 'schema';
  logoUrl: string | null;
}
```

#### Domain Authority (`domainAuthorityScore`)

```typescript
interface AuthorityEvidence {
  detected: boolean;
  sameAsLinks: string[];
  sameAsCount: number;
  hasLinkedIn: boolean;
  hasWikipedia: boolean;
  hasCrunchbase: boolean;
  hasIndustryDirectory: boolean;
  socialProfiles: string[];
  authorityScore: number;
}
```

#### Thought Leadership (`thoughtLeadershipScore`)

```typescript
interface ThoughtLeadershipEvidence {
  detected: boolean;
  hasBlog: boolean;
  blogUrl: string | null;
  articleCount: number;
  hasOriginalResearch: boolean;
  hasCaseStudies: boolean;
  hasWhitepapers: boolean;
  contentTypes: string[];
  recentArticleDate: string | null;
}
```

#### Third-Party Profiles (`thirdPartyProfilesScore`)

```typescript
interface ProfilesEvidence {
  detected: boolean;
  profiles: ProfileData[];
  profileCount: number;
  platformsCovered: string[];
  hasReviewPlatforms: boolean;
  hasIndustryDirectories: boolean;
}

interface ProfileData {
  platform: string;             // LinkedIn, G2, Capterra, etc.
  url: string;
  source: 'sameAs' | 'footer' | 'html';
}
```

---

## Category 4: Content Structure

**Weight:** 15%  
**Purpose:** Semantic HTML that AI can parse

---

### 4.1 Heading Hierarchy

**Subfactor:** `headingHierarchyScore`  
**Threshold:** 75

#### Detection Rules

```javascript
function detectHeadingHierarchy($) {
  const headings = [];
  
  $('h1, h2, h3, h4, h5, h6').each((i, el) => {
    headings.push({
      level: parseInt(el.tagName[1]),
      text: $(el).text().trim(),
      index: i
    });
  });
  
  // Check for issues
  const h1Count = headings.filter(h => h.level === 1).length;
  const hasMultipleH1 = h1Count > 1;
  const hasMissingH1 = h1Count === 0;
  
  // Check for skipped levels
  const skippedLevels = [];
  for (let i = 1; i < headings.length; i++) {
    const current = headings[i].level;
    const previous = headings[i - 1].level;
    if (current > previous + 1) {
      skippedLevels.push({ from: previous, to: current, index: i });
    }
  }
  
  // Build hierarchy tree
  const tree = buildHeadingTree(headings);
  
  return {
    detected: headings.length > 0,
    headings: headings,
    headingCount: headings.length,
    h1Count: h1Count,
    h2Count: headings.filter(h => h.level === 2).length,
    h3Count: headings.filter(h => h.level === 3).length,
    h4Count: headings.filter(h => h.level === 4).length,
    hasProperH1: h1Count === 1,
    hasMultipleH1: hasMultipleH1,
    hasMissingH1: hasMissingH1,
    skippedLevels: skippedLevels,
    hasSkippedLevels: skippedLevels.length > 0,
    hierarchyTree: tree,
    hierarchyValid: h1Count === 1 && skippedLevels.length === 0
  };
}
```

#### Extraction Schema

```typescript
interface HeadingEvidence {
  detected: boolean;
  headings: HeadingData[];
  headingCount: number;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  h4Count: number;
  hasProperH1: boolean;
  hasMultipleH1: boolean;
  hasMissingH1: boolean;
  skippedLevels: SkippedLevel[];
  hasSkippedLevels: boolean;
  hierarchyTree: HeadingNode[];
  hierarchyValid: boolean;
}

interface HeadingData {
  level: number;
  text: string;
  index: number;
}

interface SkippedLevel {
  from: number;
  to: number;
  index: number;
}

interface HeadingNode {
  level: number;
  text: string;
  children: HeadingNode[];
}
```

---

### 4.2 Navigation Structure

**Subfactor:** `navigationScore`  
**Threshold:** 70

**CRITICAL: Extract BEFORE removing nav elements**

#### Detection Rules

```javascript
function detectNavigation($) {
  // MUST run before $('nav').remove()!
  
  const navElements = [];
  const allNavLinks = [];
  
  // Find all navigation elements
  $('nav, [role="navigation"]').each((i, el) => {
    const navEl = {
      type: el.tagName.toLowerCase(),
      hasAriaLabel: !!$(el).attr('aria-label'),
      ariaLabel: $(el).attr('aria-label') || null,
      linkCount: $(el).find('a').length,
      links: []
    };
    
    $(el).find('a').each((j, link) => {
      const linkData = {
        href: $(link).attr('href') || '',
        text: $(link).text().trim(),
        inDropdown: $(link).closest('[class*="dropdown"], [class*="submenu"]').length > 0
      };
      navEl.links.push(linkData);
      allNavLinks.push(linkData);
    });
    
    navElements.push(navEl);
  });
  
  // Check for semantic structure
  const hasSemanticNav = $('nav').length > 0;
  const hasHeader = $('header').length > 0;
  const hasFooter = $('footer').length > 0;
  const hasMain = $('main').length > 0;
  const hasAside = $('aside').length > 0;
  
  // Analyze nav links for key pages
  const keyPages = {
    home: allNavLinks.some(l => l.href === '/' || /home/i.test(l.text)),
    about: allNavLinks.some(l => /about/i.test(l.href) || /about/i.test(l.text)),
    services: allNavLinks.some(l => /service/i.test(l.href) || /service/i.test(l.text)),
    blog: allNavLinks.some(l => /blog|news|article/i.test(l.href) || /blog|news/i.test(l.text)),
    faq: allNavLinks.some(l => /faq/i.test(l.href) || /faq|question/i.test(l.text)),
    contact: allNavLinks.some(l => /contact/i.test(l.href) || /contact/i.test(l.text)),
    pricing: allNavLinks.some(l => /pricing|plans/i.test(l.href) || /pricing/i.test(l.text))
  };
  
  return {
    detected: navElements.length > 0 || hasSemanticNav,
    navElements: navElements,
    navCount: navElements.length,
    totalNavLinks: allNavLinks.length,
    allNavLinks: allNavLinks,
    
    // Semantic structure
    hasSemanticNav: hasSemanticNav,
    hasHeader: hasHeader,
    hasFooter: hasFooter,
    hasMain: hasMain,
    hasAside: hasAside,
    
    // Key pages in nav
    keyPages: keyPages,
    keyPageCount: Object.values(keyPages).filter(Boolean).length,
    
    // Quality indicators
    hasAriaLabels: navElements.some(n => n.hasAriaLabel),
    hasMobileMenu: $('[class*="mobile"], [class*="hamburger"], [class*="menu-toggle"]').length > 0
  };
}
```

#### Extraction Schema

```typescript
interface NavigationEvidence {
  detected: boolean;
  navElements: NavElementData[];
  navCount: number;
  totalNavLinks: number;
  allNavLinks: NavLinkData[];
  
  // Semantic structure flags
  hasSemanticNav: boolean;
  hasHeader: boolean;
  hasFooter: boolean;
  hasMain: boolean;
  hasAside: boolean;
  
  // Key pages detected in navigation
  keyPages: {
    home: boolean;
    about: boolean;
    services: boolean;
    blog: boolean;
    faq: boolean;
    contact: boolean;
    pricing: boolean;
  };
  keyPageCount: number;
  
  // Quality
  hasAriaLabels: boolean;
  hasMobileMenu: boolean;
}

interface NavElementData {
  type: string;
  hasAriaLabel: boolean;
  ariaLabel: string | null;
  linkCount: number;
  links: NavLinkData[];
}

interface NavLinkData {
  href: string;
  text: string;
  inDropdown: boolean;
}
```

---

### 4.3-4.5 Additional Structure Subfactors

#### Entity Cues (`entityCuesScore`)

```typescript
interface EntityEvidence {
  detected: boolean;
  primaryEntity: string | null;    // Main entity from schema
  entityInTitle: boolean;
  entityInH1: boolean;
  entityInMeta: boolean;
  hasAboutSchema: boolean;
  hasMainEntitySchema: boolean;
  disambiguationLinks: string[];   // Wikidata, Wikipedia
}
```

#### Accessibility (`accessibilityScore`)

```typescript
interface AccessibilityEvidence {
  detected: boolean;
  
  // Images
  totalImages: number;
  imagesWithAlt: number;
  imagesWithEmptyAlt: number;
  imagesMissingAlt: number;
  altTextQuality: 'good' | 'poor' | 'none';
  
  // ARIA
  ariaLabelCount: number;
  ariaDescribedByCount: number;
  hasLandmarks: boolean;
  landmarks: string[];
  
  // Forms
  totalInputs: number;
  inputsWithLabels: number;
  
  // Navigation
  hasSkipLink: boolean;
  
  // Score breakdown
  imageScore: number;
  ariaScore: number;
  formScore: number;
}
```

#### Geographic Schema (`geoMetaScore`)

```typescript
interface GeoSchemaEvidence {
  detected: boolean;
  
  // Schema types found (nested or top-level)
  hasPostalAddress: boolean;
  hasGeoCoordinates: boolean;
  hasPlace: boolean;
  hasLocalBusiness: boolean;
  
  // Extracted address data
  address: AddressData | null;
  
  // Extracted coordinates
  geo: {
    latitude: number | null;
    longitude: number | null;
  } | null;
  
  // Meta tags
  hasGeoMeta: boolean;
  geoPosition: string | null;
  geoPlacename: string | null;
  geoRegion: string | null;
  
  // Completeness
  addressComplete: boolean;       // Has street, city, region, postal, country
  hasCoordinates: boolean;
  completeness: number;           // 0-100
}
```

---

## Category 5: Voice Optimization

**Weight:** 12%

### Extraction Schemas

```typescript
interface ConversationalEvidence {
  detected: boolean;
  avgSentenceLength: number;
  sentenceLengthVariation: number;
  questionCount: number;
  secondPersonCount: number;      // "you", "your"
  contractionCount: number;
  conversationalScore: number;
}

interface SpeakableEvidence {
  detected: boolean;
  hasSpeakableSchema: boolean;
  speakableSelectors: string[];
  speakableContent: string[];
}

interface FeaturedSnippetEvidence {
  detected: boolean;
  definitionCount: number;
  listCount: number;
  tableCount: number;
  stepCount: number;
  conciseAnswerCount: number;
  snippetPatterns: SnippetPattern[];
}

interface LocalVoiceEvidence {
  detected: boolean;
  nearMePatterns: number;
  serviceAreaMentions: string[];
  hasAreaServedSchema: boolean;
  localQueries: string[];
}
```

---

## Category 6: AI Readability

**Weight:** 10%

### Extraction Schemas

```typescript
interface DefinitionsEvidence {
  detected: boolean;
  dfnTags: number;
  definitionPatterns: DefinitionData[];
  hasGlossary: boolean;
  hasDefinedTermSchema: boolean;
}

interface DefinitionData {
  term: string;
  definition: string;
  source: 'dfn' | 'pattern' | 'schema';
}

interface StructuredAnswersEvidence {
  detected: boolean;
  questionAnswerPairs: number;
  tldrSections: number;
  summaryBoxes: number;
  keyTakeaways: number;
}

interface CitationEvidence {
  detected: boolean;
  statistics: StatisticData[];
  quotes: QuoteData[];
  sourceLinks: string[];
  citeTags: number;
  attributions: number;
}

interface StatisticData {
  value: string;
  context: string;
  hasSource: boolean;
}

interface QuoteData {
  text: string;
  attribution: string | null;
}

interface TopicEvidence {
  detected: boolean;
  titleTopic: string | null;
  h1Topic: string | null;
  metaTopic: string | null;
  topicsAlign: boolean;
  hasAboutSchema: boolean;
  mainEntity: string | null;
}
```

---

## Category 7: Content Freshness

**Weight:** 8%

### Extraction Schemas

```typescript
interface UpdatedEvidence {
  detected: boolean;
  lastUpdated: string | null;
  lastUpdatedSource: 'html' | 'schema' | 'header' | null;
  daysSinceUpdate: number | null;
  isRecent: boolean;              // < 6 months
}

interface PublishedEvidence {
  detected: boolean;
  datePublished: string | null;
  datePublishedSource: 'schema' | 'meta' | 'html' | null;
  hasTimeElement: boolean;
}

interface VersionEvidence {
  detected: boolean;
  versionMentioned: boolean;
  yearReferences: string[];
  hasChangelog: boolean;
  hasEditorNotes: boolean;
}
```

---

## Category 8: Speed & UX

**Weight:** 5%

### Extraction Schemas

```typescript
interface SpeedEvidence {
  detected: boolean;
  ttfb: number;                   // Time to first byte (ms)
  totalLoadTime: number;          // Total time (ms)
  pageSize: number;               // Bytes
  requestCount: number;
  hasCompression: boolean;
  hasCaching: boolean;
}

interface MobileEvidence {
  detected: boolean;
  hasViewportMeta: boolean;
  viewportContent: string | null;
  hasResponsiveImages: boolean;
  hasMobileMenu: boolean;
  touchTargetsAdequate: boolean;
}

interface VitalsEvidence {
  detected: boolean;
  lcp: number | null;             // Largest Contentful Paint
  fid: number | null;             // First Input Delay
  cls: number | null;             // Cumulative Layout Shift
  lcpRating: 'good' | 'needs-improvement' | 'poor' | null;
  fidRating: 'good' | 'needs-improvement' | 'poor' | null;
  clsRating: 'good' | 'needs-improvement' | 'poor' | null;
}
```

---

## Evidence Confidence & Conflict Resolution

### Confidence Model

Every extracted piece of evidence has a confidence level:

```typescript
type ConfidenceLevel = 'high' | 'medium' | 'low';

interface EvidenceWithConfidence {
  value: any;
  source: EvidenceSource;
  confidence: ConfidenceLevel;
  conflictsWith?: string[];      // Other sources that disagree
  resolvedBy?: string;           // Which rule resolved conflict
}
```

#### Confidence Definitions

| Level | Definition | Example |
|-------|------------|---------|
| **High** | Structured, machine-readable, validated | JSON-LD schema parsed successfully |
| **Medium** | Semi-structured, pattern-matched | HTML class="faq" with Q&A content |
| **Low** | Inferred, heuristic-based | Heading with "?" assumed to be FAQ |

#### Source Confidence Rankings

```javascript
const SOURCE_CONFIDENCE = {
  'schema-jsonld': 'high',
  'schema-microdata': 'high',
  'meta-tags': 'high',
  'html-semantic': 'medium',      // <nav>, <article>, <details>
  'html-class-id': 'medium',      // class="faq", id="blog"
  'html-pattern': 'low',          // Text patterns, heuristics
  'navigation-link': 'medium',
  'crawler-discovery': 'medium',
  'external-file': 'high',        // sitemap.xml, robots.txt
  'http-header': 'high'
};
```

### Conflict Resolution Rules

When sources disagree, apply these rules in order:

#### Rule 1: Higher Confidence Wins

```javascript
function resolveByConfidence(evidenceA, evidenceB) {
  const rank = { high: 3, medium: 2, low: 1 };
  if (rank[evidenceA.confidence] > rank[evidenceB.confidence]) {
    return { winner: evidenceA, rule: 'higher-confidence' };
  }
  if (rank[evidenceB.confidence] > rank[evidenceA.confidence]) {
    return { winner: evidenceB, rule: 'higher-confidence' };
  }
  return null; // Same confidence, use next rule
}
```

#### Rule 2: Structured Over Unstructured

```
Schema > HTML patterns > Inferences
```

#### Rule 3: Present Over Absent

If one source says "exists" and another is silent, trust the positive signal:

```javascript
// Schema says FAQ exists, HTML detection found nothing
// Result: FAQ detected (schema is positive signal)

// Navigation links to /blog, crawler didn't find blog content
// Result: Blog exists (nav link is positive signal, crawler may not have crawled it)
```

#### Rule 4: Recent Over Stale

For time-sensitive data, prefer more recent:

```javascript
// Schema dateModified: 2024-01-01
// HTML "Updated: December 2025"
// Result: Use December 2025 (more recent)
```

#### Rule 5: Specific Over Generic

```javascript
// Schema: Organization name = "Xeo Marketing Inc."
// HTML footer: "© Xeo Marketing"
// Result: Use "Xeo Marketing Inc." (more specific)
```

### Common Conflict Scenarios

| Conflict | Resolution | Rule Applied |
|----------|------------|--------------|
| Schema FAQ exists, HTML FAQ empty | Detected (schema wins) | Structured over unstructured |
| Nav links to /blog, crawler found 0 posts | Detected, flagged incomplete | Present over absent |
| Org schema name ≠ visible business name | Flag mismatch, use schema | Structured over unstructured |
| Schema dates stale, HTML shows recent | Use HTML date | Recent over stale |
| Multiple Organization schemas | Use first/most complete | Specific over generic |

### Conflict Flagging

When conflicts exist, flag them for user awareness:

```typescript
interface ConflictReport {
  subfactor: string;
  conflictType: 'value-mismatch' | 'presence-disagreement' | 'date-mismatch';
  sources: {
    source: string;
    value: any;
    confidence: ConfidenceLevel;
  }[];
  resolution: {
    winner: string;
    rule: string;
  };
  userAction?: string;           // "Consider updating schema to match visible name"
}
```

#### Example Conflict Output

```javascript
{
  subfactor: 'orgSchema',
  conflictType: 'value-mismatch',
  sources: [
    { source: 'schema-jsonld', value: 'Xeo Marketing Inc.', confidence: 'high' },
    { source: 'html-footer', value: 'Xeo Marketing', confidence: 'medium' }
  ],
  resolution: {
    winner: 'schema-jsonld',
    rule: 'structured-over-unstructured'
  },
  userAction: 'Organization names differ slightly. Consider aligning for consistency.'
}
```

---

## Site-Level vs Page-Level Separation

### Evidence Layers

The scanner produces THREE distinct evidence layers:

```typescript
interface ScanResult {
  // Layer 1: Current page only
  pageEvidence: PageEvidence;
  
  // Layer 2: Site-wide (from crawler + external files)
  siteEvidence: SiteEvidence;
  
  // Layer 3: Combined (merged with conflict resolution)
  combinedEvidence: CombinedEvidence;
}
```

### Page Evidence

Data extracted from the single scanned URL:

```typescript
interface PageEvidence {
  url: string;
  
  // What's ON this page
  schemas: ParsedSchema[];           // JSON-LD on this page
  headings: HeadingData[];           // Headings on this page
  faqs: FAQItem[];                   // FAQs visible on this page
  content: ContentData;              // Text content on this page
  navigation: NavigationEvidence;    // Nav links (extracted before removal)
  meta: MetaTagData;                 // Meta tags on this page
  
  // Page-specific scores
  pageScores: {
    faqSchemaScore: number;          // FAQ schema ON this page
    faqContentScore: number;         // Visible FAQs ON this page
    headingScore: number;            // Heading hierarchy ON this page
    readabilityScore: number;        // Readability OF this page
    // ... etc
  };
}
```

### Site Evidence

Data from crawling + external resources:

```typescript
interface SiteEvidence {
  domain: string;
  
  // Discovered URLs
  discoveredUrls: string[];
  crawledUrls: string[];
  
  // Site-wide resources
  sitemap: SitemapEvidence;          // From /sitemap.xml
  robotsTxt: RobotsTxtEvidence;      // From /robots.txt
  
  // Discovered sections (from URL patterns)
  discoveredSections: {
    blogUrls: string[];
    faqUrls: string[];
    aboutUrls: string[];
    contactUrls: string[];
    serviceUrls: string[];
  };
  
  // Aggregated from all crawled pages
  siteMetrics: {
    totalPages: number;
    pagesWithFAQ: number;
    pagesWithSchema: number;
    pagesWithBlog: number;
    avgReadabilityScore: number;
  };
  
  // Site-specific scores
  siteScores: {
    sitemapScore: number;            // Site has sitemap
    robotsTxtScore: number;          // Site has robots.txt
    blogPresenceScore: number;       // Site has blog section
    faqPresenceScore: number;        // Site has FAQ section
    // ... etc
  };
}
```

### Combined Evidence

Merged view with conflict resolution applied:

```typescript
interface CombinedEvidence {
  // Merged scores (using max, avg, or custom logic per subfactor)
  scores: {
    [subfactor: string]: {
      score: number;
      pageContribution: number;
      siteContribution: number;
      source: 'page' | 'site' | 'combined';
    };
  };
  
  // Conflicts detected
  conflicts: ConflictReport[];
  
  // Gaps (site has it, page doesn't)
  gaps: {
    subfactor: string;
    siteHas: boolean;
    pageHas: boolean;
    recommendation: string;
  }[];
}
```

### Scoring Rules by Level

| Subfactor | Level | Logic |
|-----------|-------|-------|
| `sitemapScore` | Site | Site-level only (sitemap serves whole site) |
| `robotsTxtScore` | Site | Site-level only |
| `orgSchemaScore` | Site | Usually on homepage, applies to site |
| `faqSchemaScore` | Page | Score for THIS page's FAQ schema |
| `faqPresenceScore` | Site | Does site HAVE an FAQ section anywhere? |
| `faqContentScore` | Page | Visible FAQs ON this page |
| `blogPresenceScore` | Site | Does site have a blog? |
| `headingHierarchyScore` | Page | This page's heading structure |
| `readabilityScore` | Page | This page's readability |
| `pageSpeedScore` | Page | This page's load time |

### Recommendation Targeting

Recommendations must specify which level they target:

```typescript
interface Recommendation {
  id: string;
  title: string;
  level: 'page' | 'site' | 'both';
  
  // Different messages per level
  pageMessage?: string;    // "Add FAQ schema to THIS page"
  siteMessage?: string;    // "Your site needs an FAQ section"
  
  // Where to implement
  implementationTarget: {
    page?: string;         // Specific URL
    site?: boolean;        // Site-wide change
    files?: string[];      // Specific files (sitemap.xml, robots.txt)
  };
}
```

#### Example: FAQ Recommendation

```javascript
// Site has /faq page, but current page has no FAQ
{
  id: 'add-faq-to-page',
  title: 'Add FAQ Section to This Page',
  level: 'page',
  pageMessage: 'This page has no FAQ content. Your site has an FAQ at /faq — consider adding relevant FAQs here.',
  siteMessage: null,  // Not a site-level issue
  implementationTarget: {
    page: currentUrl,
    site: false
  }
}

// Site has NO faq anywhere
{
  id: 'add-faq-to-site',
  title: 'Add FAQ Section to Your Site',
  level: 'site',
  pageMessage: null,
  siteMessage: 'Your site has no FAQ section. Add a dedicated /faq page or FAQ content to key pages.',
  implementationTarget: {
    site: true
  }
}
```

---

## Detection State Lifecycle

### State Model

Each detected feature has a lifecycle state:

```typescript
type DetectionState = 
  | 'not_detected'           // Feature not found
  | 'detected'               // Feature found by scanner
  | 'implemented_unverified' // User marked as implemented, not yet rescanned
  | 'implemented_verified'   // Rescan confirmed implementation
  | 'regressed'              // Was verified, now degraded
  | 'skipped';               // User skipped this recommendation

interface FeatureState {
  subfactor: string;
  state: DetectionState;
  
  // Timestamps
  firstDetected: string | null;
  lastVerified: string | null;
  markedImplementedAt: string | null;
  
  // History
  stateHistory: {
    state: DetectionState;
    timestamp: string;
    trigger: 'scan' | 'user_action' | 'rescan';
  }[];
  
  // Cycle tracking (for 5-day feature)
  cycleStartDate: string | null;
  cycleEndDate: string | null;
  cycleNumber: number;
}
```

### State Transitions

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌──────────────┐                                               │
│  │ not_detected │◄────────────────────────────────────────────┐ │
│  └──────┬───────┘                                             │ │
│         │ scan finds feature                                  │ │
│         ▼                                                     │ │
│  ┌──────────────┐                                             │ │
│  │   detected   │◄──────────────────────────────┐             │ │
│  └──────┬───────┘                               │             │ │
│         │ user marks implemented                │             │ │
│         ▼                                       │             │ │
│  ┌─────────────────────────┐                    │             │ │
│  │ implemented_unverified  │                    │             │ │
│  └──────┬──────────────────┘                    │             │ │
│         │                                       │             │ │
│         ├── rescan confirms ──────────┐         │             │ │
│         │                             ▼         │             │ │
│         │                    ┌─────────────────────────┐      │ │
│         │                    │  implemented_verified   │      │ │
│         │                    └──────────┬──────────────┘      │ │
│         │                               │                     │ │
│         │                               │ rescan shows decline│ │
│         │                               ▼                     │ │
│         │                    ┌──────────────┐                 │ │
│         │                    │  regressed   │─────────────────┘ │
│         │                    └──────────────┘                   │
│         │                                                       │
│         └── rescan no change ───────────────────────────────────┘
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Transition Rules

```typescript
interface StateTransition {
  from: DetectionState;
  to: DetectionState;
  trigger: TransitionTrigger;
  condition: (current: FeatureState, scanResult: any) => boolean;
}

type TransitionTrigger = 
  | 'initial_scan'
  | 'user_marks_implemented'
  | 'user_skips'
  | 'rescan_improved'
  | 'rescan_same'
  | 'rescan_declined'
  | 'cycle_expired';

const TRANSITIONS: StateTransition[] = [
  // Initial detection
  {
    from: 'not_detected',
    to: 'detected',
    trigger: 'initial_scan',
    condition: (_, scan) => scan.detected === true
  },
  
  // User marks implemented
  {
    from: 'detected',
    to: 'implemented_unverified',
    trigger: 'user_marks_implemented',
    condition: () => true
  },
  {
    from: 'not_detected',
    to: 'implemented_unverified',
    trigger: 'user_marks_implemented',
    condition: () => true
  },
  
  // Rescan verification
  {
    from: 'implemented_unverified',
    to: 'implemented_verified',
    trigger: 'rescan_improved',
    condition: (current, scan) => scan.score > current.previousScore + 10
  },
  {
    from: 'implemented_unverified',
    to: 'detected',
    trigger: 'rescan_same',
    condition: (current, scan) => Math.abs(scan.score - current.previousScore) <= 10
  },
  
  // Regression
  {
    from: 'implemented_verified',
    to: 'regressed',
    trigger: 'rescan_declined',
    condition: (current, scan) => scan.score < current.previousScore - 20
  },
  
  // Recovery from regression
  {
    from: 'regressed',
    to: 'detected',
    trigger: 'rescan_improved',
    condition: (_, scan) => scan.detected === true
  }
];
```

### 5-Day Cycle Integration

```typescript
interface CycleConfig {
  cycleDays: number;              // 5 for free, shorter for paid
  maxRecommendations: number;     // 5 for free, more for paid
  skipCooldownDays: number;       // 5 days before skipped item can return
}

function shouldShowRecommendation(
  feature: FeatureState, 
  config: CycleConfig
): boolean {
  // Don't show if verified
  if (feature.state === 'implemented_verified') return false;
  
  // Don't show if skipped within cooldown
  if (feature.state === 'skipped') {
    const skipDate = new Date(feature.markedImplementedAt);
    const cooldownEnd = addDays(skipDate, config.skipCooldownDays);
    if (new Date() < cooldownEnd) return false;
  }
  
  // Show if detected or unverified
  return ['not_detected', 'detected', 'implemented_unverified', 'regressed']
    .includes(feature.state);
}
```

### Dynamic Text by State

```typescript
const STATE_TEXT: Record<DetectionState, (data: any) => string> = {
  not_detected: (d) => `❌ Not Detected\n${d.missingText}`,
  
  detected: (d) => `✅ Detected\n${d.detectedText}`,
  
  implemented_unverified: (d) => 
    `⏳ Marked Implemented — Awaiting Verification\n` +
    `You marked this as implemented on ${d.markedDate}. ` +
    `Run a new scan to verify.`,
  
  implemented_verified: (d) => 
    `✅ Verified Implemented!\n` +
    `Confirmed working as of ${d.verifiedDate}.`,
  
  regressed: (d) => 
    `⚠️ Regression Detected\n` +
    `This was previously working but has degraded. ` +
    `Score dropped from ${d.previousScore} to ${d.currentScore}.`,
  
  skipped: (d) => 
    `⏭️ Skipped\n` +
    `You skipped this on ${d.skippedDate}. ` +
    `It will return in ${d.daysRemaining} days.`
};
```

---

## Negative & Anti-Patterns Detection

### Anti-Pattern Categories

Detection should identify **harmful patterns** that hurt AI visibility more than missing features.

```typescript
interface AntiPattern {
  id: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  detection: (evidence: any) => boolean;
  penaltyPoints: number;
  recommendation: string;
}
```

### Technical Anti-Patterns

```typescript
const TECHNICAL_ANTI_PATTERNS: AntiPattern[] = [
  {
    id: 'ai-crawlers-blocked',
    category: 'technical',
    severity: 'critical',
    detection: (e) => e.robotsTxt.blocksAllAI,
    penaltyPoints: -100,
    recommendation: 'Your robots.txt is blocking AI crawlers. This prevents AI assistants from indexing your content entirely.'
  },
  {
    id: 'noindex-meta',
    category: 'technical',
    severity: 'critical',
    detection: (e) => e.meta.robots?.includes('noindex'),
    penaltyPoints: -100,
    recommendation: 'This page has a noindex directive. AI crawlers will not index this content.'
  },
  {
    id: 'canonical-mismatch',
    category: 'technical',
    severity: 'high',
    detection: (e) => e.canonical.detected && !e.canonical.matchesCurrentUrl && !e.canonical.isIntentionalConsolidation,
    penaltyPoints: -30,
    recommendation: 'Canonical URL points to a different page. This may confuse AI about which page to index.'
  },
  {
    id: 'sitemap-stale',
    category: 'technical',
    severity: 'medium',
    detection: (e) => {
      if (!e.sitemap.mostRecentLastmod) return false;
      const lastmod = new Date(e.sitemap.mostRecentLastmod);
      const monthsAgo = (Date.now() - lastmod.getTime()) / (1000 * 60 * 60 * 24 * 30);
      return monthsAgo > 6;
    },
    penaltyPoints: -15,
    recommendation: 'Your sitemap hasn\'t been updated in over 6 months. AI crawlers may deprioritize stale sitemaps.'
  }
];
```

### Schema Anti-Patterns

```typescript
const SCHEMA_ANTI_PATTERNS: AntiPattern[] = [
  {
    id: 'faq-empty-answers',
    category: 'schema',
    severity: 'high',
    detection: (e) => {
      if (!e.faqSchema.detected) return false;
      return e.faqSchema.faqs.some(f => !f.answer || f.answer.length < 20);
    },
    penaltyPoints: -40,
    recommendation: 'FAQ schema has empty or very short answers. This is worse than no FAQ — AI may flag as spam.'
  },
  {
    id: 'faq-duplicate-questions',
    category: 'schema',
    severity: 'medium',
    detection: (e) => {
      if (!e.faqSchema.detected) return false;
      const questions = e.faqSchema.faqs.map(f => f.question.toLowerCase());
      return new Set(questions).size !== questions.length;
    },
    penaltyPoints: -25,
    recommendation: 'FAQ schema contains duplicate questions. Remove duplicates to avoid spam signals.'
  },
  {
    id: 'org-schema-invalid-url',
    category: 'schema',
    severity: 'high',
    detection: (e) => {
      if (!e.orgSchema.detected) return false;
      return e.orgSchema.url && !e.orgSchema.hasValidUrl;
    },
    penaltyPoints: -30,
    recommendation: 'Organization schema has an invalid or unreachable URL. This hurts credibility.'
  },
  {
    id: 'schema-json-invalid',
    category: 'schema',
    severity: 'high',
    detection: (e) => e.structuredData.schemas.some(s => !s.valid),
    penaltyPoints: -35,
    recommendation: 'JSON-LD schema has syntax errors. Invalid schema is worse than no schema.'
  },
  {
    id: 'sameas-broken-links',
    category: 'schema',
    severity: 'medium',
    detection: (e) => e.orgSchema.sameAs?.some(url => e.brokenLinks?.includes(url)),
    penaltyPoints: -20,
    recommendation: 'SameAs links in Organization schema are broken. Remove or fix invalid profile URLs.'
  }
];
```

### Content Anti-Patterns

```typescript
const CONTENT_ANTI_PATTERNS: AntiPattern[] = [
  {
    id: 'keyword-stuffed-headings',
    category: 'content',
    severity: 'high',
    detection: (e) => {
      // Check for repetitive keywords in headings
      const headingText = e.headings.map(h => h.text).join(' ').toLowerCase();
      const words = headingText.split(/\s+/);
      const wordCounts = {};
      words.forEach(w => wordCounts[w] = (wordCounts[w] || 0) + 1);
      const maxRepeat = Math.max(...Object.values(wordCounts));
      return maxRepeat > 5 && words.length < 50;
    },
    penaltyPoints: -30,
    recommendation: 'Headings appear keyword-stuffed. AI penalizes obvious SEO manipulation.'
  },
  {
    id: 'thin-content',
    category: 'content',
    severity: 'medium',
    detection: (e) => e.readability.wordCount < 300 && !e.meta.isLandingPage,
    penaltyPoints: -20,
    recommendation: 'Page has thin content (< 300 words). AI prefers comprehensive content.'
  },
  {
    id: 'no-headings',
    category: 'content',
    severity: 'medium',
    detection: (e) => e.headings.headingCount === 0,
    penaltyPoints: -25,
    recommendation: 'Page has no headings. AI cannot understand content structure.'
  },
  {
    id: 'heading-hierarchy-broken',
    category: 'content',
    severity: 'medium',
    detection: (e) => e.headings.hasMultipleH1 || e.headings.hasSkippedLevels,
    penaltyPoints: -15,
    recommendation: 'Heading hierarchy is broken (multiple H1s or skipped levels). Fix for better AI parsing.'
  },
  {
    id: 'images-no-alt',
    category: 'content',
    severity: 'medium',
    detection: (e) => {
      if (e.accessibility.totalImages === 0) return false;
      return e.accessibility.imagesWithAlt / e.accessibility.totalImages < 0.5;
    },
    penaltyPoints: -20,
    recommendation: 'Over half of images lack alt text. AI cannot understand image content.'
  },
  {
    id: 'blog-stale',
    category: 'content',
    severity: 'medium',
    detection: (e) => {
      if (!e.blog.detected || !e.blog.articleData?.datePublished) return false;
      const published = new Date(e.blog.articleData.datePublished);
      const yearsAgo = (Date.now() - published.getTime()) / (1000 * 60 * 60 * 24 * 365);
      return yearsAgo > 2;
    },
    penaltyPoints: -15,
    recommendation: 'Blog content is over 2 years old. AI prefers fresh, current content.'
  }
];
```

### Trust Anti-Patterns

```typescript
const TRUST_ANTI_PATTERNS: AntiPattern[] = [
  {
    id: 'no-https',
    category: 'trust',
    severity: 'high',
    detection: (e) => !e.url.startsWith('https://'),
    penaltyPoints: -40,
    recommendation: 'Site is not using HTTPS. AI assistants may not recommend insecure sites.'
  },
  {
    id: 'anonymous-author',
    category: 'trust',
    severity: 'low',
    detection: (e) => e.author.detected && (!e.author.authorName || e.author.authorName === 'Admin'),
    penaltyPoints: -10,
    recommendation: 'Author is anonymous or generic ("Admin"). Real author names build trust.'
  },
  {
    id: 'fake-reviews-pattern',
    category: 'trust',
    severity: 'critical',
    detection: (e) => {
      // Check for suspicious review patterns
      // All 5-star, similar dates, similar language
      return false; // Complex detection - placeholder
    },
    penaltyPoints: -50,
    recommendation: 'Review pattern appears inauthentic. AI may flag as spam.'
  }
];
```

### Anti-Pattern Score Integration

```typescript
function calculateFinalScore(baseScore: number, antiPatterns: AntiPattern[]): number {
  const detectedAntiPatterns = antiPatterns.filter(ap => ap.detected);
  const totalPenalty = detectedAntiPatterns.reduce((sum, ap) => sum + ap.penaltyPoints, 0);
  
  return Math.max(0, baseScore + totalPenalty);
}

function generateAntiPatternReport(evidence: any): AntiPatternReport {
  const allPatterns = [
    ...TECHNICAL_ANTI_PATTERNS,
    ...SCHEMA_ANTI_PATTERNS,
    ...CONTENT_ANTI_PATTERNS,
    ...TRUST_ANTI_PATTERNS
  ];
  
  const detected = allPatterns
    .map(ap => ({ ...ap, detected: ap.detection(evidence) }))
    .filter(ap => ap.detected);
  
  return {
    count: detected.length,
    totalPenalty: detected.reduce((sum, ap) => sum + ap.penaltyPoints, 0),
    critical: detected.filter(ap => ap.severity === 'critical'),
    high: detected.filter(ap => ap.severity === 'high'),
    medium: detected.filter(ap => ap.severity === 'medium'),
    low: detected.filter(ap => ap.severity === 'low'),
    patterns: detected
  };
}
```

### Anti-Pattern Recommendations

Anti-patterns generate PRIORITY recommendations:

```typescript
function prioritizeRecommendations(
  missingFeatures: Recommendation[],
  antiPatterns: AntiPatternReport
): Recommendation[] {
  // Anti-patterns come FIRST (they hurt more than missing features)
  const antiPatternRecs = antiPatterns.patterns.map(ap => ({
    id: ap.id,
    title: `⚠️ Fix: ${ap.id.replace(/-/g, ' ')}`,
    priority: ap.severity === 'critical' ? 0 : ap.severity === 'high' ? 1 : 2,
    type: 'anti-pattern',
    message: ap.recommendation,
    impact: Math.abs(ap.penaltyPoints)
  }));
  
  // Sort: critical anti-patterns first, then high, then missing features
  return [
    ...antiPatternRecs.filter(r => r.priority === 0),
    ...antiPatternRecs.filter(r => r.priority === 1),
    ...missingFeatures,
    ...antiPatternRecs.filter(r => r.priority === 2)
  ];
}
```

---

## Entity Disambiguation & Identity Resolution

### Ambiguity Detection

```typescript
interface EntityAmbiguity {
  entityName: string;
  ambiguityType: 'name-collision' | 'missing-identifiers' | 'conflicting-sameas' | 'generic-name';
  confidence: 'high' | 'medium' | 'low';
  disambiguationStatus: 'resolved' | 'ambiguous' | 'unknown';
  suggestions: string[];
}
```

### Detection Rules

```typescript
function detectEntityAmbiguity(evidence: any): EntityAmbiguity[] {
  const ambiguities: EntityAmbiguity[] = [];
  
  // Check 1: Generic company name
  const genericPatterns = [
    /^(the )?(consulting|solutions|services|group|partners|associates|llc|inc|ltd)$/i,
    /^(abc|xyz|acme|test)/i
  ];
  
  if (evidence.orgSchema.name && genericPatterns.some(p => p.test(evidence.orgSchema.name))) {
    ambiguities.push({
      entityName: evidence.orgSchema.name,
      ambiguityType: 'generic-name',
      confidence: 'high',
      disambiguationStatus: 'ambiguous',
      suggestions: [
        'Add sameAs links to LinkedIn, Crunchbase, or industry directories',
        'Include founding date and location to differentiate',
        'Add unique identifiers (DUNS number, registration number)'
      ]
    });
  }
  
  // Check 2: Missing unique identifiers
  if (evidence.orgSchema.detected) {
    const hasDisambiguation = 
      evidence.orgSchema.sameAs?.some(url => 
        /linkedin|crunchbase|wikipedia|wikidata|dnb\.com/i.test(url)
      );
    
    if (!hasDisambiguation) {
      ambiguities.push({
        entityName: evidence.orgSchema.name,
        ambiguityType: 'missing-identifiers',
        confidence: 'medium',
        disambiguationStatus: 'ambiguous',
        suggestions: [
          'Add LinkedIn company page URL to sameAs',
          'Add Crunchbase profile if available',
          'Add Wikipedia/Wikidata link if notable',
          'Include duns, taxID, or leiCode if applicable'
        ]
      });
    }
  }
  
  // Check 3: Conflicting sameAs links
  if (evidence.orgSchema.sameAs?.length > 1) {
    // Check if sameAs links point to different entities
    // (Would need external validation)
  }
  
  // Check 4: Name differs across sources
  if (evidence.orgSchema.name && evidence.htmlBusinessName) {
    if (evidence.orgSchema.name.toLowerCase() !== evidence.htmlBusinessName.toLowerCase()) {
      ambiguities.push({
        entityName: evidence.orgSchema.name,
        ambiguityType: 'name-collision',
        confidence: 'medium',
        disambiguationStatus: 'ambiguous',
        suggestions: [
          'Align Organization schema name with visible business name',
          'Use consistent branding across all sources'
        ]
      });
    }
  }
  
  return ambiguities;
}
```

### Disambiguation Score

```typescript
function calculateDisambiguationScore(evidence: any): number {
  let score = 0;
  const maxScore = 100;
  
  // Has Organization schema
  if (evidence.orgSchema.detected) score += 20;
  
  // Has unique identifiers in sameAs
  const identifiers = {
    linkedin: /linkedin\.com/i,
    crunchbase: /crunchbase\.com/i,
    wikipedia: /wikipedia\.org/i,
    wikidata: /wikidata\.org/i,
    dnb: /dnb\.com/i
  };
  
  for (const [name, pattern] of Object.entries(identifiers)) {
    if (evidence.orgSchema.sameAs?.some(url => pattern.test(url))) {
      score += 15;
    }
  }
  
  // Has address (geographic disambiguation)
  if (evidence.orgSchema.address?.formatted) score += 10;
  
  // Has founding date
  if (evidence.orgSchema.foundingDate) score += 10;
  
  // Has DUNS/Tax ID
  if (evidence.orgSchema.duns || evidence.orgSchema.taxID) score += 10;
  
  return Math.min(score, maxScore);
}
```

### Extraction Schema

```typescript
interface DisambiguationEvidence {
  detected: boolean;
  entityName: string | null;
  disambiguationScore: number;
  
  // Unique identifiers found
  identifiers: {
    linkedin: string | null;
    crunchbase: string | null;
    wikipedia: string | null;
    wikidata: string | null;
    duns: string | null;
    taxID: string | null;
    leiCode: string | null;
  };
  
  // Disambiguation signals
  hasGeographicContext: boolean;
  hasFoundingDate: boolean;
  hasUniqueIdentifier: boolean;
  
  // Issues
  ambiguities: EntityAmbiguity[];
  isAmbiguous: boolean;
}
```

---

## AI Consumption Readiness (Answerability Layer)

### Answerability Assessment

This meta-layer assesses whether content is **suitable for AI to cite**, not just whether features exist.

```typescript
interface AnswerabilityAssessment {
  overallScore: number;           // 0-100
  
  // Four pillars of answerability
  conciseness: ConcisenessScore;
  quotability: QuotabilityScore;
  authority: AuthorityScore;
  citeSafety: CiteSafetyScore;
  
  // Aggregate
  isAnswerable: boolean;          // Score > 60
  isHighlyAnswerable: boolean;    // Score > 80
}
```

### Conciseness Score

Can AI extract a concise answer?

```typescript
interface ConcisenessScore {
  score: number;
  
  // Factors
  hasDirectAnswers: boolean;      // Question + immediate answer
  avgAnswerLength: number;        // Words in answer paragraphs
  hasSnippetContent: boolean;     // 40-60 word answers
  hasTldr: boolean;               // Summary sections
  
  // Extracted concise content
  conciseAnswers: {
    question: string;
    answer: string;
    wordCount: number;
  }[];
}

function assessConciseness(evidence: any): ConcisenessScore {
  let score = 0;
  const conciseAnswers = [];
  
  // Check for direct Q&A patterns
  evidence.questionHeadings.questionHeadings.forEach(qh => {
    const nextParagraph = findNextParagraph(qh);
    if (nextParagraph && nextParagraph.wordCount <= 60) {
      score += 15;
      conciseAnswers.push({
        question: qh.text,
        answer: nextParagraph.text,
        wordCount: nextParagraph.wordCount
      });
    }
  });
  
  // Check for TL;DR / summary
  if (evidence.content.hasTldr) score += 20;
  
  // Check FAQ answers
  if (evidence.faqSchema.detected) {
    const avgLength = evidence.faqSchema.averageAnswerLength;
    if (avgLength > 50 && avgLength < 200) score += 20;
  }
  
  // Penalize walls of text
  if (evidence.readability.avgParagraphLength > 150) score -= 10;
  
  return {
    score: Math.max(0, Math.min(100, score)),
    hasDirectAnswers: conciseAnswers.length > 0,
    avgAnswerLength: average(conciseAnswers.map(a => a.wordCount)),
    hasSnippetContent: conciseAnswers.some(a => a.wordCount >= 40 && a.wordCount <= 60),
    hasTldr: evidence.content.hasTldr,
    conciseAnswers
  };
}
```

### Quotability Score

Can AI directly quote this content?

```typescript
interface QuotabilityScore {
  score: number;
  
  // Factors
  hasStandaloneFacts: boolean;    // Facts that make sense without context
  hasQuotableStats: boolean;      // Statistics with attribution
  hasDefinitions: boolean;        // Clear definitions
  hasAttributions: boolean;       // Cited sources
  
  // Extracted quotable content
  quotableContent: {
    type: 'fact' | 'statistic' | 'definition' | 'quote';
    text: string;
    attribution: string | null;
  }[];
}

function assessQuotability(evidence: any): QuotabilityScore {
  let score = 0;
  const quotableContent = [];
  
  // Check for statistics
  const stats = extractStatistics(evidence.content.bodyText);
  if (stats.length > 0) {
    score += 25;
    stats.forEach(s => quotableContent.push({ type: 'statistic', text: s.text, attribution: s.source }));
  }
  
  // Check for definitions
  if (evidence.definitions.detected) {
    score += 20;
    evidence.definitions.definitionPatterns.forEach(d => {
      quotableContent.push({ type: 'definition', text: `${d.term}: ${d.definition}`, attribution: null });
    });
  }
  
  // Check for attributed quotes
  const quotes = extractQuotes(evidence.content.bodyText);
  if (quotes.length > 0) {
    score += 15;
    quotes.forEach(q => quotableContent.push({ type: 'quote', text: q.text, attribution: q.attribution }));
  }
  
  // Check for standalone facts
  // (Would need NLP analysis)
  
  return {
    score: Math.max(0, Math.min(100, score)),
    hasStandaloneFacts: quotableContent.length > 0,
    hasQuotableStats: stats.length > 0,
    hasDefinitions: evidence.definitions.detected,
    hasAttributions: quotes.some(q => q.attribution),
    quotableContent
  };
}
```

### Authority Score

Is this content authoritative enough to cite?

```typescript
interface AuthorityScore {
  score: number;
  
  // Factors
  hasAuthor: boolean;
  authorHasCredentials: boolean;
  hasCitations: boolean;          // Links to authoritative sources
  isFirstPartySource: boolean;    // Original content vs aggregation
  domainTrust: number;
  
  // Signals
  authoritySignals: string[];
  trustIssues: string[];
}

function assessAuthority(evidence: any): AuthorityScore {
  let score = 0;
  const signals = [];
  const issues = [];
  
  // Author with credentials
  if (evidence.author.detected) {
    score += 15;
    signals.push('Author identified');
    
    if (evidence.author.hasCredentials) {
      score += 15;
      signals.push('Author has credentials');
    }
  } else {
    issues.push('No author identified');
  }
  
  // Citations to authoritative sources
  const authoritativeDomains = ['.gov', '.edu', 'wikipedia.org', 'nature.com', 'pubmed'];
  const authoritativeLinks = evidence.linking.externalLinks.filter(l => 
    authoritativeDomains.some(d => l.href.includes(d))
  );
  
  if (authoritativeLinks.length > 0) {
    score += 20;
    signals.push(`${authoritativeLinks.length} authoritative citations`);
  }
  
  // Organization schema with sameAs
  if (evidence.orgSchema.detected && evidence.orgSchema.sameAs?.length > 0) {
    score += 15;
    signals.push('Organization verified via sameAs');
  }
  
  // First-party content (not aggregation)
  if (evidence.orgSchema.detected && evidence.url.includes(evidence.orgSchema.url)) {
    score += 15;
    signals.push('First-party source');
  }
  
  return {
    score: Math.max(0, Math.min(100, score)),
    hasAuthor: evidence.author.detected,
    authorHasCredentials: evidence.author.hasCredentials,
    hasCitations: authoritativeLinks.length > 0,
    isFirstPartySource: true, // Would need more complex check
    domainTrust: evidence.domainAuthority?.score || 0,
    authoritySignals: signals,
    trustIssues: issues
  };
}
```

### Cite Safety Score

Is it safe for AI to cite this without risk?

```typescript
interface CiteSafetyScore {
  score: number;
  
  // Factors
  isFactual: boolean;             // Objective content
  isNonControversial: boolean;    // Not politically charged
  isVerifiable: boolean;          // Claims can be verified
  hasNoMisinformation: boolean;   // No known false claims
  isCurrentInfo: boolean;         // Not outdated
  
  // Risks
  citationRisks: string[];
}

function assessCiteSafety(evidence: any): CiteSafetyScore {
  let score = 100; // Start high, deduct for risks
  const risks = [];
  
  // Check for outdated content
  if (evidence.freshness.lastUpdated) {
    const daysSince = evidence.freshness.daysSinceUpdate;
    if (daysSince > 365 * 2) {
      score -= 30;
      risks.push('Content over 2 years old');
    } else if (daysSince > 365) {
      score -= 15;
      risks.push('Content over 1 year old');
    }
  } else {
    score -= 10;
    risks.push('No update date - freshness unknown');
  }
  
  // Check for opinion indicators (less safe to cite as fact)
  const opinionPatterns = [
    /in my opinion/i,
    /i think/i,
    /i believe/i,
    /arguably/i
  ];
  
  if (opinionPatterns.some(p => p.test(evidence.content.bodyText))) {
    score -= 15;
    risks.push('Contains opinion language');
  }
  
  // Check for absolute claims without sources
  const absolutePatterns = [
    /\balways\b/i,
    /\bnever\b/i,
    /\bproven\b/i,
    /\bguaranteed\b/i
  ];
  
  const hasAbsoluteClaims = absolutePatterns.some(p => p.test(evidence.content.bodyText));
  const hasSources = evidence.citation.sourceLinks.length > 0;
  
  if (hasAbsoluteClaims && !hasSources) {
    score -= 20;
    risks.push('Absolute claims without citations');
  }
  
  return {
    score: Math.max(0, Math.min(100, score)),
    isFactual: !opinionPatterns.some(p => p.test(evidence.content.bodyText)),
    isNonControversial: true, // Would need topic analysis
    isVerifiable: hasSources,
    hasNoMisinformation: true, // Would need fact-checking
    isCurrentInfo: evidence.freshness.daysSinceUpdate < 365,
    citationRisks: risks
  };
}
```

### Combined Answerability Score

```typescript
function assessAnswerability(evidence: any): AnswerabilityAssessment {
  const conciseness = assessConciseness(evidence);
  const quotability = assessQuotability(evidence);
  const authority = assessAuthority(evidence);
  const citeSafety = assessCiteSafety(evidence);
  
  // Weighted average
  const overallScore = Math.round(
    conciseness.score * 0.25 +
    quotability.score * 0.25 +
    authority.score * 0.30 +
    citeSafety.score * 0.20
  );
  
  return {
    overallScore,
    conciseness,
    quotability,
    authority,
    citeSafety,
    isAnswerable: overallScore >= 60,
    isHighlyAnswerable: overallScore >= 80
  };
}
```

### Answerability Recommendations

```typescript
function generateAnswerabilityRecommendations(assessment: AnswerabilityAssessment): Recommendation[] {
  const recs = [];
  
  if (assessment.conciseness.score < 60) {
    recs.push({
      id: 'improve-conciseness',
      title: 'Add Concise, Direct Answers',
      message: 'AI assistants prefer content with clear, direct answers. Add TL;DR summaries or 40-60 word answer paragraphs after question headings.',
      impact: 'high'
    });
  }
  
  if (assessment.quotability.score < 60) {
    recs.push({
      id: 'improve-quotability',
      title: 'Add Quotable Facts & Statistics',
      message: 'AI assistants cite content with clear, standalone facts. Add statistics with sources, clear definitions, and attributable quotes.',
      impact: 'high'
    });
  }
  
  if (assessment.authority.score < 60) {
    recs.push({
      id: 'improve-authority',
      title: 'Strengthen Authority Signals',
      message: 'AI assistants prefer authoritative sources. Add author credentials, cite authoritative sources, and ensure Organization schema is complete.',
      impact: 'medium'
    });
  }
  
  if (assessment.citeSafety.score < 60) {
    recs.push({
      id: 'improve-cite-safety',
      title: 'Reduce Citation Risk',
      message: 'AI may avoid citing content with risks. Update stale content, add sources for claims, and mark opinion content clearly.',
      impact: 'medium'
    });
  }
  
  return recs;
}
```

---

## Cross-Cutting Rules

## Global Detection Vocabulary Registry

### Purpose

Centralize ALL detection patterns, selectors, and keywords in a single registry. This ensures:
- Consistent detection across all modules
- Single source of truth
- Easy updates without hunting through code
- Testable pattern library
- Version control for patterns

### Registry Structure

```typescript
interface DetectionVocabulary {
  version: string;
  lastUpdated: string;
  
  // URL patterns
  urlPatterns: URLPatterns;
  
  // CSS selectors
  selectors: CSSSelectors;
  
  // Text patterns (regex)
  textPatterns: TextPatterns;
  
  // Schema types
  schemaTypes: SchemaTypes;
  
  // Keywords
  keywords: KeywordLists;
  
  // Meta tag names
  metaTags: MetaTagRegistry;
}
```

### URL Patterns

```typescript
const URL_PATTERNS: URLPatterns = {
  blog: {
    pattern: /\/(blog|news|articles|insights|resources|posts)(\/|$)/i,
    description: 'Blog or news section URLs',
    examples: ['/blog', '/news/', '/articles/my-post'],
    version: '1.0'
  },
  faq: {
    pattern: /\/(faq|faqs|frequently-asked|questions|help|support)(\/|$)/i,
    description: 'FAQ section URLs',
    examples: ['/faq', '/frequently-asked-questions', '/help'],
    version: '1.0'
  },
  about: {
    pattern: /\/(about|about-us|our-story|who-we-are|company)(\/|$)/i,
    description: 'About page URLs',
    examples: ['/about', '/about-us', '/our-story'],
    version: '1.0'
  },
  contact: {
    pattern: /\/(contact|contact-us|get-in-touch|reach-us)(\/|$)/i,
    description: 'Contact page URLs',
    examples: ['/contact', '/contact-us'],
    version: '1.0'
  },
  services: {
    pattern: /\/(services|solutions|what-we-do|offerings)(\/|$)/i,
    description: 'Services page URLs',
    examples: ['/services', '/solutions'],
    version: '1.0'
  },
  pricing: {
    pattern: /\/(pricing|plans|packages|rates)(\/|$)/i,
    description: 'Pricing page URLs',
    examples: ['/pricing', '/plans'],
    version: '1.0'
  },
  team: {
    pattern: /\/(team|our-team|people|staff|leadership)(\/|$)/i,
    description: 'Team page URLs',
    examples: ['/team', '/our-team', '/leadership'],
    version: '1.0'
  },
  careers: {
    pattern: /\/(careers|jobs|hiring|work-with-us)(\/|$)/i,
    description: 'Careers page URLs',
    examples: ['/careers', '/jobs'],
    version: '1.0'
  },
  legal: {
    pattern: /\/(privacy|terms|legal|disclaimer|cookie-policy)(\/|$)/i,
    description: 'Legal page URLs',
    examples: ['/privacy', '/terms-of-service'],
    version: '1.0'
  }
};
```

### CSS Selectors

```typescript
const CSS_SELECTORS: CSSSelectors = {
  // FAQ selectors (in priority order)
  faq: {
    containers: [
      '[class*="faq" i]',
      '[id*="faq" i]',
      '[class*="frequently-asked" i]',
      '[class*="questions" i]:not([class*="contact"])',
      '[data-component="faq"]',
      '.accordion:has([class*="question"])'
    ],
    items: [
      '.faq-item',
      '.faq-question',
      '[class*="accordion-item"]',
      'details',
      '[itemtype*="Question"]'
    ],
    questions: [
      '.faq-question',
      '[class*="question"]',
      'summary',
      'dt',
      '[itemprop="name"]'
    ],
    answers: [
      '.faq-answer',
      '[class*="answer"]',
      'dd',
      '[itemprop="text"]'
    ],
    version: '1.0'
  },
  
  // Author selectors
  author: {
    containers: [
      '[class*="author" i]',
      '[class*="byline" i]',
      '[rel="author"]',
      '[itemprop="author"]',
      '.post-author',
      '.article-author'
    ],
    name: [
      '.author-name',
      '[itemprop="name"]',
      '[class*="author"] a'
    ],
    bio: [
      '.author-bio',
      '.author-description',
      '[itemprop="description"]'
    ],
    image: [
      '.author-image',
      '.author-avatar',
      '[itemprop="image"]'
    ],
    version: '1.0'
  },
  
  // Navigation selectors
  navigation: {
    primary: [
      'nav',
      '[role="navigation"]',
      '.main-nav',
      '.primary-nav',
      '#main-navigation',
      'header nav'
    ],
    mobile: [
      '[class*="mobile-menu"]',
      '[class*="hamburger"]',
      '[class*="menu-toggle"]',
      '.mobile-nav'
    ],
    footer: [
      'footer nav',
      '.footer-nav',
      '.footer-links'
    ],
    version: '1.0'
  },
  
  // Blog selectors
  blog: {
    containers: [
      '[class*="blog" i]',
      '[class*="article" i]',
      '[class*="post" i]',
      'article',
      '.entry'
    ],
    title: [
      '.post-title',
      '.article-title',
      '.entry-title',
      'h1.title'
    ],
    date: [
      '.post-date',
      '.article-date',
      'time[datetime]',
      '[class*="published"]'
    ],
    version: '1.0'
  },
  
  // Schema script selector
  jsonLd: 'script[type="application/ld+json"]',
  
  // Semantic structure
  semantic: {
    main: 'main, [role="main"]',
    header: 'header, [role="banner"]',
    footer: 'footer, [role="contentinfo"]',
    aside: 'aside, [role="complementary"]',
    article: 'article',
    section: 'section'
  }
};
```

### Text Patterns

```typescript
const TEXT_PATTERNS: TextPatterns = {
  // Question patterns
  questions: {
    endsWithQuestionMark: /\?$/,
    startsWithQuestionWord: /^(what|why|how|when|where|who|which|can|should|do|does|is|are|will|would|could)\b/i,
    faqHeading: /^(faq|frequently asked|common questions|q\s*&\s*a)/i,
    version: '1.0'
  },
  
  // Author byline patterns
  authorByline: {
    byPattern: /^by\s+(.+)/i,
    writtenByPattern: /written by\s+(.+)/i,
    authorPattern: /author:\s*(.+)/i,
    version: '1.0'
  },
  
  // Date patterns
  dates: {
    updated: /updated:?\s*(.+)/i,
    modified: /modified:?\s*(.+)/i,
    published: /published:?\s*(.+)/i,
    posted: /posted:?\s*(.+)/i,
    version: '1.0'
  },
  
  // Problem/solution patterns
  problemSolution: {
    problems: /\b(problem|issue|challenge|struggle|pain point|frustration|difficulty|obstacle)\b/i,
    solutions: /\b(solution|solve|fix|resolve|overcome|address|tackle|remedy)\b/i,
    howTo: /\bhow to\b/i,
    version: '1.0'
  },
  
  // Definition patterns
  definitions: {
    isPattern: /^([^.]+)\s+is\s+(a|an|the)?\s*([^.]+)/i,
    refersToPattern: /^([^.]+)\s+refers to\s+([^.]+)/i,
    meansPattern: /^([^.]+)\s+means\s+([^.]+)/i,
    version: '1.0'
  },
  
  // Certification patterns
  certifications: {
    certifiedPattern: /\b(certified|accredited|licensed|registered)\b/i,
    memberPattern: /\b(member of|affiliated with|partner of)\b/i,
    version: '1.0'
  },
  
  // Contact patterns
  contact: {
    emailPattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    phonePattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    addressPattern: /\d+\s+[A-Za-z]+(\s+[A-Za-z]+)*,?\s+[A-Za-z]+,?\s+[A-Z]{2}\s+\d{5}/,
    version: '1.0'
  }
};
```

### Schema Types

```typescript
const SCHEMA_TYPES: SchemaTypes = {
  // Organization types (any of these = organization detected)
  organization: [
    'Organization',
    'LocalBusiness',
    'Corporation',
    'EducationalOrganization',
    'GovernmentOrganization',
    'MedicalOrganization',
    'NGO',
    'PerformingGroup',
    'SportsOrganization',
    // LocalBusiness subtypes
    'Restaurant',
    'Store',
    'MedicalBusiness',
    'LegalService',
    'FinancialService',
    'RealEstateAgent',
    'TravelAgency',
    'AutoDealer',
    'AutoRepair'
  ],
  
  // Article types
  article: [
    'Article',
    'BlogPosting',
    'NewsArticle',
    'TechArticle',
    'ScholarlyArticle',
    'Report',
    'SocialMediaPosting'
  ],
  
  // FAQ types
  faq: [
    'FAQPage',
    'QAPage'
  ],
  
  // Person types
  person: [
    'Person'
  ],
  
  // Location types
  location: [
    'Place',
    'LocalBusiness',
    'PostalAddress',
    'GeoCoordinates',
    'GeoShape'
  ],
  
  // Product/Service types
  offering: [
    'Product',
    'Service',
    'Offer',
    'AggregateOffer'
  ],
  
  // Review types
  review: [
    'Review',
    'AggregateRating'
  ],
  
  // Event types
  event: [
    'Event',
    'BusinessEvent',
    'EducationEvent'
  ],
  
  // Credential types
  credential: [
    'EducationalOccupationalCredential',
    'Certification'
  ]
};
```

### Keywords Registry

```typescript
const KEYWORDS: KeywordLists = {
  // Navigation link text that indicates key pages
  navLinkText: {
    blog: ['blog', 'news', 'articles', 'insights', 'resources', 'posts', 'updates'],
    faq: ['faq', 'faqs', 'questions', 'help', 'support', 'frequently asked'],
    about: ['about', 'about us', 'our story', 'who we are', 'company', 'our company'],
    contact: ['contact', 'contact us', 'get in touch', 'reach us', 'talk to us'],
    services: ['services', 'solutions', 'what we do', 'offerings', 'capabilities'],
    pricing: ['pricing', 'plans', 'packages', 'rates', 'cost'],
    team: ['team', 'our team', 'people', 'staff', 'leadership', 'founders'],
    careers: ['careers', 'jobs', 'hiring', 'work with us', 'join us']
  },
  
  // AI crawler user agents
  aiCrawlers: [
    'GPTBot',
    'ChatGPT-User',
    'Claude-Web',
    'Anthropic',
    'CCBot',
    'Google-Extended',
    'PerplexityBot',
    'YouBot',
    'Bytespider'
  ],
  
  // Authoritative domains for citation scoring
  authoritativeDomains: [
    '.gov',
    '.edu',
    'wikipedia.org',
    'nature.com',
    'pubmed.ncbi.nlm.nih.gov',
    'scholar.google.com',
    'reuters.com',
    'bbc.com',
    'nytimes.com'
  ],
  
  // Disambiguation sources
  disambiguationSources: [
    'linkedin.com/company',
    'crunchbase.com',
    'wikipedia.org',
    'wikidata.org',
    'dnb.com',
    'bbb.org'
  ]
};
```

### Registry Usage

```typescript
// Import the registry
import { VOCABULARY } from './detection-vocabulary';

// Use patterns consistently across all detectors
function detectBlog(url: string, navigation: any): boolean {
  // Use registered URL pattern
  if (VOCABULARY.urlPatterns.blog.pattern.test(url)) return true;
  
  // Use registered keywords
  const blogKeywords = VOCABULARY.keywords.navLinkText.blog;
  return navigation.links.some(l => 
    blogKeywords.some(kw => l.text.toLowerCase().includes(kw))
  );
}

function detectFAQSection($: CheerioStatic): FAQItem[] {
  const faqs: FAQItem[] = [];
  
  // Use registered selectors in priority order
  for (const selector of VOCABULARY.selectors.faq.containers) {
    const containers = $(selector);
    if (containers.length > 0) {
      // Extract using registered item/question/answer selectors
      // ...
    }
  }
  
  return faqs;
}
```

### Registry Versioning

```typescript
interface VocabularyVersion {
  version: string;
  releaseDate: string;
  changes: {
    added: string[];
    modified: string[];
    removed: string[];
  };
}

const VOCABULARY_HISTORY: VocabularyVersion[] = [
  {
    version: '1.0',
    releaseDate: '2025-12-11',
    changes: {
      added: ['Initial vocabulary registry'],
      modified: [],
      removed: []
    }
  }
];
```

---

## Diagnostic Output Contract

### Purpose

Define a standardized diagnostic payload that:
- Explains WHY each detection decision was made
- Shows WHAT was checked
- Enables self-service debugging
- Reduces support load
- Makes audits deterministic

### Diagnostic Schema

```typescript
interface ScanDiagnostics {
  scanId: string;
  url: string;
  timestamp: string;
  duration: number;
  
  // Overall summary
  summary: DiagnosticSummary;
  
  // Per-subfactor diagnostics
  subfactors: Record<string, SubfactorDiagnostic>;
  
  // Conflict diagnostics
  conflicts: ConflictDiagnostic[];
  
  // Anti-pattern diagnostics
  antiPatterns: AntiPatternDiagnostic[];
  
  // Performance diagnostics
  performance: PerformanceDiagnostic;
  
  // Raw data (for deep debugging)
  rawData?: RawDiagnosticData;
}
```

### Summary Diagnostic

```typescript
interface DiagnosticSummary {
  totalChecks: number;
  passed: number;
  failed: number;
  skipped: number;
  
  // Quick status
  status: 'healthy' | 'issues' | 'critical';
  
  // Top issues
  topIssues: {
    subfactor: string;
    reason: string;
    impact: number;
  }[];
  
  // Detection coverage
  coverage: {
    schemaChecked: boolean;
    htmlChecked: boolean;
    navigationChecked: boolean;
    crawlerUsed: boolean;
    externalFilesChecked: boolean;
  };
}
```

### Subfactor Diagnostic

```typescript
interface SubfactorDiagnostic {
  subfactor: string;
  category: string;
  
  // Result
  detected: boolean;
  score: number;
  maxScore: number;
  
  // Decision trail
  decisionTrail: DecisionStep[];
  
  // What was checked
  sourcesChecked: {
    source: string;
    checked: boolean;
    found: boolean;
    data?: any;
    reason?: string;
  }[];
  
  // Why this decision
  reasoning: string;
  
  // Confidence
  confidence: 'high' | 'medium' | 'low';
  confidenceReason: string;
  
  // What would change the result
  toImprove?: string;
}

interface DecisionStep {
  step: number;
  action: string;
  source: string;
  result: 'found' | 'not_found' | 'error' | 'skipped';
  data?: any;
  duration?: number;
}
```

### Example Subfactor Diagnostic

```typescript
// Example: FAQ Schema detection diagnostic
{
  subfactor: 'faqSchemaScore',
  category: 'aiReadiness',
  
  detected: false,
  score: 0,
  maxScore: 100,
  
  decisionTrail: [
    {
      step: 1,
      action: 'Find JSON-LD scripts',
      source: 'html',
      result: 'found',
      data: { count: 2 },
      duration: 5
    },
    {
      step: 2,
      action: 'Parse JSON-LD #1',
      source: 'schema',
      result: 'found',
      data: { types: ['Organization', 'WebSite'] },
      duration: 2
    },
    {
      step: 3,
      action: 'Parse JSON-LD #2',
      source: 'schema',
      result: 'found',
      data: { types: ['BreadcrumbList'] },
      duration: 1
    },
    {
      step: 4,
      action: 'Search for FAQPage type',
      source: 'schema',
      result: 'not_found',
      data: { searchedTypes: ['FAQPage', 'QAPage'], foundTypes: ['Organization', 'WebSite', 'BreadcrumbList'] },
      duration: 1
    }
  ],
  
  sourcesChecked: [
    { source: 'json-ld', checked: true, found: false, reason: 'No FAQPage @type in 2 scripts' },
    { source: 'microdata', checked: true, found: false, reason: 'No itemtype="FAQPage"' }
  ],
  
  reasoning: 'Checked 2 JSON-LD scripts and microdata. Found Organization, WebSite, BreadcrumbList but no FAQPage or QAPage schema.',
  
  confidence: 'high',
  confidenceReason: 'Schema detection is deterministic',
  
  toImprove: 'Add FAQPage schema with mainEntity containing Question items'
}
```

### Conflict Diagnostic

```typescript
interface ConflictDiagnostic {
  id: string;
  subfactor: string;
  conflictType: 'value_mismatch' | 'presence_disagreement' | 'date_mismatch';
  
  sources: {
    source: string;
    value: any;
    confidence: string;
    rawData?: any;
  }[];
  
  resolution: {
    winner: string;
    rule: string;
    reasoning: string;
  };
  
  userImpact: string;
  suggestedAction?: string;
}
```

### Example Conflict Diagnostic

```typescript
{
  id: 'conflict-org-name-001',
  subfactor: 'orgSchemaScore',
  conflictType: 'value_mismatch',
  
  sources: [
    {
      source: 'schema-jsonld',
      value: 'Xeo Marketing Inc.',
      confidence: 'high',
      rawData: { path: 'Organization.name', script: 1 }
    },
    {
      source: 'html-footer',
      value: '© 2025 Xeo Marketing',
      confidence: 'medium',
      rawData: { selector: 'footer .copyright', text: '© 2025 Xeo Marketing' }
    }
  ],
  
  resolution: {
    winner: 'schema-jsonld',
    rule: 'structured-over-unstructured',
    reasoning: 'Schema (high confidence) takes precedence over HTML text (medium confidence)'
  },
  
  userImpact: 'Minor - AI will use schema name. Visible name differs slightly.',
  suggestedAction: 'Consider aligning Organization schema name with visible branding for consistency.'
}
```

### Anti-Pattern Diagnostic

```typescript
interface AntiPatternDiagnostic {
  id: string;
  pattern: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  
  detected: boolean;
  
  // Evidence
  evidence: {
    check: string;
    result: any;
    threshold?: any;
  };
  
  // Impact
  penaltyApplied: number;
  
  // How to fix
  howToFix: string;
  codeExample?: string;
}
```

### Example Anti-Pattern Diagnostic

```typescript
{
  id: 'antipattern-faq-empty-answers',
  pattern: 'faq-empty-answers',
  severity: 'high',
  
  detected: true,
  
  evidence: {
    check: 'FAQ answers length > 20 characters',
    result: {
      totalFaqs: 5,
      emptyAnswers: 2,
      shortAnswers: [
        { question: 'What is your return policy?', answer: 'See terms.', length: 10 },
        { question: 'Do you ship internationally?', answer: 'Yes', length: 3 }
      ]
    },
    threshold: 'All answers must be > 20 characters'
  },
  
  penaltyApplied: -40,
  
  howToFix: 'Expand FAQ answers to provide complete, helpful responses. Each answer should be at least 50 characters.',
  codeExample: `
{
  "@type": "Question",
  "name": "What is your return policy?",
  "acceptedAnswer": {
    "@type": "Answer",
    "text": "We offer a 30-day return policy for all unused items in original packaging. Contact support@example.com to initiate a return."
  }
}
`
}
```

### Performance Diagnostic

```typescript
interface PerformanceDiagnostic {
  totalDuration: number;
  
  phases: {
    phase: string;
    duration: number;
    percentage: number;
  }[];
  
  slowestChecks: {
    check: string;
    duration: number;
  }[];
  
  networkRequests: {
    url: string;
    status: number;
    duration: number;
    cached: boolean;
  }[];
  
  warnings: string[];
}
```

### Diagnostic Output Levels

```typescript
type DiagnosticLevel = 'minimal' | 'standard' | 'verbose' | 'debug';

const DIAGNOSTIC_LEVELS = {
  minimal: {
    // Just summary and top issues
    includes: ['summary', 'topIssues']
  },
  standard: {
    // Summary + per-subfactor results + conflicts
    includes: ['summary', 'subfactors', 'conflicts', 'antiPatterns']
  },
  verbose: {
    // Everything except raw data
    includes: ['summary', 'subfactors', 'conflicts', 'antiPatterns', 'performance', 'decisionTrails']
  },
  debug: {
    // Everything including raw HTML, schemas, etc.
    includes: ['*', 'rawData']
  }
};
```

### Human-Readable Diagnostic Export

```typescript
function generateDiagnosticReport(diagnostics: ScanDiagnostics): string {
  let report = `
═══════════════════════════════════════════════════════════════
AI VISIBILITY SCAN DIAGNOSTIC REPORT
═══════════════════════════════════════════════════════════════
Scan ID: ${diagnostics.scanId}
URL: ${diagnostics.url}
Date: ${diagnostics.timestamp}
Duration: ${diagnostics.duration}ms
Status: ${diagnostics.summary.status.toUpperCase()}

───────────────────────────────────────────────────────────────
SUMMARY
───────────────────────────────────────────────────────────────
Total Checks: ${diagnostics.summary.totalChecks}
✅ Passed: ${diagnostics.summary.passed}
❌ Failed: ${diagnostics.summary.failed}
⏭️ Skipped: ${diagnostics.summary.skipped}

───────────────────────────────────────────────────────────────
TOP ISSUES
───────────────────────────────────────────────────────────────
`;

  diagnostics.summary.topIssues.forEach((issue, i) => {
    report += `${i + 1}. [${issue.subfactor}] ${issue.reason} (Impact: ${issue.impact} pts)\n`;
  });

  report += `
───────────────────────────────────────────────────────────────
DETECTION DETAILS
───────────────────────────────────────────────────────────────
`;

  for (const [key, diag] of Object.entries(diagnostics.subfactors)) {
    const icon = diag.detected ? '✅' : '❌';
    report += `
${icon} ${key}: ${diag.score}/${diag.maxScore}
   Confidence: ${diag.confidence}
   Reasoning: ${diag.reasoning}
   ${diag.toImprove ? `To Improve: ${diag.toImprove}` : ''}
`;
  }

  if (diagnostics.conflicts.length > 0) {
    report += `
───────────────────────────────────────────────────────────────
CONFLICTS DETECTED
───────────────────────────────────────────────────────────────
`;
    diagnostics.conflicts.forEach(conflict => {
      report += `
⚠️ ${conflict.subfactor}: ${conflict.conflictType}
   Sources: ${conflict.sources.map(s => `${s.source}="${s.value}"`).join(' vs ')}
   Resolution: Used ${conflict.resolution.winner} (${conflict.resolution.rule})
   Action: ${conflict.suggestedAction || 'None required'}
`;
    });
  }

  if (diagnostics.antiPatterns.length > 0) {
    report += `
───────────────────────────────────────────────────────────────
ANTI-PATTERNS DETECTED
───────────────────────────────────────────────────────────────
`;
    diagnostics.antiPatterns.filter(ap => ap.detected).forEach(ap => {
      report += `
🚫 [${ap.severity.toUpperCase()}] ${ap.pattern}
   Penalty: ${ap.penaltyApplied} points
   Fix: ${ap.howToFix}
`;
    });
  }

  report += `
═══════════════════════════════════════════════════════════════
END OF DIAGNOSTIC REPORT
═══════════════════════════════════════════════════════════════
`;

  return report;
}
```

---

## Weight Override & Future-Proofing

### Purpose

Allow weights to be configured and adjusted without code changes:
- Adapt to different AI engines
- A/B test weight profiles
- Future-proof against algorithm changes
- Enable "Optimize for X" modes

### Weight Configuration Schema

```typescript
interface WeightConfiguration {
  version: string;
  name: string;
  description: string;
  
  // Base category weights (must sum to 100)
  categoryWeights: {
    technical: number;      // Default: 18
    aiReadiness: number;    // Default: 20
    trust: number;          // Default: 12
    structure: number;      // Default: 15
    voice: number;          // Default: 12
    readability: number;    // Default: 10
    freshness: number;      // Default: 8
    performance: number;    // Default: 5
  };
  
  // Subfactor weight modifiers (multipliers)
  subfactorModifiers: Record<string, number>;
  
  // Anti-pattern severity modifiers
  antiPatternModifiers: Record<string, number>;
  
  // Answerability weight
  answerabilityWeight: number;
}
```

### Default Weight Profile

```typescript
const DEFAULT_WEIGHTS: WeightConfiguration = {
  version: '1.0',
  name: 'default',
  description: 'Balanced weights for general AI visibility',
  
  categoryWeights: {
    technical: 18,
    aiReadiness: 20,
    trust: 12,
    structure: 15,
    voice: 12,
    readability: 10,
    freshness: 8,
    performance: 5
  },
  
  subfactorModifiers: {
    // All default to 1.0 (no modification)
  },
  
  antiPatternModifiers: {
    // All default to 1.0
  },
  
  answerabilityWeight: 0  // Not included in default
};
```

### AI Engine-Specific Profiles

```typescript
const AI_ENGINE_PROFILES: Record<string, WeightConfiguration> = {
  
  chatgpt: {
    version: '1.0',
    name: 'chatgpt-optimized',
    description: 'Optimized for ChatGPT/OpenAI visibility',
    
    categoryWeights: {
      technical: 15,        // Slightly less
      aiReadiness: 25,      // MORE - conversational AI loves FAQs
      trust: 12,
      structure: 12,        // Slightly less
      voice: 15,            // MORE - conversational
      readability: 10,
      freshness: 6,
      performance: 5
    },
    
    subfactorModifiers: {
      faqSchemaScore: 1.3,      // +30% weight
      faqContentScore: 1.3,     // +30% weight
      conversationalScore: 1.2, // +20% weight
      questionHeadingsScore: 1.2
    },
    
    antiPatternModifiers: {},
    answerabilityWeight: 15  // Include answerability
  },
  
  perplexity: {
    version: '1.0',
    name: 'perplexity-optimized',
    description: 'Optimized for Perplexity visibility',
    
    categoryWeights: {
      technical: 15,
      aiReadiness: 18,
      trust: 18,            // MORE - research focus
      structure: 15,
      voice: 8,             // Less conversational
      readability: 12,      // MORE - clarity
      freshness: 10,        // MORE - current info
      performance: 4
    },
    
    subfactorModifiers: {
      citationReadyScore: 1.4,  // +40% - citations matter
      authorBiosScore: 1.3,    // +30% - E-E-A-T
      lastUpdatedScore: 1.3,   // +30% - freshness
      thirdPartyProfilesScore: 1.2
    },
    
    antiPatternModifiers: {
      'blog-stale': 1.5        // Penalize stale content more
    },
    
    answerabilityWeight: 20  // High answerability weight
  },
  
  googleSGE: {
    version: '1.0',
    name: 'google-sge-optimized',
    description: 'Optimized for Google SGE/AI Overview',
    
    categoryWeights: {
      technical: 22,        // MORE - Google loves schema
      aiReadiness: 18,
      trust: 15,            // MORE - E-E-A-T
      structure: 18,        // MORE - semantic HTML
      voice: 8,
      readability: 10,
      freshness: 6,
      performance: 3
    },
    
    subfactorModifiers: {
      structuredDataScore: 1.4,  // +40%
      orgSchemaScore: 1.3,
      headingHierarchyScore: 1.2,
      canonicalHreflangScore: 1.2,
      featuredSnippetScore: 1.3
    },
    
    antiPatternModifiers: {
      'schema-json-invalid': 1.5  // Google penalizes bad schema more
    },
    
    answerabilityWeight: 10
  },
  
  claude: {
    version: '1.0',
    name: 'claude-optimized',
    description: 'Optimized for Claude/Anthropic visibility',
    
    categoryWeights: {
      technical: 16,
      aiReadiness: 22,
      trust: 15,            // Anthropic cares about trust
      structure: 15,
      voice: 10,
      readability: 12,      // Claude appreciates clear writing
      freshness: 6,
      performance: 4
    },
    
    subfactorModifiers: {
      citationReadyScore: 1.3,
      topicClarityScore: 1.2,
      authorBiosScore: 1.2,
      definitionsScore: 1.2
    },
    
    antiPatternModifiers: {},
    answerabilityWeight: 15
  }
};
```

### Weight Application

```typescript
function calculateWeightedScore(
  rawScores: Record<string, number>,
  profile: WeightConfiguration
): number {
  let totalScore = 0;
  let totalWeight = 0;
  
  // Category scores
  for (const [category, weight] of Object.entries(profile.categoryWeights)) {
    const categorySubfactors = SUBFACTORS_BY_CATEGORY[category];
    let categoryScore = 0;
    let subfactorCount = 0;
    
    for (const subfactor of categorySubfactors) {
      const rawScore = rawScores[subfactor] || 0;
      const modifier = profile.subfactorModifiers[subfactor] || 1.0;
      categoryScore += rawScore * modifier;
      subfactorCount++;
    }
    
    const avgCategoryScore = subfactorCount > 0 ? categoryScore / subfactorCount : 0;
    totalScore += avgCategoryScore * (weight / 100);
    totalWeight += weight;
  }
  
  // Answerability (if weighted)
  if (profile.answerabilityWeight > 0) {
    const answerabilityScore = rawScores.answerability || 0;
    totalScore += answerabilityScore * (profile.answerabilityWeight / 100);
    totalWeight += profile.answerabilityWeight;
  }
  
  // Normalize to 0-1000
  return Math.round((totalScore / totalWeight) * 1000 * 100) / 100;
}
```

### Dynamic Weight Adjustment

```typescript
interface WeightAdjustment {
  type: 'boost' | 'penalty';
  subfactor: string;
  modifier: number;
  reason: string;
  expiry?: string;  // ISO date when adjustment expires
}

function applyDynamicAdjustments(
  baseProfile: WeightConfiguration,
  adjustments: WeightAdjustment[]
): WeightConfiguration {
  const adjusted = { ...baseProfile };
  adjusted.subfactorModifiers = { ...baseProfile.subfactorModifiers };
  
  for (const adj of adjustments) {
    // Skip expired adjustments
    if (adj.expiry && new Date(adj.expiry) < new Date()) continue;
    
    const currentModifier = adjusted.subfactorModifiers[adj.subfactor] || 1.0;
    
    if (adj.type === 'boost') {
      adjusted.subfactorModifiers[adj.subfactor] = currentModifier * adj.modifier;
    } else {
      adjusted.subfactorModifiers[adj.subfactor] = currentModifier / adj.modifier;
    }
  }
  
  return adjusted;
}
```

### User-Facing Profile Selection

```typescript
interface ProfileOption {
  id: string;
  name: string;
  description: string;
  recommended: boolean;
  icon: string;
}

const PROFILE_OPTIONS: ProfileOption[] = [
  {
    id: 'default',
    name: 'Balanced',
    description: 'Optimized for all AI assistants',
    recommended: true,
    icon: '⚖️'
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT Focus',
    description: 'Emphasizes conversational content and FAQs',
    recommended: false,
    icon: '💬'
  },
  {
    id: 'perplexity',
    name: 'Perplexity Focus',
    description: 'Emphasizes citations, freshness, and authority',
    recommended: false,
    icon: '🔍'
  },
  {
    id: 'googleSGE',
    name: 'Google SGE Focus',
    description: 'Emphasizes schema markup and structured data',
    recommended: false,
    icon: '🔷'
  }
];
```

### Weight Configuration API

```typescript
// API endpoint to get/set weight profile
// GET /api/config/weights
// POST /api/config/weights

interface WeightConfigAPI {
  // Get current profile
  getCurrentProfile(): WeightConfiguration;
  
  // Set profile by ID
  setProfile(profileId: string): WeightConfiguration;
  
  // Get all available profiles
  getAvailableProfiles(): ProfileOption[];
  
  // Create custom profile
  createCustomProfile(config: WeightConfiguration): string;
  
  // Apply temporary adjustment
  applyAdjustment(adjustment: WeightAdjustment): void;
}
```

### Future-Proofing Rules

1. **New AI Engines**: Add new profile without changing core code
2. **Algorithm Changes**: Adjust weights via config
3. **A/B Testing**: Create test profiles, compare results
4. **Industry-Specific**: Healthcare vs E-commerce profiles
5. **Seasonal**: Boost freshness during news cycles

```typescript
// Example: Adding a new AI engine profile
const BARD_PROFILE: WeightConfiguration = {
  version: '1.0',
  name: 'google-bard-optimized',
  description: 'Optimized for Google Bard',
  // ... weights
};

// Just add to registry - no code changes needed
AI_ENGINE_PROFILES['bard'] = BARD_PROFILE;
```

---

### Rule 1: Extract Navigation BEFORE Removal

```javascript
// CORRECT ORDER
const navigation = extractNavigation($);    // FIRST
const structure = extractStructure($);      // SECOND
$('nav, header, footer').remove();          // THIRD
const content = extractContent($);          // FOURTH
```

### Rule 2: Recursive Schema Parsing

Always use recursive type extraction:

```javascript
function extractAllTypes(obj, types = new Set()) {
  if (!obj || typeof obj !== 'object') return types;
  
  if (obj['@type']) {
    const typeVal = obj['@type'];
    if (Array.isArray(typeVal)) {
      typeVal.forEach(t => types.add(t));
    } else {
      types.add(typeVal);
    }
  }
  
  for (const key in obj) {
    if (Array.isArray(obj[key])) {
      obj[key].forEach(item => extractAllTypes(item, types));
    } else if (typeof obj[key] === 'object') {
      extractAllTypes(obj[key], types);
    }
  }
  
  return types;
}
```

### Rule 3: Check Multiple Sources

For each feature, check ALL sources before reporting "not found":

```javascript
function detectFeature(schemas, html, navigation, crawler) {
  // 1. Check schema
  if (hasFeatureInSchema(schemas)) return { detected: true, source: 'schema', ... };
  
  // 2. Check HTML
  if (hasFeatureInHTML(html)) return { detected: true, source: 'html', ... };
  
  // 3. Check navigation
  if (hasFeatureInNav(navigation)) return { detected: true, source: 'navigation', ... };
  
  // 4. Check crawler
  if (hasFeatureInCrawler(crawler)) return { detected: true, source: 'crawler', ... };
  
  // Only now report not found
  return { detected: false };
}
```

### Rule 4: Crawler Intelligence

Pass crawler discoveries to all detectors:

```javascript
const crawlerData = {
  discoveredUrls: [...],
  discoveredSections: {
    hasBlogUrl: urls.some(u => /\/blog/i.test(u)),
    hasFaqUrl: urls.some(u => /\/faq/i.test(u)),
    hasAboutUrl: urls.some(u => /\/about/i.test(u)),
    hasContactUrl: urls.some(u => /\/contact/i.test(u)),
    hasServicesUrl: urls.some(u => /\/services/i.test(u)),
    blogUrls: urls.filter(u => /\/blog/i.test(u)),
    faqUrls: urls.filter(u => /\/faq/i.test(u)),
  }
};
```

### Rule 5: Source Attribution

Always track where data came from:

```javascript
{
  value: "some data",
  source: "schema" | "html" | "navigation" | "crawler" | "meta" | "external",
  confidence: "high" | "medium" | "low",
  location: "specific.path.to.data"
}
```

---

## Dynamic Text Templates

### Template Variables

All dynamic text can use extracted evidence fields:

```
{sitemap.url}           → "https://example.com/sitemap.xml"
{sitemap.pageCount}     → 47
{org.name}              → "Xeo Marketing"
{faqSchema.count}       → 10
{navigation.keyPages}   → ["home", "about", "blog", "contact"]
```

### Template Pattern

```javascript
function generateDynamicText(subfactor, evidence, isDetected) {
  const templates = DYNAMIC_TEXT_TEMPLATES[subfactor];
  const template = isDetected ? templates.detected : templates.missing;
  
  return interpolate(template, evidence);
}

function interpolate(template, data) {
  return template.replace(/\{([^}]+)\}/g, (match, path) => {
    return getNestedValue(data, path) || match;
  });
}
```

---

## Implementation Checklist

### Phase 1: Critical Fixes
- [ ] Extract navigation BEFORE removal
- [ ] Extract structure BEFORE removal
- [ ] Add crawler discoveredSections
- [ ] Update blog detection with nav + crawler
- [ ] Update FAQ detection with nav + crawler
- [ ] Verify recursive schema parsing

### Phase 2: Complete Extraction
- [ ] Implement all extraction schemas
- [ ] Store full evidence objects
- [ ] Add source attribution

### Phase 3: Dynamic Text
- [ ] Create all detected/missing templates
- [ ] Implement template interpolation
- [ ] Use extracted data in text

### Phase 4: Testing
- [ ] Test against multiple sites
- [ ] Verify no false negatives
- [ ] Verify extraction accuracy
- [ ] Verify dynamic text accuracy

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-11 | Initial detection rulebook |
| 2.0 | 2025-12-11 | Added extraction schemas, storage structures, dynamic text |

---

*End of Detection & Extraction Rulebook*
