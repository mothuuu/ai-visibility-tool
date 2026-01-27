#!/usr/bin/env node
/**
 * Golden Fixture Validation Script
 * Phase 4A.3 Step 0.0
 *
 * Validates fixture integrity:
 * - Directory structure
 * - No PII patterns
 * - JSON schema sanity
 * - Required fields present
 * - Invariants are valid
 *
 * Usage:
 *   node scripts/fixtures/validate-fixtures.js [--dir path] [--fix] [--verbose]
 *
 * Options:
 *   --dir      Fixture directory (default: tests/fixtures/golden)
 *   --fix      Attempt to fix minor issues
 *   --verbose  Show detailed output
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_DIR = path.join(__dirname, '../../tests/fixtures/golden');

// PII patterns that should NOT appear in fixtures
const PII_PATTERNS = [
  { name: 'email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: 'bearer_token', pattern: /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/g },
  { name: 'phone_us', pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'api_key_value', pattern: /"(api_key|apiKey|API_KEY)"\s*:\s*"[^"]{10,}"/gi },
  { name: 'password_value', pattern: /"password"\s*:\s*"[^"]+"/gi },
  { name: 'secret_value', pattern: /"secret"\s*:\s*"[^"]+"/gi }
];

// Required files in each fixture directory
const REQUIRED_FILES = [
  'metadata.json',
  'api_response.json',
  'invariants.json',
  'pipeline_counts.json'
];

// Required fields in metadata.json
const REQUIRED_METADATA_FIELDS = [
  'fixture_id',
  'captured_at',
  'scan_id',
  'viewer_effective_plan'
];

// Required fields in invariants.json
const REQUIRED_INVARIANTS_FIELDS = [
  'fixture_id',
  'expected',
  'snapshot'
];

// Model A plan caps (single source of truth: backend/config/planCaps.js)
const MODEL_A_PLAN_CAPS = {
  free: 3,
  freemium: 3,
  diy: 5,
  starter: 5,
  pro: 8,
  agency: -1,
  enterprise: -1
};

// Model A invariants — batch unlock must NOT exist
const MODEL_A_FORBIDDEN_API_FIELDS = [
  'nextBatchUnlock',
  'batch_unlock',
  'daysUntilNextUnlock',
  'canUnlockMore'
];

// Required fields in expected section
const REQUIRED_EXPECTED_FIELDS = [
  'viewer_based_entitlements',
  'cap'
];

// Required fields in snapshot section
const REQUIRED_SNAPSHOT_FIELDS = [
  'returned_count',
  'top_rec_keys',
  'sections_present'
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
    dir: DEFAULT_DIR,
    fix: false,
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--dir':
        parsed.dir = nextArg;
        i++;
        break;
      case '--fix':
        parsed.fix = true;
        break;
      case '--verbose':
      case '-v':
        parsed.verbose = true;
        break;
      case '--help':
      case '-h':
        console.log(`
Golden Fixture Validation Script

Usage:
  node validate-fixtures.js [options]

Options:
  --dir      Fixture directory (default: tests/fixtures/golden)
  --fix      Attempt to fix minor issues
  --verbose  Show detailed output
  --help     Show this help message
`);
        process.exit(0);
    }
  }

  return parsed;
}

/**
 * Check if content contains PII
 */
function checkForPII(content, fileName) {
  const issues = [];
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);

  for (const { name, pattern } of PII_PATTERNS) {
    const matches = contentStr.match(pattern);
    if (matches) {
      // Filter out redacted placeholders
      const realMatches = matches.filter(m =>
        !m.includes('[REDACTED]') &&
        !m.includes('[EMAIL_REDACTED]') &&
        !m.includes('[TOKEN_REDACTED]')
      );

      if (realMatches.length > 0) {
        issues.push({
          type: 'pii',
          severity: 'error',
          message: `PII detected (${name}): ${realMatches.length} occurrence(s) in ${fileName}`,
          matches: realMatches.slice(0, 3) // Show first 3 matches
        });
      }
    }
  }

  return issues;
}

/**
 * Validate JSON can be parsed
 */
function validateJSON(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    return { valid: true, data: parsed, content };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
      data: null,
      content: null
    };
  }
}

/**
 * Check if required fields exist
 */
function checkRequiredFields(obj, fields, fileName) {
  const issues = [];

  for (const field of fields) {
    if (obj[field] === undefined) {
      issues.push({
        type: 'missing_field',
        severity: 'error',
        message: `Missing required field '${field}' in ${fileName}`
      });
    }
  }

  return issues;
}

/**
 * Validate metadata.json
 */
function validateMetadata(data, fixtureId) {
  const issues = [];

  // Check required fields
  issues.push(...checkRequiredFields(data, REQUIRED_METADATA_FIELDS, 'metadata.json'));

  // Check fixture_id matches directory name
  if (data.fixture_id && data.fixture_id !== fixtureId) {
    issues.push({
      type: 'mismatch',
      severity: 'warning',
      message: `fixture_id '${data.fixture_id}' doesn't match directory name '${fixtureId}'`
    });
  }

  // Check captured_at is valid date
  if (data.captured_at) {
    const date = new Date(data.captured_at);
    if (isNaN(date.getTime())) {
      issues.push({
        type: 'invalid_date',
        severity: 'warning',
        message: `Invalid captured_at date: ${data.captured_at}`
      });
    }
  }

  // Check viewer_effective_plan is valid
  const validPlans = ['free', 'freemium', 'diy', 'starter', 'pro', 'agency', 'enterprise'];
  if (data.viewer_effective_plan && !validPlans.includes(data.viewer_effective_plan)) {
    issues.push({
      type: 'invalid_plan',
      severity: 'warning',
      message: `Unknown viewer_effective_plan: ${data.viewer_effective_plan}`
    });
  }

  return issues;
}

/**
 * Validate api_response.json
 */
function validateApiResponse(data) {
  const issues = [];

  // Check for recommendations array
  if (!data.recommendations) {
    issues.push({
      type: 'missing_field',
      severity: 'error',
      message: 'Missing recommendations array in api_response.json'
    });
  } else if (!Array.isArray(data.recommendations)) {
    issues.push({
      type: 'invalid_type',
      severity: 'error',
      message: 'recommendations must be an array in api_response.json'
    });
  }

  // Model A invariant: no batch unlock fields in API response
  for (const field of MODEL_A_FORBIDDEN_API_FIELDS) {
    if (data[field] !== undefined && data[field] !== null) {
      issues.push({
        type: 'model_a_violation',
        severity: 'error',
        message: `Model A violation: api_response contains forbidden field '${field}' (value: ${JSON.stringify(data[field])})`
      });
    }
  }

  // Model A invariant: cap consistency
  if (data.viewer_plan && data.cap_value !== undefined) {
    const expectedCap = MODEL_A_PLAN_CAPS[data.viewer_plan];
    if (expectedCap !== undefined && data.cap_value !== expectedCap) {
      issues.push({
        type: 'cap_mismatch',
        severity: 'error',
        message: `Cap mismatch: viewer_plan '${data.viewer_plan}' should have cap ${expectedCap}, got ${data.cap_value}`
      });
    }
  }

  // Model A invariant: returned count must not exceed cap
  if (data.recommendations && data.cap_value !== undefined && data.cap_value !== -1) {
    if (data.recommendations.length > data.cap_value) {
      issues.push({
        type: 'cap_exceeded',
        severity: 'error',
        message: `Cap exceeded: returned ${data.recommendations.length} recommendations but cap is ${data.cap_value}`
      });
    }
  }

  return issues;
}

/**
 * Validate invariants.json
 */
function validateInvariants(data, fixtureId) {
  const issues = [];

  // Check required fields
  issues.push(...checkRequiredFields(data, REQUIRED_INVARIANTS_FIELDS, 'invariants.json'));

  // Check fixture_id matches
  if (data.fixture_id && data.fixture_id !== fixtureId) {
    issues.push({
      type: 'mismatch',
      severity: 'warning',
      message: `fixture_id '${data.fixture_id}' doesn't match directory name '${fixtureId}'`
    });
  }

  // Check expected section
  if (data.expected) {
    issues.push(...checkRequiredFields(data.expected, REQUIRED_EXPECTED_FIELDS, 'invariants.json (expected)'));

    // Check cap is a number or -1
    if (data.expected.cap !== undefined && typeof data.expected.cap !== 'number') {
      issues.push({
        type: 'invalid_type',
        severity: 'error',
        message: 'expected.cap must be a number in invariants.json'
      });
    }
  }

  // Check snapshot section
  if (data.snapshot) {
    issues.push(...checkRequiredFields(data.snapshot, REQUIRED_SNAPSHOT_FIELDS, 'invariants.json (snapshot)'));

    // Check returned_count is a number
    if (data.snapshot.returned_count !== undefined && typeof data.snapshot.returned_count !== 'number') {
      issues.push({
        type: 'invalid_type',
        severity: 'error',
        message: 'snapshot.returned_count must be a number in invariants.json'
      });
    }

    // Check top_rec_keys is an array
    if (data.snapshot.top_rec_keys && !Array.isArray(data.snapshot.top_rec_keys)) {
      issues.push({
        type: 'invalid_type',
        severity: 'error',
        message: 'snapshot.top_rec_keys must be an array in invariants.json'
      });
    }

    // Model A invariant: returned_count must not exceed cap
    if (data.expected && data.expected.cap !== -1 &&
        data.snapshot.returned_count > data.expected.cap) {
      issues.push({
        type: 'cap_exceeded',
        severity: 'error',
        message: `Model A: returned_count (${data.snapshot.returned_count}) exceeds cap (${data.expected.cap})`
      });
    }
  }

  // Model A invariant: viewer_based_entitlements must be true
  if (data.expected && data.expected.viewer_based_entitlements !== true) {
    issues.push({
      type: 'model_a_violation',
      severity: 'error',
      message: 'Model A requires viewer_based_entitlements = true'
    });
  }

  return issues;
}

/**
 * Validate pipeline_counts.json
 */
function validatePipelineCounts(data, fixtureId) {
  const issues = [];

  // Check fixture_id matches
  if (data.fixture_id && data.fixture_id !== fixtureId) {
    issues.push({
      type: 'mismatch',
      severity: 'warning',
      message: `fixture_id '${data.fixture_id}' doesn't match directory name '${fixtureId}'`
    });
  }

  // Check counts section exists
  if (!data.counts) {
    issues.push({
      type: 'missing_field',
      severity: 'error',
      message: 'Missing counts section in pipeline_counts.json'
    });
  } else {
    // Check returned is present and is a number
    if (data.counts.returned === undefined) {
      issues.push({
        type: 'missing_field',
        severity: 'error',
        message: 'Missing counts.returned in pipeline_counts.json'
      });
    } else if (typeof data.counts.returned !== 'number') {
      issues.push({
        type: 'invalid_type',
        severity: 'error',
        message: 'counts.returned must be a number in pipeline_counts.json'
      });
    }
  }

  return issues;
}

/**
 * Validate a single fixture directory
 */
function validateFixture(fixtureDir, fixtureId, verbose) {
  const issues = [];

  if (verbose) {
    console.log(`\n  Validating: ${fixtureId}`);
  }

  // Check required files exist
  for (const fileName of REQUIRED_FILES) {
    const filePath = path.join(fixtureDir, fileName);
    if (!fs.existsSync(filePath)) {
      issues.push({
        type: 'missing_file',
        severity: 'error',
        message: `Missing required file: ${fileName}`
      });
    }
  }

  // Validate each JSON file
  const files = {
    metadata: { path: path.join(fixtureDir, 'metadata.json'), validator: validateMetadata },
    api_response: { path: path.join(fixtureDir, 'api_response.json'), validator: validateApiResponse },
    invariants: { path: path.join(fixtureDir, 'invariants.json'), validator: validateInvariants },
    pipeline_counts: { path: path.join(fixtureDir, 'pipeline_counts.json'), validator: validatePipelineCounts }
  };

  for (const [name, { path: filePath, validator }] of Object.entries(files)) {
    if (!fs.existsSync(filePath)) continue;

    const result = validateJSON(filePath);

    if (!result.valid) {
      issues.push({
        type: 'invalid_json',
        severity: 'error',
        message: `Invalid JSON in ${name}.json: ${result.error}`
      });
      continue;
    }

    // Run specific validator
    const validatorIssues = validator(result.data, fixtureId);
    issues.push(...validatorIssues);

    // Check for PII
    const piiIssues = checkForPII(result.content, `${name}.json`);
    issues.push(...piiIssues);

    if (verbose && validatorIssues.length === 0 && piiIssues.length === 0) {
      console.log(`    ${name}.json`);
    }
  }

  return issues;
}

/**
 * Validate manifest file
 */
function validateManifest(manifestPath, fixtureIds, verbose) {
  const issues = [];

  if (!fs.existsSync(manifestPath)) {
    issues.push({
      type: 'missing_file',
      severity: 'warning',
      message: 'Missing fixture_manifest.json'
    });
    return issues;
  }

  const result = validateJSON(manifestPath);

  if (!result.valid) {
    issues.push({
      type: 'invalid_json',
      severity: 'error',
      message: `Invalid JSON in fixture_manifest.json: ${result.error}`
    });
    return issues;
  }

  const manifest = result.data;

  // Check required fields
  if (!manifest.fixtures || !Array.isArray(manifest.fixtures)) {
    issues.push({
      type: 'missing_field',
      severity: 'error',
      message: 'Missing or invalid fixtures array in manifest'
    });
    return issues;
  }

  // Check that all fixture directories are in manifest
  const manifestedIds = new Set(manifest.fixtures.map(f => f.fixture_id));

  for (const id of fixtureIds) {
    if (!manifestedIds.has(id)) {
      issues.push({
        type: 'unlisted_fixture',
        severity: 'warning',
        message: `Fixture '${id}' not listed in manifest`
      });
    }
  }

  // Check for orphaned manifest entries
  for (const entry of manifest.fixtures) {
    if (!fixtureIds.includes(entry.fixture_id)) {
      issues.push({
        type: 'orphaned_entry',
        severity: 'warning',
        message: `Manifest entry '${entry.fixture_id}' has no corresponding directory`
      });
    }
  }

  // Model A manifest invariants
  if (manifest.model !== 'A') {
    issues.push({
      type: 'model_a_violation',
      severity: 'error',
      message: `Manifest model must be 'A', got '${manifest.model}'`
    });
  }

  if (manifest.batch_unlock !== false) {
    issues.push({
      type: 'model_a_violation',
      severity: 'error',
      message: 'Manifest batch_unlock must be false for Model A'
    });
  }

  if (manifest.nextBatchUnlock_is_null_or_absent !== true) {
    issues.push({
      type: 'model_a_violation',
      severity: 'warning',
      message: 'Manifest should declare nextBatchUnlock_is_null_or_absent: true'
    });
  }

  // Validate plan_caps in manifest match SSOT
  if (manifest.plan_caps) {
    for (const [plan, expectedCap] of Object.entries(MODEL_A_PLAN_CAPS)) {
      if (plan === 'freemium' || plan === 'starter') continue; // aliases
      if (manifest.plan_caps[plan] !== undefined && manifest.plan_caps[plan] !== expectedCap) {
        issues.push({
          type: 'cap_mismatch',
          severity: 'error',
          message: `Manifest plan_caps.${plan} is ${manifest.plan_caps[plan]}, expected ${expectedCap}`
        });
      }
    }
  }

  // Validate each fixture entry has correct cap for its plan
  for (const entry of manifest.fixtures) {
    if (entry.viewer_plan && entry.expected_cap !== undefined) {
      const expectedCap = MODEL_A_PLAN_CAPS[entry.viewer_plan];
      if (expectedCap !== undefined && entry.expected_cap !== expectedCap) {
        issues.push({
          type: 'cap_mismatch',
          severity: 'error',
          message: `Fixture '${entry.fixture_id}': expected_cap ${entry.expected_cap} does not match plan '${entry.viewer_plan}' cap ${expectedCap}`
        });
      }
    }
  }

  if (verbose) {
    console.log(`\n  Manifest: ${manifest.fixtures.length} fixtures listed`);
  }

  return issues;
}

// ============================================================================
// MAIN
// ============================================================================

function main() {
  const args = parseArgs();

  console.log('Golden Fixture Validation Script');
  console.log('=================================');
  console.log(`\nValidating fixtures in: ${args.dir}`);

  if (!fs.existsSync(args.dir)) {
    console.error(`\nError: Directory not found: ${args.dir}`);
    process.exit(1);
  }

  const allIssues = [];
  const fixtureIds = [];

  // Find all fixture directories
  const entries = fs.readdirSync(args.dir, { withFileTypes: true });
  const fixtureDirs = entries.filter(e =>
    e.isDirectory() &&
    !e.name.startsWith('.') &&
    e.name !== 'node_modules'
  );

  if (fixtureDirs.length === 0) {
    console.log('\nNo fixture directories found.');
    console.log('Use capture-fixture.js to create fixtures first.');
    return;
  }

  console.log(`\nFound ${fixtureDirs.length} fixture directories`);

  // Validate each fixture
  for (const dir of fixtureDirs) {
    const fixtureDir = path.join(args.dir, dir.name);
    const fixtureId = dir.name;
    fixtureIds.push(fixtureId);

    const issues = validateFixture(fixtureDir, fixtureId, args.verbose);

    if (issues.length > 0) {
      allIssues.push({
        fixture: fixtureId,
        issues
      });
    }
  }

  // Validate manifest
  const manifestPath = path.join(args.dir, 'fixture_manifest.json');
  const manifestIssues = validateManifest(manifestPath, fixtureIds, args.verbose);

  if (manifestIssues.length > 0) {
    allIssues.push({
      fixture: 'fixture_manifest.json',
      issues: manifestIssues
    });
  }

  // Report results
  console.log('\n' + '='.repeat(50));

  if (allIssues.length === 0) {
    console.log('\n All fixtures valid!');
    console.log(`  - ${fixtureIds.length} fixtures validated`);
    console.log('  - No PII detected');
    console.log('  - All required files present');
    console.log('  - JSON structure valid');
    process.exit(0);
  }

  console.log('\nIssues Found:');

  let errorCount = 0;
  let warningCount = 0;

  for (const { fixture, issues } of allIssues) {
    console.log(`\n  ${fixture}:`);

    for (const issue of issues) {
      const icon = issue.severity === 'error' ? '' : '';

      if (issue.severity === 'error') {
        errorCount++;
      } else {
        warningCount++;
      }

      console.log(`    ${icon} [${issue.severity.toUpperCase()}] ${issue.message}`);

      if (issue.matches && args.verbose) {
        console.log(`       Samples: ${issue.matches.slice(0, 2).join(', ')}`);
      }
    }
  }

  console.log('\n' + '-'.repeat(50));
  console.log(`Summary: ${errorCount} error(s), ${warningCount} warning(s)`);

  if (errorCount > 0) {
    console.log('\nFix errors before proceeding.');
    process.exit(1);
  }

  process.exit(0);
}

main();
