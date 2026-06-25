/**
 * Opportunity EVIDENCE pass verification — typed cited field + competitor gap.
 *
 * In-memory DB that THROWS on any SQL other than the whitelisted reads + the
 * single two-column write (tracked_prompts + competitor_gap_summary), a stubbable
 * Perplexity adapter, and a stub plan service.
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
  calls: [],
};

const RE_PROFILE = /SELECT tracked_prompts, competitors_business, competitors_visibility/;
const RE_USERS = /^SELECT primary_domain FROM users WHERE id = \$1$/;
const RE_SCANS = /SELECT url FROM scans/;
const RE_LOCK = /^SELECT tracked_prompts FROM visibility_profiles WHERE user_id = \$1 FOR UPDATE$/;
const RE_WRITE = /^UPDATE visibility_profiles SET tracked_prompts = \$2::jsonb, competitor_gap_summary = \$3::jsonb WHERE user_id = \$1$/;

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
        state.profile.competitor_gap_summary = JSON.parse(params[2]);
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
const fieldClasses = (cf) => (cf || []).map((e) => `${e.domain}:${e.class}`);

function baseProfile() {
  return {
    company_name: 'Acme',
    tracked_prompts: [
      { text: 'best crm for enterprise', funnel_stage: 'MOFU', is_monitored: true, volume: 200, value: { band: 5 } },
      { text: 'acme vs globex', funnel_stage: 'BOFU', is_monitored: false, volume: null, value: { band: 4 }, custom: { keep: 1 } },
      { text: 'what is a crm', funnel_stage: 'TOFU', is_monitored: true, volume: 50, value: { band: 2 } },
      { text: 'crm pricing', funnel_stage: 'BOFU', is_monitored: true, volume: 10 },
    ],
    competitors_business: [{ name: 'Globex', url: 'https://globex.com' }],
    competitors_visibility: [{ name: 'Initech', url: 'initech.io' }],
  };
}

// acme.com = brand; g2.com = competitor; forbes.com = media; reddit.com = social.
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
// gather (live) — typed fields
// ---------------------------------------------------------------------------
describe('opportunity evidence — typed cited field', () => {
  it('FACTS-ONLY shape: typed fields, NO score/band/weight', async () => {
    await gatherOpportunityEvidence(1);
    const ev = evidenceFor(state.profile.tracked_prompts, 'best crm for enterprise');
    assert.deepStrictEqual(Object.keys(ev).sort(), [
      'brand_present', 'cited_field', 'competitor_count', 'competitor_domains',
      'competitors_present', 'diversity_count', 'engine', 'gathered_at',
      'media_count', 'media_domains', 'raw_cited_domains',
    ]);
    for (const banned of ['band', 'score', 'weight', 'specificity', 'winnability', 'opportunity']) {
      assert.ok(!(banned in ev), `evidence must not contain ${banned}`);
    }
  });

  it('CLASSIFICATION precedence: brand collapsed, competitor/media/social typed', async () => {
    await gatherOpportunityEvidence(1);
    const ev = evidenceFor(state.profile.tracked_prompts, 'best crm for enterprise');
    // brand (acme.com) collapsed out of cited_field; g2 -> competitor, forbes -> media.
    assert.deepStrictEqual(fieldClasses(ev.cited_field), ['g2.com:competitor', 'forbes.com:media']);
    assert.deepStrictEqual(ev.competitor_domains, ['g2.com']);
    assert.deepStrictEqual(ev.media_domains, ['forbes.com']);
    assert.strictEqual(ev.competitor_count, 1);
    assert.strictEqual(ev.media_count, 1);
    assert.strictEqual(ev.diversity_count, ev.competitor_count, 'diversity == competitor_count');
    assert.strictEqual(ev.brand_present, true);
    // raw retains everything incl. brand.
    assert.deepStrictEqual(ev.raw_cited_domains.map((d) => d.domain), ['acme.com', 'g2.com', 'forbes.com']);
  });

  it('competitor_domains exclude media/social/brand; social stays typed in cited_field', async () => {
    await gatherOpportunityEvidence(1);
    const ev = evidenceFor(state.profile.tracked_prompts, 'acme vs globex');
    assert.deepStrictEqual(fieldClasses(ev.cited_field), ['globex.com:competitor', 'reddit.com:social_junk']);
    assert.deepStrictEqual(ev.competitor_domains, ['globex.com']);
    assert.deepStrictEqual(ev.media_domains, []);
    assert.strictEqual(ev.diversity_count, 1);
    // declared competitor Globex matched against the RAW set.
    assert.deepStrictEqual(ev.competitors_present, [{ name: 'Globex', domain: 'globex.com' }]);
    assert.strictEqual(ev.brand_present, true);
  });

  it('GAP SUMMARY: declared-vs-cited computed + stored on competitor_gap_summary', async () => {
    const res = await gatherOpportunityEvidence(1);
    const s = res.competitor_gap_summary;
    assert.deepStrictEqual(state.profile.competitor_gap_summary, s, 'summary persisted to its own column');

    assert.deepStrictEqual(s.declared_competitors, [
      { name: 'Globex', domain: 'globex.com' },
      { name: 'Initech', domain: 'initech.io' },
    ]);
    assert.deepStrictEqual(s.cited_competitors, [
      { domain: 'g2.com', prompt_count: 1 },
      { domain: 'globex.com', prompt_count: 1 },
    ]);
    // Initech never cited; Globex IS cited (so not in declared_but_not_cited).
    assert.deepStrictEqual(s.declared_but_not_cited, [{ name: 'Initech', domain: 'initech.io' }]);
    // g2.com wins but was not declared; globex.com declared so excluded.
    assert.deepStrictEqual(s.cited_but_not_declared, [{ domain: 'g2.com', prompt_count: 1 }]);
  });

  it('SCOPED: only band>=threshold prompts call Perplexity', async () => {
    const res = await gatherOpportunityEvidence(1);
    assert.strictEqual(res.status, 'gathered');
    assert.strictEqual(res.processed, 2);
    assert.strictEqual(state.calls.length, 2);
    assert.strictEqual(evidenceFor(state.profile.tracked_prompts, 'what is a crm'), undefined);
  });

  it('ADDITIVE-ONLY: only tracked_prompts + competitor_gap_summary change', async () => {
    const before = clone(state.profile);
    await gatherOpportunityEvidence(1);
    assert.deepStrictEqual(state.profile.competitors_business, before.competitors_business);
    assert.deepStrictEqual(state.profile.competitors_visibility, before.competitors_visibility);
    assert.strictEqual(state.profile.company_name, before.company_name);
    assert.deepStrictEqual(stripEvidence(state.profile.tracked_prompts), stripEvidence(before.tracked_prompts));
  });

  it('NEVER-NULL (total failure): all calls fail → nothing written', async () => {
    state.profile.tracked_prompts[0].opportunity_evidence = { engine: 'perplexity', diversity_count: 7 };
    const before = clone(state.profile);
    state.runQuery = async () => { throw new Error('network down'); };
    const res = await gatherOpportunityEvidence(1);
    assert.strictEqual(res.status, 'all_failed');
    assert.deepStrictEqual(state.profile, before);
  });

  it('IDEMPOTENT: re-run stable except timestamps', async () => {
    await gatherOpportunityEvidence(1);
    const a = clone(state.profile);
    await gatherOpportunityEvidence(1);
    assert.deepStrictEqual(stripEvidence(state.profile.tracked_prompts), stripEvidence(a.tracked_prompts));
    assert.deepStrictEqual(
      evidenceFor(state.profile.tracked_prompts, 'best crm for enterprise').cited_field,
      evidenceFor(a.tracked_prompts, 'best crm for enterprise').cited_field
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
describe('opportunity evidence — re-derive (offline)', () => {
  function goldwynnProfile() {
    return {
      company_name: 'Goldwynn Bahamas',
      competitors_business: [{ name: 'Albany', url: 'https://albany.com' }],
      competitors_visibility: [],
      tracked_prompts: [
        {
          text: 'is Goldwynn Bahamas worth the investment',
          funnel_stage: 'BOFU', is_monitored: true, volume: 30, value: { band: 5 },
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
        { text: 'low value prompt', funnel_stage: 'TOFU', value: { band: 2 } },
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
    assert.strictEqual(state.calls.length, 0);
  });

  it('brand collapse + typed field; preserves gathered_at, stamps rederived_at', async () => {
    await rederiveOpportunityEvidence(1);
    const ev = evidenceFor(state.profile.tracked_prompts, 'is Goldwynn Bahamas worth the investment');
    assert.deepStrictEqual(fieldClasses(ev.cited_field), ['expedia.com:social_junk', 'albany.com:competitor']);
    assert.deepStrictEqual(ev.competitor_domains, ['albany.com']);
    assert.strictEqual(ev.diversity_count, 1);
    assert.strictEqual(ev.brand_present, true);
    assert.deepStrictEqual(ev.competitors_present, [{ name: 'Albany', domain: 'albany.com' }]);
    assert.deepStrictEqual(ev.raw_cited_domains.map((d) => d.domain),
      ['goldwynnbahamas.com', 'goldwynnresorts.com', 'goldwynn.com', 'expedia.com', 'albany.com']);
    assert.strictEqual(ev.gathered_at, 'ORIGINAL');
    assert.ok(typeof ev.rederived_at === 'string');
  });

  it('gap summary: declared Albany IS cited (matched), nothing missing', async () => {
    const res = await rederiveOpportunityEvidence(1);
    const s = res.competitor_gap_summary;
    assert.deepStrictEqual(s.cited_competitors, [{ domain: 'albany.com', prompt_count: 1 }]);
    assert.deepStrictEqual(s.declared_but_not_cited, []);
    assert.deepStrictEqual(s.cited_but_not_declared, []);
  });

  it('NEVER-NULL: nothing stored to recompute → no write', async () => {
    state.profile.tracked_prompts = [{ text: 'x', value: { band: 5 } }];
    const before = clone(state.profile);
    const res = await rederiveOpportunityEvidence(1);
    assert.strictEqual(res.status, 'nothing_to_rederive');
    assert.deepStrictEqual(state.profile, before);
  });
});

// ---------------------------------------------------------------------------
// pure internals
// ---------------------------------------------------------------------------
describe('classification + gap internals', () => {
  const { classifyDomain, buildBrandContext, isBrandOwned, buildGapSummary } = _internals;

  it('classifyDomain: social → media → competitor (default)', () => {
    assert.strictEqual(classifyDomain('facebook.com'), 'social_junk');
    assert.strictEqual(classifyDomain('expedia.com'), 'social_junk');
    assert.strictEqual(classifyDomain('forbes.com'), 'media');
    assert.strictEqual(classifyDomain('robbreport.com'), 'media');
    assert.strictEqual(classifyDomain('sothebysrealty.com'), 'competitor');
    assert.strictEqual(classifyDomain('bahamasrealty.com'), 'competitor');
  });

  it('isBrandOwned collapses prefix variants, not geo words', () => {
    const ctx = buildBrandContext({ brandDomain: 'goldwynnbahamas.com', companyName: 'Goldwynn Bahamas' });
    assert.strictEqual(isBrandOwned('goldwynnresorts.com', ctx), true);
    assert.strictEqual(isBrandOwned('goldwynn.com', ctx), true);
    assert.strictEqual(isBrandOwned('bahamasrealty.com', ctx), false);
  });

  it('buildGapSummary: frequency, declared_but_not_cited, cited_but_not_declared', () => {
    const declared = [{ name: 'Albany', domain: 'albany.com' }, { name: 'Ghost', domain: 'ghost.com' }];
    const evidences = [
      { raw_cited_domains: [{ domain: 'albany.com', count: 1 }, { domain: 'sothebys.com', count: 1 }], competitor_domains: ['albany.com', 'sothebys.com'] },
      { raw_cited_domains: [{ domain: 'sothebys.com', count: 1 }], competitor_domains: ['sothebys.com'] },
    ];
    const s = buildGapSummary(declared, evidences);
    assert.deepStrictEqual(s.cited_competitors, [
      { domain: 'sothebys.com', prompt_count: 2 },
      { domain: 'albany.com', prompt_count: 1 },
    ]);
    assert.deepStrictEqual(s.declared_but_not_cited, [{ name: 'Ghost', domain: 'ghost.com' }]);
    assert.deepStrictEqual(s.cited_but_not_declared, [{ domain: 'sothebys.com', prompt_count: 2 }]);
  });
});
