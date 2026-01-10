/**
 * RECOMMENDATION TARGETING
 * File: backend/recommendations/targeting.js
 *
 * Determines whether recommendations apply at site level, page level, or both.
 *
 * Phase 4A.1.5: Site vs Page Targeting Verification
 */

// ========================================
// TARGET LEVEL CONSTANTS
// ========================================

const TARGET_LEVEL = {
  SITE: 'site',
  PAGE: 'page',
  BOTH: 'both'
};

// ========================================
// SUBFACTOR TARGETING RULES
// ========================================

/**
 * Mapping of subfactor patterns to target levels.
 *
 * Rules based on rulebook:
 * - SITE: robots, sitemap, llms.txt, knowledge panel, NAP, citations, org schema
 * - PAGE: titles, meta, OG, snippets, headings, alt text, page schema
 * - BOTH: internal linking, topic clusters, schema coverage, FAQs
 */
const TARGETING_RULES = {
  // Site-level recommendations (apply once per domain)
  site: [
    // Technical Setup - site-wide configurations
    'technical_setup.sitemap_indexing',
    'technical_setup.crawler_access',
    'technical_setup.organization_schema',

    // Trust & Authority - site-wide signals
    'trust_authority.third_party_profiles',
    'trust_authority.thought_leadership',
    'trust_authority.professional_certifications',

    // AI Search Readiness - topical authority
    'ai_search_readiness.pillar_pages',

    // Content Freshness - site-wide patterns
    'content_freshness.update_cadence',

    // Voice Optimization - local presence
    'voice_optimization.local_intent'
  ],

  // Page-level recommendations (apply per page)
  page: [
    // Technical Setup - page-specific markup
    'technical_setup.social_meta_tags',
    'technical_setup.canonical_hreflang',

    // AI Readability - page content
    'ai_readability.alt_text_coverage',
    'ai_readability.media_accessibility',

    // Content Structure - page structure
    'content_structure.semantic_heading_structure',
    'content_structure.entity_cues',

    // AI Search Readiness - page content
    'ai_search_readiness.query_intent_alignment',
    'ai_search_readiness.evidence_proof_points',
    'ai_search_readiness.scannability',

    // Voice Optimization - conversational content
    'voice_optimization.conversational_content',

    // Content Freshness - page dates
    'content_freshness.last_updated',

    // Speed & UX - page performance
    'speed_ux.performance',

    // Trust & Authority - page attribution
    'trust_authority.author_bios'
  ],

  // Both site and page level (can be fixed site-wide or per page)
  both: [
    // Technical Setup - coverage metrics
    'technical_setup.structured_data_coverage',

    // AI Search Readiness - FAQ strategy
    'ai_search_readiness.icp_faqs',

    // Content Structure - navigation
    'content_structure.navigation_clarity'
  ]
};

// Build reverse lookup for fast access
const SUBFACTOR_TO_TARGET = {};
for (const [level, subfactors] of Object.entries(TARGETING_RULES)) {
  for (const subfactor of subfactors) {
    SUBFACTOR_TO_TARGET[subfactor] = level;
  }
}

// ========================================
// CATEGORY-BASED FALLBACK RULES
// ========================================

/**
 * Default target levels by category/pillar when subfactor not explicitly mapped.
 */
const CATEGORY_DEFAULTS = {
  // Site-level focused
  'technical_setup': TARGET_LEVEL.SITE,
  'trust_authority': TARGET_LEVEL.SITE,

  // Page-level focused
  'ai_readability': TARGET_LEVEL.PAGE,
  'content_structure': TARGET_LEVEL.PAGE,
  'voice_optimization': TARGET_LEVEL.PAGE,
  'content_freshness': TARGET_LEVEL.PAGE,
  'speed_ux': TARGET_LEVEL.PAGE,

  // Mixed
  'ai_search_readiness': TARGET_LEVEL.BOTH
};

// ========================================
// TARGETING FUNCTIONS
// ========================================

/**
 * Determine target level for a subfactor key.
 *
 * @param {string} subfactorKey - Canonical subfactor key (e.g., 'technical_setup.organization_schema')
 * @returns {string} - One of 'site', 'page', or 'both'
 */
function getTargetLevel(subfactorKey) {
  if (!subfactorKey || typeof subfactorKey !== 'string') {
    return TARGET_LEVEL.PAGE; // Default to page for safety
  }

  // Normalize key
  const normalized = subfactorKey.toLowerCase().trim();

  // Check explicit mapping first
  if (SUBFACTOR_TO_TARGET[normalized]) {
    return SUBFACTOR_TO_TARGET[normalized];
  }

  // Try without potential suffix variations
  for (const [key, level] of Object.entries(SUBFACTOR_TO_TARGET)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return level;
    }
  }

  // Fall back to category default
  const category = normalized.split('.')[0];
  if (CATEGORY_DEFAULTS[category]) {
    return CATEGORY_DEFAULTS[category];
  }

  // Ultimate fallback
  return TARGET_LEVEL.PAGE;
}

/**
 * Get human-readable description for target level.
 *
 * @param {string} targetLevel - One of 'site', 'page', or 'both'
 * @returns {string} - Human-readable description
 */
function getTargetLevelDescription(targetLevel) {
  switch (targetLevel) {
    case TARGET_LEVEL.SITE:
      return 'This recommendation applies site-wide and should be implemented once at the domain level.';
    case TARGET_LEVEL.PAGE:
      return 'This recommendation applies per page and should be implemented on individual pages.';
    case TARGET_LEVEL.BOTH:
      return 'This recommendation can be implemented site-wide or on individual pages.';
    default:
      return '';
  }
}

/**
 * Get implementation scope guidance.
 *
 * @param {string} targetLevel - One of 'site', 'page', or 'both'
 * @returns {{ scope: string, priority: string, examples: string[] }}
 */
function getImplementationScope(targetLevel) {
  switch (targetLevel) {
    case TARGET_LEVEL.SITE:
      return {
        scope: 'Site-wide implementation',
        priority: 'Implement once, affects all pages',
        examples: [
          'Add to global layout/template',
          'Configure at domain/CMS level',
          'Update site-wide configuration files'
        ]
      };
    case TARGET_LEVEL.PAGE:
      return {
        scope: 'Per-page implementation',
        priority: 'Prioritize high-traffic pages first',
        examples: [
          'Update individual page content',
          'Add page-specific markup',
          'Modify page templates'
        ]
      };
    case TARGET_LEVEL.BOTH:
      return {
        scope: 'Flexible implementation',
        priority: 'Can be site-wide template or per-page',
        examples: [
          'Create site-wide default, customize per page',
          'Implement in template with page overrides',
          'Batch update or individual page edits'
        ]
      };
    default:
      return {
        scope: 'Unknown',
        priority: '',
        examples: []
      };
  }
}

/**
 * Check if a subfactor targets site level.
 *
 * @param {string} subfactorKey - Subfactor key
 * @returns {boolean}
 */
function isSiteLevel(subfactorKey) {
  const level = getTargetLevel(subfactorKey);
  return level === TARGET_LEVEL.SITE || level === TARGET_LEVEL.BOTH;
}

/**
 * Check if a subfactor targets page level.
 *
 * @param {string} subfactorKey - Subfactor key
 * @returns {boolean}
 */
function isPageLevel(subfactorKey) {
  const level = getTargetLevel(subfactorKey);
  return level === TARGET_LEVEL.PAGE || level === TARGET_LEVEL.BOTH;
}

/**
 * Get all subfactors for a specific target level.
 *
 * @param {string} targetLevel - One of 'site', 'page', or 'both'
 * @returns {string[]}
 */
function getSubfactorsByTargetLevel(targetLevel) {
  return TARGETING_RULES[targetLevel] || [];
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  // Constants
  TARGET_LEVEL,
  TARGETING_RULES,
  CATEGORY_DEFAULTS,

  // Main functions
  getTargetLevel,
  getTargetLevelDescription,
  getImplementationScope,

  // Utilities
  isSiteLevel,
  isPageLevel,
  getSubfactorsByTargetLevel
};
