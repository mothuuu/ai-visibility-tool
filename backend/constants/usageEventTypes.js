/**
 * Usage Event Types
 *
 * These values MUST match the CHECK constraint on usage_events.event_type in the database.
 * See: db/migrations/phase1/008_usage_foundation.sql
 *
 * DB CHECK constraint:
 *   event_type IN ('scan_started', 'scan_completed', 'scan_failed', 'competitor_scan',
 *                  'recommendation_generated', 'recommendation_unlocked',
 *                  'export_pdf', 'export_csv', 'api_call', 'content_generated')
 */

const USAGE_EVENT_TYPES = {
  // Scan events
  SCAN_STARTED: 'scan_started',
  SCAN_COMPLETED: 'scan_completed',
  SCAN_FAILED: 'scan_failed',
  COMPETITOR_SCAN: 'competitor_scan',

  // Recommendation events
  RECOMMENDATION_GENERATED: 'recommendation_generated',
  RECOMMENDATION_UNLOCKED: 'recommendation_unlocked',

  // Export events
  EXPORT_PDF: 'export_pdf',
  EXPORT_CSV: 'export_csv',

  // Other events
  API_CALL: 'api_call',
  CONTENT_GENERATED: 'content_generated'
};

/**
 * Map scan type to the appropriate usage event type.
 *
 * @param {string} scanType - 'primary' or 'competitor'
 * @param {string} status - 'completed' or 'failed'
 * @returns {string} The event type string
 */
function getScanEventType(scanType, status = 'completed') {
  if (status === 'failed') {
    return USAGE_EVENT_TYPES.SCAN_FAILED;
  }

  if (scanType === 'competitor') {
    return USAGE_EVENT_TYPES.COMPETITOR_SCAN;
  }

  return USAGE_EVENT_TYPES.SCAN_COMPLETED;
}

module.exports = {
  USAGE_EVENT_TYPES,
  getScanEventType
};
