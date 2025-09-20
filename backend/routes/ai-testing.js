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

// V5 Category Weights - Total 100%
const CATEGORY_WEIGHTS = {
  aiReadabilityMultimodal: 0.10,      // 10%
  aiSearchReadiness: 0.20,            // 20%
  contentFreshness: 0.08,             // 8%
  contentStructure: 0.15,             // 15%
  speedUX: 0.05,                      // 5%
  technicalSetup: 0.18,               // 18%
  trustAuthority: 0.12,               // 12%
  voiceOptimization: 0.12             // 12%
};

// Industry detection remains the same
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

// V5 Comprehensive Metrics Analysis
function analyzePageMetrics(html, content, industry, url) {
  console.log('\n🔬 Analyzing page metrics with V5 rubric...');
  console.log('📄 HTML length:', html.length);
  console.log('📝 Content length:', content.length);
  
  const words = content.split(/\s+/).filter(word => word.length > 0);
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  // === AI READABILITY & MULTIMODAL ACCESS METRICS ===
  
  // === ENHANCED Image Analysis ===
  const imageMatches = html.match(/<img[^>]*>/gi) || [];

  // Improved alt text detection - catches multiple patterns
  const altPatterns = [
    /<img[^>]*alt\s*=\s*"[^"]*"[^>]*>/gi,           // alt="text"
    /<img[^>]*alt\s*=\s*'[^']*'[^>]*>/gi,           // alt='text'
    /<img[^>]*alt\s*=\s*[^>\s]+[^>]*>/gi            // alt=text (no quotes)
  ];

  let altMatches = [];
  altPatterns.forEach(pattern => {
    const matches = html.match(pattern) || [];
    altMatches = altMatches.concat(matches);
  });

  // Remove duplicates (same image caught by multiple patterns)
  const uniqueAltMatches = [...new Set(altMatches)];
  const imageAltPercentage = imageMatches.length > 0 ? (uniqueAltMatches.length / imageMatches.length) * 100 : 100;

  // Enhanced debugging
  console.log('\n🖼️ ENHANCED IMAGE ANALYSIS:');
  console.log(`  - Total images found: ${imageMatches.length}`);
  console.log(`  - Images with alt text: ${uniqueAltMatches.length}`);
  console.log(`  - Alt text coverage: ${imageAltPercentage.toFixed(1)}%`);

  // Debug first 3 images for verification
  if (imageMatches.length > 0) {
    console.log('  - Sample image analysis:');
    imageMatches.slice(0, 3).forEach((img, index) => {
      const hasAlt = /alt\s*=\s*(["][^"]*["]|['][^']*[']|[^>\s]+)/i.test(img);
      const altText = img.match(/alt\s*=\s*(["][^"]*["]|['][^']*[']|[^>\s]+)/i)?.[1] || 'none';
      console.log(`    ${index + 1}. ${hasAlt ? '✅' : '❌'} Alt: ${altText.substring(0, 30)}...`);
    });
  }
    
  // Video and audio analysis
  const videoMatches = html.match(/<video[^>]*>/gi) || [];
  const audioMatches = html.match(/<audio[^>]*>/gi) || [];
  const captionMatches = html.match(/<track[^>]+kind\s*=\s*["']captions["'][^>]*>/gi) || [];
  const transcriptIndicators = /transcript|subtitles|captions/i.test(content);
  const totalMedia = videoMatches.length + audioMatches.length;
  const captionPercentage = totalMedia > 0 ? ((captionMatches.length + (transcriptIndicators ? 1 : 0)) / totalMedia) * 100 : 0;
  
  // Interactive media accessibility
  const interactiveMedia = html.match(/<(canvas|svg|iframe|embed|object)[^>]*>/gi) || [];
  const accessibleInteractive = html.match(/aria-label|aria-labelledby|role=/gi) || [];
  const interactiveAccessibility = interactiveMedia.length > 0 ? (accessibleInteractive.length / interactiveMedia.length) * 100 : 100;
  
  // === ENHANCED Cross-media Relationships ===
  const imageReferences = (content.match(/image|photo|picture|screenshot|diagram|chart|visual|graphic/gi) || []).length;
  const videoReferences = (content.match(/video|watch|demonstration|tutorial|webinar|recording|stream/gi) || []).length;
  const totalMediaReferences = imageReferences + videoReferences;
  const totalImages = imageMatches.length;
  const totalVideos = videoMatches.length;
  const totalMedia = totalImages + totalVideos;

  // Fixed scoring logic - no longer penalizes longer content
  let crossMediaScore = 0;
  if (totalMedia > 0) {
    // Score based on how well media is referenced in text
    const mediaToReferenceRatio = totalMediaReferences > 0 ? Math.min(100, (totalMediaReferences / totalMedia) * 100) : 0;
    
    // Bonus for media diversity
    const mediaVarietyBonus = (totalImages > 0 ? 15 : 0) + (totalVideos > 0 ? 15 : 0);
    
    // Base score for having cross-references
    const baseScore = totalMediaReferences > 0 ? 20 : 0;
    
    crossMediaScore = Math.min(100, baseScore + (mediaToReferenceRatio * 0.5) + mediaVarietyBonus);
  } else if (totalMediaReferences > 0) {
    // Has media references but no actual media elements
    crossMediaScore = 25;
  }

  console.log('\n🎬 CROSS-MEDIA ANALYSIS:');
  console.log(`  - Image references in text: ${imageReferences}`);
  console.log(`  - Video references in text: ${videoReferences}`);
  console.log(`  - Total media elements: ${totalMedia}`);
  console.log(`  - Cross-media score: ${crossMediaScore.toFixed(1)}`);

  
  // === AI SEARCH READINESS & CONTENT DEPTH METRICS ===
  
  // Heading analysis
  const h1Matches = html.match(/<h1[^>]*>.*?<\/h1>/gi) || [];
  const h2h3Matches = html.match(/<h[2-3][^>]*>.*?<\/h[2-3]>/gi) || [];
  const allHeadingMatches = html.match(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi) || [];
  const questionHeadingMatches = h2h3Matches.filter(h => /\?(.*?)<\/h[2-3]>/i.test(h));
  const questionBasedPercentage = h2h3Matches.length > 0 ? (questionHeadingMatches.length / h2h3Matches.length) * 100 : 0;
  
  // Lists and tables for scannability
  const listMatches = html.match(/<(ul|ol)[^>]*>/gi) || [];
  const tableMatches = html.match(/<table[^>]*>/gi) || [];
  const stepsIndicators = /step \d|steps:|procedure|process|how to/gi.test(content);
  const scannabilityScore = Math.min(100, (listMatches.length * 15) + (tableMatches.length * 20) + (stepsIndicators ? 25 : 0));
  
  // Readability (Flesch Reading Ease approximation)
  const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : 15;
  const avgSyllablesPerWord = estimateSyllables(words) / words.length;
  const fleschScore = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
  const readabilityPercentage = Math.max(0, Math.min(100, fleschScore));
  
  // ICP-specific FAQs
  const hasFAQSection = /faq|frequently.asked|questions.and.answers|q&a/i.test(html);
  const industryQuestions = industry.painPoints.filter(pain => 
    new RegExp(`(what|how|why|when).*${pain}`, 'i').test(content)
  ).length;
  const icpFAQScore = hasFAQSection ? 80 + Math.min(20, industryQuestions * 10) : Math.min(50, industryQuestions * 15);
  
  // Snippet-eligible answers (40-60 words)
  const snippetAnswers = findSnippetAnswers(content);
  const snippetScore = Math.min(100, snippetAnswers.length * 25);
  
  // Pillar pages and internal links
  const pillarIndicators = /complete.guide|ultimate.guide|everything.about|comprehensive|hub|resource.center/i.test(content);
  const internalLinks = (html.match(/<a[^>]+href\s*=\s*["'][^"']*["'][^>]*>/gi) || []).filter(link => 
    !link.includes('http') || link.includes(new URL(url).hostname)
  ).length;
  const pillarScore = pillarIndicators ? 60 + Math.min(40, Math.floor(internalLinks / 5) * 10) : Math.min(30, Math.floor(internalLinks / 3) * 10);
  
  // Pain points coverage
  const painPointMatches = industry.painPoints.filter(pain => 
    content.toLowerCase().includes(pain.toLowerCase())
  ).length;
  const painPointsScore = Math.min(100, (painPointMatches / industry.painPoints.length) * 100);
  
  // Geographic content and case studies
  const geoTerms = ['local', 'ontario', 'toronto', 'canada', 'region', 'area', 'case study', 'client story', 'success story'];
  const geoMatches = geoTerms.filter(term => content.toLowerCase().includes(term.toLowerCase())).length;
  const geoContentScore = Math.min(100, geoMatches * 15);
  
  // === CONTENT FRESHNESS & MAINTENANCE METRICS ===
  
  // Last updated indicators
  const lastUpdatedMatch = /last.updated|updated.on|modified|revised/i.test(content);
  const visibleDates = content.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/gi) || [];
  const recentDates = visibleDates.filter(date => {
    const year = parseInt(date.match(/\d{4}/)?.[0]);
    return year >= new Date().getFullYear() - 1;
  }).length;
  const lastUpdatedScore = lastUpdatedMatch ? 70 + Math.min(30, recentDates * 15) : Math.min(40, recentDates * 20);
  
  // Version tracking
  const versioningIndicators = /version|v\d|revision|changelog|release.notes|updates/i.test(content);
  const versioningScore = versioningIndicators ? 100 : 0;
  
  // Time-sensitive content handling
  const timeSensitiveTerms = /current|latest|2024|2025|this.year|recent|new|now/gi;
  const timeSensitiveMatches = content.match(timeSensitiveTerms) || [];
  const timeSensitiveScore = Math.min(100, (timeSensitiveMatches.length / words.length) * 1000);
  
  // Content audit processes
  const auditIndicators = /reviewed|audited|verified|quality.checked|maintained/i.test(content);
  const auditScore = auditIndicators ? 100 : 0;
  
  // Live data indicators
  const liveDataTerms = /live|real.time|dynamic|up.to.date|current.status/gi;
  const liveDataMatches = content.match(liveDataTerms) || [];
  const liveDataScore = Math.min(100, liveDataMatches.length * 25);
  
  // HTTP freshness headers (simulated based on content patterns)
  const hasETags = html.includes('etag') || html.includes('last-modified');
  const httpFreshnessScore = hasETags ? 100 : 0;
  
  // Editorial calendar signals
  const editorialSignals = /blog.schedule|content.calendar|publishing.schedule|editorial/i.test(content);
  const editorialScore = editorialSignals ? 100 : 0;
  
  // === CONTENT STRUCTURE & ENTITY RECOGNITION METRICS ===
  
  // Proper heading hierarchy
  const hasProperH1 = h1Matches.length === 1;
  const hasH2s = (html.match(/<h2[^>]*>/gi) || []).length >= 2;
  const hasH3s = (html.match(/<h3[^>]*>/gi) || []).length >= 1;
  const headingHierarchyScore = (hasProperH1 ? 35 : 0) + (hasH2s ? 35 : 0) + (hasH3s ? 30 : 0);
  
  // Anchor IDs and navigation
  const anchorIds = html.match(/id\s*=\s*["'][^"']*["']/gi) || [];
  const tocIndicators = /table.of.contents|toc|jump.to|navigate/i.test(content);
  const anchorScore = Math.min(100, (anchorIds.length * 10) + (tocIndicators ? 50 : 0));
  
  // Entity cues (names, products, places)
  const entityCues = detectEntityCues(content, industry);
  const entityScore = Math.min(100, (entityCues.names * 8) + (entityCues.products * 10) + (entityCues.places * 12));
  
  // Accessibility indicators
  const accessibilityFeatures = html.match(/aria-|role=|tabindex|alt=/gi) || [];
  const accessibilityScore = Math.min(100, accessibilityFeatures.length * 5);
  
  // Geographic meta descriptions
  const hasMetaDescription = html.includes('name="description"');
  const geoInMeta = /ontario|toronto|canada|local/i.test(html);
  const geoMetaScore = hasMetaDescription ? (geoInMeta ? 100 : 50) : 0;
  
  // === SPEED & USER EXPERIENCE METRICS ===
  
  // Performance estimation (since we can't measure actual Core Web Vitals)
  const performanceMetrics = estimatePerformanceMetrics(html);
  
  // === TECHNICAL SETUP & STRUCTURED DATA METRICS ===
  
  // AI crawler access
  const crawlerFriendly = !html.includes('noindex') && !html.includes('nofollow');
  const hasCDN = /cdn\.|cloudflare|cloudfront|fastly/i.test(html);
  const crawlerAccessScore = (crawlerFriendly ? 60 : 20) + (hasCDN ? 40 : 0);
  
  // Structured data analysis
  const structuredDataAnalysis = analyzeStructuredData(html);

  // Canonical and hreflang
  const hasCanonical = html.includes('rel="canonical"');
  const hasHreflang = html.includes('hreflang=');
  const canonicalScore = (hasCanonical ? 70 : 0) + (hasHreflang ? 30 : 0);

  // Open Graph and social markup
  const hasOpenGraph = html.includes('property="og:');
  const hasTwitterCards = html.includes('name="twitter:');
  const socialMarkupScore = (hasOpenGraph ? 70 : 0) + (hasTwitterCards ? 30 : 0);

  // XML sitemap and feeds
  const hasSitemap = /sitemap|sitemap\.xml/i.test(html);
  const hasRSSFeed = html.includes('application/rss+xml') || html.includes('application/atom+xml');
  const sitemapScore = (hasSitemap ? 60 : 0) + (hasRSSFeed ? 40 : 0);

  // IndexNow
  const hasIndexNow = html.includes('indexnow') || /api\.indexnow\./i.test(html);
  const indexNowScore = hasIndexNow ? 100 : 0;
  
  // === TRUST, AUTHORITY & VERIFICATION METRICS ===
  
  // Author bios and credentials
  const authorBioAnalysis = analyzeAuthorBios(content);
  
  // Certifications and memberships
  const certificationTerms = /certified|licensed|accredited|iso.9001|iso.27001|member.of|association/gi;
  const certificationMatches = content.match(certificationTerms) || [];
  const certificationScore = Math.min(100, certificationMatches.length * 20);
  
  // Domain authority estimation (based on content quality indicators)
  const domainAuthorityEstimate = estimateDomainAuthority(content, html);
  
  // Industry citations and thought leadership
  const thoughtLeadershipAnalysis = analyzeThoughtLeadership(content);
  
  // Third-party verification
  const trustBadgeAnalysis = analyzeTrustBadges(content, html);
  
  // === VOICE & CONVERSATIONAL OPTIMIZATION METRICS ===
  
  // Long-tail conversational phrases
  const conversationalPhrases = analyzeConversationalContent(content);
  
  // Local voice search optimization
  const localVoiceAnalysis = analyzeLocalVoiceOptimization(content);
  
  // ICP conversational terms
  const icpConversationalAnalysis = analyzeICPConversationalTerms(content, industry);
  
  // Featured snippet optimization
  const featuredSnippetAnalysis = analyzeFeaturedSnippetOptimization(content);
  
  // Multi-turn conversation support
  const conversationContinuityAnalysis = analyzeConversationContinuity(content);
  
  return {
    // AI Readability & Multimodal Access
    imageAltPercentage,
    videoCaptionPercentage: captionPercentage,
    interactiveAccessibility,
    crossMediaScore,
    
    // AI Search Readiness & Content Depth
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
    
    // Speed & User Experience
    ...performanceMetrics,
    
    // Technical Setup & Structured Data
    crawlerAccessScore,
    structuredDataScore: structuredDataAnalysis.score,
    canonicalScore,
    socialMarkupScore,
    sitemapScore,
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

// === HELPER FUNCTIONS ===

function estimateSyllables(words) {
  return words.reduce((total, word) => {
    const syllableCount = word.toLowerCase().match(/[aeiouy]+/g) || [];
    return total + Math.max(1, syllableCount.length);
  }, 0);
}

function findSnippetAnswers(content) {
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.filter(sentence => {
    const words = sentence.split(/\s+/).filter(w => w.length > 0);
    return words.length >= 40 && words.length <= 60;
  });
}

function analyzeStructuredData(html) {
  const jsonLdBlocks = html.match(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const structuredDataTypes = new Set();
  
  jsonLdBlocks.forEach(block => {
    try {
      const jsonContent = block.replace(/<script[^>]*>|<\/script>/gi, '');
      const data = JSON.parse(jsonContent);
      const type = data['@type'] || (Array.isArray(data) ? data.map(item => item['@type']).join(',') : '');
      if (type) structuredDataTypes.add(type.toLowerCase());
    } catch (e) {
      // Invalid JSON, skip
    }
  });
  
  // Check for microdata
  const microdataTypes = html.match(/itemtype\s*=\s*["']([^"']+)["']/gi) || [];
  microdataTypes.forEach(match => {
    const type = match.match(/itemtype\s*=\s*["']([^"']+)["']/i)?.[1];
    if (type) structuredDataTypes.add(type.split('/').pop().toLowerCase());
  });
  
  const requiredTypes = ['organization', 'service', 'faqpage', 'article', 'breadcrumblist'];
  const foundTypes = requiredTypes.filter(type => 
    Array.from(structuredDataTypes).some(found => found.includes(type))
  );
  
  return {
    score: Math.min(100, (foundTypes.length / requiredTypes.length) * 100 + (structuredDataTypes.size > 5 ? 20 : structuredDataTypes.size * 4)),
    types: Array.from(structuredDataTypes)
  };
}

function detectEntityCues(content, industry) {
  const names = content.match(/[A-Z][a-z]+\s+[A-Z][a-z]+/g) || [];
  const products = industry.keywords.filter(keyword => content.toLowerCase().includes(keyword.toLowerCase())).length;
  const places = content.match(/\b(ontario|toronto|canada|california|new york|london)\b/gi) || [];
  
  return {
    names: names.length,
    products: products,
    places: places.length
  };
}

function estimatePerformanceMetrics(html) {
  const htmlSize = html.length;
  const imageCount = (html.match(/<img[^>]*>/gi) || []).length;
  const scriptCount = (html.match(/<script[^>]*>/gi) || []).length;
  
  const hasLazyLoading = html.includes('loading="lazy"');
  const hasWebP = /\.webp/i.test(html);
  const hasViewport = html.includes('name="viewport"');
  
  // LCP estimation
  const lcpScore = Math.max(30, 100 - Math.floor(htmlSize / 10000) - Math.floor(imageCount / 2) + (hasLazyLoading ? 15 : 0) + (hasWebP ? 10 : 0));
  
  // CLS estimation
  const clsScore = 85 + (html.includes('width=') && html.includes('height=') ? 15 : 0);
  
  // INP estimation
  const inpScore = Math.max(50, 100 - Math.floor(scriptCount / 2));
  
  // Mobile optimization
  const mobileScore = (hasViewport ? 80 : 40) + (html.includes('responsive') ? 20 : 0);
  
  return {
    lcpScore: Math.min(100, lcpScore),
    clsScore: Math.min(100, clsScore),
    inpScore: Math.min(100, inpScore),
    mobileScore: Math.min(100, mobileScore),
    crawlerResponseScore: htmlSize < 150000 ? 100 : 70
  };
}

function analyzeAuthorBios(content) {
  const authorIndicators = /author|written.by|by\s+[A-Z][a-z]+|about.the.author/gi;
  const credentialKeywords = /phd|md|cpa|certified|licensed|degree|expert|specialist|years.of.experience/gi;
  
  const hasAuthor = authorIndicators.test(content);
  const hasCredentials = credentialKeywords.test(content);
  
  let score = 0;
  if (hasAuthor && hasCredentials) score = 100;
  else if (hasAuthor) score = 60;
  else if (hasCredentials) score = 40;
  
  return { score, hasAuthor, hasCredentials };
}

function estimateDomainAuthority(content, html) {
  const qualityIndicators = [
    content.length > 5000,
    html.includes('https://'),
    /published|copyright|©/i.test(content),
    content.split(' ').length > 1000,
    html.includes('rel="canonical"')
  ];
  
  return Math.min(100, qualityIndicators.filter(Boolean).length * 20);
}

function analyzeThoughtLeadership(content) {
  const indicators = /featured.in|quoted.in|speaking.at|published.in|research|whitepaper|case.study|award|recognition/gi;
  const matches = content.match(indicators) || [];
  
  return {
    score: Math.min(100, matches.length * 25),
    indicators: matches.length
  };
}

function analyzeTrustBadges(content, html) {
  const trustBadges = /google.my.business|g2|clutch|capterra|trustpilot|better.business.bureau|bbb|verified|certified/gi;
  const matches = content.match(trustBadges) || [];
  
  return {
    score: Math.min(100, matches.length * 30),
    badges: matches.length
  };
}

function analyzeConversationalContent(content) {
  const conversationalStarters = /what.is|how.to|why.should|when.to|where.can|which.is|who.should/gi;
  const longTailPhrases = content.match(/\b\w+\s+\w+\s+\w+\s+\w+\b/g) || [];
  
  const conversationalMatches = content.match(conversationalStarters) || [];
  const relevantLongTail = longTailPhrases.filter(phrase => conversationalStarters.test(phrase));
  
  return {
    score: Math.min(100, (conversationalMatches.length * 15) + (relevantLongTail.length * 5)),
    phrases: conversationalMatches.length + relevantLongTail.length
  };
}

function analyzeLocalVoiceOptimization(content) {
  const localPhrases = /near.me|close.to.me|local|in.my.area|nearby|around.me/gi;
  const locationTerms = /ontario|toronto|canada|\d{5}|postal.code|address/gi;
  
  const localMatches = content.match(localPhrases) || [];
  const locationMatches = content.match(locationTerms) || [];
  
  return {
    score: Math.min(100, (localMatches.length * 20) + (locationMatches.length * 10)),
    terms: localMatches.length + locationMatches.length
  };
}

function analyzeICPConversationalTerms(content, industry) {
  const businessTerms = /small.business|enterprise|startup|company|organization|business.owner/gi;
  const problemTerms = industry.painPoints.map(pain => new RegExp(pain.replace(/\s+/g, '.'), 'gi'));
  
  const businessMatches = content.match(businessTerms) || [];
  const problemMatches = problemTerms.flatMap(regex => content.match(regex) || []);
  
  return {
    score: Math.min(100, (businessMatches.length * 10) + (problemMatches.length * 15)),
    terms: businessMatches.length + problemMatches.length
  };
}

function analyzeFeaturedSnippetOptimization(content) {
  const snippetAnswers = findSnippetAnswers(content);
  const definitionPatterns = /is.defined.as|refers.to|means.that|can.be.described.as/gi;
  const listPatterns = /steps.include|methods.are|ways.to|types.of/gi;
  
  const definitionMatches = content.match(definitionPatterns) || [];
  const listMatches = content.match(listPatterns) || [];
  
  return {
    score: Math.min(100, (snippetAnswers.length * 25) + (definitionMatches.length * 15) + (listMatches.length * 10)),
    snippets: snippetAnswers.length,
    patterns: definitionMatches.length + listMatches.length
  };
}

function analyzeConversationContinuity(content) {
  const followUpIndicators = /also|additionally|furthermore|next|then|after|finally|related|similar|more.information/gi;
  const questionSequences = /first|second|third|another.question|follow.up/gi;
  
  const followUpMatches = content.match(followUpIndicators) || [];
  const sequenceMatches = content.match(questionSequences) || [];
  
  return {
    score: Math.min(100, (followUpMatches.length * 5) + (sequenceMatches.length * 15)),
    indicators: followUpMatches.length + sequenceMatches.length
  };
}

// === V5 CATEGORY ANALYSIS FUNCTIONS ===

function analyzeAIReadabilityMultimodal(metrics) {
  console.log('\n👁️ Analyzing AI Readability & Multimodal Access...');
  
  const subfactorScores = {
    altTextCoverage: calculateV5SubfactorScore(metrics.imageAltPercentage, 80, 35),
    videoCaptions: calculateV5SubfactorScore(metrics.videoCaptionPercentage, 50, 35),
    interactiveAccess: calculateV5SubfactorScore(metrics.interactiveAccessibility, 60, 20),
    crossMediaRelations: calculateV5SubfactorScore(metrics.crossMediaScore, 40, 10)
  };
  
  const categoryTotal = Object.values(subfactorScores).reduce((sum, score) => sum + score, 0);
  
  console.log('👁️ AI Readability subfactors:', subfactorScores);
  console.log('👁️ Category total:', categoryTotal);
  
  return { scores: subfactorScores, total: categoryTotal };
}

function analyzeAISearchReadiness(metrics) {
  console.log('\n🎯 Analyzing AI Search Readiness & Content Depth...');
  
  const subfactorScores = {
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
  
  const categoryTotal = Object.values(subfactorScores).reduce((sum, score) => sum + score, 0);
  
  console.log('🎯 AI Search Readiness subfactors:', subfactorScores);
  console.log('🎯 Category total:', categoryTotal);
  
  return { scores: subfactorScores, total: categoryTotal };
}

function analyzeContentFreshness(metrics) {
  console.log('\n🔄 Analyzing Content Freshness & Maintenance...');
  
  const subfactorScores = {
    lastUpdated: calculateV5SubfactorScore(metrics.lastUpdatedScore, 70, 25),
    versioning: calculateV5SubfactorScore(metrics.versioningScore, 80, 15),
    timeSensitive: calculateV5SubfactorScore(metrics.timeSensitiveScore, 60, 15),
    contentAudit: calculateV5SubfactorScore(metrics.auditScore, 70, 15),
    liveData: calculateV5SubfactorScore(metrics.liveDataScore, 50, 10),
    httpHeaders: calculateV5SubfactorScore(metrics.httpFreshnessScore, 80, 10),
    editorialCalendar: calculateV5SubfactorScore(metrics.editorialScore, 70, 10)
  };
  
  const categoryTotal = Object.values(subfactorScores).reduce((sum, score) => sum + score, 0);
  
  console.log('🔄 Content Freshness subfactors:', subfactorScores);
  console.log('🔄 Category total:', categoryTotal);
  
  return { scores: subfactorScores, total: categoryTotal };
}

function analyzeContentStructure(metrics) {
  console.log('\n🏗️ Analyzing Content Structure & Entity Recognition...');
  
  const subfactorScores = {
    headingHierarchy: calculateV5SubfactorScore(metrics.headingHierarchyScore, 70, 35),
    anchorLinks: calculateV5SubfactorScore(metrics.anchorScore, 60, 20),
    entityCues: calculateV5SubfactorScore(metrics.entityScore, 50, 20),
    accessibility: calculateV5SubfactorScore(metrics.accessibilityScore, 60, 15),
    geoMeta: calculateV5SubfactorScore(metrics.geoMetaScore, 70, 10)
  };
  
  const categoryTotal = Object.values(subfactorScores).reduce((sum, score) => sum + score, 0);
  
  console.log('🏗️ Content Structure subfactors:', subfactorScores);
  console.log('🏗️ Category total:', categoryTotal);
  
  return { scores: subfactorScores, total: categoryTotal };
}

function analyzeSpeedUX(metrics) {
  console.log('\n⚡ Analyzing Speed & User Experience...');
  
  const subfactorScores = {
    lcp: calculateV5SubfactorScore(metrics.lcpScore, 70, 25),
    cls: calculateV5SubfactorScore(metrics.clsScore, 80, 25),
    inp: calculateV5SubfactorScore(metrics.inpScore, 70, 25),
    mobileOptimization: calculateV5SubfactorScore(metrics.mobileScore, 80, 15),
    crawlerResponse: calculateV5SubfactorScore(metrics.crawlerResponseScore, 80, 10)
  };
  
  const categoryTotal = Object.values(subfactorScores).reduce((sum, score) => sum + score, 0);
  
  console.log('⚡ Speed & UX subfactors:', subfactorScores);
  console.log('⚡ Category total:', categoryTotal);
  
  return { scores: subfactorScores, total: categoryTotal };
}

function analyzeTechnicalSetup(metrics) {
  console.log('\n⚙️ Analyzing Technical Setup & Structured Data...');
  
  const subfactorScores = {
    crawlerAccess: calculateV5SubfactorScore(metrics.crawlerAccessScore, 70, 30),
    structuredData: calculateV5SubfactorScore(metrics.structuredDataScore, 60, 30),
    canonical: calculateV5SubfactorScore(metrics.canonicalScore, 80, 10),
    socialMarkup: calculateV5SubfactorScore(metrics.socialMarkupScore, 70, 5),
    sitemap: calculateV5SubfactorScore(metrics.sitemapScore, 70, 10),
    indexNow: calculateV5SubfactorScore(metrics.indexNowScore, 80, 10),
    rssFeeds: calculateV5SubfactorScore(metrics.sitemapScore, 60, 5) // RSS is part of sitemap score
  };
  
  const categoryTotal = Object.values(subfactorScores).reduce((sum, score) => sum + score, 0);
  
  console.log('⚙️ Technical Setup subfactors:', subfactorScores);
  console.log('⚙️ Category total:', categoryTotal);
  
  return { scores: subfactorScores, total: categoryTotal };
}

function analyzeTrustAuthority(metrics) {
  console.log('\n🛡️ Analyzing Trust, Authority & Verification...');
  
  const subfactorScores = {
    authorBios: calculateV5SubfactorScore(metrics.authorBioScore, 70, 25),
    certifications: calculateV5SubfactorScore(metrics.certificationScore, 60, 15),
    domainAuthority: calculateV5SubfactorScore(metrics.domainAuthorityScore, 60, 25),
    thoughtLeadership: calculateV5SubfactorScore(metrics.thoughtLeadershipScore, 50, 20),
    trustBadges: calculateV5SubfactorScore(metrics.trustBadgeScore, 60, 15)
  };
  
  const categoryTotal = Object.values(subfactorScores).reduce((sum, score) => sum + score, 0);
  
  console.log('🛡️ Trust & Authority subfactors:', subfactorScores);
  console.log('🛡️ Category total:', categoryTotal);
  
  return { scores: subfactorScores, total: categoryTotal };
}

function analyzeVoiceOptimization(metrics) {
  console.log('\n🎤 Analyzing Voice & Conversational Optimization...');
  
  const subfactorScores = {
    conversationalPhrases: calculateV5SubfactorScore(metrics.conversationalPhrasesScore, 60, 25),
    localVoice: calculateV5SubfactorScore(metrics.localVoiceScore, 50, 25),
    icpConversational: calculateV5SubfactorScore(metrics.icpConversationalScore, 60, 20),
    featuredSnippets: calculateV5SubfactorScore(metrics.featuredSnippetScore, 50, 15),
    conversationContinuity: calculateV5SubfactorScore(metrics.conversationContinuityScore, 40, 15)
  };
  
  const categoryTotal = Object.values(subfactorScores).reduce((sum, score) => sum + score, 0);
  
  console.log('🎤 Voice Optimization subfactors:', subfactorScores);
  console.log('🎤 Category total:', categoryTotal);
  
  return { scores: subfactorScores, total: categoryTotal };
}

// V5 Subfactor scoring function
function calculateV5SubfactorScore(value, threshold, weight) {
  const percentage = Math.min(100, Math.max(0, value));
  let scoreMultiplier = 0;
  
  if (percentage >= threshold) {
    scoreMultiplier = 1.0; // 100% of weight
  } else if (percentage >= threshold * 0.7) {
    scoreMultiplier = 0.8; // 80% of weight
  } else if (percentage >= threshold * 0.4) {
    scoreMultiplier = 0.5; // 50% of weight
  } else {
    scoreMultiplier = percentage / threshold * 0.5; // Proportional up to 50%
  }
  
  return scoreMultiplier * weight;
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
    
    if (result.scores) {
      console.log(`  - Subfactor scores:`, result.scores);
    }
  });
  
  console.log('\n🎯 TOTAL EXPECTED SCORE:', 
    Object.entries(categoryScores)
      .filter(([key]) => key !== 'total')
      .reduce((sum, [key, score]) => sum + ((score / 100) * CATEGORY_WEIGHTS[key] * 100), 0)
      .toFixed(2)
  );
}

// Main analysis function with V5 structure
function performDetailedAnalysis(websiteData) {
  console.log('\n🚀 Starting V5 detailed analysis...');
  console.log('🌐 URL:', websiteData.url);
  
  const { html, url } = websiteData;
  const content = extractTextContent(html);
  const industry = detectIndustry(websiteData);
  
  console.log('🏭 Detected industry:', industry.name);
  
  const metrics = analyzePageMetrics(html, content, industry, url);
  
  // Get analysis results for all 8 V5 categories
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
  
  // Calculate final weighted score
  console.log('\n🧮 Calculating final V5 weighted scores...');
  const categoryScores = {};
  let totalWeightedScore = 0;
  
  for (const [category, result] of Object.entries(analysisResults)) {
    const categoryPercentage = Math.min(100, Math.max(0, result.total));
    categoryScores[category] = Math.round(categoryPercentage * 10) / 10;
    
    const weight = CATEGORY_WEIGHTS[category];
    const weightedContribution = (categoryPercentage / 100) * weight * 100; // Convert to percentage points
    totalWeightedScore += weightedContribution;
    
    console.log(`📊 ${category}: ${categoryPercentage.toFixed(1)}% (weighted: ${weightedContribution.toFixed(2)} points)`);
  }
  
  categoryScores.total = Math.round(totalWeightedScore);

  debugV5Categories(analysisResults, categoryScores);
  
  console.log('\n✅ Final V5 category scores:', categoryScores);
  console.log('🎯 Total weighted score:', totalWeightedScore.toFixed(2));
  
  // Generate V5-based recommendations
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

function generateV5Recommendations(analysis, scores, industry) {
  const recommendations = [];
  
  // AI Readability & Multimodal Access
  if (scores.aiReadabilityMultimodal < 7) {
    recommendations.push({
      title: 'Improve Image Alt Text Coverage',
      description: 'Add descriptive alt text to at least 80% of your images to help AI systems understand your visual content.',
      impact: 'High',
      category: 'AI Readability & Multimodal Access',
      quickWin: 'Start with your most important product/service images and add 5-10 word descriptive alt text.'
    });
  }
  
  // AI Search Readiness & Content Depth
  if (scores.aiSearchReadiness < 15) {
    recommendations.push({
      title: 'Add Question-Based Headings',
      description: 'Convert your H2 and H3 headings to question format to improve AI citation rates.',
      impact: 'Critical',
      category: 'AI Search Readiness & Content Depth',
      quickWin: `Add FAQ section with questions like "What makes ${industry.name} different?" and "How do you choose the right ${industry.name}?"`
    });
  }
  
  // Content Freshness & Maintenance
  if (scores.contentFreshness < 6) {
    recommendations.push({
      title: 'Add Content Freshness Indicators',
      description: 'Display "Last Updated" dates and keep content current to build AI trust.',
      impact: 'Medium',
      category: 'Content Freshness & Maintenance',
      quickWin: 'Add visible "Last Updated: [Date]" to your main service pages and update at least quarterly.'
    });
  }
  
  // Content Structure & Entity Recognition
  if (scores.contentStructure < 12) {
    recommendations.push({
      title: 'Improve Content Structure',
      description: 'Optimize heading hierarchy and add clear entity references for better AI understanding.',
      impact: 'High',
      category: 'Content Structure & Entity Recognition',
      quickWin: 'Ensure one H1 per page, use H2s for main sections, and clearly mention your company name and location.'
    });
  }
  
  // Technical Setup & Structured Data
  if (scores.technicalSetup < 14) {
    recommendations.push({
      title: 'Implement Structured Data',
      description: 'Add schema markup for Organization, Service, and FAQ to help AI systems understand your business.',
      impact: 'Critical',
      category: 'Technical Setup & Structured Data',
      quickWin: 'Start with basic Organization schema including your business name, address, and contact information.'
    });
  }
  
  // Trust, Authority & Verification
  if (scores.trustAuthority < 9) {
    recommendations.push({
      title: 'Add Authority Signals',
      description: 'Include author bios, certifications, and trust badges to improve credibility with AI systems.',
      impact: 'High',
      category: 'Trust, Authority & Verification',
      quickWin: 'Add an "About the Team" section with credentials and any industry certifications or memberships.'
    });
  }
  
  // Voice & Conversational Optimization
  if (scores.voiceOptimization < 9) {
    recommendations.push({
      title: 'Optimize for Voice Search',
      description: 'Include natural, conversational phrases that people use when speaking to AI assistants.',
      impact: 'Medium',
      category: 'Voice & Conversational Optimization',
      quickWin: `Add phrases like "best ${industry.name} near me" and answer questions in 30-60 word snippets.`
    });
  }
  
  // Speed & User Experience
  if (scores.speedUX < 4) {
    recommendations.push({
      title: 'Improve Page Performance',
      description: 'Optimize images, reduce script loading, and ensure mobile responsiveness for better AI crawler experience.',
      impact: 'Medium',
      category: 'Speed & User Experience',
      quickWin: 'Add lazy loading to images and ensure viewport meta tag is present for mobile optimization.'
    });
  }
  
  return recommendations.slice(0, 6); // Return top 6 recommendations
}

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

// === API ROUTES ===

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
    
    res.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('❌ V5 Website analysis failed:', error);
    res.status(500).json({
      error: 'Website analysis failed',
      message: error.message
    });
  }
});

// Keep existing AI testing route for compatibility
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

// === EXISTING AI TESTING FUNCTIONS (unchanged) ===

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
