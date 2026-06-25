#!/usr/bin/env node
/**
 * Visibility Opportunity (Winnability) score CLI.
 *
 * Pure computation over stored opportunity_evidence — NO Perplexity/API calls.
 * Writes a per-prompt `opportunity` {score,band,...} on tracked_prompts.
 * Strictly additive, idempotent, plan-gated.
 *
 *   npm run opportunity:score -- --user 174
 *   node scripts/opportunity-score.js --user 174
 */

const db = require('../db/database');
const { scoreOpportunity } = require('../services/draftGeneration/opportunityScoring');

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
    console.error('Usage: npm run opportunity:score -- --user <id>');
    process.exit(2);
  }

  console.log(`[opportunity:score] Scoring winnability for user ${userId} (no API calls)...`);
  const result = await scoreOpportunity(userId);
  console.log('[opportunity:score] Result:');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main()
  .catch((err) => { console.error('[opportunity:score] Fatal error:', err); process.exit(1); })
  .finally(() => { if (db.pool && typeof db.pool.end === 'function') db.pool.end().catch(() => {}); });
