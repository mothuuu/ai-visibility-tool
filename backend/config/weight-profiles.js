// backend/config/weight-profiles.js
/**
 * WEIGHT PROFILES
 *
 * Per rulebook "Weight Override & Future-Proofing":
 * Defines different scoring weight profiles for various AI platforms and use cases.
 *
 * Profiles:
 * - default: Balanced weights for general AI visibility
 * - chatgpt: Optimized for ChatGPT/OpenAI
 * - perplexity: Optimized for Perplexity AI
 * - claude: Optimized for Claude/Anthropic
 * - searchgpt: Optimized for SearchGPT
 * - enterprise: Focus on authority and trust signals
 * - local: Focus on local business signals
 */

/**
 * Scoring categories and their subfactors
 */
const SCORING_CATEGORIES = {
  IDENTITY: 'identity',
  AUTHORITY: 'authority',
  CONTENT: 'content',
  TECHNICAL: 'technical',
  STRUCTURE: 'structure',
  ACCESSIBILITY: 'accessibility',
  FRESHNESS: 'freshness',
  LOCAL: 'local'
};

/**
 * Default weights (balanced)
 * Total should equal 100
 */
const DEFAULT_WEIGHTS = {
  // Category weights
  categories: {
    [SCORING_CATEGORIES.IDENTITY]: 15,
    [SCORING_CATEGORIES.AUTHORITY]: 15,
    [SCORING_CATEGORIES.CONTENT]: 25,
    [SCORING_CATEGORIES.TECHNICAL]: 15,
    [SCORING_CATEGORIES.STRUCTURE]: 10,
    [SCORING_CATEGORIES.ACCESSIBILITY]: 10,
    [SCORING_CATEGORIES.FRESHNESS]: 5,
    [SCORING_CATEGORIES.LOCAL]: 5
  },

  // Subfactor weights within categories (percentages of category weight)
  subfactors: {
    // Identity (15%)
    organizationSchema: 40,
    brandConsistency: 30,
    logoPresence: 15,
    socialProfiles: 15,

    // Authority (15%)
    authorInfo: 30,
    citations: 25,
    expertise: 25,
    trustSignals: 20,

    // Content (25%)
    headingStructure: 20,
    contentDepth: 25,
    faqPresence: 20,
    scannability: 20,
    uniqueness: 15,

    // Technical (15%)
    schemaMarkup: 35,
    metaDescription: 25,
    openGraph: 20,
    canonical: 10,
    sitemap: 10,

    // Structure (10%)
    semanticHtml: 40,
    navigation: 35,
    breadcrumbs: 15,
    internalLinks: 10,

    // Accessibility (10%)
    altText: 40,
    ariaLabels: 25,
    langAttribute: 20,
    skipLinks: 15,

    // Freshness (5%)
    lastModified: 50,
    dateReferences: 30,
    contentUpdates: 20,

    // Local (5%)
    localSchema: 40,
    addressPresence: 30,
    mapIntegration: 15,
    hoursAvailability: 15
  }
};

/**
 * Weight profiles for different AI platforms
 */
const WEIGHT_PROFILES = {
  // ==========================================
  // DEFAULT PROFILE
  // ==========================================
  default: {
    name: 'Default',
    description: 'Balanced weights for general AI visibility',
    version: '1.0',
    ...DEFAULT_WEIGHTS
  },

  // ==========================================
  // CHATGPT OPTIMIZED
  // ==========================================
  chatgpt: {
    name: 'ChatGPT Optimized',
    description: 'Weights optimized for ChatGPT and OpenAI models',
    version: '1.0',
    categories: {
      [SCORING_CATEGORIES.IDENTITY]: 10,
      [SCORING_CATEGORIES.AUTHORITY]: 20,    // Higher - ChatGPT values authority
      [SCORING_CATEGORIES.CONTENT]: 30,       // Higher - Content quality matters
      [SCORING_CATEGORIES.TECHNICAL]: 15,
      [SCORING_CATEGORIES.STRUCTURE]: 10,
      [SCORING_CATEGORIES.ACCESSIBILITY]: 5,  // Lower priority
      [SCORING_CATEGORIES.FRESHNESS]: 5,
      [SCORING_CATEGORIES.LOCAL]: 5
    },
    subfactors: {
      ...DEFAULT_WEIGHTS.subfactors,
      // Boost content-related factors
      contentDepth: 30,
      faqPresence: 25,
      citations: 30,
      expertise: 30
    }
  },

  // ==========================================
  // PERPLEXITY OPTIMIZED
  // ==========================================
  perplexity: {
    name: 'Perplexity Optimized',
    description: 'Weights optimized for Perplexity AI search',
    version: '1.0',
    categories: {
      [SCORING_CATEGORIES.IDENTITY]: 15,
      [SCORING_CATEGORIES.AUTHORITY]: 20,     // Higher - citations important
      [SCORING_CATEGORIES.CONTENT]: 25,
      [SCORING_CATEGORIES.TECHNICAL]: 15,
      [SCORING_CATEGORIES.STRUCTURE]: 10,
      [SCORING_CATEGORIES.ACCESSIBILITY]: 5,
      [SCORING_CATEGORIES.FRESHNESS]: 10,     // Higher - freshness matters
      [SCORING_CATEGORIES.LOCAL]: 0           // Lower for search context
    },
    subfactors: {
      ...DEFAULT_WEIGHTS.subfactors,
      citations: 35,                          // Boost citations
      lastModified: 60,                       // Boost freshness
      dateReferences: 40
    }
  },

  // ==========================================
  // CLAUDE OPTIMIZED
  // ==========================================
  claude: {
    name: 'Claude Optimized',
    description: 'Weights optimized for Claude/Anthropic',
    version: '1.0',
    categories: {
      [SCORING_CATEGORIES.IDENTITY]: 15,
      [SCORING_CATEGORIES.AUTHORITY]: 15,
      [SCORING_CATEGORIES.CONTENT]: 30,       // Higher - Claude values structure
      [SCORING_CATEGORIES.TECHNICAL]: 10,
      [SCORING_CATEGORIES.STRUCTURE]: 15,     // Higher - semantic structure
      [SCORING_CATEGORIES.ACCESSIBILITY]: 10,
      [SCORING_CATEGORIES.FRESHNESS]: 5,
      [SCORING_CATEGORIES.LOCAL]: 0
    },
    subfactors: {
      ...DEFAULT_WEIGHTS.subfactors,
      semanticHtml: 50,                       // Boost semantic structure
      headingStructure: 30,
      scannability: 25
    }
  },

  // ==========================================
  // SEARCHGPT OPTIMIZED
  // ==========================================
  searchgpt: {
    name: 'SearchGPT Optimized',
    description: 'Weights optimized for SearchGPT/browsing mode',
    version: '1.0',
    categories: {
      [SCORING_CATEGORIES.IDENTITY]: 10,
      [SCORING_CATEGORIES.AUTHORITY]: 15,
      [SCORING_CATEGORIES.CONTENT]: 25,
      [SCORING_CATEGORIES.TECHNICAL]: 20,     // Higher - crawlability matters
      [SCORING_CATEGORIES.STRUCTURE]: 15,
      [SCORING_CATEGORIES.ACCESSIBILITY]: 5,
      [SCORING_CATEGORIES.FRESHNESS]: 10,
      [SCORING_CATEGORIES.LOCAL]: 0
    },
    subfactors: {
      ...DEFAULT_WEIGHTS.subfactors,
      sitemap: 20,                            // Boost sitemap
      schemaMarkup: 40,
      canonical: 15
    }
  },

  // ==========================================
  // ENTERPRISE PROFILE
  // ==========================================
  enterprise: {
    name: 'Enterprise',
    description: 'Focus on authority, trust, and compliance',
    version: '1.0',
    categories: {
      [SCORING_CATEGORIES.IDENTITY]: 20,      // Higher - brand matters
      [SCORING_CATEGORIES.AUTHORITY]: 25,     // Highest - trust critical
      [SCORING_CATEGORIES.CONTENT]: 20,
      [SCORING_CATEGORIES.TECHNICAL]: 15,
      [SCORING_CATEGORIES.STRUCTURE]: 10,
      [SCORING_CATEGORIES.ACCESSIBILITY]: 10,
      [SCORING_CATEGORIES.FRESHNESS]: 0,
      [SCORING_CATEGORIES.LOCAL]: 0
    },
    subfactors: {
      ...DEFAULT_WEIGHTS.subfactors,
      organizationSchema: 50,
      trustSignals: 30,
      expertise: 30,
      brandConsistency: 40
    }
  },

  // ==========================================
  // LOCAL BUSINESS PROFILE
  // ==========================================
  local: {
    name: 'Local Business',
    description: 'Focus on local business signals for local AI queries',
    version: '1.0',
    categories: {
      [SCORING_CATEGORIES.IDENTITY]: 15,
      [SCORING_CATEGORIES.AUTHORITY]: 10,
      [SCORING_CATEGORIES.CONTENT]: 15,
      [SCORING_CATEGORIES.TECHNICAL]: 10,
      [SCORING_CATEGORIES.STRUCTURE]: 5,
      [SCORING_CATEGORIES.ACCESSIBILITY]: 5,
      [SCORING_CATEGORIES.FRESHNESS]: 10,
      [SCORING_CATEGORIES.LOCAL]: 30         // Highest - local signals critical
    },
    subfactors: {
      ...DEFAULT_WEIGHTS.subfactors,
      localSchema: 50,
      addressPresence: 40,
      mapIntegration: 30,
      hoursAvailability: 25
    }
  }
};

/**
 * Get a weight profile by name
 * @param {string} profileName - Profile name
 * @returns {Object} - Weight profile
 */
function getWeightProfile(profileName = 'default') {
  const profile = WEIGHT_PROFILES[profileName.toLowerCase()];
  if (!profile) {
    console.warn(`[WeightProfiles] Unknown profile "${profileName}", using default`);
    return WEIGHT_PROFILES.default;
  }
  return profile;
}

/**
 * Calculate weighted score using a profile
 * @param {Object} categoryScores - { category: score (0-100) }
 * @param {string} profileName - Profile to use
 * @returns {Object} - Weighted scores
 */
function calculateWeightedScore(categoryScores, profileName = 'default') {
  const profile = getWeightProfile(profileName);
  const weights = profile.categories;

  let totalWeight = 0;
  let weightedSum = 0;
  const breakdown = {};

  for (const [category, score] of Object.entries(categoryScores)) {
    const weight = weights[category] || 0;
    if (weight > 0) {
      const weightedScore = (score * weight) / 100;
      breakdown[category] = {
        rawScore: score,
        weight: weight,
        weightedScore: Math.round(weightedScore * 100) / 100
      };
      weightedSum += weightedScore;
      totalWeight += weight;
    }
  }

  // Normalize if weights don't sum to 100
  const normalizedScore = totalWeight > 0
    ? Math.round((weightedSum / totalWeight) * 100)
    : 0;

  return {
    profile: profile.name,
    totalScore: normalizedScore,
    breakdown,
    maxPossible: 100
  };
}

/**
 * Get subfactor weight for a category
 * @param {string} category - Category name
 * @param {string} subfactor - Subfactor name
 * @param {string} profileName - Profile name
 * @returns {number} - Weight (0-100)
 */
function getSubfactorWeight(category, subfactor, profileName = 'default') {
  const profile = getWeightProfile(profileName);
  const categoryWeight = profile.categories[category] || 0;
  const subfactorWeight = profile.subfactors[subfactor] || 0;

  // Return the effective weight as a percentage of total
  return (categoryWeight * subfactorWeight) / 100;
}

/**
 * Compare scores across profiles
 * @param {Object} categoryScores - { category: score }
 * @returns {Object} - Comparison across all profiles
 */
function compareProfiles(categoryScores) {
  const comparison = {};

  for (const [profileName, profile] of Object.entries(WEIGHT_PROFILES)) {
    comparison[profileName] = calculateWeightedScore(categoryScores, profileName);
  }

  // Find best and worst profiles
  const sorted = Object.entries(comparison)
    .sort((a, b) => b[1].totalScore - a[1].totalScore);

  return {
    profiles: comparison,
    bestProfile: sorted[0][0],
    bestScore: sorted[0][1].totalScore,
    worstProfile: sorted[sorted.length - 1][0],
    worstScore: sorted[sorted.length - 1][1].totalScore,
    scoreDelta: sorted[0][1].totalScore - sorted[sorted.length - 1][1].totalScore
  };
}

/**
 * Create a custom weight profile
 * @param {string} name - Profile name
 * @param {Object} categoryOverrides - Category weight overrides
 * @param {Object} subfactorOverrides - Subfactor weight overrides
 * @returns {Object} - Custom profile
 */
function createCustomProfile(name, categoryOverrides = {}, subfactorOverrides = {}) {
  const customProfile = {
    name: name,
    description: `Custom profile: ${name}`,
    version: '1.0-custom',
    categories: {
      ...DEFAULT_WEIGHTS.categories,
      ...categoryOverrides
    },
    subfactors: {
      ...DEFAULT_WEIGHTS.subfactors,
      ...subfactorOverrides
    }
  };

  // Validate weights sum to ~100
  const categorySum = Object.values(customProfile.categories).reduce((a, b) => a + b, 0);
  if (Math.abs(categorySum - 100) > 5) {
    console.warn(`[WeightProfiles] Custom profile "${name}" category weights sum to ${categorySum}, expected ~100`);
  }

  return customProfile;
}

/**
 * Get profile recommendations based on site type
 * @param {string} siteType - Detected site type
 * @returns {Object} - Recommended profile and rationale
 */
function getRecommendedProfile(siteType) {
  const recommendations = {
    'local_business': {
      profile: 'local',
      rationale: 'Local business detected - prioritizing local signals'
    },
    'blog': {
      profile: 'perplexity',
      rationale: 'Blog detected - prioritizing freshness and citations'
    },
    'saas': {
      profile: 'enterprise',
      rationale: 'SaaS detected - prioritizing authority and trust'
    },
    'enterprise': {
      profile: 'enterprise',
      rationale: 'Enterprise site detected - prioritizing trust signals'
    },
    'ecommerce': {
      profile: 'searchgpt',
      rationale: 'E-commerce detected - prioritizing crawlability'
    }
  };

  return recommendations[siteType] || {
    profile: 'default',
    rationale: 'General site - using balanced weights'
  };
}

/**
 * List all available profiles
 */
function listProfiles() {
  return Object.entries(WEIGHT_PROFILES).map(([key, profile]) => ({
    id: key,
    name: profile.name,
    description: profile.description,
    version: profile.version
  }));
}

module.exports = {
  SCORING_CATEGORIES,
  DEFAULT_WEIGHTS,
  WEIGHT_PROFILES,
  getWeightProfile,
  calculateWeightedScore,
  getSubfactorWeight,
  compareProfiles,
  createCustomProfile,
  getRecommendedProfile,
  listProfiles
};
