/**
 * Visibility Impact score (Layer 4 rollup) verification.
 *
 * Pure computation over stored value.band × opportunity.band. In-memory DB that
 * THROWS on any SQL other than the whitelisted reads + the single tracked_prompts
 * write.
 *
 *   node --test backend/tests/unit/impact-scoring.test.js
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

const { scoreImpact, _internals } = require('../../services/draftGeneration/impactScoring');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function impactFor(prompts, text) { const p = prompts.find((x) => x.text === text); return p && p.impact; }
function stripImpact(prompts) { return prompts.map((p) => { const c = { ...p }; delete c.impact; return c; }); }

const CABLE = 'Cable Beach penthouse prices Goldwynn';
const VS = 'Goldwynn Bahamas vs other luxury Nassau developments';
const WORTH = 'is Goldwynn Bahamas worth the investment';

// Real user-174 bands from the Value + Opportunity passes.
function profile174() {
  return {
    tracked_prompts: [
      { text: VS, funnel_stage: 'MOFU', is_monitored: true, volume: null, value: { band: 4 }, opportunity: { band: 2, score: 30.0 } },
      { text: CABLE, funnel_stage: 'BOFU', is_monitored: true, volume: null, value: { band: 5 }, opportunity: { band: 5, score: 93.7 } },
      { text: WORTH, funnel_stage: 'BOFU', is_monitored: true, volume: null, value: { band: 5 }, opportunity: { band: 3, score: 44.7 } },
      { text: 'value but no opportunity', value: { band: 5 } },          // missing opp -> skip
      { text: 'low value no evidence', value: { band: 2 } },             // missing opp -> skip
    ],
  };
}

beforeEach(() => {
  state.plan = 'pro';
  state.draftConfig = { draft_enabled: true };
  state.profile = profile174();
});

describe('impact rollup — multiplicative behaviour (user 174)', () => {
  it('Cable top; multiplicative spreads worth vs developments', async () => {
    const res = await scoreImpact(1);
    assert.strictEqual(res.status, 'scored');
    assert.strictEqual(res.scored, 3);
    const p = state.profile.tracked_prompts;
    const cable = impactFor(p, CABLE), worth = impactFor(p, WORTH), vs = impactFor(p, VS);

    // V5×O5 = 1.0; V5×O3 = 0.5; V4×O2 = 0.75×0.25 = 0.1875.
    assert.strictEqual(cable.score, 100); assert.strictEqual(cable.band, 5);
    assert.strictEqual(worth.score, 50);  assert.strictEqual(worth.band, 3);
    assert.strictEqual(vs.score, 19);     assert.strictEqual(vs.band, 1); // round(18.75)
    assert.ok(cable.score > worth.score && worth.score > vs.score);
    // Multiplicative spread: worth/vs ratio (50/19 ≈ 2.6) is wider than the
    // additive band-sum ratio (8/6 ≈ 1.3) — low Opportunity collapses vs.
    assert.ok(worth.score / vs.score > 2.0);
  });

  it('demand_factor neutral-stub is applied and labeled', async () => {
    await scoreImpact(1);
    const cable = impactFor(state.profile.tracked_prompts, CABLE);
    assert.strictEqual(cable.factors.demand_factor, 1.0);
    assert.strictEqual(cable.factors.demand_source, 'neutral_stub');
    assert.strictEqual(cable.basis, 'impact_v1');
    assert.strictEqual(cable.formula_version, 'impact_v1');
    assert.deepStrictEqual(cable.factors, { value_band: 5, opportunity_band: 5, demand_factor: 1.0, demand_source: 'neutral_stub' });
  });

  it('multiplicative collapse: high value but floor opportunity -> ~0', () => {
    const { computeImpact } = _internals;
    const o = computeImpact({ text: 'x', value: { band: 5 }, opportunity: { band: 1 } });
    assert.strictEqual(o.score, 0); // 1.0 × 0.0 = 0 — unwinnable = not actionable
    assert.strictEqual(o.band, 1);
  });

  it('demand stays neutral: it never zeroes a high V/O prompt', () => {
    const { demandFactor } = _internals;
    assert.deepStrictEqual(demandFactor({ volume: null }), { factor: 1.0, source: 'neutral_stub' });
  });
});

describe('impact rollup — contract', () => {
  it('ADDITIVE-ONLY: only `impact` added; value/opportunity/etc unchanged', async () => {
    const before = clone(state.profile);
    await scoreImpact(1);
    assert.deepStrictEqual(stripImpact(state.profile.tracked_prompts), stripImpact(before.tracked_prompts));
  });

  it('SKIP if missing either band — not scored, not nulled', async () => {
    await scoreImpact(1);
    const noOpp = state.profile.tracked_prompts.find((x) => x.text === 'value but no opportunity');
    const low = state.profile.tracked_prompts.find((x) => x.text === 'low value no evidence');
    assert.ok(!('impact' in noOpp));
    assert.ok(!('impact' in low));
  });

  it('NEVER-NULL: nothing scorable -> no write', async () => {
    state.profile.tracked_prompts = [{ text: 'a', value: { band: 5 } }, { text: 'b', opportunity: { band: 5 } }];
    const before = clone(state.profile);
    const res = await scoreImpact(1);
    assert.strictEqual(res.status, 'no_scorable');
    assert.deepStrictEqual(state.profile, before);
  });

  it('IDEMPOTENT: re-run yields identical score + band', async () => {
    await scoreImpact(1);
    const a = clone(impactFor(state.profile.tracked_prompts, WORTH));
    await scoreImpact(1);
    const b = impactFor(state.profile.tracked_prompts, WORTH);
    assert.strictEqual(b.score, a.score);
    assert.strictEqual(b.band, a.band);
  });

  it('ELIGIBILITY: ineligible plan no-ops', async () => {
    state.draftConfig = { draft_enabled: false };
    const before = clone(state.profile);
    const res = await scoreImpact(1);
    assert.strictEqual(res.status, 'skipped_not_eligible');
    assert.deepStrictEqual(state.profile, before);
  });
});

describe('impact rollup — pure internals', () => {
  const { normalizeBand, bandForScore } = _internals;
  it('normalizeBand: (band-1)/4', () => {
    assert.strictEqual(normalizeBand(1), 0.0);
    assert.strictEqual(normalizeBand(3), 0.5);
    assert.strictEqual(normalizeBand(5), 1.0);
    assert.strictEqual(normalizeBand(undefined), null);
    assert.strictEqual(normalizeBand(4.5), null);
  });
  it('bandForScore: fixed buckets', () => {
    assert.strictEqual(bandForScore(0), 1);
    assert.strictEqual(bandForScore(19), 1);
    assert.strictEqual(bandForScore(20), 2);
    assert.strictEqual(bandForScore(50), 3);
    assert.strictEqual(bandForScore(100), 5);
  });
});
