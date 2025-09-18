const express = require('express');
const axios = require('axios');
const router = express.Router();

// AI API configurations
const AI_CONFIGS = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
  },
  perplexity: {
    endpoint: 'https://api.perplexity.ai/chat/completions',
    headers: { 'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}` }
  }
};

// Updated scoring parameters with graduated scoring as per specification
const SCORING_PARAMETERS = {
  weights: {
    aiSearchReadiness: 0.25,    // 25%
    contentStructure: 0.20,     // 20% 
    voiceOptimization: 0.15,    // 15%
    technicalSetup: 0.20,       // 20%
    trustAuthority: 0.15,       // 15%
    aiReadability: 0.10,        // 10%
    speedUX: 0.10              // 10%
  },
  
  factors: {
    aiSearchReadiness: {
      // 1.a) Direct Answer Structure - 4 factors × 2.5 points = 10 points
      questionBasedContent: { 
        thresholds: { high: 50, medium: 25 }, 
        points: { high: 2.5, medium: 1.5, low: 0 } 
      },
      scannability: { 
        thresholds: { high: 50, medium: 25 }, 
        points: { high: 2.5, medium: 1.5, low: 0 } 
      },
      readabilityScore: { 
        thresholds: { high: 60, medium: 40 }, 
        points: { high: 2.5, medium: 1.5, low: 0 } 
      },
      icpSpecificFAQs: { 
        thresholds: { high: 1 }, 
        points: { high: 2.5, low: 0 } 
      },
      
      // 1.b) Topical Depth and Clusters - 4 factors × 2.5 points = 10 points
      pillarPages: { 
        thresholds: { high: 1 }, 
        points: { high: 2.5, low: 0 } 
      },
      subtopicCoverage: { 
        thresholds: { high: 5, medium: 1 }, 
        points: { high: 2.5, medium: 1.5, low: 0 } 
      },
      icpSpecificDepth: { 
        thresholds: { high: 3, medium: 1 }, 
        points: { high: 2.5, medium: 1.5, low: 0 } 
      },
      geoSpecificContent: { 
        thresholds: { high: 1 }, 
        points: { high: 2.5, low: 0 } 
      }
    },
    
    contentStructure: {
      // 2.a) Semantic HTML - 5 factors × 2 points = 10 points
      headingStructure: { 
        thresholds: { high: 80, medium: 50 }, 
        points: { high: 2.0, medium: 1.0, low: 0 } 
      },
      semanticTags: { 
        thresholds: { high: 50, medium: 25 }, 
        points: { high: 2.0, medium: 1.0, low: 0 } 
      },
      accessibilityScore: { 
        thresholds: { high: 80, medium: 50 }, 
        points: { high: 2.0, medium: 1.0, low: 0 } 
      },
      icpSpecificSemantics: { 
        thresholds: { high: 50 }, 
        points: { high: 2.0, low: 0 } 
      },
      geoSpecificMetadata: { 
        thresholds: { high: 50 }, 
        points: { high: 2.0, low: 0 } 
      }
    },
    
    voiceOptimization: {
      // 3.a) Conversational Keywords - 4 factors × 2.5 points = 10 points
      longTailKeywords: { 
        thresholds: { high: 50, medium: 25 }, 
        points: { high: 2.5, medium: 1.5, low: 0 } 
      },
      localIntentKeywords: { 
        thresholds: { high: 50 }, 
        points: { high: 2.5, low: 0 } 
      },
      icpSpecificKeywords: { 
        thresholds: { high: 50 }, 
        points: { high: 2.5, low: 0 } 
      },
      featuredSnippetEligibility: { 
        thresholds: { high: 25 }, 
        points: { high: 2.5, low: 0 } 
      }
    },
    
    technicalSetup: {
      // 4.a-e) 5 parameters with varying point structures = 50 points total
      robotsTxtPermissions: { 
        thresholds: { high: 1 }, 
        points: { high: 3.5, low: 0 } 
      },
      noBlanketsDisallow: { 
        thresholds: { high: 1 }, 
        points: { high: 3.5, low: 0 } 
      },
      noIndexTags: { 
        thresholds: { high: 1 }, 
        points: { high: 3.5, low: 0 } 
      },
      noSnippetTags: { 
        thresholds: { high: 1 }, 
        points: { high: 3.5, low: 0 } 
      },
      staticHTMLContent: { 
        thresholds: { high: 80, medium: 50 }, 
        points: { high: 3.5, medium: 2.0, low: 0 } 
      },
      sitemapPresence: { 
        thresholds: { high: 1 }, 
        points: { high: 3.5, low: 0 } 
      },
      schemaImplementation: { 
        thresholds: { high: 50, medium: 25 }, 
        points: { high: 3.5, medium: 2.0, low: 0 } 
      }
    },
    
    trustAuthority: {
      // 5.a-b) 8 factors × 2.5 points = 20 points
      authorBios: { 
        thresholds: { high: 50 }, 
        points: { high: 2.5, low: 0 } 
      },
      clientReviews: { 
        thresholds: { high: 3, medium: 1 }, 
        points: { high: 2.5, medium: 1.5, low: 0 } 
      },
      icpCredentials: { 
        thresholds: { high: 1 }, 
        points: { high: 2.5, low: 0 } 
      },
      localTrustSignals: { 
        thresholds: { high: 1 }, 
        points: { high: 2.5, low: 0 } 
      },
      domainAuthority: { 
        thresholds: { high: 50, medium: 30 }, 
        points: { high: 2.5, medium: 1.5, low: 0 } 
      },
      qualityBacklinks: { 
        thresholds: { high: 5, medium: 1 }, 
        points: { high: 2.5, medium: 1.5, low: 0 } 
      },
      icpBacklinks: { 
        thresholds: { high: 1 }, 
        points: { high: 2.5, low: 0 } 
      },
      localCitations: { 
        thresholds: { high: 1 }, 
        points: { high: 2.5, low: 0 } 
      }
    },
    
    aiReadability: {
      // 6.a) 3 factors = 10 points
      imageAltText: { 
        thresholds: { high: 80, medium: 50 }, 
        points: { high: 3.5, medium: 2.0, low: 0 } 
      },
      videoCaptions: { 
        thresholds: { high: 50 }, 
        points: { high: 3.5, low: 0 } 
      },
      icpSpecificMedia: { 
        thresholds: { high: 1 }, 
        points: { high: 3.0, low: 0 } 
      }
    },
    
    speedUX: {
      // 7.a) 4 factors × 2.5 points = 10 points
      largestContentfulPaint: { 
        thresholds: { high: 2.5, medium: 4.0 }, 
        points: { high: 2.5, medium: 1.5, low: 0 } 
      },
      cumulativeLayoutShift: { 
        thresholds: { high: 0.1, medium: 0.25 }, 
        points: { high: 2.5, medium: 1.5, low: 0 } 
      },
      interactionToNextPaint: { 
        thresholds: { high: 200, medium: 500 }, 
        points: { high: 2.5, medium: 1.5, low: 0 } 
      },
      mobilePerformance: { 
        thresholds: { high: 1 }, 
        points: { high: 2.5, low: 0 } 
      }
    }
  }
};

// Industry detection with ICP focus
function detectIndustry(websiteData) {
  const { html, url } = websiteData;
  const content = html.toLowerCase();
  const domain = new URL(url).hostname.toLowerCase();
  
  const industries = [
    {
      key: 'msp',
      name: 'Managed Service Provider (MSP)',
      keywords: ['managed services', 'it support', 'cybersecurity', 'network management', 'cloud services', 'helpdesk', 'it consulting'],
      domainKeywords: ['msp', 'managed', 'itsupport', 'itservices', 'cyber', 'tech'],
      painPoints: ['security', 'downtime', 'compliance', 'remote work', 'scalability', 'backup']
    },
    {
      key: 'telecom',
      name: 'Telecommunications Provider',
      keywords: ['telecommunications', 'internet service', 'broadband', 'fiber', 'wireless', 'connectivity', 'network infrastructure'],
      domainKeywords: ['telecom', 'fiber', 'broadband', 'wireless', 'network', 'comm'],
      painPoints: ['customer retention', 'network reliability', 'coverage', 'competition', 'bandwidth']
    },
    {
      key: 'startup',
      name: 'AI/Technology Startup',
      keywords: ['artificial intelligence', 'machine learning', 'startup', 'innovation', 'automation', 'saas', 'technology platform'],
      domainKeywords: ['ai', 'startup', 'tech', 'innovation', 'platform', 'solution'],
      painPoints: ['scalability', 'funding', 'market validation', 'user acquisition', 'product-market fit']
    },
    {
      key: 'professional_services',
      name: 'Professional Services',
      keywords: ['consulting', 'advisory', 'professional services', 'expertise', 'solutions', 'strategy'],
      domainKeywords: ['consult', 'advisory', 'services', 'expert', 'strategy'],
      painPoints: ['client acquisition', 'expertise demonstration', 'competition', 'pricing', 'differentiation']
    }
  ];
  
  let bestMatch = industries[3]; // Default to professional services
  let highestScore = 0;
  
  for (const industry of industries) {
    let score = 0;
    
    // Check content keywords
    for (const keyword of industry.keywords) {
      if (content.includes(keyword)) score += 1;
    }
    
    // Check domain keywords (weighted higher)
    for (const keyword of industry.domainKeywords) {
      if (domain.includes(keyword)) score += 3;
    }
    
    // Check pain points
    for (const painPoint of industry.painPoints) {
      if (content.includes(painPoint)) score += 0.5;
    }
    
    if (score > highestScore) {
      highestScore = score;
      bestMatch = industry;
    }
  }
  
  return bestMatch;
}

// Enhanced website analysis with graduated scoring
function performDetailedAnalysis(websiteData) {
  const { html, url } = websiteData;
  const content = extractTextContent(html);
  const doc = parseHTML(html);
  const industry = detectIndustry(websiteData);
  
  // Get raw metrics for all pages (simulated as single page for now)
  const pageMetrics = analyzePageMetrics(html, content, doc, industry, url);
  
  const analysis = {
    aiSearchReadiness: analyzeAISearchReadiness(pageMetrics, industry),
    contentStructure: analyzeContentStructure(pageMetrics, industry),
    voiceOptimization: analyzeVoiceOptimization(pageMetrics, industry),
    technicalSetup: analyzeTechnicalSetup(pageMetrics, url),
    trustAuthority: analyzeTrustAuthority(pageMetrics, url),
    aiReadability: analyzeAIReadability(pageMetrics),
    speedUX: analyzeSpeedUX(pageMetrics, url)
  };
  
  const scores = calculateGraduatedScores(analysis);
  const recommendations = generateDetailedRecommendations(analysis, industry);
  
  return {
    industry,
    analysis,
    scores,
    recommendations,
    url,
    analyzedAt: new Date().toISOString()
  };
}

// Extract page metrics for graduated scoring
function analyzePageMetrics(html, content, doc, industry, url) {
  const metrics = {};
  
  // Content analysis
  const words = content.split(/\s+/).length;
  const sentences = content.split(/[.!?]+/).length;
  const totalImages = (html.match(/<img[^>]*>/gi) || []).length;
  const imagesWithAlt = (html.match(/<img[^>]+alt=[^>]*>/gi) || []).length;
  const totalVideos = (html.match(/<video[^>]*>/gi) || []).length;
  
  // Heading structure
  const h1Count = (html.match(/<h1[^>]*>/gi) || []).length;
  const headingMatches = html.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi) || [];
  const questionHeadings = headingMatches.filter(h => h.includes('?')).length;
  const totalHeadings = headingMatches.length;
  
  // List and table elements for scannability
  const listElements = (html.match(/<(ul|ol|li|table|tr|td)[^>]*>/gi) || []).length;
  
  // FAQ detection
  const hasFAQ = /faq|frequently.asked|questions/i.test(html);
  const hasICPTerms = industry.painPoints.some(term => content.toLowerCase().includes(term));
  
  // Pillar page indicators
  const pillarIndicators = ['guide', 'complete', 'ultimate', 'comprehensive', 'everything about'];
  const hasPillarContent = pillarIndicators.some(indicator => content.toLowerCase().includes(indicator));
  
  // Internal links
  const internalLinks = (html.match(/<a[^>]+href=['"](\/[^'"]*|[^'"]*\.[^'"]*)['"]/gi) || []).length;
  
  // Industry term coverage
  const industryTermCount = industry.keywords.filter(keyword => 
    content.toLowerCase().includes(keyword.toLowerCase())
  ).length;
  
  // Geo-specific content
  const geoTerms = ['ontario', 'toronto', 'vancouver', 'canada', 'local', 'region', 'area', 'near me'];
  const hasGeoContent = geoTerms.some(term => content.toLowerCase().includes(term));
  
  // Semantic tags
  const semanticTags = (html.match(/<(article|section|aside|nav|main|header|footer)[^>]*>/gi) || []).length;
  
  // Long-tail keyword detection
  const longTailMatches = content.match(/\b(\w+\s+){3,}\w+/g) || [];
  const questionPhrases = content.match(/(how to|what is|why|when|where|best way to)\s+[\w\s]{10,}/gi) || [];
  
  // Local intent keywords
  const localTerms = ['near me', 'in toronto', 'ontario', 'local', 'nearby', 'area', 'region', 'around me'];
  const hasLocalKeywords = localTerms.some(term => content.toLowerCase().includes(term));
  
  // Featured snippet eligibility (concise answers)
  const shortAnswers = content.match(/[.!?]\s*[A-Z][^.!?]{50,200}[.!?]/g) || [];
  
  // Technical elements
  const robotsMeta = html.match(/<meta[^>]+name=['"]*robots['"]*[^>]+content=['"]*([^'"]*)['"]/i);
  const hasNoIndex = robotsMeta && robotsMeta[1].includes('noindex');
  const hasNoSnippet = robotsMeta && robotsMeta[1].includes('nosnippet');
  const scriptTags = (html.match(/<script[^>]*>/gi) || []).length;
  const jsonLD = html.includes('application/ld+json');
  const microdata = html.includes('itemscope') || html.includes('itemtype');
  
  // Trust signals
  const authorTerms = ['author', 'bio', 'about', 'team', 'expert', 'founder', 'ceo', 'director'];
  const hasAuthorInfo = authorTerms.some(term => content.toLowerCase().includes(term));
  const testimonialTerms = ['testimonial', 'review', 'customer', 'client says', 'feedback', 'rating'];
  const testimonialCount = testimonialTerms.filter(term => content.toLowerCase().includes(term)).length;
  const credentialTerms = ['certified', 'certification', 'qualified', 'expert', 'professional', 'licensed', 'accredited'];
  const hasCredentials = credentialTerms.some(term => content.toLowerCase().includes(term));
  
  // Media optimization
  const mediaTerms = ['diagram', 'chart', 'infographic', 'screenshot', 'demo', 'example'];
  const hasICPMedia = mediaTerms.some(term => content.toLowerCase().includes(term));
  const captionIndicators = html.includes('captions') || html.includes('transcript') || html.includes('subtitles');
  
  // Performance indicators (simplified)
  const hasViewport = html.includes('name="viewport"');
  const hasResponsive = html.includes('responsive') || html.includes('mobile') || html.includes('@media');
  
  return {
    // AI Search Readiness metrics
    questionBasedContentPercentage: totalHeadings > 0 ? (questionHeadings / totalHeadings) * 100 : 0,
    scannabilityScore: listElements >= 10 ? 100 : (listElements / 10) * 100,
    readabilityScore: sentences > 0 ? Math.min(100, Math.max(0, 100 - Math.abs((words / sentences) - 14) * 5)) : 0,
    icpSpecificFAQs: hasFAQ && hasICPTerms ? 1 : 0,
    pillarPages: hasPillarContent ? 1 : 0,
    subtopicCoverage: Math.min(internalLinks, 10),
    icpSpecificDepth: industryTermCount,
    geoSpecificContent: hasGeoContent ? 1 : 0,
    
    // Content Structure metrics
    headingStructurePercentage: (h1Count === 1 && totalHeadings >= 3) ? 100 : 0,
    semanticTagsPercentage: semanticTags >= 3 ? 100 : (semanticTags / 3) * 100,
    accessibilityPercentage: totalImages === 0 ? 100 : (imagesWithAlt / totalImages) * 100,
    icpSpecificSemanticsPercentage: industry.keywords.some(keyword => 
      headingMatches.join(' ').toLowerCase().includes(keyword.toLowerCase())) ? 100 : 0,
    geoSpecificMetadataPercentage: hasGeoContent ? 100 : 0,
    
    // Voice Optimization metrics
    longTailKeywordsPercentage: (longTailMatches.length + questionPhrases.length) >= 20 ? 100 : 
      ((longTailMatches.length + questionPhrases.length) / 20) * 100,
    localIntentKeywordsPercentage: hasLocalKeywords ? 100 : 0,
    icpSpecificKeywordsPercentage: industryTermCount >= 3 ? 100 : (industryTermCount / 3) * 100,
    featuredSnippetEligibilityPercentage: shortAnswers.length >= 5 ? 100 : (shortAnswers.length / 5) * 100,
    
    // Technical Setup metrics
    robotsTxtPermissions: 1, // Assume allowed
    noBlanketsDisallow: 1,   // Assume no blanket disallow
    noIndexTags: hasNoIndex ? 0 : 1,
    noSnippetTags: hasNoSnippet ? 0 : 1,
    staticHTMLContentPercentage: content.length > 1000 && scriptTags < 15 ? 100 : 50,
    sitemapPresence: html.includes('sitemap') || url.includes('sitemap') ? 1 : 0,
    schemaImplementationPercentage: (jsonLD || microdata) ? 100 : 0,
    
    // Trust & Authority metrics
    authorBiosPercentage: hasAuthorInfo ? 100 : 0,
    clientReviewsCount: testimonialCount,
    icpCredentials: hasCredentials ? 1 : 0,
    localTrustSignals: geoTerms.some(term => content.toLowerCase().includes(term)) ? 1 : 0,
    domainAuthorityScore: 45, // Simulated - would need real API
    qualityBacklinksCount: 2, // Simulated - would need real API
    icpBacklinks: 1, // Simulated
    localCitations: 1, // Simulated
    
    // AI Readability metrics
    imageAltTextPercentage: totalImages === 0 ? 100 : (imagesWithAlt / totalImages) * 100,
    videoCaptionsPercentage: totalVideos === 0 ? 100 : (captionIndicators ? 100 : 0),
    icpSpecificMedia: hasICPMedia ? 1 : 0,
    
    // Speed & UX metrics (simplified)
    lcpScore: 2.3, // Simulated
    clsScore: 0.08, // Simulated
    inpScore: 150, // Simulated
    mobilePerformance: hasViewport && hasResponsive ? 1 : 0
  };
}

// Calculate graduated scores based on thresholds
function calculateFactorScore(value, factor) {
  const { thresholds, points } = factor;
  
  if (thresholds.high !== undefined) {
    if (points.medium !== undefined) {
      // Three-tier scoring
      if (value >= thresholds.high) return points.high;
      if (value >= thresholds.medium) return points.medium;
      return points.low;
    } else {
      // Two-tier scoring
      return value >= thresholds.high ? points.high : points.low;
    }
  }
  
  return points.low;
}

// AI Search Readiness Analysis with graduated scoring
function analyzeAISearchReadiness(metrics, industry) {
  const factors = SCORING_PARAMETERS.factors.aiSearchReadiness;
  
  return {
    questionBasedContent: calculateFactorScore(metrics.questionBasedContentPercentage, factors.questionBasedContent),
    scannability: calculateFactorScore(metrics.scannabilityScore, factors.scannability),
    readabilityScore: calculateFactorScore(metrics.readabilityScore, factors.readabilityScore),
    icpSpecificFAQs: calculateFactorScore(metrics.icpSpecificFAQs, factors.icpSpecificFAQs),
    pillarPages: calculateFactorScore(metrics.pillarPages, factors.pillarPages),
    subtopicCoverage: calculateFactorScore(metrics.subtopicCoverage, factors.subtopicCoverage),
    icpSpecificDepth: calculateFactorScore(metrics.icpSpecificDepth, factors.icpSpecificDepth),
    geoSpecificContent: calculateFactorScore(metrics.geoSpecificContent, factors.geoSpecificContent)
  };
}

// Content Structure Analysis with graduated scoring
function analyzeContentStructure(metrics, industry) {
  const factors = SCORING_PARAMETERS.factors.contentStructure;
  
  return {
    headingStructure: calculateFactorScore(metrics.headingStructurePercentage, factors.headingStructure),
    semanticTags: calculateFactorScore(metrics.semanticTagsPercentage, factors.semanticTags),
    accessibilityScore: calculateFactorScore(metrics.accessibilityPercentage, factors.accessibilityScore),
    icpSpecificSemantics: calculateFactorScore(metrics.icpSpecificSemanticsPercentage, factors.icpSpecificSemantics),
    geoSpecificMetadata: calculateFactorScore(metrics.geoSpecificMetadataPercentage, factors.geoSpecificMetadata)
  };
}

// Voice Optimization Analysis with graduated scoring
function analyzeVoiceOptimization(metrics, industry) {
  const factors = SCORING_PARAMETERS.factors.voiceOptimization;
  
  return {
    longTailKeywords: calculateFactorScore(metrics.longTailKeywordsPercentage, factors.longTailKeywords),
    localIntentKeywords: calculateFactorScore(metrics.localIntentKeywordsPercentage, factors.localIntentKeywords),
    icpSpecificKeywords: calculateFactorScore(metrics.icpSpecificKeywordsPercentage, factors.icpSpecificKeywords),
    featuredSnippetEligibility: calculateFactorScore(metrics.featuredSnippetEligibilityPercentage, factors.featuredSnippetEligibility)
  };
}

// Technical Setup Analysis with graduated scoring
function analyzeTechnicalSetup(metrics, url) {
  const factors = SCORING_PARAMETERS.factors.technicalSetup;
  
  return {
    robotsTxtPermissions: calculateFactorScore(metrics.robotsTxtPermissions, factors.robotsTxtPermissions),
    noBlanketsDisallow: calculateFactorScore(metrics.noBlanketsDisallow, factors.noBlanketsDisallow),
    noIndexTags: calculateFactorScore(metrics.noIndexTags, factors.noIndexTags),
    noSnippetTags: calculateFactorScore(metrics.noSnippetTags, factors.noSnippetTags),
    staticHTMLContent: calculateFactorScore(metrics.staticHTMLContentPercentage, factors.staticHTMLContent),
    sitemapPresence: calculateFactorScore(metrics.sitemapPresence, factors.sitemapPresence),
    schemaImplementation: calculateFactorScore(metrics.schemaImplementationPercentage, factors.schemaImplementation)
  };
}

// Trust & Authority Analysis with graduated scoring
function analyzeTrustAuthority(metrics, url) {
  const factors = SCORING_PARAMETERS.factors.trustAuthority;
  
  return {
    authorBios: calculateFactorScore(metrics.authorBiosPercentage, factors.authorBios),
    clientReviews: calculateFactorScore(metrics.clientReviewsCount, factors.clientReviews),
    icpCredentials: calculateFactorScore(metrics.icpCredentials, factors.icpCredentials),
    localTrustSignals: calculateFactorScore(metrics.localTrustSignals, factors.localTrustSignals),
    domainAuthority: calculateFactorScore(metrics.domainAuthorityScore, factors.domainAuthority),
    qualityBacklinks: calculateFactorScore(metrics.qualityBacklinksCount, factors.qualityBacklinks),
    icpBacklinks: calculateFactorScore(metrics.icpBacklinks, factors.icpBacklinks),
    localCitations: calculateFactorScore(metrics.localCitations, factors.localCitations)
  };
}

// AI Readability Analysis with graduated scoring
function analyzeAIReadability(metrics) {
  const factors = SCORING_PARAMETERS.factors.aiReadability;
  
  return {
    imageAltText: calculateFactorScore(metrics.imageAltTextPercentage, factors.imageAltText),
    videoCaptions: calculateFactorScore(metrics.videoCaptionsPercentage, factors.videoCaptions),
    icpSpecificMedia: calculateFactorScore(metrics.icpSpecificMedia, factors.icpSpecificMedia)
  };
}

// Speed & UX Analysis with graduated scoring
function analyzeSpeedUX(metrics, url) {
  const factors = SCORING_PARAMETERS.factors.speedUX;
  
  return {
    largestContentfulPaint: calculateFactorScore(metrics.lcpScore <= 2.5 ? 100 : (metrics.lcpScore <= 4.0 ? 50 : 0), 
      { thresholds: { high: 100, medium: 50 }, points: { high: 2.5, medium: 1.5, low: 0 } }),
    cumulativeLayoutShift: calculateFactorScore(metrics.clsScore <= 0.1 ? 100 : (metrics.clsScore <= 0.25 ? 50 : 0), 
      { thresholds: { high: 100, medium: 50 }, points: { high: 2.5, medium: 1.5, low: 0 } }),
    interactionToNextPaint: calculateFactorScore(metrics.inpScore <= 200 ? 100 : (metrics.inpScore <= 500 ? 50 : 0), 
      { thresholds: { high: 100, medium: 50 }, points: { high: 2.5, medium: 1.5, low: 0 } }),
    mobilePerformance: calculateFactorScore(metrics.mobilePerformance, factors.mobilePerformance)
  };
}

// Calculate graduated scores
function calculateGraduatedScores(analysis) {
  const scores = {};
  let totalWeightedScore = 0;
  
  for (const [category, categoryAnalysis] of Object.entries(analysis)) {
    let categoryScore = 0;
    
    // Sum all factor scores for this category
    for (const score of Object.values(categoryAnalysis)) {
      categoryScore += score;
    }
    
    scores[category] = Math.round(categoryScore);
    const categoryWeight = SCORING_PARAMETERS.weights[category];
    totalWeightedScore += categoryScore * categoryWeight;
  }
  
  scores.total = Math.round(totalWeightedScore);
  return scores;
}

// Generate detailed recommendations based on graduated analysis
function generateDetailedRecommendations(analysis, industry) {
  const recommendations = [];
  
  // AI Search Readiness recommendations
  if (analysis.aiSearchReadiness.questionBasedContent < 2.5) {
    recommendations.push({
      title: 'Add Question-Based Content Structure',
      description: `Create FAQ-style content with question headings like "What is ${industry.name} best practice?" to improve AI citation rates.`,
      impact: 'High',
      category: 'AI Search Readiness',
      quickWin: `Add 5+ FAQ questions addressing ${industry.painPoints.slice(0,2).join(' and ')} concerns.`,
      currentScore: analysis.aiSearchReadiness.questionBasedContent,
      maxScore: 2.5
    });
  }
  
  if (analysis.aiSearchReadiness.icpSpecificFAQs < 2.5) {
    recommendations.push({
      title: 'Create ICP-Specific FAQ Content',
      description: `Build FAQs targeting ${industry.name} pain points like ${industry.painPoints.slice(0,3).join(', ')}.`,
      impact: 'High',
      category: 'AI Search Readiness',
      quickWin: 'Include questions customers actually ask AI assistants about your industry.',
      currentScore: analysis.aiSearchReadiness.icpSpecificFAQs,
      maxScore: 2.5
    });
  }
  
  // Content Structure recommendations
  if (analysis.contentStructure.headingStructure < 2.0) {
    recommendations.push({
      title: 'Implement Proper Heading Hierarchy',
      description: 'Use single H1 per page with logical H2-H6 structure for better AI content understanding.',
      impact: 'Medium',
      category: 'Content Structure',
      quickWin: 'Audit headings to ensure one H1 and nested H2/H3 structure.',
      currentScore: analysis.contentStructure.headingStructure,
      maxScore: 2.0
    });
  }
  
  if (analysis.contentStructure.semanticTags < 2.0) {
    recommendations.push({
      title: 'Add Semantic HTML Elements',
      description: 'Use article, section, aside tags to help AI systems understand content relationships.',
      impact: 'Medium',
      category: 'Content Structure',
      quickWin: 'Wrap main content in <article> and use <section> for content blocks.',
      currentScore: analysis.contentStructure.semanticTags,
      maxScore: 2.0
    });
  }
  
  // Voice Optimization recommendations
  if (analysis.voiceOptimization.longTailKeywords < 2.5) {
    recommendations.push({
      title: 'Optimize for Conversational Queries',
      description: 'Include natural language phrases and questions that people ask voice assistants.',
      impact: 'High',
      category: 'Voice Optimization',
      quickWin: `Add phrases like "best ${industry.name} for..." and "how to choose ${industry.name}"`,
      currentScore: analysis.voiceOptimization.longTailKeywords,
      maxScore: 2.5
    });
  }
  
  // Technical Setup recommendations
  if (analysis.technicalSetup.schemaImplementation < 3.5) {
    recommendations.push({
      title: 'Implement Schema Markup',
      description: 'Add structured data to help AI systems extract and understand your business information.',
      impact: 'Critical',
      category: 'Technical Setup',
      quickWin: 'Add Organization schema with business details and FAQPage schema for FAQ content.',
      currentScore: analysis.technicalSetup.schemaImplementation,
      maxScore: 3.5
    });
  }
  
  // Trust & Authority recommendations
  if (analysis.trustAuthority.authorBios < 2.5) {
    recommendations.push({
      title: 'Add Expert Author Information',
      description: 'Include team bios with credentials to establish expertise and trustworthiness.',
      impact: 'Medium',
      category: 'Trust & Authority',
      quickWin: 'Create "About" or "Team" section highlighting relevant experience and qualifications.',
      currentScore: analysis.trustAuthority.authorBios,
      maxScore: 2.5
    });
  }
  
  // AI Readability recommendations
  if (analysis.aiReadability.imageAltText < 3.5) {
    recommendations.push({
      title: 'Add Descriptive Image Alt Text',
      description: 'Provide alt text for all images so AI vision models can understand visual content.',
      impact: 'Medium',
      category: 'AI Readability',
      quickWin: 'Add alt text describing images in context of your industry and services.',
      currentScore: analysis.aiReadability.imageAltText,
      maxScore: 3.5
    });
  }
  
  return recommendations.slice(0, 8); // Return top 8 recommendations
}

// Helper functions
function extractTextContent(html) {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
}

function parseHTML(html) {
  // Simplified HTML parsing for server environment
  return {
    querySelector: (selector) => {
      const match = html.match(new RegExp(`<${selector}[^>]*>`, 'i'));
      return match ? { textContent: '' } : null;
    },
    querySelectorAll: (selector) => {
      const matches = html.match(new RegExp(`<${selector}[^>]*>`, 'gi')) || [];
      return matches.map(() => ({ textContent: '' }));
    }
  };
}

// API Routes
router.post('/analyze-website', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const websiteData = await fetchWebsiteContent(url);
    const analysis = performDetailedAnalysis(websiteData);
    
    res.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('Website analysis failed:', error);
    res.status(500).json({
      error: 'Website analysis failed',
      message: error.message
    });
  }
});

// AI visibility testing endpoint
router.post('/test-ai-visibility', async (req, res) => {
  try {
    const { url, industry, queries } = req.body;
    
    if (!url || !queries || !Array.isArray(queries)) {
      return res.status(400).json({ error: 'URL and queries array are required' });
    }

    const results = await testAIVisibility(url, industry, queries);
    
    res.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error('AI visibility testing failed:', error);
    res.status(500).json({
      error: 'AI visibility testing failed',
      message: error.message
    });
  }
});

// Helper functions for fetching and AI testing
async function fetchWebsiteContent(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AI-Visibility-Tool/1.0)'
      }
    });
    
    return {
      html: response.data,
      url: url,
      status: response.status,
      headers: response.headers
    };
  } catch (error) {
    throw new Error(`Failed to fetch website: ${error.message}`);
  }
}

// Keep existing AI testing functions
async function testAIVisibility(url, industry, queries) {
  const domain = new URL(url).hostname;
  const companyName = extractCompanyName(domain);
  
  const results = {
    overall: { mentionRate: 0, recommendationRate: 0, citationRate: 0 },
    assistants: {},
    testedQueries: queries.length
  };

  for (const [assistantKey, config] of Object.entries(AI_CONFIGS)) {
    if (!process.env[assistantKey.toUpperCase() + '_API_KEY']) {
      results.assistants[assistantKey] = {
        name: assistantKey,
        tested: false,
        reason: 'API key not configured'
      };
      continue;
    }

    try {
      const assistantResults = await testSingleAssistant(assistantKey, queries, companyName, domain);
      results.assistants[assistantKey] = assistantResults;
    } catch (error) {
      results.assistants[assistantKey] = {
        name: assistantKey,
        tested: false,
        error: error.message
      };
    }
  }

  calculateOverallMetrics(results);
  return results;
}

async function testSingleAssistant(assistantKey, queries, companyName, domain) {
  const results = {
    name: assistantKey,
    tested: true,
    queries: [],
    metrics: { mentionRate: 0, recommendationRate: 0, citationRate: 0 }
  };

  let mentions = 0, recommendations = 0, citations = 0;

  for (const query of queries) {
    try {
      const response = await queryAIAssistant(assistantKey, query);
      const analysis = analyzeResponse(response, companyName, domain);
      
      results.queries.push({
        query,
        mentioned: analysis.mentioned,
        recommended: analysis.recommended,
        cited: analysis.cited
      });

      if (analysis.mentioned) mentions++;
      if (analysis.recommended) recommendations++;
      if (analysis.cited) citations++;

      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      results.queries.push({
        query,
        error: error.message,
        mentioned: false,
        recommended: false,
        cited: false
      });
    }
  }

  results.metrics.mentionRate = (mentions / queries.length) * 100;
  results.metrics.recommendationRate = (recommendations / queries.length) * 100;
  results.metrics.citationRate = (citations / queries.length) * 100;

  return results;
}

async function queryAIAssistant(assistant, query) {
  const config = AI_CONFIGS[assistant];
  let requestBody;

  switch (assistant) {
    case 'openai':
      requestBody = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: query }],
        max_tokens: 500,
        temperature: 0.7
      };
      break;
      
    case 'anthropic':
      requestBody = {
        model: 'claude-3-sonnet-20240229',
        max_tokens: 500,
        messages: [{ role: 'user', content: query }]
      };
      break;
      
    case 'perplexity':
      requestBody = {
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [{ role: 'user', content: query }]
      };
      break;
      
    default:
      throw new Error(`Unsupported assistant: ${assistant}`);
  }

  const response = await axios.post(config.endpoint, requestBody, {
    headers: {
      ...config.headers,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  switch (assistant) {
    case 'openai':
    case 'perplexity':
      return response.data.choices[0].message.content;
    case 'anthropic':
      return response.data.content[0].text;
    default:
      throw new Error(`Unknown response format for ${assistant}`);
  }
}

function analyzeResponse(response, companyName, domain) {
  const lowerResponse = response.toLowerCase();
  const lowerCompanyName = companyName.toLowerCase();
  const lowerDomain = domain.toLowerCase();

  return {
    mentioned: lowerResponse.includes(lowerCompanyName) || lowerResponse.includes(lowerDomain),
    recommended: /recommend|suggest|top|best|excellent/.test(lowerResponse) && 
                (lowerResponse.includes(lowerCompanyName) || lowerResponse.includes(lowerDomain)),
    cited: lowerResponse.includes(lowerDomain) || lowerResponse.includes('http')
  };
}

function calculateOverallMetrics(results) {
  const testedAssistants = Object.values(results.assistants).filter(a => a.tested);
  
  if (testedAssistants.length === 0) return;

  results.overall.mentionRate = testedAssistants.reduce((sum, a) => sum + a.metrics.mentionRate, 0) / testedAssistants.length;
  results.overall.recommendationRate = testedAssistants.reduce((sum, a) => sum + a.metrics.recommendationRate, 0) / testedAssistants.length;
  results.overall.citationRate = testedAssistants.reduce((sum, a) => sum + a.metrics.citationRate, 0) / testedAssistants.length;
}

function extractCompanyName(domain) {
  return domain.replace(/^www\./, '').split('.')[0]
    .replace(/[-_]/g, ' ')
    .replace(/\b(inc|llc|corp|ltd)\b/gi, '')
    .trim();
}

module.exports = router;
