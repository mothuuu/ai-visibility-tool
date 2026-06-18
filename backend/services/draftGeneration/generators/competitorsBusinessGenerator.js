/**
 * Business-competitors generator (REAL, LLM-backed) — G3.
 *
 * Proposes up to 5 DIRECT business competitors (rival companies competing for
 * the same customers) for the visibility-profile draft and returns the
 * contribution { competitors_business: [{ name, url }, ...] }, ordered
 * most-significant first. `url` is optional (null when unknown). Runs after
 * scan_extraction, so it derives competitors from G1's clean business context
 * (ctx.profile) when available, falling back to the raw scan content. Never
 * re-scans.
 *
 * GRACEFUL DEGRADATION (job contract — must never throw the run): on LLM failure
 * / timeout / unparseable output, or when there's no usable context, it returns
 * an empty list.
 *
 * Uses the existing Claude adapter (services/engines/claudeAdapter.js) — no new
 * client. `claudeAdapter.runQuery` is called via property access so tests can stub it.
 */

const claudeAdapter = require('../../engines/claudeAdapter');
const { parseJsonArray } = require('../llmJson');

const MAX_ITEMS = 5;
const LLM_MAX_CHARS = 4000;

// ---------------------------------------------------------------------------
// helpers (self-contained per generator, consistent with G1/G2)
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

/** Optional url: trimmed non-empty string that looks like a url/domain, else null. */
function cleanUrl(v) {
  const s = cleanStr(v);
  if (!s) return null;
  if (!/\./.test(s)) return null; // not a domain/url
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

/** Prefer G1's clean profile fields; otherwise raw scan content. extraContext = doc seam. */
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
    'Identify the DIRECT business competitors of the company described below — other companies',
    'competing for the SAME customers (rival providers / brands / developers in the same market).',
    'Do NOT list publications, directories, marketplaces, or "best-of" lists — only actual rival companies.',
    'Return STRICT JSON ONLY — no prose, no markdown, no code fences — as an array of objects:',
    '[{"name": "...", "url": "https://..."}]',
    '- name: the competitor\'s brand / company name (required).',
    '- url: the competitor\'s homepage if you know it, otherwise null.',
    'Return at most 5, ordered most-significant first.',
    '',
    'Business context:',
    '"""',
    context,
    '"""',
  ].join('\n');
}

/** Map parsed items -> [{ name, url }]; drop empty-name items; cap at MAX_ITEMS. */
function mapItems(parsed) {
  const out = [];
  for (const item of parsed) {
    let name, url;
    if (item && typeof item === 'object') {
      name = cleanStr(item.name || item.title || item.company || item.brand);
      url = cleanUrl(item.url || item.website || item.link || item.homepage);
    } else {
      name = cleanStr(item);
      url = null;
    }
    if (!name) continue; // url stays optional, but name is required
    out.push({ name, url });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

module.exports = {
  name: 'competitors_business',
  automated: true,

  empty() {
    return { competitors_business: [] };
  },

  /**
   * @param {object} ctx            generator context (ctx.profile carries G1; ctx.scan the scan)
   * @param {object} [extraContext] reserved seam for future parsed-document text
   */
  async run(ctx, extraContext) {
    try {
      const context = buildContext(ctx, extraContext);
      if (!context) return { competitors_business: [] };

      const out = await claudeAdapter.runQuery(buildQuery(context));
      const parsed = parseJsonArray(out, 'competitors_business');
      if (!parsed) return { competitors_business: [] };

      return { competitors_business: mapItems(parsed) };
    } catch (err) {
      console.warn(`[competitors_business] LLM generation failed (${err && err.message ? err.message : err}); returning empty list`);
      return { competitors_business: [] };
    }
  },
};
