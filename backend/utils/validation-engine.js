const db = require('../db/database');

/**
 * Validation Engine
 *
 * Detects partial implementation of recommendations by comparing
 * previous scan to current scan evidence.
 */

/**
 * Validate all completed recommendations from previous scan
 *
 * @param {number} userId - User ID
 * @param {number} newScanId - New scan ID
 * @param {Object} newEvidence - Evidence from new scan
 * @returns {Object} Validation results
 */
async function validatePreviousRecommendations(userId, newScanId, newEvidence) {
  console.log(`[Validation] Validating previous recommendations for user ${userId}`);

  try {
    // Get previous scan for this domain
    const previousScanResult = await db.query(
      `SELECT s.id, s.url, s.total_score, s.completed_at
       FROM scans s
       WHERE s.user_id = $1
         AND s.id != $2
         AND s.url = (SELECT url FROM scans WHERE id = $2)
       ORDER BY s.completed_at DESC
       LIMIT 1`,
      [userId, newScanId]
    );

    if (previousScanResult.rows.length === 0) {
      console.log(`[Validation] No previous scan found - skipping validation`);
      return {
        validated: false,
        reason: 'no_previous_scan'
      };
    }

    const previousScan = previousScanResult.rows[0];
    console.log(`[Validation] Found previous scan ${previousScan.id} from ${previousScan.completed_at}`);

    // Get completed/implemented recommendations from previous scan
    const completedRecsResult = await db.query(
      `SELECT id, category, recommendation_text, findings, subfactor_key,
              unlock_state, marked_complete_at
       FROM scan_recommendations
       WHERE scan_id = $1
         AND (unlock_state = 'completed' OR status = 'implemented')
       ORDER BY marked_complete_at DESC`,
      [previousScan.id]
    );

    if (completedRecsResult.rows.length === 0) {
      console.log(`[Validation] No completed recommendations to validate`);
      return {
        validated: false,
        reason: 'no_completed_recommendations'
      };
    }

    console.log(`[Validation] Validating ${completedRecsResult.rows.length} completed recommendations`);

    const validationResults = [];

    for (const rec of completedRecsResult.rows) {
      const result = await validateSingleRecommendation(
        rec,
        newScanId,
        newEvidence,
        previousScan
      );
      validationResults.push(result);
    }

    // Summary
    const summary = {
      validated: true,
      total: validationResults.length,
      verified_complete: validationResults.filter(r => r.outcome === 'verified_complete').length,
      partial_progress: validationResults.filter(r => r.outcome === 'partial_progress').length,
      not_implemented: validationResults.filter(r => r.outcome === 'not_implemented').length,
      regressed: validationResults.filter(r => r.outcome === 'regressed').length,
      results: validationResults
    };

    console.log(`[Validation] Summary:`, summary);

    return summary;

  } catch (error) {
    console.error('[Validation] Error:', error);
    throw error;
  }
}

/**
 * Validate a single recommendation
 *
 * @param {Object} recommendation - Recommendation to validate
 * @param {number} newScanId - New scan ID
 * @param {Object} newEvidence - Evidence from new scan
 * @param {Object} previousScan - Previous scan details
 * @returns {Object} Validation result
 */
async function validateSingleRecommendation(recommendation, newScanId, newEvidence, previousScan) {
  console.log(`[Validation] Checking: ${recommendation.recommendation_text.substring(0, 60)}...`);

  // Determine validation logic based on subfactor_key (column renamed from subfactor)
  const subfactor = recommendation.subfactor_key || recommendation.category;
  let validationResult;

  switch (subfactor) {
    case 'faqScore':
      validationResult = validateFAQImplementation(recommendation, newEvidence);
      break;

    case 'organizationSchema':
    case 'structuredDataScore':
      validationResult = validateSchemaImplementation(recommendation, newEvidence);
      break;

    case 'sitemapScore':
      validationResult = validateSitemapImplementation(recommendation, newEvidence);
      break;

    case 'headingHierarchyScore':
      validationResult = validateHeadingStructure(recommendation, newEvidence);
      break;

    case 'altTextScore':
      validationResult = validateAltText(recommendation, newEvidence);
      break;

    default:
      // Generic validation - check if score improved
      validationResult = validateGeneric(recommendation, newEvidence, subfactor);
      break;
  }

  // Save validation result to history (skip if table doesn't exist yet)
  try {
    await db.query(
      `INSERT INTO recommendation_validation_history (
        recommendation_id, scan_id, user_id,
        was_implemented, is_partial, completion_percentage,
        checked_elements, found_elements, missing_elements,
        outcome, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        recommendation.id,
        newScanId,
        previousScan.user_id || null,
        validationResult.wasImplemented,
        validationResult.isPartial,
        validationResult.completionPercentage,
        JSON.stringify(validationResult.checkedElements || {}),
        JSON.stringify(validationResult.foundElements || {}),
        JSON.stringify(validationResult.missingElements || {}),
        validationResult.outcome,
        validationResult.notes
      ]
    );
  } catch (historyError) {
    // If table doesn't exist yet (migration not run), skip history tracking
    if (historyError.code === '42P01') {
      console.log('⚠️  recommendation_validation_history table not found - skipping history tracking');
    } else {
      throw historyError; // Re-throw other errors
    }
  }

  // If partial implementation, create new "in progress" recommendation
  if (validationResult.outcome === 'partial_progress' && validationResult.shouldRequeue) {
    await createInProgressRecommendation(
      recommendation,
      newScanId,
      validationResult
    );
  }

  return {
    recommendationId: recommendation.id,
    recommendationText: recommendation.recommendation_text,
    ...validationResult
  };
}

/**
 * Validate FAQ implementation
 */
function validateFAQImplementation(recommendation, newEvidence) {
  const faqCount = newEvidence.content?.faqs?.length || 0;
  const hasSchema = newEvidence.technical?.hasFAQSchema || false;

  const wasImplemented = faqCount >= 5 || (faqCount >= 3 && hasSchema);
  const isPartial = faqCount > 0 && faqCount < 5 && !hasSchema;

  let outcome, completionPercentage, notes;

  if (wasImplemented) {
    outcome = 'verified_complete';
    completionPercentage = 100;
    notes = `✅ Implementation verified: ${faqCount} FAQs detected${hasSchema ? ' with schema' : ''}`;
  } else if (isPartial) {
    outcome = 'partial_progress';
    completionPercentage = Math.min(80, (faqCount / 5) * 100);
    notes = `⚠️ Partial implementation: ${faqCount} FAQs found, ${hasSchema ? 'schema present' : 'missing schema'}. Need ${5 - faqCount} more FAQs.`;
  } else {
    outcome = 'not_implemented';
    completionPercentage = 0;
    notes = `❌ Not implemented: No FAQs detected`;
  }

  return {
    wasImplemented,
    isPartial,
    completionPercentage,
    outcome,
    notes,
    shouldRequeue: isPartial,
    checkedElements: { faqCount: 5, schemaRequired: true },
    foundElements: { faqCount, hasSchema },
    missingElements: {
      faqs: Math.max(0, 5 - faqCount),
      schema: !hasSchema
    }
  };
}

/**
 * Validate schema implementation
 */
function validateSchemaImplementation(recommendation, newEvidence) {
  const recText = recommendation.recommendation_text.toLowerCase();

  // Determine which schema type
  let schemaType, hasSchema, requiredProperties, foundProperties;

  if (recText.includes('organization')) {
    hasSchema = newEvidence.technical?.hasOrganizationSchema || false;
    schemaType = 'Organization';
    requiredProperties = ['name', 'url', 'logo', 'description', 'address', 'contactPoint', 'sameAs'];

    // Check schema details if available
    const orgSchema = newEvidence.technical?.structuredData?.find(s => s.type === 'Organization');
    foundProperties = orgSchema ? Object.keys(orgSchema.raw || {}) : [];
  } else if (recText.includes('faq')) {
    hasSchema = newEvidence.technical?.hasFAQSchema || false;
    schemaType = 'FAQPage';
    requiredProperties = ['@type', 'mainEntity'];
    foundProperties = hasSchema ? ['@type', 'mainEntity'] : [];
  } else if (recText.includes('article')) {
    hasSchema = newEvidence.technical?.hasArticleSchema || false;
    schemaType = 'Article';
    requiredProperties = ['headline', 'author', 'datePublished', 'image'];
    foundProperties = hasSchema ? ['headline'] : [];
  } else {
    // Generic schema
    hasSchema = (newEvidence.technical?.structuredData?.length || 0) > 0;
    schemaType = 'Structured Data';
    requiredProperties = [];
    foundProperties = [];
  }

  const completionPercentage = hasSchema ?
    Math.round((foundProperties.length / Math.max(1, requiredProperties.length)) * 100) : 0;

  const missingProperties = requiredProperties.filter(prop => !foundProperties.includes(prop));

  let outcome, notes;

  if (hasSchema && missingProperties.length === 0) {
    outcome = 'verified_complete';
    notes = `✅ ${schemaType} schema fully implemented`;
  } else if (hasSchema && missingProperties.length > 0) {
    outcome = 'partial_progress';
    notes = `⚠️ ${schemaType} schema detected but missing: ${missingProperties.join(', ')}`;
  } else {
    outcome = 'not_implemented';
    notes = `❌ ${schemaType} schema not detected`;
  }

  return {
    wasImplemented: hasSchema && missingProperties.length === 0,
    isPartial: hasSchema && missingProperties.length > 0,
    completionPercentage,
    outcome,
    notes,
    shouldRequeue: hasSchema && missingProperties.length > 0,
    checkedElements: { schemaType, requiredProperties },
    foundElements: { hasSchema, foundProperties },
    missingElements: { missingProperties }
  };
}

/**
 * Validate sitemap implementation
 */
function validateSitemapImplementation(recommendation, newEvidence) {
  const hasSitemap = newEvidence.technical?.hasSitemapLink || false;

  return {
    wasImplemented: hasSitemap,
    isPartial: false,
    completionPercentage: hasSitemap ? 100 : 0,
    outcome: hasSitemap ? 'verified_complete' : 'not_implemented',
    notes: hasSitemap ? '✅ Sitemap detected' : '❌ Sitemap not detected',
    shouldRequeue: false,
    checkedElements: { sitemap: true },
    foundElements: { hasSitemap },
    missingElements: { sitemap: !hasSitemap }
  };
}

/**
 * Validate heading structure
 */
function validateHeadingStructure(recommendation, newEvidence) {
  const h1Count = newEvidence.content?.headingStructure?.h1 || 0;
  const h2Count = newEvidence.content?.headingStructure?.h2 || 0;
  const hasProperStructure = h1Count === 1 && h2Count >= 2;

  const completionPercentage = hasProperStructure ? 100 :
    (h1Count === 1 ? 50 : 0) + (h2Count >= 2 ? 50 : Math.min(50, (h2Count / 2) * 50));

  return {
    wasImplemented: hasProperStructure,
    isPartial: (h1Count === 1 || h2Count >= 1) && !hasProperStructure,
    completionPercentage,
    outcome: hasProperStructure ? 'verified_complete' :
             (h1Count >= 1 || h2Count >= 1) ? 'partial_progress' : 'not_implemented',
    notes: hasProperStructure ?
      '✅ Heading structure implemented correctly' :
      `⚠️ Partial: H1 count: ${h1Count}, H2 count: ${h2Count}`,
    shouldRequeue: !hasProperStructure && (h1Count >= 1 || h2Count >= 1),
    checkedElements: { h1Required: 1, h2Required: 2 },
    foundElements: { h1Count, h2Count },
    missingElements: { h1: Math.max(0, 1 - h1Count), h2: Math.max(0, 2 - h2Count) }
  };
}

/**
 * Validate alt text implementation
 */
function validateAltText(recommendation, newEvidence) {
  const totalImages = newEvidence.media?.imageCount || 0;
  const imagesWithAlt = newEvidence.media?.imagesWithAlt || 0;
  const altTextPercentage = totalImages > 0 ? (imagesWithAlt / totalImages) * 100 : 0;

  const wasImplemented = altTextPercentage >= 90;
  const isPartial = altTextPercentage >= 50 && altTextPercentage < 90;

  return {
    wasImplemented,
    isPartial,
    completionPercentage: Math.round(altTextPercentage),
    outcome: wasImplemented ? 'verified_complete' :
             isPartial ? 'partial_progress' : 'not_implemented',
    notes: wasImplemented ?
      `✅ Alt text coverage: ${Math.round(altTextPercentage)}%` :
      `⚠️ Alt text coverage: ${Math.round(altTextPercentage)}% (${imagesWithAlt}/${totalImages} images)`,
    shouldRequeue: isPartial,
    checkedElements: { totalImages, targetPercentage: 90 },
    foundElements: { imagesWithAlt, currentPercentage: altTextPercentage },
    missingElements: { imagesWithoutAlt: totalImages - imagesWithAlt }
  };
}

/**
 * Generic validation - check if score improved in that category
 */
function validateGeneric(recommendation, newEvidence, subfactor) {
  // This is a fallback - we don't have specific validation logic
  return {
    wasImplemented: false,
    isPartial: false,
    completionPercentage: 0,
    outcome: 'not_implemented',
    notes: `⚠️ Unable to validate automatically - manual review required`,
    shouldRequeue: false,
    checkedElements: { subfactor },
    foundElements: {},
    missingElements: {}
  };
}

/**
 * Create an "in progress" recommendation for partial implementation
 */
async function createInProgressRecommendation(originalRec, newScanId, validationResult) {
  console.log(`[Validation] Creating in-progress recommendation for: ${originalRec.recommendation_text}`);

  // Generate updated finding text
  const updatedFinding = generateUpdatedFinding(originalRec, validationResult);

  // Insert as new recommendation with "in_progress" state
  await db.query(
    `INSERT INTO scan_recommendations (
      scan_id, category, recommendation_text, priority,
      estimated_impact, estimated_effort, action_steps, findings,
      unlock_state, batch_number, unlocked_at,
      previous_recommendation_id, original_finding,
      progress_percentage, validation_status, partial_completion_detected
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      newScanId,
      originalRec.category,
      generateUpdatedTitle(originalRec, validationResult),
      originalRec.priority, // Keep same priority
      originalRec.estimated_impact,
      originalRec.estimated_effort,
      originalRec.action_steps,
      updatedFinding,
      'in_progress', // Special state
      1, // Put in first batch
      new Date(), // Unlock immediately
      originalRec.id,
      originalRec.findings,
      validationResult.completionPercentage,
      'in_progress',
      true
    ]
  );

  console.log(`[Validation] Created in-progress recommendation`);
}

/**
 * Generate updated title for in-progress recommendation
 */
function generateUpdatedTitle(originalRec, validationResult) {
  const originalTitle = originalRec.recommendation_text;

  if (validationResult.missingElements) {
    const missing = validationResult.missingElements;

    if (missing.missingProperties && missing.missingProperties.length > 0) {
      return `Complete ${originalTitle} - Missing: ${missing.missingProperties.slice(0, 3).join(', ')}`;
    } else if (missing.faqs > 0) {
      return `Add ${missing.faqs} More FAQ${missing.faqs > 1 ? 's' : ''} ${missing.schema ? 'and Schema' : ''}`;
    } else if (missing.imagesWithoutAlt > 0) {
      return `Add Alt Text to ${missing.imagesWithoutAlt} More Images`;
    }
  }

  return `Complete: ${originalTitle}`;
}

/**
 * Generate updated finding text
 */
function generateUpdatedFinding(originalRec, validationResult) {
  const progress = validationResult.completionPercentage;
  const notes = validationResult.notes;

  let finding = `Status: In Progress (${progress}% Complete)\n\n`;
  finding += `${notes}\n\n`;
  finding += `Original Implementation:\n${originalRec.findings || 'See original recommendation'}\n\n`;

  if (validationResult.foundElements) {
    finding += `✅ What's Working:\n`;
    Object.entries(validationResult.foundElements).forEach(([key, value]) => {
      if (value && value !== false && value !== 0) {
        finding += `• ${key}: ${JSON.stringify(value)}\n`;
      }
    });
    finding += `\n`;
  }

  if (validationResult.missingElements) {
    finding += `⚠️ Still Needed:\n`;
    Object.entries(validationResult.missingElements).forEach(([key, value]) => {
      if (value && value !== false && value !== 0) {
        finding += `• ${key}: ${JSON.stringify(value)}\n`;
      }
    });
  }

  return finding;
}

module.exports = {
  validatePreviousRecommendations,
  validateSingleRecommendation
};
