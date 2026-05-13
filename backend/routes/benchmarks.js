/**
 * Benchmark Routes
 *   GET /api/benchmarks/my-position   user's position within their vertical
 *   GET /api/benchmarks/:vertical     anonymous vertical stats
 *
 * Plan gating:
 *   Free (teaser):
 *     /my-position → overall percentile only; pillars omitted; plan_limited=true
 *     /:vertical   → 403 (aggregate stats locked behind a paid plan)
 *   Starter / Pro:
 *     full pillar breakdown on /my-position
 *     full vertical stats on /:vertical
 */

const express = require('express');
const router = express.Router();

const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { getEntitlements } = require('../services/planService');
const { getBenchmarkForScan } = require('../jobs/benchmarkAggregation');

function citationTier(plan) {
  const e = getEntitlements(plan) || {};
  return e.hasCitation || 'teaser';
}

// ---------------------------------------------------------------------------
// GET /api/benchmarks/my-position   (must come before /:vertical)
// ---------------------------------------------------------------------------
router.get('/my-position', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const tier = citationTier(req.user.plan);

    // Most recent completed scan for the user
    const scanRes = await db.query(
      `SELECT id FROM scans
        WHERE user_id = $1 AND status = 'completed'
        ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (scanRes.rows.length === 0) {
      return res.json({ hasData: false, message: 'Run a scan first to see your benchmark position' });
    }
    const scanId = scanRes.rows[0].id;

    const bench = await getBenchmarkForScan(scanId);
    if (!bench) {
      return res.json({
        hasData: false,
        message: 'Benchmarks not yet computed for your industry'
      });
    }

    // Gate by tier
    if (tier === 'teaser') {
      return res.json({
        hasData: true,
        vertical: bench.vertical,
        fallbackUsed: bench.fallbackUsed,
        sampleSize: bench.sampleSize,
        computedAt: bench.computedAt,
        overall: bench.overall,
        pillars: {}, // hidden for free
        plan_limited: true,
      });
    }

    res.json({
      hasData: true,
      vertical: bench.vertical,
      fallbackUsed: bench.fallbackUsed,
      sampleSize: bench.sampleSize,
      computedAt: bench.computedAt,
      overall: bench.overall,
      pillars: bench.pillars,
      plan_limited: false,
    });
  } catch (err) {
    console.error('[Benchmarks] /my-position error:', err.message);
    res.status(500).json({ error: 'Failed to load benchmark position' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/benchmarks/:vertical    (paid plans only)
// ---------------------------------------------------------------------------
router.get('/:vertical', authenticateToken, async (req, res) => {
  try {
    const tier = citationTier(req.user.plan);
    if (tier === 'teaser') {
      return res.status(403).json({
        error: 'Aggregate benchmark stats require a Starter or Pro plan'
      });
    }

    const vertical = String(req.params.vertical || '').toLowerCase().trim();
    if (!vertical) return res.status(400).json({ error: 'Invalid vertical' });

    const r = await db.query(
      `SELECT vertical, sample_size, overall_avg, overall_p25, overall_p50,
              overall_p75, overall_p90, pillar_stats, computed_at
         FROM benchmark_stats
        WHERE vertical = $1
        ORDER BY computed_at DESC LIMIT 1`,
      [vertical]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'No benchmark data for that vertical yet' });
    }

    const b = r.rows[0];
    res.json({
      vertical: b.vertical,
      sampleSize: b.sample_size,
      computedAt: b.computed_at,
      overall: {
        avg: numOrNull(b.overall_avg),
        p25: numOrNull(b.overall_p25),
        p50: numOrNull(b.overall_p50),
        p75: numOrNull(b.overall_p75),
        p90: numOrNull(b.overall_p90),
      },
      pillars: b.pillar_stats || {},
    });
  } catch (err) {
    console.error('[Benchmarks] /:vertical error:', err.message);
    res.status(500).json({ error: 'Failed to load benchmark' });
  }
});

function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = router;
