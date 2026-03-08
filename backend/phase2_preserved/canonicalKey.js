/**
 * CANONICAL KEY NORMALIZATION
 * File: backend/recommendations/canonicalKey.js
 *
 * Phase 4A.3c: Resolves recommendation objects to their canonical
 * fully-qualified Top 10 key (pillar.subfactor).
 *
 * Top 10 keys are fully qualified: e.g. "ai_readability.alt_text_coverage"
 * Runtime rec objects may provide:
 *   - rec_key (sometimes full, sometimes suffixed with ::scanId)
 *   - subfactor_key (often the full key, sometimes suffix only)
 *   - pillar_key + subfactor_key (constructable)
 */

const TOP_10_SUBFACTORS = require('./topSubfactors.phase4a3c.json').top10;
const TOP_10_SET = new Set(TOP_10_SUBFACTORS);

// Build suffix -> full key map for unique suffix matching
const SUFFIX_MAP = new Map();
for (const key of TOP_10_SUBFACTORS) {
  const parts = key.split('.');
  if (parts.length === 2) {
    const suffix = parts[1];
    if (SUFFIX_MAP.has(suffix)) {
      // Mark as ambiguous (multiple full keys share this suffix)
      SUFFIX_MAP.set(suffix, null);
    } else {
      SUFFIX_MAP.set(suffix, key);
    }
  }
}

/**
 * Resolve a recommendation object to its canonical Top 10 key.
 *
 * Matching rules (in priority order):
 * 1. rec.subfactor_key exactly matches a Top 10 entry
 * 2. rec.rec_key (before :: separator) exactly matches a Top 10 entry
 * 3. Constructed "${pillar_key}.${subfactor_key suffix}" matches
 * 4. subfactor_key suffix uniquely matches a Top 10 entry
 * 5. Otherwise null
 *
 * @param {Object} rec - Recommendation object
 * @param {string} [rec.subfactor_key]
 * @param {string} [rec.rec_key]
 * @param {string} [rec.pillar_key]
 * @param {string} [rec.pillar]
 * @param {string} [rec.category]
 * @returns {string|null} Fully qualified canonical key or null
 */
function getCanonicalKey(rec) {
  if (!rec) return null;

  // Rule 1: subfactor_key exact match
  if (rec.subfactor_key && TOP_10_SET.has(rec.subfactor_key)) {
    return rec.subfactor_key;
  }

  // Rule 2: rec_key (strip ::scanId suffix) exact match
  if (rec.rec_key) {
    const baseKey = rec.rec_key.split('::')[0];
    if (TOP_10_SET.has(baseKey)) {
      return baseKey;
    }
  }

  // Rule 3: Construct from pillar + subfactor suffix
  const pillarKey = rec.pillar_key || rec.pillar || rec.category || '';
  const subfactorSuffix = rec.subfactor_key ? rec.subfactor_key.split('.').pop() : '';

  if (pillarKey && subfactorSuffix) {
    // Normalize pillar key: convert display names to snake_case
    const normalizedPillar = normalizePillarKey(pillarKey);
    const constructed = `${normalizedPillar}.${subfactorSuffix}`;
    if (TOP_10_SET.has(constructed)) {
      return constructed;
    }
  }

  // Rule 4: Unique suffix match
  if (subfactorSuffix && SUFFIX_MAP.has(subfactorSuffix)) {
    const fullKey = SUFFIX_MAP.get(subfactorSuffix);
    if (fullKey !== null) { // null means ambiguous
      return fullKey;
    }
  }

  return null;
}

/**
 * Check if a recommendation is a Top 10 recommendation.
 *
 * @param {Object} rec - Recommendation object
 * @returns {boolean}
 */
function isTop10(rec) {
  return getCanonicalKey(rec) !== null;
}

/**
 * Normalize pillar display name to snake_case key.
 * e.g. "Technical Setup" -> "technical_setup"
 *      "AI Readability" -> "ai_readability"
 */
function normalizePillarKey(pillar) {
  if (!pillar || typeof pillar !== 'string') return '';

  // Already in snake_case
  if (/^[a-z_]+$/.test(pillar)) return pillar;

  return pillar
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .trim();
}

module.exports = {
  getCanonicalKey,
  isTop10,
  normalizePillarKey,
  TOP_10_SET,
  TOP_10_SUBFACTORS,
  SUFFIX_MAP
};
