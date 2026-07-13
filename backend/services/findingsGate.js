'use strict';

/**
 * findingsGate.js — gate evidence-only findings on the rubric's per-subfactor
 * scores (B1 Step 2/3), so a finding never contradicts the score.
 *
 * Only used when a scan has detailed_analysis.subfactorScores (future scans).
 * Old scans have none → the caller skips the gate entirely (evidence-only).
 *
 * The map is intentionally CONSERVATIVE: a resolver is gated only where it maps
 * unambiguously to a rubric leaf. Ungatable resolvers (no clean counterpart)
 * fall through to current evidence-only behavior rather than being wrongly
 * gated — a wrong gate suppresses/surfaces the wrong finding, which is worse.
 *
 * "Full credit" per leaf is the rubric's top tier value (from
 * v5-enhanced-rubric-engine.js). A finding is suppressed only when the rubric
 * gave the leaf full credit; anything below full credit surfaces the finding.
 */

// resolver canonical_key → { path in subfactorScores, fullCredit }
// path handles both flat leaves (aiReadability.subfactors.altText) and nested
// parameter→factors leaves (…subfactors.<param>.factors.<leaf>).
const RESOLVER_TO_RUBRIC = Object.freeze({
  'technical_setup.sitemap_indexing': {
    path: ['technicalSetup', 'subfactors', 'crawlerAccess', 'factors', 'sitemap'],
    fullCredit: 1.8, // 1.8 present / 0 absent (binary)
  },
  'technical_setup.structured_data_coverage': {
    path: ['technicalSetup', 'subfactors', 'structuredData', 'factors', 'schemaMarkup'],
    fullCredit: 1.8, // scoreTier top = 1.8
  },
  'ai_search_readiness.icp_faqs': {
    path: ['aiSearchReadiness', 'subfactors', 'directAnswerStructure', 'factors', 'faqContent'],
    fullCredit: 2.0, // 5+ visible FAQs = 2.0
  },
  'ai_search_readiness.query_intent_alignment': {
    path: ['aiSearchReadiness', 'subfactors', 'directAnswerStructure', 'factors', 'questionDensity'],
    fullCredit: 2.0, // max(percent,absolute) tiers top = 2.0
  },
  'trust_authority.author_bios': {
    path: ['trustAuthority', 'subfactors', 'eeat', 'factors', 'authorProfiles'],
    fullCredit: 1.2, // hasAuthor = 1.2 / 0.4 (binary)
  },
  'ai_readability.alt_text_coverage': {
    path: ['aiReadability', 'subfactors', 'altText'], // flat leaf
    fullCredit: 2.0, // 90%+ coverage = 2.0
  },
});

// Resolvers with NO clean rubric counterpart → never gated (evidence-only).
const UNGATABLE_RESOLVERS = Object.freeze([
  'technical_setup.organization_schema', // rubric has generic schemaMarkup, no org-specific leaf
  'technical_setup.social_meta_tags',    // no OG/social leaf in the rubric
  'technical_setup.crawler_access',      // ambiguous: param spans robots/ttfb/cdn, no single leaf
  'ai_search_readiness.evidence_proof_points', // no clean leaf
]);

const EPSILON = 1e-9;

function getAtPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Should this finding be suppressed because the rubric already credits it?
 * @returns {{ suppress: boolean, reason: string }}
 */
function decideForResolver(resolverKey, subfactorScores) {
  const entry = RESOLVER_TO_RUBRIC[resolverKey];
  if (!entry) return { suppress: false, reason: 'ungatable' };            // evidence-only
  const value = getAtPath(subfactorScores, entry.path);
  if (typeof value !== 'number') return { suppress: false, reason: 'no_rubric_value' }; // can't gate → keep
  if (value >= entry.fullCredit - EPSILON) {
    return { suppress: true, reason: `rubric full credit (${value} >= ${entry.fullCredit})` };
  }
  return { suppress: false, reason: `below full credit (${value} < ${entry.fullCredit})` };
}

/**
 * Filter generated finding rows against the rubric. Rows must carry
 * `subfactor_key` (the resolver canonical key). Returns { kept, suppressed }.
 * If subfactorScores is falsy the gate is a no-op (all kept) — the caller
 * should only invoke this when subfactorScores is present.
 */
function gateRows(rows, subfactorScores) {
  const kept = [];
  const suppressed = [];
  for (const row of rows) {
    const decision = decideForResolver(row.subfactor_key, subfactorScores);
    if (decision.suppress) suppressed.push({ subfactor_key: row.subfactor_key, reason: decision.reason });
    else kept.push(row);
  }
  return { kept, suppressed };
}

// ---- Audit (Step 2): printed so we can see coverage / ungatable gaps --------

// Finding resolvers that cannot be gated (surfaced but score/findings can still
// diverge). These stay evidence-only by design.
function ungatableResolvers() {
  return [...UNGATABLE_RESOLVERS];
}

// Rubric leaves that no resolver consumes (scored but never surfaced) — walks a
// real subfactorScores payload and lists leaves not referenced by any map path.
function unmappedRubricLeaves(subfactorScores) {
  const mappedLeaves = new Set(
    Object.values(RESOLVER_TO_RUBRIC).map(e => e.path.join('.'))
  );
  const leaves = [];
  const sf = subfactorScores || {};
  for (const [cat, catData] of Object.entries(sf)) {
    const subs = catData && catData.subfactors;
    if (!subs || typeof subs !== 'object') continue;
    for (const [subKey, subVal] of Object.entries(subs)) {
      if (typeof subVal === 'number') {
        // flat leaf
        const p = `${cat}.subfactors.${subKey}`;
        if (!mappedLeaves.has(p)) leaves.push(p);
      } else if (subVal && typeof subVal === 'object' && subVal.factors) {
        for (const leaf of Object.keys(subVal.factors)) {
          const p = `${cat}.subfactors.${subKey}.factors.${leaf}`;
          if (!mappedLeaves.has(p)) leaves.push(p);
        }
      }
    }
  }
  return leaves;
}

module.exports = {
  RESOLVER_TO_RUBRIC,
  UNGATABLE_RESOLVERS,
  decideForResolver,
  gateRows,
  getAtPath,
  ungatableResolvers,
  unmappedRubricLeaves,
};
