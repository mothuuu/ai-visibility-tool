#!/usr/bin/env node
/**
 * Stripe State Reconciliation Script - Phase 2.2
 *
 * Normalizes org + user Stripe fields to eliminate contradictions and ensure
 * plan resolution behaves predictably.
 *
 * Key Rules:
 * - Skip orgs with manual override (plan_source='manual' OR plan_override IS NOT NULL)
 * - If active/trialing but missing subscription_id or price_id, clear the status
 * - Convert empty strings to NULL
 * - Create backup before changes
 * - Support dry-run mode (default)
 * - Be idempotent
 *
 * Usage:
 *   node backend/scripts/reconcile-stripe-state.js --dry-run
 *   node backend/scripts/reconcile-stripe-state.js --apply
 *   node backend/scripts/reconcile-stripe-state.js --apply --org-id 110 --verbose
 *   node backend/scripts/reconcile-stripe-state.js --apply --limit 10
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Pool } = require('pg');

// Parse CLI arguments
const args = process.argv.slice(2);
const flags = {
  dryRun: !args.includes('--apply'),
  verbose: args.includes('--verbose') || args.includes('-v'),
  limit: null,
  orgId: null
};

// Parse --limit N
const limitIdx = args.indexOf('--limit');
if (limitIdx !== -1 && args[limitIdx + 1]) {
  flags.limit = parseInt(args[limitIdx + 1], 10);
}

// Parse --org-id N
const orgIdIdx = args.indexOf('--org-id');
if (orgIdIdx !== -1 && args[orgIdIdx + 1]) {
  flags.orgId = parseInt(args[orgIdIdx + 1], 10);
}

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Active subscription statuses
const ACTIVE_STATUSES = ['active', 'trialing'];

// Counters for summary
const stats = {
  orgsScanned: 0,
  orgsSkippedManual: 0,
  orgsWithInconsistentStatus: 0,
  orgsFixed: 0,
  orgsEmptyStringsFixed: 0,
  usersScanned: 0,
  usersSkippedManualOrg: 0,
  usersWithInconsistentStatus: 0,
  usersFixed: 0,
  usersEmptyStringsFixed: 0,
  backupRowsCreated: 0
};

// Track affected IDs for verbose output
const affected = {
  orgs: [],
  users: []
};

/**
 * Create backup table for this run
 */
async function createBackupTable(client) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const tableName = `stripe_reconcile_backup_${today}`;

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id SERIAL PRIMARY KEY,
      entity_type VARCHAR(10) NOT NULL,
      entity_id INTEGER NOT NULL,
      before_json JSONB NOT NULL,
      changed_at TIMESTAMPTZ DEFAULT NOW(),
      change_type VARCHAR(50)
    )
  `);

  console.log(`📦 Backup table: ${tableName}`);
  return tableName;
}

/**
 * Backup a record before modification
 */
async function backupRecord(client, backupTable, entityType, entityId, beforeData, changeType) {
  if (flags.dryRun) return;

  await client.query(`
    INSERT INTO ${backupTable} (entity_type, entity_id, before_json, change_type)
    VALUES ($1, $2, $3, $4)
  `, [entityType, entityId, JSON.stringify(beforeData), changeType]);

  stats.backupRowsCreated++;
}

/**
 * Check if a value is empty (null or empty string)
 */
function isEmpty(value) {
  return value === null || value === undefined || value === '';
}

/**
 * Run the report queries and print summary
 */
async function runReport(client) {
  console.log('\n📊 STRIPE STATE REPORT');
  console.log('='.repeat(60));

  // 1) Manual override orgs
  const manualOrgs = await client.query(`
    SELECT COUNT(*) as count
    FROM organizations
    WHERE plan_source = 'manual' OR plan_override IS NOT NULL
  `);
  console.log(`\n1) Organizations with manual override (PROTECTED): ${manualOrgs.rows[0].count}`);

  // 2) Orgs with inconsistent active status
  const inconsistentOrgs = await client.query(`
    SELECT COUNT(*) as count
    FROM organizations
    WHERE stripe_subscription_status IN ('active', 'trialing')
      AND (plan_source IS DISTINCT FROM 'manual' AND plan_override IS NULL)
      AND (
        stripe_subscription_id IS NULL OR stripe_subscription_id = ''
        OR stripe_price_id IS NULL OR stripe_price_id = ''
      )
  `);
  console.log(`2) Orgs with active/trialing but missing IDs (PROBLEM): ${inconsistentOrgs.rows[0].count}`);

  // 3) Users with inconsistent active status
  const inconsistentUsers = await client.query(`
    SELECT COUNT(*) as count
    FROM users
    WHERE stripe_subscription_status IN ('active', 'trialing')
      AND (
        stripe_subscription_id IS NULL OR stripe_subscription_id = ''
        OR stripe_price_id IS NULL OR stripe_price_id = ''
      )
  `);
  console.log(`3) Users with active/trialing but missing IDs (PROBLEM): ${inconsistentUsers.rows[0].count}`);

  // 4) Paid users without Stripe (INFO)
  const paidNoStripe = await client.query(`
    SELECT COUNT(*) as count
    FROM users
    WHERE plan IN ('diy', 'pro', 'agency', 'enterprise')
      AND (stripe_customer_id IS NULL OR stripe_customer_id = ''
           OR stripe_subscription_id IS NULL OR stripe_subscription_id = '')
  `);
  console.log(`4) Paid users without Stripe IDs (INFO only): ${paidNoStripe.rows[0].count}`);

  // 5) Orgs with customer_id but no subscription_id
  const orgsPartialStripe = await client.query(`
    SELECT COUNT(*) as count
    FROM organizations
    WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id != ''
      AND (stripe_subscription_id IS NULL OR stripe_subscription_id = '')
  `);
  console.log(`5) Orgs with customer_id but no subscription_id: ${orgsPartialStripe.rows[0].count}`);

  // 6) Active but missing period fields
  const orgsMissingPeriod = await client.query(`
    SELECT COUNT(*) as count
    FROM organizations
    WHERE stripe_subscription_status IN ('active', 'trialing')
      AND (stripe_current_period_start IS NULL OR stripe_current_period_end IS NULL)
  `);
  const usersMissingPeriod = await client.query(`
    SELECT COUNT(*) as count
    FROM users
    WHERE stripe_subscription_status IN ('active', 'trialing')
      AND (stripe_current_period_start IS NULL OR stripe_current_period_end IS NULL)
  `);
  console.log(`6) Active orgs missing period fields: ${orgsMissingPeriod.rows[0].count}`);
  console.log(`   Active users missing period fields: ${usersMissingPeriod.rows[0].count}`);

  // 7) Empty strings
  const orgsEmptyStrings = await client.query(`
    SELECT
      SUM(CASE WHEN stripe_customer_id = '' THEN 1 ELSE 0 END) as empty_customer,
      SUM(CASE WHEN stripe_subscription_id = '' THEN 1 ELSE 0 END) as empty_sub,
      SUM(CASE WHEN stripe_price_id = '' THEN 1 ELSE 0 END) as empty_price
    FROM organizations
  `);
  const usersEmptyStrings = await client.query(`
    SELECT
      SUM(CASE WHEN stripe_customer_id = '' THEN 1 ELSE 0 END) as empty_customer,
      SUM(CASE WHEN stripe_subscription_id = '' THEN 1 ELSE 0 END) as empty_sub,
      SUM(CASE WHEN stripe_price_id = '' THEN 1 ELSE 0 END) as empty_price
    FROM users
  `);
  const orgEmpty = orgsEmptyStrings.rows[0];
  const userEmpty = usersEmptyStrings.rows[0];
  console.log(`7) Empty strings (should be NULL):`);
  console.log(`   Orgs: customer=${orgEmpty.empty_customer || 0}, sub=${orgEmpty.empty_sub || 0}, price=${orgEmpty.empty_price || 0}`);
  console.log(`   Users: customer=${userEmpty.empty_customer || 0}, sub=${userEmpty.empty_sub || 0}, price=${userEmpty.empty_price || 0}`);

  console.log('\n' + '='.repeat(60));
}

/**
 * Reconcile organization Stripe fields
 */
async function reconcileOrganizations(client, backupTable) {
  console.log('\n🔧 RECONCILING ORGANIZATIONS...');

  // Build query with optional filters
  let whereClause = '1=1';
  const params = [];

  if (flags.orgId) {
    params.push(flags.orgId);
    whereClause += ` AND id = $${params.length}`;
  }

  let limitClause = '';
  if (flags.limit) {
    limitClause = `LIMIT ${flags.limit}`;
  }

  // Get all orgs to process
  const orgsResult = await client.query(`
    SELECT
      id, name, plan, plan_source, plan_override,
      stripe_customer_id, stripe_subscription_id, stripe_subscription_status,
      stripe_price_id, stripe_current_period_start, stripe_current_period_end
    FROM organizations
    WHERE ${whereClause}
    ORDER BY id
    ${limitClause}
  `, params);

  for (const org of orgsResult.rows) {
    stats.orgsScanned++;

    // Rule A: Skip manual override orgs
    if (org.plan_source === 'manual' || org.plan_override !== null) {
      stats.orgsSkippedManual++;
      if (flags.verbose) {
        console.log(`  ⏭️  Org ${org.id} (${org.name}): SKIPPED (manual override)`);
      }
      continue;
    }

    let needsUpdate = false;
    const updates = {};
    const changeTypes = [];

    // Rule B: Active/trialing but missing subscription_id or price_id
    if (ACTIVE_STATUSES.includes(org.stripe_subscription_status)) {
      if (isEmpty(org.stripe_subscription_id) || isEmpty(org.stripe_price_id)) {
        stats.orgsWithInconsistentStatus++;
        needsUpdate = true;
        updates.stripe_subscription_status = null;
        updates.stripe_subscription_id = null;
        updates.stripe_price_id = null;
        updates.stripe_current_period_start = null;
        updates.stripe_current_period_end = null;
        changeTypes.push('clear_inconsistent_active');

        if (flags.verbose) {
          console.log(`  🔴 Org ${org.id} (${org.name}): INCONSISTENT - active but missing IDs`);
          console.log(`      Status: ${org.stripe_subscription_status}, SubID: ${org.stripe_subscription_id || 'NULL'}, PriceID: ${org.stripe_price_id || 'NULL'}`);
        }
      }
    }

    // Rule E: Empty string cleanup (only if not already being cleared)
    if (!needsUpdate) {
      if (org.stripe_customer_id === '') {
        needsUpdate = true;
        updates.stripe_customer_id = null;
        changeTypes.push('empty_string_customer_id');
      }
      if (org.stripe_subscription_id === '') {
        needsUpdate = true;
        updates.stripe_subscription_id = null;
        changeTypes.push('empty_string_subscription_id');
      }
      if (org.stripe_price_id === '') {
        needsUpdate = true;
        updates.stripe_price_id = null;
        changeTypes.push('empty_string_price_id');
      }
      if (org.stripe_subscription_status === '') {
        needsUpdate = true;
        updates.stripe_subscription_status = null;
        changeTypes.push('empty_string_status');
      }

      if (needsUpdate && changeTypes.some(t => t.startsWith('empty_string'))) {
        stats.orgsEmptyStringsFixed++;
      }
    }

    // Apply updates
    if (needsUpdate) {
      affected.orgs.push({ id: org.id, name: org.name, changeTypes });

      if (!flags.dryRun) {
        // Backup first
        await backupRecord(client, backupTable, 'org', org.id, org, changeTypes.join(','));

        // Build UPDATE query
        const setClauses = [];
        const updateParams = [];
        let paramIdx = 1;

        for (const [key, value] of Object.entries(updates)) {
          setClauses.push(`${key} = $${paramIdx}`);
          updateParams.push(value);
          paramIdx++;
        }
        setClauses.push(`updated_at = NOW()`);
        updateParams.push(org.id);

        await client.query(`
          UPDATE organizations
          SET ${setClauses.join(', ')}
          WHERE id = $${paramIdx}
        `, updateParams);

        stats.orgsFixed++;
        console.log(`  ✅ Org ${org.id} (${org.name}): FIXED [${changeTypes.join(', ')}]`);
      } else {
        console.log(`  🔍 Org ${org.id} (${org.name}): WOULD FIX [${changeTypes.join(', ')}]`);
      }
    }
  }
}

/**
 * Reconcile user Stripe fields
 */
async function reconcileUsers(client, backupTable) {
  console.log('\n🔧 RECONCILING USERS...');

  // Build query with optional filters
  let whereClause = '1=1';
  const params = [];

  if (flags.orgId) {
    params.push(flags.orgId);
    whereClause += ` AND u.organization_id = $${params.length}`;
  }

  let limitClause = '';
  if (flags.limit) {
    limitClause = `LIMIT ${flags.limit}`;
  }

  // Get all users with their org info
  const usersResult = await client.query(`
    SELECT
      u.id, u.email, u.plan, u.organization_id,
      u.stripe_customer_id, u.stripe_subscription_id, u.stripe_subscription_status,
      u.stripe_price_id, u.stripe_current_period_start, u.stripe_current_period_end,
      o.plan_source as org_plan_source,
      o.plan_override as org_plan_override
    FROM users u
    LEFT JOIN organizations o ON u.organization_id = o.id
    WHERE ${whereClause}
    ORDER BY u.id
    ${limitClause}
  `, params);

  for (const user of usersResult.rows) {
    stats.usersScanned++;

    // Rule D: Skip users whose org has manual override
    if (user.org_plan_source === 'manual' || user.org_plan_override !== null) {
      stats.usersSkippedManualOrg++;
      if (flags.verbose) {
        console.log(`  ⏭️  User ${user.id} (${user.email}): SKIPPED (org has manual override)`);
      }
      continue;
    }

    let needsUpdate = false;
    const updates = {};
    const changeTypes = [];

    // Rule D: Active/trialing but missing subscription_id or price_id
    if (ACTIVE_STATUSES.includes(user.stripe_subscription_status)) {
      if (isEmpty(user.stripe_subscription_id) || isEmpty(user.stripe_price_id)) {
        stats.usersWithInconsistentStatus++;
        needsUpdate = true;
        updates.stripe_subscription_status = null;
        updates.stripe_subscription_id = null;
        updates.stripe_price_id = null;
        updates.stripe_current_period_start = null;
        updates.stripe_current_period_end = null;
        changeTypes.push('clear_inconsistent_active');

        if (flags.verbose) {
          console.log(`  🔴 User ${user.id} (${user.email}): INCONSISTENT - active but missing IDs`);
          console.log(`      Status: ${user.stripe_subscription_status}, SubID: ${user.stripe_subscription_id || 'NULL'}, PriceID: ${user.stripe_price_id || 'NULL'}`);
        }
      }
    }

    // Rule E: Empty string cleanup (only if not already being cleared)
    if (!needsUpdate) {
      if (user.stripe_customer_id === '') {
        needsUpdate = true;
        updates.stripe_customer_id = null;
        changeTypes.push('empty_string_customer_id');
      }
      if (user.stripe_subscription_id === '') {
        needsUpdate = true;
        updates.stripe_subscription_id = null;
        changeTypes.push('empty_string_subscription_id');
      }
      if (user.stripe_price_id === '') {
        needsUpdate = true;
        updates.stripe_price_id = null;
        changeTypes.push('empty_string_price_id');
      }
      if (user.stripe_subscription_status === '') {
        needsUpdate = true;
        updates.stripe_subscription_status = null;
        changeTypes.push('empty_string_status');
      }

      if (needsUpdate && changeTypes.some(t => t.startsWith('empty_string'))) {
        stats.usersEmptyStringsFixed++;
      }
    }

    // Apply updates
    if (needsUpdate) {
      affected.users.push({ id: user.id, email: user.email, changeTypes });

      if (!flags.dryRun) {
        // Backup first
        await backupRecord(client, backupTable, 'user', user.id, user, changeTypes.join(','));

        // Build UPDATE query
        const setClauses = [];
        const updateParams = [];
        let paramIdx = 1;

        for (const [key, value] of Object.entries(updates)) {
          setClauses.push(`${key} = $${paramIdx}`);
          updateParams.push(value);
          paramIdx++;
        }
        setClauses.push(`updated_at = NOW()`);
        updateParams.push(user.id);

        await client.query(`
          UPDATE users
          SET ${setClauses.join(', ')}
          WHERE id = $${paramIdx}
        `, updateParams);

        stats.usersFixed++;
        console.log(`  ✅ User ${user.id} (${user.email}): FIXED [${changeTypes.join(', ')}]`);
      } else {
        console.log(`  🔍 User ${user.id} (${user.email}): WOULD FIX [${changeTypes.join(', ')}]`);
      }
    }
  }
}

/**
 * Print summary
 */
function printSummary(backupTable) {
  console.log('\n' + '='.repeat(60));
  console.log('📋 RECONCILIATION SUMMARY');
  console.log('='.repeat(60));

  console.log(`\nMode: ${flags.dryRun ? '🔍 DRY RUN (no changes made)' : '✅ APPLY (changes committed)'}`);

  console.log('\nOrganizations:');
  console.log(`  Scanned: ${stats.orgsScanned}`);
  console.log(`  Skipped (manual override): ${stats.orgsSkippedManual}`);
  console.log(`  Inconsistent active status found: ${stats.orgsWithInconsistentStatus}`);
  console.log(`  Empty strings found: ${stats.orgsEmptyStringsFixed}`);
  console.log(`  ${flags.dryRun ? 'Would fix' : 'Fixed'}: ${flags.dryRun ? affected.orgs.length : stats.orgsFixed}`);

  console.log('\nUsers:');
  console.log(`  Scanned: ${stats.usersScanned}`);
  console.log(`  Skipped (org has manual override): ${stats.usersSkippedManualOrg}`);
  console.log(`  Inconsistent active status found: ${stats.usersWithInconsistentStatus}`);
  console.log(`  Empty strings found: ${stats.usersEmptyStringsFixed}`);
  console.log(`  ${flags.dryRun ? 'Would fix' : 'Fixed'}: ${flags.dryRun ? affected.users.length : stats.usersFixed}`);

  if (!flags.dryRun) {
    console.log(`\nBackup rows created: ${stats.backupRowsCreated}`);
    console.log(`Backup table: ${backupTable}`);
  }

  if (flags.verbose && (affected.orgs.length > 0 || affected.users.length > 0)) {
    console.log('\n📝 AFFECTED RECORDS:');

    if (affected.orgs.length > 0) {
      console.log('\nOrganizations:');
      for (const org of affected.orgs) {
        console.log(`  - Org ${org.id} (${org.name}): ${org.changeTypes.join(', ')}`);
      }
    }

    if (affected.users.length > 0) {
      console.log('\nUsers:');
      for (const user of affected.users) {
        console.log(`  - User ${user.id} (${user.email}): ${user.changeTypes.join(', ')}`);
      }
    }
  }

  if (!flags.dryRun && backupTable) {
    console.log('\n🔄 ROLLBACK HINTS:');
    console.log(`To rollback organizations:`);
    console.log(`  UPDATE organizations o`);
    console.log(`  SET`);
    console.log(`    stripe_subscription_status = (b.before_json->>'stripe_subscription_status'),`);
    console.log(`    stripe_subscription_id = (b.before_json->>'stripe_subscription_id'),`);
    console.log(`    stripe_price_id = (b.before_json->>'stripe_price_id'),`);
    console.log(`    stripe_current_period_start = (b.before_json->>'stripe_current_period_start')::timestamptz,`);
    console.log(`    stripe_current_period_end = (b.before_json->>'stripe_current_period_end')::timestamptz`);
    console.log(`  FROM ${backupTable} b`);
    console.log(`  WHERE b.entity_type = 'org' AND b.entity_id = o.id;`);
    console.log('');
    console.log(`To rollback users:`);
    console.log(`  UPDATE users u`);
    console.log(`  SET`);
    console.log(`    stripe_subscription_status = (b.before_json->>'stripe_subscription_status'),`);
    console.log(`    stripe_subscription_id = (b.before_json->>'stripe_subscription_id'),`);
    console.log(`    stripe_price_id = (b.before_json->>'stripe_price_id'),`);
    console.log(`    stripe_current_period_start = (b.before_json->>'stripe_current_period_start')::timestamptz,`);
    console.log(`    stripe_current_period_end = (b.before_json->>'stripe_current_period_end')::timestamptz`);
    console.log(`  FROM ${backupTable} b`);
    console.log(`  WHERE b.entity_type = 'user' AND b.entity_id = u.id;`);
  }

  console.log('\n' + '='.repeat(60));
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('🔧 STRIPE STATE RECONCILIATION - Phase 2.2');
  console.log('='.repeat(60));
  console.log(`\nFlags:`);
  console.log(`  --dry-run: ${flags.dryRun}`);
  console.log(`  --verbose: ${flags.verbose}`);
  console.log(`  --limit: ${flags.limit || 'none'}`);
  console.log(`  --org-id: ${flags.orgId || 'all'}`);

  const client = await pool.connect();
  let backupTable = null;

  try {
    // Run report first
    await runReport(client);

    // Create backup table (even in dry-run, for structure verification)
    backupTable = await createBackupTable(client);

    // Reconcile organizations
    await reconcileOrganizations(client, backupTable);

    // Reconcile users
    await reconcileUsers(client, backupTable);

    // Print summary
    printSummary(backupTable);

    if (flags.dryRun) {
      console.log('\n⚠️  DRY RUN COMPLETE - No changes were made.');
      console.log('   Run with --apply to execute changes.');
    } else {
      console.log('\n✅ RECONCILIATION COMPLETE');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
