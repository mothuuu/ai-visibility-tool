/**
 * Pack Prompt Templates
 *
 * getTemplate(packType) returns { systemPrompt, userPrompt(context) => string }.
 * Phase 2.2: only `quick_wins` is fully implemented; the other 14 are placeholders
 * that will be filled in Steps 2.3 / 2.4.
 */

const SYSTEM_PROMPT_BASE =
  "You are an AI visibility optimization expert. You help website owners " +
  "improve how their content appears in AI assistant answers (ChatGPT, Claude, " +
  "Perplexity, Google AI Overviews). You produce concrete, evidence-backed " +
  "recommendations grounded in the scan data provided. Always respond with " +
  "valid JSON matching the requested schema — no preamble, no closing prose.";

// ---------------------------------------------------------------------------
// quick_wins — fully implemented
// ---------------------------------------------------------------------------
function quickWinsTemplate(context) {
  const findingsSummary = (context.findings || [])
    .slice(0, 10)
    .map((f, i) =>
      `${i + 1}. [${f.severity || 'unknown'}] ${f.pillar || ''} :: ${f.title || ''}` +
      (f.description ? `\n   ${f.description}` : '') +
      (f.impacted_url_count ? `\n   impacted URLs: ${f.impacted_url_count}` : '')
    )
    .join('\n');

  return [
    `Domain: ${context.domain || 'unknown'}`,
    `Scan score: ${context.scanScore ?? 'n/a'}`,
    `Pillar scores: ${JSON.stringify(context.pillarScores || {})}`,
    '',
    `Top findings (up to 10):`,
    findingsSummary || '(no findings)',
    '',
    `Pages analyzed: ${(context.pageUrls || []).slice(0, 20).join(', ') || 'n/a'}`,
    '',
    `Task: Produce a "Quick Wins" pack — the 5 highest-impact, lowest-effort fixes`,
    `the site owner can implement in under 30 minutes each. Each fix MUST be`,
    `traceable to one of the findings above.`,
    '',
    `Respond with JSON in this exact shape:`,
    `{`,
    `  "title": string,`,
    `  "summary": string (2-3 sentences),`,
    `  "wins": [`,
    `    {`,
    `      "priority": 1..5,`,
    `      "action": string (concrete instruction),`,
    `      "rationale": string (why it matters for AI visibility),`,
    `      "evidence": string (cite the finding id or pillar this addresses),`,
    `      "expected_impact": string (one short sentence),`,
    `      "effort_minutes": integer`,
    `    }`,
    `  ]`,
    `}`
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Placeholder for the remaining 14 packs (Steps 2.3 / 2.4)
// ---------------------------------------------------------------------------
function placeholderTemplate(packType) {
  return function (context) {
    return [
      `Pack type: ${packType}`,
      `Domain: ${context.domain || 'unknown'}`,
      '',
      `This template is a Phase 2.2 placeholder and will be implemented in`,
      `Steps 2.3 / 2.4. Respond with JSON: { "title": "${packType}", "summary": "Not yet implemented", "items": [] }`
    ].join('\n');
  };
}

const TEMPLATES = {
  quick_wins: { systemPrompt: SYSTEM_PROMPT_BASE, userPrompt: quickWinsTemplate, implemented: true }
};

const PLACEHOLDER_PACKS = [
  'faq_pack', 'evidence_trust', 'entity_clarity', 'schema_pack',
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
