'use strict';

/**
 * findingsGenerator.js — evidence-only generate-on-miss for the findings surface.
 *
 * Rebuild of the deleted scan-recommendations-service's generation path, scoped
 * to the top-10 evidence-gated subfactors. It runs entirely from the persisted
 * `scanEvidence` — no per-subfactor rubric scores, no re-crawl, no HTTP/LLM
 * (the three invoked hooks are pure template assembly).
 *
 * Design: rather than duplicate the proven renderer's internals (template
 * resolution, evidence gating, hook execution), we seed a synthetic rubricResult
 * that marks the top-10 subfactors as "failing", then delegate to the exported
 * `renderRecommendations`. Its Phase-4A.3c detection-state step suppresses
 * subfactors whose evidence is COMPLETE — so selection is effectively
 * evidence-only (getDetectionState over scanEvidence), which is the whole point.
 * We then strip the synthetic score/threshold/gap from each row's evidence_json
 * so we never fabricate rubric numbers (there are none at read time).
 *
 * Persistence is idempotent: a per-scan transaction advisory lock + a zero-row
 * re-check inside the transaction prevents double-generation from two
 * simultaneous first-loads. Only generates when zero rows exist.
 */

const db = require('../db/database');
const {
  renderRecommendations,
  TOP_10_SUBFACTORS,
} = require('../phase2_preserved/renderer');
const { getPlaybookEntry } = require('../phase2_preserved/subfactorPlaybookMap');
const { gateRows } = require('./findingsGate');

// Synthetic rubricResult: every top-10 subfactor present with a below-threshold
// score so `extractFailingSubfactors` surfaces them all; the renderer's
// detection-state suppression then drops the ones whose evidence is COMPLETE.
function buildSyntheticRubric() {
  const categories = {};
  for (const key of TOP_10_SUBFACTORS) {
    const dot = key.indexOf('.');
    if (dot < 0) continue;
    const cat = key.slice(0, dot);
    const sub = key.slice(dot + 1);
    if (!categories[cat]) categories[cat] = { score: 0, subfactors: {} };
    categories[cat].subfactors[sub] = { score: 0, state: 'measured' };
  }
  return { categories };
}

// Map one renderer rec → a scan_recommendations row (evidence-only shape).
function recToRow(scanId, rec) {
  const entry = getPlaybookEntry(rec.subfactor_key) || {};

  // Strip synthetic rubric numbers — we do not fabricate score/threshold/gap.
  const ej = { ...(rec.evidence_json || {}) };
  delete ej.score;
  delete ej.threshold;
  delete ej.gap;

  const actionSteps = Array.isArray(rec.action_items)
    ? rec.action_items
    : (Array.isArray(rec.how_to_implement) ? rec.how_to_implement : []);

  return {
    scan_id: scanId,
    category: rec.pillar || entry.playbook_category || null,
    subfactor_key: rec.subfactor_key || null,
    priority: entry.priority || null,                 // 'P0'/'P1'/'P2' → severity in the mapper
    estimated_effort: entry.effort || null,           // 'S'/'M'/'L'/… → difficulty in the mapper
    status: 'pending',
    recommendation_text: rec.gap || entry.playbook_gap || null,   // status-led title
    // "What we found": when a finding lists specific evidence items (count line +
    // the exact items to fix, e.g. the images missing alt) use that; otherwise
    // keep the existing source unchanged for every other finding (evidence
    // summary, then finding prose) — this PR only upgrades the alt-text path.
    findings: rec.what_we_found || rec.evidence_summary || rec.finding || null,
    why_it_matters: rec.why_it_matters || null,
    impact_description: rec.why_it_matters || null,
    action_steps: JSON.stringify(actionSteps),
    evidence_json: JSON.stringify(ej),
    rec_key: rec.rec_key || null,
    confidence: (rec.confidence === undefined ? null : rec.confidence),
    evidence_quality: rec.evidence_quality || null,
    engine_version: 'v5.1',
  };
}

const INSERT_SQL = `
  INSERT INTO scan_recommendations
    (scan_id, category, subfactor_key, priority, estimated_effort, status,
     recommendation_text, findings, why_it_matters, impact_description,
     action_steps, evidence_json, rec_key, confidence, evidence_quality, engine_version)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
`;

/**
 * Generate the evidence-only rows for a scan (no DB writes). Exported so the
 * mapping can be smoke-tested against a scanEvidence fixture without a database.
 */
async function generateRows({ scanId, scan, scanEvidence, industry, subfactorScores }) {
  const rubricResult = buildSyntheticRubric();
  const context = industry ? { detected_industry: industry } : {};
  const scanObj = { id: scanId, ...(scan || {}) };

  const recs = await renderRecommendations({
    scan: scanObj,
    rubricResult,
    scanEvidence,
    context,
  });

  let rows = (recs || []).map((rec) => recToRow(scanId, rec));

  // B1 gate: when the scan carries rubric subfactor scores (future scans),
  // suppress findings the rubric already credits (leaf >= full credit), so
  // findings can't contradict the score. Ungatable resolvers and scans without
  // subfactorScores fall through unchanged (evidence-only).
  if (subfactorScores && typeof subfactorScores === 'object') {
    const { kept, suppressed } = gateRows(rows, subfactorScores);
    if (suppressed.length) {
      console.log(
        `[Findings] scan ${scanId}: rubric-gated ${suppressed.length} finding(s): ` +
        suppressed.map(s => `${s.subfactor_key} (${s.reason})`).join('; ')
      );
    }
    rows = kept;
  }

  return rows;
}

/**
 * Generate-on-miss + persist, idempotently. Returns { generated, alreadyExisted }.
 * Only writes when the scan has zero rows (re-checked inside the lock).
 */
async function generateAndPersist({ scanId, scan, scanEvidence, industry, subfactorScores }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // Per-scan advisory lock: serialise concurrent first-loads.
    await client.query('SELECT pg_advisory_xact_lock($1)', [scanId]);

    const existing = await client.query(
      'SELECT 1 FROM scan_recommendations WHERE scan_id = $1 LIMIT 1',
      [scanId]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return { generated: 0, alreadyExisted: true };
    }

    const rows = await generateRows({ scanId, scan, scanEvidence, industry, subfactorScores });
    for (const r of rows) {
      await client.query(INSERT_SQL, [
        r.scan_id, r.category, r.subfactor_key, r.priority, r.estimated_effort, r.status,
        r.recommendation_text, r.findings, r.why_it_matters, r.impact_description,
        r.action_steps, r.evidence_json, r.rec_key, r.confidence, r.evidence_quality, r.engine_version,
      ]);
    }

    await client.query('COMMIT');
    return { generated: rows.length, alreadyExisted: false };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  generateAndPersist,
  generateRows,
  buildSyntheticRubric,
  recToRow,
};
