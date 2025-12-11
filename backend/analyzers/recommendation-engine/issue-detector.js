/**
 * ISSUE DETECTOR
 * File: backend/analyzers/recommendation-engine/issue-detector.js
 * 
 * Analyzes V5 scores and evidence to identify specific problems
 * that need recommendations.
 * 
 * This is Part 1 of the Recommendation Engine.
 */

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
    for (const [subfactor, score] of Object.entries(subfactors)) {
      
      const threshold = ISSUE_THRESHOLDS[category][subfactor];
      
      // If score is below threshold, we have an issue!
      if (score < threshold) {
        issues.push({
          category: category,
          subfactor: subfactor,
          currentScore: score,
          threshold: threshold,
          gap: threshold - score,
          severity: calculateSeverity(score, threshold),
          priority: calculatePriority(category, score, threshold),
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
// DETECT ISSUES ACROSS ALL PAGES (DIY+)
// ========================================

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
  detectPageIssues,
  detectMultiPageIssues,
  calculateSeverity,
  calculatePriority,
  ISSUE_THRESHOLDS,
  CATEGORY_WEIGHTS
};