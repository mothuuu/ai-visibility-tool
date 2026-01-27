/**
 * STRICT PLACEHOLDER RESOLVER
 * File: backend/recommendations/placeholderResolver.js
 *
 * Phase 4A.3c: Strict placeholder resolution with zero-leak guarantee.
 *
 * Rules:
 * - Never output {{...}} in final text
 * - Never output [placeholder_name] in final text
 * - Never output "undefined" or "null" as literal strings
 * - Unresolved placeholders are replaced with safe fallbacks or empty string
 */

// ========================================
// GLOBAL SAFE FALLBACKS
// ========================================

const SAFE_FALLBACKS = Object.freeze({
  domain: 'your website',
  company_name: 'your company',
  site_url: '',
  page_url: '',
  pages_checked_count: 'multiple',
  pages_checked_list: 'homepage and key pages',
  faq_count: '0',
  error_count: 'some',
  logo_url: '',
  primary_faq_page: 'your FAQ page',
  industry: 'your industry',
  product_name: 'your product',
  product_type: 'solution',
  icp_roles: 'decision-makers',
  region: '',
  page_title: 'your page',
  page_description: '',
  og_image_url: '',
  linkedin_url: '',
  twitter_url: '',
  heading_count: 'several',
  total_images: 'several',
  images_with_alt: 'some',
  images_without_alt: 'some',
  schema_count: '0',
  ttfb: 'unknown',
  heading_issues: 'heading structure issues detected',
  current_date: new Date().toISOString().split('T')[0],
  last_updated_date: '',
  iso_date: '',
  year: String(new Date().getFullYear()),
  industry_specific_schema: 'Service',
  relevant_certs: 'relevant industry certifications',
  topic: 'your specialty',
  pain_point: 'common challenges',
  author_name: 'your team expert',
  author_title: 'Subject Matter Expert',
  years: 'several',
  error_summary: 'validation issues detected',
  detection_state: '',
  missing_schemas: 'key schemas',
  crawl_issues: 'access restrictions detected'
});

// ========================================
// CORE RESOLVER
// ========================================

/**
 * Resolve a single template string.
 *
 * Template can be:
 * - A plain string with {{key}} placeholders
 * - An object keyed by detection state: { NOT_FOUND: "...", default: "..." }
 *
 * @param {string|Object} template - Template string or state-keyed object
 * @param {Object} context - Placeholder context (key→value)
 * @param {Object} [options]
 * @param {string} [options.detectionState] - Detection state for state-keyed templates
 * @param {Object} [options.perEntryResolvers] - Per-entry resolver map (key→function)
 * @returns {string} - Resolved string with zero placeholder leaks
 */
function resolveTemplate(template, context, options = {}) {
  if (!template) return '';

  // Handle state-keyed template objects
  let templateStr;
  if (typeof template === 'object' && template !== null && !Array.isArray(template)) {
    const state = options.detectionState || 'default';
    templateStr = template[state] || template.default || template[Object.keys(template)[0]] || '';
  } else if (typeof template === 'string') {
    templateStr = template;
  } else {
    return '';
  }

  const ctx = context || {};
  const perEntry = options.perEntryResolvers || {};

  // Replace {{placeholder}} patterns
  let result = templateStr.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();

    // 1. Try per-entry resolver
    if (typeof perEntry[trimmedKey] === 'function') {
      const val = perEntry[trimmedKey](ctx);
      if (isUsableValue(val)) return String(val);
    }

    // 2. Try context (supports dot-notation paths)
    const ctxVal = getPath(ctx, trimmedKey);
    if (isUsableValue(ctxVal)) return String(ctxVal);

    // 3. Try global safe fallbacks
    if (SAFE_FALLBACKS[trimmedKey] !== undefined) {
      return SAFE_FALLBACKS[trimmedKey];
    }

    // 4. Replace with empty string (NEVER leave {{...}})
    return '';
  });

  // Clean up artifacts from empty replacements
  result = cleanupText(result);

  return result;
}

/**
 * Resolve placeholders in an array of template strings
 * @param {string[]} templates
 * @param {Object} context
 * @param {Object} [options]
 * @returns {string[]}
 */
function resolveTemplateArray(templates, context, options = {}) {
  if (!Array.isArray(templates)) return [];
  return templates
    .map(t => resolveTemplate(t, context, options))
    .filter(t => t.trim().length > 0);
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Check if a value is usable (not null, undefined, empty, or literal "undefined"/"null")
 */
function isUsableValue(val) {
  if (val === null || val === undefined) return false;
  if (val === '') return false;
  const str = String(val);
  if (str === 'undefined' || str === 'null') return false;
  return true;
}

/**
 * Get nested value from object using dot-notation path
 * @param {Object} obj
 * @param {string} path - e.g. "company.name" or "metadata.title"
 * @returns {*}
 */
function getPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, obj);
}

/**
 * Clean up text artifacts from empty placeholder replacements:
 * - Double spaces → single space
 * - Trailing/leading whitespace
 * - Orphaned punctuation (". ." → ".")
 * - Empty parentheses "()" → ""
 */
function cleanupText(text) {
  if (!text) return '';
  return text
    .replace(/\(\s*\)/g, '')           // remove empty parens
    .replace(/\[\s*\]/g, '')           // remove empty brackets
    .replace(/\s{2,}/g, ' ')          // collapse multiple spaces
    .replace(/\.\s*\./g, '.')          // collapse double periods
    .replace(/,\s*,/g, ',')           // collapse double commas
    .replace(/,\s*\./g, '.')          // comma-period → period
    .replace(/\s+([.,;:!?])/g, '$1') // remove space before punctuation
    .trim();
}

// ========================================
// VALIDATION (LEAK DETECTION)
// ========================================

/**
 * Validate that no placeholder leaks exist in the output.
 *
 * Checks for:
 * - {{...}} unresolved mustache templates
 * - [placeholder_name] bracket placeholders
 * - Literal "undefined" or "null" strings
 *
 * @param {*} obj - Any JSON-serializable value
 * @returns {{ valid: boolean, leaks: string[] }}
 */
function validateNoPlaceholderLeaks(obj) {
  const leaks = [];
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj || '');

  // Check for unresolved {{...}}
  const mustacheMatches = str.match(/\{\{[^}]+\}\}/g);
  if (mustacheMatches) {
    for (const m of mustacheMatches) {
      leaks.push(`Unresolved mustache: ${m}`);
    }
  }

  // Check for [placeholder_name] patterns (but not markdown links or arrays)
  // Match [word_word] but not [text](url) or ["value"] or [0]
  const bracketRegex = /\[([a-zA-Z][a-zA-Z0-9_]{2,})\](?!\()/g;
  let bracketMatch;
  while ((bracketMatch = bracketRegex.exec(str)) !== null) {
    const inner = bracketMatch[1];
    // Skip common non-placeholder patterns
    if (['README', 'TODO', 'FIXME', 'NOTE', 'WARN', 'INFO', 'DEBUG', 'ERROR'].includes(inner.toUpperCase())) continue;
    // Skip if it looks like a heading anchor
    if (inner.length > 30) continue;
    leaks.push(`Bracket placeholder: [${inner}]`);
  }

  // Check for literal "undefined" or "null" as standalone values
  const undefinedRegex = /(?:^|[":,\s])(?:undefined|null)(?:[":,\s}]|$)/g;
  // Only flag if it appears as a string value, not as JSON null
  if (/"undefined"/.test(str)) {
    leaks.push('Literal string "undefined" detected');
  }
  if (/"null"/.test(str)) {
    // Distinguish JSON null from string "null"
    const nullStringRegex = /:\s*"null"/g;
    if (nullStringRegex.test(str)) {
      leaks.push('Literal string "null" detected as value');
    }
  }

  return {
    valid: leaks.length === 0,
    leaks
  };
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  resolveTemplate,
  resolveTemplateArray,
  validateNoPlaceholderLeaks,
  isUsableValue,
  getPath,
  cleanupText,
  SAFE_FALLBACKS
};
