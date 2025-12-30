/**
 * Duplicate Checker Service
 * Phase 4: Check if a business is already listed in a directory before queueing submission
 *
 * Outcomes:
 *   - match_found: Confident duplicate exists → mark already_listed
 *   - no_match: No duplicate found → eligible for submission
 *   - possible_match: Ambiguous result → do not queue, do not consume
 *   - error: Check failed → do not queue, do not consume
 *   - skipped: Check not performed → do not queue, do not consume
 *
 * Safety Rules:
 *   - Never scrape Google (site_search treated as skipped)
 *   - Always store structured evidence
 *   - Rate limit respectful with backoff
 *   - Cache recent checks
 */

const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../db');

// =============================================================================
// CONSTANTS
// =============================================================================

const DUPLICATE_CHECK_STATUSES = {
  MATCH_FOUND: 'match_found',
  NO_MATCH: 'no_match',
  POSSIBLE_MATCH: 'possible_match',
  ERROR: 'error',
  SKIPPED: 'skipped'
};

// Rate limiting configuration
const RATE_LIMIT = {
  MAX_CONCURRENT: 3,
  DELAY_BETWEEN_REQUESTS_MS: 1000,
  BACKOFF_BASE_MS: 2000,
  MAX_RETRIES: 2
};

// Cache configuration (in-memory for MVP, could use Redis later)
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const checkCache = new Map();

// Request timeout
const REQUEST_TIMEOUT_MS = 10000;

// Confidence thresholds
const CONFIDENCE = {
  HIGH: 0.9,    // Confident match
  MEDIUM: 0.7,  // Possible match
  LOW: 0.5      // Unlikely match
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate cache key for a duplicate check
 */
function getCacheKey(businessProfile, directoryId) {
  const businessKey = businessProfile.name?.toLowerCase().trim() || '';
  const urlKey = businessProfile.website_url?.toLowerCase().trim() || '';
  return `${directoryId}:${businessKey}:${urlKey}`;
}

/**
 * Check if a cached result is still valid
 */
function getCachedResult(cacheKey) {
  const cached = checkCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }
  if (cached) {
    checkCache.delete(cacheKey);
  }
  return null;
}

/**
 * Store result in cache
 */
function cacheResult(cacheKey, result) {
  checkCache.set(cacheKey, {
    timestamp: Date.now(),
    result
  });

  // Cleanup old entries periodically (keep cache size manageable)
  if (checkCache.size > 1000) {
    const now = Date.now();
    for (const [key, value] of checkCache.entries()) {
      if (now - value.timestamp > CACHE_TTL_MS) {
        checkCache.delete(key);
      }
    }
  }
}

/**
 * Replace tokens in search URL template
 * Tokens: {business_name}, {website_domain}, {slug}
 */
function buildSearchUrl(template, businessProfile) {
  if (!template) return null;

  const businessName = businessProfile.name || '';
  const websiteUrl = businessProfile.website_url || '';

  // Extract domain from website URL
  let websiteDomain = '';
  try {
    if (websiteUrl) {
      const url = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
      websiteDomain = url.hostname.replace(/^www\./, '');
    }
  } catch (e) {
    websiteDomain = websiteUrl;
  }

  // Create URL-friendly slug
  const slug = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return template
    .replace(/\{business_name\}/g, encodeURIComponent(businessName))
    .replace(/\{website_domain\}/g, encodeURIComponent(websiteDomain))
    .replace(/\{slug\}/g, encodeURIComponent(slug));
}

/**
 * Calculate string similarity (Jaccard index on words)
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  const words1 = new Set(str1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(str2.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Check if URL domains match
 */
function domainsMatch(url1, url2) {
  if (!url1 || !url2) return false;

  try {
    const domain1 = new URL(url1.startsWith('http') ? url1 : `https://${url1}`).hostname.replace(/^www\./, '');
    const domain2 = new URL(url2.startsWith('http') ? url2 : `https://${url2}`).hostname.replace(/^www\./, '');
    return domain1 === domain2;
  } catch (e) {
    return false;
  }
}

/**
 * Make HTTP request with retry and backoff
 */
async function fetchWithRetry(url, retries = RATE_LIMIT.MAX_RETRIES) {
  const startTime = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AIVisibilityBot/1.0; +https://aivis.io)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        },
        maxRedirects: 3,
        validateStatus: status => status < 500
      });

      return {
        success: true,
        status: response.status,
        data: response.data,
        responseTimeMs: Date.now() - startTime
      };
    } catch (error) {
      if (attempt < retries) {
        const backoffMs = RATE_LIMIT.BACKOFF_BASE_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      return {
        success: false,
        error: error.message,
        responseTimeMs: Date.now() - startTime
      };
    }
  }
}

// =============================================================================
// SEARCH HANDLERS BY TYPE
// =============================================================================

/**
 * Handle internal_search: Fetch directory's search page and parse results
 */
async function handleInternalSearch(directory, businessProfile) {
  const searchUrl = buildSearchUrl(directory.search_url_template, businessProfile);

  if (!searchUrl) {
    return {
      status: DUPLICATE_CHECK_STATUSES.SKIPPED,
      evidence: {
        reason: 'No search URL template configured',
        method: 'internal_search',
        checked_at: new Date().toISOString()
      }
    };
  }

  const fetchResult = await fetchWithRetry(searchUrl);

  if (!fetchResult.success) {
    return {
      status: DUPLICATE_CHECK_STATUSES.ERROR,
      evidence: {
        search_url: searchUrl,
        error: fetchResult.error,
        method: 'internal_search',
        response_time_ms: fetchResult.responseTimeMs,
        checked_at: new Date().toISOString()
      }
    };
  }

  // Check for non-200 responses
  if (fetchResult.status !== 200) {
    return {
      status: DUPLICATE_CHECK_STATUSES.ERROR,
      evidence: {
        search_url: searchUrl,
        error: `HTTP ${fetchResult.status}`,
        method: 'internal_search',
        response_time_ms: fetchResult.responseTimeMs,
        checked_at: new Date().toISOString()
      }
    };
  }

  // Parse HTML and look for matches
  const $ = cheerio.load(fetchResult.data);
  const businessName = businessProfile.name?.toLowerCase() || '';
  const websiteUrl = businessProfile.website_url?.toLowerCase() || '';

  // Common selectors for search results
  const resultSelectors = [
    '.search-result', '.result', '.listing', '.product', '.tool',
    '[class*="result"]', '[class*="listing"]', '[class*="card"]',
    'article', '.item', '.entry'
  ];

  let bestMatch = null;
  let bestConfidence = 0;

  // Try different selectors
  for (const selector of resultSelectors) {
    $(selector).each((_, element) => {
      const $el = $(element);
      const text = $el.text().toLowerCase();
      const links = $el.find('a[href]').map((_, a) => $(a).attr('href')).get();

      // Check for name match
      const nameSimilarity = calculateSimilarity(businessName, text);

      // Check for URL match
      const urlMatch = links.some(link => {
        if (!link) return false;
        return domainsMatch(link, websiteUrl) || domainsMatch(link, businessProfile.website_url);
      });

      // Calculate overall confidence
      let confidence = 0;
      let matchReason = [];

      if (urlMatch) {
        confidence = Math.max(confidence, CONFIDENCE.HIGH);
        matchReason.push('URL match');
      }

      if (nameSimilarity > 0.8) {
        confidence = Math.max(confidence, CONFIDENCE.HIGH);
        matchReason.push(`Name similarity: ${(nameSimilarity * 100).toFixed(0)}%`);
      } else if (nameSimilarity > 0.5) {
        confidence = Math.max(confidence, CONFIDENCE.MEDIUM);
        matchReason.push(`Name similarity: ${(nameSimilarity * 100).toFixed(0)}%`);
      }

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestMatch = {
          excerpt: text.slice(0, 200),
          url: links.find(l => l && l.startsWith('http')) || links[0] || null,
          matchReason: matchReason.join(', ')
        };
      }
    });

    // Stop if we found a high-confidence match
    if (bestConfidence >= CONFIDENCE.HIGH) break;
  }

  // Also check the entire page for our business name/URL
  const pageText = $('body').text().toLowerCase();
  if (pageText.includes(businessName) || (websiteUrl && pageText.includes(websiteUrl.replace(/^https?:\/\//, '')))) {
    const textConfidence = CONFIDENCE.MEDIUM;
    if (textConfidence > bestConfidence) {
      bestConfidence = textConfidence;
      bestMatch = {
        excerpt: `Business name/URL found in page content`,
        url: null,
        matchReason: 'Text match in page'
      };
    }
  }

  // Determine outcome based on confidence
  const evidence = {
    search_url: searchUrl,
    method: 'internal_search',
    response_time_ms: fetchResult.responseTimeMs,
    checked_at: new Date().toISOString(),
    confidence: bestConfidence
  };

  if (bestConfidence >= CONFIDENCE.HIGH) {
    return {
      status: DUPLICATE_CHECK_STATUSES.MATCH_FOUND,
      existingListingUrl: bestMatch?.url || null,
      evidence: {
        ...evidence,
        match_reason: bestMatch?.matchReason,
        excerpt: bestMatch?.excerpt
      }
    };
  } else if (bestConfidence >= CONFIDENCE.MEDIUM) {
    return {
      status: DUPLICATE_CHECK_STATUSES.POSSIBLE_MATCH,
      existingListingUrl: bestMatch?.url || null,
      evidence: {
        ...evidence,
        match_reason: bestMatch?.matchReason,
        excerpt: bestMatch?.excerpt
      }
    };
  } else {
    return {
      status: DUPLICATE_CHECK_STATUSES.NO_MATCH,
      evidence: {
        ...evidence,
        match_reason: 'No matching results found'
      }
    };
  }
}

/**
 * Handle api_search: Use directory's API if configured
 */
async function handleApiSearch(directory, businessProfile) {
  const apiConfig = directory.api_config;

  if (!apiConfig || !apiConfig.available || !apiConfig.endpoint) {
    return {
      status: DUPLICATE_CHECK_STATUSES.SKIPPED,
      evidence: {
        reason: 'API not configured or not available',
        method: 'api_search',
        checked_at: new Date().toISOString()
      }
    };
  }

  // For MVP, API integrations are directory-specific and would need custom handlers
  // Return skipped for now, but structure allows future implementation
  return {
    status: DUPLICATE_CHECK_STATUSES.SKIPPED,
    evidence: {
      reason: 'API integration not implemented for this directory',
      method: 'api_search',
      api_endpoint: apiConfig.endpoint,
      checked_at: new Date().toISOString()
    }
  };
}

/**
 * Handle site_search: Google site: search (NOT IMPLEMENTED - scraping not allowed)
 */
async function handleSiteSearch(directory, businessProfile) {
  // SAFETY: Do not scrape Google
  return {
    status: DUPLICATE_CHECK_STATUSES.SKIPPED,
    evidence: {
      reason: 'site_search (Google scraping) not supported - use internal_search or api_search',
      method: 'site_search',
      checked_at: new Date().toISOString()
    }
  };
}

/**
 * Handle none: No duplicate check configured
 */
async function handleNone(directory, businessProfile) {
  return {
    status: DUPLICATE_CHECK_STATUSES.SKIPPED,
    evidence: {
      reason: 'No duplicate check configured for this directory',
      method: 'none',
      checked_at: new Date().toISOString()
    }
  };
}

// =============================================================================
// MAIN API
// =============================================================================

/**
 * Check if a business is already listed in a directory
 *
 * @param {Object} directory - Directory record with search_type, search_url_template, etc.
 * @param {Object} businessProfile - Business profile with name, website_url, etc.
 * @param {Object} options - Optional settings { skipCache: boolean }
 * @returns {Object} { status, existingListingUrl, evidence }
 */
async function checkForDuplicate(directory, businessProfile, options = {}) {
  const startTime = Date.now();

  // Input validation
  if (!directory || !directory.id) {
    return {
      status: DUPLICATE_CHECK_STATUSES.ERROR,
      evidence: {
        error: 'Invalid directory provided',
        checked_at: new Date().toISOString()
      }
    };
  }

  if (!businessProfile || !businessProfile.name) {
    return {
      status: DUPLICATE_CHECK_STATUSES.ERROR,
      evidence: {
        error: 'Invalid business profile provided',
        checked_at: new Date().toISOString()
      }
    };
  }

  // Check cache first
  const cacheKey = getCacheKey(businessProfile, directory.id);
  if (!options.skipCache) {
    const cached = getCachedResult(cacheKey);
    if (cached) {
      return {
        ...cached,
        fromCache: true
      };
    }
  }

  // Route to appropriate handler based on search_type
  let result;
  const searchType = directory.search_type || 'none';

  switch (searchType) {
    case 'internal_search':
      result = await handleInternalSearch(directory, businessProfile);
      break;
    case 'api_search':
      result = await handleApiSearch(directory, businessProfile);
      break;
    case 'site_search':
      result = await handleSiteSearch(directory, businessProfile);
      break;
    case 'none':
    default:
      result = await handleNone(directory, businessProfile);
      break;
  }

  // Add directory info to evidence
  result.evidence = {
    ...result.evidence,
    directory_id: directory.id,
    directory_slug: directory.slug,
    directory_name: directory.name,
    total_time_ms: Date.now() - startTime
  };

  // Cache the result (unless it's an error that might be transient)
  if (result.status !== DUPLICATE_CHECK_STATUSES.ERROR) {
    cacheResult(cacheKey, result);
  }

  return result;
}

/**
 * Batch check for duplicates across multiple directories
 *
 * @param {Array} directories - Array of directory records
 * @param {Object} businessProfile - Business profile to check
 * @param {Object} options - { concurrency: number, skipCache: boolean }
 * @returns {Map} Map of directoryId → result
 */
async function batchCheckForDuplicates(directories, businessProfile, options = {}) {
  const concurrency = options.concurrency || RATE_LIMIT.MAX_CONCURRENT;
  const results = new Map();

  // Process in batches to respect rate limits
  for (let i = 0; i < directories.length; i += concurrency) {
    const batch = directories.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async dir => {
        const result = await checkForDuplicate(dir, businessProfile, options);
        return { directoryId: dir.id, result };
      })
    );

    // Store results by directoryId (NEVER by array index)
    for (const { directoryId, result } of batchResults) {
      results.set(directoryId, result);
    }

    // Delay between batches if not last batch
    if (i + concurrency < directories.length) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.DELAY_BETWEEN_REQUESTS_MS));
    }
  }

  return results;
}

/**
 * Save duplicate check result to a submission record
 *
 * @param {string} submissionId - The directory_submissions.id
 * @param {Object} checkResult - Result from checkForDuplicate
 * @returns {Object} Updated submission record
 */
async function saveCheckResult(submissionId, checkResult) {
  const updateQuery = `
    UPDATE directory_submissions
    SET
      duplicate_check_status = $1,
      duplicate_check_evidence = $2,
      existing_listing_url = $3,
      duplicate_checked_at = NOW(),
      updated_at = NOW()
    WHERE id = $4
    RETURNING *
  `;

  const result = await db.query(updateQuery, [
    checkResult.status,
    JSON.stringify(checkResult.evidence),
    checkResult.existingListingUrl || null,
    submissionId
  ]);

  return result.rows[0];
}

/**
 * Clear the duplicate check cache (for testing or manual refresh)
 */
function clearCache() {
  checkCache.clear();
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  return {
    size: checkCache.size,
    ttlMs: CACHE_TTL_MS
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  checkForDuplicate,
  batchCheckForDuplicates,
  saveCheckResult,
  clearCache,
  getCacheStats,
  DUPLICATE_CHECK_STATUSES,
  // Exposed for testing
  buildSearchUrl,
  calculateSimilarity,
  domainsMatch
};
