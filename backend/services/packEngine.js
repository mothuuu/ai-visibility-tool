/**
 * PackEngine
 *
 * Generates execution packs: validates entitlements, records the purchase + run,
 * builds prompt context from scan/findings/evidence, calls the Anthropic API,
 * stores artifacts, then debits tokens.
 *
 * Token-safety contract:
 *   - Tokens are debited LAST, only after successful generation + artifact write.
 *   - If validation, AI call, or artifact write fails: pack_run/pack_purchase
 *     are marked 'failed' and tokens are NOT debited.
 *   - If token debit fails AFTER successful generation: artifacts are kept,
 *     pack_purchase is left at 'complete', and a warning is returned in the
 *     result. The user paid for the generation; we do not discard work.
 */

const db = require('../db/database');
const TokenService = require('./tokenService');
const { getEntitlements, getEffectivePlan } = require('./planService');
const InsufficientTokensError = require('../errors/InsufficientTokensError');
const { getPackConfig, getArtifactType, planMeetsRequirement } = require('../config/packCatalog');
const { getTemplate } = require('../templates/packTemplates');

const DEFAULT_MODEL = process.env.ANTHROPIC_PACK_MODEL || require('../config/models').DEFAULT_CLAUDE_MODEL;
const MAX_TOKENS = 4096;
const PREVIEW_LEN = 500;

// Lazy-init Anthropic client so this module loads in environments without the SDK
// (e.g. unit tests that stub it via Module._load).
let _anthropic = null;
function getAnthropic() {
  if (!_anthropic) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------
class PackValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PackValidationError';
    this.code = code; // 'unknown_pack' | 'plan_too_low' | 'scan_not_found' | 'insufficient_tokens'
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Generate an execution pack.
 *
 * @param {number} userId
 * @param {string} packType   - key in PACK_CATALOG
 * @param {number} scanId
 * @param {object} [params]   - extra generation params, persisted on pack_runs
 * @returns {Promise<{
 *   packPurchaseId: number,
 *   packRunId: number,
 *   status: 'complete'|'failed',
 *   artifacts: Array<{ id:number, type:string, contentPreview:string }>,
 *   tokenDebitWarning?: string
 * }>}
 */
async function generate(userId, packType, scanId, params = {}) {
  // ---- Step 1: VALIDATE (no DB writes yet) ----
  const pack = getPackConfig(packType);
  if (!pack) {
    throw new PackValidationError(`Unknown pack type: ${packType}`, 'unknown_pack');
  }

  const userPlan = await loadUserPlan(userId);
  const effectivePlan = getEffectivePlan(userPlan);
  if (!planMeetsRequirement(effectivePlan, pack.minPlan)) {
    throw new PackValidationError(
      `Pack '${packType}' requires plan '${pack.minPlan}' or higher (user is on '${effectivePlan}')`,
      'plan_too_low'
    );
  }

  const balance = await TokenService.getBalance(userId);
  if (balance.total_available < pack.cost) {
    throw new InsufficientTokensError(pack.cost, balance.total_available);
  }

  const scan = await loadScanForUser(scanId, userId);
  if (!scan) {
    throw new PackValidationError(
      `Scan ${scanId} not found or does not belong to user ${userId}`,
      'scan_not_found'
    );
  }

  // ---- Step 2: CREATE PURCHASE + RUN (status pending/generating) ----
  const purchaseRes = await db.query(
    `INSERT INTO pack_purchases (user_id, scan_id, pack_type, tokens_spent, status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
    [userId, scanId, packType, pack.cost]
  );
  const packPurchaseId = purchaseRes.rows[0].id;

  const runRes = await db.query(
    `INSERT INTO pack_runs (pack_purchase_id, version, input_scan_id, generation_params, status, started_at)
     VALUES ($1, 1, $2, $3, 'generating', NOW()) RETURNING id`,
    [packPurchaseId, scanId, JSON.stringify(params || {})]
  );
  const packRunId = runRes.rows[0].id;

  try {
    // ---- Step 3: BUILD CONTEXT ----
    const context = await buildContext(scan);

    // ---- Step 4: SELECT AND RUN PROMPT TEMPLATE ----
    const tpl = getTemplate(packType);
    if (!tpl) {
      // Should never happen — catalog and template registry must stay in sync
      throw new Error(`No template registered for pack type ${packType}`);
    }

    // Optional pre-AI extra context (e.g. refresh pack loads previous scan).
    // Templates can throw here to abort BEFORE the AI call / token debit.
    if (typeof tpl.buildExtraContext === 'function') {
      const extra = await tpl.buildExtraContext(context, db);
      if (extra && typeof extra === 'object') Object.assign(context, extra);
    }

    let parsed;
    let modelUsed;
    if (pack.requiresAI === false && typeof tpl.generate === 'function') {
      // Non-AI pack (e.g. audit_pdf): template produces output directly.
      parsed = await tpl.generate(context);
      modelUsed = null;
    } else {
      const userPrompt = tpl.userPrompt(context);
      const aiResponseText = await callAnthropic(tpl.systemPrompt, userPrompt);
      modelUsed = DEFAULT_MODEL;
      parsed = parseAiResponse(aiResponseText);
    }

    // ---- Step 5: STORE ARTIFACTS ----
    // Optional per-template post-processing (validation, counting, normalization).
    // Templates without postProcess are unaffected.
    if (typeof tpl.postProcess === 'function') {
      try { parsed = tpl.postProcess(parsed); }
      catch (ppErr) {
        console.error(`[PackEngine] postProcess for ${packType} threw:`, ppErr.message);
        parsed = { ...parsed, post_process_error: ppErr.message };
      }
    }
    const artifactType = getArtifactType(packType);
    const preview = makePreview(parsed);

    const artifactRes = await db.query(
      `INSERT INTO pack_artifacts (pack_run_id, artifact_type, content_preview, content_full)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id, artifact_type, content_preview`,
      [packRunId, artifactType, preview, JSON.stringify(parsed)]
    );

    await db.query(
      `UPDATE pack_runs SET status = 'complete', completed_at = NOW(), ai_model_used = $1 WHERE id = $2`,
      [modelUsed, packRunId]
    );

    // ---- Step 6: DEBIT TOKENS (last) ----
    let tokenDebitWarning;
    try {
      await TokenService.spendTokens(userId, pack.cost, 'pack_purchase', String(packPurchaseId));
      await db.query(`UPDATE pack_purchases SET status = 'complete', updated_at = NOW() WHERE id = $1`, [packPurchaseId]);
    } catch (debitErr) {
      // Generation succeeded but debit failed (e.g. concurrent spend drained balance).
      // Spec: keep the artifacts, mark purchase complete, log the issue, return a warning.
      console.error(`[PackEngine] Token debit failed AFTER successful generation for purchase ${packPurchaseId}:`, debitErr.message);
      await db.query(`UPDATE pack_purchases SET status = 'complete', updated_at = NOW() WHERE id = $1`, [packPurchaseId]);
      tokenDebitWarning = `Generated successfully but token debit failed: ${debitErr.message}. Please contact support.`;
    }

    return {
      packPurchaseId,
      packRunId,
      status: 'complete',
      artifacts: artifactRes.rows.map(r => ({
        id: r.id, type: r.artifact_type, contentPreview: r.content_preview
      })),
      ...(tokenDebitWarning ? { tokenDebitWarning } : {})
    };

  } catch (err) {
    // Generation pipeline failed — mark failed, do NOT debit tokens
    const errMsg = (err && err.message) || String(err);
    try {
      await db.query(
        `UPDATE pack_runs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
        [errMsg, packRunId]
      );
      await db.query(
        `UPDATE pack_purchases SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [packPurchaseId]
      );
    } catch (updateErr) {
      console.error('[PackEngine] Failed to mark pack_run/pack_purchase as failed:', updateErr.message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function loadUserPlan(userId) {
  const r = await db.query('SELECT plan FROM users WHERE id = $1', [userId]);
  if (r.rows.length === 0) {
    throw new PackValidationError(`User ${userId} not found`, 'scan_not_found');
  }
  return r.rows[0].plan;
}

async function loadScanForUser(scanId, userId) {
  const r = await db.query(
    `SELECT id, user_id, primary_domain, score, pillar_scores, page_count, pages_analyzed, created_at
     FROM scans WHERE id = $1 AND user_id = $2`,
    [scanId, userId]
  );
  return r.rows[0] || null;
}

async function buildContext(scan) {
  const findingsRes = await db.query(
    `SELECT id, pillar, subfactor_key, severity, title, description,
            impacted_urls, evidence_data
     FROM findings
     WHERE scan_id = $1
     ORDER BY
       CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                     WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END ASC,
       pillar ASC, id ASC`,
    [scan.id]
  );

  const evidenceRes = await db.query(
    `SELECT id, page_url, schema_found, headings, meta_data
     FROM evidence_snapshots WHERE scan_id = $1 LIMIT 20`,
    [scan.id]
  );

  const findings = findingsRes.rows.map(f => ({
    ...f,
    impacted_urls: f.impacted_urls || [],
    impacted_url_count: Array.isArray(f.impacted_urls) ? f.impacted_urls.length : 0
  }));

  const pageUrls = evidenceRes.rows.map(e => e.page_url).filter(Boolean);

  return {
    scanId: scan.id,
    domain: scan.primary_domain,
    scanScore: scan.score,
    scanCreatedAt: scan.created_at,
    pillarScores: scan.pillar_scores || {},
    pageCount: scan.page_count,
    findings,
    evidence: evidenceRes.rows,
    pageUrls,
    // Internal fields (prefixed with _) for templates that need them
    _scanId: scan.id
  };
}

async function callAnthropic(systemPrompt, userPrompt) {
  const client = getAnthropic();
  const resp = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });
  // Anthropic SDK returns content as an array of blocks; extract text.
  const textBlock = (resp.content || []).find(b => b.type === 'text');
  if (!textBlock || typeof textBlock.text !== 'string') {
    throw new Error('Anthropic response contained no text block');
  }
  return textBlock.text;
}

function parseAiResponse(text) {
  // Templates instruct the model to return strict JSON. If parsing fails,
  // we wrap the raw text so the artifact still preserves output for debugging.
  const trimmed = (text || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip markdown fences if present
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try { return JSON.parse(fenced[1].trim()); } catch { /* fall through */ }
    }
    // Try to extract the largest top-level object or array
    const obj = trimmed.match(/\{[\s\S]*\}/);
    if (obj) {
      try { return JSON.parse(obj[0]); } catch { /* fall through */ }
    }
    const arr = trimmed.match(/\[[\s\S]*\]/);
    if (arr) {
      try { return JSON.parse(arr[0]); } catch { /* fall through */ }
    }
    return { raw: trimmed, parse_error: true };
  }
}

function makePreview(parsed) {
  // If the template provided a human-readable preview field, use it directly.
  if (parsed && typeof parsed === 'object' && typeof parsed.executive_summary === 'string') {
    const s = parsed.executive_summary;
    return s.length > PREVIEW_LEN ? s.slice(0, PREVIEW_LEN) : s;
  }
  let s;
  try { s = JSON.stringify(parsed); } catch { s = String(parsed); }
  return s.length > PREVIEW_LEN ? s.slice(0, PREVIEW_LEN) : s;
}

module.exports = {
  generate,
  PackValidationError
};
