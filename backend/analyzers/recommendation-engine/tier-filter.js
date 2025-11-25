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
    maxRecommendationsPerUnlock: 5,  // Progressive unlock - 5 every 5 days
    unlockIntervalDays: 5,           // Unlock interval: 5 days
    progressiveUnlock: true,
    showCodeSnippets: true,
    showEvidence: true,
    showFAQ: true,
    showPDF: true,
    detailLevel: 'detailed',
    pagesPerScan: 5
  },
  pro: {
    maxRecommendations: 300,  // All recommendations immediately
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

  // Determine how many recommendations to show based on tier
  let limitedRecs;
  let activeCount = 0;

  if (tier === 'diy' && limits.progressiveUnlock) {
    // DIY tier with progressive unlock
    if (userProgress && userProgress.active_recommendations > 0) {
      // Use saved progress if valid
      activeCount = userProgress.active_recommendations;
    } else {
      // First scan OR corrupted data - default to 5 recommendations
      activeCount = limits.maxRecommendationsPerUnlock || 5;
      console.log(`⚠️ DIY tier: No valid userProgress, defaulting to ${activeCount} recommendations`);
    }
    limitedRecs = sortedRecs.slice(0, activeCount);
  } else if (tier === 'guest') {
    // Guest - NO recommendations
    limitedRecs = [];
  } else if (tier === 'free') {
    // Free - Top 3 only
    limitedRecs = sortedRecs.slice(0, 3);
  } else {
    // Pro - All recommendations
    limitedRecs = sortedRecs.slice(0, limits.maxRecommendations || recs.length);
  }

  // Filter each recommendation based on tier
  const filteredRecs = limitedRecs.map(rec => filterRecommendation(rec, limits));

  // Build tier-specific response
  return {
    tier: tier,
    limits: {
      recommendationsShown: filteredRecs.length,
      recommendationsAvailable: recs.length,
      hasMoreRecommendations: tier === 'guest' ? true : (recs.length > filteredRecs.length),
      activeRecommendations: activeCount,
      canUnlockMore: tier === 'diy' && userProgress ? canUnlockMore(userProgress) : false,
      daysUntilNextUnlock: tier === 'diy' && userProgress ? getDaysUntilNextUnlock(userProgress) : null
    },
    recommendations: filteredRecs,
    faq: filterFAQ(customizedFAQ, limits),
    upgrade: getUpgradeCTA(tier, recs.length, customizedFAQ, limits),
    features: getTierFeatures(tier),
    metadata: metadata
  };
}

// Helper function to check if user can unlock more recommendations (5-day interval)
function canUnlockMore(userProgress) {
  if (!userProgress) return false;

  const now = new Date();
  const lastUnlock = userProgress.last_unlock_date ? new Date(userProgress.last_unlock_date) : null;

  // If never unlocked before, can unlock
  if (!lastUnlock) {
    return true;
  }

  // Calculate days since last unlock
  const daysSinceLastUnlock = Math.floor((now - lastUnlock) / (1000 * 60 * 60 * 24));

  // Can unlock if 5 or more days have passed
  return daysSinceLastUnlock >= 5;
}

// Helper function to calculate days until next unlock
function getDaysUntilNextUnlock(userProgress) {
  if (!userProgress || !userProgress.last_unlock_date) {
    return 0; // Can unlock now
  }

  const now = new Date();
  const lastUnlock = new Date(userProgress.last_unlock_date);
  const daysSinceLastUnlock = Math.floor((now - lastUnlock) / (1000 * 60 * 60 * 24));

  if (daysSinceLastUnlock >= 5) {
    return 0; // Can unlock now
  }

  return 5 - daysSinceLastUnlock; // Days remaining
}

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
      title: 'Upgrade to DIY for deep scans, personalized code, and daily recommendations',
      message: `You're seeing 3 of ${totalRecommendations} recommendations. Upgrade to DIY Starter for the complete picture.`,
      benefits: [
        '5 new recommendations unlocked daily',
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
        'All recommendations unlocked immediately',
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
      scansPerMonth: 'Unlimited',
      pagesPerScan: 5,
      recommendationsPerUnlock: 5,
      unlockIntervalDays: 5,
      progressiveUnlock: true,
      codeSnippets: true,
      faqSchema: true,
      pdfExport: true,
      tracking: true,
      description: 'DIY - 5 recommendations every 5 days + code'
    },
    pro: {
      scansPerMonth: 'Unlimited',
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