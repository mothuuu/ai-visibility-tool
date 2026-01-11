-- ============================================================================
-- PHASE 1 VERIFICATION QUERIES
-- RUN: psql $DATABASE_URL -f backend/db/phase1-migrations/verify.sql
-- ============================================================================

\echo '=============================================='
\echo 'PHASE 1 VERIFICATION'
\echo '=============================================='

\echo ''
\echo '1. Check no NULL unlock_state:'
SELECT COUNT(*) as null_unlock_state_count FROM scan_recommendations WHERE unlock_state IS NULL;
-- Expected: 0

\echo ''
\echo '2. Check CHECK constraint exists:'
SELECT conname FROM pg_constraint WHERE conname = 'scan_recommendations_unlock_state_check';
-- Expected: 1 row

\echo ''
\echo '3. Check scan_recommendations indexes exist:'
SELECT indexname FROM pg_indexes
WHERE tablename = 'scan_recommendations' AND indexname LIKE 'idx_scan_recs%';
-- Expected: 5 rows

\echo ''
\echo '4. Check recommendation_progress table exists:'
SELECT COUNT(*) as rec_progress_rows FROM recommendation_progress;
-- Expected: no error (0 is fine)

\echo ''
\echo '5. Check recommendation_progress index exists:'
SELECT indexname FROM pg_indexes
WHERE tablename = 'recommendation_progress' AND indexname LIKE 'idx_rec_progress%';
-- Expected: 1 row

\echo ''
\echo '6. Check unlock_state distribution:'
SELECT unlock_state, COUNT(*) as count FROM scan_recommendations GROUP BY unlock_state ORDER BY unlock_state;

\echo ''
\echo '7. Check new Doc 17 columns exist:'
SELECT column_name FROM information_schema.columns
WHERE table_name = 'scan_recommendations'
  AND column_name IN ('rec_type', 'surfaced_at', 'skip_available_at', 'implemented_at', 'skipped_at', 'dismissed_at', 'resurface_at', 'priority_score')
ORDER BY column_name;
-- Expected: 8 rows

\echo ''
\echo '8. Check new Doc 18 columns exist:'
SELECT column_name FROM information_schema.columns
WHERE table_name = 'scan_recommendations'
  AND column_name IN ('title', 'marketing_copy', 'technical_copy', 'exec_copy', 'evidence', 'dedup_key', 'what_to_do', 'how_to_do')
ORDER BY column_name;
-- Expected: 8 rows

\echo ''
\echo '9. Check organizations.company_type exists:'
SELECT column_name FROM information_schema.columns
WHERE table_name = 'organizations' AND column_name = 'company_type';
-- Expected: 1 row

\echo ''
\echo '=============================================='
\echo 'VERIFICATION COMPLETE'
\echo '=============================================='
