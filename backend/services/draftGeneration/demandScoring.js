'use strict';

/**
 * Prompt Demand scoring (Layer 5) — market-wide relative demand per prompt.
 *
 * Demand = how commonly this TYPE of question is asked across the market for the
 * vertical — NOT how valuable it is to one business (that's Value), and NOT how
 * winnable (that's Opportunity). It fills the reserved `volume` slot on each
 * tracked prompt.
 *
 * ALL prompts are scored (Demand is market-wide, not business-specific) in ONE
 * batch call. It is an ESTIMATE — relative ordering within the set, not a
 * measurement (basis: "ai_inferred", estimated: true).
 *
 * Strictly additive, mirroring the Value scorer exactly:
 *   - writes ONLY the `volume` property onto matching tracked_prompts elements
 *   - preserves text, funnel_stage, is_monitored, value, opportunity_evidence,
 *     opportunity, impact and every other key
 *   - touches no other column than tracked_prompts
 *   - ABORTS the write on any failed / empty / unparseable LLM response
 *   - idempotent: re-running recomputes ONLY `volume`
 *
 * Reuses existing infra: claudeAdapter.runQuery via property access (stubbable),
 * model from config/models.js (never hardcoded), parse via llmJson.parseJsonArray.
 * Plan gate: same getDraftConfig eligibility as the other scorers.
 */

const db = require('../../db/database');
const claudeAdapter = require('../engines/claudeAdapter');
const { parseJsonArray } = require('./llmJson');
const { resolvePlanForRequest, getDraftConfig } = require('../planService');

const ELIGIBILITY_FLAG = 'draft_enabled';
const DEMAND_BASIS = 'ai_inferred';
const SCORE_TEMPERATURE = 0; // deterministic — same set, same relative bands
const LLM_MAX_CHARS = 6000;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function asArray(v) { return Array.isArray(v) ? v : []; }

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** Coerce a model-supplied band to an integer in [1,5], or null if invalid. */
function normalizeBand(v) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= 5 ? r : null;
}

function demandValue(band) {
  return { band, basis: DEMAND_BASIS, estimated: true, generated_at: new Date().toISOString() };
}

function buildQuery(industry, prompts) {
  const list = prompts
    .map((p, i) => `${i + 1}. [${p.funnel_stage || 'UNTAGGED'}] ${p.text}`)
    .join('\n');

  const lines = [
    'Estimate the relative MARKET DEMAND for each AI-search prompt below — how',
    'commonly this TYPE of question is asked across the whole market for this',
    'vertical. This is about topic popularity, NOT how valuable or winnable the',
    'prompt is to any one business.',
    '',
    'Assign each prompt a demand band 1-5 (5 = highest relative demand IN THIS SET).',
    'Calibrate honestly:',
    '- Broad, top-of-funnel discovery questions (e.g. "best X in <place>") are',
    '  usually asked far more often -> higher demand.',
    '- Specific, decision-stage (BOFU) or brand-named questions are asked LESS',
    '  often -> LOWER demand is EXPECTED and correct here, NOT a penalty. Do not',
    '  bury specific prompts artificially.',
    '- Equally, do not push every broad/TOFU prompt to the top by reflex — rank by',
    '  genuine relative frequency.',
    'Ties are allowed; do NOT force a spread. This is an ESTIMATE of relative',
    'ordering, not a measurement.',
    '',
    'Return STRICT JSON ONLY — no prose, no markdown, no code fences — an array with',
    'one object per prompt, echoing the prompt text VERBATIM:',
    '[{"text": "<verbatim prompt text>", "band": <1-5>}]',
  ];
  if (cleanStr(industry)) {
    lines.push('', `Vertical / industry: ${cleanStr(industry)}`);
  }
  lines.push('', 'Prompts (with funnel stage):', list);

  let q = lines.join('\n');
  if (q.length > LLM_MAX_CHARS + 2000) q = q.slice(0, LLM_MAX_CHARS + 2000);
  return q;
}

// ---------------------------------------------------------------------------
// data access (mirrors the Value scorer)
// ---------------------------------------------------------------------------

async function readProfile(userId) {
  const { rows } = await db.query(
    `SELECT tracked_prompts, industry FROM visibility_profiles WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function applyToTrackedPrompts(userId, mutate) {
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
 * Score market demand for ALL of a user's tracked prompts. Strictly additive,
 * idempotent, never-null.
 *
 * @param {number} userId
 * @returns {Promise<{userId:number, status:string, [scored]:number, [plan]:string}>}
 *   statuses: skipped_not_eligible | no_profile | no_prompts | llm_failed | scored
 */
async function scoreDemand(userId) {
  if (!userId) throw new Error('scoreDemand requires a userId');

  const { plan } = await resolvePlanForRequest({ userId });
  const cfg = getDraftConfig(plan);
  if (!cfg[ELIGIBILITY_FLAG]) return { userId, plan, status: 'skipped_not_eligible' };

  const profile = await readProfile(userId);
  if (!profile) return { userId, plan, status: 'no_profile' };

  // ALL prompts with usable text — Demand is market-wide, not high-value only.
  const prompts = asArray(profile.tracked_prompts).filter(
    (p) => p && typeof p === 'object' && typeof p.text === 'string' && p.text.trim()
  );
  if (prompts.length === 0) return { userId, plan, status: 'no_prompts' };

  let raw;
  try {
    raw = await claudeAdapter.runQuery(buildQuery(profile.industry, prompts), { temperature: SCORE_TEMPERATURE });
  } catch (err) {
    console.warn(`[demandScoring] user ${userId}: LLM call failed (${err && err.message ? err.message : err}); aborting write`);
    return { userId, plan, status: 'llm_failed' };
  }

  const parsed = parseJsonArray(raw, 'demand');
  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.warn(`[demandScoring] user ${userId}: empty/unparseable LLM response; aborting write (tracked_prompts untouched)`);
    return { userId, plan, status: 'llm_failed' };
  }

  const bandByText = new Map();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const text = cleanStr(item.text);
    const band = normalizeBand(item.band);
    if (text && band != null) bandByText.set(text, band);
  }
  if (bandByText.size === 0) {
    console.warn(`[demandScoring] user ${userId}: no valid {text,band} pairs; aborting write`);
    return { userId, plan, status: 'llm_failed' };
  }

  let scored = 0;
  const result = await applyToTrackedPrompts(userId, (current) => {
    let changed = false;
    const next = current.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const band = bandByText.get(typeof p.text === 'string' ? p.text : null);
      if (band == null) return p;               // unmatched => volume unchanged
      scored += 1;
      changed = true;
      return { ...p, volume: demandValue(band) }; // only `volume` touched
    });
    return changed ? next : null;
  });

  if (!result.written) return { userId, plan, status: 'llm_failed', scored: 0 };
  return { userId, plan, status: 'scored', scored };
}

module.exports = {
  scoreDemand,
  _internals: { normalizeBand, buildQuery, demandValue },
};
