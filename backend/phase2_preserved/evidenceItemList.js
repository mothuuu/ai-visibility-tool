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

module.exports = {
  DEFAULT_CAP,
  formatReadablePath,
  renderEvidenceList,
  buildSpecificEvidenceBlock,
};
