/**
 * requireCompletedProfile — dashboard completion gate (intake/profile build, Step 6).
 *
 * Authoritative, non-bypassable server-side gate. Runs AFTER authenticateToken
 * (so req.user is set) on the dashboard DATA routes only. Everything is read
 * FRESH from the DB — completion and plan are never taken from the JWT.
 *
 * Behavior:
 *   - Freemium (plan not draft_enabled): always pass — no profile requirement.
 *     Freemium users must NOT be redirected to an intake form.
 *   - Paid (draft_enabled) AND visibility_profiles.profile_completed_at IS NULL:
 *     respond 403 { error: 'profile_incomplete', redirect: INTAKE_ROUTE }.
 *   - Paid AND completed: pass.
 *
 * Does NOT modify /api/profile, auth, billing, or the onboarding/scan flow —
 * the gate is applied selectively at the dashboard mount points in server.js.
 */

const db = require('../db/database');
const { resolvePlanForRequest, getDraftConfig } = require('../services/planService');

// Route path the intake form lives at (Phase 2 builds the page). Single source.
const INTAKE_ROUTE = '/profile-setup.html';

async function requireCompletedProfile(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    // authenticateToken runs first and rejects unauthenticated requests; this is
    // just defensive — without a user there is nothing to gate.
    if (!userId) return next();

    // Fresh plan resolution (SSOT) — never trust the JWT for plan.
    const { plan } = await resolvePlanForRequest({ userId });

    // Only paid (draft-enabled) plans have a profile to complete.
    if (!getDraftConfig(plan).draft_enabled) {
      return next();
    }

    // Fresh completion read by user_id — never from the JWT.
    const { rows } = await db.query(
      'SELECT profile_completed_at FROM visibility_profiles WHERE user_id = $1',
      [userId]
    );
    const completedAt = rows[0] ? rows[0].profile_completed_at : null;

    if (!completedAt) {
      return res.status(403).json({ error: 'profile_incomplete', redirect: INTAKE_ROUTE });
    }

    return next();
  } catch (err) {
    // Fail-open (log loudly): a transient gate error must not lock a paid user
    // out of a dashboard route they're entitled to. This is an onboarding gate,
    // not a security boundary — the client still cannot fake completion.
    console.error('[ProfileGate] requireCompletedProfile error (failing open):', err.message);
    return next();
  }
}

module.exports = { requireCompletedProfile, INTAKE_ROUTE };
