/**
 * Phase 5: TestConnector
 *
 * Deterministic connector for E2E tests.
 * Only registered when NODE_ENV === 'test' or TEST_CONNECTOR_ENABLED is set.
 *
 * Features:
 * - Deterministic responses based on payload/test flags
 * - Returns proper enum values (SUBMISSION_STATUS, STATUS_REASON, etc.)
 * - Includes sensitive data in responses to test redaction
 */

'use strict';

const {
  STATUS_REASON,
  ACTION_NEEDED_TYPE,
  ERROR_TYPE
} = require('../../../constants/submission-enums');

// Test control flags (set via payload or global)
let testMode = 'success'; // 'success', 'error', 'action_needed', 'already_listed'
let testErrorType = ERROR_TYPE.NETWORK_ERROR;
let testErrorRetryable = true;

class TestConnector {
  constructor() {
    this.name = 'test-connector-v1';
    this.capabilities = ['validate', 'submit'];
  }

  /**
   * Sets the test mode for subsequent submissions
   *
   * @param {string} mode - 'success', 'error', 'action_needed', 'already_listed'
   * @param {Object} [options] - Additional options
   */
  static setTestMode(mode, options = {}) {
    testMode = mode;
    if (options.errorType) {
      testErrorType = options.errorType;
    }
    if (typeof options.retryable === 'boolean') {
      testErrorRetryable = options.retryable;
    }
  }

  /**
   * Resets test mode to default
   */
  static resetTestMode() {
    testMode = 'success';
    testErrorType = ERROR_TYPE.NETWORK_ERROR;
    testErrorRetryable = true;
  }

  /**
   * Validates a listing (always passes for tests)
   *
   * @param {Object} payload - Submission payload
   * @returns {Object} Validation result
   */
  validate(payload) {
    // Check for minimal required fields
    const { business } = payload;

    if (!business?.name) {
      return {
        valid: false,
        errors: ['Business name is required']
      };
    }

    return { valid: true, errors: [] };
  }

  /**
   * Submits a listing with deterministic results
   *
   * @param {Object} payload - Submission payload
   * @param {Object} context - Connector context
   * @returns {Promise<Object>} Submission result
   */
  async submit(payload, context) {
    // Check for inline test mode override via payload
    const mode = payload._testMode || testMode;
    const errorType = payload._testErrorType || testErrorType;
    const retryable = payload._testRetryable ?? testErrorRetryable;

    // Simulate processing time (minimal for tests)
    await new Promise(resolve => setTimeout(resolve, 10));

    switch (mode) {
      case 'success':
        return this._successResponse(payload);

      case 'error':
        return this._errorResponse(payload, errorType, retryable);

      case 'action_needed':
        return this._actionNeededResponse(payload, context);

      case 'already_listed':
        return this._alreadyListedResponse(payload);

      default:
        return this._successResponse(payload);
    }
  }

  /**
   * Success response with redaction-testable data
   */
  _successResponse(payload) {
    const externalId = `test-ext-${Date.now()}`;

    return {
      status: 'submitted',
      externalId,
      rawStatus: 'pending_review',
      rawStatusMessage: 'Submission received and pending review',
      response: {
        // Include sensitive data to test redaction
        submissionId: externalId,
        businessName: payload.business?.name,
        email: 'test@example.com', // PII - should be redacted
        phone: '555-123-4567', // PII - should be redacted
        apiKey: 'sk_live_test_secret_key_12345', // Sensitive - should be redacted
        token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test', // Sensitive - should be redacted
        status: 'received',
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Error response
   */
  _errorResponse(payload, errorType, retryable) {
    // For non-retryable errors, use a non-retryable error type
    const actualErrorType = retryable
      ? errorType
      : ERROR_TYPE.VALIDATION_ERROR;

    return {
      status: 'error',
      errorType: actualErrorType,
      errorCode: 'TEST_ERROR',
      errorMessage: `Test error: ${actualErrorType}`,
      retryable,
      response: {
        error: true,
        type: actualErrorType,
        message: 'Test connector simulated error'
      }
    };
  }

  /**
   * Action needed response
   */
  _actionNeededResponse(payload, context) {
    return {
      status: 'action_needed',
      reason: STATUS_REASON.VERIFICATION_REQUIRED,
      actionNeeded: {
        type: ACTION_NEEDED_TYPE.MANUAL_REVIEW,
        url: context?.submissionUrl || 'https://test-directory.example.com/submit',
        instructions: 'Please complete manual verification on the directory website.',
        fields: {
          businessName: payload.business?.name,
          website: payload.business?.website
        },
        deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      },
      response: {
        requiresAction: true,
        actionType: 'manual_review',
        email: 'contact@example.com' // PII for redaction test
      }
    };
  }

  /**
   * Already listed response
   */
  _alreadyListedResponse(payload) {
    return {
      status: 'already_listed',
      existingListingId: `existing-${Date.now()}`,
      listingUrl: 'https://test-directory.example.com/listing/12345',
      response: {
        duplicate: true,
        existingListing: {
          id: `existing-${Date.now()}`,
          name: payload.business?.name,
          url: 'https://test-directory.example.com/listing/12345'
        }
      }
    };
  }
}

/**
 * Registers the test connector if in test environment
 */
function registerTestConnector(registry) {
  if (process.env.NODE_ENV === 'test' || process.env.TEST_CONNECTOR_ENABLED === '1') {
    const connector = new TestConnector();
    registry.register('test-connector-v1', connector);
    console.log('[TestConnector] Registered test-connector-v1');
    return connector;
  }
  return null;
}

module.exports = {
  TestConnector,
  registerTestConnector
};
