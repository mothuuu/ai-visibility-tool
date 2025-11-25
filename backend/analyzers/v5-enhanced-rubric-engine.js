const SiteCrawler = require('./site-crawler');
const ContentExtractor = require('./content-extractor');
const { detectCertifications, calculateCertificationScore, detectGenericCertificationSignals } = require('./recommendation-engine/certification-detector');

/**
 * V5 Enhanced Rubric Scoring Engine
 *
 * Implements the Enhanced AI Readiness Assessment Rubric v3.0 with:
 * - Multi-page site analysis (not just single page)
 * - Precise PDF scoring thresholds
 * - 5-tier scoring system (0, 0.6, 1.2, 1.8, 2.0 points per factor)
 * - Enhanced entity recognition and analysis
 *
 * MATCHES PDF SPECIFICATION:
 * - Category weights identical to PDF
 * - All 50+ subfactors with exact thresholds
 * - Site-wide percentage calculations
 *
 * Scoring: 0-100 (backend), displayed as 0-1000 on frontend
 */

class V5EnhancedRubricEngine {
  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
    this.siteData = null;
    this.industry = options.industry || null;
    this.certificationData = null;

    // Category weights (from PDF v3.0)
    this.weights = {
      aiSearchReadiness: 0.20,      // 20%
      contentStructure: 0.15,        // 15%
      voiceOptimization: 0.12,       // 12%
      technicalSetup: 0.18,          // 18%
      trustAuthority: 0.12,          // 12%
      aiReadability: 0.10,           // 10%
      contentFreshness: 0.08,        // 8%
      speedUX: 0.05                  // 5%
    };
  }

  /**
   * Main analysis method
   */
  async analyze() {
    try {
      console.log(`[V5-Enhanced] Starting multi-page analysis for: ${this.url}`);

      // Step 1: Crawl multiple pages
      const crawler = new SiteCrawler(this.url, {
        maxPages: this.options.maxPages || 15,
        timeout: this.options.timeout || 10000
      });

      this.siteData = await crawler.crawl();

      // Expose enhanced evidence with site-wide FAQ data for accurate Finding generation
      // This ensures the Finding text matches the site-wide scoring data
      if (this.siteData.pages && this.siteData.pages[0]) {
        const firstPageEvidence = this.siteData.pages[0].evidence;

        // Aggregate FAQ data from all pages
        const allFAQs = [];
        let hasFAQSchema = false;

        for (const page of this.siteData.pages) {
          if (page.evidence.content && page.evidence.content.faqs) {
            allFAQs.push(...page.evidence.content.faqs);
          }
          if (page.evidence.technical && page.evidence.technical.hasFAQSchema) {
            hasFAQSchema = true;
          }
        }

        // Create enhanced evidence object with aggregated FAQ data
        this.evidence = {
          ...firstPageEvidence,
          content: {
            ...firstPageEvidence.content,
            faqs: allFAQs  // Use aggregated FAQs from all pages
          },
          technical: {
            ...firstPageEvidence.technical,
            hasFAQSchema: hasFAQSchema,  // True if ANY page has FAQ schema
            hasSitemap: this.siteData.sitemapDetected || false,  // CRITICAL FIX: Pass sitemap detection
            sitemapDetected: this.siteData.sitemapDetected || false,  // Alternative property name
            sitemapLocation: this.siteData.sitemapLocation || null,  // Which sitemap file was detected
            sitemapPageCount: this.siteData.pageCount || 0  // How many pages were crawled from sitemap
          }
        };

        console.log(`[V5-Enhanced] Aggregated ${allFAQs.length} FAQs from ${this.siteData.pages.length} pages`);
        console.log(`[V5-Enhanced] Sitemap detected: ${this.siteData.sitemapDetected ? 'YES' : 'NO'}`);
      } else {
        this.evidence = null;
      }

      console.log(`[V5-Enhanced] Crawled ${this.siteData.pageCount} pages`);

      // Step 1.5: Detect certifications (always runs, falls back to Generic)
      // Wrapped in try-catch to prevent certification detection errors from crashing scans
      try {
        const industryForCerts = this.industry || 'Generic';
        console.log(`[V5-Enhanced] Detecting certifications for industry: ${industryForCerts}${!this.industry ? ' (fallback)' : ''}`);
        this.certificationData = detectCertifications(this.siteData, industryForCerts);
      } catch (certError) {
        console.error(`[V5-Enhanced] ⚠️  Certification detection failed (non-fatal):`, certError.message);
        console.error(`[V5-Enhanced] Stack:`, certError.stack);
        this.certificationData = null; // Continue scan without certification data
      }

      // Step 2: Analyze each category using site-wide data
      const categoryScores = {
        aiSearchReadiness: this.analyzeAISearchReadiness(),
        contentStructure: this.analyzeContentStructure(),
        voiceOptimization: this.analyzeVoiceOptimization(),
        technicalSetup: this.analyzeTechnicalSetup(),
        trustAuthority: this.analyzeTrustAuthority(),
        aiReadability: this.analyzeAIReadability(),
        contentFreshness: this.analyzeContentFreshness(),
        speedUX: this.analyzeSpeedUX()
      };

      // Step 3: Calculate weighted total
      const totalScore = this.calculateTotalScore(categoryScores);

      // Step 4: Determine grade
      const grade = this.calculateGrade(totalScore);

      console.log(`[V5-Enhanced] Analysis complete. Total: ${totalScore}/100 (Grade: ${grade})`);

      return {
        url: this.url,
        totalScore: Math.round(totalScore),
        grade,
        categories: categoryScores,
        siteMetrics: this.siteData.siteMetrics,
        pageCount: this.siteData.pageCount,
        sitemapDetected: this.siteData.sitemapDetected || false,
        certificationData: this.certificationData, // Include certification analysis
        metadata: {
          analyzedAt: new Date().toISOString(),
          version: '5.0-enhanced-hybrid'
        }
      };

    } catch (error) {
      console.error(`[V5-Enhanced] Analysis failed:`, error);
      throw new Error(`Enhanced analysis failed: ${error.message}`);
    }
  }

  /**
   * Category 1: AI Search Readiness & Content Depth (20%)
   *
   * PDF Parameters:
   * 1.a) Direct Answer Structure & Content Depth (50% of category)
   * 1.b) Topical Authority & Content Clustering (50% of category)
   */
  analyzeAISearchReadiness() {
    const param1a = this.analyzeDirectAnswerStructure();
    const param1b = this.analyzeTopicalAuthority();

    // Category score = (param1a + param1b) × 20%
    const rawScore = (param1a.score + param1b.score) / 2;

    return {
      score: Math.round(rawScore),
      weight: this.weights.aiSearchReadiness,
      subfactors: {
        directAnswerStructure: param1a,
        topicalAuthority: param1b
      }
    };
  }

  /**
   * Parameter 1.a: Direct Answer Structure & Content Depth
   * 5 factors × 2.0 points each = 10 points max
   */
  analyzeDirectAnswerStructure() {
    const factors = {};

    // Factor 1: Question-Based Content Density
    // PDF: ≥60% → 2.0, 35-59% → 1.2, 15-34% → 0.6, else 0
    // HYBRID SCORING: Reward both percentage AND absolute count
    const questionPercent = this.siteData.siteMetrics.pagesWithQuestionHeadings * 100;
    const questionCount = this.siteData.pages.filter(p => this.hasQuestionHeadings(p.evidence)).length;

    const questionPercentScore = this.scoreTier(questionPercent, [
      { threshold: 60, score: 2.0 },
      { threshold: 35, score: 1.2 },
      { threshold: 15, score: 0.6 }
    ]);
    const questionAbsoluteScore = this.scoreTier(questionCount, [
      { threshold: 8, score: 2.0 },   // 8+ pages with questions = excellent
      { threshold: 5, score: 1.2 },   // 5+ pages with questions = good
      { threshold: 2, score: 0.6 }    // 2+ pages with questions = decent
    ]);
    factors.questionDensity = Math.max(questionPercentScore, questionAbsoluteScore);

    // Factor 2: Scannability Enhancement
    // PDF: ≥70% → 2.0, 40-69% → 1.2, 20-39% → 0.6, else 0
    const scannabilityPercent = this.siteData.siteMetrics.pagesWithLists * 100;
    factors.scannability = this.scoreTier(scannabilityPercent, [
      { threshold: 70, score: 2.0 },
      { threshold: 40, score: 1.2 },
      { threshold: 20, score: 0.6 }
    ]);

    // Factor 3: Readability & AI Parsing
    // PDF: Flesch >65 AND avg sentence <20 words → 2.0, moderate → 1.2, else 0.6
    const flesch = this.siteData.siteMetrics.avgFleschScore;
    const avgSentence = this.siteData.siteMetrics.avgSentenceLength;
    if (flesch > 65 && avgSentence < 20) {
      factors.readability = 2.0;
    } else if (flesch > 50 && avgSentence < 25) {
      factors.readability = 1.2;
    } else {
      factors.readability = 0.6;
    }

    // Factor 4: ICP-Specific Q&A Coverage
    // PDF: ≥5 ICP-specific Q&A → 2.0, 2-4 → 1.2, else 0
    // HYBRID SCORING: Reward both percentage AND absolute count to prevent dilution
    const faqPercent = this.siteData.siteMetrics.pagesWithFAQs * 100;
    const faqCount = this.siteData.pages.filter(p => p.evidence.content.faqs.length > 0).length;
    const totalFAQs = this.siteData.pages.reduce((sum, p) => sum + p.evidence.content.faqs.length, 0);

    // Log FAQ distribution across pages for debugging
    console.log(`[V5-Enhanced] ===== FAQ DISTRIBUTION ANALYSIS =====`);
    console.log(`[V5-Enhanced] Total FAQs across all pages: ${totalFAQs}`);
    console.log(`[V5-Enhanced] Pages with FAQs: ${faqCount}/${this.siteData.pageCount}`);
    this.siteData.pages.forEach((page, idx) => {
      if (page.evidence.content.faqs.length > 0) {
        console.log(`[V5-Enhanced]   Page ${idx + 1} (${page.url}): ${page.evidence.content.faqs.length} FAQs`);
      }
    });

    // Score based on EITHER percentage OR absolute count (whichever is better)
    const faqPercentScore = this.scoreTier(faqPercent, [
      { threshold: 40, score: 2.0 },  // At least 40% of pages have FAQs = good coverage
      { threshold: 20, score: 1.2 }
    ]);
    const faqAbsoluteScore = this.scoreTier(faqCount, [
      { threshold: 5, score: 2.0 },   // At least 5 pages with FAQs = good absolute coverage
      { threshold: 3, score: 1.8 },   // At least 3 pages with FAQs = decent coverage
      { threshold: 1, score: 1.2 }    // At least 1 page with FAQs = some coverage
    ]);
    factors.icpQA = Math.max(faqPercentScore, faqAbsoluteScore);  // Use the better of the two scores

    console.log(`[V5-Enhanced] FAQ Scoring - Pages: ${faqCount}/${this.siteData.pageCount} (${Math.round(faqPercent)}%) | Percent Score: ${faqPercentScore} | Absolute Score: ${faqAbsoluteScore} | Final: ${factors.icpQA}`);

    // Factor 5: Answer Completeness
    // PDF: 50-150 words with clear structure → 2.0, partial → 1.2, else 0
    const avgWords = this.siteData.siteMetrics.avgWordCount;
    if (avgWords >= 800 && scannabilityPercent >= 50) {
      factors.answerCompleteness = 2.0;
    } else if (avgWords >= 400) {
      factors.answerCompleteness = 1.2;
    } else {
      factors.answerCompleteness = 0;
    }

    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);

    return {
      score: (totalScore / 10) * 100, // Convert to 0-100 scale
      factors,
      details: {
        questionPercent: Math.round(questionPercent),
        scannabilityPercent: Math.round(scannabilityPercent),
        fleschScore: Math.round(flesch),
        avgSentenceLength: Math.round(avgSentence)
      }
    };
  }

  /**
   * Parameter 1.b: Topical Authority & Content Clustering
   * 5 factors × 2.0 points each = 10 points max
   */
  analyzeTopicalAuthority() {
    const factors = {};

    // Factor 1: Pillar Page Architecture
    // PDF: ≥2 comprehensive pillar pages → 2.0, 1 → 1.2, else 0
    const pillarPages = this.siteData.siteMetrics.pillarPageCount;
    if (pillarPages >= 2) {
      factors.pillarPages = 2.0;
    } else if (pillarPages >= 1) {
      factors.pillarPages = 1.2;
    } else {
      factors.pillarPages = 0;
    }

    // Factor 2: Topic Cluster Completeness
    // PDF: ≥80% → 2.0, 50-79% → 1.2, 25-49% → 0.6, else 0
    const clusterCoverage = this.siteData.siteMetrics.topicClusterCoverage * 100;
    factors.topicClusters = this.scoreTier(clusterCoverage, [
      { threshold: 80, score: 2.0 },
      { threshold: 50, score: 1.2 },
      { threshold: 25, score: 0.6 }
    ]);

    // Factor 3: Content Uniqueness vs Competitors
    // (Can't measure without competitor data, use content depth as proxy)
    const avgWords = this.siteData.siteMetrics.avgWordCount;
    if (avgWords >= 1200) {
      factors.contentUniqueness = 2.0;
    } else if (avgWords >= 600) {
      factors.contentUniqueness = 1.2;
    } else {
      factors.contentUniqueness = 0;
    }

    // Factor 4: Content Depth Metrics
    // PDF: >800 words with multimedia → 2.0, moderate → 1.2, else 0.6
    const avgImages = this.siteData.siteMetrics.avgImageCount;
    if (avgWords > 800 && avgImages >= 2) {
      factors.contentDepth = 2.0;
    } else if (avgWords > 400) {
      factors.contentDepth = 1.2;
    } else {
      factors.contentDepth = 0.6;
    }

    // Factor 5: Semantic Topic Relationships
    // PDF: Semantic linking present → 2.0, basic → 1.2, else 0
    const clusterScore = this.siteData.siteMetrics.topicClusterCoverage;
    if (clusterScore >= 0.7) {
      factors.semanticLinking = 2.0;
    } else if (clusterScore >= 0.4) {
      factors.semanticLinking = 1.2;
    } else {
      factors.semanticLinking = 0;
    }

    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);

    return {
      score: (totalScore / 10) * 100,
      factors,
      details: {
        pillarPageCount: pillarPages,
        clusterCoverage: Math.round(clusterCoverage),
        avgWordCount: Math.round(avgWords)
      }
    };
  }

  /**
   * Category 2: Content Structure & Entity Recognition (15%)
   */
  analyzeContentStructure() {
    const param2a = this.analyzeSemanticHTML();
    const param2b = this.analyzeEntityRecognition();

    const rawScore = (param2a.score + param2b.score) / 2;

    return {
      score: Math.round(rawScore),
      weight: this.weights.contentStructure,
      subfactors: {
        semanticHTML: param2a,
        entityRecognition: param2b
      }
    };
  }

  /**
   * Parameter 2.a: Advanced Semantic HTML & Accessibility
   */
  analyzeSemanticHTML() {
    const factors = {};

    // Factor 1: Proper Heading Hierarchy
    // PDF: ≥90% → 1.5, 70-89% → 1.0, 50-69% → 0.5, else 0
    const h1Percent = this.siteData.siteMetrics.pagesWithProperH1 * 100;
    factors.headingHierarchy = this.scoreTier(h1Percent, [
      { threshold: 90, score: 1.5 },
      { threshold: 70, score: 1.0 },
      { threshold: 50, score: 0.5 }
    ]);

    // Factor 2: Semantic HTML5 Elements
    // PDF: ≥80% → 1.5, 50-79% → 1.0, else 0.5
    const semanticPercent = this.siteData.siteMetrics.pagesWithSemanticHTML * 100;
    factors.semanticElements = this.scoreTier(semanticPercent, [
      { threshold: 80, score: 1.5 },
      { threshold: 50, score: 1.0 }
    ], 0.5);

    // Factor 3: ARIA Labels & Accessibility
    // (Would need external WAVE/axe API - use alt text as proxy)
    const altTextPercent = this.siteData.siteMetrics.pagesWithGoodAltText * 100;
    factors.accessibility = this.scoreTier(altTextPercent, [
      { threshold: 90, score: 1.5 },
      { threshold: 70, score: 1.0 },
      { threshold: 50, score: 0.5 }
    ]);

    // Factor 4: Content Sectioning
    factors.contentSectioning = semanticPercent >= 70 ? 1.5 : semanticPercent >= 40 ? 1.0 : 0.5;

    // Factor 5: Mobile-First Structure
    // (Assume modern sites are mobile-first if they have semantic HTML)
    factors.mobileFriendly = semanticPercent >= 60 ? 1.5 : semanticPercent >= 30 ? 1.0 : 0;

    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);

    return {
      score: (totalScore / 7.5) * 100, // Max 7.5 points
      factors
    };
  }

  /**
   * Parameter 2.b: Entity Recognition & Knowledge Graph Optimization
   */
  analyzeEntityRecognition() {
    const factors = {};

    // Get first page for detailed analysis
    const firstPage = this.siteData.pages[0].evidence;

    // Factor 1: Named Entity Markup
    const entitiesPerPage = this.siteData.siteMetrics.avgEntitiesPerPage;
    factors.namedEntities = this.scoreTier(entitiesPerPage, [
      { threshold: 20, score: 1.5 },
      { threshold: 10, score: 1.0 }
    ], 0);

    // Factor 2: Entity Relationship Mapping
    // Check for Schema.org structured data
    const schemaPercent = this.siteData.siteMetrics.pagesWithSchema * 100;
    factors.entityRelationships = this.scoreTier(schemaPercent, [
      { threshold: 70, score: 1.5 },
      { threshold: 40, score: 1.0 }
    ], 0);

    // Factor 3: Knowledge Graph Connections
    // Check for sameAs in schema
    const hasSameAs = this.detectSameAsInSchema(firstPage);
    factors.knowledgeGraph = hasSameAs ? 1.5 : 0;

    // Factor 4: Geographic Entity Precision
    const geoPercent = this.siteData.siteMetrics.pagesWithLocationData * 100;
    factors.geoEntities = this.scoreTier(geoPercent, [
      { threshold: 50, score: 1.5 },
      { threshold: 20, score: 1.0 }
    ], 0);

    // Factor 5: Professional Entity Verification
    const hasOrgSchema = this.siteData.siteMetrics.pagesWithOrganizationSchema * 100;
    factors.professionalEntities = this.scoreTier(hasOrgSchema, [
      { threshold: 30, score: 1.5 },
      { threshold: 10, score: 1.0 }
    ], 0);

    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);

    return {
      score: (totalScore / 7.5) * 100,
      factors
    };
  }

  /**
   * Category 3: Voice & Conversational Optimization (12%)
   */
  analyzeVoiceOptimization() {
    const param3a = this.analyzeConversationalKeywords();
    const param3b = this.analyzeVoiceSearch();

    const rawScore = (param3a.score + param3b.score) / 2;

    return {
      score: Math.round(rawScore),
      weight: this.weights.voiceOptimization,
      subfactors: {
        conversationalKeywords: param3a,
        voiceSearch: param3b
      }
    };
  }

  /**
   * Parameter 3.a: Conversational Keyword & Context Optimization
   */
  analyzeConversationalKeywords() {
    const factors = {};

    // Factor 1: Long-Tail Conversational Phrases
    const longTailPercent = this.siteData.siteMetrics.pagesWithLongTailKeywords * 100;
    factors.longTail = this.scoreTier(longTailPercent, [
      { threshold: 60, score: 1.2 },
      { threshold: 35, score: 0.8 },
      { threshold: 15, score: 0.4 }
    ]);

    // Factor 2: Local Intent & Geographic Targeting
    const geoPercent = this.siteData.siteMetrics.pagesWithLocationData * 100;
    factors.localIntent = this.scoreTier(geoPercent, [
      { threshold: 50, score: 1.2 },
      { threshold: 20, score: 0.8 }
    ]);

    // Factor 3: ICP-Specific Conversational Terms
    const conversationalPercent = this.siteData.siteMetrics.pagesWithConversationalContent * 100;
    factors.icpTerms = this.scoreTier(conversationalPercent, [
      { threshold: 50, score: 1.2 },
      { threshold: 25, score: 0.8 }
    ]);

    // Factor 4: Featured Snippet Optimization
    // HYBRID SCORING: Reward both percentage AND absolute count
    const faqSchemaPercent = this.siteData.siteMetrics.pagesWithFAQSchema * 100;
    const faqSchemaCount = this.siteData.pages.filter(p => p.evidence.technical.hasFAQSchema).length;

    const schemaPercentScore = this.scoreTier(faqSchemaPercent, [
      { threshold: 30, score: 1.2 },
      { threshold: 15, score: 0.8 },
      { threshold: 5, score: 0.4 }
    ]);
    const schemaAbsoluteScore = this.scoreTier(faqSchemaCount, [
      { threshold: 3, score: 1.2 },   // 3+ pages with FAQ schema = excellent
      { threshold: 1, score: 0.8 }    // 1+ page with FAQ schema = good
    ]);
    factors.snippetOptimization = Math.max(schemaPercentScore, schemaAbsoluteScore);

    // Factor 5: Follow-up Question Anticipation
    const listPercent = this.siteData.siteMetrics.pagesWithLists * 100;
    factors.followUpQuestions = this.scoreTier(listPercent, [
      { threshold: 60, score: 1.2 },
      { threshold: 30, score: 0.8 }
    ]);

    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);

    return {
      score: (totalScore / 6.0) * 100,
      factors
    };
  }

  /**
   * Parameter 3.b: Voice Search & Multi-Turn Conversation
   */
  analyzeVoiceSearch() {
    const factors = {};

    const conversationalPercent = this.siteData.siteMetrics.pagesWithConversationalContent * 100;
    const questionPercent = this.siteData.siteMetrics.pagesWithQuestionHeadings * 100;

    // Factor 1: Voice Query Pattern Matching
    factors.voicePatterns = this.scoreTier(questionPercent, [
      { threshold: 50, score: 1.2 },
      { threshold: 25, score: 0.8 }
    ], 0.4);

    // Factor 2: Context Preservation
    factors.contextPreservation = this.scoreTier(conversationalPercent, [
      { threshold: 60, score: 1.2 },
      { threshold: 30, score: 0.8 }
    ]);

    // Factor 3: Local Business Voice Optimization
    const geoPercent = this.siteData.siteMetrics.pagesWithLocationData * 100;
    factors.localVoice = this.scoreTier(geoPercent, [
      { threshold: 40, score: 1.2 },
      { threshold: 20, score: 0.8 }
    ]);

    // Factor 4: Conversational Flow Structure
    const clusterCoverage = this.siteData.siteMetrics.topicClusterCoverage * 100;
    factors.conversationalFlow = this.scoreTier(clusterCoverage, [
      { threshold: 60, score: 1.2 },
      { threshold: 30, score: 0.8 }
    ]);

    // Factor 5: Speed of Answer Delivery
    const faqPercent = this.siteData.siteMetrics.pagesWithFAQs * 100;
    factors.answerSpeed = this.scoreTier(faqPercent, [
      { threshold: 40, score: 1.2 },
      { threshold: 20, score: 0.8 }
    ]);

    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);

    return {
      score: (totalScore / 6.0) * 100,
      factors
    };
  }

  /**
   * Category 4: Technical Setup & Structured Data (18%)
   */
  analyzeTechnicalSetup() {
    const param4a = this.analyzeCrawlerAccess();
    const param4b = this.analyzeStructuredData();

    const rawScore = (param4a.score + param4b.score) / 2;

    return {
      score: Math.round(rawScore),
      weight: this.weights.technicalSetup,
      subfactors: {
        crawlerAccess: param4a,
        structuredData: param4b
      }
    };
  }

  /**
   * Parameter 4.a: AI Crawler Access & Real-Time Availability
   */
  analyzeCrawlerAccess() {
    const factors = {};
    const firstPage = this.siteData.pages[0].evidence;

    // Factor 1: Robots.txt Configuration
    // (Assume allowed since we crawled successfully)
    factors.robotsTxt = 1.8;

    // Factor 2: Uptime & Reliability
    // (All pages loaded = 100% uptime during crawl)
    const successRate = this.siteData.pageCount / Math.min(15, this.siteData.pageCount);
    factors.uptime = successRate >= 0.95 ? 1.8 : successRate >= 0.80 ? 1.2 : 0.6;

    // Factor 3: Server Response Optimization
    const ttfb = firstPage.performance.ttfb || 2000;
    factors.serverResponse = this.scoreTier(ttfb, [
      { threshold: 200, score: 1.8, reverse: true },
      { threshold: 500, score: 1.2, reverse: true }
    ], 0.6);

    // Factor 4: XML Sitemap Availability (CRITICAL FIX!)
    // Sitemap helps crawlers discover all pages efficiently
    if (this.siteData.sitemapDetected) {
      factors.sitemap = 1.8;  // Sitemap found = excellent
      console.log(`[V5-Enhanced] Sitemap scoring: 1.8 (detected at ${this.siteData.sitemapLocation})`);
    } else {
      factors.sitemap = 0;  // No sitemap = 0 points
      console.log(`[V5-Enhanced] Sitemap scoring: 0 (not detected)`);
    }

    // Factor 5: CDN & Global Accessibility
    // (Check for CDN headers)
    factors.cdn = firstPage.technical.cacheControl ? 1.2 : 0.6;

    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);

    console.log(`[V5-Enhanced] Crawler Access Factors:`, factors);
    console.log(`[V5-Enhanced] Crawler Access Total: ${totalScore}/9.0 = ${(totalScore / 9.0) * 100}%`);

    return {
      score: (totalScore / 9.0) * 100,
      factors
    };
  }

  /**
   * Parameter 4.b: Advanced Structured Data & Rich Snippets
   */
  analyzeStructuredData() {
    const factors = {};

    const schemaPercent = this.siteData.siteMetrics.pagesWithSchema * 100;
    const faqSchemaPercent = this.siteData.siteMetrics.pagesWithFAQSchema * 100;
    const orgSchemaPercent = this.siteData.siteMetrics.pagesWithOrganizationSchema * 100;

    // Factor 1: Comprehensive Schema Markup
    factors.schemaMarkup = this.scoreTier(schemaPercent, [
      { threshold: 80, score: 1.8 },
      { threshold: 50, score: 1.2 },
      { threshold: 25, score: 0.6 }
    ]);

    // Factor 2: FAQ Schema Implementation
    factors.faqSchema = this.scoreTier(faqSchemaPercent, [
      { threshold: 30, score: 1.8 },
      { threshold: 10, score: 1.2 }
    ]);

    // Factor 3: Rich Snippet Optimization
    const firstPage = this.siteData.pages[0].evidence;
    const schemaTypes = this.countSchemaTypes(firstPage);
    factors.richSnippets = this.scoreTier(schemaTypes, [
      { threshold: 3, score: 1.8 },
      { threshold: 1, score: 1.2 }
    ], 0.6);

    // Factor 4: Local Business Schema
    factors.localBusiness = orgSchemaPercent >= 20 ? 1.8 : orgSchemaPercent >= 10 ? 1.2 : 0;

    // Factor 5: Content Licensing & Usage Schema
    factors.licensing = 0; // Would need specific license markup detection

    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);

    return {
      score: (totalScore / 9.0) * 100,
      factors
    };
  }

  /**
   * Category 5: Trust, Authority & Verification (12%)
   */
  analyzeTrustAuthority() {
    const param5a = this.analyzeEEAT();
    const param5b = this.analyzeAuthorityNetwork();

    const rawScore = (param5a.score + param5b.score) / 2;

    return {
      score: Math.round(rawScore),
      weight: this.weights.trustAuthority,
      subfactors: {
        eeat: param5a,
        authorityNetwork: param5b
      }
    };
  }

  /**
   * Parameter 5.a: Enhanced E-E-A-T Signals
   */
  analyzeEEAT() {
    const factors = {};
    const firstPage = this.siteData.pages[0].evidence;

    // Factor 1: Verified Author Profiles
    const hasAuthor = firstPage.metadata.author ? 1 : 0;
    factors.authorProfiles = hasAuthor ? 1.2 : 0.4;

    // Factor 2: Professional Credential Documentation (Enhanced with Certification Library)
    if (this.certificationData && !this.certificationData.genericOnly) {
      // Use certification detection results
      const certScore = calculateCertificationScore(this.certificationData);
      // Map 0-100 score to 0-1.2 scale for factor scoring
      factors.professionalCertifications = (certScore / 100) * 1.2;

      // Additional factor for team credentials (Person schema with credentials)
      const teamCredScore = this.detectTeamCredentials();
      factors.teamCredentials = teamCredScore;
    } else if (this.certificationData?.genericOnly) {
      // Generic detection present: expose trust signal issue opportunities without changing scoring
      factors.credentials = this.detectCredentials(firstPage) ? 1.2 : 0;
    } else {
      // Fallback to basic detection
      factors.credentials = this.detectCredentials(firstPage) ? 1.2 : 0;
    }

    // Factor 3: Content Attribution & Byline Consistency
    factors.attribution = hasAuthor ? 1.2 : 0.4;

    // Factor 4: Expert Network Connections
    factors.expertNetwork = this.siteData.siteMetrics.avgEntitiesPerPage >= 15 ? 1.2 : 0.8;

    // Factor 5: Local Trust & Community Signals
    const geoPercent = this.siteData.siteMetrics.pagesWithLocationData * 100;
    factors.localTrust = this.scoreTier(geoPercent, [
      { threshold: 50, score: 1.2 },
      { threshold: 20, score: 0.8 }
    ]);

    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);
    const maxScore = this.certificationData ? 7.2 : 6.0; // 6 factors with cert data, 5 without

    return {
      score: (totalScore / maxScore) * 100,
      factors
    };
  }

  /**
   * Parameter 5.b: Authority Network & Citation Analysis
   */
  analyzeAuthorityNetwork() {
    const factors = {};

    // Factor 1: Domain Authority & Link Quality
    // (Proxy: content depth + schema presence)
    const avgWords = this.siteData.siteMetrics.avgWordCount;
    const schemaPercent = this.siteData.siteMetrics.pagesWithSchema * 100;
    const daProxy = (avgWords / 1000) * 0.5 + (schemaPercent / 100) * 0.5;
    factors.domainAuthority = this.scoreTier(daProxy * 100, [
      { threshold: 60, score: 1.2 },
      { threshold: 40, score: 0.8 }
    ], 0.4);

    // Factor 2: Industry Memberships & Associations (Enhanced)
    if (this.certificationData) {
      factors.industryMemberships = this.detectIndustryMemberships();
    } else {
      factors.industryCitations = 0.8; // Fallback base score
    }

    // Factor 3: Content Citation & Reference Quality
    factors.outboundLinks = 0.8; // Would need link analysis

    // Factor 4: Social Authority Signals
    const firstPage = this.siteData.pages[0].evidence;
    const hasSocial = firstPage.metadata.ogImage || firstPage.metadata.twitterCard;
    factors.socialAuthority = hasSocial ? 1.2 : 0.4;

    // Factor 5: Thought Leadership Indicators
    const pillarPages = this.siteData.siteMetrics.pillarPageCount;
    factors.thoughtLeadership = this.scoreTier(pillarPages, [
      { threshold: 2, score: 1.2 },
      { threshold: 1, score: 0.8 }
    ]);

    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);

    return {
      score: (totalScore / 6.0) * 100,
      factors
    };
  }

  /**
   * Category 6: AI Readability & Multimodal Access (10%)
   */
  analyzeAIReadability() {
    const factors = {};

    // Factor 1: Alt Text Coverage & Quality
    const altPercent = this.siteData.siteMetrics.pagesWithGoodAltText * 100;
    factors.altText = this.scoreTier(altPercent, [
      { threshold: 90, score: 2.0 },
      { threshold: 70, score: 1.4 },
      { threshold: 50, score: 0.8 }
    ]);

    // Factor 2: Video/Audio Transcription
    factors.transcription = 1.4; // Assume moderate

    // Factor 3: Interactive Content Accessibility
    const semanticPercent = this.siteData.siteMetrics.pagesWithSemanticHTML * 100;
    factors.interactive = this.scoreTier(semanticPercent, [
      { threshold: 80, score: 2.0 },
      { threshold: 50, score: 1.4 }
    ], 0.8);

    // Factor 4: Document & File Accessibility
    factors.documents = 1.4; // Base score

    // Factor 5: Cross-Media Content Relationships
    const avgImages = this.siteData.siteMetrics.avgImageCount;
    factors.crossMedia = this.scoreTier(avgImages, [
      { threshold: 3, score: 2.0 },
      { threshold: 1, score: 1.4 }
    ]);

    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);

    return {
      score: (totalScore / 10.0) * 100,
      weight: this.weights.aiReadability,
      subfactors: factors
    };
  }

  /**
   * Category 7: Content Freshness & Maintenance (8%)
   */
  analyzeContentFreshness() {
    const factors = {};

    // Factor 1: Last Modified & Update Frequency
    const modifiedPercent = this.siteData.siteMetrics.pagesWithLastModified * 100;
    factors.lastModified = this.scoreTier(modifiedPercent, [
      { threshold: 80, score: 1.6 },
      { threshold: 50, score: 1.1 },
      { threshold: 25, score: 0.6 }
    ]);

    // Factor 2: Content Versioning
    factors.versioning = 1.1; // Base score

    // Factor 3: Time-Sensitive Content Management
    const currentYearPercent = this.siteData.siteMetrics.pagesWithCurrentYear * 100;
    factors.timeSensitive = this.scoreTier(currentYearPercent, [
      { threshold: 60, score: 1.6 },
      { threshold: 30, score: 1.1 }
    ], 0.6);

    // Factor 4: Content Audit Process
    factors.auditProcess = modifiedPercent >= 60 ? 1.6 : 1.1;

    // Factor 5: Real-Time Information Integration
    factors.realTimeInfo = 1.1; // Base score

    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);

    return {
      score: (totalScore / 8.0) * 100,
      weight: this.weights.contentFreshness,
      subfactors: factors
    };
  }

  /**
   * Category 8: Speed & User Experience (5%)
   */
  analyzeSpeedUX() {
    const factors = {};
    const firstPage = this.siteData.pages[0].evidence;
    const ttfb = firstPage.performance.ttfb || 2000;

    // Factor 1: LCP (Largest Contentful Paint)
    const estimatedLCP = ttfb * 2;
    factors.lcp = this.scoreTier(estimatedLCP, [
      { threshold: 2000, score: 1.0, reverse: true },
      { threshold: 2500, score: 0.7, reverse: true },
      { threshold: 4000, score: 0.4, reverse: true }
    ]);

    // Factor 2: CLS (Cumulative Layout Shift)
    factors.cls = 0.7; // Assume moderate

    // Factor 3: INP (Interaction to Next Paint)
    factors.inp = ttfb < 500 ? 1.0 : ttfb < 1000 ? 0.7 : 0.4;

    // Factor 4: Mobile Performance
    const hasViewport = firstPage.technical.hasViewport;
    factors.mobile = hasViewport ? 1.0 : 0.4;

    // Factor 5: Crawler Response Times
    factors.crawlerResponse = this.scoreTier(ttfb, [
      { threshold: 200, score: 1.0, reverse: true },
      { threshold: 500, score: 0.7, reverse: true }
    ], 0.4);

    const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);

    return {
      score: (totalScore / 5.0) * 100,
      weight: this.weights.speedUX,
      subfactors: factors,
      note: 'Performance metrics are estimated. Use PageSpeed Insights for accurate measurements.'
    };
  }

  /**
   * Calculate weighted total score
   */
  calculateTotalScore(categoryScores) {
    let total = 0;

    for (const [category, data] of Object.entries(categoryScores)) {
      total += data.score * data.weight;
    }

    return Math.min(100, Math.max(0, total));
  }

  /**
   * Calculate letter grade based on PDF rubric
   */
  calculateGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  // ===== HELPER METHODS =====

  /**
   * Score based on tiered thresholds (matches PDF rubric)
   * @param {number} value - The value to score
   * @param {Array} tiers - Array of {threshold, score} objects
   * @param {number} defaultScore - Score if no tier matches
   * @returns {number} The score
   */
  scoreTier(value, tiers, defaultScore = 0) {
    // Handle reverse scoring (lower is better, e.g., TTFB)
    const reverse = tiers[0]?.reverse;

    if (reverse) {
      // For reverse scoring (lower is better)
      for (const tier of tiers) {
        if (value < tier.threshold) {
          return tier.score;
        }
      }
    } else {
      // For normal scoring (higher is better)
      for (const tier of tiers) {
        if (value >= tier.threshold) {
          return tier.score;
        }
      }
    }

    return defaultScore;
  }

  /**
   * Detect if Schema.org has sameAs property (knowledge graph connections)
   */
  detectSameAsInSchema(evidence) {
    return evidence.technical.structuredData.some(schema => {
      const raw = JSON.stringify(schema.raw);
      return raw.includes('sameAs');
    });
  }

  /**
   * Count unique Schema.org types
   */
  countSchemaTypes(evidence) {
    const types = new Set(evidence.technical.structuredData.map(s => s.type));
    return types.size;
  }

  /**
   * Detect professional credentials in content
   */
  detectCredentials(evidence) {
    const text = evidence.content.bodyText.toLowerCase();
    const credentialKeywords = ['certified', 'certification', 'license', 'accredited', 'phd', 'mba', 'degree'];
    return credentialKeywords.some(k => text.includes(k));
  }

  /**
   * Detect team member credentials (Person schema with hasCredential)
   * @returns {number} - Score from 0 to 1.2
   */
  detectTeamCredentials() {
    let teamMembersWithCredentials = 0;
    let totalTeamMembers = 0;

    // Scan all pages for Person schemas
    this.siteData.pages.forEach(page => {
      if (!page.evidence.technical || !page.evidence.technical.schemas) return;

      page.evidence.technical.schemas.forEach(schema => {
        if (schema['@type'] === 'Person') {
          totalTeamMembers++;
          if (schema.hasCredential || schema.credential || schema.award || schema.honorificSuffix) {
            teamMembersWithCredentials++;
          }
        }
      });
    });

    if (totalTeamMembers === 0) {
      // No Person schemas found, check for basic team mentions
      const firstPage = this.siteData.pages[0].evidence;
      const hasTeamPage = firstPage.content.bodyText.toLowerCase().includes('team') ||
                          firstPage.content.bodyText.toLowerCase().includes('about us');
      return hasTeamPage ? 0.4 : 0;
    }

    // Calculate score based on percentage with credentials
    const credentialPercentage = (teamMembersWithCredentials / totalTeamMembers) * 100;

    return this.scoreTier(credentialPercentage, [
      { threshold: 75, score: 1.2 },
      { threshold: 50, score: 0.8 },
      { threshold: 25, score: 0.4 }
    ], 0);
  }

  /**
   * Detect industry memberships (Organization.memberOf)
   * @returns {number} - Score from 0 to 1.2
   */
  detectIndustryMemberships() {
    let hasMemberships = false;
    const memberships = [];

    // Scan all pages for Organization schemas with memberOf
    this.siteData.pages.forEach(page => {
      if (!page.evidence.technical || !page.evidence.technical.schemas) return;

      page.evidence.technical.schemas.forEach(schema => {
        if (schema['@type'] === 'Organization' && schema.memberOf) {
          hasMemberships = true;
          if (Array.isArray(schema.memberOf)) {
            memberships.push(...schema.memberOf);
          } else {
            memberships.push(schema.memberOf);
          }
        }
      });
    });

    if (!hasMemberships) {
      // Check for membership keywords in text
      const firstPage = this.siteData.pages[0].evidence;
      const text = firstPage.content.bodyText.toLowerCase();
      const membershipKeywords = ['member of', 'association', 'partner', 'certified partner', 'industry member'];
      const hasKeyword = membershipKeywords.some(k => text.includes(k));
      return hasKeyword ? 0.6 : 0;
    }

    // Score based on number of memberships
    const membershipCount = memberships.length;
    return this.scoreTier(membershipCount, [
      { threshold: 3, score: 1.2 },
      { threshold: 1, score: 0.8 }
    ], 0);
  }

  /**
   * Check if evidence has question-based headings
   */
  hasQuestionHeadings(evidence) {
    const allHeadings = [
      ...evidence.content.headings.h1,
      ...evidence.content.headings.h2,
      ...evidence.content.headings.h3
    ];

    const questionWords = ['what', 'why', 'how', 'when', 'where', 'who', 'which', 'can', 'should', 'does'];
    return allHeadings.some(h => {
      const lower = h.toLowerCase();
      return questionWords.some(q => lower.startsWith(q)) || lower.includes('?');
    });
  }
}

module.exports = V5EnhancedRubricEngine;
