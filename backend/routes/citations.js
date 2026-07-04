/**
 * Citation Routes
 *   GET /api/citations/latest    most recent test run + plan-gated evidence
 *   GET /api/citations/history   paginated list of runs (metadata only)
 *   GET /api/citations/:runId    specific run + plan-gated evidence (must be owned)
 *
 * Plan gating on evidence rows (per SSOT):
 *   teaser   (free)    → first 3 rows, plan_limited=true; never expose
 *                        response_snippet or competitor_cited
 *   standard (starter) → all rows; strip response_snippet + competitor_cited
 *   pro                → all rows including response_snippet + competitor_cited
 */

const express = require('express');
const router = express.Router();

const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { getEntitlements } = require('../services/planService');

const FREE_PREVIEW_LIMIT = 3;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function citationTier(plan) {
  const e = getEntitlements(plan) || {};
  return e.hasCitation || 'teaser';
}

function citationRate(cited, prompts) {
  if (!prompts) return 0;
  return Number(((cited / prompts) * 100).toFixed(1));
}

function summarizeRun(row) {
  return {
    id: row.id,
    run_type: row.run_type,
    engines_tested: row.engines_tested || [],
    prompts_tested: row.prompts_tested,
    cited_count: row.cited_count,
    not_cited_count: row.not_cited_count,
    citation_rate: citationRate(row.cited_count, row.prompts_tested),
    delta_summary: row.delta_summary || null,
    completed_at: row.completed_at,
  };
}

function shapeEvidenceForTier(evidence, tier) {
  // For all tiers, strip Pro fields by default.
  let rows = evidence.map(e => ({
    query_text: e.query_text,
    engine: e.engine,
    cited: e.cited,
    citation_type: e.citation_type,
    domain_mentioned: e.domain_mentioned,
  }));

  if (tier === 'pro') {
    // Re-attach Pro fields when present
    rows = evidence.map(e => ({
      query_text: e.query_text,
      engine: e.engine,
      cited: e.cited,
      citation_type: e.citation_type,
      domain_mentioned: e.domain_mentioned,
      response_snippet: e.response_snippet || null,
      competitor_cited: e.competitor_cited || [],
    }));
  }

  if (tier === 'teaser') {
    const total = rows.length;
    const truncated = rows.slice(0, FREE_PREVIEW_LIMIT);
    return { evidence: truncated, plan_limited: true, total_evidence_count: total };
  }
  return { evidence: rows, plan_limited: false, total_evidence_count: rows.length };
}

async function loadEvidence(runId) {
  const r = await db.query(
    `SELECT query_text, engine, cited, citation_type, domain_mentioned,
            response_snippet, competitor_cited
       FROM citation_evidence
      WHERE test_run_id = $1
      ORDER BY id ASC`,
    [runId]
  );
  return r.rows;
}

// ---------------------------------------------------------------------------
// GET /api/citations/latest
// (must be registered before /:runId)
// ---------------------------------------------------------------------------
router.get('/latest', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const tier = citationTier(req.user.plan);

    const runRes = await db.query(
      `SELECT id, run_type, engines_tested, prompts_tested, cited_count, not_cited_count,
              delta_summary, completed_at
         FROM citation_test_runs
        WHERE user_id = $1 AND status = 'completed'
        ORDER BY completed_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [userId]
    );
    if (runRes.rows.length === 0) {
      return res.json({ hasData: false, message: 'Run a scan to see citation data' });
    }

    const run = runRes.rows[0];
    const evidence = await loadEvidence(run.id);
    const shaped = shapeEvidenceForTier(evidence, tier);

    res.json({
      hasData: true,
      testRun: summarizeRun(run),
      evidence: shaped.evidence,
      plan_limited: shaped.plan_limited,
      total_evidence_count: shaped.total_evidence_count,
    });
  } catch (err) {
    console.error('[Citations] /latest error:', err.message);
    res.status(500).json({ error: 'Failed to load latest citation run' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/citations/history
// (must be registered before /:runId)
// ---------------------------------------------------------------------------
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    let page  = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(page)  || page  < 1) page  = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 10;
    if (limit > 50) limit = 50;
    const offset = (page - 1) * limit;

    const [countRes, rowsRes] = await Promise.all([
      db.query(`SELECT count(*) FROM citation_test_runs WHERE user_id = $1`, [userId]),
      db.query(
        `SELECT id, run_type, engines_tested, prompts_tested, cited_count, not_cited_count,
                delta_summary, completed_at
           FROM citation_test_runs
          WHERE user_id = $1
          ORDER BY completed_at DESC NULLS LAST, id DESC
          LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      ),
    ]);
    const total = parseInt(countRes.rows[0].count, 10);

    res.json({
      runs: rowsRes.rows.map(summarizeRun),
      total,
      page,
      limit,
      hasMore: (page * limit) < total,
    });
  } catch (err) {
    console.error('[Citations] /history error:', err.message);
    res.status(500).json({ error: 'Failed to load citation history' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/citations/:runId
// ---------------------------------------------------------------------------
router.get('/:runId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const runId = parseInt(req.params.runId, 10);
    if (!runId || Number.isNaN(runId)) {
      return res.status(400).json({ error: 'Invalid runId' });
    }

    const runRes = await db.query(
      `SELECT id, user_id, run_type, engines_tested, prompts_tested, cited_count,
              not_cited_count, delta_summary, completed_at, status
         FROM citation_test_runs
        WHERE id = $1 AND user_id = $2`,
      [runId, userId]
    );
    if (runRes.rows.length === 0) {
      return res.status(404).json({ error: 'Citation run not found' });
    }

    const tier = citationTier(req.user.plan);
    const run = runRes.rows[0];
    const evidence = await loadEvidence(run.id);
    const shaped = shapeEvidenceForTier(evidence, tier);

    res.json({
      hasData: true,
      testRun: summarizeRun(run),
      evidence: shaped.evidence,
      plan_limited: shaped.plan_limited,
      total_evidence_count: shaped.total_evidence_count,
    });
  } catch (err) {
    console.error('[Citations] /:runId error:', err.message);
    res.status(500).json({ error: 'Failed to load citation run' });
  }
});

module.exports = router;
