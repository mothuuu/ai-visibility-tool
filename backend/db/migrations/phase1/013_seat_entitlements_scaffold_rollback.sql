-- Rollback Migration 013: Seat Entitlements Scaffold

DROP VIEW IF EXISTS organization_seat_usage;
ALTER TABLE organizations DROP COLUMN IF EXISTS seat_limit;
