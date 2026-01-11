/**
 * Recommendation Repository
 *
 * THE SINGLE SOURCE OF TRUTH for recommendation data access.
 *
 * Key patterns:
 * 1. COALESCE for legacy → canonical field mapping on SELECT
 * 2. Write to canonical columns only on INSERT/UPDATE
 * 3. Never rename or drop legacy columns
 *
 * Legacy → Canonical mapping:
 * - unlocked_at → surfaced_at
 * - marked_complete_at → implemented_at
 */

const db = require('../db/database');

// Canonical SELECT with legacy fallback
const CANONICAL_SELECT = `
  id,
  scan_id,
  organization_id,
  domain_id,
  pillar_key,
  category,
  unlock_state,
  rec_type,
  batch_number,
  COALESCE(surfaced_at, unlocked_at) AS surfaced_at,
  COALESCE(implemented_at, marked_complete_at) AS implemented_at,
  skip_available_at,
  skipped_at,
  dismissed_at,
  resurface_at,
  priority_score,
  title,
  marketing_copy,
  technical_copy,
  exec_copy,
  why_it_matters,
  what_to_do,
  how_to_do,
  evidence,
  dedup_key,
  cluster_id,
  confidence_score,
  engine_version,
  suggested_faqs,
  suggested_certifications,
  suggested_schema,
  secondary_pillars,
  industry_enrichment_applied,
  company_type_applied,
  created_at
`;

/**
 * Get active recommendations for an organization/domain
 */
async function getActiveRecommendations(orgId, domainId) {
  const { rows } = await db.query(`
    SELECT ${CANONICAL_SELECT}
    FROM scan_recommendations
    WHERE organization_id = $1
      AND domain_id = $2
      AND unlock_state = 'active'
    ORDER BY priority_score DESC
  `, [orgId, domainId]);

  return rows;
}

/**
 * Get locked pool for surfacing
 */
async function getLockedPool(orgId, domainId, limit = 50) {
  const { rows } = await db.query(`
    SELECT ${CANONICAL_SELECT}
    FROM scan_recommendations
    WHERE organization_id = $1
      AND domain_id = $2
      AND unlock_state = 'locked'
    ORDER BY priority_score DESC
    LIMIT $3
  `, [orgId, domainId, limit]);

  return rows;
}

/**
 * Get recommendations by state
 */
async function getRecommendationsByState(orgId, domainId, state) {
  const { rows } = await db.query(`
    SELECT ${CANONICAL_SELECT}
    FROM scan_recommendations
    WHERE organization_id = $1
      AND domain_id = $2
      AND unlock_state = $3
    ORDER BY priority_score DESC
  `, [orgId, domainId, state]);

  return rows;
}

/**
 * Get a single recommendation by ID
 */
async function getRecommendationById(recId) {
  const { rows } = await db.query(`
    SELECT ${CANONICAL_SELECT}
    FROM scan_recommendations
    WHERE id = $1
  `, [recId]);

  return rows[0] || null;
}

/**
 * Get recommendations for a scan
 */
async function getRecommendationsForScan(scanId) {
  const { rows } = await db.query(`
    SELECT ${CANONICAL_SELECT}
    FROM scan_recommendations
    WHERE scan_id = $1
    ORDER BY priority_score DESC
  `, [scanId]);

  return rows;
}

/**
 * Count recommendations by state
 */
async function countByState(orgId, domainId) {
  const { rows } = await db.query(`
    SELECT
      unlock_state,
      COUNT(*) as count
    FROM scan_recommendations
    WHERE organization_id = $1
      AND domain_id = $2
    GROUP BY unlock_state
  `, [orgId, domainId]);

  const counts = {
    locked: 0,
    active: 0,
    implemented: 0,
    skipped: 0,
    dismissed: 0,
    total: 0
  };

  for (const row of rows) {
    counts[row.unlock_state] = parseInt(row.count, 10);
    counts.total += parseInt(row.count, 10);
  }

  return counts;
}

// ============================================================================
// LIFECYCLE TRANSITIONS - Write to canonical columns only
// ============================================================================

/**
 * Surface a recommendation (locked → active)
 */
async function markAsActive(recId, batchNumber) {
  const { rows } = await db.query(`
    UPDATE scan_recommendations
    SET
      unlock_state = 'active',
      surfaced_at = NOW(),
      skip_available_at = NOW() + INTERVAL '120 hours',
      batch_number = $2
    WHERE id = $1
      AND unlock_state = 'locked'
    RETURNING id
  `, [recId, batchNumber]);

  return rows.length > 0;
}

/**
 * Mark as implemented (active → implemented)
 */
async function markAsImplemented(recId) {
  const { rows } = await db.query(`
    UPDATE scan_recommendations
    SET
      unlock_state = 'implemented',
      implemented_at = NOW()
    WHERE id = $1
      AND unlock_state = 'active'
    RETURNING id
  `, [recId]);

  return rows.length > 0;
}

/**
 * Mark as skipped (active → skipped)
 * Only allowed after skip_available_at has passed
 */
async function markAsSkipped(recId, resurfaceDays = 30) {
  const { rows } = await db.query(`
    UPDATE scan_recommendations
    SET
      unlock_state = 'skipped',
      skipped_at = NOW(),
      resurface_at = NOW() + INTERVAL '1 day' * $2
    WHERE id = $1
      AND unlock_state = 'active'
      AND COALESCE(skip_available_at, NOW()) <= NOW()
    RETURNING id
  `, [recId, resurfaceDays]);

  return rows.length > 0;
}

/**
 * Dismiss a recommendation (any state → dismissed)
 */
async function markAsDismissed(recId) {
  const { rows } = await db.query(`
    UPDATE scan_recommendations
    SET
      unlock_state = 'dismissed',
      dismissed_at = NOW()
    WHERE id = $1
      AND unlock_state != 'dismissed'
    RETURNING id
  `, [recId]);

  return rows.length > 0;
}

/**
 * Resurface a skipped recommendation (skipped → locked)
 */
async function resurfaceSkipped(recId) {
  const { rows } = await db.query(`
    UPDATE scan_recommendations
    SET
      unlock_state = 'locked',
      skipped_at = NULL,
      resurface_at = NULL
    WHERE id = $1
      AND unlock_state = 'skipped'
      AND resurface_at <= NOW()
    RETURNING id
  `, [recId]);

  return rows.length > 0;
}

/**
 * Get recommendations due for resurfacing
 */
async function getDueForResurface(orgId, domainId) {
  const { rows } = await db.query(`
    SELECT ${CANONICAL_SELECT}
    FROM scan_recommendations
    WHERE organization_id = $1
      AND domain_id = $2
      AND unlock_state = 'skipped'
      AND resurface_at <= NOW()
  `, [orgId, domainId]);

  return rows;
}

// ============================================================================
// RECOMMENDATION PROGRESS (org+domain scope)
// ============================================================================

/**
 * Get or create progress record for org+domain
 */
async function getOrCreateProgress(orgId, domainId, batchSize = 5, cycleDays = 5) {
  // Try to get existing
  let { rows } = await db.query(`
    SELECT * FROM recommendation_progress
    WHERE organization_id = $1 AND domain_id = $2
  `, [orgId, domainId]);

  if (rows.length > 0) {
    return rows[0];
  }

  // Create new
  const result = await db.query(`
    INSERT INTO recommendation_progress (
      organization_id, domain_id, batch_size, cycle_days
    ) VALUES ($1, $2, $3, $4)
    ON CONFLICT (organization_id, domain_id) DO UPDATE
      SET updated_at = NOW()
    RETURNING *
  `, [orgId, domainId, batchSize, cycleDays]);

  return result.rows[0];
}

/**
 * Check if cycle is due for advancement
 */
async function isCycleDue(orgId, domainId) {
  const { rows } = await db.query(`
    SELECT next_cycle_at <= NOW() as is_due
    FROM recommendation_progress
    WHERE organization_id = $1 AND domain_id = $2
  `, [orgId, domainId]);

  return rows.length > 0 && rows[0].is_due;
}

/**
 * Advance to next cycle
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

  return rows[0];
}

/**
 * Increment surfaced count in current cycle
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

  return rows[0];
}

module.exports = {
  CANONICAL_SELECT,

  // Read operations
  getActiveRecommendations,
  getLockedPool,
  getRecommendationsByState,
  getRecommendationById,
  getRecommendationsForScan,
  countByState,
  getDueForResurface,

  // Lifecycle transitions
  markAsActive,
  markAsImplemented,
  markAsSkipped,
  markAsDismissed,
  resurfaceSkipped,

  // Progress tracking
  getOrCreateProgress,
  isCycleDue,
  advanceCycle,
  incrementSurfacedCount
};
