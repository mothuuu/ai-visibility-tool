/**
 * DETECTION SYSTEM AUDIT
 *
 * This script audits the entire detection pipeline from URL input to final recommendation.
 * It tests against multiple real websites and compares expected vs. actual detection results.
 *
 * Run with: node backend/tests/detection-audit.js
 */

const ContentExtractor = require('../analyzers/content-extractor');
const SiteCrawler = require('../analyzers/site-crawler');
const V5EnhancedRubricEngine = require('../analyzers/v5-enhanced-rubric-engine');
const { detectPageIssues } = require('../analyzers/recommendation-engine/issue-detector');

// ============================================
// TEST CASES
// ============================================

const testCases = [
  {
    name: 'xeo.marketing',
    url: 'https://xeo.marketing',
    expectedDetections: {
      // Technical Setup
      sitemap: true,           // Sites typically have sitemaps
      organizationSchema: null, // Will detect
      faqSchema: null,         // Will detect
      localBusinessSchema: null, // Will detect

      // Content Detection
      visibleFAQ: null,        // Will detect
      questionHeadings: null,  // Will detect

      // Schema Types to check
      hasStructuredData: true,
    }
  },
  {
    name: 'visible2ai.com',
    url: 'https://www.visible2ai.com',
    expectedDetections: {
      sitemap: true,
      organizationSchema: true,
      faqSchema: true,
      localBusinessSchema: true,
      postalAddressSchema: true,
      geoCoordinatesSchema: true,
      hasStructuredData: true,
    }
  },
  {
    name: 'google.com',
    url: 'https://www.google.com',
    expectedDetections: {
      sitemap: true,           // Google definitely has a sitemap
      hasStructuredData: null, // Will detect
    }
  }
];

// ============================================
// AUDIT FUNCTIONS
// ============================================

async function runDetectionAudit() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                    DETECTION SYSTEM AUDIT                         ');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`Started: ${new Date().toISOString()}\n`);

  const results = [];

  for (const testCase of testCases) {
    console.log(`\n┌─────────────────────────────────────────────────────────────────┐`);
    console.log(`│ Testing: ${testCase.name.padEnd(54)} │`);
    console.log(`│ URL: ${testCase.url.padEnd(58)} │`);
    console.log(`└─────────────────────────────────────────────────────────────────┘\n`);

    try {
      const result = await auditSingleSite(testCase);
      results.push(result);
    } catch (error) {
      console.error(`❌ CRITICAL ERROR scanning ${testCase.name}:`, error.message);
      results.push({
        site: testCase.name,
        url: testCase.url,
        error: error.message,
        passed: 0,
        failed: 0,
        total: 0
      });
    }
  }

  // Print summary
  printSummary(results);

  return results;
}

async function auditSingleSite(testCase) {
  const result = {
    site: testCase.name,
    url: testCase.url,
    detections: {},
    rawEvidence: {},
    issues: [],
    passed: 0,
    failed: 0,
    total: 0
  };

  // Stage 1: Content Extraction
  console.log('📥 STAGE 1: Content Extraction');
  console.log('────────────────────────────────');

  const extractor = new ContentExtractor(testCase.url);
  const evidence = await extractor.extract();

  console.log(`   HTML Length: ${evidence.html?.length || 0} chars`);
  console.log(`   Word Count: ${evidence.content?.wordCount || 0}`);
  console.log(`   Image Count: ${evidence.media?.imageCount || 0}`);

  result.rawEvidence.htmlLength = evidence.html?.length || 0;
  result.rawEvidence.wordCount = evidence.content?.wordCount || 0;

  // Stage 2: Technical Detection
  console.log('\n📊 STAGE 2: Technical Detection');
  console.log('────────────────────────────────');

  const technical = evidence.technical || {};

  // Schema Detection
  console.log('\n   [Schema Detection]');
  const structuredData = technical.structuredData || [];
  console.log(`   JSON-LD Blocks Found: ${structuredData.length}`);

  const schemaTypes = structuredData.map(s => s.type);
  console.log(`   Schema Types: ${schemaTypes.length > 0 ? schemaTypes.join(', ') : 'NONE'}`);

  // Check for specific schemas
  result.detections.hasStructuredData = structuredData.length > 0;
  result.detections.organizationSchema = technical.hasOrganizationSchema || false;
  result.detections.localBusinessSchema = technical.hasLocalBusinessSchema || false;
  result.detections.faqSchema = technical.hasFAQSchema || false;
  result.detections.articleSchema = technical.hasArticleSchema || false;
  result.detections.breadcrumbSchema = technical.hasBreadcrumbSchema || false;

  // Log all schema types including nested
  if (structuredData.length > 0) {
    console.log(`\n   Detailed Schema Analysis:`);
    structuredData.forEach((schema, idx) => {
      console.log(`   ${idx + 1}. ${schema.type}`);
      if (schema.raw) {
        // Check for nested schemas
        const nestedTypes = findNestedSchemaTypes(schema.raw);
        if (nestedTypes.length > 0) {
          console.log(`      └─ Nested types: ${nestedTypes.join(', ')}`);
        }
      }
    });
  }

  // Check nested schemas
  result.detections.postalAddressSchema = hasNestedSchema(structuredData, 'PostalAddress');
  result.detections.geoCoordinatesSchema = hasNestedSchema(structuredData, 'GeoCoordinates');
  result.detections.placeSchema = hasNestedSchema(structuredData, 'Place');

  console.log(`\n   Schema Detection Summary:`);
  console.log(`   ├─ Organization: ${result.detections.organizationSchema ? '✅' : '❌'}`);
  console.log(`   ├─ LocalBusiness: ${result.detections.localBusinessSchema ? '✅' : '❌'}`);
  console.log(`   ├─ FAQPage: ${result.detections.faqSchema ? '✅' : '❌'}`);
  console.log(`   ├─ PostalAddress (nested): ${result.detections.postalAddressSchema ? '✅' : '❌'}`);
  console.log(`   └─ GeoCoordinates (nested): ${result.detections.geoCoordinatesSchema ? '✅' : '❌'}`);

  // Stage 3: Sitemap Detection
  console.log('\n   [Sitemap Detection]');
  result.detections.sitemap = technical.hasSitemapLink || false;
  console.log(`   hasSitemapLink: ${result.detections.sitemap}`);

  // Actually try to fetch the sitemap
  try {
    const sitemapResult = await checkSitemapDirectly(testCase.url);
    result.detections.sitemapActuallyExists = sitemapResult.exists;
    result.detections.sitemapLocation = sitemapResult.location;
    console.log(`   Sitemap Actual Check: ${sitemapResult.exists ? '✅ FOUND at ' + sitemapResult.location : '❌ NOT FOUND'}`);
  } catch (e) {
    result.detections.sitemapActuallyExists = null;
    console.log(`   Sitemap Actual Check: ⚠️ Could not check (${e.message})`);
  }

  // Stage 4: FAQ Detection
  console.log('\n📝 STAGE 3: FAQ Content Detection');
  console.log('────────────────────────────────');

  const faqs = evidence.content?.faqs || [];
  result.detections.visibleFAQCount = faqs.length;
  result.detections.faqSchemaCount = faqs.filter(f => f.source === 'schema').length;
  result.detections.faqHTMLCount = faqs.filter(f => f.source === 'html' || f.source === 'details' || f.source === 'heading').length;

  console.log(`   Total FAQs Found: ${faqs.length}`);
  console.log(`   ├─ From Schema: ${result.detections.faqSchemaCount}`);
  console.log(`   └─ From HTML/Details/Headings: ${result.detections.faqHTMLCount}`);

  if (faqs.length > 0) {
    console.log(`\n   Sample FAQs:`);
    faqs.slice(0, 3).forEach((faq, idx) => {
      const q = faq.question.substring(0, 60) + (faq.question.length > 60 ? '...' : '');
      console.log(`   ${idx + 1}. [${faq.source}] ${q}`);
    });
  }

  // Stage 5: Blog/Content Section Detection
  console.log('\n📰 STAGE 4: Blog/Content Section Detection');
  console.log('────────────────────────────────');

  const html = evidence.html || '';
  result.detections.blogLinkInNav = detectBlogLink(html);
  result.detections.hasArticleTag = html.includes('<article');
  result.detections.hasBlogKeyword = html.toLowerCase().includes('blog');

  console.log(`   Blog Link in Nav: ${result.detections.blogLinkInNav ? '✅' : '❌'}`);
  console.log(`   Has <article> tag: ${result.detections.hasArticleTag ? '✅' : '❌'}`);
  console.log(`   Contains "blog" keyword: ${result.detections.hasBlogKeyword ? '✅' : '❌'}`);

  // Stage 6: Question-Based Headings
  console.log('\n❓ STAGE 5: Question-Based Headings');
  console.log('────────────────────────────────');

  const headings = evidence.content?.headings || {};
  const allHeadings = [
    ...(headings.h1 || []),
    ...(headings.h2 || []),
    ...(headings.h3 || []),
    ...(headings.h4 || [])
  ];

  const questionWords = ['what', 'why', 'how', 'when', 'where', 'who', 'which', 'can', 'should', 'does', 'is', 'are'];
  const questionHeadings = allHeadings.filter(h => {
    const lower = h.toLowerCase();
    return questionWords.some(q => lower.startsWith(q)) || lower.includes('?');
  });

  result.detections.totalHeadings = allHeadings.length;
  result.detections.questionHeadingsCount = questionHeadings.length;
  result.detections.questionHeadingsPercent = allHeadings.length > 0
    ? Math.round((questionHeadings.length / allHeadings.length) * 100)
    : 0;

  console.log(`   Total Headings: ${allHeadings.length}`);
  console.log(`   Question Headings: ${questionHeadings.length} (${result.detections.questionHeadingsPercent}%)`);

  if (questionHeadings.length > 0) {
    console.log(`   Sample Question Headings:`);
    questionHeadings.slice(0, 3).forEach((h, idx) => {
      console.log(`   ${idx + 1}. ${h.substring(0, 60)}${h.length > 60 ? '...' : ''}`);
    });
  }

  // Stage 7: Geo/Location Detection
  console.log('\n🌍 STAGE 6: Geographic Data Detection');
  console.log('────────────────────────────────');

  result.detections.hasGeoMeta = !!(evidence.metadata?.geoRegion || evidence.metadata?.geoPlacename);
  result.detections.geoRegion = evidence.metadata?.geoRegion || null;
  result.detections.geoPlacename = evidence.metadata?.geoPlacename || null;

  console.log(`   Geo Meta Tags: ${result.detections.hasGeoMeta ? '✅' : '❌'}`);
  console.log(`   Geo Region: ${result.detections.geoRegion || 'Not found'}`);
  console.log(`   Geo Placename: ${result.detections.geoPlacename || 'Not found'}`);

  // Check for geo in schema
  const hasGeoInSchema = hasNestedSchema(structuredData, 'GeoCoordinates') || hasNestedSchema(structuredData, 'Place');
  console.log(`   Geo in Schema: ${hasGeoInSchema ? '✅' : '❌'}`);

  // Stage 8: Issue Detection Pipeline
  console.log('\n🔍 STAGE 7: Issue Detection');
  console.log('────────────────────────────────');

  // Transform evidence for issue detector
  const v5Scores = transformToV5Scores(evidence);
  const issues = detectPageIssues(v5Scores, evidence);

  result.issues = issues.slice(0, 10); // Keep top 10 issues

  console.log(`   Issues Detected: ${issues.length}`);
  if (issues.length > 0) {
    console.log(`   Top 5 Issues:`);
    issues.slice(0, 5).forEach((issue, idx) => {
      console.log(`   ${idx + 1}. [${issue.category}/${issue.subfactor}] Score: ${issue.currentScore}, Threshold: ${issue.threshold}, Gap: ${issue.gap}`);
    });
  }

  // Compare expected vs actual
  console.log('\n📋 COMPARISON: Expected vs Actual');
  console.log('────────────────────────────────');

  for (const [feature, expected] of Object.entries(testCase.expectedDetections)) {
    if (expected === null) continue; // Skip features we're just discovering

    const actual = result.detections[feature];
    const match = actual === expected;

    result.total++;
    if (match) {
      result.passed++;
      console.log(`   ✅ ${feature}: expected=${expected}, actual=${actual}`);
    } else {
      result.failed++;
      console.log(`   ❌ ${feature}: expected=${expected}, actual=${actual}`);
    }
  }

  console.log(`\n   Result: ${result.passed}/${result.total} passed, ${result.failed} failed`);

  return result;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function findNestedSchemaTypes(obj, types = []) {
  if (!obj || typeof obj !== 'object') return types;

  if (obj['@type']) {
    const type = Array.isArray(obj['@type']) ? obj['@type'][0] : obj['@type'];
    if (!types.includes(type)) {
      types.push(type);
    }
  }

  for (const key of Object.keys(obj)) {
    if (key !== '@type' && obj[key] && typeof obj[key] === 'object') {
      if (Array.isArray(obj[key])) {
        obj[key].forEach(item => findNestedSchemaTypes(item, types));
      } else {
        findNestedSchemaTypes(obj[key], types);
      }
    }
  }

  return types;
}

function hasNestedSchema(structuredData, schemaType) {
  for (const schema of structuredData) {
    const types = findNestedSchemaTypes(schema.raw);
    if (types.includes(schemaType)) {
      return true;
    }
  }
  return false;
}

async function checkSitemapDirectly(baseUrl) {
  const axios = require('axios');
  const urlObj = new URL(baseUrl);

  const sitemapLocations = [
    'sitemap.xml',
    'sitemap_index.xml',
    'sitemap-index.xml',
    'wp-sitemap.xml',
    'sitemap1.xml'
  ];

  for (const location of sitemapLocations) {
    const sitemapUrl = `${urlObj.protocol}//${urlObj.host}/${location}`;
    try {
      const response = await axios.head(sitemapUrl, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
        },
        validateStatus: status => status < 400
      });

      if (response.status === 200) {
        return { exists: true, location: location };
      }
    } catch (e) {
      // Continue to next location
    }
  }

  return { exists: false, location: null };
}

function detectBlogLink(html) {
  // Look for blog links in navigation
  const patterns = [
    /<nav[^>]*>[\s\S]*?<a[^>]*href=["'][^"']*blog[^"']*["'][^>]*>/i,
    /<header[^>]*>[\s\S]*?<a[^>]*href=["'][^"']*blog[^"']*["'][^>]*>/i,
    /<a[^>]*class=["'][^"']*nav[^"']*["'][^>]*href=["'][^"']*blog[^"']*["']/i
  ];

  return patterns.some(p => p.test(html));
}

function transformToV5Scores(evidence) {
  // Create a simplified V5 scores object for issue detection
  const technical = evidence.technical || {};
  const content = evidence.content || {};
  const media = evidence.media || {};

  return {
    aiReadability: {
      altTextScore: media.imageCount > 0 ? (media.imagesWithAlt / media.imageCount) * 100 : 100,
      captionsTranscriptsScore: 50,
      interactiveAccessScore: 50,
      crossMediaScore: 50
    },
    aiSearchReadiness: {
      questionHeadingsScore: 30, // Will need to calculate
      scannabilityScore: content.lists?.length > 0 ? 70 : 30,
      readabilityScore: 60,
      faqSchemaScore: technical.hasFAQSchema ? 100 : 0,
      faqContentScore: (content.faqs?.length || 0) > 0 ? 80 : 0,
      snippetEligibleScore: 50,
      pillarPagesScore: content.wordCount > 1500 ? 70 : 30,
      linkedSubpagesScore: 50,
      painPointsScore: 50,
      geoContentScore: evidence.metadata?.geoRegion ? 70 : 30
    },
    contentFreshness: {
      lastUpdatedScore: evidence.metadata?.lastModified ? 70 : 30,
      versioningScore: 50,
      timeSensitiveScore: 50,
      auditProcessScore: 50,
      liveDataScore: 50,
      httpFreshnessScore: 50,
      editorialCalendarScore: 50
    },
    contentStructure: {
      headingHierarchyScore: 60,
      navigationScore: 50,
      entityCuesScore: 50,
      accessibilityScore: 60,
      geoMetaScore: evidence.metadata?.geoRegion ? 80 : 30
    },
    speedUX: {
      lcpScore: 60,
      clsScore: 60,
      inpScore: 60,
      mobileScore: technical.hasViewport ? 80 : 40,
      crawlerResponseScore: 70
    },
    technicalSetup: {
      crawlerAccessScore: 80,
      structuredDataScore: technical.structuredData?.length > 0 ? 70 : 20,
      canonicalHreflangScore: technical.hasCanonical ? 80 : 30,
      openGraphScore: evidence.metadata?.ogTitle ? 80 : 30,
      sitemapScore: technical.hasSitemapLink ? 100 : 20,
      indexNowScore: 0,
      rssFeedScore: technical.hasRSSFeed ? 100 : 0
    },
    trustAuthority: {
      authorBiosScore: evidence.metadata?.author ? 70 : 30,
      certificationsScore: 40,
      domainAuthorityScore: 50,
      thoughtLeadershipScore: 50,
      thirdPartyProfilesScore: 40
    },
    voiceOptimization: {
      longTailScore: 50,
      localIntentScore: evidence.metadata?.geoRegion ? 70 : 30,
      conversationalTermsScore: 50,
      snippetFormatScore: 50,
      multiTurnScore: 50
    }
  };
}

function printSummary(results) {
  console.log('\n\n═══════════════════════════════════════════════════════════════════');
  console.log('                         AUDIT SUMMARY                              ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let totalPassed = 0;
  let totalFailed = 0;

  console.log('Site Results:');
  console.log('─────────────');

  for (const result of results) {
    if (result.error) {
      console.log(`  ❌ ${result.site}: ERROR - ${result.error}`);
    } else {
      const status = result.failed === 0 ? '✅' : '⚠️';
      console.log(`  ${status} ${result.site}: ${result.passed}/${result.total} passed`);
      totalPassed += result.passed;
      totalFailed += result.failed;
    }
  }

  const total = totalPassed + totalFailed;
  const failureRate = total > 0 ? ((totalFailed / total) * 100).toFixed(1) : 0;

  console.log(`\nOverall Statistics:`);
  console.log('───────────────────');
  console.log(`  Total Tests: ${total}`);
  console.log(`  Passed: ${totalPassed}`);
  console.log(`  Failed: ${totalFailed}`);
  console.log(`  Failure Rate: ${failureRate}%`);

  // Key Findings
  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log('                       KEY FINDINGS                                 ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Analyze common issues
  const commonIssues = {};

  for (const result of results) {
    if (result.error) continue;

    // Check sitemap detection
    if (result.detections.sitemapActuallyExists && !result.detections.sitemap) {
      commonIssues['sitemap_not_detected'] = (commonIssues['sitemap_not_detected'] || 0) + 1;
    }

    // Check schema detection
    if (result.detections.postalAddressSchema || result.detections.geoCoordinatesSchema) {
      if (!result.detections.localBusinessSchema && !result.detections.organizationSchema) {
        commonIssues['nested_schema_found_parent_not_detected'] = (commonIssues['nested_schema_found_parent_not_detected'] || 0) + 1;
      }
    }

    // Check FAQ detection
    if (result.detections.visibleFAQCount === 0 && result.detections.faqSchemaCount === 0) {
      commonIssues['no_faq_detected'] = (commonIssues['no_faq_detected'] || 0) + 1;
    }
  }

  if (Object.keys(commonIssues).length > 0) {
    console.log('Detected Issues:');
    for (const [issue, count] of Object.entries(commonIssues)) {
      console.log(`  - ${issue}: ${count} site(s)`);
    }
  }

  // Detection Details from all sites
  console.log('\nDetection Details by Site:');
  console.log('──────────────────────────');

  for (const result of results) {
    if (result.error) continue;

    console.log(`\n  ${result.site}:`);
    console.log(`    Sitemap: Detected=${result.detections.sitemap}, Actually Exists=${result.detections.sitemapActuallyExists}`);
    console.log(`    Schema Types: Org=${result.detections.organizationSchema}, FAQ=${result.detections.faqSchema}, LocalBiz=${result.detections.localBusinessSchema}`);
    console.log(`    Nested Schema: PostalAddress=${result.detections.postalAddressSchema}, GeoCoordinates=${result.detections.geoCoordinatesSchema}`);
    console.log(`    FAQs: Total=${result.detections.visibleFAQCount}, Schema=${result.detections.faqSchemaCount}, HTML=${result.detections.faqHTMLCount}`);
    console.log(`    Question Headings: ${result.detections.questionHeadingsCount}/${result.detections.totalHeadings} (${result.detections.questionHeadingsPercent}%)`);
    console.log(`    Geo: Meta=${result.detections.hasGeoMeta}, InSchema=${result.detections.geoCoordinatesSchema || result.detections.placeSchema}`);
    console.log(`    Issues Detected: ${result.issues.length}`);

    if (result.issues.length > 0) {
      console.log(`    Top Issues:`);
      result.issues.slice(0, 3).forEach(issue => {
        console.log(`      - ${issue.category}/${issue.subfactor}: score=${issue.currentScore}, threshold=${issue.threshold}`);
      });
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`Completed: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

// ============================================
// RUN THE AUDIT
// ============================================

runDetectionAudit().then(results => {
  console.log('\nAudit complete!');
  process.exit(0);
}).catch(error => {
  console.error('Audit failed:', error);
  process.exit(1);
});
