#!/usr/bin/env node

/**
 * Test Script for Enhanced V5 Rubric Engine
 *
 * Tests:
 * - Multi-page site crawling
 * - Site-wide metric aggregation
 * - Precise PDF scoring thresholds
 * - Enhanced entity analysis
 * - ICP-specific adjustments
 */

const V5EnhancedRubricEngine = require('./analyzers/v5-enhanced-rubric-engine');

// ========================================
// SAFE FORMATTING HELPERS
// ========================================

/**
 * Safely format a number with fixed decimal places.
 * Returns "n/a" if the value is undefined, null, NaN, or Infinity.
 * @param {*} num - The number to format
 * @param {number} digits - Number of decimal places (default: 1)
 * @returns {string} - Formatted number or "n/a"
 */
function fmt(num, digits = 1) {
  if (num === undefined || num === null || !Number.isFinite(num)) {
    return 'n/a';
  }
  return num.toFixed(digits);
}

/**
 * Safely format a number as a percentage.
 * Returns "n/a" if the value is undefined, null, NaN, or Infinity.
 * @param {*} num - The decimal number to format (0-1 range)
 * @returns {string} - Formatted percentage or "n/a"
 */
function pct(num) {
  if (num === undefined || num === null || !Number.isFinite(num)) {
    return 'n/a';
  }
  return Math.round(num * 100) + '%';
}

/**
 * Safely round a number.
 * Returns "n/a" if the value is undefined, null, NaN, or Infinity.
 * @param {*} num - The number to round
 * @returns {string|number} - Rounded number or "n/a"
 */
function safeRound(num) {
  if (num === undefined || num === null || !Number.isFinite(num)) {
    return 'n/a';
  }
  return Math.round(num);
}

async function testEnhancedRubric() {
  console.log('='.repeat(80));
  console.log('TESTING ENHANCED V5 RUBRIC ENGINE');
  console.log('='.repeat(80));
  console.log('');

  // Test URL - use a well-structured site
  const testUrl = process.argv[2] || 'https://www.mozilla.org';

  console.log(`Test URL: ${testUrl}`);
  console.log('');

  try {
    // Create engine instance
    const engine = new V5EnhancedRubricEngine(testUrl, {
      maxPages: 10, // Crawl 10 pages for testing
      timeout: 15000
    });

    console.log('[TEST] Starting enhanced analysis...');
    console.log('');

    const startTime = Date.now();

    // Run analysis
    const results = await engine.analyze();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('');
    console.log('='.repeat(80));
    console.log('RESULTS');
    console.log('='.repeat(80));
    console.log('');

    // Overall score
    console.log(`Total Score: ${results.totalScore}/100 (Grade: ${results.grade})`);
    console.log(`Pages Analyzed: ${results.pageCount}`);
    console.log(`Analysis Duration: ${duration}s`);
    console.log('');

    // Category scores
    console.log('Category Scores:');
    console.log('-'.repeat(80));

    const categories = [
      { name: 'AI Search Readiness', key: 'aiSearchReadiness' },
      { name: 'Content Structure', key: 'contentStructure' },
      { name: 'Voice Optimization', key: 'voiceOptimization' },
      { name: 'Technical Setup', key: 'technicalSetup' },
      { name: 'Trust & Authority', key: 'trustAuthority' },
      { name: 'AI Readability', key: 'aiReadability' },
      { name: 'Content Freshness', key: 'contentFreshness' },
      { name: 'Speed & UX', key: 'speedUX' }
    ];

    for (const cat of categories) {
      const categoryData = results.categories?.[cat.key];
      if (!categoryData) {
        console.log(`${cat.name.padEnd(25)} ${'░'.repeat(20)} n/a (missing category)`);
        continue;
      }
      const score = categoryData.score ?? 0;
      const weight = safeRound((categoryData.weight ?? 0) * 100);
      const weighted = safeRound(score * (categoryData.weight ?? 0));
      const barFilled = Number.isFinite(score) ? Math.round(score / 5) : 0;
      const bar = '█'.repeat(barFilled) + '░'.repeat(20 - barFilled);

      console.log(`${cat.name.padEnd(25)} ${bar} ${safeRound(score)}/100 (${weight}%) → ${weighted} points`);
    }

    console.log('');
    console.log('Site-Wide Metrics:');
    console.log('-'.repeat(80));

    const metrics = results.siteMetrics || {};

    console.log(`Question Headings:     ${pct(metrics.pagesWithQuestionHeadings)} of pages`);
    console.log(`FAQ Schema:            ${pct(metrics.pagesWithFAQSchema)} of pages`);
    console.log(`Good Alt Text:         ${pct(metrics.pagesWithGoodAltText)} of pages`);
    console.log(`Schema Markup:         ${pct(metrics.pagesWithSchema)} of pages`);
    console.log(`Proper H1:             ${pct(metrics.pagesWithProperH1)} of pages`);
    console.log(`Last Modified Date:    ${pct(metrics.pagesWithLastModified)} of pages`);
    console.log(`Current Year Content:  ${pct(metrics.pagesWithCurrentYear)} of pages`);
    console.log(``);
    console.log(`Avg Word Count:        ${safeRound(metrics.avgWordCount)} words`);
    console.log(`Avg Flesch Score:      ${safeRound(metrics.avgFleschScore)}`);
    console.log(`Avg Sentence Length:   ${safeRound(metrics.avgSentenceLength)} words`);
    console.log(`Avg Entities/Page:     ${safeRound(metrics.avgEntitiesPerPage)}`);
    console.log(`Pillar Pages:          ${metrics.pillarPageCount ?? 'n/a'}`);
    console.log(`Topic Cluster Coverage: ${pct(metrics.topicClusterCoverage)}`);

    console.log('');
    console.log('Detailed Category Breakdown:');
    console.log('-'.repeat(80));

    // Show AI Search Readiness details
    const aiSearch = results.categories?.aiSearchReadiness;
    console.log('\nAI Search Readiness (20%):');
    if (!aiSearch) {
      console.log('  (category missing)');
    } else {
      const directAnswer = aiSearch.subfactors?.directAnswerStructure;
      if (!directAnswer) {
        console.log('  Direct Answer Structure: n/a (subfactor missing)');
      } else {
        console.log(`  Direct Answer Structure: ${safeRound(directAnswer.score)}/100`);
        const factors = directAnswer.factors || {};
        if (factors.questionDensity === undefined) console.log('    [Missing factor: questionDensity]');
        console.log(`    - Question Density: ${fmt(factors.questionDensity)}/2.0 points`);
        if (factors.scannability === undefined) console.log('    [Missing factor: scannability]');
        console.log(`    - Scannability: ${fmt(factors.scannability)}/2.0 points`);
        if (factors.readability === undefined) console.log('    [Missing factor: readability]');
        console.log(`    - Readability: ${fmt(factors.readability)}/2.0 points`);
        if (factors.icpQA === undefined) console.log('    [Missing factor: icpQA]');
        console.log(`    - ICP Q&A: ${fmt(factors.icpQA)}/2.0 points`);
      }

      const topicalAuth = aiSearch.subfactors?.topicalAuthority;
      if (!topicalAuth) {
        console.log('  Topical Authority: n/a (subfactor missing)');
      } else {
        console.log(`  Topical Authority: ${safeRound(topicalAuth.score)}/100`);
        const factors = topicalAuth.factors || {};
        if (factors.pillarPages === undefined) console.log('    [Missing factor: pillarPages]');
        console.log(`    - Pillar Pages: ${fmt(factors.pillarPages)}/2.0 points`);
        if (factors.topicClusters === undefined) console.log('    [Missing factor: topicClusters]');
        console.log(`    - Topic Clusters: ${fmt(factors.topicClusters)}/2.0 points`);
      }
    }

    // Show Content Structure details
    const contentStruct = results.categories?.contentStructure;
    console.log('\nContent Structure & Entity Recognition (15%):');
    if (!contentStruct) {
      console.log('  (category missing)');
    } else {
      const semanticHTML = contentStruct.subfactors?.semanticHTML;
      const entityRecog = contentStruct.subfactors?.entityRecognition;
      console.log(`  Semantic HTML: ${semanticHTML ? safeRound(semanticHTML.score) + '/100' : 'n/a (subfactor missing)'}`);
      console.log(`  Entity Recognition: ${entityRecog ? safeRound(entityRecog.score) + '/100' : 'n/a (subfactor missing)'}`);
    }

    // Grade assessment
    console.log('');
    console.log('='.repeat(80));
    console.log('ASSESSMENT');
    console.log('='.repeat(80));
    console.log('');

    if (results.grade === 'A') {
      console.log('✅ EXCELLENT - AI-optimized leader');
      console.log('   This site is well-optimized for AI search engines and voice assistants.');
    } else if (results.grade === 'B') {
      console.log('✅ VERY GOOD - Strong AI readiness');
      console.log('   This site has strong AI optimization with room for improvement.');
    } else if (results.grade === 'C') {
      console.log('⚠️  GOOD - Adequate AI preparation');
      console.log('   This site has basic AI optimization but needs enhancements.');
    } else if (results.grade === 'D') {
      console.log('⚠️  FAIR - Needs significant improvement');
      console.log('   This site requires substantial work to be AI-ready.');
    } else {
      console.log('❌ POOR - Requires fundamental restructuring');
      console.log('   This site needs major overhaul for AI search optimization.');
    }

    console.log('');
    console.log('Critical Success Thresholds (from PDF Rubric):');
    const aiSearchScore = aiSearch?.score;
    const techSetupScore = results.categories?.technicalSetup?.score;
    const contentStructScore = contentStruct?.score;
    console.log(`  AI Search Readiness: ${aiSearchScore !== undefined ? safeRound(aiSearchScore) : 'n/a'}/100 (need 70+ for effective AI citation)`);
    console.log(`  Technical Setup: ${techSetupScore !== undefined ? safeRound(techSetupScore) : 'n/a'}/100 (need 67+ for reliable crawler access)`);
    console.log(`  Content Structure: ${contentStructScore !== undefined ? safeRound(contentStructScore) : 'n/a'}/100 (need 67+ for AI comprehension)`);

    console.log('');
    console.log('='.repeat(80));
    console.log('TEST COMPLETED SUCCESSFULLY');
    console.log('='.repeat(80));

    return results;

  } catch (error) {
    console.error('');
    console.error('='.repeat(80));
    console.error('TEST FAILED');
    console.error('='.repeat(80));
    console.error('');
    console.error('Error:', error.message);
    console.error('');
    console.error('Stack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testEnhancedRubric()
    .then(() => {
      console.log('');
      process.exit(0);
    })
    .catch(error => {
      console.error('Unhandled error:', error);
      process.exit(1);
    });
}

module.exports = { testEnhancedRubric };
