#!/usr/bin/env node

/**
 * backfill-findings.js — One-time script to backfill the findings table
 * from historical completed scans.
 *
 * Usage:
 *   DRY_RUN=true node scripts/backfill-findings.js   # preview only
 *   node scripts/backfill-findings.js                 # live insert
 *
 * Requires DATABASE_URL env var (or defaults to local socket connection).
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'backend', 'db', 'database'));
const pool = db.pool;
const { extractFindings } = require(path.join(__dirname, '..', 'backend', 'utils', 'findingsExtractor'));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// PHASE 1 — Discovery
// ---------------------------------------------------------------------------
async function runDiscovery() {
  console.log('='.repeat(70));
  console.log('PHASE 1: DISCOVERY');
  console.log('='.repeat(70));

  // A) Distinct statuses
  const statusRes = await pool.query('SELECT DISTINCT status FROM scans ORDER BY status');
  const statuses = statusRes.rows.map(r => r.status);
  console.log('\n[Discovery A] Distinct scan statuses:', statuses);

  const completedStatus = statuses.includes('completed') ? 'completed' : null;
  if (!completedStatus) {
    console.error('ERROR: No "completed" status found. Available:', statuses);
    process.exit(1);
  }
  console.log(`[Discovery A] Using status = "${completedStatus}" for backfill\n`);

  // B) Sample 3 scans — log data shape
  const sampleRes = await pool.query(
    `SELECT id, url, total_score, detailed_analysis, scan_data
     FROM scans WHERE status = $1 ORDER BY id ASC LIMIT 3`,
    [completedStatus]
  );

  console.log(`[Discovery B] Sample scans (${sampleRes.rows.length} rows):\n`);
  for (const row of sampleRes.rows) {
    const da = row.detailed_analysis;
    const sd = row.scan_data;
    const source = da ? 'detailed_analysis' : sd ? 'scan_data' : 'NONE';

    console.log(`  Scan id=${row.id}  url=${row.url}  source=${source}`);

    if (da) {
      const parsed = typeof da === 'string' ? JSON.parse(da) : da;
      console.log('    Top-level keys:', Object.keys(parsed));
      if (parsed.categoryBreakdown) {
        console.log('    categoryBreakdown:', JSON.stringify(parsed.categoryBreakdown));
      }
      if (parsed.scanEvidence) {
        console.log('    scanEvidence keys:', Object.keys(parsed.scanEvidence));
        if (parsed.scanEvidence.technical) {
          console.log('    scanEvidence.technical keys:', Object.keys(parsed.scanEvidence.technical));
        }
      }
    } else if (sd) {
      const parsed = typeof sd === 'string' ? JSON.parse(sd) : sd;
      console.log('    Top-level keys:', Object.keys(parsed));
      if (parsed.scores) console.log('    scores:', JSON.stringify(parsed.scores));
      if (parsed.metrics) console.log('    metrics keys:', Object.keys(parsed.metrics));
    }
    console.log();
  }

  // Count total completed
  const countRes = await pool.query(
    'SELECT count(*)::int AS total FROM scans WHERE status = $1',
    [completedStatus]
  );
  console.log(`[Discovery] Total completed scans to process: ${countRes.rows[0].total}\n`);

  return { completedStatus, totalScans: countRes.rows[0].total };
}

// ---------------------------------------------------------------------------
// PHASE 2 — Backfill execution
// ---------------------------------------------------------------------------
async function runBackfill(completedStatus, totalScans) {
  console.log('='.repeat(70));
  console.log(`PHASE 2: BACKFILL  ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE)'}`);
  console.log('='.repeat(70));

  let lastId = 0;
  let scansProcessed = 0;
  let scansSkipped = 0;
  let findingsCreated = 0;
  let errors = 0;
  const findingsDistribution = [];

  while (true) {
    const batchRes = await pool.query(
      `SELECT id, url, total_score, detailed_analysis, scan_data
       FROM scans
       WHERE status = $1 AND id > $2
       ORDER BY id ASC
       LIMIT $3`,
      [completedStatus, lastId, BATCH_SIZE]
    );

    if (batchRes.rows.length === 0) break;

    for (const scan of batchRes.rows) {
      lastId = scan.id;

      // Idempotency check
      const existsRes = await pool.query(
        'SELECT 1 FROM findings WHERE scan_id = $1 LIMIT 1',
        [scan.id]
      );
      if (existsRes.rows.length > 0) {
        console.log(`  Skipping scan ${scan.id} (already backfilled)`);
        scansSkipped++;
        continue;
      }

      try {
        const findings = extractFindings({
          scanId: scan.id,
          url: scan.url,
          detailedAnalysis: scan.detailed_analysis,
          scanData: scan.scan_data
        });
        scansProcessed++;

        if (findings.length === 0) {
          console.log(`  Processing scan ${scansProcessed} of ${totalScans} (id=${scan.id}) — 0 findings (no extractable data)`);
          findingsDistribution.push(0);
          continue;
        }

        console.log(`  Processing scan ${scansProcessed} of ${totalScans} (id=${scan.id}) — created ${findings.length} findings`);
        findingsDistribution.push(findings.length);

        if (DRY_RUN) {
          for (const f of findings) {
            console.log(`    [DRY] ${f.severity.toUpperCase().padEnd(8)} ${f.pillar.padEnd(14)} ${f.subfactor_key.padEnd(30)} ${f.title}`);
          }
        } else {
          // Transaction per scan
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
                  f.scan_id, f.pillar, f.subfactor_key, f.severity,
                  f.title, f.description,
                  JSON.stringify(f.impacted_urls),
                  JSON.stringify(f.evidence_data),
                  f.suggested_pack_type
                ]
              );
            }
            await client.query('COMMIT');
            findingsCreated += findings.length;
          } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
          } finally {
            client.release();
          }
        }
      } catch (err) {
        errors++;
        console.error(`  ERROR processing scan ${scan.id}:`, err.message);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Mode:             ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Scans processed:  ${scansProcessed}`);
  console.log(`  Scans skipped:    ${scansSkipped}`);
  console.log(`  Findings created: ${DRY_RUN ? `${findingsDistribution.reduce((a, b) => a + b, 0)} (would create)` : findingsCreated}`);
  console.log(`  Errors:           ${errors}`);

  if (findingsDistribution.length > 0) {
    const min = Math.min(...findingsDistribution);
    const max = Math.max(...findingsDistribution);
    const avg = (findingsDistribution.reduce((a, b) => a + b, 0) / findingsDistribution.length).toFixed(1);
    console.log(`  Findings/scan:    min=${min}  max=${max}  avg=${avg}`);
    console.log(`  Distribution:     ${JSON.stringify(findingsDistribution)}`);
  }
  console.log('='.repeat(70));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nbackfill-findings.js  ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'}\n`);

  try {
    const { completedStatus, totalScans } = await runDiscovery();
    if (totalScans === 0) {
      console.log('No completed scans to process. Exiting.');
      return;
    }
    await runBackfill(completedStatus, totalScans);
  } catch (err) {
    console.error('FATAL:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
