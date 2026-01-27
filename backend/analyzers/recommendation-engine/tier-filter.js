/**
 * TIER FILTER - Part 4 (Final)
 * File: backend/analyzers/recommendation-engine/tier-filter.js
 * 
 * Formats recommendation output based on user's plan tier.
 * Controls what information each tier can access.
 */

// ========================================
// TIER LIMITS
// ========================================

const TIER_LIMITS = {
  guest: {
    maxRecommendations: 0,  // Anonymous - NO recommendations shown
    showCodeSnippets: false,
    showEvidence: false,
    showFAQ: false,
    showPDF: false,
    detailLevel: 'basic',
    upgradeMessage: 'Sign up free to unlock your top 3 recommendations'
  },
  free: {
    maxRecommendations: 3,  // Registered - Top 3 only
    showCodeSnippets: false,
    showEvidence: false,
    showFAQ: false,
    showPDF: false,
    detailLevel: 'basic',
    upgradeMessage: 'Upgrade to DIY for deep scans, personalized code, and daily recommendations'
  },
  diy: {
    maxRecommendations: 5,           // Model A: cap of 5 active recommendations
    showCodeSnippets: true,
    showEvidence: true,
    showFAQ: true,
    showPDF: true,
    detailLevel: 'detailed',
    pagesPerScan: 5
  },
  pro: {
    maxRecommendations: 8,   // Model A: cap of 8 active recommendations
    showCodeSnippets: true,
    showEvidence: true,
    showFAQ: true,
    showPDF: true,
    detailLevel: 'comprehensive',
    pagesPerScan: 25
  }
};

// ========================================
// MAIN FILTER FUNCTION
// ========================================

function filterByTier(recommendations, customizedFAQ, tier = 'free', metadata = {}, userProgress = null) {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.guest;

  // Ensure recommendations is an array
  const recs = Array.isArray(recommendations) ? recommendations : [];

  // Sort by priority score (highest first)
  const sortedRecs = [...recs].sort((a, b) => b.priorityScore - a.priorityScore);

  // Model A: Determine how many recommendations to show based on tier cap
  // No progressive unlock - all paid tiers use cap-based filtering
  let limitedRecs;
  let activeCount = 0;

  if (tier === 'guest') {
    // Guest - NO recommendations
    limitedRecs = [];
  } else if (tier === 'free') {
    // Free - Top 3 only
    limitedRecs = sortedRecs.slice(0, 3);
    activeCount = limitedRecs.length;
  } else {
    // DIY, Pro, Agency, Enterprise - Apply cap from limits
    const cap = limits.maxRecommendations || recs.length;
    limitedRecs = sortedRecs.slice(0, cap);
    activeCount = limitedRecs.length;
  }

  // Filter each recommendation based on tier
  const filteredRecs = limitedRecs.map(rec => filterRecommendation(rec, limits));

  // Build tier-specific response (Model A: no unlock timing info)
  return {
    tier: tier,
    limits: {
      recommendationsShown: filteredRecs.length,
      recommendationsAvailable: recs.length,
      hasMoreRecommendations: tier === 'guest' ? true : (recs.length > filteredRecs.length),
      activeRecommendations: activeCount,
      cap: limits.maxRecommendations || null
    },
    recommendations: filteredRecs,
    faq: filterFAQ(customizedFAQ, limits),
    upgrade: getUpgradeCTA(tier, recs.length, customizedFAQ, limits),
    features: getTierFeatures(tier),
    metadata: metadata
  };
}

// Model A: Batch unlock helpers removed - no cooldown period
// canUnlockMore and getDaysUntilNextUnlock are deprecated
// Recommendations now refill immediately when skip/implement actions are taken

function filterRecommendation(rec, limits) {
  const filtered = {
    id: rec.id,
    title: rec.title,
    category: rec.category,
    priority: rec.priority,
    finding: rec.finding,
    impact: rec.impact,
    actionSteps: rec.actionSteps,
    estimatedTime: rec.estimatedTime,
    difficulty: rec.difficulty,
    estimatedScoreGain: rec.estimatedScoreGain,
    currentScore: rec.currentScore,
    targetScore: rec.targetScore,
    // ✅ CRITICAL FIX: Include structured fields for colored boxes
    customizedImplementation: rec.customizedImplementation || null,
    readyToUseContent: rec.readyToUseContent || null,
    implementationNotes: rec.implementationNotes || null,
    quickWins: rec.quickWins || null,
    validationChecklist: rec.validationChecklist || null
  };

  // Add code snippets for paid tiers only
  if (limits.showCodeSnippets && rec.codeSnippet) {
    filtered.codeSnippet = rec.codeSnippet;
  } else if (!limits.showCodeSnippets && rec.codeSnippet) {
    filtered.codeSnippetAvailable = true;
    filtered.upgradeMessage = 'Upgrade to DIY for copy-paste code';
  }

  // Add evidence for paid tiers only
  if (limits.showEvidence && rec.evidence) {
    filtered.evidence = rec.evidence;
  }

  filtered.detailLevel = limits.detailLevel;

  return filtered;
}

function filterFAQ(faq, limits) {
  if (!faq) return null;
  
  if (!limits.showFAQ) {
    return {
      available: true,
      message: 'Customized FAQ schema available with DIY plan',
      preview: faq.faqs?.[0]?.question || null
    };
  }
  
  return faq;
}

function getUpgradeCTA(tier, totalRecommendations, faq, limits) {
  if (tier === 'guest') {
    return {
      show: true,
      title: 'Sign up free to unlock your top 3 recommendations',
      message: `Get instant access to ${Math.min(3, totalRecommendations)} personalized recommendations to improve your AI visibility.`,
      benefits: [
        'Top 3 priority recommendations',
        'Detailed findings for each issue',
        'Action steps to fix problems',
        'Track your progress over time'
      ],
      cta: 'Sign Up Free',
      ctaUrl: '/auth.html?mode=signup',
      tier: 'free'
    };
  }

  if (tier === 'free') {
    return {
      show: true,
      title: 'Upgrade to DIY for deep scans, personalized code, and more recommendations',
      message: `You're seeing 3 of ${totalRecommendations} recommendations. Upgrade to DIY Starter for the complete picture.`,
      benefits: [
        '5 active recommendations at a time',
        '5-page deep scans (vs 1 page)',
        'Copy-paste ready code snippets',
        'Industry-specific FAQ schema',
        'PDF export capabilities',
        'Unlimited scans per month'
      ],
      cta: 'Upgrade to DIY - $29/month',
      ctaUrl: '/checkout.html?plan=diy',
      tier: 'diy'
    };
  }

  if (tier === 'diy') {
    return {
      show: true,
      title: 'Coming Soon: Pro Tier with Triple Score Analysis',
      message: 'Be first to access Brand Visibility Index and Competitive Analysis.',
      benefits: [
        '25-page comprehensive scans (vs 5)',
        'AI Visibility Score',
        'Brand Visibility Index (NEW)',
        'Competitive Analysis (vs 3 competitors)',
        '10 active recommendations (vs 5)',
        'Priority support'
      ],
      cta: 'Join Pro Waitlist - $99/month',
      ctaUrl: '/waitlist.html?plan=pro',
      tier: 'pro',
      comingSoon: true
    };
  }

  return null;
}

function getTierFeatures(tier) {
  const features = {
    guest: {
      scansPerMonth: 'Unlimited',
      pagesPerScan: 1,
      recommendationsShown: 0,
      codeSnippets: false,
      faqSchema: false,
      pdfExport: false,
      tracking: false,
      description: 'Anonymous - Score only'
    },
    free: {
      scansPerMonth: 2,
      pagesPerScan: 1,
      recommendationsShown: 3,
      codeSnippets: false,
      faqSchema: false,
      pdfExport: false,
      tracking: true,
      description: 'Registered - Top 3 recommendations'
    },
    diy: {
      scansPerMonth: 25,
      pagesPerScan: 5,
      maxActiveRecommendations: 5,
      codeSnippets: true,
      faqSchema: true,
      pdfExport: true,
      tracking: true,
      description: 'DIY - 5 active recommendations + code'
    },
    pro: {
      scansPerMonth: 50,
      pagesPerScan: 25,
      recommendationsShown: 'All',
      codeSnippets: true,
      faqSchema: true,
      pdfExport: true,
      tracking: true,
      brandVisibility: true,
      competitorAnalysis: true,
      description: 'Pro - Triple Score Analysis'
    }
  };

  return features[tier] || features.guest;
}

// ========================================
// SUMMARY GENERATION
// ========================================

function generateSummary(recommendations, faq, tier) {
  const recs = Array.isArray(recommendations) ? recommendations : [];
  const critical = recs.filter(r => r.priority === 'critical' || r.priority === 'high');
  const totalScoreGain = recs.reduce((sum, r) => sum + (r.estimatedScoreGain || 0), 0);
  
  return {
    overallStatus: getOverallStatus(recs),
    criticalIssues: critical.length,
    totalRecommendations: recs.length,
    potentialScoreGain: Math.round(totalScoreGain),
    topPriorities: critical.slice(0, 3).map(r => r.title),
    estimatedTimeToImplement: calculateTotalTime(recs),
    hasFAQ: !!faq,
    tier: tier
  };
}

function getOverallStatus(recommendations) {
  const recs = Array.isArray(recommendations) ? recommendations : [];
  const critical = recs.filter(r => r.priority === 'critical').length;
  const high = recs.filter(r => r.priority === 'high').length;
  
  if (critical > 3) return 'needs_immediate_attention';
  if (critical > 0 || high > 5) return 'needs_improvement';
  if (high > 0) return 'good_with_opportunities';
  return 'excellent';
}

function calculateTotalTime(recommendations) {
  const recs = Array.isArray(recommendations) ? recommendations : [];
  let totalHours = 0;
  
  for (const rec of recs) {
    if (rec.estimatedTime) {
      const match = rec.estimatedTime.match(/(\d+)(?:-(\d+))?\s*hour/i);
      if (match) {
        const min = parseInt(match[1]);
        const max = match[2] ? parseInt(match[2]) : min;
        totalHours += (min + max) / 2;
      }
    }
  }
  
  if (totalHours < 8) return `${Math.round(totalHours)} hours`;
  if (totalHours < 40) return `${Math.round(totalHours / 8)} days`;
  return `${Math.round(totalHours / 40)} weeks`;
}

// ========================================
// FORMATTING HELPERS
// ========================================

function formatForAPI(filteredResults) {
  return {
    success: true,
    tier: filteredResults.tier,
    summary: generateSummary(
      filteredResults.recommendations,
      filteredResults.faq,
      filteredResults.tier
    ),
    data: filteredResults,
    timestamp: new Date().toISOString()
  };
}

function formatForPDF(filteredResults) {
  if (!TIER_LIMITS[filteredResults.tier].showPDF) {
    return null;
  }
  
  return {
    title: 'AI Visibility Score Report',
    tier: filteredResults.tier,
    summary: generateSummary(
      filteredResults.recommendations,
      filteredResults.faq,
      filteredResults.tier
    ),
    recommendations: filteredResults.recommendations,
    faq: filteredResults.faq,
    metadata: filteredResults.metadata,
    generatedAt: new Date().toISOString()
  };
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  filterByTier,
  generateSummary,
  formatForAPI,
  formatForPDF,
  TIER_LIMITS
};