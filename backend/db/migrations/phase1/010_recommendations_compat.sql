-- Migration 010: Recommendations Compatibility Layer

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'scan_recommendations' AND column_name = 'category') THEN
        RAISE EXCEPTION 'FATAL: scan_recommendations.category column missing!';
    END IF;
    RAISE NOTICE 'INFO: category column verified';
END $$;

CREATE OR REPLACE VIEW v_scans_without_recommendations AS
SELECT s.id as scan_id, s.organization_id, s.user_id, s.status, s.completed_at, s.total_score,
    (SELECT COUNT(*) FROM scan_recommendations sr WHERE sr.scan_id = s.id) as rec_count
FROM scans s
WHERE s.status = 'completed' AND s.completed_at IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM scan_recommendations sr WHERE sr.scan_id = s.id);

CREATE OR REPLACE FUNCTION check_recommendations_integrity()
RETURNS TABLE (check_name TEXT, status TEXT, count BIGINT, details TEXT) AS $$
BEGIN
    RETURN QUERY SELECT 'zero_recs_scans'::TEXT, CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END, COUNT(*), 'Completed scans with no recommendations'::TEXT FROM v_scans_without_recommendations;
    RETURN QUERY SELECT 'orphaned_recs'::TEXT, CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END, COUNT(*), 'Recommendations without valid scan_id'::TEXT FROM scan_recommendations sr WHERE NOT EXISTS (SELECT 1 FROM scans s WHERE s.id = sr.scan_id);
    RETURN QUERY SELECT 'recs_without_org'::TEXT, CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END, COUNT(*), 'Recommendations missing organization_id'::TEXT FROM scan_recommendations WHERE organization_id IS NULL;
    RETURN QUERY SELECT 'orphaned_refresh_cycles'::TEXT, CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END, COUNT(*), 'Refresh cycles without valid scan'::TEXT FROM recommendation_refresh_cycles rrc WHERE NOT EXISTS (SELECT 1 FROM scans s WHERE s.id = rrc.scan_id);
END;
$$ LANGUAGE plpgsql STABLE;
