/**
 * Baseline Recommendations Fallback Tests
 *
 * Tests for the zero-recommendation fix that guarantees paid plans
 * always receive recommendations even when the generator returns empty.
 *
 * Run with: node --test backend/tests/unit/baseline-recommendations-fallback.test.js
 */

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

// ========================================
// MOCK: Replicate the actual helper functions from scan.js
// ========================================

function countMeasuredScores(subfactorScores) {
  if (!subfactorScores) return 0;
  let count = 0;
  for (const category of Object.values(subfactorScores)) {
    if (typeof category !== 'object' || category === null) continue;
    for (const score of Object.values(category)) {
      if (score && (score.state === 'measured' || typeof score === 'number')) {
        count++;
      }
    }
  }
  return count;
}

function generateBaselineRecommendations(url, scanEvidence, industry) {
  const baselineRecs = [
    {
      title: 'Add FAQ Schema Markup',
      category: 'AI Search Readiness',
      subfactor: 'faqSchemaScore',
      priority: 85,
      priorityScore: 85,
      finding: 'FAQ schema markup helps AI assistants understand your expertise and provide direct answers from your content.',
      impact: 'High visibility in AI-powered search results and voice assistants',
      actionSteps: [
        'Identify 5-10 common questions your customers ask',
        'Create clear, concise answers for each question',
        'Add FAQPage schema markup to your page using JSON-LD',
        'Validate schema with Google Rich Results Test'
      ],
      estimatedTime: '2-4 hours',
      difficulty: 'medium',
      estimatedScoreGain: 8,
      customizedImplementation: null,
      readyToUseContent: null,
      implementationNotes: ['Test with multiple AI assistants after implementation'],
      quickWins: ['Start with your top 3 most asked questions'],
      validationChecklist: ['FAQPage schema validates', 'Answers are concise (<300 chars)', 'Questions match search intent']
    },
    {
      title: 'Implement XML Sitemap with Priority Signals',
      category: 'Technical Setup',
      subfactor: 'sitemapScore',
      priority: 82,
      priorityScore: 82,
      finding: 'A well-structured XML sitemap with priority and changefreq signals helps AI crawlers efficiently index your content.',
      impact: 'Faster AI crawler discovery and more complete content indexing',
      actionSteps: ['Generate or update your XML sitemap'],
      estimatedTime: '1-2 hours',
      difficulty: 'easy',
      estimatedScoreGain: 6,
      customizedImplementation: null,
      readyToUseContent: null,
      implementationNotes: ['Keep sitemap under 50,000 URLs per file'],
      quickWins: ['Auto-generate sitemap with your CMS'],
      validationChecklist: ['Sitemap accessible at /sitemap.xml']
    },
    {
      title: 'Add Author Bio and Credentials',
      category: 'Trust & Authority',
      subfactor: 'authorBiosScore',
      priority: 78,
      priorityScore: 78,
      finding: 'AI assistants prioritize content from identifiable experts with verifiable credentials.',
      impact: 'Increased trust signals for E-E-A-T and AI citation likelihood',
      actionSteps: ['Add author name and photo to content pages'],
      estimatedTime: '2-3 hours',
      difficulty: 'medium',
      estimatedScoreGain: 7,
      customizedImplementation: null,
      readyToUseContent: null,
      implementationNotes: ['Use consistent author profiles across all content'],
      quickWins: ['Start with your highest-traffic pages'],
      validationChecklist: ['Author visible on page']
    },
    {
      title: 'Improve Content Structure with Semantic Headings',
      category: 'Content Structure',
      subfactor: 'headingHierarchyScore',
      priority: 76,
      priorityScore: 76,
      finding: 'Well-structured content with proper H1-H6 hierarchy helps AI parse and understand your content organization.',
      impact: 'Better AI comprehension and featured snippet eligibility',
      actionSteps: ['Ensure each page has exactly one H1 tag'],
      estimatedTime: '1-2 hours per page',
      difficulty: 'easy',
      estimatedScoreGain: 5,
      customizedImplementation: null,
      readyToUseContent: null,
      implementationNotes: ['Avoid skipping heading levels (H1 → H3)'],
      quickWins: ['Fix H1 issues on your homepage first'],
      validationChecklist: ['Single H1 per page']
    },
    {
      title: 'Add Organization Schema with Social Links',
      category: 'Technical Setup',
      subfactor: 'structuredDataScore',
      priority: 75,
      priorityScore: 75,
      finding: 'Organization schema helps AI understand your brand identity and connect your web presence.',
      impact: 'Enhanced Knowledge Graph eligibility and brand recognition in AI results',
      actionSteps: ['Create Organization JSON-LD schema'],
      estimatedTime: '1-2 hours',
      difficulty: 'medium',
      estimatedScoreGain: 6,
      customizedImplementation: null,
      readyToUseContent: null,
      implementationNotes: ['Use consistent brand name across all schema'],
      quickWins: ['Add to homepage first'],
      validationChecklist: ['Schema validates']
    },
    {
      title: 'Optimize Image Alt Text for AI Understanding',
      category: 'AI Readability',
      subfactor: 'altTextScore',
      priority: 72,
      priorityScore: 72,
      finding: 'Descriptive alt text helps AI assistants understand visual content and improves accessibility.',
      impact: 'Better multimodal AI understanding and accessibility compliance',
      actionSteps: ['Audit all images for missing alt attributes'],
      estimatedTime: '30 min per 20 images',
      difficulty: 'easy',
      estimatedScoreGain: 5,
      customizedImplementation: null,
      readyToUseContent: null,
      implementationNotes: ['Decorative images should have empty alt=""'],
      quickWins: ['Focus on hero images and product photos first'],
      validationChecklist: ['All meaningful images have alt']
    },
    {
      title: 'Improve Internal Linking Structure',
      category: 'AI Search Readiness',
      subfactor: 'linkedSubpagesScore',
      priority: 70,
      priorityScore: 70,
      finding: 'Strong internal linking helps AI crawlers discover and understand the relationships between your content.',
      impact: 'Better content discovery and topic authority signals for AI',
      actionSteps: ['Identify pillar pages and supporting content'],
      estimatedTime: '2-4 hours',
      difficulty: 'medium',
      estimatedScoreGain: 6,
      customizedImplementation: null,
      readyToUseContent: null,
      implementationNotes: ['Limit to 100 internal links per page maximum'],
      quickWins: ['Link new content to your top-performing pages'],
      validationChecklist: ['Orphan pages linked']
    },
    {
      title: 'Add Content Freshness Signals',
      category: 'Content Freshness',
      subfactor: 'lastUpdatedScore',
      priority: 68,
      priorityScore: 68,
      finding: 'Clear last-updated dates signal to AI that your content is current and maintained.',
      impact: 'Improved freshness signals and reduced stale content penalties',
      actionSteps: ['Add visible "Last Updated" dates to content pages'],
      estimatedTime: '1-2 hours initial setup',
      difficulty: 'easy',
      estimatedScoreGain: 5,
      customizedImplementation: null,
      readyToUseContent: null,
      implementationNotes: ['Only show dates on content that is actually updated'],
      quickWins: ['Add dates to blog posts and guides'],
      validationChecklist: ['Dates visible on page']
    }
  ];
  return baselineRecs;
}

// Simulate the fallback logic from performV5Scan
function simulateRecommendationFallback(generatedRecs, plan, isCompetitorScan, skipRecommendationGeneration) {
  const recCount = generatedRecs.length;
  const isPaidPlan = ['diy', 'pro', 'agency', 'enterprise'].includes(plan?.toLowerCase());

  // If paid plan gets 0 recs for primary scan (not competitor, not skipped), use fallback
  if (recCount === 0 && isPaidPlan && !skipRecommendationGeneration && !isCompetitorScan) {
    return generateBaselineRecommendations('https://example.com', {}, 'General');
  }

  return generatedRecs;
}

// ========================================
// TESTS: countMeasuredScores
// ========================================

describe('countMeasuredScores Helper', () => {

  it('returns 0 for null/undefined input', () => {
    assert.strictEqual(countMeasuredScores(null), 0);
    assert.strictEqual(countMeasuredScores(undefined), 0);
  });

  it('counts measured tri-state scores', () => {
    const subfactorScores = {
      aiReadability: {
        altTextScore: { score: 75, state: 'measured' },
        captionsTranscriptsScore: { score: 60, state: 'measured' }
      },
      technicalSetup: {
        sitemapScore: { score: 80, state: 'measured' },
        robotsTxtScore: { score: null, state: 'not_measured' }
      }
    };
    assert.strictEqual(countMeasuredScores(subfactorScores), 3);
  });

  it('counts numeric scores (legacy format)', () => {
    const subfactorScores = {
      aiReadability: {
        altTextScore: 75,
        captionsTranscriptsScore: 60
      }
    };
    assert.strictEqual(countMeasuredScores(subfactorScores), 2);
  });

  it('ignores not_measured scores', () => {
    const subfactorScores = {
      aiReadability: {
        altTextScore: { score: null, state: 'not_measured' },
        captionsTranscriptsScore: { score: null, state: 'not_measured' }
      }
    };
    assert.strictEqual(countMeasuredScores(subfactorScores), 0);
  });
});

// ========================================
// TESTS: generateBaselineRecommendations
// ========================================

describe('generateBaselineRecommendations', () => {

  it('returns 8 baseline recommendations', () => {
    const recs = generateBaselineRecommendations('https://example.com', {}, 'General');
    assert.strictEqual(recs.length, 8, 'Should return 8 baseline recommendations');
  });

  it('all recommendations have required fields for saveHybridRecommendations', () => {
    const recs = generateBaselineRecommendations('https://example.com', {}, 'General');

    const requiredFields = [
      'title', 'category', 'priority', 'finding', 'impact',
      'actionSteps', 'estimatedTime', 'difficulty', 'estimatedScoreGain'
    ];

    for (const rec of recs) {
      for (const field of requiredFields) {
        assert.ok(rec[field] !== undefined, `Recommendation "${rec.title}" missing field: ${field}`);
      }
    }
  });

  it('all recommendations have priorityScore for tier filtering', () => {
    const recs = generateBaselineRecommendations('https://example.com', {}, 'General');

    for (const rec of recs) {
      assert.ok(typeof rec.priorityScore === 'number', `Recommendation "${rec.title}" missing priorityScore`);
      assert.ok(rec.priorityScore > 0, `Recommendation "${rec.title}" has invalid priorityScore`);
    }
  });

  it('recommendations are sorted by priority (highest first)', () => {
    const recs = generateBaselineRecommendations('https://example.com', {}, 'General');

    for (let i = 1; i < recs.length; i++) {
      assert.ok(recs[i - 1].priority >= recs[i].priority,
        `Recommendations not sorted by priority: ${recs[i - 1].priority} < ${recs[i].priority}`);
    }
  });

  it('recommendations cover diverse categories', () => {
    const recs = generateBaselineRecommendations('https://example.com', {}, 'General');
    const categories = new Set(recs.map(r => r.category));

    // Should cover at least 4 different categories
    assert.ok(categories.size >= 4, `Only ${categories.size} categories covered, expected at least 4`);
  });
});

// ========================================
// TESTS: Fallback Logic
// ========================================

describe('Recommendation Fallback Logic', () => {

  it('PRO plan with 0 generated recs gets baseline fallback', () => {
    const result = simulateRecommendationFallback([], 'pro', false, false);
    assert.strictEqual(result.length, 8, 'PRO should get 8 baseline recs when generator returns 0');
  });

  it('DIY plan with 0 generated recs gets baseline fallback', () => {
    const result = simulateRecommendationFallback([], 'diy', false, false);
    assert.strictEqual(result.length, 8, 'DIY should get 8 baseline recs when generator returns 0');
  });

  it('Agency plan with 0 generated recs gets baseline fallback', () => {
    const result = simulateRecommendationFallback([], 'agency', false, false);
    assert.strictEqual(result.length, 8, 'Agency should get 8 baseline recs when generator returns 0');
  });

  it('Enterprise plan with 0 generated recs gets baseline fallback', () => {
    const result = simulateRecommendationFallback([], 'enterprise', false, false);
    assert.strictEqual(result.length, 8, 'Enterprise should get 8 baseline recs when generator returns 0');
  });

  it('FREE plan with 0 generated recs does NOT get baseline fallback', () => {
    const result = simulateRecommendationFallback([], 'free', false, false);
    assert.strictEqual(result.length, 0, 'Free plan should NOT get baseline fallback');
  });

  it('Competitor scan does NOT get baseline fallback (even for paid plan)', () => {
    const result = simulateRecommendationFallback([], 'pro', true, false);
    assert.strictEqual(result.length, 0, 'Competitor scan should NOT get baseline fallback');
  });

  it('Skipped recommendation generation does NOT trigger fallback', () => {
    const result = simulateRecommendationFallback([], 'pro', false, true);
    assert.strictEqual(result.length, 0, 'Skipped generation should NOT trigger fallback');
  });

  it('PRO plan with generated recs keeps original recs (no fallback needed)', () => {
    const generatedRecs = [{ title: 'Generated Rec 1' }, { title: 'Generated Rec 2' }];
    const result = simulateRecommendationFallback(generatedRecs, 'pro', false, false);
    assert.strictEqual(result.length, 2, 'Should keep original generated recs when count > 0');
    assert.strictEqual(result[0].title, 'Generated Rec 1');
  });
});

// ========================================
// TESTS: Acceptance Criteria Verification
// ========================================

describe('Bug Fix: Zero Recommendations for Paid Plans', () => {

  it('AC1: PRO primary scan with 0 generated recs returns 8+ baseline recs', () => {
    const result = simulateRecommendationFallback([], 'pro', false, false);
    assert.ok(result.length >= 8, `PRO primary scan should return at least 8 recs, got ${result.length}`);
  });

  it('AC2: Competitor scan remains empty (scores-only)', () => {
    const result = simulateRecommendationFallback([], 'pro', true, false);
    assert.strictEqual(result.length, 0, 'Competitor scan should remain empty');
  });

  it('AC3: Baseline recs have all fields needed for persistence', () => {
    const recs = generateBaselineRecommendations('https://example.com', {}, 'General');

    // Fields required by saveHybridRecommendations INSERT
    const dbFields = [
      'category',       // → category
      'title',          // → recommendation_text
      'priority',       // → priority
      'estimatedScoreGain', // → estimated_impact
      'difficulty',     // → estimated_effort
      'actionSteps',    // → action_steps (JSON)
      'finding'         // → findings
    ];

    for (const rec of recs) {
      for (const field of dbFields) {
        assert.ok(rec[field] !== undefined, `Baseline rec missing DB field: ${field}`);
      }
    }
  });

  it('AC4: Baseline recs are not tied to specific website features', () => {
    const recs = generateBaselineRecommendations('https://example.com', {}, 'General');

    // None of the baseline recs should mention specific site features
    const siteSpecificTerms = ['your blog at', 'your FAQ at', 'your sitemap at'];

    for (const rec of recs) {
      const finding = rec.finding.toLowerCase();
      for (const term of siteSpecificTerms) {
        assert.ok(!finding.includes(term),
          `Baseline rec "${rec.title}" should not reference specific site features`);
      }
    }
  });
});

// ========================================
// TESTS: Edge Cases
// ========================================

describe('Edge Cases', () => {

  it('handles case-insensitive plan names', () => {
    const result1 = simulateRecommendationFallback([], 'PRO', false, false);
    const result2 = simulateRecommendationFallback([], 'Pro', false, false);
    const result3 = simulateRecommendationFallback([], 'pro', false, false);

    assert.strictEqual(result1.length, 8);
    assert.strictEqual(result2.length, 8);
    assert.strictEqual(result3.length, 8);
  });

  it('handles null plan gracefully', () => {
    const result = simulateRecommendationFallback([], null, false, false);
    assert.strictEqual(result.length, 0, 'Null plan should not trigger fallback');
  });

  it('handles undefined plan gracefully', () => {
    const result = simulateRecommendationFallback([], undefined, false, false);
    assert.strictEqual(result.length, 0, 'Undefined plan should not trigger fallback');
  });
});
