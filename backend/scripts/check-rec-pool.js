#!/usr/bin/env node
/**
 * Pool Verification Script — Phase 4A.3c.5
 *
 * Prints recommendation counts per scan for the 10 most recent scans.
 * Helps determine whether the DB stores a pool larger than the plan cap,
 * which is required for the refill-after-resolution logic to work.
 *
 * Usage:
 *   node backend/scripts/check-rec-pool.js
 *
 * Expected output:
 *   If pool > cap (15–30 recs per scan): refill works from DB pool.
 *   If pool == cap (3/5/8 recs per scan): persistence must be raised.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('../db/database');

async function checkRecPool() {
  console.log('=== Recommendation Pool Verification ===\n');

  try {
    const result = await db.query(`
      SELECT
        sr.scan_id,
        s.created_at,
        COUNT(*) AS rec_count,
        COUNT(*) FILTER (WHERE sr.unlock_state = 'active') AS active_count,
        COUNT(*) FILTER (WHERE sr.unlock_state = 'locked') AS locked_count,
        COUNT(*) FILTER (WHERE sr.status = 'implemented') AS implemented_count
      FROM scan_recommendations sr
      JOIN scans s ON s.id = sr.scan_id
      WHERE sr.scan_id IN (
        SELECT id FROM scans ORDER BY created_at DESC LIMIT 10
      )
      GROUP BY sr.scan_id, s.created_at
      ORDER BY s.created_at DESC
    `);

    if (result.rows.length === 0) {
      console.log('No scans found in database.');
      process.exit(0);
    }

    console.log('scan_id                              | created_at           | recs | active | locked | implemented');
    console.log('-------------------------------------|----------------------|------|--------|--------|------------');

    let totalRecs = 0;
    let scanCount = 0;
    for (const row of result.rows) {
      const created = new Date(row.created_at).toISOString().slice(0, 19);
      console.log(
        `${row.scan_id.padEnd(36)} | ${created.padEnd(20)} | ${String(row.rec_count).padStart(4)} | ${String(row.active_count).padStart(6)} | ${String(row.locked_count).padStart(6)} | ${String(row.implemented_count).padStart(11)}`
      );
      totalRecs += parseInt(row.rec_count, 10);
      scanCount++;
    }

    const avgPool = (totalRecs / scanCount).toFixed(1);
    console.log(`\nAverage pool size: ${avgPool} recs/scan (across ${scanCount} scans)`);

    if (parseFloat(avgPool) > 10) {
      console.log('\n✅ Case A: Pool > cap. GET-time refill can pull from DB pool.');
    } else if (parseFloat(avgPool) <= 8) {
      console.log('\n❗ Case B: Pool ≈ cap. Persistence must be raised to store more recs.');
      console.log('   Action: Set PERSIST_POOL_LIMIT = 25 in hybrid-recommendation-helper.js');
    } else {
      console.log('\n⚠️  Borderline pool size. Review individual scan counts above.');
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      console.log('⚠️  Cannot connect to database (connection refused).');
      console.log('   This script requires a running PostgreSQL instance with DATABASE_URL configured.');
      console.log('   Run this script in a deployed environment to verify pool sizes.');
    } else {
      console.error('Error:', err.message);
    }
  } finally {
    await db.pool.end().catch(() => {});
  }
}

checkRecPool();
