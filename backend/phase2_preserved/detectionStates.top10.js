/**
 * DETECTION STATES (Top 10 Subfactors)
 * File: backend/recommendations/detectionStates.top10.js
 *
 * Phase 4A.3c: Semantic detection states for the Top 10 highest-priority subfactors.
 * Detection state determines which template variant to render and whether
 * to suppress a recommendation (COMPLETE state).
 *
 * States: NOT_FOUND | PARTIAL | SCHEMA_INVALID | CONTENT_NO_SCHEMA | COMPLETE
 *
 * Rule: If COMPLETE → renderer returns null for that subfactor.
 */

const { getEvidence } = require('./evidenceHelpers');
const {
  hasFAQSchema,
  hasOrganizationSchema,
  hasArticleSchema,
  hasBreadcrumbSchema,
  schemaTypeCount,
  hasSitemap,
  faqCount,
  imageAltStats,
  headingInfo,
  robotsBlocksAICrawlers,
  authorInfo
} = require('./evidenceHelpers');

// ========================================
// DETECTION STATE ENUM
// ========================================

const DETECTION_STATE = Object.freeze({
  NOT_FOUND: 'NOT_FOUND',
  PARTIAL: 'PARTIAL',
  CONTENT_NO_SCHEMA: 'CONTENT_NO_SCHEMA',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  WEAK: 'WEAK',
  BLOCKING: 'BLOCKING',
  COMPLETE: 'COMPLETE'
});

// ========================================
// TOP 10 DETECTION FUNCTIONS
// ========================================

const DETECTION_FUNCTIONS = {
  /**
   * 1. Organization Schema
   */
  'technical_setup.organization_schema': (evidence) => {
    const ev = getEvidence(evidence);
    if (hasOrganizationSchema(ev)) {
      // Check if schema has validation errors
      const errors = ev.technical?.schemaValidationErrors;
      if (Array.isArray(errors) && errors.some(e => (e.schema || '').toLowerCase().includes('organization'))) {
        return DETECTION_STATE.SCHEMA_INVALID;
      }
      return DETECTION_STATE.COMPLETE;
    }
    return DETECTION_STATE.NOT_FOUND;
  },

  /**
   * 2. Structured Data Coverage
   */
  'technical_setup.structured_data_coverage': (evidence) => {
    const ev = getEvidence(evidence);
    const count = schemaTypeCount(ev);
    if (count >= 4) return DETECTION_STATE.COMPLETE;
    if (count >= 2) return DETECTION_STATE.PARTIAL;
    if (count === 1) return DETECTION_STATE.PARTIAL;
    return DETECTION_STATE.NOT_FOUND;
  },

  /**
   * 3. Sitemap Indexing
   */
  'technical_setup.sitemap_indexing': (evidence) => {
    const ev = getEvidence(evidence);
    if (hasSitemap(ev)) {
      // Check if sitemap has issues
      const sitemapUrls = ev.crawler?.sitemap?.urls;
      if (Array.isArray(sitemapUrls) && sitemapUrls.length === 0) {
        return DETECTION_STATE.PARTIAL;
      }
      return DETECTION_STATE.COMPLETE;
    }
    return DETECTION_STATE.NOT_FOUND;
  },

  /**
   * 4. Crawler Access
   */
  'technical_setup.crawler_access': (evidence) => {
    const ev = getEvidence(evidence);
    if (robotsBlocksAICrawlers(ev)) {
      return DETECTION_STATE.BLOCKING;
    }
    const ttfb = ev.performance?.ttfb;
    if (typeof ttfb === 'number' && ttfb > 2000) {
      return DETECTION_STATE.PARTIAL;
    }
    // If no blocking and reasonable TTFB, consider complete
    if (ttfb && ttfb < 500) {
      return DETECTION_STATE.COMPLETE;
    }
    // Default: can't determine, treat as partial
    return DETECTION_STATE.PARTIAL;
  },

  /**
   * 5. ICP FAQs
   */
  'ai_search_readiness.icp_faqs': (evidence) => {
    const ev = getEvidence(evidence);
    const count = faqCount(ev);
    const hasSchema = hasFAQSchema(ev);

    if (count >= 5 && hasSchema) return DETECTION_STATE.COMPLETE;
    if (count > 0 && !hasSchema) return DETECTION_STATE.CONTENT_NO_SCHEMA;
    if (count > 0 && hasSchema) return DETECTION_STATE.PARTIAL;
    return DETECTION_STATE.NOT_FOUND;
  },

  /**
   * 6. Query Intent Alignment (question-based headings)
   */
  'ai_search_readiness.query_intent_alignment': (evidence) => {
    const ev = getEvidence(evidence);
    const headings = ev.content?.headings || {};
    const allHeadings = Object.values(headings).flat();
    const questionHeadings = allHeadings.filter(h =>
      typeof h === 'string' && /^(how|what|why|when|where|which|who|can|does|is|are|do)\b/i.test(h.trim())
    );

    if (allHeadings.length === 0) return DETECTION_STATE.NOT_FOUND;
    const ratio = questionHeadings.length / allHeadings.length;
    if (ratio >= 0.3) return DETECTION_STATE.COMPLETE;
    if (ratio > 0) return DETECTION_STATE.PARTIAL;
    return DETECTION_STATE.NOT_FOUND;
  },

  /**
   * 7. Social Meta Tags (OG / Twitter)
   */
  'technical_setup.social_meta_tags': (evidence) => {
    const ev = getEvidence(evidence);
    const hasOgTitle = !!ev.metadata?.ogTitle;
    const hasOgDesc = !!ev.metadata?.ogDescription;
    const hasOgImage = !!ev.metadata?.ogImage;
    const hasTwitterCard = !!ev.metadata?.twitterCard;

    const score = [hasOgTitle, hasOgDesc, hasOgImage, hasTwitterCard].filter(Boolean).length;
    if (score === 4) return DETECTION_STATE.COMPLETE;
    if (score >= 2) return DETECTION_STATE.PARTIAL;
    return DETECTION_STATE.NOT_FOUND;
  },

  /**
   * 8. Evidence & Proof Points
   */
  'ai_search_readiness.evidence_proof_points': (evidence) => {
    const ev = getEvidence(evidence);
    const bodyText = ev.content?.bodyText || '';
    const paragraphs = ev.content?.paragraphs || [];

    // Look for statistical claims, numbers, case studies
    const allText = typeof bodyText === 'string' ? bodyText : paragraphs.join(' ');
    const hasStats = /\d+%|\d+x|\$\d+|ROI|case stud(y|ies)/i.test(allText);
    const hasTestimonials = /testimonial|customer|client.*said|review/i.test(allText);

    if (hasStats && hasTestimonials) return DETECTION_STATE.COMPLETE;
    if (hasStats || hasTestimonials) return DETECTION_STATE.PARTIAL;
    return DETECTION_STATE.NOT_FOUND;
  },

  /**
   * 9. Author Bios
   */
  'trust_authority.author_bios': (evidence) => {
    const ev = getEvidence(evidence);
    const author = authorInfo(ev);
    const hasAboutPage = !!(ev.navigation?.keyPages?.about);
    const hasPeople = Array.isArray(ev.entities?.entities?.people) && ev.entities.entities.people.length > 0;

    if (author.hasAuthor && hasPeople) return DETECTION_STATE.COMPLETE;
    if (author.hasAuthor || hasAboutPage || hasPeople) return DETECTION_STATE.PARTIAL;
    return DETECTION_STATE.NOT_FOUND;
  },

  /**
   * 10. Alt Text Coverage
   */
  'ai_readability.alt_text_coverage': (evidence) => {
    const ev = getEvidence(evidence);
    const stats = imageAltStats(ev);

    if (stats.total === 0) return DETECTION_STATE.COMPLETE; // No images = no issue
    const coverage = stats.withAlt / stats.total;
    if (coverage >= 0.9) return DETECTION_STATE.COMPLETE;
    if (coverage >= 0.5) return DETECTION_STATE.PARTIAL;
    if (coverage > 0) return DETECTION_STATE.WEAK;
    return DETECTION_STATE.NOT_FOUND;
  }
};

// ========================================
// PUBLIC API
// ========================================

/**
 * Get detection state for a subfactor.
 *
 * @param {string} subfactorKey - Canonical subfactor key
 * @param {Object} evidence - Scan evidence / detailed_analysis
 * @returns {string} - Detection state (from DETECTION_STATE enum)
 */
function getDetectionState(subfactorKey, evidence) {
  const fn = DETECTION_FUNCTIONS[subfactorKey];
  if (!fn) return DETECTION_STATE.NOT_FOUND; // Default for non-top10
  try {
    return fn(evidence);
  } catch (err) {
    console.warn(`[DetectionStates] Error detecting state for ${subfactorKey}:`, err.message);
    return DETECTION_STATE.NOT_FOUND;
  }
}

/**
 * Check if a subfactor has a detection function (is Top 10).
 * @param {string} subfactorKey
 * @returns {boolean}
 */
function hasDetectionFunction(subfactorKey) {
  return subfactorKey in DETECTION_FUNCTIONS;
}

/**
 * Check if state means "suppress recommendation" (issue resolved).
 * @param {string} state
 * @returns {boolean}
 */
function shouldSuppressRecommendation(state) {
  return state === DETECTION_STATE.COMPLETE;
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  DETECTION_STATE,
  DETECTION_FUNCTIONS,
  getDetectionState,
  hasDetectionFunction,
  shouldSuppressRecommendation
};
