#!/usr/bin/env node
/**
 * Golden Fixture Capture Script
 * Phase 4A.3 Step 0.0
 *
 * Captures recommendation API responses and generates fixture files
 * for regression testing.
 *
 * Usage:
 *   cd backend && node ../scripts/fixtures/capture-fixture.js --scan 123 --id my_fixture_id
 *   cd backend && node ../scripts/fixtures/capture-fixture.js --all --outDir ../tests/fixtures/golden
 *
 * Options:
 *   --scan         Scan ID to capture
 *   --id           Fixture identifier (e.g., 'viewer_free_multi_issue')
 *   --viewerUserId Optional: simulate viewing as different user
 *   --outDir       Output directory (default: tests/fixtures/golden)
 *   --all          Capture all configured fixtures
 *   --dry-run      Show what would be captured without writing files
 *
 * NOTE: Run this script from the backend directory to ensure proper module resolution.
 */

const fs = require('fs');
const path = require('path');

// Determine the backend directory (script may be called from different locations)
const BACKEND_DIR = path.resolve(__dirname, '../../backend');

// Add backend to module search path for proper resolution
module.paths.unshift(path.join(BACKEND_DIR, 'node_modules'));

// Load environment variables
try {
  require('dotenv').config({ path: path.join(BACKEND_DIR, '.env') });
} catch (e) {
  // dotenv may not be available if running from wrong directory
  console.log('Note: dotenv not loaded. Using environment variables only.');
}

// Import backend modules
let db, resolvePlanForRequest, getRecommendationVisibleLimit, getEntitlements, recommendationRepo;

try {
  db = require(path.join(BACKEND_DIR, 'db/database'));
  ({ resolvePlanForRequest } = require(path.join(BACKEND_DIR, 'services/planService')));
  ({ getRecommendationVisibleLimit, getEntitlements } = require(path.join(BACKEND_DIR, 'services/scanEntitlementService')));
  recommendationRepo = require(path.join(BACKEND_DIR, 'repositories/recommendationRepository'));
} catch (e) {
  console.error('Error loading backend modules:', e.message);
  console.error('\nMake sure to run this script from the repository root or backend directory:');
  console.error('  cd backend && node ../scripts/fixtures/capture-fixture.js --help');
  process.exit(1);
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_OUT_DIR = path.join(__dirname, '../../tests/fixtures/golden');

// PII patterns to redact
const PII_PATTERNS = [
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL_REDACTED]' },
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, replacement: 'Bearer [TOKEN_REDACTED]' },
  { pattern: /"password"\s*:\s*"[^"]*"/g, replacement: '"password": "[REDACTED]"' },
  { pattern: /"token"\s*:\s*"[^"]*"/g, replacement: '"token": "[REDACTED]"' },
  { pattern: /"secret"\s*:\s*"[^"]*"/g, replacement: '"secret": "[REDACTED]"' },
  { pattern: /"api_key"\s*:\s*"[^"]*"/gi, replacement: '"api_key": "[REDACTED]"' },
  // Phone numbers (US format)
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, replacement: '[PHONE_REDACTED]' },
  // SSN
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN_REDACTED]' }
];

// Required sections in recommendations
const REQUIRED_SECTIONS = [
  'finding',
  'why_it_matters',
  'recommendation',
  'what_to_include',
  'how_to_implement'
];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    scan: null,
    id: null,
    viewerUserId: null,
    outDir: DEFAULT_OUT_DIR,
    all: false,
    dryRun: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--scan':
        parsed.scan = parseInt(nextArg, 10);
        i++;
        break;
      case '--id':
        parsed.id = nextArg;
        i++;
        break;
      case '--viewerUserId':
        parsed.viewerUserId = parseInt(nextArg, 10);
        i++;
        break;
      case '--outDir':
        parsed.outDir = nextArg;
        i++;
        break;
      case '--all':
        parsed.all = true;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--help':
      case '-h':
        console.log(`
Golden Fixture Capture Script

Usage:
  node capture-fixture.js --scan <ID> --id <fixture_id> [options]
  node capture-fixture.js --all [options]

Options:
  --scan         Scan ID to capture
  --id           Fixture identifier
  --viewerUserId Simulate viewing as different user
  --outDir       Output directory (default: tests/fixtures/golden)
  --all          Capture all configured fixtures
  --dry-run      Show what would be captured without writing files
  --help         Show this help message
`);
        process.exit(0);
    }
  }

  return parsed;
}

/**
 * Redact PII from a string or object
 */
function redactPII(data) {
  if (typeof data === 'string') {
    let result = data;
    for (const { pattern, replacement } of PII_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  if (Array.isArray(data)) {
    return data.map(item => redactPII(item));
  }

  if (data && typeof data === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      // Skip known PII fields entirely
      if (['email', 'password', 'token', 'api_key', 'secret', 'phone', 'address'].includes(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactPII(value);
      }
    }
    return result;
  }

  return data;
}

/**
 * Count unresolved placeholders in text
 */
function countUnresolvedPlaceholders(text) {
  if (typeof text !== 'string') return 0;
  const matches = text.match(/\{\{[^}]+\}\}/g);
  return matches ? matches.length : 0;
}

/**
 * Count total unresolved placeholders in recommendations
 */
function countAllUnresolvedPlaceholders(recommendations) {
  let total = 0;

  for (const rec of recommendations) {
    // Check common text fields
    const textFields = [
      rec.recommendation_text,
      rec.why_it_matters,
      rec.what_to_do,
      rec.how_to_do,
      rec.marketing_copy,
      rec.technical_copy,
      rec.exec_copy,
      rec.title
    ];

    for (const field of textFields) {
      total += countUnresolvedPlaceholders(field);
    }

    // Check action items if present
    if (rec.action_steps && Array.isArray(rec.action_steps)) {
      for (const step of rec.action_steps) {
        total += countUnresolvedPlaceholders(step);
      }
    }
  }

  return total;
}

/**
 * Detect which sections are present in recommendations
 */
function detectSectionsPresent(recommendations) {
  const sections = {
    finding: false,
    why_it_matters: false,
    recommendation: false,
    what_to_include: false,
    how_to_implement: false
  };

  for (const rec of recommendations) {
    if (rec.title || rec.category) sections.finding = true;
    if (rec.why_it_matters) sections.why_it_matters = true;
    if (rec.recommendation_text || rec.marketing_copy) sections.recommendation = true;
    if (rec.what_to_do) sections.what_to_include = true;
    if (rec.how_to_do || rec.action_steps) sections.how_to_implement = true;
  }

  return sections;
}

/**
 * Extract top N rec_keys from recommendations
 */
function extractTopRecKeys(recommendations, n = 5) {
  return recommendations
    .slice(0, n)
    .map(rec => rec.pillar_key || rec.category || `rec_${rec.id}`)
    .filter(Boolean);
}

/**
 * Extract evidence structure from first recommendation with evidence
 */
function extractEvidenceStructure(recommendations) {
  const result = {};

  for (const rec of recommendations) {
    const evidence = rec.evidence || rec.evidence_json;
    if (evidence && typeof evidence === 'object') {
      const key = rec.pillar_key || rec.category || `rec_${rec.id}`;
      result[key] = {
        requires: ['detection_state', 'pages_checked', 'source_urls'],
        present: Object.keys(evidence).filter(k => evidence[k] !== null && evidence[k] !== undefined)
      };
      break; // Just get first one for structure check
    }
  }

  return result;
}

// ============================================================================
// CORE CAPTURE LOGIC
// ============================================================================

/**
 * Fetch scan data from database
 */
async function fetchScanData(scanId) {
  const { rows } = await db.query(`
    SELECT
      s.id,
      s.url,
      s.status,
      s.total_score,
      s.industry,
      s.user_id,
      s.created_at,
      s.completed_at,
      u.organization_id,
      COALESCE(
        REGEXP_REPLACE(s.url, '^https?://([^/]+).*$', '\\1'),
        'unknown'
      ) AS domain
    FROM scans s
    LEFT JOIN users u ON s.user_id = u.id
    WHERE s.id = $1
  `, [scanId]);

  if (rows.length === 0) {
    throw new Error(`Scan ${scanId} not found`);
  }

  return rows[0];
}

/**
 * Fetch user plan context
 */
async function fetchUserPlanContext(userId, orgId) {
  const planResolution = await resolvePlanForRequest({ userId, orgId });
  const visibleLimit = getRecommendationVisibleLimit(planResolution.plan);
  const entitlements = getEntitlements(planResolution.plan);

  return {
    effectivePlan: planResolution.plan,
    planSource: planResolution.source,
    visibleLimit,
    entitlements
  };
}

/**
 * Fetch recommendations (mimics API endpoint logic)
 */
async function fetchRecommendations(scanId, viewerUserId, orgId) {
  // Get plan context for the viewer
  const planContext = await fetchUserPlanContext(viewerUserId, orgId);

  // Fetch all recommendations for the scan
  const result = await recommendationRepo.getByScanId(scanId, { limit: 200 });
  let recommendations = result.recommendations;

  // Apply entitlement cap (same logic as API endpoint)
  const cap = planContext.visibleLimit;
  if (cap !== -1 && recommendations.length > cap) {
    console.log(`  Capping recommendations: ${recommendations.length} → ${cap} (plan: ${planContext.effectivePlan})`);
    recommendations = recommendations.slice(0, cap);
  }

  return {
    recommendations,
    totalCandidates: result.returned_count,
    cappedTo: cap,
    planContext
  };
}

/**
 * Count total recommendations in DB for a scan
 */
async function countTotalCandidates(scanId) {
  const { rows } = await db.query(`
    SELECT COUNT(*) as count
    FROM scan_recommendations
    WHERE scan_id = $1
  `, [scanId]);

  return parseInt(rows[0].count, 10);
}

/**
 * Capture a single fixture
 */
async function captureFixture(scanId, fixtureId, viewerUserId, outDir, dryRun = false) {
  console.log(`\nCapturing fixture: ${fixtureId} (scan: ${scanId})`);

  // 1. Fetch scan data
  const scanData = await fetchScanData(scanId);
  console.log(`  Scan: ${scanData.url} (score: ${scanData.total_score})`);

  // Use viewer user ID or fall back to scan owner
  const effectiveViewerUserId = viewerUserId || scanData.user_id;

  // 2. Fetch plan context for viewer
  const planContext = await fetchUserPlanContext(effectiveViewerUserId, scanData.organization_id);
  console.log(`  Viewer plan: ${planContext.effectivePlan} (source: ${planContext.planSource}, cap: ${planContext.visibleLimit})`);

  // 3. Fetch recommendations
  const recsResult = await fetchRecommendations(scanId, effectiveViewerUserId, scanData.organization_id);
  console.log(`  Recommendations: ${recsResult.recommendations.length} returned (${recsResult.totalCandidates} total candidates)`);

  // 4. Count total candidates in DB
  const totalCandidates = await countTotalCandidates(scanId);

  // 5. Build fixture files
  const capturedAt = new Date().toISOString();

  // metadata.json
  const metadata = redactPII({
    fixture_id: fixtureId,
    description: `Fixture for scan ${scanId} viewed by user with ${planContext.effectivePlan} plan`,
    captured_at: capturedAt,
    scan_id: scanId,
    source_scan_id: null, // Would be set if context reuse is involved
    viewer_user_id: effectiveViewerUserId,
    viewer_org_id: scanData.organization_id || null,
    viewer_effective_plan: planContext.effectivePlan,
    viewer_plan_source: planContext.planSource,
    domain: scanData.domain,
    scan_status: scanData.status,
    scan_score: scanData.total_score,
    notes: 'No PII stored. Viewer plan is authoritative for entitlements.'
  });

  // api_response.json
  const apiResponse = redactPII({
    success: true,
    recommendations: recsResult.recommendations,
    total_count: recsResult.recommendations.length,
    cap_applied: planContext.visibleLimit !== -1,
    cap_value: planContext.visibleLimit,
    viewer_plan: planContext.effectivePlan
  });

  // invariants.json
  const sectionsPresent = detectSectionsPresent(recsResult.recommendations);
  const unresolvedCount = countAllUnresolvedPlaceholders(recsResult.recommendations);

  const invariants = {
    fixture_id: fixtureId,
    expected: {
      viewer_based_entitlements: true,
      cap: planContext.visibleLimit,
      sections_required: REQUIRED_SECTIONS,
      no_unresolved_placeholders: true
    },
    snapshot: {
      returned_count: recsResult.recommendations.length,
      top_rec_keys: extractTopRecKeys(recsResult.recommendations, 5),
      sections_present: sectionsPresent,
      unresolved_placeholder_count: unresolvedCount
    },
    evidence_minimums: extractEvidenceStructure(recsResult.recommendations)
  };

  // pipeline_counts.json
  const pipelineCounts = {
    fixture_id: fixtureId,
    counts: {
      total_candidates: totalCandidates,
      after_ranking: null, // Not available without pipeline instrumentation
      after_dedupe: null,  // Not available without pipeline instrumentation
      after_gating: null,  // Not available without pipeline instrumentation
      returned: recsResult.recommendations.length
    },
    notes: 'Stage counts not available without modifying pipeline; recorded as null in Step 0.0.'
  };

  // 6. Write files (unless dry run)
  if (dryRun) {
    console.log('\n  [DRY RUN] Would write:');
    console.log(`    - ${fixtureId}/metadata.json`);
    console.log(`    - ${fixtureId}/api_response.json`);
    console.log(`    - ${fixtureId}/invariants.json`);
    console.log(`    - ${fixtureId}/pipeline_counts.json`);
    console.log('\n  Metadata:', JSON.stringify(metadata, null, 2).substring(0, 200) + '...');
    return { fixtureId, metadata, invariants, pipelineCounts };
  }

  const fixtureDir = path.join(outDir, fixtureId);
  fs.mkdirSync(fixtureDir, { recursive: true });

  fs.writeFileSync(
    path.join(fixtureDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  );

  fs.writeFileSync(
    path.join(fixtureDir, 'api_response.json'),
    JSON.stringify(apiResponse, null, 2)
  );

  fs.writeFileSync(
    path.join(fixtureDir, 'invariants.json'),
    JSON.stringify(invariants, null, 2)
  );

  fs.writeFileSync(
    path.join(fixtureDir, 'pipeline_counts.json'),
    JSON.stringify(pipelineCounts, null, 2)
  );

  console.log(`  Wrote fixture to: ${fixtureDir}`);

  return { fixtureId, metadata, invariants, pipelineCounts };
}

/**
 * Update or create fixture manifest
 */
function updateManifest(outDir, fixtures) {
  const manifestPath = path.join(outDir, 'fixture_manifest.json');

  let manifest = {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    phase: '4A.3',
    step: '0.0',
    fixtures: []
  };

  // Load existing manifest if present
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      console.warn('  Warning: Could not parse existing manifest, creating new one');
    }
  }

  // Add/update fixtures
  for (const fixture of fixtures) {
    const existingIndex = manifest.fixtures.findIndex(f => f.fixture_id === fixture.fixtureId);

    const entry = {
      fixture_id: fixture.fixtureId,
      description: fixture.metadata.description,
      scan_id: fixture.metadata.scan_id,
      viewer_plan: fixture.metadata.viewer_effective_plan,
      expected_cap: fixture.invariants.expected.cap,
      returned_count: fixture.invariants.snapshot.returned_count,
      captured_at: fixture.metadata.captured_at
    };

    if (existingIndex >= 0) {
      manifest.fixtures[existingIndex] = entry;
    } else {
      manifest.fixtures.push(entry);
    }
  }

  manifest.updated_at = new Date().toISOString();

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nUpdated manifest: ${manifestPath}`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = parseArgs();

  console.log('Golden Fixture Capture Script');
  console.log('=============================');

  if (args.dryRun) {
    console.log('[DRY RUN MODE]');
  }

  // Ensure output directory exists
  if (!args.dryRun) {
    fs.mkdirSync(args.outDir, { recursive: true });
  }

  const capturedFixtures = [];

  try {
    if (args.all) {
      // Capture all configured fixtures
      console.log('\nCapturing all configured fixtures...');
      console.log('Note: --all mode requires fixture configuration. Use --scan and --id for single fixtures.');
      console.log('\nExample usage for individual fixtures:');
      console.log('  node capture-fixture.js --scan 123 --id viewer_free_plan');
      console.log('  node capture-fixture.js --scan 456 --id multi_issue_site');
      console.log('\nRun fixture selection queries first to identify candidate scans.');
      return;
    }

    if (!args.scan || !args.id) {
      console.error('\nError: --scan and --id are required unless using --all');
      console.log('Usage: node capture-fixture.js --scan <ID> --id <fixture_id>');
      process.exit(1);
    }

    // Capture single fixture
    const result = await captureFixture(
      args.scan,
      args.id,
      args.viewerUserId,
      args.outDir,
      args.dryRun
    );

    capturedFixtures.push(result);

    // Update manifest
    if (!args.dryRun && capturedFixtures.length > 0) {
      updateManifest(args.outDir, capturedFixtures);
    }

    console.log('\nCapture complete!');

  } catch (error) {
    console.error('\nError:', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    // Close database connection
    try {
      await db.end();
    } catch (e) {
      // Ignore close errors
    }
  }
}

main();
