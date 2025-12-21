/**
 * ISSUE DETECTOR
 * File: backend/analyzers/recommendation-engine/issue-detector.js
 *
 * Analyzes V5 scores and evidence to identify specific problems
 * that need recommendations.
 *
 * This is Part 1 of the Recommendation Engine.
 */

const { isMeasured, getScore, ScoreState } = require('../score-types');

// ========================================
// HELPER FUNCTIONS: Tri-State Score Handling
// ========================================

/**
 * Safely get numeric score from tri-state or plain number
 * @param {number|Object|null|undefined} scoreInput - Score in any format
 * @returns {Object} - { value: number|null, state: string }
 */
function normalizeScore(scoreInput) {
  if (scoreInput === null || scoreInput === undefined) {
    return { value: null, state: 'not_measured' };
  }

  // Plain number (legacy)
  if (typeof scoreInput === 'number') {
    return { value: scoreInput, state: 'measured' };
  }

  // Tri-state object
  if (typeof scoreInput === 'object' && scoreInput.state) {
    return {
      value: scoreInput.score,
      state: scoreInput.state
    };
  }

  return { value: null, state: 'not_measured' };
}

/**
 * Check if score is below threshold (only for measured scores)
 * @param {number|Object} scoreInput - Raw number or tri-state score object
 * @param {number} threshold - Threshold to compare against
 * @returns {boolean} - True if score is measured and below threshold
 */
function scoreBelow(scoreInput, threshold) {
  const { value, state } = normalizeScore(scoreInput);
  if (state !== 'measured' && state !== ScoreState?.MEASURED) {
    return false;  // Don't trigger issues for unmeasured
  }
  return value !== null && value < threshold;
}

/**
 * Check if score is above threshold (only for measured scores)
 * @param {number|Object} scoreInput - Raw number or tri-state score object
 * @param {number} threshold - Threshold to compare against
 * @returns {boolean} - True if score is measured and above threshold
 */
function scoreAbove(scoreInput, threshold) {
  const { value, state } = normalizeScore(scoreInput);
  if (state !== 'measured' && state !== ScoreState?.MEASURED) {
    return false;  // Don't trigger issues for unmeasured
  }
  return value !== null && value > threshold;
}

/**
 * Check if score is measured and can be evaluated
 * @param {number|Object} scoreInput - Raw number or tri-state score object
 * @returns {boolean} - True if score can be evaluated
 */
function canEvaluate(scoreInput) {
  const { state } = normalizeScore(scoreInput);
  return state === 'measured' || state === ScoreState?.MEASURED;
}

/**
 * Get numeric value from a score (handles tri-state scores)
 * @param {number|Object} scoreInput - Raw number or tri-state score object
 * @returns {number|null} - Numeric score or null if not measured
 */
function getNumericScore(scoreInput) {
  const { value, state } = normalizeScore(scoreInput);
  if (state !== 'measured' && state !== ScoreState?.MEASURED) {
    return null;
  }
  return value;
}

/**
 * Aggregate subfactor scores, handling unmeasured scores gracefully
 * @param {Object} subfactors - Object of subfactor scores
 * @returns {Object} - Aggregated result with score, state, and metadata
 */
function aggregateSubfactorScores(subfactors) {
  const measuredScores = [];
  const unmeasuredKeys = [];

  for (const [key, score] of Object.entries(subfactors)) {
    const normalized = normalizeScore(score);
    if ((normalized.state === 'measured' || normalized.state === ScoreState?.MEASURED) && normalized.value !== null) {
      measuredScores.push({ key, value: normalized.value });
    } else {
      unmeasuredKeys.push(key);
    }
  }

  if (measuredScores.length === 0) {
    return {
      score: null,
      state: 'not_measured',
      reason: 'No subfactors could be measured',
      unmeasuredKeys
    };
  }

  const average = measuredScores.reduce((sum, s) => sum + s.value, 0) / measuredScores.length;

  return {
    score: Math.round(average),
    state: 'measured',
    measuredCount: measuredScores.length,
    totalCount: Object.keys(subfactors).length,
    unmeasuredKeys
  };
}

// ========================================
// CONFIGURATION: Issue Thresholds
// ========================================

/**
 * Each V5 subfactor has a threshold score.
 * If the page scores BELOW this threshold, it triggers a recommendation.
 */
const ISSUE_THRESHOLDS = {
  // AI Readability & Multimodal (10%)
  aiReadability: {
    altTextScore: 70,                    // Below 70/100 = needs alt text fixes
    captionsTranscriptsScore: 60,        // Below 60/100 = needs video accessibility
    interactiveAccessScore: 65,          // Below 65/100 = needs interactive support
    crossMediaScore: 60                  // Below 60/100 = needs media relationships
  },

  // AI Search Readiness (20%)
  aiSearchReadiness: {
    questionHeadingsScore: 70,           // Below 70/100 = needs Q-based headings
    scannabilityScore: 65,               // Below 65/100 = needs better structure
    readabilityScore: 60,                // Below 60/100 = too hard to read
    faqSchemaScore: 70,                  // Below 70/100 = needs FAQ schema markup
    faqContentScore: 70,                 // Below 70/100 = needs visible FAQ content
    snippetEligibleScore: 65,            // Below 65/100 = not snippet-friendly
    pillarPagesScore: 60,                // Below 60/100 = weak pillar content
    linkedSubpagesScore: 70,             // Below 70/100 = poor internal linking
    painPointsScore: 60,                 // Below 60/100 = not addressing pain points
    geoContentScore: 55                  // Below 55/100 = missing local content
  },

  // Content Freshness (8%)
  contentFreshness: {
    lastUpdatedScore: 60,                // Below 60/100 = content too old
    versioningScore: 50,                 // Below 50/100 = no version tracking
    timeSensitiveScore: 55,              // Below 55/100 = not timely
    auditProcessScore: 60,               // Below 60/100 = no audit trail
    liveDataScore: 50,                   // Below 50/100 = static data
    httpFreshnessScore: 60,              // Below 60/100 = poor cache headers
    editorialCalendarScore: 50           // Below 50/100 = no content calendar
  },

  // Content Structure (15%)
  contentStructure: {
    headingHierarchyScore: 75,           // Below 75/100 = broken H1-H6 structure
    navigationScore: 65,                 // Below 65/100 = poor navigation
    entityCuesScore: 60,                 // Below 60/100 = missing entity markup
    accessibilityScore: 70,              // Below 70/100 = accessibility issues
    geoMetaScore: 55                     // Below 55/100 = missing geo metadata
  },

  // Speed & UX (5%)
  speedUX: {
    lcpScore: 70,                        // Below 70/100 = slow LCP
    clsScore: 75,                        // Below 75/100 = layout shifts
    inpScore: 70,                        // Below 70/100 = slow interaction
    mobileScore: 75,                     // Below 75/100 = not mobile-friendly
    crawlerResponseScore: 65             // Below 65/100 = slow for crawlers
  },

  // Technical Setup (18%)
  technicalSetup: {
    crawlerAccessScore: 80,              // Below 80/100 = crawling issues
    structuredDataScore: 75,             // Below 75/100 = missing schemas
    canonicalHreflangScore: 70,          // Below 70/100 = canonical issues
    openGraphScore: 65,                  // Below 65/100 = poor social sharing
    sitemapScore: 80,                    // Below 80/100 = sitemap problems
    indexNowScore: 50,                   // Below 50/100 = no IndexNow
    rssFeedScore: 50                     // Below 50/100 = no RSS feed
  },

  // Trust & Authority (12%)
  trustAuthority: {
    authorBiosScore: 60,                 // Below 60/100 = missing author info
    certificationsScore: 55,             // Below 55/100 = no certifications (legacy)
    professionalCertifications: 55,      // Below 55/100 = missing industry certifications
    teamCredentials: 45,                 // Below 45/100 = team lacks documented credentials
    industryMemberships: 40,             // Below 40/100 = no industry associations shown
    domainAuthorityScore: 60,            // Below 60/100 = low authority
    thoughtLeadershipScore: 60,          // Below 60/100 = weak thought leadership
    thirdPartyProfilesScore: 55          // Below 55/100 = no social proof
  },

  // Voice Optimization (12%)
  voiceOptimization: {
    longTailScore: 65,                   // Below 65/100 = not targeting long-tail
    localIntentScore: 60,                // Below 60/100 = missing local intent
    conversationalTermsScore: 60,        // Below 60/100 = too formal
    snippetFormatScore: 70,              // Below 70/100 = not voice-friendly
    multiTurnScore: 60                   // Below 60/100 = no follow-up content
  }
};

// ========================================
// PRIORITY WEIGHTS
// ========================================

/**
 * How important is each category?
 * Used to calculate recommendation priority.
 */
const CATEGORY_WEIGHTS = {
  aiReadability: 10,
  aiSearchReadiness: 20,
  contentFreshness: 8,
  contentStructure: 15,
  speedUX: 5,
  technicalSetup: 18,
  trustAuthority: 12,
  voiceOptimization: 12
};

// ========================================
// ISSUE DETECTION FUNCTIONS
// ========================================

/**
 * Main function: Detect all issues for a single page
 * @param {Object} pageScores - V5 scores for this page (0-100 scale)
 * @param {Object} pageEvidence - Evidence collected during scan
 * @returns {Array} - List of detected issues
 */
function detectPageIssues(pageScores, pageEvidence) {
  const issues = [];

  // Debug logging to see what's being passed
  console.log('[IssueDetector] pageScores structure:');
  for (const [category, data] of Object.entries(pageScores)) {
    console.log(`   ${category}:`, typeof data, data);
  }

  // Loop through each category in the V5 scores
  for (const [category, subfactors] of Object.entries(pageScores)) {

    // Skip if this category doesn't have thresholds defined
    if (!ISSUE_THRESHOLDS[category]) {
      console.log(`   [IssueDetector] Skipping ${category} - no thresholds defined`);
      continue;
    }

    // Check if subfactors is an object
    if (typeof subfactors !== 'object' || subfactors === null) {
      console.warn(`   [IssueDetector] WARNING: ${category} is not an object! Type: ${typeof subfactors}, Value:`, subfactors);
      continue;
    }

    console.log(`   [IssueDetector] Checking ${category} with ${Object.keys(subfactors).length} subfactors`);

    // Loop through each subfactor in the category
    for (const [subfactor, scoreResult] of Object.entries(subfactors)) {

      const threshold = ISSUE_THRESHOLDS[category][subfactor];

      // Skip if score is not measured (tri-state handling)
      if (!canEvaluate(scoreResult)) {
        continue;
      }

      const numericScore = getNumericScore(scoreResult);

      // If score is below threshold, we have an issue!
      if (scoreBelow(scoreResult, threshold)) {
        issues.push({
          category: category,
          subfactor: subfactor,
          currentScore: numericScore,
          threshold: threshold,
          gap: threshold - numericScore,
          severity: calculateSeverity(numericScore, threshold),
          priority: calculatePriority(category, numericScore, threshold),
          evidence: extractEvidenceForIssue(subfactor, pageEvidence),
          pageUrl: pageEvidence.url
        });
      }
    }
  }

  // Sort issues by priority (highest first)
  issues.sort((a, b) => b.priority - a.priority);

  return issues;
}

/**
 * Calculate how severe an issue is
 * @param {number} score - Current score (0-100)
 * @param {number} threshold - Minimum acceptable score
 * @returns {string} - 'critical', 'high', 'medium', or 'low'
 */
function calculateSeverity(score, threshold) {
  const gap = threshold - score;
  
  if (gap > 40) return 'critical';  // More than 40 points below
  if (gap > 25) return 'high';      // 25-40 points below
  if (gap > 10) return 'medium';    // 10-25 points below
  return 'low';                     // Less than 10 points below
}

/**
 * Calculate priority score for an issue
 * Higher priority = more important to fix
 * Formula: (Category Weight × Gap) / 10
 * @param {string} category - V5 category name
 * @param {number} score - Current score
 * @param {number} threshold - Minimum acceptable score
 * @returns {number} - Priority score (0-100+)
 */
function calculatePriority(category, score, threshold) {
  const categoryWeight = CATEGORY_WEIGHTS[category] || 10;
  const gap = threshold - score;
  
  // Higher weight + bigger gap = higher priority
  const priority = (categoryWeight * gap) / 10;
  
  return Math.round(priority);
}

/**
 * Extract relevant evidence for a specific issue
 * This helps generate context-aware recommendations
 * @param {string} subfactor - Which subfactor has the issue
 * @param {Object} evidence - All evidence from the scan
 * @returns {Object} - Relevant evidence for this issue
 */
function extractEvidenceForIssue(subfactor, evidence) {
  // Map subfactors to relevant evidence fields
  const evidenceMap = {
    // AI Readability
    imageAltText: {
      totalImages: evidence.images?.total || 0,
      imagesWithAlt: evidence.images?.withAlt || 0,
      coverage: evidence.images?.altCoverage || 0,
      missingAltImages: evidence.images?.missingAlt || []
    },
    videoTranscripts: {
      totalVideos: evidence.videos?.total || 0,
      withTranscripts: evidence.videos?.withTranscripts || 0
    },
    visualHierarchy: {
      headings: evidence.headings || {},
      hasH1: evidence.headings?.h1?.length > 0,
      h1Count: evidence.headings?.h1?.length || 0
    },
    
    // AI Search Readiness
    schemaMarkup: {
      schemasFound: evidence.schemas || [],
      schemaTypes: evidence.schemaTypes || [],
      missingSchemas: identifyMissingSchemas(evidence)
    },
    entityRecognition: {
      entitiesFound: evidence.entities || [],
      namedEntities: evidence.namedEntities || []
    },
    faqStructure: {
      hasFaqSchema: evidence.schemas?.includes('FAQPage'),
      faqCount: evidence.faqs?.length || 0
    },
    
    // Content Structure
    headingHierarchy: {
      headings: evidence.headings || {},
      hierarchyIssues: analyzeHeadingHierarchy(evidence.headings)
    },
    paragraphLength: {
      avgParagraphLength: evidence.content?.avgParagraphLength || 0,
      longParagraphs: evidence.content?.longParagraphs || 0
    },
    
    // Technical Setup
    robotsTxt: {
      exists: evidence.technical?.robotsTxt?.exists || false,
      blocks: evidence.technical?.robotsTxt?.blocks || []
    },
    xmlSitemap: {
      exists: evidence.technical?.sitemap?.exists || false,
      url: evidence.technical?.sitemap?.url || null
    },
    
    // Trust & Authority
    authorBios: {
      hasAuthor: evidence.author?.present || false,
      authorName: evidence.author?.name || null,
      authorBio: evidence.author?.bio || null
    },
    contactInformation: {
      hasContact: evidence.contact?.present || false,
      contactMethods: evidence.contact?.methods || []
    }
  };

  return evidenceMap[subfactor] || { raw: evidence };
}

/**
 * Identify which schema types are missing
 * @param {Object} evidence - Scan evidence
 * @returns {Array} - List of recommended schema types not found
 */
function identifyMissingSchemas(evidence) {
  const foundSchemas = evidence.schemaTypes || [];
  const recommendedSchemas = [
    'Organization',
    'WebSite',
    'WebPage',
    'BreadcrumbList',
    'FAQPage',
    'Article',
    'Person'
  ];

  return recommendedSchemas.filter(schema => !foundSchemas.includes(schema));
}

/**
 * Analyze heading hierarchy for issues
 * @param {Object} headings - Headings from evidence
 * @returns {Array} - List of hierarchy problems
 */
function analyzeHeadingHierarchy(headings) {
  const issues = [];

  if (!headings) return issues;

  // Check for missing H1
  if (!headings.h1 || headings.h1.length === 0) {
    issues.push('Missing H1 tag');
  }

  // Check for multiple H1s
  if (headings.h1 && headings.h1.length > 1) {
    issues.push(`Multiple H1 tags found (${headings.h1.length})`);
  }

  // Check for heading gaps (e.g., H1 → H3 without H2)
  const levels = Object.keys(headings).map(k => parseInt(k.replace('h', '')));
  for (let i = 1; i < 6; i++) {
    if (levels.includes(i + 2) && !levels.includes(i + 1)) {
      issues.push(`Skipped heading level: H${i} to H${i + 2}`);
    }
  }

  return issues;
}

// ========================================
// RULEBOOK v1.2 Section 4.5.2: detectMultiPageIssues() as Default
// ========================================

/**
 * RULEBOOK v1.2 Section 4.5.2: Default issue detection
 * When crawl data exists, detectMultiPageIssues MUST be the default detection mode.
 * Evidence contract v2.0: Check _meta.hasCrawlData for standardized detection
 *
 * @param {Object} scanEvidence - Complete scan evidence including siteMetrics
 * @param {Object} context - Optional context for detection
 * @returns {Object} - Issues with site-wide context
 */
function detectIssues(scanEvidence, context = {}) {
  const hasCrawlData = !!(
    scanEvidence._meta?.hasCrawlData ||
    scanEvidence.siteMetrics?.totalDiscoveredUrls > 0 ||
    scanEvidence.crawler?.totalDiscoveredUrls > 0
  );

  console.log('[IssueDetector] detectIssues:', { hasCrawlData });

  if (hasCrawlData) {
    console.log('[IssueDetector] → Using SITE-WIDE detection');
    return detectSiteWideIssues(scanEvidence);
  } else {
    console.log('[IssueDetector] → Using PAGE-LEVEL detection');
    return detectPageIssues(scanEvidence.v5Scores || {}, scanEvidence);
  }
}

/**
 * RULEBOOK v1.2: Site-wide issue detection
 * Evidence contract v2.0: Multi-source detection for blog and FAQ
 * Only flags as missing if NOT found across ENTIRE site via ANY source
 */
function detectSiteWideIssues(scanEvidence) {
  const issues = [];
  const crawler = scanEvidence.crawler || scanEvidence.siteMetrics || {};
  const navigation = scanEvidence.navigation || {};
  const technical = scanEvidence.technical || {};
  const content = scanEvidence.content || {};

  // RULEBOOK v1.2: Sitemap classification as additional source
  const sitemap = scanEvidence.siteMetrics?.sitemap || crawler.sitemap || {};

  // Blog check - multi-source (evidence contract v2.0 + sitemap classification)
  const blogFound =
    crawler.discoveredSections?.hasBlogUrl ||
    sitemap.hasBlogUrls ||
    navigation.keyPages?.blog ||
    navigation.hasBlogLink ||
    technical.hasArticleSchema;

  console.log('[SiteWide] Blog:', {
    crawler: crawler.discoveredSections?.hasBlogUrl,
    sitemap: sitemap.hasBlogUrls,
    nav: navigation.keyPages?.blog || navigation.hasBlogLink,
    schema: technical.hasArticleSchema
  }, '→', blogFound ? 'FOUND' : 'MISSING');

  if (!blogFound) {
    issues.push({
      category: 'aiSearchReadiness',
      subfactor: 'pillarPagesScore',
      currentScore: 0,
      threshold: 60,
      gap: 60,
      severity: 'high',
      priority: 30,
      evidence: { siteWideScan: true, pagesChecked: crawler.totalDiscoveredUrls },
      pageUrl: scanEvidence.url,
      siteWideIssue: true,
      description: 'No blog section found across entire site'
    });
  }

  // FAQ check - multi-source (evidence contract v2.0 + sitemap classification)
  const faqFound =
    crawler.discoveredSections?.hasFaqUrl ||
    sitemap.hasFaqUrls ||
    navigation.keyPages?.faq ||
    navigation.hasFAQLink ||
    technical.hasFAQSchema ||
    (content.faqs?.length > 0);

  console.log('[SiteWide] FAQ:', {
    crawler: crawler.discoveredSections?.hasFaqUrl,
    sitemap: sitemap.hasFaqUrls,
    nav: navigation.keyPages?.faq || navigation.hasFAQLink,
    schema: technical.hasFAQSchema,
    content: content.faqs?.length
  }, '→', faqFound ? 'FOUND' : 'MISSING');

  if (!faqFound) {
    issues.push({
      category: 'aiSearchReadiness',
      subfactor: 'faqContentScore',
      currentScore: 0,
      threshold: 70,
      gap: 70,
      severity: 'high',
      priority: 35,
      evidence: { siteWideScan: true, pagesChecked: crawler.totalDiscoveredUrls },
      pageUrl: scanEvidence.url,
      siteWideIssue: true,
      description: 'No FAQ content found across entire site'
    });
  }

  // Also run page-level detection for current page
  const pageIssues = detectPageIssues(scanEvidence.v5Scores || {}, scanEvidence);

  // Filter out blog/FAQ issues from page-level if site has them
  const filteredPageIssues = pageIssues.filter(issue => {
    if (blogFound && issue.subfactor === 'pillarPagesScore') return false;
    if (faqFound && (issue.subfactor === 'faqContentScore' || issue.subfactor === 'faqSchemaScore')) return false;
    return true;
  });

  return [...issues, ...filteredPageIssues];
}

/**
 * Detect issues across multiple pages (for DIY/Pro plans)
 * @param {Array} scannedPages - Array of page scan results
 * @returns {Object} - Issues organized by page
 */
function detectMultiPageIssues(scannedPages) {
  const allPageIssues = [];

  for (const page of scannedPages) {
    const pageIssues = detectPageIssues(page.v5Scores, page.evidence);

    allPageIssues.push({
      url: page.url,
      score: page.overallScore,
      issueCount: pageIssues.length,
      criticalIssues: pageIssues.filter(i => i.severity === 'critical').length,
      issues: pageIssues
    });
  }

  return {
    totalPages: scannedPages.length,
    totalIssues: allPageIssues.reduce((sum, p) => sum + p.issueCount, 0),
    pageBreakdown: allPageIssues,
    mostCriticalPage: allPageIssues.sort((a, b) => b.criticalIssues - a.criticalIssues)[0]
  };
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  detectIssues, // RULEBOOK v1.2: Default function that chooses detection mode
  detectSiteWideIssues, // RULEBOOK v1.2: Site-wide detection
  detectPageIssues,
  detectMultiPageIssues,
  calculateSeverity,
  calculatePriority,
  ISSUE_THRESHOLDS,
  CATEGORY_WEIGHTS
};