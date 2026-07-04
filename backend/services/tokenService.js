/**
 * Token Service
 *
 * Core service for managing token balances.
 * Every mutation is atomic: balance update + token_transactions insert
 * in a single PostgreSQL transaction with SELECT ... FOR UPDATE locking.
 */

const db = require('../db/database');
const InsufficientTokensError = require('../errors/InsufficientTokensError');

// =============================================================================
// READ
// =============================================================================

/**
 * Get token balance for a user.
 * Returns zeros if no token_balances row exists (never throws).
 *
 * @param {number} userId
 * @returns {Promise<{monthly_remaining:number, purchased_balance:number, total_available:number, cycle_start_date:Date|null, cycle_end_date:Date|null}>}
 */
async function getBalance(userId) {
  const result = await db.query(
    'SELECT monthly_remaining, purchased_balance, cycle_start_date, cycle_end_date, purchased_expires_at FROM token_balances WHERE user_id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return {
      monthly_remaining: 0,
      purchased_balance: 0,
      total_available: 0,
      cycle_start_date: null,
      cycle_end_date: null,
      purchased_expires_at: null
    };
  }

  const row = result.rows[0];
  return {
    monthly_remaining: row.monthly_remaining,
    purchased_balance: row.purchased_balance,
    total_available: row.monthly_remaining + row.purchased_balance,
    cycle_start_date: row.cycle_start_date,
    cycle_end_date: row.cycle_end_date,
    purchased_expires_at: row.purchased_expires_at
  };
}

// =============================================================================
// GRANT / CREDIT
// =============================================================================

/**
 * Grant monthly tokens to a user (e.g. on billing cycle start).
 *
 * Upserts token_balances, then inserts a monthly_grant transaction.
 * All in one transaction with row-level locking.
 *
 * @param {number} userId
 * @param {number} planAllowance - Must be > 0
 * @param {Date|string} cycleStartDate
 * @param {Date|string} cycleEndDate
 * @returns {Promise<{monthly_remaining:number, purchased_balance:number, total_available:number}>}
 */
async function grantMonthlyTokens(userId, planAllowance, cycleStartDate, cycleEndDate) {
  if (!planAllowance || planAllowance <= 0) {
    throw new Error('planAllowance must be > 0');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Upsert the balance row
    await client.query(`
      INSERT INTO token_balances (user_id, monthly_remaining, plan_allowance, cycle_start_date, cycle_end_date, updated_at)
      VALUES ($1, $2, $2, $3, $4, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        monthly_remaining  = $2,
        plan_allowance     = $2,
        cycle_start_date   = $3,
        cycle_end_date     = $4,
        updated_at         = NOW()
    `, [userId, planAllowance, cycleStartDate, cycleEndDate]);

    // Lock and read the authoritative row
    const row = await client.query(
      'SELECT monthly_remaining, purchased_balance FROM token_balances WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    const { monthly_remaining, purchased_balance } = row.rows[0];
    const balanceAfter = monthly_remaining + purchased_balance;

    // Ledger entry
    await client.query(`
      INSERT INTO token_transactions (user_id, type, amount, balance_after, reference_type)
      VALUES ($1, 'monthly_grant', $2, $3, 'system')
    `, [userId, planAllowance, balanceAfter]);

    await client.query('COMMIT');

    return { monthly_remaining, purchased_balance, total_available: balanceAfter };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Credit purchased tokens to a user's balance.
 *
 * @param {number} userId
 * @param {number} amount - Must be > 0
 * @param {string} [referenceType='stripe_payment']
 * @param {string|null} [referenceId=null]
 * @returns {Promise<{monthly_remaining:number, purchased_balance:number, total_available:number}>}
 */
async function creditPurchasedTokens(userId, amount, referenceType = 'stripe_payment', referenceId = null) {
  if (!amount || amount <= 0) {
    throw new Error('amount must be > 0');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Upsert — creates row if missing, otherwise just locks for the subsequent UPDATE
    await client.query(`
      INSERT INTO token_balances (user_id, purchased_balance, updated_at)
      VALUES ($1, 0, NOW())
      ON CONFLICT (user_id) DO NOTHING
    `, [userId]);

    // Lock + update
    await client.query(
      'SELECT 1 FROM token_balances WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    // Rolling 12-month expiry: reset the clock on every credit.
    await client.query(`
      UPDATE token_balances
      SET purchased_balance    = purchased_balance + $2,
          purchased_expires_at = NOW() + INTERVAL '12 months',
          updated_at           = NOW()
      WHERE user_id = $1
    `, [userId, amount]);

    // Read authoritative balances
    const row = await client.query(
      'SELECT monthly_remaining, purchased_balance FROM token_balances WHERE user_id = $1',
      [userId]
    );
    const { monthly_remaining, purchased_balance } = row.rows[0];
    const balanceAfter = monthly_remaining + purchased_balance;

    // Ledger entry
    await client.query(`
      INSERT INTO token_transactions (user_id, type, amount, balance_after, reference_type, reference_id)
      VALUES ($1, 'purchase', $2, $3, $4, $5)
    `, [userId, amount, balanceAfter, referenceType, referenceId]);

    await client.query('COMMIT');

    return { monthly_remaining, purchased_balance, total_available: balanceAfter };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =============================================================================
// SPEND
// =============================================================================

/**
 * Spend tokens from a user's balance.
 *
 * Deducts from monthly_remaining first, then purchased_balance.
 * Throws InsufficientTokensError if total balance < amount (no partial deduct).
 *
 * @param {number} userId
 * @param {number} amount - Must be > 0
 * @param {string} referenceType
 * @param {string|null} [referenceId=null]
 * @param {object|null} [externalClient=null] - If provided, use this client and skip BEGIN/COMMIT (caller manages the transaction).
 * @returns {Promise<{monthly_remaining:number, purchased_balance:number, total_available:number}>}
 */
async function spendTokens(userId, amount, referenceType, referenceId = null, externalClient = null) {
  if (!amount || amount <= 0) {
    throw new Error('amount must be > 0');
  }

  if (externalClient) {
    // Caller manages the transaction — just run queries on the provided client.
    const lockResult = await externalClient.query(
      'SELECT monthly_remaining, purchased_balance FROM token_balances WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (lockResult.rows.length === 0) {
      throw new InsufficientTokensError(amount, 0);
    }

    let { monthly_remaining, purchased_balance } = lockResult.rows[0];
    const totalAvailable = monthly_remaining + purchased_balance;

    if (totalAvailable < amount) {
      throw new InsufficientTokensError(amount, totalAvailable);
    }

    let remaining = amount;
    const monthlyDeduct = Math.min(remaining, monthly_remaining);
    monthly_remaining -= monthlyDeduct;
    remaining -= monthlyDeduct;

    if (remaining > 0) {
      purchased_balance -= remaining;
    }

    await externalClient.query(`
      UPDATE token_balances
      SET monthly_remaining = $2, purchased_balance = $3, updated_at = NOW()
      WHERE user_id = $1
    `, [userId, monthly_remaining, purchased_balance]);

    const balanceAfter = monthly_remaining + purchased_balance;

    await externalClient.query(`
      INSERT INTO token_transactions (user_id, type, amount, balance_after, reference_type, reference_id)
      VALUES ($1, 'spend', $2, $3, $4, $5)
    `, [userId, -amount, balanceAfter, referenceType, referenceId]);

    return { monthly_remaining, purchased_balance, total_available: balanceAfter };
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Lock
    const lockResult = await client.query(
      'SELECT monthly_remaining, purchased_balance FROM token_balances WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (lockResult.rows.length === 0) {
      throw new InsufficientTokensError(amount, 0);
    }

    let { monthly_remaining, purchased_balance } = lockResult.rows[0];
    const totalAvailable = monthly_remaining + purchased_balance;

    if (totalAvailable < amount) {
      throw new InsufficientTokensError(amount, totalAvailable);
    }

    // Deduct monthly first, then purchased
    let remaining = amount;
    const monthlyDeduct = Math.min(remaining, monthly_remaining);
    monthly_remaining -= monthlyDeduct;
    remaining -= monthlyDeduct;

    if (remaining > 0) {
      purchased_balance -= remaining;
    }

    // Persist
    await client.query(`
      UPDATE token_balances
      SET monthly_remaining = $2, purchased_balance = $3, updated_at = NOW()
      WHERE user_id = $1
    `, [userId, monthly_remaining, purchased_balance]);

    const balanceAfter = monthly_remaining + purchased_balance;

    // Ledger entry
    await client.query(`
      INSERT INTO token_transactions (user_id, type, amount, balance_after, reference_type, reference_id)
      VALUES ($1, 'spend', $2, $3, $4, $5)
    `, [userId, -amount, balanceAfter, referenceType, referenceId]);

    await client.query('COMMIT');

    return { monthly_remaining, purchased_balance, total_available: balanceAfter };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =============================================================================
// EXPIRE
// =============================================================================

/**
 * Expire remaining monthly tokens (e.g. at cycle end).
 * No-op (no ledger entry) if row missing or monthly_remaining already 0.
 *
 * @param {number} userId
 * @returns {Promise<void>}
 */
async function expireMonthlyTokens(userId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const lockResult = await client.query(
      'SELECT monthly_remaining, purchased_balance FROM token_balances WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (lockResult.rows.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const { monthly_remaining, purchased_balance } = lockResult.rows[0];

    if (monthly_remaining === 0) {
      await client.query('COMMIT');
      return;
    }

    await client.query(`
      UPDATE token_balances
      SET monthly_remaining = 0, updated_at = NOW()
      WHERE user_id = $1
    `, [userId]);

    const balanceAfter = purchased_balance; // monthly is now 0

    await client.query(`
      INSERT INTO token_transactions (user_id, type, amount, balance_after, reference_type)
      VALUES ($1, 'monthly_expire', $2, $3, 'system')
    `, [userId, -monthly_remaining, balanceAfter]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Expire purchased tokens (e.g. 12-month rolling window elapsed).
 * No-op if row missing or purchased_balance already 0.
 * Clears purchased_expires_at to NULL since balance is now 0.
 *
 * @param {number} userId
 * @returns {Promise<void>}
 */
async function expirePurchasedTokens(userId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const lockResult = await client.query(
      'SELECT monthly_remaining, purchased_balance FROM token_balances WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (lockResult.rows.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const { monthly_remaining, purchased_balance } = lockResult.rows[0];

    if (purchased_balance === 0) {
      await client.query('COMMIT');
      return;
    }

    await client.query(`
      UPDATE token_balances
      SET purchased_balance    = 0,
          purchased_expires_at = NULL,
          updated_at           = NOW()
      WHERE user_id = $1
    `, [userId]);

    const balanceAfter = monthly_remaining; // purchased is now 0

    await client.query(`
      INSERT INTO token_transactions (user_id, type, amount, balance_after, reference_type)
      VALUES ($1, 'purchased_expire', $2, $3, 'system')
    `, [userId, -purchased_balance, balanceAfter]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Expire tokens on subscription cancellation.
 *
 * Only monthly_remaining is wiped. Purchased tokens (and their
 * purchased_expires_at clock) persist after cancellation — they
 * survive until the 12-month rolling window elapses.
 *
 * No-op (no ledger entry) if row missing or monthly_remaining already 0.
 *
 * @param {number} userId
 * @returns {Promise<void>}
 */
async function expireOnCancellation(userId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const lockResult = await client.query(
      'SELECT monthly_remaining, purchased_balance FROM token_balances WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (lockResult.rows.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const { monthly_remaining, purchased_balance } = lockResult.rows[0];

    if (monthly_remaining === 0) {
      await client.query('COMMIT');
      return;
    }

    await client.query(`
      UPDATE token_balances
      SET monthly_remaining = 0, updated_at = NOW()
      WHERE user_id = $1
    `, [userId]);

    const balanceAfter = purchased_balance; // monthly is now 0, purchased untouched

    await client.query(`
      INSERT INTO token_transactions (user_id, type, amount, balance_after, reference_type)
      VALUES ($1, 'monthly_expire', $2, $3, 'cancellation')
    `, [userId, -monthly_remaining, balanceAfter]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =============================================================================
// REFUND
// =============================================================================

/**
 * Refund citation test tokens to a user's purchased_balance.
 *
 * Opens its own connection — never uses a caller-supplied client so the
 * refund commits independently even if the caller is in an error state.
 * Does NOT reset purchased_expires_at (this is a refund, not a purchase).
 *
 * @param {number} userId
 * @param {number} amount - Must be > 0
 * @param {string|null} referenceId - The citation_test_runs.id as a string
 * @returns {Promise<{monthly_remaining:number, purchased_balance:number, total_available:number}>}
 */
async function refundCitationTokens(userId, amount, referenceId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Lock row
    await client.query(
      'SELECT 1 FROM token_balances WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    // Credit purchased_balance — no expiry clock reset
    await client.query(
      `UPDATE token_balances
         SET purchased_balance = purchased_balance + $2, updated_at = NOW()
       WHERE user_id = $1`,
      [userId, amount]
    );

    // Read authoritative balances
    const row = await client.query(
      'SELECT monthly_remaining, purchased_balance FROM token_balances WHERE user_id = $1',
      [userId]
    );
    const { monthly_remaining, purchased_balance } = row.rows[0];
    const balanceAfter = monthly_remaining + purchased_balance;

    // Ledger entry
    await client.query(
      `INSERT INTO token_transactions (user_id, type, amount, balance_after, reference_type, reference_id)
       VALUES ($1, 'refund', $2, $3, 'citation_test_refund', $4)`,
      [userId, amount, balanceAfter, referenceId]
    );

    await client.query('COMMIT');
    console.log(`[TokenRefund] user_id=${userId} amount=${amount} referenceId=${referenceId}`);

    return { monthly_remaining, purchased_balance, total_available: balanceAfter };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  getBalance,
  grantMonthlyTokens,
  creditPurchasedTokens,
  spendTokens,
  expireMonthlyTokens,
  expirePurchasedTokens,
  expireOnCancellation,
  refundCitationTokens
};
