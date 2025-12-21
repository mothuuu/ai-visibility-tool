const axios = require('axios');
const dns = require('dns').promises;
const { URL } = require('url');
const psl = require('psl');

/**
 * RULEBOOK v1.2 Step C1: Safe HTTP Utility
 * Provides SSRF protection and same-domain enforcement for outbound requests
 *
 * H1: Uses Public Suffix List for accurate domain extraction
 * H2: Manual redirect following with validation at each hop
 */

// Private/reserved IP ranges to block
const BLOCKED_IP_RANGES = [
  /^127\./,                          // Loopback
  /^10\./,                           // Private Class A
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // Private Class B
  /^192\.168\./,                     // Private Class C
  /^169\.254\./,                     // Link-local
  /^0\./,                            // "This" network
  /^::1$/,                           // IPv6 loopback
  /^fc00:/i,                         // IPv6 private
  /^fe80:/i                          // IPv6 link-local
];

const SAFE_HTTP_DEFAULTS = {
  timeout: 10000,
  maxRedirects: 5,
  maxResponseSize: 5 * 1024 * 1024,
  userAgent: 'AIVisibilityBot/1.0 (+https://visible2ai.com/bot)'
};

/**
 * Check if IP is in blocked range
 */
function isBlockedIP(ip) {
  return BLOCKED_IP_RANGES.some(pattern => pattern.test(ip));
}

/**
 * H1: Get registrable domain using Public Suffix List
 * Handles complex TLDs like .co.uk, .com.au, .github.io
 * @param {string} hostname - Hostname to extract domain from
 * @returns {string|null} Registrable domain or null
 */
function getRegistrableDomain(hostname) {
  if (!hostname) return null;

  // Remove port if present
  const cleanHost = hostname.split(':')[0].toLowerCase();

  // Use PSL to parse
  const parsed = psl.parse(cleanHost);

  if (parsed.error) {
    console.warn('[PSL] Parse error:', hostname, parsed.error);
    // Fallback to simple extraction
    const parts = cleanHost.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : cleanHost;
  }

  // Return the registrable domain (e.g., example.co.uk)
  return parsed.domain || cleanHost;
}

/**
 * H1: Check if two hostnames share the same registrable domain
 * @param {string} scanTargetUrl - Original scan target URL
 * @param {string} requestUrl - URL being requested
 * @returns {boolean} True if same registrable domain
 */
function isSameRegistrableDomain(scanTargetUrl, requestUrl) {
  try {
    const scanHost = new URL(scanTargetUrl).hostname;
    const requestHost = new URL(requestUrl).hostname;

    const scanDomain = getRegistrableDomain(scanHost);
    const requestDomain = getRegistrableDomain(requestHost);

    if (!scanDomain || !requestDomain) {
      return false;
    }

    return scanDomain === requestDomain;
  } catch (e) {
    console.warn('[DomainCheck] Parse error:', e.message);
    return false;
  }
}

/**
 * Check if a string is an IP address (v4 or v6)
 */
function isIPAddress(hostname) {
  // IPv4 pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  // IPv6 pattern (simplified)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv4Pattern.test(hostname) || ipv6Pattern.test(hostname);
}

/**
 * Verify URL doesn't resolve to blocked IP (SSRF protection)
 * Handles both hostnames (via DNS) and direct IP addresses
 */
async function checkSSRFSafe(hostname) {
  // If hostname is already an IP address, check it directly
  if (isIPAddress(hostname)) {
    if (isBlockedIP(hostname)) {
      return { safe: false, reason: `Blocked IP range: ${hostname}` };
    }
    return { safe: true };
  }

  // For hostnames, resolve via DNS
  try {
    const addresses = await dns.resolve4(hostname);
    for (const ip of addresses) {
      if (isBlockedIP(ip)) {
        return { safe: false, reason: `Blocked IP range: ${ip}` };
      }
    }
    return { safe: true };
  } catch (e) {
    // DNS resolution failed - allow through (will fail at request time)
    return { safe: true, warning: `DNS resolution failed: ${e.message}` };
  }
}

/**
 * H2: Check if status code is a redirect
 */
function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

/**
 * H2: Validate a redirect target URL
 * @param {string} targetUrl - Redirect target URL
 * @param {string} scanTargetUrl - Original scan target for domain comparison
 * @param {boolean} requireSameDomain - Whether to enforce same domain
 * @returns {Object} { safe: boolean, reason?: string }
 */
async function validateRedirectTarget(targetUrl, scanTargetUrl, requireSameDomain) {
  try {
    const targetUrlObj = new URL(targetUrl);

    // Domain check
    if (requireSameDomain && scanTargetUrl) {
      if (!isSameRegistrableDomain(scanTargetUrl, targetUrl)) {
        return { safe: false, reason: 'Redirect crosses domain boundary' };
      }
    }

    // SSRF check
    const ssrfCheck = await checkSSRFSafe(targetUrlObj.hostname);
    if (!ssrfCheck.safe) {
      return { safe: false, reason: `SSRF: ${ssrfCheck.reason}` };
    }

    return { safe: true };
  } catch (e) {
    return { safe: false, reason: `Invalid redirect URL: ${e.message}` };
  }
}

/**
 * H2: Make a safe HTTP request with redirect validation at each hop
 * @param {string} url - URL to request
 * @param {Object} options - Request options
 * @param {string} options.scanTargetUrl - Original scan target (for domain matching)
 * @param {boolean} options.requireSameDomain - Enforce same registrable domain
 */
async function safeRequest(url, options = {}) {
  const {
    method = 'GET',
    timeout = SAFE_HTTP_DEFAULTS.timeout,
    maxRedirects = SAFE_HTTP_DEFAULTS.maxRedirects,
    scanTargetUrl = null,
    requireSameDomain = false,
    headers = {}
  } = options;

  // Parse and validate initial URL
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch (e) {
    return { success: false, error: 'Invalid URL', data: null };
  }

  // Initial same-domain check
  if (requireSameDomain && scanTargetUrl) {
    if (!isSameRegistrableDomain(scanTargetUrl, url)) {
      console.warn('[SafeHTTP] Cross-domain blocked:', { scan: scanTargetUrl, request: url });
      return { success: false, error: 'Cross-domain request not allowed', data: null };
    }
  }

  // Initial SSRF check
  const initialCheck = await checkSSRFSafe(urlObj.hostname);
  if (!initialCheck.safe) {
    console.warn('[SafeHTTP] SSRF blocked (initial):', url, initialCheck.reason);
    return { success: false, error: `SSRF blocked: ${initialCheck.reason}`, data: null };
  }

  try {
    // Use manual redirect handling for validation
    const response = await axios({
      method,
      url,
      timeout,
      maxRedirects: 0,  // Disable auto-redirect
      maxContentLength: SAFE_HTTP_DEFAULTS.maxResponseSize,
      headers: {
        'User-Agent': SAFE_HTTP_DEFAULTS.userAgent,
        ...headers
      },
      validateStatus: () => true  // Accept all status codes
    });

    // Handle redirects manually
    let currentUrl = url;
    let currentResponse = response;
    let redirectCount = 0;
    const redirectChain = [];

    while (isRedirect(currentResponse.status) && redirectCount < maxRedirects) {
      const location = currentResponse.headers.location;
      if (!location) break;

      // Resolve relative redirects
      const nextUrl = new URL(location, currentUrl).toString();
      redirectChain.push({ from: currentUrl, to: nextUrl, status: currentResponse.status });

      // Validate redirect target
      const redirectValidation = await validateRedirectTarget(
        nextUrl,
        scanTargetUrl,
        requireSameDomain
      );

      if (!redirectValidation.safe) {
        console.warn('[SafeHTTP] Redirect blocked:', {
          from: currentUrl,
          to: nextUrl,
          reason: redirectValidation.reason
        });
        return {
          success: false,
          error: `Redirect blocked: ${redirectValidation.reason}`,
          data: null,
          blockedAt: nextUrl,
          redirectChain
        };
      }

      // Follow redirect
      currentResponse = await axios({
        method: method === 'POST' ? 'GET' : method,  // POST→GET on redirect
        url: nextUrl,
        timeout,
        maxRedirects: 0,
        maxContentLength: SAFE_HTTP_DEFAULTS.maxResponseSize,
        headers: {
          'User-Agent': SAFE_HTTP_DEFAULTS.userAgent,
          ...headers
        },
        validateStatus: () => true
      });

      currentUrl = nextUrl;
      redirectCount++;
    }

    // Final response
    return {
      success: currentResponse.status < 400,
      status: currentResponse.status,
      data: currentResponse.data,
      headers: currentResponse.headers,
      finalUrl: currentUrl,
      redirectCount,
      redirectChain: redirectChain.length > 0 ? redirectChain : undefined
    };

  } catch (e) {
    return { success: false, error: e.message, data: null };
  }
}

/**
 * Safe HEAD request
 */
async function safeHead(url, options = {}) {
  return safeRequest(url, { ...options, method: 'HEAD' });
}

/**
 * Safe GET request
 */
async function safeGet(url, options = {}) {
  return safeRequest(url, { ...options, method: 'GET' });
}

module.exports = {
  safeRequest,
  safeHead,
  safeGet,
  checkSSRFSafe,
  isBlockedIP,
  isIPAddress,
  isSameRegistrableDomain,
  getRegistrableDomain,
  validateRedirectTarget,
  isRedirect,
  SAFE_HTTP_DEFAULTS
};
