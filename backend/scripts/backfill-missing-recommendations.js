/**
 * One-time backfill script for scans missing recommendations
 *
 * Usage: node backend/scripts/backfill-missing-recommendations.js
 *
 * Safe to run multiple times — skips scans that already have recs
 */

const { Pool } = require('pg');
const { generateAndPersistRecommendations } = require('../services/recommendation-orchestrator');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function findScansWithoutRecs() {
  const result = await pool.query(`
    SELECT s.id, s.domain, s.user_id, s.created_at
    FROM scans s
    LEFT JOIN scan_recommendations sr ON s.id = sr.scan_id
    WHERE s.status = 'completed'
      AND s.domain IS NOT NULL
      AND s.domain != ''
    GROUP BY s.id
    HAVING COUNT(sr.id) = 0
    ORDER BY s.id DESC
    LIMIT 100
  `);
  return result.rows;
}

async function backfillScan(scan) {
  console.log(`\n[Backfill] Processing scan ${scan.id} (${scan.domain})...`);

  try {
    const result = await generateAndPersistRecommendations(scan.id);

    if (result.success) {
      console.log(`  ✓ Generated ${result.recommendations_count || result.insertedCount || 0} recommendations`);
      return { scanId: scan.id, success: true, count: result.recommendations_count || result.insertedCount || 0 };
    } else {
      console.log(`  ✗ Failed: ${result.error || 'Unknown error'}`);
      return { scanId: scan.id, success: false, error: result.error };
    }
  } catch (error) {
    console.error(`  ✗ Error: ${error.message}`);
    return { scanId: scan.id, success: false, error: error.message };
  }
}

async function main() {
  console.log('=== Backfill Missing Recommendations ===\n');

  try {
    // Find scans without recommendations
    const scans = await findScansWithoutRecs();
    console.log(`Found ${scans.length} scans without recommendations\n`);

    if (scans.length === 0) {
      console.log('Nothing to backfill. All scans have recommendations.');
      process.exit(0);
    }

    // Process each scan sequentially
    const results = [];
    for (const scan of scans) {
      const result = await backfillScan(scan);
      results.push(result);

      // Small delay to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Summary
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log('\n=== Backfill Complete ===');
    console.log(`Total processed: ${results.length}`);
    console.log(`Successful: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);

    if (failed.length > 0) {
      console.log('\nFailed scans:');
      failed.forEach(f => console.log(`  - Scan ${f.scanId}: ${f.error}`));
    }

    process.exit(failed.length > 0 ? 1 : 0);

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
