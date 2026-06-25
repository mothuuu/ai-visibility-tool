/**
 * Value scoring (Layer 2) verification.
 *
 * Proves the strict-additive contract of services/draftGeneration/valueScoring.js
 * with an in-memory DB that THROWS on any SQL other than the whitelisted
 * tracked_prompts read/write (so a stray column/table write fails the test), a
 * stubbable claudeAdapter, and the REAL llmJson parser.
 *
 *   node --test backend/tests/unit/value-scoring.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// ---------------------------------------------------------------------------
// Mutable test state (swapped per case) + in-memory DB fake
// ---------------------------------------------------------------------------
const state = {
  plan: 'pro',
  draftConfig: { draft_enabled: true },
  profile: null,          // the single visibility_profiles row
  runQuery: null,         // claudeAdapter.runQuery stub
  runQueryCalls: 0,
  lastQuery: null,
};

const REGEX_READ = /SELECT[\s\S]*FROM visibility_profiles\s+WHERE user_id = \$1\s*$/;
const REGEX_LOCK = /^SELECT tracked_prompts FROM visibility_profiles WHERE user_id = \$1 FOR UPDATE$/;
const REGEX_WRITE = /^UPDATE visibility_profiles SET tracked_prompts = \$2::jsonb WHERE user_id = \$1$/;

function dbQuery(text, _params) {
  const sql = text.trim();
  if (REGEX_READ.test(sql)) {
    return Promise.resolve({ rows: state.profile ? [clone(state.profile)] : [] });
  }
  throw new Error(`Unexpected db.query SQL (non-additive?): ${sql}`);
}

function makeClient() {
  return {
    query(text, params) {
      const sql = text.trim();
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve();
      if (REGEX_LOCK.test(sql)) {
        return Promise.resolve({ rows: state.profile ? [{ tracked_prompts: clone(state.profile.tracked_prompts) }] : [] });
      }
      if (REGEX_WRITE.test(sql)) {
        state.profile.tracked_prompts = JSON.parse(params[1]); // round-trips through JSON like real JSONB
        return Promise.resolve({ rowCount: 1 });
      }
      throw new Error(`Unexpected client SQL (non-additive?): ${sql}`);
    },
    release() {},
  };
}

const dbFake = { query: dbQuery, getClient: () => Promise.resolve(makeClient()), pool: { end: () => Promise.resolve() } };
const planFake = {
  resolvePlanForRequest: async () => ({ plan: state.plan }),
  getDraftConfig: () => state.draftConfig,
};
const claudeFake = {
  runQuery: (q, opts) => {
    state.runQueryCalls += 1;
    state.lastQuery = q;
    return state.runQuery(q, opts);
  },
};

// Intercept ONLY these three; llmJson stays real so parsing is genuinely tested.
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id.endsWith('/db/database')) return dbFake;
  if (id.endsWith('/planService')) return planFake;
  if (id.endsWith('/engines/claudeAdapter')) return claudeFake;
  return originalRequire.apply(this, arguments);
};

const { scorePromptValues } = require('../../services/draftGeneration/valueScoring');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

function basePrompts() {
  return [
    { text: 'what is a crm', funnel_stage: 'TOFU', is_monitored: true, volume: 900, note: 'keep-me' },
    { text: 'acme vs globex enterprise pricing', funnel_stage: 'BOFU', is_monitored: false, volume: null, custom: { nested: [1, 2] } },
    { text: 'best crm for mid-market teams', funnel_stage: 'MOFU', is_monitored: true, volume: 40 },
  ];
}

function makeProfile(overrides = {}) {
  return {
    company_name: 'Acme', industry: 'B2B SaaS', location: 'NYC',
    business_description: 'CRM software for sales teams',
    icps: [{ text: 'RevOps leaders', selected: true }],
    competitors_business: [{ name: 'Globex', url: null }],
    competitors_visibility: [{ name: 'Initech', url: null }],
    avg_customer_value: '$30k ACV', priority_focus: 'Grow enterprise revenue',
    deal_size_band: 'over_250k', sales_model: 'enterprise',
    tracked_prompts: basePrompts(),
    ...overrides,
  };
}

// Deterministic "model": derives bands from the inputs present in the prompt text,
// so the OUTPUT genuinely reflects the business inputs we fed in.
function simulateModel(query) {
  const enterprise = query.includes('Sales model: enterprise');
  const highDeal = query.includes('over $250K') || query.includes('$50K–$250K');
  const items = [];
  const re = /^\s*\d+\.\s*\[([A-Z]+)\]\s*(.+)$/gm;
  let m;
  while ((m = re.exec(query)) !== null) {
    const stage = m[1];
    const text = m[2].trim();
    let band = stage === 'BOFU' ? 4 : stage === 'MOFU' ? 3 : 1;
    if (enterprise && highDeal) { // high-ACV enterprise pushes decision prompts up
      if (stage === 'BOFU') band = 5;
      else if (stage === 'MOFU') band = 4;
      else band = 1; // generic TOFU stays low
    }
    items.push({ text, band });
  }
  return { response: JSON.stringify(items) };
}

function stripValue(prompts) {
  return prompts.map((p) => { const c = { ...p }; delete c.value; return c; });
}
function bandFor(prompts, text) {
  const p = prompts.find((x) => x.text === text);
  return p && p.value ? p.value.band : undefined;
}

beforeEach(() => {
  state.plan = 'pro';
  state.draftConfig = { draft_enabled: true };
  state.profile = makeProfile();
  state.runQuery = async (q) => simulateModel(q);
  state.runQueryCalls = 0;
  state.lastQuery = null;
});

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------
describe('value scoring — strict additive contract', () => {
  it('ADDITIVE-ONLY: sets only `value`; every other key + column identical', async () => {
    const before = clone(state.profile);

    const res = await scorePromptValues(1);
    assert.strictEqual(res.status, 'scored');
    assert.strictEqual(res.scored, 3);

    const after = state.profile;
    // Every non-tracked_prompts column untouched.
    const beforeCols = clone(before); delete beforeCols.tracked_prompts;
    const afterCols = clone(after); delete afterCols.tracked_prompts;
    assert.deepStrictEqual(afterCols, beforeCols, 'no other column may change');

    // Every prompt key other than `value` is byte-identical.
    assert.deepStrictEqual(stripValue(after.tracked_prompts), stripValue(before.tracked_prompts));

    // `value` is the only addition, well-formed.
    for (const p of after.tracked_prompts) {
      assert.ok(p.value && Number.isInteger(p.value.band), 'band set');
      assert.strictEqual(p.value.basis, 'business_grounded');
      assert.ok(typeof p.value.generated_at === 'string');
    }
  });

  it('INPUTS DRIVE OUTPUT: business inputs reach the model; enterprise+high deal → BOFU high, TOFU low', async () => {
    await scorePromptValues(1);
    // The prompt actually carries the grounding inputs + funnel stages.
    assert.ok(state.lastQuery.includes('Sales model: enterprise'));
    assert.ok(state.lastQuery.includes('over $250K'));
    assert.ok(state.lastQuery.includes('[BOFU]') && state.lastQuery.includes('[TOFU]'));

    const p = state.profile.tracked_prompts;
    assert.strictEqual(bandFor(p, 'acme vs globex enterprise pricing'), 5, 'BOFU comparison highest');
    assert.strictEqual(bandFor(p, 'what is a crm'), 1, 'generic TOFU lowest');

    // Flip the economics: self-serve + tiny deals → BOFU no longer boosted.
    state.profile = makeProfile({ deal_size_band: 'under_1k', sales_model: 'self_serve' });
    await scorePromptValues(1);
    const p2 = state.profile.tracked_prompts;
    assert.strictEqual(bandFor(p2, 'acme vs globex enterprise pricing'), 4, 'no enterprise boost');
  });

  it('NEVER-NULL (unparseable): garbage response aborts write; tracked_prompts untouched, existing value kept', async () => {
    // Seed a pre-existing real value to prove it is NOT blanked.
    state.profile.tracked_prompts[0].value = { band: 4, basis: 'business_grounded', generated_at: 'X' };
    const before = clone(state.profile);
    state.runQuery = async () => ({ response: 'sorry, I cannot do that' });

    const res = await scorePromptValues(1);
    assert.strictEqual(res.status, 'llm_failed');
    assert.deepStrictEqual(state.profile, before, 'nothing changed on unparseable output');
  });

  it('NEVER-NULL (throw): LLM error aborts write; tracked_prompts untouched', async () => {
    const before = clone(state.profile);
    state.runQuery = async () => { throw new Error('429 rate limited'); };

    const res = await scorePromptValues(1);
    assert.strictEqual(res.status, 'llm_failed');
    assert.deepStrictEqual(state.profile, before);
  });

  it('NEVER-NULL (empty array): aborts write', async () => {
    const before = clone(state.profile);
    state.runQuery = async () => ({ response: '[]' });
    const res = await scorePromptValues(1);
    assert.strictEqual(res.status, 'llm_failed');
    assert.deepStrictEqual(state.profile, before);
  });

  it('IDEMPOTENT: second run recomputes only `value`; bands + all other keys unchanged', async () => {
    await scorePromptValues(1);
    const afterFirst = clone(state.profile);

    await scorePromptValues(1);
    const afterSecond = state.profile;

    assert.deepStrictEqual(stripValue(afterSecond.tracked_prompts), stripValue(afterFirst.tracked_prompts));
    for (const p of afterFirst.tracked_prompts) {
      assert.strictEqual(bandFor(afterSecond.tracked_prompts, p.text), p.value.band, 'band stable across runs');
    }
  });

  it('GRACEFUL DEGRADE: missing inputs → pending, no LLM call, real bands preserved', async () => {
    // One prompt already scored; must survive untouched.
    state.profile.tracked_prompts[1].value = { band: 5, basis: 'business_grounded', generated_at: 'X' };
    state.profile.deal_size_band = null; // input missing

    const res = await scorePromptValues(1);
    assert.strictEqual(res.status, 'pending_inputs');
    assert.strictEqual(state.runQueryCalls, 0, 'must not call the model without inputs');

    const p = state.profile.tracked_prompts;
    assert.strictEqual(bandFor(p, 'acme vs globex enterprise pricing'), 5, 'existing band not clobbered');
    assert.strictEqual(p[0].value.status, 'pending', 'unscored prompt marked pending, not garbage');
    assert.strictEqual(p[0].value.band, undefined, 'pending carries no fabricated band');
  });

  it('ELIGIBILITY: ineligible plan no-ops without reading/writing/calling the model', async () => {
    state.draftConfig = { draft_enabled: false };
    const before = clone(state.profile);
    const res = await scorePromptValues(1);
    assert.strictEqual(res.status, 'skipped_not_eligible');
    assert.strictEqual(state.runQueryCalls, 0);
    assert.deepStrictEqual(state.profile, before);
  });

  it('NO PROMPTS: empty tracked_prompts no-ops', async () => {
    state.profile.tracked_prompts = [];
    const res = await scorePromptValues(1);
    assert.strictEqual(res.status, 'no_prompts');
    assert.strictEqual(state.runQueryCalls, 0);
  });

  it('UNMATCHED prompts keep their existing value (model omits one)', async () => {
    state.profile.tracked_prompts[2].value = { band: 2, basis: 'business_grounded', generated_at: 'X' };
    // Model returns only the first two prompts.
    state.runQuery = async (q) => {
      const all = JSON.parse(simulateModel(q).response);
      return { response: JSON.stringify(all.slice(0, 2)) };
    };
    const res = await scorePromptValues(1);
    assert.strictEqual(res.status, 'scored');
    assert.strictEqual(res.scored, 2);
    assert.strictEqual(bandFor(state.profile.tracked_prompts, 'best crm for mid-market teams'), 2, 'unmatched value unchanged');
  });
});
