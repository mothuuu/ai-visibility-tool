'use strict';

/**
 * verify-rich-findings.js — READ-ONLY verification for the findings re-route.
 *
 * Exercises the exact mapper the GET /api/scans/:scanId/findings handler uses
 * (services/richFindingsMapper.js) against real scan_recommendations data, so
 * we can confirm the mapping and the empty-state behaviour on Render without
 * touching anything.
 *
 * Run on Render (DATABASE_URL is set in the backend service shell):
 *   node scripts/verify-rich-findings.js            # defaults: 561 896
 *   node scripts/verify-rich-findings.js 561 896 894
 *
 * It prints, per scan:
 *   - row count
 *   - distinct priority / estimated_effort / status values + impact range
 *   - whether any raw "N/100" string exists in the rows (Step-4 guardrail check)
 *   - recommendation_text lead words (to sanity-check status derivation)
 *   - severity_counts + the first two mapped finding cards
 *   - a sample evidence_json (to see where detection status really lives)
 *   - for empty scans: the scanEvidence top-level keys (empty-state log)
 */

const db = require('../db/database');
const { mapRecommendationToFinding, severityCounts } = require('../services/richFindingsMapper');

const REC_QUERY = `
  SELECT
    id, category, subfactor_key, priority, estimated_impact, estimated_effort,
    status, recommendation_text, findings, why_it_matters, impact_description,
    action_steps, evidence_json, engine_version,
    (evidence_json->>'gap')::numeric       AS gap,
    (evidence_json->>'score')::numeric     AS score,
    (evidence_json->>'threshold')::numeric AS threshold
  FROM scan_recommendations
  WHERE scan_id = $1
  ORDER BY
    CASE LOWER(priority)
      WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END ASC,
    estimated_impact DESC NULLS LAST, id ASC
`;

const distinct = (rows, k) => [...new Set(rows.map(r => r[k]))];
const HUNDRED = /\b\d{1,3}\s*\/\s*100\b/;

async function run(scanId) {
  console.log(`\n================ scan ${scanId} ================`);
  const rec = await db.query(REC_QUERY, [scanId]);
  console.log(`scan_recommendations rows: ${rec.rows.length}`);

  if (rec.rows.length === 0) {
    const s = await db.query('SELECT detailed_analysis FROM scans WHERE id = $1', [scanId]);
    let da = s.rows[0] && s.rows[0].detailed_analysis;
    if (typeof da === 'string') { try { da = JSON.parse(da); } catch (_) { da = null; } }
    const ev = da && (da.scanEvidence || da.scan_evidence);
    console.log('EMPTY-STATE → scanEvidence keys:', ev && typeof ev === 'object' ? Object.keys(ev) : '(none)');
    return;
  }

  console.log('distinct priority         :', distinct(rec.rows, 'priority'));
  console.log('distinct estimated_effort :', distinct(rec.rows, 'estimated_effort'));
  console.log('distinct status           :', distinct(rec.rows, 'status'));
  const impacts = rec.rows.map(r => Number(r.estimated_impact)).filter(Number.isFinite);
  if (impacts.length) console.log('estimated_impact range    :', Math.min(...impacts), '..', Math.max(...impacts));
  const per100 = rec.rows.filter(r => HUNDRED.test(JSON.stringify(r))).length;
  console.log('rows with a raw N/100     :', per100, per100 === 0 ? '(good — no /100)' : '(NEEDS normalization)');
  console.log('rec_text lead words       :', distinct(rec.rows.map(r => ({ w: String(r.recommendation_text || '').split(/\s+/)[0] })), 'w'));

  const mapped = rec.rows.map(mapRecommendationToFinding);
  console.log('severity_counts           :', severityCounts(mapped));
  console.log('mapped output still has N/100? :', mapped.some(m => HUNDRED.test(JSON.stringify(m))) ? 'YES (bug)' : 'no');
  console.log('\n-- first 2 mapped finding cards --');
  console.log(JSON.stringify(mapped.slice(0, 2), null, 2));

  const ej = rec.rows[0].evidence_json;
  const ejStr = typeof ej === 'string' ? ej : JSON.stringify(ej);
  console.log('\n-- evidence_json sample (row 0, first 700 chars) --');
  console.log((ejStr || '(null)').slice(0, 700));
}

(async () => {
  const ids = process.argv.slice(2).map(n => parseInt(n, 10)).filter(Number.isFinite);
  const scanIds = ids.length ? ids : [561, 896];
  try {
    for (const id of scanIds) await run(id);
  } catch (e) {
    console.error('verify error:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode || 0);
  }
})();
