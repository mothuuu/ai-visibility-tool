/**
 * Phase 5: Submission Invariant Tests
 *
 * Tests to verify core invariants are enforced.
 */

'use strict';

const {
  SUBMISSION_STATUS,
  STATUS_REASON,
  ACTION_NEEDED_TYPE,
  ERROR_TYPE,
  mapActionNeededToStatusReason,
  mapErrorTypeToStatusReason,
  isValidTransition,
  isRetryableError
} = require('../../constants/submission-enums');

describe('Submission Enums', () => {
  describe('STATUS_REASON values', () => {
    it('should have unique values', () => {
      const values = Object.values(STATUS_REASON);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });

    it('should all be lowercase with underscores', () => {
      Object.values(STATUS_REASON).forEach(value => {
        expect(value).toMatch(/^[a-z_]+$/);
      });
    });
  });

  describe('mapActionNeededToStatusReason', () => {
    it('should map all ACTION_NEEDED_TYPE values to valid STATUS_REASON', () => {
      const statusReasonValues = new Set(Object.values(STATUS_REASON));

      Object.values(ACTION_NEEDED_TYPE).forEach(actionType => {
        const result = mapActionNeededToStatusReason(actionType);
        expect(statusReasonValues.has(result)).toBe(true);
      });
    });

    it('should map CAPTCHA to captcha_required', () => {
      expect(mapActionNeededToStatusReason(ACTION_NEEDED_TYPE.CAPTCHA))
        .toBe(STATUS_REASON.CAPTCHA_REQUIRED);
    });

    it('should map MFA to mfa_required', () => {
      expect(mapActionNeededToStatusReason(ACTION_NEEDED_TYPE.MFA))
        .toBe(STATUS_REASON.MFA_REQUIRED);
    });

    it('should map MANUAL_REVIEW to verification_required', () => {
      expect(mapActionNeededToStatusReason(ACTION_NEEDED_TYPE.MANUAL_REVIEW))
        .toBe(STATUS_REASON.VERIFICATION_REQUIRED);
    });

    it('should return verification_required for unknown types', () => {
      expect(mapActionNeededToStatusReason('unknown_type'))
        .toBe(STATUS_REASON.VERIFICATION_REQUIRED);
    });
  });

  describe('mapErrorTypeToStatusReason', () => {
    it('should map network_error correctly', () => {
      expect(mapErrorTypeToStatusReason(ERROR_TYPE.NETWORK_ERROR))
        .toBe(STATUS_REASON.NETWORK_ERROR);
    });

    it('should map timeout correctly', () => {
      expect(mapErrorTypeToStatusReason(ERROR_TYPE.TIMEOUT))
        .toBe(STATUS_REASON.TIMEOUT);
    });

    it('should map rate_limited correctly', () => {
      expect(mapErrorTypeToStatusReason(ERROR_TYPE.RATE_LIMITED))
        .toBe(STATUS_REASON.RATE_LIMITED);
    });

    it('should map unknown errors to connector_error', () => {
      expect(mapErrorTypeToStatusReason('some_unknown_error'))
        .toBe(STATUS_REASON.CONNECTOR_ERROR);
    });
  });

  describe('isValidTransition', () => {
    it('should allow queued -> in_progress', () => {
      expect(isValidTransition(SUBMISSION_STATUS.QUEUED, SUBMISSION_STATUS.IN_PROGRESS))
        .toBe(true);
    });

    it('should allow in_progress -> deferred', () => {
      expect(isValidTransition(SUBMISSION_STATUS.IN_PROGRESS, SUBMISSION_STATUS.DEFERRED))
        .toBe(true);
    });

    it('should NOT allow in_progress -> queued directly', () => {
      expect(isValidTransition(SUBMISSION_STATUS.IN_PROGRESS, SUBMISSION_STATUS.QUEUED))
        .toBe(false);
    });

    it('should allow deferred -> queued', () => {
      expect(isValidTransition(SUBMISSION_STATUS.DEFERRED, SUBMISSION_STATUS.QUEUED))
        .toBe(true);
    });

    it('should NOT allow live -> in_progress', () => {
      expect(isValidTransition(SUBMISSION_STATUS.LIVE, SUBMISSION_STATUS.IN_PROGRESS))
        .toBe(false);
    });
  });

  describe('isRetryableError', () => {
    it('should return true for network errors', () => {
      expect(isRetryableError(ERROR_TYPE.NETWORK_ERROR)).toBe(true);
    });

    it('should return true for timeouts', () => {
      expect(isRetryableError(ERROR_TYPE.TIMEOUT)).toBe(true);
    });

    it('should return true for rate limiting', () => {
      expect(isRetryableError(ERROR_TYPE.RATE_LIMITED)).toBe(true);
    });

    it('should return false for validation errors', () => {
      expect(isRetryableError(ERROR_TYPE.VALIDATION_ERROR)).toBe(false);
    });

    it('should return false for auth errors', () => {
      expect(isRetryableError(ERROR_TYPE.AUTH_ERROR)).toBe(false);
    });
  });
});

describe('StateMachineService Invariants', () => {
  // These tests verify the service enforces invariants
  // In a real test, you'd mock the database

  describe('Input Validation', () => {
    const StateMachineService = require('../../services/submission/StateMachineService');

    it('should reject invalid toStatus values', async () => {
      await expect(
        StateMachineService.transitionRunStatus('some-id', {
          toStatus: 'invalid_status',
          reason: STATUS_REASON.SCHEDULED
        })
      ).rejects.toThrow('Invalid toStatus');
    });

    it('should reject invalid status_reason values', async () => {
      await expect(
        StateMachineService.transitionRunStatus('some-id', {
          toStatus: SUBMISSION_STATUS.QUEUED,
          reason: 'invalid_reason'
        })
      ).rejects.toThrow('Invalid status_reason');
    });

    it('should reject ACTION_NEEDED without action_needed_type', async () => {
      await expect(
        StateMachineService.transitionRunStatus('some-id', {
          toStatus: SUBMISSION_STATUS.ACTION_NEEDED,
          reason: STATUS_REASON.VERIFICATION_REQUIRED,
          meta: {}
        })
      ).rejects.toThrow('ACTION_NEEDED status requires meta.actionNeeded.type');
    });

    it('should reject FAILED without errorType', async () => {
      await expect(
        StateMachineService.transitionRunStatus('some-id', {
          toStatus: SUBMISSION_STATUS.FAILED,
          reason: STATUS_REASON.CONNECTOR_ERROR,
          meta: {}
        })
      ).rejects.toThrow('FAILED status requires meta.errorType');
    });
  });
});

describe('ArtifactWriter Redaction', () => {
  const ArtifactWriter = require('../../services/submission/ArtifactWriter');

  describe('detectLeaks', () => {
    it('should detect email addresses', () => {
      const content = 'Contact us at test@example.com';
      expect(ArtifactWriter.detectLeaks(content)).toBeGreaterThan(0);
    });

    it('should detect phone numbers', () => {
      const content = 'Call 555-123-4567';
      expect(ArtifactWriter.detectLeaks(content)).toBeGreaterThan(0);
    });

    it('should detect API keys', () => {
      const content = 'api_key: sk_live_abc123xyz';
      expect(ArtifactWriter.detectLeaks(content)).toBeGreaterThan(0);
    });

    it('should not flag safe content', () => {
      const content = 'This is a normal message without PII';
      expect(ArtifactWriter.detectLeaks(content)).toBe(0);
    });
  });
});

describe('ManualPacketConnector', () => {
  const ManualPacketConnector = require('../../services/submission/connectors/ManualPacketConnector');

  it('should return status_reason as STATUS_REASON value', async () => {
    const connector = new ManualPacketConnector();
    const result = await connector.submit(
      {
        business: { name: 'Test', website: 'https://test.com' },
        directory: { name: 'Test Dir' }
      },
      { submissionUrl: 'https://example.com/submit' }
    );

    expect(result.status).toBe('action_needed');
    expect(result.reason).toBe(STATUS_REASON.VERIFICATION_REQUIRED);
    expect(result.actionNeeded.type).toBe(ACTION_NEEDED_TYPE.MANUAL_REVIEW);
  });
});
