/**
 * Pack Routes
 *
 * REST endpoints that connect the frontend to PackEngine.
 *   POST /api/packs/purchase
 *   GET  /api/packs/catalog
 *   GET  /api/packs/history
 *   GET  /api/packs/:purchaseId   (must come after /catalog and /history)
 *
 * All endpoints require authentication. Pack generation is rate-limited
 * (3/min per user) because it triggers an expensive AI call.
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const db = require('../db/database');
const PackEngine = require('../services/packEngine');
const TokenService = require('../services/tokenService');
const { getEntitlements, getEffectivePlan } = require('../services/planService');
const { authenticateToken } = require('../middleware/auth');
const {
  PACK_CATALOG,
  getPackConfig,
  planMeetsRequirement
} = require('../config/packCatalog');
const InsufficientTokensError = require('../errors/InsufficientTokensError');

// =============================================================================
// RATE LIMITERS
// =============================================================================

const purchaseRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  keyGenerator: (req) => `pack_purchase_${req.user?.id || req.ip}`,
  message: { error: 'Too many pack purchases. Try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false
});

// =============================================================================
// POST /api/packs/purchase
// =============================================================================

router.post('/purchase', authenticateToken, purchaseRateLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { pack_type: packType, scan_id: scanId, params } = req.body || {};

    // ---- Validate pack_type ----
    const pack = getPackConfig(packType);
    if (!pack) {
      return res.status(400).json({
        error: `Invalid pack_type: ${packType}`,
        valid_pack_types: Object.keys(PACK_CATALOG)
      });
    }

    // ---- Validate scan_id format ----
    const scanIdNum = parseInt(scanId, 10);
    if (!scanIdNum || Number.isNaN(scanIdNum)) {
      return res.status(400).json({ error: 'scan_id is required and must be a positive integer' });
    }

    // ---- Ownership check (PackEngine also checks; we check first for nicer 404) ----
    const scanRes = await db.query(
      'SELECT id FROM scans WHERE id = $1 AND user_id = $2',
      [scanIdNum, userId]
    );
    if (scanRes.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    // ---- Plan gate ----
    const effectivePlan = getEffectivePlan(req.user.plan);
    if (!planMeetsRequirement(effectivePlan, pack.minPlan)) {
      const message = pack.minPlan === 'pro'
        ? 'Upgrade to Pro required for this pack'
        : `Upgrade to ${pack.minPlan} required for this pack`;
      return res.status(403).json({ error: message, required_plan: pack.minPlan });
    }

    // ---- Token check (race-condition-safe path: PackEngine re-checks under lock) ----
    const balance = await TokenService.getBalance(userId);
    if (balance.total_available < pack.cost) {
      return res.status(400).json({
        error: 'Insufficient tokens',
        required: pack.cost,
        available: balance.total_available,
        buy_tokens_url: '/api/tokens/purchase'
      });
    }

    // ---- Generate pack ----
    let result;
    try {
      result = await PackEngine.generate(userId, packType, scanIdNum, params || {});
    } catch (err) {
      if (err instanceof InsufficientTokensError) {
        // Race: balance changed between our pre-check and PackEngine's spend.
        const fresh = await TokenService.getBalance(userId);
        return res.status(400).json({
          error: 'Insufficient tokens',
          required: err.requested,
          available: fresh.total_available,
          buy_tokens_url: '/api/tokens/purchase'
        });
      }
      // PackValidationError surfaces as the appropriate status; everything else 500.
      if (err && err.code === 'plan_too_low') {
        return res.status(403).json({ error: err.message, required_plan: pack.minPlan });
      }
      if (err && err.code === 'scan_not_found') {
        return res.status(404).json({ error: err.message });
      }
      console.error(`[Packs] Purchase generation error for user ${userId}:`, err.message);
      return res.status(500).json({ error: 'Pack generation failed', detail: err.message });
    }

    // ---- Success: fresh balance for client ----
    const balanceAfter = await TokenService.getBalance(userId);

    res.json({
      pack_purchase_id: result.packPurchaseId,
      pack_run_id: result.packRunId,
      status: result.status,
      tokens_spent: pack.cost,
      balance_remaining: {
        monthly_remaining: balanceAfter.monthly_remaining,
        purchased_balance: balanceAfter.purchased_balance,
        total_available: balanceAfter.total_available
      },
      artifacts: result.artifacts.map(a => ({
        id: a.id,
        artifact_type: a.type,
        content_preview: a.contentPreview
      })),
      ...(result.tokenDebitWarning ? { token_debit_warning: result.tokenDebitWarning } : {})
    });

  } catch (error) {
    console.error('[Packs] Purchase route error:', error.message);
    res.status(500).json({ error: 'Failed to purchase pack' });
  }
});

// =============================================================================
// GET /api/packs/catalog
// =============================================================================

router.get('/catalog', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const effectivePlan = getEffectivePlan(req.user.plan);
    const balance = await TokenService.getBalance(userId);

    const categories = { fix: [], create: [], research: [] };
    for (const [key, cfg] of Object.entries(PACK_CATALOG)) {
      const available = planMeetsRequirement(effectivePlan, cfg.minPlan);
      const affordable = balance.total_available >= cfg.cost;
      const entry = {
        key,
        name: cfg.name,
        description: cfg.description,
        cost: cfg.cost,
        category: cfg.category,
        minPlan: cfg.minPlan,
        requiresAI: cfg.requiresAI !== false,
        available,
        affordable
      };
      const bucket = categories[cfg.category];
      if (bucket) bucket.push(entry);
      else {
        // Unknown category — surface under a fallback so we don't drop packs silently
        if (!categories._other) categories._other = [];
        categories._other.push(entry);
      }
    }

    res.json({
      token_balance: {
        monthly_remaining: balance.monthly_remaining,
        purchased_balance: balance.purchased_balance,
        total_available: balance.total_available
      },
      categories
    });
  } catch (error) {
    console.error('[Packs] Catalog route error:', error.message);
    res.status(500).json({ error: 'Failed to fetch pack catalog' });
  }
});

// =============================================================================
// GET /api/packs/history
// =============================================================================

router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(page)  || page  < 1) page  = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    if (limit > 100) limit = 100;

    const offset = (page - 1) * limit;

    const [countRes, rowsRes] = await Promise.all([
      db.query('SELECT count(*) FROM pack_purchases WHERE user_id = $1', [userId]),
      db.query(`
        SELECT
          pp.id, pp.pack_type, pp.tokens_spent, pp.status, pp.scan_id, pp.created_at,
          (SELECT count(*)::int
             FROM pack_artifacts pa
             JOIN pack_runs pr ON pr.id = pa.pack_run_id
            WHERE pr.pack_purchase_id = pp.id) AS artifact_count
        FROM pack_purchases pp
        WHERE pp.user_id = $1
        ORDER BY pp.created_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset])
    ]);

    const total = parseInt(countRes.rows[0].count, 10);

    const purchases = rowsRes.rows.map(r => {
      const cfg = PACK_CATALOG[r.pack_type];
      return {
        id: r.id,
        pack_type: r.pack_type,
        pack_name: cfg ? cfg.name : r.pack_type,
        tokens_spent: r.tokens_spent,
        status: r.status,
        scan_id: r.scan_id,
        created_at: r.created_at,
        artifact_count: r.artifact_count
      };
    });

    res.json({
      purchases,
      total,
      page,
      limit,
      hasMore: (page * limit) < total
    });
  } catch (error) {
    console.error('[Packs] History route error:', error.message);
    res.status(500).json({ error: 'Failed to fetch pack history' });
  }
});

// =============================================================================
// GET /api/packs/:purchaseId
// (must be registered AFTER /catalog and /history so static routes win)
// =============================================================================

router.get('/:purchaseId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const purchaseId = parseInt(req.params.purchaseId, 10);

    if (!purchaseId || Number.isNaN(purchaseId)) {
      return res.status(400).json({ error: 'Invalid purchase ID' });
    }

    // Ownership-scoped lookup
    const purchaseRes = await db.query(
      `SELECT id, user_id, pack_type, tokens_spent, status, scan_id, created_at
       FROM pack_purchases
       WHERE id = $1 AND user_id = $2`,
      [purchaseId, userId]
    );
    if (purchaseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Pack not found' });
    }
    const purchase = purchaseRes.rows[0];

    // Most recent run for this purchase (we don't yet expose multi-version retries)
    const runRes = await db.query(
      `SELECT id, version, status, ai_model_used, started_at, completed_at
       FROM pack_runs
       WHERE pack_purchase_id = $1
       ORDER BY version DESC, id DESC
       LIMIT 1`,
      [purchaseId]
    );
    const run = runRes.rows[0] || null;

    let artifacts = [];
    if (run) {
      const artifactsRes = await db.query(
        `SELECT id, artifact_type, content_preview, content_full, file_size_bytes, created_at
         FROM pack_artifacts
         WHERE pack_run_id = $1
         ORDER BY id ASC`,
        [run.id]
      );
      artifacts = artifactsRes.rows;
    }

    const cfg = PACK_CATALOG[purchase.pack_type];
    res.json({
      id: purchase.id,
      pack_type: purchase.pack_type,
      pack_name: cfg ? cfg.name : purchase.pack_type,
      tokens_spent: purchase.tokens_spent,
      status: purchase.status,
      scan_id: purchase.scan_id,
      created_at: purchase.created_at,
      run: run ? {
        id: run.id,
        version: run.version,
        status: run.status,
        ai_model_used: run.ai_model_used,
        started_at: run.started_at,
        completed_at: run.completed_at
      } : null,
      artifacts: artifacts.map(a => ({
        id: a.id,
        artifact_type: a.artifact_type,
        content_preview: a.content_preview,
        content_full: a.content_full,
        file_size_bytes: a.file_size_bytes,
        created_at: a.created_at
      }))
    });

  } catch (error) {
    console.error('[Packs] Get purchase route error:', error.message);
    res.status(500).json({ error: 'Failed to fetch pack' });
  }
});

module.exports = router;
