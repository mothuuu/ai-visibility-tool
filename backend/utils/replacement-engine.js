const db = require('../db/database');

/**
 * Recommendation Replacement Engine
 *
 * Handles the 5-day replacement cycle:
 * - Checks if replacement is due
 * - Counts actioned (completed/skipped) recommendations
 * - Unlocks next highest-priority locked recommendations to maintain target active count
 */

/**
 * Check if replacement is due and execute if needed
 *
 * @param {number} userId - User ID
 * @param {number} scanId - Scan ID
 * @returns {Object} Replacement results
 */
async function checkAndExecuteReplacement(userId, scanId) {
  try {
    console.log(`[Replacement] Checking replacement for user ${userId}, scan ${scanId}`);

    // Get user progress
    const progressResult = await db.query(
      `SELECT * FROM user_progress WHERE user_id = $1 AND scan_id = $2`,
      [userId, scanId]
    );

    if (progressResult.rows.length === 0) {
      console.log(`[Replacement] No progress record found`);
      return {
        replaced: false,
        reason: 'no_progress_record'
      };
    }

    const progress = progressResult.rows[0];

    // Check if new columns exist (migration has been run)
    if (!progress.hasOwnProperty('next_replacement_date')) {
      console.log(`[Replacement] Migration not run yet - next_replacement_date column missing`);
      return {
        replaced: false,
        reason: 'migration_not_run'
      };
    }

    const now = new Date();
    const nextReplacementDate = progress.next_replacement_date
      ? new Date(progress.next_replacement_date)
      : null;

    // Check if replacement is due
    if (!nextReplacementDate || nextReplacementDate > now) {
      const daysRemaining = nextReplacementDate
        ? Math.ceil((nextReplacementDate - now) / (1000 * 60 * 60 * 24))
        : null;

      console.log(`[Replacement] Not due yet. Days remaining: ${daysRemaining}`);
      return {
        replaced: false,
        reason: 'not_due_yet',
        daysRemaining,
        nextReplacementDate: nextReplacementDate?.toISOString()
      };
    }

    console.log(`[Replacement] Replacement is DUE!`);

    // Execute replacement
    const result = await executeReplacement(userId, scanId, progress);

    // Update next replacement date
    const newNextReplacementDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // +5 days
    await db.query(
      `UPDATE user_progress
       SET last_replacement_date = $1,
           next_replacement_date = $2,
           recommendations_replaced_count = recommendations_replaced_count + $3
       WHERE user_id = $4 AND scan_id = $5`,
      [now, newNextReplacementDate, result.replacedCount, userId, scanId]
    );

    console.log(`[Replacement] Next replacement scheduled for: ${newNextReplacementDate.toISOString()}`);

    return {
      replaced: true,
      ...result,
      nextReplacementDate: newNextReplacementDate.toISOString()
    };

  } catch (error) {
    // Handle database errors gracefully
    if (error.code === '42703') { // Column does not exist
      console.log(`[Replacement] ⚠️  Column missing (migration not run) - skipping replacement check`);
      return {
        replaced: false,
        reason: 'migration_not_run',
        error: error.message
      };
    }

    console.error('[Replacement] Error:', error);
    throw error; // Re-throw other errors
  }
}

/**
 * Execute the replacement logic
 *
 * @param {number} userId - User ID
 * @param {number} scanId - Scan ID
 * @param {Object} progress - User progress object
 * @returns {Object} Replacement results
 */
async function executeReplacement(userId, scanId, progress) {
  const targetActiveCount = progress.target_active_count || 5;

  // Count current active recommendations
  const activeCountResult = await db.query(
    `SELECT COUNT(*) as count
     FROM scan_recommendations
     WHERE scan_id = $1 AND unlock_state = 'active'`,
    [scanId]
  );

  const currentActiveCount = parseInt(activeCountResult.rows[0].count);
  const slotsToFill = targetActiveCount - currentActiveCount;

  console.log(`[Replacement] Current active: ${currentActiveCount}, Target: ${targetActiveCount}, Slots to fill: ${slotsToFill}`);

  if (slotsToFill <= 0) {
    console.log(`[Replacement] No slots to fill`);
    return {
      replacedCount: 0,
      reason: 'no_slots_to_fill',
      currentActiveCount,
      targetActiveCount
    };
  }

  // Get next highest-priority locked recommendations
  const lockedRecsResult = await db.query(
    `SELECT id, category, recommendation_text, priority, batch_number
     FROM scan_recommendations
     WHERE scan_id = $1
       AND unlock_state = 'locked'
     ORDER BY priority DESC, id ASC
     LIMIT $2`,
    [scanId, slotsToFill]
  );

  const lockedRecs = lockedRecsResult.rows;

  if (lockedRecs.length === 0) {
    console.log(`[Replacement] No locked recommendations available`);
    return {
      replacedCount: 0,
      reason: 'no_locked_recommendations',
      currentActiveCount,
      targetActiveCount
    };
  }

  // Unlock the selected recommendations
  // Write to CANONICAL columns only (surfaced_at, skip_available_at)
  const recIds = lockedRecs.map(r => r.id);
  const now = new Date();
  const skipAvailableAt = new Date(now.getTime() + 120 * 60 * 60 * 1000); // +120 hours (5 days)

  await db.query(
    `UPDATE scan_recommendations
     SET unlock_state = 'active',
         surfaced_at = $1,
         skip_available_at = $2,
         updated_at = NOW()
     WHERE id = ANY($3)`,
    [now, skipAvailableAt, recIds]
  );

  // Update user progress
  await db.query(
    `UPDATE user_progress
     SET active_recommendations = active_recommendations + $1
     WHERE user_id = $2 AND scan_id = $3`,
    [lockedRecs.length, userId, scanId]
  );

  console.log(`[Replacement] Unlocked ${lockedRecs.length} recommendations:`);
  lockedRecs.forEach(rec => {
    console.log(`   - ${rec.recommendation_text.substring(0, 60)}... (Priority: ${rec.priority})`);
  });

  return {
    replacedCount: lockedRecs.length,
    unlockedRecommendations: lockedRecs,
    currentActiveCount: currentActiveCount + lockedRecs.length,
    targetActiveCount
  };
}

/**
 * Force immediate replacement (for testing or manual trigger)
 *
 * @param {number} userId - User ID
 * @param {number} scanId - Scan ID
 * @returns {Object} Replacement results
 */
async function forceReplacement(userId, scanId) {
  console.log(`[Replacement] FORCED replacement for user ${userId}, scan ${scanId}`);

  const progressResult = await db.query(
    `SELECT * FROM user_progress WHERE user_id = $1 AND scan_id = $2`,
    [userId, scanId]
  );

  if (progressResult.rows.length === 0) {
    throw new Error('No progress record found');
  }

  const progress = progressResult.rows[0];
  const result = await executeReplacement(userId, scanId, progress);

  // Update dates
  const now = new Date();
  const newNextReplacementDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

  await db.query(
    `UPDATE user_progress
     SET last_replacement_date = $1,
         next_replacement_date = $2,
         recommendations_replaced_count = recommendations_replaced_count + $3
     WHERE user_id = $4 AND scan_id = $5`,
    [now, newNextReplacementDate, result.replacedCount, userId, scanId]
  );

  return {
    ...result,
    forced: true,
    nextReplacementDate: newNextReplacementDate.toISOString()
  };
}

/**
 * Calculate next replacement date based on last unlock
 *
 * @param {Date} lastUnlockDate - Last unlock date
 * @returns {Date} Next replacement date
 */
function calculateNextReplacementDate(lastUnlockDate) {
  const date = lastUnlockDate ? new Date(lastUnlockDate) : new Date();
  return new Date(date.getTime() + 5 * 24 * 60 * 60 * 1000); // +5 days
}

module.exports = {
  checkAndExecuteReplacement,
  forceReplacement,
  calculateNextReplacementDate,
  executeReplacement
};
