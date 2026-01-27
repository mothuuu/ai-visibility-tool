/**
 * EVIDENCE HELPERS
 * File: backend/recommendations/evidenceHelpers.js
 *
 * Phase 4A.3c: Safe accessor utilities for scan evidence / detailed_analysis.
 * All functions are null-safe and never throw.
 */

// ========================================
// CORE ACCESSORS
// ========================================

/**
 * Get the detailed_analysis object from a scan or evidence object.
 * @param {Object} scanOrEvidence - scan row, evidence object, or detailed_analysis directly
 * @returns {Object} - The evidence object (never null)
 */
function getEvidence(scanOrEvidence) {
  if (!scanOrEvidence || typeof scanOrEvidence !== 'object') return {};
  // If it has detailed_analysis, unwrap it
  if (scanOrEvidence.detailed_analysis && typeof scanOrEvidence.detailed_analysis === 'object') {
    return scanOrEvidence.detailed_analysis;
  }
  // Already an evidence object
  return scanOrEvidence;
}

/**
 * Safe nested object access using dot-notation path.
 * @param {Object} obj
 * @param {string} path - e.g. "technical.structuredData.0.type"
 * @returns {*} - Value or undefined
 */
function getPath(obj, path) {
  if (!obj || !path || typeof path !== 'string') return undefined;
  return path.split('.').reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, obj);
}

// ========================================
// EVIDENCE EXTRACTORS
// ========================================

/**
 * Count of pages checked/scanned.
 * @param {Object} evidence
 * @returns {number|null}
 */
function pagesCheckedCount(evidence) {
  const ev = getEvidence(evidence);
  return ev.crawler?.totalDiscoveredUrls
    || ev.siteMetrics?.pagesChecked
    || ev.siteMetrics?.totalPages
    || null;
}

/**
 * List of pages checked (as comma-separated string).
 * @param {Object} evidence
 * @param {number} [max=5]
 * @returns {string}
 */
function pagesCheckedList(evidence, max = 5) {
  const ev = getEvidence(evidence);
  const urls = ev.crawler?.discoveredUrls
    || ev.siteMetrics?.checkedUrls
    || [];
  if (!Array.isArray(urls) || urls.length === 0) return '';
  return urls.slice(0, max).join(', ');
}

/**
 * Count of FAQ items detected.
 * @param {Object} evidence
 * @returns {number}
 */
function faqCount(evidence) {
  const ev = getEvidence(evidence);
  const faqs = ev.content?.faqs;
  if (Array.isArray(faqs)) return faqs.length;
  return ev.siteMetrics?.faqCount || 0;
}

/**
 * Pages that have FAQ content (URLs).
 * @param {Object} evidence
 * @returns {string[]}
 */
function pagesWithFaqs(evidence) {
  const ev = getEvidence(evidence);
  const faqs = ev.content?.faqs || [];
  const urls = new Set();
  for (const faq of faqs) {
    if (faq.sourceUrl) urls.add(faq.sourceUrl);
    if (faq.source_url) urls.add(faq.source_url);
  }
  return Array.from(urls);
}

/**
 * Error summary from validation issues.
 * @param {Object} evidence
 * @param {string} [subfactorKey] - Optional subfactor for specific errors
 * @returns {string}
 */
function errorSummary(evidence, subfactorKey) {
  const ev = getEvidence(evidence);

  // Try schema validation errors
  const schemaErrors = ev.technical?.schemaValidationErrors;
  if (Array.isArray(schemaErrors) && schemaErrors.length > 0) {
    return schemaErrors.slice(0, 3).map(e => e.message || e).join('; ');
  }

  // Try general errors
  const errors = ev.errors || ev.issues;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.slice(0, 3).map(e => typeof e === 'string' ? e : e.message || JSON.stringify(e)).join('; ');
  }

  return '';
}

/**
 * Check if a specific schema type is present.
 * @param {Object} evidence
 * @param {string} schemaType - e.g. "Organization", "FAQPage", "Article"
 * @returns {boolean}
 */
function hasSchemaType(evidence, schemaType) {
  const ev = getEvidence(evidence);
  const structuredData = ev.technical?.structuredData;
  if (!Array.isArray(structuredData)) return false;
  return structuredData.some(s => {
    const type = s.type || s['@type'] || '';
    return type.toLowerCase() === schemaType.toLowerCase();
  });
}

/**
 * Convenience checks for common schema types.
 */
function hasFAQSchema(evidence) {
  const ev = getEvidence(evidence);
  return ev.technical?.hasFAQSchema === true || hasSchemaType(evidence, 'FAQPage');
}

function hasOrganizationSchema(evidence) {
  const ev = getEvidence(evidence);
  return ev.technical?.hasOrganizationSchema === true || hasSchemaType(evidence, 'Organization');
}

function hasArticleSchema(evidence) {
  const ev = getEvidence(evidence);
  return ev.technical?.hasArticleSchema === true || hasSchemaType(evidence, 'Article');
}

function hasBreadcrumbSchema(evidence) {
  const ev = getEvidence(evidence);
  return ev.technical?.hasBreadcrumbSchema === true || hasSchemaType(evidence, 'BreadcrumbList');
}

/**
 * Count of detected schema types.
 * @param {Object} evidence
 * @returns {number}
 */
function schemaTypeCount(evidence) {
  const ev = getEvidence(evidence);
  const structuredData = ev.technical?.structuredData;
  if (!Array.isArray(structuredData)) return 0;
  return structuredData.length;
}

/**
 * List of detected schema types (unique).
 * @param {Object} evidence
 * @returns {string[]}
 */
function detectedSchemaTypes(evidence) {
  const ev = getEvidence(evidence);
  const structuredData = ev.technical?.structuredData;
  if (!Array.isArray(structuredData)) return [];
  const types = new Set();
  for (const s of structuredData) {
    const type = s.type || s['@type'];
    if (type) types.add(type);
  }
  return Array.from(types);
}

/**
 * Missing schemas (common ones not found).
 * @param {Object} evidence
 * @returns {string[]}
 */
function missingCommonSchemas(evidence) {
  const common = ['Organization', 'WebSite', 'FAQPage', 'BreadcrumbList'];
  const detected = detectedSchemaTypes(evidence).map(t => t.toLowerCase());
  return common.filter(s => !detected.includes(s.toLowerCase()));
}

/**
 * Image alt text statistics.
 * @param {Object} evidence
 * @returns {{ total: number, withAlt: number, withoutAlt: number }}
 */
function imageAltStats(evidence) {
  const ev = getEvidence(evidence);
  const total = ev.media?.imageCount || ev.media?.totalImages || 0;
  const withAlt = ev.media?.imagesWithAlt || 0;
  const withoutAlt = ev.media?.imagesWithoutAlt || (total - withAlt);
  return { total, withAlt, withoutAlt };
}

/**
 * Heading structure info.
 * @param {Object} evidence
 * @returns {{ h1Count: number, totalHeadings: number, issues: string[] }}
 */
function headingInfo(evidence) {
  const ev = getEvidence(evidence);
  const headings = ev.content?.headings || {};
  const h1Count = Array.isArray(headings.h1) ? headings.h1.length : 0;
  const totalHeadings = Object.values(headings).flat().length;

  const issues = [];
  if (h1Count === 0) issues.push('Missing H1');
  if (h1Count > 1) issues.push(`Multiple H1s (${h1Count})`);

  return { h1Count, totalHeadings, issues };
}

/**
 * TTFB value.
 * @param {Object} evidence
 * @returns {number|null}
 */
function ttfbMs(evidence) {
  const ev = getEvidence(evidence);
  return ev.performance?.ttfb || ev.performance?.responseTime || null;
}

/**
 * Whether robots.txt blocks AI crawlers.
 * @param {Object} evidence
 * @returns {boolean}
 */
function robotsBlocksAICrawlers(evidence) {
  const ev = getEvidence(evidence);
  const robotsTxt = ev.crawler?.robotsTxt || '';
  if (typeof robotsTxt !== 'string') return false;
  // Simple heuristic: check for known AI bot disallow rules
  const aiCrawlers = ['GPTBot', 'CCBot', 'Google-Extended', 'anthropic-ai', 'ClaudeBot'];
  const lower = robotsTxt.toLowerCase();
  return aiCrawlers.some(bot => {
    const botLower = bot.toLowerCase();
    return lower.includes(`user-agent: ${botLower}`) && lower.includes('disallow: /');
  });
}

/**
 * Whether sitemap is detected.
 * @param {Object} evidence
 * @returns {boolean}
 */
function hasSitemap(evidence) {
  const ev = getEvidence(evidence);
  return !!(ev.technical?.hasSitemapLink ||
    ev.crawler?.sitemap?.detected ||
    ev.crawler?.sitemapDetected);
}

/**
 * Whether canonical tag exists.
 * @param {Object} evidence
 * @returns {boolean}
 */
function hasCanonical(evidence) {
  const ev = getEvidence(evidence);
  return !!(ev.technical?.hasCanonical || ev.technical?.canonicalUrl);
}

/**
 * Author info.
 * @param {Object} evidence
 * @returns {{ name: string, hasAuthor: boolean }}
 */
function authorInfo(evidence) {
  const ev = getEvidence(evidence);
  const name = ev.metadata?.author || '';
  return { name, hasAuthor: name.length > 0 };
}

/**
 * Build a full evidence context object for placeholder resolution.
 * Combines all extractors into a flat key-value map.
 *
 * @param {Object} evidence - Scan evidence / detailed_analysis
 * @returns {Object} - Flat context for placeholder resolver
 */
function buildEvidenceContext(evidence) {
  const ev = getEvidence(evidence);
  const imgStats = imageAltStats(ev);
  const hInfo = headingInfo(ev);
  const author = authorInfo(ev);

  return {
    pages_checked_count: String(pagesCheckedCount(ev) || 'multiple'),
    pages_checked_list: pagesCheckedList(ev) || 'homepage and key pages',
    faq_count: String(faqCount(ev)),
    pages_with_faqs: pagesWithFaqs(ev).join(', '),
    error_count: String((ev.errors || ev.issues || []).length || 'some'),
    error_summary: errorSummary(ev),
    schema_count: String(schemaTypeCount(ev)),
    detected_schemas: detectedSchemaTypes(ev).join(', '),
    missing_schemas: missingCommonSchemas(ev).join(', '),
    has_faq_schema: String(hasFAQSchema(ev)),
    has_org_schema: String(hasOrganizationSchema(ev)),
    has_article_schema: String(hasArticleSchema(ev)),
    has_breadcrumb_schema: String(hasBreadcrumbSchema(ev)),
    total_images: String(imgStats.total),
    images_with_alt: String(imgStats.withAlt),
    images_without_alt: String(imgStats.withoutAlt),
    heading_count: String(hInfo.totalHeadings),
    h1_count: String(hInfo.h1Count),
    heading_issues: hInfo.issues.join(', ') || 'none detected',
    ttfb: String(ttfbMs(ev) || 'unknown'),
    has_sitemap: String(hasSitemap(ev)),
    has_canonical: String(hasCanonical(ev)),
    robots_blocks_ai: String(robotsBlocksAICrawlers(ev)),
    author_name: author.name || 'your team expert',
    has_author: String(author.hasAuthor)
  };
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  // Core
  getEvidence,
  getPath,

  // Extractors
  pagesCheckedCount,
  pagesCheckedList,
  faqCount,
  pagesWithFaqs,
  errorSummary,
  hasSchemaType,
  hasFAQSchema,
  hasOrganizationSchema,
  hasArticleSchema,
  hasBreadcrumbSchema,
  schemaTypeCount,
  detectedSchemaTypes,
  missingCommonSchemas,
  imageAltStats,
  headingInfo,
  ttfbMs,
  robotsBlocksAICrawlers,
  hasSitemap,
  hasCanonical,
  authorInfo,

  // Context builder
  buildEvidenceContext
};
