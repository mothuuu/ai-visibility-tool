'use strict';

/**
 * Recommendations Route — the paid recommendation unlock endpoint.
 *
 *   POST /api/recommendations/:scanId/unlock   body: { type: 'schema' }
 *
 * Auth + completed-profile are applied at mount (server.js). Spend + generate +
 * persist happen in one transaction in recommendationUnlockService; this route
 * only validates input and maps outcomes to HTTP status codes.
 *
 * Status map:
 *   200 unlocked / already_unlocked
 *   400 invalid scan id / missing or unknown type
 *   402 insufficient tokens (payload carries price + balance for the top-up UI)
 *   404 scan not found / not owned
 *   409 scan not completed / no evidence (NO_EVIDENCE) — never a 500
 *   500 generation failure (tokens were rolled back — "you were not charged")
 */

const express = require('express');
const router = express.Router();

const TokenService = require('../services/tokenService');
const InsufficientTokensError = require('../errors/InsufficientTokensError');
const { getPricing } = require('../config/recommendationPricing');
const {
  unlockRecommendation,
  UnlockValidationError,
} = require('../services/recommendationUnlockService');

const VALIDATION_STATUS = {
  SCAN_NOT_FOUND: 404,
  SCAN_NOT_COMPLETED: 409,
  NO_EVIDENCE: 409,
  UNKNOWN_TYPE: 400,
};

router.post('/:scanId/unlock', async (req, res) => {
  const scanId = parseInt(req.params.scanId, 10);
  if (isNaN(scanId)) {
    return res.status(400).json({ error: 'Invalid scan ID', code: 'INVALID_SCAN_ID' });
  }

  const type = req.body && typeof req.body.type === 'string' ? req.body.type.trim() : null;
  if (!type) {
    return res.status(400).json({ error: 'Missing recommendation type', code: 'MISSING_TYPE' });
  }
  const pricing = getPricing(type);
  if (!pricing) {
    return res.status(400).json({ error: `Unknown recommendation type: ${type}`, code: 'UNKNOWN_TYPE' });
  }

  try {
    const result = await unlockRecommendation(req.user.id, scanId, type);
    return res.json({
      ...result,
      type,
      price: pricing.tokens,
      label: pricing.label,
    });
  } catch (err) {
    if (err instanceof InsufficientTokensError) {
      // 402 with price + current balance so the frontend can render the top-up state.
      let balance = err.available;
      if (balance == null) {
        try { balance = (await TokenService.getBalance(req.user.id)).total_available; }
        catch (e) { balance = 0; }
      }
      return res.status(402).json({
        error: 'Insufficient tokens',
        code: 'INSUFFICIENT_TOKENS',
        price: pricing.tokens,
        balance,
      });
    }
    if (err instanceof UnlockValidationError) {
      const status = VALIDATION_STATUS[err.code] || 400;
      return res.status(status).json({ error: err.message, code: err.code });
    }
    // Generation / persistence failure — the spend was rolled back.
    console.error(
      `[Unlock] scan ${scanId} type ${type} failed:`,
      err && err.stack ? err.stack : err
    );
    return res.status(500).json({
      error: 'Generation failed — you were not charged',
      code: 'GENERATION_FAILED',
    });
  }
});

module.exports = router;
