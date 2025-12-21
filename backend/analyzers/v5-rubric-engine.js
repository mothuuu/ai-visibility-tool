const ContentExtractor = require('./content-extractor');
const { validateEvidence } = require('./evidence-contract');
const { measured, notMeasured } = require('./score-types');

/**
 * V5 Rubric Scoring Engine
 * Main orchestrator for all 8 categories and 50+ subfactors
 * 
 * IMPORTANT: All scoring methods are PURE FUNCTIONS that depend ONLY on the Evidence Contract.
 * This makes them testable, predictable, and maintainable.
 * 
 * Scoring: 0-100 (backend), displayed as 0-1000 on frontend
 * 
 * Category Weights (must sum to 100%):
 * 1. AI Readability & Multimodal: 10%
 * 2. AI Search Readiness: 20%
 * 3. Content Freshness: 8%
 * 4. Content Structure: 15%
 * 5. Speed & UX: 5%
 * 6. Technical Setup: 18%
 * 7. Trust & Authority: 12%
 * 8. Voice Optimization: 12%
 */

class V5RubricEngine {
  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
    this.evidence = null;
    
    // Category weights (must sum to 1.0)
    this.weights = {
      aiReadability: 0.10,
      aiSearchReadiness: 0.20,
      contentFreshness: 0.08,
      contentStructure: 0.15,
      speedUX: 0.05,
      technicalSetup: 0.18,
      trustAuthority: 0.12,
      voiceOptimization: 0.12
    };
  }

  /**
   * Main analysis method
   * Returns complete V5 score with all categories and subfactors
   */
  async analyze() {
    try {
      console.log(`[V5] Starting analysis for: ${this.url}`);
      
      // Step 1: Extract content (Evidence Contract)
      const extractor = new ContentExtractor(this.url, this.options);
      this.evidence = await extractor.extract();
      
      // Step 2: Validate evidence contract
      const validation = validateEvidence(this.evidence);
      if (!validation.valid) {
        console.warn('[V5] Evidence validation warnings:', validation.errors);
      }
      
      console.log(`[V5] Content extracted: ${this.evidence.content.wordCount} words`);
      
      // Step 3: Analyze each category (pure functions using evidence)
      const categoryScores = {
        aiReadability: this.analyzeAIReadability(this.evidence),
        aiSearchReadiness: this.analyzeAISearchReadiness(this.evidence),
        contentFreshness: this.analyzeContentFreshness(this.evidence),
        contentStructure: this.analyzeContentStructure(this.evidence),
        speedUX: this.analyzeSpeedUX(this.evidence),
        technicalSetup: this.analyzeTechnicalSetup(this.evidence),
        trustAuthority: this.analyzeTrustAuthority(this.evidence),
        voiceOptimization: this.analyzeVoiceOptimization(this.evidence)
      };
      
      // Step 4: Calculate weighted total score
      const totalScore = this.calculateTotalScore(categoryScores);
      
      // Step 5: Detect industry
      const industry = ContentExtractor.detectIndustry(
        this.evidence.content,
        this.evidence.metadata
      );
      
      console.log(`[V5] Analysis complete. Total score: ${totalScore}/100 (${industry})`);
      
      return {
        url: this.url,
        totalScore: Math.round(totalScore),
        industry,
        categories: categoryScores,
        metadata: {
          wordCount: this.evidence.content.wordCount,
          imageCount: this.evidence.media.imageCount,
          pageTitle: this.evidence.metadata.title,
          analyzedAt: new Date().toISOString()
        }
      };
      
    } catch (error) {
      console.error(`[V5] Analysis failed:`, error);
      throw new Error(`V5 Rubric analysis failed: ${error.message}`);
    }
  }

  /**
   * Category 1: AI Readability & Multimodal Access (10%)
   * PURE FUNCTION - depends only on evidence
   */
  analyzeAIReadability(evidence) {
    const subfactors = {};
    
    // Subfactor 1: Alt text coverage & quality (35%)
    const altCoverage = evidence.media.imageCount > 0 
      ? (evidence.media.imagesWithAlt / evidence.media.imageCount) * 100 
      : 100;
    
    const altQuality = this.assessAltTextQuality(evidence.media.images);
    subfactors.altTextScore = (altCoverage * 0.7 + altQuality * 0.3);
    
    // Subfactor 2: Video/Audio captions & transcripts (35%)
    subfactors.captionsTranscriptsScore = this.assessMediaAccessibility(evidence.media);
    
    // Subfactor 3: Interactive docs & media accessible (20%)
    subfactors.interactiveAccessScore = this.assessInteractiveAccessibility(evidence.media, evidence.content);
    
    // Subfactor 4: Cross-media relationships (10%)
    subfactors.crossMediaScore = this.assessCrossMediaRelationships(evidence.media, evidence.content);
    
    // Weighted category score
    const categoryScore = (
      subfactors.altTextScore * 0.35 +
      subfactors.captionsTranscriptsScore * 0.35 +
      subfactors.interactiveAccessScore * 0.20 +
      subfactors.crossMediaScore * 0.10
    );
    
    return {
      score: Math.round(categoryScore),
      subfactors,
      weight: this.weights.aiReadability,
      details: {
        altCoveragePercent: Math.round(altCoverage),
        videosWithCaptions: evidence.media.videos.filter(v => v.hasCaptions).length,
        totalVideos: evidence.media.videos.length
      }
    };
  }

  /**
   * Category 2: AI Search Readiness & Content Depth (20%)
   * PURE FUNCTION - depends only on evidence
   *
   * RULEBOOK v1.2 Step 13: Handles tri-state scores
   */
  analyzeAISearchReadiness(evidence) {
    const subfactors = {};

    // Helper to extract numeric score from tri-state or raw value
    const getScore = (value) => {
      if (value === null || value === undefined) return 0;
      if (typeof value === 'object' && value.score !== undefined) {
        return value.score ?? 0; // null scores become 0 for calculation
      }
      return value;
    };

    // All subfactors as pure functions
    subfactors.questionHeadingsScore = this.assessQuestionHeadings(evidence.content.headings);
    subfactors.scannabilityScore = this.assessScannability(evidence.content);
    subfactors.readabilityScore = this.calculateFleschScore(evidence.content.bodyText);
    subfactors.faqScore = this.assessFAQs(evidence.content.faqs);
    subfactors.snippetEligibleScore = this.assessSnippetEligibility(evidence.content);
    subfactors.pillarPagesScore = this.assessPillarPages(evidence.content, evidence.structure);
    subfactors.linkedSubpagesScore = this.assessLinkedSubpages(evidence.structure);
    subfactors.painPointsScore = this.assessPainPoints(evidence.content);
    subfactors.geoContentScore = this.assessGeoContent(evidence.metadata, evidence.content);

    // Weighted category score (using getScore to handle tri-state)
    const categoryScore = (
      getScore(subfactors.questionHeadingsScore) * 0.12 +
      getScore(subfactors.scannabilityScore) * 0.12 +
      getScore(subfactors.readabilityScore) * 0.12 +
      getScore(subfactors.faqScore) * 0.12 +
      getScore(subfactors.snippetEligibleScore) * 0.10 +
      getScore(subfactors.pillarPagesScore) * 0.10 +
      getScore(subfactors.linkedSubpagesScore) * 0.10 +
      getScore(subfactors.painPointsScore) * 0.12 +
      getScore(subfactors.geoContentScore) * 0.10
    );

    return {
      score: Math.round(categoryScore),
      subfactors,
      weight: this.weights.aiSearchReadiness
    };
  }

  /**
   * Category 3: Content Freshness & Maintenance (8%)
   * PURE FUNCTION - depends only on evidence
   *
   * RULEBOOK v1.2 Step 13: Handles tri-state scores
   */
  analyzeContentFreshness(evidence) {
    const subfactors = {};

    // Helper to extract numeric score from tri-state or raw value
    const getScore = (value) => {
      if (value === null || value === undefined) return 0;
      if (typeof value === 'object' && value.score !== undefined) {
        return value.score ?? 0;
      }
      return value;
    };

    subfactors.lastUpdatedScore = this.assessLastUpdated(evidence.metadata, evidence.content);
    subfactors.versioningScore = this.assessVersioning(evidence.content);
    subfactors.timeSensitiveScore = this.assessTimeSensitiveContent(evidence.content);
    subfactors.auditProcessScore = this.assessAuditProcess(evidence.metadata);
    subfactors.liveDataScore = this.assessLiveData(evidence.content);
    subfactors.httpFreshnessScore = this.assessHTTPFreshness(evidence.technical);
    subfactors.editorialCalendarScore = this.assessEditorialCalendar(evidence.content);

    const categoryScore = (
      getScore(subfactors.lastUpdatedScore) * 0.25 +
      getScore(subfactors.versioningScore) * 0.15 +
      getScore(subfactors.timeSensitiveScore) * 0.15 +
      getScore(subfactors.auditProcessScore) * 0.15 +
      getScore(subfactors.liveDataScore) * 0.10 +
      getScore(subfactors.httpFreshnessScore) * 0.10 +
      getScore(subfactors.editorialCalendarScore) * 0.10
    );

    return {
      score: Math.round(categoryScore),
      subfactors,
      weight: this.weights.contentFreshness
    };
  }

  /**
   * Category 4: Content Structure & Entity Recognition (15%)
   * PURE FUNCTION - depends only on evidence
   */
  analyzeContentStructure(evidence) {
    const subfactors = {};
    
    subfactors.headingHierarchyScore = this.assessHeadingHierarchy(evidence.structure, evidence.content);
    subfactors.navigationScore = this.assessNavigation(evidence.structure);
    subfactors.entityCuesScore = this.assessEntityCues(evidence.content);
    subfactors.accessibilityScore = this.assessAccessibility(evidence.accessibility);
    subfactors.geoMetaScore = this.assessGeoMeta(evidence.metadata);
    
    const categoryScore = (
      subfactors.headingHierarchyScore * 0.35 +
      subfactors.navigationScore * 0.20 +
      subfactors.entityCuesScore * 0.20 +
      subfactors.accessibilityScore * 0.15 +
      subfactors.geoMetaScore * 0.10
    );
    
    return {
      score: Math.round(categoryScore),
      subfactors,
      weight: this.weights.contentStructure
    };
  }

  /**
   * Category 5: Speed & User Experience (5%)
   * PURE FUNCTION - depends only on evidence
   */
  analyzeSpeedUX(evidence) {
    const subfactors = {};
    
    const ttfb = evidence.performance.ttfb || 3000;
    subfactors.lcpScore = this.estimateLCP(ttfb);
    subfactors.clsScore = 70;
    subfactors.inpScore = this.estimateINP(ttfb);
    subfactors.mobileScore = 60;
    subfactors.crawlerResponseScore = this.assessCrawlerResponse(evidence.performance);
    
    const categoryScore = (
      subfactors.lcpScore * 0.25 +
      subfactors.clsScore * 0.25 +
      subfactors.inpScore * 0.25 +
      subfactors.mobileScore * 0.15 +
      subfactors.crawlerResponseScore * 0.10
    );
    
    return {
      score: Math.round(categoryScore),
      subfactors,
      weight: this.weights.speedUX,
      note: 'Speed metrics are estimated. Use Google PageSpeed Insights for accurate CWV.'
    };
  }

  /**
   * Category 6: Technical Setup & Structured Data (18%)
   * PURE FUNCTION - depends only on evidence
   */
  /**
   * RULEBOOK v1.2 Section 10.2: Null/not_measured score states
   * Do NOT default to 50 for unmeasurable factors. Use null instead.
   */
  analyzeTechnicalSetup(evidence) {
    const subfactors = {};

    subfactors.crawlerAccessScore = this.assessCrawlerAccess(evidence.technical, evidence.performance);
    subfactors.structuredDataScore = this.assessStructuredData(evidence.technical);
    subfactors.canonicalHreflangScore = this.assessCanonicalHreflang(evidence.technical);
    subfactors.openGraphScore = this.assessOpenGraph(evidence.metadata);

    // RULEBOOK v1.2: Use actual detection, not default values
    subfactors.sitemapScore = evidence.technical.hasSitemapLink ? 100 : 0;

    // RULEBOOK v1.2: Use new IndexNow detection
    subfactors.indexNowScore = evidence.technical.indexNow?.detected ? 100 : 0;

    // RULEBOOK v1.2: Use new RSS/Atom feed detection
    subfactors.rssFeedScore = evidence.technical.feeds?.detected ? 100 : 0;

    // Calculate weighted score, skipping null values
    const weights = {
      crawlerAccessScore: 0.30,
      structuredDataScore: 0.30,
      canonicalHreflangScore: 0.10,
      openGraphScore: 0.05,
      sitemapScore: 0.10,
      indexNowScore: 0.10,
      rssFeedScore: 0.05
    };

    let totalWeight = 0;
    let weightedSum = 0;

    for (const [key, weight] of Object.entries(weights)) {
      const score = subfactors[key];
      if (score !== null && score !== undefined) {
        weightedSum += score * weight;
        totalWeight += weight;
      }
    }

    const categoryScore = totalWeight > 0 ? weightedSum / totalWeight * 100 / 100 : 0;

    return {
      score: Math.round(categoryScore),
      subfactors,
      weight: this.weights.technicalSetup
    };
  }

  /**
   * Category 7: Trust, Authority & Verification (12%)
   * PURE FUNCTION - depends only on evidence
   *
   * RULEBOOK v1.2 Section 10.2: Null/not_measured score states
   */
  analyzeTrustAuthority(evidence) {
    const subfactors = {};

    subfactors.authorBiosScore = this.assessAuthorBios(evidence.content, evidence.metadata);
    subfactors.certificationsScore = this.assessCertifications(evidence.content);
    // RULEBOOK v1.2: Use null for unmeasurable factors, not default 60
    subfactors.domainAuthorityScore = null; // Would need external API
    subfactors.thoughtLeadershipScore = this.assessThoughtLeadership(evidence.content, evidence.structure);
    // RULEBOOK v1.2: Use new thirdPartyProfiles evidence
    subfactors.thirdPartyProfilesScore = this.assessThirdPartyProfiles(evidence.thirdPartyProfiles || evidence.content);

    // Calculate weighted score, skipping null values (RULEBOOK v1.2)
    const weights = {
      authorBiosScore: 0.25,
      certificationsScore: 0.15,
      domainAuthorityScore: 0.25,
      thoughtLeadershipScore: 0.20,
      thirdPartyProfilesScore: 0.15
    };

    let totalWeight = 0;
    let weightedSum = 0;

    for (const [key, weight] of Object.entries(weights)) {
      const score = subfactors[key];
      if (score !== null && score !== undefined) {
        weightedSum += score * weight;
        totalWeight += weight;
      }
    }

    const categoryScore = totalWeight > 0 ? (weightedSum / totalWeight) : 0;
    
    return {
      score: Math.round(categoryScore),
      subfactors,
      weight: this.weights.trustAuthority
    };
  }

  /**
   * Category 8: Voice & Conversational Optimization (12%)
   * PURE FUNCTION - depends only on evidence
   */
  analyzeVoiceOptimization(evidence) {
    const subfactors = {};
    
    subfactors.longTailScore = this.assessLongTailPhrases(evidence.content);
    subfactors.localIntentScore = this.assessLocalIntent(evidence.content, evidence.metadata);
    subfactors.conversationalTermsScore = this.assessConversationalTerms(evidence.content);
    subfactors.snippetFormatScore = this.assessSnippetFormat(evidence.content);
    subfactors.multiTurnScore = this.assessMultiTurnContinuity(evidence.content, evidence.structure);
    
    const categoryScore = (
      subfactors.longTailScore * 0.25 +
      subfactors.localIntentScore * 0.25 +
      subfactors.conversationalTermsScore * 0.20 +
      subfactors.snippetFormatScore * 0.15 +
      subfactors.multiTurnScore * 0.15
    );
    
    return {
      score: Math.round(categoryScore),
      subfactors,
      weight: this.weights.voiceOptimization
    };
  }

  /**
   * Calculate weighted total score from all categories
   */
  calculateTotalScore(categoryScores) {
    let total = 0;
    
    for (const [category, data] of Object.entries(categoryScores)) {
      total += data.score * data.weight;
    }
    
    return Math.min(100, Math.max(0, total)); // Clamp between 0-100
  }

  // ===== HELPER METHODS FOR SUBFACTOR ANALYSIS =====

  assessAltTextQuality(images) {
    if (images.length === 0) return 100;
    
    const withAlt = images.filter(img => img.alt);
    const qualityScores = withAlt.map(img => {
      const alt = img.alt.toLowerCase();
      // Good alt text: descriptive, not generic, 5-125 chars
      if (alt.length < 5) return 30;
      if (alt.includes('image') || alt.includes('picture') || alt.includes('photo')) return 50;
      if (alt.length > 125) return 70;
      return 100;
    });
    
    return qualityScores.length > 0 
      ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
      : 0;
  }

  assessMediaAccessibility(media) {
    const totalMedia = media.videoCount + media.audioCount;
    if (totalMedia === 0) return 100; // No media = perfect score
    
    const withCaptions = media.videos.filter(v => v.hasCaptions || v.hasTranscript).length;
    const withTranscripts = media.audio.filter(a => a.hasTranscript).length;
    const accessible = withCaptions + withTranscripts;
    
    return (accessible / totalMedia) * 100;
  }

  assessInteractiveAccessibility(media, content) {
    // Check for interactive elements with accessibility
    let score = 50; // Base score
    
    // Bonus for accessible interactive elements
    if (content.tables.length > 0) score += 20;
    if (content.lists.length > 5) score += 15;
    if (media.videos.some(v => v.hasControls)) score += 15;
    
    return Math.min(100, score);
  }

  assessCrossMediaRelationships(media, content) {
    let score = 40; // Base score
    
    // Check if images are referenced in text
    const imagesMentioned = media.images.filter(img => 
      img.alt && content.bodyText.toLowerCase().includes(img.alt.toLowerCase().substring(0, 20))
    ).length;
    
    if (imagesMentioned > 0) score += 30;
    
    // Check for figure/figcaption elements
    score += Math.min(30, media.imageCount * 3);
    
    return Math.min(100, score);
  }

  assessQuestionHeadings(headings) {
    const allHeadings = [...headings.h1, ...headings.h2, ...headings.h3];
    if (allHeadings.length === 0) return 0;
    
    const questionWords = ['what', 'why', 'how', 'when', 'where', 'who', 'which', 'can', 'should', 'does', 'is', 'are'];
    const questionHeadings = allHeadings.filter(h => {
      const lower = h.toLowerCase();
      return questionWords.some(q => lower.startsWith(q)) || lower.includes('?');
    });
    
    const percentage = (questionHeadings.length / allHeadings.length) * 100;
    return Math.min(100, percentage * 3); // Scale up (33% questions = 100 score)
  }

  assessScannability(content) {
    let score = 0;
    
    // Lists (max 40 points)
    const listItems = content.lists.reduce((sum, list) => sum + list.itemCount, 0);
    score += Math.min(40, listItems * 2);
    
    // Tables (max 30 points)
    score += Math.min(30, content.tables.length * 10);
    
    // Short paragraphs (max 30 points)
    const shortParas = content.paragraphs.filter(p => p.split(/\s+/).length <= 100).length;
    score += Math.min(30, shortParas * 2);
    
    return Math.min(100, score);
  }

  /**
   * RULEBOOK v1.2 Step 13: Tri-state scoring
   * Returns notMeasured for insufficient text instead of 50
   */
  calculateFleschScore(text) {
    if (!text || text.length < 100) {
      return notMeasured('Insufficient text for readability analysis');
    }

    const words = text.split(/\s+/).length;
    const sentences = text.split(/[.!?]+/).length;
    const syllables = this.countSyllables(text);

    if (words === 0 || sentences === 0) {
      return notMeasured('No sentences found for readability');
    }

    const avgWordsPerSentence = words / sentences;
    const avgSyllablesPerWord = syllables / words;

    // Flesch Reading Ease formula
    const flesch = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);

    // Convert to 0-100 score (higher Flesch = easier to read = higher score)
    // Flesch 60-70 = good, aim for 60+
    let score;
    if (flesch >= 60) score = 100;
    else if (flesch >= 50) score = 80;
    else if (flesch >= 40) score = 60;
    else if (flesch >= 30) score = 40;
    else score = 20;

    return measured(score, ['content.paragraphs', 'content.bodyText']);
  }

  countSyllables(text) {
    const words = text.toLowerCase().match(/[a-z]+/g) || [];
    return words.reduce((total, word) => {
      // Simple syllable counting (not perfect but good enough)
      const matches = word.match(/[aeiouy]+/g);
      let count = matches ? matches.length : 0;
      if (word.endsWith('e')) count--;
      if (word.endsWith('le') && word.length > 2) count++;
      return total + Math.max(1, count);
    }, 0);
  }

  assessFAQs(faqs) {
    if (faqs.length === 0) return 30; // Some points for having content
    if (faqs.length >= 5) return 100;
    return 30 + (faqs.length * 14); // Scale linearly
  }

  assessSnippetEligibility(content) {
    const eligibleParagraphs = content.paragraphs.filter(p => {
      const wordCount = p.split(/\s+/).length;
      return wordCount >= 40 && wordCount <= 60;
    });
    
    if (eligibleParagraphs.length >= 3) return 100;
    if (eligibleParagraphs.length >= 2) return 80;
    if (eligibleParagraphs.length >= 1) return 60;
    return 30;
  }

  assessPillarPages(content, structure) {
    const indicators = [
      content.headings.h2.length >= 5,
      content.wordCount >= 1500,
      structure.hasMain || structure.hasArticle,
      content.lists.length >= 3
    ];
    
    const score = (indicators.filter(Boolean).length / indicators.length) * 100;
    return score;
  }

  assessLinkedSubpages(structure) {
    if (structure.internalLinks >= 5) return 100;
    if (structure.internalLinks >= 3) return 75;
    if (structure.internalLinks >= 1) return 50;
    return 20;
  }

  assessPainPoints(content) {
    const painPointKeywords = [
      'challenge', 'problem', 'issue', 'difficulty', 'struggle', 'pain',
      'frustrat', 'concern', 'obstacle', 'bottleneck', 'solution', 'solve'
    ];
    
    const text = content.bodyText.toLowerCase();
    const mentions = painPointKeywords.filter(keyword => text.includes(keyword));
    
    if (mentions.length >= 3) return 100;
    if (mentions.length >= 2) return 70;
    if (mentions.length >= 1) return 40;
    return 20;
  }

  assessGeoContent(metadata, content) {
    let score = 0;
    
    if (metadata.geoRegion || metadata.geoPlacename) score += 40;
    
    const geoKeywords = ['location', 'address', 'city', 'state', 'country', 'local', 'area', 'region'];
    const text = content.bodyText.toLowerCase();
    const geoMentions = geoKeywords.filter(k => text.includes(k)).length;
    
    score += Math.min(40, geoMentions * 10);
    
    // Case study keywords
    if (text.includes('case study') || text.includes('success story') || text.includes('client')) {
      score += 20;
    }
    
    return Math.min(100, score);
  }

  assessLastUpdated(metadata, content) {
    let score = 0;
    
    if (metadata.lastModified || metadata.publishedTime) score += 50;
    
    const text = content.bodyText.toLowerCase();
    if (text.includes('last updated') || text.includes('updated on') || text.includes('last modified')) {
      score += 50;
    }
    
    return score;
  }

  assessVersioning(content) {
    const text = content.bodyText.toLowerCase();
    const versioningKeywords = ['version', 'v1', 'v2', 'changelog', 'revision', 'updated', 'modified'];
    const hasVersioning = versioningKeywords.some(k => text.includes(k));
    
    return hasVersioning ? 75 : 25;
  }

  assessTimeSensitiveContent(content) {
    const currentYear = new Date().getFullYear().toString();
    const text = content.bodyText;
    
    if (text.includes(currentYear)) return 100;
    if (text.includes((currentYear - 1).toString())) return 70;
    return 40;
  }

  /**
   * RULEBOOK v1.2 Step 13: Tri-state scoring
   * Returns notMeasured when no last-modified date found
   */
  assessAuditProcess(metadata) {
    // Check for freshness signals in metadata
    if (metadata.lastModified) {
      const lastMod = new Date(metadata.lastModified);
      const daysSince = (Date.now() - lastMod.getTime()) / (1000 * 60 * 60 * 24);

      let score;
      if (daysSince < 30) score = 100;
      else if (daysSince < 90) score = 80;
      else if (daysSince < 180) score = 60;
      else score = 40;

      return measured(score, ['metadata.lastModified']);
    }
    return notMeasured('No lastModified metadata found');
  }

  assessLiveData(content) {
    const liveKeywords = ['real-time', 'live', 'current', 'now', 'today', 'latest'];
    const text = content.bodyText.toLowerCase();
    const mentions = liveKeywords.filter(k => text.includes(k)).length;
    
    return Math.min(100, mentions * 20);
  }

  assessHTTPFreshness(technical) {
    let score = 0;
    
    if (technical.cacheControl) score += 40;
    if (technical.lastModified) score += 30;
    if (technical.etag) score += 30;
    
    return score;
  }

  assessEditorialCalendar(content) {
    const calendarKeywords = ['upcoming', 'scheduled', 'published', 'archive', 'posts'];
    const text = content.bodyText.toLowerCase();
    const hasCalendar = calendarKeywords.filter(k => text.includes(k)).length >= 2;
    
    return hasCalendar ? 80 : 40;
  }

  assessHeadingHierarchy(structure, content) {
    let score = 0;
    
    // H1 should be exactly 1
    if (structure.headingCount.h1 === 1) score += 30;
    else if (structure.headingCount.h1 > 1) score += 10;
    
    // Should have H2s
    if (structure.headingCount.h2 >= 3) score += 25;
    else if (structure.headingCount.h2 >= 1) score += 15;
    
    // Should have H3s
    if (structure.headingCount.h3 >= 2) score += 20;
    
    // Semantic landmarks
    if (structure.hasMain) score += 10;
    if (structure.hasArticle) score += 5;
    if (structure.landmarks >= 2) score += 10;
    
    return Math.min(100, score);
  }

  assessNavigation(structure) {
    let score = 0;
    
    if (structure.elementsWithIds >= 5) score += 40;
    else score += structure.elementsWithIds * 8;
    
    if (structure.hasTOC) score += 30;
    if (structure.anchorLinks >= 3) score += 20;
    if (structure.hasBreadcrumbs) score += 10;
    
    return Math.min(100, score);
  }

  assessEntityCues(content) {
    // Look for proper nouns, capitalized words, specific names
    const text = content.bodyText;
    const properNouns = text.match(/\b[A-Z][a-z]+\b/g) || [];
    const uniqueEntities = [...new Set(properNouns)].length;
    
    if (uniqueEntities >= 20) return 100;
    if (uniqueEntities >= 10) return 75;
    if (uniqueEntities >= 5) return 50;
    return 25;
  }

  assessAccessibility(accessibility) {
    let score = 0;
    
    if (accessibility.hasLangAttribute) score += 20;
    if (accessibility.hasSkipLink) score += 15;
    
    const labelCoverage = accessibility.formsWithLabels;
    score += Math.min(30, labelCoverage * 30);
    
    if (accessibility.ariaLabels >= 5) score += 20;
    if (accessibility.semanticButtons > accessibility.divClickHandlers) score += 15;
    
    return Math.min(100, score);
  }

  assessGeoMeta(metadata) {
    let score = 50; // Base score
    
    if (metadata.geoRegion) score += 25;
    if (metadata.geoPlacename) score += 25;
    
    return score;
  }

  estimateLCP(ttfb) {
    // LCP should be < 2.5s (good), < 4s (needs improvement)
    // Estimate based on TTFB
    const estimatedLCP = ttfb * 2; // Rough estimate
    
    if (estimatedLCP < 2500) return 100;
    if (estimatedLCP < 4000) return 60;
    return 30;
  }

  estimateINP(ttfb) {
    // INP should be < 200ms (good), < 500ms (needs improvement)
    // Faster TTFB usually means better interactivity
    if (ttfb < 500) return 100;
    if (ttfb < 1000) return 70;
    return 40;
  }

  assessCrawlerResponse(performance) {
    const ttfb = performance.ttfb || 3000;
    
    if (ttfb < 200) return 100;
    if (ttfb < 500) return 90;
    if (ttfb < 1000) return 70;
    if (ttfb < 2000) return 50;
    return 30;
  }

  assessCrawlerAccess(technical, performance) {
    let score = 0;
    
    // Robots.txt (assume allowed if we fetched)
    score += 40;
    
    // Response time
    const ttfb = performance.ttfb || 3000;
    if (ttfb < 1000) score += 40;
    else if (ttfb < 2000) score += 25;
    else score += 10;
    
    // Viewport configured
    if (technical.hasViewport) score += 20;
    
    return Math.min(100, score);
  }

  assessStructuredData(technical) {
    const { structuredData } = technical;
    let score = 0;
    
    if (technical.hasOrganizationSchema) score += 25;
    if (technical.hasFAQSchema) score += 20;
    if (technical.hasArticleSchema) score += 20;
    if (technical.hasBreadcrumbSchema) score += 15;
    if (technical.hasLocalBusinessSchema) score += 20;
    
    return Math.min(100, score);
  }

  assessCanonicalHreflang(technical) {
    let score = 0;
    
    if (technical.hasCanonical) score += 60;
    if (technical.hreflangTags > 0) score += 40;
    
    return Math.min(100, score);
  }

  assessOpenGraph(metadata) {
    let score = 0;
    
    if (metadata.ogTitle) score += 30;
    if (metadata.ogDescription) score += 30;
    if (metadata.ogImage) score += 30;
    if (metadata.ogType) score += 10;
    
    return Math.min(100, score);
  }

  assessAuthorBios(content, metadata) {
    const text = content.bodyText.toLowerCase();
    const authorKeywords = ['author', 'written by', 'by', 'contributor', 'expert'];
    const hasAuthor = authorKeywords.some(k => text.includes(k));
    
    let score = hasAuthor ? 50 : 20;
    
    if (metadata.author) score += 30;
    
    // E-E-A-T signals
    const eatKeywords = ['experience', 'expert', 'certified', 'credential', 'qualification'];
    const eatMentions = eatKeywords.filter(k => text.includes(k)).length;
    score += Math.min(20, eatMentions * 5);
    
    return Math.min(100, score);
  }

  assessCertifications(content) {
    const certKeywords = ['certified', 'certification', 'license', 'accredited', 'member', 'award'];
    const text = content.bodyText.toLowerCase();
    const mentions = certKeywords.filter(k => text.includes(k)).length;
    
    if (mentions >= 3) return 100;
    if (mentions >= 2) return 70;
    if (mentions >= 1) return 40;
    return 20;
  }

  assessThoughtLeadership(content, structure) {
    let score = 0;
    
    // Long-form content indicates expertise
    if (content.wordCount >= 2000) score += 30;
    else if (content.wordCount >= 1000) score += 20;
    
    // External links to authoritative sources
    if (structure.externalLinks >= 5) score += 30;
    
    // Deep content structure
    if (content.headings.h2.length >= 5) score += 20;
    
    // Citations or references
    const text = content.bodyText.toLowerCase();
    if (text.includes('source') || text.includes('reference') || text.includes('study')) {
      score += 20;
    }
    
    return Math.min(100, score);
  }

  /**
   * RULEBOOK v1.2 Section 9.5: Third-party profile assessment
   * Uses new thirdPartyProfiles evidence from sameAs + footer links
   */
  assessThirdPartyProfiles(profilesOrContent) {
    // Handle both new thirdPartyProfiles format and legacy content format
    if (profilesOrContent?.profiles && Array.isArray(profilesOrContent.profiles)) {
      // New RULEBOOK v1.2 format
      const profiles = profilesOrContent.profiles;
      const count = profiles.length;
      const hasSameAs = profilesOrContent.hasSameAs;
      const hasBusiness = profilesOrContent.businessProfiles?.length > 0;

      // Higher score for schema-based profiles (sameAs)
      let score = 0;
      if (count >= 5) score = 100;
      else if (count >= 3) score = 80;
      else if (count >= 2) score = 60;
      else if (count >= 1) score = 40;

      // Bonus for sameAs in schema (proper implementation)
      if (hasSameAs) score = Math.min(100, score + 15);

      // Bonus for business review profiles
      if (hasBusiness) score = Math.min(100, score + 10);

      return score;
    }

    // Legacy format fallback
    const platforms = ['g2', 'clutch', 'google', 'reviews', 'testimonial', 'rating', 'trustpilot'];
    const text = profilesOrContent?.bodyText?.toLowerCase() || '';
    const mentions = platforms.filter(p => text.includes(p)).length;

    if (mentions >= 3) return 100;
    if (mentions >= 2) return 70;
    if (mentions >= 1) return 40;
    return 20;
  }

  assessLongTailPhrases(content) {
    const fourWordPhrases = content.bodyText.match(/\b\w+\s+\w+\s+\w+\s+\w+\b/g) || [];
    const uniquePhrases = [...new Set(fourWordPhrases)].length;
    
    if (uniquePhrases >= 50) return 100;
    if (uniquePhrases >= 30) return 80;
    if (uniquePhrases >= 15) return 60;
    return 40;
  }

  assessLocalIntent(content, metadata) {
    const localKeywords = ['near me', 'local', 'location', 'address', 'directions', 'nearby'];
    const text = content.bodyText.toLowerCase();
    const mentions = localKeywords.filter(k => text.includes(k)).length;
    
    let score = mentions * 15;
    
    if (metadata.geoRegion || metadata.geoPlacename) score += 30;
    
    return Math.min(100, score);
  }

  assessConversationalTerms(content) {
    const conversationalKeywords = [
      'how to', 'what is', 'why', 'when', 'where', 'best way', 'tips', 'guide',
      'should i', 'can i', 'do i need', 'help me'
    ];
    
    const text = content.bodyText.toLowerCase();
    const mentions = conversationalKeywords.filter(k => text.includes(k)).length;
    
    if (mentions >= 5) return 100;
    if (mentions >= 3) return 75;
    if (mentions >= 1) return 50;
    return 25;
  }

  assessSnippetFormat(content) {
    let score = 0;
    
    // Short, direct answer paragraphs
    const snippetEligible = content.paragraphs.filter(p => {
      const words = p.split(/\s+/).length;
      return words >= 40 && words <= 60;
    }).length;
    
    score += Math.min(40, snippetEligible * 10);
    
    // Lists (great for snippets)
    if (content.lists.length >= 3) score += 30;
    
    // Tables (also snippet-friendly)
    if (content.tables.length >= 1) score += 30;
    
    return Math.min(100, score);
  }

  assessMultiTurnContinuity(content, structure) {
    // Check for follow-up content structure
    const continuityKeywords = [
      'next', 'then', 'after', 'following', 'also', 'additionally',
      'furthermore', 'moreover', 'related', 'see also'
    ];
    
    const text = content.bodyText.toLowerCase();
    const mentions = continuityKeywords.filter(k => text.includes(k)).length;
    
    let score = Math.min(50, mentions * 5);
    
    // Internal linking supports multi-turn
    if (structure.internalLinks >= 5) score += 50;
    
    return Math.min(100, score);
  }
}

module.exports = V5RubricEngine;