#!/usr/bin/env node
/**
 * Phase 4A.2: Backfill recommendations for existing completed scans
 *
 * Usage:
 *   RECOMMENDATIONS_PIPELINE_V1=1 node scripts/backfill_recommendations.js
 *   RECOMMENDATIONS_PIPELINE_V1=1 node scripts/backfill_recommendations.js --limit 50
 *   RECOMMENDATIONS_PIPELINE_V1=1 node scripts/backfill_recommendations.js --limit 100 --batch 10
 *
 * Options:
 *   --limit N    Maximum number of scans to process (default: 100)
 *   --batch N    Batch size for processing (default: 25)
 *   --dry-run    Only list candidates without processing
 *
 * Environment:
 *   RECOMMENDATIONS_PIPELINE_V1=1   Required to run backfill
 */

const path = require('path');

// Load database module from backend
const dbPath = path.join(__dirname, '..', 'backend', 'db', 'database');
const db = require(dbPath);

// ========================================
// ARGUMENT PARSING
// ========================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: 100,
    batchSize: 25,
    dryRun: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--batch' && args[i + 1]) {
      options.batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (arg.startsWith('--batch=')) {
      options.batchSize = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Phase 4A.2: Recommendation Backfill Script

Usage:
  RECOMMENDATIONS_PIPELINE_V1=1 node scripts/backfill_recommendations.js [options]

Options:
  --limit N    Maximum scans to process (default: 100)
  --batch N    Batch size (default: 25)
  --dry-run    List candidates only, no processing
  --help       Show this help message

Examples:
  RECOMMENDATIONS_PIPELINE_V1=1 node scripts/backfill_recommendations.js
  RECOMMENDATIONS_PIPELINE_V1=1 node scripts/backfill_recommendations.js --limit 50 --batch 10
  RECOMMENDATIONS_PIPELINE_V1=1 node scripts/backfill_recommendations.js --dry-run
`);
      process.exit(0);
    }
  }

  return options;
}

// ========================================
// MAIN BACKFILL LOGIC
// ========================================

async function main() {
  // Check feature flag
  if (process.env.RECOMMENDATIONS_PIPELINE_V1 !== '1') {
    console.log('❌ RECOMMENDATIONS_PIPELINE_V1 not enabled.');
    console.log('   Set RECOMMENDATIONS_PIPELINE_V1=1 to run backfill.');
    process.exit(0);
  }

  const options = parseArgs();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔄 Phase 4A.2 Recommendation Backfill`);
  console.log(`   Limit: ${options.limit}, Batch size: ${options.batchSize}`);
  if (options.dryRun) {
    console.log(`   Mode: DRY RUN (no changes will be made)`);
  }
  console.log(`${'='.repeat(60)}\n`);

  try {
    // Find candidate scans
    const candidatesResult = await db.query(`
      SELECT id, domain, url, total_score, domain_type, created_at
      FROM scans
      WHERE status = 'completed'
        AND user_id IS NOT NULL
        AND COALESCE(domain_type, '') <> 'competitor'
        AND (recommendations_generated_at IS NULL
             OR recommendations_count = 0
             OR recommendations_count IS NULL)
        AND created_at > NOW() - INTERVAL '90 days'
        AND detailed_analysis IS NOT NULL
      ORDER BY created_at DESC
      LIMIT $1
    `, [options.limit]);

    const candidates = candidatesResult.rows;
    console.log(`📋 Found ${candidates.length} candidate scans\n`);

    if (candidates.length === 0) {
      console.log('✅ No scans need backfill');
      process.exit(0);
    }

    // Dry run: just list candidates
    if (options.dryRun) {
      console.log('Candidate scans:\n');
      for (const scan of candidates) {
        const displayUrl = scan.domain || String(scan.url || '').substring(0, 50);
        console.log(`  [${scan.id}] ${displayUrl} (score: ${scan.total_score}, ${scan.created_at})`);
      }
      console.log('\n✅ Dry run complete. No changes made.');
      process.exit(0);
    }

    // Load orchestrator
    const orchestratorPath = path.join(__dirname, '..', 'backend', 'services', 'recommendation-orchestrator');
    const { generateAndPersistRecommendations } = require(orchestratorPath);

    // Stats tracking
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let totalRecs = 0;

    const totalBatches = Math.ceil(candidates.length / options.batchSize);

    // Process in batches
    for (let i = 0; i < candidates.length; i += options.batchSize) {
      const batch = candidates.slice(i, i + options.batchSize);
      const batchNum = Math.floor(i / options.batchSize) + 1;

      console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} scans)`);
      console.log(`${'─'.repeat(40)}`);

      for (const scan of batch) {
        const displayUrl = scan.domain || String(scan.url || '').substring(0, 40);
        process.stdout.write(`   [${scan.id}] ${displayUrl}... `);

        try {
          const result = await generateAndPersistRecommendations(scan.id);

          if (result.success) {
            console.log(`✅ ${result.recommendations_count} recs`);
            succeeded++;
            totalRecs += (result.recommendations_count || 0);
          } else {
            console.log(`⚠️  ${result.error}`);
            failed++;
          }
        } catch (err) {
          console.log(`❌ ${err.message}`);
          failed++;
        }

        processed++;
      }

      // Throttle between batches
      if (i + options.batchSize < candidates.length) {
        process.stdout.write(`   ⏳ Waiting 500ms before next batch...`);
        await new Promise(r => setTimeout(r, 500));
        console.log(' done');
      }
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Backfill Complete`);
    console.log(`${'='.repeat(60)}`);
    console.log(`   Processed:     ${processed}`);
    console.log(`   Succeeded:     ${succeeded}`);
    console.log(`   Failed:        ${failed}`);
    console.log(`   Total Recs:    ${totalRecs}`);
    console.log(`   Avg Recs/Scan: ${succeeded > 0 ? (totalRecs / succeeded).toFixed(1) : 0}`);
    console.log(`${'='.repeat(60)}\n`);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run main
main();
