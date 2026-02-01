/**
 * Plan Caps — Single Source of Truth
 *
 * IMPORTANT: This is the ONLY place where per-plan recommendation
 * active-cap values should be defined.  Every backend service,
 * entitlement check, and tier filter MUST import from here.
 *
 * Sentinel value -1 means "unlimited" — consumers must never
 * call Array.slice(0, -1) on it; use applyCap() instead.
 *
 * Model A (Dynamic Top-N, No Cooldown):
 *   Active recommendations are capped per plan.
 *   Skip / Implement immediately surfaces the next rec.
 */

const PLAN_CAPS = Object.freeze({
  free:       3,
  freemium:   3,   // normalized to free
  diy:        5,
  starter:    5,   // alias of diy
  pro:        8,
  agency:     -1,  // unlimited
  enterprise: -1   // unlimited
});

/**
 * How many recommendations to PERSIST per scan, regardless of plan cap.
 * Plan caps control what is SHOWN, not what is STORED.
 * A larger persisted pool allows GET-time refill when items resolve to implemented.
 *
 * This only affects NEW scans — existing scans are not backfilled.
 */
const PERSIST_POOL_LIMIT = 25;

/**
 * Apply a cap safely.
 * -1 (unlimited) returns the full list; any positive integer slices.
 *
 * @param {Array} list  - items to cap
 * @param {number} cap  - max items (-1 = unlimited)
 * @returns {Array}
 */
function applyCap(list, cap) {
  if (!Array.isArray(list)) return [];
  if (cap === -1) return list;
  return list.slice(0, cap);
}

/**
 * Look up the cap for a normalized plan string.
 * Falls back to free (3) for unknown plans.
 *
 * @param {string} plan - normalized plan id
 * @returns {number}
 */
function getCapForPlan(plan) {
  if (!plan) return PLAN_CAPS.free;
  const key = String(plan).toLowerCase().trim();
  return PLAN_CAPS[key] ?? PLAN_CAPS.free;
}

module.exports = { PLAN_CAPS, applyCap, getCapForPlan, PERSIST_POOL_LIMIT };
