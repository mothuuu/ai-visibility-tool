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
 * H3: IPv6 SSRF coverage with dual-stack DNS resolution
 */

// Private/reserved IPv4 ranges to block
const BLOCKED_IPV4_RANGES = [
  /^127\./,                          // Loopback
  /^10\./,                           // Private Class A
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // Private Class B
  /^192\.168\./,                     // Private Class C
  /^169\.254\./,                     // Link-local
  /^0\./                             // "This" network
];

const SAFE_HTTP_DEFAULTS = {
  timeout: 10000,
  maxRedirects: 5,
  maxResponseSize: 5 * 1024 * 1024,
  userAgent: 'AIVisibilityBot/1.0 (+https://visible2ai.com/bot)'
};

/**
 * Check if IPv4 address is in blocked range
 */
function isBlockedIP(ip) {
  return BLOCKED_IPV4_RANGES.some(pattern => pattern.test(ip));
}

/**
 * Convert hex-encoded IPv4 (like 7f00:1) to dotted decimal (127.0.0.1)
 */
function hexIPv4ToDecimal(hexPart) {
  // Format is XXXX:XXXX where each X is a hex digit
  // e.g., 7f00:1 = 127.0.0.1
  const parts = hexPart.split(':');
  if (parts.length !== 2) return null;

  try {
    const high = parseInt(parts[0] || '0', 16);
    const low = parseInt(parts[1] || '0', 16);

    const b1 = (high >> 8) & 0xff;
    const b2 = high & 0xff;
    const b3 = (low >> 8) & 0xff;
    const b4 = low & 0xff;

    return `${b1}.${b2}.${b3}.${b4}`;
  } catch (e) {
    return null;
  }
}

/**
 * H3: Check if IPv6 address is in blocked range
 * Handles loopback, link-local, unique local, and IPv4-mapped addresses
 */
function isBlockedIPv6(ip) {
  const normalized = ip.toLowerCase();

  // Loopback (::1)
  if (normalized === '::1') return true;

  // Unspecified (::)
  if (normalized === '::') return true;

  // Link-local (fe80::/10)
  if (normalized.startsWith('fe80:')) return true;

  // Unique local (fc00::/7 - includes fc00::/8 and fd00::/8)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // IPv4-mapped IPv6 - dotted decimal format (::ffff:127.0.0.1)
  const ipv4DottedMatch = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4DottedMatch) {
    return isBlockedIP(ipv4DottedMatch[1]);
  }

  // IPv4-mapped IPv6 - hex format (::ffff:7f00:1)
  const ipv4HexMatch = normalized.match(/^::ffff:([0-9a-f]+:[0-9a-f]+)$/);
  if (ipv4HexMatch) {
    const ipv4 = hexIPv4ToDecimal(ipv4HexMatch[1]);
    if (ipv4) {
      return isBlockedIP(ipv4);
    }
  }

  // IPv4-compatible IPv6 (deprecated but check anyway: ::x.x.x.x)
  const ipv4CompatMatch = normalized.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4CompatMatch) {
    return isBlockedIP(ipv4CompatMatch[1]);
  }

  return false;
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
 * Check if a string is an IPv4 address
 */
function isIPv4Address(hostname) {
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  return ipv4Pattern.test(hostname);
}

/**
 * Check if a string is an IPv6 address
 * Handles both raw IPv6 and bracketed notation from URLs
 */
function isIPv6Address(hostname) {
  // Remove brackets if present (URLs use [::1] format)
  let ip = hostname;
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }

  // Matches standard IPv6, compressed (::), and IPv4-mapped (::ffff:x.x.x.x)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  const ipv4MappedPattern = /^::ffff:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i;
  return ipv6Pattern.test(ip) || ipv4MappedPattern.test(ip);
}

/**
 * Check if a string is an IP address (v4 or v6)
 */
function isIPAddress(hostname) {
  return isIPv4Address(hostname) || isIPv6Address(hostname);
}

/**
 * Strip brackets from IPv6 hostname (URLs use [::1] format)
 */
function stripIPv6Brackets(hostname) {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/**
 * H3: Verify URL doesn't resolve to blocked IP (SSRF protection)
 * Handles both hostnames (via DNS) and direct IP addresses
 * Checks both IPv4 and IPv6 records for comprehensive protection
 */
async function checkSSRFSafe(hostname) {
  // If hostname is already an IP address, check it directly
  if (isIPv4Address(hostname)) {
    if (isBlockedIP(hostname)) {
      return { safe: false, reason: `Blocked IPv4: ${hostname}` };
    }
    return { safe: true };
  }

  if (isIPv6Address(hostname)) {
    // Strip brackets for checking
    const ipv6 = stripIPv6Brackets(hostname);
    if (isBlockedIPv6(ipv6)) {
      return { safe: false, reason: `Blocked IPv6: ${ipv6}` };
    }
    return { safe: true };
  }

  // For hostnames, resolve via DNS (both IPv4 and IPv6)
  const results = { safe: true, checkedIPv4: false, checkedIPv6: false };

  // Check IPv4 (A records)
  try {
    const ipv4Addresses = await dns.resolve4(hostname);
    results.checkedIPv4 = true;

    for (const ip of ipv4Addresses) {
      if (isBlockedIP(ip)) {
        return { safe: false, reason: `Blocked IPv4: ${ip}` };
      }
    }
  } catch (e) {
    // No IPv4 records - that's OK
    results.ipv4Error = e.code;
  }

  // Check IPv6 (AAAA records)
  try {
    const ipv6Addresses = await dns.resolve6(hostname);
    results.checkedIPv6 = true;

    for (const ip of ipv6Addresses) {
      if (isBlockedIPv6(ip)) {
        return { safe: false, reason: `Blocked IPv6: ${ip}` };
      }
    }
  } catch (e) {
    // No IPv6 records - that's OK
    results.ipv6Error = e.code;
  }

  // If we couldn't resolve ANY addresses, allow through (will fail at connection)
  if (!results.checkedIPv4 && !results.checkedIPv6) {
    return { safe: true, warning: 'DNS resolution failed for both IPv4 and IPv6' };
  }

  return { safe: true };
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
  isBlockedIPv6,
  isIPAddress,
  isIPv4Address,
  isIPv6Address,
  isSameRegistrableDomain,
  getRegistrableDomain,
  validateRedirectTarget,
  isRedirect,
  SAFE_HTTP_DEFAULTS
};
