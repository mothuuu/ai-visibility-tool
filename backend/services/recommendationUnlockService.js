'use strict';

/**
 * recommendationUnlockService.js — spend-then-generate for the paid
 * recommendation layer, in ONE transaction (the packEngine token-safety
 * contract, tightened to never-charge-on-failure via a shared externalClient).
 *
 * Sequence (all on one client, one transaction):
 *   BEGIN → spendTokens(..., client) → generate artifact → INSERT unlock → COMMIT
 * Any failure after the spend (generation throw, JSON parse, insert/race) →
 * ROLLBACK, so tokens never leave the balance without a persisted artifact.
 *
 * Idempotent per (user, scan, type): an existing unlock is returned with
 * already_unlocked:true and no spend. A UNIQUE (user_id, scan_id, type)
 * constraint plus row-level balance locking makes concurrent double-clicks
 * charge exactly once.
 */

const db = require('../db/database');
const TokenService = require('./tokenService');
const InsufficientTokensError = require('../errors/InsufficientTokensError');
const { getPricing } = require('../config/recommendationPricing');
const { generateSchemaArtifact } = require('./schemaArtifactGenerator');

// type → generator(scanEvidence, scanUrl, scanId) → artifact (throws if it can't)
const GENERATORS = Object.freeze({
  schema: (scanEvidence, scanUrl, scanId) => generateSchemaArtifact(scanEvidence, scanUrl, scanId),
});

class UnlockValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'UnlockValidationError';
    this.code = code; // 'UNKNOWN_TYPE' | 'SCAN_NOT_FOUND' | 'SCAN_NOT_COMPLETED' | 'NO_EVIDENCE'
  }
}

// Internal sentinel: lost the INSERT race to a concurrent unlock of the same key.
class UnlockRaceError extends Error {}

function parseDetailedAnalysis(detailedAnalysis) {
  let da = detailedAnalysis;
  if (typeof da === 'string') {
    try { da = JSON.parse(da); } catch (e) { return null; }
  }
  return (da && typeof da === 'object') ? da : null;
}

function getScanEvidence(detailedAnalysis) {
  const da = parseDetailedAnalysis(detailedAnalysis);
  const ev = da && (da.scanEvidence || da.scan_evidence);
  return (ev && typeof ev === 'object') ? ev : null;
}

async function loadExistingUnlock(userId, scanId, type) {
  const r = await db.query(
    `SELECT artifact, tokens_spent
       FROM recommendation_unlocks
      WHERE user_id = $1 AND scan_id = $2 AND recommendation_type = $3`,
    [userId, scanId, type]
  );
  return r.rows[0] || null;
}

/**
 * Unlock (generate + persist) a paid recommendation for a scan.
 *
 * @param {number} userId
 * @param {number} scanId
 * @param {string} type - e.g. 'schema'
 * @returns {Promise<{unlocked:boolean, already_unlocked:boolean, artifact:object, tokens_spent:number, balance_after:number}>}
 * @throws {UnlockValidationError|InsufficientTokensError|Error}
 */
async function unlockRecommendation(userId, scanId, type) {
  const pricing = getPricing(type);
  const generator = GENERATORS[type];
  if (!pricing || !generator) {
    throw new UnlockValidationError(`Unknown recommendation type: ${type}`, 'UNKNOWN_TYPE');
  }
  const price = pricing.tokens;

  // 1) Ownership + completeness + evidence presence.
  const scanRes = await db.query(
    `SELECT id, user_id, url, status, detailed_analysis
       FROM scans WHERE id = $1 AND user_id = $2`,
    [scanId, userId]
  );
  if (scanRes.rows.length === 0) {
    throw new UnlockValidationError('Scan not found', 'SCAN_NOT_FOUND');
  }
  const scan = scanRes.rows[0];
  if (scan.status && scan.status !== 'completed') {
    throw new UnlockValidationError('Scan is not completed', 'SCAN_NOT_COMPLETED');
  }
  const scanEvidence = getScanEvidence(scan.detailed_analysis);
  if (!scanEvidence) {
    // Slim/foreign-domain scans persist rubric-only output → nothing to generate.
    throw new UnlockValidationError('No scan evidence available for this scan', 'NO_EVIDENCE');
  }

  // 2) Idempotency pre-check (no spend).
  const existing = await loadExistingUnlock(userId, scanId, type);
  if (existing) {
    const bal = await TokenService.getBalance(userId);
    return {
      unlocked: true, already_unlocked: true,
      artifact: existing.artifact, tokens_spent: existing.tokens_spent,
      balance_after: bal.total_available,
    };
  }

  // 3) Fast 402 before opening a transaction (spendTokens still enforces atomically).
  const preBal = await TokenService.getBalance(userId);
  if (preBal.total_available < price) {
    throw new InsufficientTokensError(price, preBal.total_available);
  }

  const scanUrl = scanEvidence.url || scan.url || null;

  // 4) One transaction: spend → generate → insert. Any throw → ROLLBACK (never charged).
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const balanceState = await TokenService.spendTokens(
      userId, price, 'recommendation_unlock', `${scanId}:${type}`, client
    );

    const artifact = generator(scanEvidence, scanUrl, scanId); // throws on thin evidence / parse fail

    const ins = await client.query(
      `INSERT INTO recommendation_unlocks
         (user_id, scan_id, recommendation_type, tokens_spent, artifact)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (user_id, scan_id, recommendation_type) DO NOTHING
       RETURNING id`,
      [userId, scanId, type, price, JSON.stringify(artifact)]
    );
    if (ins.rows.length === 0) {
      // A concurrent unlock of the same key already committed — undo our spend.
      throw new UnlockRaceError();
    }

    await client.query('COMMIT');
    return {
      unlocked: true, already_unlocked: false,
      artifact, tokens_spent: price, balance_after: balanceState.total_available,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* connection already broken */ }
    if (err instanceof UnlockRaceError) {
      const row = await loadExistingUnlock(userId, scanId, type);
      const bal = await TokenService.getBalance(userId);
      return {
        unlocked: true, already_unlocked: true,
        artifact: row ? row.artifact : null,
        tokens_spent: row ? row.tokens_spent : 0,
        balance_after: bal.total_available,
      };
    }
    throw err; // InsufficientTokensError / generation error / etc. → route maps it
  } finally {
    client.release();
  }
}

module.exports = {
  unlockRecommendation,
  loadExistingUnlock,
  getScanEvidence,
  UnlockValidationError,
};
