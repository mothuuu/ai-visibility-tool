/**
 * Phase 5: ArtifactWriter
 *
 * Stores submission artifacts with PII redaction.
 *
 * Invariants:
 * 1. LIVE_VERIFICATION_RESULT artifacts are run-linked
 * 2. Artifacts requiring redaction are processed based on redactionMode
 * 3. In STRICT mode, leaks cause storage failure
 * 4. Telemetry: leaks count is tracked but raw samples are NOT stored
 */

'use strict';

const pool = require('../../db/database');
const crypto = require('crypto');
const {
  ARTIFACT_TYPE,
  ARTIFACT_TYPE_META,
  ARTIFACT_REDACTION_MODE,
  SUBMISSION_EVENT_TYPE,
  TRIGGERED_BY
} = require('../../constants/submission-enums');

// PII patterns for leak detection
const PII_PATTERNS = [
  // Email
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // Phone numbers (various formats)
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  /\b\(\d{3}\)\s?\d{3}[-.]?\d{4}\b/g,
  // SSN
  /\b\d{3}-\d{2}-\d{4}\b/g,
  // Credit card (basic)
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
  // API keys (common patterns)
  /\b(sk_live_|pk_live_|api_key[=:]\s*)[a-zA-Z0-9_-]+/gi,
  // Bearer tokens
  /Bearer\s+[a-zA-Z0-9._-]+/gi
];

// Redaction placeholder
const REDACTED = '[REDACTED]';

class ArtifactWriter {
  /**
   * Stores an artifact with optional redaction
   *
   * @param {Object} options - Storage options
   * @param {string} [options.runId] - UUID of the submission run
   * @param {string} [options.targetId] - UUID of the submission target
   * @param {string} options.type - ARTIFACT_TYPE value
   * @param {Object} [options.content] - JSON content
   * @param {string} [options.contentText] - Text content
   * @param {string} [options.contentUrl] - URL to content
   * @param {string} [options.contentType] - MIME type
   * @param {string} [options.redactionMode] - Override default redaction mode
   * @param {Object} [options.metadata] - Additional metadata
   * @returns {Promise<Object>} Stored artifact
   */
  async store(options) {
    const {
      runId,
      targetId,
      type,
      content,
      contentText,
      contentUrl,
      contentType = 'application/json',
      redactionMode,
      metadata = {}
    } = options;

    // Validate artifact type
    if (!Object.values(ARTIFACT_TYPE).includes(type)) {
      throw new Error(`Invalid artifact type: ${type}`);
    }

    // Get artifact metadata
    const typeMeta = ARTIFACT_TYPE_META[type];
    if (!typeMeta) {
      throw new Error(`No metadata for artifact type: ${type}`);
    }

    // Determine correct linkage based on artifact type
    const effectiveRunId = typeMeta.linkedTo === 'run' ? runId : null;
    const effectiveTargetId = typeMeta.linkedTo === 'target' ? targetId : (runId ? null : targetId);

    // Validate linkage
    if (!effectiveRunId && !effectiveTargetId) {
      throw new Error(`Artifact type ${type} requires ${typeMeta.linkedTo}Id`);
    }

    // Determine redaction mode
    const effectiveRedactionMode = redactionMode ||
      (typeMeta.requiresRedaction ? ARTIFACT_REDACTION_MODE.BEST_EFFORT : ARTIFACT_REDACTION_MODE.SKIP);

    // Process content with redaction
    let processedContent = content;
    let processedContentText = contentText;
    let redactionApplied = false;
    let leaksCount = 0;

    if (effectiveRedactionMode !== ARTIFACT_REDACTION_MODE.SKIP) {
      const redactionResult = this._applyRedaction(
        content,
        contentText,
        contentType,
        effectiveRedactionMode
      );

      processedContent = redactionResult.content;
      processedContentText = redactionResult.contentText;
      redactionApplied = redactionResult.applied;
      leaksCount = redactionResult.leaksCount;

      // In STRICT mode, fail if leaks were detected
      if (effectiveRedactionMode === ARTIFACT_REDACTION_MODE.STRICT_FAIL_ON_LEAK && leaksCount > 0) {
        await this._emitRedactionFailedEvent(runId, targetId, type, leaksCount);
        throw new Error(`Redaction failed: ${leaksCount} potential PII leaks detected`);
      }
    }

    // Calculate size and checksum
    const contentString = processedContent
      ? JSON.stringify(processedContent)
      : processedContentText || '';
    const sizeBytes = Buffer.byteLength(contentString, 'utf8');
    const checksum = crypto.createHash('sha256').update(contentString).digest('hex');

    // Insert artifact
    const result = await pool.query(
      `INSERT INTO submission_artifacts (
        submission_run_id,
        submission_target_id,
        artifact_type,
        content_type,
        content,
        content_text,
        content_url,
        size_bytes,
        checksum,
        redaction_mode,
        redaction_applied,
        redaction_leaks_count,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        effectiveRunId,
        effectiveTargetId,
        type,
        contentType,
        processedContent ? JSON.stringify(processedContent) : null,
        processedContentText,
        contentUrl,
        sizeBytes,
        checksum,
        effectiveRedactionMode,
        redactionApplied,
        leaksCount,
        JSON.stringify(metadata)
      ]
    );

    // Emit ARTIFACT_STORED event
    await this._emitArtifactStoredEvent(runId, targetId, type, result.rows[0].id);

    // If redaction was applied, emit ARTIFACT_REDACTED event
    if (redactionApplied) {
      await this._emitRedactedEvent(runId, targetId, type, leaksCount);
    }

    return result.rows[0];
  }

  /**
   * Applies redaction to content
   */
  _applyRedaction(content, contentText, contentType, mode) {
    let leaksCount = 0;
    let applied = false;

    // Redact JSON content
    if (content) {
      const result = this._redactObject(content);
      return {
        content: result.obj,
        contentText: null,
        applied: result.applied,
        leaksCount: result.leaksCount
      };
    }

    // Redact text content
    if (contentText && (contentType.startsWith('text/') || contentType === 'application/json')) {
      const result = this._redactString(contentText);
      return {
        content: null,
        contentText: result.text,
        applied: result.applied,
        leaksCount: result.leaksCount
      };
    }

    return { content, contentText, applied: false, leaksCount: 0 };
  }

  /**
   * Redacts PII from an object (deep)
   */
  _redactObject(obj) {
    let leaksCount = 0;
    let applied = false;

    const redact = (value) => {
      if (typeof value === 'string') {
        const result = this._redactString(value);
        if (result.applied) {
          applied = true;
          leaksCount += result.leaksCount;
        }
        return result.text;
      }

      if (Array.isArray(value)) {
        return value.map(redact);
      }

      if (value && typeof value === 'object') {
        const result = {};
        for (const [key, val] of Object.entries(value)) {
          // Redact sensitive field names entirely
          if (this._isSensitiveFieldName(key)) {
            result[key] = REDACTED;
            applied = true;
            leaksCount++;
          } else {
            result[key] = redact(val);
          }
        }
        return result;
      }

      return value;
    };

    return { obj: redact(obj), applied, leaksCount };
  }

  /**
   * Redacts PII from a string
   */
  _redactString(text) {
    let leaksCount = 0;
    let applied = false;
    let result = text;

    for (const pattern of PII_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        leaksCount += matches.length;
        applied = true;
        result = result.replace(pattern, REDACTED);
      }
    }

    return { text: result, applied, leaksCount };
  }

  /**
   * Checks if a field name is sensitive
   */
  _isSensitiveFieldName(name) {
    const sensitiveNames = [
      'password', 'secret', 'token', 'api_key', 'apikey',
      'auth', 'credential', 'ssn', 'credit_card', 'creditcard',
      'cvv', 'pin', 'private_key', 'privatekey'
    ];
    return sensitiveNames.some(s => name.toLowerCase().includes(s));
  }

  /**
   * Detects potential PII leaks in content
   */
  detectLeaks(content) {
    const contentStr = typeof content === 'string'
      ? content
      : JSON.stringify(content);

    let totalLeaks = 0;

    for (const pattern of PII_PATTERNS) {
      const matches = contentStr.match(pattern);
      if (matches) {
        totalLeaks += matches.length;
      }
    }

    return totalLeaks;
  }

  /**
   * Emits ARTIFACT_STORED event
   */
  async _emitArtifactStoredEvent(runId, targetId, type, artifactId) {
    if (!runId) return;

    await pool.query(
      `INSERT INTO submission_events (
        submission_run_id,
        submission_target_id,
        event_type,
        triggered_by,
        event_data
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        runId,
        targetId,
        SUBMISSION_EVENT_TYPE.ARTIFACT_STORED,
        TRIGGERED_BY.SYSTEM,
        JSON.stringify({ artifactType: type, artifactId })
      ]
    );
  }

  /**
   * Emits ARTIFACT_REDACTED event
   */
  async _emitRedactedEvent(runId, targetId, type, leaksCount) {
    if (!runId) return;

    await pool.query(
      `INSERT INTO submission_events (
        submission_run_id,
        submission_target_id,
        event_type,
        triggered_by,
        event_data
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        runId,
        targetId,
        SUBMISSION_EVENT_TYPE.ARTIFACT_REDACTED,
        TRIGGERED_BY.SYSTEM,
        JSON.stringify({ artifactType: type, leaksCount })
      ]
    );
  }

  /**
   * Emits ARTIFACT_REDACTION_FAILED event
   */
  async _emitRedactionFailedEvent(runId, targetId, type, leaksCount) {
    if (!runId) return;

    await pool.query(
      `INSERT INTO submission_events (
        submission_run_id,
        submission_target_id,
        event_type,
        triggered_by,
        event_data
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        runId,
        targetId,
        SUBMISSION_EVENT_TYPE.ARTIFACT_REDACTION_FAILED,
        TRIGGERED_BY.SYSTEM,
        JSON.stringify({ artifactType: type, leaksCount })
      ]
    );
  }

  /**
   * Retrieves artifacts for a run
   */
  async getRunArtifacts(runId) {
    const result = await pool.query(
      `SELECT * FROM submission_artifacts
       WHERE submission_run_id = $1
       ORDER BY created_at DESC`,
      [runId]
    );
    return result.rows;
  }

  /**
   * Retrieves artifacts for a target
   */
  async getTargetArtifacts(targetId) {
    const result = await pool.query(
      `SELECT * FROM submission_artifacts
       WHERE submission_target_id = $1
       ORDER BY created_at DESC`,
      [targetId]
    );
    return result.rows;
  }
}

module.exports = new ArtifactWriter();
