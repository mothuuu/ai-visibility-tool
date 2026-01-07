-- Migration 012: Invite Enhancements for Phase 3B
-- Adds invited_by_user_id column and invite token index

-- Add invited_by_user_id column to track who sent the invite
ALTER TABLE organization_members
ADD COLUMN IF NOT EXISTS invited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Add revoked_at column for explicit revocation tracking
ALTER TABLE organization_members
ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- Add index on invitation_token for fast token lookups
CREATE INDEX IF NOT EXISTS idx_org_members_invitation_token
ON organization_members(invitation_token)
WHERE invitation_token IS NOT NULL;

-- Add index on invited_email for lookups
CREATE INDEX IF NOT EXISTS idx_org_members_invited_email
ON organization_members(invited_email)
WHERE invited_email IS NOT NULL;

-- Add composite index for org + pending status (common query pattern)
CREATE INDEX IF NOT EXISTS idx_org_members_org_pending
ON organization_members(organization_id, status)
WHERE status = 'pending';

COMMENT ON COLUMN organization_members.invited_by_user_id IS 'User who sent the invitation';
COMMENT ON COLUMN organization_members.revoked_at IS 'Timestamp when invite was revoked (null if not revoked)';
