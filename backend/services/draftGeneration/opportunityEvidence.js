'use strict';

/**
 * Opportunity EVIDENCE pass (Perplexity citation bootstrap) + honest derivation.
 *
 * Surfaces the REAL cited-source landscape for HIGH-VALUE prompts and stores it
 * as grounded, facts-only evidence on each prompt. NO score, band, weight, or
 * winnability — that is a separate later pass.
 *
 * Derivation discipline (so a later score isn't fed inflated signals):
 *   - OWN-DOMAIN EXCLUSION: the customer's own registrable domain and brand
 *     variants (e.g. goldwynnbahamas.com / goldwynnresorts.com / goldwynn.com)
 *     are collapsed out of diversity_count and the competitive cited set.
 *     brand_present stays true if any brand domain appears.
 *   - SOCIAL / LOW-AUTHORITY EXCLUSION: a config list (facebook, youtube,
 *     reddit, tripadvisor, expedia, …) is excluded from diversity_count and the
 *     competitive set, but kept in raw_cited_domains so nothing is lost.
 *   - competitor_candidates: the cited domains left AFTER removing brand +
 *     social/junk — the real third-party field winning these answers. Distinct
 *     from competitors_present (declared-competitor matches). Facts only.
 *
 * Self-contained on visibility_profiles.tracked_prompts. Strictly additive:
 * writes ONLY `opportunity_evidence`, preserves every other key/column,
 * idempotent, never overwrites real data with blanks.
 *
 * Two entry points:
 *   - gatherOpportunityEvidence(userId): live — one base-Sonar (low context)
 *     Perplexity call per qualifying prompt, then derive.
 *   - rederiveOpportunityEvidence(userId): offline — recompute the signals from
 *     the ALREADY-STORED cited domains (raw_cited_domains / cited_domains). No
 *     Perplexity calls. Use after a derivation rule changes.
 */

const db = require('../../db/database');
const perplexityAdapter = require('../engines/perplexityAdapter');
const { resolvePlanForRequest, getDraftConfig } = require('../planService');
const { OPPORTUNITY_PERPLEXITY_MODEL } = require('../../config/models');

// Plan-config flag that gates Opportunity (same umbrella gate as Value).
const ELIGIBILITY_FLAG = 'draft_enabled';

const ENGINE = 'perplexity';
// Only prompts the Value pass rated >= this band get a (paid) Perplexity call.
const VALUE_THRESHOLD = 4;
// Cheapest citation context — base Sonar + low context (see cost note).
const SEARCH_CONTEXT_SIZE = 'low';

// A cited SLD is treated as brand-owned when it shares a leading prefix of at
// least this length with a brand stem (collapses goldwynn* variants without
// matching unrelated geo words like "bahamasvillas").
const BRAND_PREFIX_MIN = 5;

// Registrable-suffixes that take three labels (eTLD+1 spans two dots).
const SECOND_LEVEL_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au',
  'co.nz', 'co.za', 'com.br', 'co.jp', 'co.in', 'com.sg', 'com.mx',
]);

// Social / aggregator / OTA / low-authority domains. Real demand signal, but NOT
// competitive diversity — a brand can't "win" them the way it wins a niche
// review or a competitor comparison. Excluded from diversity + competitive set;
// retained in raw_cited_domains. Config list — extend as needed.
const SOCIAL_LOW_AUTHORITY = new Set([
  // social
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
  'youtube.com', 'linkedin.com', 'pinterest.com', 'reddit.com', 'quora.com',
  'threads.net', 'medium.com',
  // travel OTAs / aggregators (hospitality-heavy, but harmless elsewhere)
  'tripadvisor.com', 'expedia.com', 'booking.com', 'hotels.com', 'trivago.com',
  'kayak.com', 'agoda.com', 'priceline.com', 'airbnb.com', 'vrbo.com',
  'yelp.com', 'trustpilot.com',
  // generic reference
  'wikipedia.org', 'wikimedia.org',
]);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function collapseAlnum(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function commonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/** Registrable domain (eTLD+1, www-stripped, lowercased), or null. */
function extractDomain(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let host = null;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    const trimmed = rawUrl.trim().toLowerCase();
    if (trimmed && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) host = trimmed;
  }
  if (!host) return null;
  host = host.replace(/^www\./, '').toLowerCase();
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  return SECOND_LEVEL_TLDS.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

/** Second-level label of a registrable domain (acme.co.uk -> 'acme'). */
function sld(domain) {
  return domain ? domain.split('.')[0] : '';
}

/**
 * Brand context for own-domain collapsing. `registrables` are exact brand
 * registrable domains; `stems` are brand name/domain stems used for prefix
 * collapsing of variants.
 */
function buildBrandContext({ brandDomain, companyName, extraBrandDomains = [] } = {}) {
  const registrables = new Set();
  if (brandDomain) registrables.add(brandDomain);
  for (const d of asArray(extraBrandDomains)) {
    const r = extractDomain(d);
    if (r) registrables.add(r);
  }
  const stems = new Set();
  if (brandDomain) stems.add(sld(brandDomain));
  const cn = collapseAlnum(companyName);
  if (cn.length >= 3) stems.add(cn);
  return { registrables, stems: [...stems].filter(Boolean) };
}

function isBrandOwned(domain, ctx) {
  if (!domain || !ctx) return false;
  if (ctx.registrables.has(domain)) return true;
  const s = sld(domain);
  if (!s) return false;
  for (const stem of ctx.stems) {
    if (!stem) continue;
    if (s === stem) return true;
    if (commonPrefixLen(s, stem) >= BRAND_PREFIX_MIN) return true;
  }
  return false;
}

function isSocialJunk(domain) {
  return Boolean(domain) && SOCIAL_LOW_AUTHORITY.has(domain);
}

/** Full cited URLs -> deduped [{domain,count}] in first-seen order. */
function domainCountsFromUrls(urls) {
  const order = [];
  const counts = new Map();
  for (const url of asArray(urls)) {
    const domain = extractDomain(url);
    if (!domain) continue;
    if (!counts.has(domain)) {
      counts.set(domain, 0);
      order.push(domain);
    }
    counts.set(domain, counts.get(domain) + 1);
  }
  return order.map((domain) => ({ domain, count: counts.get(domain) }));
}

/** Stored raw_cited_domains / cited_domains -> normalized [{domain,count}]. */
function normalizeDomainCounts(stored) {
  const order = [];
  const counts = new Map();
  for (const entry of asArray(stored)) {
    const domain = typeof entry === 'string' ? extractDomain(entry) : extractDomain(entry && entry.domain);
    if (!domain) continue;
    const c = entry && typeof entry === 'object' && Number.isFinite(entry.count) ? entry.count : 1;
    if (!counts.has(domain)) {
      counts.set(domain, 0);
      order.push(domain);
    }
    counts.set(domain, counts.get(domain) + c);
  }
  return order.map((domain) => ({ domain, count: counts.get(domain) }));
}

/**
 * Derive the facts-only evidence object from a raw [{domain,count}] set.
 * Applies brand + social/junk exclusion. NO scoring.
 */
function deriveEvidence(rawCounts, brandCtx, competitors, meta = {}) {
  const raw = asArray(rawCounts);
  const rawSet = new Set(raw.map((d) => d.domain));

  const competitive = raw.filter((d) => !isBrandOwned(d.domain, brandCtx) && !isSocialJunk(d.domain));
  const cited_domains = competitive.map((d) => ({ domain: d.domain, count: d.count }));

  const brand_present = raw.some((d) => isBrandOwned(d.domain, brandCtx));
  const competitors_present = asArray(competitors)
    .filter((c) => c.domain && rawSet.has(c.domain))
    .map((c) => ({ name: c.name, domain: c.domain }));

  const out = {
    cited_domains,                              // competitive (brand + social removed)
    raw_cited_domains: raw,                     // everything cited, nothing lost
    diversity_count: cited_domains.length,      // competitive count only
    brand_present,                              // any brand domain present
    competitors_present,                        // declared-competitor matches
    competitor_candidates: cited_domains.map((d) => d.domain), // real third-party field
    engine: meta.engine || ENGINE,
    gathered_at: meta.gathered_at || new Date().toISOString(),
  };
  if (meta.rederived_at) out.rederived_at = meta.rederived_at;
  return out;
}

/** Live path: full citation URLs -> evidence object. */
function buildEvidence(citationUrls, brandCtx, competitors, meta) {
  return deriveEvidence(domainCountsFromUrls(citationUrls), brandCtx, competitors, meta);
}

/** Declared competitors -> [{ name, domain(registrable|null) }] from both columns. */
function collectCompetitors(profile) {
  const out = [];
  for (const col of ['competitors_business', 'competitors_visibility']) {
    for (const c of asArray(profile[col])) {
      if (!c || typeof c !== 'object') continue;
      const name = c.name == null ? null : String(c.name).trim() || null;
      const domain = extractDomain(c.url);
      if (name || domain) out.push({ name, domain });
    }
  }
  return out;
}

/** Compact declared-competitor summary for reporting (requirement 4). */
function summarizeDeclaredCompetitors(profile) {
  const f = (col) => asArray(profile[col]).map((c) => ({
    name: c && c.name != null ? String(c.name).trim() || null : null,
    url: c && c.url != null ? String(c.url).trim() || null : null,
    domain: c ? extractDomain(c.url) : null,
  }));
  return { competitors_business: f('competitors_business'), competitors_visibility: f('competitors_visibility') };
}

/** A prompt qualifies when the Value pass rated it at/above the threshold. */
function qualifies(p) {
  return Boolean(
    p && typeof p === 'object' &&
    p.value && Number.isInteger(p.value.band) && p.value.band >= VALUE_THRESHOLD
  );
}

// ---------------------------------------------------------------------------
// data access
// ---------------------------------------------------------------------------

async function readProfile(userId) {
  const { rows } = await db.query(
    `SELECT tracked_prompts, competitors_business, competitors_visibility, company_name
       FROM visibility_profiles
      WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Customer's own registrable domain: users.primary_domain first, else the most
 * recent completed scan's URL. null if none resolvable.
 */
async function readBrandDomain(userId) {
  const u = await db.query('SELECT primary_domain FROM users WHERE id = $1', [userId]);
  const primary = u.rows[0] && u.rows[0].primary_domain;
  if (primary) {
    const d = extractDomain(primary);
    if (d) return d;
  }
  const s = await db.query(
    `SELECT url FROM scans
      WHERE user_id = $1 AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId]
  );
  const url = s.rows[0] && s.rows[0].url;
  return url ? extractDomain(url) : null;
}

/**
 * Read-modify-write tracked_prompts under a row lock, applying `mutate` to a
 * FRESH copy. Writes ONLY the tracked_prompts column. `mutate` returns the new
 * array, or null to abort (commit nothing).
 */
async function applyToTrackedPrompts(userId, mutate) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT tracked_prompts FROM visibility_profiles WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { written: false, reason: 'no_profile' };
    }
    const current = asArray(rows[0].tracked_prompts);
    const next = mutate(current);
    if (next == null) {
      await client.query('ROLLBACK');
      return { written: false, reason: 'aborted' };
    }
    await client.query(
      `UPDATE visibility_profiles SET tracked_prompts = $2::jsonb WHERE user_id = $1`,
      [userId, JSON.stringify(next)]
    );
    await client.query('COMMIT');
    return { written: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Live gather: one base-Sonar (low context) Perplexity call per HIGH-VALUE
 * prompt, then derive honest evidence. Strictly additive, idempotent, facts only.
 */
async function gatherOpportunityEvidence(userId) {
  if (!userId) throw new Error('gatherOpportunityEvidence requires a userId');

  const { plan } = await resolvePlanForRequest({ userId });
  const cfg = getDraftConfig(plan);
  if (!cfg[ELIGIBILITY_FLAG]) return { userId, plan, status: 'skipped_not_eligible' };

  const profile = await readProfile(userId);
  if (!profile) return { userId, plan, status: 'no_profile' };

  const prompts = asArray(profile.tracked_prompts);
  if (prompts.length === 0) return { userId, plan, status: 'no_prompts' };

  const qualifying = prompts.filter(qualifies);
  if (qualifying.length === 0) return { userId, plan, status: 'no_qualifying_prompts' };

  const brandDomain = await readBrandDomain(userId);
  const brandCtx = buildBrandContext({ brandDomain, companyName: profile.company_name });
  const competitors = collectCompetitors(profile);

  const evidenceByText = new Map();
  let failed = 0;
  for (const p of qualifying) {
    const text = typeof p.text === 'string' ? p.text : null;
    if (!text) continue;
    try {
      const out = await perplexityAdapter.runQuery(text, {
        model: OPPORTUNITY_PERPLEXITY_MODEL,
        searchContextSize: SEARCH_CONTEXT_SIZE,
      });
      const citations = out && Array.isArray(out.citations) ? out.citations : [];
      evidenceByText.set(text, buildEvidence(citations, brandCtx, competitors));
    } catch (err) {
      failed += 1;
      console.warn(
        `[opportunityEvidence] user ${userId}: Perplexity call failed for a prompt ` +
          `(${err && err.message ? err.message : err}); skipping that prompt`
      );
    }
  }

  if (evidenceByText.size === 0) {
    console.warn(
      `[opportunityEvidence] user ${userId}: all ${qualifying.length} Perplexity calls failed; ` +
        `aborting write (tracked_prompts untouched)`
    );
    return { userId, plan, status: 'all_failed', failed };
  }

  let processed = 0;
  const result = await applyToTrackedPrompts(userId, (current) => {
    let changed = false;
    const next = current.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const ev = evidenceByText.get(typeof p.text === 'string' ? p.text : null);
      if (!ev) return p;
      processed += 1;
      changed = true;
      return { ...p, opportunity_evidence: ev };
    });
    return changed ? next : null;
  });

  if (!result.written) return { userId, plan, status: 'all_failed', processed: 0, failed };
  return {
    userId, plan, status: 'gathered', processed, failed,
    declared_competitors: summarizeDeclaredCompetitors(profile),
  };
}

/**
 * Offline re-derive: recompute evidence signals from the ALREADY-STORED cited
 * domains, applying the current brand + social exclusion rules. NO Perplexity
 * calls. Strictly additive, idempotent, never-null (aborts if nothing has
 * retained citations to recompute from).
 */
async function rederiveOpportunityEvidence(userId) {
  if (!userId) throw new Error('rederiveOpportunityEvidence requires a userId');

  const { plan } = await resolvePlanForRequest({ userId });
  const cfg = getDraftConfig(plan);
  if (!cfg[ELIGIBILITY_FLAG]) return { userId, plan, status: 'skipped_not_eligible' };

  const profile = await readProfile(userId);
  if (!profile) return { userId, plan, status: 'no_profile' };

  const prompts = asArray(profile.tracked_prompts);
  if (prompts.length === 0) return { userId, plan, status: 'no_prompts' };

  const brandDomain = await readBrandDomain(userId);
  const brandCtx = buildBrandContext({ brandDomain, companyName: profile.company_name });
  const competitors = collectCompetitors(profile);
  const declared = summarizeDeclaredCompetitors(profile);

  // Recompute from stored domains for each prompt that already has retained
  // citations (raw_cited_domains preferred, else the older cited_domains).
  const newByText = new Map();
  let needFetch = 0;
  for (const p of prompts) {
    if (!p || typeof p !== 'object' || !p.opportunity_evidence) continue;
    const ev = p.opportunity_evidence;
    const stored = ev.raw_cited_domains || ev.cited_domains;
    if (!Array.isArray(stored)) { needFetch += 1; continue; } // citations not retained
    const rawCounts = normalizeDomainCounts(stored);
    const text = typeof p.text === 'string' ? p.text : null;
    if (text == null) continue;
    newByText.set(text, deriveEvidence(rawCounts, brandCtx, competitors, {
      engine: ev.engine || ENGINE,
      gathered_at: ev.gathered_at, // preserve original fetch time
      rederived_at: new Date().toISOString(),
    }));
  }

  if (newByText.size === 0) {
    return { userId, plan, status: 'nothing_to_rederive', need_fetch: needFetch, declared_competitors: declared };
  }

  let rederived = 0;
  const result = await applyToTrackedPrompts(userId, (current) => {
    let changed = false;
    const next = current.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const ev = newByText.get(typeof p.text === 'string' ? p.text : null);
      if (!ev) return p;                       // unmatched / not retained => unchanged
      rederived += 1;
      changed = true;
      return { ...p, opportunity_evidence: ev };
    });
    return changed ? next : null;
  });

  if (!result.written) return { userId, plan, status: 'nothing_to_rederive', need_fetch: needFetch, declared_competitors: declared };
  return { userId, plan, status: 'rederived', rederived, need_fetch: needFetch, declared_competitors: declared };
}

module.exports = {
  gatherOpportunityEvidence,
  rederiveOpportunityEvidence,
  // exposed for tests
  _internals: {
    extractDomain, deriveEvidence, buildEvidence, collectCompetitors,
    buildBrandContext, isBrandOwned, isSocialJunk, normalizeDomainCounts,
    summarizeDeclaredCompetitors, qualifies, VALUE_THRESHOLD,
    SOCIAL_LOW_AUTHORITY,
  },
};
