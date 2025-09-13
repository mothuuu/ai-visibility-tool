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

// Analyze website endpoint
router.post('/analyze-website', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Fetch website content
    const websiteData = await fetchWebsiteContent(url);
    
    // Perform technical analysis
    const technicalAnalysis = performTechnicalAnalysis(websiteData);
    
    res.json({
      success: true,
      data: {
        ...technicalAnalysis,
        url: url,
        analyzedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Website analysis failed:', error);
    res.status(500).json({
      error: 'Website analysis failed',
      message: error.message
    });
  }
});

// AI assistant testing endpoint
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

// Helper functions
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

function performTechnicalAnalysis(websiteData) {
  const { html, url } = websiteData;
  
  return {
    hasSSL: url.startsWith('https://'),
    hasTitle: html.includes('<title>'),
    hasMetaDescription: html.includes('name="description"'),
    hasHeadings: html.includes('<h1>') || html.includes('<h2>'),
    hasStructuredData: html.includes('application/ld+json') || html.includes('itemscope'),
    hasFAQ: /faq|frequently.asked|questions/i.test(html),
    mobileOptimized: html.includes('viewport'),
    contentLength: html.length,
    estimatedLoadTime: html.length > 500000 ? 'Slow' : 'Fast'
  };
}

async function testAIVisibility(url, industry, queries) {
  const domain = new URL(url).hostname;
  const companyName = extractCompanyName(domain);
  
  const results = {
    overall: { mentionRate: 0, recommendationRate: 0, citationRate: 0 },
    assistants: {},
    testedQueries: queries.length
  };

  // Test each AI assistant
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

  // Calculate overall metrics
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

      // Rate limiting delay
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

  // Extract response text based on assistant
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