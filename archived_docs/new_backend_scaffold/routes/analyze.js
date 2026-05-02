// ---------------------------------------------------------
// AOME | Analyze Route (scan → score → recommend)
// POST /api/v1/analyze
// ---------------------------------------------------------
const express = require('express');
const router = express.Router();
const { getPool } = require('../db/connect');
const { URL } = require('url');
const { runRubricScoring } = require('../services/scorer');
const { generateRecommendations } = require('../services/recommender');
const {
  TIMEOUTS,
  TimeoutError,
  withTimeout,
  isAbortError,
} = require('../utils/withTimeout');

function extractDomain(inputUrl) {
  try {
    const parsed = new URL(inputUrl);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Resolve the pool lazily so an uninitialized DB returns a clean
// 503 with a stable error code instead of crashing on `pool.query`.
function resolvePool() {
  try {
    return getPool();
  } catch {
    return null;
  }
}

// Build the request-level deadline controller. Aborting cascades into every
// upstream call wired up via withTimeout({ parentSignal }).
function createRequestDeadline(ms = TIMEOUTS.ANALYZE_DEADLINE_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new TimeoutError('analyze-deadline', ms));
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    cancel: () => clearTimeout(timer),
  };
}

router.post('/', async (req, res) => {
  const { url, vertical } = req.body;

  if (!url) return res.status(400).json({ error: 'Missing URL parameter.' });

  const domain = extractDomain(url);
  if (!domain) return res.status(400).json({ error: 'Invalid URL format.' });

  const pool = resolvePool();
  if (!pool) {
    console.error('❌ Analyze error: database pool unavailable');
    return res.status(503).json({
      error: 'Database unavailable',
      code: 'DB_UNAVAILABLE',
    });
  }

  const deadline = createRequestDeadline();
  // If the client disconnects, abort upstream work so workers aren't tied up.
  const onClientAbort = () => deadline.abort(new Error('client-disconnected'));
  req.on('aborted', onClientAbort);

  // Per-step status trackers — surfaced in the response and persisted with
  // the analysis row so partial results are auditable.
  let scoringStatus = 'pending';
  let recommendationsStatus = 'pending';
  let rubric = null;
  let recs = [];

  try {
    // 1) Score using Rubric V5 via OpenAI (hard timeout per call).
    try {
      rubric = await withTimeout(
        ({ signal }) => runRubricScoring(url, { signal }),
        TIMEOUTS.SCORER_MS,
        { label: 'rubric-scoring', parentSignal: deadline.signal }
      );
      scoringStatus = 'success';
    } catch (err) {
      if (err instanceof TimeoutError || isAbortError(err)) {
        scoringStatus = 'timeout';
        // Scoring is the foundation of the response; without it we have
        // nothing useful to persist or return.
        console.error(
          `⏱️  Analyze timeout: scoring exceeded ${TIMEOUTS.SCORER_MS}ms`
        );
        return res.status(504).json({
          error: 'Upstream scoring timed out',
          code: 'UPSTREAM_TIMEOUT',
          step: 'scoring',
        });
      }
      scoringStatus = 'error';
      console.error('❌ Analyze upstream error (scoring):', err.message);
      return res.status(502).json({
        error: 'Upstream scoring failed',
        code: 'UPSTREAM_ERROR',
        step: 'scoring',
      });
    }

    // 2) Generate recommendations. If this times out / fails, persist the
    //    analysis with what we have rather than failing the whole run.
    try {
      recs = await withTimeout(
        ({ signal }) =>
          generateRecommendations(rubric, vertical || 'default', domain, {
            signal,
          }),
        TIMEOUTS.RECOMMENDER_MS,
        { label: 'recommendations', parentSignal: deadline.signal }
      );
      recommendationsStatus = 'success';
    } catch (err) {
      if (err instanceof TimeoutError || isAbortError(err)) {
        recommendationsStatus = 'timeout';
        console.error(
          `⏱️  Analyze timeout: recommendations exceeded ${TIMEOUTS.RECOMMENDER_MS}ms`
        );
      } else {
        recommendationsStatus = 'error';
        console.error(
          '❌ Analyze upstream error (recommendations):',
          err.message
        );
      }
      recs = [];
    }

    // 3) Persist analysis (always — partial results are still valuable).
    const summary = {
      domain,
      overall_score: rubric.overall_score,
      categories: rubric.categories,
      evidence: rubric.evidence,
      extracted: rubric.extracted,
      recommendations_count: recs.length,
      scoring_status: scoringStatus,
      recommendations_status: recommendationsStatus,
      timestamp: new Date().toISOString(),
    };

    const insertAnalysis = `
      INSERT INTO analyses (domain_id, url, status, summary, score)
      VALUES (NULL, $1, $2, $3, $4)
      RETURNING id;
    `;
    const overallStatus =
      recommendationsStatus === 'success' ? 'completed' : 'partial';
    const aresult = await pool.query(insertAnalysis, [
      url,
      overallStatus,
      summary,
      rubric.overall_score,
    ]);
    const analysisId = aresult.rows[0].id;

    // 4) Persist recommendations only when the upstream call succeeded.
    if (recommendationsStatus === 'success' && recs.length) {
      const insertRec = `
        INSERT INTO recommendations (analysis_id, category, severity, recommendation, faq_refs, evidence, validation_status)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      `;
      for (const r of recs) {
        await pool.query(insertRec, [
          analysisId,
          r.category,
          r.severity,
          {
            text_human: r.text_human,
            text_backend: r.text_backend,
            schema_jsonld: r.schema_jsonld,
            alt_questions: r.alt_questions,
          },
          r.faq_refs,
          { evidence_refs: r.evidence_refs },
        ]);
      }
    }

    // 5) Respond. 200 even on partial results so callers get the score,
    //    but `recommendations_status` makes the degradation explicit.
    res.status(200).json({
      status: overallStatus,
      analysis_id: analysisId,
      domain,
      score: rubric.overall_score,
      categories: rubric.categories,
      evidence: rubric.evidence,
      recommendations: recs,
      scoring_status: scoringStatus,
      recommendations_status: recommendationsStatus,
    });
  } catch (err) {
    // Anything reaching here is a DB / unexpected failure (upstream errors
    // are mapped above). Don't leak stack traces.
    console.error('❌ Analyze error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to complete analysis',
        code: 'INTERNAL_ERROR',
      });
    }
  } finally {
    deadline.cancel();
    req.removeListener('aborted', onClientAbort);
  }
});

module.exports = router;
