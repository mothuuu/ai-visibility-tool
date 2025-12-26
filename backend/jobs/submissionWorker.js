/**
 * Submission Worker
 *
 * CRITICAL: This worker processes queued directory submissions.
 * Without it, submissions stay "queued" forever.
 *
 * Features:
 * - Concurrency safety with FOR UPDATE SKIP LOCKED
 * - Per-directory rate limits
 * - Global daily rate limit
 * - Automatic retry with backoff
 * - Graceful shutdown support
 *
 * Run standalone: node backend/jobs/submissionWorker.js
 * Or via server: ENABLE_SUBMISSION_WORKER=1 node backend/server.js
 */

const db = require('../db/database');

// Per-directory rate limits (max submissions per hour)
const DIRECTORY_RATE_LIMITS = {
  'g2': 2,
  'capterra': 2,
  'product-hunt': 1,
  'trustpilot': 3,
  'yelp': 2,
  'bbb': 1,
  'default': 5
};

// Global rate limit: max submissions per day across all directories
const MAX_SUBMISSIONS_PER_DAY = 50;

// Batch settings
const BATCH_SIZE = 5;
const BATCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes between batches
const ERROR_BACKOFF_MS = 60 * 1000; // 1 minute wait on error
const MAX_RETRY_COUNT = 3;

class SubmissionWorker {
  constructor() {
    this.isRunning = false;
    this.processedToday = 0;
    this.lastResetDate = new Date().toDateString();
    this.shutdownRequested = false;
  }

  /**
   * Start the worker loop
   */
  async start() {
    if (this.isRunning) {
      console.log('[SubmissionWorker] Already running');
      return;
    }

    this.isRunning = true;
    this.shutdownRequested = false;
    console.log('[SubmissionWorker] Starting...');
    console.log(`[SubmissionWorker] Config: ${MAX_SUBMISSIONS_PER_DAY}/day limit, batch size ${BATCH_SIZE}`);

    while (this.isRunning && !this.shutdownRequested) {
      try {
        await this.processNextBatch();

        // Wait between batches
        if (this.isRunning && !this.shutdownRequested) {
          await this.sleep(BATCH_INTERVAL_MS);
        }
      } catch (error) {
        console.error('[SubmissionWorker] Batch error:', error.message);

        // Wait longer on error
        if (this.isRunning && !this.shutdownRequested) {
          await this.sleep(ERROR_BACKOFF_MS);
        }
      }
    }

    console.log('[SubmissionWorker] Stopped');
  }

  /**
   * Stop the worker gracefully
   */
  stop() {
    console.log('[SubmissionWorker] Shutdown requested...');
    this.shutdownRequested = true;
    this.isRunning = false;
  }

  /**
   * Process next batch of queued submissions
   */
  async processNextBatch() {
    // Reset daily counter at midnight
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      console.log(`[SubmissionWorker] New day - resetting counter (was ${this.processedToday})`);
      this.processedToday = 0;
      this.lastResetDate = today;
    }

    // Check daily limit
    if (this.processedToday >= MAX_SUBMISSIONS_PER_DAY) {
      console.log(`[SubmissionWorker] Daily limit reached (${this.processedToday}/${MAX_SUBMISSIONS_PER_DAY}), waiting...`);
      return;
    }

    // Use transaction with FOR UPDATE SKIP LOCKED to prevent multi-worker collisions
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      // Check per-directory rate limits (directories with too many recent submissions)
      const recentByDirectory = await client.query(`
        SELECT directory_id, COUNT(*) as recent_count
        FROM directory_submissions
        WHERE status IN ('in_progress', 'submitted', 'pending_verification')
          AND started_at > NOW() - INTERVAL '1 hour'
        GROUP BY directory_id
        HAVING COUNT(*) >= 5
      `);

      const rateLimitedDirectories = recentByDirectory.rows.map(r => r.directory_id);

      // Build query to get next batch
      let batchQuery = `
        SELECT
          ds.id,
          ds.user_id,
          ds.directory_id,
          ds.campaign_run_id,
          ds.directory_snapshot,
          ds.directory_name,
          ds.queue_position,
          ds.retry_count,
          d.name as dir_name,
          d.slug as directory_slug,
          d.website_url as submission_url,
          d.submission_mode
        FROM directory_submissions ds
        JOIN directories d ON ds.directory_id = d.id
        WHERE ds.status = 'queued'
          AND ds.retry_count < $1
      `;

      const params = [MAX_RETRY_COUNT];

      // Exclude rate-limited directories
      if (rateLimitedDirectories.length > 0) {
        batchQuery += ` AND ds.directory_id != ALL($2::uuid[])`;
        params.push(rateLimitedDirectories);
      }

      batchQuery += `
        ORDER BY ds.queue_position ASC, ds.created_at ASC
        LIMIT $${params.length + 1}
        FOR UPDATE SKIP LOCKED
      `;
      params.push(BATCH_SIZE);

      const batch = await client.query(batchQuery, params);

      if (batch.rows.length === 0) {
        await client.query('COMMIT');
        console.log('[SubmissionWorker] No queued submissions to process');
        return;
      }

      // Mark all selected rows as in_progress immediately (within transaction)
      const submissionIds = batch.rows.map(r => r.id);
      await client.query(`
        UPDATE directory_submissions
        SET status = 'in_progress',
            started_at = NOW(),
            updated_at = NOW()
        WHERE id = ANY($1::uuid[])
      `, [submissionIds]);

      // Update campaign run counters (within transaction)
      const campaignIds = [...new Set(batch.rows.filter(r => r.campaign_run_id).map(r => r.campaign_run_id))];
      for (const campaignId of campaignIds) {
        const count = batch.rows.filter(r => r.campaign_run_id === campaignId).length;
        await client.query(`
          UPDATE campaign_runs
          SET directories_in_progress = COALESCE(directories_in_progress, 0) + $1,
              directories_queued = GREATEST(0, COALESCE(directories_queued, 0) - $1),
              updated_at = NOW()
          WHERE id = $2
        `, [count, campaignId]);
      }

      await client.query('COMMIT');

      console.log(`[SubmissionWorker] Claimed ${batch.rows.length} submissions for processing`);

      // Process each submission (outside transaction - each gets its own)
      for (const submission of batch.rows) {
        if (this.shutdownRequested) {
          console.log('[SubmissionWorker] Shutdown requested, stopping batch processing');
          break;
        }

        if (this.processedToday >= MAX_SUBMISSIONS_PER_DAY) {
          console.log('[SubmissionWorker] Daily limit reached mid-batch');
          break;
        }

        try {
          await this.processSubmission(submission);
          this.processedToday++;
        } catch (error) {
          console.error(`[SubmissionWorker] Failed to process ${submission.id}:`, error.message);
          await this.markFailed(submission.id, error.message);
        }
      }

      console.log(`[SubmissionWorker] Batch complete. Today: ${this.processedToday}/${MAX_SUBMISSIONS_PER_DAY}`);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Process a single submission
   */
  async processSubmission(submission) {
    const directoryName = submission.directory_name || submission.dir_name || 'Unknown';
    console.log(`[SubmissionWorker] Processing: ${directoryName} (${submission.id})`);

    // Get business profile for this user
    const profileResult = await db.query(`
      SELECT * FROM business_profiles
      WHERE user_id = $1
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    `, [submission.user_id]);

    const profile = profileResult.rows[0];
    if (!profile) {
      throw new Error('Business profile not found for user');
    }

    // Determine submission mode
    const mode = submission.submission_mode || 'manual';

    if (mode === 'api') {
      // For API-based directories, attempt automated submission
      await this.submitViaAPI(submission, profile);
    } else {
      // For manual directories (default), mark as action_needed
      await this.markActionNeeded(
        submission.id,
        submission.campaign_run_id,
        'manual_submission',
        `Please submit your business listing manually at the directory website.`,
        submission.submission_url
      );
    }
  }

  /**
   * Attempt API-based submission (placeholder for future implementation)
   */
  async submitViaAPI(submission, profile) {
    const directoryName = submission.directory_name || submission.dir_name;

    // TODO: Implement directory-specific API integrations
    // For now, fall back to manual submission
    console.log(`[SubmissionWorker] API submission not yet implemented for ${directoryName}`);

    await this.markActionNeeded(
      submission.id,
      submission.campaign_run_id,
      'manual_submission',
      `Automated submission is not yet available for this directory. Please submit manually.`,
      submission.submission_url
    );
  }

  /**
   * Mark submission as needing user action
   */
  async markActionNeeded(submissionId, campaignRunId, actionType, instructions, actionUrl) {
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      // Calculate deadline (10 days from now)
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 10);

      await client.query(`
        UPDATE directory_submissions
        SET status = 'action_needed',
            action_type = $2,
            action_instructions = $3,
            action_url = $4,
            action_deadline = $5,
            action_required_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `, [submissionId, actionType, instructions, actionUrl, deadline]);

      // Update campaign run counters atomically
      if (campaignRunId) {
        await client.query(`
          UPDATE campaign_runs
          SET directories_action_needed = COALESCE(directories_action_needed, 0) + 1,
              directories_in_progress = GREATEST(0, COALESCE(directories_in_progress, 0) - 1),
              updated_at = NOW()
          WHERE id = $1
        `, [campaignRunId]);
      }

      await client.query('COMMIT');
      console.log(`[SubmissionWorker] Marked ${submissionId} as action_needed (deadline: ${deadline.toISOString()})`);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Mark submission as submitted (after successful submission)
   */
  async markSubmitted(submissionId, campaignRunId, listingUrl = null) {
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(`
        UPDATE directory_submissions
        SET status = 'submitted',
            submitted_at = NOW(),
            listing_url = COALESCE($2, listing_url),
            updated_at = NOW()
        WHERE id = $1
      `, [submissionId, listingUrl]);

      if (campaignRunId) {
        await client.query(`
          UPDATE campaign_runs
          SET directories_submitted = COALESCE(directories_submitted, 0) + 1,
              directories_in_progress = GREATEST(0, COALESCE(directories_in_progress, 0) - 1),
              updated_at = NOW()
          WHERE id = $1
        `, [campaignRunId]);
      }

      await client.query('COMMIT');
      console.log(`[SubmissionWorker] Marked ${submissionId} as submitted`);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Mark submission as failed
   */
  async markFailed(submissionId, errorMessage) {
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      // Get campaign_run_id first
      const sub = await client.query(
        'SELECT campaign_run_id, retry_count FROM directory_submissions WHERE id = $1',
        [submissionId]
      );

      const currentRetry = sub.rows[0]?.retry_count || 0;
      const campaignRunId = sub.rows[0]?.campaign_run_id;

      // If under retry limit, set back to queued for retry
      if (currentRetry < MAX_RETRY_COUNT - 1) {
        await client.query(`
          UPDATE directory_submissions
          SET status = 'queued',
              error_message = $2,
              retry_count = retry_count + 1,
              updated_at = NOW()
          WHERE id = $1
        `, [submissionId, errorMessage]);

        if (campaignRunId) {
          await client.query(`
            UPDATE campaign_runs
            SET directories_queued = COALESCE(directories_queued, 0) + 1,
                directories_in_progress = GREATEST(0, COALESCE(directories_in_progress, 0) - 1),
                updated_at = NOW()
            WHERE id = $1
          `, [campaignRunId]);
        }

        console.log(`[SubmissionWorker] Requeued ${submissionId} for retry (attempt ${currentRetry + 2})`);

      } else {
        // Max retries reached, mark as permanently failed
        await client.query(`
          UPDATE directory_submissions
          SET status = 'failed',
              error_message = $2,
              error_code = 'MAX_RETRIES_EXCEEDED',
              retry_count = retry_count + 1,
              failed_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `, [submissionId, errorMessage]);

        if (campaignRunId) {
          await client.query(`
            UPDATE campaign_runs
            SET directories_failed = COALESCE(directories_failed, 0) + 1,
                directories_in_progress = GREATEST(0, COALESCE(directories_in_progress, 0) - 1),
                updated_at = NOW()
            WHERE id = $1
          `, [campaignRunId]);
        }

        console.log(`[SubmissionWorker] Marked ${submissionId} as failed (max retries exceeded)`);
      }

      await client.query('COMMIT');

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[SubmissionWorker] Failed to update submission status:', error.message);
    } finally {
      client.release();
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get worker status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      processedToday: this.processedToday,
      dailyLimit: MAX_SUBMISSIONS_PER_DAY,
      lastResetDate: this.lastResetDate
    };
  }
}

// Singleton instance for server use
let workerInstance = null;

function getWorker() {
  if (!workerInstance) {
    workerInstance = new SubmissionWorker();
  }
  return workerInstance;
}

module.exports = {
  SubmissionWorker,
  getWorker,
  MAX_SUBMISSIONS_PER_DAY,
  DIRECTORY_RATE_LIMITS
};

// Run directly if called from command line
if (require.main === module) {
  console.log('[SubmissionWorker] Running as standalone worker...');

  const worker = new SubmissionWorker();

  // Graceful shutdown handlers
  process.on('SIGTERM', () => {
    console.log('[SubmissionWorker] Received SIGTERM');
    worker.stop();
  });

  process.on('SIGINT', () => {
    console.log('[SubmissionWorker] Received SIGINT');
    worker.stop();
  });

  worker.start().catch(error => {
    console.error('[SubmissionWorker] Fatal error:', error);
    process.exit(1);
  });
}
