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
    logo_url: evidence.metadata?.ogImage || '',

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

  // Step 4: Build placeholder context
  const placeholderContext = buildPlaceholderContext(scanEvidence, context, scan);

  // Step 5: Generate recommendations (limit to MAX_RECOMMENDATIONS_PER_SCAN)
  const toProcess = sortedFailing.slice(0, MAX_RECOMMENDATIONS_PER_SCAN);

  for (const failing of toProcess) {
    const entry = playbookEntries.get(failing.subfactor);

    if (!entry) {
      // No playbook entry - create minimal recommendation
      recommendations.push({
        rec_key: generateRecKey(failing.subfactor, scanId),
        pillar: PILLAR_DISPLAY_NAMES[failing.category] || failing.category,
        subfactor_key: normalizeKey(`${failing.category}.${failing.subfactor}`),
        gap: `Improve ${failing.subfactor.replace(/Score$/, '')}`,
        why_it_matters: `This subfactor scored ${failing.score}/100, below the ${failing.threshold} threshold.`,
        action_items: ['Review and improve this area based on best practices'],
        examples: [],
        evidence_json: {
          subfactor_key: failing.subfactor,
          score: failing.score,
          threshold: failing.threshold
        },
        automation_level: 'manual',
        generated_assets: []
      });
      continue;
    }

    // Resolve templates
    const whyItMatters = resolvePlaceholders(entry.why_it_matters_template, placeholderContext);
    const actionItems = resolvePlaceholdersInArray(entry.action_items_template, placeholderContext);
    const examples = resolvePlaceholdersInArray(entry.examples_template, placeholderContext);

    // Build evidence JSON
    const evidenceJson = buildEvidenceJson(scanEvidence, entry, entry.canonical_key);
    evidenceJson.score = failing.score;
    evidenceJson.threshold = failing.threshold;
    evidenceJson.gap = failing.gap;

    // Build recommendation object
    const recommendation = {
      rec_key: generateRecKey(entry.canonical_key, scanId),
      pillar: entry.playbook_category,
      subfactor_key: entry.canonical_key,
      gap: entry.playbook_gap,
      why_it_matters: whyItMatters,
      action_items: actionItems,
      examples: examples,
      evidence_json: evidenceJson,
      automation_level: entry.automation_level,
      generated_assets: []
    };

    // Step 6: Call generation hook if applicable
    if (entry.automation_level === 'generate' && entry.generator_hook_key) {
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

    recommendations.push(recommendation);
  }

  const duration = Date.now() - startTime;
  console.log(`[Renderer] Generated ${recommendations.length} recommendations in ${duration}ms`);

  return recommendations;
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

  // Utilities (exported for testing)
  extractFailingSubfactors,
  buildPlaceholderContext,
  resolvePlaceholders,
  resolvePlaceholdersInArray,
  extractEvidence,
  buildEvidenceJson,
  validateNoUnresolvedPlaceholders,
  getNumericScore,
  isBelowThreshold,
  generateRecKey
};
