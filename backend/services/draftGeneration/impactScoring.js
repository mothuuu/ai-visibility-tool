'use strict';

/**
 * Visibility Impact score (Layer 4 rollup) — pure computation over stored
 * value.band and opportunity.band. NO API calls, no evidence, no re-fetch.
 *
 *   impact = Value × Opportunity × Demand   (multiplicative)
 *
 * Per prompt that has BOTH a value.band AND an opportunity.band. Prompts missing
 * either are SKIPPED — not scored, not nulled. Demand is a neutral 1.0 stub
 * until Layer 5 ships (see config/impactScoring.js).
 *
 * Strictly additive, mirroring opportunityScoring.js: writes ONLY the `impact`
 * property on exact-text matches, preserves value / opportunity /
 * opportunity_evidence / volume / funnel_stage / is_monitored / text and every
 * other key, touches only tracked_prompts, idempotent, never overwrites real
 * data with blanks (abort the write on failure).
 */

const db = require('../../db/database');
const { resolvePlanForRequest, getDraftConfig } = require('../planService');
const {
  BAND_MIN, BAND_MAX, DEMAND_FACTOR_DEFAULT, BAND_THRESHOLDS, BASIS, FORMULA_VERSION,
} = require('../../config/impactScoring');

const ELIGIBILITY_FLAG = 'draft_enabled';

// ---------------------------------------------------------------------------
// formula
// ---------------------------------------------------------------------------

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

/** Band 1..5 -> 0..1, or null if not an integer band. */
function normalizeBand(band) {
  if (!Number.isInteger(band)) return null;
  return clamp01((band - BAND_MIN) / (BAND_MAX - BAND_MIN));
}

/**
 * Demand factor. Demand (Layer 5) is not built — return a NEUTRAL 1.0 so a
 * missing Demand never collapses impact. When Demand ships, map demand_norm into
 * the floored DEMAND_RANGE here. Returns { factor, source } for auditability.
 */
function demandFactor(/* prompt */) {
  // volume (Demand) is null today; no normalized demand signal exists yet.
  return { factor: DEMAND_FACTOR_DEFAULT, source: 'neutral_stub' };
}

/** Score (0..100) -> band (1..5). */
function bandForScore(score) {
  let band = 1;
  for (const t of BAND_THRESHOLDS) { if (score >= t) band += 1; }
  return band;
}

/**
 * Compute the impact object for one prompt from its value + opportunity bands.
 * Returns null if either band is missing (skip — do not score).
 */
function computeImpact(prompt, meta = {}) {
  const valueBand = prompt && prompt.value && prompt.value.band;
  const opportunityBand = prompt && prompt.opportunity && prompt.opportunity.band;

  const valueNorm = normalizeBand(valueBand);
  const opportunityNorm = normalizeBand(opportunityBand);
  if (valueNorm == null || opportunityNorm == null) return null; // need BOTH

  const demand = demandFactor(prompt);

  // Multiplicative: a near-floor Value OR Opportunity collapses impact. Demand
  // is a floored, non-collapsing refinement (neutral 1.0 today).
  const impactRaw = clamp01(valueNorm * opportunityNorm * demand.factor);
  const score = Math.round(impactRaw * 100); // 0..100 internal

  return {
    score,
    band: bandForScore(score),
    basis: BASIS,
    factors: {
      value_band: valueBand,
      opportunity_band: opportunityBand,
      demand_factor: demand.factor,
      demand_source: demand.source, // honest: Demand not in the rollup yet
    },
    formula_version: FORMULA_VERSION,
    generated_at: meta.generated_at || new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// data access (mirrors opportunityScoring)
// ---------------------------------------------------------------------------

function asArray(v) { return Array.isArray(v) ? v : []; }

async function readPrompts(userId) {
  const { rows } = await db.query(
    `SELECT tracked_prompts FROM visibility_profiles WHERE user_id = $1`,
    [userId]
  );
  return rows[0] ? asArray(rows[0].tracked_prompts) : null;
}

async function writeTrackedPrompts(userId, mutate) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT tracked_prompts FROM visibility_profiles WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    if (rows.length === 0) { await client.query('ROLLBACK'); return { written: false, reason: 'no_profile' }; }
    const next = mutate(asArray(rows[0].tracked_prompts));
    if (next == null) { await client.query('ROLLBACK'); return { written: false, reason: 'aborted' }; }
    await client.query(
      `UPDATE visibility_profiles SET tracked_prompts = $2::jsonb WHERE user_id = $1`,
      [userId, JSON.stringify(next)]
    );
    await client.query('COMMIT');
    return { written: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Roll up Value × Opportunity (× neutral Demand) into a per-prompt impact for
 * every prompt that has BOTH bands. Strictly additive, idempotent, never-null.
 *
 * @param {number} userId
 * @returns {Promise<{userId:number, status:string, [scored]:number, [plan]:string}>}
 *   statuses: skipped_not_eligible | no_profile | no_prompts | no_scorable | scored
 */
async function scoreImpact(userId) {
  if (!userId) throw new Error('scoreImpact requires a userId');

  const { plan } = await resolvePlanForRequest({ userId });
  const cfg = getDraftConfig(plan);
  if (!cfg[ELIGIBILITY_FLAG]) return { userId, plan, status: 'skipped_not_eligible' };

  const prompts = await readPrompts(userId);
  if (prompts == null) return { userId, plan, status: 'no_profile' };
  if (prompts.length === 0) return { userId, plan, status: 'no_prompts' };

  const impactByText = new Map();
  for (const p of prompts) {
    if (!p || typeof p !== 'object') continue;
    const impact = computeImpact(p);
    const text = typeof p.text === 'string' ? p.text : null;
    if (impact && text != null) impactByText.set(text, impact);
  }

  if (impactByText.size === 0) return { userId, plan, status: 'no_scorable' };

  let scored = 0;
  const result = await writeTrackedPrompts(userId, (current) => {
    let changed = false;
    const next = current.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const impact = impactByText.get(typeof p.text === 'string' ? p.text : null);
      if (!impact) return p;                       // missing a band / unmatched => unchanged
      scored += 1;
      changed = true;
      return { ...p, impact };                     // only `impact` touched
    });
    return changed ? next : null;
  });

  if (!result.written) return { userId, plan, status: 'no_scorable', scored: 0 };
  return { userId, plan, status: 'scored', scored };
}

module.exports = {
  scoreImpact,
  _internals: { computeImpact, normalizeBand, demandFactor, bandForScore },
};
