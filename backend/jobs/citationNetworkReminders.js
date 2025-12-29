/**
 * Citation Network Action Reminders Job
 *
 * Sends email reminders for submissions that need action, with deduplication.
 * Run via cron: node backend/jobs/citationNetworkReminders.js
 *
 * Reminder schedule (based on days LEFT until deadline):
 * - Day 2 (8 days left): Initial reminder
 * - Day 5 (5 days left): Second reminder
 * - Day 8 (2 days left): Final warning
 * - Day 10+: Submission blocked
 */

const db = require('../db/database');
const { sendEmail } = require('../utils/email');

/**
 * Main function to send action reminders
 */
async function sendActionReminders() {
  console.log('[CitationReminders] Starting reminder check...');

  try {
    // Get submissions needing reminders based on DEADLINE (not created_at)
    const result = await db.query(`
      SELECT
        ds.id as submission_id,
        ds.user_id,
        ds.action_type,
        ds.action_instructions,
        ds.action_deadline,
        ds.action_required_at,
        ds.created_at,
        d.name as directory_name,
        d.website_url as directory_url,
        u.email as user_email,
        u.name as user_name,
        COALESCE(pref.citation_reminders_enabled, true) as reminders_enabled,
        COALESCE(pref.citation_email_enabled, true) as email_enabled,
        COALESCE(pref.timezone, 'America/Toronto') as user_timezone,
        pref.quiet_hours_start,
        pref.quiet_hours_end,
        -- Calculate days LEFT until deadline (deadline-based, not creation-based)
        EXTRACT(DAY FROM (ds.action_deadline - NOW())) as days_remaining
      FROM directory_submissions ds
      JOIN directories d ON ds.directory_id = d.id
      JOIN users u ON ds.user_id = u.id
      LEFT JOIN user_notification_preferences pref ON pref.user_id = u.id
      WHERE ds.status IN ('action_needed', 'needs_action', 'pending_verification')
        AND ds.action_deadline IS NOT NULL
        AND ds.action_deadline > NOW()
        AND COALESCE(pref.citation_reminders_enabled, true) = true
        AND COALESCE(pref.citation_email_enabled, true) = true
    `);

    console.log(`[CitationReminders] Found ${result.rows.length} submissions needing action`);

    let sentCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const submission of result.rows) {
      const daysRemaining = Math.floor(submission.days_remaining);

      // Determine which reminder to send based on days LEFT (deadline-based)
      // Assuming 10-day deadline:
      // - 8 days left = day 2 of 10
      // - 5 days left = day 5 of 10
      // - 2 days left = day 8 of 10
      let reminderType = null;
      if (daysRemaining === 8) {
        reminderType = 'action_reminder_day2';
      } else if (daysRemaining === 5) {
        reminderType = 'action_reminder_day5';
      } else if (daysRemaining === 2) {
        reminderType = 'action_final_warning';
      }

      if (!reminderType) {
        continue; // Not a reminder day
      }

      // Check quiet hours (skip if in quiet hours)
      if (submission.quiet_hours_start && submission.quiet_hours_end) {
        if (isInQuietHours(submission.quiet_hours_start, submission.quiet_hours_end, submission.user_timezone)) {
          console.log(`[CitationReminders] Skipping ${submission.submission_id} - user in quiet hours`);
          skippedCount++;
          continue;
        }
      }

      // Check if already sent (deduplication)
      const alreadySent = await db.query(`
        SELECT id FROM citation_notification_events
        WHERE user_id = $1 AND submission_id = $2 AND notification_type = $3
      `, [submission.user_id, submission.submission_id, reminderType]);

      if (alreadySent.rows.length > 0) {
        console.log(`[CitationReminders] Skipping ${reminderType} for submission ${submission.submission_id} - already sent`);
        skippedCount++;
        continue;
      }

      // Send the reminder
      try {
        await sendReminderEmail(submission, reminderType, daysRemaining);

        // Record that we sent it
        await db.query(`
          INSERT INTO citation_notification_events (user_id, submission_id, notification_type, channel, sent_at)
          VALUES ($1, $2, $3, 'email', NOW())
        `, [submission.user_id, submission.submission_id, reminderType]);

        console.log(`[CitationReminders] Sent ${reminderType} to ${submission.user_email} for ${submission.directory_name}`);
        sentCount++;

      } catch (error) {
        console.error(`[CitationReminders] Failed to send ${reminderType} to ${submission.user_email}:`, error.message);

        // Record the failure
        await db.query(`
          INSERT INTO citation_notification_events (user_id, submission_id, notification_type, channel, error_message, sent_at)
          VALUES ($1, $2, $3, 'email', $4, NOW())
          ON CONFLICT (user_id, submission_id, notification_type) DO NOTHING
        `, [submission.user_id, submission.submission_id, reminderType, error.message]);

        errorCount++;
      }
    }

    // Mark expired submissions as blocked
    const blocked = await blockExpiredSubmissions();

    console.log(`[CitationReminders] Complete. Sent: ${sentCount}, Skipped: ${skippedCount}, Errors: ${errorCount}, Blocked: ${blocked}`);

    return { sent: sentCount, skipped: skippedCount, errors: errorCount, blocked };

  } catch (error) {
    console.error('[CitationReminders] Fatal error:', error);
    throw error;
  }
}

/**
 * Block submissions that have passed their action deadline
 */
async function blockExpiredSubmissions() {
  const result = await db.query(`
    UPDATE directory_submissions
    SET
      status = 'blocked',
      blocked_at = NOW(),
      blocked_reason = 'Action deadline expired after 10 days without response',
      error_message = 'Action deadline expired after 10 days',
      updated_at = NOW()
    WHERE status IN ('action_needed', 'needs_action', 'pending_verification')
      AND action_deadline IS NOT NULL
      AND action_deadline < NOW()
    RETURNING id, user_id, directory_name
  `);

  if (result.rows.length > 0) {
    console.log(`[CitationReminders] Blocked ${result.rows.length} expired submissions`);

    // Send notification for each blocked submission
    for (const blocked of result.rows) {
      try {
        await db.query(`
          INSERT INTO citation_notification_events (user_id, submission_id, notification_type, channel, sent_at)
          VALUES ($1, $2, 'submission_blocked', 'in_app', NOW())
          ON CONFLICT (user_id, submission_id, notification_type) DO NOTHING
        `, [blocked.user_id, blocked.id]);
      } catch (e) {
        console.error(`[CitationReminders] Failed to record block notification for ${blocked.id}:`, e.message);
      }
    }
  }

  return result.rows.length;
}

/**
 * Check if current time is within user's quiet hours
 */
function isInQuietHours(startTime, endTime, timezone) {
  try {
    const now = new Date();
    const options = { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false };
    const currentTime = now.toLocaleTimeString('en-US', options);

    const [currentHour, currentMinute] = currentTime.split(':').map(Number);
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);

    const current = currentHour * 60 + currentMinute;
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;

    // Handle overnight quiet hours (e.g., 22:00 - 08:00)
    if (start > end) {
      return current >= start || current <= end;
    }

    return current >= start && current <= end;
  } catch (error) {
    console.error('[CitationReminders] Error checking quiet hours:', error.message);
    return false; // Default to sending if we can't determine quiet hours
  }
}

/**
 * Send reminder email based on type
 */
async function sendReminderEmail(submission, reminderType, daysRemaining) {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8000';

  const subjects = {
    'action_reminder_day2': `Action Required: ${submission.directory_name} submission needs attention`,
    'action_reminder_day5': `Reminder: ${submission.directory_name} - ${daysRemaining} days remaining`,
    'action_final_warning': `⚠️ Final Warning: ${submission.directory_name} expires in ${daysRemaining} days`
  };

  const urgencyStyles = {
    'action_reminder_day2': { color: '#00B9DA', bgColor: '#e7f7fa', icon: '📋' },
    'action_reminder_day5': { color: '#f59e0b', bgColor: '#fef3c7', icon: '⏰' },
    'action_final_warning': { color: '#ef4444', bgColor: '#fef2f2', icon: '⚠️' }
  };

  const style = urgencyStyles[reminderType] || urgencyStyles['action_reminder_day2'];

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="color-scheme" content="light">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a; background-color: #ffffff; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, ${style.color} 0%, #7030A0 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px; }
        .alert-box { background: ${style.bgColor}; border-left: 4px solid ${style.color}; padding: 20px; margin: 20px 0; border-radius: 4px; }
        .button { display: inline-block; background: ${style.color}; color: white !important; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
        .deadline { font-size: 24px; font-weight: bold; color: ${style.color}; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        .footer a { color: ${style.color}; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin: 0; font-size: 24px;">${style.icon} Action Required</h1>
        </div>
        <div class="content">
          <p>Hi ${submission.user_name || 'there'},</p>

          <p>Your submission to <strong>${submission.directory_name}</strong> requires action:</p>

          <div class="alert-box">
            <p style="margin: 0 0 10px 0;"><strong>Action needed:</strong> ${submission.action_type || 'Verification'}</p>
            <p style="margin: 0;">${submission.action_instructions || 'Please complete the verification process to activate your listing.'}</p>
          </div>

          <p style="text-align: center;">
            <span class="deadline">${daysRemaining} days remaining</span>
          </p>

          <p style="text-align: center;">
            <a href="${FRONTEND_URL}/dashboard.html?tab=citation-network&submission=${submission.submission_id}" class="button">Complete Action Now</a>
          </p>

          ${reminderType === 'action_final_warning' ? `
            <p style="color: #ef4444; font-weight: bold;">
              ⚠️ If no action is taken within ${daysRemaining} days, this submission will be blocked and you'll need to restart the process.
            </p>
          ` : ''}

          <p>Best regards,<br>The AI Citation Network Team</p>
        </div>
        <div class="footer">
          <p><a href="${FRONTEND_URL}/dashboard.html?tab=settings">Manage notification preferences</a></p>
          <p>&copy; ${new Date().getFullYear()} AI Visibility Score. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Action Required: ${submission.directory_name}

Hi ${submission.user_name || 'there'},

Your submission to ${submission.directory_name} requires action:

Action needed: ${submission.action_type || 'Verification'}
${submission.action_instructions || 'Please complete the verification process to activate your listing.'}

Time remaining: ${daysRemaining} days

Complete your action here: ${FRONTEND_URL}/dashboard.html?tab=citation-network&submission=${submission.submission_id}

${reminderType === 'action_final_warning' ? `⚠️ WARNING: If no action is taken within ${daysRemaining} days, this submission will be blocked.` : ''}

Best regards,
The AI Citation Network Team

Manage notifications: ${FRONTEND_URL}/dashboard.html?tab=settings
  `;

  return await sendEmail({
    to: submission.user_email,
    subject: subjects[reminderType],
    html,
    text
  });
}

/**
 * Send notification when a submission goes live
 */
async function sendSubmissionLiveNotification(userId, submissionId, directoryName, listingUrl) {
  try {
    // Check if already sent
    const alreadySent = await db.query(`
      SELECT id FROM citation_notification_events
      WHERE user_id = $1 AND submission_id = $2 AND notification_type = 'submission_live'
    `, [userId, submissionId]);

    if (alreadySent.rows.length > 0) {
      return { skipped: true, reason: 'Already notified' };
    }

    // Get user info
    const userResult = await db.query(
      'SELECT email, name FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return { skipped: true, reason: 'User not found' };
    }

    const user = userResult.rows[0];
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8000';

    await sendEmail({
      to: user.email,
      subject: `🎉 Your ${directoryName} listing is now LIVE!`,
      html: `
        <h2>Great news!</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>Your listing on <strong>${directoryName}</strong> is now live and visible to AI models!</p>
        ${listingUrl ? `<p><a href="${listingUrl}" style="color: #00B9DA;">View your live listing →</a></p>` : ''}
        <p><a href="${FRONTEND_URL}/dashboard.html?tab=citation-network">View all submissions</a></p>
      `,
      text: `Your ${directoryName} listing is now LIVE! ${listingUrl ? `View it here: ${listingUrl}` : ''}\n\nView all submissions: ${FRONTEND_URL}/dashboard.html?tab=citation-network`
    });

    // Record notification
    await db.query(`
      INSERT INTO citation_notification_events (user_id, submission_id, notification_type, channel, sent_at)
      VALUES ($1, $2, 'submission_live', 'email', NOW())
    `, [userId, submissionId]);

    return { sent: true };

  } catch (error) {
    console.error('[CitationReminders] Failed to send live notification:', error);
    return { error: error.message };
  }
}

// Export functions
module.exports = {
  sendActionReminders,
  blockExpiredSubmissions,
  sendSubmissionLiveNotification,
  sendReminderEmail
};

// Run directly if called from command line
if (require.main === module) {
  console.log('[CitationReminders] Running as standalone job...');
  sendActionReminders()
    .then(result => {
      console.log('[CitationReminders] Job complete:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('[CitationReminders] Job failed:', error);
      process.exit(1);
    });
}
