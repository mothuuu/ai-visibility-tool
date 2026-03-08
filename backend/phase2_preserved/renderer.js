/**
 * RECOMMENDATION RENDERER
 * File: backend/recommendations/renderer.js
 *
 * Content-aware recommendation renderer that:
 * - Identifies failing subfactors from rubricResult
 * - Maps to playbook entries
 * - Fills templates with evidence-driven context
 * - Calls generation hooks for automation_level='generate' items
 *
 * Phase 4A.1: Content-Aware Recommendation Engine Core
 */

const {
  SUBFACTOR_TO_PLAYBOOK,
  getPlaybookEntry,
  normalizeKey,
  toSnakeCase,
  toCamelCase,
  PILLAR_DISPLAY_NAMES
} = require('./subfactorPlaybookMap');

const {
  GENERATION_HOOKS,
  executeHook,
  hasHook,
  inferCompanyName,
  inferDescription,
  extractDomain
} = require('./generationHooks');

const {
  EVIDENCE_QUALITY,
  assessEvidenceQuality,
  canRunGenerationHook,
  adjustAutomationLevel,
  shouldSkipRecommendation,
  getVerificationActionItems
} = require('./evidenceGating');

const {
  TARGET_LEVEL,
  getTargetLevel,
  getTargetLevelDescription
} = require('./targeting');

const {
  resolveTemplate,
  resolveTemplateArray,
  validateNoPlaceholderLeaks: strictLeakCheck
} = require('./placeholderResolver');

const { buildEvidenceContext } = require('./evidenceHelpers');

const {
  getDetectionState,
  hasDetectionFunction,
  shouldSuppressRecommendation
} = require('./detectionStates.top10');

// Top 10 subfactor list (Phase 4A.3c)
const TOP_10_SUBFACTORS = require('./topSubfactors.phase4a3c.json').top10;
const TOP_10_SET = new Set(TOP_10_SUBFACTORS);

// ========================================
// CONFIGURATION
// ========================================

// Score threshold below which we trigger recommendations (0-100 scale)
const RECOMMENDATION_SCORE_THRESHOLD = 70;

// Maximum recommendations to return per scan
const MAX_RECOMMENDATIONS_PER_SCAN = 12;

// Priority weights for sorting
const PRIORITY_WEIGHTS = {
  P0: 100,
  P1: 50,
  P2: 25
};

const IMPACT_WEIGHTS = {
  High: 40,
  'Med-High': 30,
  Med: 20,
  'Low-Med': 10
};

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Extract numeric score from tri-state or raw value
 * Handles: plain numbers, tri-state objects { score, state }, null/undefined
 */
function getNumericScore(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && 'score' in value) {
    return value.score;
  }
  return null;
}

/**
 * Check if a score is below threshold (only for measured scores)
 */
function isBelowThreshold(score, threshold = RECOMMENDATION_SCORE_THRESHOLD) {
  const numericScore = getNumericScore(score);
  if (numericScore === null) return false; // Don't recommend for unmeasured
  return numericScore < threshold;
}

/**
 * Generate deterministic rec_key from subfactor and scan
 */
function generateRecKey(subfactorKey, scanId) {
  return `${subfactorKey}::${scanId || 'unknown'}`;
}

/**
 * Extract value from nested object using dot-notation path
 */
function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Format current date
 */
function formatDate(date = new Date()) {
  return date.toISOString().split('T')[0];
}

// ========================================
// PLACEHOLDER RESOLUTION
// ========================================

/**
 * Build context object for placeholder resolution
 */
function buildPlaceholderContext(scanEvidence, context, scan) {
  const evidence = scanEvidence || {};
  const ctx = context || {};

  // Infer values from evidence
  const companyName = inferCompanyName(evidence, ctx);
  const siteUrl = evidence.url || ctx.site_url || 'https://example.com';
  const domain = extractDomain(siteUrl);
  const description = inferDescription(evidence, ctx);

  // Count headings
  const headingCount = Object.values(evidence.content?.headings || {})
    .flat()
    .length;

  // Count images
  const totalImages = evidence.media?.imageCount || 0;
  const imagesWithAlt = evidence.media?.imagesWithAlt || 0;
  const imagesWithoutAlt = evidence.media?.imagesWithoutAlt || totalImages - imagesWithAlt;

  // Count schema types
  const schemaTypes = evidence.technical?.structuredData?.map(s => s.type || s['@type']) || [];
  const schemaCount = schemaTypes.length;

  // Heading issues
  const headingIssues = [];
  const h1Count = evidence.content?.headings?.h1?.length || 0;
  if (h1Count === 0) headingIssues.push('Missing H1');
  if (h1Count > 1) headingIssues.push(`Multiple H1s (${h1Count})`);

  // TTFB
  const ttfb = evidence.performance?.ttfb || 'unknown';

  return {
    // Core identifiers
    company_name: companyName,
    site_url: siteUrl,
    page_url: siteUrl,
    domain: domain,

    // Context-provided values
    industry: ctx.detected_industry || ctx.industry || 'technology',
    product_name: ctx.product_name || companyName,
    product_type: ctx.product_type || 'solution',
    icp_roles: Array.isArray(ctx.icp_roles) ? ctx.icp_roles.join(', ') : (ctx.icp_roles || 'decision-makers'),
    region: ctx.region || '',

    // Page metadata
    page_title: evidence.metadata?.title || companyName,
    page_description: description,
    og_image_url: evidence.metadata?.ogImage || `${siteUrl}/og-image.jpg`,
    logo_url: evidence.metadata?.ogImage || evidence.metadata?.favicon || `${siteUrl}/logo.png`,

    // Social placeholders
    linkedin_url: `https://linkedin.com/company/${domain.split('.')[0]}`,
    twitter_url: `https://twitter.com/${domain.split('.')[0]}`,

    // Metrics
    heading_count: String(headingCount),
    total_images: String(totalImages),
    images_with_alt: String(imagesWithAlt),
    images_without_alt: String(imagesWithoutAlt),
    schema_count: String(schemaCount),
    ttfb: String(ttfb),

    // Issues
    heading_issues: headingIssues.join(', ') || 'none detected',

    // Dates
    current_date: formatDate(),
    last_updated_date: evidence.metadata?.lastModified || formatDate(),
    iso_date: new Date().toISOString(),
    year: String(new Date().getFullYear()),

    // Industry-specific
    industry_specific_schema: getIndustrySpecificSchema(ctx.detected_industry || 'technology'),
    relevant_certs: getRelevantCertifications(ctx.detected_industry || 'technology'),
    topic: ctx.topic || 'your specialty',
    pain_point: ctx.pain_point || 'common challenges',
    author_name: ctx.author_name || '[Author Name]',
    author_title: ctx.author_title || '[Title]',
    years: ctx.years || '[X]'
  };
}

/**
 * Get industry-specific schema recommendation
 */
function getIndustrySpecificSchema(industry) {
  const mapping = {
    saas: 'SoftwareApplication',
    ecommerce: 'Product',
    healthcare: 'MedicalOrganization',
    fintech: 'FinancialService',
    agency: 'Service',
    telecom: 'Service',
    technology: 'SoftwareApplication',
    cybersecurity: 'Service'
  };

  const normalized = (industry || '').toLowerCase();
  for (const [key, schema] of Object.entries(mapping)) {
    if (normalized.includes(key)) return schema;
  }
  return 'Service';
}

/**
 * Get relevant certifications for industry
 */
function getRelevantCertifications(industry) {
  const mapping = {
    saas: 'SOC 2, ISO 27001, GDPR',
    cybersecurity: 'SOC 2, ISO 27001, CISSP, CISM',
    healthcare: 'HIPAA, HITRUST, SOC 2',
    fintech: 'PCI-DSS, SOC 2, ISO 27001',
    telecom: 'ISO 27001, TL 9000',
    technology: 'SOC 2, ISO 27001'
  };

  const normalized = (industry || '').toLowerCase();
  for (const [key, certs] of Object.entries(mapping)) {
    if (normalized.includes(key)) return certs;
  }
  return 'SOC 2, ISO 27001';
}

/**
 * Resolve placeholders in a string
 */
function resolvePlaceholders(template, context) {
  if (!template || typeof template !== 'string') return template;

  let result = template;

  // Replace {{placeholder}} patterns
  const placeholderRegex = /\{\{([^}]+)\}\}/g;
  result = result.replace(placeholderRegex, (match, key) => {
    const trimmedKey = key.trim();
    const value = context[trimmedKey];

    if (value !== undefined && value !== null && value !== '') {
      return String(value);
    }

    // If no value, return a safe fallback
    console.warn(`[Renderer] Unresolved placeholder: {{${trimmedKey}}}`);
    return `[${trimmedKey}]`;
  });

  return result;
}

/**
 * Resolve placeholders in an array of strings
 */
function resolvePlaceholdersInArray(templates, context) {
  if (!Array.isArray(templates)) return [];
  return templates.map(t => resolvePlaceholders(t, context));
}

// ========================================
// EVIDENCE EXTRACTION
// ========================================

/**
 * Extract evidence for a specific playbook entry
 */
function extractEvidence(scanEvidence, evidenceSelectors) {
  if (!scanEvidence || !Array.isArray(evidenceSelectors)) {
    return {};
  }

  const evidence = {};

  for (const selector of evidenceSelectors) {
    const value = getNestedValue(scanEvidence, selector);
    if (value !== undefined) {
      // Use last part of selector as key
      const key = selector.split('.').pop();
      evidence[key] = value;
    }
  }

  return evidence;
}

/**
 * Build minimal evidence_json for a recommendation
 */
function buildEvidenceJson(scanEvidence, playbookEntry, subfactorKey) {
  const extractedEvidence = extractEvidence(
    scanEvidence,
    playbookEntry.evidence_selectors || []
  );

  return {
    subfactor_key: subfactorKey,
    extracted: extractedEvidence,
    scan_url: scanEvidence?.url || null,
    scan_timestamp: scanEvidence?.timestamp || new Date().toISOString()
  };
}

// ========================================
// FAILING SUBFACTOR DETECTION
// ========================================

/**
 * Extract failing subfactors from rubricResult
 * Returns array of { category, subfactor, score, threshold }
 */
function extractFailingSubfactors(rubricResult, threshold = RECOMMENDATION_SCORE_THRESHOLD) {
  const failing = [];

  if (!rubricResult || !rubricResult.categories) {
    console.warn('[Renderer] No categories in rubricResult');
    return failing;
  }

  // Iterate through categories
  for (const [categoryKey, categoryData] of Object.entries(rubricResult.categories)) {
    if (!categoryData || !categoryData.subfactors) continue;

    const subfactors = categoryData.subfactors;

    for (const [subfactorKey, scoreData] of Object.entries(subfactors)) {
      const score = getNumericScore(scoreData);

      // Skip null/unmeasured scores
      if (score === null) continue;

      // Check if below threshold
      if (score < threshold) {
        failing.push({
          category: categoryKey,
          subfactor: subfactorKey,
          score: score,
          threshold: threshold,
          gap: threshold - score,
          categoryScore: categoryData.score || 0
        });
      }
    }
  }

  return failing;
}

/**
 * Sort failing subfactors by priority
 */
function sortByPriority(failingSubfactors, playbookEntries) {
  return failingSubfactors.sort((a, b) => {
    const entryA = playbookEntries.get(a.subfactor);
    const entryB = playbookEntries.get(b.subfactor);

    // Priority weight (P0 > P1 > P2)
    const priorityA = PRIORITY_WEIGHTS[entryA?.priority] || 0;
    const priorityB = PRIORITY_WEIGHTS[entryB?.priority] || 0;
    if (priorityB !== priorityA) return priorityB - priorityA;

    // Impact weight
    const impactA = IMPACT_WEIGHTS[entryA?.impact] || 0;
    const impactB = IMPACT_WEIGHTS[entryB?.impact] || 0;
    if (impactB !== impactA) return impactB - impactA;

    // Lowest score first (bigger gap = more important)
    return a.score - b.score;
  });
}

// ========================================
// MAIN RENDERER FUNCTION
// ========================================

/**
 * Render content-aware recommendations
 *
 * @param {Object} params
 * @param {Object} params.scan - Scan object { id, domain, domain_type, created_at, organization_id? }
 * @param {Object} params.rubricResult - V5 rubric result with categories and subfactors
 * @param {Object} params.scanEvidence - Evidence contract v2.0 object
 * @param {Object} params.context - Additional context { detected_industry, icp_roles, product_name, etc. }
 * @returns {Promise<Object[]>} - Array of recommendation objects
 */
async function renderRecommendations({ scan, rubricResult, scanEvidence, context }) {
  const recommendations = [];
  const scanId = scan?.id || 'unknown';
  const startTime = Date.now();

  console.log(`[Renderer] Starting recommendation rendering for scan: ${scanId}`);

  // Step 1: Extract failing subfactors
  const failingSubfactors = extractFailingSubfactors(
    rubricResult,
    RECOMMENDATION_SCORE_THRESHOLD
  );

  console.log(`[Renderer] Found ${failingSubfactors.length} failing subfactors`);

  if (failingSubfactors.length === 0) {
    console.log('[Renderer] No failing subfactors, returning empty recommendations');
    return [];
  }

  // Step 2: Map to playbook entries
  const playbookEntries = new Map();
  for (const failing of failingSubfactors) {
    const entry = getPlaybookEntry(failing.subfactor, failing.category);
    if (entry) {
      playbookEntries.set(failing.subfactor, entry);
    }
  }

  console.log(`[Renderer] Mapped ${playbookEntries.size} playbook entries`);

  // Step 3: Sort by priority
  const sortedFailing = sortByPriority(failingSubfactors, playbookEntries);

  // Step 4: Build placeholder context (merges base context + evidence extractors)
  const placeholderContext = buildPlaceholderContext(scanEvidence, context, scan);
  const evidenceContext = buildEvidenceContext(scanEvidence);
  const mergedContext = { ...placeholderContext, ...evidenceContext };

  // Step 5: Generate recommendations (limit to MAX_RECOMMENDATIONS_PER_SCAN)
  const toProcess = sortedFailing.slice(0, MAX_RECOMMENDATIONS_PER_SCAN);

  for (const failing of toProcess) {
    const entry = playbookEntries.get(failing.subfactor);

    if (!entry) {
      // No playbook entry - create minimal recommendation with weak evidence
      const fallbackSubfactorKey = normalizeKey(`${failing.category}.${failing.subfactor}`);
      recommendations.push({
        rec_key: generateRecKey(failing.subfactor, scanId),
        pillar: PILLAR_DISPLAY_NAMES[failing.category] || failing.category,
        subfactor_key: fallbackSubfactorKey,
        gap: `Improve ${failing.subfactor.replace(/Score$/, '')}`,
        finding: '',
        why_it_matters: `This subfactor scored ${failing.score}/100, below the ${failing.threshold} threshold.`,
        recommendation: '',
        what_to_include: '',
        action_items: ['Review and improve this area based on best practices'],
        how_to_implement: ['Review and improve this area based on best practices'],
        examples: [],
        evidence_json: {
          subfactor_key: failing.subfactor,
          score: failing.score,
          threshold: failing.threshold
        },
        automation_level: 'manual',
        generated_assets: [],
        // Evidence gating fields
        confidence: 0.3,
        evidence_quality: EVIDENCE_QUALITY.WEAK,
        evidence_summary: 'No playbook entry - limited guidance available',
        // Target level (site vs page)
        target_level: getTargetLevel(fallbackSubfactorKey)
      });
      continue;
    }

    // Step 5a (Phase 4A.3c): Check detection state for Top 10 subfactors
    const isTop10 = TOP_10_SET.has(entry.canonical_key);
    let detectionState = null;

    if (isTop10 && hasDetectionFunction(entry.canonical_key)) {
      detectionState = getDetectionState(entry.canonical_key, scanEvidence);

      // Suppress if COMPLETE (issue resolved)
      if (shouldSuppressRecommendation(detectionState)) {
        console.log(`[Renderer] Suppressing ${entry.canonical_key}: detection state is COMPLETE`);
        continue;
      }
    }

    // Step 6: Assess evidence quality
    const evidenceAssessment = assessEvidenceQuality(scanEvidence, entry, context);
    let { quality: evidenceQuality, confidence, summary: evidenceSummary, details: evidenceDetails } = evidenceAssessment;

    // Step 7: Check if recommendation should be skipped (noise filtering)
    const skipCheck = shouldSkipRecommendation({
      evidenceQuality,
      automationLevel: entry.automation_level,
      score: failing.score,
      threshold: failing.threshold
    });

    if (skipCheck.shouldSkip) {
      console.log(`[Renderer] Skipping recommendation ${entry.canonical_key}: ${skipCheck.reason}`);
      continue;
    }

    // Step 8: Adjust automation level based on evidence quality
    let adjustedAutomationLevel = adjustAutomationLevel(entry.automation_level, evidenceQuality);

    // Step 8a (Phase 4A.3c): Resolve 5 sections for Top 10 using strict resolver
    const resolveOpts = { detectionState: detectionState || 'default' };
    let finding = '';
    let recommendationText = '';
    let whatToInclude = '';

    if (isTop10 && entry.finding_templates) {
      // Use strict placeholder resolver with state-keyed templates
      finding = resolveTemplate(entry.finding_templates, mergedContext, resolveOpts);
      recommendationText = resolveTemplate(entry.recommendation_template, mergedContext, resolveOpts);
      whatToInclude = resolveTemplate(entry.what_to_include_template, mergedContext, resolveOpts);
    }

    // Resolve existing templates (use strict resolver for Top 10, legacy for others)
    const whyItMatters = isTop10
      ? resolveTemplate(entry.why_it_matters_template, mergedContext, resolveOpts)
      : resolvePlaceholders(entry.why_it_matters_template, placeholderContext);

    let actionItems = isTop10
      ? resolveTemplateArray(entry.action_items_template, mergedContext, resolveOpts)
      : resolvePlaceholdersInArray(entry.action_items_template, placeholderContext);

    const examples = isTop10
      ? resolveTemplateArray(entry.examples_template, mergedContext, resolveOpts)
      : resolvePlaceholdersInArray(entry.examples_template, placeholderContext);

    // Step 9: Add verification action items for weak/ambiguous evidence
    if (evidenceQuality === EVIDENCE_QUALITY.WEAK || evidenceQuality === EVIDENCE_QUALITY.AMBIGUOUS) {
      const verificationItems = getVerificationActionItems(
        entry.canonical_key,
        evidenceQuality,
        evidenceDetails
      );
      if (verificationItems.length > 0) {
        actionItems = [...verificationItems, ...actionItems];
      }
    }

    // Build evidence JSON
    const evidenceJson = buildEvidenceJson(scanEvidence, entry, entry.canonical_key);
    evidenceJson.score = failing.score;
    evidenceJson.threshold = failing.threshold;
    evidenceJson.gap = failing.gap;
    if (detectionState) {
      evidenceJson.detection_state = detectionState;
    }

    // Determine target level (site vs page)
    const targetLevel = getTargetLevel(entry.canonical_key);

    // Build recommendation object (5-section output for Top 10)
    const recommendation = {
      rec_key: generateRecKey(entry.canonical_key, scanId),
      pillar: entry.playbook_category,
      subfactor_key: entry.canonical_key,
      gap: entry.playbook_gap,
      // Phase 4A.3c: 5 sections
      finding: finding,
      why_it_matters: whyItMatters,
      recommendation: recommendationText,
      what_to_include: whatToInclude,
      action_items: actionItems,
      how_to_implement: actionItems, // alias for backward compat
      examples: examples,
      evidence_json: evidenceJson,
      automation_level: adjustedAutomationLevel,
      generated_assets: [],
      // Evidence gating fields
      confidence,
      evidence_quality: evidenceQuality,
      evidence_summary: evidenceSummary,
      // Target level (site vs page)
      target_level: targetLevel,
      // Phase 4A.3c metadata
      detection_state: detectionState,
      is_top10: isTop10
    };

    // Step 10: Call generation hook if applicable AND evidence is sufficient
    if (entry.automation_level === 'generate' && entry.generator_hook_key) {
      // Gate hook based on evidence quality
      const canGenerate = evidenceQuality === EVIDENCE_QUALITY.STRONG ||
                          evidenceQuality === EVIDENCE_QUALITY.MEDIUM;

      if (!canGenerate) {
        console.log(`[Renderer] Skipping generation hook due to ${evidenceQuality} evidence: ${entry.generator_hook_key}`);
        // Already downgraded automation_level via adjustAutomationLevel
      } else {
        // Additional hook-specific checks
        const hookCheck = canRunGenerationHook(entry.generator_hook_key, scanEvidence, context);

        if (!hookCheck.canGenerate) {
          console.log(`[Renderer] Hook blocked: ${hookCheck.reason}`);
          recommendation.automation_level = adjustAutomationLevel('generate', EVIDENCE_QUALITY.WEAK);
          recommendation.evidence_summary += `. ${hookCheck.reason}`;
        } else {
          console.log(`[Renderer] Calling generation hook: ${entry.generator_hook_key}`);

          try {
            const generatedAsset = await executeHook(
              entry.generator_hook_key,
              scanEvidence,
              context
            );

            if (generatedAsset) {
              recommendation.generated_assets.push(generatedAsset);
              console.log(`[Renderer] Generated asset: ${generatedAsset.asset_type}`);
            } else {
              // Hook failed - downgrade to draft
              console.warn(`[Renderer] Hook returned null, downgrading to draft: ${entry.generator_hook_key}`);
              recommendation.automation_level = 'draft';
            }
          } catch (error) {
            // Hook threw error - log and downgrade
            console.error(`[Renderer] Hook error (${entry.generator_hook_key}):`, error.message);
            recommendation.automation_level = 'draft';
          }
        }
      }
    }

    // Phase 4A.3c: Validate no placeholder leaks for Top 10
    if (isTop10) {
      const leakCheck = strictLeakCheck({
        finding: recommendation.finding,
        why_it_matters: recommendation.why_it_matters,
        recommendation: recommendation.recommendation,
        what_to_include: recommendation.what_to_include
      });
      if (!leakCheck.valid) {
        console.warn(`[Renderer] Placeholder leaks in ${entry.canonical_key}:`, leakCheck.leaks);
      }
    }

    recommendations.push(recommendation);
  }

  const duration = Date.now() - startTime;
  console.log(`[Renderer] Generated ${recommendations.length} recommendations in ${duration}ms`);

  // Step 11: Normalize page-level targets before returning (Phase 4A.2.1)
  const normalizedRecommendations = normalizeRecommendationTargets(
    recommendations,
    scanEvidence,
    context
  );

  return normalizedRecommendations;
}

// ========================================
// TARGET NORMALIZATION (Phase 4A.2.1)
// ========================================

/**
 * Normalize page-level targets before persistence.
 * Guarantees: If target_level='page', target_url must be non-empty.
 *
 * Rules:
 * 1) If target_level='page' AND target_url missing:
 *    a) Try evidence.url or context.site_url
 *    b) Try page_url from evidence or context
 *    c) If still missing -> DOWNGRADE to target_level='site'
 *
 * @param {Object[]} recommendations - Array of recommendation objects
 * @param {Object} scanEvidence - Evidence contract object
 * @param {Object} context - Context object
 * @returns {Object[]} - Normalized recommendations
 */
function normalizeRecommendationTargets(recommendations, scanEvidence, context) {
  const evidence = scanEvidence || {};
  const ctx = context || {};

  // Derive best available URL
  const derivedUrl = evidence.url || ctx.site_url || ctx.page_url || null;

  return recommendations.map(rec => {
    // Only process page-level recommendations
    if (rec.target_level !== TARGET_LEVEL.PAGE) {
      return rec;
    }

    // Check if target_url is missing or empty
    const hasTargetUrl = rec.target_url && rec.target_url.trim() !== '';

    if (hasTargetUrl) {
      return rec; // Already has valid target_url
    }

    // Try to derive target_url
    if (derivedUrl) {
      console.log(`[Renderer] Deriving target_url for page rec: ${rec.subfactor_key} -> ${derivedUrl}`);
      return {
        ...rec,
        target_url: derivedUrl
      };
    }

    // No URL available - DOWNGRADE to site level
    console.warn(`[Renderer] Downgrading to site-level (no target_url): ${rec.subfactor_key}`);
    return {
      ...rec,
      target_level: TARGET_LEVEL.SITE,
      target_url: null
    };
  });
}

/**
 * Validate that no unresolved placeholders remain
 */
function validateNoUnresolvedPlaceholders(recommendations) {
  const issues = [];

  for (const rec of recommendations) {
    const checkField = (fieldName, value) => {
      if (typeof value === 'string' && /\{\{[^}]+\}\}/.test(value)) {
        issues.push(`${rec.rec_key}: Unresolved placeholder in ${fieldName}`);
      }
    };

    checkField('why_it_matters', rec.why_it_matters);
    checkField('gap', rec.gap);
    checkField('finding', rec.finding);
    checkField('recommendation', rec.recommendation);
    checkField('what_to_include', rec.what_to_include);

    if (Array.isArray(rec.action_items)) {
      rec.action_items.forEach((item, i) => checkField(`action_items[${i}]`, item));
    }
    if (Array.isArray(rec.examples)) {
      rec.examples.forEach((item, i) => checkField(`examples[${i}]`, item));
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  // Main function
  renderRecommendations,

  // Configuration (exported for testing/customization)
  RECOMMENDATION_SCORE_THRESHOLD,
  MAX_RECOMMENDATIONS_PER_SCAN,

  // Evidence quality constants (re-exported for convenience)
  EVIDENCE_QUALITY,

  // Target level constants (re-exported for convenience)
  TARGET_LEVEL,

  // Phase 4A.3c: Top 10 list
  TOP_10_SUBFACTORS,

  // Utilities (exported for testing)
  extractFailingSubfactors,
  buildPlaceholderContext,
  resolvePlaceholders,
  resolvePlaceholdersInArray,
  extractEvidence,
  buildEvidenceJson,
  validateNoUnresolvedPlaceholders,
  normalizeRecommendationTargets,
  getNumericScore,
  isBelowThreshold,
  generateRecKey
};
