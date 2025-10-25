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

// ✅ FAQ library + customizer (present but optional right now)
// (You can wire these into faqScore later to make it fully programmatic)
const { loadFaqsByIndustry, loadGenericFaqs } = require('./faq-library-loader');
const { customizeFaqItem } = require('./faq-customizer');

// -----------------------------------------
// Inline helpers (no external file imports)
// -----------------------------------------

const SITE_TYPES = new Set(['single_page','small_multi','multi','blog','saas','local_business']);

function normalizeEvidence(raw = {}) {
  const profileRaw = raw.detected_profile || raw.profile || {};
  const factsRaw = raw.extracted_facts || raw.facts || [];

  const profile = {
    site_type: SITE_TYPES.has(profileRaw.site_type) ? profileRaw.site_type : 'small_multi',
    routes_count: Number(profileRaw.routes_count || 1),
    anchors: Array.isArray(profileRaw.anchors) ? profileRaw.anchors : [],
    sections: typeof profileRaw.sections === 'object' && profileRaw.sections !== null ? profileRaw.sections : {}
  };

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

const RECOMMENDATION_TEMPLATES = {
  structuredDataScore: {
    title: "Implement Structured Data Schema",
    impactArea: "AI Understanding & Rich Results",
    whyItMatters: "Structured data tells AI assistants exactly what your content is about, increasing citation chances by 3–5x.",
    typicalTimeToFix: "1–2 hours",
    difficulty: "Easy",
    estimatedGain: 18
  },
  faqScore: {
    title: "Add FAQ Schema Markup",
    impactArea: "Voice Search & Featured Snippets",
    whyItMatters: "FAQ schema helps your answers surface in AI-generated results and voice search.",
    typicalTimeToFix: "1–2 hours",
    difficulty: "Easy",
    estimatedGain: 12
  },
  altTextScore: {
    title: "Complete Image Alt Text Coverage",
    impactArea: "Multimodal AI & Accessibility",
    whyItMatters: "Alt text enables AI to understand and reference your images in multimodal search.",
    typicalTimeToFix: "1–2 hours",
    difficulty: "Easy",
    estimatedGain: 8
  },
  openGraphScore: {
    title: "Add Open Graph & Twitter Card meta tags",
    impactArea: "Social Sharing & Entity Cards",
    whyItMatters: "Ensures rich previews across social/AI surfaces and better CTR from shares.",
    typicalTimeToFix: "15–30 minutes",
    difficulty: "Easy",
    estimatedGain: 8
  }
};

// -----------------------------------------
// Public entry
// -----------------------------------------

async function generateRecommendations(issues, scanEvidence, tier = 'free', industry = null) {
  console.log(`   🎯 Generating recommendations for ${issues?.length || 0} issues (tier=${tier})`);
  if (!Array.isArray(issues) || !issues.length) return [];

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

      // 2a) Programmatic JSON-LD for structured data
      if (issue.subfactor === 'structuredDataScore') {
        const rec = makeProgrammaticStructuredDataRecommendation(issue, scanEvidence);
        out.push(rec);
        continue;
      }

      // 2b) Programmatic Question Headings
      if (issue.subfactor === 'questionHeadingsScore') {
        const rec = makeProgrammaticQuestionHeadingsRecommendation(issue, scanEvidence);
        if (rec) { out.push(rec); continue; }
      }

      // 2c) Programmatic Open Graph meta tags
      if (issue.subfactor === 'openGraphScore') {
        const rec = makeProgrammaticOpenGraphRecommendation(issue, scanEvidence);
        if (rec) { out.push(rec); continue; }
      }

      // 3) ChatGPT (DIY/Pro only)
      if (tier !== 'free' && process.env.OPENAI_API_KEY) {
        const gptRec = await generateWithChatGPT(issue, scanEvidence, tier, industry);
        out.push(gptRec);
        continue;
      }

      // 4) Smart template fallback
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

async function generateWithChatGPT(issue, scanEvidence, tier, industry) {
  const template = RECOMMENDATION_TEMPLATES[issue.subfactor] || {
    title: `Improve ${issue.subfactor}`,
    impactArea: issue.category,
    whyItMatters: "This affects your AI visibility.",
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

  return `You are an AI Search Optimization expert generating PRESCRIPTIVE, ready-to-implement recommendations.

**WEBSITE ANALYSIS**
URL: ${scanEvidence.url}
Industry: ${industry || 'General'}
Issue: ${issue.subfactor} (${issue.currentScore}/100)

**SITE SHAPE DETECTED**
${siteShape}

**EXTRACTED FACTS**
${factsSection}

**CURRENT STATE**
${buildCurrentState(issue, scanEvidence)}

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

[FINDING]
- 2 sentences, tied to the extracted facts and current state.

[IMPACT BREAKDOWN]
- Coverage, Completeness, Consistency, Crawlability: each explained with specifics.

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
- Do NOT include placeholders. If data is missing, omit that field.
- Use stable @ids like ${scanEvidence.url}/#organization
- Link schemas (Organization → logo, WebSite → publisher)
- Required schemas:
${neededSchemas.map((s, i) => `${i + 1}. ${s.type} — use: ${s.useData}`).join('\n')}
` : ''}

[CODE]
- If any code is required (HTML/JSON-LD/meta tags), include ONLY here.
- Use the smallest working snippet.

[QUICK WINS]
- 2 or 3 actionable wins based on detected profile/sections.

Output ONLY the following sections in this exact order, each starting on its own line:

[FINDING]
[IMPACT BREAKDOWN]
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

  // A tiny seed library by vertical; extend as you wish.
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
      `What’s the ROI of ${brand}?`,
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
      `What’s the best way to deploy multi-model routing?`
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

  const base =
    industryId?.includes('ai_infrastructure') ? SEEDS.ai_infrastructure :
    industryId?.includes('saas') ? SEEDS.saas :
    SEEDS.generic;

  return pickUnique([...base, ...topicQs], 12);
}

function makeProgrammaticQuestionHeadingsRecommendation(issue, scanEvidence) {
  const { profile, facts } = normalizeEvidence(scanEvidence);
  const industryId = (scanEvidence?.industry_id || scanEvidence?.industry || '')
    .toString().trim().toLowerCase();
  const domain = extractDomain(scanEvidence.url);

  const headings = proposeQuestionHeadings(industryId, facts);
  if (!headings.length) return null;

  const htmlBlock =
`<!-- Question-based headings block -->
<section id="qa-topics" class="container">
  <h2>Questions we answer</h2>
${headings.map(h => `  <h3>${h}</h3>\n  <p><!-- Write an 80–200 word clear, scannable answer here. --></p>`).join('\n')}
</section>`;

  return {
    id: `rec_${issue.category}_${issue.subfactor}_${Date.now()}`,
    title: "Add question-based H2/H3 headings across key sections",
    category: issue.category,
    subfactor: "questionHeadingsScore",
    priority: issue.severity || 'medium',
    priorityScore: issue.priority || 70,
    finding: `Question-format headings (H2/H3 ending with “?”) are sparse or missing on ${domain}, limiting AI/voice snippet eligibility.`,
    impact: "Aligns page copy with how users query AI/search, improves passage extraction and featured answers.",
    actionSteps: [
      "Open your homepage or main landing template (e.g., `index.html`).",
      "Insert the block below near the end of the hero/intro or above the footer.",
      "For each question, write an 80–200 word answer **on the page** directly under the <h3>.",
      "Link answers to deeper docs/blog where useful; keep one idea per paragraph.",
      "Re-scan and verify headings are detected (H2/H3 with a `?`)."
    ],
    codeSnippet: htmlBlock,
    estimatedTime: "45–90 minutes",
    difficulty: "Easy",
    estimatedScoreGain: 10,
    currentScore: issue.currentScore,
    targetScore: issue.threshold,
    evidence: { sampleHeadings: headings.slice(0, 6), siteType: profile.site_type, domain },
    generatedBy: 'programmatic'
  };
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
    title: `Improve ${issue.subfactor}`,
    impactArea: issue.category,
    whyItMatters: "This affects your AI visibility.",
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
    if (!found) return `No Schema.org markup detected on ${domain}. Your ${wordCount} words of content are invisible to AI entity recognition.`;
    return `Limited Schema.org on ${domain}: ${types}. Missing critical schemas (Organization, FAQ, BreadcrumbList) that AI assistants use for citations.`;
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

  // Generic fallback - still helpful
  return [
    `Open the relevant page/template for ${domain}.`,
    `Review current ${subfactor} implementation against best practices.`,
    'Make necessary changes based on the recommendations above.',
    'Validate changes with automated tools (validators, analyzers).',
    'Re-run the scan to verify score improvement.',
    'Monitor impact on AI visibility over 2-4 weeks.'
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
    rec.impact = template.whyItMatters || 'This affects your AI visibility.';
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
  
  return {
    id: `rec_${issue.category}_${issue.subfactor}_${Date.now()}`,
    title: template.title,
    category: issue.category,
    subfactor: issue.subfactor,
    priority: issue.severity,
    priorityScore: issue.priority,
    finding: escapeAngleBrackets(extractSection(aiResponse, 'FINDING') || ''),
impact: escapeAngleBrackets(extractSection(aiResponse, 'IMPACT BREAKDOWN') || extractSection(aiResponse, 'IMPACT') || ''),
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
    if (!found.length) {
      return `- No Schema.org detected\n- Missing: Organization, WebSite, WebPage (at minimum)\n- Page word count: ${content.wordCount || 0}`;
    }
    return `- Found ${found.length} Schema.org block(s): ${types}\n- May be missing Organization/WebSite linking or stable @ids\n- Recommended additions: FAQ, BreadcrumbList`;
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
    if (!existing.includes('Organization')) {
      schemas.push({ type: 'Organization', useData: 'brand, logo, sameAs' });
    }
    if (!existing.includes('WebSite')) {
      schemas.push({ type: 'WebSite', useData: 'url, name, publisher→Organization' });
    }
    if (profile.site_type === 'saas' && !existing.includes('SoftwareApplication')) {
      schemas.push({ type: 'SoftwareApplication', useData: 'name, description, offers (optional)' });
    }
  }
  if (issue.subfactor === 'faqScore') {
    schemas.push({ type: 'FAQPage', useData: 'on-page Q/A pairs' });
  }
  return schemas;
}

// -----------------------------------------
// Exports
// -----------------------------------------

module.exports = {
  generateRecommendations
};
