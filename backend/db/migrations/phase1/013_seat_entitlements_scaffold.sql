-- Migration 013: Seat Entitlements Scaffold (Phase 3B.2)
-- This migration adds seat_limit column to organizations table
-- Actual seat enforcement will be implemented when Stripe integration is ready

-- Add seat_limit column to organizations (default NULL = no limit enforcement)
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS seat_limit INTEGER DEFAULT NULL;

-- Add current_seats as computed value in settings or as separate column
-- For now, we can count active members dynamically

COMMENT ON COLUMN organizations.seat_limit IS 'Maximum number of team members allowed. NULL = unlimited (or not enforced). Set via Stripe subscription.';

-- Create a view for easy seat usage lookup
CREATE OR REPLACE VIEW organization_seat_usage AS
SELECT
    o.id as organization_id,
    o.name as organization_name,
    o.plan,
    o.seat_limit,
    COUNT(om.id) FILTER (WHERE om.status = 'active') as active_members,
    COUNT(om.id) FILTER (WHERE om.status = 'pending') as pending_invites,
    CASE
        WHEN o.seat_limit IS NULL THEN true
        ELSE COUNT(om.id) FILTER (WHERE om.status = 'active') < o.seat_limit
    END as can_invite
FROM organizations o
LEFT JOIN organization_members om ON om.organization_id = o.id
GROUP BY o.id, o.name, o.plan, o.seat_limit;

-- TODO: Future implementation notes:
-- 1. Stripe webhook should update seat_limit when subscription changes
-- 2. Invite endpoint should check organization_seat_usage.can_invite
-- 3. Frontend should show seat usage: "3/5 seats used"
-- 4. Billing portal should allow seat quantity changes
