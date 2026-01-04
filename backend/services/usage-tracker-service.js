/**
 * Usage Tracker Service
 *
 * Central service for tracking scan usage across the application.
 * This is the SINGLE SOURCE OF TRUTH for incrementing/checking scan counts.
 *
 * Why this exists:
 * - Prevents double-counting (middleware + route both incrementing)
 * - Failed scans are not counted
 * - Consistent handling across all scan endpoints
 * - Separates competitor scans from primary scans
 *
 * Phase 2C: Dual-write to usage_events table when USAGE_V2_DUAL_WRITE_ENABLED=true
 */

const db = require('../db/database');
const { USAGE_EVENT_TYPES, getScanEventType } = require('../constants/usageEventTypes');

/**
 * Check if v2 usage dual-write is enabled
 * @returns {boolean}
 */
function isUsageV2Enabled() {
  return process.env.USAGE_V2_DUAL_WRITE_ENABLED === 'true';
}

/**
 * Track a usage event in the v2 usage_events table.
 * This is NON-BLOCKING - errors are logged but don't fail the request.
 *
 * @param {Object} params
 * @param {string} params.eventType - Event type (from USAGE_EVENT_TYPES)
 * @param {number} params.userId - User ID (required, guests are skipped)
 * @param {number} params.organizationId - Organization ID (optional but recommended)
 * @param {number} params.scanId - Scan ID (optional)
 * @param {Object} params.metadata - Additional metadata (optional)
 * @returns {Promise<{success: boolean, eventId?: number}>}
 */
async function trackUsageEvent({ eventType, userId, organizationId, scanId, metadata = {} }) {
  // Skip if feature flag is disabled
  if (!isUsageV2Enabled()) {
    return { success: true, skipped: 'feature_disabled' };
  }

  // Skip guests (no userId)
  if (!userId) {
    return { success: true, skipped: 'guest_user' };
  }

  // Skip if no organization (required for usage_events)
  if (!organizationId) {
    return { success: true, skipped: 'no_organization' };
  }

  try {
    // Use the DB function that handles period creation automatically
    const result = await db.query(
      `SELECT * FROM record_usage_event($1, $2, $3, $4, $5)`,
      [
        organizationId,
        eventType,
        userId,
        scanId || null,
        JSON.stringify(metadata)
      ]
    );

    if (result.rows.length > 0) {
      return { success: true, eventId: result.rows[0].id };
    }

    return { success: true };
  } catch (error) {
    // Log one-line error (no secrets) and continue - don't fail the request
    console.error(`⚠️ Usage v2 dual-write failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

class UsageTrackerService {
  /**
   * Check if user can perform a scan (without incrementing)
   *
   * @param {Number} userId - User ID
   * @param {String} scanType - 'primary' or 'competitor'
   * @param {Object} limits - Plan limits object
   * @returns {Object} { allowed: boolean, used: number, limit: number, message?: string }
   */
  static async checkScanLimit(userId, scanType = 'primary', limits) {
    const user = await db.query(
      'SELECT scans_used_this_month, competitor_scans_used_this_month FROM users WHERE id = $1',
      [userId]
    );

    if (user.rows.length === 0) {
      return {
        allowed: false,
        used: 0,
        limit: 0,
        message: 'User not found'
      };
    }

    const userData = user.rows[0];

    if (scanType === 'competitor') {
      const used = userData.competitor_scans_used_this_month || 0;
      const limit = limits.competitorScans || 0;

      return {
        allowed: used < limit,
        used,
        limit,
        message: used >= limit
          ? `You've used ${used}/${limit} competitor scans this month.`
          : null
      };
    }

    // Primary scan
    const used = userData.scans_used_this_month || 0;
    const limit = limits.scansPerMonth || 0;

    return {
      allowed: used < limit,
      used,
      limit,
      message: used >= limit
        ? `You've used ${used}/${limit} scans this month.`
        : null
    };
  }

  /**
   * Increment scan usage AFTER a successful scan
   * This should ONLY be called after the scan completes successfully.
   *
   * @param {Number} userId - User ID
   * @param {String} scanType - 'primary' or 'competitor'
   * @returns {Object} { success: boolean, newCount: number }
   */
  static async incrementScanUsage(userId, scanType = 'primary') {
    try {
      let result;

      if (scanType === 'competitor') {
        result = await db.query(
          `UPDATE users
           SET competitor_scans_used_this_month = competitor_scans_used_this_month + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING competitor_scans_used_this_month as new_count`,
          [userId]
        );
      } else {
        result = await db.query(
          `UPDATE users
           SET scans_used_this_month = scans_used_this_month + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING scans_used_this_month as new_count`,
          [userId]
        );
      }

      if (result.rows.length === 0) {
        console.error(`⚠️ Usage increment failed: User ${userId} not found`);
        return { success: false, newCount: 0 };
      }

      console.log(`📊 Usage incremented: User ${userId}, Type: ${scanType}, New count: ${result.rows[0].new_count}`);

      return {
        success: true,
        newCount: result.rows[0].new_count
      };

    } catch (error) {
      console.error(`❌ Failed to increment scan usage for user ${userId}:`, error);
      return { success: false, newCount: 0, error: error.message };
    }
  }

  /**
   * Get current scan usage for a user
   *
   * @param {Number} userId - User ID
   * @returns {Object} { primary: { used, limit }, competitor: { used, limit } }
   */
  static async getScanUsage(userId, limits = null) {
    const user = await db.query(
      'SELECT scans_used_this_month, competitor_scans_used_this_month FROM users WHERE id = $1',
      [userId]
    );

    if (user.rows.length === 0) {
      return null;
    }

    const userData = user.rows[0];

    return {
      primary: {
        used: userData.scans_used_this_month || 0,
        limit: limits?.scansPerMonth || null
      },
      competitor: {
        used: userData.competitor_scans_used_this_month || 0,
        limit: limits?.competitorScans || null
      }
    };
  }

  /**
   * Reset scan usage (for monthly reset or admin override)
   *
   * @param {Number} userId - User ID
   * @param {String} scanType - 'primary', 'competitor', or 'all'
   */
  static async resetScanUsage(userId, scanType = 'all') {
    try {
      if (scanType === 'all') {
        await db.query(
          `UPDATE users
           SET scans_used_this_month = 0,
               competitor_scans_used_this_month = 0,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [userId]
        );
      } else if (scanType === 'competitor') {
        await db.query(
          `UPDATE users
           SET competitor_scans_used_this_month = 0,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [userId]
        );
      } else {
        await db.query(
          `UPDATE users
           SET scans_used_this_month = 0,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [userId]
        );
      }

      console.log(`🔄 Usage reset: User ${userId}, Type: ${scanType}`);
      return { success: true };

    } catch (error) {
      console.error(`❌ Failed to reset scan usage for user ${userId}:`, error);
      return { success: false, error: error.message };
    }
  }
}

// Export the class and the standalone functions for Phase 2C dual-write
module.exports = UsageTrackerService;
module.exports.trackUsageEvent = trackUsageEvent;
module.exports.isUsageV2Enabled = isUsageV2Enabled;
module.exports.USAGE_EVENT_TYPES = USAGE_EVENT_TYPES;
module.exports.getScanEventType = getScanEventType;
