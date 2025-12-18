/**
 * Diagnostic Types and Evidence Schemas
 *
 * Per rulebook "Data Storage Schema" and "Diagnostic Output Contract":
 * Defines the standardized evidence structures for all detection logic.
 *
 * Every subfactor detection MUST return evidence in this format to enable:
 * - Consistent scoring across all analyzers
 * - Human-readable diagnostic output
 * - Decision trail auditing
 * - Anti-pattern detection
 */

// ============================================
// CONFIDENCE LEVELS
// ============================================

const CONFIDENCE_LEVELS = {
  HIGH: 'high',      // Schema markup, explicit declarations, verified data
  MEDIUM: 'medium',  // Pattern matching, inferred from context
  LOW: 'low'         // Heuristics, fallbacks, guesses
};

// ============================================
// EVIDENCE SOURCE TYPES
// ============================================

const EVIDENCE_SOURCES = {
  // Schema/Structured Data Sources
  JSON_LD: 'json-ld',
  MICRODATA: 'microdata',
  RDFA: 'rdfa',

  // HTML Sources
  META_TAG: 'meta-tag',
  SEMANTIC_HTML: 'semantic-html',
  CSS_CLASS: 'css-class',
  ARIA_ATTRIBUTE: 'aria-attribute',

  // Content Sources
  HEADING_TEXT: 'heading-text',
  BODY_TEXT: 'body-text',
  NAVIGATION_LINK: 'navigation-link',
  FOOTER_LINK: 'footer-link',

  // External Sources
  SITEMAP: 'sitemap',
  ROBOTS_TXT: 'robots-txt',
  CRAWLER: 'crawler',

  // Inference
  URL_PATTERN: 'url-pattern',
  HEURISTIC: 'heuristic',
  FALLBACK: 'fallback'
};

// ============================================
// BASE EVIDENCE SCHEMA
// ============================================

/**
 * Create a standardized evidence object
 * @param {Object} options - Evidence options
 * @returns {Object} - Standardized evidence object
 */
function createEvidence(options = {}) {
  return {
    detected: options.detected || false,
    source: options.source || EVIDENCE_SOURCES.HEURISTIC,
    confidence: options.confidence || CONFIDENCE_LEVELS.LOW,
    data: options.data || null,
    selector: options.selector || null,
    rawValue: options.rawValue || null,
    extractedAt: new Date().toISOString(),
    notes: options.notes || []
  };
}

// ============================================
// SUBFACTOR EVIDENCE SCHEMAS
// ============================================

const EVIDENCE_SCHEMAS = {
  // ----------------------------------------
  // IDENTITY & AUTHORITY
  // ----------------------------------------
  organizationSchema: {
    create: (data) => createEvidence({
      ...data,
      data: {
        name: data.name || null,
        description: data.description || null,
        url: data.url || null,
        logo: data.logo || null,
        sameAs: data.sameAs || [],
        contactPoint: data.contactPoint || null,
        address: data.address || null,
        founders: data.founders || [],
        foundingDate: data.foundingDate || null,
        numberOfEmployees: data.numberOfEmployees || null
      }
    })
  },

  brandIdentity: {
    create: (data) => createEvidence({
      ...data,
      data: {
        brandName: data.brandName || null,
        tagline: data.tagline || null,
        logo: data.logo || null,
        favicon: data.favicon || null,
        colors: data.colors || [],
        fonts: data.fonts || [],
        voiceTone: data.voiceTone || null
      }
    })
  },

  authorInfo: {
    create: (data) => createEvidence({
      ...data,
      data: {
        name: data.name || null,
        bio: data.bio || null,
        image: data.image || null,
        credentials: data.credentials || [],
        socialProfiles: data.socialProfiles || [],
        articleCount: data.articleCount || 0,
        expertise: data.expertise || []
      }
    })
  },

  // ----------------------------------------
  // CONTENT STRUCTURE
  // ----------------------------------------
  faqContent: {
    create: (data) => createEvidence({
      ...data,
      data: {
        faqs: data.faqs || [],
        faqCount: data.faqCount || 0,
        hasSchema: data.hasSchema || false,
        hasSectionHeading: data.hasSectionHeading || false,
        isAccordion: data.isAccordion || false,
        averageAnswerLength: data.averageAnswerLength || 0
      }
    })
  },

  blogPresence: {
    create: (data) => createEvidence({
      ...data,
      data: {
        hasBlogSection: data.hasBlogSection || false,
        blogUrl: data.blogUrl || null,
        postCount: data.postCount || 0,
        hasRssFeed: data.hasRssFeed || false,
        hasArticleSchema: data.hasArticleSchema || false,
        categories: data.categories || [],
        latestPostDate: data.latestPostDate || null
      }
    })
  },

  navigationStructure: {
    create: (data) => createEvidence({
      ...data,
      data: {
        hasSemanticNav: data.hasSemanticNav || false,
        hasAriaLabel: data.hasAriaLabel || false,
        navElementCount: data.navElementCount || 0,
        totalLinks: data.totalLinks || 0,
        keyPages: data.keyPages || {},
        keyPageCount: data.keyPageCount || 0,
        hasDropdowns: data.hasDropdowns || false,
        hasMobileMenu: data.hasMobileMenu || false,
        hasBreadcrumbs: data.hasBreadcrumbs || false
      }
    })
  },

  headingHierarchy: {
    create: (data) => createEvidence({
      ...data,
      data: {
        h1Count: data.h1Count || 0,
        h1Text: data.h1Text || [],
        hasProperHierarchy: data.hasProperHierarchy || false,
        skippedLevels: data.skippedLevels || [],
        headingCounts: data.headingCounts || {},
        questionHeadings: data.questionHeadings || []
      }
    })
  },

  // ----------------------------------------
  // TECHNICAL SEO
  // ----------------------------------------
  schemaMarkup: {
    create: (data) => createEvidence({
      ...data,
      data: {
        hasJsonLd: data.hasJsonLd || false,
        hasMicrodata: data.hasMicrodata || false,
        schemaTypes: data.schemaTypes || [],
        schemaCount: data.schemaCount || 0,
        isValid: data.isValid || false,
        errors: data.errors || [],
        warnings: data.warnings || []
      }
    })
  },

  metaData: {
    create: (data) => createEvidence({
      ...data,
      data: {
        title: data.title || null,
        titleLength: data.titleLength || 0,
        description: data.description || null,
        descriptionLength: data.descriptionLength || 0,
        hasOpenGraph: data.hasOpenGraph || false,
        hasTwitterCard: data.hasTwitterCard || false,
        hasCanonical: data.hasCanonical || false,
        canonicalUrl: data.canonicalUrl || null,
        robots: data.robots || null
      }
    })
  },

  semanticHtml: {
    create: (data) => createEvidence({
      ...data,
      data: {
        hasMain: data.hasMain || false,
        hasArticle: data.hasArticle || false,
        hasSection: data.hasSection || false,
        hasAside: data.hasAside || false,
        hasNav: data.hasNav || false,
        hasHeader: data.hasHeader || false,
        hasFooter: data.hasFooter || false,
        landmarkCount: data.landmarkCount || 0,
        ariaLandmarks: data.ariaLandmarks || []
      }
    })
  },

  // ----------------------------------------
  // ACCESSIBILITY
  // ----------------------------------------
  altText: {
    create: (data) => createEvidence({
      ...data,
      data: {
        totalImages: data.totalImages || 0,
        imagesWithAlt: data.imagesWithAlt || 0,
        imagesWithoutAlt: data.imagesWithoutAlt || 0,
        altCoverage: data.altCoverage || 0,
        decorativeImages: data.decorativeImages || 0,
        descriptiveAltCount: data.descriptiveAltCount || 0
      }
    })
  },

  // ----------------------------------------
  // CONTENT QUALITY
  // ----------------------------------------
  contentFreshness: {
    create: (data) => createEvidence({
      ...data,
      data: {
        lastModified: data.lastModified || null,
        publishedDate: data.publishedDate || null,
        hasDateSchema: data.hasDateSchema || false,
        containsCurrentYear: data.containsCurrentYear || false,
        dateReferences: data.dateReferences || [],
        estimatedAge: data.estimatedAge || null
      }
    })
  },

  contentDepth: {
    create: (data) => createEvidence({
      ...data,
      data: {
        wordCount: data.wordCount || 0,
        paragraphCount: data.paragraphCount || 0,
        averageSentenceLength: data.averageSentenceLength || 0,
        hasLists: data.hasLists || false,
        listCount: data.listCount || 0,
        hasTables: data.hasTables || false,
        tableCount: data.tableCount || 0,
        hasMedia: data.hasMedia || false,
        mediaCount: data.mediaCount || 0
      }
    })
  },

  // ----------------------------------------
  // LOCAL BUSINESS
  // ----------------------------------------
  localBusiness: {
    create: (data) => createEvidence({
      ...data,
      data: {
        hasLocalSchema: data.hasLocalSchema || false,
        businessName: data.businessName || null,
        address: data.address || null,
        phone: data.phone || null,
        email: data.email || null,
        hours: data.hours || null,
        hasMap: data.hasMap || false,
        coordinates: data.coordinates || null,
        serviceArea: data.serviceArea || null
      }
    })
  },

  // ----------------------------------------
  // SITE STRUCTURE
  // ----------------------------------------
  siteDiscovery: {
    create: (data) => createEvidence({
      ...data,
      data: {
        hasSitemap: data.hasSitemap || false,
        sitemapUrl: data.sitemapUrl || null,
        discoveredPages: data.discoveredPages || 0,
        discoveredSections: data.discoveredSections || {},
        hasRobotsTxt: data.hasRobotsTxt || false,
        allowsAiCrawlers: data.allowsAiCrawlers || null
      }
    })
  }
};

// ============================================
// DIAGNOSTIC DECISION TRAIL
// ============================================

/**
 * Create a decision trail entry for diagnostic output
 * @param {Object} options - Decision options
 * @returns {Object} - Decision trail entry
 */
function createDecision(options = {}) {
  return {
    subfactor: options.subfactor || 'unknown',
    checkName: options.checkName || 'unknown',
    result: options.result || false,
    score: options.score || 0,
    maxScore: options.maxScore || 0,
    evidence: options.evidence || [],
    reasoning: options.reasoning || '',
    sources: options.sources || [],
    timestamp: new Date().toISOString()
  };
}

// ============================================
// CONFLICT REPORT
// ============================================

/**
 * Create a conflict report when evidence sources disagree
 * @param {Object} options - Conflict options
 * @returns {Object} - Conflict report
 */
function createConflict(options = {}) {
  return {
    subfactor: options.subfactor || 'unknown',
    conflictType: options.conflictType || 'data-mismatch',
    sources: options.sources || [],
    values: options.values || [],
    resolution: options.resolution || null,
    confidence: options.confidence || CONFIDENCE_LEVELS.LOW,
    notes: options.notes || ''
  };
}

// ============================================
// ANTI-PATTERN DETECTION
// ============================================

const ANTI_PATTERNS = {
  // Schema anti-patterns
  EMPTY_SCHEMA: {
    id: 'empty-schema',
    name: 'Empty Schema Markup',
    description: 'Schema exists but contains no meaningful data',
    severity: 'warning'
  },
  INVALID_SCHEMA_TYPE: {
    id: 'invalid-schema-type',
    name: 'Invalid Schema Type',
    description: 'Schema @type is not a valid schema.org type',
    severity: 'error'
  },
  MISSING_REQUIRED_FIELDS: {
    id: 'missing-required-fields',
    name: 'Missing Required Fields',
    description: 'Schema is missing required properties',
    severity: 'warning'
  },

  // Content anti-patterns
  THIN_CONTENT: {
    id: 'thin-content',
    name: 'Thin Content',
    description: 'Page has less than 300 words of content',
    severity: 'warning'
  },
  DUPLICATE_H1: {
    id: 'duplicate-h1',
    name: 'Duplicate H1 Tags',
    description: 'Page has multiple H1 tags',
    severity: 'warning'
  },
  MISSING_H1: {
    id: 'missing-h1',
    name: 'Missing H1 Tag',
    description: 'Page has no H1 tag',
    severity: 'error'
  },
  SKIPPED_HEADING_LEVEL: {
    id: 'skipped-heading-level',
    name: 'Skipped Heading Level',
    description: 'Heading hierarchy skips levels (e.g., H2 to H4)',
    severity: 'warning'
  },

  // Navigation anti-patterns
  NO_SEMANTIC_NAV: {
    id: 'no-semantic-nav',
    name: 'No Semantic Navigation',
    description: 'Navigation uses div instead of nav element',
    severity: 'warning'
  },
  MISSING_ARIA_LABELS: {
    id: 'missing-aria-labels',
    name: 'Missing ARIA Labels',
    description: 'Navigation elements lack aria-label attributes',
    severity: 'info'
  },

  // Accessibility anti-patterns
  IMAGES_WITHOUT_ALT: {
    id: 'images-without-alt',
    name: 'Images Without Alt Text',
    description: 'One or more images are missing alt attributes',
    severity: 'warning'
  },
  LOW_ALT_COVERAGE: {
    id: 'low-alt-coverage',
    name: 'Low Alt Text Coverage',
    description: 'Less than 80% of images have alt text',
    severity: 'warning'
  },

  // Meta anti-patterns
  MISSING_META_DESCRIPTION: {
    id: 'missing-meta-description',
    name: 'Missing Meta Description',
    description: 'Page has no meta description',
    severity: 'warning'
  },
  TITLE_TOO_LONG: {
    id: 'title-too-long',
    name: 'Title Too Long',
    description: 'Title exceeds 60 characters',
    severity: 'info'
  },
  TITLE_TOO_SHORT: {
    id: 'title-too-short',
    name: 'Title Too Short',
    description: 'Title is less than 30 characters',
    severity: 'info'
  }
};

/**
 * Create an anti-pattern detection result
 * @param {string} patternId - Anti-pattern ID from ANTI_PATTERNS
 * @param {Object} details - Additional details
 * @returns {Object} - Anti-pattern detection result
 */
function createAntiPatternResult(patternId, details = {}) {
  const pattern = ANTI_PATTERNS[patternId] || {
    id: patternId,
    name: 'Unknown Pattern',
    description: 'Unknown anti-pattern detected',
    severity: 'info'
  };

  return {
    ...pattern,
    detected: true,
    details: details,
    recommendation: details.recommendation || null,
    affectedElements: details.affectedElements || [],
    timestamp: new Date().toISOString()
  };
}

// ============================================
// DIAGNOSTIC COLLECTOR
// ============================================

/**
 * Diagnostic Collector class for accumulating diagnostic data
 */
class DiagnosticCollector {
  constructor(scanId = null) {
    this.scanId = scanId || `scan-${Date.now()}`;
    this.decisions = [];
    this.conflicts = [];
    this.antiPatterns = [];
    this.evidence = {};
    this.startTime = new Date().toISOString();
    this.endTime = null;
  }

  /**
   * Add a decision to the trail
   */
  addDecision(decision) {
    this.decisions.push(createDecision(decision));
  }

  /**
   * Add a conflict report
   */
  addConflict(conflict) {
    this.conflicts.push(createConflict(conflict));
  }

  /**
   * Add an anti-pattern detection
   */
  addAntiPattern(patternId, details = {}) {
    this.antiPatterns.push(createAntiPatternResult(patternId, details));
  }

  /**
   * Store evidence for a subfactor
   */
  setEvidence(subfactor, evidence) {
    this.evidence[subfactor] = evidence;
  }

  /**
   * Get evidence for a subfactor
   */
  getEvidence(subfactor) {
    return this.evidence[subfactor] || null;
  }

  /**
   * Finalize the diagnostic collection
   */
  finalize() {
    this.endTime = new Date().toISOString();
    return this.toJSON();
  }

  /**
   * Export to JSON
   */
  toJSON() {
    return {
      scanId: this.scanId,
      startTime: this.startTime,
      endTime: this.endTime,
      summary: {
        totalDecisions: this.decisions.length,
        totalConflicts: this.conflicts.length,
        totalAntiPatterns: this.antiPatterns.length,
        antiPatternsBySeverity: {
          error: this.antiPatterns.filter(ap => ap.severity === 'error').length,
          warning: this.antiPatterns.filter(ap => ap.severity === 'warning').length,
          info: this.antiPatterns.filter(ap => ap.severity === 'info').length
        }
      },
      decisions: this.decisions,
      conflicts: this.conflicts,
      antiPatterns: this.antiPatterns,
      evidence: this.evidence
    };
  }

  /**
   * Export human-readable diagnostic report
   */
  toHumanReadable() {
    const lines = [];

    lines.push('=' .repeat(60));
    lines.push('DIAGNOSTIC REPORT');
    lines.push('=' .repeat(60));
    lines.push(`Scan ID: ${this.scanId}`);
    lines.push(`Started: ${this.startTime}`);
    lines.push(`Completed: ${this.endTime || 'In Progress'}`);
    lines.push('');

    // Summary
    lines.push('-'.repeat(60));
    lines.push('SUMMARY');
    lines.push('-'.repeat(60));
    lines.push(`Total Decisions: ${this.decisions.length}`);
    lines.push(`Total Conflicts: ${this.conflicts.length}`);
    lines.push(`Total Anti-Patterns: ${this.antiPatterns.length}`);
    lines.push('');

    // Anti-patterns
    if (this.antiPatterns.length > 0) {
      lines.push('-'.repeat(60));
      lines.push('ANTI-PATTERNS DETECTED');
      lines.push('-'.repeat(60));

      const errors = this.antiPatterns.filter(ap => ap.severity === 'error');
      const warnings = this.antiPatterns.filter(ap => ap.severity === 'warning');
      const infos = this.antiPatterns.filter(ap => ap.severity === 'info');

      if (errors.length > 0) {
        lines.push('\n[ERRORS]');
        errors.forEach(ap => {
          lines.push(`  ❌ ${ap.name}: ${ap.description}`);
          if (ap.recommendation) lines.push(`     → ${ap.recommendation}`);
        });
      }

      if (warnings.length > 0) {
        lines.push('\n[WARNINGS]');
        warnings.forEach(ap => {
          lines.push(`  ⚠️ ${ap.name}: ${ap.description}`);
          if (ap.recommendation) lines.push(`     → ${ap.recommendation}`);
        });
      }

      if (infos.length > 0) {
        lines.push('\n[INFO]');
        infos.forEach(ap => {
          lines.push(`  ℹ️ ${ap.name}: ${ap.description}`);
        });
      }
      lines.push('');
    }

    // Conflicts
    if (this.conflicts.length > 0) {
      lines.push('-'.repeat(60));
      lines.push('DATA CONFLICTS');
      lines.push('-'.repeat(60));
      this.conflicts.forEach((conflict, idx) => {
        lines.push(`${idx + 1}. ${conflict.subfactor}: ${conflict.conflictType}`);
        lines.push(`   Sources: ${conflict.sources.join(', ')}`);
        lines.push(`   Values: ${JSON.stringify(conflict.values)}`);
        if (conflict.resolution) {
          lines.push(`   Resolution: ${conflict.resolution}`);
        }
      });
      lines.push('');
    }

    // Key Decisions
    lines.push('-'.repeat(60));
    lines.push('KEY DECISIONS');
    lines.push('-'.repeat(60));
    this.decisions.slice(0, 20).forEach(decision => {
      const status = decision.result ? '✓' : '✗';
      lines.push(`${status} [${decision.subfactor}] ${decision.checkName}: ${decision.score}/${decision.maxScore}`);
      if (decision.reasoning) {
        lines.push(`   ${decision.reasoning}`);
      }
    });

    if (this.decisions.length > 20) {
      lines.push(`... and ${this.decisions.length - 20} more decisions`);
    }

    lines.push('');
    lines.push('=' .repeat(60));
    lines.push('END OF REPORT');
    lines.push('=' .repeat(60));

    return lines.join('\n');
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Constants
  CONFIDENCE_LEVELS,
  EVIDENCE_SOURCES,
  ANTI_PATTERNS,

  // Schema creators
  EVIDENCE_SCHEMAS,
  createEvidence,
  createDecision,
  createConflict,
  createAntiPatternResult,

  // Diagnostic collector
  DiagnosticCollector
};
