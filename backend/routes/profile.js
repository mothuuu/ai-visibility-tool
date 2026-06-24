/**
 * Visibility Profile Routes (intake/profile build, Step 5)
 *
 *   GET  /api/profile   read the current user's visibility profile + draft config
 *   POST /api/profile   confirm (first completion) or edit the profile
 *
 * Rules:
 *  - Auth required; plan/profile state is read FRESH from the DB (never the JWT).
 *  - These endpoints are EDIT-ONLY for the draft: they NEVER call generateDraft
 *    and never trigger AI regeneration.
 *  - POST is paid-only (plan must be draft_enabled).
 *  - First completion (profile_completed_at IS NULL) sets profile_completed_at
 *    and triggers the deeper scan exactly once (deeper_scan_triggered_at).
 *  - Subsequent POSTs are plain edits: save changes, no scan re-trigger, no AI.
 *
 * Terminology: "draft" / "suggestion" — never "recommendation".
 */

const express = require('express');
const router = express.Router();

const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { resolvePlanForRequest, getDraftConfig } = require('../services/planService');
const { triggerDeeperScan } = require('../services/deeperScanService');

// Editable profile columns accepted from the client (draft lifecycle columns
// like draft_generated_at / draft_source are NEVER written by these endpoints).
const EDITABLE_FIELDS = [
  'display_name',
  'company_name',
  'industry',
  'location',
  'business_description',
  'icps',
  'competitors_business',
  'competitors_visibility',
  'tracked_prompts',
  'avg_customer_value',
  'priority_focus',
  'deal_size_band',
  'sales_model',
];

// Customer-supplied business economics that ground per-prompt Value scoring.
// Invalid/unknown values normalize to null (never persisted as garbage), same
// lenient discipline as funnel_stage. NULL = not-yet-provided.
const DEAL_SIZE_BANDS = new Set(['under_1k', '1k_10k', '10k_50k', '50k_250k', 'over_250k']);
const SALES_MODELS = new Set(['self_serve', 'smb', 'mid_market', 'enterprise']);
const ENUM_FIELD_VALUES = { deal_size_band: DEAL_SIZE_BANDS, sales_model: SALES_MODELS };

function normalizeEnumField(field, v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return ENUM_FIELD_VALUES[field].has(s) ? s : null;
}

const JSONB_FIELDS = new Set([
  'icps',
  'competitors_business',
  'competitors_visibility',
  'tracked_prompts',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a DB row (or null) into the stable profile shape the form expects. */
function normalizeProfile(row) {
  return {
    display_name: row?.display_name ?? null,
    company_name: row?.company_name ?? null,
    industry: row?.industry ?? null,
    location: row?.location ?? null,
    business_description: row?.business_description ?? null,
    icps: row?.icps ?? [],
    competitors_business: row?.competitors_business ?? [],
    competitors_visibility: row?.competitors_visibility ?? [],
    tracked_prompts: row?.tracked_prompts ?? [],
    avg_customer_value: row?.avg_customer_value ?? null,
    priority_focus: row?.priority_focus ?? null,
    deal_size_band: row?.deal_size_band ?? null,
    sales_model: row?.sales_model ?? null,
    draft_generated_at: row?.draft_generated_at ?? null,
    draft_source: row?.draft_source ?? null,
    profile_completed_at: row?.profile_completed_at ?? null,
    deeper_scan_triggered_at: row?.deeper_scan_triggered_at ?? null,
  };
}

/** Expose only the draft-config fields the form needs to render limits. */
function publicDraftConfig(cfg) {
  return {
    draft_enabled: cfg.draft_enabled,
    populated_prompts_min: cfg.populated_prompts_min,
    populated_prompts_max: cfg.populated_prompts_max,
    baseline_volume: cfg.baseline_volume,
    token_query_unlock_enabled: cfg.token_query_unlock_enabled,
    monitoring_cap: cfg.monitoring_cap,
    benchmarking_enabled: cfg.benchmarking_enabled,
  };
}

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const asArray = (v) => (Array.isArray(v) ? v : []);

const COMPETITOR_MAX = 5; // per column
const PROMPT_STAGES = new Set(['TOFU', 'MOFU', 'BOFU']);

// funnel_stage: TOFU/MOFU/BOFU (case-insensitive), else null (untagged).
function normalizeFunnelStage(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  return PROMPT_STAGES.has(s) ? s : null;
}

// Persisted competitor shape: { name, url }. url optional/lenient (trim, no
// format enforcement). Returns null for an empty-name item (dropped on save).
function normalizeCompetitorSave(it) {
  const rawName = typeof it === 'string' ? it : (it && it.name);
  const name = String(rawName == null ? '' : rawName).trim();
  if (!name) return null;
  const rawUrl = it && typeof it === 'object' ? it.url : null;
  const url = rawUrl == null ? null : (String(rawUrl).trim() || null);
  return { name, url };
}

/**
 * Server-side validation of a POST payload. Returns an array of field-level
 * errors ([] when valid). Never trusts the client.
 *
 * @param {object} body
 * @param {{ plan: string, monitoringCap: (number|null) }} planCtx - monitoringCap
 *        from getDraftConfig(plan); null means no limit (Enterprise).
 */
function validateProfilePayload(body, planCtx) {
  const errors = [];
  const push = (field, rule, message) => errors.push({ field, rule, message });

  if (!isNonEmptyString(body.display_name)) {
    push('display_name', 'required', 'Display name is required');
  }
  if (!isNonEmptyString(body.business_description)) {
    push('business_description', 'required', 'Business description is required');
  }

  // ICP counts only when it is selected AND has non-empty (trimmed) text.
  const icps = asArray(body.icps);
  const icpText = (it) => (typeof it === 'string' ? it : it && it.text);
  const icpSelected = (it) => (typeof it === 'string' ? true : !!(it && it.selected));
  const selectedIcps = icps.filter((it) => icpSelected(it) && isNonEmptyString(icpText(it)));
  if (selectedIcps.length < 1) {
    push('icps', 'min', 'At least one ICP must be selected');
  }

  // Competitor counts only when it has a non-empty (trimmed) name.
  const compName = (it) => (typeof it === 'string' ? it : it && it.name);

  const cbNamed = asArray(body.competitors_business).filter((it) => isNonEmptyString(compName(it)));
  if (cbNamed.length < 1) {
    push('competitors_business', 'min', 'At least one business competitor is required');
  } else if (cbNamed.length > COMPETITOR_MAX) {
    push('competitors_business', 'max', `Up to ${COMPETITOR_MAX} business competitors`);
  }

  const cvNamed = asArray(body.competitors_visibility).filter((it) => isNonEmptyString(compName(it)));
  if (cvNamed.length < 1) {
    push('competitors_visibility', 'min', 'At least one visibility competitor is required');
  } else if (cvNamed.length > COMPETITOR_MAX) {
    push('competitors_visibility', 'max', `Up to ${COMPETITOR_MAX} visibility competitors`);
  }

  const prompts = asArray(body.tracked_prompts);
  if (prompts.length < 3) {
    push('tracked_prompts', 'min', 'At least 3 tracked prompts are required');
  } else {
    const bad = prompts.findIndex((p) => !isNonEmptyString(typeof p === 'string' ? p : p?.text));
    if (bad !== -1) {
      push('tracked_prompts', 'item_invalid', `Tracked prompt at index ${bad} is missing text`);
    }
  }

  // Server-enforce the plan's monitoring cap (never silently clamp/drop).
  // null cap = no limit (Enterprise) => skip.
  const cap = planCtx?.monitoringCap;
  if (cap !== null && cap !== undefined) {
    const monitoredCount = prompts.filter((p) => typeof p === 'object' && p?.is_monitored === true).length;
    if (monitoredCount > cap) {
      push(
        'tracked_prompts',
        'monitoring_cap',
        `You can monitor up to ${cap} prompts on the ${planCtx.plan} plan`
      );
    }
  }

  return errors;
}

// Core, form-authored prompt keys that this endpoint owns and normalizes.
// Anything else on a prompt is server-computed enrichment (value,
// opportunity_evidence, …) that the form only round-trips.
const CORE_PROMPT_KEYS = new Set(['text', 'volume', 'is_monitored', 'funnel_stage']);

/** Coerce a tracked_prompts entry into the stored {text, volume, is_monitored} shape. */
function normalizePrompt(p) {
  if (typeof p === 'string') {
    return { text: p.trim(), volume: null, is_monitored: false, funnel_stage: null };
  }
  const out = {
    text: String(p.text == null ? '' : p.text).trim(),
    volume: p.volume ?? null,
    is_monitored: Boolean(p.is_monitored),
    funnel_stage: normalizeFunnelStage(p.funnel_stage),
  };
  // Preserve every server-computed enrichment key verbatim (value,
  // opportunity_evidence, and any future per-prompt enrichment) so an intake
  // edit never flattens it. Generalized so new enrichment keys are kept without
  // touching this code again.
  for (const k of Object.keys(p)) {
    if (!CORE_PROMPT_KEYS.has(k) && p[k] !== undefined) out[k] = p[k];
  }
  return out;
}

/** Build the sanitized, save-ready value map from a validated payload. */
function buildSaveValues(body) {
  const values = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    if (field === 'tracked_prompts') {
      values[field] = asArray(body.tracked_prompts).map(normalizePrompt);
    } else if (field === 'competitors_business' || field === 'competitors_visibility') {
      // Persist clean { name, url }; drop empty-name items; cap at 5 per column.
      values[field] = asArray(body[field]).map(normalizeCompetitorSave).filter(Boolean).slice(0, COMPETITOR_MAX);
    } else if (JSONB_FIELDS.has(field)) {
      values[field] = asArray(body[field]);
    } else if (field in ENUM_FIELD_VALUES) {
      values[field] = normalizeEnumField(field, body[field]);
    } else {
      values[field] = body[field] === undefined ? null : body[field];
    }
  }
  return values;
}

// ---------------------------------------------------------------------------
// GET /api/profile
// ---------------------------------------------------------------------------
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Fresh reads — do not trust the JWT for plan/profile state.
    const { plan } = await resolvePlanForRequest({ userId });
    const draftConfig = getDraftConfig(plan);

    const { rows } = await db.query(
      `SELECT display_name, company_name, industry, location, business_description,
              icps, competitors_business, competitors_visibility, tracked_prompts,
              avg_customer_value, priority_focus, deal_size_band, sales_model,
              draft_generated_at, draft_source, profile_completed_at, deeper_scan_triggered_at
         FROM visibility_profiles
        WHERE user_id = $1`,
      [userId]
    );
    const row = rows[0] || null;

    return res.json({
      profile: normalizeProfile(row),
      draft_ready: Boolean(row?.draft_generated_at),
      profile_completed: Boolean(row?.profile_completed_at),
      draft_config: publicDraftConfig(draftConfig),
    });
  } catch (err) {
    console.error('[Profile] GET /api/profile error:', err.message);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/profile  (first completion OR edit)
// ---------------------------------------------------------------------------
router.post('/', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  // Fresh plan read — paid (draft-enabled) only.
  let plan;
  try {
    ({ plan } = await resolvePlanForRequest({ userId }));
  } catch (err) {
    console.error('[Profile] POST plan resolution error:', err.message);
    return res.status(500).json({ error: 'Failed to resolve plan' });
  }
  const draftConfig = getDraftConfig(plan);
  if (!draftConfig.draft_enabled) {
    return res.status(403).json({
      error: 'Profile editing is not available on your plan',
      plan,
    });
  }

  // Server-side validation — write nothing on failure.
  const errors = validateProfilePayload(req.body || {}, { plan, monitoringCap: draftConfig.monitoring_cap });
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', fields: errors });
  }

  const values = buildSaveValues(req.body || {});

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Lock the row (if any) so first-completion detection is race-safe. Also read
    // prior value-scoring inputs so we only (re)trigger scoring when they change.
    const existing = await client.query(
      `SELECT profile_completed_at, deal_size_band, sales_model
         FROM visibility_profiles WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    const isFirstCompletion = existing.rows.length === 0 || existing.rows[0].profile_completed_at === null;
    const priorInputs = existing.rows[0] || {};

    // Upsert ONLY the editable fields (draft lifecycle columns untouched).
    const cols = Object.keys(values);
    const insertCols = ['user_id', ...cols];
    const insertPlaceholders = insertCols.map((_, i) => `$${i + 1}`);
    const insertParams = [userId, ...cols.map((c) => (JSONB_FIELDS.has(c) ? JSON.stringify(values[c]) : values[c]))];
    // Cast JSONB columns explicitly.
    const placeholderFor = (col, idx) => (JSONB_FIELDS.has(col) ? `${insertPlaceholders[idx]}::jsonb` : insertPlaceholders[idx]);
    const insertColExpr = insertCols.map((c, i) => placeholderFor(c, i));
    const updateSet = cols
      .map((c, i) => `${c} = ${JSONB_FIELDS.has(c) ? `$${i + 2}::jsonb` : `$${i + 2}`}`)
      .join(', ');

    await client.query(
      `INSERT INTO visibility_profiles (${insertCols.join(', ')})
       VALUES (${insertColExpr.join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${updateSet}`,
      insertParams
    );

    // First completion only: stamp completion + deeper-scan trigger atomically.
    // The WHERE guard double-protects against a concurrent double-submit.
    let scanTriggered = false;
    if (isFirstCompletion) {
      const stamp = await client.query(
        `UPDATE visibility_profiles
            SET profile_completed_at = NOW(), deeper_scan_triggered_at = NOW()
          WHERE user_id = $1 AND profile_completed_at IS NULL
          RETURNING id`,
        [userId]
      );
      if (stamp.rows.length > 0) {
        // Single integration seam for the deeper/targeted scan.
        await triggerDeeperScan({ userId, profile: values, plan, client });
        scanTriggered = true;
      }
    }

    await client.query('COMMIT');

    // Layer-2 (Value): separate, non-blocking, isolated. Trigger only once BOTH
    // business inputs exist AND this save provided/changed them — so unrelated
    // edits don't re-spend an LLM call. The scorer itself is strictly additive
    // and idempotent; a failure here never affects the save response.
    const newDeal = 'deal_size_band' in values ? values.deal_size_band : priorInputs.deal_size_band;
    const newModel = 'sales_model' in values ? values.sales_model : priorInputs.sales_model;
    const inputsChanged =
      newDeal !== priorInputs.deal_size_band || newModel !== priorInputs.sales_model;
    if (newDeal && newModel && inputsChanged) {
      Promise.resolve()
        .then(() => require('../services/draftGeneration/valueScoring').scorePromptValues(userId))
        .then((res) => {
          // Opportunity evidence (Perplexity) depends on value bands; chain it
          // only once scoring populated them. Isolated; never affects the save.
          if (res && res.status === 'scored') {
            return require('../services/draftGeneration/opportunityEvidence').gatherOpportunityEvidence(userId);
          }
          return undefined;
        })
        .then((ev) => {
          // Winnability score: pure computation over the evidence just gathered.
          if (ev && ev.status === 'gathered') {
            return require('../services/draftGeneration/opportunityScoring').scoreOpportunity(userId);
          }
          return undefined;
        })
        .catch((err) =>
          console.warn(`[Profile] enrichment trigger failed for user ${userId}: ${err && err.message ? err.message : err}`)
        );
    }

    // Return the fresh, normalized state.
    const { rows } = await db.query(
      `SELECT display_name, company_name, industry, location, business_description,
              icps, competitors_business, competitors_visibility, tracked_prompts,
              avg_customer_value, priority_focus, deal_size_band, sales_model,
              draft_generated_at, draft_source, profile_completed_at, deeper_scan_triggered_at
         FROM visibility_profiles WHERE user_id = $1`,
      [userId]
    );
    const row = rows[0];

    return res.json({
      profile: normalizeProfile(row),
      profile_completed: Boolean(row?.profile_completed_at),
      first_completion: scanTriggered,
      deeper_scan_triggered: scanTriggered,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Profile] POST /api/profile error:', err.message);
    return res.status(500).json({ error: 'Failed to save profile' });
  } finally {
    client.release();
  }
});

module.exports = router;

// Test-only surface for the pure save/read helpers (no routing impact).
module.exports.__test = { normalizeProfile, buildSaveValues, normalizePrompt, normalizeEnumField };
