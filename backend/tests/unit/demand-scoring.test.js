/**
 * Prompt Demand scoring (Layer 5) verification.
 *
 * In-memory DB that THROWS on any SQL other than the whitelisted reads + the
 * single tracked_prompts write, a stubbable Claude adapter (property access),
 * the REAL llmJson parser, and a stub plan service.
 *
 *   node --test backend/tests/unit/demand-scoring.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const state = {
  plan: 'pro', draftConfig: { draft_enabled: true }, profile: null,
  runQuery: null, calls: 0, lastQuery: null,
};

const RE_PROFILE = /SELECT tracked_prompts, industry FROM visibility_profiles/;
const RE_LOCK = /^SELECT tracked_prompts FROM visibility_profiles WHERE user_id = \$1 FOR UPDATE$/;
const RE_WRITE = /^UPDATE visibility_profiles SET tracked_prompts = \$2::jsonb WHERE user_id = \$1$/;

function dbQuery(text) {
  const sql = text.trim().replace(/\s+/g, ' ');
  if (RE_PROFILE.test(sql)) {
    return Promise.resolve({ rows: state.profile ? [{ tracked_prompts: clone(state.profile.tracked_prompts), industry: state.profile.industry }] : [] });
  }
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
const claudeFake = { runQuery: (q, opts) => { state.calls += 1; state.lastQuery = q; return state.runQuery(q, opts); } };

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id.endsWith('/db/database')) return dbFake;
  if (id.endsWith('/planService')) return planFake;
  if (id.endsWith('/engines/claudeAdapter')) return claudeFake;
  return originalRequire.apply(this, arguments);
};

const { scoreDemand } = require('../../services/draftGeneration/demandScoring');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function volFor(prompts, text) { const p = prompts.find((x) => x.text === text); return p && p.volume; }
function stripVolume(prompts) { return prompts.map((p) => { const c = { ...p }; delete c.volume; return c; }); }

const TOFU = 'best luxury beachfront condos in Nassau';
const BOFU = 'Cable Beach penthouse prices Goldwynn';
const NOVAL = 'low value definition prompt';

// Mixed funnel + value: Demand is ALL-prompts, so even the no-value prompt scores.
function profile() {
  return {
    industry: 'Luxury real estate',
    tracked_prompts: [
      { text: TOFU, funnel_stage: 'TOFU', is_monitored: true, value: { band: 2 } },
      { text: BOFU, funnel_stage: 'BOFU', is_monitored: true, value: { band: 5 }, opportunity: { band: 5 }, impact: { band: 5 } },
      { text: NOVAL, funnel_stage: 'TOFU' }, // no value/opportunity — still gets demand
    ],
  };
}

// Model returns higher demand for the broad TOFU prompt than the specific BOFU one.
const DEMAND = { [TOFU]: 5, [BOFU]: 2, [NOVAL]: 4 };
function respond(q) {
  const re = /^\s*\d+\.\s*\[[A-Z]+\]\s*(.+)$/gm;
  const items = []; let m;
  while ((m = re.exec(q)) !== null) { const t = m[1].trim(); items.push({ text: t, band: DEMAND[t] }); }
  return { response: JSON.stringify(items) };
}

beforeEach(() => {
  state.plan = 'pro';
  state.draftConfig = { draft_enabled: true };
  state.profile = profile();
  state.calls = 0; state.lastQuery = null;
  state.runQuery = async (q) => respond(q);
});

describe('demand scoring — calibration + scope', () => {
  it('ALL-PROMPTS scope in ONE call; TOFU broad > BOFU specific (not penalized)', async () => {
    const res = await scoreDemand(1);
    assert.strictEqual(res.status, 'scored');
    assert.strictEqual(res.scored, 3, 'every prompt scored, including the no-value one');
    assert.strictEqual(state.calls, 1, 'one batch call');
    const p = state.profile.tracked_prompts;
    assert.strictEqual(volFor(p, TOFU).band, 5);
    assert.strictEqual(volFor(p, BOFU).band, 2);   // low BOFU demand present, as expected
    assert.strictEqual(volFor(p, NOVAL).band, 4);  // no-value prompt still scored
    assert.ok(volFor(p, TOFU).band > volFor(p, BOFU).band, 'TOFU demand > BOFU demand');
  });

  it('volume is the standalone Demand band, labeled estimated', async () => {
    await scoreDemand(1);
    const v = volFor(state.profile.tracked_prompts, TOFU);
    assert.deepStrictEqual(Object.keys(v).sort(), ['band', 'basis', 'estimated', 'generated_at']);
    assert.strictEqual(v.basis, 'ai_inferred');
    assert.strictEqual(v.estimated, true);
    assert.ok(typeof v.generated_at === 'string');
  });

  it('low temperature + industry context fed to the model', async () => {
    await scoreDemand(1);
    assert.ok(state.lastQuery.includes('Luxury real estate'));
    assert.ok(state.lastQuery.includes('[TOFU]') && state.lastQuery.includes('[BOFU]'));
  });
});

describe('demand scoring — contract', () => {
  it('ADDITIVE-ONLY: only `volume` set; value/opportunity/impact/funnel preserved', async () => {
    const before = clone(state.profile);
    await scoreDemand(1);
    assert.deepStrictEqual(stripVolume(state.profile.tracked_prompts), stripVolume(before.tracked_prompts));
    // impact/opportunity on the BOFU prompt untouched.
    const bofu = state.profile.tracked_prompts.find((x) => x.text === BOFU);
    assert.deepStrictEqual(bofu.opportunity, { band: 5 });
    assert.deepStrictEqual(bofu.impact, { band: 5 });
  });

  it('NEVER-NULL (unparseable): garbage aborts write; existing volume kept', async () => {
    state.profile.tracked_prompts[0].volume = { band: 3, basis: 'ai_inferred', estimated: true, generated_at: 'OLD' };
    const before = clone(state.profile);
    state.runQuery = async () => ({ response: 'sorry, cannot' });
    const res = await scoreDemand(1);
    assert.strictEqual(res.status, 'llm_failed');
    assert.deepStrictEqual(state.profile, before);
  });

  it('NEVER-NULL (throw): LLM error aborts write', async () => {
    const before = clone(state.profile);
    state.runQuery = async () => { throw new Error('429'); };
    const res = await scoreDemand(1);
    assert.strictEqual(res.status, 'llm_failed');
    assert.deepStrictEqual(state.profile, before);
  });

  it('UNMATCHED prompts keep existing volume (model omits one)', async () => {
    state.profile.tracked_prompts[2].volume = { band: 1, basis: 'ai_inferred', estimated: true, generated_at: 'OLD' };
    state.runQuery = async (q) => {
      const all = JSON.parse(respond(q).response).filter((x) => x.text !== NOVAL);
      return { response: JSON.stringify(all) };
    };
    const res = await scoreDemand(1);
    assert.strictEqual(res.status, 'scored');
    assert.strictEqual(res.scored, 2);
    assert.strictEqual(volFor(state.profile.tracked_prompts, NOVAL).generated_at, 'OLD');
  });

  it('IDEMPOTENT: re-run recomputes only volume; same bands', async () => {
    await scoreDemand(1);
    const a = clone(state.profile.tracked_prompts);
    await scoreDemand(1);
    assert.deepStrictEqual(stripVolume(state.profile.tracked_prompts), stripVolume(a));
    assert.strictEqual(volFor(state.profile.tracked_prompts, TOFU).band, volFor(a, TOFU).band);
  });

  it('ELIGIBILITY: ineligible plan no-ops without calling the model', async () => {
    state.draftConfig = { draft_enabled: false };
    const before = clone(state.profile);
    const res = await scoreDemand(1);
    assert.strictEqual(res.status, 'skipped_not_eligible');
    assert.strictEqual(state.calls, 0);
    assert.deepStrictEqual(state.profile, before);
  });
});
