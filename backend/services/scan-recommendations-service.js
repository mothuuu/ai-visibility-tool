/**
 * Phase 4A.2: Scan Recommendations Persistence Service
 *
 * Persists renderer output to scan_recommendations with idempotent upsert.
 * Handles both v2 columns and legacy column compatibility.
 *
 * Key features:
 * - Idempotent upserts via rec_key + ON CONFLICT
 * - Page-level targeting support via target_url hash
 * - Legacy column population for backward compatibility
 * - Safe JSON serialization (TEXT for action_steps, JSONB for others)
 * - Phase 4A.2.2: Plan-based unlock_state gating
 */

const crypto = require('crypto');
const db = require('../db/database');

// ========================================
// PLAN GATING (Phase 4A.2.2)
// ========================================

/**
 * Normalize user plan to known values
 * @param {string} plan - Raw plan value from database
 * @returns {string} - Normalized plan: 'free'|'freemium'|'diy'|'pro'|'agency'|'enterprise'
 */
function normalizePlan(plan) {
  if (!plan) return 'free';

  const normalized = String(plan).toLowerCase().trim();

  const knownPlans = ['free', 'freemium', 'diy', 'pro', 'agency', 'enterprise'];
  if (knownPlans.includes(normalized)) {
    return normalized;
  }

  // Handle common aliases (keep in sync with scanEntitlementService.js PLAN_ALIASES)
  const aliases = {
    'starter': 'diy',
    'basic': 'diy',
    'professional': 'pro',
    'business': 'enterprise',
    'team': 'agency',
    'teams': 'agency',
    // Metal-tier naming
    'gold': 'pro',
    'platinum': 'enterprise',
    'silver': 'diy',
    'bronze': 'free',
    // Prefixed variants
    'plan_gold': 'pro',
    'plan_platinum': 'enterprise',
    'plan_silver': 'diy',
    'plan_bronze': 'free',
    'tier_gold': 'pro',
    'tier_platinum': 'enterprise',
    'tier_silver': 'diy',
    'tier_bronze': 'free'
  };

  if (aliases[normalized]) {
    return aliases[normalized];
  }

  console.warn(`[ScanRecommendationsService] Unknown plan "${plan}", defaulting to free`);
  return 'free';
}

/**
 * Get unlock limit based on user plan
 * - free/freemium: 3 recommendations unlocked
 * - diy: 5 recommendations unlocked
 * - pro/agency/enterprise: unlimited (all unlocked)
 *
 * @param {string} plan - Normalized plan value
 * @returns {number} - Number of recommendations to unlock (Infinity for unlimited)
 */
function getUnlockLimit(plan) {
  const limits = {
    free: 3,
    freemium: 3,
    diy: 5,
    pro: Infinity,
    agency: Infinity,
    enterprise: Infinity
  };

  return limits[plan] ?? 3;
}

/**
 * Map priority string to numeric value for sorting
 * Handles both P0/P1/P2 and high/medium/low formats
 * @param {string} priority - Priority value
 * @returns {number} - Numeric priority (lower = higher priority)
 */
function priorityToNumeric(priority) {
  const map = {
    P0: 1,
    high: 1,
    P1: 2,
    medium: 2,
    P2: 3,
    low: 3
  };
  return map[priority] ?? 2; // Default to medium
}

/**
 * Compare recommendations for sorting (matches GET /api/scan/:id ordering)
 * Order: priority ASC (P0 first), confidence DESC, estimated_impact DESC
 *
 * @param {Object} a - First recommendation
 * @param {Object} b - Second recommendation
 * @returns {number} - Sort comparison result
 */
function compareRecommendations(a, b) {
  // 1. Priority: P0/high first (lower numeric = higher priority)
  const priorityA = priorityToNumeric(a.priority);
  const priorityB = priorityToNumeric(b.priority);
  if (priorityA !== priorityB) return priorityA - priorityB;

  // 2. Confidence: higher first (nulls last)
  const confA = a.confidence ?? -1;
  const confB = b.confidence ?? -1;
  if (confA !== confB) return confB - confA;

  // 3. Estimated impact: higher first (nulls last)
  const impactA = typeof a.estimated_impact === 'number' ? a.estimated_impact : mapImpact(a.impact);
  const impactB = typeof b.estimated_impact === 'number' ? b.estimated_impact : mapImpact(b.impact);
  if (impactA !== impactB) return impactB - impactA;

  return 0;
}

// ========================================
// KEY GENERATION
// ========================================

/**
 * Generate stable rec_key for idempotency.
 * Includes target hash to support page-level recommendations.
 *
 * Format: {pillar}:{subfactor}:{target_level}:{target_hash}
 *
 * Phase 4A.2.1 INVARIANT: If target_level='page', target_url MUST be non-empty.
 * If this invariant is violated, we downgrade to target_level='site' to prevent
 * inconsistent rec_keys that would cause silent overwrites.
 *
 * @param {Object} rec - Recommendation object from renderer
 * @returns {string|null} - Stable key or null if missing required fields
 */
function makeRecKey(rec) {
  if (!rec?.pillar || !rec?.subfactor_key) return null;

  let targetLevel = rec.target_level || 'site';
  const targetUrl = rec.target_url || rec.target?.url || rec.page_url || null;

  // Phase 4A.2.1: Enforce page-level invariant
  // If target_level='page' but no target_url, downgrade to 'site'
  if (targetLevel === 'page' && (!targetUrl || targetUrl.trim() === '')) {
    console.warn(`[makeRecKey] Downgrading to site-level (no target_url): ${rec.subfactor_key}`);
    targetLevel = 'site';
  }

  // For site-level, hash the literal 'site' string for consistent key
  // For page-level, hash the actual URL
  const targetId = targetLevel === 'site' ? 'site' : targetUrl;

  const targetHash = crypto.createHash('sha1')
    .update(String(targetId))
    .digest('hex')
    .slice(0, 12);

  return `${rec.pillar}:${rec.subfactor_key}:${targetLevel}:${targetHash}`;
}

// ========================================
// MAPPING UTILITIES
// ========================================

/**
 * Map priority from P0/P1/P2 to high/medium/low
 */
function mapPriority(p) {
  const map = { P0: 'high', P1: 'medium', P2: 'low' };
  return map[p] || p || 'medium';
}

/**
 * Map impact from text to numeric score
 */
function mapImpact(impact) {
  const map = {
    High: 5,
    'Med-High': 4,
    Medium: 3,
    Med: 3,
    'Low-Med': 2,
    Low: 1
  };
  return map[impact] || 3;
}

/**
 * Extract first code snippet from generated assets
 */
function extractFirstSnippet(assets) {
  if (!assets || !Array.isArray(assets) || assets.length === 0) return null;

  const first = assets[0];
  if (first.type === 'json-ld' && first.content) {
    return JSON.stringify(first.content, null, 2).substring(0, 2000);
  }
  if ((first.type === 'html' || first.type === 'meta') && first.content) {
    return String(first.content).substring(0, 2000);
  }
  return JSON.stringify(first).substring(0, 2000);
}

/**
 * Map renderer output to database columns
 *
 * @param {Object} rec - Recommendation from renderer
 * @param {string} engineVersion - Engine version (e.g., 'v5.1')
 * @returns {Object} - Database-ready column values
 */
function mapRendererOutputToDb(rec, engineVersion) {
  const recKey = makeRecKey(rec);

  // Phase 4A.2.1: Apply same target normalization as makeRecKey
  let targetLevel = rec.target_level || 'site';
  let targetUrl = rec.target_url || rec.target?.url || rec.page_url || null;

  // Enforce page-level invariant: page requires target_url
  if (targetLevel === 'page' && (!targetUrl || targetUrl.trim() === '')) {
    targetLevel = 'site';
    targetUrl = null;
  }

  return {
    // v2 fields
    rec_key: recKey,
    subfactor_key: rec.subfactor_key,
    pillar: rec.pillar,
    gap: rec.gap,
    why_it_matters: rec.why_it_matters,
    confidence: rec.confidence,
    evidence_quality: rec.evidence_quality,
    evidence_summary: rec.evidence_summary,
    automation_level: rec.automation_level,
    target_level: targetLevel,
    target_url: targetUrl,
    engine_version: engineVersion || 'v5.1',

    // JSONB columns (stringified; cast in SQL)
    evidence_json: rec.evidence_json ? JSON.stringify(rec.evidence_json) : null,
    generated_assets: rec.generated_assets ? JSON.stringify(rec.generated_assets) : null,
    examples: rec.examples ? JSON.stringify(rec.examples) : null,

    // Legacy compatibility fields
    category: rec.pillar,
    recommendation_text: (rec.gap || rec.subfactor_key || '').substring(0, 500),
    impact_description: rec.why_it_matters,
    findings: rec.evidence_summary,
    code_snippet: extractFirstSnippet(rec.generated_assets),

    // IMPORTANT: action_steps may be TEXT in legacy schema
    // Store as JSON string without ::jsonb cast
    action_steps: rec.action_items ? JSON.stringify(rec.action_items) : null,

    priority: mapPriority(rec.priority),
    estimated_impact: mapImpact(rec.impact),
    estimated_effort: rec.effort || 'M',
    status: 'pending',
    // Note: unlock_state is set by persistence layer based on user plan + rank
    recommendation_mode: 'optimization'
  };
}

// ========================================
// PERSISTENCE
// ========================================

/**
 * Persist recommendations to scan_recommendations table with idempotent upsert.
 *
 * Phase 4A.2.2: Applies plan-based unlock gating:
 * - Sorts recommendations by priority, confidence, impact (matching GET endpoint)
 * - Assigns unlock_state based on rank and plan limits
 *
 * @param {Object} params
 * @param {string} params.scanId - Scan ID
 * @param {Object[]} params.recommendations - Array of recommendations from renderer
 * @param {string} params.engineVersion - Engine version (default 'v5.1')
 * @param {string} params.userPlan - User's plan (free/diy/pro/etc.)
 * @returns {Promise<Object>} - Result with counts and status
 */
async function persistScanRecommendations({ scanId, recommendations, engineVersion, userPlan }) {
  if (!scanId) {
    return { success: false, error: 'Missing scanId' };
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  try {
    // Phase 4A.2.2: Calculate unlock limit based on user plan
    const plan = normalizePlan(userPlan);
    const unlockLimit = getUnlockLimit(plan);

    console.log(`[ScanRecommendationsService] Plan="${plan}", unlockLimit=${unlockLimit === Infinity ? 'unlimited' : unlockLimit}`);

    // Phase 4A.2.2: Sort recommendations by priority, confidence, impact
    // Create shallow copies to avoid mutating original objects
    const sortedRecs = [...(recommendations || [])].map(rec => ({ ...rec }));
    sortedRecs.sort(compareRecommendations);

    // Assign unlock_state based on rank
    sortedRecs.forEach((rec, index) => {
      rec._unlock_state = index < unlockLimit ? 'unlocked' : 'locked';
    });

    for (const rec of sortedRecs) {
      const mapped = mapRendererOutputToDb(rec, engineVersion);

      // Apply computed unlock_state
      mapped.unlock_state = rec._unlock_state || 'locked';

      // Skip recommendations with missing key fields
      if (!mapped.rec_key || !mapped.pillar || !mapped.subfactor_key) {
        console.warn('[ScanRecommendationsService] Skipping rec with missing key fields:', {
          rec_key: mapped.rec_key,
          pillar: mapped.pillar,
          subfactor_key: mapped.subfactor_key
        });
        skippedCount++;
        continue;
      }

      const result = await db.query(`
        INSERT INTO scan_recommendations (
          scan_id, rec_key, subfactor_key, pillar, gap, why_it_matters,
          confidence, evidence_quality, evidence_summary, automation_level,
          target_level, target_url, engine_version,
          evidence_json, generated_assets, examples,
          category, recommendation_text, impact_description, findings, code_snippet,
          action_steps, priority, estimated_impact, estimated_effort,
          status, unlock_state, recommendation_mode,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13,
          $14::jsonb, $15::jsonb, $16::jsonb,
          $17, $18, $19, $20, $21,
          $22, $23, $24, $25,
          $26, $27, $28,
          NOW(), NOW()
        )
        ON CONFLICT (scan_id, rec_key) WHERE rec_key IS NOT NULL
        DO UPDATE SET
          confidence = EXCLUDED.confidence,
          evidence_quality = EXCLUDED.evidence_quality,
          evidence_summary = EXCLUDED.evidence_summary,
          evidence_json = EXCLUDED.evidence_json,
          generated_assets = EXCLUDED.generated_assets,
          examples = EXCLUDED.examples,
          gap = EXCLUDED.gap,
          why_it_matters = EXCLUDED.why_it_matters,
          priority = EXCLUDED.priority,
          estimated_impact = EXCLUDED.estimated_impact,
          estimated_effort = EXCLUDED.estimated_effort,
          engine_version = EXCLUDED.engine_version,
          findings = EXCLUDED.findings,
          code_snippet = EXCLUDED.code_snippet,
          action_steps = EXCLUDED.action_steps,
          unlock_state = EXCLUDED.unlock_state,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
      `, [
        scanId,
        mapped.rec_key,
        mapped.subfactor_key,
        mapped.pillar,
        mapped.gap,
        mapped.why_it_matters,
        mapped.confidence,
        mapped.evidence_quality,
        mapped.evidence_summary,
        mapped.automation_level,
        mapped.target_level,
        mapped.target_url,
        mapped.engine_version,
        mapped.evidence_json,
        mapped.generated_assets,
        mapped.examples,
        mapped.category,
        mapped.recommendation_text,
        mapped.impact_description,
        mapped.findings,
        mapped.code_snippet,
        mapped.action_steps,
        mapped.priority,
        mapped.estimated_impact,
        mapped.estimated_effort,
        mapped.status,
        mapped.unlock_state,
        mapped.recommendation_mode
      ]);

      if (result.rows?.[0]?.inserted) {
        insertedCount++;
      } else {
        updatedCount++;
      }
    }

    const totalCount = insertedCount + updatedCount;

    // Update scan with recommendation generation metadata
    await db.query(`
      UPDATE scans SET
        recommendations_generated_at = NOW(),
        recommendations_engine_version = $1,
        recommendations_count = $2
      WHERE id = $3
    `, [engineVersion || 'v5.1', totalCount, scanId]);

    return {
      success: true,
      insertedCount,
      updatedCount,
      skippedCount,
      recommendations_count: totalCount,
      scan_id: scanId
    };
  } catch (error) {
    console.error('[ScanRecommendationsService] Persistence error:', error);
    return {
      success: false,
      error: error.message,
      scan_id: scanId
    };
  }
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  persistScanRecommendations,
  makeRecKey,
  mapRendererOutputToDb,
  mapPriority,
  mapImpact,
  extractFirstSnippet,
  // Phase 4A.2.2 plan gating helpers (exported for testing)
  normalizePlan,
  getUnlockLimit,
  priorityToNumeric,
  compareRecommendations
};
