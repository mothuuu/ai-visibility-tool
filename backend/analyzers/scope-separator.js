// backend/analyzers/scope-separator.js
/**
 * SCOPE SEPARATOR
 *
 * Per rulebook "Site-Level vs Page-Level Separation":
 * Clearly distinguishes between site-wide issues and page-specific issues
 * to provide more actionable recommendations.
 *
 * Site-level issues:
 * - Organization schema (site-wide identity)
 * - Navigation structure
 * - Sitemap/robots.txt
 * - Cross-page consistency
 *
 * Page-level issues:
 * - H1 tag
 * - Meta description
 * - Content quality
 * - Page-specific schema (Article, FAQ, etc.)
 */

const { CONFIDENCE_LEVELS, EVIDENCE_SOURCES } = require('../config/diagnostic-types');

/**
 * Scope levels
 */
const SCOPE = {
  SITE: 'site',     // Applies to entire website
  PAGE: 'page',     // Applies to specific page
  SECTION: 'section' // Applies to a section of pages (e.g., blog)
};

/**
 * Issue classification by scope
 */
const SCOPE_CLASSIFICATIONS = {
  // ==========================================
  // SITE-LEVEL ISSUES
  // ==========================================
  site: {
    identity: {
      description: 'Organization/Brand Identity',
      issues: [
        'missing-organization-schema',
        'incomplete-organization-schema',
        'inconsistent-brand-name',
        'missing-logo',
        'no-social-profiles'
      ],
      recommendation: 'These issues affect how AI systems understand your entire business identity.'
    },
    navigation: {
      description: 'Site Navigation Structure',
      issues: [
        'no-semantic-nav',
        'missing-key-pages',
        'broken-navigation',
        'no-footer-links'
      ],
      recommendation: 'Navigation issues affect how AI systems discover and relate your content.'
    },
    technical: {
      description: 'Site-Wide Technical Setup',
      issues: [
        'missing-sitemap',
        'robots-blocking-ai',
        'no-ssl',
        'slow-ttfb'
      ],
      recommendation: 'Technical issues affect AI crawler access to your entire site.'
    },
    consistency: {
      description: 'Cross-Page Consistency',
      issues: [
        'inconsistent-schema-types',
        'varying-meta-patterns',
        'duplicate-content'
      ],
      recommendation: 'Consistency issues confuse AI systems about your site structure.'
    }
  },

  // ==========================================
  // PAGE-LEVEL ISSUES
  // ==========================================
  page: {
    content: {
      description: 'Page Content Quality',
      issues: [
        'missing-h1',
        'multiple-h1',
        'thin-content',
        'no-paragraphs',
        'skipped-heading-levels'
      ],
      recommendation: 'Content issues affect how AI systems understand this specific page.'
    },
    meta: {
      description: 'Page Metadata',
      issues: [
        'missing-meta-description',
        'meta-description-too-short',
        'meta-description-too-long',
        'title-too-short',
        'title-too-long',
        'missing-open-graph'
      ],
      recommendation: 'Metadata issues affect how AI systems summarize this page.'
    },
    schema: {
      description: 'Page-Specific Schema',
      issues: [
        'missing-page-schema',
        'invalid-schema-syntax',
        'empty-faq-schema',
        'missing-article-schema'
      ],
      recommendation: 'Schema issues affect rich data extraction from this page.'
    },
    accessibility: {
      description: 'Page Accessibility',
      issues: [
        'low-alt-text-coverage',
        'no-lang-attribute',
        'missing-aria-labels'
      ],
      recommendation: 'Accessibility issues affect AI interpretation of page content.'
    }
  },

  // ==========================================
  // SECTION-LEVEL ISSUES
  // ==========================================
  section: {
    blog: {
      description: 'Blog Section',
      issues: [
        'blog-missing-article-schema',
        'blog-no-author-info',
        'blog-no-dates',
        'blog-no-categories'
      ],
      recommendation: 'Blog issues affect how AI systems index your articles.'
    },
    faq: {
      description: 'FAQ Section',
      issues: [
        'faq-missing-schema',
        'faq-short-answers',
        'faq-no-accordion'
      ],
      recommendation: 'FAQ issues affect AI question-answering capabilities.'
    },
    services: {
      description: 'Services/Products Section',
      issues: [
        'services-no-schema',
        'services-missing-pricing',
        'services-no-descriptions'
      ],
      recommendation: 'Service issues affect AI understanding of your offerings.'
    }
  }
};

/**
 * Classify an issue by scope
 * @param {string} issueId - The issue identifier
 * @returns {Object} - { scope, category, description }
 */
function classifyIssue(issueId) {
  for (const [scope, categories] of Object.entries(SCOPE_CLASSIFICATIONS)) {
    for (const [category, data] of Object.entries(categories)) {
      if (data.issues.includes(issueId)) {
        return {
          scope,
          category,
          categoryDescription: data.description,
          scopeRecommendation: data.recommendation
        };
      }
    }
  }

  // Default to page-level if unknown
  return {
    scope: SCOPE.PAGE,
    category: 'other',
    categoryDescription: 'Other Issues',
    scopeRecommendation: 'This issue affects specific page content.'
  };
}

/**
 * Separate evidence into site-level and page-level components
 * @param {Object} evidence - Scan evidence from ContentExtractor
 * @param {Object} siteMetrics - Aggregated site metrics from crawler (optional)
 * @returns {Object} - Separated evidence by scope
 */
function separateEvidenceByScope(evidence, siteMetrics = null) {
  const separated = {
    site: {
      identity: {},
      navigation: {},
      technical: {},
      consistency: {}
    },
    page: {
      content: {},
      meta: {},
      schema: {},
      accessibility: {}
    },
    section: {}
  };

  // ==========================================
  // SITE-LEVEL EXTRACTION
  // ==========================================

  // Identity (from Organization schema + metadata)
  const orgSchema = (evidence.technical?.structuredData || [])
    .find(s => s.type === 'Organization' || s.type === 'Corporation' || s.type === 'LocalBusiness');

  separated.site.identity = {
    hasOrganizationSchema: !!orgSchema,
    organizationData: orgSchema?.raw || null,
    brandName: orgSchema?.raw?.name || evidence.metadata?.ogTitle || evidence.metadata?.title || null,
    logo: orgSchema?.raw?.logo || evidence.metadata?.ogImage || null,
    socialProfiles: orgSchema?.raw?.sameAs || [],
    contactPoint: orgSchema?.raw?.contactPoint || null
  };

  // Navigation
  separated.site.navigation = {
    hasSemanticNav: evidence.structure?.hasNav || false,
    navElementCount: evidence.navigation?.navElements?.length || 0,
    keyPages: evidence.navigation?.keyPages || {},
    keyPageCount: evidence.navigation?.keyPageCount || 0,
    hasFooter: evidence.structure?.hasFooter || false,
    hasBreadcrumbs: evidence.structure?.hasBreadcrumbs || false
  };

  // Technical (site-wide)
  separated.site.technical = {
    hasSitemap: siteMetrics?.hasSitemap || false,
    hasRobotsTxt: siteMetrics?.hasRobotsTxt || false,
    allowsAiCrawlers: siteMetrics?.allowsAiCrawlers ?? true,
    hasSSL: evidence.url?.startsWith('https') || false,
    ttfb: evidence.performance?.ttfb || null
  };

  // Consistency (requires multi-page data)
  if (siteMetrics) {
    separated.site.consistency = {
      pagesScanned: siteMetrics.pagesScanned || 0,
      schemaConsistency: calculateSchemaConsistency(siteMetrics),
      metaConsistency: calculateMetaConsistency(siteMetrics),
      brandConsistency: calculateBrandConsistency(siteMetrics)
    };
  }

  // ==========================================
  // PAGE-LEVEL EXTRACTION
  // ==========================================

  // Content
  separated.page.content = {
    h1Count: evidence.content?.headings?.h1?.length || 0,
    h1Text: evidence.content?.headings?.h1?.[0] || null,
    wordCount: evidence.content?.wordCount || 0,
    paragraphCount: evidence.content?.paragraphs?.length || 0,
    headingHierarchy: {
      h1: evidence.content?.headings?.h1?.length || 0,
      h2: evidence.content?.headings?.h2?.length || 0,
      h3: evidence.content?.headings?.h3?.length || 0,
      h4: evidence.content?.headings?.h4?.length || 0
    },
    hasFaqs: (evidence.content?.faqs?.length || 0) > 0,
    faqCount: evidence.content?.faqs?.length || 0
  };

  // Meta
  separated.page.meta = {
    title: evidence.metadata?.title || null,
    titleLength: evidence.metadata?.title?.length || 0,
    description: evidence.metadata?.description || null,
    descriptionLength: evidence.metadata?.description?.length || 0,
    hasOpenGraph: !!(evidence.metadata?.ogTitle || evidence.metadata?.ogDescription),
    hasTwitterCard: !!(evidence.metadata?.twitterCard || evidence.metadata?.twitterTitle),
    hasCanonical: evidence.technical?.hasCanonical || false,
    canonicalUrl: evidence.technical?.canonicalUrl || null
  };

  // Page-specific schema
  const pageSchemas = (evidence.technical?.structuredData || [])
    .filter(s => !['Organization', 'Corporation', 'LocalBusiness', 'WebSite'].includes(s.type));

  separated.page.schema = {
    hasPageSchema: pageSchemas.length > 0,
    schemaTypes: pageSchemas.map(s => s.type),
    hasFAQSchema: evidence.technical?.hasFAQSchema || false,
    hasArticleSchema: evidence.technical?.hasArticleSchema || false,
    hasBreadcrumbSchema: evidence.technical?.hasBreadcrumbSchema || false
  };

  // Accessibility
  separated.page.accessibility = {
    imagesTotal: evidence.media?.imageCount || 0,
    imagesWithAlt: evidence.media?.imagesWithAlt || 0,
    altCoverage: evidence.media?.imageCount > 0
      ? Math.round((evidence.media.imagesWithAlt / evidence.media.imageCount) * 100)
      : 100,
    hasLangAttribute: !!(evidence.metadata?.language),
    hasSemanticStructure: evidence.structure?.hasMain || evidence.structure?.hasArticle || false
  };

  return separated;
}

/**
 * Generate scoped recommendations
 * @param {Object} antiPatterns - Anti-pattern detection results
 * @returns {Object} - Recommendations organized by scope
 */
function generateScopedRecommendations(antiPatterns) {
  const recommendations = {
    site: [],
    page: [],
    section: [],
    summary: {
      siteIssues: 0,
      pageIssues: 0,
      sectionIssues: 0
    }
  };

  for (const pattern of antiPatterns.detected || []) {
    const classification = classifyIssue(pattern.id);

    const rec = {
      issue: pattern.name,
      description: pattern.description,
      severity: pattern.severity,
      impact: pattern.impact,
      recommendation: pattern.recommendation,
      category: classification.category,
      categoryDescription: classification.categoryDescription,
      details: pattern.details
    };

    if (classification.scope === SCOPE.SITE) {
      recommendations.site.push(rec);
      recommendations.summary.siteIssues++;
    } else if (classification.scope === SCOPE.SECTION) {
      recommendations.section.push(rec);
      recommendations.summary.sectionIssues++;
    } else {
      recommendations.page.push(rec);
      recommendations.summary.pageIssues++;
    }
  }

  // Sort by severity within each scope
  const severityOrder = { critical: 0, error: 1, warning: 2, info: 3 };
  const sortBySeverity = (a, b) => (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4);

  recommendations.site.sort(sortBySeverity);
  recommendations.page.sort(sortBySeverity);
  recommendations.section.sort(sortBySeverity);

  return recommendations;
}

/**
 * Calculate schema consistency across pages
 */
function calculateSchemaConsistency(siteMetrics) {
  if (!siteMetrics.pageResults || siteMetrics.pageResults.length < 2) {
    return { consistent: true, score: 100 };
  }

  const schemaTypes = siteMetrics.pageResults.map(p =>
    (p.technical?.structuredData || []).map(s => s.type).sort().join(',')
  );

  const uniquePatterns = [...new Set(schemaTypes)].length;
  const consistency = Math.round((1 - (uniquePatterns - 1) / schemaTypes.length) * 100);

  return {
    consistent: uniquePatterns <= 2,
    score: consistency,
    patterns: uniquePatterns
  };
}

/**
 * Calculate meta tag consistency
 */
function calculateMetaConsistency(siteMetrics) {
  if (!siteMetrics.pageResults || siteMetrics.pageResults.length < 2) {
    return { consistent: true, score: 100 };
  }

  let hasDescription = 0;
  let hasOg = 0;

  siteMetrics.pageResults.forEach(p => {
    if (p.metadata?.description) hasDescription++;
    if (p.metadata?.ogTitle || p.metadata?.ogDescription) hasOg++;
  });

  const total = siteMetrics.pageResults.length;
  const descriptionRate = Math.round((hasDescription / total) * 100);
  const ogRate = Math.round((hasOg / total) * 100);

  return {
    consistent: descriptionRate >= 80 && ogRate >= 80,
    descriptionCoverage: descriptionRate,
    ogCoverage: ogRate,
    score: Math.round((descriptionRate + ogRate) / 2)
  };
}

/**
 * Calculate brand consistency
 */
function calculateBrandConsistency(siteMetrics) {
  if (!siteMetrics.pageResults || siteMetrics.pageResults.length < 2) {
    return { consistent: true, score: 100 };
  }

  const brandNames = siteMetrics.pageResults
    .map(p => {
      const orgSchema = (p.technical?.structuredData || [])
        .find(s => s.type === 'Organization');
      return orgSchema?.raw?.name || p.metadata?.ogTitle || '';
    })
    .filter(Boolean)
    .map(n => n.toLowerCase().trim());

  const uniqueBrands = [...new Set(brandNames)].length;

  return {
    consistent: uniqueBrands <= 1,
    score: uniqueBrands <= 1 ? 100 : Math.round((1 / uniqueBrands) * 100),
    variants: uniqueBrands
  };
}

/**
 * Generate executive summary by scope
 * @param {Object} scopedRecommendations - Output from generateScopedRecommendations
 * @returns {Object} - Executive summary
 */
function generateExecutiveSummary(scopedRecommendations) {
  const summary = {
    overallHealth: 'good',
    siteLevel: {
      status: 'good',
      criticalIssues: 0,
      topPriority: null
    },
    pageLevel: {
      status: 'good',
      criticalIssues: 0,
      topPriority: null
    },
    actionItems: []
  };

  // Analyze site-level
  const siteCritical = scopedRecommendations.site.filter(r => r.severity === 'critical' || r.severity === 'error');
  summary.siteLevel.criticalIssues = siteCritical.length;
  summary.siteLevel.status = siteCritical.length > 0 ? 'needs-attention' : 'good';
  summary.siteLevel.topPriority = scopedRecommendations.site[0] || null;

  // Analyze page-level
  const pageCritical = scopedRecommendations.page.filter(r => r.severity === 'critical' || r.severity === 'error');
  summary.pageLevel.criticalIssues = pageCritical.length;
  summary.pageLevel.status = pageCritical.length > 0 ? 'needs-attention' : 'good';
  summary.pageLevel.topPriority = scopedRecommendations.page[0] || null;

  // Overall health
  const totalCritical = siteCritical.length + pageCritical.length;
  if (totalCritical > 3) {
    summary.overallHealth = 'poor';
  } else if (totalCritical > 0) {
    summary.overallHealth = 'needs-improvement';
  }

  // Generate action items (top 3 from each scope)
  if (summary.siteLevel.topPriority) {
    summary.actionItems.push({
      scope: 'site',
      action: `Fix site-wide: ${summary.siteLevel.topPriority.issue}`,
      impact: summary.siteLevel.topPriority.impact
    });
  }
  if (summary.pageLevel.topPriority) {
    summary.actionItems.push({
      scope: 'page',
      action: `Fix on this page: ${summary.pageLevel.topPriority.issue}`,
      impact: summary.pageLevel.topPriority.impact
    });
  }

  return summary;
}

module.exports = {
  SCOPE,
  SCOPE_CLASSIFICATIONS,
  classifyIssue,
  separateEvidenceByScope,
  generateScopedRecommendations,
  generateExecutiveSummary
};
