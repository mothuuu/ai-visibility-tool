-- Restore test entitlements for users 2 & 4
-- Run this after Phase 4 deployment to enable live testing

-- Option 1: Create new paid orders with allocation
INSERT INTO directory_orders (
  id, user_id, status, pack_type,
  directories_allocated, directories_submitted, directories_live,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  u.id,
  'paid',
  'boost',
  100,
  0,
  0,
  NOW(),
  NOW()
FROM (SELECT unnest(ARRAY[2, 4]) AS id) u
WHERE NOT EXISTS (
  SELECT 1 FROM directory_orders
  WHERE user_id = u.id AND status = 'paid' AND directories_allocated - directories_submitted > 0
);

-- Option 2: Reset any cancelled orders back to paid (if they exist)
UPDATE directory_orders
SET
  status = 'paid',
  directories_allocated = GREATEST(directories_allocated, 100),
  directories_submitted = 0,
  directories_live = 0,
  updated_at = NOW()
WHERE user_id IN (2, 4)
  AND status = 'cancelled'
  AND id IN (
    SELECT id FROM directory_orders
    WHERE user_id IN (2, 4)
    ORDER BY created_at DESC
    LIMIT 2
  );

-- Reset subscription allocations if they exist
UPDATE subscriber_directory_allocations
SET
  submissions_used = 0,
  updated_at = NOW()
WHERE user_id IN (2, 4);

-- Verify the fix
SELECT
  user_id,
  status,
  COUNT(*) as order_count,
  SUM(directories_allocated) AS total_allocated,
  SUM(directories_submitted) AS total_submitted,
  SUM(directories_allocated - directories_submitted) AS remaining
FROM directory_orders
WHERE user_id IN (2, 4)
GROUP BY user_id, status
ORDER BY user_id, status;
