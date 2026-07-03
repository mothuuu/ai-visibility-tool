#!/usr/bin/env node
/**
 * Prompt Demand score (Layer 5) CLI.
 *
 * Market-wide relative demand per prompt via ONE low-temperature Claude batch
 * call; fills the reserved `volume` slot on tracked_prompts. Strictly additive,
 * idempotent, plan-gated. Requires ANTHROPIC_API_KEY for a real run.
 *
 * Run Demand BEFORE impact:score so the rollup picks up demand_factor.
 *
 *   npm run demand:score -- --user 174
 *   node scripts/demand-score.js --user 174
 */

const db = require('../db/database');
const { scoreDemand } = require('../services/draftGeneration/demandScoring');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user' || a === '-u') args.user = argv[++i];
    else if (a.startsWith('--user=')) args.user = a.slice('--user='.length);
  }
  return args;
}

async function main() {
  const { user } = parseArgs(process.argv.slice(2));
  const userId = Number.parseInt(user, 10);
  if (!user || Number.isNaN(userId)) {
    console.error('Usage: npm run demand:score -- --user <id>');
    process.exit(2);
  }

  console.log(`[demand:score] Scoring market demand for user ${userId}...`);
  const result = await scoreDemand(userId);
  console.log('[demand:score] Result:');
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'llm_failed' ? 4 : 0);
}

main()
  .catch((err) => { console.error('[demand:score] Fatal error:', err); process.exit(1); })
  .finally(() => { if (db.pool && typeof db.pool.end === 'function') db.pool.end().catch(() => {}); });
