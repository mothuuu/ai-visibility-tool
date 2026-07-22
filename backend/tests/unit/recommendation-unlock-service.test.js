'use strict';

/**
 * Phase 1: unlock service transaction orchestration.
 * Deterministic stand-in for the live money-path checks (Step 6 items 2–5):
 * spend-exactly-once + COMMIT on success, ROLLBACK + never-charge on generation
 * failure, idempotency (no spend), and insufficient-balance → 402 error.
 *
 * db + TokenService are stubbed; generateSchemaArtifact runs for real.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/database');
const TokenService = require('../../services/tokenService');
const InsufficientTokensError = require('../../errors/InsufficientTokensError');
const { unlockRecommendation } = require('../../services/recommendationUnlockService');

const GOOD_EVIDENCE = {
  url: 'https://acme.example.com',
  metadata: { ogTitle: 'Acme Inc', ogDescription: 'We do things', ogImage: 'https://acme.example.com/og.png' },
  content: { headings: { h1: ['Acme Inc'] }, paragraphs: ['Welcome.'], faqs: [] },
  technical: { structuredData: [] },
  html: '',
};

const orig = {};
beforeEach(() => {
  orig.query = db.query; orig.getClient = db.getClient;
  orig.spend = TokenService.spendTokens; orig.balance = TokenService.getBalance;
});
afterEach(() => {
  db.query = orig.query; db.getClient = orig.getClient;
  TokenService.spendTokens = orig.spend; TokenService.getBalance = orig.balance;
});

// A fake txn client that records BEGIN/COMMIT/ROLLBACK and the unlock INSERT.
function fakeClient(state, opts = {}) {
  return {
    async query(sql, params) {
      const s = String(sql).trim();
      if (/^BEGIN/i.test(s)) { state.began = true; return {}; }
      if (/^COMMIT/i.test(s)) { state.committed = true; return {}; }
      if (/^ROLLBACK/i.test(s)) { state.rolledBack = true; return {}; }
      if (/INSERT INTO recommendation_unlocks/i.test(s)) {
        if (opts.conflict) return { rows: [] }; // race: ON CONFLICT DO NOTHING
        state.inserted = { artifact: JSON.parse(params[4]), tokens_spent: params[3] };
        return { rows: [{ id: 9 }] };
      }
      return { rows: [] };
    },
    release() { state.released = true; },
  };
}

describe('Phase 1: unlockRecommendation — happy path', () => {
  it('spends once, generates, inserts, commits; returns artifact + balance_after', async () => {
    const state = {};
    const scanRow = { id: 5, user_id: 1, url: 'https://acme.example.com', status: 'completed', detailed_analysis: { scanEvidence: GOOD_EVIDENCE } };
    let spendCalls = 0, spendClientPassed = false;

    db.query = async (sql) => {
      if (/FROM scans WHERE id/i.test(sql)) return { rows: [scanRow] };
      if (/FROM recommendation_unlocks/i.test(sql)) return { rows: [] };
      return { rows: [] };
    };
    TokenService.getBalance = async () => ({ total_available: 50 });
    TokenService.spendTokens = async (u, a, rt, ri, client) => {
      spendCalls++; spendClientPassed = !!client;
      assert.equal(a, 10); assert.equal(rt, 'recommendation_unlock'); assert.equal(ri, '5:schema');
      return { total_available: 40 };
    };
    db.getClient = async () => fakeClient(state);

    const res = await unlockRecommendation(1, 5, 'schema');
    assert.equal(res.unlocked, true);
    assert.equal(res.already_unlocked, false);
    assert.equal(res.tokens_spent, 10);
    assert.equal(res.balance_after, 40);
    assert.ok(res.artifact.blocks.length > 0);
    assert.equal(spendCalls, 1);
    assert.equal(spendClientPassed, true, 'spend shares the txn client');
    assert.equal(state.committed, true);
    assert.ok(!state.rolledBack);
  });
});

describe('Phase 1: unlockRecommendation — never charge on failure', () => {
  it('generation throw → ROLLBACK, error propagates, spend was inside the rolled-back txn', async () => {
    const state = {};
    // Empty url on both evidence and scan → generateSchemaArtifact throws.
    const thinEvidence = { url: '', metadata: {}, content: {}, technical: { structuredData: [] }, html: '' };
    const scanRow = { id: 6, user_id: 1, url: '', status: 'completed', detailed_analysis: { scanEvidence: thinEvidence } };

    db.query = async (sql) => {
      if (/FROM scans WHERE id/i.test(sql)) return { rows: [scanRow] };
      if (/FROM recommendation_unlocks/i.test(sql)) return { rows: [] };
      return { rows: [] };
    };
    TokenService.getBalance = async () => ({ total_available: 50 });
    let spendCalls = 0;
    TokenService.spendTokens = async () => { spendCalls++; return { total_available: 40 }; };
    db.getClient = async () => fakeClient(state);

    await assert.rejects(() => unlockRecommendation(1, 6, 'schema'), /SCHEMA_GEN/);
    assert.equal(spendCalls, 1, 'spend ran inside the txn');
    assert.equal(state.committed, undefined, 'never committed');
    assert.equal(state.rolledBack, true, 'rolled back → tokens never leave the balance');
    assert.equal(state.inserted, undefined, 'no unlock row persisted');
  });
});

describe('Phase 1: unlockRecommendation — idempotency', () => {
  it('existing unlock → returns it, no spend, no transaction', async () => {
    const scanRow = { id: 7, user_id: 1, url: 'https://acme.example.com', status: 'completed', detailed_analysis: { scanEvidence: GOOD_EVIDENCE } };
    let spendCalls = 0, gotClient = false;

    db.query = async (sql) => {
      if (/FROM scans WHERE id/i.test(sql)) return { rows: [scanRow] };
      if (/FROM recommendation_unlocks/i.test(sql)) return { rows: [{ artifact: { blocks: [{ schema_type: 'Organization' }] }, tokens_spent: 10 }] };
      return { rows: [] };
    };
    TokenService.getBalance = async () => ({ total_available: 100 });
    TokenService.spendTokens = async () => { spendCalls++; return { total_available: 90 }; };
    db.getClient = async () => { gotClient = true; return fakeClient({}); };

    const res = await unlockRecommendation(1, 7, 'schema');
    assert.equal(res.already_unlocked, true);
    assert.equal(res.tokens_spent, 10);
    assert.equal(spendCalls, 0, 'no re-charge');
    assert.equal(gotClient, false, 'no transaction opened');
  });
});

describe('Phase 1: unlockRecommendation — insufficient balance', () => {
  it('balance < price → InsufficientTokensError before any transaction', async () => {
    const scanRow = { id: 8, user_id: 1, url: 'https://acme.example.com', status: 'completed', detailed_analysis: { scanEvidence: GOOD_EVIDENCE } };
    let gotClient = false;
    db.query = async (sql) => {
      if (/FROM scans WHERE id/i.test(sql)) return { rows: [scanRow] };
      if (/FROM recommendation_unlocks/i.test(sql)) return { rows: [] };
      return { rows: [] };
    };
    TokenService.getBalance = async () => ({ total_available: 3 });
    db.getClient = async () => { gotClient = true; return fakeClient({}); };

    await assert.rejects(
      () => unlockRecommendation(1, 8, 'schema'),
      (e) => e instanceof InsufficientTokensError && e.requested === 10 && e.available === 3
    );
    assert.equal(gotClient, false);
  });
});

describe('Phase 1: unlockRecommendation — validation', () => {
  it('scan not found → UnlockValidationError SCAN_NOT_FOUND', async () => {
    db.query = async () => ({ rows: [] });
    await assert.rejects(() => unlockRecommendation(1, 999, 'schema'), /Scan not found/);
  });
  it('no scanEvidence (slim scan) → NO_EVIDENCE', async () => {
    const scanRow = { id: 9, user_id: 1, url: 'https://x.com', status: 'completed', detailed_analysis: {} };
    db.query = async (sql) => (/FROM scans WHERE id/i.test(sql) ? { rows: [scanRow] } : { rows: [] });
    await assert.rejects(() => unlockRecommendation(1, 9, 'schema'), (e) => e.code === 'NO_EVIDENCE');
  });
});
