/**
 * Phase 5: Submission Framework Enums
 * Version: 2.4
 *
 * Source of truth for all submission-related enums.
 * These MUST match the PostgreSQL enum types defined in phase5_step1_migration_v1.1.0.sql
 *
 * IMPORTANT: Do not add new enum values without also adding them to the DB migration.
 */

'use strict';

// ============================================
// SUBMISSION STATUS (17 states)
// ============================================
const SUBMISSION_STATUS = Object.freeze({
  QUEUED: 'queued',
  DEFERRED: 'deferred',
  PAUSED: 'paused',
  IN_PROGRESS: 'in_progress',
  ACTION_NEEDED: 'action_needed',
  SUBMITTED: 'submitted',
  AWAITING_REVIEW: 'awaiting_review',
  APPROVED: 'approved',
  LIVE: 'live',
  NEEDS_CHANGES: 'needs_changes',
  FAILED: 'failed',
  REJECTED: 'rejected',
  BLOCKED: 'blocked',
  DISABLED: 'disabled',
  EXPIRED: 'expired',
  ALREADY_LISTED: 'already_listed',
  CANCELLED: 'cancelled'
});

// Status metadata - defines allowed transitions, terminal states, etc.
const SUBMISSION_STATUS_META = Object.freeze({
  [SUBMISSION_STATUS.QUEUED]: {
    label: 'Queued',
    description: 'Waiting to be processed',
    isTerminal: false,
    nextStates: [SUBMISSION_STATUS.IN_PROGRESS, SUBMISSION_STATUS.PAUSED, SUBMISSION_STATUS.CANCELLED, SUBMISSION_STATUS.DEFERRED]
  },
  [SUBMISSION_STATUS.DEFERRED]: {
    label: 'Deferred',
    description: 'Scheduled for retry',
    isTerminal: false,
    nextStates: [SUBMISSION_STATUS.QUEUED, SUBMISSION_STATUS.IN_PROGRESS, SUBMISSION_STATUS.PAUSED, SUBMISSION_STATUS.CANCELLED, SUBMISSION_STATUS.FAILED]
  },
  [SUBMISSION_STATUS.PAUSED]: {
    label: 'Paused',
    description: 'Paused by user',
    isTerminal: false,
    nextStates: [SUBMISSION_STATUS.QUEUED, SUBMISSION_STATUS.CANCELLED]
  },
  [SUBMISSION_STATUS.IN_PROGRESS]: {
    label: 'In Progress',
    description: 'Currently being processed',
    isTerminal: false,
    nextStates: [
      SUBMISSION_STATUS.SUBMITTED,
      SUBMISSION_STATUS.ACTION_NEEDED,
      SUBMISSION_STATUS.FAILED,
      SUBMISSION_STATUS.DEFERRED,
      SUBMISSION_STATUS.ALREADY_LISTED,
      SUBMISSION_STATUS.PAUSED,
      SUBMISSION_STATUS.CANCELLED
    ]
  },
  [SUBMISSION_STATUS.ACTION_NEEDED]: {
    label: 'Action Needed',
    description: 'Requires user intervention',
    isTerminal: false,
    nextStates: [SUBMISSION_STATUS.IN_PROGRESS, SUBMISSION_STATUS.SUBMITTED, SUBMISSION_STATUS.BLOCKED, SUBMISSION_STATUS.CANCELLED]
  },
  [SUBMISSION_STATUS.SUBMITTED]: {
    label: 'Submitted',
    description: 'Successfully submitted to directory',
    isTerminal: false,
    nextStates: [SUBMISSION_STATUS.AWAITING_REVIEW, SUBMISSION_STATUS.APPROVED, SUBMISSION_STATUS.LIVE, SUBMISSION_STATUS.REJECTED, SUBMISSION_STATUS.NEEDS_CHANGES]
  },
  [SUBMISSION_STATUS.AWAITING_REVIEW]: {
    label: 'Awaiting Review',
    description: 'Under directory review',
    isTerminal: false,
    nextStates: [SUBMISSION_STATUS.APPROVED, SUBMISSION_STATUS.REJECTED, SUBMISSION_STATUS.NEEDS_CHANGES, SUBMISSION_STATUS.LIVE]
  },
  [SUBMISSION_STATUS.APPROVED]: {
    label: 'Approved',
    description: 'Approved by directory',
    isTerminal: false,
    nextStates: [SUBMISSION_STATUS.LIVE, SUBMISSION_STATUS.EXPIRED]
  },
  [SUBMISSION_STATUS.LIVE]: {
    label: 'Live',
    description: 'Listing is live and verified',
    isTerminal: true,
    nextStates: [SUBMISSION_STATUS.EXPIRED, SUBMISSION_STATUS.DISABLED]
  },
  [SUBMISSION_STATUS.NEEDS_CHANGES]: {
    label: 'Needs Changes',
    description: 'Directory requested changes',
    isTerminal: false,
    nextStates: [SUBMISSION_STATUS.IN_PROGRESS, SUBMISSION_STATUS.CANCELLED]
  },
  [SUBMISSION_STATUS.FAILED]: {
    label: 'Failed',
    description: 'Submission failed permanently',
    isTerminal: true,
    nextStates: [SUBMISSION_STATUS.QUEUED] // Can be manually re-enabled
  },
  [SUBMISSION_STATUS.REJECTED]: {
    label: 'Rejected',
    description: 'Rejected by directory',
    isTerminal: true,
    nextStates: []
  },
  [SUBMISSION_STATUS.BLOCKED]: {
    label: 'Blocked',
    description: 'Blocked due to action timeout',
    isTerminal: true,
    nextStates: [SUBMISSION_STATUS.ACTION_NEEDED] // Can be unblocked
  },
  [SUBMISSION_STATUS.DISABLED]: {
    label: 'Disabled',
    description: 'Listing disabled',
    isTerminal: true,
    nextStates: [SUBMISSION_STATUS.QUEUED]
  },
  [SUBMISSION_STATUS.EXPIRED]: {
    label: 'Expired',
    description: 'Listing expired',
    isTerminal: true,
    nextStates: [SUBMISSION_STATUS.QUEUED]
  },
  [SUBMISSION_STATUS.ALREADY_LISTED]: {
    label: 'Already Listed',
    description: 'Business already has a listing',
    isTerminal: true,
    nextStates: []
  },
  [SUBMISSION_STATUS.CANCELLED]: {
    label: 'Cancelled',
    description: 'Cancelled by user',
    isTerminal: true,
    nextStates: [SUBMISSION_STATUS.QUEUED]
  }
});

// ============================================
// TRIGGERED BY (6 values)
// ============================================
const TRIGGERED_BY = Object.freeze({
  WORKER: 'worker',
  USER: 'user',
  ADMIN: 'admin',
  WEBHOOK: 'webhook',
  SCHEDULER: 'scheduler',
  SYSTEM: 'system'
});

// ============================================
// ACTION NEEDED TYPE (12 types)
// ============================================
const ACTION_NEEDED_TYPE = Object.freeze({
  CAPTCHA: 'captcha',
  REAUTH: 'reauth',
  MFA: 'mfa',
  LOGIN_REQUIRED: 'login_required',
  MANUAL_REVIEW: 'manual_review',
  CONTENT_FIX: 'content_fix',
  MISSING_FIELDS: 'missing_fields',
  CONSENT_REQUIRED: 'consent_required',
  PAYMENT_REQUIRED: 'payment_required',
  VERIFICATION: 'verification',
  CLAIM_LISTING: 'claim_listing',
  OTHER: 'other'
});

// ============================================
// ERROR TYPE (18 types)
// ============================================
const ERROR_TYPE = Object.freeze({
  NETWORK_ERROR: 'network_error',
  TIMEOUT: 'timeout',
  RATE_LIMITED: 'rate_limited',
  SERVER_ERROR: 'server_error',
  TEMPORARY_FAILURE: 'temporary_failure',
  VALIDATION_ERROR: 'validation_error',
  AUTH_ERROR: 'auth_error',
  NOT_FOUND: 'not_found',
  FORBIDDEN: 'forbidden',
  DUPLICATE: 'duplicate',
  TOS_VIOLATION: 'tos_violation',
  INVALID_PAYLOAD: 'invalid_payload',
  UNSUPPORTED: 'unsupported',
  CONNECTOR_ERROR: 'connector_error',
  CONFIG_ERROR: 'config_error',
  LOCK_ERROR: 'lock_error',
  REDACTION_ERROR: 'redaction_error',
  UNKNOWN: 'unknown'
});

// ============================================
// ARTIFACT TYPE (22 types)
// ============================================
const ARTIFACT_TYPE = Object.freeze({
  REQUEST_PAYLOAD: 'request_payload',
  RESPONSE_PAYLOAD: 'response_payload',
  STATUS_CHECK_REQUEST: 'status_check_request',
  STATUS_CHECK_RESPONSE: 'status_check_response',
  WEBHOOK_PAYLOAD: 'webhook_payload',
  PAYLOAD_MAPPING_RESULT: 'payload_mapping_result',
  SCREENSHOT_PRE: 'screenshot_pre',
  SCREENSHOT_POST: 'screenshot_post',
  SCREENSHOT_ERROR: 'screenshot_error',
  SCREENSHOT_LISTING: 'screenshot_listing',
  CONFIRMATION_EMAIL: 'confirmation_email',
  SUBMISSION_RECEIPT: 'submission_receipt',
  EXTERNAL_ID: 'external_id',
  LISTING_URL: 'listing_url',
  DUPLICATE_CHECK: 'duplicate_check',
  VALIDATION_RESULT: 'validation_result',
  LIVE_VERIFICATION_RESULT: 'live_verification_result',
  ERROR_LOG: 'error_log',
  RETRY_LOG: 'retry_log',
  RAW_STATUS: 'raw_status',
  SUBMISSION_PACKET: 'submission_packet',
  INSTRUCTIONS: 'instructions'
});

// Artifact metadata - defines which entity each artifact links to
const ARTIFACT_TYPE_META = Object.freeze({
  [ARTIFACT_TYPE.REQUEST_PAYLOAD]: { linkedTo: 'run', requiresRedaction: true },
  [ARTIFACT_TYPE.RESPONSE_PAYLOAD]: { linkedTo: 'run', requiresRedaction: true },
  [ARTIFACT_TYPE.STATUS_CHECK_REQUEST]: { linkedTo: 'run', requiresRedaction: false },
  [ARTIFACT_TYPE.STATUS_CHECK_RESPONSE]: { linkedTo: 'run', requiresRedaction: true },
  [ARTIFACT_TYPE.WEBHOOK_PAYLOAD]: { linkedTo: 'run', requiresRedaction: true },
  [ARTIFACT_TYPE.PAYLOAD_MAPPING_RESULT]: { linkedTo: 'run', requiresRedaction: true },
  [ARTIFACT_TYPE.SCREENSHOT_PRE]: { linkedTo: 'run', requiresRedaction: false },
  [ARTIFACT_TYPE.SCREENSHOT_POST]: { linkedTo: 'run', requiresRedaction: false },
  [ARTIFACT_TYPE.SCREENSHOT_ERROR]: { linkedTo: 'run', requiresRedaction: false },
  [ARTIFACT_TYPE.SCREENSHOT_LISTING]: { linkedTo: 'target', requiresRedaction: false },
  [ARTIFACT_TYPE.CONFIRMATION_EMAIL]: { linkedTo: 'run', requiresRedaction: true },
  [ARTIFACT_TYPE.SUBMISSION_RECEIPT]: { linkedTo: 'run', requiresRedaction: false },
  [ARTIFACT_TYPE.EXTERNAL_ID]: { linkedTo: 'run', requiresRedaction: false },
  [ARTIFACT_TYPE.LISTING_URL]: { linkedTo: 'target', requiresRedaction: false },
  [ARTIFACT_TYPE.DUPLICATE_CHECK]: { linkedTo: 'run', requiresRedaction: false },
  [ARTIFACT_TYPE.VALIDATION_RESULT]: { linkedTo: 'run', requiresRedaction: false },
  [ARTIFACT_TYPE.LIVE_VERIFICATION_RESULT]: { linkedTo: 'run', requiresRedaction: false }, // Run-linked for audit trace
  [ARTIFACT_TYPE.ERROR_LOG]: { linkedTo: 'run', requiresRedaction: true },
  [ARTIFACT_TYPE.RETRY_LOG]: { linkedTo: 'run', requiresRedaction: false },
  [ARTIFACT_TYPE.RAW_STATUS]: { linkedTo: 'run', requiresRedaction: true },
  [ARTIFACT_TYPE.SUBMISSION_PACKET]: { linkedTo: 'run', requiresRedaction: true },
  [ARTIFACT_TYPE.INSTRUCTIONS]: { linkedTo: 'run', requiresRedaction: false }
});

// ============================================
// SUBMISSION EVENT TYPE (46 types)
// ============================================
const SUBMISSION_EVENT_TYPE = Object.freeze({
  STATUS_CHANGE: 'status_change',
  CREATED: 'created',
  STARTED: 'started',
  COMPLETED: 'completed',
  CONNECTOR_CALLED: 'connector_called',
  CONNECTOR_RESPONSE: 'connector_response',
  CONNECTOR_ERROR: 'connector_error',
  VALIDATION_STARTED: 'validation_started',
  VALIDATION_PASSED: 'validation_passed',
  VALIDATION_FAILED: 'validation_failed',
  FIELD_MAPPING_COMPLETED: 'field_mapping_completed',
  SUBMITTED: 'submitted',
  DUPLICATE_FOUND: 'duplicate_found',
  EXTERNAL_ID_RECEIVED: 'external_id_received',
  STATUS_CHECK_STARTED: 'status_check_started',
  STATUS_CHECK_COMPLETED: 'status_check_completed',
  WEBHOOK_RECEIVED: 'webhook_received',
  LIVE_VERIFICATION_STARTED: 'live_verification_started',
  LIVE_VERIFIED: 'live_verified',
  LIVE_VERIFICATION_FAILED: 'live_verification_failed',
  ARTIFACT_STORED: 'artifact_stored',
  ARTIFACT_REDACTED: 'artifact_redacted',
  ARTIFACT_REDACTION_FAILED: 'artifact_redaction_failed',
  RETRY_SCHEDULED: 'retry_scheduled',
  RETRY_ATTEMPTED: 'retry_attempted',
  RETRY_BLOCKED_NO_CHANGES: 'retry_blocked_no_changes',
  RATE_LIMITED: 'rate_limited',
  BACKOFF_APPLIED: 'backoff_applied',
  CIRCUIT_OPENED: 'circuit_opened',
  CIRCUIT_CLOSED: 'circuit_closed',
  CIRCUIT_HALF_OPEN: 'circuit_half_open',
  LOCK_ACQUIRED: 'lock_acquired',
  LOCK_RELEASED: 'lock_released',
  LOCK_EXPIRED: 'lock_expired',
  LOCK_CONTENTION: 'lock_contention',
  ACTION_REQUIRED: 'action_required',
  ACTION_RESOLVED: 'action_resolved',
  ACTION_EXPIRED: 'action_expired',
  USER_PAUSED: 'user_paused',
  USER_RESUMED: 'user_resumed',
  USER_CANCELLED: 'user_cancelled',
  USER_CHANGES_ACKNOWLEDGED: 'user_changes_acknowledged',
  MANUAL_RE_ENABLED: 'manual_re_enabled',
  NEW_RUN_CREATED: 'new_run_created',
  ERROR_OCCURRED: 'error_occurred',
  AUTH_FAILED: 'auth_failed',
  TIMEOUT: 'timeout'
});

// ============================================
// STATUS REASON (40 values) - DB ENUM SAFE
// ============================================
const STATUS_REASON = Object.freeze({
  // Scheduling
  RATE_LIMITED: 'rate_limited',
  BACKOFF: 'backoff',
  SCHEDULED: 'scheduled',

  // Validation
  VALIDATION_FAILED: 'validation_failed',
  MISSING_REQUIRED_FIELDS: 'missing_required_fields',
  INVALID_DATA: 'invalid_data',

  // Duplicate
  DUPLICATE_FOUND: 'duplicate_found',
  ALREADY_EXISTS: 'already_exists',

  // Auth
  AUTH_EXPIRED: 'auth_expired',
  AUTH_FAILED: 'auth_failed',
  REAUTH_REQUIRED: 'reauth_required',

  // Action needed (mapped from ACTION_NEEDED_TYPE)
  CAPTCHA_REQUIRED: 'captcha_required',
  MFA_REQUIRED: 'mfa_required',
  LOGIN_REQUIRED: 'login_required',
  CONSENT_REQUIRED: 'consent_required',
  PAYMENT_REQUIRED: 'payment_required',
  VERIFICATION_REQUIRED: 'verification_required',

  // Directory response
  DIRECTORY_APPROVED: 'directory_approved',
  DIRECTORY_REJECTED: 'directory_rejected',
  DIRECTORY_CHANGES_REQUESTED: 'directory_changes_requested',
  DIRECTORY_BLOCKED: 'directory_blocked',

  // Technical
  NETWORK_ERROR: 'network_error',
  TIMEOUT: 'timeout',
  SERVER_ERROR: 'server_error',
  CONNECTOR_ERROR: 'connector_error',

  // Circuit breaker
  CIRCUIT_OPEN: 'circuit_open',
  CIRCUIT_CLOSED: 'circuit_closed',

  // User/Admin actions
  MANUAL_PAUSE: 'manual_pause',
  MANUAL_RESUME: 'manual_resume',
  MANUAL_CANCEL: 'manual_cancel',
  MANUAL_RE_ENABLE: 'manual_re_enable',
  CHANGES_ACKNOWLEDGED: 'changes_acknowledged',

  // Success
  SUBMISSION_ACCEPTED: 'submission_accepted',
  LIVE_VERIFIED: 'live_verified',

  // Expiry
  ACTION_DEADLINE_EXPIRED: 'action_deadline_expired',
  REVIEW_WINDOW_EXPIRED: 'review_window_expired',

  // Lock
  LOCK_ACQUIRED: 'lock_acquired',
  LOCK_RELEASED: 'lock_released',
  LOCK_EXPIRED: 'lock_expired',
  LOCK_CONTENTION: 'lock_contention'
});

// ============================================
// INTEGRATION BUCKET (4 types)
// ============================================
const INTEGRATION_BUCKET = Object.freeze({
  A: 'A', // Full API integration
  B: 'B', // Form automation
  C: 'C', // Browser automation
  D: 'D'  // Manual only
});

// ============================================
// SUBMISSION MODE (5 modes)
// ============================================
const SUBMISSION_MODE = Object.freeze({
  API: 'api',
  FORM: 'form',
  BROWSER: 'browser',
  ASSISTED: 'assisted',
  MANUAL: 'manual'
});

// ============================================
// LIVE VERIFICATION METHOD (6 methods)
// ============================================
const LIVE_VERIFICATION_METHOD = Object.freeze({
  API_CONFIRMATION: 'api_confirmation',
  SCRAPE_CHECK: 'scrape_check',
  DIRECTORY_SEARCH: 'directory_search',
  LISTING_URL_200: 'listing_url_200',
  MANUAL_CONFIRMATION: 'manual_confirmation',
  WEBHOOK_CONFIRMED: 'webhook_confirmed'
});

// ============================================
// STATUS CHECK STRATEGY (6 strategies)
// ============================================
const STATUS_CHECK_STRATEGY = Object.freeze({
  POLL: 'poll',
  WEBHOOK: 'webhook',
  HYBRID: 'hybrid',
  EMAIL: 'email',
  PORTAL: 'portal',
  NONE: 'none'
});

// ============================================
// ARTIFACT REDACTION MODE (3 modes)
// ============================================
const ARTIFACT_REDACTION_MODE = Object.freeze({
  STRICT_FAIL_ON_LEAK: 'strict_fail_on_leak',
  BEST_EFFORT: 'best_effort',
  SKIP: 'skip'
});

// ============================================
// RETRY POLICY
// ============================================
const RETRY_POLICY = Object.freeze({
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 5000,
  MAX_DELAY_MS: 300000, // 5 minutes
  BACKOFF_MULTIPLIER: 2
});

// ============================================
// HELPER: Map ACTION_NEEDED_TYPE -> STATUS_REASON (enum-safe)
// ============================================
const ACTION_NEEDED_TO_STATUS_REASON = Object.freeze({
  [ACTION_NEEDED_TYPE.CAPTCHA]: STATUS_REASON.CAPTCHA_REQUIRED,
  [ACTION_NEEDED_TYPE.MFA]: STATUS_REASON.MFA_REQUIRED,
  [ACTION_NEEDED_TYPE.REAUTH]: STATUS_REASON.REAUTH_REQUIRED,
  [ACTION_NEEDED_TYPE.LOGIN_REQUIRED]: STATUS_REASON.LOGIN_REQUIRED,
  [ACTION_NEEDED_TYPE.CONSENT_REQUIRED]: STATUS_REASON.CONSENT_REQUIRED,
  [ACTION_NEEDED_TYPE.PAYMENT_REQUIRED]: STATUS_REASON.PAYMENT_REQUIRED,
  [ACTION_NEEDED_TYPE.VERIFICATION]: STATUS_REASON.VERIFICATION_REQUIRED,
  [ACTION_NEEDED_TYPE.CLAIM_LISTING]: STATUS_REASON.VERIFICATION_REQUIRED,
  [ACTION_NEEDED_TYPE.MANUAL_REVIEW]: STATUS_REASON.VERIFICATION_REQUIRED,
  [ACTION_NEEDED_TYPE.CONTENT_FIX]: STATUS_REASON.VERIFICATION_REQUIRED,
  [ACTION_NEEDED_TYPE.MISSING_FIELDS]: STATUS_REASON.MISSING_REQUIRED_FIELDS,
  [ACTION_NEEDED_TYPE.OTHER]: STATUS_REASON.VERIFICATION_REQUIRED
});

/**
 * Maps an ACTION_NEEDED_TYPE to a valid STATUS_REASON
 * @param {string} actionNeededType - The ACTION_NEEDED_TYPE value
 * @returns {string} A valid STATUS_REASON value
 */
function mapActionNeededToStatusReason(actionNeededType) {
  return ACTION_NEEDED_TO_STATUS_REASON[actionNeededType] || STATUS_REASON.VERIFICATION_REQUIRED;
}

/**
 * Maps an ERROR_TYPE to a valid STATUS_REASON
 * @param {string} errorType - The ERROR_TYPE value
 * @returns {string} A valid STATUS_REASON value
 */
function mapErrorTypeToStatusReason(errorType) {
  switch (errorType) {
    case ERROR_TYPE.NETWORK_ERROR:
      return STATUS_REASON.NETWORK_ERROR;
    case ERROR_TYPE.TIMEOUT:
      return STATUS_REASON.TIMEOUT;
    case ERROR_TYPE.SERVER_ERROR:
    case ERROR_TYPE.TEMPORARY_FAILURE:
      return STATUS_REASON.SERVER_ERROR;
    case ERROR_TYPE.RATE_LIMITED:
      return STATUS_REASON.RATE_LIMITED;
    case ERROR_TYPE.AUTH_ERROR:
      return STATUS_REASON.AUTH_FAILED;
    case ERROR_TYPE.LOCK_ERROR:
      return STATUS_REASON.LOCK_EXPIRED;
    case ERROR_TYPE.VALIDATION_ERROR:
      return STATUS_REASON.VALIDATION_FAILED;
    case ERROR_TYPE.DUPLICATE:
      return STATUS_REASON.DUPLICATE_FOUND;
    default:
      return STATUS_REASON.CONNECTOR_ERROR;
  }
}

/**
 * Validates that a status transition is allowed
 * @param {string} fromStatus - Current status
 * @param {string} toStatus - Target status
 * @returns {boolean} Whether the transition is valid
 */
function isValidTransition(fromStatus, toStatus) {
  const meta = SUBMISSION_STATUS_META[fromStatus];
  if (!meta) return false;
  return meta.nextStates.includes(toStatus);
}

/**
 * Checks if a status is terminal
 * @param {string} status - The status to check
 * @returns {boolean} Whether the status is terminal
 */
function isTerminalStatus(status) {
  const meta = SUBMISSION_STATUS_META[status];
  return meta ? meta.isTerminal : false;
}

/**
 * Checks if an error type is retryable
 * @param {string} errorType - The ERROR_TYPE value
 * @returns {boolean} Whether the error is retryable
 */
function isRetryableError(errorType) {
  const retryableErrors = [
    ERROR_TYPE.NETWORK_ERROR,
    ERROR_TYPE.TIMEOUT,
    ERROR_TYPE.RATE_LIMITED,
    ERROR_TYPE.SERVER_ERROR,
    ERROR_TYPE.TEMPORARY_FAILURE,
    ERROR_TYPE.LOCK_ERROR
  ];
  return retryableErrors.includes(errorType);
}

/**
 * Calculates retry delay with exponential backoff
 * @param {number} attemptNo - Current attempt number
 * @returns {number} Delay in milliseconds
 */
function calculateRetryDelay(attemptNo) {
  const delay = RETRY_POLICY.BASE_DELAY_MS * Math.pow(RETRY_POLICY.BACKOFF_MULTIPLIER, attemptNo - 1);
  return Math.min(delay, RETRY_POLICY.MAX_DELAY_MS);
}

module.exports = {
  // Enums
  SUBMISSION_STATUS,
  SUBMISSION_STATUS_META,
  TRIGGERED_BY,
  ACTION_NEEDED_TYPE,
  ERROR_TYPE,
  ARTIFACT_TYPE,
  ARTIFACT_TYPE_META,
  SUBMISSION_EVENT_TYPE,
  STATUS_REASON,
  INTEGRATION_BUCKET,
  SUBMISSION_MODE,
  LIVE_VERIFICATION_METHOD,
  STATUS_CHECK_STRATEGY,
  ARTIFACT_REDACTION_MODE,
  RETRY_POLICY,

  // Helpers
  mapActionNeededToStatusReason,
  mapErrorTypeToStatusReason,
  isValidTransition,
  isTerminalStatus,
  isRetryableError,
  calculateRetryDelay
};
