/**
 * RECOMMENDATION GENERATOR - Main Orchestrator (HYBRID SYSTEM)
 * File: backend/analyzers/recommendation-generator.js
 */

const { detectPageIssues, detectMultiPageIssues } = require('./recommendation-engine/issue-detector');
const { generateRecommendations } = require('./recommendation-engine/rec-generator');
const { generateCustomizedFAQ } = require('./recommendation-engine/faq-customizer');
const { filterByTier, formatForAPI } = require('./recommendation-engine/tier-filter');
const { generateEliteRecommendations, prioritizeEliteRecommendations } = require('../utils/elite-recommendation-generator');
const { extractSiteFacts } = require('./recommendation-engine/fact-extractor');

async function generateCompleteRecommendations(scanResults, tier = 'free', industry = null, userProgress = null, mode = 'optimization') {
  try {
    console.log(`🎯 Generating recommendations for tier: ${tier}, mode: ${mode}`);

    const { v5Scores, scanEvidence, scannedPages } = scanResults;

    // ELITE MODE: Use different recommendation strategy
    if (mode === 'elite') {
      console.log('🌟 Elite mode: Generating competitive positioning recommendations...');

      const eliteRecs = await generateEliteRecommendations(
        null, // scanId not needed at generation time
        scanEvidence,
        v5Scores,
        null // totalScore calculated later
      );

      const prioritizedEliteRecs = prioritizeEliteRecommendations(eliteRecs);

      console.log(`   Generated ${prioritizedEliteRecs.length} elite recommendations`);

      // Skip FAQ generation for elite mode (focus on competitive positioning)
      const eliteResults = {
        recommendations: prioritizedEliteRecs,
        faq: null,
        summary: {
          totalRecommendations: prioritizedEliteRecs.length,
          mode: 'elite',
          highPriorityCount: prioritizedEliteRecs.filter(r => r.priority >= 85).length,
          categories: {
            competitive_intelligence: prioritizedEliteRecs.filter(r => r.category === 'Competitive Intelligence').length,
            content_opportunities: prioritizedEliteRecs.filter(r => r.category === 'Content Opportunities').length,
            advanced_optimization: prioritizedEliteRecs.filter(r => r.category === 'Advanced Optimization').length,
            maintenance: prioritizedEliteRecs.filter(r => r.category === 'Maintenance & Monitoring').length
          }
        }
      };

      return formatForAPI(eliteResults);
    }

    // OPTIMIZATION MODE: Standard issue-based recommendations
    console.log('🔧 Optimization mode: Generating foundation-building recommendations...');

    // STEP 0: Extract site facts to get FAQ/Blog detection (RULEBOOK v1.2)
    console.log('🔎 Step 0: Extracting site facts for FAQ/Blog detection...');

    // Ensure scanEvidence exists before extracting facts
    if (!scanEvidence || Object.keys(scanEvidence).length === 0) {
      console.warn('   ⚠️ No scanEvidence provided, skipping fact extraction');
    }

    const { detected_profile, extracted_facts, diagnostics } = extractSiteFacts(scanEvidence || {});

    // Merge detected_profile and extracted_facts into scanEvidence for use by rec-generator
    const enrichedScanEvidence = {
      ...scanEvidence,
      detected_profile,
      extracted_facts,
      diagnostics
    };

    console.log(`   FAQ detected: ${detected_profile.sections?.has_faq || false}`);
    console.log(`   Blog detected: ${detected_profile.sections?.has_blog || false}`);

    // STEP 1: Detect all issues
    console.log('🔍 Step 1: Detecting issues...');
    let allIssues;

    if (tier === 'guest' || tier === 'free') {
      allIssues = detectPageIssues(v5Scores, enrichedScanEvidence);
      console.log(`   Found ${allIssues.length} issues on homepage`);
    } else {
      if (scannedPages && Array.isArray(scannedPages) && scannedPages.length > 0) {
        const multiPageResult = detectMultiPageIssues(scannedPages);
        allIssues = multiPageResult.pageBreakdown[0].issues; // Use first page's issues
        console.log(`   Found ${multiPageResult.totalIssues} issues across ${multiPageResult.totalPages} pages`);
      } else {
        allIssues = detectPageIssues(v5Scores, enrichedScanEvidence);
        console.log(`   Found ${allIssues.length} issues on homepage (single page mode)`);
      }
    }

    // STEP 2: Generate recommendations (HYBRID: top 5 AI, rest templates)
    console.log('💡 Step 2: Generating recommendations (Hybrid Mode)...');
    const recommendations = await generateRecommendations(
      allIssues,
      enrichedScanEvidence,  // Use enriched evidence with detected_profile
      tier === 'guest' ? 'free' : tier, // Use free tier logic for guest
      industry
    );
    console.log(`   Generated ${recommendations.length} total recommendations`);

    // STEP 3: Generate customized FAQ (DIY+ only)
    console.log('❓ Step 3: Generating FAQ...');
    let customizedFAQ = null;
    if (tier !== 'free' && tier !== 'guest' && industry) {
      try {
        customizedFAQ = await generateCustomizedFAQ(industry, enrichedScanEvidence);
        console.log(`   Generated ${customizedFAQ.faqCount} customized FAQs`);
      } catch (error) {
        console.error('   ⚠️  FAQ generation failed:', error.message);
      }
    } else {
      console.log(`   ⏭️  Skipping FAQ (tier: ${tier})`);
    }

    // STEP 4: Filter and format by tier
    console.log('🎚️  Step 4: Applying tier filtering...');
    const filteredResults = filterByTier(recommendations, customizedFAQ, tier, {
      url: enrichedScanEvidence.url,
      scannedAt: new Date().toISOString()
    }, userProgress); // Pass userProgress for DIY progressive unlock
    console.log(`   Filtered to ${filteredResults.recommendations.length} recommendations for ${tier} tier`);

    // Return formatted results
    return formatForAPI(filteredResults);

  } catch (error) {
    console.error('❌ Error generating recommendations:', error);
    throw error;
  }
}

async function getPageRecommendations(pageScores, pageEvidence, tier = 'free') {
  const scanResults = {
    v5Scores: pageScores,
    scanEvidence: pageEvidence,
    scannedPages: [{ v5Scores: pageScores, evidence: pageEvidence }]
  };

  return generateCompleteRecommendations(scanResults, tier);
}

async function getMultiPageRecommendations(scannedPages, tier = 'diy', industry = null) {
  // Use first page's evidence as primary scanEvidence for fact extraction
  const primaryEvidence = scannedPages?.[0]?.evidence || scannedPages?.[0]?.scanEvidence || {};
  const primaryScores = scannedPages?.[0]?.v5Scores || {};

  const scanResults = {
    v5Scores: primaryScores,
    scanEvidence: primaryEvidence,
    scannedPages: scannedPages
  };

  return generateCompleteRecommendations(scanResults, tier, industry);
}

module.exports = {
  generateCompleteRecommendations,
  getPageRecommendations,
  getMultiPageRecommendations
};