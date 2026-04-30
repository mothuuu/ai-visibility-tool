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

  try {
    // 1) Score using Rubric V5 via OpenAI
    const rubric = await runRubricScoring(url);

    // 2) Generate recommendations (LLM + FAQ DB)
    const recs = await generateRecommendations(rubric, vertical || 'default', domain);

    // 3) Persist analysis
    const summary = {
      domain,
      overall_score: rubric.overall_score,
      categories: rubric.categories,
      evidence: rubric.evidence,
      extracted: rubric.extracted,
      recommendations_count: recs.length,
      timestamp: new Date().toISOString()
    };

    const insertAnalysis = `
      INSERT INTO analyses (domain_id, url, status, summary, score)
      VALUES (NULL, $1, 'completed', $2, $3)
      RETURNING id;
    `;
    const aresult = await pool.query(insertAnalysis, [url, summary, rubric.overall_score]);
    const analysisId = aresult.rows[0].id;

    // 4) Persist recommendations (optional, but good practice)
    if (recs.length) {
      const insertRec = `
        INSERT INTO recommendations (analysis_id, category, severity, recommendation, faq_refs, evidence, validation_status)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      `;
      for (const r of recs) {
        await pool.query(insertRec, [
          analysisId,
          r.category,
          r.severity,
          { text_human: r.text_human, text_backend: r.text_backend, schema_jsonld: r.schema_jsonld, alt_questions: r.alt_questions },
          r.faq_refs,
          { evidence_refs: r.evidence_refs }
        ]);
      }
    }

    // 5) Respond
    res.status(200).json({
      status: 'success',
      analysis_id: analysisId,
      domain,
      score: rubric.overall_score,
      categories: rubric.categories,
      evidence: rubric.evidence,
      recommendations: recs
    });
  } catch (err) {
    console.error('❌ Analyze error:', err);
    res.status(500).json({
      error: 'Failed to complete analysis',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

module.exports = router;
