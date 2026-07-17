/**
 * Findings Route
 *
 * GET /api/scans/:scanId/findings
 *
 * Serves findings for a scan to the results page and dashboard.
 *
 * RE-ROUTED (evidence engine) + GENERATE-ON-MISS: findings are sourced from the
 * rich `scan_recommendations` rows — status, what-we-found, why-it-matters,
 * how-to-implement steps, score gain, difficulty, severity — instead of the
 * thin, score-derived rows in the `findings` table (findingsExtractor).
 *
 * Cache behaviour:
 *  - Rows exist (cache hit) → map and serve; never regenerate.
 *  - Zero rows (cache miss) → run the evidence-only top-10 generator from the
 *    persisted scanEvidence (no scores, no re-crawl, no HTTP/LLM), persist the
 *    rows, then map and serve. Empty scans heal on first view; second load is a
 *    cache hit. No backfill job.
 *
 * Guardrails:
 *  - Findings are free/diagnostic. Tier gates execution packs, NOT findings
 *    visibility — every finding is returned regardless of plan.
 *  - No silent fallback to the score-walk. If generation yields nothing (or
 *    throws), log with scanId + the scanEvidence top-level keys and return the
 *    clean empty-state — never revert to the findings table / findingsExtractor.
 *  - On error we surface it in logs with the scanId and return an error state —
 *    never thin findings.
 *
 * The scanner, DB schema and findingsExtractor are untouched.
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { mapRecommendationToFinding, severityCounts } = require('../services/richFindingsMapper');
const { generateAndPersist } = require('../services/findingsGenerator');

// Column set + deterministic ordering (severity, then score gain, then id).
const REC_QUERY = `
  SELECT
    id, category, subfactor_key, priority, estimated_impact, estimated_effort,
    status, recommendation_text, findings, why_it_matters, impact_description,
    action_steps, engine_version,
    (evidence_json->>'gap')::numeric       AS gap,
    (evidence_json->>'score')::numeric     AS score,
    (evidence_json->>'threshold')::numeric AS threshold,
    evidence_json->'what_we_found_items'   AS what_we_found_items
  FROM scan_recommendations
  WHERE scan_id = $1
  ORDER BY
    CASE LOWER(priority)
      WHEN 'critical' THEN 1  WHEN 'p0' THEN 1
      WHEN 'high'     THEN 2  WHEN 'p1' THEN 2
      WHEN 'medium'   THEN 3  WHEN 'p2' THEN 3
      WHEN 'low'      THEN 4
      ELSE 5
    END ASC,
    estimated_impact DESC NULLS LAST,
    id ASC
`;

function parseDetailedAnalysis(detailedAnalysis) {
  let da = detailedAnalysis;
  if (typeof da === 'string') {
    try { da = JSON.parse(da); } catch (_) { return null; }
  }
  return (da && typeof da === 'object') ? da : null;
}

function getScanEvidence(detailedAnalysis) {
  const da = parseDetailedAnalysis(detailedAnalysis);
  const ev = da && (da.scanEvidence || da.scan_evidence);
  return (ev && typeof ev === 'object') ? ev : null;
}

function respondWithRows(res, rows, extra = {}) {
  const findings = rows.map(mapRecommendationToFinding);
  return res.json({
    findings,
    total_count: findings.length,
    severity_counts: severityCounts(findings),
    plan_limited: false,          // tier never gates findings visibility
    source: 'scan_recommendations',
    ...extra,
  });
}

router.get('/:scanId/findings', authenticateToken, async (req, res) => {
  const scanId = parseInt(req.params.scanId, 10);

  if (isNaN(scanId)) {
    return res.status(400).json({ error: 'Invalid scan ID' });
  }

  try {
    const userId = req.user.id;

    // 1) Ownership check + the fields generation needs (scanEvidence, industry).
    const scanResult = await db.query(
      `SELECT id, url, domain, domain_type, organization_id, industry, detailed_analysis
         FROM scans WHERE id = $1 AND user_id = $2`,
      [scanId, userId]
    );
    if (scanResult.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    const scanRow = scanResult.rows[0];

    // 2) Cache hit: rows exist → map and serve, never regenerate.
    const recResult = await db.query(REC_QUERY, [scanId]);
    if (recResult.rows.length > 0) {
      return respondWithRows(res, recResult.rows);
    }

    // 3) Cache miss: generate evidence-only rows from the stored scanEvidence.
    const scanEvidence = getScanEvidence(scanRow.detailed_analysis);
    const evKeys = scanEvidence ? Object.keys(scanEvidence) : [];

    if (scanEvidence) {
      try {
        const scan = {
          id: scanId,
          url: scanEvidence.url || scanRow.url || null,
          domain: scanRow.domain || scanRow.url || null,
          domain_type: scanRow.domain_type || null,
          organization_id: scanRow.organization_id || null,
        };
        const da = parseDetailedAnalysis(scanRow.detailed_analysis) || {};
        const industry = scanRow.industry || da.industry || null;
        // B1: present only on future scans; when absent the generator skips the
        // gate and behaves exactly as today (evidence-only) for existing scans.
        const subfactorScores = da.subfactorScores || null;

        const result = await generateAndPersist({ scanId, scan, scanEvidence, industry, subfactorScores });
        // Re-read (covers both this generation and a race that lost the lock).
        const regen = await db.query(REC_QUERY, [scanId]);
        if (regen.rows.length > 0) {
          return respondWithRows(res, regen.rows, { generated: !result.alreadyExisted });
        }
        // Generated zero rows (e.g. every top-10 subfactor COMPLETE) → empty-state.
        console.warn(
          `[Findings] scan ${scanId}: generate-on-miss produced 0 rows; ` +
          `scanEvidence keys present: [${evKeys.join(', ')}]`
        );
      } catch (genErr) {
        // NO silent fallback to findingsExtractor — log and return empty-state.
        console.error(
          `[Findings] scan ${scanId}: generate-on-miss failed: ` +
          `${genErr && genErr.stack ? genErr.stack : genErr}; ` +
          `scanEvidence keys present: [${evKeys.join(', ')}]`
        );
      }
    } else {
      console.warn(`[Findings] scan ${scanId}: no scanEvidence to generate from; returning empty-state.`);
    }

    // 4) Clean empty-state — never thin findings.
    return res.json({
      findings: [],
      total_count: 0,
      severity_counts: { critical: 0, high: 0, medium: 0, low: 0 },
      plan_limited: false,
      source: 'scan_recommendations',
      empty_state: true,
      empty_reason: 'no_rich_findings',
    });
  } catch (error) {
    console.error(
      `[Findings] scan ${scanId}: error building rich findings:`,
      error && error.stack ? error.stack : error
    );
    return res.status(500).json({ error: 'Failed to load findings', scanId });
  }
});

module.exports = router;
