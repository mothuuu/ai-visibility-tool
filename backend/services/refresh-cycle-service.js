/**
 * Refresh Cycle Service
 *
 * Handles the 5-day recommendation refresh cycle:
 * - Users receive top 5 recommendations initially
 * - Every 5 days, implemented/skipped recommendations are replaced
 * - Replacement happens during refresh cycle, not immediately
 * - New recommendations are pulled from the queue based on impact score
 */

const { Pool } = require('pg');
const ImpactScoreCalculator = require('./impact-score-calculator');
const NotificationService = require('./notification-service');

class RefreshCycleService {
  constructor(pool) {
    this.pool = pool || new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    this.REFRESH_CYCLE_DAYS = 5;
    this.ACTIVE_RECOMMENDATION_LIMIT = 5;
  }

  /**
   * Initialize refresh cycle for a new scan
   *
   * @param {Number} userId - User ID
   * @param {Number} scanId - Scan ID
   * @returns {Object} Refresh cycle record
   */
  async initializeRefreshCycle(userId, scanId) {
    const cycleStartDate = new Date();
    const cycleEndDate = new Date(cycleStartDate);
    cycleEndDate.setDate(cycleEndDate.getDate() + this.REFRESH_CYCLE_DAYS);

    const nextCycleDate = new Date(cycleEndDate);

    // Get active recommendations
    const activeRecs = await this.pool.query(`
      SELECT id
      FROM scan_recommendations
      WHERE scan_id = $1 AND unlock_state = 'active'
      ORDER BY impact_score DESC
      LIMIT $2
    `, [scanId, this.ACTIVE_RECOMMENDATION_LIMIT]);

    const activeRecIds = activeRecs.rows.map(r => r.id);

    // Create refresh cycle record
    const result = await this.pool.query(`
      INSERT INTO recommendation_refresh_cycles (
        user_id,
        scan_id,
        cycle_number,
        cycle_start_date,
        cycle_end_date,
        next_cycle_date,
        active_recommendation_ids
      )
      VALUES ($1, $2, 1, $3, $4, $5, $6)
      RETURNING *
    `, [
      userId,
      scanId,
      cycleStartDate,
      cycleEndDate,
      nextCycleDate,
      JSON.stringify(activeRecIds)
    ]);

    // Update recommendations with refresh dates
    await this.pool.query(`
      UPDATE scan_recommendations
      SET
        last_refresh_date = $1,
        next_refresh_date = $2,
        refresh_cycle_number = 1
      WHERE scan_id = $3
    `, [cycleStartDate, nextCycleDate, scanId]);

    return result.rows[0];
  }

  /**
   * Check if refresh cycle is due for a user
   *
   * @param {Number} userId - User ID
   * @returns {Array} Scans that need refresh
   */
  async checkDueRefreshCycles(userId = null) {
    let query = `
      SELECT DISTINCT
        rrc.id as cycle_id,
        rrc.user_id,
        rrc.scan_id,
        rrc.cycle_number,
        rrc.next_cycle_date,
        s.url,
        s.total_score
      FROM recommendation_refresh_cycles rrc
      JOIN scans s ON rrc.scan_id = s.id
      WHERE
        rrc.next_cycle_date <= CURRENT_DATE
        AND s.status = 'completed'
    `;

    const params = [];
    if (userId) {
      query += ' AND rrc.user_id = $1';
      params.push(userId);
    }

    query += ' ORDER BY rrc.next_cycle_date ASC';

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  /**
   * Process refresh cycle for a scan
   *
   * @param {Number} userId - User ID
   * @param {Number} scanId - Scan ID
   * @returns {Object} Refresh results
   */
  async processRefreshCycle(userId, scanId) {
    const client = await this.pool.connect();

    // === DIAGNOSTIC F: REFRESH CYCLE ===
    console.log('=== DIAGNOSTIC F: REFRESH CYCLE ===');
    console.log('Refresh cycle triggered: YES');
    console.log('User ID:', userId);
    console.log('Scan ID:', scanId);
    console.log('Current date:', new Date().toISOString());

    try {
      await client.query('BEGIN');

      // Get current refresh cycle
      const cycleResult = await client.query(`
        SELECT *
        FROM recommendation_refresh_cycles
        WHERE user_id = $1 AND scan_id = $2
        ORDER BY cycle_number DESC
        LIMIT 1
      `, [userId, scanId]);

      if (cycleResult.rows.length === 0) {
        console.log('No refresh cycle found for this scan');
        console.log('=== END DIAGNOSTIC F ===');
        throw new Error('No refresh cycle found for this scan');
      }

      const currentCycle = cycleResult.rows[0];
      console.log('Current cycle:', {
        cycle_number: currentCycle.cycle_number,
        next_cycle_date: currentCycle.next_cycle_date,
        cycle_start_date: currentCycle.cycle_start_date
      });
      console.log('Is refresh actually due?', new Date() >= new Date(currentCycle.next_cycle_date));

      // Get recommendations that need replacement (implemented or skipped)
      const needReplacement = await client.query(`
        SELECT *
        FROM scan_recommendations
        WHERE
          scan_id = $1
          AND status IN ('implemented', 'skipped')
          AND (last_refresh_date IS NULL OR last_refresh_date < $2)
        ORDER BY impact_score DESC
      `, [scanId, currentCycle.cycle_start_date]);

      const replacementCount = needReplacement.rows.length;
      console.log('Recommendations needing replacement:', replacementCount);
      console.log('Statuses of recs needing replacement:', needReplacement.rows.map(r => ({
        id: r.id,
        status: r.status,
        unlock_state: r.unlock_state
      })));

      if (replacementCount === 0) {
        console.log('No recommendations need replacement');
        console.log('=== END DIAGNOSTIC F ===');
        await this.extendCycle(client, currentCycle);
        await client.query('COMMIT');
        return {
          replaced: 0,
          message: 'No recommendations needed replacement. Cycle extended.'
        };
      }

      // Get locked recommendations to activate
      const availableRecs = await client.query(`
        SELECT *
        FROM scan_recommendations
        WHERE
          scan_id = $1
          AND unlock_state = 'locked'
          AND status = 'active'
        ORDER BY impact_score DESC
        LIMIT $2
      `, [scanId, replacementCount]);

      const newRecs = availableRecs.rows;

      // Archive old recommendations
      for (const oldRec of needReplacement.rows) {
        await client.query(`
          UPDATE scan_recommendations
          SET
            unlock_state = 'archived',
            archived_at = CURRENT_TIMESTAMP,
            archived_reason = $1
          WHERE id = $2
        `, [oldRec.status, oldRec.id]);
      }

      // Activate new recommendations
      const newRecIds = [];
      for (const newRec of newRecs) {
        await client.query(`
          UPDATE scan_recommendations
          SET
            unlock_state = 'active',
            unlocked_at = CURRENT_TIMESTAMP,
            last_refresh_date = CURRENT_DATE,
            next_refresh_date = CURRENT_DATE + INTERVAL '5 days',
            refresh_cycle_number = $1
          WHERE id = $2
        `, [currentCycle.cycle_number + 1, newRec.id]);

        newRecIds.push(newRec.id);

        // Record replacement
        await client.query(`
          INSERT INTO recommendation_replacements (
            user_id,
            scan_id,
            refresh_cycle_id,
            old_recommendation_id,
            new_recommendation_id,
            replacement_reason,
            old_impact_score,
            new_impact_score
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          userId,
          scanId,
          currentCycle.id,
          needReplacement.rows[newRecs.indexOf(newRec)]?.id || null,
          newRec.id,
          'refresh_cycle',
          needReplacement.rows[newRecs.indexOf(newRec)]?.impact_score || 0,
          newRec.impact_score
        ]);
      }

      // Create new cycle record
      const newCycleStartDate = new Date();
      const newCycleEndDate = new Date(newCycleStartDate);
      newCycleEndDate.setDate(newCycleEndDate.getDate() + this.REFRESH_CYCLE_DAYS);

      const newCycleNumber = currentCycle.cycle_number + 1;

      await client.query(`
        INSERT INTO recommendation_refresh_cycles (
          user_id,
          scan_id,
          cycle_number,
          cycle_start_date,
          cycle_end_date,
          next_cycle_date,
          active_recommendation_ids,
          implemented_count,
          skipped_count,
          replaced_count
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        userId,
        scanId,
        newCycleNumber,
        newCycleStartDate,
        newCycleEndDate,
        newCycleEndDate,
        JSON.stringify(newRecIds),
        needReplacement.rows.filter(r => r.status === 'implemented').length,
        needReplacement.rows.filter(r => r.status === 'skipped').length,
        newRecs.length
      ]);

      // Update user_progress
      await client.query(`
        UPDATE user_progress
        SET
          last_refresh_cycle_date = $1,
          next_refresh_cycle_date = $2
        WHERE user_id = $3 AND scan_id = $4
      `, [newCycleStartDate, newCycleEndDate, userId, scanId]);

      await client.query('COMMIT');

      // Send notification
      const notificationService = new NotificationService(this.pool);
      await notificationService.createRefreshCycleNotification(userId, scanId, {
        replaced_count: newRecs.length,
        new_recommendations: newRecs.map(r => r.title)
      });

      return {
        replaced: newRecs.length,
        cycleNumber: newCycleNumber,
        nextRefreshDate: newCycleEndDate,
        newRecommendations: newRecs.map(r => ({
          id: r.id,
          title: r.title,
          impact_score: r.impact_score
        }))
      };

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Refresh cycle processing failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Extend cycle if no replacements needed
   */
  async extendCycle(client, currentCycle) {
    const newEndDate = new Date(currentCycle.cycle_end_date);
    newEndDate.setDate(newEndDate.getDate() + this.REFRESH_CYCLE_DAYS);

    await client.query(`
      UPDATE recommendation_refresh_cycles
      SET
        next_cycle_date = $1
      WHERE id = $2
    `, [newEndDate, currentCycle.id]);
  }

  /**
   * Manually trigger refresh for a scan
   *
   * @param {Number} userId - User ID
   * @param {Number} scanId - Scan ID
   * @returns {Object} Refresh results
   */
  async manualRefresh(userId, scanId) {
    return await this.processRefreshCycle(userId, scanId);
  }

  /**
   * Get refresh cycle status for a scan
   *
   * @param {Number} userId - User ID
   * @param {Number} scanId - Scan ID
   * @returns {Object} Cycle status
   */
  async getRefreshStatus(userId, scanId) {
    const result = await this.pool.query(`
      SELECT
        cycle_number,
        cycle_start_date,
        cycle_end_date,
        next_cycle_date,
        active_recommendation_ids,
        implemented_count,
        skipped_count,
        replaced_count
      FROM recommendation_refresh_cycles
      WHERE user_id = $1 AND scan_id = $2
      ORDER BY cycle_number DESC
      LIMIT 1
    `, [userId, scanId]);

    if (result.rows.length === 0) {
      return null;
    }

    const cycle = result.rows[0];
    const today = new Date();
    const nextRefresh = new Date(cycle.next_cycle_date);
    const daysUntilRefresh = Math.ceil((nextRefresh - today) / (1000 * 60 * 60 * 24));

    return {
      currentCycle: cycle.cycle_number,
      startDate: cycle.cycle_start_date,
      endDate: cycle.cycle_end_date,
      nextRefreshDate: cycle.next_cycle_date,
      daysUntilRefresh: Math.max(0, daysUntilRefresh),
      activeRecommendationIds: cycle.active_recommendation_ids,
      stats: {
        implemented: cycle.implemented_count || 0,
        skipped: cycle.skipped_count || 0,
        replaced: cycle.replaced_count || 0
      }
    };
  }

  /**
   * Get all scans that need refresh (for cron job)
   *
   * @returns {Array} Scans needing refresh
   */
  async getAllDueRefreshCycles() {
    return await this.checkDueRefreshCycles();
  }

  /**
   * Process all due refresh cycles (for cron job)
   */
  async processAllDueRefreshCycles() {
    const dueCycles = await this.getAllDueRefreshCycles();

    console.log(`Processing ${dueCycles.length} due refresh cycles...`);

    const results = [];

    for (const cycle of dueCycles) {
      try {
        const result = await this.processRefreshCycle(cycle.user_id, cycle.scan_id);
        results.push({
          userId: cycle.user_id,
          scanId: cycle.scan_id,
          success: true,
          ...result
        });
      } catch (error) {
        console.error(`Failed to process refresh for user ${cycle.user_id}, scan ${cycle.scan_id}:`, error);
        results.push({
          userId: cycle.user_id,
          scanId: cycle.scan_id,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get replacement history for a scan
   */
  async getReplacementHistory(userId, scanId, limit = 20) {
    const result = await this.pool.query(`
      SELECT
        rr.replaced_at,
        rr.replacement_reason,
        old_rec.title as old_title,
        old_rec.impact_score as old_impact_score,
        new_rec.title as new_title,
        new_rec.impact_score as new_impact_score,
        rrc.cycle_number
      FROM recommendation_replacements rr
      LEFT JOIN scan_recommendations old_rec ON rr.old_recommendation_id = old_rec.id
      LEFT JOIN scan_recommendations new_rec ON rr.new_recommendation_id = new_rec.id
      LEFT JOIN recommendation_refresh_cycles rrc ON rr.refresh_cycle_id = rrc.id
      WHERE rr.user_id = $1 AND rr.scan_id = $2
      ORDER BY rr.replaced_at DESC
      LIMIT $3
    `, [userId, scanId, limit]);

    return result.rows;
  }
}

module.exports = RefreshCycleService;
