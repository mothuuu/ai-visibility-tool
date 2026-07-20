'use strict';

/**
 * evidenceItemList.js — reusable "specific evidence list" for the What-we-found
 * section of a finding.
 *
 * A finding is more executable when it names the exact items to fix ("these 7
 * files lack alt text") instead of a bare count. This module is the generic
 * machinery for that: a readable-path formatter and a capped list renderer,
 * plus a per-subfactor dispatch (`buildSpecificEvidenceBlock`) that selects the
 * items for a given finding and renders them.
 *
 * Alt-text is the first consumer. Author-bios (which pages) and OG tags (which
 * tags) can reuse the same primitives by adding a case to the dispatch — keep
 * the renderer generic, don't hardcode it to images.
 *
 * Read-time only: everything is derived from already-persisted scanEvidence.
 */

const { getEvidence, missingAltImages } = require('./evidenceHelpers');

// Default number of items shown before collapsing to "…and N more". Keeps the
// card usable when a page has dozens of offending items.
const DEFAULT_CAP = 12;

/**
 * Turn a raw image/page URL into a readable path: drop the origin (scheme +
 * host) and the query/hash, keep the full path so the file is findable. Never
 * truncates the filename itself. Relative or malformed values are returned with
 * just their query/hash stripped.
 *
 * @param {string} url
 * @returns {string}
 */
function formatReadablePath(url) {
  if (typeof url !== 'string') return '';
  const s = url.trim();
  if (!s) return '';
  try {
    // Absolute URL → pathname excludes origin + query + hash.
    const u = new URL(s);
    return u.pathname || s;
  } catch (_) {
    // Relative / protocol-relative / malformed: strip hash then query only.
    return s.split('#')[0].split('?')[0] || s;
  }
}

/**
 * Render a capped, readable, one-per-line list of specific evidence items.
 * Returns '' for an empty list (callers rely on this to omit the block rather
 * than render "0 items: []").
 *
 * @param {Array} items
 * @param {Object} [opts]
 * @param {number} [opts.cap=DEFAULT_CAP]
 * @param {(item:any)=>string} [opts.format] — item → display string
 * @param {string} [opts.bullet='• ']
 * @returns {string}
 */
function renderEvidenceList(items, opts = {}) {
  const { cap = DEFAULT_CAP, format = (x) => String(x), bullet = '• ' } = opts;
  const list = Array.isArray(items) ? items.filter(x => x != null) : [];
  if (list.length === 0) return '';

  const lines = list.slice(0, cap)
    .map(x => `${bullet}${format(x)}`)
    .filter(line => line !== bullet); // drop items that formatted to empty
  if (lines.length === 0) return '';

  const remaining = list.length - lines.length;
  if (remaining > 0) lines.push(`…and ${remaining} more`);
  return lines.join('\n');
}

/**
 * The scanned site's origin (scheme + host), for resolving relative image/page
 * paths to absolute URLs that open on the CLIENT site — never the app's own
 * origin. Derived from the scan's own URL/domain, in priority order.
 *
 * @param {Object} scanEvidence
 * @param {Object} [scan] - { url, domain }
 * @returns {string|null}
 */
function deriveScannedOrigin(scanEvidence, scan) {
  const ev = getEvidence(scanEvidence);
  const candidates = [ev && ev.url, scan && scan.url, scan && scan.domain];
  for (const c of candidates) {
    if (typeof c !== 'string' || !c.trim()) continue;
    const s = c.trim();
    try { return new URL(s).origin; } catch (_) { /* not absolute */ }
    try { return new URL('https://' + s.replace(/^\/+/, '')).origin; } catch (_) { /* give up */ }
  }
  return null;
}

/**
 * Resolve an image/page `src` to an absolute http(s) URL, using the scanned
 * origin for relative paths. Returns null when it can't be resolved to a real
 * link (data: URIs, non-http schemes, malformed, or a relative path with no
 * known origin) — the caller then renders plain text, never a broken link.
 *
 * @param {string} src
 * @param {string|null} origin - the scanned site's origin
 * @returns {string|null}
 */
function resolveAbsoluteUrl(src, origin) {
  if (typeof src !== 'string') return null;
  const s = src.trim();
  if (!s || s.toLowerCase().startsWith('data:')) return null;

  // Already absolute?
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch (_) { /* relative — resolve against the scanned origin */ }

  if (origin) {
    try {
      const u = new URL(s, origin);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
    } catch (_) { /* fall through */ }
  }
  return null;
}

/**
 * Build the specific-evidence block to append under a finding's What-we-found,
 * keyed by the finding's canonical subfactor. Returns '' when the finding has
 * no list treatment or the list is empty (so the caller appends nothing).
 *
 * The list uses the SAME filtered set the finding's count refers to, so the two
 * can never disagree.
 *
 * @param {string} canonicalKey - e.g. 'ai_readability.alt_text_coverage'
 * @param {Object} scanEvidence
 * @param {Object} [opts]
 * @returns {string}
 */
function buildSpecificEvidenceBlock(canonicalKey, scanEvidence, opts = {}) {
  const ev = getEvidence(scanEvidence);
  switch (canonicalKey) {
    case 'ai_readability.alt_text_coverage': {
      const missing = missingAltImages(ev);
      if (!missing.length) return ''; // suppressed elsewhere; never render empty
      return renderEvidenceList(missing, {
        cap: opts.cap || DEFAULT_CAP,
        format: (img) => formatReadablePath(img && img.src),
      });
    }
    default:
      return '';
  }
}

/**
 * Structured variant of the specific-evidence list, for the frontend to render
 * as clickable links. Each item carries a short readable `label` (display text)
 * and an absolute `url` (link target on the SCANNED site) — or url:null when it
 * can't be resolved, so the frontend renders that item as plain text.
 *
 * The FULL filtered set is returned (no server-side cap): the frontend shows the
 * first N by default and reveals the rest via an in-place "Show all" toggle, so
 * every link must already be in the payload. Same filtered set as
 * buildSpecificEvidenceBlock, so text and links agree. `moreCount` is retained
 * (0) for payload-shape compatibility. Generic given an absolute-URL resolver —
 * other findings add a case here.
 *
 * @param {string} canonicalKey
 * @param {Object} scanEvidence
 * @param {Object} [opts] - { scan, origin }
 * @returns {{ items: Array<{label:string,url:string|null}>, moreCount: number } | null}
 */
function buildSpecificEvidenceItems(canonicalKey, scanEvidence, opts = {}) {
  const ev = getEvidence(scanEvidence);
  const origin = opts.origin || deriveScannedOrigin(ev, opts.scan);

  switch (canonicalKey) {
    case 'ai_readability.alt_text_coverage': {
      const missing = missingAltImages(ev);
      if (!missing.length) return null;
      const items = missing
        .map(img => ({
          label: formatReadablePath(img && img.src),
          url: resolveAbsoluteUrl(img && img.src, origin),
        }))
        .filter(it => it.label);
      if (!items.length) return null;
      return { items, moreCount: 0 };
    }
    default:
      return null;
  }
}

module.exports = {
  DEFAULT_CAP,
  formatReadablePath,
  renderEvidenceList,
  deriveScannedOrigin,
  resolveAbsoluteUrl,
  buildSpecificEvidenceBlock,
  buildSpecificEvidenceItems,
};
