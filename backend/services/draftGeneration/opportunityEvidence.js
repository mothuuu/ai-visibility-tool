'use strict';

/**
 * Opportunity EVIDENCE pass — typed cited field + competitor-gap insight.
 *
 * Surfaces the REAL cited-source landscape for HIGH-VALUE prompts as grounded,
 * facts-only evidence. NO score, band, weight, or winnability — that is a
 * separate later pass. This pass TYPES the cited field and exposes the
 * "declared vs. actually-cited competitors" gap; it does not interpret it.
 *
 * Per-prompt opportunity_evidence (on visibility_profiles.tracked_prompts):
 *   raw_cited_domains  : [{domain,count}]        every cited domain, nothing lost
 *   cited_field        : [{domain,count,class}]  every NON-brand cited domain, typed
 *   competitor_domains : [domain]                class === 'competitor' only
 *   media_domains      : [domain]                class === 'media'
 *   competitor_count   : competitor_domains.length   (the honest concentration)
 *   media_count        : media_domains.length
 *   diversity_count    : === competitor_count        (competitive field size only)
 *   brand_present      : any brand domain cited
 *   competitors_present: [{name,domain}]         DECLARED-competitor matches
 *   engine, gathered_at[, rederived_at]
 *
 * Profile-level competitor_gap_summary (visibility_profiles.competitor_gap_summary):
 *   declared_competitors, cited_competitors, declared_but_not_cited,
 *   cited_but_not_declared, generated_at   — facts only.
 *
 * Classification precedence: brand-owned (collapsed here) → social_junk → media →
 * competitor (default). One domain → exactly one class. Lists live in
 * config/citationDomainClasses.js.
 *
 * Strictly additive: writes ONLY tracked_prompts + competitor_gap_summary,
 * preserves every other key/column, idempotent, never overwrites real data with
 * blanks. Offline re-derivation recomputes from stored citations (no Perplexity).
 */

const db = require('../../db/database');
const perplexityAdapter = require('../engines/perplexityAdapter');
const { resolvePlanForRequest, getDraftConfig } = require('../planService');
const { OPPORTUNITY_PERPLEXITY_MODEL } = require('../../config/models');
const { classifyDomain } = require('../../config/citationDomainClasses');

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

/** Brand context for own-domain collapsing. */
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

/** Full cited URLs -> deduped [{domain,count}] in first-seen order. */
function domainCountsFromUrls(urls) {
  const order = [];
  const counts = new Map();
  for (const url of asArray(urls)) {
    const domain = extractDomain(url);
    if (!domain) continue;
    if (!counts.has(domain)) { counts.set(domain, 0); order.push(domain); }
    counts.set(domain, counts.get(domain) + 1);
  }
  return order.map((domain) => ({ domain, count: counts.get(domain) }));
}

/** Stored raw_cited_domains / cited_domains / cited_field -> [{domain,count}]. */
function normalizeDomainCounts(stored) {
  const order = [];
  const counts = new Map();
  for (const entry of asArray(stored)) {
    const domain = typeof entry === 'string' ? extractDomain(entry) : extractDomain(entry && entry.domain);
    if (!domain) continue;
    const c = entry && typeof entry === 'object' && Number.isFinite(entry.count) ? entry.count : 1;
    if (!counts.has(domain)) { counts.set(domain, 0); order.push(domain); }
    counts.set(domain, counts.get(domain) + c);
  }
  return order.map((domain) => ({ domain, count: counts.get(domain) }));
}

/**
 * Derive the typed, facts-only evidence object from a raw [{domain,count}] set.
 * Brand-owned domains are collapsed out of cited_field; remaining domains are
 * typed social_junk / media / competitor. NO scoring.
 */
function deriveEvidence(rawCounts, brandCtx, competitors, meta = {}) {
  const raw = asArray(rawCounts);
  const rawSet = new Set(raw.map((d) => d.domain));

  const cited_field = [];
  const competitor_domains = [];
  const media_domains = [];
  let brand_present = false;

  for (const { domain, count } of raw) {
    if (isBrandOwned(domain, brandCtx)) { brand_present = true; continue; } // collapse brand
    const cls = classifyDomain(domain);
    cited_field.push({ domain, count, class: cls });
    if (cls === 'competitor') competitor_domains.push(domain);
    else if (cls === 'media') media_domains.push(domain);
  }

  const competitors_present = asArray(competitors)
    .filter((c) => c.domain && rawSet.has(c.domain))
    .map((c) => ({ name: c.name, domain: c.domain }));

  const out = {
    cited_field,
    raw_cited_domains: raw,
    competitor_domains,
    media_domains,
    competitor_count: competitor_domains.length,
    media_count: media_domains.length,
    diversity_count: competitor_domains.length, // competitive field only
    brand_present,
    competitors_present,
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

/**
 * Profile-level competitor-gap summary (facts only). Built from the typed
 * evidence of HIGH-VALUE prompts + the declared competitor list.
 *
 * @param {Array<{name,domain}>} declared
 * @param {Array<object>} evidences  per-prompt evidence objects (high-value)
 */
function buildGapSummary(declared, evidences, meta = {}) {
  const citedAll = new Set();              // every cited registrable domain (any class)
  const compPromptCount = new Map();       // competitor-class domain -> # prompts cited in
  for (const ev of asArray(evidences)) {
    for (const d of asArray(ev.raw_cited_domains)) citedAll.add(d.domain);
    for (const dom of new Set(asArray(ev.competitor_domains))) {
      compPromptCount.set(dom, (compPromptCount.get(dom) || 0) + 1);
    }
  }

  const declared_competitors = asArray(declared).map((c) => ({ name: c.name || null, domain: c.domain || null }));
  const declaredDomains = new Set(declared_competitors.map((c) => c.domain).filter(Boolean));

  const cited_competitors = [...compPromptCount.entries()]
    .map(([domain, prompt_count]) => ({ domain, prompt_count }))
    .sort((a, b) => b.prompt_count - a.prompt_count || a.domain.localeCompare(b.domain));

  // Declared competitor never appears in ANY cited set (null domain => can't be cited).
  const declared_but_not_cited = declared_competitors.filter((c) => !c.domain || !citedAll.has(c.domain));
  // Real competitor-class winners the customer did NOT declare.
  const cited_but_not_declared = cited_competitors.filter((c) => !declaredDomains.has(c.domain));

  return {
    declared_competitors,
    cited_competitors,
    declared_but_not_cited,
    cited_but_not_declared,
    generated_at: meta.generated_at || new Date().toISOString(),
  };
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
 * Read-modify-write under a row lock. Applies `mutate` to a FRESH copy of
 * tracked_prompts; writes ONLY tracked_prompts + competitor_gap_summary. `mutate`
 * returns the new array, or null to abort (commit nothing). Strict additive guard.
 */
async function writeEvidence(userId, mutate, summary) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT tracked_prompts FROM visibility_profiles WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    if (rows.length === 0) { await client.query('ROLLBACK'); return { written: false, reason: 'no_profile' }; }
    const current = asArray(rows[0].tracked_prompts);
    const next = mutate(current);
    if (next == null) { await client.query('ROLLBACK'); return { written: false, reason: 'aborted' }; }
    await client.query(
      `UPDATE visibility_profiles SET tracked_prompts = $2::jsonb, competitor_gap_summary = $3::jsonb WHERE user_id = $1`,
      [userId, JSON.stringify(next), JSON.stringify(summary)]
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
 * prompt, then derive typed evidence + the gap summary. Additive, idempotent.
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

  const summary = buildGapSummary(competitors, [...evidenceByText.values()]);

  let processed = 0;
  const result = await writeEvidence(userId, (current) => {
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
  }, summary);

  if (!result.written) return { userId, plan, status: 'all_failed', processed: 0, failed };
  return { userId, plan, status: 'gathered', processed, failed, competitor_gap_summary: summary };
}

/**
 * Offline re-derive: recompute typed evidence + gap summary from ALREADY-STORED
 * citations. NO Perplexity calls. Additive, idempotent, never-null.
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

  const newByText = new Map();
  const summaryEvidences = [];
  let needFetch = 0;
  for (const p of prompts) {
    if (!p || typeof p !== 'object' || !p.opportunity_evidence) continue;
    const ev = p.opportunity_evidence;
    const stored = ev.raw_cited_domains || ev.cited_domains || ev.cited_field;
    if (!Array.isArray(stored)) { needFetch += 1; continue; } // citations not retained
    const text = typeof p.text === 'string' ? p.text : null;
    if (text == null) continue;
    const fresh = deriveEvidence(normalizeDomainCounts(stored), brandCtx, competitors, {
      engine: ev.engine || ENGINE,
      gathered_at: ev.gathered_at,             // preserve original fetch time
      rederived_at: new Date().toISOString(),
    });
    newByText.set(text, fresh);
    if (qualifies(p)) summaryEvidences.push(fresh); // gap summary = high-value prompts only
  }

  if (newByText.size === 0) {
    return { userId, plan, status: 'nothing_to_rederive', need_fetch: needFetch };
  }

  const summary = buildGapSummary(competitors, summaryEvidences);

  let rederived = 0;
  const result = await writeEvidence(userId, (current) => {
    let changed = false;
    const next = current.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const ev = newByText.get(typeof p.text === 'string' ? p.text : null);
      if (!ev) return p;
      rederived += 1;
      changed = true;
      return { ...p, opportunity_evidence: ev };
    });
    return changed ? next : null;
  }, summary);

  if (!result.written) return { userId, plan, status: 'nothing_to_rederive', need_fetch: needFetch };
  return { userId, plan, status: 'rederived', rederived, need_fetch: needFetch, competitor_gap_summary: summary };
}

module.exports = {
  gatherOpportunityEvidence,
  rederiveOpportunityEvidence,
  // exposed for tests
  _internals: {
    extractDomain, deriveEvidence, buildEvidence, collectCompetitors,
    buildBrandContext, isBrandOwned, normalizeDomainCounts, buildGapSummary,
    classifyDomain, qualifies, VALUE_THRESHOLD,
  },
};
