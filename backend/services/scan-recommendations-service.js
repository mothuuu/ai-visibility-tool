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
 */

const crypto = require('crypto');
const db = require('../db/database');

// ========================================
// KEY GENERATION
// ========================================

/**
 * Generate stable rec_key for idempotency.
 * Includes target hash to support page-level recommendations.
 *
 * Format: {pillar}:{subfactor}:{target_level}:{target_hash}
 *
 * @param {Object} rec - Recommendation object from renderer
 * @returns {string|null} - Stable key or null if missing required fields
 */
function makeRecKey(rec) {
  if (!rec?.pillar || !rec?.subfactor_key) return null;

  const targetLevel = rec.target_level || 'site';
  const targetId = rec.target_url || rec.target?.url || rec.page_url || 'site';

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
  const targetLevel = rec.target_level || 'site';
  const targetUrl = rec.target_url || rec.target?.url || rec.page_url || null;

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
    unlock_state: 'unlocked',
    recommendation_mode: 'optimization'
  };
}

// ========================================
// PERSISTENCE
// ========================================

/**
 * Persist recommendations to scan_recommendations table with idempotent upsert.
 *
 * @param {Object} params
 * @param {string} params.scanId - Scan ID
 * @param {Object[]} params.recommendations - Array of recommendations from renderer
 * @param {string} params.engineVersion - Engine version (default 'v5.1')
 * @returns {Promise<Object>} - Result with counts and status
 */
async function persistScanRecommendations({ scanId, recommendations, engineVersion }) {
  if (!scanId) {
    return { success: false, error: 'Missing scanId' };
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  try {
    for (const rec of (recommendations || [])) {
      const mapped = mapRendererOutputToDb(rec, engineVersion);

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
  extractFirstSnippet
};
