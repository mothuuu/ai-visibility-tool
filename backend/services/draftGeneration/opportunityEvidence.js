'use strict';

/**
 * Opportunity EVIDENCE pass (Perplexity citation bootstrap).
 *
 * Surfaces the REAL cited-source landscape for HIGH-VALUE prompts and stores it
 * as grounded, facts-only evidence on each prompt. This is the evidence layer
 * ONLY — it computes NO score, band, weight, specificity, or winnability. The
 * Opportunity SCORE is a separate later pass that reads this data.
 *
 * Self-contained on visibility_profiles.tracked_prompts: it does NOT touch
 * citation_evidence / prompt_clusters / either citation schema / deeperScanService.
 *
 * Strictly additive, mirroring the Value scorer exactly:
 *   - writes ONLY an `opportunity_evidence` property onto matching prompts
 *   - preserves text, funnel_stage, is_monitored, volume, value and every key
 *   - touches no other column than tracked_prompts
 *   - per-prompt failure skips that prompt (its evidence untouched); total
 *     failure aborts the write entirely (never overwrites real data with blanks)
 *   - idempotent: re-running refreshes evidence only on processed prompts
 *
 * Reuses existing infra: perplexityAdapter.runQuery via property access
 * (stubbable), model from config/models.js (never hardcoded). One base-Sonar
 * call with LOW search context per qualifying prompt (cheapest citation-bearing).
 *
 * Plan gate: same getDraftConfig eligibility as the Value scorer.
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

// Registrable-suffixes that take three labels (eTLD+1 spans two dots), so
// e.g. acme.co.uk reduces to acme.co.uk, not co.uk. Small, pragmatic list.
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

/**
 * Ported from the dormant citationMonitoringService.extractDomain (host, www-
 * stripped, lowercased), then reduced to the REGISTRABLE domain (eTLD+1) so the
 * cited-source list and competitor matching are at the same granularity and a
 * cited subdomain (docs.acme.com) still matches the declared brand/competitor
 * (acme.com). Returns null when no domain can be parsed.
 */
function extractDomain(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let host = null;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    // Allow bare domain strings from upstream parsers.
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

/**
 * Build the facts-only evidence object for one prompt from its Perplexity
 * citation URLs. NO scoring/judgement — pure landscape facts.
 *
 * @param {string[]} citationUrls full URLs
 * @param {string|null} brandDomain registrable domain of the customer
 * @param {Array<{name:string,domain:string}>} competitors declared competitors w/ registrable domain
 */
function buildEvidence(citationUrls, brandDomain, competitors) {
  // Deduped registrable domains, first-seen order, with repeat counts.
  const order = [];
  const counts = new Map();
  for (const url of asArray(citationUrls)) {
    const domain = extractDomain(url);
    if (!domain) continue;
    if (!counts.has(domain)) {
      counts.set(domain, 0);
      order.push(domain);
    }
    counts.set(domain, counts.get(domain) + 1);
  }
  const cited_domains = order.map((domain) => ({ domain, count: counts.get(domain) }));
  const domainSet = new Set(order);

  const brand_present = Boolean(brandDomain && domainSet.has(brandDomain));
  const competitors_present = competitors
    .filter((c) => c.domain && domainSet.has(c.domain))
    .map((c) => ({ name: c.name, domain: c.domain }));

  return {
    cited_domains,
    diversity_count: cited_domains.length,
    brand_present,
    competitors_present,
    engine: ENGINE,
    gathered_at: new Date().toISOString(),
  };
}

/** Declared competitors → [{ name, domain(registrable|null) }] from both columns. */
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
    `SELECT tracked_prompts, competitors_business, competitors_visibility
       FROM visibility_profiles
      WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Resolve the customer's own domain: users.primary_domain first, else the most
 * recent completed scan's URL. Registrable domain, or null if none resolvable.
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
 * array, or null to abort (commit nothing). Identical guard to the Value scorer.
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
 * Gather Opportunity evidence for a user's HIGH-VALUE prompts. Strictly
 * additive and idempotent. Facts only — no scoring.
 *
 * @param {number} userId
 * @returns {Promise<{userId:number, status:string, [processed]:number, [failed]:number, [plan]:string}>}
 *   statuses: skipped_not_eligible | no_profile | no_prompts |
 *             no_qualifying_prompts | all_failed | gathered
 */
async function gatherOpportunityEvidence(userId) {
  if (!userId) throw new Error('gatherOpportunityEvidence requires a userId');

  // 1) Eligibility — same gate as Value.
  const { plan } = await resolvePlanForRequest({ userId });
  const cfg = getDraftConfig(plan);
  if (!cfg[ELIGIBILITY_FLAG]) {
    return { userId, plan, status: 'skipped_not_eligible' };
  }

  // 2) Load prompts + competitors; resolve the customer's own domain.
  const profile = await readProfile(userId);
  if (!profile) return { userId, plan, status: 'no_profile' };

  const prompts = asArray(profile.tracked_prompts);
  if (prompts.length === 0) return { userId, plan, status: 'no_prompts' };

  // High-value only — no-value / low-value prompts make ZERO Perplexity calls.
  const qualifying = prompts.filter(qualifies);
  if (qualifying.length === 0) {
    return { userId, plan, status: 'no_qualifying_prompts' };
  }

  const brandDomain = await readBrandDomain(userId);
  const competitors = collectCompetitors(profile);

  // 3) ONE base-Sonar (low search context) call per qualifying prompt. A failed
  //    call skips THAT prompt only; successful calls produce facts-only evidence.
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
      evidenceByText.set(text, buildEvidence(citations, brandDomain, competitors));
    } catch (err) {
      failed += 1;
      console.warn(
        `[opportunityEvidence] user ${userId}: Perplexity call failed for a prompt ` +
          `(${err && err.message ? err.message : err}); skipping that prompt`
      );
    }
  }

  // Total failure => abort the write entirely; leave tracked_prompts untouched.
  if (evidenceByText.size === 0) {
    console.warn(
      `[opportunityEvidence] user ${userId}: all ${qualifying.length} Perplexity calls failed; ` +
        `aborting write (tracked_prompts untouched)`
    );
    return { userId, plan, status: 'all_failed', failed };
  }

  // 4) Strictly additive write-back: set `opportunity_evidence` ONLY on exact-text
  //    matches we processed; leave every other key and every unprocessed prompt's
  //    evidence UNCHANGED.
  let processed = 0;
  const result = await applyToTrackedPrompts(userId, (current) => {
    let changed = false;
    const next = current.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const ev = evidenceByText.get(typeof p.text === 'string' ? p.text : null);
      if (!ev) return p;                                   // unprocessed => unchanged
      processed += 1;
      changed = true;
      return { ...p, opportunity_evidence: ev };           // only this key touched
    });
    return changed ? next : null;
  });

  if (!result.written) {
    return { userId, plan, status: 'all_failed', processed: 0, failed };
  }
  return { userId, plan, status: 'gathered', processed, failed };
}

module.exports = {
  gatherOpportunityEvidence,
  // exposed for tests
  _internals: { extractDomain, buildEvidence, collectCompetitors, qualifies, VALUE_THRESHOLD },
};
