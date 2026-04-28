#!/usr/bin/env node

/**
 * backfill-findings.js — One-time script that backfills the `findings` table
 * from historical completed scans.
 *
 * Extraction logic lives in the shared utility backend/utils/findingsExtractor.js
 * (used by both this script and services/findingsService.js — single source of
 * truth, no duplication). This script handles discovery, batched iteration,
 * idempotency, dry-run preview, and per-scan transactions.
 *
 * Usage:
 *   DRY_RUN=true node scripts/backfill-findings.js   # preview, no writes
 *   node scripts/backfill-findings.js                 # live insert
 *
 * Requires DATABASE_URL.
 */

const path = require('path');

// pg and dotenv are installed under backend/node_modules; reuse the backend's
// configured pool so this script works regardless of where node is invoked from.
const db = require(path.join(__dirname, '..', 'backend', 'db', 'database'));
const pool = db.pool;

const { extractFindings } = require(path.join(
  __dirname, '..', 'backend', 'utils', 'findingsExtractor'
));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 50;
const SAMPLE_SIZE = 3;

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseJsonb(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function pickScanData(scan, sourceCols) {
  for (const col of sourceCols) {
    const blob = scan[col];
    if (blob == null) continue;
    const parsed = parseJsonb(blob);
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
      if (!parsed.url && scan.url) parsed.url = scan.url;
      return { col, parsed };
    }
  }
  return null;
}

// Track unknown-pillar warnings emitted by the shared extractor so we can
// report a count in the summary.
let otherPillarCount = 0;
const _origWarn = console.warn;
console.warn = function patchedWarn(...args) {
  if (typeof args[0] === 'string' && args[0].includes("[findingsExtractor] unknown pillar")) {
    otherPillarCount++;
  }
  return _origWarn.apply(this, args);
};

// ---------------------------------------------------------------------------
// PHASE 1 — Discovery
// ---------------------------------------------------------------------------
async function runDiscovery() {
  console.log('='.repeat(70));
  console.log('PHASE 1: DISCOVERY');
  console.log('='.repeat(70));

  // A) distinct statuses
  const statusRes = await pool.query('SELECT DISTINCT status FROM scans ORDER BY status');
  const statuses = statusRes.rows.map(r => r.status);
  console.log('\n[A] Distinct scan statuses:', statuses);

  let completedStatus = null;
  if (statuses.includes('completed')) completedStatus = 'completed';
  else if (statuses.includes('complete')) completedStatus = 'complete';
  else if (statuses.includes('done')) completedStatus = 'done';
  else if (statuses.includes('success')) completedStatus = 'success';

  if (!completedStatus) {
    console.error(`\nERROR: Could not auto-detect a "completed" status from: ${JSON.stringify(statuses)}`);
    process.exit(1);
  }
  console.log(`[A] Using completedStatus = "${completedStatus}"\n`);

  // A.5) Detect which JSONB source columns exist on `scans`
  const colsRes = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name   = 'scans'
        AND column_name IN ('scan_data', 'detailed_analysis')`
  );
  const colsAvail = colsRes.rows.map(r => r.column_name);
  // Order: scan_data first if present, then detailed_analysis
  const presentCols = [];
  if (colsAvail.includes('scan_data')) presentCols.push('scan_data');
  if (colsAvail.includes('detailed_analysis')) presentCols.push('detailed_analysis');
  console.log('[A.5] JSONB source columns present on scans:', presentCols);
  if (presentCols.length === 0) {
    console.error('ERROR: Neither scan_data nor detailed_analysis exist on the scans table. Cannot extract findings.');
    process.exit(1);
  }
  const projection = ['id', 'url', 'total_score', ...presentCols].join(', ');

  // B) sample rows — log actual JSON shape
  const sampleRes = await pool.query(
    `SELECT ${projection}
       FROM scans
      WHERE status = $1
      ORDER BY id ASC
      LIMIT $2`,
    [completedStatus, SAMPLE_SIZE]
  );
  console.log(`[B] Sample of ${sampleRes.rows.length} completed scans (id, ${presentCols.join(', ')}):\n`);
  for (const row of sampleRes.rows) {
    console.log(`  --- scan id=${row.id} ---`);
    for (const col of presentCols) {
      if (row[col] == null) {
        console.log(`    ${col}: NULL`);
        continue;
      }
      const parsed = parseJsonb(row[col]);
      if (parsed && typeof parsed === 'object') {
        console.log(`    ${col} top-level keys:`, Object.keys(parsed));
        if (parsed.scores)            console.log(`    ${col}.scores:`, JSON.stringify(parsed.scores));
        if (parsed.metrics)           console.log(`    ${col}.metrics keys:`, Object.keys(parsed.metrics));
        if (parsed.categoryBreakdown) console.log(`    ${col}.categoryBreakdown:`, JSON.stringify(parsed.categoryBreakdown));
        if (parsed.scanEvidence)      console.log(`    ${col}.scanEvidence keys:`, Object.keys(parsed.scanEvidence));
      }
      const preview = JSON.stringify(parsed).slice(0, 600);
      console.log(`    ${col} preview: ${preview}${preview.length >= 600 ? '…' : ''}`);
    }
    console.log();
  }

  const countRes = await pool.query(
    'SELECT count(*)::int AS total FROM scans WHERE status = $1',
    [completedStatus]
  );
  const totalScans = countRes.rows[0].total;
  console.log(`[Discovery] Total scans with status="${completedStatus}": ${totalScans}\n`);

  return { completedStatus, totalScans, presentCols };
}

// ---------------------------------------------------------------------------
// PHASE 2 — Backfill
// ---------------------------------------------------------------------------
async function runBackfill(completedStatus, totalScans, presentCols) {
  console.log('='.repeat(70));
  console.log(`PHASE 2: BACKFILL  ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE)'}`);
  console.log('='.repeat(70));

  const projection = ['id', 'url', 'total_score', ...presentCols].join(', ');
  let lastId = 0;
  let scansSeen = 0;
  let scansProcessed = 0;
  let scansSkipped = 0;
  let findingsCreated = 0;
  let errors = 0;
  const findingsPerScan = [];

  while (true) {
    const batchRes = await pool.query(
      `SELECT ${projection}
         FROM scans
        WHERE status = $1
          AND id > $2
        ORDER BY id ASC
        LIMIT $3`,
      [completedStatus, lastId, BATCH_SIZE]
    );
    if (batchRes.rows.length === 0) break;

    for (const scan of batchRes.rows) {
      lastId = scan.id;
      scansSeen++;

      // Idempotency
      const existsRes = await pool.query(
        'SELECT 1 FROM findings WHERE scan_id = $1 LIMIT 1',
        [scan.id]
      );
      if (existsRes.rows.length > 0) {
        console.log(`Skipping scan ${scan.id} (already backfilled)`);
        scansSkipped++;
        continue;
      }

      const picked = pickScanData(scan, presentCols);
      if (!picked) {
        console.log(`Processing scan ${scansSeen} of ${totalScans} (id=${scan.id}) — 0 findings (no scan data)`);
        findingsPerScan.push(0);
        scansProcessed++;
        continue;
      }

      let findings;
      try {
        findings = extractFindings({
          scanId: scan.id,
          scanData: picked.parsed,
          scanScore: typeof scan.total_score === 'number' ? scan.total_score : null
        });
      } catch (err) {
        errors++;
        console.error(`  ERROR extracting scan ${scan.id}: ${err.message}`);
        continue;
      }

      console.log(`Processing scan ${scansSeen} of ${totalScans} (id=${scan.id}) — ${DRY_RUN ? 'would create' : 'created'} ${findings.length} findings (source=${picked.col})`);
      findingsPerScan.push(findings.length);

      if (findings.length === 0) {
        scansProcessed++;
        continue;
      }

      if (DRY_RUN) {
        for (const f of findings) {
          console.log(`    [DRY] ${f.severity.toUpperCase().padEnd(8)} ${f.pillar.padEnd(13)} ${f.subfactor_key.padEnd(32)} ${f.title}`);
        }
        scansProcessed++;
        continue;
      }

      // Per-scan transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
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
        await client.query('COMMIT');
        findingsCreated += findings.length;
        scansProcessed++;
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        errors++;
        console.error(`  ERROR inserting findings for scan ${scan.id}: ${txErr.message}`);
      } finally {
        client.release();
      }
    }
  }

  // Summary
  const total = findingsPerScan.reduce((a, b) => a + b, 0);
  const min = findingsPerScan.length ? Math.min(...findingsPerScan) : 0;
  const max = findingsPerScan.length ? Math.max(...findingsPerScan) : 0;
  const avg = findingsPerScan.length ? (total / findingsPerScan.length).toFixed(1) : '0.0';

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Mode:                     ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Scans seen:               ${scansSeen}`);
  console.log(`  Scans processed:          ${scansProcessed}`);
  console.log(`  Scans skipped (existing): ${scansSkipped}`);
  console.log(`  Findings ${DRY_RUN ? 'previewed' : 'created '}:        ${DRY_RUN ? total : findingsCreated}`);
  console.log(`  Errors:                   ${errors}`);
  console.log(`  'other' pillar mappings:  ${otherPillarCount}`);
  if (findingsPerScan.length) {
    console.log(`  Findings per scan:        min=${min}  max=${max}  avg=${avg}`);
  }
  console.log('='.repeat(70));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nbackfill-findings.js ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'}\n`);
  try {
    const { completedStatus, totalScans, presentCols } = await runDiscovery();
    if (totalScans === 0) {
      console.log('No completed scans to process. Exiting.');
      return;
    }
    await runBackfill(completedStatus, totalScans, presentCols);
  } catch (err) {
    console.error('FATAL:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
