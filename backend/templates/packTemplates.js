/**
 * Pack Prompt Templates
 *
 * Each template registered as:
 *   {
 *     systemPrompt:  string,
 *     userPrompt:    (context) => string,
 *     postProcess?:  (parsed) => parsed | normalized   // optional
 *   }
 *
 * PackEngine reads .systemPrompt + calls .userPrompt(context); after the AI
 * responds it calls .postProcess(parsed) when present (validation, counting).
 *
 * Phase 2.3: quick_wins, schema_pack, faq_pack are fully implemented.
 * The remaining 12 packs return a clearly-marked placeholder.
 */

const path = require('path');
const faqLibraryLoader = require('../phase2_preserved/recommendation-engine/faq-library-loader');

const SYSTEM_PROMPT_BASE =
  "You are an AI visibility optimization expert. You help website owners " +
  "improve how their content appears in AI assistant answers (ChatGPT, Claude, " +
  "Perplexity, Google AI Overviews). You produce concrete, evidence-backed " +
  "recommendations grounded in the scan data provided. Always respond with " +
  "valid JSON matching the requested schema — no preamble, no closing prose.";

// ---------------------------------------------------------------------------
// QUICK WINS (cost: 15) — full implementation
// ---------------------------------------------------------------------------
const QUICK_WINS_SYSTEM =
  "You are an AI visibility optimization expert. You analyze website scan data " +
  "and identify the fastest, lowest-effort fixes that will improve how AI " +
  "assistants (ChatGPT, Claude, Perplexity) perceive and recommend this brand. " +
  "Your output must be immediately actionable — specific URLs, exact changes, " +
  "copy-paste ready code/text where applicable. Respond in valid JSON format only.";

function quickWinsUserPrompt(context) {
  const findings = context.findings || [];
  const pageUrls = (context.pageUrls || []).join('\n');

  return [
    `Analyze this website scan for quick wins.`,
    ``,
    `Domain: ${context.domain || 'unknown'}`,
    `Overall Score: ${context.scanScore ?? 'n/a'}/1000`,
    ``,
    `Findings (sorted by severity):`,
    JSON.stringify(findings, null, 2),
    ``,
    `Page URLs scanned:`,
    pageUrls || '(none)',
    ``,
    `Identify 3-5 quick wins — fixes that:`,
    `- Take under 30 minutes each to implement`,
    `- Don't require structural site changes`,
    `- Have measurable impact on AI visibility score`,
    ``,
    `For each quick win, return a JSON array with objects containing:`,
    `- title: short descriptive name`,
    `- finding_id: which finding this addresses (from the findings above)`,
    `- severity: how critical this fix is`,
    `- page_url: the specific page to modify`,
    `- current_issue: what's wrong now`,
    `- fix_description: exactly what to change`,
    `- implementation: copy-paste ready code, text, or step-by-step instruction`,
    `- estimated_score_impact: rough point improvement (e.g., '+15 to +25 points')`,
    `- time_estimate: how long to implement (e.g., '10 minutes')`,
    ``,
    `Return ONLY a valid JSON array. No markdown, no explanation outside the JSON.`
  ].join('\n');
}

function quickWinsPostProcess(parsed) {
  // Spec contract: AI returns a top-level JSON array of quick-win objects.
  // Also accepted (for backward compat with earlier prompt iterations):
  //   { quick_wins: [...] }     — already-wrapped
  //   { title, summary, wins: [...] }  — object with `wins` array + meta
  if (Array.isArray(parsed)) {
    return { quick_wins: parsed, count: parsed.length };
  }
  if (parsed && Array.isArray(parsed.quick_wins)) {
    return { ...parsed, quick_wins: parsed.quick_wins, count: parsed.quick_wins.length };
  }
  if (parsed && Array.isArray(parsed.wins)) {
    // Legacy shape: keep title/summary/etc, expose `quick_wins` alias for new consumers
    return { ...parsed, quick_wins: parsed.wins, count: parsed.wins.length };
  }
  if (parsed && parsed.parse_error) {
    return { quick_wins: [], count: 0, parse_error: true, raw: parsed.raw };
  }
  // Unexpected shape — pass through but mark as such
  return { quick_wins: [], count: 0, unexpected_shape: true, original: parsed };
}

// ---------------------------------------------------------------------------
// SCHEMA PACK (cost: 60) — full implementation
// ---------------------------------------------------------------------------
const SCHEMA_PACK_SYSTEM =
  "You are a Schema.org structured data expert specializing in AI visibility. " +
  "You generate complete, valid JSON-LD markup based on real website data. " +
  "Your output must be ready to paste directly into HTML <script type='application/ld+json'> tags. " +
  "All data must come from the scan evidence provided — never fabricate company details. " +
  "Respond in valid JSON format only.";

function schemaPackUserPrompt(context) {
  const evidence = context.evidence || {};
  const schemaFindings = (context.findings || []).filter(f => f.pillar === 'schema');

  // The PackEngine context.evidence is an array of evidence_snapshots rows.
  // Aggregate the per-page fields the prompt asks for.
  const aggregatedSchema = {};
  const aggregatedHeadings = [];
  const aggregatedMeta = {};
  const aggregatedContent = {};
  if (Array.isArray(context.evidence)) {
    for (const e of context.evidence) {
      if (e.schema_found && Object.keys(e.schema_found).length > 0) {
        aggregatedSchema[e.page_url || 'unknown'] = e.schema_found;
      }
      if (Array.isArray(e.headings) && e.headings.length > 0) {
        aggregatedHeadings.push({ page_url: e.page_url, headings: e.headings });
      }
      if (e.meta_data && Object.keys(e.meta_data).length > 0) {
        aggregatedMeta[e.page_url || 'unknown'] = e.meta_data;
      }
    }
  }

  return [
    `Generate complete JSON-LD structured data for this website.`,
    ``,
    `Domain: ${context.domain || 'unknown'}`,
    `Overall Score: ${context.scanScore ?? 'n/a'}/1000`,
    ``,
    `Current schema found on site:`,
    JSON.stringify(aggregatedSchema, null, 2),
    ``,
    `Page content and structure:`,
    JSON.stringify(aggregatedContent, null, 2),
    ``,
    `Meta data:`,
    JSON.stringify(aggregatedMeta, null, 2),
    ``,
    `Headings found:`,
    JSON.stringify(aggregatedHeadings, null, 2),
    ``,
    `Schema-related findings:`,
    JSON.stringify(schemaFindings, null, 2),
    ``,
    `Generate these schema types (skip any where insufficient data exists):`,
    `1. Organization — use real company name, URL, description from scan data`,
    `2. WebSite — with SearchAction if applicable`,
    `3. FAQPage — if FAQ content was detected on any page`,
    `4. Article/BlogPosting — for any content pages detected`,
    `5. BreadcrumbList — based on site structure`,
    `6. LocalBusiness — if address/location data found`,
    ``,
    `For each schema block, return a JSON object with:`,
    `- schema_type: the @type value`,
    `- target_page: which page URL this belongs on`,
    `- json_ld: the complete, valid JSON-LD object (ready to paste)`,
    `- notes: any implementation notes`,
    ``,
    `Return ONLY a valid JSON array of schema blocks. No markdown wrapping.`
  ].join('\n');
}

function schemaPackPostProcess(parsed) {
  const blocks = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.schema_blocks) ? parsed.schema_blocks
       : (parsed && Array.isArray(parsed.blocks) ? parsed.blocks : null));

  if (!blocks) {
    if (parsed && parsed.parse_error) {
      return { schema_blocks: [], valid_count: 0, invalid_count: 0, parse_error: true, raw: parsed.raw };
    }
    return { schema_blocks: [], valid_count: 0, invalid_count: 0, unexpected_shape: true, original: parsed };
  }

  const validated = blocks.map(b => {
    const jsonLd = b && b.json_ld;
    const hasContext = jsonLd && (jsonLd['@context'] || jsonLd['@CONTEXT']);
    const hasType = jsonLd && (jsonLd['@type'] || jsonLd['@TYPE']);
    const valid = Boolean(jsonLd && hasContext && hasType);
    const validation_warnings = [];
    if (!jsonLd) validation_warnings.push('json_ld field missing');
    else {
      if (!hasContext) validation_warnings.push('json_ld missing @context');
      if (!hasType)    validation_warnings.push('json_ld missing @type');
    }
    return { ...b, valid, validation_warnings };
  });

  const validCount = validated.filter(b => b.valid).length;
  return {
    schema_blocks: validated,
    valid_count: validCount,
    invalid_count: validated.length - validCount
  };
}

// ---------------------------------------------------------------------------
// FAQ PACK (cost: 35) — full implementation, uses industry FAQ library
// ---------------------------------------------------------------------------
const FAQ_PACK_SYSTEM =
  "You are a content strategist specializing in FAQ optimization for AI " +
  "visibility. You create FAQ content that directly addresses the questions " +
  "AI assistants ask about businesses in specific industries. Your FAQs must " +
  "be natural, informative, and include proper FAQPage schema markup. Use " +
  "real business context from the scan data — never generic filler. " +
  "Respond in valid JSON format only.";

function detectIndustry(context) {
  // Try several context locations; the scan loader may stash industry differently.
  const e = context.evidence;
  if (Array.isArray(e)) {
    for (const row of e) {
      const ind = row && row.meta_data && (row.meta_data.detected_industry || row.meta_data.industry);
      if (ind) return ind;
    }
  } else if (e && typeof e === 'object') {
    const ca = e.content_analysis || {};
    if (ca.detected_industry) return ca.detected_industry;
  }
  if (context.industry) return context.industry;
  return null;
}

function loadIndustryLibrarySafely(industry) {
  if (!industry) return null;
  try {
    if (faqLibraryLoader.hasLibrary && !faqLibraryLoader.hasLibrary(industry)) return null;
    const lib = faqLibraryLoader.loadLibrary(industry);
    return lib || null;
  } catch (e) {
    console.warn(`[packTemplates] FAQ library load failed for "${industry}":`, e.message);
    return null;
  }
}

function faqPackUserPrompt(context) {
  const industry = detectIndustry(context);
  const industryLibrary = loadIndustryLibrarySafely(industry);
  const faqFindings = (context.findings || []).filter(f => f.pillar === 'faqs' || f.pillar === 'faq');

  const sections = [
    `Generate optimized FAQ content for this website.`,
    ``,
    `Domain: ${context.domain || 'unknown'}`,
    `Industry/vertical (if detectable): ${industry || 'Unknown'}`,
    ``,
    `Current FAQ content on site:`,
    JSON.stringify(faqFindings, null, 2),
    ``,
    `Page content context:`,
    JSON.stringify({ page_count: context.pageCount, page_urls: (context.pageUrls || []).slice(0, 20) }, null, 2),
    ``
  ];

  if (industryLibrary) {
    sections.push(
      `Industry FAQ templates for reference (adapt these, don't copy verbatim):`,
      JSON.stringify(industryLibrary, null, 2),
      ``
    );
  }

  sections.push(
    `Generate 8-12 FAQ items that:`,
    `- Address questions AI assistants commonly ask about this type of business`,
    `- Use natural language (not keyword-stuffed)`,
    `- Include specific details from the scan data where possible`,
    `- Cover: what the business does, how it's different, pricing/process, trust/credentials, common concerns`,
    ``,
    `For each FAQ, return a JSON object with:`,
    `- question: the FAQ question`,
    `- answer: the answer (2-4 sentences, informative, specific)`,
    `- category: grouping (e.g., 'services', 'trust', 'process', 'comparison')`,
    `- priority: 'high', 'medium', or 'low'`,
    ``,
    `Also include a complete FAQPage JSON-LD schema block containing all generated Q&As, ready to paste.`,
    ``,
    `Return a JSON object with:`,
    `- faqs: array of FAQ objects`,
    `- schema: complete FAQPage JSON-LD`,
    `- implementation_notes: where to place the FAQs on the site and how to integrate the schema`
  );

  return sections.join('\n');
}

function faqPackPostProcess(parsed) {
  if (parsed && parsed.parse_error) {
    return { faqs: [], faq_count: 0, schema: null, schema_valid: false, parse_error: true, raw: parsed.raw };
  }

  const obj = parsed && typeof parsed === 'object' ? parsed : {};
  const faqs = Array.isArray(obj.faqs) ? obj.faqs : [];
  const schema = obj.schema || null;
  const schemaIsFaqPage =
    schema && (schema['@type'] === 'FAQPage' || schema['@TYPE'] === 'FAQPage');

  const validation_warnings = [];
  if (!schema) validation_warnings.push('schema field missing');
  else if (!schemaIsFaqPage) validation_warnings.push('schema @type is not "FAQPage"');
  if (faqs.length < 8) validation_warnings.push(`fewer than 8 FAQs generated (got ${faqs.length})`);
  if (faqs.length > 12) validation_warnings.push(`more than 12 FAQs generated (got ${faqs.length})`);

  return {
    faqs,
    faq_count: faqs.length,
    schema,
    schema_valid: Boolean(schemaIsFaqPage),
    implementation_notes: obj.implementation_notes || null,
    validation_warnings
  };
}

// ---------------------------------------------------------------------------
// Placeholder for the remaining 12 packs (Step 2.4)
// ---------------------------------------------------------------------------
function placeholderTemplate(packType) {
  return function (context) {
    return [
      `Pack type: ${packType}`,
      `Domain: ${context.domain || 'unknown'}`,
      ``,
      `Template for ${packType} is not yet implemented. Coming in Phase 2.3/2.4.`,
      `Respond with this JSON: { "title": "${packType}", "summary": "Not yet implemented", "items": [] }`
    ].join('\n');
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
const TEMPLATES = {
  quick_wins:  { systemPrompt: QUICK_WINS_SYSTEM,  userPrompt: quickWinsUserPrompt,  postProcess: quickWinsPostProcess,  implemented: true },
  schema_pack: { systemPrompt: SCHEMA_PACK_SYSTEM, userPrompt: schemaPackUserPrompt, postProcess: schemaPackPostProcess, implemented: true },
  faq_pack:    { systemPrompt: FAQ_PACK_SYSTEM,    userPrompt: faqPackUserPrompt,    postProcess: faqPackPostProcess,    implemented: true }
};

const PLACEHOLDER_PACKS = [
  'evidence_trust', 'entity_clarity',
  'content_brief', 'comparison', 'ai_ready_draft',
  'audit_pdf', 'refresh', 'citation_lift', 'query_refresh',
  'narrative_repair', 'query_baseline_starter', 'query_baseline_pro'
];
for (const pt of PLACEHOLDER_PACKS) {
  TEMPLATES[pt] = { systemPrompt: SYSTEM_PROMPT_BASE, userPrompt: placeholderTemplate(pt), implemented: false };
}

function getTemplate(packType) {
  return TEMPLATES[packType] || null;
}

module.exports = { getTemplate, TEMPLATES };
