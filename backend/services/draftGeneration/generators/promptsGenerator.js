/**
 * Prompts generator (REAL, LLM-backed) — G4.
 *
 * Produces the best-suggested discovery prompts for the visibility-profile draft
 * and returns the contribution
 *   { tracked_prompts: [ { text, funnel_stage, is_monitored, volume: null }, ... ] }.
 *
 * Runs after icps (and competitors), so it reasons from G1's basics + G2's ICPs
 * in ctx.profile (falling back to raw scan content). Asks the model for the
 * discovery queries real customers type into AI assistants (ChatGPT, Claude,
 * Perplexity, Gemini) when looking for this kind of business, each tagged with a
 * funnel stage (TOFU / MOFU / BOFU) with a spread across the three.
 *
 * Count respects ctx.draftConfig.populated_prompts_min/max (3–5). is_monitored
 * defaults true within the populated set, never exceeding ctx.draftConfig.
 * monitoring_cap. volume is ALWAYS null here — estimation is a later feature
 * (Walther's token unlock), never done in this generator.
 *
 * GRACEFUL DEGRADATION (job contract — must never throw the run): on LLM failure
 * / timeout / unparseable output, or when there's no usable context, returns an
 * empty list.
 *
 * Uses the existing Claude adapter (services/engines/claudeAdapter.js) — no new
 * client. `claudeAdapter.runQuery` is called via property access so tests can stub it.
 */

const claudeAdapter = require('../../engines/claudeAdapter');
const { parseJsonArray } = require('../llmJson');

const DEFAULT_MIN = 3;
const DEFAULT_MAX = 5;
const HARD_MAX = 5;          // never return more than this
const LLM_MAX_CHARS = 4000;

const FUNNEL_STAGES = new Set(['TOFU', 'MOFU', 'BOFU']);

// ---------------------------------------------------------------------------
// helpers (self-contained per generator, consistent with G1–G3)
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

/** Normalize a funnel stage to TOFU/MOFU/BOFU, or null if undeterminable. */
function normalizeFunnel(v) {
  const s = cleanStr(v);
  if (!s) return null;
  const u = s.toUpperCase();
  if (FUNNEL_STAGES.has(u)) return u;
  if (/AWARE|DISCOVER|\bTOP\b|TOP[\s-]?OF/.test(u)) return 'TOFU';
  if (/COMPAR|CONSIDER|MIDDLE|EVAL|VS\b/.test(u)) return 'MOFU';
  if (/DECISION|PURCHAS|BOTTOM|\bBUY\b|PRICE|COST/.test(u)) return 'BOFU';
  return null;
}

/** Compact fallback context from raw scan content (when G1 fields are absent). */
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

/**
 * Best-available business context: prefer G1's clean fields + G2's ICPs; else
 * raw scan content. extraContext = forward doc-upload seam (no-op today).
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

  let context = lines.length ? lines.join('\n') : gatherSiteText(ctx && ctx.scan);

  const extra = extraContext && toText(extraContext.documentText || extraContext.text);
  if (extra) context = `${context}\n\nAdditional context:\n${extra}`;

  context = context.trim();
  if (context.length > LLM_MAX_CHARS) context = context.slice(0, LLM_MAX_CHARS);
  return context;
}

function buildQuery(context, min, max) {
  return [
    'List the discovery queries real customers type into AI assistants (ChatGPT, Claude, Perplexity,',
    'Gemini) when looking for a business like the one described below — the queries where this brand',
    'wants to surface. Phrase them the way a customer would actually ask.',
    '',
    'Assign each query a funnel_stage:',
    '- "TOFU": awareness (e.g. "best luxury beachfront condos in Nassau")',
    '- "MOFU": comparison / consideration (e.g. "Goldwynn Bahamas vs Albany")',
    '- "BOFU": decision (e.g. "Cable Beach condo prices", "is X worth it")',
    'Aim for a spread across TOFU, MOFU and BOFU.',
    '',
    'Return STRICT JSON ONLY — no prose, no markdown, no code fences — as an array of objects:',
    '[{"text": "...", "funnel_stage": "TOFU|MOFU|BOFU"}]',
    `Return between ${min} and ${max} queries.`,
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
   * @param {object} ctx            generator context (ctx.profile carries G1/G2; ctx.draftConfig the caps)
   * @param {object} [extraContext] reserved seam for future parsed-document text
   */
  async run(ctx, extraContext) {
    const cfg = (ctx && ctx.draftConfig) || {};
    const max = Math.min(posInt(cfg.populated_prompts_max) || DEFAULT_MAX, HARD_MAX);
    const min = Math.min(posInt(cfg.populated_prompts_min) || DEFAULT_MIN, max);
    // monitoring_cap: null/undefined => no limit (Enterprise). 0 => none monitored.
    const cap = cfg.monitoring_cap == null ? null : (posInt(cfg.monitoring_cap) || 0);

    try {
      const context = buildContext(ctx, extraContext);
      if (!context) return { tracked_prompts: [] };

      const out = await claudeAdapter.runQuery(buildQuery(context, min, max));
      const parsed = parseJsonArray(out, 'prompts');
      if (!parsed) return { tracked_prompts: [] };

      const items = [];
      for (const item of parsed) {
        const text = cleanStr(typeof item === 'string' ? item : (item && (item.text || item.query || item.prompt)));
        if (!text) continue;
        const funnel_stage = normalizeFunnel(item && (item.funnel_stage || item.stage || item.funnel));
        items.push({ text, funnel_stage, is_monitored: true, volume: null }); // volume ALWAYS null
        if (items.length >= max) break; // respect populated_prompts_max
      }

      // is_monitored within the populated set, never exceeding monitoring_cap.
      items.forEach((it, i) => {
        it.is_monitored = cap == null ? true : i < cap;
      });

      return { tracked_prompts: items };
    } catch (err) {
      console.warn(`[prompts] LLM generation failed (${err && err.message ? err.message : err}); returning empty list`);
      return { tracked_prompts: [] };
    }
  },
};
