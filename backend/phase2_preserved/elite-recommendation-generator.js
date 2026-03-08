/**
 * Elite Maintenance Recommendation Generator
 *
 * Generates recommendations for users in Elite Maintenance Mode (score 850+)
 *
 * Recommendation Categories:
 * 1. Competitive Intelligence (30%) - Track competitors, identify threats
 * 2. Content Opportunities (30%) - Emerging questions, seasonal content
 * 3. Advanced Optimization (20%) - Schema upgrades, voice search, speakable
 * 4. Maintenance & Monitoring (20%) - Compliance, performance degradation
 */

const { Pool } = require('pg');

class EliteRecommendationGenerator {
  constructor(pool) {
    this.pool = pool || new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    this.CATEGORY_MIX = {
      competitive_intelligence: 0.30,
      content_opportunities: 0.30,
      advanced_optimization: 0.20,
      maintenance_monitoring: 0.20
    };
  }

  /**
   * Generate Elite mode recommendations
   *
   * @param {Object} scanResults - Scan results with scores and analysis
   * @param {String} industry - User's industry
   * @param {Array} competitors - Tracked competitors
   * @returns {Array} Elite recommendations
   */
  async generateEliteRecommendations(scanResults, industry = null, competitors = []) {
    const recommendations = [];

    // Calculate how many recommendations for each category (out of 5 total)
    const distribution = {
      competitive_intelligence: Math.ceil(5 * this.CATEGORY_MIX.competitive_intelligence), // 2
      content_opportunities: Math.ceil(5 * this.CATEGORY_MIX.content_opportunities), // 2
      advanced_optimization: Math.floor(5 * this.CATEGORY_MIX.advanced_optimization), // 1
      maintenance_monitoring: 0 // Remainder
    };

    // Adjust to ensure total = 5
    const total = Object.values(distribution).reduce((a, b) => a + b, 0);
    distribution.maintenance_monitoring = 5 - total;

    // Generate each category
    const competitive = await this.generateCompetitiveIntelligence(
      scanResults,
      competitors,
      distribution.competitive_intelligence
    );
    recommendations.push(...competitive);

    const contentOps = await this.generateContentOpportunities(
      scanResults,
      industry,
      distribution.content_opportunities
    );
    recommendations.push(...contentOps);

    const advanced = await this.generateAdvancedOptimizations(
      scanResults,
      distribution.advanced_optimization
    );
    recommendations.push(...advanced);

    const maintenance = await this.generateMaintenanceMonitoring(
      scanResults,
      distribution.maintenance_monitoring
    );
    recommendations.push(...maintenance);

    return recommendations;
  }

  /**
   * Generate Competitive Intelligence recommendations (30%)
   */
  async generateCompetitiveIntelligence(scanResults, competitors, count) {
    const recommendations = [];

    if (competitors && competitors.length > 0) {
      // Real competitive analysis
      for (let i = 0; i < Math.min(count, competitors.length); i++) {
        const competitor = competitors[i];

        if (competitor.recent_improvements && competitor.recent_improvements.length > 0) {
          recommendations.push({
            category: 'Competitive Intelligence',
            elite_category: 'competitive_intelligence',
            title: `Competitor "${competitor.competitor_name}" Added New Features`,
            recommendation_text: `Your competitor has improved their AI visibility. Stay competitive by analyzing their changes.`,
            findings: `${competitor.competitor_name} added ${competitor.recent_improvements.length} new improvements:\n` +
                     competitor.recent_improvements.map(imp => `• ${imp}`).join('\n'),
            priority: 'high',
            estimated_impact: 30,
            implementation_difficulty: 'moderate',
            customized_implementation: this.generateCompetitiveResponse(competitor),
            ready_to_use_content: null,
            implementation_notes: [
              'Review competitor changes',
              'Identify gaps in your implementation',
              'Implement differentiated improvements',
              'Monitor for further changes'
            ]
          });
        }
      }
    }

    // If not enough real competitive data, generate templates
    while (recommendations.length < count) {
      const templates = this.getCompetitiveTemplates(scanResults);
      if (templates.length > 0) {
        recommendations.push(templates[recommendations.length % templates.length]);
      } else {
        break;
      }
    }

    return recommendations.slice(0, count);
  }

  /**
   * Generate Content Opportunity recommendations (30%)
   */
  async generateContentOpportunities(scanResults, industry, count) {
    const recommendations = [];

    // Detect missing FAQ topics
    const faqOpportunities = this.detectFAQOpportunities(scanResults, industry);
    if (faqOpportunities.length > 0) {
      recommendations.push(faqOpportunities[0]);
    }

    // Seasonal content opportunities
    const seasonalOps = this.getSeasonalOpportunities(industry);
    if (seasonalOps.length > 0 && recommendations.length < count) {
      recommendations.push(seasonalOps[0]);
    }

    // Trending topics
    const trendingOps = this.getTrendingTopicOpportunities(industry);
    if (trendingOps.length > 0 && recommendations.length < count) {
      recommendations.push(trendingOps[0]);
    }

    // Content depth opportunities
    const depthOps = this.getContentDepthOpportunities(scanResults);
    recommendations.push(...depthOps);

    return recommendations.slice(0, count);
  }

  /**
   * Generate Advanced Optimization recommendations (20%)
   */
  async generateAdvancedOptimizations(scanResults, count) {
    const recommendations = [];

    const currentAnalysis = scanResults.detailed_analysis || {};

    // Speakable schema
    if (!currentAnalysis.has_speakable_schema) {
      recommendations.push({
        category: 'Advanced Optimization',
        elite_category: 'advanced_optimization',
        title: 'Implement Speakable Schema for Voice Search',
        recommendation_text: 'Add speakable schema markup to optimize for voice search results and AI-read content.',
        findings: 'Your content is not optimized for voice assistants. Speakable schema identifies sections suitable for text-to-speech.',
        priority: 'medium',
        estimated_impact: 25,
        implementation_difficulty: 'moderate',
        customized_implementation: this.generateSpeakableSchemaGuide(),
        code_snippet: this.getSpeakableSchemaExample(),
        implementation_notes: [
          'Identify key content sections suitable for voice',
          'Add speakable schema to those sections',
          'Ensure content is conversational and clear',
          'Test with Google\'s Rich Results Test'
        ]
      });
    }

    // Enhanced FAQ schema
    if (currentAnalysis.has_faq_schema && !currentAnalysis.has_suggested_answer) {
      recommendations.push({
        category: 'Advanced Optimization',
        elite_category: 'advanced_optimization',
        title: 'Upgrade FAQs with SuggestedAnswer Property',
        recommendation_text: 'Enhance FAQ schema with suggestedAnswer to provide alternative viewpoints and increase AI confidence.',
        findings: 'Your FAQ schema is basic. Adding suggestedAnswer increases trustworthiness and AI citation likelihood.',
        priority: 'medium',
        estimated_impact: 20,
        implementation_difficulty: 'quick_win',
        customized_implementation: this.generateSuggestedAnswerGuide(),
        code_snippet: this.getSuggestedAnswerExample(),
        implementation_notes: [
          'Review existing FAQ schema',
          'Add suggestedAnswer for alternative perspectives',
          'Ensure answers are comprehensive',
          'Validate updated schema'
        ]
      });
    }

    // Enhanced Review schema
    if (currentAnalysis.has_review_schema && !currentAnalysis.has_item_reviewed) {
      recommendations.push({
        category: 'Advanced Optimization',
        elite_category: 'advanced_optimization',
        title: 'Add ItemReviewed Properties to Review Schema',
        recommendation_text: 'Strengthen entity relationships by adding itemReviewed properties to your review schema.',
        findings: 'Your review schema lacks itemReviewed context, limiting AI understanding of what is being reviewed.',
        priority: 'low',
        estimated_impact: 15,
        implementation_difficulty: 'quick_win',
        customized_implementation: this.generateItemReviewedGuide(),
        code_snippet: this.getItemReviewedExample()
      });
    }

    // Advanced schema (BreadcrumbList, VideoObject, etc.)
    const advancedSchemaOps = this.getAdvancedSchemaOpportunities(currentAnalysis);
    recommendations.push(...advancedSchemaOps);

    return recommendations.slice(0, count);
  }

  /**
   * Generate Maintenance & Monitoring recommendations (20%)
   */
  async generateMaintenanceMonitoring(scanResults, count) {
    const recommendations = [];

    const currentAnalysis = scanResults.detailed_analysis || {};
    const previousScore = scanResults.previous_score || scanResults.total_score;
    const currentScore = scanResults.total_score;

    // Schema validation warnings
    if (currentAnalysis.schema_warnings && currentAnalysis.schema_warnings.length > 0) {
      recommendations.push({
        category: 'Maintenance & Monitoring',
        elite_category: 'maintenance_monitoring',
        title: 'Fix Schema Validation Warnings',
        recommendation_text: 'Your schema has validation warnings that may prevent AI parsing in the future.',
        findings: `${currentAnalysis.schema_warnings.length} schema validation warnings detected:\n` +
                 currentAnalysis.schema_warnings.slice(0, 5).join('\n'),
        priority: 'high',
        estimated_impact: 20,
        implementation_difficulty: 'moderate',
        customized_implementation: this.generateSchemaFixGuide(currentAnalysis.schema_warnings),
        implementation_notes: [
          'Review all schema validation warnings',
          'Fix syntax and property errors',
          'Validate with Google Rich Results Test',
          'Monitor for future warnings'
        ]
      });
    }

    // Performance degradation
    if (currentScore < previousScore && (previousScore - currentScore) >= 10) {
      const degradation = previousScore - currentScore;
      recommendations.push({
        category: 'Maintenance & Monitoring',
        elite_category: 'maintenance_monitoring',
        title: `Score Dropped ${degradation} Points - Immediate Action Required`,
        recommendation_text: 'Your AI Visibility score has declined. Identify and fix the issues causing the drop.',
        findings: this.identifyScoreDegradationCauses(scanResults),
        priority: 'critical',
        estimated_impact: degradation,
        implementation_difficulty: 'complex',
        customized_implementation: this.generateScoreRecoveryPlan(scanResults)
      });
    }

    // Schema.org updates
    const schemaUpdateOps = this.getSchemaUpdateOpportunities();
    recommendations.push(...schemaUpdateOps);

    // Performance monitoring
    const perfOps = this.getPerformanceMonitoringOpportunities(currentAnalysis);
    recommendations.push(...perfOps);

    return recommendations.slice(0, count);
  }

  // ==========================================
  // Helper Methods - Competitive Intelligence
  // ==========================================

  generateCompetitiveResponse(competitor) {
    return `
      <h3>Competitive Analysis: ${competitor.competitor_name}</h3>
      <p><strong>Recent Changes:</strong></p>
      <ul>
        ${competitor.recent_improvements.map(imp => `<li>${imp}</li>`).join('')}
      </ul>

      <h4>Recommended Response:</h4>
      <ol>
        <li><strong>Analyze Their Implementation</strong>
          <p>Visit their site and review how they implemented these changes.</p>
        </li>
        <li><strong>Identify Your Gaps</strong>
          <p>Compare their implementation with yours to find where you're falling behind.</p>
        </li>
        <li><strong>Implement Differentiated Improvements</strong>
          <p>Don't just copy - improve upon their approach with your unique value.</p>
        </li>
        <li><strong>Monitor Continuously</strong>
          <p>Set up tracking to be alerted of future competitor improvements.</p>
        </li>
      </ol>
    `;
  }

  getCompetitiveTemplates(scanResults) {
    return [
      {
        category: 'Competitive Intelligence',
        elite_category: 'competitive_intelligence',
        title: 'Track Competitor Schema Implementations',
        recommendation_text: 'Monitor your top 3 competitors for schema markup changes to stay ahead.',
        findings: 'Elite status requires continuous competitive awareness. Track competitor improvements.',
        priority: 'medium',
        estimated_impact: 25,
        implementation_difficulty: 'quick_win',
        customized_implementation: 'Set up competitor tracking in your Elite dashboard to receive alerts when competitors improve their AI visibility.',
        implementation_notes: [
          'Add up to 3 competitors to track',
          'Enable competitive alerts',
          'Review monthly competitive reports',
          'Respond to significant competitor improvements'
        ]
      }
    ];
  }

  // ==========================================
  // Helper Methods - Content Opportunities
  // ==========================================

  detectFAQOpportunities(scanResults, industry) {
    const opportunities = [];
    const currentFAQs = scanResults.faq_schema || [];

    // Industry-specific common questions
    const industryQuestions = this.getIndustrySpecificQuestions(industry);

    const missingTopics = industryQuestions.filter(q =>
      !currentFAQs.some(faq =>
        faq.question.toLowerCase().includes(q.keyword.toLowerCase())
      )
    );

    if (missingTopics.length > 0) {
      opportunities.push({
        category: 'Content Opportunities',
        elite_category: 'content_opportunities',
        title: `Add ${missingTopics.length} Missing Industry FAQs`,
        recommendation_text: 'Expand FAQ coverage with industry-specific questions your competitors are answering.',
        findings: `Analysis shows ${missingTopics.length} common questions in your industry are missing from your FAQs:\n` +
                 missingTopics.slice(0, 5).map(q => `• ${q.question}`).join('\n'),
        priority: 'high',
        estimated_impact: 30,
        implementation_difficulty: 'moderate',
        ready_to_use_content: this.generateReadyToUseFAQs(missingTopics.slice(0, 5)),
        implementation_notes: [
          'Add suggested FAQs to your site',
          'Customize answers for your brand',
          'Implement FAQ schema markup',
          'Monitor for additional trending questions'
        ]
      });
    }

    return opportunities;
  }

  getSeasonalOpportunities(industry) {
    const month = new Date().getMonth() + 1;
    const seasonal = [];

    // Tax season (Jan-Apr)
    if (month >= 1 && month <= 4 && industry === 'accounting') {
      seasonal.push({
        category: 'Content Opportunities',
        elite_category: 'content_opportunities',
        title: 'Tax Season Content Opportunity',
        recommendation_text: 'Tax-related queries increase 300% during tax season. Update FAQs with tax-specific questions.',
        findings: 'Seasonal opportunity detected: Tax season is active. Add tax-related FAQs to capture increased search volume.',
        priority: 'high',
        estimated_impact: 35,
        implementation_difficulty: 'moderate',
        ready_to_use_content: this.getTaxSeasonFAQs()
      });
    }

    return seasonal;
  }

  getTrendingTopicOpportunities(industry) {
    // Placeholder for trending topics (would integrate with real trend data)
    return [];
  }

  getContentDepthOpportunities(scanResults) {
    const opportunities = [];
    const currentFAQs = scanResults.faq_schema || [];

    // Check if FAQs are too basic (all < 100 words)
    const basicFAQs = currentFAQs.filter(faq =>
      faq.answer && faq.answer.split(' ').length < 100
    );

    if (basicFAQs.length > currentFAQs.length * 0.7) {
      opportunities.push({
        category: 'Content Opportunities',
        elite_category: 'content_opportunities',
        title: 'Expand FAQ Depth for Advanced Topics',
        recommendation_text: 'Your FAQs cover basics well but miss advanced "deep dive" topics that competitors are capturing.',
        findings: 'FAQ analysis shows 70%+ of answers are under 100 words. Competitors are winning advanced queries with detailed content.',
        priority: 'medium',
        estimated_impact: 25,
        implementation_difficulty: 'moderate'
      });
    }

    return opportunities;
  }

  // ==========================================
  // Helper Methods - Advanced Optimization
  // ==========================================

  generateSpeakableSchemaGuide() {
    return `
      <h3>Implementing Speakable Schema</h3>
      <p>Speakable schema identifies content sections that are especially suitable for text-to-speech (TTS) playback.</p>

      <h4>Step-by-Step Implementation:</h4>
      <ol>
        <li><strong>Identify Key Content Sections</strong>
          <p>Choose sections that are:
            <ul>
              <li>Concise and conversational</li>
              <li>Factual and informative</li>
              <li>Standalone and self-contained</li>
            </ul>
          </p>
        </li>
        <li><strong>Add Speakable Markup</strong>
          <p>Use either CSS selectors or XPath to identify speakable sections.</p>
        </li>
        <li><strong>Validate Implementation</strong>
          <p>Test with Google's Rich Results Test to ensure proper recognition.</p>
        </li>
      </ol>
    `;
  }

  getSpeakableSchemaExample() {
    return `
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "WebPage",
  "name": "Your Page Title",
  "speakable": {
    "@type": "SpeakableSpecification",
    "cssSelector": [
      ".speakable-summary",
      ".key-points"
    ]
  }
}
</script>

<!-- In your HTML, mark sections as speakable -->
<div class="speakable-summary">
  This content will be optimized for voice assistants.
</div>
    `.trim();
  }

  generateSuggestedAnswerGuide() {
    return `
      <h3>Upgrading FAQ Schema with SuggestedAnswer</h3>
      <p>The suggestedAnswer property allows you to provide alternative perspectives, increasing AI confidence.</p>

      <h4>Benefits:</h4>
      <ul>
        <li>Shows comprehensive understanding of the topic</li>
        <li>Increases trustworthiness in AI systems</li>
        <li>Higher likelihood of being cited</li>
      </ul>
    `;
  }

  getSuggestedAnswerExample() {
    return `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [{
    "@type": "Question",
    "name": "What is AI visibility?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "AI visibility is how well AI systems can discover, understand, and cite your content."
    },
    "suggestedAnswer": [{
      "@type": "Answer",
      "text": "From a technical perspective, AI visibility measures structured data implementation and content clarity."
    }, {
      "@type": "Answer",
      "text": "Marketers view AI visibility as a competitive metric for AI-driven search results."
    }]
  }]
}
</script>
    `.trim();
  }

  generateItemReviewedGuide() {
    return `<h3>Adding ItemReviewed to Review Schema</h3><p>Strengthen entity relationships by specifying what is being reviewed.</p>`;
  }

  getItemReviewedExample() {
    return `
<script type="application/ld+json">
{
  "@type": "Review",
  "itemReviewed": {
    "@type": "Product",
    "name": "Product Name",
    "description": "Product description"
  },
  "reviewRating": {
    "@type": "Rating",
    "ratingValue": "5"
  }
}
</script>
    `.trim();
  }

  getAdvancedSchemaOpportunities(currentAnalysis) {
    const opportunities = [];

    if (!currentAnalysis.has_breadcrumb_schema) {
      opportunities.push({
        category: 'Advanced Optimization',
        elite_category: 'advanced_optimization',
        title: 'Implement BreadcrumbList Schema',
        recommendation_text: 'Add breadcrumb navigation schema to improve site hierarchy understanding.',
        priority: 'low',
        estimated_impact: 15,
        implementation_difficulty: 'quick_win'
      });
    }

    return opportunities;
  }

  // ==========================================
  // Helper Methods - Maintenance & Monitoring
  // ==========================================

  generateSchemaFixGuide(warnings) {
    return `
      <h3>Fixing Schema Validation Warnings</h3>
      <p>Warnings detected:</p>
      <ul>
        ${warnings.slice(0, 5).map(w => `<li>${w}</li>`).join('')}
      </ul>

      <h4>Fix Process:</h4>
      <ol>
        <li>Test each schema with Google Rich Results Test</li>
        <li>Fix reported errors and warnings</li>
        <li>Validate all changes</li>
        <li>Monitor for new warnings</li>
      </ol>
    `;
  }

  identifyScoreDegradationCauses(scanResults) {
    // Compare pillar scores to identify which declined
    const causes = [];
    // This would compare with previous scan
    causes.push('Analysis in progress - check detailed scan results');
    return causes.join('\n');
  }

  generateScoreRecoveryPlan(scanResults) {
    return `
      <h3>Score Recovery Plan</h3>
      <p>Your score has declined. Follow this recovery plan:</p>
      <ol>
        <li>Review which pillars declined</li>
        <li>Check for broken schema or removed content</li>
        <li>Verify all markup is still valid</li>
        <li>Restore any missing elements</li>
        <li>Re-scan to confirm recovery</li>
      </ol>
    `;
  }

  getSchemaUpdateOpportunities() {
    // Placeholder for schema.org spec updates
    return [];
  }

  getPerformanceMonitoringOpportunities(currentAnalysis) {
    return [];
  }

  // ==========================================
  // Industry-Specific Content
  // ==========================================

  getIndustrySpecificQuestions(industry) {
    const questionSets = {
      saas: [
        { keyword: 'pricing', question: 'How does your pricing work?' },
        { keyword: 'integration', question: 'What integrations do you support?' },
        { keyword: 'security', question: 'How do you ensure data security?' },
        { keyword: 'support', question: 'What support options are available?' }
      ],
      agency: [
        { keyword: 'services', question: 'What services do you offer?' },
        { keyword: 'pricing', question: 'How do you price your services?' },
        { keyword: 'timeline', question: 'What is the typical project timeline?' },
        { keyword: 'results', question: 'What results can we expect?' }
      ],
      telecom: [
        { keyword: 'coverage', question: 'What is your coverage area?' },
        { keyword: 'plans', question: 'What plans do you offer?' },
        { keyword: 'support', question: 'How can I contact customer support?' },
        { keyword: 'speed', question: 'What internet speeds are available?' }
      ]
    };

    return questionSets[industry?.toLowerCase()] || [];
  }

  generateReadyToUseFAQs(topics) {
    return topics.map(topic => ({
      question: topic.question,
      answer: `[Customize this answer for your business] - ${topic.question}`
    }));
  }

  getTaxSeasonFAQs() {
    return [
      {
        question: 'When is the tax filing deadline?',
        answer: '[Customize with current year deadline]'
      },
      {
        question: 'What documents do I need for tax filing?',
        answer: '[Customize with your requirements]'
      }
    ];
  }
}

module.exports = EliteRecommendationGenerator;
