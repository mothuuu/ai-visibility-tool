/**
 * findingsService.js — Generates findings rows for a completed scan.
 *
 * Called from the scan completion pipeline (POST /api/scan/analyze) once the
 * scan row's status has been set to 'completed' and final scores +
 * detailed_analysis have been persisted.
 *
 * Single transaction with SELECT ... FOR UPDATE row lock so concurrent
 * workers can't generate duplicate findings. In-transaction idempotency
 * check using the same lock. Errors are logged and swallowed so findings
 * generation never fails scan completion.
 */

const db = require('../db/database');
const { extractFindings } = require('../utils/findingsExtractor');

// ---------------------------------------------------------------------------
// Source-column detection. The scans table may or may not have a `scan_data`
// column depending on whether migrate-scans-columns has run. `detailed_analysis`
// is always present. Detect once on first call and cache.
// ---------------------------------------------------------------------------
let scanSourceColsPromise = null;
async function getScanSourceColumns() {
  if (!scanSourceColsPromise) {
    scanSourceColsPromise = (async () => {
      const res = await db.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name   = 'scans'
            AND column_name IN ('scan_data', 'detailed_analysis')`
      );
      const cols = res.rows.map(r => r.column_name);
      // Always include detailed_analysis in the list if present; keep
      // scan_data first so legacy data wins when both populated.
      const ordered = [];
      if (cols.includes('scan_data')) ordered.push('scan_data');
      if (cols.includes('detailed_analysis')) ordered.push('detailed_analysis');
      return ordered;
    })().catch(err => {
      // Don't cache failures
      scanSourceColsPromise = null;
      throw err;
    });
  }
  return scanSourceColsPromise;
}

function pickScanData(scan, sourceCols) {
  for (const col of sourceCols) {
    const blob = scan[col];
    if (blob == null) continue;
    const parsed = (typeof blob === 'string') ? safeParse(blob) : blob;
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
      // Inject url onto blob if missing so the extractor can attach impacted_urls
      if (!parsed.url && scan.url) parsed.url = scan.url;
      return parsed;
    }
  }
  return null;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Generate and persist findings for a completed scan.
 *
 * Never throws — errors are logged and swallowed so scan completion succeeds
 * even if findings generation fails.
 *
 * @param {number} scanId
 */
async function generateFindings(scanId) {
  let client;
  try {
    const sourceCols = await getScanSourceColumns();
    if (sourceCols.length === 0) {
      console.warn(`[Findings] scans table has no scan_data or detailed_analysis column; skipping scan ${scanId}`);
      return;
    }
    const projection = ['id', 'url', 'total_score', ...sourceCols].join(', ');

    client = await db.getClient();
    await client.query('BEGIN');

    // 1) Lock the scan row so concurrent workers serialise here.
    const scanRes = await client.query(
      `SELECT ${projection} FROM scans WHERE id = $1 FOR UPDATE`,
      [scanId]
    );
    if (scanRes.rows.length === 0) {
      console.warn(`[Findings] Scan ${scanId} not found; skipping findings generation`);
      await client.query('ROLLBACK');
      return;
    }
    const scan = scanRes.rows[0];

    // 2) In-transaction idempotency check (after the lock, before extraction).
    const existsRes = await client.query(
      'SELECT 1 FROM findings WHERE scan_id = $1 LIMIT 1',
      [scanId]
    );
    if (existsRes.rows.length > 0) {
      console.log(`[Findings] Findings already exist for scan ${scanId}; skipping`);
      await client.query('ROLLBACK');
      return;
    }

    // Resolve the JSONB blob to extract from.
    const scanData = pickScanData(scan, sourceCols);
    if (!scanData) {
      console.warn(`[Findings] No scan data for scan ${scanId}; skipping findings generation`);
      await client.query('ROLLBACK');
      return;
    }

    // 3) Extract findings.
    const findings = extractFindings({
      scanId: scan.id,
      scanData,
      scanScore: typeof scan.total_score === 'number' ? scan.total_score : null
    });

    if (findings.length === 0) {
      console.log(`[Findings] Scan ${scanId}: no findings extracted (scan looks healthy)`);
      await client.query('COMMIT');
      return;
    }

    // 4) Insert all findings on the same client so the row lock + inserts are atomic.
    for (const f of findings) {
      await client.query(
        `INSERT INTO findings
           (scan_id, pillar, subfactor_key, severity, title, description,
            impacted_urls, evidence_data, suggested_pack_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          f.scan_id,
          f.pillar,
          f.subfactor_key,
          f.severity,
          f.title,
          f.description,
          JSON.stringify(f.impacted_urls || []),
          JSON.stringify(f.evidence_data || {}),
          f.suggested_pack_type
        ]
      );
    }

    // 5) Commit.
    await client.query('COMMIT');
    console.log(`[Findings] Generated ${findings.length} findings for scan ${scanId}`);
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    }
    console.error(`[Findings] Error generating findings for scan ${scanId}:`, err && err.stack ? err.stack : err);
    // Never propagate — scan completion must not fail because of findings.
  } finally {
    if (client) client.release();
  }
}

module.exports = { generateFindings };
