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

// Simplified scoring parameters for debugging
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

// Industry detection (simplified for debugging)
function detectIndustry(websiteData) {
  const { html, url } = websiteData;
  const content = html.toLowerCase();
  
  console.log('🔍 Detecting industry for:', url);
  console.log('📄 Content length:', content.length);
  
  // Default industry for debugging
  return {
    key: 'professional_services',
    name: 'Professional Services',
    keywords: ['consulting', 'advisory', 'professional services', 'expertise', 'solutions', 'strategy'],
    painPoints: ['client acquisition', 'expertise demonstration', 'competition']
  };
}

// Calculate factor score with debugging
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

// Extract basic metrics with extensive logging
function analyzePageMetrics(html, content, industry, url) {
  console.log('\n🔬 Starting page metrics analysis...');
  console.log('📄 HTML length:', html.length);
  console.log('📝 Content length:', content.length);
  
  // Basic content analysis
  const words = content.split(/\s+/).filter(word => word.length > 0);
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  console.log('📊 Basic stats:', { wordCount: words.length, sentenceCount: sentences.length });
  
  // Image analysis
  const imageMatches = html.match(/<img[^>]*>/gi) || [];
  const altMatches = html.match(/<img[^>]+alt\s*=\s*["'][^"']*["'][^>]*>/gi) || [];
  console.log('🖼️  Images:', { total: imageMatches.length, withAlt: altMatches.length });
  
  // Heading analysis
  const h1Matches = html.match(/<h1[^>]*>/gi) || [];
  const allHeadingMatches = html.match(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi) || [];
  const questionHeadingMatches = allHeadingMatches.filter(h => h.includes('?'));
  console.log('📰 Headings:', { 
    h1Count: h1Matches.length, 
    totalHeadings: allHeadingMatches.length,
    questionHeadings: questionHeadingMatches.length 
  });
  
  // List elements for scannability
  const listMatches = html.match(/<(ul|ol|li|table|tr|td)[^>]*>/gi) || [];
  console.log('📋 List elements:', listMatches.length);
  
  // FAQ detection
  const hasFAQ = /faq|frequently.asked|questions/i.test(html);
  const hasIndustryTerms = industry.keywords.some(term => content.toLowerCase().includes(term));
  console.log('❓ FAQ analysis:', { hasFAQ, hasIndustryTerms });
  
  // Calculate percentages
  const questionBasedPercentage = allHeadingMatches.length > 0 ? 
    (questionHeadingMatches.length / allHeadingMatches.length) * 100 : 0;
  
  const imageAltPercentage = imageMatches.length > 0 ? 
    (altMatches.length / imageMatches.length) * 100 : 100; // If no images, consider it perfect
  
  const scannabilityPercentage = listMatches.length >= 10 ? 100 : (listMatches.length / 10) * 100;
  
  // Simple readability score
  const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : 0;
  const readabilityPercentage = avgWordsPerSentence > 0 ? 
    Math.max(0, Math.min(100, 100 - Math.abs(avgWordsPerSentence - 15) * 2)) : 0;
  
  console.log('📈 Calculated percentages:', {
    questionBasedPercentage: questionBasedPercentage.toFixed(1),
    imageAltPercentage: imageAltPercentage.toFixed(1),
    scannabilityPercentage: scannabilityPercentage.toFixed(1),
    readabilityPercentage: readabilityPercentage.toFixed(1),
    avgWordsPerSentence: avgWordsPerSentence.toFixed(1)
  });
  
  return {
    // AI Search Readiness
    questionBasedPercentage,
    scannabilityPercentage,
    readabilityPercentage,
    hasFAQs: hasFAQ && hasIndustryTerms ? 100 : 0,
    
    // Content Structure
    hasProperHeadings: (h1Matches.length === 1 && allHeadingMatches.length >= 3) ? 100 : 0,
    imageAltPercentage,
    
    // Basic scores for other categories (simplified for debugging)
    basicTechnicalScore: html.includes('sitemap') ? 100 : 50,
    basicTrustScore: content.includes('about') || content.includes('team') ? 100 : 0,
    basicSpeedScore: html.length < 100000 ? 100 : 50
  };
}

// Simplified analysis functions for debugging
function analyzeAISearchReadiness(metrics) {
  console.log('\n🎯 Analyzing AI Search Readiness...');
  
  const scores = {
    questionBasedContent: calculateFactorScore(
      metrics.questionBasedPercentage,
      { high: 50, medium: 25 },
      { high: 2.5, medium: 1.5, low: 0 },
      'questionBasedContent'
    ),
    scannability: calculateFactorScore(
      metrics.scannabilityPercentage,
      { high: 50, medium: 25 },
      { high: 2.5, medium: 1.5, low: 0 },
      'scannability'
    ),
    readabilityScore: calculateFactorScore(
      metrics.readabilityPercentage,
      { high: 60, medium: 40 },
      { high: 2.5, medium: 1.5, low: 0 },
      'readabilityScore'
    ),
    icpSpecificFAQs: calculateFactorScore(
      metrics.hasFAQs,
      { high: 50 },
      { high: 2.5, low: 0 },
      'icpSpecificFAQs'
    )
  };
  
  console.log('🎯 AI Search Readiness scores:', scores);
  return scores;
}

function analyzeContentStructure(metrics) {
  console.log('\n🏗️  Analyzing Content Structure...');
  
  const scores = {
    headingStructure: calculateFactorScore(
      metrics.hasProperHeadings,
      { high: 80 },
      { high: 2.0, low: 0 },
      'headingStructure'
    ),
    imageAltText: calculateFactorScore(
      metrics.imageAltPercentage,
      { high: 80, medium: 50 },
      { high: 2.0, medium: 1.0, low: 0 },
      'imageAltText'
    )
  };
  
  console.log('🏗️  Content Structure scores:', scores);
  return scores;
}

function analyzeVoiceOptimization(metrics) {
  console.log('\n🎤 Analyzing Voice Optimization...');
  
  const scores = {
    basicVoiceScore: calculateFactorScore(
      metrics.readabilityPercentage,
      { high: 50 },
      { high: 2.5, low: 0 },
      'basicVoiceScore'
    )
  };
  
  console.log('🎤 Voice Optimization scores:', scores);
  return scores;
}

function analyzeTechnicalSetup(metrics) {
  console.log('\n⚙️ Analyzing Technical Setup...');
  
  const scores = {
    basicTechnical: calculateFactorScore(
      metrics.basicTechnicalScore,
      { high: 75 },
      { high: 3.5, low: 0 },
      'basicTechnical'
    )
  };
  
  console.log('⚙️ Technical Setup scores:', scores);
  return scores;
}

function analyzeTrustAuthority(metrics) {
  console.log('\n🛡️ Analyzing Trust & Authority...');
  
  const scores = {
    basicTrust: calculateFactorScore(
      metrics.basicTrustScore,
      { high: 50 },
      { high: 2.5, low: 0 },
      'basicTrust'
    )
  };
  
  console.log('🛡️ Trust & Authority scores:', scores);
  return scores;
}

function analyzeAIReadability(metrics) {
  console.log('\n👁️ Analyzing AI Readability...');
  
  const scores = {
    imageAltText: calculateFactorScore(
      metrics.imageAltPercentage,
      { high: 80 },
      { high: 3.5, low: 0 },
      'imageAltText'
    )
  };
  
  console.log('👁️ AI Readability scores:', scores);
  return scores;
}

function analyzeSpeedUX(metrics) {
  console.log('\n⚡ Analyzing Speed & UX...');
  
  const scores = {
    basicSpeed: calculateFactorScore(
      metrics.basicSpeedScore,
      { high: 75 },
      { high: 2.5, low: 0 },
      'basicSpeed'
    )
  };
  
  console.log('⚡ Speed & UX scores:', scores);
  return scores;
}

// Calculate total scores with debugging
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
    
    scores[category] = Math.round(categoryScore * 10) / 10; // Round to 1 decimal
    const categoryWeight = SCORING_PARAMETERS.weights[category];
    totalWeightedScore += categoryScore * categoryWeight;
    
    console.log(`📊 ${category}: ${categoryScore} points (weighted: ${(categoryScore * categoryWeight).toFixed(2)})`);
  }
  
  scores.total = Math.round(totalWeightedScore * 10) / 10;
  console.log('🎯 Total weighted score:', scores.total);
  
  return scores;
}

// Main analysis function with debugging
function performDetailedAnalysis(websiteData) {
  console.log('\n🚀 Starting detailed analysis...');
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
    metrics, // Include raw metrics for debugging
    recommendations: generateBasicRecommendations(analysis, scores),
    url,
    analyzedAt: new Date().toISOString()
  };
}

function generateBasicRecommendations(analysis, scores) {
  const recommendations = [];
  
  if (scores.aiSearchReadiness < 5) {
    recommendations.push({
      title: 'Improve Question-Based Content',
      description: 'Add more FAQ-style headings with questions to improve AI citation rates.',
      impact: 'High',
      category: 'AI Search Readiness'
    });
  }
  
  if (scores.contentStructure < 3) {
    recommendations.push({
      title: 'Fix Heading Structure',
      description: 'Use proper H1-H6 hierarchy and add alt text to images.',
      impact: 'Medium',
      category: 'Content Structure'
    });
  }
  
  return recommendations;
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

// Keep existing AI testing functions (simplified for space)
async function testAIVisibility(url, industry, queries) {
  const domain = new URL(url).hostname;
  const companyName = extractCompanyName(domain);
  
  const results = {
    overall: { mentionRate: 0, recommendationRate: 0, citationRate: 0 },
    assistants: {},
    testedQueries: queries.length
  };

  // Simplified for debugging - just return mock data
  results.assistants.openai = {
    name: 'openai',
    tested: false,
    reason: 'Simplified for debugging'
  };

  return results;
}

function extractCompanyName(domain) {
  return domain.replace(/^www\./, '').split('.')[0]
    .replace(/[-_]/g, ' ')
    .replace(/\b(inc|llc|corp|ltd)\b/gi, '')
    .trim();
}

module.exports = router;
