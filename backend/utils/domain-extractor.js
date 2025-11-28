/**
 * Domain Extraction and Normalization Utility
 *
 * Handles domain extraction from URLs and comparison logic for
 * determining if a scan is against the primary domain or a competitor.
 *
 * Rules:
 * - xeo.com = www.xeo.com = app.xeo.com = blog.xeo.com (same root domain)
 * - Extracts root domain (removes www, subdomains)
 * - Normalizes for consistent comparison
 */

const { URL } = require('url');
const axios = require('axios');

/**
 * Resolve a URL to its canonical form by following redirects
 *
 * This ensures consistent scanning regardless of how the user enters the URL:
 * - massivewebdesign.ca → https://www.massivewebdesign.ca
 * - www.massivewebdesign.ca → https://www.massivewebdesign.ca
 * - http://massivewebdesign.ca → https://www.massivewebdesign.ca
 *
 * GUARDRAILS:
 * - Different paths are preserved: /blog ≠ /pricing (separate scans)
 * - Subdomains are preserved: app.example.com ≠ example.com (different sites)
 * - Only normalizes: protocol (→https), www vs bare (via redirect), trailing slash
 * - Query params and hashes are stripped for canonical comparison
 * - If URL is inaccessible, falls back to normalized input
 *
 * @param {string} inputUrl - User-provided URL (may be missing protocol, www, etc.)
 * @returns {Promise<{canonicalUrl: string, inputUrl: string, redirected: boolean}>}
 */
async function resolveCanonicalUrl(inputUrl) {
  // Step 1: Normalize input - add protocol if missing
  let normalizedUrl = inputUrl.trim().toLowerCase();

  // Remove any trailing slashes for consistency
  normalizedUrl = normalizedUrl.replace(/\/+$/, '');

  // Add https:// if no protocol specified
  if (!normalizedUrl.match(/^https?:\/\//i)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  try {
    // Step 2: Follow redirects with a HEAD request to get final URL
    // HEAD is faster than GET and sufficient for redirect resolution
    const response = await axios.head(normalizedUrl, {
      timeout: 10000,
      maxRedirects: 10,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AI-Visibility-Tool/1.0; +https://visible2ai.com)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });

    // Get the final URL after all redirects
    // axios stores this in response.request.res.responseUrl
    let finalUrl = response.request?.res?.responseUrl || normalizedUrl;

    // Normalize the final URL
    const parsedFinal = new URL(finalUrl);

    // Build canonical URL: lowercase hostname, remove trailing slash from path
    let canonicalUrl = `${parsedFinal.protocol}//${parsedFinal.hostname.toLowerCase()}`;

    // Add path (remove trailing slash unless it's just "/")
    let path = parsedFinal.pathname;
    if (path !== '/' && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    if (path !== '/') {
      canonicalUrl += path;
    }

    // Note: We intentionally exclude query params and hash for canonical comparison
    // Most homepages should resolve to the same canonical regardless of tracking params

    console.log(`[URL Resolver] Input: "${inputUrl}" → Canonical: "${canonicalUrl}"`);

    return {
      canonicalUrl,
      inputUrl: inputUrl,
      normalizedInput: normalizedUrl,
      finalUrl: finalUrl,
      redirected: normalizedUrl !== finalUrl
    };

  } catch (error) {
    // If HEAD fails, try GET (some servers don't support HEAD)
    try {
      const response = await axios.get(normalizedUrl, {
        timeout: 10000,
        maxRedirects: 10,
        maxContentLength: 1024, // Only fetch first 1KB to check redirect
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AI-Visibility-Tool/1.0; +https://visible2ai.com)',
          'Accept': 'text/html,application/xhtml+xml'
        }
      });

      let finalUrl = response.request?.res?.responseUrl || normalizedUrl;
      const parsedFinal = new URL(finalUrl);

      let canonicalUrl = `${parsedFinal.protocol}//${parsedFinal.hostname.toLowerCase()}`;
      let path = parsedFinal.pathname;
      if (path !== '/' && path.endsWith('/')) {
        path = path.slice(0, -1);
      }
      if (path !== '/') {
        canonicalUrl += path;
      }

      console.log(`[URL Resolver] Input: "${inputUrl}" → Canonical: "${canonicalUrl}" (via GET fallback)`);

      return {
        canonicalUrl,
        inputUrl: inputUrl,
        normalizedInput: normalizedUrl,
        finalUrl: finalUrl,
        redirected: normalizedUrl !== finalUrl
      };

    } catch (getError) {
      // If both fail, return normalized input as canonical (best effort)
      console.warn(`[URL Resolver] Failed to resolve "${inputUrl}": ${getError.message}`);

      const parsedNormalized = new URL(normalizedUrl);
      const fallbackCanonical = `${parsedNormalized.protocol}//${parsedNormalized.hostname.toLowerCase()}`;

      return {
        canonicalUrl: fallbackCanonical,
        inputUrl: inputUrl,
        normalizedInput: normalizedUrl,
        finalUrl: normalizedUrl,
        redirected: false,
        error: getError.message
      };
    }
  }
}

/**
 * Extract root domain from a URL
 * Examples:
 * - https://www.xeo.com/page -> xeo.com
 * - https://app.xeo.com/dashboard -> xeo.com
 * - https://blog.xeo.com -> xeo.com
 * - https://xeo.com -> xeo.com
 *
 * @param {string} urlString - Full URL to extract domain from
 * @returns {string|null} Root domain or null if invalid
 */
function extractRootDomain(urlString) {
  try {
    // Parse URL
    const parsedUrl = new URL(urlString);
    let hostname = parsedUrl.hostname.toLowerCase();

    // Remove www prefix if present
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }

    // Split by dots
    const parts = hostname.split('.');

    // Handle different TLD cases
    if (parts.length >= 2) {
      // For most domains: example.com, example.co.uk, etc.
      // Take last 2 parts for standard TLDs (.com, .org, .net)
      // For country-code TLDs like .co.uk, this still works (co.uk)
      const rootDomain = parts.slice(-2).join('.');
      return rootDomain;
    }

    // If only one part (localhost), return as-is
    return hostname;
  } catch (error) {
    console.error('Error extracting domain from URL:', urlString, error.message);
    return null;
  }
}

/**
 * Check if two URLs belong to the same root domain
 *
 * @param {string} url1 - First URL
 * @param {string} url2 - Second URL
 * @returns {boolean} True if same root domain
 */
function isSameDomain(url1, url2) {
  const domain1 = extractRootDomain(url1);
  const domain2 = extractRootDomain(url2);

  if (!domain1 || !domain2) {
    return false;
  }

  return domain1 === domain2;
}

/**
 * Determine if a scan URL matches the user's primary domain
 *
 * @param {string} scanUrl - URL being scanned
 * @param {string} primaryDomain - User's primary root domain (e.g., "xeo.com")
 * @returns {boolean} True if scan URL matches primary domain
 */
function isPrimaryDomain(scanUrl, primaryDomain) {
  if (!primaryDomain) {
    return false; // No primary domain set yet
  }

  const scanDomain = extractRootDomain(scanUrl);

  if (!scanDomain) {
    return false;
  }

  // Normalize both for comparison
  return scanDomain.toLowerCase() === primaryDomain.toLowerCase();
}

/**
 * Get display-friendly domain name
 *
 * @param {string} urlString - Full URL
 * @returns {string} Display name (e.g., "xeo.com" or "www.example.com")
 */
function getDisplayDomain(urlString) {
  try {
    const parsedUrl = new URL(urlString);
    return parsedUrl.hostname.toLowerCase();
  } catch (error) {
    return urlString;
  }
}

/**
 * Validate that a URL is properly formatted
 *
 * @param {string} urlString - URL to validate
 * @returns {boolean} True if valid URL
 */
function isValidUrl(urlString) {
  try {
    new URL(urlString);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  extractRootDomain,
  isSameDomain,
  isPrimaryDomain,
  getDisplayDomain,
  isValidUrl,
  resolveCanonicalUrl
};
