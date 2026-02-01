/**
 * Tests for validation engine SQL column fix (Phase 4A.3c.2)
 *
 * Validates that the validation engine uses correct column names
 * (subfactor_key instead of subfactor) to prevent:
 *   "column subfactor does not exist" errors
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('validation-engine — SQL column names', () => {
  const engineSource = fs.readFileSync(
    path.join(__dirname, '../../utils/validation-engine.js'),
    'utf8'
  );

  it('SELECT query uses subfactor_key not subfactor', () => {
    // The SELECT query should reference subfactor_key (the actual column name)
    // and NOT bare "subfactor" which causes Postgres errorMissingColumn
    const selectMatch = engineSource.match(/SELECT[^;]+FROM\s+scan_recommendations/s);
    assert.ok(selectMatch, 'Should have a SELECT from scan_recommendations');
    const selectClause = selectMatch[0];

    // Should contain subfactor_key
    assert.ok(
      selectClause.includes('subfactor_key'),
      `SELECT should reference subfactor_key, got: ${selectClause.substring(0, 200)}`
    );

    // Should NOT contain bare "subfactor" without _key suffix in column position
    // (allow "subfactor_key" but not standalone "subfactor,")
    const bareSubfactor = /\bsubfactor\b(?!_key)/;
    assert.ok(
      !bareSubfactor.test(selectClause),
      'SELECT should not reference bare "subfactor" column (use subfactor_key)'
    );
  });

  it('validateSingleRecommendation uses subfactor_key from recommendation', () => {
    // The function should access recommendation.subfactor_key, not recommendation.subfactor
    assert.ok(
      engineSource.includes('recommendation.subfactor_key'),
      'Should access recommendation.subfactor_key'
    );
  });
});
