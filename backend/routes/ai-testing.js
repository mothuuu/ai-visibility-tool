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

// Realistic scoring parameters based on what real websites actually have
const SCORING_PARAMETERS = {
  weights: {
    aiSearchReadiness: 0.25,
    contentStructure: 0.20,
    voiceOptimization: 0.15,
    technicalSetup: 0.20,
    trustAuthority: 0.15,
    aiReadability: 0.10,
    speedUX: 0.10
  }
};

// Industry detection
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
    
    for (const keyword of industry.keywords) {
      if (content.includes(keyword)) score += 1;
    }
    
    for (const keyword of industry.domainKeywords) {
      if (domain.includes(keyword)) score += 3;
    }
    
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

// Calculate factor score with realistic thresholds
function calculateFactorScore(value, thresholds, points, factorName) {
  console.log(`📊 Calculating ${factorName}:`, { value, thresholds, points });
  
  if (typeof thresholds.high !== 'undefined') {
    if (typeof points.medium !== 'undefined') {
      // Three-tier scoring
      if (value >= thresholds.high) {
        console.log(`✅ ${factorName}: ${value} >= ${thresholds.high} → ${points.high} points`);
        return points.high;
      }
      if (value >= thresholds.medium) {
        console.log(`🟡 ${factorName}: ${value} >= ${thresholds.medium} → ${points.medium} points`);
        return points.medium;
      }
      console.log(`❌ ${factorName}: ${value} < ${thresholds.medium} → ${points.low} points`);
      return points.low;
    } else {
      // Two-tier scoring
      if (value >= thresholds.high) {
        console.log(`✅ ${factorName}: ${value} >= ${thresholds.high} → ${points.high} points`);
        return points.high;
      }
      console.log(`❌ ${factorName}: ${value} < ${thresholds.high} → ${points.low} points`);
      return points.low;
    }
  }
  
  console.log(`❌ ${factorName}: No valid thresholds → ${points.low} points`);
  return points.low || 0;
}

// Extract comprehensive metrics with more generous scoring
function analyzePageMetrics(html, content, industry, url) {
  console.log('\n🔬 Starting comprehensive page metrics analysis...');
  console.log('📄 HTML length:', html.length);
  console.log('📝 Content length:', content.length);
  
  // Basic content analysis
  const words = content.split(/\s+/).filter(word => word.length > 0);
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  console.log('📊 Basic stats:', { wordCount: words.length, sentenceCount: sentences.length });
  
  // Heading analysis
  const h1Matches = html.match(/<h1[^>]*>/gi) || [];
  const allHeadingMatches = html.match(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi) || [];
  const questionHeadingMatches = allHeadingMatches.filter(h => h.includes('?'));
  const headingText = allHeadingMatches.join(' ').toLowerCase();
  
  // More generous content detection
  const hasSubheadings = (html.match(/<h[2-6][^>]*>/gi) || []).length >= 2;
  const hasLists = (html.match(/<(ul|ol)[^>]*>/gi) || []).length >= 1;
  const hasTables = (html.match(/<table[^>]*>/gi) || []).length >= 1;
  const listElements = (html.match(/<(ul|ol|li|table|tr|td)[^>]*>/gi) || []).length;
  
  console.log('📰 Heading analysis:', { 
    h1Count: h1Matches.length, 
    totalHeadings: allHeadingMatches.length,
    questionHeadings: questionHeadingMatches.length,
    hasSubheadings,
    hasLists,
    hasTables
  });
  
  // Image analysis
  const imageMatches = html.match(/<img[^>]*>/gi) || [];
  const altMatches = html.match(/<img[^>]+alt\s*=\s*["'][^"']*["'][^>]*>/gi) || [];
  console.log('🖼️ Images:', { total: imageMatches.length, withAlt: altMatches.length });
  
  // Content quality indicators
  const hasAboutSection = /about|team|company|who we are|our story/i.test(content);
  const hasContactInfo = /contact|phone|email|address/i.test(content);
  const hasServices = /services|solutions|products|what we do/i.test(content);
  const hasTestimonials = /testimonial|review|feedback|client|customer/i.test(content);
  
  // Industry-specific content
  const industryTermCount = industry.keywords.filter(keyword => 
    content.toLowerCase().includes(keyword.toLowerCase())
  ).length;
  const painPointsCount = industry.painPoints.filter(pain => 
    content.toLowerCase().includes(pain.toLowerCase())
  ).length;
  
  // FAQ and Q&A detection (more generous)
  const hasFAQSection = /faq|frequently.asked|questions.and.answers|q&a/i.test(html);
  const hasQuestionWords = /what|how|why|when|where|which/i.test(content);
  
  // Local/geo content
  const geoTerms = ['ontario', 'toronto', 'vancouver', 'canada', 'local', 'region', 'area', 'near me', 'city', 'province'];
  const geoMatches = geoTerms.filter(term => content.toLowerCase().includes(term)).length;
  
  // Technical indicators
  const hasMetaDescription = html.includes('name="description"');
  const hasViewport = html.includes('name="viewport"');
  const hasStructuredData = html.includes('application/ld+json') || html.includes('itemscope');
  const hasSitemap = html.includes('sitemap') || /sitemap/i.test(content);
  
  // Trust indicators
  const trustTerms = ['certified', 'licensed', 'accredited', 'professional', 'expert', 'award', 'years of experience'];
  const trustMatches = trustTerms.filter(term => content.toLowerCase().includes(term)).length;
  
  // Calculate more generous percentages
  const questionBasedPercentage = allHeadingMatches.length > 0 ? 
    (questionHeadingMatches.length / allHeadingMatches.length) * 100 : 0;
  
  // Enhanced scannability score (more generous)
  let scannabilityScore = 0;
  if (hasLists) scannabilityScore += 30;
  if (hasTables) scannabilityScore += 20;
  if (hasSubheadings) scannabilityScore += 25;
  if (listElements >= 5) scannabilityScore += 25;
  scannabilityScore = Math.min(100, scannabilityScore);
  
  const imageAltPercentage = imageMatches.length > 0 ? 
    (altMatches.length / imageMatches.length) * 100 : 100;
  
  // More forgiving readability calculation
  const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : 15;
  const readabilityPercentage = Math.max(20, Math.min(100, 120 - Math.abs(avgWordsPerSentence - 15) * 3));
  
  // Content structure score
  let structureScore = 0;
  if (h1Matches.length === 1) structureScore += 40;
  if (hasSubheadings) structureScore += 30;
  if (allHeadingMatches.length >= 3) structureScore += 30;
  structureScore = Math.min(100, structureScore);
  
  // Voice optimization score
  let voiceScore = 0;
  if (hasQuestionWords) voiceScore += 25;
  if (hasFAQSection) voiceScore += 35;
  if (questionHeadingMatches.length > 0) voiceScore += 40;
  voiceScore = Math.min(100, voiceScore);
  
  // Technical score
  let technicalScore = 0;
  if (hasMetaDescription) technicalScore += 25;
  if (hasViewport) technicalScore += 25;
  if (hasStructuredData) technicalScore += 30;
  if (hasSitemap) technicalScore += 20;
  technicalScore = Math.min(100, technicalScore);
  
  // Trust score
  let trustScore = 0;
  if (hasAboutSection) trustScore += 25;
  if (hasContactInfo) trustScore += 20;
  if (hasTestimonials) trustScore += 25;
  if (trustMatches > 0) trustScore += 30;
  trustScore = Math.min(100, trustScore);
  
  // Speed/UX score (basic indicators)
  let speedScore = 50; // Base score
  if (html.length < 100000) speedScore += 25; // Not too large
  if (hasViewport) speedScore += 25; // Mobile friendly
  speedScore = Math.min(100, speedScore);
  
  console.log('📈 Calculated generous scores:', {
    questionBasedPercentage: questionBasedPercentage.toFixed(1),
    scannabilityScore: scannabilityScore.toFixed(1),
    readabilityPercentage: readabilityPercentage.toFixed(1),
    structureScore: structureScore.toFixed(1),
    voiceScore: voiceScore.toFixed(1),
    technicalScore: technicalScore.toFixed(1),
    trustScore: trustScore.toFixed(1),
    speedScore: speedScore.toFixed(1)
  });
  
  return {
    // AI Search Readiness
    questionBasedPercentage,
    scannabilityScore,
    readabilityPercentage,
    hasFAQsScore: hasFAQSection ? 100 : (hasQuestionWords ? 50 : 0),
    industryContentScore: Math.min(100, (industryTermCount * 25) + (painPointsCount * 15)),
    geoContentScore: Math.min(100, geoMatches * 20),
    
    // Content Structure
    structureScore,
    imageAltPercentage,
    semanticScore: hasAboutSection && hasServices ? 100 : 50,
    
    // Voice Optimization  
    voiceScore,
    localKeywordScore: geoMatches > 0 ? 100 : 0,
    
    // Technical Setup
    technicalScore,
    
    // Trust & Authority
    trustScore,
    
    // AI Readability
    mediaScore: imageAltPercentage,
    
    // Speed & UX
    speedScore
  };
}

// AI Search Readiness with more generous thresholds
function analyzeAISearchReadiness(metrics) {
  console.log('\n🎯 Analyzing AI Search Readiness with generous scoring...');
  
  const scores = {
    // More forgiving thresholds - even 10% gets some points
    questionBasedContent: calculateFactorScore(
      metrics.questionBasedPercentage,
      { high: 20, medium: 5 }, // Much lower thresholds
      { high: 2.5, medium: 1.5, low: 0 },
      'questionBasedContent'
    ),
    scannability: calculateFactorScore(
      metrics.scannabilityScore,
      { high: 40, medium: 20 }, // Lower thresholds
      { high: 2.5, medium: 1.5, low: 0.5 }, // Minimum 0.5 points
      'scannability'
    ),
    readabilityScore: calculateFactorScore(
      metrics.readabilityPercentage,
      { high: 50, medium: 30 }, // Lower thresholds  
      { high: 2.5, medium: 1.5, low: 0.5 },
      'readabilityScore'
    ),
    icpSpecificFAQs: calculateFactorScore(
      metrics.hasFAQsScore,
      { high: 50, medium: 25 },
      { high: 2.5, medium: 1.5, low: 0 },
      'icpSpecificFAQs'
    ),
    // Additional factors for more points
    industryContent: calculateFactorScore(
      metrics.industryContentScore,
      { high: 40, medium: 20 },
      { high: 2.0, medium: 1.0, low: 0.5 },
      'industryContent'
    ),
    geoContent: calculateFactorScore(
      metrics.geoContentScore,
      { high: 40, medium: 20 },
      { high: 1.5, medium: 1.0, low: 0 },
      'geoContent'
    )
  };
  
  console.log('🎯 AI Search Readiness scores:', scores);
  return scores;
}

function analyzeContentStructure(metrics) {
  console.log('\n🏗️ Analyzing Content Structure...');
  
  const scores = {
    headingStructure: calculateFactorScore(
      metrics.structureScore,
      { high: 60, medium: 30 }, // More achievable
      { high: 3.0, medium: 2.0, low: 1.0 }, // Always get some points
      'headingStructure'
    ),
    semanticContent: calculateFactorScore(
      metrics.semanticScore,
      { high: 75, medium: 40 },
      { high: 2.5, medium: 1.5, low: 0.5 },
      'semanticContent'
    ),
    imageAltText: calculateFactorScore(
      metrics.imageAltPercentage,
      { high: 70, medium: 40 },
      { high: 2.0, medium: 1.0, low: 0.5 },
      'imageAltText'
    )
  };
  
  console.log('🏗️ Content Structure scores:', scores);
  return scores;
}

function analyzeVoiceOptimization(metrics) {
  console.log('\n🎤 Analyzing Voice Optimization...');
  
  const scores = {
    conversationalContent: calculateFactorScore(
      metrics.voiceScore,
      { high: 50, medium: 25 },
      { high: 3.0, medium: 2.0, low: 1.0 }, // Always get some points
      'conversationalContent'
    ),
    localKeywords: calculateFactorScore(
      metrics.localKeywordScore,
      { high: 75, medium: 25 },
      { high: 2.5, medium: 1.5, low: 0.5 },
      'localKeywords'
    )
  };
  
  console.log('🎤 Voice Optimization scores:', scores);
  return scores;
}

function analyzeTechnicalSetup(metrics) {
  console.log('\n⚙️ Analyzing Technical Setup...');
  
  const scores = {
    basicTechnical: calculateFactorScore(
      metrics.technicalScore,
      { high: 60, medium: 30 },
      { high: 5.0, medium: 3.0, low: 1.5 }, // Always get some points
      'basicTechnical'
    )
  };
  
  console.log('⚙️ Technical Setup scores:', scores);
  return scores;
}

function analyzeTrustAuthority(metrics) {
  console.log('\n🛡️ Analyzing Trust & Authority...');
  
  const scores = {
    trustSignals: calculateFactorScore(
      metrics.trustScore,
      { high: 60, medium: 30 },
      { high: 4.0, medium: 2.5, low: 1.0 }, // Always get some points
      'trustSignals'
    )
  };
  
  console.log('🛡️ Trust & Authority scores:', scores);
  return scores;
}

function analyzeAIReadability(metrics) {
  console.log('\n👁️ Analyzing AI Readability...');
  
  const scores = {
    mediaOptimization: calculateFactorScore(
      metrics.mediaScore,
      { high: 70, medium: 40 },
      { high: 3.0, medium: 2.0, low: 1.0 }, // Always get some points
      'mediaOptimization'
    )
  };
  
  console.log('👁️ AI Readability scores:', scores);
  return scores;
}

function analyzeSpeedUX(metrics) {
  console.log('\n⚡ Analyzing Speed & UX...');
  
  const scores = {
    performanceBasics: calculateFactorScore(
      metrics.speedScore,
      { high: 70, medium: 40 },
      { high: 3.0, medium: 2.0, low: 1.0 }, // Always get some points
      'performanceBasics'
    )
  };
  
  console.log('⚡ Speed & UX scores:', scores);
  return scores;
}

// Calculate total scores
function calculateScores(analysis) {
  console.log('\n🧮 Calculating final scores...');
  
  const scores = {};
  let totalWeightedScore = 0;
  
  for (const [category, categoryAnalysis] of Object.entries(analysis)) {
    let categoryScore = 0;
    
    for (const [factorName, factorScore] of Object.entries(categoryAnalysis)) {
      console.log(`  ${category}.${factorName}: ${factorScore}`);
      categoryScore += factorScore;
    }
    
    scores[category] = Math.round(categoryScore * 10) / 10;
    const categoryWeight = SCORING_PARAMETERS.weights[category];
    totalWeightedScore += categoryScore * categoryWeight;
    
    console.log(`📊 ${category}: ${categoryScore} points (weighted: ${(categoryScore * categoryWeight).toFixed(2)})`);
  }
  
  scores.total = Math.round(totalWeightedScore * 10) / 10;
  console.log('🎯 Total weighted score:', scores.total);
  
  return scores;
}

// Main analysis function
function performDetailedAnalysis(websiteData) {
  console.log('\n🚀 Starting detailed analysis with generous scoring...');
  console.log('🌐 URL:', websiteData.url);
  
  const { html, url } = websiteData;
  const content = extractTextContent(html);
  const industry = detectIndustry(websiteData);
  
  console.log('🏭 Detected industry:', industry.name);
  
  const metrics = analyzePageMetrics(html, content, industry, url);
  
  const analysis = {
    aiSearchReadiness: analyzeAISearchReadiness(metrics),
    contentStructure: analyzeContentStructure(metrics),
    voiceOptimization: analyzeVoiceOptimization(metrics),
    technicalSetup: analyzeTechnicalSetup(metrics),
    trustAuthority: analyzeTrustAuthority(metrics),
    aiReadability: analyzeAIReadability(metrics),
    speedUX: analyzeSpeedUX(metrics)
  };
  
  const scores = calculateScores(analysis);
  
  console.log('\n✅ Analysis complete!');
  console.log('📊 Final scores:', scores);
  
  return {
    industry,
    analysis,
    scores,
    metrics,
    recommendations: generateRecommendations(analysis, scores, industry),
    url,
    analyzedAt: new Date().toISOString()
  };
}

function generateRecommendations(analysis, scores, industry) {
  const recommendations = [];
  
  // Check each category and provide specific recommendations
  if (scores.aiSearchReadiness < 8) {
    recommendations.push({
      title: 'Improve Question-Based Content',
      description: `Add FAQ sections and question headings like "What makes ${industry.name} different?" to improve AI citation rates.`,
      impact: 'High',
      category: 'AI Search Readiness',
      quickWin: 'Add 3-5 FAQ questions addressing common customer concerns.'
    });
  }
  
  if (scores.contentStructure < 6) {
    recommendations.push({
      title: 'Enhance Content Structure',
      description: 'Improve heading hierarchy and add alt text to images for better AI understanding.',
      impact: 'Medium',
      category: 'Content Structure',
      quickWin: 'Ensure single H1 per page and add descriptive alt text to images.'
    });
  }
  
  if (scores.voiceOptimization < 4) {
    recommendations.push({
      title: 'Optimize for Voice Search',
      description: 'Include conversational phrases and local keywords to capture voice queries.',
      impact: 'High',
      category: 'Voice Optimization',
      quickWin: `Add phrases like "best ${industry.name} near me" and natural language questions.`
    });
  }
  
  if (scores.technicalSetup < 4) {
    recommendations.push({
      title: 'Improve Technical Foundation',
      description: 'Add structured data, meta descriptions, and ensure mobile optimization.',
      impact: 'Critical',
      category: 'Technical Setup',
      quickWin: 'Add basic schema markup and ensure viewport meta tag is present.'
    });
  }
  
  return recommendations.slice(0, 6);
}

// Helper functions
function extractTextContent(html) {
  if (!html || typeof html !== 'string') {
    console.log('⚠️ Invalid HTML provided to extractTextContent');
    return '';
  }
  
  const textContent = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
    
  console.log('📝 Extracted text content length:', textContent.length);
  return textContent;
}

// API Routes
router.post('/analyze-website', async (req, res) => {
  try {
    console.log('\n🌐 New website analysis request...');
    const { url } = req.body;
    
    if (!url) {
      console.log('❌ No URL provided');
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log('🔍 Analyzing URL:', url);
    const websiteData = await fetchWebsiteContent(url);
    const analysis = performDetailedAnalysis(websiteData);
    
    console.log('✅ Sending response with scores:', analysis.scores);
    
    res.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('❌ Website analysis failed:', error);
    res.status(500).json({
      error: 'Website analysis failed',
      message: error.message
    });
  }
});

// Keep existing AI testing route
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

async function fetchWebsiteContent(url) {
  try {
    console.log('📡 Fetching website content from:', url);
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AI-Visibility-Tool/1.0)'
      }
    });
    
    console.log('✅ Website fetched successfully. Content length:', response.data.length);
    
    return {
      html: response.data,
      url: url,
      status: response.status,
      headers: response.headers
    };
  } catch (error) {
    console.error('❌ Failed to fetch website:', error.message);
    throw new Error(`Failed to fetch website: ${error.message}`);
  }
}

// Simplified AI testing functions
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
