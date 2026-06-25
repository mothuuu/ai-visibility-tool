'use strict';

/**
 * Visibility Impact score (Layer 4 rollup) — config-driven formula constants.
 *
 * impact = Value × Opportunity × Demand  (multiplicative, per prompt).
 *
 * Why multiplicative: a near-floor factor in EITHER Value or Opportunity should
 * collapse impact — a high-value prompt you cannot realistically win is not
 * actionable, and a winnable prompt worth nothing isn't either. Addition would
 * let one strong factor mask a weak one; multiplication does not.
 *
 * Demand is deliberately EXEMPT from that collapse: it refines, it doesn't
 * dominate. It enters as a `demand_factor` that defaults to a NEUTRAL 1.0 while
 * Demand (Layer 5 / volume) is not built, and — once it ships — maps the demand
 * signal into DEMAND_RANGE (floored, e.g. 0.5–1.0) so a low/absent Demand can
 * only attenuate impact, never zero it. A missing Demand must NOT drag impact to
 * 0 — neutral = 1.0, not 0.
 */

// Band 1..5 -> 0..1 normalization: (band - BAND_MIN) / (BAND_MAX - BAND_MIN).
const BAND_MIN = 1;
const BAND_MAX = 5;

// Demand (Layer 5) is not built yet -> neutral, non-collapsing default.
const DEMAND_FACTOR_DEFAULT = 1.0;
// Forward-compat: when Demand ships, demand_norm (0..1) maps into this floored
// range so Demand modulates impact but never zeroes a high-value/high-opp prompt.
// floored mapping: DEMAND_RANGE[0] + demand_norm * (DEMAND_RANGE[1] - DEMAND_RANGE[0]).
const DEMAND_RANGE = Object.freeze([0.5, 1.0]);

// impact_score (0..100) -> impact_band (1..5). Coarse + stable on re-run.
//   <20 => 1, >=20 => 2, >=40 => 3, >=60 => 4, >=80 => 5
const BAND_THRESHOLDS = Object.freeze([20, 40, 60, 80]);

const BASIS = 'impact_v1';
const FORMULA_VERSION = 'impact_v1';

module.exports = {
  BAND_MIN,
  BAND_MAX,
  DEMAND_FACTOR_DEFAULT,
  DEMAND_RANGE,
  BAND_THRESHOLDS,
  BASIS,
  FORMULA_VERSION,
};
