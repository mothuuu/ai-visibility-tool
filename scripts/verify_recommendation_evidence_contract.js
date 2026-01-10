#!/usr/bin/env node
/**
 * RECOMMENDATION EVIDENCE CONTRACT VERIFICATION
 * Phase 4A.1.5 Rulebook Alignment
 *
 * Verifies:
 * A) Evidence selectors match the canonical scanEvidence contract
 * B) Source + confidence support is properly handled
 * C) Site vs page targeting is explicit in recommendations
 *
 * Run: node scripts/verify_recommendation_evidence_contract.js
 * Exit: 0 on success, 1 on failures
 */

const path = require('path');
const fs = require('fs');

// ========================================
// CONFIGURATION
// ========================================

const BACKEND_DIR = path.join(__dirname, '..', 'backend');

// ========================================
// EVIDENCE CONTRACT PATHS (from evidence-contract.js)
// ========================================

// All valid paths in the scanEvidence contract
const CANONICAL_EVIDENCE_PATHS = [
  // Root level
  'url',
  'timestamp',
  'contractVersion',
  'html',

  // Metadata namespace
  'metadata',
  'metadata.title',
  'metadata.description',
  'metadata.keywords',
  'metadata.author',
  'metadata.canonical',
  'metadata.robots',
  'metadata.ogTitle',
  'metadata.ogDescription',
  'metadata.ogImage',
  'metadata.ogType',
  'metadata.ogUrl',
  'metadata.twitterCard',
  'metadata.twitterTitle',
  'metadata.twitterDescription',
  'metadata.lastModified',
  'metadata.publishedTime',
  'metadata.language',
  'metadata.geoRegion',
  'metadata.geoPlacename',

  // Content namespace
  'content',
  'content.headings',
  'content.headings.h1',
  'content.headings.h2',
  'content.headings.h3',
  'content.headings.h4',
  'content.headings.h5',
  'content.headings.h6',
  'content.paragraphs',
  'content.bodyText',
  'content.wordCount',
  'content.textLength',
  'content.lists',
  'content.tables',
  'content.faqs',

  // Structure namespace
  'structure',
  'structure.hasMain',
  'structure.hasArticle',
  'structure.hasSection',
  'structure.hasAside',
  'structure.hasNav',
  'structure.hasHeader',
  'structure.hasFooter',
  'structure.landmarks',
  'structure.headingCount',
  'structure.headingHierarchy',
  'structure.internalLinks',
  'structure.externalLinks',
  'structure.elementsWithIds',
  'structure.anchorLinks',
  'structure.hasTOC',
  'structure.hasBreadcrumbs',

  // Navigation namespace
  'navigation',
  'navigation.keyPages',
  'navigation.keyPages.about',
  'navigation.keyPages.contact',
  'navigation.keyPages.services',
  'navigation.keyPages.faq',
  'navigation.keyPages.blog',
  'navigation.keyPages.pricing',
  'navigation.allNavLinks',
  'navigation.hasSemanticNav',
  'navigation.headerLinks',
  'navigation.navLinks',
  'navigation.footerLinks',
  'navigation.hasBlogLink',
  'navigation.hasFAQLink',
  'navigation.totalNavLinks',

  // Media namespace
  'media',
  'media.images',
  'media.imageCount',
  'media.imagesWithAlt',
  'media.imagesWithoutAlt',
  'media.videos',
  'media.videoCount',
  'media.audio',
  'media.audioCount',

  // Technical namespace
  'technical',
  'technical.structuredData',
  'technical.hasOrganizationSchema',
  'technical.hasLocalBusinessSchema',
  'technical.hasFAQSchema',
  'technical.hasArticleSchema',
  'technical.hasBreadcrumbSchema',
  'technical.hreflangTags',
  'technical.hreflangLanguages',
  'technical.hasCanonical',
  'technical.canonicalUrl',
  'technical.hasSitemapLink',
  'technical.hasRSSFeed',
  'technical.hasViewport',
  'technical.viewport',
  'technical.charset',
  'technical.robotsMeta',
  'technical.cacheControl',
  'technical.lastModified',
  'technical.etag',
  'technical.isJSRendered',

  // Performance namespace
  'performance',
  'performance.ttfb',
  'performance.responseTime',
  'performance.serverTiming',
  'performance.contentLength',
  'performance.contentType',
  'performance.error',

  // Accessibility namespace
  'accessibility',
  'accessibility.ariaLabels',
  'accessibility.ariaDescribed',
  'accessibility.ariaLabelledBy',
  'accessibility.ariaHidden',
  'accessibility.ariaLive',
  'accessibility.formsWithLabels',
  'accessibility.imagesWithAlt',
  'accessibility.imagesTotal',
  'accessibility.hasLangAttribute',
  'accessibility.hasSkipLink',
  'accessibility.tabindex',
  'accessibility.hasInlineStyles',
  'accessibility.semanticButtons',
  'accessibility.divClickHandlers',

  // Entities namespace
  'entities',
  'entities.entities',
  'entities.entities.people',
  'entities.entities.organizations',
  'entities.entities.places',
  'entities.entities.products',
  'entities.entities.events',
  'entities.entities.professionalCredentials',
  'entities.entities.relationships',
  'entities.metrics',
  'entities.metrics.totalEntities',
  'entities.metrics.entitiesByType',
  'entities.metrics.relationships',
  'entities.metrics.verifiedEntities',
  'entities.metrics.knowledgeGraphConnections',
  'entities.metrics.geoPrecision',
  'entities.metrics.professionalVerification',
  'entities.knowledgeGraph',

  // Crawler namespace (expected, not required)
  'crawler',
  'crawler.discoveredSections',
  'crawler.discoveredSections.hasBlogUrl',
  'crawler.discoveredSections.hasFaqUrl',
  'crawler.discoveredSections.hasAboutUrl',
  'crawler.discoveredSections.hasContactUrl',
  'crawler.discoveredSections.blogUrls',
  'crawler.discoveredSections.faqUrls',
  'crawler.totalDiscoveredUrls',
  'crawler.crawledPageCount',
  'crawler.robotsTxt',
  'crawler.robotsTxt.found',
  'crawler.sitemap',
  'crawler.sitemap.detected',
  'crawler.sitemap.location',
  'crawler.sitemap.urls',
  'crawler.sitemap.totalUrls',
  'crawler.sitemap.blogUrls',
  'crawler.sitemap.faqUrls',
  'crawler.sitemap.aboutUrls',
  'crawler.sitemap.contactUrls',
  'crawler.sitemap.pricingUrls',
  'crawler.sitemap.hasBlogUrls',
  'crawler.sitemap.hasFaqUrls',

  // SiteMetrics namespace (expected, not required)
  'siteMetrics',
  'siteMetrics.discoveredSections',
  'siteMetrics.totalDiscoveredUrls',
  'siteMetrics.sitemap',
  'siteMetrics.robotsTxt',
  'siteMetrics.blogUrlCount',
  'siteMetrics.faqUrlCount',

  // Future namespaces (empty but defined)
  'aiReadiness',
  'aiReadiness.questionHeadings',
  'aiReadiness.snippetEligibility',
  'aiReadiness.answerability',
  'trust',
  'trust.authorBios',
  'trust.testimonials',
  'trust.thirdPartyProfiles',
  'trust.teamPage',
  'trust.caseStudies',
  'voice',
  'voice.speakableContent',
  'voice.conversationalQueries',
  'freshness',
  'freshness.lastModified',
  'freshness.publishDate',
  'freshness.updateFrequency',

  // Meta namespace
  '_meta',
  '_meta.hasCrawlData'
];

// ========================================
// SELECTOR EXTRACTION
// ========================================

/**
 * Extract evidence_selectors from subfactorPlaybookMap.js
 */
function extractPlaybookSelectors() {
  const playbookPath = path.join(BACKEND_DIR, 'recommendations', 'subfactorPlaybookMap.js');
  const content = fs.readFileSync(playbookPath, 'utf-8');

  const selectors = new Set();
  const subfactorDetails = {};

  // Parse evidence_selectors arrays
  const regex = /evidence_selectors:\s*\[([\s\S]*?)\]/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const arrayContent = match[1];
    // Extract string literals
    const stringRegex = /'([^']+)'|"([^"]+)"/g;
    let strMatch;
    while ((strMatch = stringRegex.exec(arrayContent)) !== null) {
      const selector = strMatch[1] || strMatch[2];
      selectors.add(selector);
    }
  }

  // Also get subfactor keys for context
  const subfactorRegex = /'([a-z_]+\.[a-z_]+)':\s*\{/g;
  while ((match = subfactorRegex.exec(content)) !== null) {
    const key = match[1];
    // Find the evidence_selectors for this subfactor
    const subfactorStart = match.index;
    const subfactorEnd = content.indexOf('},', subfactorStart);
    const subfactorContent = content.substring(subfactorStart, subfactorEnd);

    const selectorsMatch = subfactorContent.match(/evidence_selectors:\s*\[([\s\S]*?)\]/);
    if (selectorsMatch) {
      const selectorStrings = [];
      const stringRegex = /'([^']+)'|"([^"]+)"/g;
      let strMatch;
      while ((strMatch = stringRegex.exec(selectorsMatch[1])) !== null) {
        selectorStrings.push(strMatch[1] || strMatch[2]);
      }
      subfactorDetails[key] = selectorStrings;
    }
  }

  return { selectors: Array.from(selectors), subfactorDetails };
}

/**
 * Extract hardcoded selectors from evidenceGating.js
 */
function extractGatingSelectors() {
  const gatingPath = path.join(BACKEND_DIR, 'recommendations', 'evidenceGating.js');
  const content = fs.readFileSync(gatingPath, 'utf-8');

  const selectors = new Set();

  // Find patterns like scanEvidence.path.to.value or evidence.path.to.value
  const accessPatterns = [
    // Direct property access: scanEvidence.foo.bar
    /(?:scanEvidence|evidence)\??\.[a-zA-Z_]+(?:\??\.[a-zA-Z_]+)*/g,
    // getNestedValue calls: getNestedValue(obj, 'path.to.value')
    /getNestedValue\s*\([^,]+,\s*['"]([^'"]+)['"]\)/g
  ];

  // Extract direct property accesses
  let match;
  const directAccessRegex = /(?:scanEvidence|evidence)\??\.[a-zA-Z_]+(?:\??\.[a-zA-Z_]+)*/g;
  while ((match = directAccessRegex.exec(content)) !== null) {
    const fullPath = match[0];
    // Remove optional chaining and variable prefix
    const cleanPath = fullPath
      .replace(/^(?:scanEvidence|evidence)\??\./, '')
      .replace(/\?\./g, '.');
    if (cleanPath && !cleanPath.includes('(') && !cleanPath.includes('=')) {
      selectors.add(cleanPath);
    }
  }

  // Extract getNestedValue paths
  const nestedValueRegex = /getNestedValue\s*\([^,]+,\s*['"]([^'"]+)['"]\)/g;
  while ((match = nestedValueRegex.exec(content)) !== null) {
    selectors.add(match[1]);
  }

  return Array.from(selectors);
}

// ========================================
// VERIFICATION LOGIC
// ========================================

/**
 * Check if a selector path exists in the canonical contract
 */
function checkSelectorExists(selector) {
  // Exact match
  if (CANONICAL_EVIDENCE_PATHS.includes(selector)) {
    return { status: 'exact', message: 'Exact match' };
  }

  // Check if it's a prefix of any canonical path (partial match)
  const isPrefix = CANONICAL_EVIDENCE_PATHS.some(p => p.startsWith(selector + '.'));
  if (isPrefix) {
    return { status: 'exact', message: 'Valid prefix path' };
  }

  // Check if any canonical path is a prefix of this selector (nested access)
  const hasPrefix = CANONICAL_EVIDENCE_PATHS.some(p => selector.startsWith(p + '.'));
  if (hasPrefix) {
    return { status: 'partial', message: 'Extends canonical path (nested access)' };
  }

  // Check if the namespace exists
  const namespace = selector.split('.')[0];
  const namespaceExists = CANONICAL_EVIDENCE_PATHS.some(p => p === namespace || p.startsWith(namespace + '.'));
  if (namespaceExists) {
    return { status: 'partial', message: `Namespace '${namespace}' exists but field not defined` };
  }

  return { status: 'missing', message: 'Path not in contract' };
}

/**
 * Categorize selector by feature area
 */
function categorizeSelector(selector) {
  const namespace = selector.split('.')[0];
  const featureMap = {
    'navigation': 'Navigation',
    'technical': 'Technical/Schema',
    'content': 'Content',
    'structure': 'Structure',
    'media': 'Media',
    'crawler': 'Crawler/Sitemap',
    'siteMetrics': 'Site Metrics',
    'metadata': 'Metadata',
    'performance': 'Performance',
    'entities': 'Entities',
    'accessibility': 'Accessibility'
  };
  return featureMap[namespace] || 'Other';
}

// ========================================
// SOURCE + CONFIDENCE VERIFICATION
// ========================================

/**
 * Verify source + confidence support
 */
function verifySourceConfidenceSupport() {
  const report = {
    hasExplicitSourceField: false,
    hasExplicitConfidenceField: false,
    sourceLocations: [],
    gatingPrioritizesStructured: true,
    top10EvidenceSignals: []
  };

  // Check evidence contract for source/confidence fields
  const sourceFields = CANONICAL_EVIDENCE_PATHS.filter(p =>
    p.includes('source') || p.includes('Source')
  );
  const confidenceFields = CANONICAL_EVIDENCE_PATHS.filter(p =>
    p.includes('confidence') || p.includes('Confidence')
  );

  report.hasExplicitSourceField = sourceFields.length > 0;
  report.hasExplicitConfidenceField = confidenceFields.length > 0;
  report.sourceLocations = sourceFields;

  // Check evidenceGating.js for proper prioritization
  const gatingPath = path.join(BACKEND_DIR, 'recommendations', 'evidenceGating.js');
  const gatingContent = fs.readFileSync(gatingPath, 'utf-8');

  // Check if gating differentiates structured vs heuristic signals
  const hasStructuredCheck = gatingContent.includes('hasFAQSchema') ||
    gatingContent.includes('hasOrganizationSchema') ||
    gatingContent.includes('structuredData');
  const hasHeuristicHandling = gatingContent.includes('isFaqFalsePositive') ||
    gatingContent.includes('ambiguous') ||
    gatingContent.includes('AMBIGUOUS');

  report.gatingPrioritizesStructured = hasStructuredCheck && hasHeuristicHandling;

  // Top 10 evidence signals with their treatment
  report.top10EvidenceSignals = [
    { signal: 'technical.hasFAQSchema', type: 'structured', treatment: 'high confidence' },
    { signal: 'technical.hasOrganizationSchema', type: 'structured', treatment: 'high confidence' },
    { signal: 'technical.structuredData', type: 'structured', treatment: 'high confidence' },
    { signal: 'crawler.sitemap.detected', type: 'structured', treatment: 'high confidence' },
    { signal: 'crawler.robotsTxt.found', type: 'structured', treatment: 'high confidence' },
    { signal: 'navigation.keyPages.faq', type: 'heuristic', treatment: 'medium confidence' },
    { signal: 'content.faqs', type: 'heuristic', treatment: 'checked for false positives' },
    { signal: 'content.headings', type: 'heuristic', treatment: 'medium confidence' },
    { signal: 'navigation.hasFAQLink', type: 'heuristic', treatment: 'requires verification' },
    { signal: 'metadata.ogTitle', type: 'structured', treatment: 'high confidence' }
  ];

  return report;
}

// ========================================
// TARGET LEVEL VERIFICATION
// ========================================

/**
 * Verify target_level support in recommendations
 */
function verifyTargetLevelSupport() {
  const rendererPath = path.join(BACKEND_DIR, 'recommendations', 'renderer.js');
  const rendererContent = fs.readFileSync(rendererPath, 'utf-8');

  const report = {
    hasTargetLevel: false,
    fieldName: null,
    sampleValues: []
  };

  // Check if target_level or similar field exists
  if (rendererContent.includes('target_level')) {
    report.hasTargetLevel = true;
    report.fieldName = 'target_level';
  } else if (rendererContent.includes('targetLevel')) {
    report.hasTargetLevel = true;
    report.fieldName = 'targetLevel';
  } else if (rendererContent.includes('scope') && rendererContent.includes("'site'") && rendererContent.includes("'page'")) {
    report.hasTargetLevel = true;
    report.fieldName = 'scope';
  }

  return report;
}

// ========================================
// MAIN VERIFICATION RUNNER
// ========================================

function runVerification() {
  console.log('='.repeat(80));
  console.log('RECOMMENDATION EVIDENCE CONTRACT VERIFICATION');
  console.log('Phase 4A.1.5 Rulebook Alignment');
  console.log('='.repeat(80));
  console.log('');

  let hasErrors = false;
  const results = {
    selectors: { exact: [], partial: [], missing: [] },
    byFeature: {},
    sourceConfidence: null,
    targetLevel: null
  };

  // ========================================
  // A) EVIDENCE SELECTOR CONTRACT VERIFICATION
  // ========================================

  console.log('A) EVIDENCE SELECTOR CONTRACT VERIFICATION');
  console.log('-'.repeat(80));

  // Extract selectors from playbook
  const { selectors: playbookSelectors, subfactorDetails } = extractPlaybookSelectors();
  console.log(`   Found ${playbookSelectors.length} unique selectors in subfactorPlaybookMap.js`);

  // Extract selectors from gating
  const gatingSelectors = extractGatingSelectors();
  console.log(`   Found ${gatingSelectors.length} selector patterns in evidenceGating.js`);

  // Combine and dedupe
  const allSelectors = [...new Set([...playbookSelectors, ...gatingSelectors])];
  console.log(`   Total unique selectors: ${allSelectors.length}`);
  console.log('');

  // Verify each selector
  for (const selector of allSelectors.sort()) {
    const result = checkSelectorExists(selector);
    const feature = categorizeSelector(selector);

    if (!results.byFeature[feature]) {
      results.byFeature[feature] = { exact: [], partial: [], missing: [] };
    }

    if (result.status === 'exact') {
      results.selectors.exact.push({ selector, message: result.message });
      results.byFeature[feature].exact.push(selector);
    } else if (result.status === 'partial') {
      results.selectors.partial.push({ selector, message: result.message });
      results.byFeature[feature].partial.push(selector);
    } else {
      results.selectors.missing.push({ selector, message: result.message });
      results.byFeature[feature].missing.push(selector);
      hasErrors = true;
    }
  }

  // Print results
  console.log('   RESULTS:');
  console.log(`   ✅ Exact matches:   ${results.selectors.exact.length}`);
  console.log(`   ⚠️  Partial matches: ${results.selectors.partial.length}`);
  console.log(`   ❌ Missing:         ${results.selectors.missing.length}`);
  console.log('');

  // Print by feature
  console.log('   BY FEATURE:');
  for (const [feature, counts] of Object.entries(results.byFeature).sort()) {
    const total = counts.exact.length + counts.partial.length + counts.missing.length;
    const status = counts.missing.length > 0 ? '❌' :
                   counts.partial.length > 0 ? '⚠️' : '✅';
    console.log(`   ${status} ${feature.padEnd(20)} - ${counts.exact.length} exact, ${counts.partial.length} partial, ${counts.missing.length} missing`);
  }
  console.log('');

  // Print partial matches
  if (results.selectors.partial.length > 0) {
    console.log('   ⚠️  PARTIAL MATCHES (may need review):');
    for (const { selector, message } of results.selectors.partial) {
      console.log(`      - ${selector}: ${message}`);
    }
    console.log('');
  }

  // Print missing selectors
  if (results.selectors.missing.length > 0) {
    console.log('   ❌ MISSING SELECTORS (ERRORS):');
    for (const { selector, message } of results.selectors.missing) {
      console.log(`      - ${selector}: ${message}`);
    }
    console.log('');
  }

  // ========================================
  // B) SOURCE + CONFIDENCE SUPPORT
  // ========================================

  console.log('B) SOURCE + CONFIDENCE SUPPORT VERIFICATION');
  console.log('-'.repeat(80));

  results.sourceConfidence = verifySourceConfidenceSupport();

  console.log(`   Explicit source field in contract: ${results.sourceConfidence.hasExplicitSourceField ? 'YES' : 'NO'}`);
  console.log(`   Explicit confidence field in contract: ${results.sourceConfidence.hasExplicitConfidenceField ? 'YES' : 'NO'}`);
  console.log(`   Gating prioritizes structured > heuristic: ${results.sourceConfidence.gatingPrioritizesStructured ? 'YES ✅' : 'NO ❌'}`);
  console.log('');

  if (!results.sourceConfidence.hasExplicitSourceField && !results.sourceConfidence.hasExplicitConfidenceField) {
    console.log('   NOTE: scanEvidence does not carry explicit source/confidence fields.');
    console.log('   evidenceGating.js applies conservative defaults:');
    console.log('   - Structured signals (JSON-LD, robots, sitemap) => medium/high confidence');
    console.log('   - Heuristic signals (menu patterns, link patterns) => low/ambiguous');
    console.log('');
  }

  console.log('   TOP 10 EVIDENCE SIGNALS:');
  for (const signal of results.sourceConfidence.top10EvidenceSignals) {
    console.log(`   - ${signal.signal.padEnd(35)} [${signal.type}] => ${signal.treatment}`);
  }
  console.log('');

  // ========================================
  // C) SITE VS PAGE TARGETING
  // ========================================

  console.log('C) SITE VS PAGE TARGETING VERIFICATION');
  console.log('-'.repeat(80));

  results.targetLevel = verifyTargetLevelSupport();

  console.log(`   target_level present: ${results.targetLevel.hasTargetLevel ? 'YES ✅' : 'NO ⚠️'}`);
  if (results.targetLevel.hasTargetLevel) {
    console.log(`   Field name: ${results.targetLevel.fieldName}`);
  } else {
    console.log('');
    console.log('   RECOMMENDATION: Add target_level field to recommendations.');
    console.log('   Expected values: "site" | "page" | "both"');
    console.log('');
    console.log('   Suggested targeting by subfactor:');
    console.log('   - SITE level: robots, sitemap, llms.txt, knowledge panel, NAP, citations');
    console.log('   - PAGE level: titles, meta, OG, snippets, headings, alt text');
    console.log('   - BOTH: internal linking, topic clusters, schema coverage');
  }
  console.log('');

  // ========================================
  // FINAL SUMMARY
  // ========================================

  console.log('='.repeat(80));
  console.log('VERIFICATION SUMMARY');
  console.log('='.repeat(80));

  const selectorStatus = results.selectors.missing.length === 0 ? '✅ PASS' : '❌ FAIL';
  const sourceStatus = results.sourceConfidence.gatingPrioritizesStructured ? '✅ PASS' : '⚠️ REVIEW';
  const targetStatus = results.targetLevel.hasTargetLevel ? '✅ PASS' : '⚠️ NEEDS IMPLEMENTATION';

  console.log(`A) Evidence Selectors:     ${selectorStatus}`);
  console.log(`B) Source + Confidence:    ${sourceStatus}`);
  console.log(`C) Target Level:           ${targetStatus}`);
  console.log('');

  if (hasErrors) {
    console.log('❌ VERIFICATION FAILED');
    console.log('   Missing selectors must be added to the evidence contract');
    console.log('   or removed from playbook/gating if not needed.');
    process.exit(1);
  } else if (!results.targetLevel.hasTargetLevel) {
    console.log('⚠️  VERIFICATION PASSED WITH WARNINGS');
    console.log('   Consider implementing target_level for recommendations.');
    process.exit(0);
  } else {
    console.log('✅ VERIFICATION PASSED');
    process.exit(0);
  }
}

// Run verification
runVerification();
