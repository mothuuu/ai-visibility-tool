/**
 * Phase 5: ManualPacketConnector
 *
 * Connector for directories that require manual submission.
 * Generates a submission packet with instructions for the user.
 *
 * Invariants:
 * 1. Returns valid STATUS_REASON values (not ACTION_NEEDED_TYPE)
 * 2. Always provides action_needed.type for ACTION_NEEDED results
 */

'use strict';

const {
  STATUS_REASON,
  ACTION_NEEDED_TYPE
} = require('../../../constants/submission-enums');

class ManualPacketConnector {
  /**
   * "Submits" by generating instructions for manual submission
   *
   * @param {Object} payload - Submission payload
   * @param {Object} config - Connector configuration
   * @param {string} config.submissionUrl - URL where user should submit
   * @returns {Promise<Object>} Result with action_needed status
   */
  async submit(payload, config) {
    const { business, directory } = payload;
    const submissionUrl = config.submissionUrl || directory.submissionUrl;

    // Generate instructions
    const instructions = this._generateInstructions(business, directory, submissionUrl);

    // Generate submission packet
    const packet = this._generatePacket(business, directory);

    return {
      status: 'action_needed',
      // CRITICAL: reason is STATUS_REASON, not ACTION_NEEDED_TYPE
      reason: STATUS_REASON.VERIFICATION_REQUIRED,
      actionNeeded: {
        // action_needed_type column uses ACTION_NEEDED_TYPE
        type: ACTION_NEEDED_TYPE.MANUAL_REVIEW,
        url: submissionUrl,
        instructions,
        fields: packet,
        deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) // 10 days
      },
      response: {
        generatedAt: new Date().toISOString(),
        submissionUrl,
        packet
      }
    };
  }

  /**
   * Generates user-friendly instructions
   */
  _generateInstructions(business, directory, submissionUrl) {
    return `
To complete your submission to ${directory.name}:

1. Visit: ${submissionUrl || 'the directory website'}
2. Look for "Add Listing", "Submit Business", or "Claim Listing"
3. Fill in the following information:
   - Business Name: ${business.name}
   - Website: ${business.website}
   - Phone: ${business.phone || 'Your business phone'}
   - Address: ${business.address || 'Your business address'}
   - Description: Copy from the prepared packet below

4. Complete any verification steps required by the directory
5. Once submitted, come back here and click "Mark Complete"

If you encounter any issues, contact support.
    `.trim();
  }

  /**
   * Generates a submission packet with all required fields
   */
  _generatePacket(business, directory) {
    return {
      businessName: business.name,
      website: business.website,
      description: business.description || '',
      address: {
        street: business.address || '',
        city: business.city || '',
        state: business.state || '',
        zip: business.zip || ''
      },
      contact: {
        phone: business.phone || '',
        email: business.email || ''
      },
      categories: [], // Can be populated from business profile
      hours: null,    // Can be populated from business profile
      photos: []      // Can be populated from business profile
    };
  }
}

module.exports = ManualPacketConnector;
