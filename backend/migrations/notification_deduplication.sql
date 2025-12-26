-- Migration: Notification Deduplication & User Preferences
-- Date: 2025-12-26
-- Description: Add notification events table for deduplication and user preferences

-- ============================================================================
-- 1. Citation Notification Events for Deduplication
-- ============================================================================

CREATE TABLE IF NOT EXISTS citation_notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES directory_submissions(id) ON DELETE CASCADE,
  notification_type VARCHAR(50) NOT NULL, -- 'action_reminder_day2', 'action_reminder_day5', 'action_final_warning', 'submission_live', 'submission_failed'
  channel VARCHAR(20) DEFAULT 'email', -- 'email', 'in_app', 'sms'
  sent_at TIMESTAMP DEFAULT NOW(),
  delivered_at TIMESTAMP,
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  error_message TEXT,

  -- Unique constraint for deduplication: only one notification of each type per submission per user
  CONSTRAINT unique_notification UNIQUE (user_id, submission_id, notification_type)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_citation_notifications_user
ON citation_notification_events(user_id);

CREATE INDEX IF NOT EXISTS idx_citation_notifications_submission
ON citation_notification_events(submission_id);

CREATE INDEX IF NOT EXISTS idx_citation_notifications_type
ON citation_notification_events(notification_type);

CREATE INDEX IF NOT EXISTS idx_citation_notifications_sent
ON citation_notification_events(sent_at);

-- ============================================================================
-- 2. User Notification Preferences
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,

  -- Citation Network specific preferences
  citation_reminders_enabled BOOLEAN DEFAULT true,
  citation_reminder_frequency VARCHAR(20) DEFAULT 'immediate', -- 'immediate', 'daily_digest', 'weekly_digest'
  citation_email_enabled BOOLEAN DEFAULT true,
  citation_in_app_enabled BOOLEAN DEFAULT true,

  -- Quiet hours (no notifications during these times)
  quiet_hours_start TIME, -- e.g., '22:00'
  quiet_hours_end TIME,   -- e.g., '08:00'
  timezone VARCHAR(50) DEFAULT 'America/Toronto',

  -- General preferences (for future use)
  marketing_emails_enabled BOOLEAN DEFAULT true,
  weekly_summary_enabled BOOLEAN DEFAULT true,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for user lookup
CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_user
ON user_notification_preferences(user_id);

-- ============================================================================
-- 3. Add action_deadline to directory_submissions if not exists
-- ============================================================================

ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS action_deadline TIMESTAMP;

-- Add action_required_at if it doesn't exist
ALTER TABLE directory_submissions
ADD COLUMN IF NOT EXISTS action_required_at TIMESTAMP;

-- Set default action_deadline for existing action_needed submissions (10 days from created_at if no action_required_at)
UPDATE directory_submissions
SET action_deadline = COALESCE(action_required_at, created_at) + INTERVAL '10 days'
WHERE status IN ('action_needed', 'needs_action')
  AND action_deadline IS NULL;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'citation_notification_events'
  ) THEN
    RAISE WARNING 'citation_notification_events table was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'user_notification_preferences'
  ) THEN
    RAISE WARNING 'user_notification_preferences table was not created';
  END IF;
END $$;
