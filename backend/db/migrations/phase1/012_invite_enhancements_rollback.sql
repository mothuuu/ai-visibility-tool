-- Rollback Migration 012: Invite Enhancements
-- Removes invited_by_user_id column and invite indexes

DROP INDEX IF EXISTS idx_org_members_org_pending;
DROP INDEX IF EXISTS idx_org_members_invited_email;
DROP INDEX IF EXISTS idx_org_members_invitation_token;

ALTER TABLE organization_members DROP COLUMN IF EXISTS revoked_at;
ALTER TABLE organization_members DROP COLUMN IF EXISTS invited_by_user_id;
