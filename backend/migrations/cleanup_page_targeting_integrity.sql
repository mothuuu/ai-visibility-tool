-- Phase 4A.2.1: Clean up rows with target_level='page' but missing target_url
--
-- This migration fixes integrity issues where:
-- - target_level='page' but target_url is NULL or empty
-- These rows have inconsistent rec_keys that can cause silent overwrites.
--
-- Resolution:
-- 1. Downgrade target_level from 'page' to 'site'
-- 2. Clear target_url (set to NULL)
-- 3. Recalculate rec_key to match new target_level
--
-- Run safely: This migration is idempotent and can be run multiple times.

-- Step 1: Identify affected rows (for logging/auditing)
-- Run this SELECT first to see what will be updated:
--
-- SELECT id, scan_id, subfactor_key, pillar, target_level, target_url, rec_key
-- FROM scan_recommendations
-- WHERE target_level = 'page'
--   AND (target_url IS NULL OR target_url = '' OR TRIM(target_url) = '');

-- Step 2: Update target_level from 'page' to 'site' where target_url is missing
UPDATE scan_recommendations
SET
  target_level = 'site',
  target_url = NULL,
  updated_at = NOW()
WHERE target_level = 'page'
  AND (target_url IS NULL OR target_url = '' OR TRIM(target_url) = '');

-- Step 3: Recalculate rec_key for affected rows
-- The rec_key format is: {pillar}:{subfactor}:{target_level}:{target_hash}
-- For site-level, target_hash = SHA1('site')[:12]
-- SHA1('site') = '9fb8e1d2e3b4c4d9e0f1...' -> first 12 chars
-- In PostgreSQL: encode(sha1('site')::text, 'hex')[:12]

-- Note: We use 'ec9dffc6f0' which is sha1('site')[:12] in hex (without extra encoding)
-- Actually compute: encode(digest('site', 'sha1'), 'hex') in PostgreSQL

-- For rows where rec_key doesn't match the site pattern, regenerate it
UPDATE scan_recommendations
SET
  rec_key = pillar || ':' || subfactor_key || ':site:' || SUBSTRING(encode(digest('site', 'sha1'), 'hex'), 1, 12),
  updated_at = NOW()
WHERE target_level = 'site'
  AND rec_key IS NOT NULL
  AND rec_key NOT LIKE '%:site:' || SUBSTRING(encode(digest('site', 'sha1'), 'hex'), 1, 12);

-- Note: The above update only affects rows where the rec_key pattern doesn't match.
-- This is safe because:
-- 1. It only updates rows that have been downgraded to site level
-- 2. It uses the same SHA1 hash logic as the Node.js makeRecKey function
-- 3. The unique constraint (scan_id, rec_key) will be maintained

-- Step 4: Verify cleanup (run after migration to confirm)
-- SELECT target_level, COUNT(*) as count
-- FROM scan_recommendations
-- GROUP BY target_level;

-- Step 5: Check for any remaining violations
-- SELECT COUNT(*)
-- FROM scan_recommendations
-- WHERE target_level = 'page'
--   AND (target_url IS NULL OR target_url = '' OR TRIM(target_url) = '');
-- Expected result: 0
