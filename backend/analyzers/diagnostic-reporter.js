/**
 * Diagnostic Reporter
 *
 * Per rulebook "Diagnostic Output Contract":
 * Generates comprehensive diagnostic output for scan results including:
 * - Per-subfactor decision trails
 * - Conflict reports
 * - Anti-pattern detection
 * - Human-readable diagnostic export
 */

const {
  CONFIDENCE_LEVELS,
  EVIDENCE_SOURCES,
  ANTI_PATTERNS,
  EVIDENCE_SCHEMAS,
  createEvidence,
  createDecision,
  createConflict,
  createAntiPatternResult,
  DiagnosticCollector
} = require('../config/diagnostic-types');

const VOCABULARY = require('../config/detection-vocabulary');

/**
 * DiagnosticReporter class
 * Analyzes scan evidence and generates comprehensive diagnostic output
 */
class DiagnosticReporter {
  constructor(scanEvidence, options = {}) {
    this.evidence = scanEvidence;
    this.options = options;
    this.collector = new DiagnosticCollector(options.scanId);
  }

  /**
   * Generate full diagnostic report
   * @returns {Object} - Complete diagnostic report
   */
  generateReport() {
    console.log('[DiagnosticReporter] Generating diagnostic report...');

    // Run all diagnostic checks
    this.analyzeOrganizationSchema();
    this.analyzeNavigation();
    this.analyzeHeadingHierarchy();
    this.analyzeFAQContent();
    this.analyzeBlogPresence();
    this.analyzeMetadata();
    this.analyzeSemanticHtml();
    this.analyzeAltText();
    this.analyzeContentQuality();
    this.analyzeSiteStructure();

    // Finalize and return
    const report = this.collector.finalize();

    console.log('[DiagnosticReporter] Report generated:', {
      decisions: report.summary.totalDecisions,
      antiPatterns: report.summary.totalAntiPatterns,
      conflicts: report.summary.totalConflicts
    });

    return report;
  }

  /**
   * Analyze Organization Schema
   */
  analyzeOrganizationSchema() {
    const technical = this.evidence.technical || {};
    const structuredData = technical.structuredData || [];

    const orgSchema = structuredData.find(sd =>
      VOCABULARY.SCHEMA_TYPES.organization.includes(sd.type)
    );

    const hasOrgSchema = !!orgSchema;
    let confidence = CONFIDENCE_LEVELS.LOW;
    let source = EVIDENCE_SOURCES.HEURISTIC;

    if (orgSchema) {
      source = EVIDENCE_SOURCES.JSON_LD;
      const raw = orgSchema.raw || {};

      // Check completeness
      const hasName = !!raw.name;
      const hasDescription = !!raw.description;
      const hasUrl = !!raw.url;
      const hasLogo = !!raw.logo;
      const hasSameAs = Array.isArray(raw.sameAs) && raw.sameAs.length > 0;

      const fieldCount = [hasName, hasDescription, hasUrl, hasLogo, hasSameAs].filter(Boolean).length;

      if (fieldCount >= 4) {
        confidence = CONFIDENCE_LEVELS.HIGH;
      } else if (fieldCount >= 2) {
        confidence = CONFIDENCE_LEVELS.MEDIUM;
      }

      // Check for anti-patterns
      if (!hasName) {
        this.collector.addAntiPattern('MISSING_REQUIRED_FIELDS', {
          affectedElements: ['Organization.name'],
          recommendation: 'Add a name property to your Organization schema'
        });
      }

      // Store evidence
      this.collector.setEvidence('organizationSchema', EVIDENCE_SCHEMAS.organizationSchema.create({
        detected: true,
        source,
        confidence,
        name: raw.name,
        description: raw.description,
        url: raw.url,
        logo: raw.logo,
        sameAs: raw.sameAs || [],
        contactPoint: raw.contactPoint,
        address: raw.address
      }));
    } else {
      this.collector.setEvidence('organizationSchema', EVIDENCE_SCHEMAS.organizationSchema.create({
        detected: false,
        source: EVIDENCE_SOURCES.HEURISTIC,
        confidence: CONFIDENCE_LEVELS.HIGH,
        notes: ['No Organization schema found']
      }));
    }

    // Add decision
    this.collector.addDecision({
      subfactor: 'organizationSchema',
      checkName: 'Organization Schema Present',
      result: hasOrgSchema,
      score: hasOrgSchema ? (confidence === CONFIDENCE_LEVELS.HIGH ? 10 : 5) : 0,
      maxScore: 10,
      evidence: [{ hasOrgSchema, confidence }],
      reasoning: hasOrgSchema
        ? `Organization schema found with ${confidence} confidence`
        : 'No Organization schema detected',
      sources: [source]
    });
  }

  /**
   * Analyze Navigation Structure
   */
  analyzeNavigation() {
    const navigation = this.evidence.navigation || {};
    const structure = this.evidence.structure || {};

    const hasSemanticNav = navigation.hasSemanticNav || structure.hasNav || false;
    const hasHeader = navigation.hasHeader || structure.hasHeader || false;
    const hasFooter = navigation.hasFooter || structure.hasFooter || false;
    const keyPages = navigation.keyPages || {};
    const keyPageCount = navigation.keyPageCount || Object.values(keyPages).filter(Boolean).length;
    const totalLinks = navigation.totalNavLinks || navigation.links?.length || 0;

    // Determine confidence
    let confidence = CONFIDENCE_LEVELS.LOW;
    if (hasSemanticNav && totalLinks > 3) {
      confidence = CONFIDENCE_LEVELS.HIGH;
    } else if (totalLinks > 0) {
      confidence = CONFIDENCE_LEVELS.MEDIUM;
    }

    // Check for anti-patterns
    if (!hasSemanticNav && totalLinks > 0) {
      this.collector.addAntiPattern('NO_SEMANTIC_NAV', {
        recommendation: 'Wrap navigation links in a <nav> element'
      });
    }

    if (hasSemanticNav && !navigation.navElements?.some(n => n.hasAriaLabel)) {
      this.collector.addAntiPattern('MISSING_ARIA_LABELS', {
        recommendation: 'Add aria-label to nav elements (e.g., aria-label="Main navigation")'
      });
    }

    // Store evidence
    this.collector.setEvidence('navigationStructure', EVIDENCE_SCHEMAS.navigationStructure.create({
      detected: hasSemanticNav || totalLinks > 0,
      source: hasSemanticNav ? EVIDENCE_SOURCES.SEMANTIC_HTML : EVIDENCE_SOURCES.CSS_CLASS,
      confidence,
      hasSemanticNav,
      hasAriaLabel: navigation.navElements?.some(n => n.hasAriaLabel) || false,
      navElementCount: navigation.navElements?.length || 0,
      totalLinks,
      keyPages,
      keyPageCount,
      hasDropdowns: navigation.allNavLinks?.some(l => l.inDropdown) || false,
      hasMobileMenu: navigation.hasMobileMenu || false,
      hasBreadcrumbs: structure.hasBreadcrumbs || false
    }));

    // Add decision
    this.collector.addDecision({
      subfactor: 'navigation',
      checkName: 'Semantic Navigation',
      result: hasSemanticNav,
      score: hasSemanticNav ? 5 : 0,
      maxScore: 5,
      evidence: [{ hasSemanticNav, totalLinks, keyPageCount }],
      reasoning: hasSemanticNav
        ? `Semantic <nav> element found with ${totalLinks} links and ${keyPageCount} key pages`
        : 'No semantic navigation element found',
      sources: [EVIDENCE_SOURCES.SEMANTIC_HTML]
    });
  }

  /**
   * Analyze Heading Hierarchy
   */
  analyzeHeadingHierarchy() {
    const content = this.evidence.content || {};
    const headings = content.headings || {};
    const structure = this.evidence.structure || {};
    const headingCount = structure.headingCount || {};

    const h1Count = headingCount.h1 || headings.h1?.length || 0;
    const h1Text = headings.h1 || [];

    // Check for proper hierarchy
    const h2Count = headingCount.h2 || headings.h2?.length || 0;
    const h3Count = headingCount.h3 || headings.h3?.length || 0;

    // Detect skipped levels
    const skippedLevels = [];
    if (h1Count > 0 && h3Count > 0 && h2Count === 0) {
      skippedLevels.push('H1 to H3 (skipped H2)');
    }

    const hasProperHierarchy = h1Count === 1 && skippedLevels.length === 0;

    // Detect question headings
    const allHeadings = [...(headings.h1 || []), ...(headings.h2 || []), ...(headings.h3 || [])];
    const questionHeadings = allHeadings.filter(h =>
      VOCABULARY.TEXT_PATTERNS.questions.endsWithQuestion.test(h) ||
      VOCABULARY.TEXT_PATTERNS.questions.questionWords.test(h)
    );

    // Check for anti-patterns
    if (h1Count === 0) {
      this.collector.addAntiPattern('MISSING_H1', {
        recommendation: 'Add a single H1 tag that describes the main topic of the page'
      });
    } else if (h1Count > 1) {
      this.collector.addAntiPattern('DUPLICATE_H1', {
        affectedElements: h1Text,
        recommendation: 'Use only one H1 tag per page'
      });
    }

    if (skippedLevels.length > 0) {
      this.collector.addAntiPattern('SKIPPED_HEADING_LEVEL', {
        affectedElements: skippedLevels,
        recommendation: 'Maintain proper heading hierarchy without skipping levels'
      });
    }

    // Store evidence
    this.collector.setEvidence('headingHierarchy', EVIDENCE_SCHEMAS.headingHierarchy.create({
      detected: h1Count > 0,
      source: EVIDENCE_SOURCES.SEMANTIC_HTML,
      confidence: hasProperHierarchy ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MEDIUM,
      h1Count,
      h1Text,
      hasProperHierarchy,
      skippedLevels,
      headingCounts: { h1: h1Count, h2: h2Count, h3: h3Count },
      questionHeadings
    }));

    // Add decision
    this.collector.addDecision({
      subfactor: 'headingHierarchy',
      checkName: 'Proper Heading Structure',
      result: hasProperHierarchy,
      score: hasProperHierarchy ? 5 : (h1Count === 1 ? 3 : 0),
      maxScore: 5,
      evidence: [{ h1Count, hasProperHierarchy, questionHeadings: questionHeadings.length }],
      reasoning: hasProperHierarchy
        ? 'Single H1 with proper heading hierarchy'
        : h1Count === 0 ? 'Missing H1 tag' : `${h1Count} H1 tags found (should be 1)`,
      sources: [EVIDENCE_SOURCES.SEMANTIC_HTML]
    });
  }

  /**
   * Analyze FAQ Content
   */
  analyzeFAQContent() {
    const content = this.evidence.content || {};
    const technical = this.evidence.technical || {};
    const faqs = content.faqs || [];

    const hasFAQSchema = technical.hasFAQSchema || false;
    const faqCount = faqs.length;
    const hasFAQs = faqCount > 0 || hasFAQSchema;

    // Calculate average answer length
    let averageAnswerLength = 0;
    if (faqCount > 0) {
      const totalLength = faqs.reduce((sum, faq) => sum + (faq.answer?.length || 0), 0);
      averageAnswerLength = Math.round(totalLength / faqCount);
    }

    // Determine source and confidence
    let source = EVIDENCE_SOURCES.HEURISTIC;
    let confidence = CONFIDENCE_LEVELS.LOW;

    if (hasFAQSchema) {
      source = EVIDENCE_SOURCES.JSON_LD;
      confidence = CONFIDENCE_LEVELS.HIGH;
    } else if (faqCount > 0) {
      const schemaFaqs = faqs.filter(f => f.source === 'schema');
      const htmlFaqs = faqs.filter(f => f.source === 'html' || f.source === 'details');

      if (schemaFaqs.length > 0) {
        source = EVIDENCE_SOURCES.MICRODATA;
        confidence = CONFIDENCE_LEVELS.HIGH;
      } else if (htmlFaqs.length > 0) {
        source = EVIDENCE_SOURCES.CSS_CLASS;
        confidence = CONFIDENCE_LEVELS.MEDIUM;
      }
    }

    // Check for section heading
    const headings = content.headings || {};
    const allH2s = headings.h2 || [];
    const hasSectionHeading = allH2s.some(h => VOCABULARY.TEXT_PATTERNS.questions.faqHeadings.test(h));

    // Detect accordion pattern
    const isAccordion = faqs.some(f => f.source === 'aria' || f.source === 'details');

    // Store evidence
    this.collector.setEvidence('faqContent', EVIDENCE_SCHEMAS.faqContent.create({
      detected: hasFAQs,
      source,
      confidence,
      faqs: faqs.slice(0, 10), // First 10 for diagnostic
      faqCount,
      hasSchema: hasFAQSchema,
      hasSectionHeading,
      isAccordion,
      averageAnswerLength
    }));

    // Add decision
    this.collector.addDecision({
      subfactor: 'faqContent',
      checkName: 'FAQ Content Present',
      result: hasFAQs,
      score: hasFAQs ? (hasFAQSchema ? 10 : 5) : 0,
      maxScore: 10,
      evidence: [{ faqCount, hasFAQSchema, averageAnswerLength }],
      reasoning: hasFAQs
        ? `${faqCount} FAQs found${hasFAQSchema ? ' with FAQPage schema' : ''}`
        : 'No FAQ content detected',
      sources: [source]
    });
  }

  /**
   * Analyze Blog Presence
   */
  analyzeBlogPresence() {
    const navigation = this.evidence.navigation || {};
    const technical = this.evidence.technical || {};
    const siteMetrics = this.evidence.siteMetrics || {};

    const hasBlogNavLink = navigation.keyPages?.blog || navigation.hasBlogLink || false;
    const hasArticleSchema = technical.hasArticleSchema || false;
    const crawlerFoundBlog = siteMetrics.discoveredSections?.hasBlogUrl || false;
    const blogUrls = siteMetrics.discoveredSections?.blogUrls || [];

    const hasBlog = hasBlogNavLink || hasArticleSchema || crawlerFoundBlog;

    // Determine source and confidence
    let source = EVIDENCE_SOURCES.HEURISTIC;
    let confidence = CONFIDENCE_LEVELS.LOW;

    if (hasArticleSchema) {
      source = EVIDENCE_SOURCES.JSON_LD;
      confidence = CONFIDENCE_LEVELS.HIGH;
    } else if (hasBlogNavLink) {
      source = EVIDENCE_SOURCES.NAVIGATION_LINK;
      confidence = CONFIDENCE_LEVELS.MEDIUM;
    } else if (crawlerFoundBlog) {
      source = EVIDENCE_SOURCES.CRAWLER;
      confidence = CONFIDENCE_LEVELS.MEDIUM;
    }

    // Check for RSS
    const hasRssFeed = technical.hasRSSFeed || false;

    // Store evidence
    this.collector.setEvidence('blogPresence', EVIDENCE_SCHEMAS.blogPresence.create({
      detected: hasBlog,
      source,
      confidence,
      hasBlogSection: hasBlog,
      blogUrl: blogUrls[0] || null,
      postCount: blogUrls.length,
      hasRssFeed,
      hasArticleSchema,
      categories: [],
      latestPostDate: null
    }));

    // Add decision
    this.collector.addDecision({
      subfactor: 'blogPresence',
      checkName: 'Blog Section Present',
      result: hasBlog,
      score: hasBlog ? (hasArticleSchema ? 8 : 4) : 0,
      maxScore: 8,
      evidence: [{ hasBlogNavLink, hasArticleSchema, crawlerFoundBlog, blogUrlCount: blogUrls.length }],
      reasoning: hasBlog
        ? `Blog detected via ${source}${hasArticleSchema ? ' with Article schema' : ''}`
        : 'No blog section detected',
      sources: [source]
    });
  }

  /**
   * Analyze Metadata
   */
  analyzeMetadata() {
    const metadata = this.evidence.metadata || {};

    const title = metadata.title || '';
    const description = metadata.description || '';
    const hasOpenGraph = !!(metadata.ogTitle || metadata.ogDescription);
    const hasTwitterCard = !!metadata.twitterCard;
    const hasCanonical = !!metadata.canonical;

    // Check for anti-patterns
    if (!description) {
      this.collector.addAntiPattern('MISSING_META_DESCRIPTION', {
        recommendation: 'Add a meta description between 120-160 characters'
      });
    }

    if (title.length > 60) {
      this.collector.addAntiPattern('TITLE_TOO_LONG', {
        affectedElements: [title],
        recommendation: 'Shorten title to under 60 characters'
      });
    } else if (title.length < 30 && title.length > 0) {
      this.collector.addAntiPattern('TITLE_TOO_SHORT', {
        affectedElements: [title],
        recommendation: 'Expand title to at least 30 characters'
      });
    }

    // Store evidence
    this.collector.setEvidence('metaData', EVIDENCE_SCHEMAS.metaData.create({
      detected: !!title,
      source: EVIDENCE_SOURCES.META_TAG,
      confidence: CONFIDENCE_LEVELS.HIGH,
      title,
      titleLength: title.length,
      description,
      descriptionLength: description.length,
      hasOpenGraph,
      hasTwitterCard,
      hasCanonical,
      canonicalUrl: metadata.canonical || null,
      robots: metadata.robots || null
    }));

    // Add decision
    const metaScore = (title ? 2 : 0) + (description ? 3 : 0) + (hasOpenGraph ? 2 : 0) + (hasCanonical ? 2 : 0);
    this.collector.addDecision({
      subfactor: 'metadata',
      checkName: 'Essential Metadata',
      result: metaScore >= 5,
      score: metaScore,
      maxScore: 9,
      evidence: [{ titleLength: title.length, descriptionLength: description.length, hasOpenGraph, hasCanonical }],
      reasoning: `Title: ${title.length} chars, Description: ${description.length} chars, OG: ${hasOpenGraph}, Canonical: ${hasCanonical}`,
      sources: [EVIDENCE_SOURCES.META_TAG]
    });
  }

  /**
   * Analyze Semantic HTML
   */
  analyzeSemanticHtml() {
    const structure = this.evidence.structure || {};
    const navigation = this.evidence.navigation || {};

    const hasMain = structure.hasMain || navigation.hasMain || false;
    const hasArticle = structure.hasArticle || false;
    const hasSection = structure.hasSection || false;
    const hasAside = structure.hasAside || false;
    const hasNav = structure.hasNav || navigation.hasSemanticNav || false;
    const hasHeader = structure.hasHeader || navigation.hasHeader || false;
    const hasFooter = structure.hasFooter || navigation.hasFooter || false;

    const landmarkCount = [hasMain, hasArticle, hasSection, hasAside, hasNav, hasHeader, hasFooter]
      .filter(Boolean).length;

    // Store evidence
    this.collector.setEvidence('semanticHtml', EVIDENCE_SCHEMAS.semanticHtml.create({
      detected: landmarkCount > 0,
      source: EVIDENCE_SOURCES.SEMANTIC_HTML,
      confidence: landmarkCount >= 3 ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MEDIUM,
      hasMain,
      hasArticle,
      hasSection,
      hasAside,
      hasNav,
      hasHeader,
      hasFooter,
      landmarkCount,
      ariaLandmarks: []
    }));

    // Add decision
    this.collector.addDecision({
      subfactor: 'semanticHtml',
      checkName: 'Semantic HTML Elements',
      result: landmarkCount >= 3,
      score: Math.min(landmarkCount * 1.5, 7),
      maxScore: 7,
      evidence: [{ hasMain, hasNav, hasHeader, hasFooter, landmarkCount }],
      reasoning: `${landmarkCount} semantic landmarks found (main: ${hasMain}, nav: ${hasNav}, header: ${hasHeader}, footer: ${hasFooter})`,
      sources: [EVIDENCE_SOURCES.SEMANTIC_HTML]
    });
  }

  /**
   * Analyze Alt Text Coverage
   */
  analyzeAltText() {
    const media = this.evidence.media || {};

    const totalImages = media.imageCount || 0;
    const imagesWithAlt = media.imagesWithAlt || 0;
    const imagesWithoutAlt = media.imagesWithoutAlt || 0;

    const altCoverage = totalImages > 0 ? imagesWithAlt / totalImages : 1;

    // Check for anti-patterns
    if (imagesWithoutAlt > 0) {
      this.collector.addAntiPattern('IMAGES_WITHOUT_ALT', {
        affectedElements: [`${imagesWithoutAlt} images`],
        recommendation: 'Add descriptive alt text to all non-decorative images'
      });
    }

    if (altCoverage < 0.8 && totalImages > 0) {
      this.collector.addAntiPattern('LOW_ALT_COVERAGE', {
        details: { coverage: `${Math.round(altCoverage * 100)}%` },
        recommendation: 'Aim for at least 90% alt text coverage'
      });
    }

    // Store evidence
    this.collector.setEvidence('altText', EVIDENCE_SCHEMAS.altText.create({
      detected: totalImages > 0,
      source: EVIDENCE_SOURCES.SEMANTIC_HTML,
      confidence: CONFIDENCE_LEVELS.HIGH,
      totalImages,
      imagesWithAlt,
      imagesWithoutAlt,
      altCoverage: Math.round(altCoverage * 100),
      decorativeImages: 0,
      descriptiveAltCount: imagesWithAlt
    }));

    // Add decision
    this.collector.addDecision({
      subfactor: 'altText',
      checkName: 'Image Alt Text Coverage',
      result: altCoverage >= 0.9,
      score: Math.round(altCoverage * 5),
      maxScore: 5,
      evidence: [{ totalImages, imagesWithAlt, altCoverage: Math.round(altCoverage * 100) }],
      reasoning: totalImages > 0
        ? `${Math.round(altCoverage * 100)}% alt text coverage (${imagesWithAlt}/${totalImages} images)`
        : 'No images found',
      sources: [EVIDENCE_SOURCES.SEMANTIC_HTML]
    });
  }

  /**
   * Analyze Content Quality
   */
  analyzeContentQuality() {
    const content = this.evidence.content || {};

    const wordCount = content.wordCount || 0;
    const paragraphCount = content.paragraphs?.length || 0;
    const listCount = content.lists?.length || 0;
    const tableCount = content.tables?.length || 0;

    // Check for thin content
    if (wordCount < 300) {
      this.collector.addAntiPattern('THIN_CONTENT', {
        details: { wordCount },
        recommendation: 'Add more substantive content (aim for 500+ words for important pages)'
      });
    }

    // Store evidence
    this.collector.setEvidence('contentDepth', EVIDENCE_SCHEMAS.contentDepth.create({
      detected: wordCount > 0,
      source: EVIDENCE_SOURCES.BODY_TEXT,
      confidence: CONFIDENCE_LEVELS.HIGH,
      wordCount,
      paragraphCount,
      averageSentenceLength: 0,
      hasLists: listCount > 0,
      listCount,
      hasTables: tableCount > 0,
      tableCount,
      hasMedia: (this.evidence.media?.imageCount || 0) > 0,
      mediaCount: this.evidence.media?.imageCount || 0
    }));

    // Add decision
    const contentScore = Math.min(Math.floor(wordCount / 100), 10);
    this.collector.addDecision({
      subfactor: 'contentDepth',
      checkName: 'Content Depth',
      result: wordCount >= 500,
      score: contentScore,
      maxScore: 10,
      evidence: [{ wordCount, paragraphCount, listCount, tableCount }],
      reasoning: `${wordCount} words, ${paragraphCount} paragraphs, ${listCount} lists, ${tableCount} tables`,
      sources: [EVIDENCE_SOURCES.BODY_TEXT]
    });
  }

  /**
   * Analyze Site Structure
   */
  analyzeSiteStructure() {
    const siteMetrics = this.evidence.siteMetrics || {};
    const technical = this.evidence.technical || {};

    const hasSitemap = this.evidence.sitemapDetected || technical.hasSitemapLink || false;
    const discoveredSections = siteMetrics.discoveredSections || {};
    const totalDiscoveredUrls = discoveredSections.totalDiscoveredUrls || 0;

    // Store evidence
    this.collector.setEvidence('siteDiscovery', EVIDENCE_SCHEMAS.siteDiscovery.create({
      detected: hasSitemap || totalDiscoveredUrls > 0,
      source: hasSitemap ? EVIDENCE_SOURCES.SITEMAP : EVIDENCE_SOURCES.CRAWLER,
      confidence: hasSitemap ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MEDIUM,
      hasSitemap,
      sitemapUrl: this.evidence.sitemapLocation || null,
      discoveredPages: totalDiscoveredUrls,
      discoveredSections,
      hasRobotsTxt: false,
      allowsAiCrawlers: null
    }));

    // Add decision
    this.collector.addDecision({
      subfactor: 'siteDiscovery',
      checkName: 'Site Discoverability',
      result: hasSitemap,
      score: hasSitemap ? 5 : 2,
      maxScore: 5,
      evidence: [{ hasSitemap, totalDiscoveredUrls, sections: Object.keys(discoveredSections).filter(k => discoveredSections[k] === true) }],
      reasoning: hasSitemap
        ? `Sitemap found with ${totalDiscoveredUrls} discoverable URLs`
        : `No sitemap, ${totalDiscoveredUrls} URLs discovered via crawling`,
      sources: [hasSitemap ? EVIDENCE_SOURCES.SITEMAP : EVIDENCE_SOURCES.CRAWLER]
    });
  }

  /**
   * Get human-readable report
   */
  getHumanReadableReport() {
    return this.collector.toHumanReadable();
  }

  /**
   * Get JSON report
   */
  getJSONReport() {
    return this.collector.toJSON();
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = DiagnosticReporter;
