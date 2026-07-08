/**
 * Findings Route
 *
 * GET /api/scans/:scanId/findings
 *
 * Serves findings for a scan to the results page and dashboard.
 *
 * RE-ROUTED (evidence engine): findings are now sourced from the rich
 * `scan_recommendations` rows produced by the v5.x evidence engine — status,
 * what-we-found, why-it-matters, how-to-implement steps, score gain, difficulty
 * and severity — instead of the thin, score-derived rows in the `findings`
 * table (findingsExtractor). The scanner, DB schema and findingsExtractor are
 * untouched; only this read handler changed.
 *
 * Guardrails:
 *  - Findings are free/diagnostic. Tier gates execution packs, NOT findings
 *    visibility — every finding is returned regardless of plan.
 *  - No silent fallback to the score-walk. If a scan whose evidence is
 *    populated has zero rich rows, we log a warning listing the scanEvidence
 *    top-level keys and return the rich empty-state — we never revert to the
 *    findings table / findingsExtractor.
 *  - On error we surface it in logs with the scanId and return an error state —
 *    never thin findings.
 *
 * NOTE (follow-up "C"): new scans no longer populate scan_recommendations
 * (recommendation generation was removed from the scan pipeline), so recent
 * scans return the empty-state until scan-time generation is restored.
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { mapRecommendationToFinding, severityCounts } = require('../services/richFindingsMapper');

// Column set + deterministic ordering (severity, then score gain, then id).
const REC_QUERY = `
  SELECT
    id, category, subfactor_key, priority, estimated_impact, estimated_effort,
    status, recommendation_text, findings, why_it_matters, impact_description,
    action_steps, engine_version
  FROM scan_recommendations
  WHERE scan_id = $1
  ORDER BY
    CASE LOWER(priority)
      WHEN 'critical' THEN 1
      WHEN 'high'     THEN 2
      WHEN 'medium'   THEN 3
      WHEN 'low'      THEN 4
      ELSE 5
    END ASC,
    estimated_impact DESC NULLS LAST,
    id ASC
`;

function scanEvidenceKeys(detailedAnalysis) {
  let da = detailedAnalysis;
  if (typeof da === 'string') {
    try { da = JSON.parse(da); } catch (_) { return []; }
  }
  const ev = da && (da.scanEvidence || da.scan_evidence);
  return (ev && typeof ev === 'object') ? Object.keys(ev) : [];
}

router.get('/:scanId/findings', authenticateToken, async (req, res) => {
  const scanId = parseInt(req.params.scanId, 10);

  if (isNaN(scanId)) {
    return res.status(400).json({ error: 'Invalid scan ID' });
  }

  try {
    const userId = req.user.id;

    // 1) Ownership check (also pulls detailed_analysis for the empty-state log).
    const scanResult = await db.query(
      'SELECT id, detailed_analysis FROM scans WHERE id = $1 AND user_id = $2',
      [scanId, userId]
    );
    if (scanResult.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    // 2) Rich source: persisted evidence-engine recommendations.
    const recResult = await db.query(REC_QUERY, [scanId]);

    if (recResult.rows.length > 0) {
      const findings = recResult.rows.map(mapRecommendationToFinding);
      // Tier does NOT gate findings visibility — return all of them.
      return res.json({
        findings,
        total_count: findings.length,
        severity_counts: severityCounts(findings),
        plan_limited: false,
        source: 'scan_recommendations',
      });
    }

    // 3) Zero rich rows — NO silent fallback to findingsExtractor. Log the
    //    scanEvidence keys so the regression is visible, return empty-state.
    const evKeys = scanEvidenceKeys(scanResult.rows[0].detailed_analysis);
    console.warn(
      `[Findings] scan ${scanId}: 0 rich recommendations in scan_recommendations; ` +
      `NOT falling back to findingsExtractor. scanEvidence keys present: [${evKeys.join(', ')}]`
    );
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
