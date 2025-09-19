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

// Weights for final calculation
const CATEGORY_WEIGHTS = {
  aiSearchReadiness: 0.25,
  contentStructure: 0.20,
  voiceOptimization: 0.15,
  technicalSetup: 0.20,
  trustAuthority: 0.15,
  aiReadability: 0.10,
  speedUX: 0.10
};

// Industry detection with error handling
function detectIndustry(websiteData) {
  try {
    const { html = '', url = '' } = websiteData || {};
    
    if (!html || !url) {
      console.warn('Missing html or url in websiteData, using default industry');
      return getDefaultIndustry();
    }

    const content = html.toLowerCase();
    let domain = '';
    
    try {
      domain = new URL(url).hostname.toLowerCase();
    } catch (error) {
      console.warn('Invalid URL provided:', url, 'Error:', error.message);
      domain = '';
    }
    
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
      
      try {
        // Safe keyword checking
        for (const keyword of industry.keywords || []) {
          if (content.includes(keyword)) score += 1;
        }
        
        for (const keyword of industry.domainKeywords || []) {
          if (domain.includes(keyword)) score += 3;
        }
        
        for (const painPoint of industry.painPoints || []) {
          if (content.includes(painPoint)) score += 0.5;
        }
        
        if (score > highestScore) {
          highestScore = score;
          bestMatch = industry;
        }
      } catch (error) {
        console.warn('Error scoring industry:', industry.key, error.message);
        continue;
      }
    }
    
    return bestMatch;
  } catch (error) {
    console.error('Error in detectIndustry:', error);
    return getDefaultIndustry();
  }
}

function getDefaultIndustry() {
  return {
    key: 'professional_services',
    name: 'Professional Services',
    keywords: ['consulting', 'advisory', 'professional services'],
    domainKeywords: ['consult', 'services'],
    painPoints: ['client acquisition', 'competition']
  };
}

// Safe calculation function with validation
function calculateFactorScore(value, thresholds, points, factorName) {
  try {
    console.log(`Scoring ${factorName}: value=${value}`);
    
    // Validate inputs
    if (!thresholds || !points || typeof factorName !== 'string') {
      console.warn(`Invalid inputs for ${factorName}, returning 0`);
      return 0;
    }
    
    // Ensure value is a valid number
    const numValue = Number(value);
    if (isNaN(numValue) || !isFinite(numValue)) {
      console.log(`Invalid value ${value} for ${factorName}, returning 0`);
      return 0;
    }
    
    // Handle different threshold structures safely
    if (thresholds.high !== undefined && points.high !== undefined) {
      if (points.medium !== undefined && thresholds.medium !== undefined) {
        // Three-tier scoring
        if (numValue >= thresholds.high) {
          return points.high;
        }
        if (numValue >= thresholds.medium) {
          return points.medium;
        }
        return points.low || 0;
      } else {
        // Two-tier scoring
        if (numValue >= thresholds.high) {
          return points.high;
        }
        return points.low || 0;
      }
    }
    
    console.log(`No valid thresholds for ${factorName}, returning 0`);
    return 0;
  } catch (error) {
    console.error(`Error calculating factor score for ${factorName}:`, error);
    return 0;
  }
}

// Safe content extraction
function extractTextContent(html) {
  try {
    if (!html || typeof html !== 'string') {
      console.log('Invalid HTML provided to extractTextContent');
      return '';
    }
    
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
      
    console.log('Extracted text content length:', textContent.length);
    return textContent;
  } catch (error) {
    console.error('Error extracting text content:', error);
    return '';
  }
}

// Safe metrics analysis
function analyzePageMetrics(html, content, industry, url) {
  try {
    console.log('Analyzing page metrics...');
    
    // Validate inputs
    const safeHtml = html || '';
    const safeContent = content || '';
    const safeIndustry = industry || getDefaultIndustry();
    
    // Safe content analysis
    const words = safeContent.split(/\s+/).filter(word => word && word.length > 0);
    const sentences = safeContent.split(/[.!?]+/).filter(s => s && s.trim().length > 0);
    
    // Safe heading analysis
    const h1Matches = (safeHtml.match(/<h1[^>]*>/gi) || []);
    const allHeadingMatches = (safeHtml.match(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi) || []);
    const questionHeadingMatches = allHeadingMatches.filter(h => h.includes('?'));
    const hasSubheadings = (safeHtml.match(/<h[2-6][^>]*>/gi) || []).length >= 2;
    
    // Safe structure analysis
    const hasLists = (safeHtml.match(/<(ul|ol)[^>]*>/gi) || []).length >= 1;
    const hasTables = (safeHtml.match(/<table[^>]*>/gi) || []).length >= 1;
    const listElements = (safeHtml.match(/<(ul|ol|li|table|tr|td)[^>]*>/gi) || []).length;
    
    // Safe image analysis
    const imageMatches = (safeHtml.match(/<img[^>]*>/gi) || []);
    const altMatches = (safeHtml.match(/<img[^>]+alt\s*=\s*["'][^"']*["'][^>]*>/gi) || []);
    
    // Safe content quality indicators
    const hasAboutSection = /about|team|company|who we are|our story/i.test(safeContent);
    const hasContactInfo = /contact|phone|email|address/i.test(safeContent);
    const hasServices = /services|solutions|products|what we do/i.test(safeContent);
    const hasTestimonials = /testimonial|review|feedback|client|customer/i.test(safeContent);
    
    // Safe industry-specific content analysis
    let industryTermCount = 0;
    let painPointsCount = 0;
    
    try {
      industryTermCount = (safeIndustry.keywords || []).filter(keyword => 
        safeContent.toLowerCase().includes(keyword.toLowerCase())
      ).length;
      
      painPointsCount = (safeIndustry.painPoints || []).filter(pain => 
        safeContent.toLowerCase().includes(pain.toLowerCase())
      ).length;
    } catch (error) {
      console.warn('Error analyzing industry content:', error);
    }
    
    // Safe FAQ and Q&A detection
    const hasFAQSection = /faq|frequently.asked|questions.and.answers|q&a/i.test(safeHtml);
    const hasQuestionWords = /what|how|why|when|where|which/i.test(safeContent);
    
    // Safe geo content analysis
    const geoTerms = ['ontario', 'toronto', 'vancouver', 'canada', 'local', 'region', 'area', 'near me', 'city', 'province'];
    const geoMatches = geoTerms.filter(term => safeContent.toLowerCase().includes(term)).length;
    
    // Safe technical indicators
    const hasMetaDescription = safeHtml.includes('name="description"');
    const hasViewport = safeHtml.includes('name="viewport"');
    const hasStructuredData = safeHtml.includes('application/ld+json') || safeHtml.includes('itemscope');
    
    // Safe trust indicators
    const trustTerms = ['certified', 'licensed', 'accredited', 'professional', 'expert', 'award', 'years of experience'];
    const trustMatches = trustTerms.filter(term => safeContent.toLowerCase().includes(term)).length;
    
    // Safe calculations with fallbacks
    const questionBasedPercentage = allHeadingMatches.length > 0 ? 
      Math.min(100, (questionHeadingMatches.length / allHeadingMatches.length) * 100) : 0;
    
    // Safe scannability score
    let scannabilityScore = 0;
    if (hasLists) scannabilityScore += 30;
    if (hasTables) scannabilityScore += 20;
    if (hasSubheadings) scannabilityScore += 25;
    if (listElements >= 5) scannabilityScore += 25;
    scannabilityScore = Math.min(100, Math.max(0, scannabilityScore));
    
    // Safe image alt percentage
    const imageAltPercentage = imageMatches.length > 0 ? 
      Math.min(100, (altMatches.length / imageMatches.length) * 100) : 100;
    
    // Safe readability calculation
    const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : 15;
    const readabilityPercentage = Math.max(20, Math.min(100, 120 - Math.abs(avgWordsPerSentence - 15) * 3));
    
    return {
      questionBasedPercentage: Math.max(0, questionBasedPercentage) || 0,
      scannabilityScore: Math.max(0, scannabilityScore) || 0,
      readabilityPercentage: Math.max(0, readabilityPercentage) || 50,
      hasFAQsScore: hasFAQSection ? 100 : (hasQuestionWords ? 50 : 0),
      industryContentScore: Math.min(100, Math.max(0, (industryTermCount * 25) + (painPointsCount * 15))),
      geoContentScore: Math.min(100, Math.max(0, geoMatches * 20)),
      structureScore: (h1Matches.length === 1 ? 40 : 0) + (hasSubheadings ? 30 : 0) + (allHeadingMatches.length >= 3 ? 30 : 0),
      imageAltPercentage: Math.max(0, Math.min(100, imageAltPercentage)),
      semanticScore: hasAboutSection && hasServices ? 100 : 50,
      voiceScore: (hasQuestionWords ? 25 : 0) + (hasFAQSection ? 35 : 0) + (questionHeadingMatches.length > 0 ? 40 : 0),
      localKeywordScore: geoMatches > 0 ? 100 : 0,
      technicalScore: (hasMetaDescription ? 25 : 0) + (hasViewport ? 25 : 0) + (hasStructuredData ? 30 : 0) + 20,
      trustScore: (hasAboutSection ? 25 : 0) + (hasContactInfo ? 20 : 0) + (hasTestimonials ? 25 : 0) + (trustMatches > 0 ? 30 : 0),
      mediaScore: Math.max(0, Math.min(100, imageAltPercentage)),
      speedScore: (safeHtml.length < 100000 ? 25 : 0) + (hasViewport ? 25 : 0) + 50
    };
  } catch (error) {
    console.error('Error analyzing page metrics:', error);
    // Return safe default metrics
    return {
      questionBasedPercentage: 0,
      scannabilityScore: 0,
      readabilityPercentage: 50,
      hasFAQsScore: 0,
      industryContentScore: 0,
      geoContentScore: 0,
      structureScore: 0,
      imageAltPercentage: 100,
      semanticScore: 50,
      voiceScore: 0,
      localKeywordScore: 0,
      technicalScore: 20,
      trustScore: 0,
      mediaScore: 100,
      speedScore: 50
    };
  }
}

// Safe analysis functions
function analyzeAISearchReadiness(metrics) {
  try {
    console.log('Analyzing AI Search Readiness...');
    const safeMetrics = metrics || {};
    const factorScores = {};
    
    factorScores.questionBasedContent = calculateFactorScore(
      safeMetrics.questionBasedPercentage || 0,
      { high: 20, medium: 5 },
      { high: 2.5, medium: 1.5, low: 0 },
      'questionBasedContent'
    );
    
    factorScores.scannability = calculateFactorScore(
      safeMetrics.scannabilityScore || 0,
      { high: 40, medium: 20 },
      { high: 2.5, medium: 1.5, low: 0.5 },
      'scannability'
    );
    
    factorScores.readabilityScore = calculateFactorScore(
      safeMetrics.readabilityPercentage || 0,
      { high: 50, medium: 30 },
      { high: 2.5, medium: 1.5, low: 0.5 },
      'readabilityScore'
    );
    
    factorScores.icpSpecificFAQs = calculateFactorScore(
      safeMetrics.hasFAQsScore || 0,
      { high: 50, medium: 25 },
      { high: 2.5, medium: 1.5, low: 0 },
      'icpSpecificFAQs'
    );
    
    factorScores.industryContent = calculateFactorScore(
      safeMetrics.industryContentScore || 0,
      { high: 40, medium: 20 },
      { high: 2.0, medium: 1.0, low: 0.5 },
      'industryContent'
    );
    
    factorScores.geoContent = calculateFactorScore(
      safeMetrics.geoContentScore || 0,
      { high: 40, medium: 20 },
      { high: 1.5, medium: 1.0, low: 0 },
      'geoContent'
    );
    
    let categoryTotal = 0;
    for (const [factorName, score] of Object.entries(factorScores)) {
      const safeScore = Number(score) || 0;
      categoryTotal += safeScore;
    }
    
    return { scores: factorScores, total: Math.max(0, categoryTotal) };
  } catch (error) {
    console.error('Error in analyzeAISearchReadiness:', error);
    return { scores: {}, total: 0 };
  }
}

function analyzeContentStructure(metrics) {
  try {
    const safeMetrics = metrics || {};
    const factorScores = {};
    
    factorScores.headingStructure = calculateFactorScore(
      safeMetrics.structureScore || 0,
      { high: 60, medium: 30 },
      { high: 3.0, medium: 2.0, low: 1.0 },
      'headingStructure'
    );
    
    factorScores.semanticContent = calculateFactorScore(
      safeMetrics.semanticScore || 0,
      { high: 75, medium: 40 },
      { high: 2.5, medium: 1.5, low: 0.5 },
      'semanticContent'
    );
    
    factorScores.imageAltText = calculateFactorScore(
      safeMetrics.imageAltPercentage || 0,
      { high: 70, medium: 40 },
      { high: 2.0, medium: 1.0, low: 0.5 },
      'imageAltText'
    );
    
    let categoryTotal = 0;
    for (const score of Object.values(factorScores)) {
      categoryTotal += Number(score) || 0;
    }
    
    return { scores: factorScores, total: Math.max(0, categoryTotal) };
  } catch (error) {
    console.error('Error in analyzeContentStructure:', error);
    return { scores: {}, total: 0 };
  }
}

function analyzeVoiceOptimization(metrics) {
  try {
    const safeMetrics = metrics || {};
    const factorScores = {};
    
    factorScores.conversationalContent = calculateFactorScore(
      safeMetrics.voiceScore || 0,
      { high: 50, medium: 25 },
      { high: 3.0, medium: 2.0, low: 1.0 },
      'conversationalContent'
    );
    
    factorScores.localKeywords = calculateFactorScore(
      safeMetrics.localKeywordScore || 0,
      { high: 75, medium: 25 },
      { high: 2.5, medium: 1.5, low: 0.5 },
      'localKeywords'
    );
    
    let categoryTotal = 0;
    for (const score of Object.values(factorScores)) {
      categoryTotal += Number(score) || 0;
    }
    
    return { scores: factorScores, total: Math.max(0, categoryTotal) };
  } catch (error) {
    console.error('Error in analyzeVoiceOptimization:', error);
    return { scores: {}, total: 0 };
  }
}

function analyzeTechnicalSetup(metrics) {
  try {
    const safeMetrics = metrics || {};
    const factorScores = {};
    
    factorScores.basicTechnical = calculateFactorScore(
      safeMetrics.technicalScore || 0,
      { high: 60, medium: 30 },
      { high: 5.0, medium: 3.0, low: 1.5 },
      'basicTechnical'
    );
    
    let categoryTotal = 0;
    for (const score of Object.values(factorScores)) {
      categoryTotal += Number(score) || 0;
    }
    
    return { scores: factorScores, total: Math.max(0, categoryTotal) };
  } catch (error) {
    console.error('Error in analyzeTechnicalSetup:', error);
    return { scores: {}, total: 0 };
  }
}

function analyzeTrustAuthority(metrics) {
  try {
    const safeMetrics = metrics || {};
    const factorScores = {};
    
    factorScores.trustSignals = calculateFactorScore(
      safeMetrics.trustScore || 0,
      { high: 60, medium: 30 },
      { high: 4.0, medium: 2.5, low: 1.0 },
      'trustSignals'
    );
    
    let categoryTotal = 0;
    for (const score of Object.values(factorScores)) {
      categoryTotal += Number(score) || 0;
    }
    
    return { scores: factorScores, total: Math.max(0, categoryTotal) };
  } catch (error) {
    console.error('Error in analyzeTrustAuthority:', error);
    return { scores: {}, total: 0 };
  }
}

function analyzeAIReadability(metrics) {
  try {
    const safeMetrics = metrics || {};
    const factorScores = {};
    
    factorScores.mediaOptimization = calculateFactorScore(
      safeMetrics.mediaScore || 0,
      { high: 70, medium: 40 },
      { high: 3.0, medium: 2.0, low: 1.0 },
      'mediaOptimization'
    );
    
    let categoryTotal = 0;
    for (const score of Object.values(factorScores)) {
      categoryTotal += Number(score) || 0;
    }
    
    return { scores: factorScores, total: Math.max(0, categoryTotal) };
  } catch (error) {
    console.error('Error in analyzeAIReadability:', error);
    return { scores: {}, total: 0 };
  }
}

function analyzeSpeedUX(metrics) {
  try {
    const safeMetrics = metrics || {};
    const factorScores = {};
    
    factorScores.performanceBasics = calculateFactorScore(
      safeMetrics.speedScore || 0,
      { high: 70, medium: 40 },
      { high: 3.0, medium: 2.0, low: 1.0 },
      'performanceBasics'
    );
    
    let categoryTotal = 0;
    for (const score of Object.values(factorScores)) {
      categoryTotal += Number(score) || 0;
    }
    
    return { scores: factorScores, total: Math.max(0, categoryTotal) };
  } catch (error) {
    console.error('Error in analyzeSpeedUX:', error);
    return { scores: {}, total: 0 };
  }
}

// Main analysis function with comprehensive error handling
function performDetailedAnalysis(websiteData) {
  try {
    console.log('Starting detailed analysis...');
    
    if (!websiteData) {
      throw new Error('No website data provided');
    }
    
    const { html = '', url = '' } = websiteData;
    
    if (!html) {
      throw new Error('No HTML content provided');
    }
    
    const content = extractTextContent(html);
    const industry = detectIndustry(websiteData);
    
    console.log('Detected industry:', industry.name);
    
    const metrics = analyzePageMetrics(html, content, industry, url);
    
    // Get analysis results with error handling
    const analysisResults = {
      aiSearchReadiness: analyzeAISearchReadiness(metrics),
      contentStructure: analyzeContentStructure(metrics),
      voiceOptimization: analyzeVoiceOptimization(metrics),
      technicalSetup: analyzeTechnicalSetup(metrics),
      trustAuthority: analyzeTrustAuthority(metrics),
      aiReadability: analyzeAIReadability(metrics),
      speedUX: analyzeSpeedUX(metrics)
    };
    
    // Calculate final scores safely
    console.log('Calculating final scores...');
    const categoryScores = {};
    let totalWeightedScore = 0;
    
    for (const [category, result] of Object.entries(analysisResults)) {
      const categoryScore = Number(result?.total) || 0;
      categoryScores[category] = Math.round(categoryScore * 10) / 10;
      
      const weight = CATEGORY_WEIGHTS[category] || 0;
      const weightedScore = categoryScore * weight;
      totalWeightedScore += weightedScore;
    }
    
    categoryScores.total = Math.round(Math.max(0, totalWeightedScore) * 10) / 10;
    
    console.log('Final category scores:', categoryScores);
    
    // Generate recommendations safely
    const recommendations = generateRecommendations(analysisResults, categoryScores, industry);
    
    return {
      url: url || 'Unknown URL',
      industry: industry || getDefaultIndustry(),
      scores: categoryScores,
      analysis: analysisResults,
      recommendations: recommendations || [],
      metrics: metrics || {},
      analyzedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error in performDetailedAnalysis:', error);
    
    // Return safe fallback response
    return {
      url: websiteData?.url || 'Unknown URL',
      industry: getDefaultIndustry(),
      scores: {
        aiSearchReadiness: 0,
        contentStructure: 0,
        voiceOptimization: 0,
        technicalSetup: 0,
        trustAuthority: 0,
        aiReadability: 0,
        speedUX: 0,
        total: 0
      },
      analysis: {},
      recommendations: [{
        title: 'Analysis Error',
        description: 'There was an error analyzing this website. Please try again or contact support.',
        impact: 'High',
        category: 'System',
        quickWin: 'Verify the URL is accessible and try again.'
      }],
      metrics: {},
      analyzedAt: new Date().toISOString(),
      error: error.message
    };
  }
}

function generateRecommendations(analysis, scores, industry) {
  try {
    const recommendations = [];
    const safeScores = scores || {};
    const safeIndustry = industry || getDefaultIndustry();
    
    if ((safeScores.aiSearchReadiness || 0) < 8) {
      recommendations.push({
        title: 'Improve Question-Based Content',
        description: `Add FAQ sections and question headings like "What makes ${safeIndustry.name} different?" to improve AI citation rates.`,
        impact: 'High',
        category: 'AI Search Readiness',
        quickWin: 'Add 3-5 FAQ questions addressing common customer concerns.'
      });
    }
    
    if ((safeScores.contentStructure || 0) < 6) {
      recommendations.push({
        title: 'Enhance Content Structure',
        description: 'Improve heading hierarchy and add alt text to images for better AI understanding.',
        impact: 'Medium',
        category: 'Content Structure',
        quickWin: 'Ensure single H1 per page and add descriptive alt text to images.'
      });
    }
    
    if ((safeScores.voiceOptimization || 0) < 4) {
      recommendations.push({
        title: 'Optimize for Voice Search',
        description: 'Include conversational phrases and local keywords to capture voice queries.',
        impact: 'High',
        category: 'Voice Optimization',
        quickWin: `Add phrases like "best ${safeIndustry.name} near me" and natural language questions.`
      });
    }
    
    if ((safeScores.technicalSetup || 0) < 4) {
      recommendations.push({
        title: 'Improve Technical Foundation',
        description: 'Add structured data, meta descriptions, and ensure mobile optimization.',
        impact: 'Critical',
        category: 'Technical Setup',
        quickWin: 'Add basic schema markup and ensure viewport meta tag is present.'
      });
    }
    
    return recommendations.slice(0, 6);
  } catch (error) {
    console.error('Error generating recommendations:', error);
    return [{
      title: 'General Optimization',
      description: 'Focus on improving content quality and technical SEO fundamentals.',
      impact: 'Medium',
      category: 'General',
      quickWin: 'Ensure your website loads quickly and has clear navigation.'
    }];
  }
}

// Safe website fetching
async function fetchWebsiteContent(url) {
  try {
    console.log('Fetching website content from:', url);
    
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL provided');
    }
    
    // Basic URL validation
    let validUrl;
    try {
      validUrl = new URL(url);
    } catch (urlError) {
      throw new Error(`Invalid URL format: ${urlError.message}`);
    }
    
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AI-Visibility-Tool/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'Cache-Control': 'no-cache'
      },
      validateStatus: function (status) {
        return status >= 200 && status < 400; // Accept 2xx and 3xx status codes
      }
    });
    
    if (!response.data) {
      throw new Error('No content received from website');
    }
    
    console.log('Website fetched successfully. Content length:', response.data.length);
    
    return {
      html: response.data,
      url: url,
      status: response.status,
      headers: response.headers || {}
    };
  } catch (error) {
    console.error('Failed to fetch website:', error.message);
    
    if (error.code === 'ENOTFOUND') {
      throw new Error('Website not found. Please check the URL and try again.');
    } else if (error.code === 'ECONNREFUSED') {
      throw new Error('Connection refused. The website may be down or blocking requests.');
    } else if (error.code === 'ETIMEDOUT') {
      throw new Error('Request timed out. The website is taking too long to respond.');
    } else if (error.response) {
      throw new Error(`Website returned ${error.response.status}: ${error.response.statusText}`);
    } else {
      throw new Error(`Failed to fetch website: ${error.message}`);
    }
  }
}

// API Routes with comprehensive error handling

// Test routes
router.get('/test', (req, res) => {
    res.json({ 
        message: 'AI Testing routes are working!',
        timestamp: new Date().toISOString()
    });
});

router.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        service: 'AI Testing API',
        timestamp: new Date().toISOString()
    });
});

// Main website analysis endpoint
router.post('/analyze-website', async (req, res) => {
  try {
    console.log('New website analysis request...');
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        success: false,
        error: 'URL is required',
        message: 'Please provide a valid URL to analyze'
      });
    }

    if (typeof url !== 'string') {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid URL format',
        message: 'URL must be a string'
      });
    }

    console.log('Analyzing URL:', url);
    
    const websiteData = await fetchWebsiteContent(url);
    const analysis = performDetailedAnalysis(websiteData);
    
    console.log('Analysis completed. Total score:', analysis.scores.total);
    
    res.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('Website analysis failed:', error);
    
    // Return appropriate error status and message
    const statusCode = error.message.includes('not found') ? 404 :
                      error.message.includes('timeout') ? 408 :
                      error.message.includes('refused') ? 503 :
                      error.message.includes('Invalid URL') ? 400 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: 'Website analysis failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// AI visibility testing endpoint (simplified for now to avoid API issues)
router.post('/test-ai-visibility', async (req, res) => {
  try {
    const { url, industry, queries } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        success: false,
        error: 'URL is required',
        message: 'Please provide a URL to test'
      });
    }

    if (!queries || !Array.isArray(queries)) {
      return res.status(400).json({ 
        success: false,
        error: 'Queries array is required',
        message: 'Please provide an array of test queries'
      });
    }

    // Check if API keys are configured
    const availableAssistants = [];
    if (process.env.OPENAI_API_KEY) availableAssistants.push('OpenAI GPT-4');
    if (process.env.ANTHROPIC_API_KEY) availableAssistants.push('Anthropic Claude');
    if (process.env.PERPLEXITY_API_KEY) availableAssistants.push('Perplexity AI');

    if (availableAssistants.length === 0) {
      return res.status(503).json({
        success: false,
        error: 'AI testing unavailable',
        message: 'No AI API keys configured. Please contact administrator.',
        availableFeatures: ['Website Analysis']
      });
    }

    // For now, return a mock response to avoid API costs and failures
    const mockResults = {
      overall: { 
        mentionRate: Math.random() * 100, 
        recommendationRate: Math.random() * 50, 
        citationRate: Math.random() * 75 
      },
      assistants: {},
      testedQueries: queries.length,
      availableAssistants,
      note: 'AI visibility testing requires API configuration. This is a mock response.',
      timestamp: new Date().toISOString()
    };

    console.log('AI visibility test completed (mock)');
    
    res.json({
      success: true,
      data: mockResults
    });

  } catch (error) {
    console.error('AI visibility testing failed:', error);
    res.status(500).json({
      success: false,
      error: 'AI visibility testing failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling for the router
router.use((error, req, res, next) => {
  console.error('Router error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: 'An unexpected error occurred',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
