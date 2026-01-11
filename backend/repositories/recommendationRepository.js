/**
 * Recommendation Repository
 *
 * THE SINGLE SOURCE OF TRUTH for recommendation data access.
 *
 * Key patterns:
 * 1. COALESCE for legacy → canonical field mapping on SELECT
 * 2. Write to canonical columns ONLY on INSERT/UPDATE
 * 3. Never rename or drop legacy columns
 *
 * Legacy → Canonical mapping:
 * - unlocked_at → surfaced_at
 * - marked_complete_at → implemented_at
 * - skip_enabled_at → skip_available_at
 */

const db = require('../db/database');

/**
 * CANONICAL SELECT with legacy fallbacks via COALESCE
 *
 * IMPORTANT:
 * - surfaced_at falls back to unlocked_at
 * - implemented_at falls back to marked_complete_at
 * - skip_available_at falls back to skip_enabled_at, then computed from surfaced_at
 * - pillar_key falls back to category
 */
const CANONICAL_SELECT = `
  id,
  scan_id,
  organization_id,
  domain_id,
  COALESCE(pillar_key, category) AS pillar_key,
  category,

  -- Lifecycle (Doc 17) with legacy fallbacks
  unlock_state,
  rec_type,
  batch_number,
  priority_score,
  COALESCE(surfaced_at, unlocked_at) AS surfaced_at,
  COALESCE(implemented_at, marked_complete_at) AS implemented_at,
  COALESCE(
    skip_available_at,
    skip_enabled_at,
    COALESCE(surfaced_at, unlocked_at) + INTERVAL '120 hours'
  ) AS skip_available_at,
  skipped_at,
  dismissed_at,
  resurface_at,

  -- Content (Doc 18) - use marketing_copy as primary
  title,
  marketing_copy,
  technical_copy,
  exec_copy,
  why_it_matters,
  what_to_do,
  how_to_do,

  -- Evidence/Traceability (Doc 18)
  evidence,
  dedup_key,
  cluster_id,
  secondary_pillars,
  confidence_score,
  engine_version,

  -- KB Enrichment (Doc 18)
  suggested_faqs,
  suggested_certifications,
  suggested_schema,
  industry_enrichment_applied,
  company_type_applied,

  -- Timestamps
  created_at,
  updated_at
`;

/**
 * Default ordering for stability
 */
const DEFAULT_ORDER = `ORDER BY priority_score DESC NULLS LAST, id ASC`;

/**
 * Default limit to prevent returning thousands of rows
 */
const DEFAULT_LIMIT = 200;

// ============================================================================
// READ OPERATIONS
// ============================================================================

/**
 * Get recommendations by scan ID
 */
async function getByScanId(scanId, options = {}) {
  const { limit = DEFAULT_LIMIT } = options;

  const { rows } = await db.query(`
    SELECT ${CANONICAL_SELECT}
    FROM scan_recommendations
    WHERE scan_id = $1
    ${DEFAULT_ORDER}
    LIMIT $2
  `, [scanId, limit]);

  return {
    recommendations: rows.map(serializeRecommendation),
    returned_count: rows.length,
    limit_applied: limit
  };
}

/**
 * Get recommendations by organization and domain (canonical scope)
 */
async function getByOrgAndDomain(orgId, domainId, options = {}) {
  const { unlockState, limit = DEFAULT_LIMIT } = options;

  let query = `
    SELECT ${CANONICAL_SELECT}
    FROM scan_recommendations
    WHERE organization_id = $1
      AND domain_id = $2
  `;
  const params = [orgId, domainId];

  if (unlockState) {
    query += ` AND unlock_state = $${params.length + 1}`;
    params.push(unlockState);
  }

  query += ` ${DEFAULT_ORDER} LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await db.query(query, params);

  // Get total count for metadata
  const countQuery = `
    SELECT COUNT(*) as total
    FROM scan_recommendations
    WHERE organization_id = $1 AND domain_id = $2
    ${unlockState ? 'AND unlock_state = $3' : ''}
  `;
  const countParams = unlockState ? [orgId, domainId, unlockState] : [orgId, domainId];
  const { rows: countRows } = await db.query(countQuery, countParams);

  return {
    recommendations: rows.map(serializeRecommendation),
    returned_count: rows.length,
    total_count: parseInt(countRows[0].total),
    limit_applied: limit
  };
}

/**
 * Get active recommendations
 */
async function getActiveRecommendations(orgId, domainId, limit = DEFAULT_LIMIT) {
  return getByOrgAndDomain(orgId, domainId, { unlockState: 'active', limit });
}

/**
 * Get locked pool (available for surfacing)
 */
async function getLockedPool(orgId, domainId, limit = 50) {
  return getByOrgAndDomain(orgId, domainId, { unlockState: 'locked', limit });
}

/**
 * Get single recommendation by ID
 */
async function getById(recId) {
  const { rows } = await db.query(`
    SELECT ${CANONICAL_SELECT}
    FROM scan_recommendations
    WHERE id = $1
  `, [recId]);

  return rows.length > 0 ? serializeRecommendation(rows[0]) : null;
}

/**
 * Get recommendations for a user's scan (with user ownership check)
 */
async function getByScanIdForUser(scanId, userId, options = {}) {
  const { limit = DEFAULT_LIMIT } = options;

  const { rows } = await db.query(`
    SELECT ${CANONICAL_SELECT}
    FROM scan_recommendations sr
    JOIN scans s ON sr.scan_id = s.id
    WHERE sr.scan_id = $1 AND s.user_id = $2
    ${DEFAULT_ORDER}
    LIMIT $3
  `, [scanId, userId, limit]);

  return {
    recommendations: rows.map(serializeRecommendation),
    returned_count: rows.length,
    limit_applied: limit
  };
}

// ============================================================================
// LIFECYCLE TRANSITIONS - Write to CANONICAL columns ONLY
// ============================================================================

/**
 * Surface a recommendation (locked → active)
 *
 * Sets:
 * - unlock_state = 'active'
 * - surfaced_at = NOW()
 * - skip_available_at = NOW() + 120 hours (5 days)
 * - batch_number = provided value
 */
async function markAsActive(recId, batchNumber) {
  const { rows } = await db.query(`
    UPDATE scan_recommendations
    SET
      unlock_state = 'active',
      surfaced_at = NOW(),
      skip_available_at = NOW() + INTERVAL '120 hours',
      batch_number = $2,
      updated_at = NOW()
    WHERE id = $1
      AND unlock_state = 'locked'
    RETURNING id
  `, [recId, batchNumber]);

  return rows.length > 0;
}

/**
 * Mark as implemented (active → implemented)
 *
 * Sets:
 * - unlock_state = 'implemented'
 * - implemented_at = NOW()
 */
async function markAsImplemented(recId) {
  const { rows } = await db.query(`
    UPDATE scan_recommendations
    SET
      unlock_state = 'implemented',
      implemented_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
      AND unlock_state = 'active'
    RETURNING id
  `, [recId]);

  return rows.length > 0;
}

/**
 * Mark as skipped (active → skipped)
 *
 * IMPORTANT: Only allowed if skip_available_at exists AND has passed.
 * MUST NOT allow immediate skip when skip date is NULL.
 *
 * Sets:
 * - unlock_state = 'skipped'
 * - skipped_at = NOW()
 * - resurface_at = NOW() + 30 days
 */
async function markAsSkipped(recId) {
  const { rows } = await db.query(`
    UPDATE scan_recommendations
    SET
      unlock_state = 'skipped',
      skipped_at = NOW(),
      resurface_at = NOW() + INTERVAL '30 days',
      updated_at = NOW()
    WHERE id = $1
      AND unlock_state = 'active'
      AND COALESCE(skip_available_at, skip_enabled_at) IS NOT NULL
      AND COALESCE(skip_available_at, skip_enabled_at) <= NOW()
    RETURNING id
  `, [recId]);

  return rows.length > 0;
}

/**
 * Check if a recommendation can be skipped
 * Returns { canSkip, reason, skipAvailableAt }
 */
async function canSkip(recId) {
  const { rows } = await db.query(`
    SELECT
      unlock_state,
      COALESCE(skip_available_at, skip_enabled_at) AS skip_available_at
    FROM scan_recommendations
    WHERE id = $1
  `, [recId]);

  if (rows.length === 0) {
    return { canSkip: false, reason: 'Recommendation not found' };
  }

  const rec = rows[0];

  if (rec.unlock_state !== 'active') {
    return { canSkip: false, reason: `Cannot skip: recommendation is ${rec.unlock_state}, not active` };
  }

  if (!rec.skip_available_at) {
    return { canSkip: false, reason: 'Cannot skip: skip date not set' };
  }

  const skipDate = new Date(rec.skip_available_at);
  const now = new Date();

  if (skipDate > now) {
    return {
      canSkip: false,
      reason: `Cannot skip yet: available at ${skipDate.toISOString()}`,
      skipAvailableAt: skipDate
    };
  }

  return { canSkip: true, skipAvailableAt: skipDate };
}

/**
 * Mark as dismissed (active → dismissed)
 *
 * Sets:
 * - unlock_state = 'dismissed'
 * - dismissed_at = NOW()
 */
async function markAsDismissed(recId) {
  const { rows } = await db.query(`
    UPDATE scan_recommendations
    SET
      unlock_state = 'dismissed',
      dismissed_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
      AND unlock_state = 'active'
    RETURNING id
  `, [recId]);

  return rows.length > 0;
}

// ============================================================================
// SERIALIZER - Canonical API shape ONLY
// ============================================================================

/**
 * Transform DB row to canonical API shape
 *
 * NEVER returns:
 * - unlocked_at
 * - marked_complete_at
 * - skip_enabled_at
 */
function serializeRecommendation(row) {
  if (!row) return null;

  const skipAvailableAt = row.skip_available_at ? new Date(row.skip_available_at) : null;
  const now = new Date();

  return {
    id: row.id,
    scan_id: row.scan_id,
    organization_id: row.organization_id,
    domain_id: row.domain_id,
    pillar_key: row.pillar_key,
    category: row.category, // Keep for backward compat

    // Lifecycle (CANONICAL NAMES ONLY)
    unlock_state: row.unlock_state,
    rec_type: row.rec_type || 'actionable',
    batch_number: row.batch_number,
    priority_score: row.priority_score || 0,
    surfaced_at: row.surfaced_at,
    implemented_at: row.implemented_at,
    skip_available_at: row.skip_available_at,
    skipped_at: row.skipped_at,
    dismissed_at: row.dismissed_at,
    resurface_at: row.resurface_at,

    // Computed flags for UI
    can_skip: row.unlock_state === 'active' &&
              skipAvailableAt !== null &&
              skipAvailableAt <= now,
    is_active: row.unlock_state === 'active',
    is_locked: row.unlock_state === 'locked',
    is_implemented: row.unlock_state === 'implemented',
    is_skipped: row.unlock_state === 'skipped',
    is_dismissed: row.unlock_state === 'dismissed',

    // Content (use marketing_copy as primary text)
    title: row.title,
    recommendation_text: row.marketing_copy, // Derived, not from DB column
    marketing_copy: row.marketing_copy,
    technical_copy: row.technical_copy,
    exec_copy: row.exec_copy,
    why_it_matters: row.why_it_matters,
    what_to_do: row.what_to_do,
    how_to_do: row.how_to_do,

    // Evidence
    evidence: row.evidence || {},
    dedup_key: row.dedup_key,
    cluster_id: row.cluster_id,
    confidence_score: row.confidence_score,
    engine_version: row.engine_version,

    // KB enrichment
    suggested_faqs: row.suggested_faqs,
    suggested_certifications: row.suggested_certifications,
    suggested_schema: row.suggested_schema,
    industry_enrichment_applied: row.industry_enrichment_applied || false,
    company_type_applied: row.company_type_applied,

    // Timestamps
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

module.exports = {
  // Constants
  CANONICAL_SELECT,
  DEFAULT_LIMIT,

  // Read operations
  getByScanId,
  getByScanIdForUser,
  getByOrgAndDomain,
  getActiveRecommendations,
  getLockedPool,
  getById,

  // Lifecycle transitions
  markAsActive,
  markAsImplemented,
  markAsSkipped,
  markAsDismissed,
  canSkip,

  // Serialization
  serializeRecommendation
};
