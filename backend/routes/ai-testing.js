// backend/routes/ai-testing.js
// Express router for AI Readiness / AEO analysis (V5 rubric)

const { authenticateToken, authenticateTokenOptional } = require('../middleware/auth');
const { checkScanLimit, PLAN_LIMITS, getPlanLimits } = require('../middleware/usageLimits');
const db = require('../db/database');

/* eslint-disable no-console */
const express = require('express');
const axios = require('axios');
const router = express.Router();

// Import enhanced industries configuration
const { INDUSTRIES, KEYWORD_WEIGHTS } = require('../config/industries');

/* ================================
   DISCOVERY HELPERS (robots + sitemap + multi-page sampler)
================================ */
async function fetchText(url, timeout = 12000, headers = {}) {
  try {
    const r = await axios.get(url, {
      timeout,
      validateStatus: () => true, // keep body even on 403/404
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        ...headers
      }
    });
    const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    return { ok: r.status >= 200 && r.status < 400, status: r.status, text: body, headers: r.headers };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function parseRobots(text = '') {
  const hasBlanketDisallow = /^\s*Disallow:\s*\/\s*$/gim.test(text);
  const allowsAIBots = /User-agent:\s*(GPTBot|Claude|Anthropic|Perplexity)/i.test(text) && !hasBlanketDisallow;
  const sitemaps = (text.match(/^\s*Sitemap:\s*(.+)$/gim) || [])
    .map(l => l.split(/:\s*/i).slice(1).join(':').trim());
  return { hasBlanketDisallow, allowsAIBots, sitemaps };
}

async function fetchRobotsAndSitemaps(origin) {
  const robotsUrl = origin.replace(/\/+$/, '') + '/robots.txt';
  const robotsRes = await fetchText(robotsUrl);
  let robots = null, foundSitemaps = [];

  if (robotsRes.ok || robotsRes.text) {
    robots = parseRobots(robotsRes.text || '');
    const candidates = [
      ...(robots?.sitemaps || []),
      origin.replace(/\/+$/, '') + '/sitemap.xml',
      origin.replace(/\/+$/, '') + '/sitemap_index.xml',
      origin.replace(/\/+$/, '') + '/sitemap-index.xml'
    ];
    for (const s of [...new Set(candidates)]) {
      const r = await fetchText(s);
      if (r.text && /<(urlset|sitemapindex)\b/i.test(r.text)) foundSitemaps.push(s);
    }
  }

  return { robots, sitemapFound: foundSitemaps.length > 0, sitemaps: foundSitemaps };
}

// very light XML <loc> parser
async function extractSitemapUrls(sitemapUrl, max = 8) {
  const r = await fetchText(sitemapUrl, 12000, { Accept: 'application/xml,text/xml,*/*' });
  const xml = r.text || '';
  const isIndex = /<sitemapindex/i.test(xml);
  if (isIndex) {
    const innerMaps = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1]).slice(0, 3);
    let urls = [];
    for (const map of innerMaps) {
      const sub = await fetchText(map, 12000, { Accept: 'application/xml,text/xml,*/*' });
      const u = [...(sub.text || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1]);
      urls = urls.concat(u);
      if (urls.length >= max) break;
    }
    return urls.slice(0, max);
  }
  return [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1]).slice(0, max);
}

async function fetchMultiPageSample(startUrl, userPlan = 'free', selectedPages = []) {
  const origin = new URL(startUrl).origin;
  const discovery = await fetchRobotsAndSitemaps(origin);
  
  // FREE USERS: Homepage only
  if (userPlan === 'free' || !userPlan) {
    const r = await fetchText(startUrl);
    return { 
      combinedHtml: r.text || '', 
      discovery, 
      origin, 
      pagesFetched: 1, 
      sampledUrls: [startUrl],
      planUsed: 'free'
    };
  }
  
  // DIY USERS: Homepage + 4 user-selected pages (5 total)
  if (userPlan === 'diy') {
    const pages = [];
    const urlsToFetch = [startUrl, ...selectedPages.slice(0, 4)]; // Max 5 pages
    
    for (const u of urlsToFetch) {
      const r = await fetchText(u);
      if (r.text && r.text.length > 500) pages.push(r.text);
    }
    
    const combinedHtml = pages.join('\n<!-- PAGE SPLIT -->\n');
    return { 
      combinedHtml, 
      discovery, 
      origin, 
      pagesFetched: pages.length, 
      sampledUrls: urlsToFetch.slice(0, pages.length),
      planUsed: 'diy'
    };
  }
  
  // PRO USERS: Multi-page crawl (25 pages)
  if (userPlan === 'pro' || userPlan === 'premium') {
    const corePaths = ['/insights','/news','/blog','/press','/resources','/solutions','/services','/about','/products','/platform'];
    let sampledUrls = [startUrl];
    
    // If user provided specific pages, use those first
    if (selectedPages.length > 0) {
      sampledUrls = [startUrl, ...selectedPages.slice(0, 24)];
    } else {
      // Auto-discover pages
      sampledUrls = [startUrl, ...corePaths.map(p => origin.replace(/\/+$/, '') + p)];
      
      if (discovery.sitemapFound && discovery.sitemaps?.length) {
        try {
          const fromSitemap = await extractSitemapUrls(discovery.sitemaps[0], 20);
          sampledUrls = [...new Set(sampledUrls.concat(fromSitemap))];
        } catch { /* ignore */ }
      }
    }
    
    const pages = [];
    for (const u of sampledUrls.slice(0, 25)) { // Limit to 25 pages
      const r = await fetchText(u);
      if (r.text && r.text.length > 500) pages.push(r.text);
    }
    
    const combinedHtml = pages.join('\n<!-- PAGE SPLIT -->\n');
    return { 
      combinedHtml, 
      discovery, 
      origin, 
      pagesFetched: pages.length, 
      sampledUrls: sampledUrls.slice(0, pages.length),
      planUsed: userPlan
    };
  }
  
  // Fallback to free
  const r = await fetchText(startUrl);
  return { 
    combinedHtml: r.text || '', 
    discovery, 
    origin, 
    pagesFetched: 1, 
    sampledUrls: [startUrl],
    planUsed: 'free'
  };
}
/* ================================
   AI API CONFIGS (visibility tests)
================================ */
const AI_CONFIGS = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
  },
  perplexity: {
    endpoint: 'https://api.perplexity.ai/chat/completions',
    headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` }
  }
};

/* =======================
   V5 CATEGORY WEIGHTS
   (sum = 1.00)
======================= */
const CATEGORY_WEIGHTS = {
  aiReadabilityMultimodal: 0.10,
  aiSearchReadiness: 0.20,
  contentFreshness: 0.08,
  contentStructure: 0.15,
  speedUX: 0.05,
  technicalSetup: 0.18,
  trustAuthority: 0.12,
  voiceOptimization: 0.12
};

/* =======================
   Expanded industry catalog
======================= */

/* ================================
   INDUSTRY DETECTION FUNCTIONS
================================ */

// Enhanced keyword-based detection (improved scoring)
function detectIndustryKeywordBased(websiteData) {
  const { html, url } = websiteData;
  const content = (html || '').toLowerCase();
  const domain = new URL(url).hostname.toLowerCase();

  let best = INDUSTRIES[0];
  let bestScore = -1;
  
  for (const ind of INDUSTRIES) {
    let score = 0;
    
    // Strong keywords (3 points each)
    if (ind.strongKeywords) {
      for (const k of ind.strongKeywords) {
        if (content.includes(k.toLowerCase())) {
          score += KEYWORD_WEIGHTS.strong;
        }
      }
    }
    
    // Medium keywords (1.5 points each)
    if (ind.mediumKeywords) {
      for (const k of ind.mediumKeywords) {
        if (content.includes(k.toLowerCase())) {
          score += KEYWORD_WEIGHTS.medium;
        }
      }
    }
    
    // Weak keywords (0.5 points each)
    const weakKw = ind.weakKeywords || ind.keywords || [];
    for (const k of weakKw) {
      if (content.includes(k.toLowerCase())) {
        score += KEYWORD_WEIGHTS.weak;
      }
    }
    
    // Domain keywords (3 points each)
    if (ind.domainKeywords) {
      for (const dk of ind.domainKeywords) {
        if (domain.includes(dk)) {
          score += KEYWORD_WEIGHTS.domain;
        }
      }
    }
    
    // Context patterns (2 points each)
    if (ind.contextPatterns) {
      for (const pattern of ind.contextPatterns) {
        if (content.includes(pattern.toLowerCase())) {
          score += KEYWORD_WEIGHTS.context;
        }
      }
    }
    
    // Certifications (1.5 points each)
    if (ind.certifications) {
      for (const cert of ind.certifications) {
        if (content.includes(cert.toLowerCase())) {
          score += KEYWORD_WEIGHTS.certification;
        }
      }
    }
    
    // Pain points (0.5 points each)
    if (ind.painPoints) {
      for (const p of ind.painPoints) {
        if (content.includes(p.toLowerCase())) {
          score += KEYWORD_WEIGHTS.painPoint;
        }
      }
    }
    
    // Exclusion keywords (-2 points each)
    if (ind.excludeKeywords) {
      for (const exclude of ind.excludeKeywords) {
        if (content.includes(exclude.toLowerCase())) {
          score += KEYWORD_WEIGHTS.exclude;
        }
      }
    }
    
    // Apply priority boost (if set)
    if (ind.priority) {
      score += ind.priority * 0.1;
    }
    
    if (score > bestScore) { 
      bestScore = score; 
      best = ind; 
    }
  }
  
  return { 
    ...best, 
    detectionMethod: 'keyword', 
    confidence: bestScore > 10 ? 'high' : bestScore > 5 ? 'medium' : 'low',
    score: Math.round(bestScore * 10) / 10
  };
}

// AI-based industry detection
async function detectIndustryWithAI(websiteData, preferredAI = 'openai') {
  const { html, url } = websiteData;
  const content = extractTextContent(html).slice(0, 3000); // limit to first 3000 chars
  const domain = new URL(url).hostname;
  
  // Build industry options list for AI
  const industryOptions = INDUSTRIES.map(i => i.name).join(', ');
  
  const prompt = `Analyze this website content and classify it into ONE of these industries:

${industryOptions}

Website: ${domain}
Content preview: ${content}

Instructions:
1. Return ONLY the industry name from the list above
2. If multiple industries apply, choose the PRIMARY one
3. If uncertain, return "General B2B"
4. Response format: Just the industry name, nothing else

Industry:`;

  try {
    // Check if API key is available
    const aiKey = process.env[preferredAI.toUpperCase() + '_API_KEY'];
    if (!aiKey) {
      console.log(`No API key for ${preferredAI}, falling back to keyword detection`);
      return detectIndustryKeywordBased(websiteData);
    }

    const response = await queryAIAssistant(preferredAI, prompt);
    const detectedName = response.trim().replace(/['"]/g, '');
    
    // Find matching industry from our catalog
    const matchedIndustry = INDUSTRIES.find(i => 
      i.name.toLowerCase() === detectedName.toLowerCase() ||
      detectedName.toLowerCase().includes(i.name.toLowerCase())
    );
    
    if (matchedIndustry) {
      console.log(`AI detected industry: ${matchedIndustry.name}`);
      return { 
        ...matchedIndustry, 
        detectionMethod: 'ai',
        confidence: 'high',
        aiAssistant: preferredAI 
      };
    }
    
    // AI returned unexpected value, fall back to keywords
    console.log(`AI returned unexpected industry "${detectedName}", using keyword fallback`);
    return detectIndustryKeywordBased(websiteData);
    
  } catch (error) {
    console.error('AI industry detection failed:', error.message);
    // Fallback to keyword-based detection
    return detectIndustryKeywordBased(websiteData);
  }
}

// Hybrid approach: Use both AI and keywords
async function detectIndustryHybrid(websiteData, useAI = true) {
  if (!useAI) {
    return detectIndustryKeywordBased(websiteData);
  }
  
  // Run both in parallel
  const [aiResult, keywordResult] = await Promise.allSettled([
    detectIndustryWithAI(websiteData, 'openai'),
    Promise.resolve(detectIndustryKeywordBased(websiteData))
  ]);
  
  // Prefer AI if successful
  if (aiResult.status === 'fulfilled' && aiResult.value.detectionMethod === 'ai') {
    return aiResult.value;
  }
  
  // Otherwise use keyword-based
  return keywordResult.status === 'fulfilled' 
    ? keywordResult.value 
    : INDUSTRIES[0];
}

// Multi-AI consensus detection (optional - most accurate but uses more API calls)
async function detectIndustryMultiAI(websiteData) {
  const content = extractTextContent(websiteData.html).slice(0, 3000);
  const domain = new URL(websiteData.url).hostname;
  const industryOptions = INDUSTRIES.map(i => i.name).join(', ');
  
  const prompt = `Analyze this website and return ONLY the PRIMARY industry from this list:
${industryOptions}

Website: ${domain}
Content: ${content}

Return just the industry name:`;

  const results = [];
  
  // Query multiple AIs in parallel
  const aiPromises = ['openai', 'anthropic', 'perplexity']
    .filter(ai => process.env[ai.toUpperCase() + '_API_KEY'])
    .map(async (ai) => {
      try {
        const response = await queryAIAssistant(ai, prompt);
        const industry = INDUSTRIES.find(i => 
          response.toLowerCase().includes(i.name.toLowerCase())
        );
        return industry ? { ai, industry: industry.name, match: industry } : null;
      } catch (err) {
        console.error(`${ai} failed:`, err.message);
        return null;
      }
    });
  
  const aiResults = (await Promise.all(aiPromises)).filter(Boolean);
  
  // Find consensus (if 2+ AIs agree)
  if (aiResults.length >= 2) {
    const counts = {};
    aiResults.forEach(r => {
      counts[r.industry] = (counts[r.industry] || 0) + 1;
    });
    
    const consensus = Object.entries(counts).find(([_, count]) => count >= 2);
    if (consensus) {
      const industry = INDUSTRIES.find(i => i.name === consensus[0]);
      return { 
        ...industry, 
        detectionMethod: 'ai-consensus', 
        confidence: 'very-high',
        consensusCount: consensus[1],
        aiResponses: aiResults 
      };
    }
  }
  
  // If no consensus, use first successful AI result
  if (aiResults.length > 0) {
    return { 
      ...aiResults[0].match, 
      detectionMethod: 'ai-single', 
      confidence: 'medium',
      aiAssistant: aiResults[0].ai 
    };
  }
  
  // Fall back to keyword detection
  return detectIndustryKeywordBased(websiteData);
}

/* ================================
   Core page metrics (V5)
================================ */
function analyzePageMetrics(html, content, industry, url, discovery = {}) {
  const words = content.split(/\s+/).filter(Boolean);
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);

  // --- multimedia
  const imgs = html.match(/<img[^>]*>/gi) || [];
  const altMatches = (html.match(/<img[^>]*\salt\s*=\s*("[^"]*"|'[^']*'|[^ >]+)[^>]*>/gi) || []);
  const imageAltPercentage = imgs.length ? (new Set(altMatches).size / imgs.length) * 100 : 100;

  const vids = html.match(/<video[^>]*>/gi) || [];
  const auds = html.match(/<audio[^>]*>/gi) || [];
  const totalAv = vids.length + auds.length;
  const trackCaps = html.match(/<track[^>]+kind\s*=\s*["']captions["'][^>]*>/gi) || [];
  const transcriptHint = /transcript|subtitles|captions/i.test(content);
  const captionPercentage = totalAv ? ((trackCaps.length + (transcriptHint ? 1 : 0)) / totalAv) * 100 : 0;

  const interactiveMedia = html.match(/<(canvas|svg|iframe|embed|object)[^>]*>/gi) || [];
  const accessibleInteractive = html.match(/aria-label|aria-labelledby|role=/gi) || [];
  const interactiveAccessibility = interactiveMedia.length ? (accessibleInteractive.length / interactiveMedia.length) * 100 : 100;

  const mediaRefCount =
    (content.match(/\b(image|photo|picture|diagram|chart|graphic)\b/gi) || []).length +
    (content.match(/\b(video|watch|tutorial|webinar|recording)\b/gi) || []).length;
  let crossMediaScore = 0;
  if (imgs.length + vids.length > 0) {
    crossMediaScore = Math.min(100, 20 + mediaRefCount * 8 + (imgs.length ? 15 : 0) + (vids.length ? 15 : 0));
  } else if (mediaRefCount > 0) crossMediaScore = 25;

  // --- search readiness
  const h1s = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi) || [];
  const h2h3 = html.match(/<h[23][^>]*>[\s\S]*?<\/h[23]>/gi) || [];
  const qWords = /\b(what|how|why|when|where|which|who)\b/i;
  const questionHeads = h2h3.filter(h => qWords.test(h.replace(/<[^>]+>/g,' ')) || /\?/.test(h));
  const questionBasedPercentage = h2h3.length ? (questionHeads.length / h2h3.length) * 100 : 0;

  const lists = html.match(/<(ul|ol)[^>]*>/gi) || [];
  const tables = html.match(/<table[^>]*>/gi) || [];
  const hasSteps = /(?:^|\s)(step\s*\d|steps:|procedure|process|how to)(?=\s|$)/gi.test(content);
  const scannabilityScore = Math.min(100, lists.length * 15 + tables.length * 20 + (hasSteps ? 25 : 0));

  const avgWordsPerSentence = sentences.length ? words.length / sentences.length : 15;
  const syllables = estimateSyllables(words);
  const asw = words.length ? (syllables / words.length) : 1.4;
  const flesch = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * asw);
  const readabilityPercentage = Math.max(0, Math.min(100, Number.isFinite(flesch) ? flesch : 0));

  const hasFAQSection = /(?:^|[^a-z])(faq|frequently\s*asked|q&a)(?:[^a-z]|$)/i.test(html);
  const industryQs = (industry.painPoints || []).filter(p => new RegExp(`\\b(what|how|why|when)\\b[\\s\\S]{0,40}${escapeRegex(p)}`, 'i').test(content)).length;
  const icpFAQScore = hasFAQSection ? 80 + Math.min(20, industryQs * 10) : Math.min(50, industryQs * 15);

  const snippetAnswers = findSnippetAnswers(content);
  const snippetScore = Math.min(100, snippetAnswers.length * 25);

  const pillarInd = /complete\s*guide|ultimate\s*guide|resource\s*center|hub/i.test(content);
  const internalLinks = (html.match(/<a[^>]+href\s*=\s*["'][^"']+["'][^>]*>/gi) || [])
    .filter(a => {
      const href = a.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] || '';
      if (!href || href.startsWith('#')) return false;
      return !/^https?:\/\//i.test(href) || href.includes(new URL(url).hostname);
    }).length;
  const pillarScore = pillarInd ? 60 + Math.min(40, Math.floor(internalLinks / 5) * 10) : Math.min(30, Math.floor(internalLinks / 3) * 10);

  const painHits = (industry.painPoints || []).filter(p => content.includes(p.toLowerCase())).length;
  const painPointsScore = Math.min(100, (painHits / Math.max(1, (industry.painPoints||[]).length)) * 100);

  // --- Geo content & meta (generalized)
  const phoneRe = /\+?\d[\d\s().-]{7,}/;
  const addressHints = /\b(ave|avenue|st|street|rd|road|blvd|suite|ste\.|floor|fl|building|campus|parkway|drive|dr)\b/i;
  const worldCities = /\b(paris|london|new york|dallas|madrid|tel aviv|singapore|são paulo|tokyo|sydney|toronto|vancouver|bangalore|pune|mumbai|seattle|boston|chicago|miami|san jose|los angeles|berlin|munich|amsterdam|zurich)\b/i;
  const geoHits = [phoneRe,addressHints,worldCities].reduce((s,re)=> s + (re.test(content)?1:0), 0);
  const geoContentScore = Math.min(100, geoHits * 30);

  // --- freshness
  const lastUpdatedMatch = /last\s*updated|updated\s*on|modified|revised/i.test(content);
  const visibleDates = content.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/gi) || [];
  const year = new Date().getFullYear();
  const recentDates = visibleDates.filter(d => (parseInt(d.match(/\d{4}/)?.[0]||'0',10)) >= (year-1)).length;
  const lastUpdatedScore = lastUpdatedMatch ? 70 + Math.min(30, recentDates * 15) : Math.min(40, recentDates * 20);
  const versioningScore = /version|v\d|revision|changelog|release\s*notes|updates/i.test(content) ? 100 : 0;
  const timeSensitiveScore = Math.min(100, ((content.match(/\b(current|latest|2024|2025|this\s*year|recent|new|now)\b/gi) || []).length / Math.max(1, words.length)) * 1000);
  const auditScore = /reviewed|audited|verified|quality\s*checked|maintained/i.test(content) ? 100 : 0;
  const liveDataScore = Math.min(100, (content.match(/\b(live|real\s*time|dynamic|up\s*to\s*date|current\s*status)\b/gi) || []).length * 25);
  const httpFreshnessScore = /etag|last-modified/i.test(html) ? 100 : 0;
  const editorialScore = /blog\s*schedule|content\s*calendar|publishing\s*schedule|editorial/i.test(content) ? 100 : 0;

  // --- structure & entities
  const hasProperH1 = h1s.length === 1;
  const hasH2s = (html.match(/<h2[^>]*>/gi) || []).length >= 2;
  const hasH3s = (html.match(/<h3[^>]*>/gi) || []).length >= 1;
  const headingHierarchyScore = (hasProperH1?35:0) + (hasH2s?35:0) + (hasH3s?30:0);

  const anchorIds = html.match(/\sid\s*=\s*["'][^"']+["']/gi) || [];
  const tocIndicators = /table\s*of\s*contents|toc|jump\s*to|navigate/i.test(content);
  const anchorScore = Math.min(100, anchorIds.length * 10 + (tocIndicators ? 50 : 0));

  const entityCues = detectEntityCues(content, industry);
  const entityScore = Math.min(100, (entityCues.names*8) + (entityCues.products*10) + (entityCues.places*12));

  const accessibilityFeatures = html.match(/aria-|role=|tabindex|alt=/gi) || [];
  const accessibilityScore = Math.min(100, accessibilityFeatures.length * 5);

  const hasMetaDescription = /name\s*=\s*["']description["']/i.test(html);
  const geoInMeta = worldCities.test(html) || addressHints.test(html);
  const geoMetaScore = hasMetaDescription ? (geoInMeta ? 100 : 50) : 0;

  // --- speed & UX (proxies)
  const performanceMetrics = estimatePerformanceMetrics(html);

  // --- technical setup
  const robots = discovery.robots || {};
  const robotsOk = robots.hasBlanketDisallow ? false : true;
  const aiAllowed = robots.allowsAIBots === true;
  const crawlerFriendly = robotsOk && !/noindex|nofollow/i.test(html);
  const hasCDN = /cdn\.|cloudflare|cloudfront|fastly/i.test(html);

  let crawlerAccessScore = 0;
  crawlerAccessScore += crawlerFriendly ? 60 : 20;
  crawlerAccessScore += hasCDN ? 20 : 0;
  crawlerAccessScore += aiAllowed ? 20 : 0;
  crawlerAccessScore = Math.max(0, Math.min(100, crawlerAccessScore));

  const structuredDataAnalysis = analyzeStructuredData(html);
  const hasCanonical = /rel\s*=\s*["']canonical["']/i.test(html);
  const hasHreflang = /hreflang\s*=/i.test(html);
  const canonicalScore = (hasCanonical ? 70 : 0) + (hasHreflang ? 30 : 0);
  const hasOpenGraph = /property\s*=\s*["']og:/i.test(html);
  const hasTwitterCards = /(name|property)\s*=\s*["']twitter:/i.test(html);
  const socialMarkupScore = (hasOpenGraph ? 70 : 0) + (hasTwitterCards ? 30 : 0);
  const sitemapScore = discovery.sitemapFound === true ? 100 : 0;
  const rssFeedScore = /application\/(rss|atom)\+xml/i.test(html) ? 100 : 0;
  const indexNowScore = /indexnow|api\.indexnow\./i.test(html) ? 100 : 0;

  // --- trust & authority
  const authorBioAnalysis = analyzeAuthorBios(content);
  const certificationScore = Math.min(100, (content.match(/certified|licensed|accredited|iso\s*9001|iso\s*27001|member\s*of|association/gi) || []).length * 20);
  const domainAuthorityScore = estimateDomainAuthority(content, html);
  const thoughtLeadershipScore = analyzeThoughtLeadership(content).score;

  const enterpriseTrustTerms = /\b(press release|media center|newsroom|investor relations|annual report|earnings|customer (story|case study)|case studies|partners|clients|who we work with)\b/gi;
  const enterpriseTrustScore = Math.min(100, (content.match(enterpriseTrustTerms) || []).length * 20);
  const trustBadgeRaw = analyzeTrustBadges(content, html).score;
  const trustBadgeScore = Math.max(trustBadgeRaw, enterpriseTrustScore);

  // --- voice & conversational
  const conversationalPhrasesScore = analyzeConversationalContent(content).score;
  const localVoiceScore = analyzeLocalVoiceOptimization(content).score;
  const icpConversationalScore = analyzeICPConversationalTerms(content, industry).score;
  const featuredSnippetScore = analyzeFeaturedSnippetOptimization(content).score;
  const conversationContinuityScore = analyzeConversationContinuity(content).score;

  return {
    // AI Readability & Multimodal
    imageAltPercentage, videoCaptionPercentage: captionPercentage, interactiveAccessibility, crossMediaScore,
    // AI Search Readiness
    questionBasedPercentage, scannabilityScore, readabilityPercentage, icpFAQScore, snippetScore, pillarScore,
    internalLinksScore: Math.min(100, internalLinks * 5), painPointsScore, geoContentScore,
    // Freshness
    lastUpdatedScore, versioningScore, timeSensitiveScore, auditScore, liveDataScore, httpFreshnessScore, editorialScore,
    // Structure & Entities
    headingHierarchyScore, anchorScore, entityScore, accessibilityScore, geoMetaScore,
    // Speed & UX
    ...performanceMetrics,
    // Technical
    crawlerAccessScore, structuredDataScore: structuredDataAnalysis.score, canonicalScore, socialMarkupScore,
    sitemapScore, rssFeedScore, indexNowScore,
    // Trust
    authorBioScore: authorBioAnalysis.score, certificationScore, domainAuthorityScore, thoughtLeadershipScore, trustBadgeScore,
    // Voice
    conversationalPhrasesScore, localVoiceScore, icpConversationalScore, featuredSnippetScore, conversationContinuityScore
  };
}

/* ==========================
   Helpers
========================== */
function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function estimateSyllables(words){
  return words.reduce((t,w)=> t + Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) || []).length), 0);
}
function findSnippetAnswers(content){
  const sentences = content.split(/[.!?]+/).filter(s=>s.trim().length>0);
  return sentences.filter(s => {
    const n = s.trim().split(/\s+/).filter(Boolean).length;
    return n>=40 && n<=60;
  });
}
function analyzeStructuredData(html){
  const types = new Set();
  const blocks = html.match(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  blocks.forEach(b=>{
    try{
      const json = b.replace(/<script[^>]*>|<\/script>/gi,'');
      const data = JSON.parse(json);
      const collect = (node)=>{
        if(!node) return;
        if(Array.isArray(node)) return node.forEach(collect);
        const t = node['@type'];
        if(Array.isArray(t)) t.forEach(x=> types.add(String(x).toLowerCase()));
        else if(t) types.add(String(t).toLowerCase());
        Object.values(node).forEach(v => { if(v && typeof v==='object') collect(v); });
      };
      collect(data);
    }catch{}
  });
  (html.match(/itemtype\s*=\s*["']([^"']+)["']/gi) || []).forEach(m=>{
    const t = m.match(/itemtype\s*=\s*["']([^"']+)["']/i)?.[1];
    if(t) types.add(t.split('/').pop().toLowerCase());
  });
  const required = ['organization','service','faqpage','article','breadcrumblist'];
  const found = required.filter(t => Array.from(types).some(x => x.includes(t)));
  const coverage = (found.length / required.length) * 100;
  const bonus = types.size > 5 ? 20 : types.size * 4;
  return { score: Math.min(100, coverage + bonus), types: Array.from(types) };
}
function detectEntityCues(content, industry){
  const nameMatches = content.match(/[A-Z][a-z]+\s+[A-Z][a-z]+/g) || [];
  const unique = Array.from(new Set(nameMatches));
  const products = (industry.keywords || []).filter(k => content.toLowerCase().includes(k)).length;
  const places = content.match(/\b(ontario|toronto|canada|california|new york|london|paris|bangalore)\b/gi) || [];
  return { names: unique.length, products, places: places.length };
}
function estimatePerformanceMetrics(html){
  const htmlSize = html.length;
  const imgCount = (html.match(/<img[^>]*>/gi) || []).length;
  const scriptCount = (html.match(/<script[^>]*>/gi) || []).length;
  const hasLazy = /loading\s*=\s*["']lazy["']/i.test(html);
  const hasWebP = /\.webp/i.test(html);
  const hasViewport = /name\s*=\s*["']viewport["']/i.test(html);

  let lcpScore = 100 - Math.floor(htmlSize/10000) - Math.floor(imgCount/2) + (hasLazy?15:0) + (hasWebP?10:0);
  lcpScore = Math.max(30, Math.min(100, lcpScore));
  const clsScore = Math.min(100, 85 + ((/width=/.test(html) && /height=/.test(html)) ? 15 : 0));
  const inpScore = Math.min(100, Math.max(50, 100 - Math.floor(scriptCount/2)));
  const mobileScore = Math.min(100, (hasViewport ? 80 : 40) + (/responsive/i.test(html) ? 20 : 0));
  return { lcpScore, clsScore, inpScore, mobileScore, crawlerResponseScore: htmlSize < 150000 ? 100 : 70 };
}
function analyzeAuthorBios(content){
  const hasAuthor = /\b(author|written\s*by|by\s+[A-Z][a-z]+)\b/gi.test(content);
  const hasCreds = /\b(phd|md|cpa|certified|licensed|degree|expert|specialist|years\s*of\s*experience)\b/gi.test(content);
  return { score: hasAuthor && hasCreds ? 100 : hasAuthor ? 60 : hasCreds ? 40 : 0, hasAuthor, hasCreds };
}
function estimateDomainAuthority(content, html){
  const indicators = [
    content.length > 5000,
    /https?:\/\//i.test(html),
    /published|copyright|©/i.test(content),
    content.split(/\s+/).length > 1000,
    /rel\s*=\s*["']canonical["']/i.test(html)
  ];
  return Math.min(100, indicators.filter(Boolean).length * 20);
}
function analyzeThoughtLeadership(content){
  const m = content.match(/\b(featured\s*in|quoted\s*in|speaking\s*at|published\s*in|research|whitepaper|case\s*study|award|recognition)\b/gi) || [];
  return { score: Math.min(100, m.length * 25), indicators: m.length };
}
function analyzeTrustBadges(content, html){
  const re = /\b(google\s*my\s*business|g2|clutch|capterra|trustpilot|better\s*business\s*bureau|bbb|verified|certified)\b/gi;
  const matches = (content.match(re) || []).length + (html.match(re) || []).length;
  return { score: Math.min(100, matches * 30), badges: matches };
}
function analyzeConversationalContent(content){
  const starters = /\b(what\s*is|how\s*to|why\s*should|when\s*to|where\s*can|which\s*is|who\s*should)\b/gi;
  const longTails = content.match(/\b\w+\s+\w+\s+\w+\s+\w+\b/g) || [];
  const conv = content.match(starters) || [];
  const relevantLT = longTails.filter(p => starters.test(p));
  return { score: Math.min(100, conv.length*15 + relevantLT.length*5), phrases: conv.length + relevantLT.length };
}
function analyzeLocalVoiceOptimization(content){
  const local = content.match(/\b(near\s*me|close\s*to\s*me|local|in\s*my\s*area|nearby|around\s*me)\b/gi) || [];
  const locs  = content.match(/\b(ontario|toronto|canada|\d{5}|postal\s*code|address)\b/gi) || [];
  return { score: Math.min(100, local.length*20 + locs.length*10), terms: local.length + locs.length };
}
function analyzeICPConversationalTerms(content, industry){
  const biz = content.match(/\b(small\s*business|enterprise|startup|company|organization|business\s*owner)\b/gi) || [];
  const problems = (industry.painPoints||[]).flatMap(p => content.match(new RegExp(p.replace(/\s+/g,'.'),'gi')) || []);
  return { score: Math.min(100, biz.length*10 + problems.length*15), terms: biz.length + problems.length };
}
function analyzeFeaturedSnippetOptimization(content){
  const snippets = findSnippetAnswers(content);
  const defs = content.match(/\b(is\s*defined\s*as|refers\s*to|means\s*that|can\s*be\s*described\s*as)\b/gi) || [];
  const lists = content.match(/\b(steps\s*include|methods\s*are|ways\s*to|types\s*of)\b/gi) || [];
  return { score: Math.min(100, snippets.length*25 + defs.length*15 + lists.length*10), snippets: snippets.length, patterns: defs.length + lists.length };
}
function analyzeConversationContinuity(content){
  const follow = content.match(/\b(also|additionally|furthermore|next|then|after|finally|related|similar|more\s*information)\b/gi) || [];
  const seq = content.match(/\b(first|second|third|another\s*question|follow\s*up)\b/gi) || [];
  return { score: Math.min(100, follow.length*5 + seq.length*15), indicators: follow.length + seq.length };
}

/* ===========================
   Category scorers (V5)
=========================== */
function calculateV5SubfactorScore(value, threshold, weight) {
  if (value === null || value === undefined) return 0.5 * weight; // unknown → partial credit
  const pct = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  let m = 0;
  if (pct >= threshold) m = 1.0;
  else if (pct >= threshold * 0.7) m = 0.8;
  else if (pct >= threshold * 0.4) m = 0.5;
  else m = (threshold > 0 ? (pct / threshold) : 0) * 0.5;
  return m * weight;
}
const sumValues = obj => Object.values(obj).reduce((s,v)=> s + (Number.isFinite(v)?v:0), 0);

function analyzeAIReadabilityMultimodal(m){
  const sub = {
    altTextCoverage: calculateV5SubfactorScore(m.imageAltPercentage, 80, 35),
    videoCaptions:   calculateV5SubfactorScore(m.videoCaptionPercentage, 50, 35),
    interactiveAccess: calculateV5SubfactorScore(m.interactiveAccessibility, 60, 20),
    crossMediaRelations: calculateV5SubfactorScore(m.crossMediaScore, 40, 10)
  }; return { scores: sub, total: sumValues(sub) };
}
function analyzeAISearchReadiness(m){
  const sub = {
    questionHeadings: calculateV5SubfactorScore(m.questionBasedPercentage, 15, 12),
    scannability:     calculateV5SubfactorScore(m.scannabilityScore, 40, 12),
    readability:      calculateV5SubfactorScore(m.readabilityPercentage, 50, 12),
    icpFAQs:          calculateV5SubfactorScore(m.icpFAQScore, 60, 12),
    snippetAnswers:   calculateV5SubfactorScore(m.snippetScore, 50, 10),
    pillarPages:      calculateV5SubfactorScore(m.pillarScore, 40, 10),
    internalLinks:    calculateV5SubfactorScore(m.internalLinksScore, 50, 10),
    painPointsCoverage: calculateV5SubfactorScore(m.painPointsScore, 60, 12),
    geoContent:       calculateV5SubfactorScore(m.geoContentScore, 40, 10)
  }; return { scores: sub, total: sumValues(sub) };
}
function analyzeContentFreshness(m){
  const sub = {
    lastUpdated:      calculateV5SubfactorScore(m.lastUpdatedScore, 70, 25),
    versioning:       calculateV5SubfactorScore(m.versioningScore, 80, 15),
    timeSensitive:    calculateV5SubfactorScore(m.timeSensitiveScore, 60, 15),
    contentAudit:     calculateV5SubfactorScore(m.auditScore, 70, 15),
    liveData:         calculateV5SubfactorScore(m.liveDataScore, 50, 10),
    httpHeaders:      calculateV5SubfactorScore(m.httpFreshnessScore, 80, 10),
    editorialCalendar:calculateV5SubfactorScore(m.editorialScore, 70, 10)
  }; return { scores: sub, total: sumValues(sub) };
}
function analyzeContentStructure(m){
  const sub = {
    headingHierarchy: calculateV5SubfactorScore(m.headingHierarchyScore, 70, 35),
    anchorLinks:      calculateV5SubfactorScore(m.anchorScore, 60, 20),
    entityCues:       calculateV5SubfactorScore(m.entityScore, 50, 20),
    accessibility:    calculateV5SubfactorScore(m.accessibilityScore, 60, 15),
    geoMeta:          calculateV5SubfactorScore(m.geoMetaScore, 70, 10)
  }; return { scores: sub, total: sumValues(sub) };
}
function analyzeSpeedUX(m){
  const sub = {
    lcp:               calculateV5SubfactorScore(m.lcpScore, 70, 25),
    cls:               calculateV5SubfactorScore(m.clsScore, 80, 25),
    inp:               calculateV5SubfactorScore(m.inpScore, 70, 25),
    mobileOptimization:calculateV5SubfactorScore(m.mobileScore, 80, 15),
    crawlerResponse:   calculateV5SubfactorScore(m.crawlerResponseScore, 80, 10)
  }; return { scores: sub, total: sumValues(sub) };
}
function analyzeTechnicalSetup(m){
  const sub = {
    crawlerAccess:  calculateV5SubfactorScore(m.crawlerAccessScore, 70, 30),
    structuredData: calculateV5SubfactorScore(m.structuredDataScore, 60, 30),
    canonical:      calculateV5SubfactorScore(m.canonicalScore, 80, 10),
    socialMarkup:   calculateV5SubfactorScore(m.socialMarkupScore, 70, 5),
    sitemap:        calculateV5SubfactorScore(m.sitemapScore, 70, 10),
    indexNow:       calculateV5SubfactorScore(m.indexNowScore, 80, 10),
    rssFeeds:       calculateV5SubfactorScore(m.rssFeedScore, 60, 5)
  }; return { scores: sub, total: sumValues(sub) };
}
function analyzeTrustAuthority(m){
  const sub = {
    authorBios:       calculateV5SubfactorScore(m.authorBioScore, 70, 25),
    certifications:   calculateV5SubfactorScore(m.certificationScore, 60, 15),
    domainAuthority:  calculateV5SubfactorScore(m.domainAuthorityScore, 60, 25),
    thoughtLeadership:calculateV5SubfactorScore(m.thoughtLeadershipScore, 50, 20),
    trustBadges:      calculateV5SubfactorScore(m.trustBadgeScore, 60, 15)
  }; return { scores: sub, total: sumValues(sub) };
}
function analyzeVoiceOptimization(m){
  const sub = {
    conversationalPhrases: calculateV5SubfactorScore(m.conversationalPhrasesScore, 60, 25),
    localVoice:            calculateV5SubfactorScore(m.localVoiceScore, 50, 25),
    icpConversational:     calculateV5SubfactorScore(m.icpConversationalScore, 60, 20),
    featuredSnippets:      calculateV5SubfactorScore(m.featuredSnippetScore, 50, 15),
    conversationContinuity:calculateV5SubfactorScore(m.conversationContinuityScore, 40, 15)
  }; return { scores: sub, total: sumValues(sub) };
}

/* ===========================
   Detailed analysis + recs
=========================== */
async function performDetailedAnalysis(websiteData, discovery = {}, useAI = true) {
  const { html, url } = websiteData;
  const content = extractTextContent(html);
  
  // Use AI-based or hybrid industry detection
  const industry = await detectIndustryHybrid(websiteData, useAI);
  
  const m = analyzePageMetrics(html, content, industry, url, discovery);
  const analysisResults = {
    aiReadabilityMultimodal: analyzeAIReadabilityMultimodal(m),
    aiSearchReadiness:       analyzeAISearchReadiness(m),
    contentFreshness:        analyzeContentFreshness(m),
    contentStructure:        analyzeContentStructure(m),
    speedUX:                 analyzeSpeedUX(m),
    technicalSetup:          analyzeTechnicalSetup(m),
    trustAuthority:          analyzeTrustAuthority(m),
    voiceOptimization:       analyzeVoiceOptimization(m)
  };

  const categoryScores = {};
  let totalWeighted = 0;
  for (const [cat, res] of Object.entries(analysisResults)) {
    const pct = Math.min(100, Math.max(0, res.total));
    categoryScores[cat] = Math.round(pct * 10) / 10;
    totalWeighted += (pct / 100) * CATEGORY_WEIGHTS[cat] * 100;
  }
  categoryScores.total = Math.round(totalWeighted);

  const recommendations = generateV5Recommendations(analysisResults, categoryScores, industry);
  return {
    url, 
    industry: {
      name: industry.name,
      key: industry.key,
      detectionMethod: industry.detectionMethod,
      confidence: industry.confidence,
      assistant: industry.aiAssistant,
      score: industry.score
    },
    scores: categoryScores, 
    analysis: analysisResults,
    recommendations, 
    metrics: m, 
    rubricVersion: 'V5', 
    analyzedAt: new Date().toISOString()
  };
}

function generateV5Recommendations(_analysis, scores, industry) {
  const recs = [];
  if (scores.aiReadabilityMultimodal < 70) recs.push({
    title: 'Improve Image Alt Text Coverage', impact: 'High',
    category: 'AI Readability & Multimodal Access',
    description: 'Add descriptive alt text to ≥80% of images so AI can understand visual content.',
    quickWin: 'Start with product/service images; add concise 5–10 word alt text.'
  });
  if (scores.aiSearchReadiness < 70) recs.push({
    title: 'Add Question-Based Headings & FAQ', impact: 'Critical',
    category: 'AI Search Readiness & Content Depth',
    description: 'Convert H2/H3 into questions and add an ICP-specific FAQ to raise AI citation odds.',
    quickWin: `Add FAQ items like “What makes a great ${industry.name}?” and “How to choose the right ${industry.name}?”`
  });
  if (scores.contentFreshness < 60) recs.push({
    title: 'Add Freshness Signals', impact: 'Medium',
    category: 'Content Freshness & Maintenance',
    description: 'Show visible “Last Updated” dates and update quarterly to build AI trust.',
    quickWin: 'Add “Last Updated: [Date]” to core pages and keep a lightweight refresh log.'
  });
  if (scores.contentStructure < 70) recs.push({
    title: 'Tighten Heading Hierarchy & Entities', impact: 'High',
    category: 'Content Structure & Entity Recognition',
    description: 'Ensure 1×H1, multiple H2s, at least one H3; name your brand and locations clearly.',
    quickWin: 'Audit headings; add entity-rich subheads and anchor IDs for deep links.'
  });
  if (scores.technicalSetup < 70) recs.push({
    title: 'Implement/Expand Structured Data', impact: 'Critical',
    category: 'Technical Setup & Structured Data',
    description: 'Add Organization, Service, FAQ, Article, Breadcrumb JSON-LD as applicable.',
    quickWin: 'Start with Organization schema (name, URL, logo, sameAs, contact).'
  });
  if (scores.trustAuthority < 70) recs.push({
    title: 'Boost Authority Signals', impact: 'High',
    category: 'Trust, Authority & Verification',
    description: 'Add author bylines with credentials, certifications, third-party profiles/badges.',
    quickWin: 'Add “About the Team” bios with experience, plus G2/Capterra/GBP links.'
  });
  if (scores.voiceOptimization < 70) recs.push({
    title: 'Optimize for Voice/Conversational Search', impact: 'Medium',
    category: 'Voice & Conversational Optimization',
    description: 'Use natural Q&A phrasing and 30–60 word answers; anticipate follow-ups.',
    quickWin: `Sprinkle phrases like “best ${industry.name} near me” (if relevant) with short answers.`
  });
  if (scores.speedUX < 70) recs.push({
    title: 'Improve Page Performance', impact: 'Medium',
    category: 'Speed & User Experience',
    description: 'Optimize images, load fewer JS bundles, ensure mobile viewport + lazy-loading.',
    quickWin: 'Enable <img loading="lazy">, compress hero images, defer non-critical scripts.'
  });
  return recs.slice(0, 6);
}

/* ===========================
   Content extraction
=========================== */
function extractTextContent(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ===========================
   API ROUTES
=========================== */
router.post('/analyze-website', authenticateTokenOptional, async (req, res) => {
  try {
    const { url, useAIDetection = true, pages = [] } = req.body || {};
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const userPlan = req.user?.plan || 'free';

    // For logged-in users, check and increment scan limit
    if (req.user) {
      // Use centralized plan validation (single source of truth)
      const limits = getPlanLimits(userPlan);

      if (!limits) {
        console.error(`⚠️ CRITICAL: Invalid plan in ai-testing for user ${req.user.id}: "${userPlan}"`);
        return res.status(400).json({
          error: 'INVALID_PLAN',
          message: 'Your account has an invalid plan configuration. Please contact support.',
          supportEmail: 'support@yourapp.com'
        });
      }

      const scanLimit = limits.scansPerMonth;

      if (req.user.scans_used_this_month >= scanLimit) {
        return res.status(403).json({
          error: 'Scan limit reached',
          message: `You've used ${req.user.scans_used_this_month}/${scanLimit} scans this month.`,
          currentPlan: userPlan,
          upgrade: userPlan === 'free'
            ? 'Upgrade to DIY ($29/mo) for 25 scans/month'
            : userPlan === 'diy'
            ? 'Upgrade to Pro ($99/mo) for 50 scans/month'
            : null
        });
      }
      
      // Validate page count for plan
      const pageLimit = limits?.pagesPerScan || 1;
      const requestedPages = pages.length + 1; // +1 for homepage
      
      if (requestedPages > pageLimit) {
        return res.status(403).json({
          error: 'Page limit exceeded',
          message: `Your ${userPlan} plan allows ${pageLimit} pages per scan. You requested ${requestedPages} pages.`,
          limit: pageLimit,
          upgrade: pageLimit < 5 ? 'Upgrade to DIY for 5 pages per scan' : 'Upgrade to Pro for 25 pages per scan'
        });
      }
      
      // Increment usage
      await db.query(
        'UPDATE users SET scans_used_this_month = scans_used_this_month + 1 WHERE id = $1',
        [req.user.id]
      );
    }
    
    // Run analysis with plan-appropriate page count
    const { combinedHtml, discovery, origin, pagesFetched, sampledUrls } = 
      await fetchMultiPageSample(url, userPlan, pages);
      
    const websiteData = { html: combinedHtml || '', url };
    const analysis = await performDetailedAnalysis(websiteData, discovery, useAIDetection);

    // Save scan with page tracking
    await db.query(
      `INSERT INTO scans (user_id, url, score, industry, scan_data, pages_scanned, page_count) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.user?.id || null, 
        url, 
        analysis.scores.total, 
        analysis.industry.key, 
        JSON.stringify(analysis),
        JSON.stringify(sampledUrls),
        pagesFetched
      ]
    );

    return res.json({
      success: true,
      data: {
        ...analysis,
        isFreemium: !req.user,
        userPlan: userPlan,
        pagesScanned: sampledUrls,
        pagesFetched: pagesFetched,
        discovery: {
          origin, 
          pagesFetched, 
          sampledUrls,
          robots: discovery.robots, 
          sitemaps: discovery.sitemaps, 
          sitemapFound: discovery.sitemapFound
        }
      }
    });
  } catch (error) {
    console.error('V5 analysis failed:', error);
    return res.status(500).json({ error: 'Website analysis failed', message: error.message });
  }
});

/* ============== AI visibility harness (unchanged contract) ============== */
router.post('/test-ai-visibility', async (req, res) => {
  try {
    const { url, industry, queries } = req.body || {};
    if (!url || !Array.isArray(queries)) return res.status(400).json({ error: 'URL and queries array are required' });
    const results = await testAIVisibility(url, industry, queries);
    return res.json({ success: true, data: results });
  } catch (error) {
    console.error('AI visibility testing failed:', error);
    return res.status(500).json({ error: 'AI visibility testing failed', message: error.message });
  }
});

async function testAIVisibility(url, industry, queries) {
  const domain = new URL(url).hostname;
  const companyName = extractCompanyName(domain);
  const results = { overall: { mentionRate:0, recommendationRate:0, citationRate:0 }, assistants: {}, testedQueries: queries.length };

  for (const [k, cfg] of Object.entries(AI_CONFIGS)) {
    const envKey = process.env[k.toUpperCase() + '_API_KEY'];
    if (!envKey) { results.assistants[k] = { name: k, tested:false, reason:'API key not configured' }; continue; }
    try { results.assistants[k] = await testSingleAssistant(k, queries, companyName, domain); }
    catch (e) { results.assistants[k] = { name:k, tested:false, error:e.message }; }
  }
  calculateOverallMetrics(results);
  return results;
}

async function testSingleAssistant(assistantKey, queries, companyName, domain) {
  const out = { name: assistantKey, tested: true, queries: [], metrics: { mentionRate:0, recommendationRate:0, citationRate:0 } };
  let m=0, r=0, c=0;
  for (const q of queries) {
    try {
      const txt = await queryAIAssistant(assistantKey, q);
      const a = analyzeResponse(txt, companyName, domain);
      out.queries.push({ query:q, mentioned:a.mentioned, recommended:a.recommended, cited:a.cited });
      if (a.mentioned) m++; if (a.recommended) r++; if (a.cited) c++;
      await new Promise(done=>setTimeout(done, 1200));
    } catch (e) {
      out.queries.push({ query:q, error:e.message, mentioned:false, recommended:false, cited:false });
    }
  }
  out.metrics.mentionRate = (m/queries.length)*100;
  out.metrics.recommendationRate = (r/queries.length)*100;
  out.metrics.citationRate = (c/queries.length)*100;
  return out;
}

async function queryAIAssistant(assistant, query) {
  const cfg = AI_CONFIGS[assistant];
  let body;
  switch (assistant) {
    case 'openai':
      body = { model: 'gpt-4o-mini', messages: [{ role:'user', content: query }], max_tokens: 500, temperature: 0.7 }; break;
    case 'anthropic':
      body = { model: 'claude-3-sonnet-20240229', max_tokens: 500, messages: [{ role:'user', content: [{ type:'text', text: query }] }] }; break;
    case 'perplexity':
      body = { model: 'llama-3.1-sonar-small-128k-online', messages: [{ role:'user', content: query }] }; break;
    default: throw new Error(`Unsupported assistant: ${assistant}`);
  }
  const resp = await axios.post(cfg.endpoint, body, { headers: { ...cfg.headers, 'Content-Type':'application/json' }, timeout: 30000 });
  switch (assistant) {
    case 'openai':
    case 'perplexity': return resp.data?.choices?.[0]?.message?.content || '';
    case 'anthropic':  return resp.data?.content?.[0]?.text || '';
    default: throw new Error(`Unknown response format for ${assistant}`);
  }
}

function analyzeResponse(response, companyName, domain) {
  const lower = (response || '').toLowerCase();
  const name = (companyName || '').toLowerCase();
  const host = (domain || '').toLowerCase();
  return {
    mentioned: lower.includes(name) || lower.includes(host),
    recommended: /\b(recommend|suggest|top|best|excellent)\b/.test(lower) && (lower.includes(name) || lower.includes(host)),
    cited: lower.includes(host) || lower.includes('http')
  };
}
function calculateOverallMetrics(results) {
  const tested = Object.values(results.assistants).filter(a => a.tested);
  if (!tested.length) return;
  results.overall.mentionRate = tested.reduce((s,a)=> s+a.metrics.mentionRate,0)/tested.length;
  results.overall.recommendationRate = tested.reduce((s,a)=> s+a.metrics.recommendationRate,0)/tested.length;
  results.overall.citationRate = tested.reduce((s,a)=> s+a.metrics.citationRate,0)/tested.length;
}
function extractCompanyName(domain){
  return domain.replace(/^www\./,'').split('.')[0].replace(/[-_]/g,' ').replace(/\b(inc|llc|corp|ltd)\b/gi,'').trim();
}

module.exports = router;
