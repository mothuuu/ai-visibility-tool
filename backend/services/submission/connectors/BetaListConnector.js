/**
 * Phase 5 Step 3A: BetaListConnector
 *
 * Manual-first connector for BetaList (Bucket B directory).
 * Generates high-quality submission packets for manual submission.
 *
 * BetaList is a startup discovery platform:
 * - Website: https://betalist.com
 * - Submit: https://betalist.com/submit
 * - Mode: Form-based (no public API)
 * - TOS: Automation not explicitly allowed
 *
 * Invariants:
 * 1. Returns valid STATUS_REASON enum values (not raw strings)
 * 2. Always provides action_needed.type for ACTION_NEEDED results
 * 3. Uses ARTIFACT_TYPE.SUBMISSION_PACKET for manual packets
 * 4. All validation errors use ERROR_TYPE enum values
 */

'use strict';

const {
  STATUS_REASON,
  ACTION_NEEDED_TYPE,
  ERROR_TYPE,
  ARTIFACT_TYPE
} = require('../../../constants/submission-enums');

// BetaList field constraints
const FIELD_LIMITS = {
  TAGLINE_MAX: 60,
  DESCRIPTION_MIN: 160,
  DESCRIPTION_MAX: 500,
  NAME_MAX: 100
};

// Field mapping: canonical → BetaList form field names
const FIELD_MAPPING = {
  business_name: 'startup[name]',
  short_description: 'startup[tagline]',
  long_description: 'startup[description]',
  website_url: 'startup[url]',
  contact_email: 'startup[email]',
  categories: 'startup[markets][]',
  logo_url: 'startup[logo]'
};

class BetaListConnector {
  constructor() {
    this.name = 'betalist-v1';
    this.directoryName = 'BetaList';
    this.directorySlug = 'betalist';
    this.submissionUrl = 'https://betalist.com/submit';
  }

  /**
   * Returns connector capabilities.
   * Only claims capabilities that are actually implemented.
   *
   * @returns {string[]} Array of capability strings
   */
  getCapabilities() {
    return ['validate', 'submit'];
  }

  /**
   * Derives a tagline from description if not provided.
   * Takes first sentence or truncates at 60 chars.
   */
  _deriveTagline(business) {
    // Check explicit tagline/short_description first
    if (business.tagline && business.tagline.trim()) {
      return business.tagline.trim();
    }
    if (business.short_description && business.short_description.trim()) {
      return business.short_description.trim();
    }

    // Derive from description
    const description = business.description || '';
    if (!description.trim()) {
      return null;
    }

    // Try to get first sentence
    const sentenceMatch = description.match(/^([^.!?]+[.!?])/);
    if (sentenceMatch && sentenceMatch[1].length <= FIELD_LIMITS.TAGLINE_MAX) {
      return sentenceMatch[1].trim();
    }

    // Truncate description at word boundary
    if (description.length <= FIELD_LIMITS.TAGLINE_MAX) {
      return description.trim();
    }

    const truncated = description.substring(0, FIELD_LIMITS.TAGLINE_MAX - 3);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 20) {
      return truncated.substring(0, lastSpace) + '...';
    }
    return truncated + '...';
  }

  /**
   * Validates a listing for BetaList submission.
   *
   * @param {Object} listing - The listing payload (from WorkerService._buildPayload)
   * @returns {Object} Validation result { valid, errors, warnings }
   */
  validate(listing) {
    const errors = [];
    const warnings = [];
    const business = listing.business || {};

    // Required: business_name (<=100 chars)
    if (!business.name || typeof business.name !== 'string' || business.name.trim() === '') {
      errors.push({
        field: 'business_name',
        message: 'Business name is required',
        code: 'REQUIRED'
      });
    } else if (business.name.length > FIELD_LIMITS.NAME_MAX) {
      errors.push({
        field: 'business_name',
        message: `Business name exceeds ${FIELD_LIMITS.NAME_MAX} characters (${business.name.length})`,
        code: 'MAX_LENGTH'
      });
    }

    // Required: short_description/tagline (<=60 chars)
    // If not provided, derive from description
    const tagline = this._deriveTagline(business);
    if (!tagline) {
      errors.push({
        field: 'short_description',
        message: 'Tagline is required (or provide a description to derive one)',
        code: 'REQUIRED'
      });
    } else {
      if (tagline.length > FIELD_LIMITS.TAGLINE_MAX) {
        errors.push({
          field: 'short_description',
          message: `Tagline exceeds ${FIELD_LIMITS.TAGLINE_MAX} characters (${tagline.length})`,
          code: 'MAX_LENGTH'
        });
      }
      // Stylistic warnings
      if (tagline.endsWith('.')) {
        warnings.push({
          field: 'short_description',
          message: 'Tagline ends with a period (typically omitted for taglines)',
          code: 'STYLE_PERIOD'
        });
      }
      if (/^(a|an)\s/i.test(tagline)) {
        warnings.push({
          field: 'short_description',
          message: 'Tagline starts with "a/an" (consider more direct phrasing)',
          code: 'STYLE_ARTICLE'
        });
      }
    }

    // Required: long_description (160-500 chars)
    const description = business.description || business.long_description;
    if (!description || typeof description !== 'string' || description.trim() === '') {
      errors.push({
        field: 'long_description',
        message: 'Description is required (160-500 characters)',
        code: 'REQUIRED'
      });
    } else {
      if (description.length < FIELD_LIMITS.DESCRIPTION_MIN) {
        errors.push({
          field: 'long_description',
          message: `Description is too short (${description.length} chars, minimum ${FIELD_LIMITS.DESCRIPTION_MIN})`,
          code: 'MIN_LENGTH'
        });
      }
      if (description.length > FIELD_LIMITS.DESCRIPTION_MAX) {
        errors.push({
          field: 'long_description',
          message: `Description exceeds ${FIELD_LIMITS.DESCRIPTION_MAX} characters (${description.length})`,
          code: 'MAX_LENGTH'
        });
      }
    }

    // Required: website_url (valid URL)
    if (!business.website || typeof business.website !== 'string' || business.website.trim() === '') {
      errors.push({
        field: 'website_url',
        message: 'Website URL is required',
        code: 'REQUIRED'
      });
    } else if (!this._isValidUrl(business.website)) {
      errors.push({
        field: 'website_url',
        message: 'Website URL is not valid',
        code: 'INVALID_FORMAT'
      });
    }

    // Required: contact_email (valid email)
    if (!business.email || typeof business.email !== 'string' || business.email.trim() === '') {
      errors.push({
        field: 'contact_email',
        message: 'Contact email is required',
        code: 'REQUIRED'
      });
    } else if (!this._isValidEmail(business.email)) {
      errors.push({
        field: 'contact_email',
        message: 'Contact email is not valid',
        code: 'INVALID_FORMAT'
      });
    }

    // Categories: warn if missing (common to not have in DB schema)
    // Operator will need to select categories manually during submission
    const categories = business.categories || business.markets;
    if (!Array.isArray(categories) || categories.length === 0) {
      warnings.push({
        field: 'categories',
        message: 'Categories not provided - operator must select during manual submission',
        code: 'MISSING_CATEGORIES'
      });
    }

    // Recommended: logo_url
    if (!business.logo_url && !business.logoUrl) {
      warnings.push({
        field: 'logo_url',
        message: 'Logo is recommended for better visibility',
        code: 'RECOMMENDED'
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Submits to BetaList (manual packet mode).
   * Returns ACTION_NEEDED status with high-quality submission packet.
   *
   * @param {Object} payload - Submission payload from WorkerService
   * @param {Object} context - Connector context
   * @returns {Promise<Object>} Result with action_needed status
   */
  async submit(payload, context) {
    const { business, directory, submission } = payload;

    // Defensive validation (should be validated upstream, but be safe)
    const validation = this.validate(payload);
    if (!validation.valid) {
      return {
        status: 'error',
        errorType: ERROR_TYPE.VALIDATION_ERROR,
        errorCode: 'VALIDATION_FAILED',
        errorMessage: `Validation failed: ${validation.errors.map(e => e.message).join('; ')}`,
        retryable: false,
        response: {
          validation
        }
      };
    }

    // Generate manual submission packet
    const packet = this._buildManualPacket(payload, context, validation.warnings);

    // Generate operator instructions
    const instructions = this._generateInstructions(business, packet);

    return {
      status: 'action_needed',
      // CRITICAL: reason is STATUS_REASON enum value
      reason: STATUS_REASON.VERIFICATION_REQUIRED,
      actionNeeded: {
        // action_needed_type column uses ACTION_NEEDED_TYPE enum
        type: ACTION_NEEDED_TYPE.MANUAL_REVIEW,
        url: this.submissionUrl,
        instructions,
        fields: packet.prefillData,
        deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) // 10 days
      },
      rawResponse: packet,
      response: {
        generatedAt: packet.generatedAt,
        submissionUrl: this.submissionUrl,
        packet
      }
    };
  }

  /**
   * Builds a high-quality manual submission packet.
   */
  _buildManualPacket(payload, context, warnings = []) {
    const { business, directory, submission } = payload;
    const tagline = this._deriveTagline(business) || '';
    const categories = business.categories || business.markets || [];

    return {
      // Directory metadata
      directoryName: this.directoryName,
      directorySlug: this.directorySlug,
      submissionUrl: this.submissionUrl,

      // Field mapping (canonical → BetaList)
      formFieldMap: { ...FIELD_MAPPING },

      // Prefill data (ready to paste/use)
      prefillData: {
        'startup[name]': business.name,
        'startup[tagline]': tagline,
        'startup[description]': business.description,
        'startup[url]': business.website,
        'startup[email]': business.email,
        'startup[markets][]': categories,
        'startup[logo]': business.logo_url || business.logoUrl || null
      },

      // Canonical data (for reference)
      canonicalData: {
        business_name: business.name,
        short_description: tagline,
        long_description: business.description,
        website_url: business.website,
        contact_email: business.email,
        categories: categories,
        logo_url: business.logo_url || business.logoUrl || null
      },

      // Operator instructions
      operatorInstructions: [
        '1. Navigate to https://betalist.com/submit',
        '2. Log in or create an account if required',
        '3. Fill in the "Startup Name" field',
        '4. Enter the tagline (max 60 characters)',
        '5. Paste the full description (160-500 characters)',
        '6. Enter the website URL',
        '7. Provide contact email',
        '8. Select at least one market/category',
        '9. Upload logo if available (square PNG/JPG recommended)',
        '10. Review all fields and submit',
        '11. Return here and mark as "Action Complete"'
      ],

      // Validation summary (warnings to note)
      validationSummary: {
        status: 'passed',
        warningCount: warnings.length,
        warnings: warnings.map(w => ({
          field: w.field,
          message: w.message
        }))
      },

      // Traceability
      correlationId: context?.correlationId || null,
      runId: context?.runId || null,
      targetId: submission?.targetId || null,

      // Timestamps
      generatedAt: new Date().toISOString(),

      // Compliance
      complianceNotice: 'Automation disabled by default. Manual submission recommended due to TOS uncertainty.',
      tosReviewed: true,
      automationEnabled: false
    };
  }

  /**
   * Generates step-by-step instructions for the operator.
   */
  _generateInstructions(business, packet) {
    const warningText = packet.validationSummary.warningCount > 0
      ? `\n\nNote: ${packet.validationSummary.warningCount} warning(s) to review:\n${packet.validationSummary.warnings.map(w => `- ${w.field}: ${w.message}`).join('\n')}`
      : '';

    return `
=== BetaList Submission Instructions ===

STEP 1: Go to ${this.submissionUrl}

STEP 2: Log in or create an account if you don't have one

STEP 3: Fill in the following information:

  Startup Name: ${business.name}

  Tagline (max 60 chars):
  ${packet.canonicalData.short_description || '[Enter a short, catchy tagline]'}

  Description (160-500 chars):
  ${business.description || '[Paste your full description]'}

  Website: ${business.website}

  Email: ${business.email}

  Categories: ${(packet.canonicalData.categories || []).join(', ') || '[Select at least one]'}

  Logo: ${packet.canonicalData.logo_url || '[Upload square PNG/JPG]'}

STEP 4: Review all fields for accuracy

STEP 5: Click "Submit" to complete submission

STEP 6: Return to the dashboard and click "Mark Complete"
${warningText}

---
Generated: ${packet.generatedAt}
Compliance: ${packet.complianceNotice}
    `.trim();
  }

  /**
   * Validates URL format
   */
  _isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validates email format
   */
  _isValidEmail(email) {
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

module.exports = BetaListConnector;
