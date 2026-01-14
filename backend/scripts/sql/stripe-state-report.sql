-- =============================================================================
-- Stripe State Report - Phase 2.2 Data Reconciliation
-- =============================================================================
-- Run this to identify inconsistent Stripe states before/after reconciliation.
-- Usage: psql $DATABASE_URL -f backend/scripts/sql/stripe-state-report.sql
-- =============================================================================

\echo '=============================================='
\echo 'STRIPE STATE REPORT'
\echo '=============================================='
\echo ''

-- -----------------------------------------------------------------------------
-- 1) Organizations with manual override (PROTECTED - won't be modified)
-- -----------------------------------------------------------------------------
\echo '1) Organizations with manual override (protected from reconciliation):'
SELECT
  COUNT(*) as count,
  'plan_source=manual OR plan_override IS NOT NULL' as condition
FROM organizations
WHERE plan_source = 'manual' OR plan_override IS NOT NULL;

\echo ''
\echo 'Details of manual override orgs:'
SELECT
  id,
  name,
  plan,
  plan_source,
  plan_override,
  stripe_subscription_status,
  CASE WHEN stripe_subscription_id IS NULL OR stripe_subscription_id = '' THEN 'MISSING' ELSE 'present' END as sub_id_status,
  CASE WHEN stripe_price_id IS NULL OR stripe_price_id = '' THEN 'MISSING' ELSE 'present' END as price_id_status
FROM organizations
WHERE plan_source = 'manual' OR plan_override IS NOT NULL
ORDER BY id;

\echo ''

-- -----------------------------------------------------------------------------
-- 2) Organizations: active/trialing but missing subscription_id or price_id
-- -----------------------------------------------------------------------------
\echo '2) PROBLEM: Orgs with active/trialing status but missing subscription_id or price_id:'
SELECT
  COUNT(*) as problem_count,
  'stripe_subscription_status IN (active,trialing) AND (subscription_id OR price_id missing)' as condition
FROM organizations
WHERE stripe_subscription_status IN ('active', 'trialing')
  AND (plan_source IS DISTINCT FROM 'manual' AND plan_override IS NULL)
  AND (
    stripe_subscription_id IS NULL OR stripe_subscription_id = ''
    OR stripe_price_id IS NULL OR stripe_price_id = ''
  );

\echo ''
\echo 'Details:'
SELECT
  id,
  name,
  plan,
  plan_source,
  stripe_subscription_status,
  CASE WHEN stripe_subscription_id IS NULL OR stripe_subscription_id = '' THEN 'MISSING' ELSE LEFT(stripe_subscription_id, 20) || '...' END as sub_id,
  CASE WHEN stripe_price_id IS NULL OR stripe_price_id = '' THEN 'MISSING' ELSE stripe_price_id END as price_id,
  CASE WHEN stripe_customer_id IS NULL OR stripe_customer_id = '' THEN 'MISSING' ELSE LEFT(stripe_customer_id, 20) || '...' END as cust_id
FROM organizations
WHERE stripe_subscription_status IN ('active', 'trialing')
  AND (plan_source IS DISTINCT FROM 'manual' AND plan_override IS NULL)
  AND (
    stripe_subscription_id IS NULL OR stripe_subscription_id = ''
    OR stripe_price_id IS NULL OR stripe_price_id = ''
  )
ORDER BY id;

\echo ''

-- -----------------------------------------------------------------------------
-- 3) Users: active/trialing but missing subscription_id or price_id
-- -----------------------------------------------------------------------------
\echo '3) PROBLEM: Users with active/trialing status but missing subscription_id or price_id:'
SELECT
  COUNT(*) as problem_count,
  'stripe_subscription_status IN (active,trialing) AND (subscription_id OR price_id missing)' as condition
FROM users
WHERE stripe_subscription_status IN ('active', 'trialing')
  AND (
    stripe_subscription_id IS NULL OR stripe_subscription_id = ''
    OR stripe_price_id IS NULL OR stripe_price_id = ''
  );

\echo ''
\echo 'Details (first 20):'
SELECT
  u.id,
  u.email,
  u.plan,
  u.organization_id,
  u.stripe_subscription_status,
  CASE WHEN u.stripe_subscription_id IS NULL OR u.stripe_subscription_id = '' THEN 'MISSING' ELSE LEFT(u.stripe_subscription_id, 20) || '...' END as sub_id,
  CASE WHEN u.stripe_price_id IS NULL OR u.stripe_price_id = '' THEN 'MISSING' ELSE u.stripe_price_id END as price_id,
  COALESCE(o.plan_source, 'no_org') as org_plan_source,
  CASE WHEN o.plan_override IS NOT NULL THEN 'YES' ELSE 'no' END as org_has_override
FROM users u
LEFT JOIN organizations o ON u.organization_id = o.id
WHERE u.stripe_subscription_status IN ('active', 'trialing')
  AND (
    u.stripe_subscription_id IS NULL OR u.stripe_subscription_id = ''
    OR u.stripe_price_id IS NULL OR u.stripe_price_id = ''
  )
ORDER BY u.id
LIMIT 20;

\echo ''

-- -----------------------------------------------------------------------------
-- 4) Users with paid plan but no Stripe IDs (likely manual/test - INFO ONLY)
-- -----------------------------------------------------------------------------
\echo '4) INFO: Users with paid plan (diy/pro/agency/enterprise) but no stripe_customer_id/subscription_id:'
\echo '   (This may be intentional for test/manual accounts)'
SELECT
  COUNT(*) as count,
  'plan IN (diy,pro,agency,enterprise) AND stripe_customer_id/subscription_id missing' as condition
FROM users
WHERE plan IN ('diy', 'pro', 'agency', 'enterprise')
  AND (stripe_customer_id IS NULL OR stripe_customer_id = '' OR stripe_subscription_id IS NULL OR stripe_subscription_id = '');

\echo ''
\echo 'Details (first 20):'
SELECT
  id,
  email,
  plan,
  organization_id,
  CASE WHEN stripe_customer_id IS NULL OR stripe_customer_id = '' THEN 'MISSING' ELSE 'present' END as cust_id,
  CASE WHEN stripe_subscription_id IS NULL OR stripe_subscription_id = '' THEN 'MISSING' ELSE 'present' END as sub_id,
  stripe_subscription_status
FROM users
WHERE plan IN ('diy', 'pro', 'agency', 'enterprise')
  AND (stripe_customer_id IS NULL OR stripe_customer_id = '' OR stripe_subscription_id IS NULL OR stripe_subscription_id = '')
ORDER BY id
LIMIT 20;

\echo ''

-- -----------------------------------------------------------------------------
-- 5) Orgs with stripe_customer_id but missing subscription_id
-- -----------------------------------------------------------------------------
\echo '5) Orgs with stripe_customer_id present but subscription_id missing:'
SELECT
  COUNT(*) as count,
  'stripe_customer_id present AND stripe_subscription_id missing' as condition
FROM organizations
WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id != ''
  AND (stripe_subscription_id IS NULL OR stripe_subscription_id = '');

\echo ''
\echo 'Details:'
SELECT
  id,
  name,
  plan,
  plan_source,
  stripe_subscription_status,
  LEFT(stripe_customer_id, 25) || '...' as customer_id,
  CASE WHEN stripe_subscription_id IS NULL OR stripe_subscription_id = '' THEN 'MISSING' ELSE 'present' END as sub_id
FROM organizations
WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id != ''
  AND (stripe_subscription_id IS NULL OR stripe_subscription_id = '')
ORDER BY id;

\echo ''

-- -----------------------------------------------------------------------------
-- 6) Orgs/Users with active/trialing but missing period fields
-- -----------------------------------------------------------------------------
\echo '6) Orgs with active/trialing status but missing period_start/end:'
SELECT
  COUNT(*) as count,
  'active/trialing AND period fields missing' as condition
FROM organizations
WHERE stripe_subscription_status IN ('active', 'trialing')
  AND (stripe_current_period_start IS NULL OR stripe_current_period_end IS NULL);

\echo ''
\echo '   Users with active/trialing status but missing period_start/end:'
SELECT
  COUNT(*) as count,
  'active/trialing AND period fields missing' as condition
FROM users
WHERE stripe_subscription_status IN ('active', 'trialing')
  AND (stripe_current_period_start IS NULL OR stripe_current_period_end IS NULL);

\echo ''

-- -----------------------------------------------------------------------------
-- 7) Empty string cleanup candidates
-- -----------------------------------------------------------------------------
\echo '7) Records with empty string (should be NULL) in Stripe fields:'

\echo '   Organizations with empty strings:'
SELECT
  SUM(CASE WHEN stripe_customer_id = '' THEN 1 ELSE 0 END) as empty_customer_id,
  SUM(CASE WHEN stripe_subscription_id = '' THEN 1 ELSE 0 END) as empty_subscription_id,
  SUM(CASE WHEN stripe_price_id = '' THEN 1 ELSE 0 END) as empty_price_id,
  SUM(CASE WHEN stripe_subscription_status = '' THEN 1 ELSE 0 END) as empty_status
FROM organizations;

\echo ''
\echo '   Users with empty strings:'
SELECT
  SUM(CASE WHEN stripe_customer_id = '' THEN 1 ELSE 0 END) as empty_customer_id,
  SUM(CASE WHEN stripe_subscription_id = '' THEN 1 ELSE 0 END) as empty_subscription_id,
  SUM(CASE WHEN stripe_price_id = '' THEN 1 ELSE 0 END) as empty_price_id,
  SUM(CASE WHEN stripe_subscription_status = '' THEN 1 ELSE 0 END) as empty_status
FROM users;

\echo ''
\echo '=============================================='
\echo 'END OF REPORT'
\echo '=============================================='
