/**
 * Opportunity EVIDENCE pass verification.
 *
 * Proves the strict-additive, facts-only contract of
 * services/draftGeneration/opportunityEvidence.js — including the honest
 * derivation (own-brand + social/junk exclusion, competitor_candidates,
 * raw_cited_domains) and the offline re-derive path — with an in-memory DB that
 * THROWS on any SQL other than the whitelisted reads + the single tracked_prompts
 * write, a stubbable Perplexity adapter, and a stub plan service.
 *
 *   node --test backend/tests/unit/opportunity-evidence.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// ---------------------------------------------------------------------------
// Mutable state + in-memory DB fake
// ---------------------------------------------------------------------------
const state = {
  plan: 'pro',
  draftConfig: { draft_enabled: true },
  profile: null,
  primaryDomain: null,
  scanUrl: null,
  runQuery: null,
  calls: [],            // queries sent to Perplexity
};

const RE_PROFILE = /SELECT tracked_prompts, competitors_business, competitors_visibility/;
const RE_USERS = /^SELECT primary_domain FROM users WHERE id = \$1$/;
const RE_SCANS = /SELECT url FROM scans/;
const RE_LOCK = /^SELECT tracked_prompts FROM visibility_profiles WHERE user_id = \$1 FOR UPDATE$/;
const RE_WRITE = /^UPDATE visibility_profiles SET tracked_prompts = \$2::jsonb WHERE user_id = \$1$/;

const PROFILE_COLS = ['tracked_prompts', 'competitors_business', 'competitors_visibility', 'company_name'];

function dbQuery(text) {
  const sql = text.trim().replace(/\s+/g, ' ');
  if (RE_PROFILE.test(sql)) {
    return Promise.resolve({ rows: state.profile ? [clone(pick(state.profile, PROFILE_COLS))] : [] });
  }
  if (RE_USERS.test(sql)) return Promise.resolve({ rows: [{ primary_domain: state.primaryDomain }] });
  if (RE_SCANS.test(sql)) return Promise.resolve({ rows: state.scanUrl ? [{ url: state.scanUrl }] : [] });
  throw new Error(`Unexpected db.query SQL (non-additive?): ${sql}`);
}

function makeClient() {
  return {
    query(text, params) {
      const sql = text.trim().replace(/\s+/g, ' ');
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve();
      if (RE_LOCK.test(sql)) {
        return Promise.resolve({ rows: state.profile ? [{ tracked_prompts: clone(state.profile.tracked_prompts) }] : [] });
      }
      if (RE_WRITE.test(sql)) {
        state.profile.tracked_prompts = JSON.parse(params[1]);
        return Promise.resolve({ rowCount: 1 });
      }
      throw new Error(`Unexpected client SQL (non-additive?): ${sql}`);
    },
    release() {},
  };
}

const dbFake = { query: dbQuery, getClient: () => Promise.resolve(makeClient()) };
const planFake = {
  resolvePlanForRequest: async () => ({ plan: state.plan }),
  getDraftConfig: () => state.draftConfig,
};
const perplexityFake = {
  runQuery: (q, opts) => { state.calls.push({ q, opts }); return state.runQuery(q, opts); },
  engine: 'perplexity',
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id.endsWith('/db/database')) return dbFake;
  if (id.endsWith('/planService')) return planFake;
  if (id.endsWith('/engines/perplexityAdapter')) return perplexityFake;
  return originalRequire.apply(this, arguments);
};

const {
  gatherOpportunityEvidence,
  rederiveOpportunityEvidence,
  _internals,
} = require('../../services/draftGeneration/opportunityEvidence');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function pick(o, keys) { const r = {}; for (const k of keys) r[k] = o[k]; return r; }
function stripEvidence(prompts) {
  return prompts.map((p) => { const c = { ...p }; delete c.opportunity_evidence; return c; });
}
function evidenceFor(prompts, text) {
  const p = prompts.find((x) => x.text === text);
  return p && p.opportunity_evidence;
}
const domainsOf = (cd) => (cd || []).map((d) => d.domain);

function baseProfile() {
  return {
    company_name: 'Acme',
    tracked_prompts: [
      { text: 'best crm for enterprise', funnel_stage: 'MOFU', is_monitored: true, volume: 200, value: { band: 5, basis: 'business_grounded', generated_at: 'V' } },
      { text: 'acme vs globex', funnel_stage: 'BOFU', is_monitored: false, volume: null, value: { band: 4 }, custom: { keep: 1 } },
      { text: 'what is a crm', funnel_stage: 'TOFU', is_monitored: true, volume: 50, value: { band: 2 } },
      { text: 'crm pricing', funnel_stage: 'BOFU', is_monitored: true, volume: 10 }, // no value
    ],
    competitors_business: [{ name: 'Globex', url: 'https://globex.com' }],
    competitors_visibility: [{ name: 'Initech', url: 'initech.io' }],
  };
}

// Deterministic citation sets keyed by prompt text. acme.com is the brand;
// reddit.com is social — both must be excluded from the competitive set.
const CITATIONS = {
  'best crm for enterprise': ['https://acme.com/crm', 'https://g2.com/a', 'https://g2.com/b', 'https://forbes.com/x'],
  'acme vs globex': ['https://www.globex.com/compare', 'https://reddit.com/r/crm', 'https://acme.com/vs'],
};

beforeEach(() => {
  state.plan = 'pro';
  state.draftConfig = { draft_enabled: true };
  state.profile = baseProfile();
  state.primaryDomain = 'https://www.acme.com';
  state.scanUrl = null;
  state.calls = [];
  state.runQuery = async (q) => ({ response: 'x', tokens_used: 1, citations: CITATIONS[q] || [] });
});

// ---------------------------------------------------------------------------
// gather (live)
// ---------------------------------------------------------------------------
describe('opportunity evidence — gather (live)', () => {
  it('SCOPED: only value.band >= threshold prompts call Perplexity', async () => {
    const res = await gatherOpportunityEvidence(1);
    assert.strictEqual(res.status, 'gathered');
    assert.strictEqual(res.processed, 2);
    assert.strictEqual(state.calls.length, 2);
    assert.deepStrictEqual(state.calls.map((c) => c.q).sort(), ['acme vs globex', 'best crm for enterprise']);
    assert.strictEqual(evidenceFor(state.profile.tracked_prompts, 'what is a crm'), undefined);
    assert.strictEqual(evidenceFor(state.profile.tracked_prompts, 'crm pricing'), undefined);
  });

  it('low search context + base sonar model used for the call', async () => {
    await gatherOpportunityEvidence(1);
    const opts = state.calls[0].opts;
    assert.strictEqual(opts.searchContextSize, 'low');
    assert.strictEqual(opts.model, require('../../config/models').OPPORTUNITY_PERPLEXITY_MODEL);
  });

  it('ADDITIVE-ONLY: only opportunity_evidence + tracked_prompts change', async () => {
    const before = clone(state.profile);
    await gatherOpportunityEvidence(1);
    assert.deepStrictEqual(state.profile.competitors_business, before.competitors_business);
    assert.deepStrictEqual(state.profile.competitors_visibility, before.competitors_visibility);
    assert.deepStrictEqual(stripEvidence(state.profile.tracked_prompts), stripEvidence(before.tracked_prompts));
  });

  it('FACTS-ONLY shape: landscape facts + new fields, NO score/band/weight', async () => {
    await gatherOpportunityEvidence(1);
    const ev = evidenceFor(state.profile.tracked_prompts, 'best crm for enterprise');
    assert.deepStrictEqual(Object.keys(ev).sort(), [
      'brand_present', 'cited_domains', 'competitor_candidates', 'competitors_present',
      'diversity_count', 'engine', 'gathered_at', 'raw_cited_domains',
    ]);
    for (const banned of ['band', 'score', 'weight', 'specificity', 'winnability', 'opportunity']) {
      assert.ok(!(banned in ev), `evidence must not contain ${banned}`);
    }
    assert.strictEqual(ev.engine, 'perplexity');
  });

  it('OWN-DOMAIN EXCLUSION: brand domain dropped from diversity but kept in raw', async () => {
    await gatherOpportunityEvidence(1);
    const ev = evidenceFor(state.profile.tracked_prompts, 'best crm for enterprise');
    // acme.com (brand) excluded from competitive set; g2.com + forbes.com remain.
    assert.deepStrictEqual(ev.cited_domains, [{ domain: 'g2.com', count: 2 }, { domain: 'forbes.com', count: 1 }]);
    assert.strictEqual(ev.diversity_count, 2);
    assert.deepStrictEqual(ev.competitor_candidates, ['g2.com', 'forbes.com']);
    // raw retains everything, brand included.
    assert.deepStrictEqual(domainsOf(ev.raw_cited_domains), ['acme.com', 'g2.com', 'forbes.com']);
    assert.strictEqual(ev.brand_present, true);
  });

  it('SOCIAL EXCLUSION + competitor match: reddit dropped, globex kept', async () => {
    await gatherOpportunityEvidence(1);
    const ev = evidenceFor(state.profile.tracked_prompts, 'acme vs globex');
    // reddit.com (social) + acme.com (brand) excluded → only globex.com competitive.
    assert.deepStrictEqual(ev.cited_domains, [{ domain: 'globex.com', count: 1 }]);
    assert.strictEqual(ev.diversity_count, 1);
    assert.deepStrictEqual(ev.competitor_candidates, ['globex.com']);
    assert.deepStrictEqual(domainsOf(ev.raw_cited_domains), ['globex.com', 'reddit.com', 'acme.com']);
    assert.strictEqual(ev.brand_present, true);
    // declared competitor Globex matched against the RAW set.
    assert.deepStrictEqual(ev.competitors_present, [{ name: 'Globex', domain: 'globex.com' }]);
  });

  it('reports declared competitors on the result', async () => {
    const res = await gatherOpportunityEvidence(1);
    assert.deepStrictEqual(res.declared_competitors.competitors_business, [{ name: 'Globex', url: 'https://globex.com', domain: 'globex.com' }]);
    assert.deepStrictEqual(res.declared_competitors.competitors_visibility, [{ name: 'Initech', url: 'initech.io', domain: 'initech.io' }]);
  });

  it('BRAND via scan-URL fallback when primary_domain unset', async () => {
    state.primaryDomain = null;
    state.scanUrl = 'https://www.acme.com/home';
    await gatherOpportunityEvidence(1);
    assert.strictEqual(evidenceFor(state.profile.tracked_prompts, 'best crm for enterprise').brand_present, true);
  });

  it('SCOPED no-op: no qualifying prompts → zero calls, untouched', async () => {
    state.profile.tracked_prompts = [{ text: 'a', value: { band: 3 } }, { text: 'b' }];
    const before = clone(state.profile);
    const res = await gatherOpportunityEvidence(1);
    assert.strictEqual(res.status, 'no_qualifying_prompts');
    assert.strictEqual(state.calls.length, 0);
    assert.deepStrictEqual(state.profile, before);
  });

  it('NEVER-NULL (per-prompt failure): failed prompt untouched, others proceed', async () => {
    state.profile.tracked_prompts[1].opportunity_evidence = { engine: 'perplexity', diversity_count: 9, gathered_at: 'OLD' };
    state.runQuery = async (q) => {
      if (q === 'acme vs globex') throw new Error('429 rate limited');
      return { response: 'x', citations: CITATIONS[q] || [] };
    };
    const res = await gatherOpportunityEvidence(1);
    assert.strictEqual(res.status, 'gathered');
    assert.strictEqual(res.processed, 1);
    assert.strictEqual(res.failed, 1);
    assert.strictEqual(evidenceFor(state.profile.tracked_prompts, 'acme vs globex').gathered_at, 'OLD');
    assert.notStrictEqual(evidenceFor(state.profile.tracked_prompts, 'best crm for enterprise'), undefined);
  });

  it('NEVER-NULL (total failure): all calls fail → write aborted, untouched', async () => {
    state.profile.tracked_prompts[0].opportunity_evidence = { engine: 'perplexity', diversity_count: 7 };
    const before = clone(state.profile);
    state.runQuery = async () => { throw new Error('network down'); };
    const res = await gatherOpportunityEvidence(1);
    assert.strictEqual(res.status, 'all_failed');
    assert.deepStrictEqual(state.profile, before);
  });

  it('IDEMPOTENT: re-run refreshes processed prompts only; others unchanged', async () => {
    await gatherOpportunityEvidence(1);
    const afterFirst = clone(state.profile);
    await gatherOpportunityEvidence(1);
    assert.deepStrictEqual(stripEvidence(state.profile.tracked_prompts), stripEvidence(afterFirst.tracked_prompts));
    assert.deepStrictEqual(
      evidenceFor(state.profile.tracked_prompts, 'best crm for enterprise').cited_domains,
      evidenceFor(afterFirst.tracked_prompts, 'best crm for enterprise').cited_domains
    );
  });

  it('ELIGIBILITY: ineligible plan no-ops without reading/calling', async () => {
    state.draftConfig = { draft_enabled: false };
    const before = clone(state.profile);
    const res = await gatherOpportunityEvidence(1);
    assert.strictEqual(res.status, 'skipped_not_eligible');
    assert.strictEqual(state.calls.length, 0);
    assert.deepStrictEqual(state.profile, before);
  });
});

// ---------------------------------------------------------------------------
// re-derive (offline; the Goldwynn case)
// ---------------------------------------------------------------------------
describe('opportunity evidence — re-derive (offline, no Perplexity)', () => {
  function goldwynnProfile() {
    return {
      company_name: 'Goldwynn Bahamas',
      competitors_business: [{ name: 'Albany', url: 'https://albany.com' }],
      competitors_visibility: [],
      tracked_prompts: [
        {
          text: 'is Goldwynn Bahamas worth the investment',
          funnel_stage: 'BOFU', is_monitored: true, volume: 30, value: { band: 5 },
          // OLD-shape evidence: brand + social inflate diversity to 5.
          opportunity_evidence: {
            cited_domains: [
              { domain: 'goldwynnbahamas.com', count: 1 },
              { domain: 'goldwynnresorts.com', count: 1 },
              { domain: 'goldwynn.com', count: 1 },
              { domain: 'expedia.com', count: 1 },
              { domain: 'albany.com', count: 2 },
            ],
            diversity_count: 5, brand_present: false, competitors_present: [],
            engine: 'perplexity', gathered_at: 'ORIGINAL',
          },
        },
        { text: 'low value prompt', funnel_stage: 'TOFU', value: { band: 2 } }, // no evidence
      ],
    };
  }

  beforeEach(() => {
    state.profile = goldwynnProfile();
    state.primaryDomain = 'https://www.goldwynnbahamas.com';
    state.calls = [];
  });

  it('recomputes from stored domains with ZERO Perplexity calls', async () => {
    const res = await rederiveOpportunityEvidence(1);
    assert.strictEqual(res.status, 'rederived');
    assert.strictEqual(res.rederived, 1);
    assert.strictEqual(state.calls.length, 0, 'must not call Perplexity');
  });

  it('collapses brand variants + social, exposes competitor_candidates', async () => {
    await rederiveOpportunityEvidence(1);
    const ev = evidenceFor(state.profile.tracked_prompts, 'is Goldwynn Bahamas worth the investment');
    // goldwynnbahamas/goldwynnresorts/goldwynn collapsed (brand), expedia (social) dropped.
    assert.deepStrictEqual(ev.cited_domains, [{ domain: 'albany.com', count: 2 }]);
    assert.strictEqual(ev.diversity_count, 1);
    assert.deepStrictEqual(ev.competitor_candidates, ['albany.com']);
    assert.strictEqual(ev.brand_present, true, 'a brand domain is present');
    // declared competitor Albany matched.
    assert.deepStrictEqual(ev.competitors_present, [{ name: 'Albany', domain: 'albany.com' }]);
    // raw retains all five; original fetch time preserved; rederive stamped.
    assert.deepStrictEqual(domainsOf(ev.raw_cited_domains),
      ['goldwynnbahamas.com', 'goldwynnresorts.com', 'goldwynn.com', 'expedia.com', 'albany.com']);
    assert.strictEqual(ev.gathered_at, 'ORIGINAL');
    assert.ok(typeof ev.rederived_at === 'string');
  });

  it('ADDITIVE + idempotent: other keys untouched; second run stable', async () => {
    const before = clone(state.profile);
    await rederiveOpportunityEvidence(1);
    assert.deepStrictEqual(stripEvidence(state.profile.tracked_prompts), stripEvidence(before.tracked_prompts));
    const afterFirst = clone(evidenceFor(state.profile.tracked_prompts, 'is Goldwynn Bahamas worth the investment'));
    await rederiveOpportunityEvidence(1);
    const afterSecond = evidenceFor(state.profile.tracked_prompts, 'is Goldwynn Bahamas worth the investment');
    assert.deepStrictEqual(afterSecond.cited_domains, afterFirst.cited_domains);
    assert.deepStrictEqual(afterSecond.raw_cited_domains, afterFirst.raw_cited_domains);
  });

  it('reports declared competitors', async () => {
    const res = await rederiveOpportunityEvidence(1);
    assert.deepStrictEqual(res.declared_competitors.competitors_business, [{ name: 'Albany', url: 'https://albany.com', domain: 'albany.com' }]);
    assert.deepStrictEqual(res.declared_competitors.competitors_visibility, []);
  });

  it('NEVER-NULL: nothing stored to recompute → no write', async () => {
    state.profile.tracked_prompts = [{ text: 'x', value: { band: 5 } }]; // no evidence
    const before = clone(state.profile);
    const res = await rederiveOpportunityEvidence(1);
    assert.strictEqual(res.status, 'nothing_to_rederive');
    assert.deepStrictEqual(state.profile, before);
  });
});

// ---------------------------------------------------------------------------
// pure derivation internals
// ---------------------------------------------------------------------------
describe('derivation internals', () => {
  const { extractDomain, buildBrandContext, isBrandOwned, isSocialJunk } = _internals;

  it('extractDomain reduces to registrable (eTLD+1)', () => {
    assert.strictEqual(extractDomain('https://docs.globex.com/x'), 'globex.com');
    assert.strictEqual(extractDomain('https://shop.acme.co.uk/x'), 'acme.co.uk');
    assert.strictEqual(extractDomain('initech.io'), 'initech.io');
    assert.strictEqual(extractDomain('not a url'), null);
  });

  it('isBrandOwned collapses prefix variants, not unrelated geo', () => {
    const ctx = buildBrandContext({ brandDomain: 'goldwynnbahamas.com', companyName: 'Goldwynn Bahamas' });
    assert.strictEqual(isBrandOwned('goldwynnbahamas.com', ctx), true);
    assert.strictEqual(isBrandOwned('goldwynnresorts.com', ctx), true);
    assert.strictEqual(isBrandOwned('goldwynn.com', ctx), true);
    assert.strictEqual(isBrandOwned('albany.com', ctx), false);
    assert.strictEqual(isBrandOwned('bahamasrealty.com', ctx), false, 'geo word must not match');
  });

  it('isSocialJunk flags configured low-authority domains', () => {
    for (const d of ['facebook.com', 'youtube.com', 'reddit.com', 'tripadvisor.com', 'expedia.com']) {
      assert.strictEqual(isSocialJunk(d), true, d);
    }
    assert.strictEqual(isSocialJunk('albany.com'), false);
  });
});
