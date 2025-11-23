// V2 shadow-mode scan runner. Mirrors V1 logic while enabling independent iteration.
const V2RubricEngine = require('./v2-rubric-engine');
const { generateCompleteRecommendationsV2 } = require('./v2-recommendation-engine');

function queueShadowScanV2(shadowArgs) {
  // Detach from response lifecycle to avoid impacting user experience
  setImmediate(() => {
    runShadowScanV2(shadowArgs).catch(error => {
      console.error(`[V2 Shadow] Non-blocking failure for ${shadowArgs.url}:`, error.message);
    });
  });
}

async function runShadowScanV2({ url, plan, pages, userProgress, userIndustry, mode = 'optimization', planLimits, v1Result }) {
  const shadowStart = Date.now();

  try {
    const shadowResult = await performV5ScanV2(url, plan, {
      pages,
      userProgress,
      userIndustry,
      mode,
      planLimits
    });

    const payload = {
      url,
      durationMs: Date.now() - shadowStart,
      plan,
      mode,
      score: shadowResult.totalScore,
      recommendations: shadowResult.recommendations?.length || 0,
      faq: !!shadowResult.faq,
      planLimitPages: planLimits?.pagesPerScan || null
    };

    if (v1Result) {
      payload.v1Delta = {
        score: shadowResult.totalScore - v1Result.totalScore,
        recommendations: (shadowResult.recommendations?.length || 0) - (v1Result.recommendations?.length || 0)
      };
    }

    console.log('[V2 Shadow] Completed shadow scan', payload);
  } catch (error) {
    console.error(`[V2 Shadow] Shadow scan failed for ${url}:`, error.message);
  }
}

async function performV5ScanV2(url, plan, options = {}) {
  const {
    pages = null,
    userProgress = null,
    userIndustry = null,
    mode = 'optimization',
    planLimits = null
  } = options;

  console.log('🛰️  [V2 Shadow] Starting V2 pipeline for:', url);
  console.log(`🧭 [V2 Shadow] Mode: ${mode}, Plan: ${plan}`);

  try {
    const engine = new V2RubricEngine(url, {
      maxPages: planLimits?.pagesPerScan || 25,
      timeout: 10000,
      industry: userIndustry,
      pages
    });

    const v5Results = await engine.analyze();

    const categories = {
      aiReadability: v5Results.categories.aiReadability.score || 0,
      aiSearchReadiness: v5Results.categories.aiSearchReadiness.score || 0,
      contentFreshness: v5Results.categories.contentFreshness.score || 0,
      contentStructure: v5Results.categories.contentStructure.score || 0,
      speedUX: v5Results.categories.speedUX.score || 0,
      technicalSetup: v5Results.categories.technicalSetup.score || 0,
      trustAuthority: v5Results.categories.trustAuthority.score || 0,
      voiceOptimization: v5Results.categories.voiceOptimization.score || 0
    };

    const scanEvidence = engine.evidence || v5Results.evidence || {};

    if (v5Results.certificationData) {
      scanEvidence.certificationData = v5Results.certificationData;
    }

    const subfactorScores = transformV5ToSubfactorsV2(v5Results.categories);
    const finalIndustry = userIndustry || v5Results.industry || 'General';

    const recommendationResults = await generateCompleteRecommendationsV2(
      {
        v5Scores: subfactorScores,
        scanEvidence: scanEvidence
      },
      plan,
      finalIndustry,
      userProgress,
      mode
    );

    return {
      totalScore: v5Results.totalScore,
      categories,
      recommendations: recommendationResults.data.recommendations,
      faq: recommendationResults.data.faq || null,
      upgrade: recommendationResults.data.upgrade || null,
      industry: finalIndustry,
      metadata: {
        rubricVersion: 'V5-shadow',
        planLimits,
        pagesAnalyzed: Array.isArray(pages) ? pages.length : null
      }
    };
  } catch (error) {
    console.error(`[V2 Shadow] Error during V2 pipeline for ${url}:`, error);
    throw error;
  }
}

function transformV5ToSubfactorsV2(v5Categories) {
  const subfactors = {};

  if (v5Categories.aiReadability) {
    const ar = v5Categories.aiReadability;
    const aiReadability = ar.subfactors?.aiReadability || {};
    const clarity = ar.subfactors?.clarity || {};
    const structure = ar.subfactors?.structure || {};

    subfactors.aiReadability = {
      aiLanguagePatternsScore: (aiReadability.factors?.aiLanguagePatterns || 0) * 50,
      glossaryScore: (aiReadability.factors?.glossary || 0) * 50,
      readabilityScore: (clarity.factors?.readability || 0) * 50,
      contentDepthScore: (clarity.factors?.depth || 0) * 50,
      visualStructureScore: (structure.factors?.visualStructure || 0) * 50,
      chunkingScore: (structure.factors?.chunking || 0) * 50
    };
  }

  if (v5Categories.aiSearchReadiness) {
    const as = v5Categories.aiSearchReadiness;
    const queries = as.subfactors?.queryCoverage || {};
    const intent = as.subfactors?.intentMatching || {};

    subfactors.aiSearchReadiness = {
      queryCoverageScore: (queries.factors?.queryCoverage || 0) * 50,
      answerCoverageScore: (queries.factors?.answerCoverage || 0) * 50,
      intentAlignmentScore: (intent.factors?.intentAlignment || 0) * 50,
      entityCoverageScore: (intent.factors?.entityCoverage || 0) * 50
    };
  }

  if (v5Categories.contentFreshness) {
    const cf = v5Categories.contentFreshness;
    const updates = cf.subfactors?.contentUpdates || {};
    const cadence = cf.subfactors?.cadence || {};

    subfactors.contentFreshness = {
      updateFrequencyScore: (updates.factors?.updateFrequency || 0) * 50,
      recencyScore: (updates.factors?.recency || 0) * 50,
      cadenceConsistencyScore: (cadence.factors?.consistency || 0) * 50,
      evergreenScore: (cadence.factors?.evergreen || 0) * 50
    };
  }

  if (v5Categories.contentStructure) {
    const cs = v5Categories.contentStructure;
    const headings = cs.subfactors?.headings || {};
    const summaries = cs.subfactors?.summaries || {};
    const media = cs.subfactors?.media || {};

    subfactors.contentStructure = {
      headingDepthScore: (headings.factors?.headingDepth || 0) * 50,
      headingQualityScore: (headings.factors?.headingQuality || 0) * 50,
      summaryPresenceScore: (summaries.factors?.summaryPresence || 0) * 50,
      summaryQualityScore: (summaries.factors?.summaryQuality || 0) * 50,
      mediaDiversityScore: (media.factors?.mediaDiversity || 0) * 50,
      mediaSupportScore: (media.factors?.mediaSupport || 0) * 50
    };
  }

  if (v5Categories.speedUX) {
    const su = v5Categories.speedUX;
    const performance = su.subfactors?.performance || {};
    const ux = su.subfactors?.ux || {};

    subfactors.speedUX = {
      pageSpeedScore: (performance.factors?.pageSpeed || 0) * 50,
      responsivenessScore: (performance.factors?.responsiveness || 0) * 50,
      visualStabilityScore: (ux.factors?.visualStability || 0) * 50,
      mobileFriendlinessScore: (ux.factors?.mobileFriendly || 0) * 50,
      performanceBudgetScore: (performance.factors?.performanceBudget || 0) * 50,
      crawlerResponseScore: (su.crawlerResponse || 0) * 100
    };
  }

  if (v5Categories.technicalSetup) {
    const ts = v5Categories.technicalSetup;
    const crawler = ts.subfactors?.crawlerAccess || {};
    const structured = ts.subfactors?.structuredData || {};

    subfactors.technicalSetup = {
      crawlerAccessScore: (crawler.factors?.robotsTxt || 0) * 55.6,
      structuredDataScore: (structured.factors?.schemaMarkup || 0) * 55.6,
      canonicalHreflangScore: 50,
      openGraphScore: 50,
      sitemapScore: (crawler.factors?.sitemap || 0) * 55.6,
      indexNowScore: 50,
      rssFeedScore: 50
    };
  }

  if (v5Categories.trustAuthority) {
    const ta = v5Categories.trustAuthority;
    const eeat = ta.subfactors?.eeat || {};
    const authority = ta.subfactors?.authorityNetwork || {};

    subfactors.trustAuthority = {
      authorBiosScore: (eeat.factors?.authorProfiles || 0) * 50,
      certificationsScore: (eeat.factors?.credentials || 0) * 50,
      professionalCertifications: (eeat.factors?.professionalCertifications || 0) * 83.3,
      teamCredentials: (eeat.factors?.teamCredentials || 0) * 83.3,
      industryMemberships: (authority.factors?.industryMemberships || 0) * 83.3,
      domainAuthorityScore: (authority.factors?.domainAuthority || 0) * 33,
      thoughtLeadershipScore: (authority.factors?.thoughtLeadership || 0) * 33,
      thirdPartyProfilesScore: (authority.factors?.socialAuthority || 0) * 50
    };
  }

  if (v5Categories.voiceOptimization) {
    const vo = v5Categories.voiceOptimization;
    const conversational = vo.subfactors?.conversationalKeywords || {};
    const voice = vo.subfactors?.voiceSearch || {};

    subfactors.voiceOptimization = {
      longTailScore: (conversational.factors?.longTail || 0) * 83,
      localIntentScore: (conversational.factors?.localIntent || 0) * 83,
      conversationalTermsScore: (voice.factors?.conversationalFlow || 0) * 83,
      snippetFormatScore: (conversational.factors?.snippetOptimization || 0) * 83,
      multiTurnScore: (conversational.factors?.followUpQuestions || 0) * 83
    };
  }

  return subfactors;
}

module.exports = { queueShadowScanV2, runShadowScanV2, performV5ScanV2 };
