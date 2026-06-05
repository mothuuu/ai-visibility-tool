/**
 * Draft Generation Service (Step 3 — intake/profile build).
 *
 * Populates a user's visibility_profiles record ONCE from their existing
 * completed scan. The draft is generated a single time, then it's edit-only
 * forever — no AI re-runs, no overwrites. This is what protects user edits.
 *
 * Hard rules enforced here:
 *  - Plan-gated: freemium (draft_enabled=false) is a no-op.
 *  - Idempotent: if draft_generated_at is already set, no-op (never overwrite).
 *  - Reuses an existing COMPLETED scan as raw material; NEVER triggers a scan.
 *  - No completed scan => "no_scan" status, draft_generated_at NOT set, so the
 *    job can run later once a scan exists.
 *  - Reliable: each generator is isolated (try/catch + short retry); a failing
 *    or stub generator leaves its field at the empty default and the job STILL
 *    completes and marks draft_generated_at.
 *
 * This module is the job logic. A thin CLI wrapper lives at
 * scripts/draft-generate.js (npm run draft:generate -- --user <id>).
 */

const db = require('../db/database');
const { resolvePlanForRequest, getDraftConfig } = require('./planService');
const { PIPELINE } = require('./draftGeneration/generators');

const GENERATOR_RETRIES = 1; // one short internal retry per generator

// Status constants returned by generateDraft().
const STATUS = Object.freeze({
  SKIPPED_DISABLED: 'skipped_draft_disabled',
  ALREADY_GENERATED: 'already_generated',
  NO_SCAN: 'no_scan',
  GENERATED: 'generated',
});

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

async function getProfileRow(userId) {
  const { rows } = await db.query(
    `SELECT user_id, draft_generated_at, draft_source
       FROM visibility_profiles
      WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function ensureProfileRow(userId) {
  await db.query(
    `INSERT INTO visibility_profiles (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

async function getLatestCompletedScan(userId) {
  const { rows } = await db.query(
    `SELECT id, user_id, url, status, industry, detailed_analysis, created_at, completed_at
       FROM scans
      WHERE user_id = $1 AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Persist the generated draft. The `draft_generated_at IS NULL` guard makes the
 * write itself no-overwrite and race-safe: it only ever sets the draft once.
 *
 * @returns {boolean} true if a row was written (draft newly marked)
 */
async function persistDraft(userId, profile) {
  const { rowCount } = await db.query(
    `UPDATE visibility_profiles SET
        company_name           = $2,
        industry               = $3,
        location               = $4,
        business_description   = $5,
        icps                   = $6::jsonb,
        competitors_business   = $7::jsonb,
        competitors_visibility = $8::jsonb,
        tracked_prompts        = $9::jsonb,
        draft_generated_at     = NOW(),
        draft_source           = 'auto'
      WHERE user_id = $1 AND draft_generated_at IS NULL`,
    [
      userId,
      profile.company_name ?? null,
      profile.industry ?? null,
      profile.location ?? null,
      profile.business_description ?? null,
      JSON.stringify(profile.icps ?? []),
      JSON.stringify(profile.competitors_business ?? []),
      JSON.stringify(profile.competitors_visibility ?? []),
      JSON.stringify(profile.tracked_prompts ?? []),
    ]
  );
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
// Generator execution (isolated + retried)
// ---------------------------------------------------------------------------

/**
 * Run a single generator with isolation. Never throws: on failure (after
 * retries) it returns the generator's empty default and records 'failed'.
 *
 * @returns {{ contribution: object, status: 'ran'|'stubbed'|'failed'|'skipped' }}
 */
async function runGenerator(generator, ctx) {
  // Optional plan/data gate (e.g. volumes only when baseline_volume is on).
  if (typeof generator.shouldRun === 'function' && !generator.shouldRun(ctx)) {
    return { contribution: generator.empty(), status: 'skipped' };
  }

  for (let attempt = 0; attempt <= GENERATOR_RETRIES; attempt++) {
    try {
      const contribution = (await generator.run(ctx)) || {};
      return { contribution, status: generator.automated ? 'ran' : 'stubbed' };
    } catch (err) {
      if (attempt < GENERATOR_RETRIES) {
        console.warn(
          `[DraftGeneration] generator '${generator.name}' attempt ${attempt + 1} failed: ${err.message} — retrying`
        );
        continue;
      }
      console.error(
        `[DraftGeneration] generator '${generator.name}' failed after ${GENERATOR_RETRIES + 1} attempt(s): ${err.message} — using empty default`
      );
      return { contribution: safeEmpty(generator), status: 'failed' };
    }
  }
  // Unreachable, but keeps the contract explicit.
  return { contribution: safeEmpty(generator), status: 'failed' };
}

function safeEmpty(generator) {
  try {
    return generator.empty() || {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the one-time draft for a user.
 *
 * @param {number} userId
 * @param {object} [options]
 * @param {Array}  [options.pipeline] - generator pipeline (defaults to the
 *        registry). Injectable for testing (e.g. a generator that throws).
 * @returns {Promise<{ userId:number, plan?:string, status:string, fields?:object, ... }>}
 */
async function generateDraft(userId, { pipeline = PIPELINE } = {}) {
  if (!userId) throw new Error('generateDraft requires a userId');

  // 1) Plan gate — freemium / draft-disabled is a no-op.
  const { plan } = await resolvePlanForRequest({ userId });
  const draftConfig = getDraftConfig(plan);

  if (!draftConfig.draft_enabled) {
    console.log(`[DraftGeneration] user ${userId} plan '${plan}': draft not enabled — skipping`);
    return { userId, plan, status: STATUS.SKIPPED_DISABLED };
  }

  // 2) Idempotency — never regenerate / overwrite an existing draft.
  const existing = await getProfileRow(userId);
  if (existing && existing.draft_generated_at) {
    console.log(
      `[DraftGeneration] user ${userId}: draft already generated at ${existing.draft_generated_at.toISOString?.() ?? existing.draft_generated_at} (source=${existing.draft_source}) — skipping`
    );
    return {
      userId,
      plan,
      status: STATUS.ALREADY_GENERATED,
      draft_generated_at: existing.draft_generated_at,
      draft_source: existing.draft_source,
    };
  }

  // Make sure a profile row exists (so a later run can fill it in too).
  await ensureProfileRow(userId);

  // 3) No-scan edge case — do NOT crash, do NOT mark generated.
  const scan = await getLatestCompletedScan(userId);
  if (!scan) {
    console.log(`[DraftGeneration] user ${userId}: no completed scan — recording no_scan, draft NOT generated`);
    return { userId, plan, status: STATUS.NO_SCAN };
  }

  // 4) Run the generator pipeline. Contributions accumulate into ctx.profile so
  //    later generators can read earlier results (ICPs -> prompts -> volumes).
  const ctx = { userId, scan, plan, draftConfig, profile: {} };
  const fields = {};

  for (const generator of pipeline) {
    const { contribution, status } = await runGenerator(generator, ctx);
    fields[generator.name] = status;
    Object.assign(ctx.profile, contribution);
  }

  // 5) Persist once and mark the draft generated. Even if every generator
  //    stubbed/failed, the job completes and draft_generated_at is set.
  const written = await persistDraft(userId, ctx.profile);

  console.log(
    `[DraftGeneration] user ${userId} (plan=${plan}, scan=${scan.id}): draft generated — ` +
      Object.entries(fields).map(([k, v]) => `${k}:${v}`).join(' ')
  );

  return {
    userId,
    plan,
    scanId: scan.id,
    status: STATUS.GENERATED,
    draft_source: 'auto',
    written,
    fields,
    profile: ctx.profile,
  };
}

module.exports = { generateDraft, STATUS };
