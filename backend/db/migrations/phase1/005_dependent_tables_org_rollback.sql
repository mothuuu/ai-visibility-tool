DROP INDEX IF EXISTS idx_rec_refresh_cycles_org;
ALTER TABLE recommendation_refresh_cycles DROP CONSTRAINT IF EXISTS fk_rec_refresh_cycles_org;
ALTER TABLE recommendation_refresh_cycles DROP COLUMN IF EXISTS organization_id;

DROP INDEX IF EXISTS idx_user_progress_org;
ALTER TABLE user_progress DROP CONSTRAINT IF EXISTS fk_user_progress_org;
ALTER TABLE user_progress DROP COLUMN IF EXISTS organization_id;

DROP INDEX IF EXISTS idx_usage_logs_org;
ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS fk_usage_logs_org;
ALTER TABLE usage_logs DROP COLUMN IF EXISTS organization_id;

DROP INDEX IF EXISTS idx_scan_recommendations_org;
ALTER TABLE scan_recommendations DROP CONSTRAINT IF EXISTS fk_scan_recommendations_org;
ALTER TABLE scan_recommendations DROP COLUMN IF EXISTS organization_id;
