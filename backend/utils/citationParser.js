/**
 * Citation Parser
 *
 * analyzeCitation(responseText, domain, competitorDomains = []) → CitationResult
 *
 * Heuristic-based detection of brand citation in an AI assistant response.
 * Returns:
 *   {
 *     cited:             boolean,
 *     citation_type:     'cited' | 'recommended' | 'compared' | 'absent',
 *     domain_mentioned:  boolean,
 *     competitor_cited:  string[],
 *     brand_name:        string   // for debug/inspection
 *   }
 */

const RECOMMEND_PATTERNS = [
  /\brecommend(?:s|ed|ing)?\b/i,
  /\bsuggest(?:s|ed|ing)?\b/i,
  /\btry\s+(?:out\s+)?\b/i,
  /\bcheck\s+out\b/i,
  /\bgo\s+with\b/i,
  /\bbest\s+(?:choice|option|pick|tool|product|service|platform)\b/i,
  /\btop\s+(?:choice|pick|recommendation)\b/i,
  /\bmy\s+pick\b/i,
  /\bworth\s+considering\b/i,
];
const COMPARE_PATTERNS = [
  /\bcompared\s+to\b/i,
  /\bvs\.?\b/i,
  /\bversus\b/i,
  /\balternative\s+to\b/i,
  /\balternatives?\b/i,
  /\bbetter\s+than\b/i,
  /\bsimilar\s+to\b/i,
  /\bcompetes?\s+with\b/i,
  /\binstead\s+of\b/i,
];

/**
 * Pull a likely brand name out of a domain.
 *   visible2ai.com   -> 'visible2ai'
 *   www.acme-co.com  -> 'acme co'
 *   sub.domain.co.uk -> 'domain'   (uses the registrable label heuristically)
 */
function brandFromDomain(domain) {
  if (!domain) return '';
  let d = String(domain).toLowerCase().trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
  // Pick the second-to-last label for *.co.uk / *.com.au style, else last-before-TLD.
  const labels = d.split('.');
  let brand;
  if (labels.length >= 3 && /^(co|com|net|org|gov|ac|edu)$/.test(labels[labels.length - 2])) {
    brand = labels[labels.length - 3] || labels[0];
  } else if (labels.length >= 2) {
    brand = labels[labels.length - 2];
  } else {
    brand = labels[0];
  }
  return brand.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeForRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsBrand(text, brand) {
  if (!brand) return false;
  // Match brand name as a whole word(s), case-insensitive. Allow optional
  // surrounding ., -, or whitespace.
  const re = new RegExp('(^|[^A-Za-z0-9])' + escapeForRegex(brand) + '([^A-Za-z0-9]|$)', 'i');
  return re.test(text);
}

function containsDomain(text, domain) {
  if (!domain) return false;
  // Domain match: case-insensitive, allow optional protocol/www prefix.
  const bare = String(domain).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (!bare) return false;
  const re = new RegExp('\\b' + escapeForRegex(bare) + '\\b', 'i');
  return re.test(text);
}

function nearbyMatch(text, brand, patterns, windowChars = 120) {
  if (!brand) return false;
  // Find brand occurrences and look ±windowChars around each for any pattern match.
  const brandRe = new RegExp(escapeForRegex(brand), 'gi');
  let m;
  while ((m = brandRe.exec(text)) !== null) {
    const start = Math.max(0, m.index - windowChars);
    const end = Math.min(text.length, m.index + m[0].length + windowChars);
    const window = text.slice(start, end);
    for (const p of patterns) {
      if (p.test(window)) return true;
    }
  }
  return false;
}

function analyzeCitation(responseText, domain, competitorDomains = []) {
  const text = String(responseText || '');
  const brand = brandFromDomain(domain);

  const domain_mentioned = containsDomain(text, domain);
  const brand_mentioned = containsBrand(text, brand);
  const cited = Boolean(domain_mentioned || brand_mentioned);

  const competitor_cited = (Array.isArray(competitorDomains) ? competitorDomains : [])
    .filter(c => containsDomain(text, c) || containsBrand(text, brandFromDomain(c)))
    .map(c => String(c).toLowerCase());

  let citation_type;
  if (!cited) {
    citation_type = 'absent';
  } else if (nearbyMatch(text, brand, RECOMMEND_PATTERNS) || nearbyMatch(text, domain, RECOMMEND_PATTERNS)) {
    citation_type = 'recommended';
  } else if (nearbyMatch(text, brand, COMPARE_PATTERNS) || nearbyMatch(text, domain, COMPARE_PATTERNS) ||
             (competitor_cited.length > 0 && cited)) {
    // If competitors are also named in the response and brand is cited, treat as comparison.
    citation_type = 'compared';
  } else {
    citation_type = 'cited';
  }

  return {
    cited,
    citation_type,
    domain_mentioned,
    competitor_cited,
    brand_name: brand
  };
}

module.exports = {
  analyzeCitation,
  brandFromDomain,
  // Exported for tests and downstream tooling
  RECOMMEND_PATTERNS,
  COMPARE_PATTERNS
};
