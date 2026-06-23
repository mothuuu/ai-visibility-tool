#!/usr/bin/env node
/**
 * Manual Opportunity-evidence / backfill CLI.
 *
 * Runs the Perplexity citation-evidence pass for a single user's HIGH-VALUE
 * prompts (value.band >= threshold) and prints the result. Strictly additive
 * (writes only the tracked_prompts `opportunity_evidence` property), idempotent,
 * facts-only, plan-gated exactly like the live trigger.
 *
 * Prereq: the Value pass must have populated bands first (run value:score).
 * Requires PERPLEXITY_API_KEY to be set for real calls.
 *
 *   npm run opportunity:evidence -- --user 174
 *   node scripts/opportunity-evidence.js --user 174
 */

const db = require('../db/database');
const { gatherOpportunityEvidence } = require('../services/draftGeneration/opportunityEvidence');

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
    console.error('Usage: npm run opportunity:evidence -- --user <id>');
    process.exit(2);
  }

  console.log(`[opportunity:evidence] Gathering Perplexity evidence for user ${userId}...`);
  const result = await gatherOpportunityEvidence(userId);
  console.log('[opportunity:evidence] Result:');
  console.log(JSON.stringify(result, null, 2));

  // 0 = gathered or a legitimate no-op; 4 = all Perplexity calls failed.
  process.exit(result.status === 'all_failed' ? 4 : 0);
}

main()
  .catch((err) => {
    console.error('[opportunity:evidence] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => {
    if (db.pool && typeof db.pool.end === 'function') db.pool.end().catch(() => {});
  });
