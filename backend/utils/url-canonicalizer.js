/**
 * URL Canonicalizer Utility
 *
 * Normalizes URLs for consistent comparison and deduplication:
 * - Forces HTTPS
 * - Removes www prefix
 * - Removes trailing slashes (except root)
 * - Strips tracking parameters
 * - Removes hash fragments
 */

const { URL } = require('url');

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

module.exports = { canonicalizeUrl, urlsAreEquivalent };
