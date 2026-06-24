'use strict';

/**
 * Visibility Opportunity (Winnability) SCORE — pure computation over the stored
 * opportunity_evidence. NO Perplexity / API calls, no re-fetch, no recompute of
 * evidence. Consumes the typed evidence + funnel_stage and writes a per-prompt
 * `opportunity` score+band onto visibility_profiles.tracked_prompts.
 *
 * Signals + weights live in config/opportunityScoring.js (tunable, not inline):
 *   winnability = W_brand * brand_gap + W_spec * specificity + W_contest * contestability
 *
 * Only prompts that already carry opportunity_evidence are scored (high-value
 * prompts). Prompts without evidence are SKIPPED — not scored, not nulled.
 *
 * Strictly additive, mirroring opportunityEvidence.js: writes ONLY the
 * `opportunity` property on exact-text matches, preserves opportunity_evidence /
 * value / volume / funnel_stage / is_monitored / text and every other key,
 * touches only tracked_prompts, idempotent, never overwrites real data with
 * blanks (abort the write on failure).
 */

const db = require('../../db/database');
const { resolvePlanForRequest, getDraftConfig } = require('../planService');
const {
  WEIGHTS, SPECIFICITY_BY_STAGE, SPECIFICITY_DEFAULT, CONTESTABILITY,
  BAND_THRESHOLDS, BASIS,
} = require('../../config/opportunityScoring');

// Same umbrella gate as the Value / evidence passes.
const ELIGIBILITY_FLAG = 'draft_enabled';

// ---------------------------------------------------------------------------
// signals (each 0..1)
// ---------------------------------------------------------------------------

function asArray(v) { return Array.isArray(v) ? v : []; }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

/** Brand-presence gap: absent (false) => 1 winnable, present (true) => 0. */
function brandGap(brandPresent) {
  return brandPresent ? 0 : 1;
}

/** Specificity from funnel stage (BOFU > MOFU > TOFU); neutral for untagged. */
function specificity(funnelStage) {
  const s = funnelStage ? String(funnelStage).toUpperCase() : null;
  return s && SPECIFICITY_BY_STAGE[s] != null ? SPECIFICITY_BY_STAGE[s] : SPECIFICITY_DEFAULT;
}

/**
 * Field contestability (0..1): fragmentation (competitor_count) + a POSITIVE
 * media term (media_count). Transparent and documented in config.
 */
function contestability(competitorCount, mediaCount) {
  const fragmentation = clamp01((competitorCount || 0) / CONTESTABILITY.COMPETITOR_SATURATION);
  const mediaPositive = clamp01((mediaCount || 0) / CONTESTABILITY.MEDIA_SATURATION);
  return clamp01(
    CONTESTABILITY.FRAGMENTATION_WEIGHT * fragmentation +
    CONTESTABILITY.MEDIA_WEIGHT * mediaPositive
  );
}

/** Score (0..100) -> band (1..5). */
function bandForScore(score) {
  let band = 1;
  for (const t of BAND_THRESHOLDS) { if (score >= t) band += 1; }
  return band;
}

/**
 * Compute the opportunity object for one prompt from its evidence. Facts-derived,
 * fully deterministic. Returns null if there is no evidence to score.
 */
function computeOpportunity(prompt, meta = {}) {
  const ev = prompt && prompt.opportunity_evidence;
  if (!ev || typeof ev !== 'object') return null;

  const competitor_count = Number.isFinite(ev.competitor_count)
    ? ev.competitor_count : asArray(ev.competitor_domains).length;
  const media_count = Number.isFinite(ev.media_count)
    ? ev.media_count : asArray(ev.media_domains).length;
  const brand_present = ev.brand_present === true;
  const specificity_signal = specificity(prompt.funnel_stage);

  const composite =
    WEIGHTS.brand_presence * brandGap(brand_present) +
    WEIGHTS.specificity * specificity_signal +
    WEIGHTS.contestability * contestability(competitor_count, media_count);

  const score = Math.round(clamp01(composite) * 1000) / 10; // 0..100, one decimal

  return {
    score,
    band: bandForScore(score),
    basis: BASIS,
    inputs: { brand_present, specificity_signal, competitor_count, media_count },
    weights: WEIGHTS,
    generated_at: meta.generated_at || new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// data access (mirrors opportunityEvidence)
// ---------------------------------------------------------------------------

async function readPrompts(userId) {
  const { rows } = await db.query(
    `SELECT tracked_prompts FROM visibility_profiles WHERE user_id = $1`,
    [userId]
  );
  return rows[0] ? asArray(rows[0].tracked_prompts) : null;
}

/**
 * Read-modify-write tracked_prompts under a row lock. Writes ONLY tracked_prompts.
 * `mutate` returns the new array, or null to abort.
 */
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
 * Score winnability for every prompt that carries opportunity_evidence.
 * Strictly additive, idempotent, never-null. Pure — no API calls.
 *
 * @param {number} userId
 * @returns {Promise<{userId:number, status:string, [scored]:number, [plan]:string}>}
 *   statuses: skipped_not_eligible | no_profile | no_prompts | no_evidence | scored
 */
async function scoreOpportunity(userId) {
  if (!userId) throw new Error('scoreOpportunity requires a userId');

  const { plan } = await resolvePlanForRequest({ userId });
  const cfg = getDraftConfig(plan);
  if (!cfg[ELIGIBILITY_FLAG]) return { userId, plan, status: 'skipped_not_eligible' };

  const prompts = await readPrompts(userId);
  if (prompts == null) return { userId, plan, status: 'no_profile' };
  if (prompts.length === 0) return { userId, plan, status: 'no_prompts' };

  // Score only prompts that already carry evidence (high-value). Skip the rest.
  const scoreByText = new Map();
  for (const p of prompts) {
    if (!p || typeof p !== 'object' || !p.opportunity_evidence) continue;
    const opp = computeOpportunity(p);
    const text = typeof p.text === 'string' ? p.text : null;
    if (opp && text != null) scoreByText.set(text, opp);
  }

  if (scoreByText.size === 0) return { userId, plan, status: 'no_evidence' };

  let scored = 0;
  const result = await writeTrackedPrompts(userId, (current) => {
    let changed = false;
    const next = current.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const opp = scoreByText.get(typeof p.text === 'string' ? p.text : null);
      if (!opp) return p;                         // unscored / unmatched => unchanged
      scored += 1;
      changed = true;
      return { ...p, opportunity: opp };          // only `opportunity` touched
    });
    return changed ? next : null;
  });

  if (!result.written) return { userId, plan, status: 'no_evidence', scored: 0 };
  return { userId, plan, status: 'scored', scored };
}

module.exports = {
  scoreOpportunity,
  // exposed for tests / introspection
  _internals: { computeOpportunity, brandGap, specificity, contestability, bandForScore, WEIGHTS },
};
