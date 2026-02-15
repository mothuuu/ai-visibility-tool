/**
 * findingsExtractor.js — Pure utility for extracting findings from scan data.
 *
 * Shared by:
 *   - scripts/backfill-findings.js  (batch backfill)
 *   - services/findingsService.js   (live scan completion)
 *
 * No database access — returns plain objects ready for INSERT.
 */

// ---------------------------------------------------------------------------
// Pillar + pack-type mappings
// ---------------------------------------------------------------------------
const CATEGORY_TO_PILLAR = {
  technicalSetup:     'crawlability',
  contentStructure:   'entities',
  aiSearchReadiness:  'faqs',
  trustAuthority:     'trust',
  speedUX:            'speed',
  voiceOptimization:  'aeo',
  aiReadability:      'aeo',
  contentFreshness:   'citations',
  // legacy key used in ai-testing route
  aiReadabilityMultimodal: 'aeo'
};

const PILLAR_TO_PACK = {
  schema:        'schema_pack',
  faqs:          'faq_pack',
  trust:         'evidence_trust',
  entities:      'entity_clarity',
  citations:     'citation_pack',
  speed:         'performance_pack',
  crawlability:  'technical_seo_pack',
  aeo:           'aeo_pack',
  other:         'quick_wins'
};

const CATEGORY_DISPLAY = {
  aiReadability:            'AI Readability',
  aiReadabilityMultimodal:  'AI Readability',
  aiSearchReadiness:        'AI Search Readiness',
  contentFreshness:         'Content Freshness',
  contentStructure:         'Content Structure',
  speedUX:                  'Speed & UX',
  technicalSetup:           'Technical Setup',
  trustAuthority:           'Trust & Authority',
  voiceOptimization:        'Voice Optimization'
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function severityFromScore(score) {
  if (score == null || score <= 40) return 'critical';
  if (score <= 60) return 'high';
  if (score <= 80) return 'medium';
  return 'low';
}

function pillarFor(key) {
  return CATEGORY_TO_PILLAR[key] || 'other';
}

function packFor(pillar) {
  return PILLAR_TO_PACK[pillar] || 'quick_wins';
}

function severityDescription(sev) {
  switch (sev) {
    case 'critical': return 'This area needs urgent attention.';
    case 'high':     return 'Significant improvement opportunity.';
    case 'medium':   return 'Moderate improvement recommended.';
    case 'low':      return 'Minor refinement possible.';
    default:         return '';
  }
}

function subfactorFinding(scanId, pillar, subfactorKey, parentScore, title, description, urls, evidenceData) {
  const severity = severityFromScore(parentScore);
  return {
    scan_id: scanId,
    pillar: PILLAR_TO_PACK[pillar] ? pillar : 'other',
    subfactor_key: subfactorKey,
    severity,
    title,
    description,
    impacted_urls: urls || [],
    evidence_data: { ...evidenceData, level: 'subfactor' },
    suggested_pack_type: packFor(pillar)
  };
}

// ---------------------------------------------------------------------------
// Extraction: modern detailed_analysis
// ---------------------------------------------------------------------------
function extractFromDetailedAnalysis(scanId, url, da, findings) {
  const breakdown = da.categoryBreakdown || {};
  const evidence = da.scanEvidence || {};
  const tech = evidence.technical || {};
  const content = evidence.content || {};
  const structure = evidence.structure || {};
  const nav = evidence.navigation || {};
  const crawler = evidence.crawler || {};

  // --- Pillar-level findings (one per category) ---
  for (const [cat, score] of Object.entries(breakdown)) {
    if (typeof score !== 'number') continue;
    const pillar = pillarFor(cat);
    const severity = severityFromScore(score);
    const displayName = CATEGORY_DISPLAY[cat] || cat;

    findings.push({
      scan_id: scanId,
      pillar,
      subfactor_key: cat,
      severity,
      title: `${displayName}: Score ${score}/100`,
      description: `The ${displayName} pillar scored ${score}/100. ${severityDescription(severity)}`,
      impacted_urls: [url],
      evidence_data: { score, pillar: cat, level: 'pillar' },
      suggested_pack_type: packFor(pillar)
    });
  }

  // --- Subfactor-level findings from scanEvidence ---

  // Schema / structured data signals
  if (!tech.hasOrganizationSchema) {
    findings.push(subfactorFinding(scanId, 'schema', 'organization_schema_missing',
      breakdown.technicalSetup,
      'Missing Organization Schema',
      'No Organization JSON-LD detected. Adding it helps AI engines understand brand identity.',
      [url], { signal: 'hasOrganizationSchema', value: false }));
  }
  if (!tech.hasArticleSchema) {
    findings.push(subfactorFinding(scanId, 'schema', 'article_schema_missing',
      breakdown.technicalSetup,
      'Missing Article Schema',
      'No Article JSON-LD detected. Article schema helps AI engines parse authored content.',
      [url], { signal: 'hasArticleSchema', value: false }));
  }
  if (!tech.hasFAQSchema) {
    findings.push(subfactorFinding(scanId, 'schema', 'faq_schema_missing',
      breakdown.aiSearchReadiness,
      'Missing FAQ Schema',
      'No FAQPage JSON-LD detected. FAQ schema improves visibility in AI-generated answers.',
      [url], { signal: 'hasFAQSchema', value: false }));
  }
  if (!tech.hasBreadcrumbSchema) {
    findings.push(subfactorFinding(scanId, 'schema', 'breadcrumb_schema_missing',
      breakdown.technicalSetup,
      'Missing Breadcrumb Schema',
      'No BreadcrumbList JSON-LD detected. Breadcrumbs help AI understand site hierarchy.',
      [url], { signal: 'hasBreadcrumbSchema', value: false }));
  }

  // Crawlability signals
  if (!tech.hasSitemap && !tech.sitemapDetected) {
    findings.push(subfactorFinding(scanId, 'crawlability', 'sitemap_missing',
      breakdown.technicalSetup,
      'No Sitemap Detected',
      'No XML sitemap was found. Sitemaps help AI crawlers discover and index all pages.',
      [url], { signal: 'hasSitemap', value: false }));
  }
  if (!tech.robotsTxtFound) {
    findings.push(subfactorFinding(scanId, 'crawlability', 'robots_txt_missing',
      breakdown.technicalSetup,
      'No robots.txt Found',
      'No robots.txt file detected. A robots.txt helps guide AI crawlers to important content.',
      [url], { signal: 'robotsTxtFound', value: false }));
  }
  if (!tech.hasCanonical) {
    findings.push(subfactorFinding(scanId, 'crawlability', 'canonical_missing',
      breakdown.technicalSetup,
      'Missing Canonical Tag',
      'No canonical link tag detected. Canonicals prevent duplicate content issues for AI indexing.',
      [url], { signal: 'hasCanonical', value: false }));
  }
  if (!tech.hasOpenGraph) {
    findings.push(subfactorFinding(scanId, 'crawlability', 'open_graph_missing',
      breakdown.technicalSetup,
      'Missing Open Graph Tags',
      'No Open Graph meta tags detected. OG tags improve content representation in AI platforms.',
      [url], { signal: 'hasOpenGraph', value: false }));
  }

  // FAQ / content signals
  const faqs = content.faqs || [];
  if (faqs.length === 0) {
    findings.push(subfactorFinding(scanId, 'faqs', 'no_faq_content',
      breakdown.aiSearchReadiness,
      'No FAQ Content Found',
      'No FAQ question-answer pairs detected on the page. FAQ content is highly cited by AI engines.',
      [url], { faqCount: 0 }));
  }

  // Entity / structure signals
  const headings = content.headings || {};
  const h1s = headings.h1 || [];
  const h2s = headings.h2 || [];
  if (h1s.length === 0) {
    findings.push(subfactorFinding(scanId, 'entities', 'missing_h1',
      breakdown.contentStructure,
      'No H1 Heading Found',
      'No H1 tag detected. A clear H1 anchors the page topic for AI comprehension.',
      [url], { h1Count: 0 }));
  }
  if (h2s.length === 0) {
    findings.push(subfactorFinding(scanId, 'entities', 'missing_h2',
      breakdown.contentStructure,
      'No H2 Headings Found',
      'No H2 subheadings detected. H2s provide topical structure that AI engines rely on.',
      [url], { h2Count: 0 }));
  }
  if (!structure.hasNav && !nav.hasSemanticNav) {
    findings.push(subfactorFinding(scanId, 'entities', 'no_semantic_nav',
      breakdown.contentStructure,
      'No Semantic Navigation',
      'No <nav> element detected. Semantic navigation helps AI map site structure.',
      [url], { hasNav: false, hasSemanticNav: false }));
  }

  // Content depth
  const wordCount = content.wordCount || 0;
  if (wordCount < 300) {
    findings.push(subfactorFinding(scanId, 'aeo', 'thin_content',
      breakdown.aiReadability,
      'Thin Content Detected',
      `Page has only ${wordCount} words. AI engines favour pages with 800+ words of substantive content.`,
      [url], { wordCount }));
  }

  // Crawler discovered sections
  const sections = crawler.discoveredSections || {};
  if (!sections.hasBlogUrl) {
    findings.push(subfactorFinding(scanId, 'citations', 'no_blog_section',
      breakdown.contentFreshness,
      'No Blog Section Discovered',
      'No blog or news section found. Regular content publishing signals freshness to AI engines.',
      [url], { hasBlogUrl: false }));
  }
}

// ---------------------------------------------------------------------------
// Extraction: legacy scan_data (ai-testing route)
// ---------------------------------------------------------------------------
function extractFromLegacyScanData(scanId, url, sd, findings) {
  const scores = sd.scores || {};
  const metrics = sd.metrics || {};

  const scoreMap = {
    aiReadabilityMultimodal: scores.aiReadabilityMultimodal,
    aiSearchReadiness:       scores.aiSearchReadiness,
    contentFreshness:        scores.contentFreshness,
    contentStructure:        scores.contentStructure,
    speedUX:                 scores.speedUX,
    technicalSetup:          scores.technicalSetup,
    trustAuthority:          scores.trustAuthority,
    voiceOptimization:       scores.voiceOptimization
  };

  // Pillar-level findings
  for (const [cat, score] of Object.entries(scoreMap)) {
    if (score == null || typeof score !== 'number') continue;
    const pillar = pillarFor(cat);
    const severity = severityFromScore(score);
    const displayName = CATEGORY_DISPLAY[cat] || cat;

    findings.push({
      scan_id: scanId,
      pillar,
      subfactor_key: cat,
      severity,
      title: `${displayName}: Score ${Math.round(score)}/100`,
      description: `The ${displayName} pillar scored ${Math.round(score)}/100. ${severityDescription(severity)}`,
      impacted_urls: [url],
      evidence_data: { score, pillar: cat, level: 'pillar', source: 'legacy' },
      suggested_pack_type: packFor(pillar)
    });
  }

  // Subfactor findings from metrics
  if (metrics.hasSitemap === false) {
    findings.push(subfactorFinding(scanId, 'crawlability', 'sitemap_missing',
      scoreMap.technicalSetup, 'No Sitemap Detected',
      'No XML sitemap was found.', [url], { signal: 'hasSitemap', value: false }));
  }
  if (metrics.hasFAQSchema === false) {
    findings.push(subfactorFinding(scanId, 'schema', 'faq_schema_missing',
      scoreMap.aiSearchReadiness, 'Missing FAQ Schema',
      'No FAQPage JSON-LD detected.', [url], { signal: 'hasFAQSchema', value: false }));
  }
  if (metrics.hasOrganizationSchema === false) {
    findings.push(subfactorFinding(scanId, 'schema', 'organization_schema_missing',
      scoreMap.technicalSetup, 'Missing Organization Schema',
      'No Organization JSON-LD detected.', [url], { signal: 'hasOrganizationSchema', value: false }));
  }
  if (metrics.hasArticleSchema === false) {
    findings.push(subfactorFinding(scanId, 'schema', 'article_schema_missing',
      scoreMap.technicalSetup, 'Missing Article Schema',
      'No Article JSON-LD detected.', [url], { signal: 'hasArticleSchema', value: false }));
  }
  if (metrics.hasCanonical === false) {
    findings.push(subfactorFinding(scanId, 'crawlability', 'canonical_missing',
      scoreMap.technicalSetup, 'Missing Canonical Tag',
      'No canonical link tag detected.', [url], { signal: 'hasCanonical', value: false }));
  }
  if (metrics.hasOpenGraph === false) {
    findings.push(subfactorFinding(scanId, 'crawlability', 'open_graph_missing',
      scoreMap.technicalSetup, 'Missing Open Graph Tags',
      'No Open Graph meta tags detected.', [url], { signal: 'hasOpenGraph', value: false }));
  }
  if ((metrics.faqCount || 0) === 0) {
    findings.push(subfactorFinding(scanId, 'faqs', 'no_faq_content',
      scoreMap.aiSearchReadiness, 'No FAQ Content Found',
      'No FAQ question-answer pairs detected.', [url], { faqCount: 0 }));
  }
  if ((metrics.wordCount || 0) < 300) {
    findings.push(subfactorFinding(scanId, 'aeo', 'thin_content',
      scoreMap.aiReadabilityMultimodal, 'Thin Content Detected',
      `Page has only ${metrics.wordCount || 0} words.`, [url], { wordCount: metrics.wordCount || 0 }));
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract findings from a scan's data.
 *
 * @param {Object} opts
 * @param {number} opts.scanId        - The scan ID
 * @param {string} opts.url           - The scanned URL
 * @param {Object|null} opts.detailedAnalysis - parsed detailed_analysis JSONB (preferred)
 * @param {Object|null} opts.scanData        - parsed scan_data JSONB (legacy fallback)
 * @returns {Array<Object>} Finding rows ready for INSERT
 */
function extractFindings({ scanId, url, detailedAnalysis, scanData }) {
  const findings = [];

  if (detailedAnalysis) {
    const parsed = typeof detailedAnalysis === 'string' ? JSON.parse(detailedAnalysis) : detailedAnalysis;
    const resolvedUrl = parsed.url || url;
    extractFromDetailedAnalysis(scanId, resolvedUrl, parsed, findings);
  } else if (scanData) {
    const parsed = typeof scanData === 'string' ? JSON.parse(scanData) : scanData;
    const resolvedUrl = parsed.url || url;
    extractFromLegacyScanData(scanId, resolvedUrl, parsed, findings);
  }

  return findings;
}

module.exports = { extractFindings };
