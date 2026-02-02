/**
 * Scan Quota Caps — SINGLE SOURCE OF TRUTH for monthly scan limits.
 *
 * IMPORTANT: This file is ONLY for scan-per-month quotas.
 * Recommendation caps live in planCaps.js — DO NOT mix them.
 *
 * Values must match scanEntitlementService.js SCAN_ENTITLEMENTS.scans_per_period.
 * -1 means unlimited.
 */

const PLAN_SCAN_CAPS = Object.freeze({
  free: 2,
  freemium: 2,
  diy: 25,
  starter: 25,   // alias for diy
  pro: 50,
  agency: -1,
  enterprise: -1
});

/**
 * Normalize a raw plan string to a canonical scan-quota key.
 * Falls back to 'free' for unknown plans.
 *
 * @param {string|null|undefined} planRaw
 * @returns {string}
 */
function normalizePlanForQuota(planRaw) {
  if (!planRaw) return 'free';
  const p = String(planRaw).toLowerCase().trim();
  if (p === 'freemium') return 'freemium';
  if (p === 'starter' || p === 'diy' || p === 'basic' || p === 'silver' || p === 'plan_diy' || p === 'plan_starter') return 'diy';
  if (p === 'pro' || p === 'gold' || p === 'professional' || p === 'plan_pro') return 'pro';
  if (p === 'agency' || p === 'team' || p === 'teams' || p === 'plan_agency') return 'agency';
  if (p === 'enterprise' || p === 'platinum' || p === 'business' || p === 'plan_enterprise') return 'enterprise';
  if (p === 'free' || p === 'plan_free' || p === 'bronze') return 'free';
  return 'free';
}

/**
 * Get the monthly scan cap for a plan.
 *
 * @param {string|null|undefined} planRaw
 * @returns {number} cap (-1 = unlimited)
 */
function getMonthlyScanCap(planRaw) {
  const plan = normalizePlanForQuota(planRaw);
  return PLAN_SCAN_CAPS[plan] ?? 2;
}

module.exports = { PLAN_SCAN_CAPS, normalizePlanForQuota, getMonthlyScanCap };
