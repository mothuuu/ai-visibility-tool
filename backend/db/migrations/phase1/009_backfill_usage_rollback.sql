-- ⚠️ DANGER: This will DELETE usage tracking data!
DELETE FROM usage_events WHERE (metadata->>'backfilled')::boolean = true;
DELETE FROM usage_periods;
