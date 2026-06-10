/**
 * ICP generator (REAL, LLM-backed) — G2.
 *
 * Proposes 2–3 ideal customer profiles for the visibility-profile draft and
 * returns the contribution { icps: [{ text, selected: true }, ...] }. AI-proposed
 * items start selected. Runs AFTER scan_extraction, so it derives ICPs from G1's
 * clean business context (ctx.profile.company_name / industry / business_description)
 * when available, falling back to the raw scan content otherwise. Never re-scans.
 *
 * GRACEFUL DEGRADATION (job contract — must never throw the run): on LLM failure
 * / timeout / unparseable output, or when there's no usable context, it returns
 * an empty list. ICPs have no deterministic fallback (unlike the basics), so
 * empty-for-manual-entry is the correct degrade.
 *
 * Uses the existing Claude adapter (services/engines/claudeAdapter.js) — no new
 * client. `claudeAdapter.runQuery` is called via property access so tests can stub it.
 */

const claudeAdapter = require('../../engines/claudeAdapter');

const MAX_ICPS = 5;          // hard cap on what we ever return
const LLM_MAX_CHARS = 4000;  // budget for the context fed to the model

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
 * Best-available business context: prefer G1's clean profile fields; otherwise
 * fall back to the raw scan content. `extraContext` is the forward seam for a
 * future parsed-document upload (appended when present; no-op today).
 */
function buildContext(ctx, extraContext) {
  const p = (ctx && ctx.profile) || {};
  const lines = [];
  if (cleanStr(p.company_name)) lines.push(`Company: ${cleanStr(p.company_name)}`);
  if (cleanStr(p.industry)) lines.push(`Industry: ${cleanStr(p.industry)}`);
  if (cleanStr(p.location)) lines.push(`Location: ${cleanStr(p.location)}`);
  if (cleanStr(p.business_description)) lines.push(`Business description: ${cleanStr(p.business_description)}`);

  let context = lines.length ? lines.join('\n') : gatherSiteText(ctx && ctx.scan);

  const extra = extraContext && toText(extraContext.documentText || extraContext.text);
  if (extra) context = `${context}\n\nAdditional context:\n${extra}`;

  context = context.trim();
  if (context.length > LLM_MAX_CHARS) context = context.slice(0, LLM_MAX_CHARS);
  return context;
}

function buildQuery(context) {
  return [
    'Identify the 2–3 most important ideal customer profiles (ICPs) for the business described below.',
    'Each ICP is a concise label (3–8 words) describing a TYPE / segment of customer this business',
    'serves — not an individual person, and not a bare job title.',
    'Return STRICT JSON ONLY — no prose, no markdown, no code fences — as an array of objects:',
    '[{"text": "..."}, {"text": "..."}]',
    'Return at most 3.',
    '',
    'Business context:',
    '"""',
    context,
    '"""',
  ].join('\n');
}

/** Strip fences / prose and parse the first JSON array. null on failure. */
function parseJsonArrayLoose(text) {
  if (!text || typeof text !== 'string') return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('[');
  const last = t.lastIndexOf(']');
  if (first === -1 || last === -1 || last < first) return null;
  try {
    const v = JSON.parse(t.slice(first, last + 1));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

module.exports = {
  name: 'icps',
  automated: true,

  empty() {
    return { icps: [] };
  },

  /**
   * @param {object} ctx            generator context (ctx.profile carries G1; ctx.scan the scan)
   * @param {object} [extraContext] reserved seam for future parsed-document text
   */
  async run(ctx, extraContext) {
    try {
      const context = buildContext(ctx, extraContext);
      if (!context) return { icps: [] }; // nothing to reason from — manual entry

      const out = await claudeAdapter.runQuery(buildQuery(context));
      const parsed = parseJsonArrayLoose(out && out.response_text);
      if (!parsed) return { icps: [] }; // unparseable — degrade to empty

      const icps = [];
      for (const item of parsed) {
        const text = cleanStr(typeof item === 'string' ? item : (item && (item.text || item.label || item.name)));
        if (text) icps.push({ text, selected: true }); // AI-proposed -> start selected
        if (icps.length >= MAX_ICPS) break;            // hard cap at 5
      }
      return { icps };
    } catch (err) {
      console.warn(`[icps] LLM generation failed (${err && err.message ? err.message : err}); returning empty list`);
      return { icps: [] };
    }
  },
};
