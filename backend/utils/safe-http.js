const axios = require('axios');
const dns = require('dns').promises;
const { URL } = require('url');

/**
 * RULEBOOK v1.2 Step C1: Safe HTTP Utility
 * Provides SSRF protection and same-domain enforcement for outbound requests
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
 * Get registrable domain (e.g., example.com from www.sub.example.com)
 */
function getRegistrableDomain(hostname) {
  const parts = hostname.toLowerCase().split('.');
  // Simple extraction - for complex TLDs, use 'psl' library
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }
  return hostname;
}

/**
 * Verify URL doesn't resolve to blocked IP (SSRF protection)
 */
async function checkSSRFSafe(hostname) {
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
 * Check if request URL is on same registrable domain as scan target
 */
function isSameRegistrableDomain(scanTargetUrl, requestUrl) {
  try {
    const scanDomain = getRegistrableDomain(new URL(scanTargetUrl).hostname);
    const requestDomain = getRegistrableDomain(new URL(requestUrl).hostname);
    return scanDomain === requestDomain;
  } catch (e) {
    return false;
  }
}

/**
 * Make a safe HTTP request with SSRF protection
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

  // Parse URL
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch (e) {
    return { success: false, error: 'Invalid URL', data: null };
  }

  // Same-domain check (if required)
  if (requireSameDomain && scanTargetUrl) {
    if (!isSameRegistrableDomain(scanTargetUrl, url)) {
      console.warn('[SafeHTTP] Cross-domain request blocked:', { scanTarget: scanTargetUrl, requested: url });
      return { success: false, error: 'Cross-domain request not allowed', data: null };
    }
  }

  // SSRF check
  const ssrfCheck = await checkSSRFSafe(urlObj.hostname);
  if (!ssrfCheck.safe) {
    console.warn('[SafeHTTP] SSRF blocked:', url, ssrfCheck.reason);
    return { success: false, error: `SSRF blocked: ${ssrfCheck.reason}`, data: null };
  }

  try {
    const response = await axios({
      method,
      url,
      timeout,
      maxRedirects,
      maxContentLength: SAFE_HTTP_DEFAULTS.maxResponseSize,
      headers: {
        'User-Agent': SAFE_HTTP_DEFAULTS.userAgent,
        ...headers
      },
      validateStatus: s => s < 500
    });

    return {
      success: true,
      status: response.status,
      data: response.data,
      headers: response.headers,
      finalUrl: response.request?.res?.responseUrl || url
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
  isSameRegistrableDomain,
  getRegistrableDomain,
  SAFE_HTTP_DEFAULTS
};
