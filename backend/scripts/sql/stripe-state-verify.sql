-- =============================================================================
-- Stripe State Verification - Post-Reconciliation
-- =============================================================================
-- Run this AFTER reconciliation to verify inconsistencies are resolved.
-- Expected: All "PROBLEM" counts should be 0 for non-manual orgs.
-- Usage: psql $DATABASE_URL -f backend/scripts/sql/stripe-state-verify.sql
-- =============================================================================

\echo '=============================================='
\echo 'POST-RECONCILIATION VERIFICATION'
\echo '=============================================='
\echo ''

-- -----------------------------------------------------------------------------
-- Key metrics that should be 0 after reconciliation (for non-manual orgs)
-- -----------------------------------------------------------------------------

\echo 'EXPECTED: 0 for non-manual orgs/users'
\echo ''

\echo '1) Non-manual orgs with active/trialing but missing IDs (should be 0):'
SELECT COUNT(*) as problem_count
FROM organizations
WHERE stripe_subscription_status IN ('active', 'trialing')
  AND (plan_source IS DISTINCT FROM 'manual' AND plan_override IS NULL)
  AND (
    stripe_subscription_id IS NULL OR stripe_subscription_id = ''
    OR stripe_price_id IS NULL OR stripe_price_id = ''
  );

\echo ''
\echo '2) Users (not in manual-override orgs) with active/trialing but missing IDs (should be 0):'
SELECT COUNT(*) as problem_count
FROM users u
LEFT JOIN organizations o ON u.organization_id = o.id
WHERE u.stripe_subscription_status IN ('active', 'trialing')
  AND (o.plan_source IS DISTINCT FROM 'manual' AND o.plan_override IS NULL)
  AND (
    u.stripe_subscription_id IS NULL OR u.stripe_subscription_id = ''
    OR u.stripe_price_id IS NULL OR u.stripe_price_id = ''
  );

\echo ''
\echo '3) Empty strings in org Stripe fields (should all be 0):'
SELECT
  SUM(CASE WHEN stripe_customer_id = '' THEN 1 ELSE 0 END) as empty_customer_id,
  SUM(CASE WHEN stripe_subscription_id = '' THEN 1 ELSE 0 END) as empty_subscription_id,
  SUM(CASE WHEN stripe_price_id = '' THEN 1 ELSE 0 END) as empty_price_id
FROM organizations;

\echo ''
\echo '4) Empty strings in user Stripe fields (should all be 0):'
SELECT
  SUM(CASE WHEN stripe_customer_id = '' THEN 1 ELSE 0 END) as empty_customer_id,
  SUM(CASE WHEN stripe_subscription_id = '' THEN 1 ELSE 0 END) as empty_subscription_id,
  SUM(CASE WHEN stripe_price_id = '' THEN 1 ELSE 0 END) as empty_price_id
FROM users;

\echo ''
\echo '=============================================='
\echo 'INFORMATIONAL (may not be 0, and that is OK)'
\echo '=============================================='
\echo ''

\echo '5) Manual override orgs (these are protected, may have any state):'
SELECT COUNT(*) as count
FROM organizations
WHERE plan_source = 'manual' OR plan_override IS NOT NULL;

\echo ''
\echo '6) Paid users without Stripe IDs (manual/test accounts - INFO):'
SELECT COUNT(*) as count
FROM users
WHERE plan IN ('diy', 'pro', 'agency', 'enterprise')
  AND (stripe_customer_id IS NULL OR stripe_subscription_id IS NULL);

\echo ''
\echo '=============================================='
\echo 'BACKUP TABLE CHECK'
\echo '=============================================='
\echo ''

\echo '7) Backup tables (for rollback if needed):'
SELECT table_name, pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as size
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'stripe_reconcile_backup_%'
ORDER BY table_name DESC;

\echo ''
\echo '=============================================='
\echo 'VERIFICATION COMPLETE'
\echo '=============================================='
