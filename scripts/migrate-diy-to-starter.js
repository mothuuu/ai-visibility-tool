#!/usr/bin/env node

/**
 * migrate-diy-to-starter.js — One-time migration script
 *
 * Converts all existing DIY subscribers to the Starter plan with:
 *   - plan: 'diy' → 'starter'
 *   - 60 monthly tokens (Starter allowance)
 *   - 60 bonus purchased tokens (migration gift)
 *
 * Does NOT touch Stripe — same $29/mo subscription, just a plan name change.
 *
 * Usage:
 *   DRY_RUN=true node scripts/migrate-diy-to-starter.js   # preview only
 *   node scripts/migrate-diy-to-starter.js                 # live migration
 *
 * Requires DATABASE_URL env var.
 * Safe to re-run (idempotent).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require(path.join(__dirname, '..', 'backend', 'db', 'database'));
const pool = db.pool;

const DRY_RUN = process.env.DRY_RUN === 'true';
const STARTER_ALLOWANCE = 60;
const BONUS_AMOUNT = 60;
const MIGRATION_REF_ID = 'diy_to_starter_migration';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('='.repeat(70));
  console.log('DIY → STARTER MIGRATION');
  console.log(DRY_RUN ? '>>> DRY RUN — no changes will be made <<<' : '>>> LIVE RUN <<<');
  console.log('='.repeat(70));

  // ------ Discovery ------
  await runDiscovery();

  // ------ Extend CHECK constraint for bonus_grant type ------
  if (!DRY_RUN) {
    await ensureBonusGrantType();
  }

  // ------ Migrate ------
  const stats = await migrateUsers();

  // ------ Summary ------
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total DIY users found:    ${stats.found}`);
  console.log(`Migrated:                 ${stats.migrated}`);
  console.log(`Skipped (already done):   ${stats.skippedAlready}`);
  console.log(`Skipped (not diy):        ${stats.skippedNotDiy}`);
  console.log(`Errors:                   ${stats.errors}`);

  if (DRY_RUN) {
    console.log('\n>>> DRY RUN complete — no changes were made <<<');
  }

  await pool.end();
  process.exit(stats.errors > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
async function runDiscovery() {
  console.log('\n--- DISCOVERY ---\n');

  // A) Count DIY users
  const countRes = await pool.query("SELECT count(*) FROM users WHERE plan = 'diy'");
  console.log(`[A] DIY users count: ${countRes.rows[0].count}`);

  // B) DIY users with token_balances
  const balRes = await pool.query(`
    SELECT u.id, u.email, tb.id AS balance_id, tb.monthly_remaining, tb.purchased_balance
    FROM users u
    LEFT JOIN token_balances tb ON u.id = tb.user_id
    WHERE u.plan = 'diy'
    ORDER BY u.id
  `);
  console.log(`[B] DIY users with token data:`);
  balRes.rows.forEach(r => {
    const bal = r.balance_id
      ? `balance_id=${r.balance_id}, monthly=${r.monthly_remaining}, purchased=${r.purchased_balance}`
      : 'NO token_balances row';
    console.log(`    user ${r.id} (${r.email}): ${bal}`);
  });

  // C) Billing cycle dates
  const cycleRes = await pool.query(`
    SELECT id, email, stripe_subscription_id,
           stripe_current_period_start, stripe_current_period_end
    FROM users WHERE plan = 'diy' ORDER BY id
  `);
  console.log(`[C] DIY users billing cycle:`);
  cycleRes.rows.forEach(r => {
    console.log(`    user ${r.id} (${r.email}): sub=${r.stripe_subscription_id || 'null'}, ` +
      `period=${r.stripe_current_period_start || 'null'} → ${r.stripe_current_period_end || 'null'}`);
  });

  // D) Check for existing migration transactions
  const txRes = await pool.query(
    `SELECT user_id, type, amount FROM token_transactions WHERE reference_id = $1`,
    [MIGRATION_REF_ID]
  );
  if (txRes.rows.length > 0) {
    console.log(`[D] Existing migration transactions found: ${txRes.rows.length} rows`);
    txRes.rows.forEach(r => {
      console.log(`    user ${r.user_id}: type=${r.type}, amount=${r.amount}`);
    });
  } else {
    console.log(`[D] No existing migration transactions found — clean slate.`);
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Ensure bonus_grant type is allowed in CHECK constraint
// ---------------------------------------------------------------------------
async function ensureBonusGrantType() {
  try {
    // Drop the old CHECK and add one that includes bonus_grant.
    // This is idempotent — if bonus_grant is already allowed, no harm.
    await pool.query(`
      ALTER TABLE token_transactions
        DROP CONSTRAINT IF EXISTS token_transactions_type_check
    `);
    await pool.query(`
      ALTER TABLE token_transactions
        ADD CONSTRAINT token_transactions_type_check
        CHECK (type IN (
          'monthly_grant', 'purchase', 'spend',
          'monthly_expire', 'purchased_expire', 'bonus_grant'
        ))
    `);
    console.log('[Schema] Added bonus_grant to token_transactions type CHECK constraint.\n');
  } catch (err) {
    console.error('[Schema] Failed to update CHECK constraint:', err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Migrate all DIY users
// ---------------------------------------------------------------------------
async function migrateUsers() {
  const stats = { found: 0, migrated: 0, skippedAlready: 0, skippedNotDiy: 0, errors: 0 };

  // Fetch all DIY users (snapshot at start)
  const usersRes = await pool.query(`
    SELECT u.id, u.email, u.plan,
           u.stripe_current_period_start, u.stripe_current_period_end,
           tb.monthly_remaining, tb.purchased_balance
    FROM users u
    LEFT JOIN token_balances tb ON u.id = tb.user_id
    WHERE u.plan = 'diy'
    ORDER BY u.id
  `);

  stats.found = usersRes.rows.length;
  console.log(`\n--- MIGRATION (${stats.found} users) ---\n`);

  for (const row of usersRes.rows) {
    try {
      await migrateOneUser(row, stats);
    } catch (err) {
      stats.errors++;
      console.error(`  ERROR migrating user ${row.id} (${row.email}): ${err.message}`);
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Migrate a single user (within a transaction)
// ---------------------------------------------------------------------------
async function migrateOneUser(row, stats) {
  const userId = row.id;
  const email = row.email;

  // Check if already migrated (has migration transaction)
  const existingTx = await pool.query(
    `SELECT id FROM token_transactions WHERE user_id = $1 AND reference_id = $2 LIMIT 1`,
    [userId, MIGRATION_REF_ID]
  );
  if (existingTx.rows.length > 0) {
    console.log(`  SKIP user ${userId} (${email}): already migrated`);
    stats.skippedAlready++;
    return;
  }

  // Derive cycle dates
  const cycleStart = row.stripe_current_period_start || new Date();
  const cycleEnd = row.stripe_current_period_end || new Date(new Date(cycleStart).getTime() + 30 * 24 * 60 * 60 * 1000);

  // Existing purchased balance (may be > 0 if user bought tokens before)
  const existingPurchased = row.purchased_balance || 0;
  const newPurchased = existingPurchased + BONUS_AMOUNT;

  // balance_after for each transaction step:
  //   Step A (monthly grant): monthly=60, purchased=existingPurchased (bonus not yet added)
  const balanceAfterMonthly = STARTER_ALLOWANCE + existingPurchased;
  //   Step B (bonus grant): monthly=60, purchased=existingPurchased + 60
  const balanceAfterBonus = STARTER_ALLOWANCE + newPurchased;

  if (DRY_RUN) {
    console.log(`  DRY_RUN user ${userId} (${email}): ` +
      `plan diy → starter, monthly=60, purchased=${existingPurchased}+${BONUS_AMOUNT}=${newPurchased}, ` +
      `balance_after: monthly_grant=${balanceAfterMonthly}, bonus_grant=${balanceAfterBonus}, ` +
      `cycle=${new Date(cycleStart).toISOString().slice(0, 10)} → ${new Date(cycleEnd).toISOString().slice(0, 10)}`);
    stats.migrated++;
    return;
  }

  // --- Transaction ---
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Update plan (guarded: only if still 'diy')
    const planUpdate = await client.query(
      `UPDATE users SET plan = 'starter', updated_at = NOW() WHERE id = $1 AND plan = 'diy' RETURNING id`,
      [userId]
    );
    if (planUpdate.rows.length === 0) {
      // Plan was changed since our snapshot — skip
      await client.query('ROLLBACK');
      console.log(`  SKIP user ${userId} (${email}): plan is no longer 'diy'`);
      stats.skippedNotDiy++;
      return;
    }

    // 2) Upsert token_balances
    await client.query(`
      INSERT INTO token_balances (user_id, monthly_remaining, plan_allowance, purchased_balance,
                                   cycle_start_date, cycle_end_date, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        monthly_remaining = $2,
        plan_allowance    = $3,
        purchased_balance = token_balances.purchased_balance + $7,
        cycle_start_date  = $5,
        cycle_end_date    = $6,
        updated_at        = NOW()
    `, [userId, STARTER_ALLOWANCE, STARTER_ALLOWANCE, newPurchased,
        cycleStart, cycleEnd, BONUS_AMOUNT]);

    // 3a) Log monthly_grant transaction
    await client.query(`
      INSERT INTO token_transactions (user_id, type, amount, balance_after, reference_type, reference_id, created_at)
      VALUES ($1, 'monthly_grant', $2, $3, 'migration', $4, NOW())
    `, [userId, STARTER_ALLOWANCE, balanceAfterMonthly, MIGRATION_REF_ID]);

    // 3b) Log bonus_grant transaction
    await client.query(`
      INSERT INTO token_transactions (user_id, type, amount, balance_after, reference_type, reference_id, created_at)
      VALUES ($1, 'bonus_grant', $2, $3, 'migration_bonus', $4, NOW())
    `, [userId, BONUS_AMOUNT, balanceAfterBonus, MIGRATION_REF_ID]);

    await client.query('COMMIT');

    console.log(`  Migrated user ${userId} (${email}): plan diy → starter, ` +
      `granted ${STARTER_ALLOWANCE} monthly + ${BONUS_AMOUNT} bonus = ${balanceAfterBonus} total tokens`);
    stats.migrated++;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
