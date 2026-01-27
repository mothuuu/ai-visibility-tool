/**
 * Progress Repository
 *
 * Manages recommendation_progress records for org+domain scope.
 * This tracks surfacing cycles and batch limits per plan.
 *
 * Key patterns:
 * - org_id + domain_id is the canonical scope
 * - Plan limits determine batch_size and cycle_days
 * - cycle_number increments on each 5-day cycle
 */

const db = require('../db/database');

// ============================================================================
// CONSTANTS
// ============================================================================

const PLAN_LIMITS = {
  free: { batch_size: 3, cycle_days: 7 },
  starter: { batch_size: 5, cycle_days: 5 },
  diy: { batch_size: 5, cycle_days: 5 },
  pro: { batch_size: 8, cycle_days: 5 },
  enterprise: { batch_size: 15, cycle_days: 3 }
};

const DEFAULT_LIMITS = { batch_size: 5, cycle_days: 5 };

// ============================================================================
// READ OPERATIONS
// ============================================================================

/**
 * Get progress record for org+domain
 * Returns null if no record exists
 */
async function getProgress(orgId, domainId) {
  const { rows } = await db.query(`
    SELECT
      organization_id,
      domain_id,
      cycle_number,
      cycle_started_at,
      next_cycle_at,
      batch_size,
      cycle_days,
      surfaced_in_cycle,
      created_at,
      updated_at
    FROM recommendation_progress
    WHERE organization_id = $1 AND domain_id = $2
  `, [orgId, domainId]);

  return rows.length > 0 ? serializeProgress(rows[0]) : null;
}

/**
 * Get or create progress record
 * Uses plan limits to set batch_size and cycle_days
 */
async function getOrCreateProgress(orgId, domainId, planLimits = null) {
  const limits = planLimits || DEFAULT_LIMITS;
  const { batch_size, cycle_days } = limits;

  const { rows } = await db.query(`
    INSERT INTO recommendation_progress (
      organization_id,
      domain_id,
      batch_size,
      cycle_days,
      cycle_number,
      surfaced_in_cycle,
      cycle_started_at,
      next_cycle_at
    ) VALUES (
      $1, $2, $3, $4, 1, 0, NOW(), NOW() + INTERVAL '1 day' * $4
    )
    ON CONFLICT (organization_id, domain_id) DO UPDATE
      SET updated_at = NOW()
    RETURNING *
  `, [orgId, domainId, batch_size, cycle_days]);

  return serializeProgress(rows[0]);
}

/**
 * Check if more recommendations can be surfaced in current cycle
 */
async function canSurfaceMore(orgId, domainId) {
  const { rows } = await db.query(`
    SELECT
      surfaced_in_cycle,
      batch_size,
      next_cycle_at <= NOW() as cycle_due
    FROM recommendation_progress
    WHERE organization_id = $1 AND domain_id = $2
  `, [orgId, domainId]);

  if (rows.length === 0) {
    return { canSurface: true, reason: 'No progress record - will be created' };
  }

  const { surfaced_in_cycle, batch_size, cycle_due } = rows[0];

  // If cycle is due, we can surface (after advancing)
  if (cycle_due) {
    return {
      canSurface: true,
      reason: 'New cycle is due',
      cycleAdvanceRequired: true
    };
  }

  // Check if we've hit the batch limit
  if (surfaced_in_cycle >= batch_size) {
    return {
      canSurface: false,
      reason: `Batch limit reached (${surfaced_in_cycle}/${batch_size})`,
      surfacedInCycle: surfaced_in_cycle,
      batchSize: batch_size
    };
  }

  return {
    canSurface: true,
    reason: 'Within batch limit',
    surfacedInCycle: surfaced_in_cycle,
    batchSize: batch_size,
    remaining: batch_size - surfaced_in_cycle
  };
}

/**
 * Check if cycle should advance (next_cycle_at has passed)
 */
async function shouldAdvanceCycle(orgId, domainId) {
  const { rows } = await db.query(`
    SELECT next_cycle_at <= NOW() as is_due
    FROM recommendation_progress
    WHERE organization_id = $1 AND domain_id = $2
  `, [orgId, domainId]);

  return rows.length > 0 && rows[0].is_due;
}

// ============================================================================
// WRITE OPERATIONS
// ============================================================================

/**
 * Increment surfaced count in current cycle
 * Returns updated progress record
 */
async function incrementSurfacedCount(orgId, domainId, count = 1) {
  const { rows } = await db.query(`
    UPDATE recommendation_progress
    SET
      surfaced_in_cycle = surfaced_in_cycle + $3,
      updated_at = NOW()
    WHERE organization_id = $1 AND domain_id = $2
    RETURNING *
  `, [orgId, domainId, count]);

  return rows.length > 0 ? serializeProgress(rows[0]) : null;
}

/**
 * Advance to next cycle
 * Resets surfaced_in_cycle and increments cycle_number
 */
async function advanceCycle(orgId, domainId) {
  const { rows } = await db.query(`
    UPDATE recommendation_progress
    SET
      cycle_number = cycle_number + 1,
      cycle_started_at = NOW(),
      next_cycle_at = NOW() + INTERVAL '1 day' * cycle_days,
      surfaced_in_cycle = 0,
      updated_at = NOW()
    WHERE organization_id = $1 AND domain_id = $2
    RETURNING *
  `, [orgId, domainId]);

  return rows.length > 0 ? serializeProgress(rows[0]) : null;
}

/**
 * Update plan limits (when user upgrades/downgrades)
 */
async function updatePlanLimits(orgId, domainId, plan) {
  const limits = PLAN_LIMITS[plan] || DEFAULT_LIMITS;

  const { rows } = await db.query(`
    UPDATE recommendation_progress
    SET
      batch_size = $3,
      cycle_days = $4,
      updated_at = NOW()
    WHERE organization_id = $1 AND domain_id = $2
    RETURNING *
  `, [orgId, domainId, limits.batch_size, limits.cycle_days]);

  return rows.length > 0 ? serializeProgress(rows[0]) : null;
}

// ============================================================================
// SERIALIZER
// ============================================================================

/**
 * Serialize progress record for API response
 */
function serializeProgress(row) {
  if (!row) return null;

  return {
    organization_id: row.organization_id,
    domain_id: row.domain_id,
    cycle_number: row.cycle_number,
    cycle_started_at: row.cycle_started_at,
    next_cycle_at: row.next_cycle_at,
    batch_size: row.batch_size,
    cycle_days: row.cycle_days,
    surfaced_in_cycle: row.surfaced_in_cycle,
    can_surface_more: row.surfaced_in_cycle < row.batch_size,
    remaining_in_cycle: Math.max(0, row.batch_size - row.surfaced_in_cycle),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Constants
  PLAN_LIMITS,
  DEFAULT_LIMITS,

  // Read operations
  getProgress,
  getOrCreateProgress,
  canSurfaceMore,
  shouldAdvanceCycle,

  // Write operations
  incrementSurfacedCount,
  advanceCycle,
  updatePlanLimits,

  // Serialization
  serializeProgress
};
