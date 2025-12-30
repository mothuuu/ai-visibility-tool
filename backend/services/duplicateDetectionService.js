/**
 * Phase 4: Duplicate Detection Service
 * internal_search implemented with cheerio + confidence scoring + evidence.
 * site_search/api_search skipped for MVP (no Google scraping, no API integrations yet).
 */

const axios = require('axios');
const cheerio = require('cheerio');

const CONFIDENCE_THRESHOLDS = {
  MATCH_FOUND: 0.85,
  POSSIBLE_MATCH: 0.50,
  DOMAIN_BOOST_MIN: 0.70
};

const DEFAULT_CONCURRENCY = 3;
const REQUEST_TIMEOUT = 12000;
const BATCH_DELAY_MS = 800;
const CACHE_TTL_HOURS = 24;

function extractDomain(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function slugify(text) {
  if (!text) return '';
  return text.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildSearchUrl(template, profile) {
  const businessName = profile.name || profile.business_name || '';
  const websiteDomain = extractDomain(profile.website_url) || '';
  const slug = slugify(businessName);

  return template
    .replaceAll('{business_name}', encodeURIComponent(businessName))
    .replaceAll('{website_domain}', encodeURIComponent(websiteDomain))
    .replaceAll('{slug}', encodeURIComponent(slug));
}

function scoreMatch({ htmlText, links, businessName, websiteDomain }) {
  const name = (businessName || '').toLowerCase();
  const domain = (websiteDomain || '').toLowerCase();

  let confidence = 0;
  const reasons = [];

  if (domain) {
    const domainInText = htmlText.includes(domain);
    const domainInLinks = links.some(l => (l.href || '').toLowerCase().includes(domain));
    if (domainInText || domainInLinks) {
      confidence = Math.max(confidence, 0.85);
      reasons.push('website_domain_match');
      if (domainInLinks) reasons.push('domain_in_link');
    }
  }

  if (name && name.length > 2) {
    const nameInText = htmlText.includes(name);
    const nameInLinks = links.some(l =>
      (l.text || '').toLowerCase().includes(name) ||
      (l.href || '').toLowerCase().includes(name)
    );
    if (nameInText) {
      confidence = Math.max(confidence, 0.65);
      reasons.push('business_name_in_text');
    }
    if (nameInLinks) {
      confidence = Math.max(confidence, 0.70);
      reasons.push('business_name_in_link');
    }
  }

  const slug = slugify(businessName);
  if (slug && slug.length > 3) {
    const slugInLinks = links.some(l => (l.href || '').toLowerCase().includes(slug));
    if (slugInLinks && confidence < 0.60) {
      confidence = Math.max(confidence, 0.55);
      reasons.push('slug_in_link');
    }
  }

  return { confidence, reasons };
}

function pickListingUrl({ links, businessName, websiteDomain, urlRegex }) {
  const name = (businessName || '').toLowerCase();
  const slug = slugify(businessName || '');
  const domain = (websiteDomain || '').toLowerCase();

  if (urlRegex) {
    try {
      const re = new RegExp(urlRegex);
      const hit = links.find(l => re.test(l.href || ''));
      if (hit?.href) return hit.href;
    } catch {}
  }

  if (domain) {
    const byDomain = links.find(l => (l.href || '').toLowerCase().includes(domain));
    if (byDomain?.href) return byDomain.href;
  }

  if (slug && slug.length > 3) {
    const bySlug = links.find(l => (l.href || '').toLowerCase().includes(slug));
    if (bySlug?.href) return bySlug.href;
  }

  if (name && name.length > 2) {
    const byName = links.find(l =>
      (l.text || '').toLowerCase().includes(name) ||
      (l.href || '').toLowerCase().includes(name)
    );
    if (byName?.href) return byName.href;
  }

  return null;
}

function determineStatus(confidence, reasons) {
  const hasDomainMatch = reasons.includes('website_domain_match') || reasons.includes('domain_in_link');
  if (confidence >= CONFIDENCE_THRESHOLDS.MATCH_FOUND) return 'match_found';
  if (hasDomainMatch && confidence >= CONFIDENCE_THRESHOLDS.DOMAIN_BOOST_MIN) return 'match_found';
  if (confidence >= CONFIDENCE_THRESHOLDS.POSSIBLE_MATCH) return 'possible_match';
  return 'no_match';
}

async function checkInternalSearch(directory, profile) {
  const checkedAt = new Date();
  const method = 'internal_search';
  const baseEvidence = { directory: directory.name, directoryId: directory.id };

  if (!directory.search_url_template) {
    return {
      directoryId: directory.id,
      method: 'skipped',
      status: 'skipped',
      confidence: 0,
      listingUrl: null,
      searchUrl: null,
      evidence: { ...baseEvidence, reason: 'missing_search_url_template' },
      checkedAt
    };
  }

  const businessName = profile.name || profile.business_name;
  const websiteDomain = extractDomain(profile.website_url);
  const searchUrl = buildSearchUrl(directory.search_url_template, profile);

  const evidence = { ...baseEvidence, searchUrl };

  try {
    const resp = await axios.get(searchUrl, {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Visible2AI/1.0; +https://visible2ai.com)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8'
      },
      validateStatus: s => s >= 200 && s < 500,
      maxRedirects: 3
    });

    if (resp.status === 429 || resp.status === 403) {
      return {
        directoryId: directory.id,
        method,
        status: 'error',
        confidence: 0,
        listingUrl: null,
        searchUrl,
        evidence: {
          ...evidence,
          httpStatus: resp.status,
          error: resp.status === 429 ? 'rate_limited' : 'access_blocked'
        },
        checkedAt
      };
    }

    if (resp.status >= 400) {
      return {
        directoryId: directory.id,
        method,
        status: 'error',
        confidence: 0,
        listingUrl: null,
        searchUrl,
        evidence: { ...evidence, httpStatus: resp.status, error: 'http_error' },
        checkedAt
      };
    }

    const html = resp.data || '';
    const $ = cheerio.load(html);

    const cfg = directory.duplicate_check_config || {};
    const scope = cfg.result_selector ? $(cfg.result_selector) : $('body');

    const text = scope.text().toLowerCase();
    const links = [];
    scope.find('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const linkText = $(el).text().trim();
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        let fullHref = href;
        try { fullHref = new URL(href, searchUrl).href; } catch {}
        links.push({ href: fullHref, text: linkText });
      }
    });

    const { confidence, reasons } = scoreMatch({ htmlText: text, links, businessName, websiteDomain });
    const listingUrl = pickListingUrl({ links, businessName, websiteDomain, urlRegex: cfg.listing_url_regex });

    const excerptSelector = cfg.excerpt_selector || cfg.result_selector;
    const excerpt = (excerptSelector ? $(excerptSelector).text() : scope.text())
      .trim().replace(/\s+/g, ' ')
      .slice(0, 500);

    const status = determineStatus(confidence, reasons);

    return {
      directoryId: directory.id,
      method,
      status,
      confidence,
      listingUrl,
      searchUrl,
      evidence: {
        ...evidence,
        httpStatus: resp.status,
        reasons,
        excerpt,
        listingUrlCandidate: listingUrl,
        linkCount: links.length,
        textLength: text.length
      },
      checkedAt
    };
  } catch (err) {
    const errorType =
      err.code === 'ECONNABORTED' ? 'timeout' :
      err.code === 'ENOTFOUND' ? 'dns_error' :
      'request_failed';

    return {
      directoryId: directory.id,
      method,
      status: 'error',
      confidence: 0,
      listingUrl: null,
      searchUrl,
      evidence: { ...evidence, error: errorType, errorMessage: err.message },
      checkedAt
    };
  }
}

async function checkForExistingListing(directory, profile) {
  const checkedAt = new Date();
  const baseEvidence = { directory: directory.name, directoryId: directory.id };

  const searchType = directory.search_type;

  if (!searchType || searchType === 'none') {
    return {
      directoryId: directory.id,
      method: 'skipped',
      status: 'skipped',
      confidence: 0,
      listingUrl: null,
      searchUrl: null,
      evidence: { ...baseEvidence, reason: 'search_type_none' },
      checkedAt
    };
  }

  if (searchType === 'site_search') {
    return {
      directoryId: directory.id,
      method: 'site_search',
      status: 'skipped',
      confidence: 0,
      listingUrl: null,
      searchUrl: null,
      evidence: { ...baseEvidence, reason: 'site_search_requires_compliant_search_api' },
      checkedAt
    };
  }

  if (searchType === 'internal_search') {
    return checkInternalSearch(directory, profile);
  }

  if (searchType === 'api_search') {
    return {
      directoryId: directory.id,
      method: 'api_search',
      status: 'skipped',
      confidence: 0,
      listingUrl: null,
      searchUrl: null,
      evidence: { ...baseEvidence, reason: 'api_search_not_implemented' },
      checkedAt
    };
  }

  return {
    directoryId: directory.id,
    method: 'skipped',
    status: 'skipped',
    confidence: 0,
    listingUrl: null,
    searchUrl: null,
    evidence: { ...baseEvidence, reason: 'unknown_search_type', searchType },
    checkedAt
  };
}

async function batchCheckForListings(directories, profile, opts = {}) {
  const concurrency = opts.concurrency || DEFAULT_CONCURRENCY;
  const results = [];
  const resultsMap = new Map();

  for (let i = 0; i < directories.length; i += concurrency) {
    const batch = directories.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(d => checkForExistingListing(d, profile)));

    batchResults.forEach(r => {
      results.push(r);
      resultsMap.set(r.directoryId, r);
    });

    if (i + concurrency < directories.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  return {
    results,
    resultsMap,
    summary: {
      total: results.length,
      matchFound: results.filter(r => r.status === 'match_found').length,
      possibleMatch: results.filter(r => r.status === 'possible_match').length,
      noMatch: results.filter(r => r.status === 'no_match').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      error: results.filter(r => r.status === 'error').length
    }
  };
}

function isRecentCheckValid(submission) {
  if (!submission?.duplicate_check_performed_at) return false;
  const checkTime = new Date(submission.duplicate_check_performed_at);
  const hours = (Date.now() - checkTime.getTime()) / (1000 * 60 * 60);
  return hours < CACHE_TTL_HOURS;
}

module.exports = {
  CONFIDENCE_THRESHOLDS,
  extractDomain,
  slugify,
  buildSearchUrl,
  checkForExistingListing,
  batchCheckForListings,
  isRecentCheckValid
};
