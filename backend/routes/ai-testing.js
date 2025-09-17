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

// Detailed scoring parameters based on your specification
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
      // 1.a) Direct Answer Structure
      questionBasedContent: { maxPoints: 2.5, weight: 0.125 },
      scannability: { maxPoints: 2.5, weight: 0.125 },
      readabilityScore: { maxPoints: 2.5, weight: 0.125 },
      icpSpecificFAQs: { maxPoints: 2.5, weight: 0.125 },
      
      // 1.b) Topical Depth and Clusters
      pillarPages: { maxPoints: 2.5, weight: 0.125 },
      subtopicCoverage: { maxPoints: 2.5, weight: 0.125 },
      icpSpecificDepth: { maxPoints: 2.5, weight: 0.125 },
      geoSpecificContent: { maxPoints: 2.5, weight: 0.125 }
    },
    
    contentStructure: {
      // 2.a) Semantic HTML and Content Hierarchy
      headingStructure: { maxPoints: 2.0, weight: 0.20 },
      semanticTags: { maxPoints: 2.0, weight: 0.20 },
      accessibilityScore: { maxPoints: 2.0, weight: 0.20 },
      icpSpecificSemantics: { maxPoints: 2.0, weight: 0.20 },
      geoSpecificMetadata: { maxPoints: 2.0, weight: 0.20 }
    },
    
    voiceOptimization: {
      // 3.a) Conversational Keyword Optimization
      longTailKeywords: { maxPoints: 2.5, weight: 0.25 },
      localIntentKeywords: { maxPoints: 2.5, weight: 0.25 },
      icpSpecificKeywords: { maxPoints: 2.5, weight: 0.25 },
      featuredSnippetEligibility: { maxPoints: 2.5, weight: 0.25 }
    },
    
    technicalSetup: {
      // 4.a) AI Crawler Allowance
      robotsTxtPermissions: { maxPoints: 3.5, weight: 0.175 },
      noBlanketsDisallow: { maxPoints: 3.5, weight: 0.175 },
      
      // 4.b) Noindex/Nosnippet Avoidance
      noIndexTags: { maxPoints: 3.5, weight: 0.175 },
      noSnippetTags: { maxPoints: 3.5, weight: 0.175 },
      
      // 4.c) Server-Side Rendering
      staticHTMLContent: { maxPoints: 3.5, weight: 0.175 },
      
      // 4.d) XML Sitemap
      sitemapPresence: { maxPoints: 3.5, weight: 0.175 },
      
      // 4.e) Schema Markup
      schemaImplementation: { maxPoints: 3.0, weight: 0.15 }
    },
    
    trustAuthority: {
      // 5.a) E-E-A-T Signals
      authorBios: { maxPoints: 2.5, weight: 0.125 },
      clientReviews: { maxPoints: 2.5, weight: 0.125 },
      icpCredentials: { maxPoints: 2.5, weight: 0.125 },
      localTrustSignals: { maxPoints: 2.5, weight: 0.125 },
      
      // 5.b) Backlink and Citation Profile
      domainAuthority: { maxPoints: 2.5, weight: 0.125 },
      qualityBacklinks: { maxPoints: 2.5, weight: 0.125 },
      icpBacklinks: { maxPoints: 2.5, weight: 0.125 },
      localCitations: { maxPoints: 2.5, weight: 0.125 }
    },
    
    aiReadability: {
      // 6.a) Multimodal Content Optimization
      imageAltText: { maxPoints: 3.5, weight: 0.35 },
      videoCaptions: { maxPoints: 3.5, weight: 0.35 },
      icpSpecificMedia: { maxPoints: 3.0, weight: 0.30 }
    },
    
    speedUX: {
      // 7.a) Site Performance (Core Web Vitals)
      largestContentfulPaint: { maxPoints: 2.5, weight: 0.25 },
      cumulativeLayoutShift: { maxPoints: 2.5, weight: 0.25 },
      interactionToNextPaint: { maxPoints: 2.5, weight: 0.25 },
      mobilePerformance: { maxPoints: 2.5, weight: 0.25 }
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

// Enhanced website analysis with detailed parameters
function performDetailedAnalysis(websiteData) {
  const { html, url } = websiteData;
  const content = extractTextContent(html);
  const doc = parseHTML(html);
  const industry = detectIndustry(websiteData);
  
  const analysis = {
    aiSearchReadiness: analyzeAISearchReadiness(html, content, doc, industry),
    contentStructure: analyzeContentStructure(html, content, doc, industry),
    voiceOptimization: analyzeVoiceOptimization(html, content, doc, industry),
    technicalSetup: analyzeTechnicalSetup(html, url, doc),
    trustAuthority: analyzeTrustAuthority(html, content, doc, url),
    aiReadability: analyzeAIReadability(html, content, doc),
    speedUX: analyzeSpeedUX(html, doc, url)
  };
  
  const scores = calculateDetailedScores(analysis);
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

// 1. AI Search Readiness Analysis
function analyzeAISearchReadiness(html, content, doc, industry) {
  const analysis = {};
  
  // 1.a) Direct Answer Structure
  const questionHeadings = (html.match(/h[1-6][^>]*>.*?\?.*?<\/h[1-6]>/gi) || []).length;
  const totalHeadings = (html.match(/<h[1-6][^>]*>/gi) || []).length;
  analysis.questionBasedContent = totalHeadings > 0 ? (questionHeadings / totalHeadings) >= 0.5 : false;
  
  // Scannability - lists and tables
  const listCount = (html.match(/<(ul|ol|li|table|tr|td)[^>]*>/gi) || []).length;
  analysis.scannability = listCount >= 10; // At least 10 list/table elements
  
  // Readability Score (simplified Flesch approximation)
  const sentences = content.split(/[.!?]+/).length;
  const words = content.split(/\s+/).length;
  const avgWordsPerSentence = sentences > 0 ? words / sentences : 0;
  analysis.readabilityScore = avgWordsPerSentence < 20 && avgWordsPerSentence > 8; // Sweet spot for readability
  
  // ICP-specific FAQs
  const hasFAQ = /faq|frequently.asked|questions/i.test(html);
  const hasICPTerms = industry.painPoints.some(term => content.toLowerCase().includes(term));
  analysis.icpSpecificFAQs = hasFAQ && hasICPTerms;
  
  // 1.b) Topical Depth and Clusters
  const pillarIndicators = ['guide', 'complete', 'ultimate', 'comprehensive', 'everything about'];
  analysis.pillarPages = pillarIndicators.some(indicator => content.toLowerCase().includes(indicator));
  
  // Subtopic coverage (internal links)
  const internalLinks = (html.match(/<a[^>]+href=['"](\/[^'"]*|[^'"]*\.[^'"]*)['"]/gi) || []).length;
  analysis.subtopicCoverage = internalLinks >= 5;
  
  // ICP-specific depth
  const industryTermCount = industry.keywords.filter(keyword => 
    content.toLowerCase().includes(keyword.toLowerCase())
  ).length;
  analysis.icpSpecificDepth = industryTermCount >= 3;
  
  // Geo-specific content
  const geoTerms = ['ontario', 'toronto', 'vancouver', 'canada', 'local', 'region', 'area', 'near me'];
  analysis.geoSpecificContent = geoTerms.some(term => content.toLowerCase().includes(term));
  
  return analysis;
}

// 2. Content Structure Analysis
function analyzeContentStructure(html, content, doc, industry) {
  const analysis = {};
  
  // Heading structure
  const h1Count = (html.match(/<h1[^>]*>/gi) || []).length;
  const hasProperH1 = h1Count === 1;
  const hasNestedHeadings = (html.match(/<h[2-6][^>]*>/gi) || []).length >= 3;
  analysis.headingStructure = hasProperH1 && hasNestedHeadings;
  
  // Semantic tags
  const semanticTags = (html.match(/<(article|section|aside|nav|main|header|footer)[^>]*>/gi) || []).length;
  analysis.semanticTags = semanticTags >= 3;
  
  // Accessibility (simplified)
  const altImages = (html.match(/<img[^>]+alt=[^>]*>/gi) || []).length;
  const totalImages = (html.match(/<img[^>]*>/gi) || []).length;
  const ariaLabels = (html.match(/aria-label|aria-labelledby/gi) || []).length;
  analysis.accessibilityScore = (totalImages === 0 || altImages / totalImages >= 0.8) && ariaLabels >= 2;
  
  // ICP-specific semantics
  const headingText = (html.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi) || []).join(' ').toLowerCase();
  const hasICPHeadings = industry.keywords.some(keyword => headingText.includes(keyword.toLowerCase()));
  analysis.icpSpecificSemantics = hasICPHeadings;
  
  // Geo-specific metadata
  const metaDescription = html.match(/<meta[^>]+name=['"]*description['"]*[^>]+content=['"]*([^'"]*)['"]/i);
  const hasGeoMeta = metaDescription && /ontario|toronto|canada|local|region/i.test(metaDescription[1]);
  analysis.geoSpecificMetadata = hasGeoMeta;
  
  return analysis;
}

// 3. Voice Optimization Analysis
function analyzeVoiceOptimization(html, content, doc, industry) {
  const analysis = {};
  
  // Long-tail keywords (4+ words)
  const longTailMatches = content.match(/\b(\w+\s+){3,}\w+/g) || [];
  const questionPhrases = content.match(/(how to|what is|why|when|where|best way to)\s+[\w\s]{10,}/gi) || [];
  analysis.longTailKeywords = (longTailMatches.length + questionPhrases.length) >= 20;
  
  // Local intent keywords
  const localTerms = ['near me', 'in toronto', 'ontario', 'local', 'nearby', 'area', 'region', 'around me'];
  analysis.localIntentKeywords = localTerms.some(term => content.toLowerCase().includes(term));
  
  // ICP-specific keywords
  analysis.icpSpecificKeywords = industry.keywords.some(keyword => content.toLowerCase().includes(keyword));
  
  // Featured snippet eligibility
  const shortAnswers = content.match(/[.!?]\s*[A-Z][^.!?]{50,200}[.!?]/g) || [];
  analysis.featuredSnippetEligibility = shortAnswers.length >= 5;
  
  return analysis;
}

// 4. Technical Setup Analysis
function analyzeTechnicalSetup(html, url, doc) {
  const analysis = {};
  
  // 4.a) AI Crawler Allowance (simplified - would need server-side robots.txt check)
  analysis.robotsTxtPermissions = true; // Assume allowed unless detected otherwise
  analysis.noBlanketsDisallow = true;
  
  // 4.b) Noindex/Nosnippet Avoidance
  const robotsMeta = html.match(/<meta[^>]+name=['"]*robots['"]*[^>]+content=['"]*([^'"]*)['"]/i);
  analysis.noIndexTags = !robotsMeta || !robotsMeta[1].includes('noindex');
  analysis.noSnippetTags = !robotsMeta || !robotsMeta[1].includes('nosnippet');
  
  // 4.c) Server-Side Rendering
  const scriptTags = (html.match(/<script[^>]*>/gi) || []).length;
  const contentLength = html.replace(/<[^>]*>/g, '').length;
  analysis.staticHTMLContent = contentLength > 1000 && scriptTags < 15;
  
  // 4.d) XML Sitemap (would need server check)
  analysis.sitemapPresence = html.includes('sitemap') || url.includes('sitemap');
  
  // 4.e) Schema Markup Implementation
  const jsonLD = html.includes('application/ld+json');
  const microdata = html.includes('itemscope') || html.includes('itemtype');
  analysis.schemaImplementation = jsonLD || microdata;
  
  return analysis;
}

// 5. Trust & Authority Analysis
function analyzeTrustAuthority(html, content, doc, url) {
  const analysis = {};
  
  // 5.a) E-E-A-T Signals
  const authorTerms = ['author', 'bio', 'about', 'team', 'expert', 'founder', 'ceo', 'director'];
  analysis.authorBios = authorTerms.some(term => content.toLowerCase().includes(term));
  
  const testimonialTerms = ['testimonial', 'review', 'customer', 'client says', 'feedback', 'rating'];
  analysis.clientReviews = testimonialTerms.some(term => content.toLowerCase().includes(term));
  
  const credentialTerms = ['certified', 'certification', 'qualified', 'expert', 'professional', 'licensed', 'accredited'];
  analysis.icpCredentials = credentialTerms.some(term => content.toLowerCase().includes(term));
  
  const trustTerms = ['chamber of commerce', 'bbb', 'member', 'association', 'award', 'recognition'];
  analysis.localTrustSignals = trustTerms.some(term => content.toLowerCase().includes(term));
  
  // 5.b) Backlink Profile (simplified indicators)
  const domain = new URL(url).hostname;
  const domainAge = content.includes('since') || content.includes('founded') || content.includes('established');
  analysis.domainAuthority = domainAge || domain.length < 15; // Shorter domains often indicate maturity
  
  const partnershipTerms = ['partnership', 'partner', 'collaboration', 'featured in', 'as seen in'];
  analysis.qualityBacklinks = partnershipTerms.some(term => content.toLowerCase().includes(term));
  
  analysis.icpBacklinks = content.includes('industry') || content.includes('sector') || content.includes('network');
  analysis.localCitations = content.includes('directory') || content.includes('listed') || content.includes('featured');
  
  return analysis;
}

// 6. AI Readability Analysis
function analyzeAIReadability(html, content, doc) {
  const analysis = {};
  
  // Image alt text
  const images = (html.match(/<img[^>]*>/gi) || []);
  const imagesWithAlt = (html.match(/<img[^>]+alt=[^>]*>/gi) || []);
  analysis.imageAltText = images.length === 0 || (imagesWithAlt.length / images.length) >= 0.8;
  
  // Video captions (simplified detection)
  const videos = (html.match(/<video[^>]*>/gi) || []).length;
  const captionIndicators = html.includes('captions') || html.includes('transcript') || html.includes('subtitles');
  analysis.videoCaptions = videos === 0 || captionIndicators;
  
  // ICP-specific media
  const mediaTerms = ['diagram', 'chart', 'infographic', 'screenshot', 'demo', 'example'];
  analysis.icpSpecificMedia = mediaTerms.some(term => content.toLowerCase().includes(term));
  
  return analysis;
}

// 7. Speed & UX Analysis
function analyzeSpeedUX(html, doc, url) {
  const analysis = {};
  
  // Performance approximations (would need real performance APIs for accuracy)
  const imageCount = (html.match(/<img[^>]*>/gi) || []).length;
  const scriptCount = (html.match(/<script[^>]*>/gi) || []).length;
  const styleCount = (html.match(/<style[^>]*>|<link[^>]+stylesheet/gi) || []).length;
  const htmlSize = html.length;
  
  // LCP approximation
  analysis.largestContentfulPaint = imageCount < 20 && htmlSize < 500000;
  
  // CLS approximation
  const hasFixedSizing = (html.match(/<img[^>]+width[^>]+height/gi) || []).length >= imageCount * 0.8;
  analysis.cumulativeLayoutShift = hasFixedSizing || imageCount < 10;
  
  // INP approximation
  analysis.interactionToNextPaint = scriptCount < 10;
  
  // Mobile performance
  const hasViewport = html.includes('name="viewport"');
  const hasResponsive = html.includes('responsive') || html.includes('mobile') || html.includes('@media');
  analysis.mobilePerformance = hasViewport && (hasResponsive || true);
  
  return analysis;
}

// Calculate scores using your detailed parameters
function calculateDetailedScores(analysis) {
  const scores = {};
  let totalWeightedScore = 0;
  
  for (const [category, factors] of Object.entries(SCORING_PARAMETERS.factors)) {
    let categoryScore = 0;
    const categoryAnalysis = analysis[category];
    
    for (const [factorName, factorConfig] of Object.entries(factors)) {
      if (categoryAnalysis && categoryAnalysis[factorName] === true) {
        categoryScore += factorConfig.maxPoints;
      }
    }
    
    scores[category] = Math.round(categoryScore);
    const categoryWeight = SCORING_PARAMETERS.weights[category];
    totalWeightedScore += categoryScore * categoryWeight;
  }
  
  scores.total = Math.round(totalWeightedScore);
  return scores;
}

// Generate detailed recommendations based on your parameters
function generateDetailedRecommendations(analysis, industry) {
  const recommendations = [];
  
  // AI Search Readiness recommendations
  if (!analysis.aiSearchReadiness.questionBasedContent) {
    recommendations.push({
      title: 'Add Question-Based Content Structure',
      description: `Create FAQ-style content with question headings like "What is ${industry.name} best practice?" to improve AI citation rates.`,
      impact: 'High',
      category: 'AI Search Readiness',
      quickWin: `Add 5+ FAQ questions addressing ${industry.painPoints.slice(0,2).join(' and ')} concerns.`
    });
  }
  
  if (!analysis.aiSearchReadiness.icpSpecificFAQs) {
    recommendations.push({
      title: 'Create ICP-Specific FAQ Content',
      description: `Build FAQs targeting ${industry.name} pain points like ${industry.painPoints.slice(0,3).join(', ')}.`,
      impact: 'High',
      category: 'AI Search Readiness',
      quickWin: 'Include questions customers actually ask AI assistants about your industry.'
    });
  }
  
  // Content Structure recommendations
  if (!analysis.contentStructure.headingStructure) {
    recommendations.push({
      title: 'Implement Proper Heading Hierarchy',
      description: 'Use single H1 per page with logical H2-H6 structure for better AI content understanding.',
      impact: 'Medium',
      category: 'Content Structure',
      quickWin: 'Audit headings to ensure one H1 and nested H2/H3 structure.'
    });
  }
  
  if (!analysis.contentStructure.semanticTags) {
    recommendations.push({
      title: 'Add Semantic HTML Elements',
      description: 'Use article, section, aside tags to help AI systems understand content relationships.',
      impact: 'Medium',
      category: 'Content Structure',
      quickWin: 'Wrap main content in <article> and use <section> for content blocks.'
    });
  }
  
  // Voice Optimization recommendations
  if (!analysis.voiceOptimization.longTailKeywords) {
    recommendations.push({
      title: 'Optimize for Conversational Queries',
      description: 'Include natural language phrases and questions that people ask voice assistants.',
      impact: 'High',
      category: 'Voice Optimization',
      quickWin: `Add phrases like "best ${industry.name} for..." and "how to choose ${industry.name}"`
    });
  }
  
  // Technical Setup recommendations
  if (!analysis.technicalSetup.schemaImplementation) {
    recommendations.push({
      title: 'Implement Schema Markup',
      description: 'Add structured data to help AI systems extract and understand your business information.',
      impact: 'Critical',
      category: 'Technical Setup',
      quickWin: 'Add Organization schema with business details and FAQPage schema for FAQ content.'
    });
  }
  
  // Trust & Authority recommendations
  if (!analysis.trustAuthority.authorBios) {
    recommendations.push({
      title: 'Add Expert Author Information',
      description: 'Include team bios with credentials to establish expertise and trustworthiness.',
      impact: 'Medium',
      category: 'Trust & Authority',
      quickWin: 'Create "About" or "Team" section highlighting relevant experience and qualifications.'
    });
  }
  
  // AI Readability recommendations
  if (!analysis.aiReadability.imageAltText) {
    recommendations.push({
      title: 'Add Descriptive Image Alt Text',
      description: 'Provide alt text for all images so AI vision models can understand visual content.',
      impact: 'Medium',
      category: 'AI Readability',
      quickWin: 'Add alt text describing images in context of your industry and services.'
    });
  }
  
  // Speed & UX recommendations
  if (!analysis.speedUX.largestContentfulPaint) {
    recommendations.push({
      title: 'Optimize Page Load Performance',
      description: 'Improve LCP by optimizing images and reducing resource load times.',
      impact: 'High',
      category: 'Speed & UX',
      quickWin: 'Compress images and defer non-critical JavaScript to improve load speed.'
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

// AI visibility testing endpoint (unchanged)
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

// Helper functions for fetching and AI testing (keeping existing implementations)
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

// Keep existing AI testing functions...
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
