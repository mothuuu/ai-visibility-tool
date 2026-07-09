'use strict';

/**
 * Verify evidence-only generate-on-miss against a real scan's persisted
 * evidence — no HTTP, no auth token. Exercises the exact generator + DB INSERT
 * the endpoint runs, so a schema mismatch (e.g. a NOT NULL column) surfaces
 * here with a full stack.
 *
 * Run in the backend shell (DATABASE_URL is set), on the deployed branch:
 *   node scripts/verify-generate.js 897
 *   node scripts/verify-generate.js 896
 *
 * Idempotent: if the scan already has rows it reports alreadyExisted and writes
 * nothing (same guard the endpoint uses).
 */

const db = require('../db/database');
const { generateAndPersist } = require('../services/findingsGenerator');
const { mapRecommendationToFinding } = require('../services/richFindingsMapper');

const SAMPLE_SQL = `
  SELECT id, category, subfactor_key, priority, estimated_effort,
         recommendation_text, findings, why_it_matters, action_steps,
         (evidence_json->>'gap')::numeric AS gap
    FROM scan_recommendations
   WHERE scan_id = $1
   ORDER BY id
   LIMIT 4
`;

(async () => {
  const scanId = parseInt(process.argv[2], 10);
  if (!Number.isFinite(scanId)) {
    console.error('usage: node scripts/verify-generate.js <scanId>');
    process.exit(1);
  }
  try {
    const { rows } = await db.query(
      `SELECT id, url, domain, domain_type, organization_id, industry, detailed_analysis
         FROM scans WHERE id = $1`,
      [scanId]
    );
    if (!rows.length) { console.error('scan not found:', scanId); process.exit(1); }

    const s = rows[0];
    let da = s.detailed_analysis;
    if (typeof da === 'string') { try { da = JSON.parse(da); } catch (_) { da = null; } }
    const scanEvidence = da && (da.scanEvidence || da.scan_evidence);
    console.log(`scan ${scanId}: scanEvidence present=${!!scanEvidence}` +
      (scanEvidence ? ` | keys: [${Object.keys(scanEvidence).join(', ')}]` : ''));
    if (!scanEvidence) { console.log('no scanEvidence — nothing to generate'); process.exit(0); }

    const before = await db.query('SELECT count(*)::int AS c FROM scan_recommendations WHERE scan_id=$1', [scanId]);
    console.log('rows before:', before.rows[0].c);

    const scan = {
      id: scanId,
      url: scanEvidence.url || s.url || null,
      domain: s.domain || s.url || null,
      domain_type: s.domain_type || null,
      organization_id: s.organization_id || null,
    };
    const industry = s.industry || (da && da.industry) || null;

    const result = await generateAndPersist({ scanId, scan, scanEvidence, industry });
    console.log('generateAndPersist:', JSON.stringify(result));

    const after = await db.query(
      "SELECT count(*)::int AS c, array_agg(DISTINCT priority) AS p FROM scan_recommendations WHERE scan_id=$1",
      [scanId]
    );
    console.log('rows after :', after.rows[0].c, '| priorities:', after.rows[0].p);

    const sample = await db.query(SAMPLE_SQL, [scanId]);
    console.log('sample mapped cards:');
    sample.rows.map(mapRecommendationToFinding).forEach(c =>
      console.log(`  ${String(c.severity).padEnd(9)} +${c.score_gain}p  ${String(c.difficulty).padEnd(9)} ${String(c.status || '(none)').padEnd(18)} | ${c.title}`)
    );
    const anyPer100 = sample.rows.some(r => /\b\d{1,3}\/100\b/.test(JSON.stringify(r)));
    console.log('any raw /100 in sample rows:', anyPer100 ? 'YES (bug)' : 'no');
  } catch (e) {
    console.error('VERIFY ERROR:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode || 0);
  }
})();
