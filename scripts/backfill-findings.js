#!/usr/bin/env node

/**
 * backfill-findings.js — One-time script that backfills the `findings` table
 * from historical completed scans by parsing `scans.scan_data`.
 *
 * Standalone: extraction logic is embedded; no application services are
 * imported. Not part of server startup.
 *
 * Usage:
 *   DRY_RUN=true node scripts/backfill-findings.js   # preview, no writes
 *   node scripts/backfill-findings.js                 # live insert
 *
 * Requires DATABASE_URL.
 */

const path = require('path');

// `pg` and `dotenv` are installed under backend/node_modules in this monorepo.
// Reuse the backend's already-configured pool so this script works regardless
// of where node is invoked from.
const db = require(path.join(__dirname, '..', 'backend', 'db', 'database'));
const pool = db.pool;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 50;
const SAMPLE_SIZE = 3;

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Mappings (per spec)
// ---------------------------------------------------------------------------
const KNOWN_PILLARS = new Set([
  'schema', 'entities', 'faqs', 'citations',
  'crawlability', 'speed', 'trust', 'aeo'
]);

// Category (as found inside scan_data.scores) → pillar name
const CATEGORY_TO_PILLAR = {
  aiReadability:           'aeo',
  aiReadabilityMultimodal: 'aeo',
  aiSearchReadiness:       'faqs',
  contentFreshness:        'citations',
  contentStructure:        'entities',
  speedUX:                 'speed',
  technicalSetup:          'crawlability',
  trustAuthority:          'trust',
  voiceOptimization:       'aeo'
};

const CATEGORY_DISPLAY = {
  aiReadability:           'AI Readability',
  aiReadabilityMultimodal: 'AI Readability',
  aiSearchReadiness:       'AI Search Readiness',
  contentFreshness:        'Content Freshness',
  contentStructure:        'Content Structure',
  speedUX:                 'Speed & UX',
  technicalSetup:          'Technical Setup',
  trustAuthority:          'Trust & Authority',
  voiceOptimization:       'Voice Optimization'
};

// Pillar → suggested_pack_type (per spec)
const PILLAR_TO_PACK = {
  schema:        'schema_pack',
  faqs:          'faq_pack',
  trust:         'evidence_trust',
  entities:      'entity_clarity',
  citations:     'quick_wins',
  speed:         'quick_wins',
  crawlability:  'quick_wins',
  aeo:           'quick_wins',
  other:         'quick_wins'
};

// ---------------------------------------------------------------------------
// Counters (mutated by extraction, surfaced in summary)
// ---------------------------------------------------------------------------
let otherPillarCount = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function severityFromScore(score) {
  if (score == null || isNaN(score)) return 'critical';
  if (score <= 40) return 'critical';
  if (score <= 60) return 'high';
  if (score <= 80) return 'medium';
  return 'low';
}

function severityForFinding({ subfactorScore, pillarScore, scanScore }) {
  const score =
    (typeof subfactorScore === 'number' ? subfactorScore : null) ??
    (typeof pillarScore    === 'number' ? pillarScore    : null) ??
    (typeof scanScore      === 'number' ? scanScore      : null);
  return severityFromScore(score);
}

function severityBlurb(sev) {
  switch (sev) {
    case 'critical': return 'This area needs urgent attention.';
    case 'high':     return 'Significant improvement opportunity.';
    case 'medium':   return 'Moderate improvement recommended.';
    case 'low':      return 'Minor refinement possible.';
    default:         return '';
  }
}

function resolvePillar(rawPillar, scanId, contextKey) {
  if (rawPillar && KNOWN_PILLARS.has(rawPillar)) return rawPillar;
  otherPillarCount++;
  console.warn(`  WARN: unknown pillar "${rawPillar}" for scan ${scanId} (${contextKey}); using 'other'`);
  return 'other';
}

function packForPillar(pillar) {
  return PILLAR_TO_PACK[pillar] || PILLAR_TO_PACK.other;
}

function parseJsonb(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Extraction — routes to the right shape-specific extractor based on which
// JSONB blob is present on the scan row. Supports two shapes:
//   1. scan_data         { url?, scores: {...}, metrics: {...} }   (legacy)
//   2. detailed_analysis { categoryBreakdown, scanEvidence: {...} } (modern)
// ---------------------------------------------------------------------------
function extractFindings(scan) {
  const findings = [];
  const scanScore = (typeof scan.total_score === 'number') ? scan.total_score : null;

  const sd = ('scan_data' in scan) ? parseJsonb(scan.scan_data) : null;
  const da = ('detailed_analysis' in scan) ? parseJsonb(scan.detailed_analysis) : null;

  if (sd && typeof sd === 'object' && (sd.scores || sd.metrics)) {
    extractFromScanData(scan, sd, scanScore, findings);
  } else if (da && typeof da === 'object') {
    extractFromDetailedAnalysis(scan, da, scanScore, findings);
  } else if (sd && typeof sd === 'object') {
    // scan_data present but doesn't match expected shape — try detailed_analysis fallback
    if (da) extractFromDetailedAnalysis(scan, da, scanScore, findings);
  }
  return findings;
}

function extractFromScanData(scan, sd, scanScore, findings) {
  const url = sd.url || scan.url || null;
  const urls = url ? [url] : [];

  const scores = (sd.scores && typeof sd.scores === 'object') ? sd.scores : {};
  const metrics = (sd.metrics && typeof sd.metrics === 'object') ? sd.metrics : {};

  // Resolve a pillar score (used as fallback for subfactor severity)
  const pillarScores = {};
  for (const [cat, score] of Object.entries(scores)) {
    if (typeof score !== 'number') continue;
    const pillar = CATEGORY_TO_PILLAR[cat];
    if (!pillar) continue;
    if (pillarScores[pillar] == null || score < pillarScores[pillar]) {
      pillarScores[pillar] = score;
    }
  }

  // -- PILLAR-LEVEL findings: one per scored category that signals an issue
  for (const [cat, rawScore] of Object.entries(scores)) {
    if (typeof rawScore !== 'number') continue;
    if (rawScore >= 81) continue; // not an issue
    const pillar = resolvePillar(CATEGORY_TO_PILLAR[cat], scan.id, `scores.${cat}`);
    const score = Math.round(rawScore);
    const severity = severityForFinding({ subfactorScore: score, pillarScore: score, scanScore });
    const display = CATEGORY_DISPLAY[cat] || cat;

    findings.push({
      scan_id:      scan.id,
      pillar,
      subfactor_key: cat,
      severity,
      title:        `${display}: Score ${score}/100`,
      description:  `The ${display} pillar scored ${score}/100. ${severityBlurb(severity)}`,
      impacted_urls: urls,
      evidence_data: { level: 'pillar', category: cat, score, source: 'scan_data.scores' },
      suggested_pack_type: packForPillar(pillar)
    });
  }

  // -- SUBFACTOR-LEVEL findings: derived from metrics flags
  const sub = (key, pillar, parentCategoryForScore, title, description, evidence) => {
    const resolved = resolvePillar(pillar, scan.id, `metrics.${key}`);
    const subSeverity = severityForFinding({
      subfactorScore: null,
      pillarScore: pillarScores[resolved],
      scanScore
    });
    findings.push({
      scan_id:      scan.id,
      pillar:       resolved,
      subfactor_key: key,
      severity:     subSeverity,
      title,
      description,
      impacted_urls: urls,
      evidence_data: { level: 'subfactor', source: 'scan_data.metrics', ...evidence },
      suggested_pack_type: packForPillar(resolved)
    });
  };

  if (metrics.hasOrganizationSchema === false) {
    sub('organization_schema_missing', 'schema', 'technicalSetup',
      'Missing Organization Schema',
      'No Organization JSON-LD detected. Adding it helps AI engines understand brand identity.',
      { signal: 'hasOrganizationSchema', value: false });
  }
  if (metrics.hasArticleSchema === false) {
    sub('article_schema_missing', 'schema', 'technicalSetup',
      'Missing Article Schema',
      'No Article JSON-LD detected. Article schema helps AI engines parse authored content.',
      { signal: 'hasArticleSchema', value: false });
  }
  if (metrics.hasFAQSchema === false) {
    sub('faq_schema_missing', 'schema', 'aiSearchReadiness',
      'Missing FAQ Schema',
      'No FAQPage JSON-LD detected. FAQ schema improves visibility in AI-generated answers.',
      { signal: 'hasFAQSchema', value: false });
  }
  if (metrics.hasBreadcrumbSchema === false) {
    sub('breadcrumb_schema_missing', 'schema', 'technicalSetup',
      'Missing Breadcrumb Schema',
      'No BreadcrumbList JSON-LD detected. Breadcrumbs help AI understand site hierarchy.',
      { signal: 'hasBreadcrumbSchema', value: false });
  }
  if (metrics.hasSitemap === false) {
    sub('sitemap_missing', 'crawlability', 'technicalSetup',
      'No Sitemap Detected',
      'No XML sitemap was found. Sitemaps help AI crawlers discover and index all pages.',
      { signal: 'hasSitemap', value: false });
  }
  if (metrics.robotsTxtFound === false) {
    sub('robots_txt_missing', 'crawlability', 'technicalSetup',
      'No robots.txt Found',
      'No robots.txt file detected. A robots.txt helps guide AI crawlers to important content.',
      { signal: 'robotsTxtFound', value: false });
  }
  if (metrics.hasCanonical === false) {
    sub('canonical_missing', 'crawlability', 'technicalSetup',
      'Missing Canonical Tag',
      'No canonical link tag detected. Canonicals prevent duplicate content issues for AI indexing.',
      { signal: 'hasCanonical', value: false });
  }
  if (metrics.hasOpenGraph === false) {
    sub('open_graph_missing', 'crawlability', 'technicalSetup',
      'Missing Open Graph Tags',
      'No Open Graph meta tags detected. OG tags improve content representation in AI platforms.',
      { signal: 'hasOpenGraph', value: false });
  }
  if (metrics.faqCount != null && metrics.faqCount === 0) {
    sub('no_faq_content', 'faqs', 'aiSearchReadiness',
      'No FAQ Content Found',
      'No FAQ question-answer pairs detected on the page. FAQ content is highly cited by AI engines.',
      { faqCount: 0 });
  }
  if (metrics.h1Count != null && metrics.h1Count === 0) {
    sub('missing_h1', 'entities', 'contentStructure',
      'No H1 Heading Found',
      'No H1 tag detected. A clear H1 anchors the page topic for AI comprehension.',
      { h1Count: 0 });
  }
  if (metrics.h2Count != null && metrics.h2Count === 0) {
    sub('missing_h2', 'entities', 'contentStructure',
      'No H2 Headings Found',
      'No H2 subheadings detected. H2s provide topical structure that AI engines rely on.',
      { h2Count: 0 });
  }
  if (metrics.hasNav === false || metrics.hasSemanticNav === false) {
    sub('no_semantic_nav', 'entities', 'contentStructure',
      'No Semantic Navigation',
      'No <nav> element detected. Semantic navigation helps AI map site structure.',
      { hasNav: metrics.hasNav, hasSemanticNav: metrics.hasSemanticNav });
  }
  if (typeof metrics.wordCount === 'number' && metrics.wordCount < 300) {
    sub('thin_content', 'aeo', 'aiReadabilityMultimodal',
      'Thin Content Detected',
      `Page has only ${metrics.wordCount} words. AI engines favour pages with 800+ words of substantive content.`,
      { wordCount: metrics.wordCount });
  }
  if (metrics.hasBlogUrl === false) {
    sub('no_blog_section', 'citations', 'contentFreshness',
      'No Blog Section Discovered',
      'No blog or news section found. Regular content publishing signals freshness to AI engines.',
      { hasBlogUrl: false });
  }
}

// Modern shape: detailed_analysis = { categoryBreakdown: {...}, scanEvidence: {...} }
function extractFromDetailedAnalysis(scan, da, scanScore, findings) {
  const url = da.url || scan.url || null;
  const urls = url ? [url] : [];
  const breakdown = (da.categoryBreakdown && typeof da.categoryBreakdown === 'object') ? da.categoryBreakdown : {};
  const evidence  = (da.scanEvidence && typeof da.scanEvidence === 'object') ? da.scanEvidence : {};
  const tech      = evidence.technical  || {};
  const content   = evidence.content    || {};
  const structure = evidence.structure  || {};
  const nav       = evidence.navigation || {};
  const crawler   = evidence.crawler    || {};

  // Pillar score lookup for severity fallback
  const pillarScores = {};
  for (const [cat, score] of Object.entries(breakdown)) {
    if (typeof score !== 'number') continue;
    const pillar = CATEGORY_TO_PILLAR[cat];
    if (!pillar) continue;
    if (pillarScores[pillar] == null || score < pillarScores[pillar]) {
      pillarScores[pillar] = score;
    }
  }

  // Pillar-level findings
  for (const [cat, rawScore] of Object.entries(breakdown)) {
    if (typeof rawScore !== 'number') continue;
    if (rawScore >= 81) continue;
    const pillar = resolvePillar(CATEGORY_TO_PILLAR[cat], scan.id, `categoryBreakdown.${cat}`);
    const score = Math.round(rawScore);
    const severity = severityForFinding({ subfactorScore: score, pillarScore: score, scanScore });
    const display = CATEGORY_DISPLAY[cat] || cat;
    findings.push({
      scan_id:       scan.id,
      pillar,
      subfactor_key: cat,
      severity,
      title:         `${display}: Score ${score}/100`,
      description:   `The ${display} pillar scored ${score}/100. ${severityBlurb(severity)}`,
      impacted_urls: urls,
      evidence_data: { level: 'pillar', category: cat, score, source: 'detailed_analysis.categoryBreakdown' },
      suggested_pack_type: packForPillar(pillar)
    });
  }

  const sub = (key, pillar, parentCat, title, description, evidenceBlob) => {
    const resolved = resolvePillar(pillar, scan.id, `scanEvidence.${key}`);
    const severity = severityForFinding({
      subfactorScore: null,
      pillarScore: pillarScores[resolved],
      scanScore
    });
    findings.push({
      scan_id:       scan.id,
      pillar:        resolved,
      subfactor_key: key,
      severity,
      title,
      description,
      impacted_urls: urls,
      evidence_data: { level: 'subfactor', source: 'detailed_analysis.scanEvidence', ...evidenceBlob },
      suggested_pack_type: packForPillar(resolved)
    });
  };

  if (tech.hasOrganizationSchema === false) {
    sub('organization_schema_missing', 'schema', 'technicalSetup',
      'Missing Organization Schema',
      'No Organization JSON-LD detected. Adding it helps AI engines understand brand identity.',
      { signal: 'hasOrganizationSchema', value: false });
  }
  if (tech.hasArticleSchema === false) {
    sub('article_schema_missing', 'schema', 'technicalSetup',
      'Missing Article Schema',
      'No Article JSON-LD detected. Article schema helps AI engines parse authored content.',
      { signal: 'hasArticleSchema', value: false });
  }
  if (tech.hasFAQSchema === false) {
    sub('faq_schema_missing', 'schema', 'aiSearchReadiness',
      'Missing FAQ Schema',
      'No FAQPage JSON-LD detected. FAQ schema improves visibility in AI-generated answers.',
      { signal: 'hasFAQSchema', value: false });
  }
  if (tech.hasBreadcrumbSchema === false) {
    sub('breadcrumb_schema_missing', 'schema', 'technicalSetup',
      'Missing Breadcrumb Schema',
      'No BreadcrumbList JSON-LD detected. Breadcrumbs help AI understand site hierarchy.',
      { signal: 'hasBreadcrumbSchema', value: false });
  }
  if (tech.hasSitemap === false && tech.sitemapDetected !== true) {
    sub('sitemap_missing', 'crawlability', 'technicalSetup',
      'No Sitemap Detected',
      'No XML sitemap was found. Sitemaps help AI crawlers discover and index all pages.',
      { signal: 'hasSitemap', value: false });
  }
  if (tech.robotsTxtFound === false) {
    sub('robots_txt_missing', 'crawlability', 'technicalSetup',
      'No robots.txt Found',
      'No robots.txt file detected. A robots.txt helps guide AI crawlers to important content.',
      { signal: 'robotsTxtFound', value: false });
  }
  if (tech.hasCanonical === false) {
    sub('canonical_missing', 'crawlability', 'technicalSetup',
      'Missing Canonical Tag',
      'No canonical link tag detected. Canonicals prevent duplicate content issues for AI indexing.',
      { signal: 'hasCanonical', value: false });
  }
  if (tech.hasOpenGraph === false) {
    sub('open_graph_missing', 'crawlability', 'technicalSetup',
      'Missing Open Graph Tags',
      'No Open Graph meta tags detected. OG tags improve content representation in AI platforms.',
      { signal: 'hasOpenGraph', value: false });
  }
  const faqs = Array.isArray(content.faqs) ? content.faqs : [];
  if (faqs.length === 0) {
    sub('no_faq_content', 'faqs', 'aiSearchReadiness',
      'No FAQ Content Found',
      'No FAQ question-answer pairs detected on the page. FAQ content is highly cited by AI engines.',
      { faqCount: 0 });
  }
  const headings = content.headings || {};
  const h1s = Array.isArray(headings.h1) ? headings.h1 : [];
  const h2s = Array.isArray(headings.h2) ? headings.h2 : [];
  if (h1s.length === 0) {
    sub('missing_h1', 'entities', 'contentStructure',
      'No H1 Heading Found',
      'No H1 tag detected. A clear H1 anchors the page topic for AI comprehension.',
      { h1Count: 0 });
  }
  if (h2s.length === 0) {
    sub('missing_h2', 'entities', 'contentStructure',
      'No H2 Headings Found',
      'No H2 subheadings detected. H2s provide topical structure that AI engines rely on.',
      { h2Count: 0 });
  }
  if (structure.hasNav === false && nav.hasSemanticNav !== true) {
    sub('no_semantic_nav', 'entities', 'contentStructure',
      'No Semantic Navigation',
      'No <nav> element detected. Semantic navigation helps AI map site structure.',
      { hasNav: structure.hasNav, hasSemanticNav: nav.hasSemanticNav });
  }
  if (typeof content.wordCount === 'number' && content.wordCount < 300) {
    sub('thin_content', 'aeo', 'aiReadability',
      'Thin Content Detected',
      `Page has only ${content.wordCount} words. AI engines favour pages with 800+ words of substantive content.`,
      { wordCount: content.wordCount });
  }
  const sections = (crawler.discoveredSections && typeof crawler.discoveredSections === 'object') ? crawler.discoveredSections : {};
  if (sections.hasBlogUrl === false) {
    sub('no_blog_section', 'citations', 'contentFreshness',
      'No Blog Section Discovered',
      'No blog or news section found. Regular content publishing signals freshness to AI engines.',
      { hasBlogUrl: false });
  }
}

// ---------------------------------------------------------------------------
// PHASE 1 — Discovery
// ---------------------------------------------------------------------------
async function runDiscovery() {
  console.log('='.repeat(70));
  console.log('PHASE 1: DISCOVERY');
  console.log('='.repeat(70));

  // A) distinct statuses
  const statusRes = await pool.query('SELECT DISTINCT status FROM scans ORDER BY status');
  const statuses = statusRes.rows.map(r => r.status);
  console.log('\n[A] Distinct scan statuses:', statuses);

  let completedStatus = null;
  if (statuses.includes('completed')) completedStatus = 'completed';
  else if (statuses.includes('complete')) completedStatus = 'complete';
  else if (statuses.includes('done')) completedStatus = 'done';
  else if (statuses.includes('success')) completedStatus = 'success';

  if (!completedStatus) {
    console.error(`\nERROR: Could not auto-detect a "completed" status from: ${JSON.stringify(statuses)}`);
    console.error('Edit COMPLETED_STATUS in this script and re-run.');
    process.exit(1);
  }
  console.log(`[A] Using completedStatus = "${completedStatus}"\n`);

  // A.5) Detect which JSONB source columns exist on `scans`.
  const colsRes = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name   = 'scans'
        AND column_name IN ('scan_data', 'detailed_analysis')`
  );
  const presentCols = colsRes.rows.map(r => r.column_name);
  console.log('[A.5] JSONB source columns present on scans:', presentCols);
  if (presentCols.length === 0) {
    console.error('ERROR: Neither scan_data nor detailed_analysis exist on the scans table. Cannot extract findings.');
    process.exit(1);
  }
  const projection = ['id', 'url', 'total_score', ...presentCols].join(', ');

  // B) sample 3 scans — log the actual JSONB shape
  const sampleRes = await pool.query(
    `SELECT ${projection}
       FROM scans
      WHERE status = $1
      ORDER BY id ASC
      LIMIT $2`,
    [completedStatus, SAMPLE_SIZE]
  );

  console.log(`[B] Sample of ${sampleRes.rows.length} completed scans (id, ${presentCols.join(', ')}):\n`);
  for (const row of sampleRes.rows) {
    console.log(`  --- scan id=${row.id} ---`);
    for (const col of presentCols) {
      if (row[col] == null) {
        console.log(`    ${col}: NULL`);
        continue;
      }
      const parsed = parseJsonb(row[col]);
      if (parsed && typeof parsed === 'object') {
        console.log(`    ${col} top-level keys:`, Object.keys(parsed));
        if (parsed.scores)            console.log(`    ${col}.scores:`, JSON.stringify(parsed.scores));
        if (parsed.metrics)           console.log(`    ${col}.metrics keys:`, Object.keys(parsed.metrics));
        if (parsed.categoryBreakdown) console.log(`    ${col}.categoryBreakdown:`, JSON.stringify(parsed.categoryBreakdown));
        if (parsed.scanEvidence)      console.log(`    ${col}.scanEvidence keys:`, Object.keys(parsed.scanEvidence));
      }
      const preview = JSON.stringify(parsed).slice(0, 600);
      console.log(`    ${col} preview: ${preview}${preview.length >= 600 ? '…' : ''}`);
    }
    console.log();
  }

  const countRes = await pool.query(
    'SELECT count(*)::int AS total FROM scans WHERE status = $1',
    [completedStatus]
  );
  const totalScans = countRes.rows[0].total;
  console.log(`[Discovery] Total scans with status="${completedStatus}": ${totalScans}\n`);

  return { completedStatus, totalScans, presentCols };
}

// ---------------------------------------------------------------------------
// PHASE 2 — Backfill
// ---------------------------------------------------------------------------
async function runBackfill(completedStatus, totalScans, presentCols) {
  console.log('='.repeat(70));
  console.log(`PHASE 2: BACKFILL  ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE)'}`);
  console.log('='.repeat(70));

  const projection = ['id', 'url', 'total_score', ...presentCols].join(', ');
  let lastId = 0;
  let scansSeen = 0;
  let scansProcessed = 0;
  let scansSkipped = 0;
  let findingsCreated = 0;
  let errors = 0;
  const findingsPerScan = [];

  while (true) {
    const batchRes = await pool.query(
      `SELECT ${projection}
         FROM scans
        WHERE status = $1
          AND id > $2
        ORDER BY id ASC
        LIMIT $3`,
      [completedStatus, lastId, BATCH_SIZE]
    );
    if (batchRes.rows.length === 0) break;

    for (const scan of batchRes.rows) {
      lastId = scan.id;
      scansSeen++;

      // Idempotency
      const existsRes = await pool.query(
        'SELECT 1 FROM findings WHERE scan_id = $1 LIMIT 1',
        [scan.id]
      );
      if (existsRes.rows.length > 0) {
        console.log(`Skipping scan ${scan.id} (already backfilled)`);
        scansSkipped++;
        continue;
      }

      let findings;
      try {
        findings = extractFindings(scan);
      } catch (err) {
        errors++;
        console.error(`  ERROR extracting scan ${scan.id}: ${err.message}`);
        continue;
      }

      console.log(`Processing scan ${scansSeen} of ${totalScans} (id=${scan.id}) — ${DRY_RUN ? 'would create' : 'created'} ${findings.length} findings`);
      findingsPerScan.push(findings.length);

      if (findings.length === 0) {
        scansProcessed++;
        continue;
      }

      if (DRY_RUN) {
        for (const f of findings) {
          console.log(`    [DRY] ${f.severity.toUpperCase().padEnd(8)} ${f.pillar.padEnd(13)} ${f.subfactor_key.padEnd(32)} ${f.title}`);
        }
        scansProcessed++;
        continue;
      }

      // Per-scan transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const f of findings) {
          await client.query(
            `INSERT INTO findings
               (scan_id, pillar, subfactor_key, severity, title, description,
                impacted_urls, evidence_data, suggested_pack_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              f.scan_id,
              f.pillar,
              f.subfactor_key,
              f.severity,
              f.title,
              f.description,
              JSON.stringify(f.impacted_urls || []),
              JSON.stringify(f.evidence_data || {}),
              f.suggested_pack_type
            ]
          );
        }
        await client.query('COMMIT');
        findingsCreated += findings.length;
        scansProcessed++;
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        errors++;
        console.error(`  ERROR inserting findings for scan ${scan.id}: ${txErr.message}`);
      } finally {
        client.release();
      }
    }
  }

  // Summary
  const total = findingsPerScan.reduce((a, b) => a + b, 0);
  const min = findingsPerScan.length ? Math.min(...findingsPerScan) : 0;
  const max = findingsPerScan.length ? Math.max(...findingsPerScan) : 0;
  const avg = findingsPerScan.length ? (total / findingsPerScan.length).toFixed(1) : '0.0';

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Mode:                     ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Scans seen:               ${scansSeen}`);
  console.log(`  Scans processed:          ${scansProcessed}`);
  console.log(`  Scans skipped (existing): ${scansSkipped}`);
  console.log(`  Findings ${DRY_RUN ? 'previewed' : 'created '}:        ${DRY_RUN ? total : findingsCreated}`);
  console.log(`  Errors:                   ${errors}`);
  console.log(`  'other' pillar mappings:  ${otherPillarCount}`);
  if (findingsPerScan.length) {
    console.log(`  Findings per scan:        min=${min}  max=${max}  avg=${avg}`);
  }
  console.log('='.repeat(70));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nbackfill-findings.js ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'}\n`);
  try {
    const { completedStatus, totalScans, presentCols } = await runDiscovery();
    if (totalScans === 0) {
      console.log('No completed scans to process. Exiting.');
      return;
    }
    await runBackfill(completedStatus, totalScans, presentCols);
  } catch (err) {
    console.error('FATAL:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
