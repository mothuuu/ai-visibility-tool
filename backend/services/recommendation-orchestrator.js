/**
 * Phase 4A.2: Recommendation Orchestrator
 *
 * Loads scan data + evidence, calls the content-aware renderer, and persists v2 recommendations.
 * Handles the 0-1000 to 0-100 score conversion for the renderer.
 *
 * Key responsibilities:
 * - Load scan data and evidence from database
 * - Construct rubricResult in renderer-expected format
 * - Call renderRecommendations
 * - Persist results via scan-recommendations-service
 */

const db = require('../db/database');

// ========================================
// UTILITIES
// ========================================

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Convert database pillar score (0-1000) to renderer scale (0-100)
 */
function normalizeScore(dbScore) {
  if (dbScore === null || dbScore === undefined) return 50; // Default middle score
  return Math.min(100, Math.max(0, Math.round(dbScore / 10)));
}

/**
 * Map database category names (snake_case) to renderer category keys (camelCase)
 */
const CATEGORY_KEY_MAP = {
  'ai_readability': 'aiReadability',
  'ai_search_readiness': 'aiSearchReadiness',
  'content_freshness': 'contentFreshness',
  'content_structure': 'contentStructure',
  'speed_ux': 'speedUX',
  'technical_setup': 'technicalSetup',
  'trust_authority': 'trustAuthority',
  'voice_optimization': 'voiceOptimization'
};

/**
 * Default subfactor keys per category (for synthetic rubricResult)
 * These map to the playbook entries
 */
const CATEGORY_SUBFACTORS = {
  technicalSetup: [
    'organizationSchemaScore',
    'structuredDataScore',
    'sitemapScore',
    'openGraphScore',
    'canonicalScore',
    'crawlerAccessScore'
  ],
  aiSearchReadiness: [
    'icpFaqsScore',
    'queryIntentScore',
    'evidenceProofScore',
    'pillarPagesScore',
    'scannabilityScore'
  ],
  trustAuthority: [
    'authorBiosScore',
    'certificationsScore',
    'thirdPartyScore',
    'thoughtLeadershipScore'
  ],
  aiReadability: [
    'altTextScore',
    'mediaAccessibilityScore'
  ],
  contentStructure: [
    'headingHierarchyScore',
    'navigationScore',
    'entityCuesScore'
  ],
  voiceOptimization: [
    'conversationalScore',
    'localIntentScore'
  ],
  contentFreshness: [
    'lastUpdatedScore'
  ],
  speedUX: [
    'performanceScore'
  ]
};

/**
 * Build rubricResult from scan database row
 * Creates synthetic subfactor scores based on pillar scores
 */
function buildRubricResult(scan) {
  const categories = {};

  // Build each category with normalized scores
  const pillarScores = {
    aiReadability: scan.ai_readability_score,
    aiSearchReadiness: scan.ai_search_readiness_score,
    contentFreshness: scan.content_freshness_score,
    contentStructure: scan.content_structure_score,
    speedUX: scan.speed_ux_score,
    technicalSetup: scan.technical_setup_score,
    trustAuthority: scan.trust_authority_score,
    voiceOptimization: scan.voice_optimization_score
  };

  for (const [categoryKey, dbScore] of Object.entries(pillarScores)) {
    const normalizedScore = normalizeScore(dbScore);
    const subfactorKeys = CATEGORY_SUBFACTORS[categoryKey] || [];

    // Create subfactors object with same score (proxy)
    const subfactors = {};
    for (const subfactorKey of subfactorKeys) {
      subfactors[subfactorKey] = normalizedScore;
    }

    categories[categoryKey] = {
      score: normalizedScore,
      subfactors
    };
  }

  return {
    totalScore: scan.total_score ? normalizeScore(scan.total_score * 10) : 50,
    categories
  };
}

/**
 * Extract scanEvidence from detailed_analysis
 */
function extractScanEvidence(detailedAnalysis) {
  if (!detailedAnalysis) return {};

  // Evidence is stored at detailedAnalysis.scanEvidence
  if (detailedAnalysis.scanEvidence) {
    return detailedAnalysis.scanEvidence;
  }

  // Fallback: maybe the whole object is evidence
  if (detailedAnalysis.url && detailedAnalysis.timestamp) {
    return detailedAnalysis;
  }

  return {};
}

// ========================================
// MAIN ORCHESTRATOR
// ========================================

/**
 * Generate and persist content-aware recommendations for a scan
 *
 * @param {string} scanId - Scan ID to process
 * @returns {Promise<Object>} - Result with success status and counts
 */
async function generateAndPersistRecommendations(scanId) {
  try {
    // Step 1: Load scan data
    const scanResult = await db.query(`
      SELECT
        id, url, domain, domain_type, industry, organization_id, user_id,
        total_score, ai_readability_score, ai_search_readiness_score,
        content_freshness_score, content_structure_score, speed_ux_score,
        technical_setup_score, trust_authority_score, voice_optimization_score,
        detailed_analysis, created_at
      FROM scans
      WHERE id = $1
    `, [scanId]);

    if (scanResult.rows.length === 0) {
      return { success: false, error: 'Scan not found', scan_id: scanId };
    }

    const scan = scanResult.rows[0];

    // Step 2: Extract evidence from detailed_analysis
    const detailedAnalysis = scan.detailed_analysis || {};
    const scanEvidence = extractScanEvidence(detailedAnalysis);

    // Step 3: Build rubricResult from pillar scores (0-1000 -> 0-100)
    const rubricResult = buildRubricResult(scan);

    // Step 4: Build context
    const context = {
      detected_industry: scan.industry || scan.domain_type || 'technology',
      domain: scan.domain || extractDomain(scan.url),
      site_url: scan.url,
      organization_id: scan.organization_id
    };

    // Step 5: Call renderer
    const { renderRecommendations } = require('../recommendations/renderer');
    const recommendations = await renderRecommendations({
      scan: {
        id: scan.id,
        url: scan.url,
        domain: scan.domain,
        domain_type: scan.domain_type,
        created_at: scan.created_at,
        organization_id: scan.organization_id
      },
      rubricResult,
      scanEvidence,
      context
    });

    console.log(`[RecommendationOrchestrator] Generated ${recommendations.length} recommendations for scan ${scanId}`);

    // Step 6: Persist recommendations
    const { persistScanRecommendations } = require('./scan-recommendations-service');
    const persistResult = await persistScanRecommendations({
      scanId,
      recommendations,
      engineVersion: 'v5.1'
    });

    return persistResult;
  } catch (error) {
    console.error('[RecommendationOrchestrator] Error:', error);
    return {
      success: false,
      error: error.message,
      scan_id: scanId
    };
  }
}

/**
 * Check if a scan should skip recommendation generation
 *
 * @param {Object} scan - Scan object
 * @returns {boolean} - True if should skip
 */
function shouldSkipRecommendationGeneration(scan) {
  // Skip competitor scans
  if (scan.domain_type === 'competitor') {
    return true;
  }

  // Skip if no detailed_analysis
  if (!scan.detailed_analysis) {
    return true;
  }

  return false;
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  generateAndPersistRecommendations,
  shouldSkipRecommendationGeneration,
  buildRubricResult,
  extractScanEvidence,
  normalizeScore,
  CATEGORY_SUBFACTORS
};
