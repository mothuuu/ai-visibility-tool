#!/usr/bin/env node
/**
 * Visibility Impact score (Layer 4 rollup) CLI.
 *
 * Pure computation over stored value.band × opportunity.band — NO API calls.
 * Writes a per-prompt `impact` {score,band,...} on tracked_prompts. Strictly
 * additive, idempotent, plan-gated.
 *
 *   npm run impact:score -- --user 174
 *   node scripts/impact-score.js --user 174
 */

const db = require('../db/database');
const { scoreImpact } = require('../services/draftGeneration/impactScoring');

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
    console.error('Usage: npm run impact:score -- --user <id>');
    process.exit(2);
  }

  console.log(`[impact:score] Rolling up impact for user ${userId} (no API calls)...`);
  const result = await scoreImpact(userId);
  console.log('[impact:score] Result:');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main()
  .catch((err) => { console.error('[impact:score] Fatal error:', err); process.exit(1); })
  .finally(() => { if (db.pool && typeof db.pool.end === 'function') db.pool.end().catch(() => {}); });
