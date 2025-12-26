-- Migration: Credential Security Hardening
-- Date: 2025-12-26
-- Description: Add unique constraints, audit trail columns, and access log table

-- ============================================================================
-- 1. Add unique constraint to prevent duplicate credentials per user+directory
-- ============================================================================

-- First, handle any existing duplicates by keeping the most recent one
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, directory_id
           ORDER BY created_at DESC, id DESC
         ) as rn
  FROM credential_vault
  WHERE user_id IS NOT NULL AND directory_id IS NOT NULL
)
DELETE FROM credential_vault
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- Now add the unique constraint
ALTER TABLE credential_vault
DROP CONSTRAINT IF EXISTS unique_user_directory_credential;

ALTER TABLE credential_vault
ADD CONSTRAINT unique_user_directory_credential
UNIQUE (user_id, directory_id);

-- ============================================================================
-- 2. Add handoff audit trail columns to credential_vault
-- ============================================================================

ALTER TABLE credential_vault
ADD COLUMN IF NOT EXISTS handoff_status VARCHAR(50) DEFAULT 'none';

ALTER TABLE credential_vault
ADD COLUMN IF NOT EXISTS handed_off_at TIMESTAMP;

ALTER TABLE credential_vault
ADD COLUMN IF NOT EXISTS handed_off_by_user_id INTEGER;

ALTER TABLE credential_vault
ADD COLUMN IF NOT EXISTS handoff_reason TEXT;

ALTER TABLE credential_vault
ADD COLUMN IF NOT EXISTS handoff_notes TEXT;

ALTER TABLE credential_vault
ADD COLUMN IF NOT EXISTS handoff_completed_at TIMESTAMP;

-- ============================================================================
-- 3. Create credential access audit log table
-- ============================================================================

CREATE TABLE IF NOT EXISTS credential_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID REFERENCES credential_vault(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  access_type VARCHAR(50) NOT NULL, -- 'password_reveal', 'password_copy', 'handoff_request', 'view_metadata'
  ip_address VARCHAR(45),
  user_agent TEXT,
  success BOOLEAN DEFAULT true,
  failure_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_credential_access_log_credential
ON credential_access_log(credential_id);

CREATE INDEX IF NOT EXISTS idx_credential_access_log_user
ON credential_access_log(user_id);

CREATE INDEX IF NOT EXISTS idx_credential_access_log_created
ON credential_access_log(created_at);

CREATE INDEX IF NOT EXISTS idx_credential_access_log_type
ON credential_access_log(access_type);

-- ============================================================================
-- 4. Add index on credential_vault for faster lookups
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_credential_vault_user_status
ON credential_vault(user_id, account_status);

-- ============================================================================
-- Verification
-- ============================================================================

-- Verify the constraint exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_user_directory_credential'
  ) THEN
    RAISE WARNING 'unique_user_directory_credential constraint was not created';
  END IF;
END $$;

-- Verify the access log table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'credential_access_log'
  ) THEN
    RAISE WARNING 'credential_access_log table was not created';
  END IF;
END $$;
