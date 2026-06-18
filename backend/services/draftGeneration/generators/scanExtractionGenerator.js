/**
 * Scan-extraction generator (REAL, LLM-backed).
 *
 * Produces the core identity basics for the visibility-profile draft from the
 * user's EXISTING completed scan — it never triggers a new scan. It feeds the
 * scanned site's text (detailed_analysis.scanEvidence) to the existing Claude
 * adapter and asks for strict-JSON extraction of:
 *
 *   company_name         real brand name, proper-cased ("Goldwynn Bahamas")
 *   industry             specific (not a generic catch-all like "General")
 *   location             city/region/country if derivable, else null
 *   business_description 1–2 sentences on what they do and who they serve
 *
 * GRACEFUL DEGRADATION (job contract — must never throw the run):
 * on LLM failure / timeout / unparseable output, OR for any single field the
 * LLM leaves empty, it falls back to the previous DETERMINISTIC logic
 * (hostname-derived company_name, scans.industry column, best-effort location/
 * description). Output is therefore never worse than before, and every field
 * degrades to null rather than raising.
 *
 * Uses the existing LLM adapter (services/engines/claudeAdapter.js) — no new
 * client. `claudeAdapter.runQuery` is called via property access so tests can
 * stub it.
 */

const { URL } = require('url');
const claudeAdapter = require('../../engines/claudeAdapter');
const { parseJsonObject } = require('../llmJson');

// Keep the prompt within a sane budget for the adapter's fixed token cap.
const LLM_MAX_CHARS = 6000;

// ---------------------------------------------------------------------------
// Deterministic fallbacks (the previous behavior, retained as the safety net)
// ---------------------------------------------------------------------------

/** "https://www.acme-co.com/x" -> "Acme-co"; null if unparseable. */
function deriveCompanyName(rawUrl) {
  if (!rawUrl) return null;
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./i, '');
    const core = host.split('.')[0];
    if (!core) return null;
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch {
    return null;
  }
}

/** Best-effort meta description from the analysis blob (shape varies). */
function extractDescription(detailedAnalysis) {
  const da = detailedAnalysis || {};
  const ev = da.scanEvidence || {};
  return (
    da.meta?.description ||
    ev.technical?.metaTags?.description ||
    ev.technical?.meta?.description ||
    ev.content?.metaDescription ||
    null
  );
}

/** Best-effort primary location from extracted entities. */
function extractLocation(detailedAnalysis) {
  const ev = (detailedAnalysis || {}).scanEvidence || {};
  const locations = ev.entities?.locations;
  if (Array.isArray(locations) && locations.length > 0) {
    return locations[0] || null;
  }
  return null;
}

/** The full deterministic contribution (never throws, fields may be null). */
function deterministicExtract(scan) {
  const s = scan || {};
  return {
    company_name: deriveCompanyName(s.url),
    industry: (s.industry && String(s.industry).trim()) || null,
    location: extractLocation(s.detailed_analysis),
    business_description: extractDescription(s.detailed_analysis),
  };
}

// ---------------------------------------------------------------------------
// LLM extraction
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

/**
 * Assemble a compact text blob from the scan content for the LLM. `extraContext`
 * is a forward seam (future parsed-document upload); appended when present.
 */
function gatherSiteText(scan, extraContext) {
  const s = scan || {};
  const da = s.detailed_analysis || {};
  const ev = da.scanEvidence || {};
  const content = ev.content || {};
  const technical = ev.technical || {};
  const parts = [];

  if (s.url) parts.push(`URL: ${s.url}`);

  const title = toText(technical.metaTags?.title) || toText(technical.title) || toText(da.title) || toText(content.title);
  if (title) parts.push(`Title: ${title}`);

  const desc = toText(extractDescription(da));
  if (desc) parts.push(`Meta description: ${desc}`);

  if (s.industry) parts.push(`Detected industry hint: ${toText(s.industry)}`);

  const locs = asStrings(ev.entities?.locations).slice(0, 5);
  if (locs.length) parts.push(`Location entities: ${locs.join(', ')}`);

  const headings = asStrings(content.headings).slice(0, 25);
  if (headings.length) parts.push(`Headings:\n${headings.join('\n')}`);

  const paras = asStrings(content.paragraphs).slice(0, 30);
  if (paras.length) parts.push(`Content:\n${paras.join('\n')}`);

  // Forward seam: parsed uploaded-doc text, when a caller eventually provides it.
  const extra = extraContext && toText(extraContext.documentText || extraContext.text);
  if (extra) parts.push(`Additional context:\n${extra}`);

  let text = parts.join('\n\n').trim();
  if (text.length > LLM_MAX_CHARS) text = text.slice(0, LLM_MAX_CHARS);
  return text;
}

function buildQuery(siteText) {
  return [
    "Extract a company's basic profile from its website content below.",
    'Return STRICT JSON ONLY — no prose, no markdown, no code fences — with exactly these keys:',
    '{"company_name": string, "industry": string, "location": string or null, "business_description": string}',
    '',
    'Rules:',
    '- company_name: the real brand name, proper-cased (e.g. "Goldwynn Bahamas"), NOT the bare domain.',
    '- industry: specific and descriptive (e.g. "Luxury beachfront real estate"); never a generic catch-all like "General".',
    '- location: the primary city/region/country if determinable from the content, otherwise null.',
    '- business_description: 1–2 sentences on what they do and who they serve.',
    '- If a field truly cannot be determined, use null.',
    '',
    'Website content:',
    '"""',
    siteText,
    '"""',
  ].join('\n');
}

/** Trimmed non-empty string, or null (also rejects literal null/none/unknown). */
function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || /^(null|none|n\/a|na|unknown)$/i.test(s)) return null;
  return s;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

module.exports = {
  name: 'scan_extraction',
  automated: true,

  empty() {
    return {
      company_name: null,
      industry: null,
      location: null,
      business_description: null,
    };
  },

  /**
   * @param {object} ctx           generator context (ctx.scan is the completed scan)
   * @param {object} [extraContext] reserved seam for future parsed-document text
   */
  async run(ctx, extraContext) {
    const scan = (ctx && ctx.scan) || {};
    const fallback = deterministicExtract(scan);

    try {
      const siteText = gatherSiteText(scan, extraContext);
      if (!siteText) return fallback; // nothing to feed the LLM — best-effort deterministic

      const out = await claudeAdapter.runQuery(buildQuery(siteText));
      const parsed = parseJsonObject(out, 'scan_extraction');
      if (!parsed) return fallback; // unparseable — never worse than today

      // Per-field: prefer the LLM value, fall back to deterministic when empty.
      return {
        company_name: cleanStr(parsed.company_name) || fallback.company_name,
        industry: cleanStr(parsed.industry) || fallback.industry,
        location: cleanStr(parsed.location) || fallback.location,
        business_description: cleanStr(parsed.business_description) || fallback.business_description,
      };
    } catch (err) {
      // LLM failure / timeout — degrade to deterministic; never throw the run.
      console.warn(`[scan_extraction] LLM extraction failed (${err && err.message ? err.message : err}); using deterministic fallback`);
      return fallback;
    }
  },
};
