// backend/analyzers/recommendation-engine/fact-extractor.js
/**
 * FACT EXTRACTOR
 * Extracts concrete facts from scanEvidence for use in prescriptive recommendations
 *
 * Per rulebook "Diagnostic Output Contract":
 * Includes decision trails for all detection logic to enable auditing and debugging.
 */

const VOCABULARY = require('../../config/detection-vocabulary');
const {
  CONFIDENCE_LEVELS,
  EVIDENCE_SOURCES,
  DiagnosticCollector,
  createDecision
} = require('../../config/diagnostic-types');

/**
 * Main extraction function
 * @param {Object} scanEvidence - Complete scan evidence
 * @returns {Object} - Detected profile + extracted facts + diagnostic trails
 */
function extractSiteFacts(scanEvidence) {
  // Create a diagnostic collector for this extraction
  const diagnostics = new DiagnosticCollector(`fact-extraction-${Date.now()}`);

  const detected_profile = detectSiteProfile(scanEvidence, diagnostics);
  const extracted_facts = extractAllFacts(scanEvidence, diagnostics);

  // Finalize diagnostics
  const diagnosticReport = diagnostics.finalize();

  return {
    detected_profile,
    extracted_facts,
    diagnostics: diagnosticReport
  };
}

// ========================================
// SITE PROFILE DETECTION
// ========================================

function detectSiteProfile(scanEvidence, diagnostics) {
  const pageCount = scanEvidence.pageCount || 1;
  const html = scanEvidence.html || '';
  const content = scanEvidence.content || {};
  const structure = scanEvidence.structure || {};

  // Detect anchors (single-page indicators)
  const anchors = extractAnchors(html);

  // Detect sections with diagnostic trails
  const faqResult = detectFAQ(scanEvidence, diagnostics);
  const pricingResult = detectPricing(html, scanEvidence, diagnostics);
  const contactResult = detectContact(html, diagnostics);
  const blogResult = detectBlog(scanEvidence, diagnostics);
  const localBusinessResult = detectLocalBusiness(scanEvidence, diagnostics);

  // Determine site type with decision trail
  let site_type = 'multi_page'; // default
  let siteTypeReasoning = '';

  if (pageCount === 1) {
    if (anchors.length >= 3) {
      site_type = 'single_page';
      siteTypeReasoning = `Single page with ${anchors.length} anchor links detected`;
    } else {
      site_type = 'simple_site';
      siteTypeReasoning = `Single page with ${anchors.length} anchor links (< 3)`;
    }
  } else if (blogResult.detected) {
    site_type = 'blog';
    siteTypeReasoning = `Blog detected: ${blogResult.reasoning}`;
  } else if (localBusinessResult.detected) {
    site_type = 'local_business';
    siteTypeReasoning = `Local business signals detected: ${localBusinessResult.reasoning}`;
  } else if (pricingResult.detected) {
    site_type = 'saas';
    siteTypeReasoning = `Pricing content detected: ${pricingResult.reasoning}`;
  } else {
    siteTypeReasoning = `Default multi-page site (${pageCount} pages)`;
  }

  // Add site type decision to diagnostics
  diagnostics.addDecision({
    subfactor: 'site_profile',
    checkName: 'site_type_detection',
    result: true,
    score: 1,
    maxScore: 1,
    evidence: [site_type, pageCount, anchors.length],
    reasoning: siteTypeReasoning,
    sources: [EVIDENCE_SOURCES.HEURISTIC]
  });

  return {
    site_type,
    routes_count: pageCount,
    anchors: anchors,
    sections: {
      has_faq: faqResult.detected,
      has_pricing: pricingResult.detected,
      has_contact: contactResult.detected,
      has_blog: blogResult.detected,
      has_local_info: localBusinessResult.detected
    },
    // Include detection details for debugging
    _detection_details: {
      faq: faqResult,
      pricing: pricingResult,
      contact: contactResult,
      blog: blogResult,
      localBusiness: localBusinessResult
    }
  };
}

function extractAnchors(html) {
  const anchorPattern = /href=["']#([^"']+)["']/gi;
  const anchors = [];
  let match;
  
  while ((match = anchorPattern.exec(html)) !== null) {
    const anchor = match[1];
    if (anchor && anchor.length > 0 && !anchors.includes('#' + anchor)) {
      anchors.push('#' + anchor);
    }
  }
  
  return anchors.slice(0, 10); // Max 10
}

/**
 * RULEBOOK v1.2 Section 2.2.6: FAQ Detection - Complete Specification
 * Returns all required evidence fields for multi-source detection
 */
function detectFAQ(scanEvidence, diagnostics) {
  const faqs = scanEvidence.content?.faqs || [];
  const h2s = scanEvidence.content?.headings?.h2 || [];
  const hasFAQSchema = scanEvidence.technical?.hasFAQSchema || false;
  const schemaFAQCount = faqs.filter(f => f.source === 'schema').length;

  // Existing checks for on-page FAQ content using centralized VOCABULARY
  const faqPattern = VOCABULARY.TEXT_PATTERNS.questions.faqHeadings;
  const hasFAQHeading = h2s.some(h => faqPattern.test(h));
  const faqHeadingText = h2s.find(h => faqPattern.test(h)) || null;
  const hasOnPageFAQs = faqs.length > 0;
  const onPageFAQCount = faqs.length;

  // RULEBOOK v1.2: Check crawler discoveries with full URL details
  const crawlerFoundFAQ = scanEvidence.siteMetrics?.discoveredSections?.hasFaqUrl ||
                          scanEvidence.crawler?.discoveredSections?.hasFaqUrl || false;
  const faqPageUrl = scanEvidence.siteMetrics?.discoveredSections?.faqUrl ||
                     scanEvidence.crawler?.discoveredSections?.faqUrl || null;
  const faqPageUrls = scanEvidence.siteMetrics?.discoveredSections?.faqUrls ||
                      scanEvidence.crawler?.discoveredSections?.faqUrls || [];

  // RULEBOOK v1.2: Check navigation links with href and text details
  const navigation = scanEvidence.navigation || scanEvidence.content?.navigation || {};
  const allNavLinks = navigation.allNavLinks || navigation.links || [];

  // Find FAQ link in navigation
  let hasFAQNavLink = navigation.hasFAQLink || navigation.keyPages?.faq || false;
  let faqNavLinkHref = null;
  let faqNavLinkText = null;

  // Search for FAQ link details
  for (const link of allNavLinks) {
    const href = link.href || '';
    const text = (link.text || '').toLowerCase();
    if (VOCABULARY.URL_PATTERNS.faq.test(href) || VOCABULARY.matchesNavKeyword(text, 'faq')) {
      hasFAQNavLink = true;
      faqNavLinkHref = href;
      faqNavLinkText = link.text;
      break;
    }
  }

  // RULEBOOK v1.2: Accept FAQ presence if ANY of these is true
  const detected = hasOnPageFAQs || hasFAQSchema || hasFAQNavLink || crawlerFoundFAQ;

  // Determine source with priority: schema > content > heading > navigation > crawler
  let source = 'none';
  let confidence = 'low';
  if (hasFAQSchema) {
    source = 'schema';
    confidence = 'high';
  } else if (hasOnPageFAQs) {
    source = 'content';
    confidence = 'medium';
  } else if (hasFAQHeading) {
    source = 'heading';
    confidence = 'medium';
  } else if (hasFAQNavLink) {
    source = 'navigation';
    confidence = 'medium';
  } else if (crawlerFoundFAQ) {
    source = 'crawler';
    confidence = 'medium';
  }

  // Build reasoning string
  const reasons = [];
  if (hasOnPageFAQs) reasons.push(`${onPageFAQCount} FAQs extracted from page`);
  if (hasFAQSchema) reasons.push(`FAQPage schema with ${schemaFAQCount} items`);
  if (hasFAQHeading) reasons.push(`FAQ heading found: "${faqHeadingText}"`);
  if (hasFAQNavLink) reasons.push(`FAQ nav link: ${faqNavLinkText} -> ${faqNavLinkHref}`);
  if (crawlerFoundFAQ) reasons.push(`Crawler found FAQ: ${faqPageUrl}`);

  const reasoning = detected
    ? reasons.join('; ')
    : 'No FAQ content, schema, nav link, or discovered URL';

  // Add decision to diagnostics
  if (diagnostics) {
    const sources = [];
    if (hasFAQSchema) sources.push(EVIDENCE_SOURCES.JSON_LD);
    if (hasOnPageFAQs) sources.push(EVIDENCE_SOURCES.SEMANTIC_HTML);
    if (hasFAQNavLink) sources.push(EVIDENCE_SOURCES.NAVIGATION_LINK);
    if (crawlerFoundFAQ) sources.push(EVIDENCE_SOURCES.CRAWLER);

    diagnostics.addDecision({
      subfactor: 'faq_presence',
      checkName: 'detect_faq',
      result: detected,
      score: detected ? 1 : 0,
      maxScore: 1,
      evidence: {
        // RULEBOOK v1.2 Section 2.2.6: All required evidence fields
        detected,
        count: onPageFAQCount,
        source,
        confidence,
        hasFAQSchema,
        schemaFAQCount,
        hasOnPageFAQs,
        onPageFAQCount,
        hasFAQHeading,
        faqHeadingText,
        hasFAQNavLink,
        faqNavLinkHref,
        faqNavLinkText,
        crawlerFoundFAQ,
        faqPageUrl,
        faqPageUrls
      },
      reasoning,
      sources: sources.length > 0 ? sources : [EVIDENCE_SOURCES.HEURISTIC]
    });
  }

  console.log('[Detection] FAQ detected:', detected, {
    source,
    confidence,
    onPageFAQCount,
    hasFAQSchema,
    hasFAQNavLink,
    crawlerFoundFAQ
  });

  // RULEBOOK v1.2: Return complete evidence object
  return {
    detected,
    count: onPageFAQCount,
    source,
    confidence,
    reasoning,
    // All required evidence fields
    hasFAQSchema,
    schemaFAQCount,
    hasOnPageFAQs,
    onPageFAQCount,
    hasFAQHeading,
    faqHeadingText,
    hasFAQNavLink,
    faqNavLinkHref,
    faqNavLinkText,
    crawlerFoundFAQ,
    faqPageUrl,
    faqPageUrls
  };
}

function detectPricing(html, scanEvidence, diagnostics) {
  // Check for pricing keywords and price patterns
  const pricingKeywords = VOCABULARY.KEYWORDS.navLinkText.pricing;
  const hasPricingKeyword = pricingKeywords.some(kw => new RegExp(kw, 'i').test(html));
  const hasPricePattern = /\$\d+|\d+\.\d{2}|subscribe|buy now/i.test(html);

  // Check navigation for pricing link
  const navigation = scanEvidence?.navigation || scanEvidence?.content?.navigation || {};
  const navHasPricingLink = navigation.keyPages?.pricing || navigation.hasPricingLink || false;

  const detected = hasPricingKeyword || hasPricePattern || navHasPricingLink;

  // Build reasoning
  const reasons = [];
  if (hasPricingKeyword) reasons.push('Pricing keywords found in content');
  if (hasPricePattern) reasons.push('Price patterns ($XX.XX) detected');
  if (navHasPricingLink) reasons.push('Pricing link in navigation');

  const reasoning = detected
    ? reasons.join('; ')
    : 'No pricing keywords, patterns, or nav links found';

  // Add decision to diagnostics
  if (diagnostics) {
    diagnostics.addDecision({
      subfactor: 'pricing_presence',
      checkName: 'detect_pricing',
      result: detected,
      score: detected ? 1 : 0,
      maxScore: 1,
      evidence: { hasPricingKeyword, hasPricePattern, navHasPricingLink },
      reasoning,
      sources: navHasPricingLink ? [EVIDENCE_SOURCES.NAVIGATION_LINK, EVIDENCE_SOURCES.BODY_TEXT] : [EVIDENCE_SOURCES.BODY_TEXT]
    });
  }

  return { detected, reasoning, sources: { hasPricingKeyword, hasPricePattern, navHasPricingLink } };
}

function detectContact(html, diagnostics) {
  // Check for contact patterns using VOCABULARY
  const hasEmail = VOCABULARY.TEXT_PATTERNS.contact.email.test(html);
  const hasPhone = VOCABULARY.TEXT_PATTERNS.contact.phone.test(html);
  const hasContactKeyword = /contact|get in touch|reach us/i.test(html);

  const detected = hasEmail || hasPhone || hasContactKeyword;

  // Build reasoning
  const reasons = [];
  if (hasEmail) reasons.push('Email address found');
  if (hasPhone) reasons.push('Phone number found');
  if (hasContactKeyword) reasons.push('Contact keywords detected');

  const reasoning = detected
    ? reasons.join('; ')
    : 'No contact information found';

  // Add decision to diagnostics
  if (diagnostics) {
    diagnostics.addDecision({
      subfactor: 'contact_info',
      checkName: 'detect_contact',
      result: detected,
      score: detected ? 1 : 0,
      maxScore: 1,
      evidence: { hasEmail, hasPhone, hasContactKeyword },
      reasoning,
      sources: [EVIDENCE_SOURCES.BODY_TEXT]
    });
  }

  return { detected, reasoning, sources: { hasEmail, hasPhone, hasContactKeyword } };
}

/**
 * RULEBOOK v1.2 Section 2.4.4: Blog Detection - Complete Specification
 * Returns all required evidence fields for multi-source detection
 */
function detectBlog(scanEvidence, diagnostics) {
  const url = scanEvidence.url || '';
  const hasArticleSchema = scanEvidence.technical?.hasArticleSchema || false;

  // Get article schema type if present
  const structuredData = scanEvidence.technical?.structuredData || [];
  const articleSchema = structuredData.find(s =>
    ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle'].includes(s.type)
  );
  const articleSchemaType = articleSchema?.type || null;

  // Check current page using centralized VOCABULARY
  const currentPageIsBlog = VOCABULARY.URL_PATTERNS.blog.test(url);

  // RULEBOOK v1.2: Check crawler discoveries with full URL details
  const crawlerFoundBlog = scanEvidence.siteMetrics?.discoveredSections?.hasBlogUrl ||
                           scanEvidence.crawler?.discoveredSections?.hasBlogUrl || false;
  const blogPageUrl = scanEvidence.siteMetrics?.discoveredSections?.blogUrl ||
                      scanEvidence.crawler?.discoveredSections?.blogUrl || null;
  const blogPageUrls = scanEvidence.siteMetrics?.discoveredSections?.blogUrls ||
                       scanEvidence.crawler?.discoveredSections?.blogUrls || [];

  // RULEBOOK v1.2: Check sitemap discoveries
  const sitemapFoundBlog = scanEvidence.siteMetrics?.sitemap?.hasBlogUrls ||
                           scanEvidence.crawler?.sitemap?.hasBlogUrls || false;
  const sitemapBlogUrls = scanEvidence.siteMetrics?.sitemap?.blogUrls ||
                          scanEvidence.crawler?.sitemap?.blogUrls || [];

  // RULEBOOK v1.2: Check navigation links with href and text details
  const navigation = scanEvidence.navigation || scanEvidence.content?.navigation || {};
  const allNavLinks = navigation.allNavLinks || navigation.links || [];

  // Find blog link in navigation
  let hasBlogNavLink = navigation.hasBlogLink || navigation.keyPages?.blog || false;
  let blogNavLinkHref = null;
  let blogNavLinkText = null;

  // Search for blog link details
  for (const link of allNavLinks) {
    const href = link.href || '';
    const text = (link.text || '').toLowerCase();
    if (VOCABULARY.URL_PATTERNS.blog.test(href) || VOCABULARY.matchesNavKeyword(text, 'blog')) {
      hasBlogNavLink = true;
      blogNavLinkHref = href;
      blogNavLinkText = link.text;
      break;
    }
  }

  // RULEBOOK v1.2: Check ALL sources for detection
  const detected = currentPageIsBlog || hasArticleSchema || hasBlogNavLink ||
                   crawlerFoundBlog || sitemapFoundBlog;

  // Determine source with priority: url > schema > navigation > crawler > sitemap
  let source = 'none';
  if (currentPageIsBlog) {
    source = 'url';
  } else if (hasArticleSchema) {
    source = 'schema';
  } else if (hasBlogNavLink) {
    source = 'navigation';
  } else if (crawlerFoundBlog) {
    source = 'crawler';
  } else if (sitemapFoundBlog) {
    source = 'sitemap';
  }

  // Build reasoning
  const reasons = [];
  if (currentPageIsBlog) reasons.push('Current URL matches blog pattern');
  if (hasArticleSchema) reasons.push(`${articleSchemaType} schema present`);
  if (hasBlogNavLink) reasons.push(`Blog nav link: ${blogNavLinkText} -> ${blogNavLinkHref}`);
  if (crawlerFoundBlog) reasons.push(`Crawler found blog: ${blogPageUrl}`);
  if (sitemapFoundBlog) reasons.push(`Sitemap contains ${sitemapBlogUrls.length} blog URLs`);

  const reasoning = detected
    ? reasons.join('; ')
    : 'No blog URL, schema, nav link, crawler, or sitemap discovery';

  // Add decision to diagnostics
  if (diagnostics) {
    const sources = [];
    if (currentPageIsBlog) sources.push(EVIDENCE_SOURCES.URL_PATTERN);
    if (hasArticleSchema) sources.push(EVIDENCE_SOURCES.JSON_LD);
    if (hasBlogNavLink) sources.push(EVIDENCE_SOURCES.NAVIGATION_LINK);
    if (crawlerFoundBlog) sources.push(EVIDENCE_SOURCES.CRAWLER);
    if (sitemapFoundBlog) sources.push(EVIDENCE_SOURCES.SITEMAP || 'sitemap');

    diagnostics.addDecision({
      subfactor: 'blog_presence',
      checkName: 'detect_blog',
      result: detected,
      score: detected ? 1 : 0,
      maxScore: 1,
      evidence: {
        // RULEBOOK v1.2 Section 2.4.4: All required evidence fields
        detected,
        source,
        currentPageIsBlog,
        hasArticleSchema,
        articleSchemaType,
        hasBlogNavLink,
        blogNavLinkHref,
        blogNavLinkText,
        crawlerFoundBlog,
        blogPageUrl,
        blogPageUrls,
        sitemapFoundBlog,
        sitemapBlogUrls
      },
      reasoning,
      sources: sources.length > 0 ? sources : [EVIDENCE_SOURCES.HEURISTIC]
    });
  }

  console.log('[Detection] Blog detected:', detected, {
    source,
    currentPageIsBlog,
    hasArticleSchema,
    hasBlogNavLink,
    crawlerFoundBlog,
    sitemapFoundBlog
  });

  // RULEBOOK v1.2: Return complete evidence object
  return {
    detected,
    source,
    reasoning,
    // All required evidence fields
    currentPageIsBlog,
    hasArticleSchema,
    articleSchemaType,
    hasBlogNavLink,
    blogNavLinkHref,
    blogNavLinkText,
    crawlerFoundBlog,
    blogPageUrl,
    blogPageUrls,
    sitemapFoundBlog,
    sitemapBlogUrls
  };
}

function detectLocalBusiness(scanEvidence, diagnostics) {
  const html = scanEvidence.html || '';
  const hasLocalSchema = scanEvidence.technical?.hasLocalBusinessSchema || false;

  // Check for address patterns using centralized VOCABULARY
  const hasAddress = VOCABULARY.TEXT_PATTERNS.address.usStreet.test(html);
  const hasPhone = VOCABULARY.TEXT_PATTERNS.contact.phone.test(html);
  const hasMap = /maps\.google|google\.com\/maps|mapbox/i.test(html);

  const detected = hasLocalSchema || (hasAddress && hasPhone) || hasMap;

  // Build reasoning
  const reasons = [];
  if (hasLocalSchema) reasons.push('LocalBusiness schema present');
  if (hasAddress && hasPhone) reasons.push('Address and phone number found');
  if (hasMap) reasons.push('Google Maps or Mapbox embed detected');

  const reasoning = detected
    ? reasons.join('; ')
    : 'No local business signals found';

  // Add decision to diagnostics
  if (diagnostics) {
    const sources = [];
    if (hasLocalSchema) sources.push(EVIDENCE_SOURCES.JSON_LD);
    if (hasAddress || hasPhone) sources.push(EVIDENCE_SOURCES.BODY_TEXT);
    if (hasMap) sources.push(EVIDENCE_SOURCES.SEMANTIC_HTML);

    diagnostics.addDecision({
      subfactor: 'local_business',
      checkName: 'detect_local_business',
      result: detected,
      score: detected ? 1 : 0,
      maxScore: 1,
      evidence: { hasLocalSchema, hasAddress, hasPhone, hasMap },
      reasoning,
      sources: sources.length > 0 ? sources : [EVIDENCE_SOURCES.HEURISTIC]
    });
  }

  return { detected, reasoning, sources: { hasLocalSchema, hasAddress, hasPhone, hasMap } };
}

// ========================================
// FACT EXTRACTION
// ========================================

function extractAllFacts(scanEvidence, diagnostics) {
  const facts = [];

  // Extract brand name
  const brand = extractBrand(scanEvidence, diagnostics);
  if (brand) {
    facts.push({
      name: 'brand',
      value: brand.value,
      selector: brand.selector,
      confidence: brand.confidence,
      source: brand.source
    });
  }

  // Extract description
  const description = extractDescription(scanEvidence, diagnostics);
  if (description) {
    facts.push({
      name: 'description',
      value: description.value,
      selector: description.selector,
      confidence: description.confidence,
      source: description.source
    });
  }

  // Extract logo
  const logo = extractLogo(scanEvidence, diagnostics);
  if (logo) {
    facts.push({
      name: 'logo',
      value: logo.value,
      selector: logo.selector,
      confidence: logo.confidence,
      validated: logo.validated,
      source: logo.source
    });
  }

  // Extract social links
  const social = extractSocialLinks(scanEvidence, diagnostics);
  if (social && social.length > 0) {
    facts.push({
      name: 'social_links',
      value: social.map(s => s.value),
      platforms: social.map(s => s.platform),
      selector: 'footer a, header a',
      confidence: 'high',
      source: EVIDENCE_SOURCES.BODY_TEXT
    });
  }

  // Extract contact info
  const email = extractEmail(scanEvidence, diagnostics);
  if (email) {
    facts.push({
      name: 'email',
      value: email.value,
      selector: email.selector,
      confidence: email.confidence,
      source: email.source
    });
  }

  const phone = extractPhone(scanEvidence, diagnostics);
  if (phone) {
    facts.push({
      name: 'phone',
      value: phone.value,
      selector: phone.selector,
      confidence: phone.confidence,
      source: phone.source
    });
  }

  // Add fact extraction summary to diagnostics
  if (diagnostics) {
    diagnostics.addDecision({
      subfactor: 'fact_extraction',
      checkName: 'extract_all_facts',
      result: facts.length > 0,
      score: facts.length,
      maxScore: 6, // brand, description, logo, social, email, phone
      evidence: facts.map(f => f.name),
      reasoning: `Extracted ${facts.length} facts: ${facts.map(f => f.name).join(', ') || 'none'}`,
      sources: [...new Set(facts.map(f => f.source).filter(Boolean))]
    });
  }

  return facts;
}

// ========================================
// BRAND NAME EXTRACTION
// ========================================

function extractBrand(scanEvidence, diagnostics) {
  const metadata = scanEvidence.metadata || {};
  const content = scanEvidence.content || {};
  const technical = scanEvidence.technical || {};
  const url = scanEvidence.url || '';

  let result = null;
  let extractionSource = '';

  // Priority 1: Organization schema
  const orgSchema = (technical.structuredData || []).find(s => s.type === 'Organization');
  if (orgSchema && orgSchema.raw && orgSchema.raw.name) {
    result = {
      value: orgSchema.raw.name,
      selector: 'script[type="application/ld+json"] Organization.name',
      confidence: CONFIDENCE_LEVELS.HIGH,
      source: EVIDENCE_SOURCES.JSON_LD
    };
    extractionSource = 'Organization schema';
  }
  // Priority 2: OG site name
  else if (metadata.ogTitle) {
    result = {
      value: cleanBrandName(metadata.ogTitle),
      selector: 'meta[property="og:title"]',
      confidence: CONFIDENCE_LEVELS.HIGH,
      source: EVIDENCE_SOURCES.META_TAG
    };
    extractionSource = 'Open Graph title';
  }
  // Priority 3: Title tag
  else if (metadata.title) {
    result = {
      value: cleanBrandName(metadata.title),
      selector: 'title',
      confidence: CONFIDENCE_LEVELS.MEDIUM,
      source: EVIDENCE_SOURCES.META_TAG
    };
    extractionSource = 'Title tag';
  }
  // Priority 4: H1
  else {
    const h1s = content.headings?.h1 || [];
    if (h1s.length > 0) {
      result = {
        value: cleanBrandName(h1s[0]),
        selector: 'h1',
        confidence: CONFIDENCE_LEVELS.MEDIUM,
        source: EVIDENCE_SOURCES.HEADING_TEXT
      };
      extractionSource = 'H1 heading';
    }
    // Fallback: Domain name
    else {
      try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        const brandName = domain.split('.')[0];
        result = {
          value: brandName.charAt(0).toUpperCase() + brandName.slice(1),
          selector: 'url',
          confidence: CONFIDENCE_LEVELS.LOW,
          source: EVIDENCE_SOURCES.URL_PATTERN
        };
        extractionSource = 'Domain name fallback';
      } catch (e) {
        result = null;
        extractionSource = 'Failed to extract';
      }
    }
  }

  // Add decision to diagnostics
  if (diagnostics) {
    diagnostics.addDecision({
      subfactor: 'brand_extraction',
      checkName: 'extract_brand',
      result: !!result,
      score: result ? 1 : 0,
      maxScore: 1,
      evidence: result ? { value: result.value, selector: result.selector } : null,
      reasoning: result ? `Brand extracted from ${extractionSource}: "${result.value}"` : 'No brand name found',
      sources: result ? [result.source] : [EVIDENCE_SOURCES.HEURISTIC]
    });
  }

  return result;
}

function cleanBrandName(raw) {
  // Remove common suffixes
  return raw
    .replace(/\s*[-|–—]\s*(Home|Welcome|Official Site|Website).*$/i, '')
    .trim();
}

// ========================================
// DESCRIPTION EXTRACTION
// ========================================

function extractDescription(scanEvidence, diagnostics) {
  const metadata = scanEvidence.metadata || {};

  let result = null;
  let extractionSource = '';

  if (metadata.description) {
    result = {
      value: metadata.description,
      selector: 'meta[name="description"]',
      confidence: CONFIDENCE_LEVELS.HIGH,
      source: EVIDENCE_SOURCES.META_TAG
    };
    extractionSource = 'Meta description';
  } else if (metadata.ogDescription) {
    result = {
      value: metadata.ogDescription,
      selector: 'meta[property="og:description"]',
      confidence: CONFIDENCE_LEVELS.HIGH,
      source: EVIDENCE_SOURCES.META_TAG
    };
    extractionSource = 'Open Graph description';
  }

  // Add decision to diagnostics
  if (diagnostics) {
    diagnostics.addDecision({
      subfactor: 'description_extraction',
      checkName: 'extract_description',
      result: !!result,
      score: result ? 1 : 0,
      maxScore: 1,
      evidence: result ? { length: result.value.length, selector: result.selector } : null,
      reasoning: result ? `Description extracted from ${extractionSource} (${result.value.length} chars)` : 'No meta description found',
      sources: result ? [result.source] : [EVIDENCE_SOURCES.HEURISTIC]
    });
  }

  return result;
}

// ========================================
// LOGO EXTRACTION
// ========================================

function extractLogo(scanEvidence, diagnostics) {
  const metadata = scanEvidence.metadata || {};
  const media = scanEvidence.media || {};
  const url = scanEvidence.url || '';

  let result = null;
  let extractionSource = '';

  // Priority 1: OG Image
  if (metadata.ogImage) {
    result = {
      value: makeAbsoluteUrl(metadata.ogImage, url),
      selector: 'meta[property="og:image"]',
      confidence: CONFIDENCE_LEVELS.HIGH,
      validated: false,
      source: EVIDENCE_SOURCES.META_TAG
    };
    extractionSource = 'Open Graph image';
  }
  // Priority 2: Images with 'logo' in alt
  else {
    const images = media.images || [];
    const logoImage = images.find(img => img.alt && /logo/i.test(img.alt));
    if (logoImage) {
      result = {
        value: makeAbsoluteUrl(logoImage.src, url),
        selector: 'img[alt*="logo"]',
        confidence: CONFIDENCE_LEVELS.HIGH,
        validated: false,
        source: EVIDENCE_SOURCES.SEMANTIC_HTML
      };
      extractionSource = 'Image with logo alt text';
    }
    // Fallback: Guess /logo.png
    else {
      result = {
        value: `${url}/logo.png`,
        selector: 'inferred',
        confidence: CONFIDENCE_LEVELS.LOW,
        validated: false,
        source: EVIDENCE_SOURCES.FALLBACK
      };
      extractionSource = 'Inferred /logo.png fallback';
    }
  }

  // Add decision to diagnostics
  if (diagnostics) {
    diagnostics.addDecision({
      subfactor: 'logo_extraction',
      checkName: 'extract_logo',
      result: !!result && result.confidence !== CONFIDENCE_LEVELS.LOW,
      score: result && result.confidence !== CONFIDENCE_LEVELS.LOW ? 1 : 0,
      maxScore: 1,
      evidence: result ? { url: result.value, selector: result.selector } : null,
      reasoning: `Logo extracted from ${extractionSource}`,
      sources: [result.source]
    });
  }

  return result;
}

// ========================================
// SOCIAL LINKS EXTRACTION
// ========================================

function extractSocialLinks(scanEvidence, diagnostics) {
  const html = scanEvidence.html || '';
  const social = [];

  const platforms = [
    { name: 'twitter', patterns: [/twitter\.com\/([a-zA-Z0-9_]+)/i, /x\.com\/([a-zA-Z0-9_]+)/i] },
    { name: 'linkedin', patterns: [/linkedin\.com\/company\/([a-zA-Z0-9-]+)/i, /linkedin\.com\/in\/([a-zA-Z0-9-]+)/i] },
    { name: 'facebook', patterns: [/facebook\.com\/([a-zA-Z0-9.]+)/i] },
    { name: 'instagram', patterns: [/instagram\.com\/([a-zA-Z0-9_.]+)/i] },
    { name: 'youtube', patterns: [/youtube\.com\/(channel|c|user)\/([a-zA-Z0-9_-]+)/i] }
  ];

  for (const platform of platforms) {
    for (const pattern of platform.patterns) {
      const match = html.match(pattern);
      if (match) {
        social.push({
          platform: platform.name,
          value: match[0].startsWith('http') ? match[0] : `https://${match[0]}`,
          confidence: CONFIDENCE_LEVELS.HIGH,
          source: EVIDENCE_SOURCES.BODY_TEXT
        });
        break; // Only get first match per platform
      }
    }
  }

  // Add decision to diagnostics
  if (diagnostics) {
    diagnostics.addDecision({
      subfactor: 'social_links_extraction',
      checkName: 'extract_social_links',
      result: social.length > 0,
      score: social.length,
      maxScore: platforms.length,
      evidence: social.map(s => s.platform),
      reasoning: social.length > 0
        ? `Found ${social.length} social links: ${social.map(s => s.platform).join(', ')}`
        : 'No social media links found',
      sources: [EVIDENCE_SOURCES.BODY_TEXT]
    });
  }

  return social;
}

// ========================================
// EMAIL EXTRACTION
// ========================================

function extractEmail(scanEvidence, diagnostics) {
  const html = scanEvidence.html || '';

  let result = null;
  let extractionSource = '';

  // Look for mailto: links
  const mailtoMatch = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (mailtoMatch) {
    result = {
      value: mailtoMatch[1],
      selector: 'a[href^="mailto:"]',
      confidence: CONFIDENCE_LEVELS.HIGH,
      source: EVIDENCE_SOURCES.SEMANTIC_HTML
    };
    extractionSource = 'mailto: link';
  }
  // Look for email patterns in text
  else {
    const emailMatch = html.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/i);
    if (emailMatch) {
      result = {
        value: emailMatch[0],
        selector: 'text content',
        confidence: CONFIDENCE_LEVELS.MEDIUM,
        source: EVIDENCE_SOURCES.BODY_TEXT
      };
      extractionSource = 'text content pattern';
    }
  }

  // Add decision to diagnostics
  if (diagnostics) {
    diagnostics.addDecision({
      subfactor: 'email_extraction',
      checkName: 'extract_email',
      result: !!result,
      score: result ? 1 : 0,
      maxScore: 1,
      evidence: result ? { email: result.value, selector: result.selector } : null,
      reasoning: result ? `Email extracted from ${extractionSource}: ${result.value}` : 'No email address found',
      sources: result ? [result.source] : [EVIDENCE_SOURCES.HEURISTIC]
    });
  }

  return result;
}

// ========================================
// PHONE EXTRACTION
// ========================================

function extractPhone(scanEvidence, diagnostics) {
  const html = scanEvidence.html || '';

  let result = null;
  let extractionSource = '';

  // Look for tel: links
  const telMatch = html.match(/tel:([0-9+\-()\s]+)/i);
  if (telMatch) {
    result = {
      value: telMatch[1].trim(),
      selector: 'a[href^="tel:"]',
      confidence: CONFIDENCE_LEVELS.HIGH,
      source: EVIDENCE_SOURCES.SEMANTIC_HTML
    };
    extractionSource = 'tel: link';
  }
  // Look for US phone patterns
  else {
    const phoneMatch = html.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    if (phoneMatch) {
      result = {
        value: phoneMatch[0],
        selector: 'text content',
        confidence: CONFIDENCE_LEVELS.MEDIUM,
        source: EVIDENCE_SOURCES.BODY_TEXT
      };
      extractionSource = 'text content pattern';
    }
  }

  // Add decision to diagnostics
  if (diagnostics) {
    diagnostics.addDecision({
      subfactor: 'phone_extraction',
      checkName: 'extract_phone',
      result: !!result,
      score: result ? 1 : 0,
      maxScore: 1,
      evidence: result ? { phone: result.value, selector: result.selector } : null,
      reasoning: result ? `Phone extracted from ${extractionSource}: ${result.value}` : 'No phone number found',
      sources: result ? [result.source] : [EVIDENCE_SOURCES.HEURISTIC]
    });
  }

  return result;
}

// ========================================
// HELPER FUNCTIONS
// ========================================

function makeAbsoluteUrl(url, baseUrl) {
  if (!url) return null;
  
  // Already absolute
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // Protocol-relative
  if (url.startsWith('//')) {
    return 'https:' + url;
  }
  
  // Relative URL
  try {
    const base = new URL(baseUrl);
    if (url.startsWith('/')) {
      return `${base.protocol}//${base.hostname}${url}`;
    } else {
      return `${base.protocol}//${base.hostname}/${url}`;
    }
  } catch (e) {
    return url;
  }
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  extractSiteFacts,
  extractBrand,
  extractLogo,
  extractSocialLinks,
  extractEmail,
  extractPhone
};