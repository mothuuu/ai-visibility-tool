'use strict';

/**
 * Value scoring (Layer 2) — per-prompt business-value enrichment.
 *
 * Value = how much winning a given prompt is worth to THIS business. It is
 * grounded in CUSTOMER-SUPPLIED economics (deal_size_band, sales_model, revenue
 * objective, ICP, competitors) + the prompt's funnel_stage. The LLM's job is to
 * REASON over those real inputs — the synthesis the customer would do — NOT to
 * invent market data. No inputs => no score (pending), never a guess.
 *
 * Strictly additive, same discipline as the (paused) Demand/volume pass:
 *   - writes ONLY a `value` property onto matching tracked_prompts elements
 *   - preserves text, funnel_stage, is_monitored, volume and every other key
 *   - touches no other column than tracked_prompts
 *   - ABORTS the write on any failed / empty / unparseable LLM response
 *     (never overwrites real data with blanks)
 *   - idempotent: re-running recomputes and overwrites ONLY `value`
 *
 * Reuses existing infra (no new pattern): claudeAdapter.runQuery via property
 * access (stubbable), model from config/models.js (never hardcoded), parse via
 * llmJson.parseJsonArray.
 *
 * Plan gate: getDraftConfig(plan) eligibility. Defaults to the umbrella
 * `draft_enabled` flag (the same gate that decides whether a plan gets the AI
 * profile draft at all). If product wants a dedicated `value_scoring_enabled`
 * flag later, change ELIGIBILITY_FLAG below — one line, nothing else moves.
 */

const db = require('../../db/database');
const claudeAdapter = require('../engines/claudeAdapter');
const { parseJsonArray } = require('./llmJson');
const { resolvePlanForRequest, getDraftConfig } = require('../planService');

// Plan-config flag that gates Value (product call — see header).
const ELIGIBILITY_FLAG = 'draft_enabled';

const VALUE_BASIS = 'business_grounded';
const SCORE_TEMPERATURE = 0;     // deterministic — same inputs, same bands
const LLM_MAX_CHARS = 6000;

// Customer-facing labels for the stored enums, fed to the model so it reasons
// over meaning, not opaque codes. Keys MUST match the DB CHECK constraints.
const DEAL_SIZE_LABELS = Object.freeze({
  under_1k:  'under $1K per deal',
  '1k_10k':  '$1K–$10K per deal',
  '10k_50k': '$10K–$50K per deal',
  '50k_250k':'$50K–$250K per deal',
  over_250k: 'over $250K per deal',
});
const SALES_MODEL_LABELS = Object.freeze({
  self_serve:  'self-serve (low-touch, high-volume, low ACV)',
  smb:         'SMB sales (light-touch)',
  mid_market:  'mid-market sales',
  enterprise:  'enterprise (high-touch, high ACV, long cycle)',
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') return String(v.text || v.name || v.title || v.value || '').trim();
  return String(v).trim();
}

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function namesOf(arr, limit) {
  return asArray(arr).map(toText).filter(Boolean).slice(0, limit);
}

/** A value object representing "scored" with a 1–5 band. */
function scoredValue(band) {
  return { band, basis: VALUE_BASIS, generated_at: new Date().toISOString() };
}

/** A value object representing "no inputs yet". */
function pendingValue() {
  return { status: 'pending', basis: VALUE_BASIS, reason: 'missing_business_inputs', generated_at: new Date().toISOString() };
}

/** True if a prompt already carries a real scored band (so pending must not clobber it). */
function hasScoredBand(value) {
  return Boolean(value && typeof value === 'object' && Number.isInteger(value.band));
}

/** Coerce a model-supplied band to an integer in [1,5], or null if invalid. */
function normalizeBand(v) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= 5 ? r : null;
}

// ---------------------------------------------------------------------------
// prompt construction
// ---------------------------------------------------------------------------

function buildBusinessContext(profile) {
  const lines = [];
  if (cleanStr(profile.company_name)) lines.push(`Company: ${cleanStr(profile.company_name)}`);
  if (cleanStr(profile.industry)) lines.push(`Industry: ${cleanStr(profile.industry)}`);
  if (cleanStr(profile.location)) lines.push(`Location: ${cleanStr(profile.location)}`);
  if (cleanStr(profile.business_description)) lines.push(`What they do: ${cleanStr(profile.business_description)}`);

  const icps = namesOf((asArray(profile.icps)).map((i) => (typeof i === 'string' ? i : (i && i.text))), 8);
  if (icps.length) lines.push(`Target customers (ICPs): ${icps.join('; ')}`);

  const competitors = namesOf(profile.competitors_business, 6);
  if (competitors.length) lines.push(`Competitors: ${competitors.join('; ')}`);

  if (cleanStr(profile.avg_customer_value)) lines.push(`Average customer value: ${cleanStr(profile.avg_customer_value)}`);
  if (cleanStr(profile.priority_focus)) lines.push(`Revenue objective / focus: ${cleanStr(profile.priority_focus)}`);

  // The two grounding economics (guaranteed present — caller checked).
  lines.push(`Typical deal size: ${DEAL_SIZE_LABELS[profile.deal_size_band] || profile.deal_size_band}`);
  lines.push(`Sales model: ${SALES_MODEL_LABELS[profile.sales_model] || profile.sales_model}`);

  let ctx = lines.join('\n').trim();
  if (ctx.length > LLM_MAX_CHARS) ctx = ctx.slice(0, LLM_MAX_CHARS);
  return ctx;
}

function buildQuery(context, prompts) {
  const list = prompts
    .map((p, i) => `${i + 1}. [${p.funnel_stage || 'UNTAGGED'}] ${p.text}`)
    .join('\n');

  return [
    'You are scoring how VALUABLE it is to THIS specific business to win each AI-search',
    'prompt below — i.e. if a person asking that prompt converts, how much does that',
    'outcome matter to this business? Reason ONLY over the business facts provided; do',
    'NOT invent market size or demand.',
    '',
    'Weigh three things:',
    '- Deal economics: bigger typical deal size => a won customer is worth more.',
    '- Sales model: enterprise/high-touch favours decision-stage, comparison and',
    '  vendor-evaluation prompts; self-serve/high-volume spreads value more evenly but',
    '  still rewards intent.',
    '- Funnel intent of the prompt: BOFU (decision) > MOFU (comparison/consideration)',
    '  > TOFU (awareness/definition) for conversion proximity.',
    '',
    'Assign each prompt a value band from 1 to 5 (5 = highest value to THIS business,',
    '1 = lowest). Ties are allowed — do NOT force a spread. A high-ACV enterprise',
    'business should push BOFU comparison/decision prompts to the top and generic TOFU',
    'definition prompts to the bottom.',
    '',
    'Return STRICT JSON ONLY — no prose, no markdown, no code fences — an array with one',
    'object per prompt, echoing the prompt text VERBATIM:',
    '[{"text": "<verbatim prompt text>", "band": <1-5>}]',
    '',
    'Business facts:',
    '"""',
    context,
    '"""',
    '',
    'Prompts to score:',
    list,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// data access
// ---------------------------------------------------------------------------

async function readProfile(userId) {
  const { rows } = await db.query(
    `SELECT company_name, industry, location, business_description,
            icps, competitors_business, competitors_visibility,
            avg_customer_value, priority_focus, deal_size_band, sales_model,
            tracked_prompts
       FROM visibility_profiles
      WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Read-modify-write the tracked_prompts JSONB under a row lock, applying `mutate`
 * to a FRESH copy of the array. Writes ONLY the tracked_prompts column. `mutate`
 * returns the new array, or null to abort the write (commit nothing).
 *
 * Re-reading inside the lock is the additive guard: concurrent edits to other
 * properties/prompts are preserved; we only ever set `value` on what we matched.
 */
async function applyToTrackedPrompts(userId, mutate) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT tracked_prompts FROM visibility_profiles WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { written: false, reason: 'no_profile' };
    }
    const current = asArray(rows[0].tracked_prompts);
    const next = mutate(current);
    if (next == null) {
      await client.query('ROLLBACK');
      return { written: false, reason: 'aborted' };
    }
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
 * Score the business value of every tracked prompt for a user. Strictly
 * additive; safe to run any number of times.
 *
 * @param {number} userId
 * @returns {Promise<{userId:number, status:string, [scored]:number, [pending]:number, [plan]:string}>}
 *   statuses: skipped_not_eligible | no_profile | no_prompts | pending_inputs |
 *             llm_failed | scored
 */
async function scorePromptValues(userId) {
  if (!userId) throw new Error('scorePromptValues requires a userId');

  // 1) Eligibility — same gate as the AI profile draft.
  const { plan } = await resolvePlanForRequest({ userId });
  const cfg = getDraftConfig(plan);
  if (!cfg[ELIGIBILITY_FLAG]) {
    return { userId, plan, status: 'skipped_not_eligible' };
  }

  // 2) Load business context + prompts.
  const profile = await readProfile(userId);
  if (!profile) return { userId, plan, status: 'no_profile' };

  const prompts = asArray(profile.tracked_prompts);
  if (prompts.length === 0) return { userId, plan, status: 'no_prompts' };

  // 2a) Inputs required — never guess economics. Mark unscored prompts pending
  //     (without clobbering any real band that already exists), then return.
  if (!profile.deal_size_band || !profile.sales_model) {
    let pending = 0;
    await applyToTrackedPrompts(userId, (current) => {
      let changed = false;
      const next = current.map((p) => {
        if (p && typeof p === 'object' && !hasScoredBand(p.value)) {
          pending += 1;
          changed = true;
          return { ...p, value: pendingValue() };
        }
        return p;
      });
      return changed ? next : null; // null => nothing to write
    });
    return { userId, plan, status: 'pending_inputs', pending };
  }

  // 3) ONE low-temperature batch call.
  const context = buildBusinessContext(profile);
  let raw;
  try {
    raw = await claudeAdapter.runQuery(buildQuery(context, prompts), { temperature: SCORE_TEMPERATURE });
  } catch (err) {
    console.warn(`[valueScoring] user ${userId}: LLM call failed (${err && err.message ? err.message : err}); aborting write`);
    return { userId, plan, status: 'llm_failed' };
  }

  const parsed = parseJsonArray(raw, 'value');
  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.warn(`[valueScoring] user ${userId}: empty/unparseable LLM response; aborting write (tracked_prompts untouched)`);
    return { userId, plan, status: 'llm_failed' };
  }

  // Build exact-text => band map from the model output.
  const bandByText = new Map();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const text = cleanStr(item.text);
    const band = normalizeBand(item.band);
    if (text && band != null) bandByText.set(text, band);
  }
  if (bandByText.size === 0) {
    console.warn(`[valueScoring] user ${userId}: no valid {text,band} pairs; aborting write`);
    return { userId, plan, status: 'llm_failed' };
  }

  // 4) Strictly additive write-back: set `value` ONLY on exact-text matches;
  //    leave every other key and every unmatched prompt's value UNCHANGED.
  let scored = 0;
  const result = await applyToTrackedPrompts(userId, (current) => {
    let changed = false;
    const next = current.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const band = bandByText.get(typeof p.text === 'string' ? p.text : null);
      if (band == null) return p;               // unmatched => value unchanged
      scored += 1;
      changed = true;
      return { ...p, value: scoredValue(band) }; // only `value` touched
    });
    return changed ? next : null;
  });

  if (!result.written) {
    return { userId, plan, status: 'llm_failed', scored: 0 };
  }
  return { userId, plan, status: 'scored', scored };
}

module.exports = { scorePromptValues };
