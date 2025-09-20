// ai-testing.js
// Express router for AI Readiness / AEO analysis (V5 rubric)

/* eslint-disable no-console */
const express = require('express');
const axios = require('axios');
const router = express.Router();

// ---- Discovery helpers (robots + sitemap + multi-page sampler) ----
async function fetchText(url, timeout = 10000, headers = {}) {
  try {
    const r = await axios.get(url, {
      timeout,
      headers: { 'User-Agent': 'Mozilla/5.0 (AI-Readiness-Tool/1.0)', ...headers }
    });
    return { ok: true, status: r.status, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data), headers: r.headers };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function parseRobots(text) {
  const hasBlanketDisallow = /^\s*Disallow:\s*\/\s*$/gim.test(text);
  const allowsAIBots = /User-agent:\s*(GPTBot|Claude|Anthropic|Perplexity)/i.test(text) && !hasBlanketDisallow;
  const sitemaps = (text.match(/^\s*Sitemap:\s*(.+)$/gim) || []).map(l => l.split(/:\s*/i).slice(1).join(':').trim());
  return { hasBlanketDisallow, allowsAIBots, sitemaps };
}

async function fetchRobotsAndSitemaps(origin) {
  const robotsUrl = origin.replace(/\/+$/, '') + '/robots.txt';
  const robotsRes = await fetchText(robotsUrl);
  let robots = null, foundSitemaps = [];
  if (robotsRes.ok) {
    robots = parseRobots(robotsRes.text);
    const candidateSitemaps = [
      ...(robots.sitemaps || []),
      origin.replace(/\/+$/, '') + '/sitemap.xml',
      origin.replace(/\/+$/, '') + '/sitemap_index.xml',
      origin.replace(/\/+$/, '') + '/sitemap-index.xml'
    ];
    for (const s of [...new Set(candidateSitemaps)]) {
      const r = await fetchText(s);
      if (r.ok && /<(urlset|sitemapindex)\b/i.test(r.text)) foundSitemaps.push(s);
    }
  }
  return {
    robots,
    sitemapFound: foundSitemaps.length > 0,
    sitemaps: foundSitemaps
  };
}

async function fetchMultiPageSample(startUrl) {
  const origin = new URL(startUrl).origin;
  const corePaths = ['/insights', '/news', '/blog', '/press', '/resources', '/sitemap'];
  const targets = [startUrl, ...corePaths.map(p => origin.replace(/\/+$/, '') + p)];
  const pages = [];
  for (const u of [...new Set(targets)]) {
    const r = await fetchText(u);
    if (r.ok && r.text) pages.push(r.text);
  }
  const combinedHtml = pages.join('\n<!-- PAGE SPLIT -->\n');
  const discovery = await fetchRobotsAndSitemaps(origin);
  return { combinedHtml, discovery, origin, pagesFetched: pages.length };
}


/**
 * ================================
 * AI API CONFIGS (visibility tests)
 * ================================
 */
const AI_CONFIGS = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    }
  },
  perplexity: {
    endpoint: 'https://api.perplexity.ai/chat/completions',
    headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` }
  }
};

/**
 * =======================
 * V5 CATEGORY WEIGHTS
 * =======================
 * (Total = 100%) per the V5 rubric
 */
const CATEGORY_WEIGHTS = {
  aiReadabilityMultimodal: 0.10, // 10%
  aiSearchReadiness: 0.20,       // 20%
  contentFreshness: 0.08,        // 8%
  contentStructure: 0.15,        // 15%
  speedUX: 0.05,                 // 5%
  technicalSetup: 0.18,          // 18%
  trustAuthority: 0.12,          // 12%
  voiceOptimization: 0.12        // 12%
};

/**
 * =======================
 * Industry detection
 * =======================
 */
function detectIndustry(websiteData) {
  const { html, url } = websiteData;
  const content = (html || '').toLowerCase();
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

  let bestMatch = industries[3]; // default
  let highestScore = 0;

  for (const industry of industries) {
    let score = 0;

    for (const k of industry.keywords) if (content.includes(k)) score += 1;
    for (const dk of industry.domainKeywords) if (domain.includes(dk)) score += 3;
    for (const p of industry.painPoints) if (content.includes(p)) score += 0.5;

    if (score > highestScore) {
      highestScore = score;
      bestMatch = industry;
    }
  }

  return bestMatch;
}

/**
 * ==================================================
 * Core page metrics extraction per V5 rubric
 * ==================================================
 */
function analyzePageMetrics(html, content, industry, url) {
  console.log('\n🔬 Analyzing page metrics with V5 rubric...');
  console.log('📄 HTML length:', html.length);
  console.log('📝 Content length:', content.length);

  const words = content.split(/\s+/).filter(Boolean);
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);

  // === AI READABILITY & MULTIMODAL ACCESS ===

  // Images & alt coverage
  const imageMatches = html.match(/<img[^>]*>/gi) || [];
  const altPatterns = [
    /<img[^>]*\salt\s*=\s*"[^"]*"[^>]*>/gi,
    /<img[^>]*\salt\s*=\s*'[^']*'[^>]*>/gi,
    /<img[^>]*\salt\s*=\s*[^>\s"'][^>\s]*[^>]*>/gi
  ];
  let altMatches = [];
  altPatterns.forEach(p => { altMatches = altMatches.concat(html.match(p) || []); });
  const uniqueAltMatches = [...new Set(altMatches)];
  const imageAltPercentage = imageMatches.length > 0 ? (uniqueAltMatches.length / imageMatches.length) * 100 : 100;

  // AV media & captions
  const videoMatches = html.match(/<video[^>]*>/gi) || [];
  const audioMatches = html.match(/<audio[^>]*>/gi) || [];
  const captionMatches = html.match(/<track[^>]+kind\s*=\s*["']captions["'][^>]*>/gi) || [];
  const transcriptIndicators = /transcript|subtitles|captions/i.test(content);
  const totalAvMedia = videoMatches.length + audioMatches.length;
  const captionPercentage = totalAvMedia > 0 ? ((captionMatches.length + (transcriptIndicators ? 1 : 0)) / totalAvMedia) * 100 : 0;

  // Interactive media accessibility
  const interactiveMedia = html.match(/<(canvas|svg|iframe|embed|object)[^>]*>/gi) || [];
  const accessibleInteractive = html.match(/aria-label|aria-labelledby|role=/gi) || [];
  const interactiveAccessibility = interactiveMedia.length > 0 ? (accessibleInteractive.length / interactiveMedia.length) * 100 : 100;

  // Cross-media relationships
  const imageReferences = (content.match(/\b(image|photo|picture|screenshot|diagram|chart|visual|graphic)\b/gi) || []).length;
  const videoReferences = (content.match(/\b(video|watch|demonstration|tutorial|webinar|recording|stream)\b/gi) || []).length;
  const totalMediaReferences = imageReferences + videoReferences;
  const totalImages = imageMatches.length;
  const totalVideos = videoMatches.length;
  const totalMediaElements = totalImages + totalVideos;
  let crossMediaScore = 0;
  if (totalMediaElements > 0) {
    const mediaToReferenceRatio = totalMediaReferences > 0 ? Math.min(100, (totalMediaReferences / totalMediaElements) * 100) : 0;
    const mediaVarietyBonus = (totalImages > 0 ? 15 : 0) + (totalVideos > 0 ? 15 : 0);
    const baseScore = totalMediaReferences > 0 ? 20 : 0;
    crossMediaScore = Math.min(100, baseScore + (mediaToReferenceRatio * 0.5) + mediaVarietyBonus);
  } else if (totalMediaReferences > 0) {
    crossMediaScore = 25;
  }

  // === AI SEARCH READINESS & DEPTH ===

  // Headings
  const h1Matches = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi) || [];
  const h2h3Matches = html.match(/<h[2-3][^>]*>[\s\S]*?<\/h[2-3]>/gi) || [];
  const qWords = /\b(what|how|why|when|where|which|who)\b/i;
  const questionHeadingMatches = h2h3Matches.filter(h => {
    const inner = h.replace(/<[^>]+>/g, ' ').trim();
    return /\?/.test(inner) || qWords.test(inner);
  });
  const questionBasedPercentage = h2h3Matches.length > 0 ? (questionHeadingMatches.length / h2h3Matches.length) * 100 : 0;

  // Lists/tables/steps
  const listMatches = html.match(/<(ul|ol)[^>]*>/gi) || [];
  const tableMatches = html.match(/<table[^>]*>/gi) || [];
  const stepsIndicators = /(?:^|\s)(step\s*\d|steps:|procedure|process|how to)(?=\s|$)/gi.test(content);
  const scannabilityScore = Math.min(100, (listMatches.length * 15) + (tableMatches.length * 20) + (stepsIndicators ? 25 : 0));

  // Readability (Flesch approximation)
  const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : 15;
  const totalSyllables = estimateSyllables(words);
  const avgSyllablesPerWord = words.length ? (totalSyllables / words.length) : 1.4;
  const fleschScore = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
  const readabilityPercentage = Math.max(0, Math.min(100, Number.isFinite(fleschScore) ? fleschScore : 0));

  // ICP FAQs
  const hasFAQSection = /(?:^|[^a-z])(faq|frequently\s*asked|q&a)(?:[^a-z]|$)/i.test(html);
  const industryQuestions = industry.painPoints.filter(pain => new RegExp(`\\b(what|how|why|when)\\b[\\s\\S]{0,40}${escapeRegex(pain)}`, 'i').test(content)).length;
  const icpFAQScore = hasFAQSection ? 80 + Math.min(20, industryQuestions * 10) : Math.min(50, industryQuestions * 15);

  // Snippet-eligible 40–60 words
  const snippetAnswers = findSnippetAnswers(content);
  const snippetScore = Math.min(100, snippetAnswers.length * 25);

  // Pillar pages & internal links
  const pillarIndicators = /complete\s*guide|ultimate\s*guide|everything\s*about|comprehensive|hub|resource\s*center/i.test(content);
  const internalLinks = (html.match(/<a[^>]+href\s*=\s*["'][^"']+["'][^>]*>/gi) || [])
    .filter(link => {
      const href = (link.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] || '').trim();
      if (!href) return false;
      if (href.startsWith('#')) return false;
      // internal if relative OR same host
      return !/^https?:\/\//i.test(href) || href.includes(new URL(url).hostname);
    }).length;
  const pillarScore = pillarIndicators ? 60 + Math.min(40, Math.floor(internalLinks / 5) * 10) : Math.min(30, Math.floor(internalLinks / 3) * 10);

  // Pain points coverage
  const painPointMatches = industry.painPoints.filter(p => content.includes(p.toLowerCase())).length;
  const painPointsScore = Math.min(100, (painPointMatches / industry.painPoints.length) * 100);

  // Geo terms & case studies
  const geoTerms = ['local', 'ontario', 'toronto', 'canada', 'region', 'area', 'case study', 'client story', 'success story'];
  const geoMatches = geoTerms.filter(t => content.includes(t.toLowerCase())).length;
  const geoContentScore = Math.min(100, geoMatches * 15);

  // === CONTENT FRESHNESS & MAINTENANCE ===
  const lastUpdatedMatch = /last\s*updated|updated\s*on|modified|revised/i.test(content);
  const visibleDates = content.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/gi) || [];
  const thisYear = new Date().getFullYear();
  const recentDates = visibleDates.filter(d => {
    const y = parseInt(d.match(/\d{4}/)?.[0] || '0', 10);
    return y >= (thisYear - 1);
  }).length;
  const lastUpdatedScore = lastUpdatedMatch ? 70 + Math.min(30, recentDates * 15) : Math.min(40, recentDates * 20);

  const versioningIndicators = /version|v\d|revision|changelog|release\s*notes|updates/i.test(content);
  const versioningScore = versioningIndicators ? 100 : 0;

  const timeSensitiveMatches = content.match(/\b(current|latest|2024|2025|this\s*year|recent|new|now)\b/gi) || [];
  const timeSensitiveScore = Math.min(100, (timeSensitiveMatches.length / Math.max(1, words.length)) * 1000);

  const auditIndicators = /reviewed|audited|verified|quality\s*checked|maintained/i.test(content);
  const auditScore = auditIndicators ? 100 : 0;

  const liveDataMatches = content.match(/\b(live|real\s*time|dynamic|up\s*to\s*date|current\s*status)\b/gi) || [];
  const liveDataScore = Math.min(100, liveDataMatches.length * 25);

  const hasETagsInMarkup = /etag|last-modified/i.test(html); // heuristic; real header check would be server-side
  const httpFreshnessScore = hasETagsInMarkup ? 100 : 0;

  const editorialSignals = /blog\s*schedule|content\s*calendar|publishing\s*schedule|editorial/i.test(content);
  const editorialScore = editorialSignals ? 100 : 0;

  // === CONTENT STRUCTURE & ENTITY RECOGNITION ===
  const hasProperH1 = h1Matches.length === 1;
  const hasH2s = (html.match(/<h2[^>]*>/gi) || []).length >= 2;
  const hasH3s = (html.match(/<h3[^>]*>/gi) || []).length >= 1;
  const headingHierarchyScore = (hasProperH1 ? 35 : 0) + (hasH2s ? 35 : 0) + (hasH3s ? 30 : 0);

  const anchorIds = html.match(/\sid\s*=\s*["'][^"']+["']/gi) || [];
  const tocIndicators = /table\s*of\s*contents|toc|jump\s*to|navigate/i.test(content);
  const anchorScore = Math.min(100, (anchorIds.length * 10) + (tocIndicators ? 50 : 0));

  const entityCues = detectEntityCues(content, industry);
  const entityScore = Math.min(100, (entityCues.names * 8) + (entityCues.products * 10) + (entityCues.places * 12));

  const accessibilityFeatures = html.match(/aria-|role=|tabindex|alt=/gi) || [];
  const accessibilityScore = Math.min(100, accessibilityFeatures.length * 5);

  const hasMetaDescription = /name\s*=\s*["']description["']/i.test(html);
  const geoInMeta = /\b(ontario|toronto|canada|local)\b/i.test(html);
  const geoMetaScore = hasMetaDescription ? (geoInMeta ? 100 : 50) : 0;

  // === SPEED & UX (proxies) ===
  const performanceMetrics = estimatePerformanceMetrics(html);

  // === TECHNICAL SETUP & STRUCTURED DATA ===
  const crawlerFriendly = !/noindex|nofollow/i.test(html);
  const hasCDN = /cdn\.|cloudflare|cloudfront|fastly/i.test(html);
  const crawlerAccessScore = (crawlerFriendly ? 60 : 20) + (hasCDN ? 40 : 0);

  const structuredDataAnalysis = analyzeStructuredData(html);

  const hasCanonical = /rel\s*=\s*["']canonical["']/i.test(html);
  const hasHreflang = /hreflang\s*=/i.test(html);
  const canonicalScore = (hasCanonical ? 70 : 0) + (hasHreflang ? 30 : 0);

  const hasOpenGraph = /property\s*=\s*["']og:/i.test(html);
  const hasTwitterCards = /(name|property)\s*=\s*["']twitter:/i.test(html);
  const socialMarkupScore = (hasOpenGraph ? 70 : 0) + (hasTwitterCards ? 30 : 0);

  const hasSitemap = /sitemap(?:\.xml)?/i.test(html);
  const hasRSSFeed = /application\/(rss|atom)\+xml/i.test(html);
  const sitemapScore = (hasSitemap ? 60 : 0) + (hasRSSFeed ? 40 : 0);
  const rssFeedScore = hasRSSFeed ? 100 : 0;

  const hasIndexNow = /indexnow|api\.indexnow\./i.test(html);
  const indexNowScore = hasIndexNow ? 100 : 0;

  // === TRUST, AUTHORITY & VERIFICATION ===
  const authorBioAnalysis = analyzeAuthorBios(content);

  const certificationTerms = /certified|licensed|accredited|iso\s*9001|iso\s*27001|member\s*of|association/gi;
  const certificationMatches = content.match(certificationTerms) || [];
  const certificationScore = Math.min(100, certificationMatches.length * 20);

  const domainAuthorityEstimate = estimateDomainAuthority(content, html);

  const thoughtLeadershipAnalysis = analyzeThoughtLeadership(content);

  const trustBadgeAnalysis = analyzeTrustBadges(content, html);

  // === VOICE & CONVERSATIONAL OPTIMIZATION ===
  const conversationalPhrases = analyzeConversationalContent(content);
  const localVoiceAnalysis = analyzeLocalVoiceOptimization(content);
  const icpConversationalAnalysis = analyzeICPConversationalTerms(content, industry);
  const featuredSnippetAnalysis = analyzeFeaturedSnippetOptimization(content);
  const conversationContinuityAnalysis = analyzeConversationContinuity(content);

  return {
    // AI Readability & Multimodal
    imageAltPercentage,
    videoCaptionPercentage: captionPercentage,
    interactiveAccessibility,
    crossMediaScore,

    // AI Search Readiness & Depth
    questionBasedPercentage,
    scannabilityScore,
    readabilityPercentage,
    icpFAQScore,
    snippetScore,
    pillarScore,
    internalLinksScore: Math.min(100, internalLinks * 5),
    painPointsScore,
    geoContentScore,

    // Content Freshness & Maintenance
    lastUpdatedScore,
    versioningScore,
    timeSensitiveScore,
    auditScore,
    liveDataScore,
    httpFreshnessScore,
    editorialScore,

    // Content Structure & Entity Recognition
    headingHierarchyScore,
    anchorScore,
    entityScore,
    accessibilityScore,
    geoMetaScore,

    // Speed & UX
    ...performanceMetrics,

    // Technical Setup & Structured Data
    crawlerAccessScore,
    structuredDataScore: structuredDataAnalysis.score,
    canonicalScore,
    socialMarkupScore,
    sitemapScore,
    rssFeedScore,
    indexNowScore,

    // Trust, Authority & Verification
    authorBioScore: authorBioAnalysis.score,
    certificationScore,
    domainAuthorityScore: domainAuthorityEstimate,
    thoughtLeadershipScore: thoughtLeadershipAnalysis.score,
    trustBadgeScore: trustBadgeAnalysis.score,

    // Voice & Conversational Optimization
    conversationalPhrasesScore: conversationalPhrases.score,
    localVoiceScore: localVoiceAnalysis.score,
    icpConversationalScore: icpConversationalAnalysis.score,
    featuredSnippetScore: featuredSnippetAnalysis.score,
    conversationContinuityScore: conversationContinuityAnalysis.score
  };
}

/**
 * ==========================
 * Helper functions
 * ==========================
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function estimateSyllables(words) {
  // crude heuristic
  return words.reduce((total, w) => {
    const m = w.toLowerCase().match(/[aeiouy]+/g) || [];
    return total + Math.max(1, m.length);
  }, 0);
}

function findSnippetAnswers(content) {
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.filter(sentence => {
    const ws = sentence.trim().split(/\s+/).filter(Boolean);
    return ws.length >= 40 && ws.length <= 60;
  });
}

function analyzeStructuredData(html) {
  const jsonLdBlocks = html.match(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const types = new Set();

  jsonLdBlocks.forEach(block => {
    try {
      const jsonContent = block.replace(/<script[^>]*>|<\/script>/gi, '');
      const data = JSON.parse(jsonContent);
      const collect = (node) => {
        if (!node) return;
        if (Array.isArray(node)) return node.forEach(collect);
        const t = node['@type'];
        if (Array.isArray(t)) t.forEach(x => types.add(String(x).toLowerCase()));
        else if (t) types.add(String(t).toLowerCase());
      };
      collect(data);
    } catch (_) { /* ignore bad JSON-LD */ }
  });

  // microdata itemtype
  const microTypes = html.match(/itemtype\s*=\s*["']([^"']+)["']/gi) || [];
  microTypes.forEach(m => {
    const t = m.match(/itemtype\s*=\s*["']([^"']+)["']/i)?.[1];
    if (t) types.add(t.split('/').pop().toLowerCase());
  });

  const required = ['organization', 'service', 'faqpage', 'article', 'breadcrumblist'];
  const found = required.filter(t => Array.from(types).some(x => x.includes(t)));
  const coverage = (found.length / required.length) * 100;
  const bonus = types.size > 5 ? 20 : types.size * 4;
  const score = Math.min(100, coverage + bonus);

  return { score, types: Array.from(types) };
}

function detectEntityCues(content, industry) {
  const nameMatches = content.match(/[A-Z][a-z]+\s+[A-Z][a-z]+/g) || [];
  const uniqueNames = Array.from(new Set(nameMatches));
  const products = industry.keywords.filter(k => content.toLowerCase().includes(k)).length;
  const places = content.match(/\b(ontario|toronto|canada|california|new york|london)\b/gi) || [];
  return { names: uniqueNames.length, products, places: places.length };
}

function estimatePerformanceMetrics(html) {
  const htmlSize = html.length;
  const imageCount = (html.match(/<img[^>]*>/gi) || []).length;
  const scriptCount = (html.match(/<script[^>]*>/gi) || []).length;

  const hasLazyLoading = /loading\s*=\s*["']lazy["']/i.test(html);
  const hasWebP = /\.webp/i.test(html);
  const hasViewport = /name\s*=\s*["']viewport["']/i.test(html);

  let lcpScore = 100 - Math.floor(htmlSize / 10000) - Math.floor(imageCount / 2) + (hasLazyLoading ? 15 : 0) + (hasWebP ? 10 : 0);
  lcpScore = Math.max(30, Math.min(100, lcpScore));

  const clsScore = Math.min(100, 85 + ((/width=/.test(html) && /height=/.test(html)) ? 15 : 0));
  const inpScore = Math.min(100, Math.max(50, 100 - Math.floor(scriptCount / 2)));
  const mobileScore = Math.min(100, (hasViewport ? 80 : 40) + (/responsive/i.test(html) ? 20 : 0));

  return {
    lcpScore,
    clsScore,
    inpScore,
    mobileScore,
    crawlerResponseScore: htmlSize < 150000 ? 100 : 70
  };
}

function analyzeAuthorBios(content) {
  const authorIndicators = /\b(author|written\s*by|by\s+[A-Z][a-z]+)\b/gi;
  const credentialKeywords = /\b(phd|md|cpa|certified|licensed|degree|expert|specialist|years\s*of\s*experience)\b/gi;

  const hasAuthor = authorIndicators.test(content);
  const hasCredentials = credentialKeywords.test(content);

  let score = 0;
  if (hasAuthor && hasCredentials) score = 100;
  else if (hasAuthor) score = 60;
  else if (hasCredentials) score = 40;

  return { score, hasAuthor, hasCredentials };
}

function estimateDomainAuthority(content, html) {
  const indicators = [
    content.length > 5000,
    /https?:\/\//i.test(html),
    /published|copyright|©/i.test(content),
    content.split(/\s+/).length > 1000,
    /rel\s*=\s*["']canonical["']/i.test(html)
  ];
  return Math.min(100, indicators.filter(Boolean).length * 20);
}

function analyzeThoughtLeadership(content) {
  const indicators = /\b(featured\s*in|quoted\s*in|speaking\s*at|published\s*in|research|whitepaper|case\s*study|award|recognition)\b/gi;
  const matches = content.match(indicators) || [];
  return { score: Math.min(100, matches.length * 25), indicators: matches.length };
}

function analyzeTrustBadges(content, html) {
  const trustBadges = /\b(google\s*my\s*business|g2|clutch|capterra|trustpilot|better\s*business\s*bureau|bbb|verified|certified)\b/gi;
  const matches = (content.match(trustBadges) || []).length + (html.match(trustBadges) || []).length;
  return { score: Math.min(100, matches * 30), badges: matches };
}

function analyzeConversationalContent(content) {
  const conversationalStarters = /\b(what\s*is|how\s*to|why\s*should|when\s*to|where\s*can|which\s*is|who\s*should)\b/gi;
  const longTailPhrases = content.match(/\b\w+\s+\w+\s+\w+\s+\w+\b/g) || [];
  const convMatches = content.match(conversationalStarters) || [];
  // Count long-tail phrases that begin with a conversational starter term nearby
  const relevantLongTail = longTailPhrases.filter(p => conversationalStarters.test(p));
  return {
    score: Math.min(100, (convMatches.length * 15) + (relevantLongTail.length * 5)),
    phrases: convMatches.length + relevantLongTail.length
  };
}

function analyzeLocalVoiceOptimization(content) {
  const localPhrases = /\b(near\s*me|close\s*to\s*me|local|in\s*my\s*area|nearby|around\s*me)\b/gi;
  const locationTerms = /\b(ontario|toronto|canada|\d{5}|postal\s*code|address)\b/gi;

  const localMatches = content.match(localPhrases) || [];
  const locationMatches = content.match(locationTerms) || [];
  return { score: Math.min(100, (localMatches.length * 20) + (locationMatches.length * 10)), terms: localMatches.length + locationMatches.length };
}

function analyzeICPConversationalTerms(content, industry) {
  const businessTerms = /\b(small\s*business|enterprise|startup|company|organization|business\s*owner)\b/gi;
  const businessMatches = content.match(businessTerms) || [];
  const problemMatches = industry.painPoints.flatMap(p => content.match(new RegExp(p.replace(/\s+/g, '.'), 'gi')) || []);
  return { score: Math.min(100, (businessMatches.length * 10) + (problemMatches.length * 15)), terms: businessMatches.length + problemMatches.length };
}

function analyzeFeaturedSnippetOptimization(content) {
  const snippetAnswers = findSnippetAnswers(content);
  const definitionPatterns = /\b(is\s*defined\s*as|refers\s*to|means\s*that|can\s*be\s*described\s*as)\b/gi;
  const listPatterns = /\b(steps\s*include|methods\s*are|ways\s*to|types\s*of)\b/gi;

  const definitionMatches = content.match(definitionPatterns) || [];
  const listMatches = content.match(listPatterns) || [];
  return {
    score: Math.min(100, (snippetAnswers.length * 25) + (definitionMatches.length * 15) + (listMatches.length * 10)),
    snippets: snippetAnswers.length,
    patterns: definitionMatches.length + listMatches.length
  };
}

function analyzeConversationContinuity(content) {
  const followUpIndicators = /\b(also|additionally|furthermore|next|then|after|finally|related|similar|more\s*information)\b/gi;
  const questionSequences = /\b(first|second|third|another\s*question|follow\s*up)\b/gi;

  const followUpMatches = content.match(followUpIndicators) || [];
  const sequenceMatches = content.match(questionSequences) || [];
  return { score: Math.min(100, (followUpMatches.length * 5) + (sequenceMatches.length * 15)), indicators: followUpMatches.length + sequenceMatches.length };
}

/**
 * ===========================
 * V5 CATEGORY ANALYSIS
 * ===========================
 */
function analyzeAIReadabilityMultimodal(metrics) {
  const sub = {
    altTextCoverage: calculateV5SubfactorScore(metrics.imageAltPercentage, 80, 35),
    videoCaptions: calculateV5SubfactorScore(metrics.videoCaptionPercentage, 50, 35),
    interactiveAccess: calculateV5SubfactorScore(metrics.interactiveAccessibility, 60, 20),
    crossMediaRelations: calculateV5SubfactorScore(metrics.crossMediaScore, 40, 10)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeAISearchReadiness(metrics) {
  const sub = {
    questionHeadings: calculateV5SubfactorScore(metrics.questionBasedPercentage, 15, 12),
    scannability: calculateV5SubfactorScore(metrics.scannabilityScore, 40, 12),
    readability: calculateV5SubfactorScore(metrics.readabilityPercentage, 50, 12),
    icpFAQs: calculateV5SubfactorScore(metrics.icpFAQScore, 60, 12),
    snippetAnswers: calculateV5SubfactorScore(metrics.snippetScore, 50, 10),
    pillarPages: calculateV5SubfactorScore(metrics.pillarScore, 40, 10),
    internalLinks: calculateV5SubfactorScore(metrics.internalLinksScore, 50, 10),
    painPointsCoverage: calculateV5SubfactorScore(metrics.painPointsScore, 60, 12),
    geoContent: calculateV5SubfactorScore(metrics.geoContentScore, 40, 10)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeContentFreshness(metrics) {
  const sub = {
    lastUpdated: calculateV5SubfactorScore(metrics.lastUpdatedScore, 70, 25),
    versioning: calculateV5SubfactorScore(metrics.versioningScore, 80, 15),
    timeSensitive: calculateV5SubfactorScore(metrics.timeSensitiveScore, 60, 15),
    contentAudit: calculateV5SubfactorScore(metrics.auditScore, 70, 15),
    liveData: calculateV5SubfactorScore(metrics.liveDataScore, 50, 10),
    httpHeaders: calculateV5SubfactorScore(metrics.httpFreshnessScore, 80, 10),
    editorialCalendar: calculateV5SubfactorScore(metrics.editorialScore, 70, 10)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeContentStructure(metrics) {
  const sub = {
    headingHierarchy: calculateV5SubfactorScore(metrics.headingHierarchyScore, 70, 35),
    anchorLinks: calculateV5SubfactorScore(metrics.anchorScore, 60, 20),
    entityCues: calculateV5SubfactorScore(metrics.entityScore, 50, 20),
    accessibility: calculateV5SubfactorScore(metrics.accessibilityScore, 60, 15),
    geoMeta: calculateV5SubfactorScore(metrics.geoMetaScore, 70, 10)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeSpeedUX(metrics) {
  const sub = {
    lcp: calculateV5SubfactorScore(metrics.lcpScore, 70, 25),
    cls: calculateV5SubfactorScore(metrics.clsScore, 80, 25),
    inp: calculateV5SubfactorScore(metrics.inpScore, 70, 25),
    mobileOptimization: calculateV5SubfactorScore(metrics.mobileScore, 80, 15),
    crawlerResponse: calculateV5SubfactorScore(metrics.crawlerResponseScore, 80, 10)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeTechnicalSetup(metrics) {
  const sub = {
    crawlerAccess: calculateV5SubfactorScore(metrics.crawlerAccessScore, 70, 30),
    structuredData: calculateV5SubfactorScore(metrics.structuredDataScore, 60, 30),
    canonical: calculateV5SubfactorScore(metrics.canonicalScore, 80, 10),
    socialMarkup: calculateV5SubfactorScore(metrics.socialMarkupScore, 70, 5),
    sitemap: calculateV5SubfactorScore(metrics.sitemapScore, 70, 10),
    indexNow: calculateV5SubfactorScore(metrics.indexNowScore, 80, 10),
    rssFeeds: calculateV5SubfactorScore(metrics.rssFeedScore, 60, 5)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeTrustAuthority(metrics) {
  const sub = {
    authorBios: calculateV5SubfactorScore(metrics.authorBioScore, 70, 25),
    certifications: calculateV5SubfactorScore(metrics.certificationScore, 60, 15),
    domainAuthority: calculateV5SubfactorScore(metrics.domainAuthorityScore, 60, 25),
    thoughtLeadership: calculateV5SubfactorScore(metrics.thoughtLeadershipScore, 50, 20),
    trustBadges: calculateV5SubfactorScore(metrics.trustBadgeScore, 60, 15)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeVoiceOptimization(metrics) {
  const sub = {
    conversationalPhrases: calculateV5SubfactorScore(metrics.conversationalPhrasesScore, 60, 25),
    localVoice: calculateV5SubfactorScore(metrics.localVoiceScore, 50, 25),
    icpConversational: calculateV5SubfactorScore(metrics.icpConversationalScore, 60, 20),
    featuredSnippets: calculateV5SubfactorScore(metrics.featuredSnippetScore, 50, 15),
    conversationContinuity: calculateV5SubfactorScore(metrics.conversationContinuityScore, 40, 15)
  };
  return { scores: sub, total: sumValues(sub) };
}

// Subfactor scoring with NaN/Infinity guard
function calculateV5SubfactorScore(value, threshold, weight) {
  const safe = Number.isFinite(value) ? value : 0;
  const percentage = Math.min(100, Math.max(0, safe));
  let scoreMultiplier = 0;

  if (percentage >= threshold) scoreMultiplier = 1.0;
  else if (percentage >= threshold * 0.7) scoreMultiplier = 0.8;
  else if (percentage >= threshold * 0.4) scoreMultiplier = 0.5;
  else scoreMultiplier = (threshold > 0 ? (percentage / threshold) : 0) * 0.5;

  return scoreMultiplier * weight;
}

function sumValues(obj) {
  return Object.values(obj).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
}

function debugV5Categories(analysisResults, categoryScores) {
  console.log('\n🔍 V5 CATEGORY DEBUG BREAKDOWN:');
  console.log('=====================================');

  Object.entries(analysisResults).forEach(([category, result]) => {
    console.log(`\n📊 ${category.toUpperCase()}:`);
    console.log(`  - Raw total: ${result.total}`);
    console.log(`  - Final percentage: ${categoryScores[category]}%`);
    console.log(`  - Weight: ${(CATEGORY_WEIGHTS[category] * 100).toFixed(1)}%`);
    console.log(`  - Weighted contribution: ${((categoryScores[category] / 100) * CATEGORY_WEIGHTS[category] * 100).toFixed(2)} points`);
    if (result.scores) console.log(`  - Subfactor scores:`, result.scores);
  });

  const totalExpected = Object.entries(categoryScores)
    .filter(([k]) => k !== 'total')
    .reduce((sum, [k, score]) => sum + ((score / 100) * CATEGORY_WEIGHTS[k] * 100), 0);

  console.log('\n🎯 TOTAL EXPECTED SCORE:', totalExpected.toFixed(2));
}

/**
 * ==========================================
 * Main analysis (V5)
 * ==========================================
 */
function performDetailedAnalysis(websiteData) {
  console.log('\n🚀 Starting V5 detailed analysis...');
  console.log('🌐 URL:', websiteData.url);

  const { html, url } = websiteData;
  const content = extractTextContent(html);
  const industry = detectIndustry(websiteData);
  console.log('🏭 Detected industry:', industry.name);

  const metrics = analyzePageMetrics(html, content, industry, url);

  const analysisResults = {
    aiReadabilityMultimodal: analyzeAIReadabilityMultimodal(metrics),
    aiSearchReadiness: analyzeAISearchReadiness(metrics),
    contentFreshness: analyzeContentFreshness(metrics),
    contentStructure: analyzeContentStructure(metrics),
    speedUX: analyzeSpeedUX(metrics),
    technicalSetup: analyzeTechnicalSetup(metrics),
    trustAuthority: analyzeTrustAuthority(metrics),
    voiceOptimization: analyzeVoiceOptimization(metrics)
  };

  console.log('\n🧮 Calculating final V5 weighted scores...');
  const categoryScores = {};
  let totalWeightedScore = 0;

  for (const [category, result] of Object.entries(analysisResults)) {
    const categoryPercentage = Math.min(100, Math.max(0, result.total));
    categoryScores[category] = Math.round(categoryPercentage * 10) / 10;

    const weight = CATEGORY_WEIGHTS[category];
    const weightedContribution = (categoryPercentage / 100) * weight * 100;
    totalWeightedScore += weightedContribution;

    console.log(`📊 ${category}: ${categoryPercentage.toFixed(1)}% (weighted: ${weightedContribution.toFixed(2)} points)`);
  }

  categoryScores.total = Math.round(totalWeightedScore);
  debugV5Categories(analysisResults, categoryScores);

  const recommendations = generateV5Recommendations(analysisResults, categoryScores, industry);

  return {
    url,
    industry,
    scores: categoryScores,
    analysis: analysisResults,
    recommendations,
    metrics,
    rubricVersion: 'V5',
    analyzedAt: new Date().toISOString()
  };
}

/**
 * ==========================================
 * Recommendations (thresholds aligned to V5)
 * ==========================================
 */
function generateV5Recommendations(_analysis, scores, industry) {
  const recs = [];

  if (scores.aiReadabilityMultimodal < 70) {
    recs.push({
      title: 'Improve Image Alt Text Coverage',
      description: 'Add descriptive alt text to ≥80% of images so AI can understand visual content.',
      impact: 'High',
      category: 'AI Readability & Multimodal Access',
      quickWin: 'Start with product/service images; add concise 5–10 word alt text.'
    });
  }

  if (scores.aiSearchReadiness < 70) {
    recs.push({
      title: 'Add Question-Based Headings & FAQ',
      description: 'Convert H2/H3 into questions and add an ICP-specific FAQ to raise AI citation odds.',
      impact: 'Critical',
      category: 'AI Search Readiness & Content Depth',
      quickWin: `Add FAQ items like “What makes a great ${industry.name}?” and “How to choose the right ${industry.name}?”`
    });
  }

  if (scores.contentFreshness < 60) {
    recs.push({
      title: 'Add Freshness Signals',
      description: 'Show visible “Last Updated” dates and update quarterly to build AI trust.',
      impact: 'Medium',
      category: 'Content Freshness & Maintenance',
      quickWin: 'Add “Last Updated: [Date]” to core pages and keep a lightweight refresh log.'
    });
  }

  if (scores.contentStructure < 70) {
    recs.push({
      title: 'Tighten Heading Hierarchy & Entities',
      description: 'Ensure 1×H1, multiple H2s, at least one H3; name your brand and locations clearly.',
      impact: 'High',
      category: 'Content Structure & Entity Recognition',
      quickWin: 'Audit headings; add entity-rich subheads and anchor IDs for deep links.'
    });
  }

  if (scores.technicalSetup < 70) {
    recs.push({
      title: 'Implement/Expand Structured Data',
      description: 'Add Organization, Service, FAQ, Article, Breadcrumb JSON-LD as applicable.',
      impact: 'Critical',
      category: 'Technical Setup & Structured Data',
      quickWin: 'Start with Organization schema (name, URL, logo, sameAs, contact).'
    });
  }

  if (scores.trustAuthority < 70) {
    recs.push({
      title: 'Boost Authority Signals',
      description: 'Add author bylines with credentials, certifications, third-party profiles/badges.',
      impact: 'High',
      category: 'Trust, Authority & Verification',
      quickWin: 'Add “About the Team” bios with experience, plus G2/Capterra/GBP links.'
    });
  }

  if (scores.voiceOptimization < 70) {
    recs.push({
      title: 'Optimize for Voice/Conversational Search',
      description: 'Use natural Q&A phrasing and 30–60 word answers; anticipate follow-ups.',
      impact: 'Medium',
      category: 'Voice & Conversational Optimization',
      quickWin: `Sprinkle phrases like “best ${industry.name} near me” (if relevant) with short answers.`
    });
  }

  if (scores.speedUX < 70) {
    recs.push({
      title: 'Improve Page Performance',
      description: 'Optimize images, load fewer JS bundles, ensure mobile viewport + lazy-loading.',
      impact: 'Medium',
      category: 'Speed & User Experience',
      quickWin: 'Enable <img loading="lazy">, compress hero images, defer non-critical scripts.'
    });
  }

  return recs.slice(0, 6);
}

/**
 * ===========================
 * Content extraction
 * ===========================
 */
function extractTextContent(html) {
  if (!html || typeof html !== 'string') {
    console.log('⚠️ Invalid HTML provided to extractTextContent');
    return '';
  }
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  console.log('📝 Extracted text content length:', text.length);
  return text;
}

/**
 * ===========================
 * API ROUTES
 * ===========================
 */
router.post('/analyze-website', async (req, res) => {
  try {
    console.log('\n🌐 New V5 website analysis request...');
    const { url } = req.body;

    if (!url) {
      console.log('❌ No URL provided');
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log('🔍 Analyzing URL with V5 rubric:', url);
    const websiteData = await fetchWebsiteContent(url);
    const analysis = performDetailedAnalysis(websiteData);

    console.log('✅ Sending V5 response with scores:', analysis.scores);
    return res.json({ success: true, data: analysis });
  } catch (error) {
    console.error('❌ V5 Website analysis failed:', error);
    return res.status(500).json({ error: 'Website analysis failed', message: error.message });
  }
});

router.post('/test-ai-visibility', async (req, res) => {
  try {
    const { url, industry, queries } = req.body;
    if (!url || !queries || !Array.isArray(queries)) {
      return res.status(400).json({ error: 'URL and queries array are required' });
    }
    const results = await testAIVisibility(url, industry, queries);
    return res.json({ success: true, data: results });
  } catch (error) {
    console.error('AI visibility testing failed:', error);
    return res.status(500).json({ error: 'AI visibility testing failed', message: error.message });
  }
});

/**
 * ===========================
 * Fetch + Visibility harness
 * ===========================
 */
async function fetchWebsiteContent(url) {
  try {
    console.log('📡 Fetching website content from:', url);
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Visibility-Tool/1.0)' }
    });

    console.log('✅ Website fetched. Content length:', (response.data || '').length);
    return {
      html: response.data || '',
      url,
      status: response.status,
      headers: response.headers
    };
  } catch (error) {
    console.error('❌ Failed to fetch website:', error.message);
    throw new Error(`Failed to fetch website: ${error.message}`);
  }
}

async function testAIVisibility(url, industry, queries) {
  const domain = new URL(url).hostname;
  const companyName = extractCompanyName(domain);

  const results = {
    overall: { mentionRate: 0, recommendationRate: 0, citationRate: 0 },
    assistants: {},
    testedQueries: queries.length
  };

  for (const [assistantKey, config] of Object.entries(AI_CONFIGS)) {
    const envKey = process.env[assistantKey.toUpperCase() + '_API_KEY'];
    if (!envKey) {
      results.assistants[assistantKey] = { name: assistantKey, tested: false, reason: 'API key not configured' };
      continue;
    }
    try {
      const assistantResults = await testSingleAssistant(assistantKey, queries, companyName, domain);
      results.assistants[assistantKey] = assistantResults;
    } catch (error) {
      results.assistants[assistantKey] = { name: assistantKey, tested: false, error: error.message };
    }
  }

  calculateOverallMetrics(results);
  return results;
}

async function testSingleAssistant(assistantKey, queries, companyName, domain) {
  const results = { name: assistantKey, tested: true, queries: [], metrics: { mentionRate: 0, recommendationRate: 0, citationRate: 0 } };
  let mentions = 0, recommendations = 0, citations = 0;

  for (const query of queries) {
    try {
      const responseText = await queryAIAssistant(assistantKey, query);
      const analysis = analyzeResponse(responseText, companyName, domain);

      results.queries.push({ query, mentioned: analysis.mentioned, recommended: analysis.recommended, cited: analysis.cited });
      if (analysis.mentioned) mentions++;
      if (analysis.recommended) recommendations++;
      if (analysis.cited) citations++;

      // Be polite to APIs
      await new Promise(res => setTimeout(res, 2000));
    } catch (error) {
      results.queries.push({ query, error: error.message, mentioned: false, recommended: false, cited: false });
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
        model: 'gpt-4o-mini', // or gpt-4 if your account has access
        messages: [{ role: 'user', content: query }],
        max_tokens: 500,
        temperature: 0.7
      };
      break;
    case 'anthropic':
      requestBody = {
        model: 'claude-3-sonnet-20240229',
        max_tokens: 500,
        messages: [{ role: 'user', content: [{ type: 'text', text: query }] }]
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
    headers: { ...config.headers, 'Content-Type': 'application/json' },
    timeout: 30000
  });

  switch (assistant) {
    case 'openai':
    case 'perplexity':
      return response.data?.choices?.[0]?.message?.content || '';
    case 'anthropic':
      return response.data?.content?.[0]?.text || '';
    default:
      throw new Error(`Unknown response format for ${assistant}`);
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
  if (tested.length === 0) return;

  results.overall.mentionRate = tested.reduce((s, a) => s + a.metrics.mentionRate, 0) / tested.length;
  results.overall.recommendationRate = tested.reduce((s, a) => s + a.metrics.recommendationRate, 0) / tested.length;
  results.overall.citationRate = tested.reduce((s, a) => s + a.metrics.citationRate, 0) / tested.length;
}

function extractCompanyName(domain) {
  return domain
    .replace(/^www\./, '')
    .split('.')[0]
    .replace(/[-_]/g, ' ')
    .replace(/\b(inc|llc|corp|ltd)\b/gi, '')
    .trim();
}

// TEMP: discovery debug (you can remove this route later)
// Usage: GET /_debug/discovery?url=https://www.amdocs.com/
router.get('/_debug/discovery', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({ error: 'url query param required' });
    }
    // uses the helpers you added earlier
    const { combinedHtml, discovery, origin, pagesFetched } = await fetchMultiPageSample(url);
    res.json({
      origin,
      pagesFetched,
      robots: discovery.robots,
      sitemaps: discovery.sitemaps,
      sitemapFound: discovery.sitemapFound,
      combinedHtmlSize: combinedHtml.length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});




module.exports = router;
