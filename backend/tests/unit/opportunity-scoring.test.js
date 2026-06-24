/**
 * Visibility Opportunity (Winnability) score verification.
 *
 * Pure computation over stored opportunity_evidence. In-memory DB that THROWS on
 * any SQL other than the whitelisted reads + the single tracked_prompts write.
 *
 *   node --test backend/tests/unit/opportunity-scoring.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const state = { plan: 'pro', draftConfig: { draft_enabled: true }, profile: null };

const RE_READ = /^SELECT tracked_prompts FROM visibility_profiles WHERE user_id = \$1$/;
const RE_LOCK = /^SELECT tracked_prompts FROM visibility_profiles WHERE user_id = \$1 FOR UPDATE$/;
const RE_WRITE = /^UPDATE visibility_profiles SET tracked_prompts = \$2::jsonb WHERE user_id = \$1$/;

function dbQuery(text) {
  const sql = text.trim().replace(/\s+/g, ' ');
  if (RE_READ.test(sql)) return Promise.resolve({ rows: state.profile ? [{ tracked_prompts: clone(state.profile.tracked_prompts) }] : [] });
  throw new Error(`Unexpected db.query SQL: ${sql}`);
}
function makeClient() {
  return {
    query(text, params) {
      const sql = text.trim().replace(/\s+/g, ' ');
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve();
      if (RE_LOCK.test(sql)) return Promise.resolve({ rows: state.profile ? [{ tracked_prompts: clone(state.profile.tracked_prompts) }] : [] });
      if (RE_WRITE.test(sql)) { state.profile.tracked_prompts = JSON.parse(params[1]); return Promise.resolve({ rowCount: 1 }); }
      throw new Error(`Unexpected client SQL (non-additive?): ${sql}`);
    },
    release() {},
  };
}
const dbFake = { query: dbQuery, getClient: () => Promise.resolve(makeClient()) };
const planFake = { resolvePlanForRequest: async () => ({ plan: state.plan }), getDraftConfig: () => state.draftConfig };

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id.endsWith('/db/database')) return dbFake;
  if (id.endsWith('/planService')) return planFake;
  return originalRequire.apply(this, arguments);
};

const { scoreOpportunity, _internals } = require('../../services/draftGeneration/opportunityScoring');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function oppFor(prompts, text) { const p = prompts.find((x) => x.text === text); return p && p.opportunity; }
function stripOpp(prompts) { return prompts.map((p) => { const c = { ...p }; delete c.opportunity; return c; }); }

// The real user-174 evidence shape (from the typed evidence pass).
function profile174() {
  return {
    tracked_prompts: [
      { text: 'Goldwynn Bahamas vs other luxury Nassau developments', funnel_stage: 'MOFU', is_monitored: true, value: { band: 4 },
        opportunity_evidence: { brand_present: true, competitor_count: 3, media_count: 0, competitor_domains: ['rodlandrealestate.com', 'sellingbahamas.com', 'bahamasrealty.com'], media_domains: [] } },
      { text: 'Cable Beach penthouse prices Goldwynn', funnel_stage: 'BOFU', is_monitored: true, value: { band: 5 },
        opportunity_evidence: { brand_present: false, competitor_count: 4, media_count: 2, competitor_domains: ['sothebysrealty.com', 'coldwellbankerluxury.com', 'engelvoelkers.com', 'cirecaribbean.com'], media_domains: ['hauteresidence.com', 'hauteliving.com'] } },
      { text: 'is Goldwynn Bahamas worth the investment', funnel_stage: 'BOFU', is_monitored: true, value: { band: 5 },
        opportunity_evidence: { brand_present: true, competitor_count: 1, media_count: 2, competitor_domains: ['bahamasrealty.com'], media_domains: ['forbes.com', 'foratravel.com'] } },
      { text: 'low value no evidence', funnel_stage: 'TOFU', value: { band: 2 } }, // no evidence -> skip
    ],
  };
}

beforeEach(() => {
  state.plan = 'pro';
  state.draftConfig = { draft_enabled: true };
  state.profile = profile174();
});

const CABLE = 'Cable Beach penthouse prices Goldwynn';
const VS = 'Goldwynn Bahamas vs other luxury Nassau developments';
const WORTH = 'is Goldwynn Bahamas worth the investment';

describe('winnability score — calibration (user 174)', () => {
  it('ordering: Cable highest, vs lowest, worth middle (not bottom)', async () => {
    const res = await scoreOpportunity(1);
    assert.strictEqual(res.status, 'scored');
    assert.strictEqual(res.scored, 3);
    const p = state.profile.tracked_prompts;
    const cable = oppFor(p, CABLE), vs = oppFor(p, VS), worth = oppFor(p, WORTH);

    // Exact scores from the v1 weights (0.40/0.35/0.25).
    assert.strictEqual(cable.score, 93.7);
    assert.strictEqual(worth.score, 44.7);
    assert.strictEqual(vs.score, 30.0);
    // Bands.
    assert.strictEqual(cable.band, 5);
    assert.strictEqual(worth.band, 3);
    assert.strictEqual(vs.band, 2);
    // Ordering relations.
    assert.ok(cable.score > worth.score && worth.score > vs.score, 'Cable > worth > vs');
    assert.ok(worth.score > vs.score, 'worth is NOT bottom');
  });

  it('media_count lever: it lifts "worth" above a pure competitor-count reading', () => {
    const { computeOpportunity } = _internals;
    const base = { text: WORTH, funnel_stage: 'BOFU' };
    const withMedia = computeOpportunity({ ...base, opportunity_evidence: { brand_present: true, competitor_count: 1, media_count: 2 } });
    const noMedia = computeOpportunity({ ...base, opportunity_evidence: { brand_present: true, competitor_count: 1, media_count: 0 } });
    // Same competitor_count; media is the only difference.
    assert.strictEqual(noMedia.score, 38.0);
    assert.strictEqual(noMedia.band, 2);
    assert.strictEqual(withMedia.score, 44.7);
    assert.strictEqual(withMedia.band, 3); // media bumps it a full band, clear of vs (band 2)
    assert.ok(withMedia.score > noMedia.score);
  });

  it('opportunity object is auditable: weights + inputs stored', async () => {
    await scoreOpportunity(1);
    const cable = oppFor(state.profile.tracked_prompts, CABLE);
    assert.strictEqual(cable.basis, 'winnability_v1');
    assert.deepStrictEqual(cable.weights, _internals.WEIGHTS);
    assert.deepStrictEqual(cable.inputs, { brand_present: false, specificity_signal: 1.0, competitor_count: 4, media_count: 2 });
    assert.ok(typeof cable.generated_at === 'string');
  });
});

describe('winnability score — contract', () => {
  it('ADDITIVE-ONLY: only `opportunity` added; evidence/value/funnel/etc unchanged', async () => {
    const before = clone(state.profile);
    await scoreOpportunity(1);
    assert.deepStrictEqual(stripOpp(state.profile.tracked_prompts), stripOpp(before.tracked_prompts));
  });

  it('SKIPS prompts without evidence — no opportunity written, not nulled', async () => {
    await scoreOpportunity(1);
    const low = state.profile.tracked_prompts.find((x) => x.text === 'low value no evidence');
    assert.ok(!('opportunity' in low), 'evidence-less prompt is left untouched');
  });

  it('NEVER-NULL: no evidence anywhere → no write', async () => {
    state.profile.tracked_prompts = [{ text: 'a', value: { band: 5 } }, { text: 'b' }];
    const before = clone(state.profile);
    const res = await scoreOpportunity(1);
    assert.strictEqual(res.status, 'no_evidence');
    assert.deepStrictEqual(state.profile, before);
  });

  it('IDEMPOTENT: re-run yields identical score + band', async () => {
    await scoreOpportunity(1);
    const first = clone(oppFor(state.profile.tracked_prompts, CABLE));
    await scoreOpportunity(1);
    const second = oppFor(state.profile.tracked_prompts, CABLE);
    assert.strictEqual(second.score, first.score);
    assert.strictEqual(second.band, first.band);
  });

  it('ELIGIBILITY: ineligible plan no-ops without reading/writing', async () => {
    state.draftConfig = { draft_enabled: false };
    const before = clone(state.profile);
    const res = await scoreOpportunity(1);
    assert.strictEqual(res.status, 'skipped_not_eligible');
    assert.deepStrictEqual(state.profile, before);
  });
});

describe('winnability score — pure internals', () => {
  const { brandGap, specificity, contestability, bandForScore } = _internals;
  it('brandGap: absent=1, present=0', () => {
    assert.strictEqual(brandGap(false), 1);
    assert.strictEqual(brandGap(true), 0);
  });
  it('specificity: BOFU > MOFU > TOFU', () => {
    assert.ok(specificity('BOFU') > specificity('MOFU'));
    assert.ok(specificity('MOFU') > specificity('TOFU'));
    assert.strictEqual(specificity(null), 0.5);
  });
  it('contestability: media nudges up; fragmentation rises with competitor_count', () => {
    assert.ok(contestability(1, 2) > contestability(1, 0), 'media positive');
    assert.ok(contestability(4, 0) > contestability(1, 0), 'more competitors = more fragmented = higher');
  });
  it('bandForScore: fixed buckets', () => {
    assert.strictEqual(bandForScore(0), 1);
    assert.strictEqual(bandForScore(19.9), 1);
    assert.strictEqual(bandForScore(20), 2);
    assert.strictEqual(bandForScore(44.7), 3);
    assert.strictEqual(bandForScore(80), 5);
    assert.strictEqual(bandForScore(100), 5);
  });
});
