#!/usr/bin/env node
/**
 * Phase 4 Go/No-Go Checklist
 *
 * A 5-minute pre-flight check before starting Phase 4 work.
 * READ-ONLY by default. Safe for production.
 *
 * Usage:
 *   node backend/scripts/phase4-go-no-go.js
 *   node backend/scripts/phase4-go-no-go.js --org-id 110
 *   node backend/scripts/phase4-go-no-go.js --org-id 110 --verbose
 *   API_BASE=https://your-app.onrender.com node backend/scripts/phase4-go-no-go.js
 *
 * Exit codes:
 *   0 = GO (all checks pass)
 *   1 = NO-GO (one or more checks failed)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const https = require('https');
const http = require('http');

// =============================================================================
// CLI ARGUMENT PARSING
// =============================================================================

const args = process.argv.slice(2);
const flags = {
  orgId: 110, // default
  verbose: args.includes('--verbose') || args.includes('-v'),
  skipApi: args.includes('--skip-api'),
  skipStripe: args.includes('--skip-stripe'),
  skipQuota: args.includes('--skip-quota')
};

// Parse --org-id N
const orgIdIdx = args.indexOf('--org-id');
if (orgIdIdx !== -1 && args[orgIdIdx + 1]) {
  flags.orgId = parseInt(args[orgIdIdx + 1], 10);
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const DATABASE_URL = process.env.DATABASE_URL;
const API_BASE = process.env.API_BASE;
const SCRIPTS_DIR = __dirname;

// Checklist results
const results = {
  environment: { status: 'pending', details: [] },
  migrations: { status: 'pending', details: [] },
  quota: { status: 'pending', details: [] },
  stripe: { status: 'pending', details: [] },
  database: { status: 'pending', details: [] },
  api: { status: 'pending', details: [] }
};

let hasFailure = false;

// =============================================================================
// HELPERS
// =============================================================================

function log(msg) {
  console.log(msg);
}

function logVerbose(msg) {
  if (flags.verbose) {
    console.log(`  ${msg}`);
  }
}

function pass(category, msg) {
  results[category].status = 'pass';
  results[category].details.push(`✅ ${msg}`);
  log(`  ✅ ${msg}`);
}

function warn(category, msg) {
  if (results[category].status !== 'fail') {
    results[category].status = 'warn';
  }
  results[category].details.push(`⚠️  ${msg}`);
  log(`  ⚠️  ${msg}`);
}

function fail(category, msg) {
  results[category].status = 'fail';
  results[category].details.push(`❌ ${msg}`);
  log(`  ❌ ${msg}`);
  hasFailure = true;
}

function skip(category, msg) {
  results[category].status = 'skip';
  results[category].details.push(`⏭️  ${msg}`);
  log(`  ⏭️  ${msg}`);
}

function runSQL(query) {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL not set');
  }
  try {
    const result = execSync(`psql "${DATABASE_URL}" -t -A -c "${query}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim();
  } catch (err) {
    throw new Error(`SQL error: ${err.message}`);
  }
}

function runSQLMultiline(query) {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL not set');
  }
  try {
    const result = execSync(`psql "${DATABASE_URL}" -c "${query}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim();
  } catch (err) {
    throw new Error(`SQL error: ${err.message}`);
  }
}

// =============================================================================
// CHECK 1: ENVIRONMENT SANITY
// =============================================================================

function checkEnvironment() {
  log('\n📋 CHECK 1: Environment Sanity');

  // NODE_ENV
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'production') {
    pass('environment', `NODE_ENV=${nodeEnv}`);
  } else {
    warn('environment', `NODE_ENV=${nodeEnv} (not production)`);
  }

  // DATABASE_URL
  if (DATABASE_URL) {
    const masked = DATABASE_URL.replace(/:[^@]+@/, ':****@');
    pass('environment', `DATABASE_URL is set (${masked.substring(0, 50)}...)`);
  } else {
    fail('environment', 'DATABASE_URL is NOT set');
  }

  // USAGE_V2 flags
  const v2Read = process.env.USAGE_V2_READ_ENABLED;
  const v2DualWrite = process.env.USAGE_V2_DUAL_WRITE_ENABLED;

  if (v2Read === 'true' && v2DualWrite === 'true') {
    pass('environment', `USAGE_V2_READ_ENABLED=${v2Read}, USAGE_V2_DUAL_WRITE_ENABLED=${v2DualWrite} (Phase 4 ready)`);
  } else if (v2Read === 'true') {
    warn('environment', `USAGE_V2_READ_ENABLED=${v2Read}, USAGE_V2_DUAL_WRITE_ENABLED=${v2DualWrite || 'not set'} (dual-write not enabled)`);
  } else {
    warn('environment', `USAGE_V2 flags not fully enabled: READ=${v2Read || 'not set'}, DUAL_WRITE=${v2DualWrite || 'not set'}`);
  }

  // API_BASE (optional)
  if (API_BASE) {
    pass('environment', `API_BASE=${API_BASE}`);
  } else {
    warn('environment', 'API_BASE not set (API checks will be skipped)');
  }
}

// =============================================================================
// CHECK 2: MIGRATION SANITY
// =============================================================================

function checkMigrations() {
  log('\n📋 CHECK 2: Migration Sanity');

  try {
    // Check for schema_migrations table
    const tableExists = runSQL(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'schema_migrations'
      )
    `);

    if (tableExists !== 't') {
      warn('migrations', 'schema_migrations table not found (migrations may not be tracked)');
      return;
    }

    // Check for modified migrations
    const modifiedCount = runSQL(`
      SELECT COUNT(*) FROM schema_migrations
      WHERE checksum IS NOT NULL
        AND rolled_back_at IS NULL
    `);

    pass('migrations', `${modifiedCount} migrations tracked in schema_migrations`);

    // Check for Phase 2 columns on organizations
    const phase2Cols = runSQL(`
      SELECT COUNT(*) FROM information_schema.columns
      WHERE table_name = 'organizations'
        AND column_name IN ('plan_source', 'plan_override', 'stripe_price_id', 'stripe_current_period_start')
    `);

    if (parseInt(phase2Cols) >= 4) {
      pass('migrations', 'Phase 2.1 columns present on organizations table');
    } else {
      fail('migrations', `Phase 2.1 columns missing (found ${phase2Cols}/4)`);
    }

    // Check for usage_events table
    const usageEventsExists = runSQL(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'usage_events'
      )
    `);

    if (usageEventsExists === 't') {
      pass('migrations', 'usage_events table exists');
    } else {
      warn('migrations', 'usage_events table not found (V2 usage tracking may not work)');
    }

  } catch (err) {
    fail('migrations', `Migration check failed: ${err.message}`);
  }
}

// =============================================================================
// CHECK 3: QUOTA SANITY
// =============================================================================

function checkQuota() {
  log('\n📋 CHECK 3: Quota Mode Sanity');

  if (flags.skipQuota) {
    skip('quota', 'Skipped (--skip-quota flag)');
    return;
  }

  const quotaScript = path.join(SCRIPTS_DIR, 'verify_quota_modes.js');

  try {
    const result = spawnSync('node', [quotaScript], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    if (result.status === 0) {
      pass('quota', 'verify_quota_modes.js passed');
      if (flags.verbose && result.stdout) {
        result.stdout.split('\n').forEach(line => logVerbose(line));
      }
    } else {
      fail('quota', 'verify_quota_modes.js failed');
      if (result.stderr) {
        result.stderr.split('\n').slice(0, 5).forEach(line => logVerbose(line));
      }
    }
  } catch (err) {
    fail('quota', `Could not run verify_quota_modes.js: ${err.message}`);
  }
}

// =============================================================================
// CHECK 4: STRIPE STATE SANITY
// =============================================================================

function checkStripe() {
  log('\n📋 CHECK 4: Stripe State Sanity');

  if (flags.skipStripe) {
    skip('stripe', 'Skipped (--skip-stripe flag)');
    return;
  }

  try {
    // Check for inconsistent orgs (non-manual with active but missing IDs)
    const inconsistentOrgs = runSQL(`
      SELECT COUNT(*) FROM organizations
      WHERE stripe_subscription_status IN ('active', 'trialing')
        AND (plan_source IS DISTINCT FROM 'manual' AND plan_override IS NULL)
        AND (
          stripe_subscription_id IS NULL OR stripe_subscription_id = ''
          OR stripe_price_id IS NULL OR stripe_price_id = ''
        )
    `);

    const inconsistentOrgCount = parseInt(inconsistentOrgs) || 0;
    if (inconsistentOrgCount === 0) {
      pass('stripe', 'No non-manual orgs with inconsistent active status');
    } else {
      fail('stripe', `${inconsistentOrgCount} non-manual orgs have active/trialing status but missing subscription_id or price_id`);
    }

    // Check for inconsistent users
    const inconsistentUsers = runSQL(`
      SELECT COUNT(*) FROM users
      WHERE stripe_subscription_status IN ('active', 'trialing')
        AND (
          stripe_subscription_id IS NULL OR stripe_subscription_id = ''
          OR stripe_price_id IS NULL OR stripe_price_id = ''
        )
    `);

    const inconsistentUserCount = parseInt(inconsistentUsers) || 0;
    if (inconsistentUserCount === 0) {
      pass('stripe', 'No users with inconsistent active status');
    } else {
      warn('stripe', `${inconsistentUserCount} users have active/trialing status but missing IDs (may be in manual-override orgs)`);
    }

    // Count manual override orgs (info only)
    const manualOrgs = runSQL(`
      SELECT COUNT(*) FROM organizations
      WHERE plan_source = 'manual' OR plan_override IS NOT NULL
    `);
    pass('stripe', `${manualOrgs} orgs have manual override (protected)`);

  } catch (err) {
    fail('stripe', `Stripe check failed: ${err.message}`);
  }
}

// =============================================================================
// CHECK 5: DATABASE SANITY (READ-ONLY QUERIES)
// =============================================================================

function checkDatabase() {
  log('\n📋 CHECK 5: Database Sanity');

  try {
    // a) Show org plan + override for target org
    log(`\n  Checking org ${flags.orgId}:`);
    const orgInfo = runSQLMultiline(`
      SELECT id, name, plan, plan_source, plan_override,
             stripe_subscription_status,
             CASE WHEN stripe_customer_id IS NOT NULL THEN 'present' ELSE 'NULL' END as stripe_cust,
             CASE WHEN stripe_subscription_id IS NOT NULL THEN 'present' ELSE 'NULL' END as stripe_sub
      FROM organizations WHERE id = ${flags.orgId}
    `);

    if (orgInfo.includes('(0 rows)')) {
      fail('database', `Org ${flags.orgId} not found`);
    } else {
      pass('database', `Org ${flags.orgId} found`);
      if (flags.verbose) {
        orgInfo.split('\n').forEach(line => log(`    ${line}`));
      }

      // Check if it has the expected manual override
      const isManual = orgInfo.includes('manual');
      if (isManual) {
        pass('database', `Org ${flags.orgId} has manual override (expected)`);
      } else {
        warn('database', `Org ${flags.orgId} does NOT have manual override`);
      }
    }

    // b) Show usage_events counts for that org for current month
    log(`\n  Usage events for org ${flags.orgId} (current month):`);
    try {
      const usageEvents = runSQLMultiline(`
        SELECT event_type, COUNT(*) as count
        FROM usage_events
        WHERE organization_id = ${flags.orgId}
          AND created_at >= date_trunc('month', NOW())
        GROUP BY event_type
        ORDER BY count DESC
        LIMIT 10
      `);

      if (usageEvents.includes('(0 rows)')) {
        warn('database', `No usage_events for org ${flags.orgId} this month`);
      } else {
        pass('database', `Found usage_events for org ${flags.orgId}`);
        if (flags.verbose) {
          usageEvents.split('\n').forEach(line => log(`    ${line}`));
        }
      }
    } catch (err) {
      warn('database', `usage_events query failed (table may not exist): ${err.message}`);
    }

    // c) Show top 20 orgs with stripe_customer_id but no subscription_id
    log('\n  Orgs with stripe_customer_id but no subscription_id:');
    const partialStripeOrgs = runSQLMultiline(`
      SELECT id, name, plan, plan_source,
             CASE WHEN stripe_subscription_status IS NOT NULL THEN stripe_subscription_status ELSE 'NULL' END as status
      FROM organizations
      WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id != ''
        AND (stripe_subscription_id IS NULL OR stripe_subscription_id = '')
      ORDER BY id
      LIMIT 20
    `);

    if (partialStripeOrgs.includes('(0 rows)')) {
      pass('database', 'No orgs with customer_id but missing subscription_id');
    } else {
      const count = partialStripeOrgs.split('\n').filter(l => l.match(/^\s*\d+/)).length;
      warn('database', `${count} orgs have customer_id but no subscription_id`);
      if (flags.verbose) {
        partialStripeOrgs.split('\n').forEach(line => log(`    ${line}`));
      }
    }

  } catch (err) {
    fail('database', `Database check failed: ${err.message}`);
  }
}

// =============================================================================
// CHECK 6: API SANITY (OPTIONAL)
// =============================================================================

function checkApi() {
  return new Promise((resolve) => {
    log('\n📋 CHECK 6: API Sanity');

    if (flags.skipApi || !API_BASE) {
      skip('api', API_BASE ? 'Skipped (--skip-api flag)' : 'Skipped (API_BASE not set)');
      resolve();
      return;
    }

    const url = new URL('/api/auth/verify', API_BASE);
    const protocol = url.protocol === 'https:' ? https : http;

    log(`  Checking ${url.toString()}...`);

    const req = protocol.get(url.toString(), { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 401) {
          // Expected for unauthenticated request
          pass('api', `API responded with 401 (expected for /verify without token)`);
        } else if (res.statusCode === 200) {
          pass('api', `API responded with 200`);
        } else {
          warn('api', `API responded with ${res.statusCode}`);
        }
        resolve();
      });
    });

    req.on('error', (err) => {
      fail('api', `API request failed: ${err.message}`);
      resolve();
    });

    req.on('timeout', () => {
      req.destroy();
      fail('api', 'API request timed out');
      resolve();
    });
  });
}

// =============================================================================
// SUMMARY
// =============================================================================

function printSummary() {
  log('\n' + '='.repeat(60));
  log('📋 PHASE 4 GO/NO-GO SUMMARY');
  log('='.repeat(60));

  const categories = ['environment', 'migrations', 'quota', 'stripe', 'database', 'api'];

  for (const cat of categories) {
    const r = results[cat];
    const icon = r.status === 'pass' ? '✅' :
                 r.status === 'warn' ? '⚠️ ' :
                 r.status === 'fail' ? '❌' :
                 r.status === 'skip' ? '⏭️ ' : '❓';
    log(`${icon} ${cat.toUpperCase()}: ${r.status.toUpperCase()}`);
  }

  log('\n' + '='.repeat(60));

  if (hasFailure) {
    log('❌ NO-GO: One or more checks failed');
    log('');
    log('Failed checks:');
    for (const cat of categories) {
      if (results[cat].status === 'fail') {
        results[cat].details.filter(d => d.startsWith('❌')).forEach(d => log(`  ${d}`));
      }
    }
    log('');
    log('Actions:');
    log('  1. Review the failed checks above');
    log('  2. Run reconciliation if Stripe state is inconsistent:');
    log('     node backend/scripts/reconcile-stripe-state.js --apply');
    log('  3. Ensure all migrations are applied');
    log('  4. Re-run this checklist');
  } else {
    log('✅ GO: All checks passed (safe to proceed to Phase 4)');
  }

  log('='.repeat(60));
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  log('='.repeat(60));
  log('🚀 PHASE 4 GO/NO-GO CHECKLIST');
  log('='.repeat(60));
  log(`Target org: ${flags.orgId}`);
  log(`Verbose: ${flags.verbose}`);
  log(`Time: ${new Date().toISOString()}`);

  // Run all checks
  checkEnvironment();
  checkMigrations();
  checkQuota();
  checkStripe();
  checkDatabase();
  await checkApi();

  // Print summary
  printSummary();

  // Exit with appropriate code
  process.exit(hasFailure ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
