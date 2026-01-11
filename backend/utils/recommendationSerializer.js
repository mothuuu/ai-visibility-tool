/**
 * Recommendation Serializer
 *
 * Ensures API responses use canonical field names only.
 * Legacy columns (unlocked_at, marked_complete_at) are mapped
 * in the repository layer via COALESCE.
 *
 * This serializer outputs:
 * - surfaced_at (NOT unlocked_at)
 * - implemented_at (NOT marked_complete_at)
 */

/**
 * Serialize a single recommendation for API response
 */
function serializeRecommendation(row) {
  if (!row) return null;

  return {
    id: row.id,
    scan_id: row.scan_id,
    organization_id: row.organization_id,
    domain_id: row.domain_id,
    pillar_key: row.pillar_key,
    category: row.category,

    // Lifecycle (canonical names only)
    unlock_state: row.unlock_state,
    rec_type: row.rec_type || 'actionable',
    batch_number: row.batch_number,
    surfaced_at: row.surfaced_at,           // COALESCE'd in repository
    implemented_at: row.implemented_at,     // COALESCE'd in repository
    skip_available_at: row.skip_available_at,
    skipped_at: row.skipped_at,
    dismissed_at: row.dismissed_at,
    resurface_at: row.resurface_at,
    priority_score: row.priority_score || 0,

    // Computed fields
    can_skip: row.unlock_state === 'active' &&
              row.skip_available_at &&
              new Date(row.skip_available_at) <= new Date(),

    // Content
    title: row.title,
    marketing_copy: row.marketing_copy,
    technical_copy: row.technical_copy,
    exec_copy: row.exec_copy,
    why_it_matters: row.why_it_matters,
    what_to_do: row.what_to_do,
    how_to_do: row.how_to_do,

    // Evidence & metadata
    evidence: row.evidence || {},
    dedup_key: row.dedup_key,
    cluster_id: row.cluster_id,
    confidence_score: row.confidence_score,
    engine_version: row.engine_version,

    // KB enrichment
    suggested_faqs: row.suggested_faqs,
    suggested_certifications: row.suggested_certifications,
    suggested_schema: row.suggested_schema,
    secondary_pillars: row.secondary_pillars,

    // Enrichment flags
    industry_enrichment_applied: row.industry_enrichment_applied || false,
    company_type_applied: row.company_type_applied,

    // Timestamps
    created_at: row.created_at
  };
}

/**
 * Serialize multiple recommendations
 */
function serializeRecommendations(rows) {
  if (!rows || !Array.isArray(rows)) return [];
  return rows.map(serializeRecommendation);
}

/**
 * Serialize recommendation with minimal fields (for list views)
 */
function serializeRecommendationSummary(row) {
  if (!row) return null;

  return {
    id: row.id,
    category: row.category,
    pillar_key: row.pillar_key,
    unlock_state: row.unlock_state,
    rec_type: row.rec_type || 'actionable',
    priority_score: row.priority_score || 0,
    title: row.title,
    marketing_copy: row.marketing_copy,
    surfaced_at: row.surfaced_at,
    can_skip: row.unlock_state === 'active' &&
              row.skip_available_at &&
              new Date(row.skip_available_at) <= new Date()
  };
}

/**
 * Serialize recommendations grouped by state
 */
function serializeGroupedByState(counts, active, implemented, skipped) {
  return {
    counts: {
      total: counts.total,
      locked: counts.locked,
      active: counts.active,
      implemented: counts.implemented,
      skipped: counts.skipped,
      dismissed: counts.dismissed
    },
    active: serializeRecommendations(active),
    implemented: serializeRecommendations(implemented),
    skipped: serializeRecommendations(skipped)
  };
}

/**
 * Serialize progress record
 */
function serializeProgress(progress) {
  if (!progress) return null;

  return {
    organization_id: progress.organization_id,
    domain_id: progress.domain_id,
    cycle_number: progress.cycle_number,
    cycle_started_at: progress.cycle_started_at,
    next_cycle_at: progress.next_cycle_at,
    batch_size: progress.batch_size,
    cycle_days: progress.cycle_days,
    surfaced_in_cycle: progress.surfaced_in_cycle,
    can_surface_more: progress.surfaced_in_cycle < progress.batch_size
  };
}

module.exports = {
  serializeRecommendation,
  serializeRecommendations,
  serializeRecommendationSummary,
  serializeGroupedByState,
  serializeProgress
};
