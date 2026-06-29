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

  it('absent volume -> demand_factor neutral_default (never drags)', async () => {
    await scoreImpact(1);
    const cable = impactFor(state.profile.tracked_prompts, CABLE);
    assert.strictEqual(cable.factors.demand_factor, 1.0);
    assert.strictEqual(cable.factors.demand_source, 'neutral_default');
    assert.strictEqual(cable.basis, 'impact_v1');
    assert.strictEqual(cable.formula_version, 'impact_v1');
    assert.deepStrictEqual(cable.factors, { value_band: 5, opportunity_band: 5, demand_factor: 1.0, demand_source: 'neutral_default' });
  });

  it('volume.band activates demand_factor (band1->0.5 .. band5->1.0); refines score', () => {
    const { computeImpact } = _internals;
    const base = { text: CABLE, value: { band: 5 }, opportunity: { band: 5 } }; // V5×O5 = 1.0 pre-demand
    const d1 = computeImpact({ ...base, volume: { band: 1 } });
    const d3 = computeImpact({ ...base, volume: { band: 3 } });
    const d5 = computeImpact({ ...base, volume: { band: 5 } });
    assert.strictEqual(d1.factors.demand_factor, 0.5);  assert.strictEqual(d1.factors.demand_source, 'ai_inferred');
    assert.strictEqual(d3.factors.demand_factor, 0.75);
    assert.strictEqual(d5.factors.demand_factor, 1.0);
    // floored mapping moves the 100-pre score, never to 0.
    assert.strictEqual(d1.score, 50);  // 100 × 0.5
    assert.strictEqual(d3.score, 75);  // 100 × 0.75
    assert.strictEqual(d5.score, 100); // 100 × 1.0
  });

  it('floored demand cannot reorder the top: Cable >= worth even at worst case', () => {
    const { computeImpact } = _internals;
    // Worst case for ordering: Cable lowest demand (0.5), worth highest (1.0).
    const cable = computeImpact({ value: { band: 5 }, opportunity: { band: 5 }, volume: { band: 1 } }); // 100 -> 50
    const worth = computeImpact({ value: { band: 5 }, opportunity: { band: 3 }, volume: { band: 5 } }); // 50 -> 50
    assert.ok(cable.score >= worth.score, 'a 2x headline gap survives the 2x demand range (floor preserved)');
  });

  it('multiplicative collapse: high value but floor opportunity -> ~0', () => {
    const { computeImpact } = _internals;
    const o = computeImpact({ text: 'x', value: { band: 5 }, opportunity: { band: 1 } });
    assert.strictEqual(o.score, 0); // 1.0 × 0.0 = 0 — unwinnable = not actionable
    assert.strictEqual(o.band, 1);
  });

  it('demand stays neutral when absent: never zeroes a high V/O prompt', () => {
    const { demandFactor } = _internals;
    assert.deepStrictEqual(demandFactor({ volume: null }), { factor: 1.0, source: 'neutral_default' });
    assert.deepStrictEqual(demandFactor({}), { factor: 1.0, source: 'neutral_default' });
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
