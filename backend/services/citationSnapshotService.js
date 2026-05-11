/**
 * CitationSnapshotService
 *
 * Runs a scan-time citation test after a scan completes. Picks engines and
 * query volume based on the user's plan (hasCitation entitlement), pulls
 * queries from prompt_clusters when available with a generic fallback,
 * and delegates execution to CitationTestService.
 *
 *   runScanTimeCitation(scanId, userId, domain) → result | { skipped: true, reason }
 *
 * Designed to be called fire-and-forget from the scan completion hook.
 * All errors are swallowed by the caller, but this service still logs
 * informatively so issues are visible.
 */

const db = require('../db/database');
const CitationTestService = require('./citationTestService');
const { getEntitlements } = require('./planService');

// hasCitation → { engines, maxQueries, storePro }
const CITATION_TIER_CONFIG = Object.freeze({
  teaser:   { engines: ['chatgpt'],                          maxQueries: 5,  storePro: false },
  standard: { engines: ['chatgpt', 'claude'],                maxQueries: 15, storePro: false },
  pro:      { engines: ['chatgpt', 'claude', 'perplexity'],  maxQueries: 30, storePro: true  },
});

// engine → env var holding its API key
const ENGINE_KEY_ENV = Object.freeze({
  claude:     'ANTHROPIC_API_KEY',
  chatgpt:    'OPENAI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
});

// ---------------------------------------------------------------------------

async function runScanTimeCitation(scanId, userId, domain) {
  if (!scanId || !userId || !domain) {
    console.warn('[CitationSnapshot] missing inputs (scanId/userId/domain); skipping');
    return { skipped: true, reason: 'missing_inputs' };
  }

  // 1) Resolve plan + tier config
  const userPlan = await loadUserPlan(userId);
  const entitlements = getEntitlements(userPlan);
  const tier = entitlements.hasCitation || 'teaser';
  const tierConfig = CITATION_TIER_CONFIG[tier];
  if (!tierConfig) {
    console.warn(`[CitationSnapshot] unknown citation tier '${tier}' for user ${userId}; skipping`);
    return { skipped: true, reason: 'unknown_tier' };
  }

  // 2) Filter engines down to those with API keys configured
  const availableEngines = tierConfig.engines.filter(e => Boolean(process.env[ENGINE_KEY_ENV[e]]));
  if (availableEngines.length === 0) {
    console.warn(
      `[CitationSnapshot] no API keys configured for tier '${tier}' engines ` +
      `(${tierConfig.engines.join(', ')}); skipping citation testing for scan ${scanId}`
    );
    return { skipped: true, reason: 'no_engine_keys' };
  }
  if (availableEngines.length < tierConfig.engines.length) {
    const missing = tierConfig.engines.filter(e => !availableEngines.includes(e));
    console.warn(`[CitationSnapshot] missing API keys for: ${missing.join(', ')}; proceeding with ${availableEngines.join(', ')}`);
  }

  // 3) Pick queries: user clusters → generic vertical clusters → fallback
  const userIndustry = await loadUserIndustry(userId);
  let queries = await loadQueriesFromClusters({ userId, vertical: userIndustry });
  if (!queries || queries.length === 0) {
    queries = buildFallbackQueries(domain, userIndustry);
    console.log(`[CitationSnapshot] no prompt_clusters found; using ${queries.length} generic fallback queries`);
  }
  // Trim to tier's maxQueries
  if (queries.length > tierConfig.maxQueries) {
    queries = queries.slice(0, tierConfig.maxQueries);
  }

  // 4) Competitor domains (Pro only; placeholder until competitor tracking lands)
  const competitorDomains = tierConfig.storePro ? await loadCompetitorDomains(userId) : [];

  console.log(
    `[CitationSnapshot] scan ${scanId} user ${userId} tier=${tier} ` +
    `engines=${availableEngines.join(',')} queries=${queries.length} ` +
    `storePro=${tierConfig.storePro}`
  );

  try {
    const result = await CitationTestService.runTestSuite(userId, {
      scanId,
      runType: 'scan_time',
      queries,
      engines: availableEngines,
      domain,
      competitorDomains,
      storePro: tierConfig.storePro,
    });
    return {
      skipped: false,
      testRunId: result.testRunId,
      queriesRun: result.totalQueries,
      citedCount: result.citedCount,
      notCitedCount: result.notCitedCount,
    };
  } catch (err) {
    console.error(`[CitationSnapshot] runTestSuite failed for scan ${scanId}: ${err.message}`);
    return { skipped: true, reason: 'suite_failed', error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadUserPlan(userId) {
  try {
    const r = await db.query('SELECT plan FROM users WHERE id = $1', [userId]);
    return r.rows[0] ? r.rows[0].plan : null;
  } catch (e) {
    console.warn(`[CitationSnapshot] could not load plan for user ${userId}: ${e.message}`);
    return null;
  }
}

async function loadUserIndustry(userId) {
  try {
    const r = await db.query('SELECT industry FROM users WHERE id = $1', [userId]);
    return (r.rows[0] && r.rows[0].industry) || null;
  } catch {
    return null;
  }
}

/**
 * Pull queries from prompt_clusters:
 *   1. user-specific clusters (user_id = $userId, active = true)
 *   2. generic vertical clusters (user_id IS NULL, vertical = $vertical, active = true)
 * Returns a flat array of query strings. Empty if nothing matches.
 */
async function loadQueriesFromClusters({ userId, vertical }) {
  try {
    const userRes = await db.query(
      `SELECT queries FROM prompt_clusters WHERE user_id = $1 AND active = true`,
      [userId]
    );
    const userQueries = flattenQueries(userRes.rows);
    if (userQueries.length > 0) return userQueries;

    if (vertical) {
      const genRes = await db.query(
        `SELECT queries FROM prompt_clusters WHERE user_id IS NULL AND vertical = $1 AND active = true`,
        [vertical]
      );
      const genQueries = flattenQueries(genRes.rows);
      if (genQueries.length > 0) return genQueries;
    }
    return [];
  } catch (e) {
    // Likely the prompt_clusters table doesn't exist yet (migration 018 not applied).
    console.warn(`[CitationSnapshot] prompt_clusters lookup failed: ${e.message}`);
    return [];
  }
}

function flattenQueries(rows) {
  const out = [];
  for (const r of rows) {
    const qs = r.queries;
    if (Array.isArray(qs)) {
      for (const q of qs) {
        if (typeof q === 'string' && q.trim()) out.push(q.trim());
        else if (q && typeof q.text === 'string') out.push(q.text.trim());
      }
    }
  }
  return out;
}

/**
 * Generic fallback queries when no prompt clusters exist for this user/vertical.
 * Caller still trims to the tier's maxQueries.
 */
function buildFallbackQueries(domain, industry) {
  const bare = String(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  const indSlot = industry ? industry : 'business';
  return [
    `What is ${bare}?`,
    `Is ${bare} a good ${indSlot} tool?`,
    `What are alternatives to ${bare}?`,
    `Tell me about ${bare}'s features`,
    `Should I use ${bare}?`,
    `What do people say about ${bare}?`,
    `Compare ${bare} to competitors`,
    `Is ${bare} worth it?`,
    `What problems does ${bare} solve?`,
    `Who should use ${bare}?`,
  ];
}

async function loadCompetitorDomains(userId) {
  // Placeholder for a future competitive-tracking lookup. For now, empty.
  void userId;
  return [];
}

module.exports = {
  runScanTimeCitation,
  // Exposed for tests / introspection
  CITATION_TIER_CONFIG,
  _internal: { buildFallbackQueries, flattenQueries, loadQueriesFromClusters },
};
