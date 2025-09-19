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
  aiReadability: 0.03,
  speedUX: 0.02
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

// Fixed graduated scoring function
function calculateFactorScore(value, thresholds, points, factorName) {
  console.log(`🔢 Scoring ${factorName}: value=${value}, thresholds=`, thresholds, 'points=', points);
  
  // Ensure value is a number
  const numValue = Number(value);
  if (isNaN(numValue)) {
    console.log(`❌ ${factorName}: Invalid value ${value}, returning 0`);
    return 0;
  }
  
  // Handle different threshold structures
  if (thresholds.high !== undefined) {
    if (points.medium !== undefined) {
      // Three-tier scoring
      if (numValue >= thresholds.high) {
        console.log(`✅ ${factorName}: ${numValue} >= ${thresholds.high} → ${points.high} points`);
        return points.high;
      }
      if (numValue >= thresholds.medium) {
        console.log(`🟡 ${factorName}: ${numValue} >= ${thresholds.medium} → ${points.medium} points`);
        return points.medium;
      }
      console.log(`❌ ${factorName}: ${numValue} < ${thresholds.medium} → ${points.low} points`);
      return points.low;
    } else {
      // Two-tier scoring
      if (numValue >= thresholds.high) {
        console.log(`✅ ${factorName}: ${numValue} >= ${thresholds.high} → ${points.high} points`);
        return points.high;
      }
      console.log(`❌ ${factorName}: ${numValue} < ${thresholds.high} → ${points.low} points`);
      return points.low;
    }
  }
  
  console.log(`❌ ${factorName}: No valid thresholds, returning 0`);
  return 0;
}

// Extract comprehensive metrics
function analyzePageMetrics(html, content, industry, url) {
  console.log('\n🔬 Analyzing page metrics...');
  console.log('📄 HTML length:', html.length);
  console.log('📝 Content length:', content.length);
  
  // Basic content analysis
  const words = content.split(/\s+/).filter(word => word.length > 0);
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  // Heading analysis
  const h1Matches = html.match(/<h1[^>]*>/gi) || [];
  const allHeadingMatches = html.match(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi) || [];
  const questionHeadingMatches = allHeadingMatches.filter(h => h.includes('?'));
  const hasSubheadings = (html.match(/<h[2-6][^>]*>/gi) || []).length >= 2;
  
  // Content structure elements
  const hasLists = (html.match(/<(ul|ol)[^>]*>/gi) || []).length >= 1;
  const hasTables = (html.match(/<table[^>]*>/gi) || []).length >= 1;
  const listElements = (html.match(/<(ul|ol|li|table|tr|td)[^>]*>/gi) || []).length;
  
  // Image analysis
  const imageMatches = html.match(/<img[^>]*>/gi) || [];
  const altMatches = html.match(/<img[^>]+alt\s*=\s*["'][^"']*["'][^>]*>/gi) || [];
  
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
  
  // FAQ and Q&A detection
  const hasFAQSection = /faq|frequently.asked|questions.and.answers|q&a/i.test(html);
  const hasQuestionWords = /what|how|why|when|where|which/i.test(content);
  
  // Local/geo content
  const geoTerms = ['ontario', 'toronto', 'vancouver', 'canada', 'local', 'region', 'area', 'near me', 'city', 'province'];
  const geoMatches = geoTerms.filter(term => content.toLowerCase().includes(term)).length;
  
  // Technical indicators
  const hasMetaDescription = html.includes('name="description"');
  const hasViewport = html.includes('name="viewport"');
  const hasStructuredData = html.includes('application/ld+json') || html.includes('itemscope');
  
  // Trust indicators
  const trustTerms = ['certified', 'licensed', 'accredited', 'professional', 'expert', 'award', 'years of experience'];
  const trustMatches = trustTerms.filter(term => content.toLowerCase().includes(term)).length;
  
  // Calculate percentages and scores
  const questionBasedPercentage = allHeadingMatches.length > 0 ? 
    (questionHeadingMatches.length / allHeadingMatches.length) * 100 : 0;
  
  // Enhanced scannability score
  let scannabilityScore = 0;
  if (hasLists) scannabilityScore += 30;
  if (hasTables) scannabilityScore += 20;
  if (hasSubheadings) scannabilityScore += 25;
  if (listElements >= 5) scannabilityScore += 25;
  scannabilityScore = Math.min(100, scannabilityScore);
  
  const imageAltPercentage = imageMatches.length > 0 ? 
    (altMatches.length / imageMatches.length) * 100 : 100;
  
  // Readability calculation
  const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : 15;
  const readabilityPercentage = Math.max(20, Math.min(100, 120 - Math.abs(avgWordsPerSentence - 15) * 3));
  
  console.log('📊 Calculated key metrics:', {
    questionBasedPercentage: questionBasedPercentage.toFixed(1),
    scannabilityScore: scannabilityScore.toFixed(1),
    readabilityPercentage: readabilityPercentage.toFixed(1),
    imageAltPercentage: imageAltPercentage.toFixed(1),
    industryTermCount,
    hasFAQSection,
    hasQuestionWords
  });
  
  return {
    questionBasedPercentage,
    scannabilityScore,
    readabilityPercentage,
    hasFAQsScore: hasFAQSection ? 100 : (hasQuestionWords ? 50 : 0),
    industryContentScore: Math.min(100, (industryTermCount * 25) + (painPointsCount * 15)),
    geoContentScore: Math.min(100, geoMatches * 20),
    structureScore: (h1Matches.length === 1 ? 40 : 0) + (hasSubheadings ? 30 : 0) + (allHeadingMatches.length >= 3 ? 30 : 0),
    imageAltPercentage,
    semanticScore: hasAboutSection && hasServices ? 100 : 50,
    voiceScore: (hasQuestionWords ? 25 : 0) + (hasFAQSection ? 35 : 0) + (questionHeadingMatches.length > 0 ? 40 : 0),
    localKeywordScore: geoMatches > 0 ? 100 : 0,
    technicalScore: (hasMetaDescription ? 25 : 0) + (hasViewport ? 25 : 0) + (hasStructuredData ? 30 : 0) + 20,
    trustScore: (hasAboutSection ? 25 : 0) + (hasContactInfo ? 20 : 0) + (hasTestimonials ? 25 : 0) + (trustMatches > 0 ? 30 : 0),
    mediaScore: imageAltPercentage,
    speedScore: (html.length < 100000 ? 25 : 0) + (hasViewport ? 25 : 0) + 50
  };
}

// AI Search Readiness Analysis
function analyzeAISearchReadiness(metrics) {
  console.log('\n🎯 Analyzing AI Search Readiness...');
  
  const factorScores = {};
  
  // Individual factor calculations with detailed logging
  factorScores.questionBasedContent = calculateFactorScore(
    metrics.questionBasedPercentage,
    { high: 20, medium: 5 },
    { high: 2.5, medium: 1.5, low: 0 },
    'questionBasedContent'
  );
  
  factorScores.scannability = calculateFactorScore(
    metrics.scannabilityScore,
    { high: 40, medium: 20 },
    { high: 2.5, medium: 1.5, low: 0.5 },
    'scannability'
  );
  
  factorScores.readabilityScore = calculateFactorScore(
    metrics.readabilityPercentage,
    { high: 50, medium: 30 },
    { high: 2.5, medium: 1.5, low: 0.5 },
    'readabilityScore'
  );
  
  factorScores.icpSpecificFAQs = calculateFactorScore(
    metrics.hasFAQsScore,
    { high: 50, medium: 25 },
    { high: 2.5, medium: 1.5, low: 0 },
    'icpSpecificFAQs'
  );
  
  factorScores.industryContent = calculateFactorScore(
    metrics.industryContentScore,
    { high: 40, medium: 20 },
    { high: 2.0, medium: 1.0, low: 0.5 },
    'industryContent'
  );
  
  factorScores.geoContent = calculateFactorScore(
    metrics.geoContentScore,
    { high: 40, medium: 20 },
    { high: 1.5, medium: 1.0, low: 0 },
    'geoContent'
  );
  
  // Sum up all factor scores
  let categoryTotal = 0;
  for (const [factorName, score] of Object.entries(factorScores)) {
    console.log(`  ${factorName}: ${score} points`);
    categoryTotal += score;
  }
  
  console.log(`🎯 AI Search Readiness total: ${categoryTotal} points`);
  return { scores: factorScores, total: categoryTotal };
}

// Content Structure Analysis
function analyzeContentStructure(metrics) {
  console.log('\n🏗️ Analyzing Content Structure...');
  
  const factorScores = {};
  
  factorScores.headingStructure = calculateFactorScore(
    metrics.structureScore,
    { high: 60, medium: 30 },
    { high: 3.0, medium: 2.0, low: 1.0 },
    'headingStructure'
  );
  
  factorScores.semanticContent = calculateFactorScore(
    metrics.semanticScore,
    { high: 75, medium: 40 },
    { high: 2.5, medium: 1.5, low: 0.5 },
    'semanticContent'
  );
  
  factorScores.imageAltText = calculateFactorScore(
    metrics.imageAltPercentage,
    { high: 70, medium: 40 },
    { high: 2.0, medium: 1.0, low: 0.5 },
    'imageAltText'
  );
  
  let categoryTotal = 0;
  for (const [factorName, score] of Object.entries(factorScores)) {
    console.log(`  ${factorName}: ${score} points`);
    categoryTotal += score;
  }
  
  console.log(`🏗️ Content Structure total: ${categoryTotal} points`);
  return { scores: factorScores, total: categoryTotal };
}

// Voice Optimization Analysis
function analyzeVoiceOptimization(metrics) {
  console.log('\n🎤 Analyzing Voice Optimization...');
  
  const factorScores = {};
  
  factorScores.conversationalContent = calculateFactorScore(
    metrics.voiceScore,
    { high: 50, medium: 25 },
    { high: 3.0, medium: 2.0, low: 1.0 },
    'conversationalContent'
  );
  
  factorScores.localKeywords = calculateFactorScore(
    metrics.localKeywordScore,
    { high: 75, medium: 25 },
    { high: 2.5, medium: 1.5, low: 0.5 },
    'localKeywords'
  );
  
  let categoryTotal = 0;
  for (const [factorName, score] of Object.entries(factorScores)) {
    console.log(`  ${factorName}: ${score} points`);
    categoryTotal += score;
  }
  
  console.log(`🎤 Voice Optimization total: ${categoryTotal} points`);
  return { scores: factorScores, total: categoryTotal };
}

// Technical Setup Analysis
function analyzeTechnicalSetup(metrics) {
  console.log('\n⚙️ Analyzing Technical Setup...');
  
  const factorScores = {};
  
  factorScores.basicTechnical = calculateFactorScore(
    metrics.technicalScore,
    { high: 60, medium: 30 },
    { high: 5.0, medium: 3.0, low: 1.5 },
    'basicTechnical'
  );
  
  let categoryTotal = 0;
  for (const [factorName, score] of Object.entries(factorScores)) {
    console.log(`  ${factorName}: ${score} points`);
    categoryTotal += score;
  }
  
  console.log(`⚙️ Technical Setup total: ${categoryTotal} points`);
  return { scores: factorScores, total: categoryTotal };
}

// Trust & Authority Analysis
function analyzeTrustAuthority(metrics) {
  console.log('\n🛡️ Analyzing Trust & Authority...');
  
  const factorScores = {};
  
  factorScores.trustSignals = calculateFactorScore(
    metrics.trustScore,
    { high: 60, medium: 30 },
    { high: 4.0, medium: 2.5, low: 1.0 },
    'trustSignals'
  );
  
  let categoryTotal = 0;
  for (const [factorName, score] of Object.entries(factorScores)) {
    console.log(`  ${factorName}: ${score} points`);
    categoryTotal += score;
  }
  
  console.log(`🛡️ Trust & Authority total: ${categoryTotal} points`);
  return { scores: factorScores, total: categoryTotal };
}

// AI Readability Analysis
function analyzeAIReadability(metrics) {
  console.log('\n👁️ Analyzing AI Readability...');
  
  const factorScores = {};
  
  factorScores.mediaOptimization = calculateFactorScore(
    metrics.mediaScore,
    { high: 70, medium: 40 },
    { high: 3.0, medium: 2.0, low: 1.0 },
    'mediaOptimization'
  );
  
  let categoryTotal = 0;
  for (const [factorName, score] of Object.entries(factorScores)) {
    console.log(`  ${factorName}: ${score} points`);
    categoryTotal += score;
  }
  
  console.log(`👁️ AI Readability total: ${categoryTotal} points`);
  return { scores: factorScores, total: categoryTotal };
}

// Speed & UX Analysis
function analyzeSpeedUX(metrics) {
  console.log('\n⚡ Analyzing Speed & UX...');
  
  const factorScores = {};
  
  factorScores.performanceBasics = calculateFactorScore(
    metrics.speedScore,
    { high: 70, medium: 40 },
    { high: 3.0, medium: 2.0, low: 1.0 },
    'performanceBasics'
  );
  
  let categoryTotal = 0;
  for (const [factorName, score] of Object.entries(factorScores)) {
    console.log(`  ${factorName}: ${score} points`);
    categoryTotal += score;
  }
  
  console.log(`⚡ Speed & UX total: ${categoryTotal} points`);
  return { scores: factorScores, total: categoryTotal };
}

// Replace the final scoring calculation in performDetailedAnalysis function
function performDetailedAnalysis(websiteData) {
  console.log('\n🚀 Starting detailed analysis with fixed aggregation...');
  console.log('🌐 URL:', websiteData.url);
  
  const { html, url } = websiteData;
  const content = extractTextContent(html);
  const industry = detectIndustry(websiteData);
  
  console.log('🏭 Detected industry:', industry.name);
  
  const metrics = analyzePageMetrics(html, content, industry, url);
  
  // Get analysis results with totals
  const analysisResults = {
    aiSearchReadiness: analyzeAISearchReadiness(metrics),
    contentStructure: analyzeContentStructure(metrics),
    voiceOptimization: analyzeVoiceOptimization(metrics),
    technicalSetup: analyzeTechnicalSetup(metrics),
    trustAuthority: analyzeTrustAuthority(metrics),
    aiReadability: analyzeAIReadability(metrics),
    speedUX: analyzeSpeedUX(metrics)
  };
  
  // Calculate final scores using the totals with percentage conversion
  console.log('\n🧮 Calculating final scores with percentage conversion...');
  const categoryScores = {};
  let totalWeightedScore = 0;
  
  // Define maximum possible scores for each category (based on factor max points)
  const maxScores = {
    aiSearchReadiness: 13.0,  // 2.5+2.5+2.5+2.5+2.0+1.5
    contentStructure: 7.5,    // 3.0+2.5+2.0
    voiceOptimization: 5.5,   // 3.0+2.5
    technicalSetup: 5.0,      // 5.0
    trustAuthority: 4.0,      // 4.0
    aiReadability: 3.0,       // 3.0
    speedUX: 3.0             // 3.0
  };
  
  // Calculate maximum possible weighted score
  let maxWeightedScore = 0;
  for (const [category, maxScore] of Object.entries(maxScores)) {
    const weight = CATEGORY_WEIGHTS[category];
    maxWeightedScore += maxScore * weight;
  }
  
  console.log('📊 Maximum possible weighted score:', maxWeightedScore);
  
  for (const [category, result] of Object.entries(analysisResults)) {
    const categoryScore = result.total;
    categoryScores[category] = Math.round(categoryScore * 10) / 10;
    
    const weight = CATEGORY_WEIGHTS[category];
    const weightedScore = categoryScore * weight;
    totalWeightedScore += weightedScore;
    
    console.log(`📊 ${category}: ${categoryScore} points (weighted: ${weightedScore.toFixed(2)})`);
  }
  
  // Convert to percentage (0-100 scale)
  const percentageScore = Math.round((totalWeightedScore / maxWeightedScore) * 100);
  categoryScores.total = Math.max(0, Math.min(100, percentageScore)); // Ensure it's between 0-100
  
  console.log('\n✅ Final category scores:', categoryScores);
  console.log('🎯 Total weighted score:', totalWeightedScore.toFixed(2));
  console.log('🎯 Percentage score:', categoryScores.total);
  
  // Generate recommendations
  const recommendations = generateRecommendations(analysisResults, categoryScores, industry);
  
  return {
    url,
    industry,
    scores: categoryScores,
    analysis: analysisResults,
    recommendations,
    metrics,
    analyzedAt: new Date().toISOString()
  };
}

function generateRecommendations(analysis, scores, industry) {
  const recommendations = [];
  
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

// Keep existing AI testing route and helper functions
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
