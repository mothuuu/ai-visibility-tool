// backend/analyzers/anti-pattern-detector.js
/**
 * ANTI-PATTERN DETECTOR
 *
 * Per rulebook "Negative & Anti-Patterns Detection":
 * Detects bad signals that hurt AI visibility, including:
 * - Empty/invalid schema markup
 * - Missing critical elements (H1, meta description)
 * - Thin content
 * - Poor heading hierarchy
 * - Accessibility issues
 * - Navigation problems
 * - Conflicting data
 */

const { ANTI_PATTERNS, createAntiPatternResult } = require('../config/diagnostic-types');
const VOCABULARY = require('../config/detection-vocabulary');

/**
 * Anti-Pattern Detection Categories
 */
const DETECTION_CATEGORIES = {
  SCHEMA: 'schema',
  CONTENT: 'content',
  STRUCTURE: 'structure',
  NAVIGATION: 'navigation',
  ACCESSIBILITY: 'accessibility',
  META: 'meta',
  PERFORMANCE: 'performance'
};

/**
 * Severity levels for anti-patterns
 */
const SEVERITY = {
  CRITICAL: 'critical',  // Severely impacts AI visibility
  ERROR: 'error',        // Significant negative impact
  WARNING: 'warning',    // Moderate impact, should fix
  INFO: 'info'           // Minor issue, nice to fix
};

/**
 * Extended anti-patterns with detection functions
 */
const EXTENDED_ANTI_PATTERNS = {
  // ==========================================
  // SCHEMA ANTI-PATTERNS
  // ==========================================
  EMPTY_ORGANIZATION_SCHEMA: {
    id: 'empty-organization-schema',
    name: 'Empty Organization Schema',
    description: 'Organization schema exists but lacks name, description, or contact info',
    category: DETECTION_CATEGORIES.SCHEMA,
    severity: SEVERITY.ERROR,
    impact: 'AI systems cannot extract business identity',
    recommendation: 'Add name, description, url, and contactPoint to Organization schema',
    detect: (evidence) => {
      const orgSchema = (evidence.technical?.structuredData || [])
        .find(s => s.type === 'Organization' || s.type === 'Corporation');
      if (!orgSchema) return null;

      const raw = orgSchema.raw || {};
      const missingFields = [];
      if (!raw.name) missingFields.push('name');
      if (!raw.description) missingFields.push('description');
      if (!raw.url) missingFields.push('url');
      if (!raw.contactPoint && !raw.telephone && !raw.email) missingFields.push('contactPoint');

      if (missingFields.length >= 2) {
        return { detected: true, details: { missingFields, schemaType: orgSchema.type } };
      }
      return null;
    }
  },

  INVALID_SCHEMA_SYNTAX: {
    id: 'invalid-schema-syntax',
    name: 'Invalid Schema Syntax',
    description: 'JSON-LD schema has syntax errors or invalid structure',
    category: DETECTION_CATEGORIES.SCHEMA,
    severity: SEVERITY.ERROR,
    impact: 'Schema markup is ignored by AI systems',
    recommendation: 'Validate schema at schema.org or using Google Rich Results Test',
    detect: (evidence) => {
      // Check for schema parsing errors (would be captured during extraction)
      const schemas = evidence.technical?.structuredData || [];
      const invalidSchemas = schemas.filter(s => s.parseError || !s.type);

      if (invalidSchemas.length > 0) {
        return { detected: true, details: { count: invalidSchemas.length, errors: invalidSchemas.map(s => s.parseError) } };
      }
      return null;
    }
  },

  MISSING_SCHEMA_CONTEXT: {
    id: 'missing-schema-context',
    name: 'Missing Schema Context',
    description: 'JSON-LD schema is missing @context declaration',
    category: DETECTION_CATEGORIES.SCHEMA,
    severity: SEVERITY.WARNING,
    impact: 'Schema may not be properly interpreted',
    recommendation: 'Add "@context": "https://schema.org" to all JSON-LD blocks',
    detect: (evidence) => {
      const schemas = evidence.technical?.structuredData || [];
      const missingContext = schemas.filter(s => !s.context || !s.context.includes('schema.org'));

      if (missingContext.length > 0) {
        return { detected: true, details: { count: missingContext.length, types: missingContext.map(s => s.type) } };
      }
      return null;
    }
  },

  DUPLICATE_SCHEMA_TYPES: {
    id: 'duplicate-schema-types',
    name: 'Duplicate Schema Types',
    description: 'Multiple schemas of the same type with conflicting data',
    category: DETECTION_CATEGORIES.SCHEMA,
    severity: SEVERITY.WARNING,
    impact: 'AI systems may use inconsistent data',
    recommendation: 'Consolidate duplicate schemas or ensure data consistency',
    detect: (evidence) => {
      const schemas = evidence.technical?.structuredData || [];
      const typeCounts = {};
      schemas.forEach(s => {
        typeCounts[s.type] = (typeCounts[s.type] || 0) + 1;
      });

      const duplicates = Object.entries(typeCounts).filter(([type, count]) => count > 1);
      if (duplicates.length > 0) {
        return { detected: true, details: { duplicates: Object.fromEntries(duplicates) } };
      }
      return null;
    }
  },

  // ==========================================
  // CONTENT ANTI-PATTERNS
  // ==========================================
  MISSING_H1: {
    id: 'missing-h1',
    name: 'Missing H1 Tag',
    description: 'Page has no H1 heading',
    category: DETECTION_CATEGORIES.CONTENT,
    severity: SEVERITY.ERROR,
    impact: 'AI cannot determine page topic',
    recommendation: 'Add a single, descriptive H1 heading that summarizes the page content',
    detect: (evidence) => {
      const h1Count = evidence.content?.headings?.h1?.length || 0;
      if (h1Count === 0) {
        return { detected: true, details: { h1Count: 0 } };
      }
      return null;
    }
  },

  MULTIPLE_H1: {
    id: 'multiple-h1',
    name: 'Multiple H1 Tags',
    description: 'Page has more than one H1 heading',
    category: DETECTION_CATEGORIES.CONTENT,
    severity: SEVERITY.WARNING,
    impact: 'Dilutes topic focus for AI systems',
    recommendation: 'Use a single H1 and demote others to H2',
    detect: (evidence) => {
      const h1s = evidence.content?.headings?.h1 || [];
      if (h1s.length > 1) {
        return { detected: true, details: { h1Count: h1s.length, h1Texts: h1s.slice(0, 3) } };
      }
      return null;
    }
  },

  SKIPPED_HEADING_LEVELS: {
    id: 'skipped-heading-levels',
    name: 'Skipped Heading Levels',
    description: 'Heading hierarchy skips levels (e.g., H2 directly to H4)',
    category: DETECTION_CATEGORIES.CONTENT,
    severity: SEVERITY.WARNING,
    impact: 'Confuses content structure for AI parsing',
    recommendation: 'Ensure headings follow H1 > H2 > H3 hierarchy without skipping',
    detect: (evidence) => {
      const headings = evidence.content?.headings || {};
      const skipped = [];

      const levels = [1, 2, 3, 4, 5, 6];
      let lastLevel = 0;

      for (const level of levels) {
        const count = headings[`h${level}`]?.length || 0;
        if (count > 0) {
          if (lastLevel > 0 && level > lastLevel + 1) {
            skipped.push({ from: `H${lastLevel}`, to: `H${level}`, missing: `H${lastLevel + 1}` });
          }
          lastLevel = level;
        }
      }

      if (skipped.length > 0) {
        return { detected: true, details: { skippedLevels: skipped } };
      }
      return null;
    }
  },

  THIN_CONTENT: {
    id: 'thin-content',
    name: 'Thin Content',
    description: 'Page has less than 300 words of content',
    category: DETECTION_CATEGORIES.CONTENT,
    severity: SEVERITY.WARNING,
    impact: 'Insufficient content for AI to extract meaningful information',
    recommendation: 'Expand content to at least 500 words with substantive information',
    detect: (evidence) => {
      const wordCount = evidence.content?.wordCount || 0;
      if (wordCount < 300) {
        return { detected: true, details: { wordCount, threshold: 300 } };
      }
      return null;
    }
  },

  NO_PARAGRAPHS: {
    id: 'no-paragraphs',
    name: 'No Paragraph Content',
    description: 'Page lacks proper paragraph elements',
    category: DETECTION_CATEGORIES.CONTENT,
    severity: SEVERITY.ERROR,
    impact: 'AI cannot extract structured text content',
    recommendation: 'Structure content using proper <p> tags',
    detect: (evidence) => {
      const paragraphs = evidence.content?.paragraphs || [];
      if (paragraphs.length === 0) {
        return { detected: true, details: { paragraphCount: 0 } };
      }
      return null;
    }
  },

  BOILERPLATE_HEAVY: {
    id: 'boilerplate-heavy',
    name: 'Boilerplate-Heavy Content',
    description: 'Page content is mostly navigation, footer, or repeated template text',
    category: DETECTION_CATEGORIES.CONTENT,
    severity: SEVERITY.WARNING,
    impact: 'Low signal-to-noise ratio for AI extraction',
    recommendation: 'Add unique, substantive content in the main content area',
    detect: (evidence) => {
      const wordCount = evidence.content?.wordCount || 0;
      const paragraphs = evidence.content?.paragraphs || [];
      const paragraphWordCount = paragraphs.join(' ').split(/\s+/).length;

      // If paragraph content is less than 30% of total word count, likely boilerplate heavy
      if (wordCount > 100 && paragraphWordCount / wordCount < 0.3) {
        return { detected: true, details: { totalWords: wordCount, paragraphWords: paragraphWordCount, ratio: (paragraphWordCount / wordCount).toFixed(2) } };
      }
      return null;
    }
  },

  // ==========================================
  // META ANTI-PATTERNS
  // ==========================================
  MISSING_META_DESCRIPTION: {
    id: 'missing-meta-description',
    name: 'Missing Meta Description',
    description: 'Page has no meta description',
    category: DETECTION_CATEGORIES.META,
    severity: SEVERITY.ERROR,
    impact: 'AI systems lack page summary',
    recommendation: 'Add a 150-160 character meta description summarizing the page',
    detect: (evidence) => {
      const description = evidence.metadata?.description;
      if (!description || description.trim().length === 0) {
        return { detected: true, details: { hasDescription: false } };
      }
      return null;
    }
  },

  META_DESCRIPTION_TOO_SHORT: {
    id: 'meta-description-too-short',
    name: 'Meta Description Too Short',
    description: 'Meta description is under 50 characters',
    category: DETECTION_CATEGORIES.META,
    severity: SEVERITY.WARNING,
    impact: 'Insufficient context for AI systems',
    recommendation: 'Expand meta description to 120-160 characters',
    detect: (evidence) => {
      const description = evidence.metadata?.description || '';
      if (description.length > 0 && description.length < 50) {
        return { detected: true, details: { length: description.length, minimum: 50 } };
      }
      return null;
    }
  },

  META_DESCRIPTION_TOO_LONG: {
    id: 'meta-description-too-long',
    name: 'Meta Description Too Long',
    description: 'Meta description exceeds 160 characters',
    category: DETECTION_CATEGORIES.META,
    severity: SEVERITY.INFO,
    impact: 'May be truncated in AI summaries',
    recommendation: 'Trim meta description to 160 characters',
    detect: (evidence) => {
      const description = evidence.metadata?.description || '';
      if (description.length > 160) {
        return { detected: true, details: { length: description.length, maximum: 160 } };
      }
      return null;
    }
  },

  TITLE_TOO_SHORT: {
    id: 'title-too-short',
    name: 'Title Too Short',
    description: 'Page title is under 30 characters',
    category: DETECTION_CATEGORIES.META,
    severity: SEVERITY.WARNING,
    impact: 'Insufficient context for page identification',
    recommendation: 'Expand title to 50-60 characters',
    detect: (evidence) => {
      const title = evidence.metadata?.title || '';
      if (title.length > 0 && title.length < 30) {
        return { detected: true, details: { length: title.length, minimum: 30 } };
      }
      return null;
    }
  },

  TITLE_TOO_LONG: {
    id: 'title-too-long',
    name: 'Title Too Long',
    description: 'Page title exceeds 60 characters',
    category: DETECTION_CATEGORIES.META,
    severity: SEVERITY.INFO,
    impact: 'May be truncated in AI references',
    recommendation: 'Trim title to 60 characters',
    detect: (evidence) => {
      const title = evidence.metadata?.title || '';
      if (title.length > 60) {
        return { detected: true, details: { length: title.length, maximum: 60 } };
      }
      return null;
    }
  },

  MISSING_OPEN_GRAPH: {
    id: 'missing-open-graph',
    name: 'Missing Open Graph Tags',
    description: 'Page lacks Open Graph metadata',
    category: DETECTION_CATEGORIES.META,
    severity: SEVERITY.WARNING,
    impact: 'AI systems miss rich preview data',
    recommendation: 'Add og:title, og:description, and og:image tags',
    detect: (evidence) => {
      const meta = evidence.metadata || {};
      if (!meta.ogTitle && !meta.ogDescription && !meta.ogImage) {
        return { detected: true, details: { hasOgTitle: false, hasOgDescription: false, hasOgImage: false } };
      }
      return null;
    }
  },

  // ==========================================
  // NAVIGATION ANTI-PATTERNS
  // ==========================================
  NO_SEMANTIC_NAV: {
    id: 'no-semantic-nav',
    name: 'No Semantic Navigation',
    description: 'Navigation uses div elements instead of <nav>',
    category: DETECTION_CATEGORIES.NAVIGATION,
    severity: SEVERITY.WARNING,
    impact: 'AI systems cannot identify navigation structure',
    recommendation: 'Wrap navigation in <nav> element with aria-label',
    detect: (evidence) => {
      const hasSemanticNav = evidence.structure?.hasNav || evidence.navigation?.hasSemanticNav;
      const hasLinks = (evidence.navigation?.links?.length || 0) > 0;

      if (!hasSemanticNav && hasLinks) {
        return { detected: true, details: { hasSemanticNav: false, linkCount: evidence.navigation?.links?.length || 0 } };
      }
      return null;
    }
  },

  MISSING_KEY_PAGES: {
    id: 'missing-key-pages',
    name: 'Missing Key Pages in Navigation',
    description: 'Navigation lacks links to essential pages (About, Contact)',
    category: DETECTION_CATEGORIES.NAVIGATION,
    severity: SEVERITY.INFO,
    impact: 'AI systems may miss important site sections',
    recommendation: 'Add About and Contact links to main navigation',
    detect: (evidence) => {
      const keyPages = evidence.navigation?.keyPages || {};
      const missingKey = [];

      if (!keyPages.about) missingKey.push('about');
      if (!keyPages.contact) missingKey.push('contact');

      if (missingKey.length > 0) {
        return { detected: true, details: { missingKeyPages: missingKey, keyPages } };
      }
      return null;
    }
  },

  // ==========================================
  // ACCESSIBILITY ANTI-PATTERNS
  // ==========================================
  LOW_ALT_TEXT_COVERAGE: {
    id: 'low-alt-text-coverage',
    name: 'Low Alt Text Coverage',
    description: 'Less than 80% of images have alt text',
    category: DETECTION_CATEGORIES.ACCESSIBILITY,
    severity: SEVERITY.WARNING,
    impact: 'AI systems cannot understand image content',
    recommendation: 'Add descriptive alt text to all content images',
    detect: (evidence) => {
      const media = evidence.media || {};
      const total = media.imageCount || 0;
      const withAlt = media.imagesWithAlt || 0;

      if (total > 0) {
        const coverage = (withAlt / total) * 100;
        if (coverage < 80) {
          return { detected: true, details: { coverage: Math.round(coverage), total, withAlt, withoutAlt: total - withAlt } };
        }
      }
      return null;
    }
  },

  NO_LANG_ATTRIBUTE: {
    id: 'no-lang-attribute',
    name: 'Missing Language Attribute',
    description: 'HTML element lacks lang attribute',
    category: DETECTION_CATEGORIES.ACCESSIBILITY,
    severity: SEVERITY.WARNING,
    impact: 'AI systems cannot determine content language',
    recommendation: 'Add lang attribute to <html> element (e.g., lang="en")',
    detect: (evidence) => {
      const lang = evidence.metadata?.language;
      if (!lang || lang.trim().length === 0) {
        return { detected: true, details: { hasLang: false } };
      }
      return null;
    }
  },

  // ==========================================
  // STRUCTURE ANTI-PATTERNS
  // ==========================================
  NO_MAIN_ELEMENT: {
    id: 'no-main-element',
    name: 'Missing Main Element',
    description: 'Page lacks <main> landmark element',
    category: DETECTION_CATEGORIES.STRUCTURE,
    severity: SEVERITY.WARNING,
    impact: 'AI cannot identify primary content area',
    recommendation: 'Wrap primary content in <main> element',
    detect: (evidence) => {
      if (!evidence.structure?.hasMain) {
        return { detected: true, details: { hasMain: false } };
      }
      return null;
    }
  },

  NO_SEMANTIC_STRUCTURE: {
    id: 'no-semantic-structure',
    name: 'No Semantic Structure',
    description: 'Page lacks semantic HTML5 elements (main, article, section)',
    category: DETECTION_CATEGORIES.STRUCTURE,
    severity: SEVERITY.WARNING,
    impact: 'AI cannot parse content hierarchy',
    recommendation: 'Use semantic HTML5 elements to structure content',
    detect: (evidence) => {
      const structure = evidence.structure || {};
      if (!structure.hasMain && !structure.hasArticle && !structure.hasSection) {
        return { detected: true, details: { hasMain: false, hasArticle: false, hasSection: false } };
      }
      return null;
    }
  }
};

/**
 * Main anti-pattern detection function
 * @param {Object} evidence - Scan evidence from ContentExtractor
 * @returns {Object} - Detection results with categorized anti-patterns
 */
function detectAntiPatterns(evidence) {
  const results = {
    detected: [],
    byCategory: {},
    bySeverity: {
      [SEVERITY.CRITICAL]: [],
      [SEVERITY.ERROR]: [],
      [SEVERITY.WARNING]: [],
      [SEVERITY.INFO]: []
    },
    summary: {
      total: 0,
      critical: 0,
      errors: 0,
      warnings: 0,
      info: 0
    }
  };

  // Initialize category buckets
  Object.values(DETECTION_CATEGORIES).forEach(cat => {
    results.byCategory[cat] = [];
  });

  // Run all detection functions
  for (const [key, pattern] of Object.entries(EXTENDED_ANTI_PATTERNS)) {
    try {
      const detection = pattern.detect(evidence);

      if (detection && detection.detected) {
        const result = {
          id: pattern.id,
          name: pattern.name,
          description: pattern.description,
          category: pattern.category,
          severity: pattern.severity,
          impact: pattern.impact,
          recommendation: pattern.recommendation,
          details: detection.details,
          detectedAt: new Date().toISOString()
        };

        results.detected.push(result);
        results.byCategory[pattern.category].push(result);
        results.bySeverity[pattern.severity].push(result);

        // Update summary counts
        results.summary.total++;
        if (pattern.severity === SEVERITY.CRITICAL) results.summary.critical++;
        else if (pattern.severity === SEVERITY.ERROR) results.summary.errors++;
        else if (pattern.severity === SEVERITY.WARNING) results.summary.warnings++;
        else if (pattern.severity === SEVERITY.INFO) results.summary.info++;
      }
    } catch (err) {
      console.error(`[AntiPatternDetector] Error detecting ${key}:`, err.message);
    }
  }

  console.log(`[AntiPatternDetector] Detected ${results.summary.total} anti-patterns:`,
    `${results.summary.critical} critical,`,
    `${results.summary.errors} errors,`,
    `${results.summary.warnings} warnings,`,
    `${results.summary.info} info`
  );

  return results;
}

/**
 * Get prioritized recommendations based on detected anti-patterns
 * @param {Object} antiPatternResults - Results from detectAntiPatterns
 * @returns {Array} - Prioritized list of recommendations
 */
function getPrioritizedRecommendations(antiPatternResults) {
  const recommendations = [];

  // Priority order: critical > error > warning > info
  const priorityOrder = [SEVERITY.CRITICAL, SEVERITY.ERROR, SEVERITY.WARNING, SEVERITY.INFO];

  for (const severity of priorityOrder) {
    const patterns = antiPatternResults.bySeverity[severity] || [];
    for (const pattern of patterns) {
      recommendations.push({
        priority: priorityOrder.indexOf(severity) + 1,
        severity: pattern.severity,
        issue: pattern.name,
        impact: pattern.impact,
        recommendation: pattern.recommendation,
        category: pattern.category,
        details: pattern.details
      });
    }
  }

  return recommendations;
}

/**
 * Calculate anti-pattern score impact
 * @param {Object} antiPatternResults - Results from detectAntiPatterns
 * @returns {Object} - Score impact breakdown
 */
function calculateScoreImpact(antiPatternResults) {
  const impacts = {
    critical: -20,  // Critical issues severely impact score
    error: -10,     // Errors have significant impact
    warning: -5,    // Warnings have moderate impact
    info: -1        // Info has minimal impact
  };

  const totalImpact =
    (antiPatternResults.summary.critical * impacts.critical) +
    (antiPatternResults.summary.errors * impacts.error) +
    (antiPatternResults.summary.warnings * impacts.warning) +
    (antiPatternResults.summary.info * impacts.info);

  return {
    totalImpact: Math.max(totalImpact, -50), // Cap at -50
    breakdown: {
      critical: antiPatternResults.summary.critical * impacts.critical,
      errors: antiPatternResults.summary.errors * impacts.error,
      warnings: antiPatternResults.summary.warnings * impacts.warning,
      info: antiPatternResults.summary.info * impacts.info
    },
    counts: antiPatternResults.summary
  };
}

module.exports = {
  detectAntiPatterns,
  getPrioritizedRecommendations,
  calculateScoreImpact,
  DETECTION_CATEGORIES,
  SEVERITY,
  EXTENDED_ANTI_PATTERNS
};
