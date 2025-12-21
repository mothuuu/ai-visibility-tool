/**
 * URL Canonicalizer Utility
 *
 * RULEBOOK v1.2 Step C4: Enhanced with redirect following and canonical tag parsing
 *
 * Normalizes URLs for consistent comparison and deduplication:
 * - Forces HTTPS
 * - Removes www prefix
 * - Removes trailing slashes (except root)
 * - Strips tracking parameters
 * - Removes hash fragments
 * - Follows redirects and extracts canonical tags
 */

const { URL } = require('url');
const { safeGet } = require('./safe-http');

function canonicalizeUrl(urlString) {
  let normalized = urlString.trim();
  if (!normalized.match(/^https?:\/\//i)) {
    normalized = 'https://' + normalized;
  }

  try {
    const url = new URL(normalized);
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase();

    // Remove www
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.substring(4);
    }

    // Remove trailing slash (except root)
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    // Remove tracking params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref'];
    trackingParams.forEach(p => url.searchParams.delete(p));

    url.hash = '';
    return url.toString();
  } catch (e) {
    return normalized;
  }
}

function urlsAreEquivalent(url1, url2) {
  return canonicalizeUrl(url1) === canonicalizeUrl(url2);
}

/**
 * RULEBOOK v1.2 Step C5: Generate cache key from canonical URL
 * Used for consistent cache lookups regardless of input URL format
 * @param {string} url - URL to generate cache key for
 * @returns {string} Normalized cache key
 */
function getCacheKey(url) {
  const canonical = canonicalizeUrl(url);
  // Remove protocol for cache key to handle http/https variations
  return canonical.replace(/^https?:\/\//, '').toLowerCase();
}

/**
 * RULEBOOK v1.2 Step C4: Full canonicalization with redirect following
 * Returns metadata about the URL journey
 * @param {string} inputUrl - URL to canonicalize
 * @param {Object} options - Options (maxRedirects, timeout)
 * @returns {Object} Canonicalization result with redirect chain
 */
async function canonicalizeWithRedirects(inputUrl, options = {}) {
  const { maxRedirects = 5, timeout = 10000 } = options;

  const normalized = canonicalizeUrl(inputUrl);

  const result = {
    requestedUrl: inputUrl,
    normalizedUrl: normalized,
    finalUrl: null,
    canonicalUrl: null,
    redirectChain: [],
    error: null
  };

  try {
    const response = await safeGet(normalized, {
      maxRedirects,
      timeout,
      requireSameDomain: false  // Allow redirects to different subdomains
    });

    if (!response.success) {
      result.error = response.error;
      result.finalUrl = normalized;
      result.canonicalUrl = normalized;
      return result;
    }

    result.finalUrl = response.finalUrl || normalized;

    // Parse canonical tag from HTML
    if (typeof response.data === 'string') {
      const canonicalInfo = parseCanonicalTag(response.data, result.finalUrl);
      if (canonicalInfo) {
        result.canonicalUrl = canonicalInfo.url;
        result.canonicalSource = canonicalInfo.source;
        result.canonicalWarnings = canonicalInfo.warnings;
      }
    }

    // Prefer: canonical tag > final URL > normalized
    result.canonicalUrl = result.canonicalUrl || result.finalUrl || normalized;

  } catch (e) {
    result.error = e.message;
    result.finalUrl = normalized;
    result.canonicalUrl = normalized;
  }

  return result;
}

/**
 * RULEBOOK v1.2 Step C4: Parse canonical tag with edge case handling
 * @param {string} html - HTML content
 * @param {string} baseUrl - Base URL for resolving relative URLs
 * @returns {Object|null} Canonical info with url, source, warnings
 */
function parseCanonicalTag(html, baseUrl) {
  const warnings = [];

  // Find all canonical tags
  const matches = [...html.matchAll(/<link[^>]+rel=["']canonical["'][^>]*>/gi)];

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    warnings.push(`Multiple canonical tags found (${matches.length}), using first`);
    console.log(`[Canonicalizer] Warning: Multiple canonical tags found (${matches.length})`);
  }

  // Extract href from first match
  const hrefMatch = matches[0][0].match(/href=["']([^"']+)["']/i);
  if (!hrefMatch) {
    return null;
  }

  let canonicalHref = hrefMatch[1];

  // Handle relative URLs
  if (canonicalHref.startsWith('/')) {
    try {
      const base = new URL(baseUrl);
      canonicalHref = `${base.protocol}//${base.host}${canonicalHref}`;
      warnings.push('Canonical was relative URL, resolved against base');
      console.log(`[Canonicalizer] Resolved relative canonical: ${canonicalHref}`);
    } catch (e) {
      warnings.push('Failed to resolve relative canonical URL');
    }
  }

  // Check for cross-domain canonical
  try {
    const baseHost = new URL(baseUrl).hostname;
    const canonicalHost = new URL(canonicalHref).hostname;
    if (baseHost !== canonicalHost) {
      warnings.push(`Cross-domain canonical: ${baseHost} → ${canonicalHost}`);
      console.log(`[Canonicalizer] Warning: Cross-domain canonical: ${baseHost} → ${canonicalHost}`);
    }
  } catch (e) {
    // Ignore parse errors
  }

  return {
    url: canonicalHref,
    source: 'link-tag',
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

module.exports = {
  canonicalizeUrl,
  urlsAreEquivalent,
  getCacheKey,
  canonicalizeWithRedirects,
  parseCanonicalTag
};
