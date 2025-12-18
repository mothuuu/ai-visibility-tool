// backend/analyzers/recommendation-engine/fact-extractor.js
/**
 * FACT EXTRACTOR
 * Extracts concrete facts from scanEvidence for use in prescriptive recommendations
 */

const VOCABULARY = require('../../config/detection-vocabulary');

/**
 * Main extraction function
 * @param {Object} scanEvidence - Complete scan evidence
 * @returns {Object} - Detected profile + extracted facts
 */
function extractSiteFacts(scanEvidence) {
  return {
    detected_profile: detectSiteProfile(scanEvidence),
    extracted_facts: extractAllFacts(scanEvidence)
  };
}

// ========================================
// SITE PROFILE DETECTION
// ========================================

function detectSiteProfile(scanEvidence) {
  const pageCount = scanEvidence.pageCount || 1;
  const html = scanEvidence.html || '';
  const content = scanEvidence.content || {};
  const structure = scanEvidence.structure || {};
  
  // Detect anchors (single-page indicators)
  const anchors = extractAnchors(html);
  
  // Detect sections
  const hasFAQ = detectFAQ(scanEvidence);
  const hasPricing = detectPricing(html);
  const hasContact = detectContact(html);
  const hasBlog = detectBlog(scanEvidence);
  const hasLocalBusiness = detectLocalBusiness(scanEvidence);
  
  // Determine site type
  let site_type = 'multi_page'; // default
  
  if (pageCount === 1) {
    if (anchors.length >= 3) {
      site_type = 'single_page';
    } else {
      site_type = 'simple_site';
    }
  } else if (hasBlog) {
    site_type = 'blog';
  } else if (hasLocalBusiness) {
    site_type = 'local_business';
  } else if (hasPricing) {
    site_type = 'saas';
  }
  
  return {
    site_type,
    routes_count: pageCount,
    anchors: anchors,
    sections: {
      has_faq: hasFAQ,
      has_pricing: hasPricing,
      has_contact: hasContact,
      has_blog: hasBlog,
      has_local_info: hasLocalBusiness
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

function detectFAQ(scanEvidence) {
  const faqs = scanEvidence.content?.faqs || [];
  const h2s = scanEvidence.content?.headings?.h2 || [];
  const hasFAQSchema = scanEvidence.technical?.hasFAQSchema || false;

  // Existing checks for on-page FAQ content using centralized VOCABULARY
  const faqPattern = VOCABULARY.TEXT_PATTERNS.questions.faqHeadings;
  const hasOnPageFAQ = faqs.length > 0 || h2s.some(h => faqPattern.test(h)) || hasFAQSchema;

  // Fix for Issue #2 + #9: Check crawler discoveries
  const crawlerFoundFAQ = scanEvidence.siteMetrics?.discoveredSections?.hasFaqUrl ||
                          scanEvidence.crawler?.discoveredSections?.hasFaqUrl || false;

  // Fix for Issue #2 + #9: Check navigation links (multiple possible locations)
  const navigation = scanEvidence.navigation || scanEvidence.content?.navigation || {};
  const navHasFAQLink = navigation.hasFAQLink || navigation.keyPages?.faq || false;

  const result = hasOnPageFAQ || crawlerFoundFAQ || navHasFAQLink;

  console.log('[Detection] FAQ detected:', result, {
    hasOnPageFAQ,
    faqCount: faqs.length,
    hasFAQSchema,
    crawlerFoundFAQ,
    navHasFAQLink
  });

  return result;
}

function detectPricing(html) {
  // Check for pricing keywords and price patterns
  const pricingKeywords = VOCABULARY.KEYWORDS.navLinkText.pricing;
  const hasPricingKeyword = pricingKeywords.some(kw => new RegExp(kw, 'i').test(html));
  const hasPricePattern = /\$\d+|\d+\.\d{2}|subscribe|buy now/i.test(html);
  return hasPricingKeyword || hasPricePattern;
}

function detectContact(html) {
  // Check for contact patterns using VOCABULARY
  const hasEmail = VOCABULARY.TEXT_PATTERNS.contact.email.test(html);
  const hasPhone = VOCABULARY.TEXT_PATTERNS.contact.phone.test(html);
  const hasContactKeyword = /contact|get in touch|reach us/i.test(html);
  return hasEmail || hasPhone || hasContactKeyword;
}

function detectBlog(scanEvidence) {
  const url = scanEvidence.url || '';
  const hasArticleSchema = scanEvidence.technical?.hasArticleSchema || false;

  // Check current page using centralized VOCABULARY
  const currentPageIsBlog = VOCABULARY.URL_PATTERNS.blog.test(url);

  // Fix for Issue #2 + #9: Check crawler discoveries
  const crawlerFoundBlog = scanEvidence.siteMetrics?.discoveredSections?.hasBlogUrl ||
                           scanEvidence.crawler?.discoveredSections?.hasBlogUrl || false;

  // Fix for Issue #2 + #9: Check navigation links (multiple possible locations)
  const navigation = scanEvidence.navigation || scanEvidence.content?.navigation || {};
  const navHasBlogLink = navigation.hasBlogLink || navigation.keyPages?.blog || false;

  const result = currentPageIsBlog || hasArticleSchema || crawlerFoundBlog || navHasBlogLink;

  console.log('[Detection] Blog detected:', result, {
    currentPageIsBlog,
    hasArticleSchema,
    crawlerFoundBlog,
    navHasBlogLink
  });

  return result;
}

function detectLocalBusiness(scanEvidence) {
  const html = scanEvidence.html || '';
  const hasLocalSchema = scanEvidence.technical?.hasLocalBusinessSchema || false;

  // Check for address patterns using centralized VOCABULARY
  const hasAddress = VOCABULARY.TEXT_PATTERNS.address.usStreet.test(html);
  const hasPhone = VOCABULARY.TEXT_PATTERNS.contact.phone.test(html);
  const hasMap = /maps\.google|google\.com\/maps|mapbox/i.test(html);

  return hasLocalSchema || (hasAddress && hasPhone) || hasMap;
}

// ========================================
// FACT EXTRACTION
// ========================================

function extractAllFacts(scanEvidence) {
  const facts = [];
  
  // Extract brand name
  const brand = extractBrand(scanEvidence);
  if (brand) {
    facts.push({
      name: 'brand',
      value: brand.value,
      selector: brand.selector,
      confidence: brand.confidence
    });
  }
  
  // Extract description
  const description = extractDescription(scanEvidence);
  if (description) {
    facts.push({
      name: 'description',
      value: description.value,
      selector: description.selector,
      confidence: description.confidence
    });
  }
  
  // Extract logo
  const logo = extractLogo(scanEvidence);
  if (logo) {
    facts.push({
      name: 'logo',
      value: logo.value,
      selector: logo.selector,
      confidence: logo.confidence,
      validated: logo.validated
    });
  }
  
  // Extract social links
  const social = extractSocialLinks(scanEvidence);
  if (social && social.length > 0) {
    facts.push({
      name: 'social_links',
      value: social.map(s => s.value),
      platforms: social.map(s => s.platform),
      selector: 'footer a, header a',
      confidence: 'high'
    });
  }
  
  // Extract contact info
  const email = extractEmail(scanEvidence);
  if (email) {
    facts.push({
      name: 'email',
      value: email.value,
      selector: email.selector,
      confidence: email.confidence
    });
  }
  
  const phone = extractPhone(scanEvidence);
  if (phone) {
    facts.push({
      name: 'phone',
      value: phone.value,
      selector: phone.selector,
      confidence: phone.confidence
    });
  }
  
  return facts;
}

// ========================================
// BRAND NAME EXTRACTION
// ========================================

function extractBrand(scanEvidence) {
  const metadata = scanEvidence.metadata || {};
  const content = scanEvidence.content || {};
  const technical = scanEvidence.technical || {};
  const url = scanEvidence.url || '';
  
  // Priority 1: Organization schema
  const orgSchema = (technical.structuredData || []).find(s => s.type === 'Organization');
  if (orgSchema && orgSchema.raw && orgSchema.raw.name) {
    return {
      value: orgSchema.raw.name,
      selector: 'script[type="application/ld+json"] Organization.name',
      confidence: 'high'
    };
  }
  
  // Priority 2: OG site name
  if (metadata.ogTitle) {
    return {
      value: cleanBrandName(metadata.ogTitle),
      selector: 'meta[property="og:title"]',
      confidence: 'high'
    };
  }
  
  // Priority 3: Title tag
  if (metadata.title) {
    return {
      value: cleanBrandName(metadata.title),
      selector: 'title',
      confidence: 'medium'
    };
  }
  
  // Priority 4: H1
  const h1s = content.headings?.h1 || [];
  if (h1s.length > 0) {
    return {
      value: cleanBrandName(h1s[0]),
      selector: 'h1',
      confidence: 'medium'
    };
  }
  
  // Fallback: Domain name
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '');
    const brandName = domain.split('.')[0];
    return {
      value: brandName.charAt(0).toUpperCase() + brandName.slice(1),
      selector: 'url',
      confidence: 'low'
    };
  } catch (e) {
    return null;
  }
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

function extractDescription(scanEvidence) {
  const metadata = scanEvidence.metadata || {};
  
  if (metadata.description) {
    return {
      value: metadata.description,
      selector: 'meta[name="description"]',
      confidence: 'high'
    };
  }
  
  if (metadata.ogDescription) {
    return {
      value: metadata.ogDescription,
      selector: 'meta[property="og:description"]',
      confidence: 'high'
    };
  }
  
  return null;
}

// ========================================
// LOGO EXTRACTION
// ========================================

function extractLogo(scanEvidence) {
  const metadata = scanEvidence.metadata || {};
  const media = scanEvidence.media || {};
  const url = scanEvidence.url || '';
  
  // Priority 1: OG Image
  if (metadata.ogImage) {
    return {
      value: makeAbsoluteUrl(metadata.ogImage, url),
      selector: 'meta[property="og:image"]',
      confidence: 'high',
      validated: false // We'd need to check if it returns 200
    };
  }
  
  // Priority 2: Images with 'logo' in alt
  const images = media.images || [];
  const logoImage = images.find(img => img.alt && /logo/i.test(img.alt));
  if (logoImage) {
    return {
      value: makeAbsoluteUrl(logoImage.src, url),
      selector: 'img[alt*="logo"]',
      confidence: 'high',
      validated: false
    };
  }
  
  // Priority 3: Favicon
  // Note: Would need to parse link[rel="icon"] from HTML
  
  // Fallback: Guess /logo.png
  return {
    value: `${url}/logo.png`,
    selector: 'inferred',
    confidence: 'low',
    validated: false
  };
}

// ========================================
// SOCIAL LINKS EXTRACTION
// ========================================

function extractSocialLinks(scanEvidence) {
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
          confidence: 'high'
        });
        break; // Only get first match per platform
      }
    }
  }
  
  return social;
}

// ========================================
// EMAIL EXTRACTION
// ========================================

function extractEmail(scanEvidence) {
  const html = scanEvidence.html || '';
  
  // Look for mailto: links
  const mailtoMatch = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (mailtoMatch) {
    return {
      value: mailtoMatch[1],
      selector: 'a[href^="mailto:"]',
      confidence: 'high'
    };
  }
  
  // Look for email patterns in text
  const emailMatch = html.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/i);
  if (emailMatch) {
    return {
      value: emailMatch[0],
      selector: 'text content',
      confidence: 'medium'
    };
  }
  
  return null;
}

// ========================================
// PHONE EXTRACTION
// ========================================

function extractPhone(scanEvidence) {
  const html = scanEvidence.html || '';
  
  // Look for tel: links
  const telMatch = html.match(/tel:([0-9+\-()\s]+)/i);
  if (telMatch) {
    return {
      value: telMatch[1].trim(),
      selector: 'a[href^="tel:"]',
      confidence: 'high'
    };
  }
  
  // Look for US phone patterns
  const phoneMatch = html.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  if (phoneMatch) {
    return {
      value: phoneMatch[0],
      selector: 'text content',
      confidence: 'medium'
    };
  }
  
  return null;
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