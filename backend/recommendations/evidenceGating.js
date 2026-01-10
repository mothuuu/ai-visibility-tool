/**
 * EVIDENCE GATING
 * File: backend/recommendations/evidenceGating.js
 *
 * Evidence quality assessment and gating logic for recommendations.
 * Ensures recommendations are trustworthy and evidence-supported.
 *
 * Phase 4A.1.5: Evidence-gating + confidence rules
 */

// ========================================
// CONSTANTS
// ========================================

const EVIDENCE_QUALITY = {
  STRONG: 'strong',
  MEDIUM: 'medium',
  WEAK: 'weak',
  AMBIGUOUS: 'ambiguous'
};

// Confidence thresholds
const CONFIDENCE_THRESHOLDS = {
  STRONG: 0.85,
  MEDIUM: 0.6,
  WEAK: 0.4,
  AMBIGUOUS: 0.35
};

// FAQ false-positive patterns (navigation/menu toggles)
const FAQ_FALSE_POSITIVE_PATTERNS = [
  /^close\s/i,
  /^open\s/i,
  /\smenu$/i,
  /\smenu\s/i,
  /^menu\s/i,
  /about\s+us\s+menu/i,
  /products?\s+menu/i,
  /services?\s+menu/i,
  /toggle\s/i,
  /navigation/i,
  /expand\s/i,
  /collapse\s/i,
  /show\s+more/i,
  /hide\s/i
];

// ========================================
// EVIDENCE EXTRACTION
// ========================================

/**
 * Safely extract value from nested object using dot-notation path
 * @param {Object} obj - Source object
 * @param {string} path - Dot-notation path (e.g., 'siteMetrics.pagesWithFAQSchema')
 * @returns {*} - Value at path or undefined
 */
function getNestedValue(obj, path) {
  if (!obj || !path || typeof path !== 'string') return undefined;
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Extract evidence from scanEvidence using selectors
 * @param {Object} scanEvidence - Evidence contract object
 * @param {string[]} selectors - Array of dot-notation paths
 * @returns {{ found: Record<string, any>, missing: string[] }}
 */
function getEvidence(scanEvidence, selectors) {
  const found = {};
  const missing = [];

  if (!scanEvidence || !Array.isArray(selectors)) {
    return { found, missing: selectors || [] };
  }

  for (const selector of selectors) {
    const value = getNestedValue(scanEvidence, selector);
    if (value !== undefined && value !== null) {
      // Use last part of selector as key
      const key = selector.split('.').pop();
      found[key] = value;
    } else {
      missing.push(selector);
    }
  }

  return { found, missing };
}

/**
 * Check if a value is "truthy" for evidence purposes
 * Handles: booleans, numbers, arrays, objects
 */
function isEvidencePresent(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return !!value;
}

// ========================================
// FAQ FALSE-POSITIVE DETECTION
// ========================================

/**
 * Check if a FAQ question looks like a navigation/menu toggle
 * @param {string} question - FAQ question text
 * @returns {boolean}
 */
function isFaqFalsePositive(question) {
  if (!question || typeof question !== 'string') return false;
  const normalized = question.trim();

  for (const pattern of FAQ_FALSE_POSITIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  // Additional heuristics: very short questions (< 10 chars) are suspicious
  if (normalized.length < 10 && !normalized.includes('?')) {
    return true;
  }

  return false;
}

/**
 * Analyze FAQ content for false positives
 * @param {Object} scanEvidence - Evidence contract object
 * @returns {{ isSuspicious: boolean, suspiciousCount: number, totalCount: number, reasons: string[] }}
 */
function analyzeFaqQuality(scanEvidence) {
  const result = {
    isSuspicious: false,
    suspiciousCount: 0,
    totalCount: 0,
    reasons: []
  };

  if (!scanEvidence) return result;

  // Check content.faqs array if available
  const faqs = scanEvidence.content?.faqs || [];
  result.totalCount = faqs.length;

  for (const faq of faqs) {
    const question = faq.question || faq.q || '';
    if (isFaqFalsePositive(question)) {
      result.suspiciousCount++;
      if (result.reasons.length < 3) {
        result.reasons.push(`"${question.substring(0, 50)}..." looks like nav toggle`);
      }
    }
  }

  // If majority of FAQs look suspicious, mark as suspicious
  if (result.totalCount > 0 && result.suspiciousCount >= result.totalCount * 0.5) {
    result.isSuspicious = true;
    result.reasons.unshift(`${result.suspiciousCount}/${result.totalCount} detected FAQs appear to be navigation toggles`);
  }

  // Conservative rule: FAQ count > 0 but no FAQ URL detected and no FAQ schema
  const hasFaqUrl = scanEvidence.navigation?.keyPages?.faq ||
                    scanEvidence.crawler?.discoveredSections?.hasFaqUrl ||
                    scanEvidence.navigation?.hasFAQLink;
  const hasFaqSchema = scanEvidence.technical?.hasFAQSchema;

  if (result.totalCount > 0 && !hasFaqUrl && !hasFaqSchema) {
    // This is a warning signal - FAQs detected but no dedicated FAQ page or schema
    if (!result.isSuspicious) {
      result.isSuspicious = true;
      result.reasons.push('FAQs detected in content but no FAQ page URL or FAQPage schema found');
    }
  }

  return result;
}

// ========================================
// EVIDENCE QUALITY ASSESSMENT
// ========================================

/**
 * Assess evidence quality for a playbook entry
 * @param {Object} scanEvidence - Evidence contract object
 * @param {Object} playbookEntry - Playbook entry with evidence_selectors
 * @param {Object} context - Context object
 * @returns {{ quality: string, confidence: number, summary: string, details: Object }}
 */
function assessEvidenceQuality(scanEvidence, playbookEntry, context = {}) {
  const entry = playbookEntry || {};
  const selectors = entry.evidence_selectors || [];
  const minEvidence = entry.min_evidence || [];
  const disqualifiers = entry.disqualifiers || [];
  const ambiguityRules = entry.ambiguity_rules || [];
  const subfactorKey = entry.canonical_key || '';

  // Extract evidence
  const { found, missing } = getEvidence(scanEvidence, selectors);
  const { found: minFound, missing: minMissing } = getEvidence(scanEvidence, minEvidence);

  const details = {
    selectorsChecked: selectors.length,
    selectorsFound: Object.keys(found).length,
    selectorsMissing: missing.length,
    minEvidenceChecked: minEvidence.length,
    minEvidenceFound: Object.keys(minFound).length,
    minEvidenceMissing: minMissing.length,
    disqualifiersTriggered: [],
    ambiguityTriggered: []
  };

  // Default assessment
  let quality = EVIDENCE_QUALITY.MEDIUM;
  let confidence = CONFIDENCE_THRESHOLDS.MEDIUM;
  let summaryParts = [];

  // Step 1: Check disqualifiers
  for (const disq of disqualifiers) {
    if (disq.selector) {
      const value = getNestedValue(scanEvidence, disq.selector);
      if (disq.pattern) {
        const regex = new RegExp(disq.pattern, 'i');
        if (value && regex.test(String(value))) {
          details.disqualifiersTriggered.push(disq.reason);
        }
      } else if (isEvidencePresent(value)) {
        details.disqualifiersTriggered.push(disq.reason);
      }
    }
  }

  if (details.disqualifiersTriggered.length > 0) {
    quality = EVIDENCE_QUALITY.AMBIGUOUS;
    confidence = Math.min(confidence, CONFIDENCE_THRESHOLDS.AMBIGUOUS);
    summaryParts.push(`Disqualified: ${details.disqualifiersTriggered.join('; ')}`);
  }

  // Step 2: Check ambiguity rules
  for (const amb of ambiguityRules) {
    if (amb.selector) {
      const value = getNestedValue(scanEvidence, amb.selector);
      if (amb.pattern) {
        const regex = new RegExp(amb.pattern, 'i');
        if (value && regex.test(String(value))) {
          details.ambiguityTriggered.push(amb.reason);
        }
      }
    }
  }

  if (details.ambiguityTriggered.length > 0 && quality !== EVIDENCE_QUALITY.AMBIGUOUS) {
    quality = EVIDENCE_QUALITY.AMBIGUOUS;
    confidence = Math.min(confidence, CONFIDENCE_THRESHOLDS.AMBIGUOUS + 0.1);
    summaryParts.push(`Ambiguous: ${details.ambiguityTriggered.join('; ')}`);
  }

  // Step 3: Special handling for FAQ-related subfactors
  if (subfactorKey.toLowerCase().includes('faq')) {
    const faqAnalysis = analyzeFaqQuality(scanEvidence);
    if (faqAnalysis.isSuspicious) {
      quality = EVIDENCE_QUALITY.AMBIGUOUS;
      confidence = Math.min(confidence, CONFIDENCE_THRESHOLDS.AMBIGUOUS);
      summaryParts.push(faqAnalysis.reasons[0] || 'FAQ content appears suspicious');
      details.faqAnalysis = faqAnalysis;
    }
  }

  // Step 4: Assess based on evidence coverage (only if not already ambiguous)
  if (quality !== EVIDENCE_QUALITY.AMBIGUOUS) {
    if (minEvidence.length > 0) {
      // Use min_evidence for quality determination
      const minCoverage = minEvidence.length > 0
        ? Object.keys(minFound).length / minEvidence.length
        : 0;

      if (minCoverage >= 0.8) {
        quality = EVIDENCE_QUALITY.STRONG;
        confidence = CONFIDENCE_THRESHOLDS.STRONG;
        summaryParts.push(`Strong evidence: ${Object.keys(minFound).length}/${minEvidence.length} required signals found`);
      } else if (minCoverage >= 0.5) {
        quality = EVIDENCE_QUALITY.MEDIUM;
        confidence = CONFIDENCE_THRESHOLDS.MEDIUM + (minCoverage - 0.5) * 0.4;
        summaryParts.push(`Medium evidence: ${Object.keys(minFound).length}/${minEvidence.length} required signals found`);
      } else {
        quality = EVIDENCE_QUALITY.WEAK;
        confidence = CONFIDENCE_THRESHOLDS.WEAK + minCoverage * 0.3;
        summaryParts.push(`Weak evidence: only ${Object.keys(minFound).length}/${minEvidence.length} required signals found`);
      }
    } else if (selectors.length > 0) {
      // Use evidence_selectors for quality determination
      const coverage = Object.keys(found).length / selectors.length;

      if (coverage >= 0.7) {
        quality = EVIDENCE_QUALITY.MEDIUM;
        confidence = CONFIDENCE_THRESHOLDS.MEDIUM + coverage * 0.2;
        summaryParts.push(`${Object.keys(found).length}/${selectors.length} evidence selectors found`);
      } else if (coverage >= 0.3) {
        quality = EVIDENCE_QUALITY.WEAK;
        confidence = CONFIDENCE_THRESHOLDS.WEAK + coverage * 0.3;
        summaryParts.push(`Only ${Object.keys(found).length}/${selectors.length} evidence selectors found`);
      } else {
        quality = EVIDENCE_QUALITY.WEAK;
        confidence = CONFIDENCE_THRESHOLDS.WEAK;
        summaryParts.push(`Insufficient evidence: ${Object.keys(found).length}/${selectors.length} selectors found`);
      }
    } else {
      // No selectors defined - default to weak
      quality = EVIDENCE_QUALITY.WEAK;
      confidence = CONFIDENCE_THRESHOLDS.WEAK;
      summaryParts.push('No evidence selectors defined for this recommendation');
    }
  }

  // Step 5: Context adjustments
  if (context.detected_industry || context.icp_roles) {
    confidence = Math.min(1, confidence + 0.05);
    if (quality === EVIDENCE_QUALITY.WEAK && confidence > CONFIDENCE_THRESHOLDS.WEAK + 0.15) {
      quality = EVIDENCE_QUALITY.MEDIUM;
    }
  }

  // Clamp confidence
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    quality,
    confidence: Math.round(confidence * 100) / 100,
    summary: summaryParts.join('. ') || 'Evidence assessed',
    details
  };
}

// ========================================
// HOOK-SPECIFIC EVIDENCE REQUIREMENTS
// ========================================

/**
 * Check if evidence is sufficient for a specific generation hook
 * @param {string} hookKey - Generation hook key
 * @param {Object} scanEvidence - Evidence contract object
 * @param {Object} context - Context object
 * @returns {{ canGenerate: boolean, reason: string }}
 */
function canRunGenerationHook(hookKey, scanEvidence, context = {}) {
  const evidence = scanEvidence || {};
  const ctx = context || {};

  switch (hookKey) {
    case 'technical_setup.organization_schema': {
      // Require: org name or site name, and ideally logo
      const hasOrgName = !!(
        evidence.entities?.entities?.organizations?.[0]?.name ||
        evidence.content?.headings?.h1?.[0] ||
        evidence.metadata?.ogTitle ||
        ctx.company_name
      );
      const hasLogo = !!(
        evidence.metadata?.ogImage ||
        ctx.logo_url
      );
      const hasSiteUrl = !!(evidence.url || ctx.site_url);

      if (hasOrgName && hasSiteUrl) {
        return { canGenerate: true, reason: 'Sufficient organization identity signals' };
      }
      return {
        canGenerate: false,
        reason: hasOrgName
          ? 'Missing site URL for organization schema'
          : 'Unable to reliably determine organization name'
      };
    }

    case 'technical_setup.open_graph_tags': {
      // Require: title and description candidates
      const hasTitle = !!(
        evidence.metadata?.title ||
        evidence.metadata?.ogTitle ||
        evidence.content?.headings?.h1?.[0] ||
        ctx.company_name
      );
      const hasDescription = !!(
        evidence.metadata?.description ||
        evidence.metadata?.ogDescription ||
        evidence.content?.paragraphs?.[0]
      );

      if (hasTitle && hasDescription) {
        return { canGenerate: true, reason: 'Title and description available' };
      }
      return {
        canGenerate: false,
        reason: !hasTitle
          ? 'No page title detected'
          : 'No description content available'
      };
    }

    case 'ai_search_readiness.icp_faqs': {
      // Require: industry context or ICP roles, and check for FAQ false positives
      const hasIndustry = !!(ctx.detected_industry || ctx.industry);
      const hasIcpRoles = Array.isArray(ctx.icp_roles) && ctx.icp_roles.length > 0;

      // Check FAQ quality
      const faqAnalysis = analyzeFaqQuality(evidence);
      if (faqAnalysis.isSuspicious) {
        return {
          canGenerate: false,
          reason: `FAQ generation blocked: ${faqAnalysis.reasons[0] || 'suspicious FAQ content detected'}`
        };
      }

      if (hasIndustry || hasIcpRoles) {
        return { canGenerate: true, reason: 'Industry context available for FAQ generation' };
      }
      return {
        canGenerate: false,
        reason: 'Missing industry context or ICP roles for tailored FAQ generation'
      };
    }

    default:
      // Unknown hook - allow by default but with warning
      return { canGenerate: true, reason: 'Unknown hook - proceeding with caution' };
  }
}

// ========================================
// AUTOMATION LEVEL ADJUSTMENT
// ========================================

/**
 * Downgrade automation level based on evidence quality
 * @param {string} currentLevel - Current automation_level
 * @param {string} evidenceQuality - Assessed evidence quality
 * @returns {string} - Adjusted automation_level
 */
function adjustAutomationLevel(currentLevel, evidenceQuality) {
  const levels = ['generate', 'draft', 'guide', 'manual'];
  const currentIndex = levels.indexOf(currentLevel);

  if (currentIndex === -1) return currentLevel;

  switch (evidenceQuality) {
    case EVIDENCE_QUALITY.STRONG:
      // No adjustment needed
      return currentLevel;

    case EVIDENCE_QUALITY.MEDIUM:
      // generate stays generate, others unchanged
      return currentLevel;

    case EVIDENCE_QUALITY.WEAK:
      // Downgrade by one level
      if (currentLevel === 'generate') return 'draft';
      if (currentLevel === 'draft') return 'guide';
      return currentLevel;

    case EVIDENCE_QUALITY.AMBIGUOUS:
      // Downgrade by two levels
      if (currentLevel === 'generate') return 'guide';
      if (currentLevel === 'draft') return 'manual';
      if (currentLevel === 'guide') return 'manual';
      return currentLevel;

    default:
      return currentLevel;
  }
}

// ========================================
// RECOMMENDATION FILTERING
// ========================================

/**
 * Determine if a recommendation should be skipped/filtered
 * @param {Object} params
 * @param {string} params.evidenceQuality - Assessed evidence quality
 * @param {string} params.automationLevel - Adjusted automation level
 * @param {number} params.score - Subfactor score
 * @param {number} params.threshold - Score threshold
 * @returns {{ shouldSkip: boolean, reason: string }}
 */
function shouldSkipRecommendation({ evidenceQuality, automationLevel, score, threshold }) {
  // Skip if ambiguous AND would have been generate-level
  // (too risky to show as actionable)
  if (evidenceQuality === EVIDENCE_QUALITY.AMBIGUOUS && automationLevel === 'generate') {
    return {
      shouldSkip: false, // Don't skip, but will be manual with verify guidance
      reason: 'Ambiguous evidence - requires verification'
    };
  }

  // Skip if evidence is entirely missing AND score is only slightly below threshold
  // (65-70 range with no evidence = likely noise)
  const gap = threshold - score;
  if (evidenceQuality === EVIDENCE_QUALITY.WEAK && gap < 10 && gap >= 0) {
    return {
      shouldSkip: true,
      reason: `Score ${score} is close to threshold ${threshold} with weak evidence - likely noise`
    };
  }

  return { shouldSkip: false, reason: '' };
}

/**
 * Generate action items for verification when evidence is weak/ambiguous
 * @param {string} subfactorKey - Subfactor key
 * @param {string} evidenceQuality - Evidence quality
 * @param {Object} details - Assessment details
 * @returns {string[]} - Additional action items to prepend
 */
function getVerificationActionItems(subfactorKey, evidenceQuality, details = {}) {
  const items = [];

  if (evidenceQuality === EVIDENCE_QUALITY.AMBIGUOUS) {
    if (subfactorKey.toLowerCase().includes('faq')) {
      items.push('⚠️ Verify whether detected FAQs are real on-page Q&A (not navigation menu toggles).');
    } else {
      items.push('⚠️ Verify the detected issue before taking action - evidence is ambiguous.');
    }
  }

  if (evidenceQuality === EVIDENCE_QUALITY.WEAK) {
    items.push('Collect/confirm missing inputs required to generate this asset.');
  }

  if (details.minEvidenceMissing > 0) {
    items.push(`Missing evidence: check ${details.minEvidenceMissing} required data points.`);
  }

  return items;
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  // Constants
  EVIDENCE_QUALITY,
  CONFIDENCE_THRESHOLDS,

  // Evidence extraction
  getEvidence,
  getNestedValue,
  isEvidencePresent,

  // FAQ analysis
  isFaqFalsePositive,
  analyzeFaqQuality,
  FAQ_FALSE_POSITIVE_PATTERNS,

  // Quality assessment
  assessEvidenceQuality,

  // Hook gating
  canRunGenerationHook,

  // Automation level adjustment
  adjustAutomationLevel,

  // Filtering
  shouldSkipRecommendation,
  getVerificationActionItems
};
