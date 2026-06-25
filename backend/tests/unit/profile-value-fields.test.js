/**
 * Save-path round-trip for the Value feature's new fields.
 *
 * Verifies routes/profile.js helpers:
 *  - deal_size_band / sales_model are editable, enum-validated, and round-trip
 *    through read (normalizeProfile) and write (buildSaveValues).
 *  - tracked_prompts `value` (server-computed Layer-2 enrichment) is preserved
 *    verbatim by the save path — NOT flattened/dropped on an intake edit.
 *
 *   node --test backend/tests/unit/profile-value-fields.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// profile.js pulls in db/database + services at require time; stub the heavy deps.
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id.endsWith('/db/database')) return { query: async () => ({ rows: [] }), getClient: async () => ({ query: async () => ({}), release() {} }) };
  if (id.endsWith('/middleware/auth')) return { authenticateToken: (_req, _res, next) => next() };
  if (id.endsWith('/services/planService') || id.endsWith('/planService')) {
    return { resolvePlanForRequest: async () => ({ plan: 'pro' }), getDraftConfig: () => ({ draft_enabled: true, monitoring_cap: 20 }) };
  }
  if (id.endsWith('/deeperScanService')) return { triggerDeeperScan: async () => {} };
  return originalRequire.apply(this, arguments);
};

const { __test } = require('../../routes/profile');
const { normalizeProfile, buildSaveValues, normalizePrompt, normalizeEnumField } = __test;

describe('profile save path — value fields round-trip', () => {
  it('normalizeEnumField accepts valid enums and nulls invalid ones', () => {
    assert.strictEqual(normalizeEnumField('deal_size_band', '50k_250k'), '50k_250k');
    assert.strictEqual(normalizeEnumField('deal_size_band', 'OVER_250K'), 'over_250k'); // case-insensitive
    assert.strictEqual(normalizeEnumField('deal_size_band', 'bogus'), null);
    assert.strictEqual(normalizeEnumField('sales_model', 'enterprise'), 'enterprise');
    assert.strictEqual(normalizeEnumField('sales_model', ''), null);
    assert.strictEqual(normalizeEnumField('sales_model', null), null);
  });

  it('buildSaveValues persists the two business fields (valid kept, invalid → null)', () => {
    const v = buildSaveValues({ deal_size_band: '10k_50k', sales_model: 'not-real' });
    assert.strictEqual(v.deal_size_band, '10k_50k');
    assert.strictEqual(v.sales_model, null);
  });

  it('normalizeProfile surfaces the two fields on read', () => {
    const row = { deal_size_band: 'over_250k', sales_model: 'enterprise' };
    const out = normalizeProfile(row);
    assert.strictEqual(out.deal_size_band, 'over_250k');
    assert.strictEqual(out.sales_model, 'enterprise');
    // Absent row → null (not undefined), like the other fields.
    assert.strictEqual(normalizeProfile(null).deal_size_band, null);
  });

  it('save path preserves a prompt `value` object verbatim (no flattening)', () => {
    const value = { band: 4, basis: 'business_grounded', generated_at: '2026-06-22T00:00:00.000Z' };
    const out = normalizePrompt({ text: ' acme vs globex ', funnel_stage: 'bofu', is_monitored: true, volume: 12, value });
    assert.deepStrictEqual(out.value, value, 'value preserved exactly');
    assert.strictEqual(out.text, 'acme vs globex');
    assert.strictEqual(out.funnel_stage, 'BOFU');
    assert.strictEqual(out.volume, 12);
    assert.strictEqual(out.is_monitored, true);
  });

  it('save path omits `value` when the prompt never had one (no fabricated null)', () => {
    const out = normalizePrompt({ text: 'new prompt', funnel_stage: 'TOFU', is_monitored: false });
    assert.ok(!('value' in out), 'no value key fabricated for a fresh prompt');
  });

  it('full tracked_prompts round-trip keeps value alongside volume', () => {
    const prompts = [
      { text: 'p1', funnel_stage: 'TOFU', is_monitored: true, volume: 100, value: { band: 1, basis: 'business_grounded', generated_at: 'Z' } },
      { text: 'p2', funnel_stage: 'BOFU', is_monitored: false, volume: null },
    ];
    const v = buildSaveValues({ tracked_prompts: prompts });
    assert.deepStrictEqual(v.tracked_prompts[0].value, prompts[0].value);
    assert.strictEqual(v.tracked_prompts[0].volume, 100);
    assert.ok(!('value' in v.tracked_prompts[1]));
  });

  it('save path preserves opportunity_evidence verbatim (un-flattened)', () => {
    const opportunity_evidence = {
      cited_domains: [{ domain: 'g2.com', count: 2 }, { domain: 'acme.com', count: 1 }],
      diversity_count: 2,
      brand_present: true,
      competitors_present: [{ name: 'Globex', domain: 'globex.com' }],
      engine: 'perplexity',
      gathered_at: '2026-06-22T00:00:00.000Z',
    };
    const out = normalizePrompt({ text: 'acme vs globex', funnel_stage: 'BOFU', is_monitored: true, volume: 5, opportunity_evidence });
    assert.deepStrictEqual(out.opportunity_evidence, opportunity_evidence, 'nested evidence preserved exactly');
  });

  it('preservation is generalized: value + opportunity_evidence + any future key survive together', () => {
    const prompt = {
      text: 'p', funnel_stage: 'BOFU', is_monitored: true, volume: 9,
      value: { band: 5 },
      opportunity_evidence: { diversity_count: 3, engine: 'perplexity' },
      demand: { index: 42 }, // hypothetical future enrichment key
    };
    const out = normalizePrompt(prompt);
    assert.deepStrictEqual(out.value, prompt.value);
    assert.deepStrictEqual(out.opportunity_evidence, prompt.opportunity_evidence);
    assert.deepStrictEqual(out.demand, prompt.demand, 'future enrichment keys are not dropped');
  });
});
