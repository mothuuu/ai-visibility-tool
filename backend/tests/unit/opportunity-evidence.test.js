/**
 * Opportunity EVIDENCE pass verification.
 *
 * Proves the strict-additive, facts-only contract of
 * services/draftGeneration/opportunityEvidence.js with an in-memory DB that
 * THROWS on any SQL other than the whitelisted reads + the single tracked_prompts
 * write (so a stray column/table write fails the test), a stubbable Perplexity
 * adapter, and a stub plan service.
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

function dbQuery(text) {
  const sql = text.trim().replace(/\s+/g, ' ');
  if (RE_PROFILE.test(sql)) {
    return Promise.resolve({ rows: state.profile ? [clone(pick(state.profile, ['tracked_prompts', 'competitors_business', 'competitors_visibility']))] : [] });
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

const { gatherOpportunityEvidence, _internals } = require('../../services/draftGeneration/opportunityEvidence');

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

function baseProfile() {
  return {
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

// Deterministic citation sets keyed by prompt text.
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
// tests
// ---------------------------------------------------------------------------
describe('opportunity evidence — strict additive, facts only', () => {
  it('SCOPED: only value.band >= threshold prompts call Perplexity', async () => {
    const res = await gatherOpportunityEvidence(1);
    assert.strictEqual(res.status, 'gathered');
    assert.strictEqual(res.processed, 2);
    // Exactly the two high-value prompts were queried; low/no-value made zero calls.
    assert.strictEqual(state.calls.length, 2);
    const queried = state.calls.map((c) => c.q).sort();
    assert.deepStrictEqual(queried, ['acme vs globex', 'best crm for enterprise']);
    // Low/no-value prompts carry no evidence.
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

    // No other column written (the fake throws otherwise). Non-tracked columns equal.
    assert.deepStrictEqual(state.profile.competitors_business, before.competitors_business);
    assert.deepStrictEqual(state.profile.competitors_visibility, before.competitors_visibility);
    // Every prompt key other than opportunity_evidence byte-identical (value/volume/funnel/text/custom).
    assert.deepStrictEqual(stripEvidence(state.profile.tracked_prompts), stripEvidence(before.tracked_prompts));
  });

  it('FACTS-ONLY: evidence has landscape facts and NO score/band/weight', async () => {
    await gatherOpportunityEvidence(1);
    const ev = evidenceFor(state.profile.tracked_prompts, 'best crm for enterprise');
    assert.deepStrictEqual(Object.keys(ev).sort(), ['brand_present', 'cited_domains', 'competitors_present', 'diversity_count', 'engine', 'gathered_at']);
    for (const banned of ['band', 'score', 'weight', 'specificity', 'winnability', 'opportunity']) {
      assert.ok(!(banned in ev), `evidence must not contain ${banned}`);
    }
    // cited_domains: deduped registrable, first-seen order, with repeat counts.
    assert.deepStrictEqual(ev.cited_domains, [
      { domain: 'acme.com', count: 1 },
      { domain: 'g2.com', count: 2 },
      { domain: 'forbes.com', count: 1 },
    ]);
    assert.strictEqual(ev.diversity_count, 3);
    assert.strictEqual(ev.engine, 'perplexity');
  });

  it('BRAND + COMPETITOR detection by registrable domain', async () => {
    await gatherOpportunityEvidence(1);
    const ev1 = evidenceFor(state.profile.tracked_prompts, 'best crm for enterprise');
    assert.strictEqual(ev1.brand_present, true, 'acme.com present in citations');
    assert.deepStrictEqual(ev1.competitors_present, [], 'no competitor cited for this prompt');

    const ev2 = evidenceFor(state.profile.tracked_prompts, 'acme vs globex');
    assert.strictEqual(ev2.brand_present, true);
    // www.globex.com cited → matched to declared competitor Globex by registrable domain.
    assert.deepStrictEqual(ev2.competitors_present, [{ name: 'Globex', domain: 'globex.com' }]);
  });

  it('BRAND via scan-URL fallback when primary_domain unset', async () => {
    state.primaryDomain = null;
    state.scanUrl = 'https://www.acme.com/home';
    await gatherOpportunityEvidence(1);
    assert.strictEqual(evidenceFor(state.profile.tracked_prompts, 'best crm for enterprise').brand_present, true);
  });

  it('SCOPED no-op: no qualifying prompts → zero calls, untouched', async () => {
    state.profile.tracked_prompts = [
      { text: 'a', value: { band: 3 } },
      { text: 'b' }, // no value
    ];
    const before = clone(state.profile);
    const res = await gatherOpportunityEvidence(1);
    assert.strictEqual(res.status, 'no_qualifying_prompts');
    assert.strictEqual(state.calls.length, 0);
    assert.deepStrictEqual(state.profile, before);
  });

  it('NEVER-NULL (per-prompt failure): failed prompt untouched, others proceed', async () => {
    // Pre-seed existing evidence on the prompt whose call will fail.
    state.profile.tracked_prompts[1].opportunity_evidence = { engine: 'perplexity', diversity_count: 9, gathered_at: 'OLD' };
    state.runQuery = async (q) => {
      if (q === 'acme vs globex') throw new Error('429 rate limited');
      return { response: 'x', citations: CITATIONS[q] || [] };
    };
    const res = await gatherOpportunityEvidence(1);
    assert.strictEqual(res.status, 'gathered');
    assert.strictEqual(res.processed, 1);
    assert.strictEqual(res.failed, 1);
    // Failed prompt keeps its OLD evidence; succeeded prompt refreshed.
    assert.strictEqual(evidenceFor(state.profile.tracked_prompts, 'acme vs globex').gathered_at, 'OLD');
    assert.notStrictEqual(evidenceFor(state.profile.tracked_prompts, 'best crm for enterprise'), undefined);
  });

  it('NEVER-NULL (total failure): all calls fail → write aborted, untouched', async () => {
    state.profile.tracked_prompts[0].opportunity_evidence = { engine: 'perplexity', diversity_count: 7 };
    const before = clone(state.profile);
    state.runQuery = async () => { throw new Error('network down'); };
    const res = await gatherOpportunityEvidence(1);
    assert.strictEqual(res.status, 'all_failed');
    assert.deepStrictEqual(state.profile, before, 'tracked_prompts untouched on total failure');
  });

  it('IDEMPOTENT: re-run refreshes processed prompts only; others unchanged', async () => {
    await gatherOpportunityEvidence(1);
    const afterFirst = clone(state.profile);
    await gatherOpportunityEvidence(1);
    // Non-evidence keys identical; processed prompts still carry evidence; unprocessed still none.
    assert.deepStrictEqual(stripEvidence(state.profile.tracked_prompts), stripEvidence(afterFirst.tracked_prompts));
    assert.deepStrictEqual(
      evidenceFor(state.profile.tracked_prompts, 'best crm for enterprise').cited_domains,
      evidenceFor(afterFirst.tracked_prompts, 'best crm for enterprise').cited_domains
    );
    assert.strictEqual(evidenceFor(state.profile.tracked_prompts, 'what is a crm'), undefined);
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

describe('extractDomain — registrable reduction', () => {
  const { extractDomain } = _internals;
  it('reduces subdomains to eTLD+1', () => {
    assert.strictEqual(extractDomain('https://docs.globex.com/x'), 'globex.com');
    assert.strictEqual(extractDomain('https://www.acme.com'), 'acme.com');
  });
  it('handles two-label second-level TLDs', () => {
    assert.strictEqual(extractDomain('https://shop.acme.co.uk/x'), 'acme.co.uk');
  });
  it('accepts bare domains and rejects junk', () => {
    assert.strictEqual(extractDomain('initech.io'), 'initech.io');
    assert.strictEqual(extractDomain('not a url'), null);
    assert.strictEqual(extractDomain(null), null);
  });
});
