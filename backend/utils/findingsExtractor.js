/**
 * findingsExtractor.js — Pure utility that converts a scan's JSONB blob into
 * findings rows ready for INSERT.
 *
 * Shared by:
 *   - services/findingsService.js   (live scan completion)
 *   - scripts/backfill-findings.js  (one-time historical backfill)
 *
 * No database access; no side effects (other than warning logs for unknown
 * pillars). Auto-detects two shapes:
 *
 *   Legacy (scan_data):       { url?, scores: {...}, metrics: {...} }
 *   Modern (detailed_analysis): { url?, categoryBreakdown: {...},
 *                                 scanEvidence: { technical, content,
 *                                                 structure, navigation,
 *                                                 crawler } }
 *
 * Returned rows match the findings table exactly:
 *   { scan_id, pillar, subfactor_key, severity,
 *     title, description, impacted_urls, evidence_data, suggested_pack_type }
 */

// ---------------------------------------------------------------------------
// Mappings (spec)
// ---------------------------------------------------------------------------
const KNOWN_PILLARS = new Set([
  'schema', 'entities', 'faqs', 'citations',
  'crawlability', 'speed', 'trust', 'aeo'
]);

const CATEGORY_TO_PILLAR = {
  aiReadability:           'aeo',
  aiReadabilityMultimodal: 'aeo',
  aiSearchReadiness:       'faqs',
  contentFreshness:        'citations',
  contentStructure:        'entities',
  speedUX:                 'speed',
  technicalSetup:          'crawlability',
  trustAuthority:          'trust',
  voiceOptimization:       'aeo'
};

const CATEGORY_DISPLAY = {
  aiReadability:           'AI Readability',
  aiReadabilityMultimodal: 'AI Readability',
  aiSearchReadiness:       'AI Search Readiness',
  contentFreshness:        'Content Freshness',
  contentStructure:        'Content Structure',
  speedUX:                 'Speed & UX',
  technicalSetup:          'Technical Setup',
  trustAuthority:          'Trust & Authority',
  voiceOptimization:       'Voice Optimization'
};

const PILLAR_TO_PACK = {
  schema:        'schema_pack',
  faqs:          'faq_pack',
  trust:         'evidence_trust',
  entities:      'entity_clarity',
  citations:     'quick_wins',
  speed:         'quick_wins',
  crawlability:  'quick_wins',
  aeo:           'quick_wins',
  other:         'quick_wins'
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function severityFromScore(score) {
  if (score == null || isNaN(score)) return 'critical';
  if (score <= 40) return 'critical';
  if (score <= 60) return 'high';
  if (score <= 80) return 'medium';
  return 'low';
}

function severityForFinding({ subfactorScore, pillarScore, scanScore }) {
  const score =
    (typeof subfactorScore === 'number' ? subfactorScore : null) ??
    (typeof pillarScore    === 'number' ? pillarScore    : null) ??
    (typeof scanScore      === 'number' ? scanScore      : null);
  return severityFromScore(score);
}

function severityBlurb(sev) {
  switch (sev) {
    case 'critical': return 'This area needs urgent attention.';
    case 'high':     return 'Significant improvement opportunity.';
    case 'medium':   return 'Moderate improvement recommended.';
    case 'low':      return 'Minor refinement possible.';
    default:         return '';
  }
}

function packForPillar(pillar) {
  return PILLAR_TO_PACK[pillar] || PILLAR_TO_PACK.other;
}

function parseJsonb(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function makeResolver(scanId) {
  return function resolvePillar(rawPillar, contextKey) {
    if (rawPillar && KNOWN_PILLARS.has(rawPillar)) return rawPillar;
    console.warn(`[findingsExtractor] unknown pillar "${rawPillar}" for scan ${scanId} (${contextKey}); using 'other'`);
    return 'other';
  };
}

// ---------------------------------------------------------------------------
// Legacy shape: scan_data = { scores, metrics }
// ---------------------------------------------------------------------------
function extractFromScanDataShape(scanId, sd, scanScore, findings, resolvePillar) {
  const url = sd.url || null;
  const urls = url ? [url] : [];
  const scores  = (sd.scores  && typeof sd.scores  === 'object') ? sd.scores  : {};
  const metrics = (sd.metrics && typeof sd.metrics === 'object') ? sd.metrics : {};

  const pillarScores = {};
  for (const [cat, score] of Object.entries(scores)) {
    if (typeof score !== 'number') continue;
    const pillar = CATEGORY_TO_PILLAR[cat];
    if (!pillar) continue;
    if (pillarScores[pillar] == null || score < pillarScores[pillar]) pillarScores[pillar] = score;
  }

  for (const [cat, rawScore] of Object.entries(scores)) {
    if (typeof rawScore !== 'number') continue;
    if (rawScore >= 81) continue;
    const pillar = resolvePillar(CATEGORY_TO_PILLAR[cat], `scores.${cat}`);
    const score = Math.round(rawScore);
    const severity = severityForFinding({ subfactorScore: score, pillarScore: score, scanScore });
    const display = CATEGORY_DISPLAY[cat] || cat;

    findings.push({
      scan_id: scanId,
      pillar,
      subfactor_key: cat,
      severity,
      title:        `${display}: Score ${score}/100`,
      description:  `The ${display} pillar scored ${score}/100. ${severityBlurb(severity)}`,
      impacted_urls: urls,
      evidence_data: { level: 'pillar', category: cat, score, source: 'scan_data.scores' },
      suggested_pack_type: packForPillar(pillar)
    });
  }

  const sub = (key, pillar, title, description, evidenceBlob) => {
    const resolved = resolvePillar(pillar, `metrics.${key}`);
    const severity = severityForFinding({ subfactorScore: null, pillarScore: pillarScores[resolved], scanScore });
    findings.push({
      scan_id: scanId,
      pillar:  resolved,
      subfactor_key: key,
      severity,
      title,
      description,
      impacted_urls: urls,
      evidence_data: { level: 'subfactor', source: 'scan_data.metrics', ...evidenceBlob },
      suggested_pack_type: packForPillar(resolved)
    });
  };

  if (metrics.hasOrganizationSchema === false) sub('organization_schema_missing', 'schema',
    'Missing Organization Schema',
    'No Organization JSON-LD detected. Adding it helps AI engines understand brand identity.',
    { signal: 'hasOrganizationSchema', value: false });
  if (metrics.hasArticleSchema === false) sub('article_schema_missing', 'schema',
    'Missing Article Schema',
    'No Article JSON-LD detected. Article schema helps AI engines parse authored content.',
    { signal: 'hasArticleSchema', value: false });
  if (metrics.hasFAQSchema === false) sub('faq_schema_missing', 'schema',
    'Missing FAQ Schema',
    'No FAQPage JSON-LD detected. FAQ schema improves visibility in AI-generated answers.',
    { signal: 'hasFAQSchema', value: false });
  if (metrics.hasBreadcrumbSchema === false) sub('breadcrumb_schema_missing', 'schema',
    'Missing Breadcrumb Schema',
    'No BreadcrumbList JSON-LD detected. Breadcrumbs help AI understand site hierarchy.',
    { signal: 'hasBreadcrumbSchema', value: false });
  if (metrics.hasSitemap === false) sub('sitemap_missing', 'crawlability',
    'No Sitemap Detected',
    'No XML sitemap was found. Sitemaps help AI crawlers discover and index all pages.',
    { signal: 'hasSitemap', value: false });
  if (metrics.robotsTxtFound === false) sub('robots_txt_missing', 'crawlability',
    'No robots.txt Found',
    'No robots.txt file detected. A robots.txt helps guide AI crawlers to important content.',
    { signal: 'robotsTxtFound', value: false });
  if (metrics.hasCanonical === false) sub('canonical_missing', 'crawlability',
    'Missing Canonical Tag',
    'No canonical link tag detected. Canonicals prevent duplicate content issues for AI indexing.',
    { signal: 'hasCanonical', value: false });
  if (metrics.hasOpenGraph === false) sub('open_graph_missing', 'crawlability',
    'Missing Open Graph Tags',
    'No Open Graph meta tags detected. OG tags improve content representation in AI platforms.',
    { signal: 'hasOpenGraph', value: false });
  if (metrics.faqCount != null && metrics.faqCount === 0) sub('no_faq_content', 'faqs',
    'No FAQ Content Found',
    'No FAQ question-answer pairs detected on the page. FAQ content is highly cited by AI engines.',
    { faqCount: 0 });
  if (metrics.h1Count != null && metrics.h1Count === 0) sub('missing_h1', 'entities',
    'No H1 Heading Found',
    'No H1 tag detected. A clear H1 anchors the page topic for AI comprehension.',
    { h1Count: 0 });
  if (metrics.h2Count != null && metrics.h2Count === 0) sub('missing_h2', 'entities',
    'No H2 Headings Found',
    'No H2 subheadings detected. H2s provide topical structure that AI engines rely on.',
    { h2Count: 0 });
  if (metrics.hasNav === false || metrics.hasSemanticNav === false) sub('no_semantic_nav', 'entities',
    'No Semantic Navigation',
    'No <nav> element detected. Semantic navigation helps AI map site structure.',
    { hasNav: metrics.hasNav, hasSemanticNav: metrics.hasSemanticNav });
  if (typeof metrics.wordCount === 'number' && metrics.wordCount < 300) sub('thin_content', 'aeo',
    'Thin Content Detected',
    `Page has only ${metrics.wordCount} words. AI engines favour pages with 800+ words of substantive content.`,
    { wordCount: metrics.wordCount });
  if (metrics.hasBlogUrl === false) sub('no_blog_section', 'citations',
    'No Blog Section Discovered',
    'No blog or news section found. Regular content publishing signals freshness to AI engines.',
    { hasBlogUrl: false });
}

// ---------------------------------------------------------------------------
// Modern shape: detailed_analysis = { categoryBreakdown, scanEvidence }
// ---------------------------------------------------------------------------
function extractFromDetailedAnalysisShape(scanId, da, scanScore, findings, resolvePillar) {
  const url = da.url || null;
  const urls = url ? [url] : [];
  const breakdown = (da.categoryBreakdown && typeof da.categoryBreakdown === 'object') ? da.categoryBreakdown : {};
  const evidence  = (da.scanEvidence && typeof da.scanEvidence === 'object') ? da.scanEvidence : {};
  const tech      = evidence.technical  || {};
  const content   = evidence.content    || {};
  const structure = evidence.structure  || {};
  const nav       = evidence.navigation || {};
  const crawler   = evidence.crawler    || {};

  const pillarScores = {};
  for (const [cat, score] of Object.entries(breakdown)) {
    if (typeof score !== 'number') continue;
    const pillar = CATEGORY_TO_PILLAR[cat];
    if (!pillar) continue;
    if (pillarScores[pillar] == null || score < pillarScores[pillar]) pillarScores[pillar] = score;
  }

  for (const [cat, rawScore] of Object.entries(breakdown)) {
    if (typeof rawScore !== 'number') continue;
    if (rawScore >= 81) continue;
    const pillar = resolvePillar(CATEGORY_TO_PILLAR[cat], `categoryBreakdown.${cat}`);
    const score = Math.round(rawScore);
    const severity = severityForFinding({ subfactorScore: score, pillarScore: score, scanScore });
    const display = CATEGORY_DISPLAY[cat] || cat;

    findings.push({
      scan_id: scanId,
      pillar,
      subfactor_key: cat,
      severity,
      title:        `${display}: Score ${score}/100`,
      description:  `The ${display} pillar scored ${score}/100. ${severityBlurb(severity)}`,
      impacted_urls: urls,
      evidence_data: { level: 'pillar', category: cat, score, source: 'detailed_analysis.categoryBreakdown' },
      suggested_pack_type: packForPillar(pillar)
    });
  }

  const sub = (key, pillar, title, description, evidenceBlob) => {
    const resolved = resolvePillar(pillar, `scanEvidence.${key}`);
    const severity = severityForFinding({ subfactorScore: null, pillarScore: pillarScores[resolved], scanScore });
    findings.push({
      scan_id: scanId,
      pillar:  resolved,
      subfactor_key: key,
      severity,
      title,
      description,
      impacted_urls: urls,
      evidence_data: { level: 'subfactor', source: 'detailed_analysis.scanEvidence', ...evidenceBlob },
      suggested_pack_type: packForPillar(resolved)
    });
  };

  if (tech.hasOrganizationSchema === false) sub('organization_schema_missing', 'schema',
    'Missing Organization Schema',
    'No Organization JSON-LD detected. Adding it helps AI engines understand brand identity.',
    { signal: 'hasOrganizationSchema', value: false });
  if (tech.hasArticleSchema === false) sub('article_schema_missing', 'schema',
    'Missing Article Schema',
    'No Article JSON-LD detected. Article schema helps AI engines parse authored content.',
    { signal: 'hasArticleSchema', value: false });
  if (tech.hasFAQSchema === false) sub('faq_schema_missing', 'schema',
    'Missing FAQ Schema',
    'No FAQPage JSON-LD detected. FAQ schema improves visibility in AI-generated answers.',
    { signal: 'hasFAQSchema', value: false });
  if (tech.hasBreadcrumbSchema === false) sub('breadcrumb_schema_missing', 'schema',
    'Missing Breadcrumb Schema',
    'No BreadcrumbList JSON-LD detected. Breadcrumbs help AI understand site hierarchy.',
    { signal: 'hasBreadcrumbSchema', value: false });
  if (tech.hasSitemap === false && tech.sitemapDetected !== true) sub('sitemap_missing', 'crawlability',
    'No Sitemap Detected',
    'No XML sitemap was found. Sitemaps help AI crawlers discover and index all pages.',
    { signal: 'hasSitemap', value: false });
  if (tech.robotsTxtFound === false) sub('robots_txt_missing', 'crawlability',
    'No robots.txt Found',
    'No robots.txt file detected. A robots.txt helps guide AI crawlers to important content.',
    { signal: 'robotsTxtFound', value: false });
  if (tech.hasCanonical === false) sub('canonical_missing', 'crawlability',
    'Missing Canonical Tag',
    'No canonical link tag detected. Canonicals prevent duplicate content issues for AI indexing.',
    { signal: 'hasCanonical', value: false });
  if (tech.hasOpenGraph === false) sub('open_graph_missing', 'crawlability',
    'Missing Open Graph Tags',
    'No Open Graph meta tags detected. OG tags improve content representation in AI platforms.',
    { signal: 'hasOpenGraph', value: false });

  const faqs = Array.isArray(content.faqs) ? content.faqs : [];
  if (faqs.length === 0) sub('no_faq_content', 'faqs',
    'No FAQ Content Found',
    'No FAQ question-answer pairs detected on the page. FAQ content is highly cited by AI engines.',
    { faqCount: 0 });

  const headings = content.headings || {};
  const h1s = Array.isArray(headings.h1) ? headings.h1 : [];
  const h2s = Array.isArray(headings.h2) ? headings.h2 : [];
  if (h1s.length === 0) sub('missing_h1', 'entities',
    'No H1 Heading Found',
    'No H1 tag detected. A clear H1 anchors the page topic for AI comprehension.',
    { h1Count: 0 });
  if (h2s.length === 0) sub('missing_h2', 'entities',
    'No H2 Headings Found',
    'No H2 subheadings detected. H2s provide topical structure that AI engines rely on.',
    { h2Count: 0 });

  if (structure.hasNav === false && nav.hasSemanticNav !== true) sub('no_semantic_nav', 'entities',
    'No Semantic Navigation',
    'No <nav> element detected. Semantic navigation helps AI map site structure.',
    { hasNav: structure.hasNav, hasSemanticNav: nav.hasSemanticNav });

  if (typeof content.wordCount === 'number' && content.wordCount < 300) sub('thin_content', 'aeo',
    'Thin Content Detected',
    `Page has only ${content.wordCount} words. AI engines favour pages with 800+ words of substantive content.`,
    { wordCount: content.wordCount });

  const sections = (crawler.discoveredSections && typeof crawler.discoveredSections === 'object') ? crawler.discoveredSections : {};
  if (sections.hasBlogUrl === false) sub('no_blog_section', 'citations',
    'No Blog Section Discovered',
    'No blog or news section found. Regular content publishing signals freshness to AI engines.',
    { hasBlogUrl: false });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Convert a scan's JSONB blob into findings rows.
 *
 * @param {Object} opts
 * @param {number} opts.scanId      - The scan ID (becomes scan_id on each row)
 * @param {Object|string|null} opts.scanData - The scan's JSONB blob. Accepts
 *   either the legacy `{scores, metrics}` shape or the modern
 *   `{categoryBreakdown, scanEvidence}` shape. May be a JSON string.
 * @param {number} [opts.scanScore] - Optional overall scan score; used as
 *   final-fallback severity input when no subfactor/pillar score is available.
 * @returns {Array<Object>} Findings rows shaped exactly for INSERT.
 */
function extractFindings({ scanId, scanData, scanScore = null }) {
  const findings = [];
  const blob = parseJsonb(scanData);
  if (!blob || typeof blob !== 'object') return findings;

  const resolvePillar = makeResolver(scanId);

  const looksLegacy = !!(blob.scores || blob.metrics);
  const looksModern = !!(blob.categoryBreakdown || blob.scanEvidence);

  if (looksLegacy) {
    extractFromScanDataShape(scanId, blob, scanScore, findings, resolvePillar);
  } else if (looksModern) {
    extractFromDetailedAnalysisShape(scanId, blob, scanScore, findings, resolvePillar);
  }
  return findings;
}

module.exports = {
  extractFindings,
  // exported for tests / introspection
  CATEGORY_TO_PILLAR,
  PILLAR_TO_PACK,
  KNOWN_PILLARS
};
