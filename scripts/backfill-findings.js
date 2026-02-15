#!/usr/bin/env node

/**
 * backfill-findings.js — One-time script to backfill the findings table
 * from historical completed scans.
 *
 * Usage:
 *   DRY_RUN=true node scripts/backfill-findings.js   # preview only
 *   node scripts/backfill-findings.js                 # live insert
 *
 * Requires DATABASE_URL env var (or defaults to local socket connection).
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'backend', 'db', 'database'));
const pool = db.pool;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Pillar + pack-type mappings
// ---------------------------------------------------------------------------
const CATEGORY_TO_PILLAR = {
  technicalSetup:     'crawlability',
  contentStructure:   'entities',
  aiSearchReadiness:  'faqs',
  trustAuthority:     'trust',
  speedUX:            'speed',
  voiceOptimization:  'aeo',
  aiReadability:      'aeo',
  contentFreshness:   'citations',
  // legacy key used in ai-testing route
  aiReadabilityMultimodal: 'aeo'
};

const PILLAR_TO_PACK = {
  schema:        'schema_pack',
  faqs:          'faq_pack',
  trust:         'evidence_trust',
  entities:      'entity_clarity',
  citations:     'citation_pack',
  speed:         'performance_pack',
  crawlability:  'technical_seo_pack',
  aeo:           'aeo_pack',
  other:         'quick_wins'
};

// Human-readable names for pillar-level findings
const CATEGORY_DISPLAY = {
  aiReadability:            'AI Readability',
  aiReadabilityMultimodal:  'AI Readability',
  aiSearchReadiness:        'AI Search Readiness',
  contentFreshness:         'Content Freshness',
  contentStructure:         'Content Structure',
  speedUX:                  'Speed & UX',
  technicalSetup:           'Technical Setup',
  trustAuthority:           'Trust & Authority',
  voiceOptimization:        'Voice Optimization'
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function severityFromScore(score) {
  if (score == null || score <= 40) return 'critical';
  if (score <= 60) return 'high';
  if (score <= 80) return 'medium';
  return 'low';
}

function pillarFor(key) {
  return CATEGORY_TO_PILLAR[key] || 'other';
}

function packFor(pillar) {
  return PILLAR_TO_PACK[pillar] || 'quick_wins';
}

// ---------------------------------------------------------------------------
// PHASE 1 — Discovery
// ---------------------------------------------------------------------------
async function runDiscovery() {
  console.log('='.repeat(70));
  console.log('PHASE 1: DISCOVERY');
  console.log('='.repeat(70));

  // A) Distinct statuses
  const statusRes = await pool.query('SELECT DISTINCT status FROM scans ORDER BY status');
  const statuses = statusRes.rows.map(r => r.status);
  console.log('\n[Discovery A] Distinct scan statuses:', statuses);

  const completedStatus = statuses.includes('completed') ? 'completed' : null;
  if (!completedStatus) {
    console.error('ERROR: No "completed" status found. Available:', statuses);
    process.exit(1);
  }
  console.log(`[Discovery A] Using status = "${completedStatus}" for backfill\n`);

  // B) Sample 3 scans — log data shape
  const sampleRes = await pool.query(
    `SELECT id, url, total_score, detailed_analysis, scan_data
     FROM scans WHERE status = $1 ORDER BY id ASC LIMIT 3`,
    [completedStatus]
  );

  console.log(`[Discovery B] Sample scans (${sampleRes.rows.length} rows):\n`);
  for (const row of sampleRes.rows) {
    const da = row.detailed_analysis;
    const sd = row.scan_data;
    const source = da ? 'detailed_analysis' : sd ? 'scan_data' : 'NONE';

    console.log(`  Scan id=${row.id}  url=${row.url}  source=${source}`);

    if (da) {
      const parsed = typeof da === 'string' ? JSON.parse(da) : da;
      console.log('    Top-level keys:', Object.keys(parsed));
      if (parsed.categoryBreakdown) {
        console.log('    categoryBreakdown:', JSON.stringify(parsed.categoryBreakdown));
      }
      if (parsed.scanEvidence) {
        console.log('    scanEvidence keys:', Object.keys(parsed.scanEvidence));
        if (parsed.scanEvidence.technical) {
          console.log('    scanEvidence.technical keys:', Object.keys(parsed.scanEvidence.technical));
        }
      }
    } else if (sd) {
      const parsed = typeof sd === 'string' ? JSON.parse(sd) : sd;
      console.log('    Top-level keys:', Object.keys(parsed));
      if (parsed.scores) console.log('    scores:', JSON.stringify(parsed.scores));
      if (parsed.metrics) console.log('    metrics keys:', Object.keys(parsed.metrics));
    }
    console.log();
  }

  // Count total completed
  const countRes = await pool.query(
    'SELECT count(*)::int AS total FROM scans WHERE status = $1',
    [completedStatus]
  );
  console.log(`[Discovery] Total completed scans to process: ${countRes.rows[0].total}\n`);

  return { completedStatus, totalScans: countRes.rows[0].total };
}

// ---------------------------------------------------------------------------
// PHASE 2 — Extraction logic
// ---------------------------------------------------------------------------

/**
 * Extract findings from a scan row.
 * Returns an array of finding objects ready for INSERT.
 */
function extractFindings(scan) {
  const findings = [];
  const da = scan.detailed_analysis;
  const sd = scan.scan_data;

  if (da) {
    const parsed = typeof da === 'string' ? JSON.parse(da) : da;
    extractFromDetailedAnalysis(scan, parsed, findings);
  } else if (sd) {
    const parsed = typeof sd === 'string' ? JSON.parse(sd) : sd;
    extractFromLegacyScanData(scan, parsed, findings);
  }

  return findings;
}

/**
 * Extract from modern detailed_analysis (V5 engine output).
 * Creates pillar-level findings from categoryBreakdown scores, plus
 * subfactor-level findings from scanEvidence signals.
 */
function extractFromDetailedAnalysis(scan, da, findings) {
  const url = da.url || scan.url;
  const breakdown = da.categoryBreakdown || {};
  const evidence = da.scanEvidence || {};
  const tech = evidence.technical || {};
  const content = evidence.content || {};
  const structure = evidence.structure || {};
  const nav = evidence.navigation || {};
  const crawler = evidence.crawler || {};

  // --- Pillar-level findings (one per category with score < 100) ---
  for (const [cat, score] of Object.entries(breakdown)) {
    if (typeof score !== 'number') continue;
    const pillar = pillarFor(cat);
    const severity = severityFromScore(score);
    const displayName = CATEGORY_DISPLAY[cat] || cat;

    findings.push({
      scan_id: scan.id,
      pillar,
      subfactor_key: cat,
      severity,
      title: `${displayName}: Score ${score}/100`,
      description: `The ${displayName} pillar scored ${score}/100. ${severityDescription(severity)}`,
      impacted_urls: [url],
      evidence_data: { score, pillar: cat, level: 'pillar' },
      suggested_pack_type: packFor(pillar)
    });
  }

  // --- Subfactor-level findings from scanEvidence ---

  // Schema / structured data signals
  if (!tech.hasOrganizationSchema) {
    findings.push(subfactorFinding(scan, 'schema', 'organization_schema_missing',
      breakdown.technicalSetup,
      'Missing Organization Schema',
      'No Organization JSON-LD detected. Adding it helps AI engines understand brand identity.',
      [url], { signal: 'hasOrganizationSchema', value: false }));
  }
  if (!tech.hasArticleSchema) {
    findings.push(subfactorFinding(scan, 'schema', 'article_schema_missing',
      breakdown.technicalSetup,
      'Missing Article Schema',
      'No Article JSON-LD detected. Article schema helps AI engines parse authored content.',
      [url], { signal: 'hasArticleSchema', value: false }));
  }
  if (!tech.hasFAQSchema) {
    findings.push(subfactorFinding(scan, 'schema', 'faq_schema_missing',
      breakdown.aiSearchReadiness,
      'Missing FAQ Schema',
      'No FAQPage JSON-LD detected. FAQ schema improves visibility in AI-generated answers.',
      [url], { signal: 'hasFAQSchema', value: false }));
  }
  if (!tech.hasBreadcrumbSchema) {
    findings.push(subfactorFinding(scan, 'schema', 'breadcrumb_schema_missing',
      breakdown.technicalSetup,
      'Missing Breadcrumb Schema',
      'No BreadcrumbList JSON-LD detected. Breadcrumbs help AI understand site hierarchy.',
      [url], { signal: 'hasBreadcrumbSchema', value: false }));
  }

  // Crawlability signals
  if (!tech.hasSitemap && !tech.sitemapDetected) {
    findings.push(subfactorFinding(scan, 'crawlability', 'sitemap_missing',
      breakdown.technicalSetup,
      'No Sitemap Detected',
      'No XML sitemap was found. Sitemaps help AI crawlers discover and index all pages.',
      [url], { signal: 'hasSitemap', value: false }));
  }
  if (!tech.robotsTxtFound) {
    findings.push(subfactorFinding(scan, 'crawlability', 'robots_txt_missing',
      breakdown.technicalSetup,
      'No robots.txt Found',
      'No robots.txt file detected. A robots.txt helps guide AI crawlers to important content.',
      [url], { signal: 'robotsTxtFound', value: false }));
  }
  if (!tech.hasCanonical) {
    findings.push(subfactorFinding(scan, 'crawlability', 'canonical_missing',
      breakdown.technicalSetup,
      'Missing Canonical Tag',
      'No canonical link tag detected. Canonicals prevent duplicate content issues for AI indexing.',
      [url], { signal: 'hasCanonical', value: false }));
  }
  if (!tech.hasOpenGraph) {
    findings.push(subfactorFinding(scan, 'crawlability', 'open_graph_missing',
      breakdown.technicalSetup,
      'Missing Open Graph Tags',
      'No Open Graph meta tags detected. OG tags improve content representation in AI platforms.',
      [url], { signal: 'hasOpenGraph', value: false }));
  }

  // FAQ / content signals
  const faqs = content.faqs || [];
  if (faqs.length === 0) {
    findings.push(subfactorFinding(scan, 'faqs', 'no_faq_content',
      breakdown.aiSearchReadiness,
      'No FAQ Content Found',
      'No FAQ question-answer pairs detected on the page. FAQ content is highly cited by AI engines.',
      [url], { faqCount: 0 }));
  }

  // Entity / structure signals
  const headings = content.headings || {};
  const h1s = headings.h1 || [];
  const h2s = headings.h2 || [];
  if (h1s.length === 0) {
    findings.push(subfactorFinding(scan, 'entities', 'missing_h1',
      breakdown.contentStructure,
      'No H1 Heading Found',
      'No H1 tag detected. A clear H1 anchors the page topic for AI comprehension.',
      [url], { h1Count: 0 }));
  }
  if (h2s.length === 0) {
    findings.push(subfactorFinding(scan, 'entities', 'missing_h2',
      breakdown.contentStructure,
      'No H2 Headings Found',
      'No H2 subheadings detected. H2s provide topical structure that AI engines rely on.',
      [url], { h2Count: 0 }));
  }
  if (!structure.hasNav && !nav.hasSemanticNav) {
    findings.push(subfactorFinding(scan, 'entities', 'no_semantic_nav',
      breakdown.contentStructure,
      'No Semantic Navigation',
      'No <nav> element detected. Semantic navigation helps AI map site structure.',
      [url], { hasNav: false, hasSemanticNav: false }));
  }

  // Content depth
  const wordCount = content.wordCount || 0;
  if (wordCount < 300) {
    findings.push(subfactorFinding(scan, 'aeo', 'thin_content',
      breakdown.aiReadability,
      'Thin Content Detected',
      `Page has only ${wordCount} words. AI engines favour pages with 800+ words of substantive content.`,
      [url], { wordCount }));
  }

  // Trust signals (no author bios/certs can't be detected from evidence alone,
  // but low trust score is already captured at pillar level)

  // Crawler discovered sections
  const sections = crawler.discoveredSections || {};
  if (!sections.hasBlogUrl) {
    findings.push(subfactorFinding(scan, 'citations', 'no_blog_section',
      breakdown.contentFreshness,
      'No Blog Section Discovered',
      'No blog or news section found. Regular content publishing signals freshness to AI engines.',
      [url], { hasBlogUrl: false }));
  }
}

/**
 * Extract from legacy scan_data (ai-testing route format).
 */
function extractFromLegacyScanData(scan, sd, findings) {
  const url = sd.url || scan.url;
  const scores = sd.scores || {};
  const metrics = sd.metrics || {};
  const analysis = sd.analysis || {};

  // Map legacy score keys to our category names
  const scoreMap = {
    aiReadabilityMultimodal: scores.aiReadabilityMultimodal,
    aiSearchReadiness:       scores.aiSearchReadiness,
    contentFreshness:        scores.contentFreshness,
    contentStructure:        scores.contentStructure,
    speedUX:                 scores.speedUX,
    technicalSetup:          scores.technicalSetup,
    trustAuthority:          scores.trustAuthority,
    voiceOptimization:       scores.voiceOptimization
  };

  // Pillar-level findings from scores
  for (const [cat, score] of Object.entries(scoreMap)) {
    if (score == null || typeof score !== 'number') continue;
    const pillar = pillarFor(cat);
    const severity = severityFromScore(score);
    const displayName = CATEGORY_DISPLAY[cat] || cat;

    findings.push({
      scan_id: scan.id,
      pillar,
      subfactor_key: cat,
      severity,
      title: `${displayName}: Score ${Math.round(score)}/100`,
      description: `The ${displayName} pillar scored ${Math.round(score)}/100. ${severityDescription(severity)}`,
      impacted_urls: [url],
      evidence_data: { score, pillar: cat, level: 'pillar', source: 'legacy' },
      suggested_pack_type: packFor(pillar)
    });
  }

  // Subfactor findings from metrics
  if (metrics.hasSitemap === false) {
    findings.push(subfactorFinding(scan, 'crawlability', 'sitemap_missing',
      scoreMap.technicalSetup, 'No Sitemap Detected',
      'No XML sitemap was found.', [url], { signal: 'hasSitemap', value: false }));
  }
  if (metrics.hasFAQSchema === false) {
    findings.push(subfactorFinding(scan, 'schema', 'faq_schema_missing',
      scoreMap.aiSearchReadiness, 'Missing FAQ Schema',
      'No FAQPage JSON-LD detected.', [url], { signal: 'hasFAQSchema', value: false }));
  }
  if (metrics.hasOrganizationSchema === false) {
    findings.push(subfactorFinding(scan, 'schema', 'organization_schema_missing',
      scoreMap.technicalSetup, 'Missing Organization Schema',
      'No Organization JSON-LD detected.', [url], { signal: 'hasOrganizationSchema', value: false }));
  }
  if (metrics.hasArticleSchema === false) {
    findings.push(subfactorFinding(scan, 'schema', 'article_schema_missing',
      scoreMap.technicalSetup, 'Missing Article Schema',
      'No Article JSON-LD detected.', [url], { signal: 'hasArticleSchema', value: false }));
  }
  if (metrics.hasCanonical === false) {
    findings.push(subfactorFinding(scan, 'crawlability', 'canonical_missing',
      scoreMap.technicalSetup, 'Missing Canonical Tag',
      'No canonical link tag detected.', [url], { signal: 'hasCanonical', value: false }));
  }
  if (metrics.hasOpenGraph === false) {
    findings.push(subfactorFinding(scan, 'crawlability', 'open_graph_missing',
      scoreMap.technicalSetup, 'Missing Open Graph Tags',
      'No Open Graph meta tags detected.', [url], { signal: 'hasOpenGraph', value: false }));
  }
  if ((metrics.faqCount || 0) === 0) {
    findings.push(subfactorFinding(scan, 'faqs', 'no_faq_content',
      scoreMap.aiSearchReadiness, 'No FAQ Content Found',
      'No FAQ question-answer pairs detected.', [url], { faqCount: 0 }));
  }
  if ((metrics.wordCount || 0) < 300) {
    findings.push(subfactorFinding(scan, 'aeo', 'thin_content',
      scoreMap.aiReadabilityMultimodal, 'Thin Content Detected',
      `Page has only ${metrics.wordCount || 0} words.`, [url], { wordCount: metrics.wordCount || 0 }));
  }
}

function subfactorFinding(scan, pillar, subfactorKey, parentScore, title, description, urls, evidenceData) {
  const severity = severityFromScore(parentScore);
  return {
    scan_id: scan.id,
    pillar: PILLAR_TO_PACK[pillar] ? pillar : 'other',
    subfactor_key: subfactorKey,
    severity,
    title,
    description,
    impacted_urls: urls || [],
    evidence_data: { ...evidenceData, level: 'subfactor' },
    suggested_pack_type: packFor(pillar)
  };
}

function severityDescription(sev) {
  switch (sev) {
    case 'critical': return 'This area needs urgent attention.';
    case 'high':     return 'Significant improvement opportunity.';
    case 'medium':   return 'Moderate improvement recommended.';
    case 'low':      return 'Minor refinement possible.';
    default:         return '';
  }
}

// ---------------------------------------------------------------------------
// PHASE 3 — Backfill execution
// ---------------------------------------------------------------------------
async function runBackfill(completedStatus, totalScans) {
  console.log('='.repeat(70));
  console.log(`PHASE 2: BACKFILL  ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE)'}`);
  console.log('='.repeat(70));

  let lastId = 0;
  let scansProcessed = 0;
  let scansSkipped = 0;
  let findingsCreated = 0;
  let errors = 0;
  const findingsDistribution = [];

  while (true) {
    const batchRes = await pool.query(
      `SELECT id, url, total_score, detailed_analysis, scan_data
       FROM scans
       WHERE status = $1 AND id > $2
       ORDER BY id ASC
       LIMIT $3`,
      [completedStatus, lastId, BATCH_SIZE]
    );

    if (batchRes.rows.length === 0) break;

    for (const scan of batchRes.rows) {
      lastId = scan.id;

      // Idempotency check
      const existsRes = await pool.query(
        'SELECT 1 FROM findings WHERE scan_id = $1 LIMIT 1',
        [scan.id]
      );
      if (existsRes.rows.length > 0) {
        console.log(`  Skipping scan ${scan.id} (already backfilled)`);
        scansSkipped++;
        continue;
      }

      try {
        const findings = extractFindings(scan);
        scansProcessed++;

        if (findings.length === 0) {
          console.log(`  Processing scan ${scansProcessed} of ${totalScans} (id=${scan.id}) — 0 findings (no extractable data)`);
          findingsDistribution.push(0);
          continue;
        }

        console.log(`  Processing scan ${scansProcessed} of ${totalScans} (id=${scan.id}) — created ${findings.length} findings`);
        findingsDistribution.push(findings.length);

        if (DRY_RUN) {
          for (const f of findings) {
            console.log(`    [DRY] ${f.severity.toUpperCase().padEnd(8)} ${f.pillar.padEnd(14)} ${f.subfactor_key.padEnd(30)} ${f.title}`);
          }
        } else {
          // Transaction per scan
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
                  f.scan_id, f.pillar, f.subfactor_key, f.severity,
                  f.title, f.description,
                  JSON.stringify(f.impacted_urls),
                  JSON.stringify(f.evidence_data),
                  f.suggested_pack_type
                ]
              );
            }
            await client.query('COMMIT');
            findingsCreated += findings.length;
          } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
          } finally {
            client.release();
          }
        }
      } catch (err) {
        errors++;
        console.error(`  ERROR processing scan ${scan.id}:`, err.message);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Mode:             ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Scans processed:  ${scansProcessed}`);
  console.log(`  Scans skipped:    ${scansSkipped}`);
  console.log(`  Findings created: ${DRY_RUN ? `${findingsDistribution.reduce((a, b) => a + b, 0)} (would create)` : findingsCreated}`);
  console.log(`  Errors:           ${errors}`);

  if (findingsDistribution.length > 0) {
    const min = Math.min(...findingsDistribution);
    const max = Math.max(...findingsDistribution);
    const avg = (findingsDistribution.reduce((a, b) => a + b, 0) / findingsDistribution.length).toFixed(1);
    console.log(`  Findings/scan:    min=${min}  max=${max}  avg=${avg}`);
    console.log(`  Distribution:     ${JSON.stringify(findingsDistribution)}`);
  }
  console.log('='.repeat(70));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nbackfill-findings.js  ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'}\n`);

  try {
    const { completedStatus, totalScans } = await runDiscovery();
    if (totalScans === 0) {
      console.log('No completed scans to process. Exiting.');
      return;
    }
    await runBackfill(completedStatus, totalScans);
  } catch (err) {
    console.error('FATAL:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
