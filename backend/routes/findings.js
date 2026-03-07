/**
 * Findings Route
 *
 * GET /api/scans/:scanId/findings
 *
 * Serves findings for a scan to the frontend dashboard.
 * Plan-gated: free plan users see only first 3 findings (teaser),
 * paid plans see all findings.
 *
 * Counts (total_count, severity_counts) always reflect the full
 * unfiltered set regardless of plan or query filters.
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { getEntitlements } = require('../services/planService');

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'];
const SEVERITY_ORDER = { critical: 1, high: 2, medium: 3, low: 4 };
const FREE_PLAN_FINDINGS_LIMIT = 3;

router.get('/:scanId/findings', authenticateToken, async (req, res) => {
  try {
    const scanId = parseInt(req.params.scanId, 10);
    const userId = req.user.id;

    if (isNaN(scanId)) {
      return res.status(400).json({ error: 'Invalid scan ID' });
    }

    // 1) Ownership check
    const scanResult = await db.query(
      'SELECT id FROM scans WHERE id = $1 AND user_id = $2',
      [scanId, userId]
    );

    if (scanResult.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    // Parse and validate filters
    const severityFilter = req.query.severity
      ? req.query.severity.split(',').map(s => s.trim().toLowerCase())
      : null;
    const pillarFilter = req.query.pillar
      ? req.query.pillar.split(',').map(p => p.trim().toLowerCase())
      : null;

    if (severityFilter) {
      const invalid = severityFilter.filter(s => !VALID_SEVERITIES.includes(s));
      if (invalid.length > 0) {
        return res.status(400).json({
          error: `Invalid severity value(s): ${invalid.join(', ')}. Valid values: ${VALID_SEVERITIES.join(', ')}`
        });
      }
    }

    // 2) Counts query — always unfiltered
    const countsResult = await db.query(
      'SELECT severity, COUNT(*)::int AS count FROM findings WHERE scan_id = $1 GROUP BY severity',
      [scanId]
    );

    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    let totalCount = 0;
    for (const row of countsResult.rows) {
      if (VALID_SEVERITIES.includes(row.severity)) {
        severityCounts[row.severity] = row.count;
      }
      totalCount += row.count;
    }

    // 3) Findings query with optional filters
    const conditions = ['scan_id = $1'];
    const params = [scanId];
    let paramIdx = 2;

    if (severityFilter) {
      conditions.push(`severity = ANY($${paramIdx})`);
      params.push(severityFilter);
      paramIdx++;
    }

    if (pillarFilter) {
      conditions.push(`LOWER(pillar) = ANY($${paramIdx})`);
      params.push(pillarFilter);
      paramIdx++;
    }

    const findingsResult = await db.query(`
      SELECT
        id, pillar, subfactor_key, severity, title, description,
        impacted_urls, evidence_data, suggested_pack_type, created_at
      FROM findings
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END ASC,
        pillar ASC,
        id ASC
    `, params);

    // Determine plan-based truncation
    const entitlements = getEntitlements(req.user.plan);
    const hasFindings = entitlements.hasFindings;
    const isTeaser = hasFindings === 'teaser';

    let findings = findingsResult.rows.map(row => ({
      id: row.id,
      pillar: row.pillar,
      subfactor_key: row.subfactor_key,
      severity: row.severity,
      title: row.title,
      description: row.description,
      impacted_urls: row.impacted_urls || [],
      impacted_url_count: Array.isArray(row.impacted_urls) ? row.impacted_urls.length : 0,
      evidence_data: row.evidence_data,
      suggested_pack_type: row.suggested_pack_type,
      created_at: row.created_at
    }));

    // Apply plan-based truncation last
    const planLimited = isTeaser && findings.length > FREE_PLAN_FINDINGS_LIMIT;
    if (isTeaser) {
      findings = findings.slice(0, FREE_PLAN_FINDINGS_LIMIT);
    }

    res.json({
      findings,
      total_count: totalCount,
      severity_counts: severityCounts,
      plan_limited: planLimited
    });
  } catch (error) {
    console.error(`[Findings] Error fetching findings for scan ${req.params.scanId}:`, error.message);
    res.status(500).json({ error: 'Failed to fetch findings' });
  }
});

module.exports = router;
