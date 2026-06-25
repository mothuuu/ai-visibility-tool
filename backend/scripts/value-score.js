#!/usr/bin/env node
/**
 * Manual value-scoring / backfill CLI (Layer 2).
 *
 * Scores the per-prompt business `value` for a single user. Optionally sets the
 * two grounding business inputs first (backfill / testing), then runs the scorer.
 *
 *   npm run value:score -- --user 174
 *   npm run value:score -- --user 174 --deal-size 50k_250k --sales-model enterprise
 *   node scripts/value-score.js --user 174 --deal-size 50k_250k --sales-model enterprise
 *
 * Strictly additive (writes only the tracked_prompts `value` property), idempotent,
 * and plan-gated exactly like the live trigger. Setting the inputs uses the same
 * CHECK-constrained columns the intake save path writes.
 */

const db = require('../db/database');
const { scorePromptValues } = require('../services/draftGeneration/valueScoring');

const DEAL_SIZE_BANDS = new Set(['under_1k', '1k_10k', '10k_50k', '50k_250k', 'over_250k']);
const SALES_MODELS = new Set(['self_serve', 'smb', 'mid_market', 'enterprise']);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => argv[++i];
    if (a === '--user' || a === '-u') args.user = take();
    else if (a.startsWith('--user=')) args.user = a.slice('--user='.length);
    else if (a === '--deal-size') args.dealSize = take();
    else if (a.startsWith('--deal-size=')) args.dealSize = a.slice('--deal-size='.length);
    else if (a === '--sales-model') args.salesModel = take();
    else if (a.startsWith('--sales-model=')) args.salesModel = a.slice('--sales-model='.length);
  }
  return args;
}

async function setInputs(userId, dealSize, salesModel) {
  if (dealSize && !DEAL_SIZE_BANDS.has(dealSize)) {
    throw new Error(`Invalid --deal-size '${dealSize}'. One of: ${[...DEAL_SIZE_BANDS].join(', ')}`);
  }
  if (salesModel && !SALES_MODELS.has(salesModel)) {
    throw new Error(`Invalid --sales-model '${salesModel}'. One of: ${[...SALES_MODELS].join(', ')}`);
  }
  // COALESCE: only overwrite the columns the caller actually supplied.
  await db.query(
    `UPDATE visibility_profiles
        SET deal_size_band = COALESCE($2, deal_size_band),
            sales_model    = COALESCE($3, sales_model)
      WHERE user_id = $1`,
    [userId, dealSize || null, salesModel || null]
  );
  console.log(`[value:score] set inputs for user ${userId}: deal_size_band=${dealSize || '(unchanged)'} sales_model=${salesModel || '(unchanged)'}`);
}

async function main() {
  const { user, dealSize, salesModel } = parseArgs(process.argv.slice(2));
  const userId = Number.parseInt(user, 10);

  if (!user || Number.isNaN(userId)) {
    console.error('Usage: npm run value:score -- --user <id> [--deal-size <band>] [--sales-model <model>]');
    process.exit(2);
  }

  if (dealSize || salesModel) {
    await setInputs(userId, dealSize, salesModel);
  }

  console.log(`[value:score] Scoring prompt values for user ${userId}...`);
  const result = await scorePromptValues(userId);
  console.log('[value:score] Result:');
  console.log(JSON.stringify(result, null, 2));

  // 0 = scored or a legitimate no-op; 4 = pending (inputs still missing).
  process.exit(result.status === 'pending_inputs' ? 4 : 0);
}

main()
  .catch((err) => {
    console.error('[value:score] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => {
    if (db.pool && typeof db.pool.end === 'function') db.pool.end().catch(() => {});
  });
