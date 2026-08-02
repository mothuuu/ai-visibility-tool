/**
 * Prompts generator (REAL, LLM-backed) — SAVE-TIME suggestions.
 *
 * Produces suggested discovery prompts for the Top Queries picker. It is NO
 * LONGER part of the background draft pipeline (see generators/index.js) — it is
 * invoked at SAVE time, on first profile completion, from the user's CONFIRMED
 * icps + competitors, and returns
 *   { tracked_prompts: [ { text, funnel_stage, is_monitored:false,
 *                          source:"suggested", volume:null }, ... ] }
 * with `suggestions_per_stage` (default 10) queries per funnel stage
 * (TOFU / MOFU / BOFU) — 30 total by default. All items are SUGGESTIONS
 * (is_monitored=false, source="suggested", volume=null) until the user picks
 * (selection persistence is a later build).
 *
 * Count comes from ctx.draftConfig.suggestions_per_stage (NOT the legacy
 * populated_prompts_min/max). One LLM call PER STAGE, run in parallel (~5s), so
 * per-stage counts are reliable; a stage whose call fails degrades to empty
 * without affecting the others.
 *
 * GRACEFUL DEGRADATION (must never throw): on LLM failure / timeout /
 * unparseable output / no usable context, returns an empty list so the picker
 * can still let the user add their own. `extraContext` doc-upload seam preserved.
 *
 * Uses the existing Claude adapter (services/engines/claudeAdapter.js) — no new
 * client. `claudeAdapter.runQuery` is called via property access so tests can stub it.
 */

const claudeAdapter = require('../../engines/claudeAdapter');
const { parseJsonArray } = require('../llmJson');

const DEFAULT_PER_STAGE = 10;
const LLM_MAX_CHARS = 4000;

// Funnel stages + the flavor of query the model should produce for each.
const STAGES = [
  { key: 'TOFU', desc: 'awareness / top-of-funnel — broad discovery ("best …", "how do I …", "what is …") where the buyer does not yet know specific brands' },
  { key: 'MOFU', desc: 'comparison / consideration / middle-of-funnel — ("X vs Y", "alternatives to …", "compare …", "which … is best for …") where the buyer is weighing options' },
  { key: 'BOFU', desc: 'decision / bottom-of-funnel — ("… pricing", "… reviews", "is … worth it", "… near me") where the buyer is close to choosing' },
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') return String(v.text || v.title || v.name || v.value || '').trim();
  return String(v).trim();
}

function asStrings(v) {
  if (!Array.isArray(v)) return [];
  return v.map(toText).filter(Boolean);
}

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || /^(null|none|n\/a|na|unknown)$/i.test(s)) return null;
  return s;
}

function posInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Compact fallback context from raw scan content (when profile fields are absent). */
function gatherSiteText(scan) {
  const s = scan || {};
  const ev = (s.detailed_analysis || {}).scanEvidence || {};
  const content = ev.content || {};
  const technical = ev.technical || {};
  const parts = [];
  if (s.url) parts.push(`URL: ${s.url}`);
  const title = toText(technical.metaTags?.title) || toText(technical.title);
  if (title) parts.push(`Title: ${title}`);
  const desc = toText(technical.metaTags?.description) || toText(content.metaDescription);
  if (desc) parts.push(`Meta description: ${desc}`);
  if (s.industry) parts.push(`Detected industry hint: ${toText(s.industry)}`);
  const headings = asStrings(content.headings).slice(0, 20);
  if (headings.length) parts.push(`Headings:\n${headings.join('\n')}`);
  const paras = asStrings(content.paragraphs).slice(0, 20);
  if (paras.length) parts.push(`Content:\n${paras.join('\n')}`);
  return parts.join('\n\n').trim();
}

const compNames = (list) =>
  asStrings((Array.isArray(list) ? list : []).map((c) => (typeof c === 'string' ? c : (c && c.name)))).slice(0, 6);

/**
 * Business context from the CONFIRMED profile: basics + ICPs + competitors.
 * Falls back to raw scan content when profile fields are absent. extraContext =
 * forward doc-upload seam (no-op today).
 */
function buildContext(ctx, extraContext) {
  const p = (ctx && ctx.profile) || {};
  const lines = [];
  if (cleanStr(p.company_name)) lines.push(`Company: ${cleanStr(p.company_name)}`);
  if (cleanStr(p.industry)) lines.push(`Industry: ${cleanStr(p.industry)}`);
  if (cleanStr(p.location)) lines.push(`Location: ${cleanStr(p.location)}`);
  if (cleanStr(p.business_description)) lines.push(`Business description: ${cleanStr(p.business_description)}`);

  const icps = asStrings((Array.isArray(p.icps) ? p.icps : []).map((i) => (typeof i === 'string' ? i : (i && i.text)))).slice(0, 8);
  if (icps.length) lines.push(`Target customers (ICPs): ${icps.join('; ')}`);

  const cbiz = compNames(p.competitors_business);
  if (cbiz.length) lines.push(`Direct competitors: ${cbiz.join('; ')}`);
  const cvis = compNames(p.competitors_visibility);
  if (cvis.length) lines.push(`Authoritative sources in the space: ${cvis.join('; ')}`);

  let context = lines.length ? lines.join('\n') : gatherSiteText(ctx && ctx.scan);

  const extra = extraContext && toText(extraContext.documentText || extraContext.text);
  if (extra) context = `${context}\n\nAdditional context:\n${extra}`;

  context = context.trim();
  if (context.length > LLM_MAX_CHARS) context = context.slice(0, LLM_MAX_CHARS);
  return context;
}

function buildStageQuery(context, stage, n) {
  return [
    `List exactly ${n} discovery queries that real customers type into AI assistants (ChatGPT, Claude,`,
    'Perplexity, Gemini) when looking for a business like the one described below.',
    `These must all be ${stage.key} queries: ${stage.desc}.`,
    'Phrase them the way a customer would actually ask. Do not number them. Avoid duplicates.',
    '',
    'Return STRICT JSON ONLY — no prose, no markdown, no code fences — as an array of objects:',
    '[{"text": "..."}]',
    `Return exactly ${n} objects.`,
    '',
    'Business context:',
    '"""',
    context,
    '"""',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

module.exports = {
  name: 'prompts',
  automated: true,

  empty() {
    return { tracked_prompts: [] };
  },

  /**
   * @param {object} ctx            generator context (ctx.profile = confirmed basics+icps+competitors)
   * @param {object} [extraContext] reserved seam for future parsed-document text
   */
  async run(ctx, extraContext) {
    try {
      const cfg = (ctx && ctx.draftConfig) || {};
      // 0/missing handling: an explicit 0 (freemium) => no suggestions; missing => default.
      const perStage =
        cfg.suggestions_per_stage === 0 ? 0 : (posInt(cfg.suggestions_per_stage) || DEFAULT_PER_STAGE);
      if (perStage <= 0) return { tracked_prompts: [] };

      const context = buildContext(ctx, extraContext);
      if (!context) return { tracked_prompts: [] };

      // One call per stage, in parallel; a stage failure degrades to [] only for it.
      const stageResults = await Promise.all(
        STAGES.map(async (stage) => {
          try {
            const out = await claudeAdapter.runQuery(buildStageQuery(context, stage, perStage));
            const parsed = parseJsonArray(out, `prompts:${stage.key}`);
            if (!parsed) return [];
            const items = [];
            const seen = new Set();
            for (const item of parsed) {
              const text = cleanStr(typeof item === 'string' ? item : (item && (item.text || item.query || item.prompt)));
              if (!text) continue;
              const key = text.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              items.push({ text, funnel_stage: stage.key, is_monitored: false, source: 'suggested', volume: null });
              if (items.length >= perStage) break; // cap at N per stage
            }
            return items;
          } catch (err) {
            console.warn(`[prompts:${stage.key}] suggestion generation failed (${err && err.message ? err.message : err}); returning empty for stage`);
            return [];
          }
        })
      );

      return { tracked_prompts: stageResults.flat() };
    } catch (err) {
      console.warn(`[prompts] suggestion generation failed (${err && err.message ? err.message : err}); returning empty list`);
      return { tracked_prompts: [] };
    }
  },
};
