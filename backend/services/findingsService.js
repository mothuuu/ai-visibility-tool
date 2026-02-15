/**
 * findingsService.js — Generates findings rows for a completed scan.
 *
 * Called from the scan completion pipeline (POST /api/scan/analyze).
 * Uses the shared findingsExtractor for all parsing/scoring/mapping logic.
 */

const db = require('../db/database');
const { extractFindings } = require('../utils/findingsExtractor');

/**
 * Generate and persist findings for a completed scan.
 *
 * - Loads scan data from the database
 * - Idempotent: skips if findings already exist for this scan
 * - Inserts all findings in a single transaction
 * - Never throws: errors are logged but do not propagate
 *
 * @param {number} scanId
 */
async function generateFindings(scanId) {
  // Idempotency: check if findings already exist
  const existsRes = await db.query(
    'SELECT 1 FROM findings WHERE scan_id = $1 LIMIT 1',
    [scanId]
  );
  if (existsRes.rows.length > 0) {
    console.log(`[Findings] Scan ${scanId} already has findings, skipping`);
    return;
  }

  // Load scan data
  const scanRes = await db.query(
    'SELECT id, url, detailed_analysis, scan_data FROM scans WHERE id = $1',
    [scanId]
  );
  if (scanRes.rows.length === 0) {
    console.error(`[Findings] Scan ${scanId} not found`);
    return;
  }

  const scan = scanRes.rows[0];
  const findings = extractFindings({
    scanId: scan.id,
    url: scan.url,
    detailedAnalysis: scan.detailed_analysis,
    scanData: scan.scan_data
  });

  if (findings.length === 0) {
    console.log(`[Findings] Scan ${scanId}: no findings extracted`);
    return;
  }

  // Insert all findings in a single transaction
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    for (const f of findings) {
      await client.query(
        `INSERT INTO findings
           (scan_id, pillar, subfactor_key, severity, title, description,
            impacted_urls, evidence_data, suggested_pack_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          f.scan_id, f.pillar, f.subfactor_key, f.severity,
          f.title, f.description,
          JSON.stringify(f.impacted_urls),
          JSON.stringify(f.evidence_data),
          f.suggested_pack_type
        ]
      );
    }
    await client.query('COMMIT');
    console.log(`[Findings] Generated ${findings.length} findings for scan ${scanId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { generateFindings };
