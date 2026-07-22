'use strict';

/**
 * recommendationPricing.js — single source of truth for the paid
 * recommendation layer (token-gated "done-for-you" artifacts).
 *
 * Same discipline as config/models.js: price, unit, copy, AND the finding→
 * category mapping all live here. Adding a future category (faq, alt_text, …)
 * is a ONE-FILE change — cards and endpoints read from this config, never
 * hardcode a price or a finding-key list.
 *
 * Product model:
 *   Finding = FREE (the problem, evidence, why it matters, generic how-to).
 *   Recommendation = PAID (the generated artifact that did not exist before
 *   the unlock). Price below is what that unlock costs, in tokens.
 */

const RECOMMENDATION_PRICING = Object.freeze({
  schema: {
    tokens: 10,
    unit: 'per_scan_all_applicable', // one unlock = ALL applicable schema types for the scan
    label: 'Schema Markup Pack',
    description: 'All applicable JSON-LD schema for this scan, ready to paste',
    // A finding belongs to this paid category when its subfactor_key matches.
    // Kept here (not in cards/endpoints) so a new category is a one-file change.
    // Matches: technical_setup.organization_schema, organization_schema_missing,
    // structured_data_coverage, faq_schema_missing, breadcrumb_schema_missing, …
    subfactorKeyPattern: /schema|structured_data/i,
  },
  // future: faq, alt_text, ... — add here, nowhere else.
});

/**
 * Return the pricing/config entry for a recommendation type, or null.
 * @param {string} type
 */
function getPricing(type) {
  return RECOMMENDATION_PRICING[type] || null;
}

/**
 * Which paid category (if any) gates a finding identified by its subfactor_key.
 * @param {string} subfactorKey
 * @returns {string|null} category type e.g. 'schema'
 */
function categoryForSubfactorKey(subfactorKey) {
  const key = String(subfactorKey || '');
  if (!key) return null;
  for (const [type, cfg] of Object.entries(RECOMMENDATION_PRICING)) {
    if (cfg.subfactorKeyPattern && cfg.subfactorKeyPattern.test(key)) return type;
  }
  return null;
}

module.exports = {
  RECOMMENDATION_PRICING,
  getPricing,
  categoryForSubfactorKey,
};
