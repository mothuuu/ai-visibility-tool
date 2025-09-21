// ai-testing.js
// Express router for AI Readiness / AEO analysis (V5 rubric) - Updated for accuracy and expanded industries

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
 * Expanded Industry detection
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
    },
    // Expanded verticals based on common B2B industries
    {
      key: 'real_estate',
      name: 'Real Estate',
      keywords: ['real estate', 'property', 'house hunting', 'apartment', 'realtor', 'mortgage', 'listing'],
      domainKeywords: ['realestate', 'realtor', 'property', 'homes', 'zillow'],
      painPoints: ['buyer research', 'competition', 'local market', 'closing deals', 'online visibility']
    },
    {
      key: 'food_beverages',
      name: 'Food & Beverages',
      keywords: ['restaurant', 'food service', 'beverages', 'catering', 'menu', 'dining', 'culinary'],
      domainKeywords: ['restaurant', 'food', 'beverage', 'cafe', 'bar'],
      painPoints: ['reviews', 'customer loyalty', 'competition', 'supply chain', 'online ordering']
    },
    {
      key: 'travel_hospitality',
      name: 'Travel & Hospitality',
      keywords: ['travel', 'hotel', 'hospitality', 'booking', 'vacation', 'resort', 'tourism'],
      domainKeywords: ['travel', 'hotel', 'hospitality', 'booking', 'trip'],
      painPoints: ['seasonal trends', 'customer research', 'low margins', 'data quality', 'personalization']
    },
    {
      key: 'b2b_software',
      name: 'B2B Software/SaaS',
      keywords: ['saas', 'software', 'b2b', 'enterprise', 'crm', 'erp', 'cloud software'],
      domainKeywords: ['saas', 'software', 'b2b', 'enterprise', 'crm'],
      painPoints: ['sales cycles', 'qualified leads', 'niche markets', 'integration', 'adoption']
    },
    {
      key: 'home_garden',
      name: 'Home & Garden',
      keywords: ['home improvement', 'garden', 'interior design', 'furniture', 'landscaping', 'diy'],
      domainKeywords: ['home', 'garden', 'interior', 'furniture', 'diy'],
      painPoints: ['seasonal sales', 'promotions', 'weather impact', 'local sourcing', 'trends']
    },
    {
      key: 'ecommerce',
      name: 'E-Commerce',
      keywords: ['ecommerce', 'online store', 'shopping cart', 'retail', 'product catalog', 'dropshipping'],
      domainKeywords: ['shop', 'store', 'ecom', 'cart', 'buy'],
      painPoints: ['cart abandonment', 'conversions', 'keyword targeting', 'inventory', 'shipping']
    },
    {
      key: 'healthcare',
      name: 'Healthcare',
      keywords: ['healthcare', 'medical', 'hospital', 'patient care', 'pharmaceutical', 'telemedicine'],
      domainKeywords: ['health', 'medical', 'hospital', 'clinic', 'pharma'],
      painPoints: ['regulations', 'terminology', 'patient privacy', 'insurance', 'access']
    },
    {
      key: 'law',
      name: 'Legal Services',
      keywords: ['law firm', 'attorney', 'legal', 'litigation', 'contract', 'compliance'],
      domainKeywords: ['law', 'attorney', 'legal', 'firm', 'esq'],
      painPoints: ['expensive keywords', 'qualified clients', 'competition', 'case intake', 'reviews']
    },
    {
      key: 'higher_education',
      name: 'Higher Education',
      keywords: ['university', 'college', 'education', 'admissions', 'tuition', 'campus', 'degree'],
      domainKeywords: ['edu', 'university', 'college', 'school'],
      painPoints: ['long sales cycles', 'regulations', 'student research', 'enrollment', 'funding']
    },
    {
      key: 'retail',
      name: 'Retail',
      keywords: ['retail', 'store', 'merchandise', 'sales', 'inventory', 'customer service'],
      domainKeywords: ['retail', 'store', 'shop', 'mall'],
      painPoints: ['online research', 'competition', 'inventory management', 'returns', 'foot traffic']
    }
  ];

  let bestMatch = industries[industries.length - 1]; // default to last
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
 * Core page metrics extraction per V5 rubric (refined for accuracy)
 * ==================================================
 */
function analyzePageMetrics(html, content, industry, url, discovery = {}) {

  console.log('\n🔬 Analyzing page metrics with V5 rubric...');
  console.log('📄 HTML length:', html.length);
  console.log('📝 Content length:', content.length);

  const words = content.split(/\s+/).filter(Boolean);
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);

  // === AI READABILITY & MULTIMODAL ACCESS ===

  // Images & alt coverage (threshold 80%)
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

  // AV media & captions (threshold 50%)
  const videoMatches = html.match(/<video[^>]*>/gi) || [];
  const audioMatches = html.match(/<audio[^>]*>/gi) || [];
  const captionMatches = html.match(/<track[^>]+kind\s*=\s*["']captions["'][^>]*>/gi) || [];
  const transcriptIndicators = /transcript|subtitles|captions/i.test(content);
  const totalAvMedia = videoMatches.length + audioMatches.length;
  const captionPercentage = totalAvMedia > 0 ? ((captionMatches.length + (transcriptIndicators ? 1 : 0)) / totalAvMedia) * 100 : 100;

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

  // Pillar pages & internal links (>=5 subpages)
  const pillarIndicators = /complete\s*guide|ultimate\s*guide|everything\s*about|comprehensive|hub|resource\s*center/i.test(content);
  const internalLinks = (html.match(/<a[^>]+href\s*=\s*["'][^"']+["'][^>]*>/gi) || [])
    .filter(link => {
      const href = (link.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] || '').trim();
      if (!href) return false;
      if (href.startsWith('#')) return false;
      return !/^https?:\/\//i.test(href) || href.includes(new URL(url).hostname);
    }).length;
  const pillarScore = pillarIndicators ? 60 + Math.min(40, Math.floor(internalLinks / 5) * 10) : Math.min(30, Math.floor(internalLinks / 3) * 10);

  // Pain points coverage (>=3)
  const painPointMatches = industry.painPoints.filter(p => content.includes(p.toLowerCase())).length;
  const painPointsScore = Math.min(100, (painPointMatches / industry.painPoints.length) * 100);

  // Geo content / case studies
  const phoneRe = /\+?\d[\d\s().-]{7,}/;
  const addressHints = /\b(ave|avenue|st|street|rd|road|blvd|suite|ste\.|floor|fl|building|campus|parkway|drive|dr)\b/i;
  const worldCities = /\b(paris|london|new york|dallas|madrid|tel aviv|singapore|são paulo|tokyo|sydney|toronto|vancouver|bangalore|pune|mumbai|seattle|boston|chicago|miami|san jose|los angeles|berlin|munich|amsterdam|zurich)\b/i;
  const caseStudyIndicators = /case\s*study|success\s*story|client\s*story|testimonial/i.test(content);
  const geoHits = [phoneRe, addressHints, worldCities].reduce((s, re) => s + (re.test(content) ? 1 : 0), 0) + (caseStudyIndicators ? 1 : 0);
  const geoContentScore = Math.min(100, geoHits * 25);

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

  const hasETagsInMarkup = /etag|last-modified/i.test(html); // heuristic
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
  const geoInMeta = worldCities.test(html) || addressHints.test(html);
  const geoMetaScore = geoInMeta ? 100 : 0;

  // === SPEED & UX (heuristics) ===
  const htmlSize = html.length;
  const scriptMatches = html.match(/<script[^>]*>/gi) || [];
  const lcpEstimate = htmlSize > 50000 || scriptMatches.length > 10 ? 40 : 80; // low if heavy
  const clsEstimate = 80; // default good
  const inpEstimate = 80;
  const mobilePass = /viewport/i.test(html) ? 100 : 50;
  const crawlerTime = discovery.sitemapFound ? 100 : 60;
  const speedScore = (lcpEstimate * 0.25) + (clsEstimate * 0.25) + (inpEstimate * 0.25) + (mobilePass * 0.15) + (crawlerTime * 0.1);

  // === TECHNICAL SETUP ===
  const robotsAllow = discovery.robots && !discovery.robots.hasBlanketDisallow ? 100 : 50;
  const structuredData = parseStructuredData(html);
  const sdCoverage = structuredData.types.length * 20; // Org/Service/FAQ etc.
  const canonical = /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html) ? 100 : 0;
  const openGraph = /property=["']og:/i.test(html) ? 100 : 0;
  const sitemapSubmitted = discovery.sitemapFound ? 100 : 0;
  const indexNow = /indexnow/i.test(html) ? 100 : 0;
  const rssFeed = /<link[^>]+rel=["']alternate["'][^>]+rss/i.test(html) ? 100 : 0;
  const techScore = (robotsAllow * 0.3) + (sdCoverage * 0.3) + (canonical * 0.1) + (openGraph * 0.05) + (sitemapSubmitted * 0.1) + (indexNow * 0.1) + (rssFeed * 0.05);

  // === TRUST & AUTHORITY ===
  const authorBios = /author|byline|written\s*by/i.test(content) ? 100 : 0;
  const certifications = /certified|license|accredited|member/i.test(content) ? 100 : 0;
  const daEstimate = Math.min(100, (words.length / 1000) * 10 + internalLinks * 2); // heuristic
  const citations = /cited|source|reference/i.test(content) ? 100 : 0;
  const thirdParty = /g2|clutch|capterra|trustpilot/i.test(content) ? 100 : 0;
  const trustScore = (authorBios * 0.25) + (certifications * 0.15) + (daEstimate * 0.25) + (citations * 0.2) + (thirdParty * 0.15);

  // === VOICE OPTIMIZATION ===
  const longTailPhrases = content.match(/\b\w+\s+\w+\s+\w+\s+\w+\b/gi) || []; // >=4 words
  const longTailScore = longTailPhrases.length > 10 ? 100 : 50;
  const localIntents = /near\s*me|local|in\s*\w+/i.test(content) ? 100 : 0;
  const icpConversational = industry.painPoints.filter(p => content.includes(`how to ${p}`)).length * 20;
  const featuredSnippets = snippetScore; // reuse
  const followUps = /related|next|further|additionally/i.test(content) ? 100 : 0;
  const voiceScore = (longTailScore * 0.25) + (localIntents * 0.25) + (icpConversational * 0.2) + (featuredSnippets * 0.15) + (followUps * 0.15);

  return {
    // AI Readability
    altTextCoverage: imageAltPercentage,
    videoCaptions: captionPercentage,
    interactiveAccess: interactiveAccessibility,
    crossMediaRelations: crossMediaScore,
    // AI Search
    questionHeadings: questionBasedPercentage,
    scannability: scannabilityScore,
    readability: readabilityPercentage,
    icpFAQs: icpFAQScore,
    snippetAnswers: snippetScore,
    pillarPages: pillarScore,
    internalLinks: internalLinks >= 5 ? 100 : (internalLinks / 5 * 100),
    painPointsCoverage: painPointsScore,
    geoContent: geoContentScore,
    // Freshness
    lastUpdated: lastUpdatedScore,
    versioning: versioningScore,
    timeSensitive: timeSensitiveScore,
    audit: auditScore,
    liveData: liveDataScore,
    httpFreshness: httpFreshnessScore,
    editorial: editorialScore,
    // Structure
    headingHierarchy: headingHierarchyScore,
    anchorIds: anchorScore,
    entityCues: entityScore,
    accessibility: accessibilityScore,
    geoMeta: geoMetaScore,
    // Speed
    lcp: lcpEstimate,
    cls: clsEstimate,
    inp: inpEstimate,
    mobileCWV: mobilePass,
    crawlerResponse: crawlerTime,
    // Tech
    aiCrawlerAccess: robotsAllow,
    structuredDataCoverage: sdCoverage,
    canonicalHreflang: canonical,
    openGraphOembed: openGraph,
    xmlSitemap: sitemapSubmitted,
    indexNow: indexNow,
    rssFeed: rssFeed,
    // Trust
    authorBios: authorBios,
    certifications: certifications,
    domainAuthority: daEstimate,
    industryCitations: citations,
    thirdPartyProfiles: thirdParty,
    // Voice
    longTailConversational: longTailScore,
    localNearMe: localIntents,
    icpConversational: Math.min(100, icpConversational),
    featuredSnippets: featuredSnippets,
    anticipatedFollowups: followUps
  };
}

// Helper functions (assumed from original, refined)
function estimateSyllables(words) {
  return words.reduce((s, w) => s + (w.length > 1 ? Math.floor(w.length / 2) : 1), 0); // simple approx
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSnippetAnswers(content) {
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.filter(s => s.split(/\s+/).length >= 40 && s.split(/\s+/).length <= 60);
}

function detectEntityCues(content, industry) {
  const names = (content.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) || []).length / 2; // approx people
  const products = (content.match(new RegExp(industry.keywords.join('|'), 'gi')) || []).length;
  const places = (content.match(/\b[A-Z][a-z]+(?:\s+(?:City|State|Province|District))\b/g) || []).length;
  return { names, products, places };
}

function parseStructuredData(html) {
  const jsonLd = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const types = [];
  jsonLd.forEach(script => {
    try {
      const data = JSON.parse(script.replace(/<[^>]+>/g, ''));
      if (data['@type']) types.push(data['@type']);
    } catch (e) {}
  });
  return { types };
}

// Analysis functions (refined weights/thresholds per rubric)
function analyzeAIReadabilityMultimodal(metrics) {
  const sub = {
    altTextCoverage: calculateV5SubfactorScore(metrics.altTextCoverage, 80, 35),
    videoCaptions: calculateV5SubfactorScore(metrics.videoCaptions, 50, 35),
    interactiveAccess: calculateV5SubfactorScore(metrics.interactiveAccess, 70, 20), // inferred
    crossMediaRelations: calculateV5SubfactorScore(metrics.crossMediaRelations, 40, 10)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeAISearchReadiness(metrics) {
  const sub = {
    questionHeadings: calculateV5SubfactorScore(metrics.questionHeadings, 50, 12),
    scannability: calculateV5SubfactorScore(metrics.scannability, 60, 12),
    readability: calculateV5SubfactorScore(metrics.readability, 60, 12),
    icpFAQs: calculateV5SubfactorScore(metrics.icpFAQs, 80, 12),
    snippetAnswers: calculateV5SubfactorScore(metrics.snippetAnswers, 50, 10),
    pillarPages: calculateV5SubfactorScore(metrics.pillarPages, 60, 10),
    internalLinks: calculateV5SubfactorScore(metrics.internalLinks, 100, 10), // >=5 =100
    painPointsCoverage: calculateV5SubfactorScore(metrics.painPointsCoverage, 75, 12), // >=3/4
    geoContent: calculateV5SubfactorScore(metrics.geoContent, 50, 10)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeContentFreshness(metrics) {
  const sub = {
    lastUpdated: calculateV5SubfactorScore(metrics.lastUpdated, 70, 25),
    versioning: calculateV5SubfactorScore(metrics.versioning, 100, 15),
    timeSensitive: calculateV5SubfactorScore(metrics.timeSensitive, 50, 15),
    audit: calculateV5SubfactorScore(metrics.audit, 100, 15),
    liveData: calculateV5SubfactorScore(metrics.liveData, 50, 10),
    httpFreshness: calculateV5SubfactorScore(metrics.httpFreshness, 100, 10),
    editorial: calculateV5SubfactorScore(metrics.editorial, 100, 10)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeContentStructure(metrics) {
  const sub = {
    headingHierarchy: calculateV5SubfactorScore(metrics.headingHierarchy, 100, 35),
    anchorIds: calculateV5SubfactorScore(metrics.anchorIds, 50, 20),
    entityCues: calculateV5SubfactorScore(metrics.entityCues, 60, 20),
    accessibility: calculateV5SubfactorScore(metrics.accessibility, 50, 15),
    geoMeta: calculateV5SubfactorScore(metrics.geoMeta, 100, 10)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeSpeedUX(metrics) {
  const sub = {
    lcp: calculateV5SubfactorScore(metrics.lcp, 75, 25),
    cls: calculateV5SubfactorScore(metrics.cls, 90, 25),
    inp: calculateV5SubfactorScore(metrics.inp, 90, 25),
    mobileCWV: calculateV5SubfactorScore(metrics.mobileCWV, 100, 15),
    crawlerResponse: calculateV5SubfactorScore(metrics.crawlerResponse, 80, 10)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeTechnicalSetup(metrics) {
  const sub = {
    aiCrawlerAccess: calculateV5SubfactorScore(metrics.aiCrawlerAccess, 100, 30),
    structuredDataCoverage: calculateV5SubfactorScore(metrics.structuredDataCoverage, 100, 30),
    canonicalHreflang: calculateV5SubfactorScore(metrics.canonicalHreflang, 100, 10),
    openGraphOembed: calculateV5SubfactorScore(metrics.openGraphOembed, 100, 5),
    xmlSitemap: calculateV5SubfactorScore(metrics.xmlSitemap, 100, 10),
    indexNow: calculateV5SubfactorScore(metrics.indexNow, 100, 10),
    rssFeed: calculateV5SubfactorScore(metrics.rssFeed, 100, 5)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeTrustAuthority(metrics) {
  const sub = {
    authorBios: calculateV5SubfactorScore(metrics.authorBios, 100, 25),
    certifications: calculateV5SubfactorScore(metrics.certifications, 100, 15),
    domainAuthority: calculateV5SubfactorScore(metrics.domainAuthority, 50, 25),
    industryCitations: calculateV5SubfactorScore(metrics.industryCitations, 100, 20),
    thirdPartyProfiles: calculateV5SubfactorScore(metrics.thirdPartyProfiles, 100, 15)
  };
  return { scores: sub, total: sumValues(sub) };
}

function analyzeVoiceOptimization(metrics) {
  const sub = {
    longTailConversational: calculateV5SubfactorScore(metrics.longTailConversational, 100, 25),
    localNearMe: calculateV5SubfactorScore(metrics.localNearMe, 100, 25),
    icpConversational: calculateV5SubfactorScore(metrics.icpConversational, 80, 20),
    featuredSnippets: calculateV5SubfactorScore(metrics.featuredSnippets, 50, 15),
    anticipatedFollowups: calculateV5SubfactorScore(metrics.anticipatedFollowups, 50, 15)
  };
  return { scores: sub, total: sumValues(sub) };
}

// Subfactor scoring with NaN/Infinity guard (tweaked for conservatism: unknown=0.3)
function calculateV5SubfactorScore(value, threshold, weight) {
  if (value === null || value === undefined) return 0.3 * weight; // reduced partial credit
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
function performDetailedAnalysis(websiteData, discovery = {}) {

  console.log('\n🚀 Starting V5 detailed analysis...');
  console.log('🌐 URL:', websiteData.url);

  const { html, url } = websiteData;
  const content = extractTextContent(html);
  const industry = detectIndustry(websiteData);
  console.log('🏭 Detected industry:', industry.name);

  const metrics = analyzePageMetrics(html, content, industry, url, discovery);

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
function generateV5Recommendations(analysis, scores, industry) {
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

    console.log('🔍 Multi-page sampling + robots/sitemap for:', url);
    const { combinedHtml, discovery, origin, pagesFetched } = await fetchMultiPageSample(url);

    if (!combinedHtml) {
      return res.status(500).json({ error: 'Failed to fetch website content' });
    }

    const websiteData = { html: combinedHtml, url };
    const analysis = performDetailedAnalysis(websiteData, discovery);

    console.log('✅ Sending V5 response with scores:', analysis.scores);
    return res.json({
      success: true,
      data: {
        ...analysis,
        discovery: {
          origin,
          pagesFetched,
          robots: discovery.robots,
          sitemaps: discovery.sitemaps,
          sitemapFound: discovery.sitemapFound
        }
      }
    });
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

// Visibility testing (unchanged)
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
        model: 'gpt-4o-mini',
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

module.exports = router;
