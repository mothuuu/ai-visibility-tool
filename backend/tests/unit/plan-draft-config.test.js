/**
 * Intake/Profile Draft Config Tests (intake-form/profile build, Step 2)
 *
 * Verifies PlanService.getDraftConfig() returns the correct per-plan draft
 * settings, that 'diy' aliases to 'starter', and that unknown/legacy plans
 * fall back to the freemium (no-draft) config without throwing.
 *
 * Run with: node --test backend/tests/unit/plan-draft-config.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// Mock database module before importing service (it requires ../db/database)
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../db/database' || id.endsWith('/db/database')) {
    return { query: async () => ({ rows: [] }) };
  }
  return originalRequire.apply(this, arguments);
};

const { getDraftConfig, isDraftEnabled } = require('../../services/planService');

// Expected configs (the contract this step delivers)
const EXPECTED = {
  freemium: {
    draft_enabled:              false,
    populated_prompts_min:      0,
    populated_prompts_max:      0,
    baseline_volume:            false,
    token_query_unlock_enabled: false,
    monitoring_cap:             0,
    benchmarking_enabled:       false
  },
  starter: {
    draft_enabled:              true,
    populated_prompts_min:      3,
    populated_prompts_max:      5,
    baseline_volume:            true,
    token_query_unlock_enabled: true,
    monitoring_cap:             5,
    benchmarking_enabled:       false
  },
  pro: {
    draft_enabled:              true,
    populated_prompts_min:      3,
    populated_prompts_max:      5,
    baseline_volume:            true,
    token_query_unlock_enabled: true,
    monitoring_cap:             20,
    benchmarking_enabled:       true
  },
  enterprise: {
    draft_enabled:              true,
    populated_prompts_min:      3,
    populated_prompts_max:      5,
    baseline_volume:            true,
    token_query_unlock_enabled: true,
    monitoring_cap:             null,
    benchmarking_enabled:       true
  }
};

describe('PlanService.getDraftConfig — per-plan draft settings', () => {

  it('freemium / free returns draft-disabled config', () => {
    assert.deepStrictEqual(getDraftConfig('freemium'), EXPECTED.freemium);
    assert.deepStrictEqual(getDraftConfig('free'), EXPECTED.freemium);
  });

  it('starter returns the paid draft config (3-5 prompts, cap 5, no benchmarking)', () => {
    assert.deepStrictEqual(getDraftConfig('starter'), EXPECTED.starter);
  });

  it('pro returns draft config with cap 20 and benchmarking enabled', () => {
    assert.deepStrictEqual(getDraftConfig('pro'), EXPECTED.pro);
  });

  it('enterprise returns draft config with custom (null) cap and benchmarking enabled', () => {
    assert.deepStrictEqual(getDraftConfig('enterprise'), EXPECTED.enterprise);
  });

  it("'diy' returns the SAME config as 'starter' (reuses existing mapping)", () => {
    assert.deepStrictEqual(getDraftConfig('diy'), getDraftConfig('starter'));
    assert.deepStrictEqual(getDraftConfig('diy'), EXPECTED.starter);
  });

  it('resolves case/whitespace/alias variants through PlanService', () => {
    assert.deepStrictEqual(getDraftConfig('  DIY  '), EXPECTED.starter);
    assert.deepStrictEqual(getDraftConfig('Pro'), EXPECTED.pro);
    assert.deepStrictEqual(getDraftConfig('ENTERPRISE'), EXPECTED.enterprise);
  });

  it('unknown / legacy / empty plans fall back to freemium config without throwing', () => {
    for (const bad of ['xyz123', 'agency', '', null, undefined, '   ', 42, {}]) {
      assert.doesNotThrow(() => getDraftConfig(bad), `getDraftConfig(${JSON.stringify(bad)}) threw`);
      assert.deepStrictEqual(
        getDraftConfig(bad),
        EXPECTED.freemium,
        `getDraftConfig(${JSON.stringify(bad)}) should fall back to freemium`
      );
    }
  });

  it('isDraftEnabled mirrors draft_enabled for each tier', () => {
    assert.strictEqual(isDraftEnabled('freemium'), false);
    assert.strictEqual(isDraftEnabled('free'), false);
    assert.strictEqual(isDraftEnabled('starter'), true);
    assert.strictEqual(isDraftEnabled('diy'), true);
    assert.strictEqual(isDraftEnabled('pro'), true);
    assert.strictEqual(isDraftEnabled('enterprise'), true);
  });

  it('isDraftEnabled is false for unknown/legacy plans and never throws', () => {
    for (const bad of ['xyz123', 'agency', '', null, undefined, 42, {}]) {
      assert.doesNotThrow(() => isDraftEnabled(bad), `isDraftEnabled(${JSON.stringify(bad)}) threw`);
      assert.strictEqual(isDraftEnabled(bad), false, `isDraftEnabled(${JSON.stringify(bad)}) should be false`);
    }
  });

  it('returned config is immutable (frozen)', () => {
    const cfg = getDraftConfig('pro');
    assert.ok(Object.isFrozen(cfg));
    assert.throws(() => { 'use strict'; cfg.draft_enabled = false; }, TypeError);
  });
});
