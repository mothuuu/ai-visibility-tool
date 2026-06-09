#!/usr/bin/env node
/**
 * Manual draft-generation CLI (Step 3).
 *
 * Generates the one-time visibility_profiles draft for a single user from their
 * existing completed scan. Use this to seed current paid users and to test.
 *
 *   npm run draft:generate -- --user <id>
 *   node scripts/draft-generate.js --user 42
 *
 * Honours every rule in DraftGenerationService: plan-gated, idempotent (won't
 * overwrite an existing draft), and never triggers a scan.
 */

const { generateDraft } = require('../services/draftGenerationService');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user' || a === '-u') {
      args.user = argv[++i];
    } else if (a.startsWith('--user=')) {
      args.user = a.slice('--user='.length);
    }
  }
  return args;
}

async function main() {
  const { user } = parseArgs(process.argv.slice(2));
  const userId = Number.parseInt(user, 10);

  if (!user || Number.isNaN(userId)) {
    console.error('Usage: npm run draft:generate -- --user <id>');
    process.exit(2);
  }

  console.log(`[draft:generate] Generating draft for user ${userId}...`);
  const result = await generateDraft(userId);
  console.log('[draft:generate] Result:');
  console.log(JSON.stringify(result, null, 2));

  // Exit code reflects outcome so it's scriptable.
  // 0 = generated or a legitimate no-op (disabled/already); 3 = no_scan.
  process.exit(result.status === 'no_scan' ? 3 : 0);
}

main().catch((err) => {
  console.error('[draft:generate] Fatal error:', err);
  process.exit(1);
});
