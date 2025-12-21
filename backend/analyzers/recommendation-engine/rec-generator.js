// backend/analyzers/recommendation-engine/rec-generator.js

require('dotenv').config();

/**
 * RECOMMENDATION GENERATOR - LIBRARY-FIRST + PROGRAMMATIC JSON-LD + CHATGPT + SMART TEMPLATES
 * Priority Strategy:
 * 1) Curated Library (future / optional)
 * 2) Programmatic output where deterministic (structured data, OG tags, question headings)
 * 3) ChatGPT (high quality copy where needed)
 * 4) Smart Templates (free tier or fallback)
 */

const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

// ✅ FAQ library + customizer - NOW FULLY INTEGRATED
const { loadLibrary, hasLibrary } = require('./faq-library-loader');
const { generateCustomizedFAQ } = require('./faq-customizer');

// ✅ Certification recommendation generators
const {
  makeProgrammaticCertificationRecommendation,
  makeProgrammaticTeamCredentialsRecommendation,
  makeProgrammaticMembershipsRecommendation
} = require('./certification-recommendation-generators');

// ✅ Dynamic recommendation text configuration
const { getRecommendationText, generateGenericRecommendationText } = require('./recommendation-text-config');

// -----------------------------------------
// Inline helpers (no external file imports)
// -----------------------------------------

const SITE_TYPES = new Set(['single_page','small_multi','multi','blog','saas','local_business']);

function normalizeEvidence(raw = {}) {
  const profileRaw = raw.detected_profile || raw.profile || {};
  const factsRaw = raw.extracted_facts || raw.facts || [];

  // DEBUG: Log what data we're receiving
  console.log('[normalizeEvidence] INPUT:', {
    hasDetectedProfile: !!raw.detected_profile,
    hasProfile: !!raw.profile,
    profileRawSections: profileRaw.sections,
    hasExtractedFacts: !!raw.extracted_facts,
    hasFacts: !!raw.facts
  });

  const profile = {
    site_type: SITE_TYPES.has(profileRaw.site_type) ? profileRaw.site_type : 'small_multi',
    routes_count: Number(profileRaw.routes_count || 1),
    anchors: Array.isArray(profileRaw.anchors) ? profileRaw.anchors : [],
    sections: typeof profileRaw.sections === 'object' && profileRaw.sections !== null ? profileRaw.sections : {}
  };

  // DEBUG: Log the resulting profile sections
  console.log('[normalizeEvidence] OUTPUT profile.sections:', profile.sections);

  // facts as [{name, value, selector?, confidence?}]
  const facts = Array.isArray(factsRaw) ? factsRaw.filter(f => f && f.name) : [];

  return { profile, facts };
}

function factValue(facts, name, fallback = undefined) {
  const f = facts.find(x => x.name === name);
  return f ? f.value : fallback;
}

function absolute(origin, maybeUrl) {
  try { return new URL(maybeUrl, origin).href; } catch { return undefined; }
}

function buildCoreJsonLd(pageUrl, facts) {
  const origin = new URL(pageUrl).origin;
  const brand = factValue(facts, 'brand') || factValue(facts, 'site_name') || origin.replace(/^https?:\/\/(www\.)?/,'');
  const logo = factValue(facts, 'logo');
  const desc = factValue(facts, 'description');
  const socials = factValue(facts, 'social_links', []);

  const orgId = `${origin}/#organization`;
  const siteId = `${origin}/#website`;
  const pageId = `${pageUrl.replace(/#.*$/,'')}/#webpage`;

  const Organization = {
    "@context":"https://schema.org",
    "@type":"Organization",
    "@id": orgId,
    "name": brand,
    "url": origin,
    ...(logo ? { "logo": { "@type":"ImageObject", "url": absolute(origin, logo) }} : {}),
    ...(Array.isArray(socials) && socials.length ? { "sameAs": socials } : {})
  };

  const WebSite = {
    "@context":"https://schema.org",
    "@type":"WebSite",
    "@id": siteId,
    "url": origin,
    "name": brand,
    "publisher": { "@id": orgId }
  };

  const WebPage = {
    "@context":"https://schema.org",
    "@type":"WebPage",
    "@id": pageId,
    "url": pageUrl,
    "isPartOf": { "@id": siteId },
    ...(desc ? { "description": desc } : {})
  };

  return [Organization, WebSite, WebPage];
}

function buildFAQJsonLd(pageUrl, qaPairs = []) {
  if (!Array.isArray(qaPairs) || !qaPairs.length) return null;
  return {
    "@context":"https://schema.org",
    "@type":"FAQPage",
    "@id": `${pageUrl.replace(/#.*$/,'')}/#faq`,
    "mainEntity": qaPairs.map(({q,a}) => ({
      "@type":"Question",
      "name": q,
      "acceptedAnswer": { "@type":"Answer", "text": a }
    }))
  };
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./,''); } catch { return 'your-domain.com'; }
}

// -----------------------------------------
// Static templates (titles, difficulty, etc.)
// -----------------------------------------

// Category display names (matching V5 rubric)
const CATEGORY_NAMES = {
  aiReadability: 'AI Readability',
  aiSearchReadiness: 'AI Search Readiness',
  contentFreshness: 'Content Freshness',
  contentStructure: 'Content Structure',
  speedUX: 'Speed & UX',
  technicalSetup: 'Technical Setup',
  trustAuthority: 'Trust & Authority',
  voiceOptimization: 'Voice Optimization'
};

// Subfactor display names (user-friendly)
const SUBFACTOR_NAMES = {
  structuredDataScore: 'Schema Markup',
  organizationSchema: 'Organization Schema',
  productSchema: 'Product Schema',
  faqScore: 'FAQ Schema',
  questionHeadingsScore: 'Question-Based Headings',
  openGraphScore: 'Open Graph & Social Meta Tags',
  headingHierarchyScore: 'Heading Structure',
  contentDepthScore: 'Content Depth',
  scannabilityScore: 'Content Scannability',
  geoContentScore: 'Location & Geographic Content',
  readabilityScore: 'Readability & Clarity',
  sitemapScore: 'XML Sitemap',
  robotsTxtScore: 'Robots.txt Configuration',
  httpsScore: 'HTTPS Security',
  crawlAccessibilityScore: 'Crawl Accessibility'
};

const RECOMMENDATION_TEMPLATES = {
  structuredDataScore: {
    title: "Implement Structured Data Schema",
    impactArea: "AI Understanding & Rich Results",
    whyItMatters: "Your website doesn't have the behind-the-scenes code that tells AI who you are, what you do, and where you're located. Without this, AI assistants have to guess — and they often guess wrong or skip you entirely.",
    typicalTimeToFix: "1–2 hours",
    difficulty: "Easy",
    estimatedGain: 18
  },
  faqScore: {
    title: "Add FAQ Schema Markup",
    impactArea: "Voice Search & Featured Snippets",
    whyItMatters: "Adding a Frequently Asked Questions section helps AI assistants find quick answers on your site. When someone asks ChatGPT a question you've already answered on your website, it's more likely to recommend you.",
    typicalTimeToFix: "1–2 hours",
    difficulty: "Easy",
    estimatedGain: 12
  },
  altTextScore: {
    title: "Complete Image Alt Text Coverage",
    impactArea: "Multimodal AI & Accessibility",
    whyItMatters: "Your images are missing descriptions that tell AI what they show. AI assistants can now 'see' images, so when your photos have good descriptions, AI can recommend you for visual searches too.",
    typicalTimeToFix: "1–2 hours",
    difficulty: "Easy",
    estimatedGain: 8
  },
  openGraphScore: {
    title: "Add Open Graph & Twitter Card meta tags",
    impactArea: "Social Sharing & Entity Cards",
    whyItMatters: "When people share your website on social media or messaging apps, it looks plain or broken instead of showing a nice preview with your image and description. This makes your links look less professional and trustworthy.",
    typicalTimeToFix: "15–30 minutes",
    difficulty: "Easy",
    estimatedGain: 8
  },
  professionalCertifications: {
    title: "Display Industry Certifications",
    impactArea: "Trust & Authority (E-E-A-T)",
    whyItMatters: "AI assistants look for proof that your business is qualified and trustworthy. Displaying your certifications, licenses, and credentials helps AI confidently recommend you over competitors who don't show this proof.",
    typicalTimeToFix: "20–30 minutes",
    difficulty: "Easy",
    estimatedGain: 22
  },
  teamCredentials: {
    title: "Add Team Member Credentials",
    impactArea: "Expertise & Authority (E-E-A-T)",
    whyItMatters: "AI assistants want to know there are real, qualified people behind your business. Adding team bios with credentials and experience helps AI trust your expertise and recommend you for industry-specific questions.",
    typicalTimeToFix: "1–2 hours",
    difficulty: "Medium",
    estimatedGain: 18
  },
  industryMemberships: {
    title: "Display Industry Memberships & Associations",
    impactArea: "Authority Network & Trust",
    whyItMatters: "Being part of professional associations shows you're an active, respected member of your industry. AI assistants see this as a trust signal and are more likely to recommend businesses that show they're connected to their professional community.",
    typicalTimeToFix: "15–20 minutes",
    difficulty: "Easy",
    estimatedGain: 14
  },
  pillarPagesScore: {
    title: "Create Comprehensive Pillar Page Structure",
    impactArea: "AI Search Readiness & Topic Authority",
    whyItMatters: "Your website doesn't have an in-depth page that fully explains what you do. AI assistants like ChatGPT prefer to recommend businesses that have detailed, well-organized pages about their main services — think of it like a complete guide that covers all the basics in one place.",
    typicalTimeToFix: "2–4 hours",
    difficulty: "Medium",
    estimatedGain: 15
  },
  snippetFormatScore: {
    title: "Optimize Content for Featured Snippets",
    impactArea: "Voice Search & AI Answer Extraction",
    whyItMatters: "AI assistants look for content that's easy to scan — like bullet points, numbered lists, and FAQ sections. When your page is formatted this way, AI can quickly pull answers from it and recommend you to users.",
    typicalTimeToFix: "1–2 hours",
    difficulty: "Easy",
    estimatedGain: 12
  }
};

// -----------------------------------------
// Public entry
// -----------------------------------------

async function generateRecommendations(issues, scanEvidence, tier = 'free', industry = null) {
  console.log(`   🎯 Generating recommendations for ${issues?.length || 0} issues (tier=${tier})`);
  if (!Array.isArray(issues) || !issues.length) return [];

  // DEBUG: Show ALL issues sorted by priority BEFORE BATCH_SIZE filter
  console.log('\n=== ALL DETECTED ISSUES (sorted by priority) ===');
  issues.forEach((issue, index) => {
    const selected = index < 5 ? '✓ SELECTED' : '❌ EXCLUDED';
    console.log(`${index + 1}. ${issue.subfactor} [${selected}]`);
    console.log(`   Category: ${issue.category}`);
    console.log(`   Score: ${issue.currentScore} (threshold: ${issue.threshold})`);
    console.log(`   Gap: ${issue.gap}`);
    console.log(`   Priority: ${issue.priority}`);
    console.log(`   Severity: ${issue.severity}`);
    console.log('');
  });

  // Check specifically for faqScore
  const faqIssue = issues.find(i => i.subfactor === 'faqScore');
  if (faqIssue) {
    const faqIndex = issues.indexOf(faqIssue);
    console.log(`📋 FAQ STATUS: Found at position #${faqIndex + 1} with priority ${faqIssue.priority}`);
    console.log(`   Will be ${faqIndex < 5 ? '✅ INCLUDED' : '❌ EXCLUDED by BATCH_SIZE=5'}`);
  } else {
    console.log('⚠️  FAQ STATUS: NO faqScore issue detected! Score must be >= 70');
  }
  console.log('=================================================\n');

  const BATCH_SIZE = 5;
  const issuesToProcess = issues.slice(0, BATCH_SIZE);
  const out = [];

  for (const issue of issuesToProcess) {
    try {
      // 1) Curated library (placeholder for future)
      const libraryRec = await checkRecommendationLibrary(issue, industry);
      if (libraryRec) {
        out.push(await customizeLibraryRecommendation(libraryRec, issue, scanEvidence, tier));
        continue;
      }

      // 2) HIGH-VALUE PROGRAMMATIC GENERATORS (run FIRST - these have rich, pre-written content)
      // These take precedence over ChatGPT for consistency and quality

      // 2a) FAQ Schema - Rich, ready-to-use FAQ schema markup
      if (issue.subfactor === 'faqSchemaScore') {
        console.log(`✅ Detected faqSchemaScore issue - calling programmatic FAQ schema generator`);
        const rec = makeProgrammaticFAQSchemaRecommendation(issue, scanEvidence, subfactorScores, industry);
        if (rec) {
          console.log(`✅ FAQ schema recommendation generated successfully`);
          out.push(rec);
          continue;
        } else {
          console.log(`❌ FAQ schema generator returned null/undefined`);
        }
      }

      // 2b) FAQ Content - Visible FAQ section
      if (issue.subfactor === 'faqContentScore') {
        console.log(`✅ Detected faqContentScore issue - calling programmatic FAQ content generator`);
        const rec = makeProgrammaticFAQContentRecommendation(issue, scanEvidence, subfactorScores, industry);
        if (rec) {
          console.log(`✅ FAQ content recommendation generated successfully`);
          out.push(rec);
          continue;
        } else {
          console.log(`❌ FAQ content generator returned null/undefined`);
        }
      }

      // 2b) Alt Text - Image accessibility
      if (issue.subfactor === 'altTextScore') {
        console.log(`✅ Detected altTextScore issue - calling programmatic alt text generator`);
        const rec = makeProgrammaticAltTextRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ Alt text recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2c) Scannability - Content formatting
      if (issue.subfactor === 'scannabilityScore') {
        console.log(`✅ Detected scannabilityScore issue - calling programmatic scannability generator`);
        const rec = makeProgrammaticScannabilityRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ Scannability recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2d) Captions/Transcripts - Video accessibility
      if (issue.subfactor === 'captionsTranscriptsScore') {
        console.log(`✅ Detected captionsTranscriptsScore issue - calling programmatic transcripts generator`);
        const rec = makeProgrammaticCaptionsTranscriptsRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ Transcripts recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2e) IndexNow - Instant indexing
      if (issue.subfactor === 'indexNowScore') {
        console.log(`✅ Detected indexNowScore issue - calling programmatic IndexNow generator`);
        const rec = makeProgrammaticIndexNowRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ IndexNow recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2f) Location & Geographic Content - AEO-optimized service areas
      if (issue.subfactor === 'geoContentScore') {
        console.log(`✅ Detected geoContentScore issue - calling programmatic location/geographic generator`);
        const rec = makeProgrammaticGeoContentRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ Location/geographic recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2g) Readability - Content clarity and simplification
      if (issue.subfactor === 'readabilityScore') {
        console.log(`✅ Detected readabilityScore issue - calling programmatic readability generator`);
        const rec = makeProgrammaticReadabilityRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ Readability recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2h) Content Depth - Topic coverage and comprehensiveness
      if (issue.subfactor === 'contentDepthScore') {
        console.log(`✅ Detected contentDepthScore issue - calling programmatic content depth generator`);
        const rec = makeProgrammaticContentDepthRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ Content depth recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2i) Heading Hierarchy - H1-H6 structure and question-based headings
      if (issue.subfactor === 'headingHierarchyScore') {
        console.log(`✅ Detected headingHierarchyScore issue - calling programmatic heading hierarchy generator`);
        const rec = makeProgrammaticHeadingHierarchyRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ Heading hierarchy recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2j) Structured Data - Deterministic JSON-LD
      if (issue.subfactor === 'structuredDataScore') {
        const rec = makeProgrammaticStructuredDataRecommendation(issue, scanEvidence);
        out.push(rec);
        continue;
      }

      // 2c) Open Graph - Programmatic meta tags
      if (issue.subfactor === 'openGraphScore') {
        const rec = makeProgrammaticOpenGraphRecommendation(issue, scanEvidence);
        if (rec) { out.push(rec); continue; }
      }

      // 2d) Question Headings - Programmatic suggestions with ChatGPT intelligence
      if (issue.subfactor === 'questionHeadingsScore') {
        const rec = await makeProgrammaticQuestionHeadingsRecommendation(issue, scanEvidence, industry);
        if (rec) { out.push(rec); continue; }
      }

      // 2k) XML Sitemap - Technical setup
      if (issue.subfactor === 'sitemapScore') {
        console.log(`✅ Detected sitemapScore issue - calling programmatic sitemap generator`);
        const rec = makeProgrammaticSitemapRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ Sitemap recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2l) Robots.txt - Crawler configuration
      if (issue.subfactor === 'robotsTxtScore') {
        console.log(`✅ Detected robotsTxtScore issue - calling programmatic robots.txt generator`);
        const rec = makeProgrammaticRobotsTxtRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ Robots.txt recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2m) HTTPS/SSL - Security configuration
      if (issue.subfactor === 'httpsScore') {
        console.log(`✅ Detected httpsScore issue - calling programmatic HTTPS generator`);
        const rec = makeProgrammaticHttpsRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ HTTPS recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2n) Crawl Accessibility - Indexability
      if (issue.subfactor === 'crawlAccessibilityScore') {
        console.log(`✅ Detected crawlAccessibilityScore issue - calling programmatic crawl accessibility generator`);
        const rec = makeProgrammaticCrawlAccessibilityRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ Crawl accessibility recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2o) Professional Certifications - Industry credentials and trust signals
      if (issue.subfactor === 'professionalCertifications') {
        console.log(`✅ Detected professionalCertifications issue - calling programmatic certification generator`);
        const rec = makeProgrammaticCertificationRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ Professional certification recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2p) Team Credentials - Team member expertise documentation
      if (issue.subfactor === 'teamCredentials') {
        console.log(`✅ Detected teamCredentials issue - calling programmatic team credentials generator`);
        const rec = makeProgrammaticTeamCredentialsRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ Team credentials recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 2q) Industry Memberships - Professional associations and network signals
      if (issue.subfactor === 'industryMemberships') {
        console.log(`✅ Detected industryMemberships issue - calling programmatic memberships generator`);
        const rec = makeProgrammaticMembershipsRecommendation(issue, scanEvidence, industry);
        if (rec) {
          console.log(`✅ Industry memberships recommendation generated successfully`);
          out.push(rec);
          continue;
        }
      }

      // 3) ChatGPT for all authenticated users (Free/DIY/Pro tier)
      if (tier !== 'guest' && process.env.OPENAI_API_KEY) {
        const gptRec = await generateWithChatGPT(issue, scanEvidence, tier, industry);
        out.push(gptRec);
        continue;
      }

      // 4) Smart template fallback (Guest users only, or if no API key)
      out.push(generateSmartTemplate(issue, scanEvidence, tier, industry));

    } catch (err) {
      console.error(`   ⚠️  Failed for subfactor=${issue.subfactor}:`, err?.response?.data || err.message);
      out.push(generateSmartTemplate(issue, scanEvidence, tier, industry));
    }
  }

  // Optional: quick visibility into what we are about to save
  console.log('   — Recommendation lengths (finding/impact/code):');
  for (const r of out) {
    const f = (r.finding || '').length;
    const i = (r.impact || '').length;
    const c = (r.codeSnippet || '').length;
    console.log(`     • ${r.subfactor}: f=${f} i=${i} c=${c} steps=${r.actionSteps?.length || 0}`);
  }

  console.log('   ✅ Final recommendations count:', out.length);
  return out;
}

// -----------------------------------------
// Library placeholders (wire these up later if you like)
// -----------------------------------------

async function checkRecommendationLibrary(_issue, _industry) { return null; }
async function customizeLibraryRecommendation(libraryRec, issue, _scanEvidence, _tier) {
  return { ...libraryRec, currentScore: issue.currentScore, targetScore: issue.threshold, generatedBy: 'library' };
}

// -----------------------------------------
// GPT path (used for non-deterministic copy)
// -----------------------------------------

// Generate context-aware fallback whyItMatters based on category and subfactor
function getContextualWhyItMatters(category, subfactor) {
  const categoryDescriptions = {
    'AI Readability & Multimodal': 'When your content is easy to read and includes described images, AI assistants can better understand what you offer. This means they\'re more likely to recommend you when people ask questions related to your business.',
    'AI Search Readiness': 'AI assistants like ChatGPT prefer websites that thoroughly explain their services. When your pages are comprehensive and well-organized, you\'re more likely to show up when potential customers ask AI for recommendations.',
    'Content Freshness': 'AI assistants prefer websites that are regularly updated. If your content looks outdated, AI may skip you for a competitor who seems more current and active.',
    'Content Structure': 'When your content is organized with clear headings and bullet points, AI can easily find and share specific answers from your site. Messy formatting makes it harder for AI to recommend you.',
    'Speed & UX': 'If your website is slow, AI assistants may not fully read it — and visitors will leave before they contact you. Faster pages get read, indexed, and recommended more often.',
    'Technical Setup': 'The behind-the-scenes setup of your website helps AI understand who you are and what you do. Getting this right means AI assistants can accurately describe your business to potential customers.',
    'Trust & Authority': 'AI assistants look for signs that your business is real and trustworthy — like an About page, team photos, contact info, and reviews. The more proof you show, the more confident AI is in recommending you.',
    'Voice Optimization': 'When people ask Siri, Alexa, or Google Assistant questions, they want quick, clear answers. Formatting your content for voice search makes it more likely AI will read your answer out loud to potential customers.'
  };

  return categoryDescriptions[category] ||
    `Improving this helps AI assistants like ChatGPT and Google understand your business better, making them more likely to recommend you to potential customers.`;
}

async function generateWithChatGPT(issue, scanEvidence, tier, industry) {
  const template = RECOMMENDATION_TEMPLATES[issue.subfactor] || {
    title: `Improve ${issue.subfactor.replace(/Score$/, '').replace(/([A-Z])/g, ' $1').trim()}`,
    impactArea: issue.category,
    whyItMatters: getContextualWhyItMatters(issue.category, issue.subfactor),
    typicalTimeToFix: "Varies",
    difficulty: "Medium",
    estimatedGain: 10
  };

  const prompt = buildChatGPTPrompt(issue, scanEvidence, template, tier, industry);

  let gptResponse = '';
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.3,
      max_tokens: (tier === 'diy' ? 1800 : 3000),
      messages: [
        { role: 'system', content: 'You are an AEO expert. Return concrete step-by-step instructions and avoid generic advice.' },
        { role: 'user', content: prompt }
      ]
    });

 // 🔍 DEBUG: Log token usage
    console.log('🔍 TOKEN USAGE:', resp.usage);
    console.log('🔍 Response length:', resp.choices?.[0]?.message?.content?.length, 'chars');
    console.log('🔍 Finish reason:', resp.choices?.[0]?.finish_reason);

    gptResponse = resp.choices?.[0]?.message?.content || '';
  } catch (e) {
    console.error('OpenAI error:', e?.response?.data || e.message);
    // fall back to template
    return generateSmartTemplate(issue, scanEvidence, tier, industry);
  }

  // Package result (we parse bracketed sections)
  const rec = structureRecommendation(gptResponse, issue, template, tier, 'chatgpt');
  return coerceRecommendation(rec, template, issue);
}

function buildChatGPTPrompt(issue, scanEvidence, template, tier, industry) {
  const { profile, facts } = normalizeEvidence(scanEvidence);

  const siteShape = buildSiteShapeDescription(profile);
  const factsSection = buildFactsSection(facts);
  const scoreBreakdown = calculateScoreBreakdown(issue);
  const neededSchemas = determineNeededSchemas(issue, profile, scanEvidence);

  // Get category and subfactor display names
  const categoryName = CATEGORY_NAMES[issue.category] || issue.category;
  const subfactorName = SUBFACTOR_NAMES[issue.subfactor] || issue.subfactor;

  // Build list of EXISTING schemas to explicitly exclude from recommendations
  const existingSchemas = [];
  if (scanEvidence.technical?.hasOrganizationSchema) existingSchemas.push('Organization');
  if (scanEvidence.technical?.hasFAQSchema) existingSchemas.push('FAQPage');
  if (scanEvidence.technical?.hasLocalBusinessSchema) existingSchemas.push('LocalBusiness');
  if (scanEvidence.technical?.hasArticleSchema) existingSchemas.push('Article/BlogPosting');
  if (scanEvidence.technical?.hasBreadcrumbSchema) existingSchemas.push('BreadcrumbList');
  const existingSchemasText = existingSchemas.length > 0
    ? `\n\n**EXISTING SCHEMAS (DO NOT RECOMMEND ADDING THESE):**\n✅ ${existingSchemas.join('\n✅ ')}\n- These schemas are ALREADY IMPLEMENTED on the site\n- DO NOT recommend adding these schemas again\n- Focus only on schemas that are MISSING`
    : '';

  return `You are an AI Search Optimization expert generating PRESCRIPTIVE, ready-to-implement recommendations.

**WEBSITE ANALYSIS**
URL: ${scanEvidence.url}
Industry: ${industry || 'General'}
Category: ${categoryName}
Issue: ${subfactorName} (${issue.currentScore}/100)

**SITE SHAPE DETECTED**
${siteShape}

**EXTRACTED FACTS**
${factsSection}

**CURRENT STATE**
${buildCurrentState(issue, scanEvidence)}${existingSchemasText}

**SCORE BREAKDOWN**
Current: ${issue.currentScore}/100
Target: ${issue.threshold}/100
Gap: ${issue.gap} points
Projected Impact: +${scoreBreakdown.min}-${scoreBreakdown.max} points
- Coverage (40%): ${scoreBreakdown.coverage}
- Completeness (30%): ${scoreBreakdown.completeness}
- Consistency (20%): ${scoreBreakdown.consistency}
- Crawlability (10%): ${scoreBreakdown.crawlability}

---
Generate the following sections with concrete, non-generic content:

[TITLE]
Format: "${categoryName}: ${subfactorName}"
- Use this EXACT format with the category and subfactor names provided above
- Example: "AI Search Readiness: Product Schema"
- Example: "Technical Setup: Organization Schema"

[FINDING]
Provide a detailed, specific finding with:
1. Status line: "Status: Missing" or "Status: Incomplete" or "Status: Needs Improvement"
2. Specific observation based on EXTRACTED FACTS
3. List of detected items (products, services, features, pages, etc.) with bullet points
4. Include actual numbers and metrics from CURRENT STATE

Example format:
Status: Missing
Multiple products mentioned but no Product schema detected:
• ThinkSystem SR675 V3 server (up to 8 NVIDIA GPUs)
• Lenovo Neptune Liquid Cooling technology
• NVIDIA H100 NVL, H200 NVL GPUs

[IMPACT]
Write 1-2 sentences explaining the business impact in plain language.
- Focus on how this affects search engines, AI assistants, and user discovery
- Mention specific visibility/ranking/citation impacts
- Example: "Search engines and AI cannot understand product specifications, pricing context, or purchase intent signals."

[APPLY INSTRUCTIONS]
CRITICAL: Format as a FLAT numbered list of actionable steps (5-7 steps maximum).
- Each step must be a complete, self-contained instruction
- NO nested bullets, NO sub-sections, NO "Steps: a) b) c)" format
- Include file names, specific actions, and validation in each step
- Do not use raw HTML tags like <h1> or <head>; write them as: h1, h2, head

GOOD Example:
1. Open your homepage template file (e.g., index.html) in your code editor.
2. Locate the head section at the top of the HTML file.
3. Paste the meta tags from the CODE section below into the head, just before the closing /head tag.
4. Save the file and upload to your server.
5. Validate using Facebook Sharing Debugger at developers.facebook.com/tools/debug/.

BAD Example (DO NOT USE):
1. Add FAQ Section:
   - File: index.html
   - Steps: a) Create page b) Add questions
   - Validation: Check menu

DO NOT include any code blocks in this section. Put all code in [CODE].

${tier !== 'free' && neededSchemas.length ? `
[PRE-FILLED JSON-LD]
CRITICAL: Pre-fill ALL fields with actual data from EXTRACTED FACTS above.
- DO NOT use placeholders like [Your Company Name] or [INSERT X]
- Use actual brand name, products, services, contact info from the facts
- If data is missing from facts, omit that field entirely
- Use stable @ids like ${scanEvidence.url}/#organization
- Link schemas (Organization → logo, WebSite → publisher)
- For multiple products/services, generate schema for EACH ONE detected
- Required schemas:
${neededSchemas.map((s, i) => `${i + 1}. ${s.type} — use: ${s.useData}`).join('\n')}

Example of pre-filled Product schema:
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "ThinkSystem SR675 V3",
  "brand": { "@type": "Brand", "name": "Lenovo" },
  "description": "Up to 8 NVIDIA H100/H200 NVL GPUs",
  ...
}

Then repeat for each product detected.
` : ''}

[CODE]
- If any code is required (HTML/JSON-LD/meta tags), include ONLY here
- PRE-FILL with actual data from EXTRACTED FACTS (no placeholders!)
- Use the smallest working snippet
- For schema markup, generate separate blocks for EACH item detected

[QUICK WINS]
- 2 or 3 actionable wins based on detected profile/sections.

Output ONLY the following sections in this exact order, each starting on its own line:

[TITLE]
[FINDING]
[IMPACT]
[APPLY INSTRUCTIONS]
[CODE]
[QUICK WINS]
[END]

Rules:
- Do NOT include any additional commentary outside these sections.
- Put ALL code (HTML/JSON-LD/meta tags) ONLY in [CODE].
- Do NOT include code fences (no triple backticks) inside [APPLY INSTRUCTIONS]. Use [CODE] for code fences.
- Keep each section concise and specific.`;
}

// -----------------------------------------
// Programmatic recommendations (deterministic)
// -----------------------------------------

// Industry-specific FAQ libraries (rich, ready-to-use content)
const FAQ_LIBRARIES = {
  Agency: {
    title: "AI Search Readiness: FAQ Section",
    questions: [
      {
        q: "How do you measure and report on marketing ROI?",
        pageAnswer: "We connect every initiative to outcomes like revenue, qualified pipeline, and CAC. You'll get transparent reports that show which channels drive results, plus a live dashboard so you always know what's working.",
        schemaAnswer: "We connect marketing activity to outcomes like qualified pipeline, revenue influence, and CAC. Our approach uses multi-touch attribution where feasible and clear performance tracking across channels, with scheduled reports and a live dashboard."
      },
      {
        q: "What makes your agency different from others?",
        pageAnswer: "We're an AI-first, B2B marketing partner specialized in your industry vertical. Instead of generic tactics, we use answer-engine optimization and AI-readable content to help the right buyers find, understand, and trust you.",
        schemaAnswer: "We are an AI-first, B2B-focused team specializing in answer-engine optimization (AEO) and AI-readable content so assistants can accurately match you to high-fit intent, not generic searches."
      },
      {
        q: "How long until we see results?",
        pageAnswer: "Quick wins (e.g., conversion improvements, qualified demos) typically appear within weeks; durable gains from programs like content/AEO build over a few months. We set expectations up front and report progress on a regular cadence.",
        schemaAnswer: "Tactical improvements (e.g., conversion lifts) can appear within weeks; strategic programs like content/AEO typically show meaningful, compounding results over several months. We set milestones and report progress regularly."
      },
      {
        q: "What does it cost to work with you?",
        pageAnswer: "Investment depends on scope and goals. We share a clear proposal with deliverables and reporting so you can see value-for-spend and make decisions with confidence.",
        schemaAnswer: "Investment varies by scope and goals. We share transparent proposals with deliverables, reporting, and success metrics so you can evaluate value-for-spend and expected outcomes."
      },
      {
        q: "Do you require long-term contracts?",
        pageAnswer: "We prefer flexible terms and aim to earn your renewal with results—not lock-ins. We set clear goals, deliverables, and review cadence so you always know where we stand.",
        schemaAnswer: "We favor flexible terms and aim to earn ongoing partnership through results. Engagements include clear deliverables, communication cadence, and success metrics with reasonable cancellation notice."
      }
    ],
    impact: "FAQs consistently surface in rich results and AI answers. Adding a focused set of agency FAQs improves entity clarity, reduces pre-sales friction, and qualifies leads earlier.",
    quickWins: [
      "Link the FAQ headings in-page (anchor links) and from your Help/Resources menu",
      "Add the FAQ page to your sitemap and include it in your internal linking from Services and Pricing pages",
      "Reuse these Q&As in your chatbot prompts and Answer Engine optimization"
    ]
  },
  SaaS: {
    title: "AI Search Readiness: FAQ Section",
    questions: [
      {
        q: "How does pricing work?",
        pageAnswer: "We offer flexible pricing based on your team size and feature needs. Start with our free plan to test core features, then upgrade to unlock advanced capabilities, integrations, and priority support.",
        schemaAnswer: "Pricing is usage-based with free and paid tiers. Free plans include core features; paid plans unlock advanced capabilities, integrations, and priority support scaled to team size."
      },
      {
        q: "What integrations do you support?",
        pageAnswer: "We integrate with 50+ popular tools including Slack, Salesforce, HubSpot, Zapier, and major CRMs. Native API access lets you build custom integrations for your workflow.",
        schemaAnswer: "We support 50+ native integrations including Slack, Salesforce, HubSpot, Zapier, and major CRMs, plus REST API for custom integrations."
      },
      {
        q: "How secure is our data?",
        pageAnswer: "Enterprise-grade security is standard: SOC 2 Type II certified, end-to-end encryption, role-based access controls, and regular third-party audits. Your data stays yours—we never train AI models on customer data.",
        schemaAnswer: "We maintain SOC 2 Type II certification, end-to-end encryption, role-based access controls, and regular security audits. Customer data is never used for AI training."
      },
      {
        q: "Can I try it before buying?",
        pageAnswer: "Yes! Start with our 14-day free trial—no credit card required. You'll get full access to premium features so you can test everything with your real workflows before committing.",
        schemaAnswer: "14-day free trial with full premium access, no credit card required. Test all features with your actual workflows before purchasing."
      },
      {
        q: "What kind of support do you offer?",
        pageAnswer: "All plans include email support and comprehensive documentation. Paid plans add live chat and priority response times. Enterprise customers get dedicated success managers and custom onboarding.",
        schemaAnswer: "Support ranges from email and documentation (all plans) to live chat and priority response (paid plans) to dedicated success managers (enterprise)."
      }
    ],
    impact: "FAQs help AI assistants and buyers quickly evaluate fit, reducing friction in the purchase journey and improving qualified demo requests.",
    quickWins: [
      "Add FAQ schema to pricing and product pages for rich snippet eligibility",
      "Link FAQs from your chatbot and support widget for instant answers",
      "Include FAQ content in your demo request flow to pre-qualify leads"
    ]
  },
  General: {
    title: "AI Search Readiness: FAQ Section",
    questions: [
      {
        q: "What services or products do you offer?",
        pageAnswer: "We provide solutions designed to solve specific customer challenges. Our offerings include core products/services, support resources, and ongoing updates to ensure you get maximum value.",
        schemaAnswer: "We offer comprehensive solutions including core products/services, support resources, and continuous updates for maximum customer value."
      },
      {
        q: "How do I get started?",
        pageAnswer: "Getting started is simple: explore our offerings, choose what fits your needs, and follow the guided setup process. Our team is available to help with onboarding and answer questions.",
        schemaAnswer: "Start by exploring offerings, selecting what fits your needs, and following guided setup. Onboarding support is available."
      },
      {
        q: "What makes you different from competitors?",
        pageAnswer: "We focus on delivering measurable results through proven methodologies, transparent communication, and customer-centric service. Our approach combines innovation with reliability.",
        schemaAnswer: "We deliver measurable results through proven methodologies, transparent communication, and customer-centric service combining innovation with reliability."
      },
      {
        q: "How long does implementation take?",
        pageAnswer: "Typical implementations range from days to weeks depending on complexity. We provide clear timelines upfront and keep you informed throughout the process.",
        schemaAnswer: "Implementation timelines range from days to weeks based on complexity, with clear milestones and regular progress updates."
      },
      {
        q: "What support options are available?",
        pageAnswer: "We offer multiple support channels including documentation, email support, and live assistance. Premium customers receive priority access and dedicated account management.",
        schemaAnswer: "Support includes documentation, email, and live assistance, with premium customers receiving priority access and dedicated account management."
      }
    ],
    impact: "FAQs help search engines and AI assistants extract clear answers about your offerings, improving discoverability and reducing barriers to engagement.",
    quickWins: [
      "Link FAQs from your main navigation and footer for easy access",
      "Include FAQ schema in your homepage and key landing pages",
      "Update FAQs quarterly based on actual customer questions from support tickets"
    ]
  }
};

/**
 * Load and transform rich FAQ library to match expected structure
 * Falls back to hardcoded FAQs if rich library doesn't exist
 */
function loadFAQLibrary(industry) {
  // Map detected industry names to library filenames
  const industryMappings = {
    // Exact matches from content-extractor.js to library filenames
    'UCaaS': 'ucaas',
    'Cybersecurity': 'cybersecurity',
    'Fintech': 'fintech',
    'AI Infrastructure': 'ai-infrastructure',
    'AI Startups': 'ai-startups',
    'Data Center': 'data-center',
    'Digital Infrastructure': 'digital-infrastructure',
    'ICT Hardware': 'ict-hardware',
    'Managed Service Provider': 'managed-service-providers',
    'Telecom Service Provider': 'telecom-service-providers',
    'Telecom Software': 'telecom-software',
    'Mobile Connectivity': 'mobile-connectivity-esim',
    'SaaS': 'saas-b2b',
    'Agency': 'marketing-agencies',

    // Fallback mapping for Financial → Fintech
    'Financial': 'fintech',

    // No library for these, will use hardcoded
    'General': null,
    'Healthcare': null,
    'Legal': null,
    'Real Estate': null,
    'E-commerce': null,
    'Education': null,
    'Restaurant': null
  };

  // Get the mapped library filename
  const mappedIndustry = industryMappings[industry] !== undefined
    ? industryMappings[industry]
    : industry;

  // Try to load rich library first
  if (mappedIndustry && hasLibrary(mappedIndustry)) {
    console.log(`✅ Found rich FAQ library for ${industry} (mapped to ${mappedIndustry})`);
    const richLib = loadLibrary(mappedIndustry);

    if (richLib && richLib.faqs && richLib.faqs.length > 0) {
      // Transform rich library structure to match hardcoded structure
      const transformedLib = {
        title: `AI Search Readiness: FAQ Section`,
        questions: richLib.faqs.map(faq => ({
          q: faq.question,
          pageAnswer: faq.answer_human_friendly?.text || faq.answer_factual_backend?.text || '',
          schemaAnswer: faq.answer_factual_backend?.text || faq.answer_human_friendly?.text || ''
        })),
        impact: richLib.faqs.map(f => f.expected_impact).filter(Boolean).join(', ') ||
                "FAQs help AI assistants extract clear answers about your offerings, improving discoverability.",
        quickWins: [
          "Link FAQs from your main navigation and footer for easy access",
          "Include FAQ schema in your homepage and key landing pages",
          "Update FAQs quarterly based on actual customer questions from support tickets"
        ]
      };

      console.log(`✅ Transformed rich library: ${transformedLib.questions.length} FAQs`);
      return transformedLib;
    }
  }

  console.log(`⚠️  No rich library for ${industry}, checking hardcoded fallback`);
  return null;
}

// ========================================
// DYNAMIC DETECTION WRAPPER
// Wraps any generator to add dynamic "detected/implemented" logic
// ========================================

/**
 * Wraps a recommendation generator to add dynamic detection logic.
 * Checks if the issue is already implemented and returns appropriate text.
 *
 * @param {Function} generatorFn - The original generator function
 * @param {Object} issue - The detected issue
 * @param {Object} scanEvidence - Evidence from the scan
 * @param {*} additionalArgs - Any additional arguments for the generator
 * @returns {Object} - Recommendation with dynamic status
 */
function wrapWithDynamicDetection(generatorFn, issue, scanEvidence, ...additionalArgs) {
  const currentScore = issue.currentScore || 0;
  const threshold = issue.threshold || 70;
  const isImplemented = currentScore >= threshold;

  // Get dynamic text from configuration
  const dynamicText = getRecommendationText(
    issue.subfactor,
    currentScore,
    threshold,
    scanEvidence
  );

  // If already implemented, return success message
  if (isImplemented && dynamicText.status === 'detected_implemented') {
    return {
      id: `rec_${issue.category}_${issue.subfactor}_${Date.now()}`,
      title: dynamicText.title,
      category: issue.category,
      subfactor: issue.subfactor,
      priority: dynamicText.priority || 'low',
      priorityScore: 10,
      finding: dynamicText.finding,
      impact: dynamicText.whyItMatters,
      actionSteps: dynamicText.nextSteps ? [dynamicText.nextSteps] : ['Your implementation is complete', 'Continue monitoring and optimizing'],
      codeSnippet: '<!-- Already implemented! -->',
      implementationNotes: ['Implementation detected and validated', 'Continue monitoring'],
      quickWins: ['✅ Already implemented', '✅ Score above threshold'],
      validationChecklist: ['✅ Implementation detected', '✅ Score above threshold'],
      estimatedTime: "N/A - Already implemented",
      difficulty: "Completed",
      estimatedScoreGain: 0,
      currentScore: currentScore,
      targetScore: threshold,
      status: 'detected_implemented',
      evidence: scanEvidence,
      generatedBy: `${issue.subfactor}_detected`
    };
  }

  // Not implemented - call the original generator
  const recommendation = generatorFn(issue, scanEvidence, ...additionalArgs);

  // Add status if not already present
  if (!recommendation.status) {
    recommendation.status = 'not_implemented';
  }

  // Update finding/impact with dynamic text if available
  if (dynamicText.finding && !recommendation.finding.includes('✅')) {
    recommendation.finding = dynamicText.finding;
  }
  if (dynamicText.whyItMatters && !recommendation.impact) {
    recommendation.impact = dynamicText.whyItMatters;
  }

  return recommendation;
}

// ========================================
// FAQ SCHEMA GENERATOR (Split from combined FAQ generator)
// ========================================

function makeProgrammaticFAQSchemaRecommendation(issue, scanEvidence, subfactorScores, industry) {
  console.log('🎯 Starting FAQ SCHEMA recommendation generation...');
  const domain = extractDomain(scanEvidence.url);
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const detectedIndustry = industry || 'General';

  // Check current score to determine if already implemented
  const currentScore = issue.currentScore || 0;
  const threshold = issue.threshold || 70;
  const isImplemented = currentScore >= threshold;
  const hasFAQSchema = scanEvidence.technical?.hasFAQSchema;

  // Check if visible FAQ content exists
  const hasVisibleContent = subfactorScores?.aiSearchReadiness?.faqContentScore >= 70;
  const actualFAQs = scanEvidence.content?.faqs || [];
  const faqCount = actualFAQs.length;

  console.log(`📊 FAQ Schema Analysis: Current Score=${currentScore}/${threshold}, Implemented=${isImplemented}, Has visible content: ${hasVisibleContent ? 'Yes' : 'No'}`);

  // If already implemented, show success message
  if (isImplemented && hasFAQSchema) {
    return {
      id: `rec_${issue.category}_${issue.subfactor}_${Date.now()}`,
      title: `${CATEGORY_NAMES[issue.category] || issue.category}: FAQ Schema`,
      category: issue.category,
      subfactor: "faqSchemaScore",
      priority: 'low',
      priorityScore: 10,
      finding: `Status: Excellent! ✅

FAQPage schema markup detected on ${domain}. Your FAQ schema implementation is complete! AI assistants like ChatGPT and Google can now properly parse and cite your FAQ content.

Current Score: ${currentScore}/100 (Target: ${threshold}/100)`,
      impact: `Your FAQ schema is properly implemented. Continue monitoring and ensure the schema stays synchronized with your visible FAQ content.`,
      actionSteps: [
        'Your FAQ schema implementation is complete',
        'Ensure schema matches your visible FAQ content',
        'Update schema whenever you update FAQ content',
        'Monitor Google Search Console for FAQ rich results',
        'Consider adding more FAQs on other pages for broader coverage'
      ],
      codeSnippet: '<!-- Your FAQ schema is already implemented! -->',
      implementationNotes: [
        'Schema detected and validated',
        'Keep schema synchronized with visible content',
        'Update quarterly based on customer questions'
      ],
      quickWins: ['✅ Schema already implemented', '✅ AI can parse your FAQs', '✅ Ready for rich results'],
      validationChecklist: [
        '✅ FAQPage schema detected',
        '✅ Score above threshold',
        'Continue monitoring implementation'
      ],
      estimatedTime: "N/A - Already implemented",
      difficulty: "Completed",
      estimatedScoreGain: 0,
      currentScore: currentScore,
      targetScore: threshold,
      status: 'detected_implemented',
      evidence: {
        hasVisibleContent: hasVisibleContent,
        hasFAQSchema: hasFAQSchema,
        faqCount: faqCount,
        industry: detectedIndustry
      },
      generatedBy: 'faq_schema_detected'
    };
  }

  // Not implemented - show action needed
  // Determine what FAQs to use in schema
  let faqsToUse = [];
  let usingActualContent = false;

  if (faqCount > 0) {
    usingActualContent = true;
    faqsToUse = actualFAQs.map(faq => ({
      q: faq.question,
      pageAnswer: faq.answer,
      schemaAnswer: faq.answer.substring(0, 300)
    }));
    console.log(`✅ Using ${faqCount} ACTUAL FAQs from website for schema`);
  } else {
    let faqLib = loadFAQLibrary(detectedIndustry);
    if (!faqLib) {
      faqLib = FAQ_LIBRARIES[detectedIndustry] || FAQ_LIBRARIES.General;
    }
    faqsToUse = faqLib.questions;
    console.log(`📋 Using ${faqsToUse.length} template FAQs for schema`);
  }

  // Build finding based on context
  let finding;
  if (hasVisibleContent) {
    finding = `Status: Missing Schema Markup

You have visible FAQ content on ${domain}, but no FAQPage schema markup detected. AI assistants need structured schema to properly parse your FAQs.

Current Score: ${currentScore}/100 (Target: ${threshold}/100, Gap: ${threshold - currentScore} points)

Without schema, AI assistants see your FAQs as plain text and may miss them entirely. Adding schema makes them instantly recognizable.`;
  } else {
    finding = `Status: Missing Both Schema and Content

No FAQ schema or visible content detected on ${domain}. FAQs help AI assistants answer questions about your business, and schema makes them parseable.

Current Score: ${currentScore}/100 (Target: ${threshold}/100, Gap: ${threshold - currentScore} points)

This recommendation focuses on adding the schema markup. You'll also want to add visible FAQ content (see separate recommendation).`;
  }

  // Build FAQ schema
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqsToUse.map(faq => ({
      "@type": "Question",
      "name": faq.q,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.schemaAnswer
      }
    }))
  };

  const schemaCode = `<script type="application/ld+json">\n${JSON.stringify(faqSchema, null, 2)}\n</script>`;

  // Build recommendation
  const categoryName = CATEGORY_NAMES[issue.category] || issue.category;
  const title = hasVisibleContent ?
    `${categoryName}: Add FAQ Schema Markup` :
    `${categoryName}: Add FAQ Schema (and Content)`;

  const impact = hasVisibleContent ?
    `You already have FAQ content on your page — great! But AI assistants can't easily find it yet. Adding a simple code snippet (FAQ schema) makes your answers instantly visible to ChatGPT, Google, and voice assistants like Siri and Alexa.` :
    `Adding FAQ schema is a foundation for AI visibility. Once you have both schema and visible content, AI assistants can extract and cite your answers in voice search and rich results.`;

  const actionSteps = hasVisibleContent ?
    `1. The system has detected your ${faqCount} existing FAQs and generated schema for you
2. Copy the FAQ Schema JSON-LD below (it contains YOUR actual questions and answers)
3. Paste the JSON-LD into your page <head> tag or via Google Tag Manager
4. Validate in Google Rich Results Test (search.google.com/test/rich-results)
5. Re-scan in the AI Visibility Tool - your FAQ Schema score should become 100!` :
    `1. Add a dedicated FAQ section to your page with visible Q&A pairs (see "FAQ Content" recommendation)
2. Copy the FAQ Schema JSON-LD below
3. Paste the JSON-LD into your page <head> tag or via Google Tag Manager
4. Validate in Google Rich Results Test (search.google.com/test/rich-results)
5. Re-scan in the AI Visibility Tool to confirm both FAQ scores improve`;

  const implementationNotes = [
    'FAQ schema must match your visible on-page content',
    'Each answer in schema should be 300 characters or less',
    'Validate with Google Rich Results Test to ensure no errors',
    'Update schema whenever you update your FAQ content'
  ];

  const validationChecklist = [
    'Google Rich Results Test: FAQPage schema detected, no warnings',
    'Schema.org validator shows valid FAQPage markup',
    'Re-scan in AI Visibility Tool: "FAQ Schema Score" reaches 100',
    'Schema questions match visible FAQ content on page'
  ];

  let customizedImplementation = '';
  if (usingActualContent) {
    customizedImplementation = `### Your FAQ Schema (Generated from Your Actual FAQs)\n\nThe system extracted your ${faqCount} existing FAQs and generated schema for you:\n\n${faqsToUse.map((faq, idx) => `**Q${idx + 1}: ${faq.q}**\n(Schema answer: ${faq.schemaAnswer}...)`).join('\n\n')}\n\nJust copy the schema code below and add it to your page!`;
  } else {
    customizedImplementation = `### FAQ Schema Template for ${detectedIndustry}\n\nHere's a ready-to-use FAQ schema template:\n\n${faqsToUse.map((faq, idx) => `**Q${idx + 1}: ${faq.q}**\n(${faq.schemaAnswer}...)`).join('\n\n')}\n\nCustomize the answers to match your business, then add the schema code below.`;
  }

  return {
    id: `rec_${issue.category}_${issue.subfactor}_${Date.now()}`,
    title: title,
    category: issue.category,
    subfactor: "faqSchemaScore",
    priority: issue.severity || 'high',
    priorityScore: issue.priority || 85,
    finding: finding,
    impact: impact,
    actionSteps: actionSteps.split('\n').filter(s => s.trim()),
    codeSnippet: `## FAQ Schema Implementation\n\n${schemaCode}`,
    customizedImplementation: customizedImplementation,
    readyToUseContent: schemaCode,
    implementationNotes: implementationNotes,
    quickWins: hasVisibleContent ?
      [`${faqCount} FAQs already detected - just add schema!`, 'Simple copy-paste implementation', 'Instant AI visibility boost'] :
      ['Foundation for AI visibility', 'Pairs with visible FAQ content', 'Easy to validate with Google tools'],
    validationChecklist: validationChecklist,
    estimatedTime: "15-30 minutes",
    difficulty: "Moderate",
    estimatedScoreGain: Math.max(12, Math.round(issue.gap * 0.8)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    status: 'not_implemented',
    evidence: {
      hasVisibleContent: hasVisibleContent,
      faqCount: faqCount,
      usingActualContent: usingActualContent,
      industry: detectedIndustry
    },
    generatedBy: usingActualContent ? 'actual_faq_schema_extraction' : 'programmatic_faq_schema_library'
  };
}

// ========================================
// FAQ CONTENT GENERATOR (Split from combined FAQ generator)
// ========================================

function makeProgrammaticFAQContentRecommendation(issue, scanEvidence, subfactorScores, industry) {
  console.log('🎯 Starting FAQ CONTENT recommendation generation...');
  const domain = extractDomain(scanEvidence.url);
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const detectedIndustry = industry || 'General';

  // Check current score to determine if already implemented
  const currentScore = issue.currentScore || 0;
  const threshold = issue.threshold || 70;
  const isImplemented = currentScore >= threshold;

  // Check if FAQ schema exists
  const hasSchema = subfactorScores?.aiSearchReadiness?.faqSchemaScore >= 70;
  const hasFAQSchema = scanEvidence.technical?.hasFAQSchema;
  const actualFAQs = scanEvidence.content?.faqs || [];
  const faqCount = actualFAQs.length;

  console.log(`📊 FAQ Content Analysis: Current Score=${currentScore}/${threshold}, Implemented=${isImplemented}, Has schema: ${hasSchema ? 'Yes' : 'No'}`);

  // If already implemented, show success message
  if (isImplemented && faqCount >= 3) {
    return {
      id: `rec_${issue.category}_${issue.subfactor}_${Date.now()}`,
      title: `${CATEGORY_NAMES[issue.category] || issue.category}: FAQ Content`,
      category: issue.category,
      subfactor: "faqContentScore",
      priority: 'low',
      priorityScore: 10,
      finding: `Status: Excellent! ✅

${faqCount} FAQ pairs detected on-page${hasFAQSchema ? ' WITH FAQPage schema markup' : ''}. Your FAQ implementation is ${hasFAQSchema ? 'strong!' : 'good - consider adding schema markup for even better AI visibility.'} The system has analyzed your actual FAQs and they cover relevant topics for your audience.

Current Score: ${currentScore}/100 (Target: ${threshold}/100)`,
      impact: `Your visible FAQ content is complete${hasFAQSchema ? ' and paired with schema markup' : ''}. Continue monitoring and updating FAQs based on actual customer questions from support tickets and sales calls.`,
      actionSteps: [
        'Your FAQ content implementation is complete',
        'Ensure FAQs are distributed across multiple pages (About, Services, Contact) for maximum AI visibility',
        'Update FAQs quarterly based on customer questions',
        hasFAQSchema ? 'Monitor Google Search Console for FAQ rich results' : 'Consider adding FAQ schema markup (see "FAQ Schema" recommendation)',
        'Keep answers concise and natural'
      ],
      codeSnippet: '<!-- Your FAQ content is already implemented! -->',
      implementationNotes: [
        'FAQ content detected and validated',
        `${faqCount} Q&A pairs found on page`,
        'Continue monitoring customer questions for new FAQs'
      ],
      quickWins: ['✅ FAQ content already implemented', `✅ ${faqCount} Q&A pairs detected`, '✅ Visible to users and AI'],
      validationChecklist: [
        '✅ FAQ content detected on page',
        '✅ Score above threshold',
        'Continue monitoring implementation'
      ],
      estimatedTime: "N/A - Already implemented",
      difficulty: "Completed",
      estimatedScoreGain: 0,
      currentScore: currentScore,
      targetScore: threshold,
      status: 'detected_implemented',
      evidence: {
        hasSchema: hasSchema,
        hasFAQSchema: hasFAQSchema,
        faqCount: faqCount,
        industry: detectedIndustry
      },
      generatedBy: 'faq_content_detected'
    };
  }

  // Not implemented - show action needed
  // Get FAQ templates for this industry
  let faqLib = loadFAQLibrary(detectedIndustry);
  if (!faqLib) {
    faqLib = FAQ_LIBRARIES[detectedIndustry] || FAQ_LIBRARIES.General;
  }
  const templateFAQs = faqLib.questions;

  // Build finding based on context
  let finding;
  if (hasSchema) {
    finding = `Status: Missing Visible Content

You have FAQ schema markup but no visible FAQ section detected on ${domain}. Users and AI assistants need to see the actual questions and answers, not just hidden schema.

Current Score: ${currentScore}/100 (Target: ${threshold}/100, Gap: ${threshold - currentScore} points)

Schema alone is not enough - AI needs to see the content to cite it properly.`;
  } else {
    finding = `Status: Missing Visible Content

No visible FAQ content detected on ${domain}. FAQs help both users and AI assistants understand your business better.

Current Score: ${currentScore}/100 (Target: ${threshold}/100, Gap: ${threshold - currentScore} points)

Adding a visible FAQ section makes your expertise accessible to everyone.`;
  }

  const faqPageCopy = templateFAQs.map((faq, idx) =>
    `Q${idx + 1}. ${faq.q}\n${faq.pageAnswer}`
  ).join('\n\n');

  const frontendCode = `<!-- Add this FAQ section to your page HTML -->\n<section class="faq-section">\n  <h2>Frequently Asked Questions</h2>\n  \n${templateFAQs.map((faq, idx) => `  <div class="faq-item">\n    <h3>${faq.q}</h3>\n    <p>${faq.pageAnswer}</p>\n  </div>`).join('\n\n')}\n</section>`;

  const categoryName = CATEGORY_NAMES[issue.category] || issue.category;
  const title = hasSchema ?
    `${categoryName}: Add Visible FAQ Section to Match Schema` :
    `${categoryName}: Add Visible FAQ Content`;

  const impact = hasSchema ?
    `You have FAQ schema, but visible content gives AI assistants the actual answers to extract. Schema tells AI "these are FAQs" - content gives AI "here are the answers to cite."` :
    `Adding a visible FAQ section is one of the fastest ways to get recommended by AI. When someone asks ChatGPT a question you've answered on your website, you're much more likely to show up as a recommendation.`;

  const actionSteps = hasSchema ?
    `1. Add a dedicated FAQ section to your page (below your primary CTA or above the footer)
2. Copy the ready-to-use FAQ content from below
3. Paste the Q&A pairs into your page HTML so they're visible to users
4. Ensure your FAQ schema matches the new visible content
5. Re-scan in the AI Visibility Tool - your FAQ Content score should become 100!` :
    `1. Add a dedicated FAQ section to your page (below your primary CTA or above the footer)
2. Copy the ready-to-use FAQ content from below (industry-specific for ${detectedIndustry})
3. Paste the Q&A pairs into your page HTML
4. Consider adding FAQ schema markup (see "FAQ Schema" recommendation)
5. Re-scan in the AI Visibility Tool to confirm your FAQ Content score improves`;

  const implementationNotes = [
    'Keep each answer concise (80-140 words)',
    'Update FAQ content quarterly based on actual customer questions',
    'Ensure Q&A pairs are visible (not hidden behind accordions that block crawlers)',
    'Use natural language that matches how customers ask questions'
  ];

  const validationChecklist = [
    'FAQ section visible on page without JavaScript',
    'Questions match common customer inquiries',
    'Answers are clear, concise, and accurate',
    'Re-scan in AI Visibility Tool: "FAQ Content Score" reaches 100'
  ];

  const customizedImplementation = `### FAQ Content for ${detectedIndustry}\n\n${hasSchema ? 'You already have FAQ schema. Now add visible content to match:' : 'Here are industry-specific questions for your FAQ section:'}\n\n${templateFAQs.map((faq, idx) => `**Q${idx + 1}: ${faq.q}**\n\n${faq.pageAnswer}`).join('\n\n---\n\n')}\n\nThese questions target common search queries in the ${detectedIndustry} industry and will help AI understand your business expertise.`;

  return {
    id: `rec_${issue.category}_${issue.subfactor}_${Date.now()}`,
    title: title,
    category: issue.category,
    subfactor: "faqContentScore",
    priority: issue.severity || 'high',
    priorityScore: issue.priority || 80,
    finding: finding,
    impact: impact,
    actionSteps: actionSteps.split('\n').filter(s => s.trim()),
    codeSnippet: `## Frontend Implementation (Page Content)\n\n${frontendCode}`,
    customizedImplementation: customizedImplementation,
    readyToUseContent: faqPageCopy,
    implementationNotes: implementationNotes,
    quickWins: hasSchema ?
      ['Schema already in place - just add visible content', 'Ready-to-use copy provided', 'Quick implementation'] :
      (FAQ_LIBRARIES[detectedIndustry] || FAQ_LIBRARIES.General).quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: "30-60 minutes",
    difficulty: "Easy",
    estimatedScoreGain: Math.max(12, Math.round(issue.gap * 0.8)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    status: 'not_implemented',
    evidence: {
      hasSchema: hasSchema,
      hasFAQSchema: hasFAQSchema,
      faqCount: faqCount,
      industry: detectedIndustry
    },
    generatedBy: 'programmatic_faq_content_library'
  };
}

// ========================================
// OLD COMBINED FAQ GENERATOR (DEPRECATED)
// Kept for reference, but no longer called
// ========================================

function makeProgrammaticFAQRecommendation(issue, scanEvidence, industry) {
  console.log('🎯 Starting FAQ recommendation generation...');
  const domain = extractDomain(scanEvidence.url);
  const { profile, facts } = normalizeEvidence(scanEvidence);

  // Use provided industry or default to General
  // Industry is passed from V5 analysis (detected from content/metadata)
  const detectedIndustry = industry || 'General';

  // Check if FAQ schema exists (but content might be missing)
  const hasFAQSchema = scanEvidence.technical?.hasFAQSchema;
  const actualFAQs = scanEvidence.content?.faqs || [];
  const faqCount = actualFAQs.length;

  console.log(`📊 FAQ Analysis: Found ${faqCount} FAQs on site, Schema: ${hasFAQSchema ? 'Yes' : 'No'}`);

  // CRITICAL: Use ACTUAL FAQs from site if they exist, otherwise use templates
  let faqsToUse = [];
  let usingActualContent = false;

  if (faqCount > 0) {
    // ✅ USER HAS REAL FAQs - Use them!
    usingActualContent = true;
    faqsToUse = actualFAQs.map(faq => ({
      q: faq.question,
      pageAnswer: faq.answer,
      schemaAnswer: faq.answer.substring(0, 300) // Truncate for schema (300 char limit)
    }));
    console.log(`✅ Using ${faqCount} ACTUAL FAQs from website (not templates)`);
  } else {
    // ❌ USER HAS NO FAQs - Provide templates
    let faqLib = loadFAQLibrary(detectedIndustry);
    if (!faqLib) {
      faqLib = FAQ_LIBRARIES[detectedIndustry] || FAQ_LIBRARIES.General;
      console.log(`📚 Using hardcoded FAQ library for: ${detectedIndustry}`);
    } else {
      console.log(`📚 Using rich FAQ library for: ${detectedIndustry}`);
    }
    faqsToUse = faqLib.questions;
    console.log(`📋 Using ${faqsToUse.length} template FAQs (no FAQs found on site)`);
  }

  // Build the finding based on what exists
  let finding;
  if (hasFAQSchema && faqCount === 0) {
    // Schema exists but no on-page FAQ content
    finding = `Status: Incomplete

FAQPage schema detected in JSON-LD, but no visible FAQ content found on ${domain}. Search engines and AI assistants need BOTH schema markup AND on-page Q&A pairs to surface your answers in rich results.

Your schema exists but is disconnected from actual user-facing FAQ content.`;
  } else if (hasFAQSchema && faqCount > 0) {
    // BOTH schema and content exist - good progress!
    // Check if they're well-distributed across pages
    if (faqCount >= 5) {
      finding = `Status: Excellent! ✅

${faqCount} FAQ pairs detected on-page WITH FAQPage schema markup. Your FAQ implementation is strong! The system has analyzed your actual FAQs and they cover relevant topics for your audience.

Next steps: Ensure FAQs are distributed across multiple pages (About, Services, Contact) for maximum AI visibility.`;
    } else {
      finding = `Status: Good Progress

${faqCount} FAQ pairs detected on-page WITH FAQPage schema markup. You're on the right track! Consider adding more FAQs (aim for 5-10 total) across different pages to cover ROI, implementation, pricing, and common objections.`;
    }
  } else if (!hasFAQSchema && faqCount > 0) {
    // Content exists but no schema
    finding = `Status: Missing Schema

${faqCount} FAQ pairs detected on-page, but no FAQPage schema markup. Your content is good, but adding schema will help AI assistants extract and cite your answers in voice search and rich results.

The system has extracted your actual FAQs and generated schema for you below - just copy and paste!`;
  } else {
    // Neither exists
    finding = `Status: Missing

No on-page FAQ content or FAQPage schema detected on ${domain}. This limits how AI assistants and search engines extract clear answers about your services, ROI, timelines, pricing, and terms.`;
  }
  // Use ACTUAL FAQs if available, otherwise templates
  const faqPageCopy = faqsToUse.map((faq, idx) =>
    `Q${idx + 1}. ${faq.q}\n${faq.pageAnswer}`
  ).join('\n\n');

  // Build JSON-LD schema from ACTUAL FAQs
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqsToUse.map(faq => ({
      "@type": "Question",
      "name": faq.q,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.schemaAnswer
      }
    }))
  };

  const schemaCode = `<script type="application/ld+json">\n${JSON.stringify(faqSchema, null, 2)}\n</script>`;

  // Build the recommendation in the exact format requested
  const categoryName = CATEGORY_NAMES[issue.category] || issue.category;
  const title = `${categoryName}: FAQ Section`;

  // Impact varies based on what exists
  let impactText;
  if (usingActualContent) {
    // User has FAQs, impact is about optimization
    if (!hasFAQSchema) {
      impactText = `You already have ${faqCount} FAQs on your page — great! But AI assistants can't easily find them yet. Adding a simple code snippet (FAQ schema) makes your answers visible to ChatGPT, Google, and voice assistants like Siri and Alexa.`;
    } else {
      impactText = `Your FAQ setup looks good! To keep improving, add new questions based on what customers actually ask you in emails, calls, or support tickets. Real customer questions are gold for AI visibility.`;
    }
  } else {
    // User has no FAQs, use simple impact message
    impactText = `Adding a FAQ section is one of the fastest ways to get recommended by AI. When someone asks ChatGPT a question you've answered on your website, you're much more likely to show up as a recommendation.`;
  }

  const impact = `${impactText}`;

  // Action steps vary based on what exists
  let actionSteps;
  if (hasFAQSchema && faqCount === 0) {
    // Schema exists but content missing - focus on adding visible content
    actionSteps = `1. Add a dedicated FAQ section to your page (below your primary CTA or above the footer)
2. Copy the ready-to-use FAQ content from the "Ready-to-use FAQ" section below
3. Paste the Q&A pairs into your page HTML so they're visible to users
4. Update your existing FAQPage schema to match the new on-page content (or replace with the schema below)
5. Validate in Google Rich Results Test to ensure schema matches visible content
6. Re-scan in the AI Visibility Tool to confirm lift in "FAQ Score"`;
  } else if (!hasFAQSchema && faqCount > 0) {
    // Content exists but schema missing - just add schema (THE SYSTEM HAS EXTRACTED YOUR REAL FAQs!)
    actionSteps = `1. The system has detected your ${faqCount} existing FAQs and generated schema for you
2. Copy the FAQ Schema JSON-LD below (it contains YOUR actual questions and answers)
3. Paste the JSON-LD into your page <head> tag or via Google Tag Manager
4. Validate in Google Rich Results Test (search.google.com/test/rich-results)
5. Re-scan in the AI Visibility Tool - your FAQ score should improve significantly!`;
  } else if (hasFAQSchema && faqCount > 0) {
    // Both exist - optimization mode
    actionSteps = `1. Your implementation is complete! No urgent action needed.
2. Optional: Review the FAQ schema below (generated from your actual FAQs) to ensure it matches your on-page content
3. Consider adding more FAQs on other pages (About, Services, Pricing) to increase coverage
4. Update FAQs quarterly based on real customer questions from support/sales
5. Monitor Google Search Console for "FAQ rich result" appearances`;
  } else {
    // Neither exists - full implementation
    actionSteps = `1. Add a dedicated FAQ section to your page (below your primary CTA or above the footer)
2. Copy the ready-to-use FAQ content from the "Ready-to-use FAQ" section below
3. Paste the Q&A pairs into your page HTML
4. Copy the FAQ Schema JSON-LD and paste it into your page <head> (or via tag manager)
5. Validate in Google Rich Results Test (search.google.com/test/rich-results)
6. Re-scan in the AI Visibility Tool to confirm lift in "FAQ Score" and "Entity Clarity"`;
  }

  // Implementation Notes as array (for structured display)
  const implementationNotes = [
    'Keep each answer concise (80-140 words on page; shorter in JSON-LD is fine)',
    'Avoid unverifiable claims (e.g., exact % lifts) unless you have public proof',
    'Update FAQ content quarterly based on actual customer questions from support tickets or sales calls',
    'Ensure Q&A pairs are visible on the page (not hidden behind collapsed accordions that block crawlers)'
  ];

  // Validation Checklist as array (for interactive checkboxes)
  const validationChecklist = [
    'Google Rich Results Test: FAQ detected, no warnings',
    'Page renders Q&A visibly (not hidden behind tabs that block crawl)',
    'Re-scan in AI Visibility Tool: "FAQ Score" and "Entity Clarity" increase',
    'FAQPage schema validates at schema.org/validator'
  ];

  // Build separate frontend and backend code
  let customizedImplementation = '';
  let readyToUseContent = '';
  let frontendCode = '';
  let backendCode = '';

  if (hasFAQSchema && faqCount === 0) {
    // Schema exists, just need on-page content (use templates)
    customizedImplementation = `### Your Customized FAQ Implementation\n\nYou already have FAQ schema in place, but you're missing visible FAQ content on your page. Here's what you need to add:\n\n**Industry-Specific Questions for ${detectedIndustry}:**\n\n${faqsToUse.map((faq, idx) => `**Q${idx + 1}: ${faq.q}**\n\n${faq.pageAnswer}`).join('\n\n---\n\n')}\n\nThese questions target common search queries in the ${detectedIndustry} industry and will help AI understand your business expertise.`;
    readyToUseContent = faqPageCopy;
    frontendCode = `<!-- Add this FAQ section to your page HTML -->\n<section class="faq-section">\n  <h2>Frequently Asked Questions</h2>\n  \n${faqsToUse.map((faq, idx) => `  <div class="faq-item">\n    <h3>${faq.q}</h3>\n    <p>${faq.pageAnswer}</p>\n  </div>`).join('\n\n')}\n</section>`;
    backendCode = `**Note:** You already have FAQ schema. Update it to match the new on-page content above.`;
  } else if (!hasFAQSchema && faqCount > 0) {
    // Content exists, just need schema - USE ACTUAL FAQs!
    customizedImplementation = `### ✅ Your FAQs Have Been Extracted!\n\n**Great news!** The system detected ${faqCount} FAQ pairs on your site and has generated structured data schema for you.\n\n**Your Actual FAQs:**\n\n${faqsToUse.slice(0, 5).map((faq, idx) => `**Q${idx + 1}: ${faq.q}**\n\n${faq.pageAnswer}`).join('\n\n---\n\n')}${faqCount > 5 ? `\n\n*...and ${faqCount - 5} more questions*` : ''}\n\n**What You Need to Do:**\n\nThe system has already extracted your FAQs and generated the schema below. Simply copy the JSON-LD code and paste it into your page <head> tag. This will make your expertise machine-readable for AI assistants.`;
    readyToUseContent = `✅ **Your ${faqCount} existing FAQs are already on the page.** Just add the schema below!`;
    frontendCode = '<!-- ✅ Your existing FAQ content is good. No changes needed. -->';
    backendCode = schemaCode;
  } else if (hasFAQSchema && faqCount > 0) {
    // Both exist - show what was detected
    customizedImplementation = `### ✅ Implementation Complete!\n\n**Congratulations!** Your FAQ section is fully optimized:\n\n✓ ${faqCount} FAQ pairs detected on-page\n✓ FAQPage schema markup present\n✓ Content is machine-readable for AI\n\n**Your Detected FAQs:**\n\n${faqsToUse.slice(0, 5).map((faq, idx) => `**Q${idx + 1}: ${faq.q}**\n\n${faq.pageAnswer}`).join('\n\n---\n\n')}${faqCount > 5 ? `\n\n*...and ${faqCount - 5} more questions*` : ''}\n\n**Next Steps:**\n\n1. Verify schema matches your on-page content (see generated schema below)\n2. Consider adding FAQs to additional pages (About, Services, Pricing)\n3. Update quarterly with new customer questions`;
    readyToUseContent = `✅ **You already have ${faqCount} FAQs with schema!** See below for what was detected.`;
    frontendCode = '<!-- ✅ Your FAQ content and schema are both implemented! -->';
    backendCode = `<!-- Below is the schema generated from your actual FAQs -->\n${schemaCode}`;
  } else {
    // Need both - full implementation (use templates)
    customizedImplementation = `### Your Complete FAQ Implementation for ${detectedIndustry}\n\nYou currently have no FAQ section. Implementing this will significantly boost your AI visibility.\n\n**Industry-Tailored Questions:**\n\n${faqsToUse.map((faq, idx) => `**Q${idx + 1}: ${faq.q}**\n\n${faq.pageAnswer}`).join('\n\n---\n\n')}\n\n**Why These Questions Matter:**\n- Targets actual search queries in ${detectedIndustry}\n- Helps AI systems understand your expertise\n- Increases chances of being cited by ChatGPT, Perplexity, and other AI assistants\n- Improves traditional SEO rankings for question-based searches`;
    readyToUseContent = faqPageCopy;
    frontendCode = `<!-- Add this FAQ section to your page HTML -->\n<section class="faq-section">\n  <h2>Frequently Asked Questions</h2>\n  \n${faqsToUse.map((faq, idx) => `  <div class="faq-item">\n    <h3>${faq.q}</h3>\n    <p>${faq.pageAnswer}</p>\n  </div>`).join('\n\n')}\n</section>`;
    backendCode = schemaCode;
  }

  // Combine frontend and backend for codeSnippet display
  const codeSnippet = `## Frontend Implementation (Page Content)\n\n${frontendCode}\n\n---\n\n## Backend Implementation (FAQ Schema)\n\n${backendCode}`;

  return {
    id: `rec_${issue.category}_${issue.subfactor}_${Date.now()}`,
    title: title,
    category: issue.category,
    subfactor: "faqScore",
    priority: issue.severity || 'high',
    priorityScore: issue.priority || 85,
    finding: finding,
    impact: impact,
    actionSteps: actionSteps.split('\n').filter(s => s.trim()),
    codeSnippet: codeSnippet,
    customizedImplementation: customizedImplementation,  // ✅ ADDED: Customized implementation for blue box
    readyToUseContent: readyToUseContent,
    implementationNotes: implementationNotes,
    quickWins: usingActualContent ? [`${faqCount} FAQs already detected - schema implementation is quick!`, 'Your actual Q&As are ready to be structured', 'Simple copy-paste of generated schema'] : (FAQ_LIBRARIES[detectedIndustry] || FAQ_LIBRARIES.General).quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: "1-2 hours",
    difficulty: "Easy",
    estimatedScoreGain: Math.max(12, Math.round(issue.gap * 0.8)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: {
      faqDetected: faqCount > 0,
      faqCount: faqCount,
      hasFAQSchema: hasFAQSchema,
      usingActualContent: usingActualContent,
      industry: detectedIndustry
    },
    generatedBy: usingActualContent ? 'actual_faq_extraction' : 'programmatic_faq_library'
  };
}

// ========================================
// ALT TEXT GENERATOR
// ========================================

function makeProgrammaticAltTextRecommendation(issue, scanEvidence, industry) {
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const detectedIndustry = industry || 'General';

  // Extract image data
  const images = scanEvidence.media?.images || [];
  console.log(`[AltText] Found ${images.length} images in scanEvidence.media.images`);

  const imagesWithoutAlt = images.filter(img => !img.alt || img.alt.trim() === '');
  const imagesWithAlt = images.filter(img => img.alt && img.alt.trim() !== '');

  const totalImages = images.length;
  const missingAltCount = imagesWithoutAlt.length;
  const altCoverage = totalImages > 0 ? Math.round((imagesWithAlt.length / totalImages) * 100) : 0;

  console.log(`[AltText] Images with alt: ${imagesWithAlt.length}, without alt: ${missingAltCount}, coverage: ${altCoverage}%`);

  // Build Finding
  const finding = `Status: ${missingAltCount === 0 ? 'Good' : 'Needs Improvement'}

Your page contains ${totalImages} image${totalImages === 1 ? '' : 's'}:
• ${imagesWithAlt.length} image${imagesWithAlt.length === 1 ? '' : 's'} with alt text (${altCoverage}% coverage)
• ${missingAltCount} image${missingAltCount === 1 ? '' : 's'} missing alt text

${missingAltCount > 0 ? `Images without alt text cannot be understood by AI assistants, screen readers, or search engines. This reduces your content's accessibility and discoverability.` : `Great job! All your images have alt text. Make sure the descriptions are meaningful and descriptive.`}`;

  // Build Impact
  const impact = `Your images are like silent salespeople — but without descriptions, AI can't see them. When you add alt text, you're telling AI assistants like ChatGPT what's in each photo. This means they can include your images when answering questions, and people searching for images can find you too.`;

  // Build Action Steps
  const actionSteps = [
    `Audit all ${totalImages} images on this page to identify those missing alt text`,
    `Write descriptive alt text for each image (8-15 words recommended)`,
    `Include relevant keywords naturally - describe what's actually in the image`,
    `For decorative images (borders, spacers), use empty alt="" to indicate they're decorative`,
    `Validate implementation using an accessibility checker (WAVE, axe DevTools)`,
    `Re-scan this page to confirm alt text coverage reaches 100%`
  ];

  // Customized Implementation - Show actual images that need alt text
  let customizedImplementation = '';
  if (missingAltCount > 0) {
    const exampleImages = imagesWithoutAlt.slice(0, 3);
    customizedImplementation = `### Your Images That Need Alt Text\n\nWe detected ${missingAltCount} image${missingAltCount === 1 ? '' : 's'} without alt text. Here are ${Math.min(3, missingAltCount)} that need attention:\n\n`;

    exampleImages.forEach((img, idx) => {
      const fileName = img.src ? img.src.split('/').pop() : 'unknown';
      const suggestedAlt = generateAltTextSuggestion(fileName, detectedIndustry);
      customizedImplementation += `**Image ${idx + 1}:** \`${fileName}\`\n`;
      customizedImplementation += `- **Current:** No alt text\n`;
      customizedImplementation += `- **Suggested:** "${suggestedAlt}"\n`;
      customizedImplementation += `- **Code:** \`<img src="${img.src}" alt="${suggestedAlt}">\`\n\n`;
    });

    if (missingAltCount > 3) {
      customizedImplementation += `*...and ${missingAltCount - 3} more image${missingAltCount - 3 === 1 ? '' : 's'} need${missingAltCount - 3 === 1 ? 's' : ''} alt text.*\n\n`;
    }

    customizedImplementation += `**Why These Matter:**\n- AI assistants can now reference your visual content in answers\n- Screen readers can describe images to visually impaired visitors\n- Google Images can index and rank these images for relevant searches`;
  } else {
    customizedImplementation = `### Excellent Alt Text Coverage!\n\nAll ${totalImages} images on your page have alt text. To maximize AI visibility:\n\n1. **Review quality:** Make sure alt text is descriptive, not just "image" or "photo"\n2. **Include context:** Describe what's happening in the image and why it matters\n3. **Natural keywords:** Include relevant terms naturally without keyword stuffing\n\n**Example of good vs. poor alt text:**\n- ❌ Poor: "team photo"\n- ✅ Good: "AI startup team collaborating on product roadmap in modern office"\n\nWell-written alt text helps AI assistants cite your content with visual context.`;
  }

  // Ready-to-use content - HTML template
  const readyToUseContent = missingAltCount > 0 ? `Copy-paste this HTML template for adding alt text to your images:

\`\`\`html
<!-- Before: Missing alt text -->
<img src="/images/hero.jpg">

<!-- After: With descriptive alt text -->
<img src="/images/hero.jpg" alt="${generateAltTextSuggestion('hero', detectedIndustry)}">
\`\`\`

**Alt Text Formula:** [What's in the image] + [Context/Purpose] + [Relevant keyword if natural]

Example: "Marketing team reviewing analytics dashboard on laptop"` : null;

  // Implementation Notes
  const implementationNotes = [
    'Keep alt text between 8-15 words - descriptive but concise',
    'Avoid starting with "image of" or "picture of" - it\'s implied',
    'For complex images (charts, diagrams), provide detailed descriptions or link to full text alternative',
    'Decorative images should have empty alt="" to indicate they add no informational value',
    'Use your industry terminology naturally - helps with topical relevance'
  ];

  // Quick Wins
  const quickWins = [
    'Add alt text to your logo: "' + (facts.brand || 'Your Company') + ' logo"',
    'Add alt text to hero/banner image first - most visible to visitors',
    'Update team photos with names and roles when appropriate',
    'For product images, include product name and key feature'
  ];

  // Validation Checklist
  const validationChecklist = [
    'Run WAVE accessibility checker - no alt text errors',
    'Test with screen reader (NVDA, JAWS, or VoiceOver) - images described correctly',
    'Google Lighthouse accessibility score improved',
    'Re-scan in AI Visibility Tool - altTextScore increases',
    'All images have meaningful alt text (not "image1.jpg" or generic descriptions)'
  ];

  // Code Snippet
  const codeSnippet = missingAltCount > 0 ? `## Adding Alt Text to Images

### Step 1: Locate Images Without Alt Text

Use browser DevTools or view page source to find \`<img>\` tags missing alt attributes.

### Step 2: Add Descriptive Alt Text

\`\`\`html
<!-- Generic example -->
<img src="/images/product-demo.jpg"
     alt="${generateAltTextSuggestion('product-demo', detectedIndustry)}">

<!-- Logo -->
<img src="/images/logo.png"
     alt="${facts.brand || 'Company'} logo">

<!-- Team photo -->
<img src="/images/team.jpg"
     alt="Marketing team collaborating in ${detectedIndustry} strategy session">

<!-- Decorative image (no informational value) -->
<img src="/images/decorative-border.svg"
     alt=""
     role="presentation">
\`\`\`

### Step 3: Validate

Test with a screen reader or use WAVE browser extension to verify alt text is present and meaningful.` : `## Maintaining Good Alt Text

Your images already have alt text! Here's how to keep it high-quality:

\`\`\`html
<!-- Good alt text example -->
<img src="/images/case-study.jpg"
     alt="AI startup dashboard showing 40% increase in user engagement">

<!-- Poor alt text example - too generic -->
<img src="/images/case-study.jpg"
     alt="screenshot">
\`\`\`

**Quality Checklist:**
✓ Describes what's actually in the image
✓ Provides context about why it matters
✓ Uses natural language (not keyword stuffing)
✓ Concise but informative (8-15 words ideal)
\`\`\``;

  return {
    id: `rec_${issue.category}_altText_${Date.now()}`,
    title: 'AI Readability: Image Alt Text',
    category: issue.category,
    subfactor: 'altTextScore',
    priority: missingAltCount > 5 ? 'high' : missingAltCount > 0 ? 'medium' : 'low',
    priorityScore: issue.priority || 70,
    finding: finding,
    impact: impact,
    actionSteps: actionSteps,
    codeSnippet: codeSnippet,
    customizedImplementation: customizedImplementation,
    readyToUseContent: readyToUseContent,
    implementationNotes: implementationNotes,
    quickWins: quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: missingAltCount > 10 ? "2-3 hours" : missingAltCount > 0 ? "1-2 hours" : "30 minutes",
    difficulty: "Easy",
    estimatedScoreGain: Math.max(5, Math.round(issue.gap * 0.8)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: {
      totalImages: totalImages,
      missingAlt: missingAltCount,
      altCoverage: altCoverage
    },
    generatedBy: 'programmatic_alt_text'
  };
}

// Helper: Generate alt text suggestions based on filename and industry
function generateAltTextSuggestion(filename, industry) {
  const name = filename.replace(/\.(jpg|jpeg|png|gif|svg|webp)$/i, '').replace(/[-_]/g, ' ');

  // Common patterns
  if (/logo/i.test(name)) return `${industry} company logo`;
  if (/hero|banner/i.test(name)) return `${industry} professional services hero image`;
  if (/team|people|staff/i.test(name)) return `${industry} team members collaborating`;
  if (/product|demo|screenshot/i.test(name)) return `${industry} product demonstration screenshot`;
  if (/office|workspace/i.test(name)) return `Modern ${industry} office workspace`;

  // Generic fallback
  return `${name} - ${industry} visual content`;
}

// ========================================
// SCANNABILITY GENERATOR
// ========================================

function makeProgrammaticScannabilityRecommendation(issue, scanEvidence, industry) {
  const { profile, facts } = normalizeEvidence(scanEvidence);

  // Extract scannability metrics
  const wordCount = scanEvidence.content?.wordCount || 0;
  const paragraphs = scanEvidence.content?.paragraphs || [];
  const headings = {
    h1: scanEvidence.content?.headings?.h1 || [],
    h2: scanEvidence.content?.headings?.h2 || [],
    h3: scanEvidence.content?.headings?.h3 || [],
  };

  const totalHeadings = headings.h1.length + headings.h2.length + headings.h3.length;
  const avgWordsPerHeading = totalHeadings > 0 ? Math.round(wordCount / totalHeadings) : wordCount;

  // Find long paragraphs (>150 words)
  const longParagraphs = paragraphs.filter(p => p.split(/\s+/).length > 150);

  // Detect lists/bullets
  const hasBullets = /<ul|<ol|<li/i.test(scanEvidence.html);

  // Build Finding
  const finding = `Status: ${avgWordsPerHeading > 300 ? 'Needs Improvement' : avgWordsPerHeading > 200 ? 'Fair' : 'Good'}

**Page Structure:**
• Total word count: ${wordCount}
• Headings: ${totalHeadings} (${headings.h2.length} H2s, ${headings.h3.length} H3s)
• Average words per section: ${avgWordsPerHeading}
• Long paragraphs (>150 words): ${longParagraphs.length}
• Bullet points/lists: ${hasBullets ? 'Detected' : 'Not detected'}

${avgWordsPerHeading > 300 ? `Your content has large sections without headings. AI assistants prefer content broken into clear, scannable sections with descriptive headings every 150-250 words.` : `Your content structure is reasonable, but optimizing scannability will improve AI comprehension and user engagement.`}`;

  // Build Impact
  const impact = `Long blocks of text are hard for both people and AI to read. When you break up your content with headings, bullet points, and short paragraphs, AI can quickly find and share the most helpful parts. Think of it like making your content easier to skim — the clearer it is, the more likely AI will recommend it.`;

  // Build Action Steps
  const actionSteps = [
    `Break long paragraphs (>150 words) into smaller chunks of 3-4 sentences each`,
    `Add descriptive H2/H3 headings every 150-250 words to segment content`,
    `Convert process lists or feature lists into bullet points for clarity`,
    `Use bold text to highlight key terms and important concepts`,
    `Add white space between sections to improve visual scannability`,
    `Test readability score - aim for Flesch Reading Ease >65`
  ];

  // Customized Implementation
  let customizedImplementation = '';
  if (longParagraphs.length > 0) {
    // Use the first long paragraph (now prioritized by relevance scoring)
    const targetParagraph = longParagraphs[0];
    const wordCount = targetParagraph.split(/\s+/).length;
    const charCount = targetParagraph.length;
    const previewText = targetParagraph.substring(0, 300) + (charCount > 300 ? '...' : '');

    customizedImplementation = `### Reformatting Your Content for Better Scannability\n\n**Before:** One long paragraph (${wordCount} words, ${charCount} characters)\n\n> ${previewText}\n\n---\n\n**After:** Broken into scannable sections with headings and bullets\n\n## [Add Descriptive H2 Here]\n\n[First key point in 2-3 sentences]\n\n**Key benefits:**\n- [Benefit 1]\n- [Benefit 2]\n- [Benefit 3]\n\n## [Add Second H2 Here]\n\n[Next point in 2-3 sentences]\n\n---\n\n**Why This Works:**\n- AI assistants can quickly scan headings to find relevant sections\n- Bullets make individual points easy to extract and cite\n- Shorter paragraphs improve comprehension and keep readers engaged\n\n💡 **Note:** This example is from your main content area - one of the most visible paragraphs on your page.`;
  } else {
    customizedImplementation = `### Optimizing Your Content Structure\n\nYour content is already fairly scannable! Here's how to make it even better:\n\n**Current Structure:**\n- ${totalHeadings} headings dividing ${wordCount} words\n- Average ${avgWordsPerHeading} words per section\n\n**Optimization Opportunities:**\n1. Ensure every 150-250 words has a descriptive H2 or H3 heading\n2. Convert any process descriptions or feature lists to bullet points\n3. Add bold formatting to key terms AI should pay attention to\n4. Use short paragraphs (3-4 sentences max) for easy scanning`;
  }

  // Ready-to-use content
  const readyToUseContent = `### Scannability Checklist\n\nApply these formatting rules to your content:\n\n**Heading Frequency:** Add H2/H3 every 150-250 words\n**Paragraph Length:** Keep paragraphs to 3-4 sentences (50-100 words)\n**Lists:** Convert 3+ related items to bullet points\n**White Space:** Add line breaks between sections\n**Bold Text:** Highlight 1-2 key terms per section\n\n**Example Format:**\n\n## Clear, Descriptive Heading\n\nShort introductory paragraph (2-3 sentences) that previews what this section covers.\n\n**Key points:**\n- First important point\n- Second important point\n- Third important point\n\nBrief conclusion or transition (1-2 sentences).`;

  // Implementation Notes
  const implementationNotes = [
    'Aim for Flesch Reading Ease score above 65 (readable by 13-15 year olds)',
    'Average sentence length should be under 20 words',
    'Use transition words (However, Therefore, Additionally) to connect ideas',
    'Bold key terms but avoid over-formatting (3-5 bold terms per section max)',
    'Test on mobile - scannable content is even more critical on small screens'
  ];

  // Quick Wins
  const quickWins = [
    'Break your longest paragraph in half - add a subheading between the two parts',
    'Find one list of items in sentence form - convert it to bullet points',
    'Add bold formatting to 5-10 key terms throughout the page',
    'Review your H2 headings - make them more descriptive and keyword-rich'
  ];

  // Validation Checklist
  const validationChecklist = [
    'Hemingway App or similar tool shows readability grade of 8th grade or lower',
    'Every section has a clear H2 or H3 heading',
    'No paragraphs exceed 4-5 sentences',
    'Important lists are formatted as bullet points',
    'Re-scan shows improved scannabilityScore'
  ];

  // Code Snippet
  const codeSnippet = `## Content Formatting Template

### Before: Dense, Hard-to-Scan Content

\`\`\`html
<p>
  This is a very long paragraph that covers multiple topics without any breaks.
  It discusses the first topic at length, then moves to a second topic, and
  eventually covers a third topic. There are no headings, no bullets, and no
  clear visual breaks. AI assistants struggle to extract specific information
  from this format because everything is jumbled together in one continuous block.
  [continues for 200+ words...]
</p>
\`\`\`

### After: Scannable, AI-Friendly Format

\`\`\`html
<h2>First Topic: Clear Descriptive Heading</h2>

<p>
  Short introduction to this topic (2-3 sentences that summarize the key point).
</p>

<p><strong>Key benefits:</strong></p>
<ul>
  <li>First specific benefit</li>
  <li>Second specific benefit</li>
  <li>Third specific benefit</li>
</ul>

<h2>Second Topic: Another Clear Heading</h2>

<p>
  Brief explanation of this topic with <strong>key terms</strong> highlighted for emphasis.
</p>

<p>
  Additional details in a separate paragraph (keeps each para to 3-4 sentences).
</p>
\`\`\`

**Key Improvements:**
- Clear H2 headings every 150-250 words
- Short paragraphs (3-4 sentences each)
- Bullet points for lists
- Bold text on key terms`;

  return {
    id: `rec_${issue.category}_scannability_${Date.now()}`,
    title: 'AI Search Readiness: Content Scannability',
    category: issue.category,
    subfactor: 'scannabilityScore',
    priority: avgWordsPerHeading > 400 ? 'high' : 'medium',
    priorityScore: issue.priority || 75,
    finding: finding,
    impact: impact,
    actionSteps: actionSteps,
    codeSnippet: codeSnippet,
    customizedImplementation: customizedImplementation,
    readyToUseContent: readyToUseContent,
    implementationNotes: implementationNotes,
    quickWins: quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: "1-3 hours",
    difficulty: "Easy",
    estimatedScoreGain: Math.max(8, Math.round(issue.gap * 0.7)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: {
      wordCount: wordCount,
      totalHeadings: totalHeadings,
      avgWordsPerHeading: avgWordsPerHeading,
      longParagraphs: longParagraphs.length
    },
    generatedBy: 'programmatic_scannability'
  };
}

// ========================================
// CAPTIONS/TRANSCRIPTS GENERATOR
// ========================================

function makeProgrammaticCaptionsTranscriptsRecommendation(issue, scanEvidence, industry) {
  const { profile, facts } = normalizeEvidence(scanEvidence);

  // Detect videos
  const videos = scanEvidence.content?.videos || [];
  const videoCount = videos.length;
  const hasTranscripts = /transcript|caption/i.test(scanEvidence.html);

  // Build Finding
  const finding = `Status: ${hasTranscripts ? 'Partial' : videoCount > 0 ? 'Missing' : 'N/A'}

${videoCount > 0 ? `**Video Content Detected:**
• Videos on page: ${videoCount}
• Transcripts detected: ${hasTranscripts ? 'Yes (partial)' : 'No'}

${!hasTranscripts ? `Without transcripts, AI assistants cannot index or reference your video content. Search engines skip video content entirely unless transcripts are provided.` : `You have some transcript content, but ensure all videos have complete, properly formatted transcripts for maximum AI visibility.`}` : `No video content detected on this page. This recommendation will apply when you add video content.`}`;

  // Build Impact
  const impact = `AI assistants can't watch your videos — they can only read text. Without transcripts, all the valuable information in your videos is invisible to ChatGPT, Google, and other AI tools. Adding transcripts is like giving AI a written copy of everything you said, so it can recommend your content to people who ask related questions.`;

  // Build Action Steps
  const actionSteps = [
    `Identify all ${videoCount > 0 ? videoCount : ''} video${videoCount === 1 ? '' : 's'} on your page that need transcripts`,
    `Use a transcription service (Rev, Otter.ai, YouTube auto-captions) to generate initial transcript`,
    `Edit transcript for accuracy - fix technical terms, company names, and industry jargon`,
    `Format transcript with timestamps and speaker labels for clarity`,
    `Add transcript to page in accessible location (expandable section below video, separate tab, or dedicated transcript page)`,
    `Test with screen reader to ensure transcript is properly labeled and accessible`,
    `Validate with Google Rich Results Test - transcript should be crawlable`
  ];

  // Customized Implementation
  const customizedImplementation = videoCount > 0 ? `### Adding Transcripts to Your Video Content\n\n**Videos Detected:** ${videoCount}\n\nEach video needs a complete, accurate transcript to be AI-readable. Here's what to do:\n\n**Option 1: Embedded Transcript (Recommended)**\nAdd an expandable transcript section directly below each video:\n\n\`\`\`html
<div class="video-container">
  <video src="your-video.mp4" controls></video>

  <details class="transcript">
    <summary>📄 View Transcript</summary>
    <div class="transcript-content">
      <p><strong>[00:00]</strong> Introduction to ${facts.brand || 'our service'}...</p>
      <p><strong>[00:30]</strong> Key feature explanation...</p>
      <p><strong>[01:15]</strong> Customer success story...</p>
    </div>
  </details>
</div>
\`\`\`

**Option 2: Separate Transcript Page**\nCreate a dedicated transcript page and link to it below the video:

\`\`\`html
<video src="your-video.mp4" controls></video>
<p><a href="/transcripts/video-1-transcript">Read full transcript</a></p>
\`\`\`

**Why This Matters:**\n- AI assistants can now cite specific quotes from your video\n- Search engines index the transcript text\n- Accessible to all users regardless of ability to hear audio` : `### Preparing for Video Content\n\nWhen you add video content to your site, follow this transcript workflow:\n\n1. **Record video** with clear audio\n2. **Generate transcript** using Rev.com, Otter.ai, or YouTube auto-captions\n3. **Edit for accuracy** - fix technical terms and jargon\n4. **Format with timestamps** for easy reference\n5. **Embed on page** below video or link to separate transcript page\n6. **Validate accessibility** with screen reader testing\n\nProper transcripts can increase video content's AI citation rate by 300%+.`;

  // Ready-to-use content
  const readyToUseContent = `### Video Transcript Template\n\n\`\`\`html
<div class="video-with-transcript">
  <h2>Video Title Here</h2>

  <video controls>
    <source src="/videos/demo.mp4" type="video/mp4">
    <track kind="captions" src="/captions/demo.vtt" srclang="en" label="English">
  </video>

  <details class="video-transcript" open>
    <summary><strong>📄 Transcript</strong></summary>

    <div class="transcript-content">
      <p>
        <span class="timestamp">[00:00]</span>
        <span class="speaker">Speaker:</span>
        Welcome to this overview of [topic]. In this video, we'll cover...
      </p>

      <p>
        <span class="timestamp">[00:30]</span>
        First key point about [topic]...
      </p>

      <p>
        <span class="timestamp">[01:15]</span>
        Second key point...
      </p>
    </div>
  </details>
</div>
\`\`\`

Copy this template and fill in your actual video content.`;

  // Implementation Notes
  const implementationNotes = [
    'Use professional transcription services (Rev, Otter.ai) for accuracy - auto-captions need heavy editing',
    'Include timestamps every 30-60 seconds for easy navigation',
    'Add speaker labels if multiple people appear in video',
    'Correct all technical terms, company names, and industry jargon',
    'Make transcripts accessible via <details> element, accordion, or separate linked page'
  ];

  // Quick Wins
  const quickWins = [
    'Start with your homepage video - it likely gets the most traffic',
    'Use YouTube auto-captions as a starting point (free)',
    'For short videos (<5 min), manually transcribe - faster than editing auto-captions',
    'Add VTT caption files for native browser caption support'
  ];

  // Validation Checklist
  const validationChecklist = [
    'Every video on the page has a complete transcript',
    'Transcript is visible and accessible (not hidden in code comments)',
    'Screen reader can navigate and read transcript properly',
    'Transcript includes timestamps for longer videos (>5 minutes)',
    'Google Rich Results Test can crawl the transcript text'
  ];

  // Code Snippet
  const codeSnippet = `## Video Transcript Implementation

### Complete Example with Styles

\`\`\`html
<style>
.video-transcript {
  margin-top: 20px;
  padding: 15px;
  background: #f5f5f5;
  border-left: 4px solid #0066cc;
  border-radius: 4px;
}

.video-transcript summary {
  cursor: pointer;
  font-weight: bold;
  margin-bottom: 10px;
}

.transcript-content p {
  margin: 10px 0;
  line-height: 1.6;
}

.timestamp {
  font-weight: bold;
  color: #0066cc;
  margin-right: 8px;
}

.speaker {
  font-style: italic;
  margin-right: 8px;
}
</style>

<div class="video-container">
  <h2>Product Demo Video</h2>

  <video width="100%" controls>
    <source src="/videos/product-demo.mp4" type="video/mp4">
    <track kind="captions" src="/captions/demo.vtt" srclang="en" label="English">
    Your browser does not support the video tag.
  </video>

  <details class="video-transcript" open>
    <summary>📄 Full Transcript</summary>

    <div class="transcript-content">
      <p>
        <span class="timestamp">[00:00]</span>
        <span class="speaker">Presenter:</span>
        Welcome to our product demo. Today I'll show you how our platform helps ${industry} companies improve their efficiency.
      </p>

      <p>
        <span class="timestamp">[00:30]</span>
        Let's start with the dashboard. As you can see, all your key metrics are displayed in real-time...
      </p>

      <p>
        <span class="timestamp">[01:00]</span>
        Now let's look at the reporting features. You can generate custom reports by...
      </p>

      <!-- Continue with full transcript -->
    </div>
  </details>
</div>
\`\`\`

### VTT Caption File Format

Create a \`.vtt\` file for native browser captions:

\`\`\`
WEBVTT

00:00:00.000 --> 00:00:05.000
Welcome to our product demo.

00:00:05.000 --> 00:00:10.000
Today I'll show you how our platform helps companies improve efficiency.

00:00:10.000 --> 00:00:15.000
Let's start with the dashboard.
\`\`\`

Save as \`demo.vtt\` and reference in video tag.`;

  return {
    id: `rec_${issue.category}_transcripts_${Date.now()}`,
    title: 'AI Readability: Video Transcripts',
    category: issue.category,
    subfactor: 'captionsTranscriptsScore',
    priority: videoCount > 0 && !hasTranscripts ? 'high' : 'medium',
    priorityScore: issue.priority || 70,
    finding: finding,
    impact: impact,
    actionSteps: actionSteps,
    codeSnippet: codeSnippet,
    customizedImplementation: customizedImplementation,
    readyToUseContent: readyToUseContent,
    implementationNotes: implementationNotes,
    quickWins: quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: videoCount > 0 ? `${videoCount * 2}-${videoCount * 4} hours` : "2-3 hours per video",
    difficulty: "Medium",
    estimatedScoreGain: Math.max(6, Math.round(issue.gap * 0.75)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: {
      videoCount: videoCount,
      hasTranscripts: hasTranscripts
    },
    generatedBy: 'programmatic_transcripts'
  };
}

// ========================================
// INDEXNOW GENERATOR
// ========================================

function makeProgrammaticIndexNowRecommendation(issue, scanEvidence, industry) {
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const domain = extractDomain(scanEvidence.url);

  // Check if IndexNow is already implemented
  const hasIndexNow = /indexnow/i.test(scanEvidence.html);

  // Build Finding
  const finding = `Status: ${hasIndexNow ? 'Detected (verify implementation)' : 'Missing'}

${!hasIndexNow ? `**IndexNow Protocol:** Not detected

IndexNow is a protocol that instantly notifies search engines when your content changes. Without it, search engines may take days or weeks to discover your updates.

**Current situation:**
• No IndexNow implementation detected
• Search engines rely on periodic crawling to discover changes
• New or updated content may remain unindexed for extended periods` : `**IndexNow Protocol:** Detected

You appear to have IndexNow implemented. Verify that:
• The API key is valid and properly configured
• Notifications are sent automatically on content updates
• All major search engines (Bing, Yandex) are receiving notifications`}`;

  // Build Impact
  const impact = `When you update your website, search engines might not notice for days or even weeks. IndexNow is like sending a text message to Google and Bing saying "Hey, I just updated this page!" — so they can check it right away. This is especially helpful if you regularly add new content or make important updates.`;

  // Build Action Steps
  const actionSteps = [
    `Generate an IndexNow API key at bing.com/indexnow`,
    `Create a text file containing your API key (e.g., abc123.txt) in your site root`,
    `Add the API key file to your site root directory (${domain}/abc123.txt)`,
    `Implement automatic notifications: send POST request to api.indexnow.org when content changes`,
    `Test implementation by updating a page and verifying notification was sent`,
    `Monitor IndexNow submissions in Bing Webmaster Tools`,
    `Set up automatic notifications for CMS publish/update events`
  ];

  // Customized Implementation
  const customizedImplementation = `### IndexNow Setup for ${domain}\n\n**Step-by-Step Implementation:**\n\n**1. Generate Your API Key**\n- Visit https://www.bing.com/indexnow\n- Generate a unique API key (e.g., \`8f3d2c1b9a7e5f4d3c2b1a0987654321\`)\n- Save this key securely\n\n**2. Create Key File**\nCreate a text file named \`[your-key].txt\` containing only your API key:\n\n\`\`\`
8f3d2c1b9a7e5f4d3c2b1a0987654321
\`\`\`

Upload to: \`${domain}/8f3d2c1b9a7e5f4d3c2b1a0987654321.txt\`\n\n**3. Verify Key File**\nConfirm the file is publicly accessible by visiting the URL in your browser.\n\n**4. Send Notifications**\nWhen you publish or update content, send a POST request to IndexNow API (implementation code in the Code section below).\n\n**Why This Matters for ${industry}:**\n- Your content gets discovered immediately instead of waiting for the next crawl\n- Critical updates (pricing changes, new features, breaking news) are indexed within hours\n- Competitive advantage over companies relying on traditional crawling`;

  // Ready-to-use content
  const readyToUseContent = `### Quick IndexNow Setup\n\n**1. Get Your API Key:**\nhttps://www.bing.com/indexnow\n\n**2. Create Key File:**\nCreate \`[your-api-key].txt\` with just the key inside\n\n**3. Upload to Site Root:**\n\`${domain}/[your-api-key].txt\`\n\n**4. Submit URLs:**\nUse the code examples in the Code section to notify search engines when content changes.\n\n**Supported Search Engines:**\n- Bing\n- Yandex\n- Seznam.cz\n- Naver\n\n(Google doesn't support IndexNow but uses its own instant indexing API)`;

  // Implementation Notes
  const implementationNotes = [
    'API key file must be publicly accessible at [domain]/[key].txt',
    'Send notifications only when content actually changes - not on every page view',
    'You can submit up to 10,000 URLs per batch',
    'Notifications are free - no rate limits or usage fees',
    'Test with a single URL first before implementing site-wide'
  ];

  // Quick Wins
  const quickWins = [
    'Start with manual submissions for important pages using the web interface',
    'Implement automatic notifications for blog posts first',
    'Add IndexNow to your CMS publish workflow',
    'Monitor Bing Webmaster Tools to confirm submissions are working'
  ];

  // Validation Checklist
  const validationChecklist = [
    'API key file accessible at public URL',
    'Test notification sent successfully (check response code 200)',
    'Bing Webmaster Tools shows submitted URLs',
    'New content appears in Bing search within 24-48 hours',
    'Automatic notifications trigger on CMS publish/update events'
  ];

  // Code Snippet
  const codeSnippet = `## IndexNow Implementation

### 1. Create API Key File

Create a file named \`8f3d2c1b9a7e5f4d3c2b1a0987654321.txt\` (use your actual key):

\`\`\`
8f3d2c1b9a7e5f4d3c2b1a0987654321
\`\`\`

Upload to your site root: \`${domain}/8f3d2c1b9a7e5f4d3c2b1a0987654321.txt\`

---

### 2. Manual Submission (Test First)

\`\`\`bash
curl -X POST "https://api.indexnow.org/indexnow" \\
  -H "Content-Type: application/json" \\
  -d '{
    "host": "${domain}",
    "key": "8f3d2c1b9a7e5f4d3c2b1a0987654321",
    "keyLocation": "https://${domain}/8f3d2c1b9a7e5f4d3c2b1a0987654321.txt",
    "urlList": [
      "https://${domain}/new-page",
      "https://${domain}/updated-page"
    ]
  }'
\`\`\`

---

### 3. Node.js/Express Implementation

\`\`\`javascript
const axios = require('axios');

async function notifyIndexNow(urls) {
  try {
    const response = await axios.post('https://api.indexnow.org/indexnow', {
      host: '${domain}',
      key: '8f3d2c1b9a7e5f4d3c2b1a0987654321',
      keyLocation: 'https://${domain}/8f3d2c1b9a7e5f4d3c2b1a0987654321.txt',
      urlList: Array.isArray(urls) ? urls : [urls]
    });

    console.log('IndexNow notification sent:', response.status);
    return response.status === 200;
  } catch (error) {
    console.error('IndexNow error:', error.message);
    return false;
  }
}

// Usage: Call when content is published/updated
notifyIndexNow([
  'https://${domain}/new-blog-post',
  'https://${domain}/updated-service-page'
]);
\`\`\`

---

### 4. WordPress Plugin Alternative

If using WordPress, install the **IndexNow** plugin:
1. Go to Plugins → Add New
2. Search for "IndexNow"
3. Install and activate
4. Enter your API key in Settings → IndexNow
5. URLs auto-submitted on publish/update

---

### 5. Python Implementation

\`\`\`python
import requests
import json

def notify_indexnow(urls):
    payload = {
        "host": "${domain}",
        "key": "8f3d2c1b9a7e5f4d3c2b1a0987654321",
        "keyLocation": "https://${domain}/8f3d2c1b9a7e5f4d3c2b1a0987654321.txt",
        "urlList": urls if isinstance(urls, list) else [urls]
    }

    response = requests.post(
        "https://api.indexnow.org/indexnow",
        json=payload
    )

    return response.status_code == 200

# Usage
notify_indexnow([
    "https://${domain}/new-page",
    "https://${domain}/updated-page"
])
\`\`\`

**Response Codes:**
- \`200\`: Success - URL submitted
- \`400\`: Bad request - check your JSON format
- \`403\`: Forbidden - verify key file is accessible
- \`422\`: Unprocessable - invalid URL format`;

  return {
    id: `rec_${issue.category}_indexnow_${Date.now()}`,
    title: 'Technical Setup: IndexNow Protocol',
    category: issue.category,
    subfactor: 'indexNowScore',
    priority: 'medium',
    priorityScore: issue.priority || 65,
    finding: finding,
    impact: impact,
    actionSteps: actionSteps,
    codeSnippet: codeSnippet,
    customizedImplementation: customizedImplementation,
    readyToUseContent: readyToUseContent,
    implementationNotes: implementationNotes,
    quickWins: quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: "1-2 hours",
    difficulty: "Medium",
    estimatedScoreGain: Math.max(5, Math.round(issue.gap * 0.6)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: {
      hasIndexNow: hasIndexNow,
      domain: domain
    },
    generatedBy: 'programmatic_indexnow'
  };
}

/**
 * Generates comprehensive location/geographic content recommendations
 * with AEO-focused question-based headings and schema markup
 */
function makeProgrammaticGeoContentRecommendation(issue, scanEvidence, industry) {
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const detectedIndustry = industry || 'Technology';
  const domain = extractDomain(scanEvidence.url);
  const pageTitle = scanEvidence.metadata?.title || 'Your Page';

  // Analyze current location content
  const html = scanEvidence.html || '';
  const hasLocationContent = /\b(serve|service area|location|region|country|city|local|area)\b/i.test(html);
  const hasAreaServedSchema = /"areaServed"/i.test(html) || /<script[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?"areaServed"/i.test(html);
  const hasQuestionHeadings = /(where|who|what|when|why|how)\s+(do|can|will|should|does|are|is)/i.test(html);

  // Extract any existing location mentions
  const locationMentions = [];
  const locationPattern = /\b(Canada|United States|USA|UK|United Kingdom|Australia|Global|Europe|Asia|North America)\b/gi;
  const matches = html.match(locationPattern);
  if (matches) {
    const uniqueLocations = [...new Set(matches)];
    locationMentions.push(...uniqueLocations.slice(0, 5));
  }

  const currentLocations = locationMentions.length;
  const hasGoodCoverage = currentLocations >= 2 && hasLocationContent;

  // Build finding text
  const finding = hasGoodCoverage
    ? `Your page mentions ${currentLocations} location(s), but lacks the structured format and schema markup that answer engines need to understand your service areas. Current location mentions: ${locationMentions.join(', ')}. Score: ${issue.currentScore}/100 (Target: ${issue.threshold}).`
    : `Your page has minimal geographic content (Score: ${issue.currentScore}/100, Target: ${issue.threshold}). Answer engines like ChatGPT, Perplexity, and Google's AI Overviews prioritize businesses with clear service areas and location-specific value propositions.`;

  // Build impact description
  const impact = `When someone asks AI "Who offers this service in my city?" — AI needs to know where you operate. Right now, your website doesn't clearly state your service areas, so AI assistants might skip you for local searches. Adding clear location information helps you show up when nearby customers are looking for exactly what you offer.`;

  // Build action steps
  const actionSteps = [
    'Add a "Where We Work" section with 2-3 core regions',
    'Include one-sentence value promise per region tied to outcomes',
    'Implement areaServed schema markup in <head>',
    'Use question-based H2/H3 headings for AEO optimization',
    'Keep location content visible in HTML (not hidden in tabs/JS)',
    'Re-scan page to confirm lift in Location & Geographic Content score'
  ];

  // Build customized implementation (blue box)
  const customizedImplementation = `### Comprehensive Location Content for ${pageTitle}

${currentLocations > 0 ? `**Current Locations Detected:** ${locationMentions.join(', ')}\n\n` : ''}**Add AEO-Optimized Location Section**

Answer engines prioritize question-based headings. Add this section below your main services/intro content:

\`\`\`html
<!-- Question-based heading for AEO (Answer Engine Optimization) -->
<section class="service-areas">
  <h2>Where do we deliver ${detectedIndustry.toLowerCase()} services?</h2>

  <p>
    [Your Company Name] partners with ${detectedIndustry.toLowerCase()} companies across
    Canada, the United States, and globally. Our solutions adapt to local market needs
    while keeping your brand consistently visible to AI assistants and answer engines.
  </p>

  <ul>
    <li>
      <strong>Canada:</strong> AI-first strategy and growth programs for B2B ${detectedIndustry.toLowerCase()}
      companies seeking answer engine visibility.
    </li>
    <li>
      <strong>United States:</strong> Answer-engine optimization and AI content intelligence
      for ${detectedIndustry.toLowerCase()} growth-stage teams.
    </li>
    <li>
      <strong>Global:</strong> Scalable frameworks for multi-region visibility and
      localized intent coverage in AI search.
    </li>
  </ul>
</section>
\`\`\`

**Alternative Question-Based Headings** (choose what fits your tone):
- "Where can you find our ${detectedIndustry.toLowerCase()} services?"
- "What regions do we serve?"
- "Which markets benefit from our ${detectedIndustry.toLowerCase()} expertise?"
- "Where are we available?"

**Key Principles:**
✅ **Intent-matched copy**: Each region ties to an outcome/benefit
✅ **Visible HTML**: Don't hide in JavaScript tabs/accordions
✅ **Question format**: Improves answer engine extraction
✅ **Schema support**: Backs up visible copy with structured data`;

  // Build ready-to-use schema markup
  const readyToUseContent = `<!-- Page-Scoped Schema Markup for Service Areas -->
<!-- Add this to your <head> section or before </body> -->

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Service",
  "@id": "${domain}#service",
  "serviceType": "${detectedIndustry}Service",
  "name": "${detectedIndustry} Services",
  "url": "${domain}",
  "areaServed": [
    {
      "@type": "Country",
      "name": "Canada"
    },
    {
      "@type": "Country",
      "name": "United States"
    },
    {
      "@type": "Place",
      "name": "Global"
    }
  ],
  "audience": {
    "@type": "BusinessAudience",
    "name": "B2B ${detectedIndustry.toLowerCase()} companies"
  },
  "provider": {
    "@type": "Organization",
    "@id": "${domain}#organization"
  }
}
</script>

<!-- If you want to specify provinces/states instead of countries: -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Service",
  "@id": "${domain}#service-regional",
  "serviceType": "${detectedIndustry}Service",
  "name": "${detectedIndustry} Services",
  "areaServed": [
    {
      "@type": "State",
      "name": "Ontario",
      "containedInPlace": {
        "@type": "Country",
        "name": "Canada"
      }
    },
    {
      "@type": "State",
      "name": "British Columbia",
      "containedInPlace": {
        "@type": "Country",
        "name": "Canada"
      }
    },
    {
      "@type": "State",
      "name": "California",
      "containedInPlace": {
        "@type": "Country",
        "name": "United States"
      }
    },
    {
      "@type": "State",
      "name": "New York",
      "containedInPlace": {
        "@type": "Country",
        "name": "United States"
      }
    }
  ]
}
</script>`;

  // Build implementation notes (yellow box)
  const implementationNotes = [
    '**Placement**: Add location section after your main service intro, before case studies or testimonials',
    '**Length**: Keep 2-3 core regions. More than 5 dilutes focus for answer engines',
    '**Value propositions**: Each region needs one sentence tied to an outcome (not just "we serve X")',
    '**Question headings**: Use natural question format (Where/What/Who) to match how users query AI',
    '**Schema validation**: Test with Google Rich Results Test after adding schema',
    '**Visibility**: Location copy must be in HTML source - not loaded via JavaScript tabs/modals',
    '**Entity linking**: If you have physical offices, link to location pages with LocalBusiness schema',
    '**Update frequency**: Revise when you expand to new markets (then notify IndexNow)'
  ];

  // Build quick wins (purple box)
  const quickWins = [
    '✅ Add 2-3 core regions in visible copy (5 min)',
    '✅ Write one outcome-focused sentence per region (10 min)',
    '✅ Paste areaServed schema into <head> (2 min)',
    '✅ Change section heading to question format (2 min)',
    '✅ Re-scan to confirm Location & Geographic Content score lift'
  ];

  // Build validation checklist (indigo box)
  const validationChecklist = [
    {
      text: 'Location section added with 2-3 regions',
      checked: false
    },
    {
      text: 'Each region has outcome/value statement (not just "we serve X")',
      checked: false
    },
    {
      text: 'Heading uses question format (Where/What/Who)',
      checked: false
    },
    {
      text: 'areaServed schema added to <head>',
      checked: false
    },
    {
      text: 'Schema validated with Google Rich Results Test',
      checked: false
    },
    {
      text: 'Location content visible in HTML source (not JS-loaded)',
      checked: false
    },
    {
      text: 'Re-scanned page and confirmed score improvement',
      checked: false
    }
  ];

  // Build comprehensive code snippet
  const codeSnippet = `## Complete Location Content Implementation

### 1. HTML Section (Add to page body)

\`\`\`html
<section class="service-areas" id="locations">
  <!-- Question-based heading for AEO -->
  <h2>Where do we deliver ${detectedIndustry.toLowerCase()} services?</h2>

  <p>
    [Your Company Name] partners with ${detectedIndustry.toLowerCase()} companies across
    Canada, the United States, and globally. Our solutions adapt to local buying behavior
    while keeping your brand consistently visible to AI assistants and answer engines.
  </p>

  <!-- Region-specific value propositions -->
  <ul class="region-list">
    <li>
      <strong>Canada:</strong> AI-first strategy and demand programs for B2B ${detectedIndustry.toLowerCase()}
      companies and MSPs seeking answer engine visibility.
    </li>
    <li>
      <strong>United States:</strong> Answer-engine optimization and AI content intelligence
      for growth-stage ${detectedIndustry.toLowerCase()} teams.
    </li>
    <li>
      <strong>Global:</strong> Scalable frameworks for multi-region visibility and
      localized intent coverage.
    </li>
  </ul>

  <!-- Optional: Link to location pages if you have them -->
  <p>
    <a href="/locations/">View all service locations →</a>
  </p>
</section>
\`\`\`

### 2. Schema Markup (Add to <head>)

\`\`\`html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Service",
  "@id": "${domain}#service",
  "serviceType": "${detectedIndustry}Service",
  "name": "${detectedIndustry} Services",
  "url": "${domain}",
  "description": "Professional ${detectedIndustry.toLowerCase()} services for businesses across North America and globally",
  "areaServed": [
    {
      "@type": "Country",
      "name": "Canada"
    },
    {
      "@type": "Country",
      "name": "United States"
    },
    {
      "@type": "Place",
      "name": "Global"
    }
  ],
  "audience": {
    "@type": "BusinessAudience",
    "name": "B2B ${detectedIndustry.toLowerCase()} companies"
  },
  "provider": {
    "@type": "Organization",
    "@id": "${domain}#organization"
  }
}
</script>
\`\`\`

### 3. CSS Styling (Optional)

\`\`\`css
.service-areas {
  margin: 3rem 0;
  padding: 2rem;
  background: #f9fafb;
  border-left: 4px solid #3b82f6;
}

.service-areas h2 {
  color: #1e40af;
  margin-bottom: 1rem;
  font-size: 1.75rem;
}

.region-list {
  list-style: none;
  padding: 0;
  margin: 1.5rem 0;
}

.region-list li {
  margin-bottom: 1rem;
  padding-left: 1.5rem;
  position: relative;
}

.region-list li:before {
  content: "📍";
  position: absolute;
  left: 0;
}

.region-list strong {
  color: #1f2937;
  font-weight: 600;
}
\`\`\`

### 4. Validation Steps

**Test Schema Markup:**
1. Visit: https://search.google.com/test/rich-results
2. Paste your page URL or code
3. Verify "Service" type appears with areaServed property

**Test Answer Engine Visibility:**
1. Re-scan with AI Visibility Tool
2. Check Location & Geographic Content score increase
3. Query ChatGPT/Perplexity: "[your service] providers in [region]"
4. Verify your business appears in responses

**Common Issues:**
- ❌ Location content hidden in collapsed tabs → Move to visible HTML
- ❌ Generic "we serve globally" → Add specific regions with value props
- ❌ Schema validation errors → Check JSON syntax and required fields
- ❌ No score improvement → Ensure content is crawlable (not JS-rendered)`;

  return {
    id: `rec_${issue.category}_geo_${Date.now()}`,
    title: 'AI Search Readiness: Location & Geographic Content',
    category: issue.category,
    subfactor: 'geoContentScore',
    priority: 'high',
    priorityScore: issue.priority || 75,
    finding: finding,
    impact: impact,
    actionSteps: actionSteps,
    codeSnippet: codeSnippet,
    customizedImplementation: customizedImplementation,
    readyToUseContent: readyToUseContent,
    implementationNotes: implementationNotes,
    quickWins: quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: "30-45 minutes",
    difficulty: "Easy",
    estimatedScoreGain: Math.max(8, Math.round(issue.gap * 0.7)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: {
      hasLocationContent: hasLocationContent,
      hasAreaServedSchema: hasAreaServedSchema,
      hasQuestionHeadings: hasQuestionHeadings,
      currentLocations: currentLocations,
      locationMentions: locationMentions
    },
    generatedBy: 'programmatic_geocontent'
  };
}

/**
 * Generates comprehensive readability and clarity recommendations
 * with AEO-focused simplification strategies and before/after examples
 */
function makeProgrammaticReadabilityRecommendation(issue, scanEvidence, industry) {
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const detectedIndustry = industry || 'General';
  const domain = extractDomain(scanEvidence.url);
  const pageTitle = scanEvidence.metadata?.title || 'Your Page';

  // Extract readability metrics from scanEvidence
  const wordCount = scanEvidence.content?.wordCount || 0;
  const paragraphs = scanEvidence.content?.paragraphs || [];
  const sentences = scanEvidence.content?.sentences || [];
  const avgSentenceLength = sentences.length > 0 ? Math.round(wordCount / sentences.length) : 0;

  // Calculate readability indicators
  const longSentences = sentences.filter(s => s.split(/\s+/).length > 25).length;
  const longSentencePct = sentences.length > 0 ? Math.round((longSentences / sentences.length) * 100) : 0;

  // Check for jargon and complexity indicators
  const html = scanEvidence.html || '';
  const textContent = html.replace(/<[^>]+>/g, ' ').toLowerCase();
  const hasJargon = /\b(utilize|implement|leverage|synergy|paradigm|ecosystem|solution|optimize|facilitate|innovative)\b/gi.test(textContent);
  const hasPassiveVoice = /\b(was|were|is|are|been)\s+\w+ed\b/gi.test(textContent);

  // Extract a sample long sentence for before/after example
  let sampleLongSentence = '';
  if (longSentences > 0) {
    const longSentence = sentences.find(s => s.split(/\s+/).length > 25);
    if (longSentence) {
      sampleLongSentence = longSentence.substring(0, 200) + (longSentence.length > 200 ? '...' : '');
    }
  }

  // Build finding text
  const finding = `Your content has readability challenges that limit AI comprehension (Score: ${issue.currentScore}/100, Target: ${issue.threshold}). ${longSentencePct > 0 ? `${longSentencePct}% of sentences exceed 25 words, ` : ''}Average sentence length: ${avgSentenceLength} words. Answer engines like ChatGPT and Perplexity prioritize clear, concise content that directly answers user questions.`;

  // Build impact description
  const impact = `AI assistants prefer content that's easy to understand — like you're explaining something to a friend. When your writing uses short sentences and avoids jargon, AI can better understand your message and share it with people who ask related questions. Simpler writing = more AI recommendations.`;

  // Build action steps
  const actionSteps = [
    'Break sentences longer than 25 words into 2-3 shorter sentences',
    'Replace jargon and complex terms with plain language equivalents',
    'Convert passive voice to active voice where possible',
    'Use question-based H2/H3 headings to match user queries',
    'Add transitional phrases and clear section breaks',
    'Re-scan page to confirm Readability & Clarity score improvement'
  ];

  // Build customized implementation (blue box)
  let customizedImplementation = `### Readability Improvements for ${pageTitle}

**Current Metrics:**
- Average sentence length: ${avgSentenceLength} words (Target: 15-20 words)
${longSentencePct > 0 ? `- Long sentences (>25 words): ${longSentencePct}%\n` : ''}- Word count: ${wordCount.toLocaleString()}
- Detected issues: ${hasJargon ? 'Jargon/buzzwords, ' : ''}${hasPassiveVoice ? 'Passive voice' : 'None major'}

**Answer Engine Optimization Strategy:**

AI systems extract information most effectively from content that:
1. **Uses direct, active voice**
2. **Keeps sentences under 20 words**
3. **Replaces jargon with plain language**
4. **Answers questions explicitly**`;

  if (sampleLongSentence) {
    customizedImplementation += `

**Example from Your Page:**

**Before** (Complex, ${sampleLongSentence.split(/\s+/).length} words):
> ${sampleLongSentence}

**After** (Clear, simplified):
> ${simplifyComplexSentence(sampleLongSentence, detectedIndustry)}

**What Changed:**
- Split into shorter sentences (15-20 words each)
- Removed unnecessary qualifiers
- Used active voice
- Added clear subject-verb-object structure`;
  }

  customizedImplementation += `

**Key Simplification Principles:**
✅ **One idea per sentence**: Don't chain multiple concepts
✅ **Active voice**: "We help companies grow" (not "Companies are helped to grow by us")
✅ **Plain language**: Use "use" instead of "utilize", "help" instead of "facilitate"
✅ **Question headings**: "How does X work?" instead of "X Methodology"`;

  // Build ready-to-use content
  const readyToUseContent = `**Common Jargon → Plain Language Replacements:**

| Replace This | With This |
|-------------|-----------|
| Utilize | Use |
| Leverage | Use / Take advantage of |
| Implement | Start / Set up / Use |
| Facilitate | Help / Enable |
| Optimize | Improve |
| Solution | Product / Service / Answer |
| Ecosystem | System / Platform |
| Synergy | Working together |
| Paradigm | Model / Approach |
| Robust | Strong / Reliable |

**Sentence Length Guide:**

- **Ideal**: 15-20 words per sentence
- **Maximum**: 25 words before breaking into two
- **Variety**: Mix short (8-12) and medium (15-20) sentences

**Active Voice Conversions:**

❌ **Passive**: "Our services are utilized by leading companies"
✅ **Active**: "Leading companies use our services"

❌ **Passive**: "The solution was implemented by our team"
✅ **Active**: "Our team implemented the solution"

❌ **Passive**: "Results can be achieved through our methodology"
✅ **Active**: "Our methodology delivers results"`;

  // Build implementation notes (yellow box)
  const implementationNotes = [
    '**Target reading level**: Aim for 8th-10th grade (Flesch Reading Ease: 60-70)',
    '**Sentence variety**: Mix short punchy sentences with medium explanatory ones',
    '**Paragraph length**: Keep paragraphs to 3-4 sentences (60-80 words max)',
    '**Transition words**: Use "however," "therefore," "for example" to connect ideas',
    '**Question headings**: Convert 30-50% of H2/H3 headings to questions',
    '**Test readability**: Use Hemingway App or Grammarly to check reading grade level',
    '**Voice search optimization**: Read content aloud - if it sounds unnatural, simplify',
    '**Industry balance**: Use some technical terms for credibility, but define them inline'
  ];

  // Build quick wins (purple box)
  const quickWins = [
    '✅ Find 3-5 longest sentences, split each in half (10 min)',
    '✅ Replace 5-10 jargon words with plain language (15 min)',
    '✅ Convert 3-5 passive voice sentences to active voice (10 min)',
    '✅ Add question-based H2/H3 headings to 2-3 sections (5 min)',
    '✅ Run Hemingway App - aim for Grade 8-10 reading level (5 min)',
    '✅ Re-scan to confirm Readability & Clarity score improvement'
  ];

  // Build validation checklist (indigo box)
  const validationChecklist = [
    {
      text: 'Average sentence length reduced to 15-20 words',
      checked: false
    },
    {
      text: 'Replaced 5+ jargon/buzzwords with plain language',
      checked: false
    },
    {
      text: 'Converted passive voice to active voice in key sections',
      checked: false
    },
    {
      text: 'Added 2-3 question-based H2/H3 headings',
      checked: false
    },
    {
      text: 'Hemingway App shows Grade 8-10 reading level',
      checked: false
    },
    {
      text: 'Read content aloud - sounds natural and conversational',
      checked: false
    },
    {
      text: 'Re-scanned page and confirmed Readability score improvement',
      checked: false
    }
  ];

  // Build comprehensive code snippet
  const codeSnippet = `## Readability Improvement Implementation

### 1. Simplify Complex Sentences

**Before:**
\`\`\`
Our comprehensive ${detectedIndustry.toLowerCase()} platform leverages cutting-edge AI and machine
learning algorithms to facilitate seamless integration across your existing technology
ecosystem, enabling organizations to optimize workflows and drive measurable business outcomes.
\`\`\`

**After:**
\`\`\`
Our ${detectedIndustry.toLowerCase()} platform uses AI and machine learning to integrate with
your existing tools. This helps your team work more efficiently and measure business results.
\`\`\`

**What Changed:**
- Reduced sentence from 32 words to two sentences (15 + 12 words)
- Replaced jargon: "leverages" → "uses", "facilitate" → "helps", "optimize" → "work more efficiently"
- Removed unnecessary qualifiers: "comprehensive", "cutting-edge", "seamless"

### 2. Convert Passive to Active Voice

**Before (Passive):**
\`\`\`html
<p>Our solutions are used by Fortune 500 companies to achieve their digital
transformation goals. Results are delivered through our proven methodology that
has been refined over 10+ years.</p>
\`\`\`

**After (Active):**
\`\`\`html
<p>Fortune 500 companies use our solutions to achieve digital transformation.
Our proven 10-year methodology delivers results.</p>
\`\`\`

### 3. Add Question-Based Headings (AEO)

**Before:**
\`\`\`html
<h2>${detectedIndustry} Service Methodology</h2>
<h2>Implementation Timeline</h2>
<h2>Pricing Structure</h2>
\`\`\`

**After (Question-Based):**
\`\`\`html
<h2>How does our ${detectedIndustry.toLowerCase()} service work?</h2>
<h2>How long does implementation take?</h2>
<h2>What does it cost?</h2>
\`\`\`

### 4. Break Long Paragraphs

**Before:**
\`\`\`html
<p>In today's rapidly evolving digital landscape, organizations face unprecedented
challenges in maintaining competitive advantage while simultaneously managing
complex technology stacks, ensuring data security, meeting regulatory compliance
requirements, and delivering exceptional customer experiences across multiple
touchpoints and channels, which is why partnering with an experienced provider
can make the difference between success and stagnation.</p>
\`\`\`

**After:**
\`\`\`html
<p>Modern businesses face tough challenges:</p>
<ul>
  <li>Managing complex technology</li>
  <li>Keeping data secure</li>
  <li>Meeting compliance requirements</li>
  <li>Delivering great customer experiences</li>
</ul>
<p>An experienced partner helps you tackle these challenges and grow.</p>
\`\`\`

### 5. Testing Tools

**Hemingway App** (hemingwayapp.com):
- Paste your content
- Aim for Grade 8-10 reading level
- Fix sentences highlighted in red/yellow

**Grammarly** (grammarly.com):
- Check for passive voice
- Identify complex sentences
- Suggest clarity improvements

**WebAIM Readability Tool**:
- Calculate Flesch Reading Ease (target: 60-70)
- Analyze average words per sentence (target: 15-20)

### 6. Voice Search Test

Read your content aloud. Ask:
- Does it sound natural?
- Would someone say this in conversation?
- Can I understand it without re-reading?

If no, simplify further.`;

  return {
    id: `rec_${issue.category}_readability_${Date.now()}`,
    title: 'AI Readability: Content Clarity & Simplification',
    category: issue.category,
    subfactor: 'readabilityScore',
    priority: 'high',
    priorityScore: issue.priority || 75,
    finding: finding,
    impact: impact,
    actionSteps: actionSteps,
    codeSnippet: codeSnippet,
    customizedImplementation: customizedImplementation,
    readyToUseContent: readyToUseContent,
    implementationNotes: implementationNotes,
    quickWins: quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: "1-2 hours",
    difficulty: "Easy",
    estimatedScoreGain: Math.max(6, Math.round(issue.gap * 0.6)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: {
      wordCount: wordCount,
      avgSentenceLength: avgSentenceLength,
      longSentences: longSentences,
      longSentencePct: longSentencePct,
      hasJargon: hasJargon,
      hasPassiveVoice: hasPassiveVoice
    },
    generatedBy: 'programmatic_readability'
  };
}

/**
 * Helper function to simplify complex sentences for before/after examples
 */
function simplifyComplexSentence(sentence, industry) {
  // This is a simplified example - actual simplification would be more sophisticated
  let simplified = sentence;

  // Common simplifications
  const replacements = [
    [/\butilize\b/gi, 'use'],
    [/\bleverage\b/gi, 'use'],
    [/\bfacilitate\b/gi, 'help'],
    [/\boptimize\b/gi, 'improve'],
    [/\bimplement\b/gi, 'set up'],
    [/\becosystem\b/gi, 'system'],
    [/\bsynergy\b/gi, 'collaboration'],
    [/\bparadigm\b/gi, 'approach'],
    [/\brobust\b/gi, 'strong'],
    [/\bcomprehensive\b/gi, ''],
    [/\bcutting-edge\b/gi, 'modern'],
    [/\bseamless\b/gi, '']
  ];

  for (const [pattern, replacement] of replacements) {
    simplified = simplified.replace(pattern, replacement);
  }

  // Clean up extra spaces
  simplified = simplified.replace(/\s+/g, ' ').trim();

  // If still very long, split into two sentences at a natural break
  if (simplified.split(/\s+/).length > 25) {
    const midPoint = Math.floor(simplified.length / 2);
    const commaIndex = simplified.indexOf(',', midPoint - 20);
    if (commaIndex > 0 && commaIndex < midPoint + 20) {
      simplified = simplified.substring(0, commaIndex) + '.' + simplified.substring(commaIndex + 1);
    }
  }

  return simplified;
}

/**
 * Generates comprehensive content depth recommendations
 * with AEO-focused topic coverage and entity enrichment strategies
 */
function makeProgrammaticContentDepthRecommendation(issue, scanEvidence, industry) {
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const detectedIndustry = industry || 'General';
  const domain = extractDomain(scanEvidence.url);
  const pageTitle = scanEvidence.metadata?.title || 'Your Page';

  // Extract content metrics from scanEvidence
  const wordCount = scanEvidence.content?.wordCount || 0;
  const headings = scanEvidence.content?.headings || {};
  const totalHeadings = (headings.h2 || []).length + (headings.h3 || []).length + (headings.h4 || []).length;
  const paragraphs = scanEvidence.content?.paragraphs || [];
  const lists = scanEvidence.content?.lists || [];

  // Calculate depth indicators
  const wordsPerHeading = totalHeadings > 0 ? Math.round(wordCount / totalHeadings) : wordCount;
  const hasSubstantialContent = wordCount >= 800;
  const hasGoodStructure = totalHeadings >= 3;

  // Check for depth markers
  const html = scanEvidence.html || '';
  const hasExamples = /\b(example|for instance|such as|like|including)\b/gi.test(html);
  const hasData = /\b(\d+%|\d+ percent|\d+x|statistics|study|research|data)\b/gi.test(html);
  const hasQuestions = /(what|how|why|when|where|who)\s+(is|are|does|do|can|should|will)/gi.test(html);

  // Industry-specific depth recommendations
  const MIN_WORDS = detectedIndustry === 'Legal' || detectedIndustry === 'Healthcare' ? 1200 : 800;
  const IDEAL_WORDS = detectedIndustry === 'Legal' || detectedIndustry === 'Healthcare' ? 2000 : 1500;

  const wordGap = Math.max(0, MIN_WORDS - wordCount);
  const needsMoreContent = wordCount < MIN_WORDS;

  // Build finding text
  const finding = needsMoreContent
    ? `Your page has thin content (${wordCount.toLocaleString()} words) that limits AI comprehension (Score: ${issue.currentScore}/100, Target: ${issue.threshold}). Answer engines like ChatGPT and Perplexity prioritize comprehensive pages with ${MIN_WORDS}+ words, multiple sections, and substantive examples. You need approximately ${wordGap} more words of quality content.`
    : `Your page has adequate length (${wordCount.toLocaleString()} words) but may lack depth in key areas (Score: ${issue.currentScore}/100, Target: ${issue.threshold}). ${!hasExamples ? 'Missing concrete examples. ' : ''}${!hasData ? 'Missing data/statistics. ' : ''}${!hasQuestions ? 'Missing question-based headings for AEO.' : ''}`;

  // Build impact description
  const impact = `AI assistants trust detailed, thorough content more than thin pages. When you provide real examples, data, and comprehensive explanations, AI sees you as an expert worth recommending. Short, surface-level content often gets overlooked for more helpful resources.`;

  // Build action steps
  const actionSteps = [
    needsMoreContent ? `Add ${wordGap}+ words of substantive content (not fluff)` : 'Expand existing sections with more examples and detail',
    'Add 3-5 concrete examples or case studies',
    'Include data, statistics, or research findings',
    'Create question-based H2/H3 sections (What/How/Why)',
    'Add a comprehensive FAQ section (5-8 questions)',
    'Include comparison tables or step-by-step processes',
    'Re-scan page to confirm Content Depth score improvement'
  ];

  // Build customized implementation (blue box)
  let customizedImplementation = `### Content Depth Strategy for ${pageTitle}

**Current Content Analysis:**
- Word count: ${wordCount.toLocaleString()} (Target: ${MIN_WORDS}+, Ideal: ${IDEAL_WORDS}+)
- Headings (H2/H3/H4): ${totalHeadings} sections
- Words per section: ${wordsPerHeading}
- Content elements: ${hasExamples ? '✅ Examples' : '❌ Examples'}, ${hasData ? '✅ Data/stats' : '❌ Data/stats'}, ${hasQuestions ? '✅ Question headings' : '❌ Question headings'}

**AEO Content Depth Framework:**

Answer engines evaluate content depth through:
1. **Topic Coverage**: Do you address all major subtopics?
2. **Example Richness**: Do you provide concrete, specific examples?
3. **Data Support**: Do you back claims with data or research?
4. **Question Answering**: Do you explicitly answer user questions?

**Recommended Content Additions:**`;

  // Add industry-specific content recommendations
  const contentRecommendations = generateContentDepthRecommendations(detectedIndustry, wordCount);
  customizedImplementation += `\n\n${contentRecommendations}`;

  // Build ready-to-use content template
  const readyToUseContent = `**Content Depth Template for ${detectedIndustry}:**

## Add Comprehensive "How It Works" Section

\`\`\`html
<section>
  <h2>How does ${detectedIndustry.toLowerCase()} implementation work?</h2>

  <p><strong>Overview:</strong> [2-3 sentence summary of your approach]</p>

  <h3>Step-by-Step Process:</h3>
  <ol>
    <li><strong>Discovery & Assessment</strong> - [Explain what happens, 40-60 words]</li>
    <li><strong>Strategy Development</strong> - [Explain planning phase, 40-60 words]</li>
    <li><strong>Implementation</strong> - [Explain execution, 40-60 words]</li>
    <li><strong>Measurement & Optimization</strong> - [Explain tracking, 40-60 words]</li>
  </ol>

  <h3>Real-World Example:</h3>
  <p><strong>Client:</strong> [Industry] company with [context]</p>
  <p><strong>Challenge:</strong> [Specific problem, 30-40 words]</p>
  <p><strong>Solution:</strong> [What you did, 40-60 words]</p>
  <p><strong>Results:</strong> [Measurable outcomes with data points]</p>
</section>
\`\`\`

## Add "Common Questions" Section

\`\`\`html
<section>
  <h2>Common questions about ${detectedIndustry.toLowerCase()} services</h2>

  <h3>What results can I expect?</h3>
  <p>[Answer with specific outcomes and timeframes, 60-80 words]</p>

  <h3>How long does implementation take?</h3>
  <p>[Answer with timeline breakdown, 60-80 words]</p>

  <h3>What's included in your service?</h3>
  <ul>
    <li>[Deliverable 1 with brief description]</li>
    <li>[Deliverable 2 with brief description]</li>
    <li>[Deliverable 3 with brief description]</li>
  </ul>

  <h3>How is this different from [common alternative]?</h3>
  <p>[Comparison showing your unique approach, 80-100 words]</p>
</section>
\`\`\`

## Add Data-Backed "Why It Matters" Section

\`\`\`html
<section>
  <h2>Why ${detectedIndustry.toLowerCase()} expertise matters</h2>

  <p>Industry research shows that [insight with data]:</p>
  <ul>
    <li><strong>X% of companies</strong> that [action] see [outcome]</li>
    <li><strong>Average ROI</strong> of [metric] within [timeframe]</li>
    <li><strong>Key success factor:</strong> [Important variable with explanation]</li>
  </ul>
</section>
\`\`\``;

  // Build implementation notes (yellow box)
  const implementationNotes = [
    `**Minimum viable depth**: ${MIN_WORDS} words with 5+ sections and 3+ examples`,
    `**Ideal depth**: ${IDEAL_WORDS}+ words with 8+ sections, multiple examples, and data support`,
    '**Quality over quantity**: Every added word must provide value (no keyword stuffing)',
    '**Question-based sections**: 40-50% of H2/H3 headings should be questions',
    '**Example specificity**: Use real numbers, names, and concrete details (not vague generalities)',
    '**Topic clustering**: Cover main topic + 3-5 related subtopics comprehensively',
    '**Entity enrichment**: Mention relevant people, companies, tools, concepts in your industry',
    '**Visual depth**: Add comparison tables, process diagrams, or infographics where helpful'
  ];

  // Build quick wins (purple box)
  const quickWins = [
    `✅ Add one detailed example/case study (150-200 words) (20 min)`,
    `✅ Create a "How It Works" section with 4-step process (15 min)`,
    `✅ Add comparison table (Your approach vs. alternatives) (15 min)`,
    `✅ Convert 2-3 existing H2/H3s to question format (5 min)`,
    `✅ Add one data point or statistic with context (10 min)`,
    `✅ Re-scan to confirm Content Depth score lift`
  ];

  // Build validation checklist (indigo box)
  const validationChecklist = [
    {
      text: `Word count increased to ${MIN_WORDS}+ words`,
      checked: false
    },
    {
      text: 'Added 3+ concrete examples with specific details',
      checked: false
    },
    {
      text: 'Included data points, statistics, or research findings',
      checked: false
    },
    {
      text: 'Created 2-3 question-based H2/H3 sections',
      checked: false
    },
    {
      text: 'Added comparison table or step-by-step process',
      checked: false
    },
    {
      text: 'All new content provides unique value (not filler)',
      checked: false
    },
    {
      text: 'Re-scanned page and confirmed Content Depth score improvement',
      checked: false
    }
  ];

  // Build comprehensive code snippet
  const codeSnippet = `## Content Depth Implementation Examples

### 1. Adding Comprehensive Process Section

\`\`\`html
<section class="process-section">
  <h2>How does our ${detectedIndustry.toLowerCase()} process work?</h2>

  <p>Our proven methodology combines industry best practices with
  customized strategies tailored to your business goals.</p>

  <div class="process-steps">
    <div class="step">
      <h3>1. Discovery & Assessment</h3>
      <p>We start by analyzing your current state, goals, and challenges.
      This includes stakeholder interviews, competitive analysis, and
      technical audits. Most discovery phases take 1-2 weeks and result
      in a comprehensive assessment report.</p>
    </div>

    <div class="step">
      <h3>2. Strategy Development</h3>
      <p>Based on discovery findings, we create a customized roadmap with
      clear milestones, success metrics, and resource requirements. You'll
      receive a detailed strategy document with implementation timelines.</p>
    </div>

    <div class="step">
      <h3>3. Implementation & Execution</h3>
      <p>Our team executes the strategy in phased sprints, providing weekly
      progress updates and adapting based on results. Implementation typically
      spans 3-6 months depending on scope.</p>
    </div>

    <div class="step">
      <h3>4. Measurement & Optimization</h3>
      <p>We track KPIs continuously and optimize based on performance data.
      Monthly reports show progress against goals with recommendations for
      ongoing improvement.</p>
    </div>
  </div>
</section>
\`\`\`

### 2. Adding Rich Case Study Example

\`\`\`html
<section class="case-study">
  <h2>Real-world example: ${detectedIndustry} transformation</h2>

  <div class="case-study-content">
    <h3>The Challenge</h3>
    <p><strong>Client:</strong> Mid-market ${detectedIndustry.toLowerCase()} company with
    200 employees and $50M revenue</p>

    <p><strong>Problem:</strong> Their existing approach was generating only 12 qualified
    leads per month with a 2.5% conversion rate. Marketing and sales teams weren't
    aligned, and attribution was unclear.</p>

    <h3>Our Solution</h3>
    <p>We implemented a comprehensive strategy that included:</p>
    <ul>
      <li>Rebuilt content architecture around question-based topics</li>
      <li>Implemented answer engine optimization (AEO) best practices</li>
      <li>Created 15+ FAQ pages targeting high-intent queries</li>
      <li>Optimized for ChatGPT, Perplexity, and Google AI Overviews</li>
    </ul>

    <h3>The Results</h3>
    <p>Within 6 months:</p>
    <ul>
      <li><strong>85% increase</strong> in qualified leads (12 → 47 per month)</li>
      <li><strong>4.8% conversion rate</strong> (up from 2.5%)</li>
      <li><strong>40% of traffic</strong> now comes from AI-powered search</li>
      <li><strong>ROI:</strong> $380K in new revenue attributed to AI visibility improvements</li>
    </ul>
  </div>
</section>
\`\`\`

### 3. Adding Comparison Table

\`\`\`html
<section class="comparison">
  <h2>What makes our approach different?</h2>

  <table>
    <thead>
      <tr>
        <th>Approach</th>
        <th>Traditional ${detectedIndustry}</th>
        <th>Our AEO-First Method</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Content Focus</strong></td>
        <td>Keyword rankings</td>
        <td>Answer engine citations and AI visibility</td>
      </tr>
      <tr>
        <td><strong>Success Metric</strong></td>
        <td>Traffic volume</td>
        <td>Qualified leads from AI-powered search</td>
      </tr>
      <tr>
        <td><strong>Timeline</strong></td>
        <td>6-12 months for results</td>
        <td>3-6 months for measurable improvement</td>
      </tr>
      <tr>
        <td><strong>Content Strategy</strong></td>
        <td>Blog posts and landing pages</td>
        <td>Question-based content + FAQ schema + entity optimization</td>
      </tr>
    </tbody>
  </table>
</section>
\`\`\`

### 4. Content Depth Checklist

Use this checklist when expanding content:

**Topic Coverage:**
- [ ] Main topic explained thoroughly (300+ words)
- [ ] 3-5 related subtopics covered (150+ words each)
- [ ] Industry-specific terminology defined
- [ ] Common misconceptions addressed

**Example Richness:**
- [ ] At least 1 detailed case study/example
- [ ] Real numbers and specific outcomes (not vague claims)
- [ ] Before/after scenarios showing transformation
- [ ] Client names or anonymized profiles for credibility

**Data Support:**
- [ ] Industry statistics or research findings cited
- [ ] Your own data or insights (if available)
- [ ] Quantifiable results (percentages, timelines, costs)
- [ ] Sources linked or referenced

**Question Answering:**
- [ ] 40-50% of headings are questions
- [ ] Questions match how users actually search
- [ ] Answers are direct and complete (60-100 words)
- [ ] FAQ section with 5-8 common questions`;

  return {
    id: `rec_${issue.category}_contentDepth_${Date.now()}`,
    title: 'AI Search Readiness: Content Depth & Comprehensiveness',
    category: issue.category,
    subfactor: 'contentDepthScore',
    priority: 'high',
    priorityScore: issue.priority || 80,
    finding: finding,
    impact: impact,
    actionSteps: actionSteps,
    codeSnippet: codeSnippet,
    customizedImplementation: customizedImplementation,
    readyToUseContent: readyToUseContent,
    implementationNotes: implementationNotes,
    quickWins: quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: needsMoreContent ? "3-4 hours" : "2-3 hours",
    difficulty: "Medium",
    estimatedScoreGain: Math.max(8, Math.round(issue.gap * 0.65)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: {
      wordCount: wordCount,
      totalHeadings: totalHeadings,
      wordsPerHeading: wordsPerHeading,
      hasExamples: hasExamples,
      hasData: hasData,
      hasQuestions: hasQuestions,
      needsMoreContent: needsMoreContent,
      wordGap: wordGap
    },
    generatedBy: 'programmatic_content_depth'
  };
}

/**
 * Helper function to generate industry-specific content depth recommendations
 */
function generateContentDepthRecommendations(industry, currentWordCount) {
  const baseRecs = `
**1. Add Question-Based Sections (300-400 words)**
- "What results can I expect?" with specific outcomes and timeframes
- "How does the process work?" with step-by-step breakdown
- "Who is this right for?" with ideal customer profiles

**2. Include Concrete Examples (200-300 words)**
- Real client case study with before/after metrics
- Step-by-step walkthrough of typical project
- Common scenario showing your approach in action

**3. Add Data & Research (150-200 words)**
- Industry statistics supporting your approach
- Your own data or insights from experience
- Research findings validating your methodology`;

  const industrySpecific = {
    'Agency': `\n\n**Agency-Specific Additions:**
- Client portfolio examples with measurable results
- Service delivery process with timelines
- Team expertise and certifications
- Case studies showing ROI (3x+ return examples perform well)`,

    'SaaS': `\n\n**SaaS-Specific Additions:**
- Product feature comparison table
- Integration capabilities and API documentation overview
- Security and compliance information (SOC 2, GDPR, etc.)
- Pricing calculator or transparent pricing breakdown`,

    'Legal': `\n\n**Legal-Specific Additions:**
- Relevant case law or precedents
- Step-by-step legal process explanation
- Common legal terms defined in plain language
- Attorney credentials and practice area depth`,

    'Healthcare': `\n\n**Healthcare-Specific Additions:**
- Treatment approach with evidence-based rationale
- Expected outcomes with realistic timelines
- Insurance and payment information
- Provider credentials and specializations`,

    'Technology': `\n\n**Technology-Specific Additions:**
- Technical architecture or approach explanation
- Integration capabilities and compatibility
- Security measures and data protection
- Performance benchmarks and scalability information`
  };

  return baseRecs + (industrySpecific[industry] || '');
}

/**
 * Generates comprehensive heading hierarchy recommendations
 * with AEO-focused question-based heading strategies
 */
function makeProgrammaticHeadingHierarchyRecommendation(issue, scanEvidence, industry) {
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const detectedIndustry = industry || 'General';
  const domain = extractDomain(scanEvidence.url);
  const pageTitle = scanEvidence.metadata?.title || 'Your Page';

  // Extract heading data from scanEvidence
  const headings = scanEvidence.content?.headings || {};
  const h1Count = (headings.h1 || []).length;
  const h2Count = (headings.h2 || []).length;
  const h3Count = (headings.h3 || []).length;
  const h4Count = (headings.h4 || []).length;
  const totalHeadings = h2Count + h3Count + h4Count;

  const h1Text = h1Count > 0 ? (headings.h1[0] || 'Untitled') : 'None';
  const h2List = (headings.h2 || []).slice(0, 5);

  // Analyze heading quality
  const html = scanEvidence.html || '';
  const hasMultipleH1 = h1Count > 1;
  const hasNoH1 = h1Count === 0;
  const hasPoorDistribution = h2Count < 3;
  const hasQuestionHeadings = /(what|how|why|when|where|who)\s+(is|are|does|do|can|should|will)/gi.test(h2List.join(' '));
  const questionHeadingPct = h2Count > 0 ? Math.round((h2List.filter(h => /(what|how|why|when|where|who)\s+/gi.test(h)).length / h2Count) * 100) : 0;

  // Identify hierarchy issues
  const hierarchyIssues = [];
  if (hasNoH1) hierarchyIssues.push('Missing H1');
  if (hasMultipleH1) hierarchyIssues.push('Multiple H1s');
  if (hasPoorDistribution) hierarchyIssues.push('Too few H2 sections');
  if (questionHeadingPct < 30) hierarchyIssues.push('Missing question-based headings');

  // Build finding text
  const finding = hierarchyIssues.length > 0
    ? `Your page has heading hierarchy issues that limit AI comprehension (Score: ${issue.currentScore}/100, Target: ${issue.threshold}). Issues detected: ${hierarchyIssues.join(', ')}. ${h1Count > 0 ? `Current H1: "${h1Text}"` : 'No H1 found'}. H2 sections: ${h2Count}. Answer engines prioritize well-structured content with question-based headings.`
    : `Your page has adequate heading structure (${h2Count} H2s, ${h3Count} H3s) but could improve for AEO (Score: ${issue.currentScore}/100, Target: ${issue.threshold}). Only ${questionHeadingPct}% of headings are question-based. Converting headings to questions increases AI extraction by 30-40%.`;

  // Build impact description
  const impact = `Headings are like a table of contents for AI. When your page is organized with clear headings (especially ones that are questions), AI can quickly find the answer it needs and share it with users. Messy or missing headings make it harder for AI to understand what your page is about.`;

  // Build action steps
  const actionSteps = [
    hasNoH1 ? 'Add exactly one H1 tag with your main topic' : hasMultipleH1 ? 'Remove duplicate H1s - keep only one' : 'Verify H1 clearly states main topic',
    hasPoorDistribution ? 'Add 3-5 H2 sections to break up content' : 'Ensure logical H2 → H3 hierarchy',
    'Convert 40-50% of H2/H3 headings to questions',
    'Use H2 for main sections, H3 for subsections within H2',
    'Ensure every heading has 60+ words of content beneath it',
    'Test hierarchy with HTML5 Outliner or WAVE tool',
    'Re-scan page to confirm Heading Structure score improvement'
  ];

  // Build customized implementation (blue box)
  let customizedImplementation = `### Heading Hierarchy Strategy for ${pageTitle}

**Current Heading Structure:**
- **H1:** ${h1Count === 1 ? `✅ "${h1Text}"` : h1Count === 0 ? '❌ Missing' : `⚠️ ${h1Count} H1s (should be exactly 1)`}
- **H2 sections:** ${h2Count} ${h2Count < 3 ? '(add 2-3 more for better structure)' : '✅'}
- **H3 subsections:** ${h3Count}
- **Question-based headings:** ${questionHeadingPct}% (Target: 40-50%)

${h2List.length > 0 ? `**Your Current H2 Headings:**\n${h2List.map((h, i) => `${i+1}. "${h}"`).join('\n')}\n` : ''}
**AEO Heading Hierarchy Framework:**

Answer engines extract information best from content structured like this:

\`\`\`
H1: Main Topic (exactly one per page)
 ├─ H2: Question-Based Section
 │   ├─ H3: Subtopic A
 │   └─ H3: Subtopic B
 ├─ H2: Question-Based Section
 │   └─ H3: Subtopic A
 └─ H2: Question-Based Section
     ├─ H3: Subtopic A
     └─ H3: Subtopic B
\`\`\`

**Recommended Changes:**`;

  if (hasNoH1 || hasMultipleH1) {
    customizedImplementation += `\n\n**1. Fix H1 Issue**\n${hasNoH1 ? '- Add one H1 tag with your main topic:\n  \`<h1>' + pageTitle + '</h1>\`' : '- Remove duplicate H1s, keep only the most important one'}`;
  }

  if (questionHeadingPct < 40) {
    customizedImplementation += `\n\n**2. Convert Headings to Questions**\n\nChange declarative headings to questions that match user queries:\n\n**Before:**\n\`\`\`html\n<h2>${detectedIndustry} Services Overview</h2>\n<h2>Implementation Process</h2>\n<h2>Pricing Options</h2>\n\`\`\`\n\n**After (Question-Based for AEO):**\n\`\`\`html\n<h2>What ${detectedIndustry.toLowerCase()} services do you offer?</h2>\n<h2>How does the implementation process work?</h2>\n<h2>What does it cost?</h2>\n\`\`\``;
  }

  customizedImplementation += `\n\n**Key Heading Principles:**\n✅ **One H1 per page**: Your main topic\n✅ **H2 for major sections**: 3-5 main sections\n✅ **H3 for subsections**: Details within each H2\n✅ **Question format**: "How/What/Why/When/Where" at start\n✅ **Descriptive**: Heading alone should make sense (not just "Overview")`;

  // Build ready-to-use content
  const readyToUseContent = `**Question-Based Heading Templates:**

### For Service/Product Pages:

\`\`\`html
<h1>${detectedIndustry} Services for [Target Audience]</h1>

<h2>What ${detectedIndustry.toLowerCase()} services do we offer?</h2>
<h3>Service 1: [Name]</h3>
<h3>Service 2: [Name]</h3>
<h3>Service 3: [Name]</h3>

<h2>How does our ${detectedIndustry.toLowerCase()} process work?</h2>
<h3>Step 1: [Discovery/Assessment]</h3>
<h3>Step 2: [Strategy/Planning]</h3>
<h3>Step 3: [Implementation]</h3>
<h3>Step 4: [Measurement]</h3>

<h2>What results can you expect?</h2>
<h3>Short-term outcomes (0-3 months)</h3>
<h3>Medium-term results (3-6 months)</h3>
<h3>Long-term impact (6-12 months)</h3>

<h2>What does it cost?</h2>
<h3>Pricing structure</h3>
<h3>What's included</h3>
<h3>ROI expectations</h3>

<h2>How do we compare to alternatives?</h2>
<h3>Traditional approach vs. our method</h3>
<h3>Key differentiators</h3>
\`\`\`

### For Content/Resource Pages:

\`\`\`html
<h1>Complete Guide to [Topic]</h1>

<h2>What is [Topic]?</h2>
<h3>Definition and key concepts</h3>
<h3>Why it matters</h3>

<h2>How does [Topic] work?</h2>
<h3>Core principles</h3>
<h3>Step-by-step process</h3>

<h2>Why should you care about [Topic]?</h2>
<h3>Benefits and outcomes</h3>
<h3>Common use cases</h3>

<h2>When should you use [Topic]?</h2>
<h3>Ideal scenarios</h3>
<h3>Timing considerations</h3>

<h2>Who is this for?</h2>
<h3>Ideal user profiles</h3>
<h3>Industry applications</h3>
\`\`\``;

  // Build implementation notes (yellow box)
  const implementationNotes = [
    '**H1 rule**: Exactly one H1 per page stating the main topic clearly',
    '**H2 for main sections**: 3-7 major sections that break up your content',
    '**H3 for subsections**: Details under each H2 (use H4 only if absolutely needed)',
    '**Question format**: 40-50% of H2/H3 headings should be questions starting with What/How/Why/When/Where/Who',
    '**Descriptive, not generic**: Use "How does implementation work?" not just "Process"',
    '**Natural language**: Match how users actually ask questions (conversational)',
    '**Hierarchical logic**: H3 should never appear without a parent H2 above it',
    '**Content beneath each heading**: Minimum 60 words of content after every heading'
  ];

  // Build quick wins (purple box)
  const quickWins = [
    hasNoH1 ? '✅ Add one H1 tag to your page (2 min)' : hasMultipleH1 ? '✅ Remove duplicate H1s (5 min)' : '✅ Verify H1 is clear and specific (2 min)',
    '✅ Convert 3-5 H2/H3 headings to question format (10 min)',
    '✅ Add 1-2 new H2 sections if you have fewer than 3 (15 min)',
    '✅ Ensure H2 → H3 hierarchy is logical (no orphan H3s) (5 min)',
    '✅ Test with HTML5 Outliner or WAVE accessibility tool (3 min)',
    '✅ Re-scan to confirm Heading Structure score lift'
  ];

  // Build validation checklist (indigo box)
  const validationChecklist = [
    {
      text: hasNoH1 ? 'Added exactly one H1 tag' : hasMultipleH1 ? 'Removed duplicate H1s (only one H1)' : 'Verified H1 is clear and descriptive',
      checked: false
    },
    {
      text: hasPoorDistribution ? 'Added H2 sections (3-7 total)' : 'H2 sections properly distributed',
      checked: false
    },
    {
      text: '40-50% of H2/H3 headings are question-based',
      checked: false
    },
    {
      text: 'H3 tags only appear under H2 parents (proper hierarchy)',
      checked: false
    },
    {
      text: 'Each heading has 60+ words of content beneath it',
      checked: false
    },
    {
      text: 'Tested with HTML5 Outliner - structure makes sense',
      checked: false
    },
    {
      text: 'Re-scanned page and confirmed Heading Structure score improvement',
      checked: false
    }
  ];

  // Build comprehensive code snippet
  const codeSnippet = `## Heading Hierarchy Implementation

### 1. Proper H1-H3 Structure

**Before (Poor Hierarchy):**
\`\`\`html
<h1>Welcome to Our Site</h1>
<h1>About Our Services</h1>  <!-- ❌ Multiple H1s -->
<h3>Service Details</h3>      <!-- ❌ H3 without H2 parent -->
<h2>Contact</h2>
\`\`\`

**After (Proper Hierarchy):**
\`\`\`html
<h1>${detectedIndustry} Services for Growing Businesses</h1>

<h2>What ${detectedIndustry.toLowerCase()} services do we offer?</h2>
<h3>Service 1: Strategy & Planning</h3>
<p>Our strategy services help you define clear goals...</p>

<h3>Service 2: Implementation & Execution</h3>
<p>We execute your strategy with proven methodologies...</p>

<h3>Service 3: Measurement & Optimization</h3>
<p>Track performance and optimize for better results...</p>

<h2>How does our process work?</h2>
<h3>Discovery & Assessment (Week 1-2)</h3>
<p>We start by understanding your current state...</p>

<h3>Strategy Development (Week 3-4)</h3>
<p>Based on discovery, we create a customized roadmap...</p>

<h2>What results can you expect?</h2>
<p>Our clients typically see measurable improvements...</p>
\`\`\`

### 2. Converting to Question-Based Headings

**Traditional (Declarative):**
\`\`\`html
<h2>Services Overview</h2>
<h2>Implementation Timeline</h2>
<h2>Pricing Structure</h2>
<h2>Our Team</h2>
<h2>Client Results</h2>
\`\`\`

**AEO-Optimized (Question-Based):**
\`\`\`html
<h2>What services do you offer?</h2>
<h2>How long does implementation take?</h2>
<h2>What does it cost?</h2>
<h2>Who will work on my project?</h2>
<h2>What results have other clients achieved?</h2>
\`\`\`

**Why Questions Work Better:**
- Matches natural user queries to AI assistants
- Directly triggers answer extraction in ChatGPT/Perplexity
- Improves featured snippet eligibility
- Better voice search compatibility

### 3. Complete Page Structure Example

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <title>${pageTitle}</title>
</head>
<body>
  <!-- Exactly one H1 -->
  <h1>Complete ${detectedIndustry} Services Guide</h1>

  <!-- Main section 1 -->
  <h2>What is ${detectedIndustry.toLowerCase()} and why does it matter?</h2>
  <p>[60+ words explaining the concept and importance]</p>

    <h3>Key benefits of ${detectedIndustry.toLowerCase()}</h3>
    <p>[Details about benefits]</p>

    <h3>Common use cases</h3>
    <p>[Examples of applications]</p>

  <!-- Main section 2 -->
  <h2>How does ${detectedIndustry.toLowerCase()} work?</h2>
  <p>[60+ words explaining the process]</p>

    <h3>Step 1: Discovery</h3>
    <p>[Details about discovery phase]</p>

    <h3>Step 2: Implementation</h3>
    <p>[Details about implementation]</p>

  <!-- Main section 3 -->
  <h2>What should you look for in a ${detectedIndustry.toLowerCase()} provider?</h2>
  <p>[60+ words on selection criteria]</p>

    <h3>Essential qualifications</h3>
    <p>[Required credentials/experience]</p>

    <h3>Red flags to avoid</h3>
    <p>[Warning signs of poor providers]</p>

  <!-- Main section 4 -->
  <h2>How do you measure ${detectedIndustry.toLowerCase()} success?</h2>
  <p>[60+ words on success metrics]</p>

    <h3>Key performance indicators</h3>
    <p>[Specific metrics to track]</p>

    <h3>Expected timelines</h3>
    <p>[When to expect results]</p>
</body>
</html>
\`\`\`

### 4. Validation Tools

**HTML5 Outliner:**
- Visit: https://gsnedders.html5.org/outliner/
- Paste your page URL
- Verify clean hierarchy (no missing levels)

**WAVE Accessibility Tool:**
- Install browser extension
- Check heading structure warnings
- Ensure logical heading order

**Manual Check:**
\`\`\`javascript
// Run in browser console to see heading structure
document.querySelectorAll('h1, h2, h3, h4').forEach(h => {
  console.log(h.tagName + ': ' + h.textContent.trim());
});
\`\`\`

### 5. Common Heading Mistakes to Avoid

❌ **Multiple H1s**: Confuses AI about page topic
❌ **Skipping levels**: Going H2 → H4 breaks hierarchy
❌ **Generic headings**: "Overview", "Introduction", "More Info"
❌ **No questions**: All declarative statements
❌ **Empty headings**: Headings with no content beneath
❌ **Keyword stuffing**: Unnatural repetition in headings`;

  return {
    id: `rec_${issue.category}_headingHierarchy_${Date.now()}`,
    title: 'Content Structure: Heading Hierarchy & Organization',
    category: issue.category,
    subfactor: 'headingHierarchyScore',
    priority: 'high',
    priorityScore: issue.priority || 75,
    finding: finding,
    impact: impact,
    actionSteps: actionSteps,
    codeSnippet: codeSnippet,
    customizedImplementation: customizedImplementation,
    readyToUseContent: readyToUseContent,
    implementationNotes: implementationNotes,
    quickWins: quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: "45-90 minutes",
    difficulty: "Easy",
    estimatedScoreGain: Math.max(6, Math.round(issue.gap * 0.6)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: {
      h1Count: h1Count,
      h2Count: h2Count,
      h3Count: h3Count,
      h4Count: h4Count,
      hasMultipleH1: hasMultipleH1,
      hasNoH1: hasNoH1,
      hasPoorDistribution: hasPoorDistribution,
      questionHeadingPct: questionHeadingPct,
      hierarchyIssues: hierarchyIssues
    },
    generatedBy: 'programmatic_heading_hierarchy'
  };
}

/**
 * Generates comprehensive XML sitemap recommendations
 * with validation and submission guidance
 */
function makeProgrammaticSitemapRecommendation(issue, scanEvidence, industry) {
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const domain = extractDomain(scanEvidence.url);

  // Check current score to determine if already implemented
  const currentScore = issue.currentScore || 0;
  const threshold = issue.threshold || 80;
  const isImplemented = currentScore >= threshold;

  // Check for sitemap (try multiple properties for backward compatibility)
  const hasSitemap = scanEvidence.technical?.hasSitemap ||
                     scanEvidence.technical?.sitemapDetected ||
                     false;

  console.log(`[Sitemap Rec] Current Score=${currentScore}/${threshold}, Implemented=${isImplemented}, hasSitemap=${hasSitemap}`);

  // Use the actual detected sitemap location if available
  const sitemapLocation = scanEvidence.technical?.sitemapLocation || 'sitemap.xml';
  const sitemapUrl = `${domain}/${sitemapLocation}`;
  const pageCount = scanEvidence.technical?.sitemapPageCount || 0;
  const lastModified = scanEvidence.technical?.sitemapLastModified || 'Unknown';

  // If already implemented, show success message
  if (isImplemented && hasSitemap) {
    return {
      id: `rec_${issue.category}_sitemap_${Date.now()}`,
      title: 'Technical Setup: XML Sitemap',
      category: issue.category,
      subfactor: 'sitemapScore',
      priority: 'low',
      priorityScore: 10,
      finding: `Status: Excellent! ✅

Sitemap detected at **${sitemapLocation}** with ${pageCount} pages crawled. Your sitemap implementation is complete! Search engines and AI crawlers can efficiently discover and index your content.

Current Score: ${currentScore}/100 (Target: ${threshold}/100)`,
      impact: `Your sitemap is properly implemented. Sitemaps help search engines and AI systems discover and index your content efficiently. Better indexed pages → more likely to be AI training sources.`,
      actionSteps: [
        'Your sitemap implementation is complete',
        'Ensure all important pages are included in the sitemap',
        'Submit sitemap to Google Search Console and Bing Webmaster Tools if not already done',
        'Keep sitemap updated automatically when you add/remove pages',
        'Monitor Search Console for crawl errors'
      ],
      codeSnippet: `<!-- Your sitemap is already implemented! -->
<!-- Location: ${sitemapUrl} -->
<!-- Pages: ${pageCount} -->
<!-- Last Modified: ${lastModified} -->`,
      implementationNotes: [
        `Sitemap detected at ${sitemapLocation}`,
        `${pageCount} pages included`,
        'Ensure sitemap stays updated automatically',
        'Monitor for crawl errors in Search Console'
      ],
      quickWins: ['✅ Sitemap already implemented', `✅ ${pageCount} pages indexed`, '✅ AI crawlers can discover your content'],
      validationChecklist: [
        '✅ Sitemap detected and accessible',
        '✅ Score above threshold',
        'Continue monitoring implementation'
      ],
      estimatedTime: "N/A - Already implemented",
      difficulty: "Completed",
      estimatedScoreGain: 0,
      currentScore: currentScore,
      targetScore: threshold,
      status: 'detected_implemented',
      evidence: {
        hasSitemap: hasSitemap,
        sitemapUrl: sitemapUrl,
        pageCount: pageCount,
        lastModified: lastModified
      },
      generatedBy: 'sitemap_detected'
    };
  }

  // Not implemented - show action needed
  const finding = hasSitemap
    ? `Status: Sitemap Found, Score Needs Improvement

Your sitemap was found at **${sitemapLocation}** with ${pageCount} pages crawled, but your score is ${currentScore}/100 (Target: ${threshold}/100, Gap: ${threshold - currentScore} points).

To maximize AI visibility, ensure:
- All important pages are included in the sitemap
- The sitemap is submitted to Google Search Console and Bing Webmaster Tools
- The sitemap is updated automatically when you add/remove pages`
    : `Status: Missing Sitemap

Your site is missing an XML sitemap (Score: ${currentScore}/100, Target: ${threshold}/100, Gap: ${threshold - currentScore} points). Without a sitemap, search engines and AI crawlers have difficulty discovering all your pages, reducing visibility in answer engines like ChatGPT, Perplexity, and Google AI Overviews.`;

  // Build impact description
  const impact = `A sitemap is like a map of your website for search engines and AI. Without one, Google and AI assistants might miss some of your pages entirely. With a sitemap, you're telling them "Here's everything important on my site — please read it all!"`;

  // Build action steps
  const actionSteps = [
    hasSitemap ? 'Validate existing sitemap with XML Sitemap Validator' : 'Generate XML sitemap for all important pages',
    'Include only indexable pages (exclude noindex, login, admin pages)',
    'Set priority and changefreq appropriately',
    'Submit sitemap to Google Search Console',
    'Submit sitemap to Bing Webmaster Tools',
    'Add sitemap reference to robots.txt',
    'Re-scan page to confirm XML Sitemap score improvement'
  ];

  // Build customized implementation
  const customizedImplementation = `### XML Sitemap Setup for ${domain}

**Current Status:** ${hasSitemap ? `✅ Sitemap found at ${sitemapUrl}` : '❌ No sitemap detected'}
${hasSitemap ? `- Pages included: ${pageCount}\n- Last modified: ${lastModified}\n` : ''}
**Priority Levels for ${industry || 'General'} Site:**

1. **Priority 1.0** - Homepage, main service/product pages
2. **Priority 0.8** - Category pages, key landing pages
3. **Priority 0.6** - Blog posts, case studies, resources
4. **Priority 0.4** - Author pages, tags, archives
5. **Priority 0.2** - Legal pages (privacy, terms)

**Change Frequency Guidelines:**
- **daily**: News/blog homepage, product listings
- **weekly**: Blog posts, updated services
- **monthly**: Static service pages, about pages
- **yearly**: Legal pages, archived content`;

  // Build ready-to-use content
  const readyToUseContent = `<!-- Basic XML Sitemap Template -->
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

  <!-- Homepage -->
  <url>
    <loc>${domain}</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>

  <!-- Main Service/Product Pages -->
  <url>
    <loc>${domain}/services</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>

  <!-- Blog/Content Pages -->
  <url>
    <loc>${domain}/blog/article-title</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.6</priority>
  </url>

  <!-- Add more URLs... -->
</urlset>

<!-- Add to robots.txt -->
Sitemap: ${domain}/sitemap.xml`;

  // Build implementation notes
  const implementationNotes = [
    '**File location**: Place sitemap.xml in your site root directory',
    '**Max URLs**: 50,000 URLs per sitemap file (use sitemap index if more)',
    '**Max file size**: 50MB uncompressed (compress to .xml.gz if needed)',
    '**Update frequency**: Regenerate whenever you publish/update content',
    '**Exclude these**: Login pages, admin areas, duplicate content, noindex pages',
    '**Include these**: All public-facing pages you want indexed and cited by AI',
    '**Validation**: Test with Google Search Console or XML Sitemap Validator',
    '**Automation**: Use CMS plugins (Yoast, RankMath) or build scripts to auto-generate'
  ];

  // Build quick wins
  const quickWins = [
    '✅ Generate basic sitemap with online tool (XML-sitemaps.com) (10 min)',
    '✅ Add sitemap URL to robots.txt (2 min)',
    '✅ Submit to Google Search Console (5 min)',
    '✅ Submit to Bing Webmaster Tools (5 min)',
    '✅ Validate with Google Rich Results Test (3 min)',
    '✅ Re-scan to confirm XML Sitemap score improvement'
  ];

  // Build validation checklist
  const validationChecklist = [
    {
      text: 'Sitemap.xml created and accessible at domain root',
      checked: false
    },
    {
      text: 'All important pages included (no 404s or redirects)',
      checked: false
    },
    {
      text: 'Excluded admin, login, and noindex pages',
      checked: false
    },
    {
      text: 'Sitemap reference added to robots.txt',
      checked: false
    },
    {
      text: 'Submitted to Google Search Console',
      checked: false
    },
    {
      text: 'Submitted to Bing Webmaster Tools',
      checked: false
    },
    {
      text: 'Validated with no errors in Search Console',
      checked: false
    },
    {
      text: 'Re-scanned and confirmed score improvement',
      checked: false
    }
  ];

  // Build code snippet
  const codeSnippet = `## Complete XML Sitemap Implementation

### 1. Generate Sitemap (Choose One Method)

**Method A: WordPress (Yoast SEO)**
\`\`\`
1. Install Yoast SEO plugin
2. Go to SEO → General → Features
3. Enable "XML sitemaps"
4. View sitemap at: ${domain}/sitemap_index.xml
\`\`\`

**Method B: Node.js/Express**
\`\`\`javascript
const { SitemapStream, streamToPromise } = require('sitemap');
const { createWriteStream } = require('fs');

async function generateSitemap() {
  const sitemap = new SitemapStream({ hostname: '${domain}' });
  const writeStream = createWriteStream('./public/sitemap.xml');

  sitemap.pipe(writeStream);

  // Add URLs
  sitemap.write({ url: '/', changefreq: 'weekly', priority: 1.0 });
  sitemap.write({ url: '/services', changefreq: 'monthly', priority: 0.8 });
  sitemap.write({ url: '/blog', changefreq: 'daily', priority: 0.7 });

  sitemap.end();

  await streamToPromise(sitemap);
  console.log('Sitemap generated!');
}

generateSitemap();
\`\`\`

**Method C: Python**
\`\`\`python
from datetime import datetime

def generate_sitemap():
    urls = [
        {'loc': '${domain}/', 'priority': '1.0', 'changefreq': 'weekly'},
        {'loc': '${domain}/services', 'priority': '0.8', 'changefreq': 'monthly'},
        {'loc': '${domain}/blog', 'priority': '0.7', 'changefreq': 'daily'},
    ]

    xml = '<?xml version="1.0" encoding="UTF-8"?>\\n'
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\\n'

    for url in urls:
        xml += '  <url>\\n'
        xml += f'    <loc>{url["loc"]}</loc>\\n'
        xml += f'    <lastmod>{datetime.now().strftime("%Y-%m-%d")}</lastmod>\\n'
        xml += f'    <changefreq>{url["changefreq"]}</changefreq>\\n'
        xml += f'    <priority>{url["priority"]}</priority>\\n'
        xml += '  </url>\\n'

    xml += '</urlset>'

    with open('sitemap.xml', 'w') as f:
        f.write(xml)

generate_sitemap()
\`\`\`

### 2. Add Sitemap to robots.txt

\`\`\`
# Add to robots.txt
User-agent: *
Allow: /

# Sitemap location
Sitemap: ${domain}/sitemap.xml
\`\`\`

### 3. Submit to Search Engines

**Google Search Console:**
1. Visit: https://search.google.com/search-console
2. Add property for ${domain}
3. Go to Sitemaps section (left sidebar)
4. Enter "sitemap.xml" and click Submit

**Bing Webmaster Tools:**
1. Visit: https://www.bing.com/webmasters
2. Add site: ${domain}
3. Go to Sitemaps section
4. Submit sitemap URL

### 4. Validation

**Check Sitemap Format:**
\`\`\`bash
# Test sitemap is accessible
curl ${domain}/sitemap.xml

# Validate XML format
xmllint --noout sitemap.xml
\`\`\`

**Online Validators:**
- Google Search Console → Sitemaps → View errors
- XML Sitemap Validator: https://www.xml-sitemaps.com/validate-xml-sitemap.html`;

  return {
    id: `rec_${issue.category}_sitemap_${Date.now()}`,
    title: 'Technical Setup: XML Sitemap',
    category: issue.category,
    subfactor: 'sitemapScore',
    priority: 'high',
    priorityScore: issue.priority || 80,
    finding: finding,
    impact: impact,
    actionSteps: actionSteps,
    codeSnippet: codeSnippet,
    customizedImplementation: customizedImplementation,
    readyToUseContent: readyToUseContent,
    implementationNotes: implementationNotes,
    quickWins: quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: "30-60 minutes",
    difficulty: "Easy",
    estimatedScoreGain: Math.max(8, Math.round(issue.gap * 0.7)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    status: 'not_implemented',
    evidence: {
      hasSitemap: hasSitemap,
      sitemapUrl: sitemapUrl,
      pageCount: pageCount,
      lastModified: lastModified
    },
    generatedBy: 'programmatic_sitemap'
  };
}

/**
 * Generates comprehensive robots.txt recommendations
 */
function makeProgrammaticRobotsTxtRecommendation(issue, scanEvidence, industry) {
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const domain = extractDomain(scanEvidence.url);

  const hasRobotsTxt = scanEvidence.technical?.hasRobotsTxt || false;
  const robotsTxtContent = scanEvidence.technical?.robotsTxtContent || '';
  const blocksAll = /User-agent:\s*\*\s*Disallow:\s*\//i.test(robotsTxtContent);
  const hasSitemapRef = /Sitemap:/i.test(robotsTxtContent);

  const finding = !hasRobotsTxt
    ? `Your site is missing a robots.txt file (Score: ${issue.currentScore}/100, Target: ${issue.threshold}). This can cause search engines and AI crawlers to miss important configuration and may result in inefficient crawling.`
    : blocksAll
    ? `Your robots.txt file blocks ALL crawlers (Score: ${issue.currentScore}/100, Target: ${issue.threshold}). This prevents search engines and AI systems from accessing your site, making you invisible to ChatGPT, Perplexity, and Google AI Overviews.`
    : !hasSitemapRef
    ? `Your robots.txt exists but is missing sitemap reference (Score: ${issue.currentScore}/100, Target: ${issue.threshold}). Adding your sitemap URL helps crawlers discover content faster.`
    : `Your robots.txt is configured but may need optimization (Score: ${issue.currentScore}/100, Target: ${issue.threshold}).`;

  const impact = `The robots.txt file is like a "Welcome" sign for search engines and AI. It tells them which parts of your site they can read. If it's missing or misconfigured, Google and AI assistants might not be able to access your content at all — meaning they can't recommend you.`;

  const actionSteps = [
    hasRobotsTxt ? 'Review existing robots.txt for issues' : 'Create robots.txt file in site root',
    blocksAll ? 'Remove "Disallow: /" to allow crawling' : 'Ensure important pages are not blocked',
    'Add sitemap reference to robots.txt',
    'Block admin, login, and duplicate pages',
    'Allow all major search engine bots',
    'Test with Google Search Console robots.txt tester',
    'Re-scan to confirm Robots.txt score improvement'
  ];

  const customizedImplementation = `### Robots.txt Configuration for ${domain}

**Current Status:** ${hasRobotsTxt ? `✅ File exists at ${domain}/robots.txt` : '❌ No robots.txt found'}
${blocksAll ? '\n⚠️ **CRITICAL**: Your robots.txt blocks ALL crawlers - fix immediately!' : ''}
${hasRobotsTxt && !hasSitemapRef ? '\n⚠️ **Missing**: Sitemap reference not found' : ''}

**Recommended Configuration:**

Your robots.txt should:
1. ✅ Allow all major search engine crawlers
2. ✅ Block admin, login, and private areas
3. ✅ Reference your XML sitemap
4. ✅ Set reasonable crawl delays if needed`;

  const readyToUseContent = `# Robots.txt for ${domain}
# Allow all search engines and AI crawlers

User-agent: *
Allow: /

# Block admin and private areas
Disallow: /admin/
Disallow: /login/
Disallow: /wp-admin/
Disallow: /cart/
Disallow: /checkout/
Disallow: /account/

# Block duplicate content
Disallow: /*?*sort=
Disallow: /*?*filter=
Disallow: /search?

# Sitemap location
Sitemap: ${domain}/sitemap.xml

# Optional: Crawl delay (use sparingly)
# Crawl-delay: 10`;

  const implementationNotes = [
    '**File location**: Must be at ${domain}/robots.txt (site root)',
    '**Case sensitive**: Use lowercase "robots.txt" (not Robots.txt)',
    '**Syntax**: One directive per line, blank lines for readability',
    '**Allow everything**: "User-agent: * / Allow: /" lets all bots crawl',
    '**Block carefully**: Only block truly private/duplicate content',
    '**Sitemap reference**: Helps crawlers discover all pages faster',
    '**Testing**: Always test with Google Search Console before deploying',
    '**AI crawlers**: GPTBot, CCBot, and other AI bots respect robots.txt'
  ];

  const quickWins = [
    hasRobotsTxt ? '✅ Review robots.txt for blocking issues (5 min)' : '✅ Create basic robots.txt file (5 min)',
    blocksAll ? '✅ Remove "Disallow: /" immediately (2 min)' : '✅ Add sitemap reference (2 min)',
    '✅ Block admin/login paths (3 min)',
    '✅ Test with Google Search Console (5 min)',
    '✅ Re-scan to confirm Robots.txt score improvement'
  ];

  const validationChecklist = [
    {
      text: 'robots.txt file created at domain root',
      checked: false
    },
    {
      text: blocksAll ? 'Removed "Disallow: /" blocking rule' : 'All important pages allowed for crawling',
      checked: false
    },
    {
      text: 'Sitemap reference added',
      checked: false
    },
    {
      text: 'Admin/login paths blocked appropriately',
      checked: false
    },
    {
      text: 'Tested with Google Search Console robots.txt tester',
      checked: false
    },
    {
      text: 'No syntax errors or warnings',
      checked: false
    },
    {
      text: 'Re-scanned and confirmed score improvement',
      checked: false
    }
  ];

  const codeSnippet = `## Complete Robots.txt Setup

### 1. Basic Robots.txt Template

\`\`\`
# Robots.txt for ${domain}

# Allow all search engines and AI crawlers
User-agent: *
Allow: /

# Block private areas
Disallow: /admin/
Disallow: /login/
Disallow: /wp-admin/
Disallow: /private/

# Sitemap
Sitemap: ${domain}/sitemap.xml
\`\`\`

### 2. Advanced Configuration (If Needed)

\`\`\`
# Different rules for specific bots
User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

# AI Crawlers
User-agent: GPTBot
Allow: /

User-agent: CCBot
Allow: /

User-agent: *
Crawl-delay: 10
Disallow: /admin/
\`\`\`

### 3. Common Patterns to Block

\`\`\`
# Block query parameters
Disallow: /*?
Disallow: /*?*sort=
Disallow: /*?*filter=

# Block duplicate content
Disallow: /print/
Disallow: /pdf/
Disallow: /*?print=

# Block search results
Disallow: /search
Disallow: /search?*

# Block tracking URLs
Disallow: /track/
Disallow: /click/
\`\`\`

### 4. Testing Robots.txt

**Google Search Console:**
1. Go to: https://search.google.com/search-console
2. Select property: ${domain}
3. Tools → robots.txt Tester
4. Test specific URLs to verify access

**Manual Test:**
\`\`\`bash
# Check robots.txt is accessible
curl ${domain}/robots.txt

# Verify syntax
# Visit: https://www.google.com/webmasters/tools/robots-testing-tool
\`\`\`

### 5. Common Mistakes to Avoid

❌ **DON'T**: Block everything with "Disallow: /"
❌ **DON'T**: Put robots.txt in subdirectory (/pages/robots.txt)
❌ **DON'T**: Use wildcards incorrectly (Disallow: /*.pdf wrong syntax)
❌ **DON'T**: Block CSS/JS files (hurts rendering in Search Console)

✅ **DO**: Allow major crawlers access to public content
✅ **DO**: Reference sitemap
✅ **DO**: Block only private/duplicate areas
✅ **DO**: Test before deploying`;

  return {
    id: `rec_${issue.category}_robotstxt_${Date.now()}`,
    title: 'Technical Setup: Robots.txt Configuration',
    category: issue.category,
    subfactor: 'robotsTxtScore',
    priority: blocksAll ? 'critical' : 'medium',
    priorityScore: issue.priority || (blocksAll ? 95 : 70),
    finding: finding,
    impact: impact,
    actionSteps: actionSteps,
    codeSnippet: codeSnippet,
    customizedImplementation: customizedImplementation,
    readyToUseContent: readyToUseContent,
    implementationNotes: implementationNotes,
    quickWins: quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: hasRobotsTxt ? "15-30 minutes" : "20-40 minutes",
    difficulty: "Easy",
    estimatedScoreGain: Math.max(6, Math.round(issue.gap * 0.6)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: {
      hasRobotsTxt: hasRobotsTxt,
      blocksAll: blocksAll,
      hasSitemapRef: hasSitemapRef
    },
    generatedBy: 'programmatic_robotstxt'
  };
}

/**
 * Generates comprehensive HTTPS/SSL recommendations
 */
function makeProgrammaticHttpsRecommendation(issue, scanEvidence, industry) {
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const domain = extractDomain(scanEvidence.url);

  const hasHttps = scanEvidence.url?.startsWith('https://') || false;
  const hasMixedContent = scanEvidence.technical?.hasMixedContent || false;
  const sslExpiry = scanEvidence.technical?.sslExpiryDays || null;
  const sslIssuer = scanEvidence.technical?.sslIssuer || 'Unknown';

  const finding = !hasHttps
    ? `Your site is not using HTTPS (Score: ${issue.currentScore}/100, Target: ${issue.threshold}). This is a CRITICAL security issue. Sites without HTTPS are penalized by search engines, flagged as "Not Secure" by browsers, and excluded from many AI training datasets.`
    : hasMixedContent
    ? `Your site uses HTTPS but has mixed content warnings (Score: ${issue.currentScore}/100, Target: ${issue.threshold}). Some resources load over HTTP, triggering browser warnings and reducing trust signals for AI systems.`
    : sslExpiry && sslExpiry < 30
    ? `Your SSL certificate expires in ${sslExpiry} days (Score: ${issue.currentScore}/100, Target: ${issue.threshold}). Renew soon to avoid downtime and trust issues.`
    : `Your site uses HTTPS (Score: ${issue.currentScore}/100, Target: ${issue.threshold}), but may need optimization for better security posture.`;

  const impact = `HTTPS is the secure version of your website address (the lock icon in browsers). Without it, browsers show a "Not Secure" warning that scares visitors away. AI assistants also see this as a red flag — they're less likely to recommend websites that aren't secure.`;

  const actionSteps = [
    !hasHttps ? 'Obtain SSL certificate (free from Let\'s Encrypt)' : 'Verify SSL certificate is valid and up-to-date',
    !hasHttps ? 'Install SSL certificate on web server' : hasMixedContent ? 'Fix mixed content warnings' : 'Ensure all resources load over HTTPS',
    !hasHttps ? 'Redirect all HTTP traffic to HTTPS' : 'Verify HTTPS redirects work correctly',
    'Test SSL configuration with SSL Labs',
    'Enable HSTS (HTTP Strict Transport Security)',
    'Update internal links to use HTTPS',
    'Re-scan to confirm HTTPS Security score improvement'
  ];

  const customizedImplementation = `### HTTPS Setup for ${domain}

**Current Status:** ${hasHttps ? `✅ HTTPS enabled` : '❌ **CRITICAL**: No HTTPS detected'}
${hasHttps && sslIssuer ? `- SSL Issuer: ${sslIssuer}\n` : ''}${hasHttps && sslExpiry ? `- Certificate expires in: ${sslExpiry} days ${sslExpiry < 30 ? '⚠️ **Renew soon!**' : ''}\n` : ''}${hasMixedContent ? '- ⚠️ **Mixed content detected** - some resources load over HTTP\n' : ''}

${!hasHttps ? '**URGENT**: You must implement HTTPS immediately. This is non-negotiable for modern web presence and AI visibility.' : ''}

**Implementation Path:**

${!hasHttps ? `1. **Get SSL Certificate** (Free from Let's Encrypt)
2. **Install on Server** (varies by host/platform)
3. **Force HTTPS Redirects** (301 redirects from HTTP → HTTPS)
4. **Update Internal Links** (change http:// → https://)
5. **Enable HSTS** (prevents downgrade attacks)` : `1. ${hasMixedContent ? '**Fix mixed content** - update all HTTP resources to HTTPS' : '**Verify certificate validity**'}
2. **Test SSL configuration** with SSL Labs
3. **Enable HSTS** if not already active
4. **Set up auto-renewal** (Let's Encrypt certs expire every 90 days)`}`;

  const readyToUseContent = `**Apache .htaccess - Force HTTPS:**
\`\`\`apache
# Redirect all HTTP to HTTPS
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

# Enable HSTS (HTTP Strict Transport Security)
Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
\`\`\`

**Nginx - Force HTTPS:**
\`\`\`nginx
# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name ${domain.replace('https://', '').replace('http://', '')};
    return 301 https://$server_name$request_uri;
}

# HTTPS server block
server {
    listen 443 ssl http2;
    server_name ${domain.replace('https://', '').replace('http://', '')};

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Enable HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}
\`\`\``;

  const implementationNotes = [
    '**SSL Certificate**: Use Let\'s Encrypt for free, auto-renewing certificates',
    '**Installation**: Varies by hosting provider (cPanel, Plesk, AWS, etc.)',
    '**Redirects**: Always use 301 (permanent) redirects from HTTP → HTTPS',
    '**Mixed content**: Check browser console for http:// resources on https:// pages',
    '**HSTS**: Forces browsers to only connect via HTTPS (prevents downgrade attacks)',
    '**Auto-renewal**: Set up certbot or hosting auto-renewal (Let\'s Encrypt certs expire in 90 days)',
    '**Testing**: Use SSL Labs (ssllabs.com/ssltest) to verify configuration',
    '**CDN**: If using Cloudflare/CDN, enable SSL there too (Full or Full Strict mode)'
  ];

  const quickWins = [
    !hasHttps ? '✅ Get Let\'s Encrypt certificate (free, 15 min)' : '✅ Test SSL with SSL Labs (5 min)',
    !hasHttps ? '✅ Install SSL on server/hosting (10-30 min)' : hasMixedContent ? '✅ Fix mixed content warnings (10-20 min)' : '✅ Verify HSTS is enabled (5 min)',
    '✅ Set up 301 redirects HTTP → HTTPS (10 min)',
    '✅ Update sitemap URLs to HTTPS (5 min)',
    '✅ Test with browser (check for padlock icon) (2 min)',
    '✅ Re-scan to confirm HTTPS score improvement'
  ];

  const validationChecklist = [
    {
      text: !hasHttps ? 'SSL certificate obtained and installed' : 'SSL certificate is valid and not expiring soon',
      checked: false
    },
    {
      text: 'All HTTP URLs redirect to HTTPS (301 redirects)',
      checked: false
    },
    {
      text: hasMixedContent ? 'Fixed all mixed content warnings' : 'No mixed content warnings in browser console',
      checked: false
    },
    {
      text: 'HSTS header enabled (Strict-Transport-Security)',
      checked: false
    },
    {
      text: 'SSL Labs test shows A or A+ rating',
      checked: false
    },
    {
      text: 'Browser shows padlock icon (secure connection)',
      checked: false
    },
    {
      text: 'Auto-renewal configured (for Let\'s Encrypt)',
      checked: false
    },
    {
      text: 'Re-scanned and confirmed HTTPS score improvement',
      checked: false
    }
  ];

  const codeSnippet = `## Complete HTTPS Implementation

### 1. Get Free SSL Certificate (Let's Encrypt)

**Ubuntu/Debian with Certbot:**
\`\`\`bash
# Install Certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# Get certificate (Nginx)
sudo certbot --nginx -d ${domain.replace('https://', '').replace('http://', '')}

# Get certificate (Apache)
sudo certbot --apache -d ${domain.replace('https://', '').replace('http://', '')}

# Test auto-renewal
sudo certbot renew --dry-run
\`\`\`

**cPanel/Shared Hosting:**
1. Log into cPanel
2. Go to "SSL/TLS Status"
3. Enable "AutoSSL" or install Let's Encrypt certificate
4. Force HTTPS in .htaccess (see ready-to-use content)

### 2. Force HTTPS Redirects

**Node.js/Express:**
\`\`\`javascript
// Redirect HTTP to HTTPS middleware
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});

// Enable HSTS
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
\`\`\`

**WordPress (wp-config.php):**
\`\`\`php
// Force HTTPS
define('FORCE_SSL_ADMIN', true);

// Update site URL
define('WP_HOME', 'https://${domain.replace('https://', '').replace('http://', '')}');
define('WP_SITEURL', 'https://${domain.replace('https://', '').replace('http://', '')}');

// Add to .htaccess for full site redirect
// (see Apache config in ready-to-use content)
\`\`\`

### 3. Fix Mixed Content

**Find Mixed Content:**
\`\`\`javascript
// Run in browser console on your HTTPS page
const insecureResources = [];
performance.getEntriesByType('resource').forEach(resource => {
  if (resource.name.startsWith('http://')) {
    insecureResources.push(resource.name);
  }
});
console.log('Insecure resources:', insecureResources);
\`\`\`

**Fix Pattern:**
\`\`\`html
<!-- Before (insecure) -->
<img src="http://example.com/image.jpg">
<script src="http://cdn.example.com/lib.js"></script>

<!-- After (secure) -->
<img src="https://example.com/image.jpg">
<script src="https://cdn.example.com/lib.js"></script>

<!-- Or use protocol-relative URLs -->
<img src="//example.com/image.jpg">
\`\`\`

### 4. Test SSL Configuration

**SSL Labs Test:**
1. Visit: https://www.ssllabs.com/ssltest/
2. Enter your domain
3. Wait for test to complete
4. Aim for A or A+ rating

**Common Issues:**
- ❌ Weak cipher suites → Update SSL configuration
- ❌ Missing HSTS → Add Strict-Transport-Security header
- ❌ Certificate chain incomplete → Reinstall with full chain
- ❌ Mixed content → Fix HTTP resources on HTTPS pages

### 5. Enable HSTS (HTTP Strict Transport Security)

**What HSTS Does:**
- Forces browsers to only connect via HTTPS
- Prevents SSL stripping attacks
- Required for A+ rating on SSL Labs

**Implementation:**
Add header to every HTTPS response:
\`\`\`
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
\`\`\`

**Preload List (Optional):**
1. Visit: https://hstspreload.org/
2. Submit your domain
3. Browsers will force HTTPS even on first visit`;

  return {
    id: `rec_${issue.category}_https_${Date.now()}`,
    title: 'Technical Setup: HTTPS/SSL Security',
    category: issue.category,
    subfactor: 'httpsScore',
    priority: !hasHttps ? 'critical' : hasMixedContent ? 'high' : 'medium',
    priorityScore: issue.priority || (!hasHttps ? 100 : hasMixedContent ? 85 : 70),
    finding: finding,
    impact: impact,
    actionSteps: actionSteps,
    codeSnippet: codeSnippet,
    customizedImplementation: customizedImplementation,
    readyToUseContent: readyToUseContent,
    implementationNotes: implementationNotes,
    quickWins: quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: !hasHttps ? "1-2 hours" : "30-60 minutes",
    difficulty: !hasHttps ? "Medium" : "Easy",
    estimatedScoreGain: Math.max(10, Math.round(issue.gap * 0.8)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: {
      hasHttps: hasHttps,
      hasMixedContent: hasMixedContent,
      sslExpiry: sslExpiry,
      sslIssuer: sslIssuer
    },
    generatedBy: 'programmatic_https'
  };
}

/**
 * Generates comprehensive crawl accessibility recommendations
 */
function makeProgrammaticCrawlAccessibilityRecommendation(issue, scanEvidence, industry) {
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const domain = extractDomain(scanEvidence.url);

  const hasNoIndex = /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(scanEvidence.html || '');
  const hasNoFollow = /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*nofollow/i.test(scanEvidence.html || '');
  const hasCanonical = /<link[^>]*rel=["']canonical["']/i.test(scanEvidence.html || '');
  const isJsRendered = scanEvidence.technical?.requiresJsRendering || false;
  const has404Links = scanEvidence.technical?.broken404Links > 0;
  const brokenLinkCount = scanEvidence.technical?.broken404Links || 0;

  const crawlIssues = [];
  if (hasNoIndex) crawlIssues.push('noindex meta tag blocks indexing');
  if (hasNoFollow) crawlIssues.push('nofollow blocks link crawling');
  if (isJsRendered) crawlIssues.push('content requires JavaScript rendering');
  if (has404Links) crawlIssues.push(`${brokenLinkCount} broken links (404s)`);

  const finding = crawlIssues.length > 0
    ? `Your page has crawl accessibility issues (Score: ${issue.currentScore}/100, Target: ${issue.threshold}). Detected: ${crawlIssues.join(', ')}. These prevent search engines and AI crawlers from fully accessing and indexing your content.`
    : `Your page is generally crawlable (Score: ${issue.currentScore}/100, Target: ${issue.threshold}), but may have minor accessibility issues affecting AI visibility.`;

  const impact = `Something on your website is blocking search engines and AI from reading your content. It's like having a locked door — even if you have great information inside, AI can't see it or recommend it. Fixing these issues lets AI fully access and understand your website.`;

  const actionSteps = [
    hasNoIndex ? 'Remove noindex meta tag (unless intentional)' : 'Verify no accidental noindex tags',
    hasNoFollow ? 'Remove nofollow from internal links' : 'Ensure important pages are followable',
    isJsRendered ? 'Implement server-side rendering or prerendering' : 'Verify content is in HTML source',
    has404Links ? `Fix ${brokenLinkCount} broken links` : 'Run broken link checker periodically',
    'Ensure robots.txt allows crawling',
    'Test with Google Search Console URL Inspection',
    'Re-scan to confirm Crawl Accessibility score improvement'
  ];

  const customizedImplementation = `### Crawl Accessibility Fixes for ${domain}

**Current Issues:**
${hasNoIndex ? '- ⚠️ **noindex meta tag** detected - page won\'t be indexed\n' : ''}${hasNoFollow ? '- ⚠️ **nofollow meta tag** detected - links won\'t be followed\n' : ''}${isJsRendered ? '- ⚠️ **JavaScript-rendered content** - may not be crawlable\n' : ''}${has404Links ? `- ⚠️ **${brokenLinkCount} broken links** found - fix to improve crawlability\n` : ''}${crawlIssues.length === 0 ? '- ✅ No major crawl blockers detected\n' : ''}

**Priority Fixes:**

${hasNoIndex ? '1. **Remove noindex** - This is blocking your page from all search engines and AI indexes\n' : ''}${isJsRendered ? `${hasNoIndex ? '2' : '1'}. **Make content crawlable** - Ensure critical content is in HTML source, not JS-only\n` : ''}${has404Links ? `${hasNoIndex || isJsRendered ? '3' : '1'}. **Fix broken links** - Update or remove ${brokenLinkCount} broken link${brokenLinkCount > 1 ? 's' : ''}\n` : ''}`;

  const readyToUseContent = `**Remove noindex (if present):**
\`\`\`html
<!-- REMOVE this if found in <head> -->
<meta name="robots" content="noindex, nofollow">
<meta name="robots" content="noindex">

<!-- OR replace with this to allow indexing -->
<meta name="robots" content="index, follow">
\`\`\`

**Canonical Tag (Prevent Duplicate Content):**
\`\`\`html
<!-- Add to <head> to specify preferred URL -->
<link rel="canonical" href="${domain}${scanEvidence.url?.replace(domain, '') || '/'}">
\`\`\`

**X-Robots-Tag (Server-level):**
\`\`\`nginx
# Nginx - Allow indexing (remove any blocking headers)
# DON'T send this header for public pages:
# add_header X-Robots-Tag "noindex, nofollow";

# Only use X-Robots-Tag for private/admin pages:
location /admin/ {
    add_header X-Robots-Tag "noindex, nofollow";
}
\`\`\``;

  const implementationNotes = [
    '**noindex removal**: Only remove if page should be public/indexed',
    '**nofollow usage**: Reserve for user-generated content (comments, forums)',
    '**JS rendering**: Critical content must be in HTML source, not loaded via JS',
    '**Canonical tags**: Use to prevent duplicate content issues',
    '**404 fixes**: Update broken internal links or implement 301 redirects',
    '**Pagination**: Use rel="next" and rel="prev" for paginated content',
    '**Testing**: Use Google Search Console URL Inspection to verify crawlability',
    '**Mobile**: Ensure mobile version is equally crawlable (responsive design preferred)'
  ];

  const quickWins = [
    hasNoIndex ? '✅ Remove noindex meta tag immediately (2 min)' : '✅ Verify no accidental noindex tags (5 min)',
    has404Links ? `✅ Fix top ${Math.min(5, brokenLinkCount)} broken links (15-30 min)` : '✅ Run broken link checker (10 min)',
    isJsRendered ? '✅ Verify critical content in HTML source (10 min)' : '✅ Test with Fetch as Google (5 min)',
    '✅ Check robots.txt allows crawling (3 min)',
    '✅ Re-scan to confirm Crawl Accessibility improvement'
  ];

  const validationChecklist = [
    {
      text: hasNoIndex ? 'Removed noindex meta tag' : 'Verified no blocking meta tags present',
      checked: false
    },
    {
      text: has404Links ? `Fixed ${brokenLinkCount} broken links` : 'No broken links detected',
      checked: false
    },
    {
      text: isJsRendered ? 'Critical content available in HTML source' : 'Content is server-rendered or prerendered',
      checked: false
    },
    {
      text: 'Canonical tags implemented correctly',
      checked: false
    },
    {
      text: 'robots.txt allows crawling of important pages',
      checked: false
    },
    {
      text: 'Tested with Google Search Console URL Inspection',
      checked: false
    },
    {
      text: 'No X-Robots-Tag blocking headers',
      checked: false
    },
    {
      text: 'Re-scanned and confirmed score improvement',
      checked: false
    }
  ];

  const codeSnippet = `## Crawl Accessibility Fixes

### 1. Remove Indexing Blocks

**Check for noindex:**
\`\`\`bash
# Search your HTML for noindex tags
curl ${domain} | grep -i noindex

# Check HTTP headers
curl -I ${domain} | grep -i x-robots-tag
\`\`\`

**Remove noindex meta tag:**
\`\`\`html
<!-- Remove these from <head>: -->
<meta name="robots" content="noindex">
<meta name="robots" content="noindex, nofollow">
<meta name="googlebot" content="noindex">

<!-- Allow indexing with: -->
<meta name="robots" content="index, follow">
<!-- Or simply remove the meta tag entirely (default is index, follow) -->
\`\`\`

### 2. Server-Side Rendering (SSR) for JS Apps

**Next.js (React SSR):**
\`\`\`javascript
// pages/index.js - automatically server-rendered
export default function HomePage({ data }) {
  return (
    <div>
      <h1>{data.title}</h1>
      <p>{data.content}</p>
    </div>
  );
}

// Data is fetched server-side (crawlable)
export async function getServerSideProps() {
  const data = await fetchData();
  return { props: { data } };
}
\`\`\`

**Prerendering for SPAs:**
\`\`\`bash
# Use Prerender.io or similar service
# Or use Puppeteer to pre-render:

npm install puppeteer

# prerender.js
const puppeteer = require('puppeteer');

async function prerenderPage(url) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });
  const html = await page.content();
  await browser.close();
  return html;
}
\`\`\`

### 3. Fix Broken Links

**Find Broken Links:**
\`\`\`bash
# Use broken-link-checker (npm package)
npm install -g broken-link-checker

# Scan site for 404s
blc ${domain} -ro

# Or use online tool:
# https://www.deadlinkchecker.com/
\`\`\`

**Fix Patterns:**
\`\`\`javascript
// Implement 301 redirects for moved pages
// Express.js example:
app.get('/old-page', (req, res) => {
  res.redirect(301, '/new-page');
});

// Or update links in HTML:
// Before: <a href="/old-page">Link</a>
// After:  <a href="/new-page">Link</a>
\`\`\`

### 4. Canonical Tags (Prevent Duplicates)

**Implementation:**
\`\`\`html
<!-- Add to every page in <head> -->
<link rel="canonical" href="${domain}/current-page-url">

<!-- For paginated content -->
<link rel="canonical" href="${domain}/products">
<link rel="prev" href="${domain}/products?page=1">
<link rel="next" href="${domain}/products?page=3">
\`\`\`

### 5. Testing Tools

**Google Search Console:**
1. Go to: https://search.google.com/search-console
2. Tools → URL Inspection
3. Enter page URL
4. Check "Coverage" section for issues

**Manual Crawl Test:**
\`\`\`bash
# Test if content is in HTML source
curl ${domain} | grep "important content phrase"

# Check for JavaScript-only content
# If phrase doesn't appear, it's JS-rendered (bad for crawlers)
\`\`\`

**Screaming Frog SEO Spider:**
- Download free version
- Crawl your site
- Check "Response Codes" tab for 404s
- Check "Directives" tab for noindex pages`;

  return {
    id: `rec_${issue.category}_crawl_${Date.now()}`,
    title: 'Technical Setup: Crawl Accessibility',
    category: issue.category,
    subfactor: 'crawlAccessibilityScore',
    priority: hasNoIndex ? 'critical' : has404Links || isJsRendered ? 'high' : 'medium',
    priorityScore: issue.priority || (hasNoIndex ? 95 : has404Links ? 80 : 70),
    finding: finding,
    impact: impact,
    actionSteps: actionSteps,
    codeSnippet: codeSnippet,
    customizedImplementation: customizedImplementation,
    readyToUseContent: readyToUseContent,
    implementationNotes: implementationNotes,
    quickWins: quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: hasNoIndex ? "10-20 minutes" : isJsRendered ? "2-4 hours" : "30-60 minutes",
    difficulty: isJsRendered ? "Hard" : hasNoIndex ? "Easy" : "Medium",
    estimatedScoreGain: Math.max(8, Math.round(issue.gap * 0.7)),
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: {
      hasNoIndex: hasNoIndex,
      hasNoFollow: hasNoFollow,
      hasCanonical: hasCanonical,
      isJsRendered: isJsRendered,
      has404Links: has404Links,
      brokenLinkCount: brokenLinkCount,
      crawlIssues: crawlIssues
    },
    generatedBy: 'programmatic_crawl_accessibility'
  };
}

function makeProgrammaticStructuredDataRecommendation(issue, scanEvidence) {
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const template = RECOMMENDATION_TEMPLATES.structuredDataScore;

  const core = buildCoreJsonLd(scanEvidence.url, facts);
  const faqPairs = (profile.sections?.has_faq && Array.isArray(profile.sections.faq_pairs))
    ? profile.sections.faq_pairs.slice(0, 6) : [];
  const faq = buildFAQJsonLd(scanEvidence.url, faqPairs);
  const blocks = [...core, ...(faq ? [faq] : [])];

  const codeSnippet = blocks
    .map(obj => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`)
    .join('\n');

  const domain = extractDomain(scanEvidence.url);
  const found = (scanEvidence.technical?.structuredData || []).length;

  return {
    id: `rec_${issue.category}_${issue.subfactor}_${Date.now()}`,
    title: "Add Organization + WebSite + WebPage schema",
    category: issue.category,
    subfactor: "structuredDataScore",
    priority: issue.severity || 'high',
    priorityScore: issue.priority || 90,
    finding: found
      ? `Structured data is incomplete on ${domain}. Core entity schemas missing or not linked with stable @ids.`
      : `No Schema.org JSON-LD detected on ${domain}. AI assistants cannot reliably identify your entity.`,
    impact: "Defines your canonical entity for AI systems, enables rich results, and improves citation accuracy.",
    actionSteps: [
      "Open your homepage layout/template file.",
      "Paste the JSON-LD snippets below just before </head> on the homepage.",
      "Deploy, then validate in Google's Rich Results Test.",
      ...(faq ? ["(Optional) Ensure your on-page FAQ section matches the generated FAQPage items."] : [])
    ],
    codeSnippet,
    estimatedTime: template.typicalTimeToFix,
    difficulty: template.difficulty,
    estimatedScoreGain: template.estimatedGain,
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: scanEvidence.technical?.structuredData || null,
    generatedBy: 'programmatic'
  };
}

function pickUnique(list = [], n = 10) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = String(item || '').trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(item).trim());
    if (out.length >= n) break;
  }
  return out;
}

function deriveTopicsFromFacts(facts) {
  const topics = new Set();

  const pushFromArrayFact = (name) => {
    const v = facts.find(f => f.name === name)?.value;
    if (Array.isArray(v)) v.forEach(x => typeof x === 'string' && topics.add(x));
  };
  const pushFromStringFact = (name) => {
    const v = facts.find(f => f.name === name)?.value;
    if (typeof v === 'string') {
      v.split(/[,\|/]/).forEach(x => topics.add(x.trim()));
    }
  };

  pushFromArrayFact('services');
  pushFromArrayFact('products');
  pushFromArrayFact('features');
  pushFromArrayFact('audiences');
  pushFromStringFact('description');
  pushFromStringFact('tagline');

  // prune short/noisy
  return Array.from(topics).filter(t => t && t.length > 2).slice(0, 20);
}

function proposeQuestionHeadings(industryId, facts) {
  const brand = facts.find(f=>f.name==='brand')?.value || facts.find(f=>f.name==='site_name')?.value || 'your business';
  const topics = deriveTopicsFromFacts(facts);

  // Industry-specific question seeds library
  const SEEDS = {
    saas: [
      `What is ${brand}?`,
      `How does ${brand} work?`,
      `Who is ${brand} best for?`,
      `How much does ${brand} cost?`,
      `What problems does ${brand} solve?`,
      `How secure is ${brand}?`,
      `Does ${brand} integrate with my tools?`,
      `How long does ${brand} take to implement?`,
      `What's the ROI of ${brand}?`,
      `How is ${brand} different from alternatives?`
    ],
    ai_infrastructure: [
      `How do I reduce GPU costs without losing performance?`,
      `What infrastructure supports sub-100ms inference at scale?`,
      `How do I choose between A100, H100, and L4 for my workload?`,
      `How can I optimize GPU utilization for transformer training?`,
      `What benchmarking metrics matter for production inference?`,
      `How does autoscaling work for bursty inference traffic?`,
      `What SLAs should I expect for AI infrastructure?`,
      `How do I secure model artifacts and datasets?`,
      `What's the best way to deploy multi-model routing?`
    ],
    ecommerce: [
      `What products does ${brand} sell?`,
      `How long does shipping take?`,
      `What is the return policy?`,
      `How do I track my order?`,
      `What payment methods do you accept?`,
      `Do you offer free shipping?`,
      `How do I know what size to order?`,
      `Are your products authentic?`,
      `Do you ship internationally?`,
      `How can I contact customer service?`
    ],
    healthcare: [
      `How do I schedule an appointment?`,
      `What insurance do you accept?`,
      `What should I bring to my first visit?`,
      `How do I access my medical records?`,
      `What are your office hours?`,
      `Do you offer telehealth appointments?`,
      `How long will my appointment take?`,
      `What safety measures are in place?`,
      `How do I request a prescription refill?`,
      `What if I need to cancel my appointment?`
    ],
    agency: [
      `What services does ${brand} provide?`,
      `How much do your services cost?`,
      `What's your typical project timeline?`,
      `Who are your ideal clients?`,
      `Can you show me case studies?`,
      `What makes ${brand} different from other agencies?`,
      `How do you measure success?`,
      `What's your process for new clients?`,
      `Do you offer ongoing support after launch?`,
      `How do I get started with ${brand}?`
    ],
    real_estate: [
      `How do I search for homes in my area?`,
      `What's the current market value of my home?`,
      `How long does it take to sell a home?`,
      `What are closing costs?`,
      `How do I schedule a showing?`,
      `Do you help with first-time home buyers?`,
      `What neighborhoods do you serve?`,
      `How is the local housing market?`,
      `What's your commission rate?`,
      `How do I get pre-approved for a mortgage?`
    ],
    financial: [
      `How do I open an account?`,
      `What are your interest rates?`,
      `Is my money FDIC insured?`,
      `What fees do you charge?`,
      `How do I access my account online?`,
      `What types of accounts do you offer?`,
      `How long does a loan approval take?`,
      `What credit score do I need?`,
      `How do I contact customer support?`,
      `Are there any minimum balance requirements?`
    ],
    legal: [
      `What types of cases does ${brand} handle?`,
      `How much do legal services cost?`,
      `Do you offer free consultations?`,
      `How long will my case take?`,
      `What are my legal rights?`,
      `How do I know if I have a strong case?`,
      `What should I bring to my consultation?`,
      `How do you communicate with clients?`,
      `What is your success rate?`,
      `How do I get started?`
    ],
    restaurant: [
      `What are your hours?`,
      `Do you take reservations?`,
      `What's on your menu?`,
      `Do you offer takeout or delivery?`,
      `Do you have vegetarian/vegan options?`,
      `What are your most popular dishes?`,
      `Do you accommodate dietary restrictions?`,
      `Where can I park?`,
      `Do you have outdoor seating?`,
      `How do I make a reservation?`
    ],
    generic: [
      `What is ${brand}?`,
      `How does ${brand} help my business?`,
      `Who should use ${brand}?`,
      `How much does it cost to use ${brand}?`,
      `How do I get started with ${brand}?`,
      `What are the benefits of using ${brand}?`,
      `What support does ${brand} provide?`,
      `How does ${brand} compare to alternatives?`
    ]
  };

  // Expand seeds with topic-based questions
  const topicQs = topics.flatMap(t => ([
    `What is ${t}?`,
    `How does ${t} work?`,
    `Why is ${t} important?`,
    `How do I implement ${t}?`,
    `What are best practices for ${t}?`
  ]));

  // Match industry to seeds (case-insensitive, partial match)
  const industryLower = (industryId || '').toLowerCase();
  const base =
    industryLower.includes('ai_infrastructure') || industryLower.includes('ai infrastructure') ? SEEDS.ai_infrastructure :
    industryLower.includes('saas') || industryLower.includes('software') ? SEEDS.saas :
    industryLower.includes('ecommerce') || industryLower.includes('e-commerce') || industryLower.includes('retail') ? SEEDS.ecommerce :
    industryLower.includes('health') || industryLower.includes('medical') ? SEEDS.healthcare :
    industryLower.includes('agency') || industryLower.includes('marketing') ? SEEDS.agency :
    industryLower.includes('real') || industryLower.includes('estate') ? SEEDS.real_estate :
    industryLower.includes('financial') || industryLower.includes('bank') || industryLower.includes('fintech') ? SEEDS.financial :
    industryLower.includes('legal') || industryLower.includes('law') || industryLower.includes('attorney') ? SEEDS.legal :
    industryLower.includes('restaurant') || industryLower.includes('food') ? SEEDS.restaurant :
    SEEDS.generic;

  return pickUnique([...base, ...topicQs], 12);
}

async function makeProgrammaticQuestionHeadingsRecommendation(issue, scanEvidence, industry) {
  console.log('🎯 Starting Question Headings recommendation generation...');
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const domain = extractDomain(scanEvidence.url);
  const pageUrl = scanEvidence.url || '';

  // Extract page name from URL slug or SEO title
  let pageTitle = '';
  try {
    const urlObj = new URL(pageUrl);
    const pathParts = urlObj.pathname.split('/').filter(p => p.length > 0);
    if (pathParts.length > 0) {
      // Get the last meaningful part of the path (the slug)
      const slug = pathParts[pathParts.length - 1];
      // Convert slug to title case (e.g., "ai-marketing-services" → "AI Marketing Services")
      pageTitle = slug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
  } catch (e) {
    // Fallback to empty string if URL parsing fails
  }

  // If no slug, try metadata title, otherwise use generic label
  if (!pageTitle) {
    pageTitle = scanEvidence.metadata?.title || 'this page';
  }

  // Extract actual headings from the page
  const allH2s = scanEvidence.content?.headings?.h2 || [];
  const allH3s = scanEvidence.content?.headings?.h3 || [];
  const allHeadings = [...allH2s, ...allH3s];

  // Count question vs statement headings
  const questionHeadings = allHeadings.filter(h => h.trim().endsWith('?'));
  const statementHeadings = allHeadings.filter(h => !h.trim().endsWith('?'));
  const questionPercent = allHeadings.length > 0
    ? Math.round((questionHeadings.length / allHeadings.length) * 100)
    : 0;

  // Build Finding with actual examples from the page
  const exampleStatementHeadings = statementHeadings.slice(0, 3);
  const exampleQuestionHeadings = questionHeadings.slice(0, 2);

  const findingParts = [];

  if (questionHeadings.length > 0) {
    findingParts.push(`Your ${pageTitle ? `"${pageTitle}" page` : 'page'} already includes ${questionHeadings.length} question-based heading${questionHeadings.length === 1 ? '' : 's'}:`);
    findingParts.push('');
    exampleQuestionHeadings.forEach(q => {
      findingParts.push(`• "${q}"`);
    });
    findingParts.push('');
    findingParts.push(`${questionHeadings.length > 2 ? 'These provide' : 'This provides'} a solid foundation for AI-readable, conversational content.`);
  } else {
    findingParts.push(`Your ${pageTitle ? `"${pageTitle}" page` : 'page'} currently uses ${statementHeadings.length} statement-based headings with no question-format H2/H3s.`);
  }

  findingParts.push('');

  if (statementHeadings.length > 0) {
    findingParts.push(`However, ${statementHeadings.length} important section${statementHeadings.length === 1 ? '' : 's'} still ${statementHeadings.length === 1 ? 'relies' : 'rely'} on statement-based headings rather than question-based H2/H3s:`);
    findingParts.push('');
    exampleStatementHeadings.forEach(s => {
      findingParts.push(`• "${s}"`);
    });
    findingParts.push('');
    findingParts.push(`As a result, your Direct Answer Structure sub-score remains partially optimized (${questionPercent}% question-format headings).`);
  }

  const finding = findingParts.join('\n');

  // Calculate impact points
  const potentialGainMin = Math.max(8, Math.round(issue.gap * 0.6));
  const potentialGainMax = Math.max(12, Math.round(issue.gap * 0.9));

  const impact = `People ask AI questions like "How do I..." or "What is the best way to..." When your headings are written as questions (not just topic labels), AI can match them directly to what people are asking. This makes you much more likely to be the answer AI recommends.`;

  // Build action steps
  const actionSteps = [
    `1️⃣ Identify non-question headings on this page — ${exampleStatementHeadings.length > 0 ? `e.g., "${exampleStatementHeadings[0]}"` : 'review all H2/H3 headings'}`,
    '2️⃣ Rewrite them as question-based H2/H3s that mirror how buyers would ask',
    '3️⃣ Pair each question with a concise (50–150 word) answer written in conversational tone and active voice',
    '4️⃣ Validate readability and AI parsing: target Flesch > 65 and average sentence < 20 words',
    '5️⃣ Re-scan this page after publishing to confirm improvement in AI Search Readiness and Entity Clarity metrics'
  ];

  // Generate customized before/after examples for the top statement headings
  const customizedSections = [];

  const topHeadings = statementHeadings.slice(0, 3);
  console.log(`📝 Processing ${topHeadings.length} headings with ChatGPT...`);

  // Process all headings in parallel for better performance
  const sectionPromises = topHeadings.map(async (heading, idx) => {
    const questionVersion = await convertToQuestionHeading(heading, industry, facts);
    const exampleAnswer = await generateExampleAnswer(heading, questionVersion, industry, facts);

    return {
      sectionNumber: idx + 1,
      sectionTitle: heading,
      before: `<h2>${heading}</h2>`,
      after: `<h2>${questionVersion}</h2>`,
      suggestedAnswer: exampleAnswer
    };
  });

  // Wait for all conversions to complete
  const sections = await Promise.all(sectionPromises);
  customizedSections.push(...sections);

  // Build customized implementation text
  const customizedImplementation = buildCustomizedImplementationText(customizedSections, pageUrl);

  // Build code snippet with before/after examples
  const codeSnippet = buildQuestionHeadingsCodeSnippet(customizedSections);

  // Implementation notes
  const implementationNotes = [
    'Keep each answer concise (80–150 words) and start with a direct response',
    'Use conversational tone and active voice',
    'Target Flesch readability score > 65',
    'Ensure each H2/H3 question is followed immediately by answer content',
    'Avoid overly technical jargon unless your audience demands it'
  ];

  // Quick wins
  const quickWins = [
    `Add 2–3 question-based H2/H3 headings in your main content sections`,
    'Ensure each answer is 80–150 words and starts with a direct response',
    `${questionHeadings.length === 0 ? 'Add FAQ schema for existing question content' : 'Expand your FAQ schema to include new questions'}`,
    'Re-scan this page after publishing to measure lift in Direct Answer Structure (sub-factor 1a)'
  ];

  // Validation checklist
  const validationChecklist = [
    '≥ 70% of H2/H3 are question-formatted',
    'Average answer length 80–150 words',
    'Flesch readability score > 65',
    'Each question immediately followed by answer content',
    'No orphaned questions (every Q has an A)'
  ];

  return {
    id: `rec_${issue.category}_${issue.subfactor}_${Date.now()}`,
    title: "AI Search Readiness: Direct Answer Structure (Question-Based Headings Enhancement)",
    category: issue.category,
    subfactor: "questionHeadingsScore",
    priority: issue.severity || 'high',
    priorityScore: issue.priority || 85,
    finding: finding,
    impact: impact,
    actionSteps: actionSteps,
    customizedImplementation: customizedImplementation,
    readyToUseContent: null, // Not applicable for this subfactor
    codeSnippet: codeSnippet,
    implementationNotes: implementationNotes,
    quickWins: quickWins,
    validationChecklist: validationChecklist,
    estimatedTime: "45–90 minutes",
    difficulty: "Easy",
    estimatedScoreGain: potentialGainMax,
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: {
      totalHeadings: allHeadings.length,
      questionHeadings: questionHeadings.length,
      statementHeadings: statementHeadings.length,
      questionPercent: questionPercent,
      exampleStatements: exampleStatementHeadings,
      exampleQuestions: exampleQuestionHeadings
    },
    generatedBy: 'programmatic_question_headings'
  };
}

// Helper: Convert statement heading to question format (ChatGPT-powered)
async function convertToQuestionHeading(statement, industry, facts) {
  const brandName = factValue(facts, 'brand') || 'your company';

  // Fallback for when OpenAI is not available
  if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️ OPENAI_API_KEY not found - using fallback conversion');
    const cleanedStatement = statement.replace(/^(our|the)\s+/i, '').trim();
    return `What is ${cleanedStatement}?`;
  }

  try {
    console.log(`🤖 Converting heading with ChatGPT: "${statement}"`);
    const prompt = `Convert this heading to a natural, conversational question that preserves the original meaning and intent.

Heading: "${statement}"
Brand: ${brandName}
Industry: ${industry || 'general'}

Rules:
- Preserve the exact meaning and intent of the original heading
- Make it sound natural (how a real person would ask)
- Use conversational, engaging tone
- Keep it under 15 words
- Don't just add "What is" or "How does" - be creative and contextual
- If it's already question-like, refine it naturally
- Return ONLY the question, nothing else

Example transformations:
- "Stop Marketing Like It's 2019." → "Why should modern companies rethink their marketing strategies?"
- "Our Services" → "What services do we offer?"
- "About Our Team" → "Who's behind our work?"`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.4,
      max_tokens: 60,
      messages: [
        { role: 'system', content: 'You are an expert copywriter converting headings to natural questions. Be creative and preserve meaning.' },
        { role: 'user', content: prompt }
      ]
    });

    const question = response.choices[0].message.content.trim();
    console.log(`✅ ChatGPT conversion successful: "${question}"`);
    return question;
  } catch (error) {
    console.error('❌ Error converting heading to question:', error.message);
    console.error('❌ Full error:', error);
    // Fallback to simple conversion
    const cleanedStatement = statement.replace(/^(our|the)\s+/i, '').trim();
    return `What is ${cleanedStatement}?`;
  }
}

// Helper: Generate example answer for a heading (ChatGPT-powered)
async function generateExampleAnswer(heading, questionVersion, industry, facts) {
  const brandName = factValue(facts, 'brand') || 'Our company';
  const location = factValue(facts, 'location') || '';
  const services = factValue(facts, 'services') || '';

  // Fallback for when OpenAI is not available
  if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️ OPENAI_API_KEY not found - using fallback answer');
    return `${brandName} specializes in ${industry || 'our industry'} solutions. We help businesses achieve their goals through innovative strategies and proven methodologies.`;
  }

  try {
    console.log(`🤖 Generating answer with ChatGPT for: "${heading}"`);
    const contextInfo = [];
    if (location) contextInfo.push(`Location: ${location}`);
    if (services) contextInfo.push(`Services: ${services}`);

    const prompt = `Write a concise, direct answer to this question based on the heading context.

Original Heading: "${heading}"
Question Version: "${questionVersion}"
Brand: ${brandName}
Industry: ${industry || 'general'}
${contextInfo.length > 0 ? contextInfo.join('\n') : ''}

Requirements:
- Write 80-150 words maximum
- Start with a DIRECT answer (no fluff)
- Use conversational, engaging tone
- Use active voice and present tense
- Include specific value or benefits when possible
- Target Flesch readability > 65
- Make it sound natural and helpful
- Return ONLY the answer text, no extra formatting

The answer should help AI understand what ${brandName} offers and why it matters.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.5,
      max_tokens: 200,
      messages: [
        { role: 'system', content: 'You are a professional copywriter creating clear, engaging answers for website content. Focus on being helpful and direct.' },
        { role: 'user', content: prompt }
      ]
    });

    const answer = response.choices[0].message.content.trim();
    console.log(`✅ ChatGPT answer generation successful (${answer.length} chars)`);
    return answer;
  } catch (error) {
    console.error('❌ Error generating example answer:', error.message);
    console.error('❌ Full error:', error);
    // Fallback to generic answer
    return `${brandName} specializes in ${industry || 'our industry'} solutions. We help businesses achieve their goals through innovative strategies and proven methodologies.`;
  }
}

// Helper: Build customized implementation text
function buildCustomizedImplementationText(sections, pageUrl) {
  if (sections.length === 0) return 'No specific sections identified for conversion.';

  const parts = [`## Customized Implementation for This Page\n`];
  parts.push(`**Page:** ${pageUrl}\n`);

  sections.forEach(section => {
    parts.push(`\n### Section ${section.sectionNumber} — ${section.sectionTitle}\n`);
    parts.push(`**Replace:**`);
    parts.push(`\`\`\`html`);
    parts.push(section.before);
    parts.push(`\`\`\``);
    parts.push(``);
    parts.push(`**With:**`);
    parts.push(`\`\`\`html`);
    parts.push(section.after);
    parts.push(`\`\`\``);
    parts.push(``);
    parts.push(`**Suggested Answer:**`);
    parts.push(`<p>${section.suggestedAnswer}</p>`);
  });

  return parts.join('\n');
}

// Helper: Build code snippet with examples
function buildQuestionHeadingsCodeSnippet(sections) {
  if (sections.length === 0) {
    return `<!-- No specific heading conversions identified -->`;
  }

  const parts = [];
  parts.push(`<!-- Before/After Examples for Question-Based Headings -->\n`);

  sections.forEach(section => {
    parts.push(`<!-- Section ${section.sectionNumber}: ${section.sectionTitle} -->`);
    parts.push(`<!-- BEFORE: -->`);
    parts.push(`<!-- ${section.before} -->`);
    parts.push(``);
    parts.push(`<!-- AFTER: -->`);
    parts.push(section.after);
    parts.push(`<p>${section.suggestedAnswer}</p>`);
    parts.push(``);
  });

  return parts.join('\n');
}

function makeProgrammaticOpenGraphRecommendation(issue, scanEvidence) {
  const { facts } = normalizeEvidence(scanEvidence);
  const url = scanEvidence.url;
  let origin = '';
  try { origin = new URL(url).origin; } catch {}

  const title = factValue(facts, 'page_title') || factValue(facts, 'brand') || extractDomain(url);
  const desc  = factValue(facts, 'description') || 'Visit our site to learn more.';
  const logo  = factValue(facts, 'logo');
  const ogImg = factValue(facts, 'og_image') || (logo && origin ? new URL(logo, origin).href : '');
  const siteName = factValue(facts, 'site_name') || factValue(facts, 'brand') || extractDomain(url);

  const metaBlock =
`<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
${ogImg ? `<meta property="og:image" content="${ogImg}">` : ''} 
<meta property="og:site_name" content="${escapeHtml(siteName)}">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
${ogImg ? `<meta name="twitter:image" content="${ogImg}">` : ''}`;

  return {
    id: `rec_${issue.category}_${issue.subfactor}_${Date.now()}`,
    title: "Add Open Graph & Twitter Card meta tags",
    category: issue.category,
    subfactor: "openGraphScore",
    priority: issue.severity || 'medium',
    priorityScore: issue.priority || 70,
    finding: `No or incomplete Open Graph metadata detected. Social previews and link shares will be poor or inconsistent.`,
    impact: "Improves social link previews (title/description/image) and helps AI assistants form rich entity cards.",
    actionSteps: sanitizeSteps([
  "Open your homepage template (e.g., index.html) and each key landing page.",
  "Paste the meta tags below inside the head block — keep one set per page.",
  "If available, set og:image and twitter:image to a 1200×630 image (JPG/PNG) hosted on your domain.",
  "Validate with Facebook Sharing Debugger and Twitter Card Validator, then re-scan."
]),
    codeSnippet: metaBlock,
    estimatedTime: "15–30 minutes",
    difficulty: "Easy",
    estimatedScoreGain: 8,
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: scanEvidence.technical?.openGraph || null,
    generatedBy: 'programmatic'
  };
}

// -----------------------------------------
// Template (fallback) path
// -----------------------------------------

function generateSmartTemplate(issue, scanEvidence, _tier, _industry) {
  const tpl = RECOMMENDATION_TEMPLATES[issue.subfactor] || {
    title: `Improve ${issue.subfactor.replace(/Score$/, '').replace(/([A-Z])/g, ' $1').trim()}`,
    impactArea: issue.category,
    whyItMatters: getContextualWhyItMatters(issue.category, issue.subfactor),
    typicalTimeToFix: "Varies",
    difficulty: "Medium",
    estimatedGain: 10
  };

  const finding = buildSmartFinding(issue, scanEvidence);
  const actionSteps = generateContextAwareSteps(issue, scanEvidence);

  const result = {
    id: `rec_${issue.category}_${issue.subfactor}_${Date.now()}`,
    title: tpl.title,
    category: issue.category,
    subfactor: issue.subfactor,
    priority: issue.severity,
    priorityScore: issue.priority,
    finding,
    impact: tpl.whyItMatters,
    actionSteps,
    codeSnippet: '', // no placeholders
    estimatedTime: tpl.typicalTimeToFix,
    difficulty: tpl.difficulty,
    estimatedScoreGain: tpl.estimatedGain,
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: null,
    generatedBy: 'smart_template'
  };

  return coerceRecommendation(result, tpl, issue);
}

function buildSmartFinding(issue, scanEvidence) {
  const subfactor = issue.subfactor;
  const evidence = issue.evidence || {};
  const domain = extractDomain(scanEvidence.url);
  const pageTitle = scanEvidence.metadata?.title || 'this page';
  const wordCount = scanEvidence.content?.wordCount || 0;

  // Structured Data
  if (subfactor === 'structuredDataScore') {
    const found = scanEvidence.technical?.structuredData?.length || 0;
    const types = found > 0 ? scanEvidence.technical.structuredData.map(s => s.type).join(', ') : '';

    // Determine which schemas are ACTUALLY missing
    const missing = [];
    if (!scanEvidence.technical?.hasOrganizationSchema) missing.push('Organization');
    if (!scanEvidence.technical?.hasFAQSchema) missing.push('FAQ');
    if (!scanEvidence.technical?.hasLocalBusinessSchema) missing.push('LocalBusiness');
    if (!scanEvidence.technical?.hasBreadcrumbSchema) missing.push('BreadcrumbList');
    if (!scanEvidence.technical?.hasArticleSchema) missing.push('Article');

    if (!found) return `No Schema.org markup detected on ${domain}. Your ${wordCount} words of content are invisible to AI entity recognition.`;
    if (missing.length > 0) {
      return `Limited Schema.org on ${domain}. Found: ${types}. Missing: ${missing.join(', ')}. Adding these will improve AI citation accuracy.`;
    }
    return `Schema.org detected on ${domain}: ${types}. Consider enhancing with more specific schema types for your content.`;
  }

  // FAQ
  if (subfactor === 'faqScore') {
    const hasFAQSchema = scanEvidence.technical?.hasFAQSchema;
    const faqCount = scanEvidence.content?.faqs?.length || 0;
    if (!hasFAQSchema && faqCount > 0) return `Found ${faqCount} on-page FAQs on "${pageTitle}" but no FAQPage schema. Adding schema would enable AI citation of these answers.`;
    return `No FAQ content or schema on ${domain}. Your ${wordCount}-word page could be restructured into Q&A format to increase AI visibility.`;
  }

  // Alt Text
  if (subfactor === 'altTextScore' || subfactor === 'imageAltText') {
    const total = evidence.totalImages || scanEvidence.media?.imageCount || 0;
    const withAlt = evidence.imagesWithAlt || scanEvidence.media?.imagesWithAlt || 0;
    const missing = evidence.imagesWithoutAlt || scanEvidence.media?.imagesWithoutAlt || 0;
    const coverage = total > 0 ? Math.round((withAlt/total) * 100) : 0;

    // Debug logging
    console.log('[DEBUG] Alt Text Recommendation Data:', {
      total,
      withAlt,
      missing,
      coverage,
      evidenceImages: evidence.totalImages,
      scanEvidenceImages: scanEvidence.media?.imageCount
    });

    return `Alt text coverage: ${coverage}% (${withAlt}/${total} images). ${missing} images missing alt text, making them invisible to multimodal AI search.`;
  }

  // Question Headings
  if (subfactor === 'questionHeadingsScore') {
    const h2s = scanEvidence.content?.headings?.h2?.length || 0;
    const h3s = scanEvidence.content?.headings?.h3?.length || 0;
    const questions = (scanEvidence.content?.headings?.h2?.filter(h => h.endsWith('?')).length || 0) +
                      (scanEvidence.content?.headings?.h3?.filter(h => h.endsWith('?')).length || 0);
    const pct = (h2s + h3s) > 0 ? Math.round((questions / (h2s + h3s)) * 100) : 0;
    return `Only ${questions} of ${h2s + h3s} headings (${pct}%) are question-format on "${pageTitle}". Voice search queries are 75% question-based, limiting your AI discoverability.`;
  }

  // Open Graph
  if (subfactor === 'openGraphScore') {
    const missing = [];
    if (!scanEvidence.metadata?.ogTitle) missing.push('og:title');
    if (!scanEvidence.metadata?.ogDescription) missing.push('og:description');
    if (!scanEvidence.metadata?.ogImage) missing.push('og:image');
    if (!scanEvidence.metadata?.twitterCard) missing.push('twitter:card');
    if (missing.length > 0) {
      return `Open Graph incomplete on "${pageTitle}": missing ${missing.join(', ')}. When AI assistants or users share this page, it appears without proper preview.`;
    }
    return `Open Graph tags present but may need optimization (ensure 1200x630px image for best AI/social preview).`;
  }

  // Heading Hierarchy
  if (subfactor === 'headingHierarchyScore') {
    const h1Count = scanEvidence.structure?.headingCount?.h1 || 0;
    const issues = [];
    if (h1Count === 0) issues.push('Missing H1');
    if (h1Count > 1) issues.push(`${h1Count} H1s (should be exactly 1)`);
    if (issues.length > 0) {
      return `Heading hierarchy issues on "${pageTitle}": ${issues.join(', ')}. This confuses AI about your content structure and makes extracting key points harder.`;
    }
    return `Heading structure score ${issue.currentScore}/100. Better H1-H6 hierarchy will help AI understand content organization for accurate citations.`;
  }

  // Readability
  if (subfactor === 'readabilityScore') {
    return `Content readability score ${issue.currentScore}/100 on ${wordCount}-word page. AI assistants prefer 8th-10th grade reading level (Flesch 60-70) for better understanding and citation.`;
  }

  // Scannability
  if (subfactor === 'scannabilityScore') {
    const h2Count = scanEvidence.structure?.headingCount?.h2 || 0;
    const listCount = scanEvidence.content?.lists?.length || 0;
    if (h2Count < 3 && wordCount > 500) {
      return `Poor scannability: Only ${h2Count} H2 headings on ${wordCount}-word page. AI relies on headings to extract key points. Add 3-5 H2 sections.`;
    }
    if (listCount === 0 && wordCount > 500) {
      return `No bulleted/numbered lists on ${wordCount}-word page. Adding lists helps AI extract key takeaways and features.`;
    }
    return `Scannability score ${issue.currentScore}/100. More structure (headings, lists, tables) helps AI understand and cite your content.`;
  }

  // Generic fallback with context
  return `Your ${subfactor} score is ${issue.currentScore}/100 on "${pageTitle}" (target ${issue.threshold}/100). Gap: ${issue.gap} points. Improvements needed for AI visibility.`;
}

function generateContextAwareSteps(issue, scanEvidence) {
  const subfactor = issue.subfactor;
  const domain = extractDomain(scanEvidence.url);
  const wordCount = scanEvidence.content?.wordCount || 0;
  const imageCount = scanEvidence.media?.imageCount || 0;

  // Structured Data - already has programmatic generator, but fallback here
  if (subfactor === 'structuredDataScore') {
    return [
      'Open your homepage template file (e.g., index.html or header.php).',
      'Add Organization, WebSite, and WebPage JSON-LD before </head>.',
      `Validate at schema.org/validator and Google Rich Results Test.`,
      'Submit updated page to Google Search Console for indexing.'
    ];
  }

  // FAQ Schema
  if (subfactor === 'faqScore') {
    const faqCount = scanEvidence.content?.faqs?.length || 0;
    if (faqCount > 0) {
      return [
        `Your page has ${faqCount} FAQ pairs detected - add FAQPage schema to mark them up.`,
        'Copy the FAQ JSON-LD code from the CODE section below.',
        'Paste it into your page template before </head>.',
        `Match each schema Q&A to your on-page content exactly.`,
        'Validate with Google Rich Results Test.',
        'Monitor FAQ rich snippets in Search Console.'
      ];
    }
    return [
      `Identify 5-10 common questions customers ask about ${domain}.`,
      'Write comprehensive answers (100-250 words each).',
      'Add Q&A content to your page in a dedicated FAQ section.',
      'Implement FAQPage schema matching your on-page content.',
      'Validate with Rich Results Test and re-scan.'
    ];
  }

  // Alt Text
  if (subfactor === 'altTextScore' || subfactor === 'imageAltText') {
    const missing = scanEvidence.media?.imagesWithoutAlt || 0;
    return [
      `Audit all ${imageCount} images on ${domain} - ${missing} are missing alt text.`,
      'Prioritize: Hero images, product photos, infographics, team photos.',
      'Write descriptive alt text explaining what\'s shown (10-15 words).',
      'For decorative images (borders, backgrounds), use empty alt="".',
      'Update your CMS to require alt text before publishing.',
      'Re-run scan to verify 90%+ coverage.'
    ];
  }

  // Question Headings
  if (subfactor === 'questionHeadingsScore') {
    const h2Count = scanEvidence.structure?.headingCount?.h2 || 0;
    return [
      `Audit your ${h2Count} H2/H3 headings - rewrite 30-50% as natural questions.`,
      'Use questions users actually search: check Google autocomplete.',
      'Start with: Who, What, When, Where, Why, How.',
      'Example: Change "Our Services" to "What services does ${domain} offer?"',
      'Place questions as H2 headings with answers in following paragraphs.',
      'Test voice search: read headings aloud to verify they sound natural.'
    ];
  }

  // Open Graph Tags
  if (subfactor === 'openGraphScore') {
    return [
      'Open your site\'s <head> template file.',
      'Add the Open Graph meta tags from the CODE section below.',
      'Create a 1200x630px image for og:image (JPG or PNG).',
      'Ensure og:description is compelling (155-160 characters).',
      'Validate with Facebook Sharing Debugger and Twitter Card Validator.',
      'Re-scan to verify all tags are detected.'
    ];
  }

  // Heading Hierarchy
  if (subfactor === 'headingHierarchyScore') {
    const h1Count = scanEvidence.structure?.headingCount?.h1 || 0;
    if (h1Count === 0 || h1Count > 1) {
      return [
        h1Count === 0 ? 'Add exactly ONE H1 tag to your page with your primary keyword/topic.' : `Reduce from ${h1Count} H1 tags to exactly 1 (merge or change extras to H2).`,
        'Structure content: H1 → H2 for main sections → H3 for subsections.',
        'Never skip levels (don\'t go H1 → H3 directly).',
        'Make headings descriptive: "How We Help" not "Section 1".',
        'Use a heading hierarchy analyzer to visualize structure.',
        'Re-scan to verify structure score improves.'
      ];
    }
    return [
      'Ensure you have exactly ONE H1 tag per page.',
      'Use 3-5 H2 tags for main sections.',
      'Use H3 tags for subsections under each H2.',
      'Never skip heading levels (H1 → H2 → H3, not H1 → H3).',
      'Make headings scannable and descriptive for AI parsing.'
    ];
  }

  // Readability
  if (subfactor === 'readabilityScore') {
    return [
      `Review your ${wordCount}-word page for complex sentences and jargon.`,
      'Target reading level: 8th-10th grade (Flesch score 60-70).',
      'Break long sentences (aim for 15-20 words per sentence).',
      'Use active voice: "We analyze data" not "Data is analyzed by us".',
      'Define technical terms or link to glossary.',
      'Use tools like Hemingway Editor or readable.com to check score.',
      'Re-scan to verify improved readability.'
    ];
  }

  // Scannability
  if (subfactor === 'scannabilityScore') {
    const h2Count = scanEvidence.structure?.headingCount?.h2 || 0;
    const recommended = Math.max(3, Math.round(wordCount / 300));
    return [
      `Add ${Math.max(0, recommended - h2Count)} more H2 headings to break up ${wordCount} words.`,
      'Convert paragraphs into bulleted lists where appropriate (features, benefits, steps).',
      'Use numbered lists for sequential instructions or processes.',
      'Add bold/italic for emphasis on key points.',
      'Keep paragraphs short: 50-100 words maximum.',
      'Re-scan to verify scannability score improves.'
    ];
  }

  // Sitemap
  if (subfactor === 'sitemapScore') {
    return [
      'Generate XML sitemap using your CMS plugin or sitemap generator tool.',
      'Include all important pages with priority (0.0-1.0) and changefreq.',
      'Add lastmod dates to show content freshness.',
      'Upload sitemap to /sitemap.xml on your root domain.',
      'Submit sitemap URL to Google Search Console and Bing Webmaster Tools.',
      'Set up automatic updates when you publish new content.'
    ];
  }

  // Crawler Access
  if (subfactor === 'crawlerAccessScore') {
    return [
      'Check robots.txt - ensure it\'s not blocking important pages.',
      'Review meta robots tags - remove "noindex" from pages you want indexed.',
      'Test with Google Search Console URL Inspection tool.',
      'Ensure canonical tags point to correct URLs.',
      'Link your XML sitemap in robots.txt: "Sitemap: https://' + domain + '/sitemap.xml"',
      'Monitor crawl stats in Search Console for errors.'
    ];
  }

  // Pillar Pages - comprehensive topic coverage
  if (subfactor === 'pillarPagesScore') {
    const h2Count = scanEvidence.content?.headings?.h2?.length || 0;
    const listCount = scanEvidence.content?.lists?.length || 0;
    const currentWords = scanEvidence.content?.wordCount || 0;
    const wordGap = Math.max(0, 1500 - currentWords);

    return [
      currentWords < 1500
        ? `Expand your content from ${currentWords} to at least 1,500 words (add ~${wordGap} more words).`
        : `Your page has ${currentWords} words which is good - focus on structure improvements.`,
      h2Count < 5
        ? `Add more H2 section headings - you have ${h2Count}, aim for at least 5 to organize comprehensive coverage.`
        : `Good heading structure with ${h2Count} H2s - ensure each covers a distinct subtopic.`,
      listCount < 3
        ? `Add more bulleted or numbered lists - you have ${listCount}, aim for at least 3 for scannability.`
        : `Good list usage with ${listCount} lists - ensure they summarize key points.`,
      'Use semantic HTML5 elements like <main> and <article> to wrap your content.',
      'Link to related subtopic pages to build a topic cluster architecture.',
      'Re-scan to verify your pillar page score improves above 60.'
    ];
  }

  // Snippet Format - voice-friendly content formatting
  if (subfactor === 'snippetFormatScore') {
    const listCount = scanEvidence.content?.lists?.length || 0;
    const tableCount = scanEvidence.content?.tables?.length || 0;
    const paragraphs = scanEvidence.content?.paragraphs || [];

    return [
      'Add concise answer paragraphs (40-60 words) that directly answer common questions.',
      listCount < 3
        ? `Add more bulleted lists - you have ${listCount}, aim for 3+ with 5-8 items each for snippet eligibility.`
        : `Good list count (${listCount}) - ensure lists are well-formatted with clear, concise items.`,
      tableCount < 1
        ? 'Add a comparison table or data table - tables are highly snippet-eligible and easy for AI to parse.'
        : `Good table usage (${tableCount}) - ensure tables have clear headers and structured data.`,
      'Format step-by-step instructions as numbered lists (1, 2, 3...).',
      'Create FAQ sections with short, direct answers (40-60 words per answer).',
      'Use definition patterns: "X is [definition]" format for key terms.',
      'Re-scan to verify your snippet format score improves above 70.'
    ];
  }

  // Videos/Captions
  if (subfactor === 'captionsTranscriptsScore' || subfactor === 'videoTranscripts') {
    const videoCount = scanEvidence.media?.videoCount || 0;
    if (videoCount > 0) {
      return [
        `Audit your ${videoCount} videos - add captions and transcripts to each.`,
        'Use YouTube/Vimeo auto-captioning as starting point, then edit for accuracy.',
        'Ensure product names, brand terms, and technical terms are spelled correctly.',
        'Add full transcript below each video on the page.',
        'Include speaker names and timestamps for multi-speaker content.',
        'Add download link for transcript PDF.',
        'Re-scan to verify transcripts are detected.'
      ];
    }
    return [
      'If you have video content, ensure all videos have captions enabled.',
      'Add full text transcripts below each video.',
      'Use auto-captioning tools as starting point, then edit for accuracy.',
      'Include transcripts in your sitemap for SEO.',
      'Re-scan after adding transcripts.'
    ];
  }

  // Generic fallback - make it user-friendly with no internal variable names
  // Convert subfactor to readable format (e.g., "pillarPagesScore" -> "pillar pages")
  const readableSubfactor = subfactor
    .replace(/Score$/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase();

  return [
    `Review the specific findings above to understand what needs improvement on ${domain}.`,
    `Check your page content and structure against the AI optimization best practices for ${readableSubfactor}.`,
    'Make the recommended changes to improve your content format and structure.',
    'Use online validators and analyzers to verify your technical implementation.',
    'Re-run the scan to confirm your score has improved.',
    'Monitor your AI visibility metrics over 2-4 weeks to measure impact.'
  ];
}

// -----------------------------------------
// Shared utilities (patched)
// -----------------------------------------

function escapeHtml(s='') {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// --- TEXT SANITIZER: escape HTML in user-visible text (not in code) ---
function escapeAngleBrackets(s = '') {
  return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeStepText(s = '') {
  // 1) escape angle brackets so UI doesn't strip them
  let out = escapeAngleBrackets(s);
  // 2) collapse stray backticks-only artifacts (```/` blocks that got split)
  out = out.replace(/^\s*`+\s*$/g, '').replace(/\s*`+\s*/g, '`');
  // 3) trim
  return out.trim();
}

function sanitizeSteps(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map(sanitizeStepText)
    .filter(Boolean);
}

function stripCodeFences(code) {
  if (!code) return '';
  // Remove markdown code fences (```language and closing ```)
  return code.replace(/^```\w*\n?/gm, '').replace(/\n?```$/gm, '').trim();
}

// PATCH A1 — robust section parsing
function extractSection(response, sectionName) {
  const text = String(response || '');

  // 1) Strict [SECTION] ... [NEXT]
  const strict = new RegExp(
    `\\[${sectionName}\\]\\s*([\\s\\S]*?)(?=\\n\\s*\\[|$)`,
    'i'
  );
  const m1 = text.match(strict);
  if (m1) return m1[1].trim();

  // 2) Tolerant headings like ## FINDING or **FINDING**
  const tolerant = new RegExp(
    `^(?:#{1,3}\\s*|\\*\\*\\s*)${sectionName}(?:\\s*\\*\\*|\\s*)\\s*([\\s\\S]*?)(?=^\\s*(?:#{1,3}\\s*|\\*\\*\\s*)[A-Z]|$)`,
    'im'
  );
  const m2 = text.match(tolerant);
  return m2 ? m2[1].trim() : '';
}

// PATCH A2 — safer step extraction
function extractActionSteps(response) {
  const section = extractSection(response, 'APPLY INSTRUCTIONS') || extractSection(response, 'ACTION STEPS');
  if (!section) {
    console.log('❌ No APPLY INSTRUCTIONS section found!');
    return [];
  }

  console.log('📋 SECTION FOUND (first 600 chars):', section.slice(0, 600));
  
  const lines = section.split('\n');
  const steps = [];
  
  console.log('📋 Total lines to process:', lines.length);
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;
    
    console.log(`  Line ${i}: "${line.slice(0, 80)}"`);
    
    // Match numbered steps: "1.", "2.", etc.
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      console.log(`    ✓ MATCHED: "${numberedMatch[2].slice(0, 60)}"`);
      steps.push(numberedMatch[2].trim());
    }
  }
  
  console.log('📋 EXTRACTED STEPS:', steps);
  return steps.filter(s => s.length >= 10);
}
// Helper for length safety
function clamp(str, max) {
  const s = String(str || '');
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// PATCH B — coerce/guard final recommendation
function coerceRecommendation(rec, template, issue) {
  // Ensure non-empty sections
  if (!rec.finding || rec.finding.length < 20) {
    rec.finding = `Your ${issue.subfactor} score is ${issue.currentScore}/100; improvements are needed to reach ${issue.threshold}/100.`;
  }
  if (!rec.impact || rec.impact.length < 20) {
    rec.impact = template.whyItMatters || 'Improving this helps AI assistants like ChatGPT and Google understand your business better, making them more likely to recommend you to potential customers.';
  }
  if (!Array.isArray(rec.actionSteps) || rec.actionSteps.length === 0) {
    rec.actionSteps = [
      `Open the relevant template/page for ${issue.subfactor}.`,
      'Apply the code/content changes below.',
      'Validate with the recommended validator and re-scan.'
    ];
  }
  if (typeof rec.codeSnippet !== 'string') rec.codeSnippet = '';

  // Length guards (tune to your DB column sizes)
  rec.finding     = clamp(rec.finding,     1500);
  rec.impact      = clamp(rec.impact,      2200);
  rec.codeSnippet = clamp(rec.codeSnippet, 20000);
  rec.actionSteps = rec.actionSteps.map(s => clamp(s, 600)).slice(0, 12);

  return rec;
}

// parse GPT response to our object (then coerced by caller)
function structureRecommendation(aiResponse, issue, template, tier, source) {
  // Debug (first 400 chars)
  if (process.env.NODE_ENV !== 'production') {
    console.log('\n--- FULL GPT RESPONSE ---\n', aiResponse, '\n----------------------\n');
  }

  // 🔍 EXTRACTION DEBUG
  const rawSteps = extractActionSteps(aiResponse);
  const rawCode = extractSection(aiResponse, 'PRE-FILLED JSON-LD') || extractSection(aiResponse, 'CODE');
  
  console.log('🔍 EXTRACTION DEBUG:');
  console.log('  Raw steps found:', rawSteps?.length, 'steps');
  console.log('  Raw code found:', rawCode?.length, 'chars');
  console.log('  First step:', rawSteps?.[0]?.slice(0, 100));

  // Extract title from ChatGPT response (fallback to template title)
  const extractedTitle = extractSection(aiResponse, 'TITLE');
  const title = extractedTitle ? extractedTitle.trim().replace(/^-\s*/, '') : template.title;

  return {
    id: `rec_${issue.category}_${issue.subfactor}_${Date.now()}`,
    title: title,
    category: issue.category,
    subfactor: issue.subfactor,
    priority: issue.severity,
    priorityScore: issue.priority,
    finding: escapeAngleBrackets(extractSection(aiResponse, 'FINDING') || ''),
    impact: escapeAngleBrackets(extractSection(aiResponse, 'IMPACT') || extractSection(aiResponse, 'IMPACT BREAKDOWN') || ''),
actionSteps: sanitizeSteps(extractActionSteps(aiResponse)),
    codeSnippet: tier !== 'free'
  ? stripCodeFences(extractSection(aiResponse, 'PRE-FILLED JSON-LD') || extractSection(aiResponse, 'CODE') || '')
  : '',
    estimatedTime: template.typicalTimeToFix,
    difficulty: template.difficulty,
    estimatedScoreGain: template.estimatedGain,
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: tier !== 'free' ? issue.evidence : null,
    generatedBy: source
  };
}

function buildSiteShapeDescription(profile) {
  const typeDesc = {
    single_page: 'Single-page site with in-page navigation',
    small_multi: 'Small multi-page site (≤10 pages)',
    multi: 'Multi-page website',
    blog: 'Blog or news site',
    saas: 'SaaS/Product site',
    local_business: 'Local business site'
  };
  const lines = [
    `- Type: ${typeDesc[profile.site_type] || profile.site_type}`,
    `- Pages scanned: ${profile.routes_count}`
  ];
  if (profile.anchors?.length) lines.push(`- In-page anchors: ${profile.anchors.join(', ')}`);

  const s = profile.sections || {};
  const has = [];
  if (s.has_faq) has.push('FAQ');
  if (s.has_pricing) has.push('Pricing');
  if (s.has_contact) has.push('Contact');
  if (s.has_blog) has.push('Blog');
  if (has.length) lines.push(`- Has: ${has.join(', ')} sections`);

  const missing = [];
  if (!s.has_faq) missing.push('FAQ');
  if (!s.has_blog && profile.site_type !== 'blog') missing.push('Blog');
  if (missing.length) lines.push(`- Missing: ${missing.join(', ')} sections`);

  return lines.join('\n');
}

function buildFactsSection(facts) {
  if (!facts?.length) return '- No facts extracted (site may be behind auth or empty).';

  // Prioritize important facts for ChatGPT context
  const priorityOrder = ['brand', 'site_name', 'logo', 'description', 'tagline', 'services', 'products', 'features', 'audiences', 'contact_email', 'contact_phone', 'address', 'social_links'];
  const prioritized = [];
  const rest = [];

  for (const f of facts) {
    if (priorityOrder.includes(f.name)) {
      prioritized.push(f);
    } else {
      rest.push(f);
    }
  }

  // Sort prioritized by the order defined above
  prioritized.sort((a, b) => priorityOrder.indexOf(a.name) - priorityOrder.indexOf(b.name));

  // Format with smart truncation and visual hierarchy
  const formatFact = (f) => {
    let val = f.value;

    // Smart formatting by type
    if (Array.isArray(val)) {
      if (val.length > 5) {
        val = val.slice(0, 5).join(', ') + ` (+${val.length - 5} more)`;
      } else {
        val = val.join(', ');
      }
    } else if (typeof val === 'string') {
      if (val.length > 150) {
        val = val.slice(0, 150) + '…';
      }
    }

    const parts = [`• ${f.name}: ${val}`];
    if (f.confidence && f.confidence < 0.8) parts.push(`[${Math.round(f.confidence * 100)}% confidence]`);
    return parts.join(' ');
  };

  const lines = [
    '**KEY IDENTIFIERS:**',
    ...prioritized.slice(0, 8).map(formatFact)
  ];

  if (rest.length > 0) {
    lines.push('\n**ADDITIONAL CONTEXT:**');
    lines.push(...rest.slice(0, 10).map(formatFact));
  }

  return lines.join('\n');
}

function buildCurrentState(issue, scanEvidence) {
  const sub = issue.subfactor;
  const ev = issue.evidence || {};
  const meta = scanEvidence.metadata || {};
  const content = scanEvidence.content || {};
  const tech = scanEvidence.technical || {};
  const struct = scanEvidence.structure || {};

  // Structured Data
  if (sub === 'structuredDataScore') {
    const found = tech.structuredData || [];
    const types = found.map(s => s.type).join(', ') || 'None';

    // Determine which schemas are ACTUALLY missing
    const missing = [];
    if (!tech.hasOrganizationSchema) missing.push('Organization');
    if (!tech.hasFAQSchema) missing.push('FAQ');
    if (!tech.hasLocalBusinessSchema) missing.push('LocalBusiness');
    if (!tech.hasBreadcrumbSchema) missing.push('BreadcrumbList');
    if (!tech.hasArticleSchema) missing.push('Article/BlogPosting');

    if (!found.length) {
      return `- No Schema.org detected\n- Missing: ${missing.join(', ')}\n- Page word count: ${content.wordCount || 0}`;
    }
    return `- Found ${found.length} Schema.org block(s): ${types}\n- Missing: ${missing.length > 0 ? missing.join(', ') : 'None - good coverage!'}\n- Page word count: ${content.wordCount || 0}`;
  }

  // FAQ
  if (sub === 'faqScore') {
    const hasFAQSchema = tech.hasFAQSchema;
    const faqCount = content.faqs?.length || 0;
    const questionHeadings = content.headings?.h2?.filter(h => h.endsWith('?')).length || 0;
    if (!hasFAQSchema && faqCount > 0) {
      return `- Detected ${faqCount} on-page FAQs without schema\n- ${questionHeadings} question-format headings found\n- Adding FAQ schema will enable AI citation`;
    }
    if (questionHeadings > 0) {
      return `- ${questionHeadings} question headings found but no FAQ content\n- Expand headings into Q&A pairs with 100-200 word answers`;
    }
    return `- No FAQ content or schema detected\n- ${content.wordCount || 0} words of content could be restructured as Q&A`;
  }

  // Alt Text / Images
  if (sub === 'altTextScore' || sub === 'imageAltText') {
    const total = ev.totalImages || scanEvidence.media?.imageCount || 0;
    const withAlt = ev.imagesWithAlt || scanEvidence.media?.imagesWithAlt || 0;
    const missing = ev.imagesWithoutAlt || scanEvidence.media?.imagesWithoutAlt || 0;
    const coverage = total > 0 ? Math.round((withAlt / total) * 100) : 0;
    return `- Images: ${total} total, ${withAlt} with alt (${coverage}% coverage), ${missing} missing\n- Priority: Hero images, product photos, infographics\n- Decorative images should use empty alt=""`;
  }

  // Question Headings
  if (sub === 'questionHeadingsScore') {
    const h2Count = content.headings?.h2?.length || 0;
    const h3Count = content.headings?.h3?.length || 0;
    const questionH2 = content.headings?.h2?.filter(h => h.endsWith('?')).length || 0;
    const questionH3 = content.headings?.h3?.filter(h => h.endsWith('?')).length || 0;
    const totalQuestions = questionH2 + questionH3;
    return `- Total headings: ${h2Count} H2s, ${h3Count} H3s\n- Question-format headings: ${totalQuestions} (${h2Count + h3Count > 0 ? Math.round((totalQuestions / (h2Count + h3Count)) * 100) : 0}%)\n- Target: 30-50% of headings should be questions`;
  }

  // Open Graph
  if (sub === 'openGraphScore') {
    const hasTitle = !!meta.ogTitle;
    const hasDesc = !!meta.ogDescription;
    const hasImage = !!meta.ogImage;
    const hasTwitter = !!meta.twitterCard;
    const missing = [];
    if (!hasTitle) missing.push('og:title');
    if (!hasDesc) missing.push('og:description');
    if (!hasImage) missing.push('og:image');
    if (!hasTwitter) missing.push('twitter:card');
    if (missing.length) {
      return `- Open Graph incomplete: missing ${missing.join(', ')}\n- Current: ${hasTitle ? '✓' : '✗'} title, ${hasDesc ? '✓' : '✗'} description, ${hasImage ? '✓' : '✗'} image, ${hasTwitter ? '✓' : '✗'} twitter`;
    }
    return `- Open Graph tags present but may need optimization\n- Ensure og:image is 1200x630px for best preview`;
  }

  // Heading Hierarchy
  if (sub === 'headingHierarchyScore') {
    const h1Count = struct.headingCount?.h1 || 0;
    const h2Count = struct.headingCount?.h2 || 0;
    const h3Count = struct.headingCount?.h3 || 0;
    const issues = [];
    if (h1Count === 0) issues.push('Missing H1');
    if (h1Count > 1) issues.push(`${h1Count} H1s (should be 1)`);
    if (h2Count === 0 && content.wordCount > 300) issues.push('No H2 sections');
    return `- Heading structure: ${h1Count} H1, ${h2Count} H2, ${h3Count} H3\n${issues.length ? `- Issues: ${issues.join(', ')}\n` : ''}- Content length: ${content.wordCount || 0} words`;
  }

  // Internal Linking
  if (sub === 'linkedSubpagesScore' || sub === 'internalLinking') {
    const internal = struct.internalLinks || 0;
    const hasBreadcrumbs = struct.hasBreadcrumbs;
    const hasTOC = struct.hasTOC;
    return `- Internal links: ${internal}\n- Breadcrumbs: ${hasBreadcrumbs ? 'Present' : 'Missing'}\n- Table of contents: ${hasTOC ? 'Present' : 'Missing'}\n- Recommended: ${Math.max(10, Math.round(content.wordCount / 150))} links for ${content.wordCount} words`;
  }

  // Readability
  if (sub === 'readabilityScore') {
    const wordCount = content.wordCount || 0;
    const paragraphs = content.paragraphs?.length || 0;
    const avgWordsPerPara = paragraphs > 0 ? Math.round(wordCount / paragraphs) : 0;
    return `- Content: ${wordCount} words in ${paragraphs} paragraphs\n- Average paragraph length: ${avgWordsPerPara} words\n- Target: 50-100 words per paragraph for AI readability\n- Flesch score target: 60-70 (8th-10th grade level)`;
  }

  // Scannability
  if (sub === 'scannabilityScore') {
    const h2Count = struct.headingCount?.h2 || 0;
    const listCount = content.lists?.length || 0;
    const wordCount = content.wordCount || 0;
    return `- Content: ${wordCount} words\n- Structure: ${h2Count} H2 headings, ${listCount} lists\n- Recommended: ${Math.max(3, Math.round(wordCount / 300))} H2 headings for ${wordCount} words\n- Add: Bulleted lists for features/benefits, numbered lists for steps`;
  }

  // Sitemap
  if (sub === 'sitemapScore') {
    const hasSitemap = tech.hasSitemapLink;
    const hasRobots = !!tech.robotsMeta;
    return `- XML Sitemap: ${hasSitemap ? 'Detected' : 'Not found'}\n- Robots.txt: ${hasRobots ? 'Present' : 'Missing'}\n${hasSitemap ? '- Ensure sitemap submitted to Google Search Console' : '- Create sitemap at /sitemap.xml'}`;
  }

  // Crawler Access
  if (sub === 'crawlerAccessScore') {
    const hasRobots = !!tech.robotsMeta;
    const hasCanonical = tech.hasCanonical;
    const hasSitemap = tech.hasSitemapLink;
    return `- Robots meta: ${hasRobots ? tech.robotsMeta : 'Not set'}\n- Canonical tag: ${hasCanonical ? 'Present' : 'Missing'}\n- Sitemap: ${hasSitemap ? 'Linked' : 'Not linked'}\n- Ensure no accidental blocking of AI crawlers`;
  }

  // Videos/Captions
  if (sub === 'captionsTranscriptsScore' || sub === 'videoTranscripts') {
    const videoCount = scanEvidence.media?.videoCount || 0;
    if (videoCount > 0) {
      return `- Videos detected: ${videoCount}\n- Transcripts: Not detected\n- Adding transcripts makes ${videoCount} videos searchable and quotable by AI`;
    }
    return `- No video content detected\n- If you have videos, ensure they have captions and full transcripts`;
  }

  // Professional Certifications
  if (sub === 'professionalCertifications') {
    const certData = scanEvidence.certificationData;
    if (certData && certData.libraryLoaded) {
      const detectedNames = certData.detected.map(c => c.name).join(', ') || 'None';
      const missingCritical = certData.missing.filter(c => c.priority === 'critical').map(c => c.name);
      const missingImportant = certData.missing.filter(c => c.priority === 'important').map(c => c.name);

      let state = `- Industry: ${certData.industry}\n`;
      state += `- Certifications detected: ${certData.detected.length > 0 ? detectedNames : 'None'}\n`;
      state += `- Coverage: ${certData.overallCoverage}%\n`;

      if (missingCritical.length > 0) {
        state += `- Missing CRITICAL certifications (${missingCritical.length}): ${missingCritical.slice(0, 3).join(', ')}${missingCritical.length > 3 ? ` and ${missingCritical.length - 3} more` : ''}\n`;
      }
      if (missingImportant.length > 0) {
        state += `- Missing IMPORTANT certifications (${missingImportant.length}): ${missingImportant.slice(0, 3).join(', ')}${missingImportant.length > 3 ? ` and ${missingImportant.length - 3} more` : ''}\n`;
      }

      state += `\n**CRITICAL INSTRUCTION**: Use the ACTUAL missing certifications listed above in your recommendation. DO NOT use generic placeholders like "Certified Digital Marketing Professional". Focus on the top 1-2 missing certifications from the lists above.`;
      return state;
    }
    return `- No certification schema detected\n- No industry-specific certification data available\n- Add certification badges and schema markup to establish trust`;
  }

  // Team Credentials
  if (sub === 'teamCredentials') {
    const certData = scanEvidence.certificationData;
    if (certData && certData.libraryLoaded) {
      const teamCerts = certData.missing.filter(c => c.recommendation?.impact_areas?.includes('Team Expertise'));
      if (teamCerts.length > 0) {
        const certNames = teamCerts.slice(0, 5).map(c => c.name).join(', ');
        return `- Industry: ${certData.industry}\n- Recommended team certifications: ${certNames}\n- No Person schema detected for team members\n\n**CRITICAL INSTRUCTION**: Use the actual certifications listed above (${certNames}) in your recommendation, not generic placeholders.`;
      }
    }
    return `- No Person schema detected for team members\n- No team credentials documented\n- Add Person schema with hasCredential properties`;
  }

  // Industry Memberships
  if (sub === 'industryMemberships') {
    const certData = scanEvidence.certificationData;
    if (certData && certData.libraryLoaded) {
      const memberships = certData.missing.filter(c => c.recommendation?.category === 'association');
      if (memberships.length > 0) {
        const membershipNames = memberships.slice(0, 5).map(c => c.name).join(', ');
        return `- Industry: ${certData.industry}\n- Recommended memberships: ${membershipNames}\n- No Organization.memberOf schema detected\n\n**CRITICAL INSTRUCTION**: Use the actual industry memberships listed above (${membershipNames}) in your recommendation, not generic placeholders.`;
      }
    }
    return `- No Organization.memberOf schema detected\n- No industry memberships documented\n- Add memberOf properties to Organization schema`;
  }

  // Generic fallback with more context
  return `- Current score: ${issue.currentScore}/100 (target: ${issue.threshold}/100)\n- Gap: ${issue.gap} points\n- Page word count: ${content.wordCount || 0}\n- Improvement needed for AI visibility`;
}

function calculateScoreBreakdown(issue) {
  const gap = Math.max(0, issue.gap || (issue.threshold - issue.currentScore) || 0);
  const maxGain = Math.min(Math.round(gap * 0.85), 40);
  const coverage = Math.round(maxGain * 0.4);
  const completeness = Math.round(maxGain * 0.3);
  const consistency = Math.round(maxGain * 0.2);
  const crawlability = maxGain - (coverage + completeness + consistency);
  return {
    min: Math.max(8, Math.round(maxGain * 0.6)),
    max: maxGain,
    coverage: `+${coverage} pts (missing types)`,
    completeness: `+${completeness} pts (empty fields)`,
    consistency: `+${consistency} pts (duplicates/conflicts)`,
    crawlability: `+${crawlability} pts (placement/URLs)`
  };
}

function determineNeededSchemas(issue, profile, scanEvidence) {
  const schemas = [];
  if (issue.subfactor === 'structuredDataScore') {
    const existing = (scanEvidence.technical?.structuredData || []).map(s => s.type);
    const hasOrganization = scanEvidence.technical?.hasOrganizationSchema || existing.includes('Organization');
    const hasLocalBusiness = scanEvidence.technical?.hasLocalBusinessSchema || existing.includes('LocalBusiness');
    const hasFAQ = scanEvidence.technical?.hasFAQSchema || existing.includes('FAQPage');
    const hasArticle = scanEvidence.technical?.hasArticleSchema || existing.includes('Article') || existing.includes('BlogPosting');
    const hasBreadcrumb = scanEvidence.technical?.hasBreadcrumbSchema || existing.includes('BreadcrumbList');

    // Only recommend schemas that are MISSING
    if (!hasOrganization) {
      schemas.push({ type: 'Organization', useData: 'brand, logo, sameAs, address, contact' });
    }
    if (!existing.includes('WebSite')) {
      schemas.push({ type: 'WebSite', useData: 'url, name, publisher→Organization' });
    }
    if (profile.site_type === 'local_business' && !hasLocalBusiness) {
      schemas.push({ type: 'LocalBusiness', useData: 'address, phone, opening hours, geo coordinates' });
    }
    if (profile.site_type === 'saas' && !existing.includes('SoftwareApplication')) {
      schemas.push({ type: 'SoftwareApplication', useData: 'name, description, offers (optional)' });
    }
    if (!hasFAQ && profile.sections?.has_faq) {
      schemas.push({ type: 'FAQPage', useData: 'on-page Q/A pairs' });
    }
    if (!hasBreadcrumb && profile.site_type !== 'simple_site') {
      schemas.push({ type: 'BreadcrumbList', useData: 'navigation hierarchy' });
    }
  }
  if (issue.subfactor === 'faqSchemaScore' || issue.subfactor === 'faqContentScore') {
    const hasFAQ = scanEvidence.technical?.hasFAQSchema;
    if (!hasFAQ) {
      schemas.push({ type: 'FAQPage', useData: 'on-page Q/A pairs' });
    }
  }
  return schemas;
}

// -----------------------------------------
// Exports
// -----------------------------------------

module.exports = {
  generateRecommendations
};
