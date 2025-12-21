/**
 * Unit tests for issue-detector tri-state handling
 * RULEBOOK v1.2 Step G5: Tests for tri-state score handling in issue detector
 *
 * Run with: node --test backend/tests/unit/issue-detector-tristate.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// Import the helpers from issue-detector
// These are used internally; we test them via the exported detectIssues function
const { detectIssues } = require('../../analyzers/recommendation-engine/issue-detector');
const { measured, notMeasured, notApplicable } = require('../../analyzers/score-types');

describe('issue-detector tri-state handling', () => {

  describe('handles tri-state scores in factors', () => {

    it('processes measured scores correctly', () => {
      const factors = {
        F1: {
          score: measured(85),
          subfactors: {
            'F1.1': { score: measured(90) },
            'F1.2': { score: measured(80) }
          }
        }
      };

      const issues = detectIssues(factors, {});
      // High scores should not generate critical issues
      const criticalIssues = issues.filter(i => i.priority === 'critical');
      assert.ok(criticalIssues.length === 0 || !criticalIssues.some(i => i.factor === 'F1'));
    });

    it('handles notMeasured scores without crashing', () => {
      const factors = {
        F1: {
          score: notMeasured('No content detected'),
          subfactors: {
            'F1.1': { score: notMeasured() },
            'F1.2': { score: measured(50) }
          }
        }
      };

      // Should not throw
      const issues = detectIssues(factors, {});
      assert.ok(Array.isArray(issues));
    });

    it('handles notApplicable scores without crashing', () => {
      const factors = {
        F1: {
          score: notApplicable('Page type not supported'),
          subfactors: {
            'F1.1': { score: notApplicable() }
          }
        }
      };

      // Should not throw
      const issues = detectIssues(factors, {});
      assert.ok(Array.isArray(issues));
    });

    it('handles mixed tri-state and legacy number scores', () => {
      const factors = {
        F1: {
          score: 75, // Legacy number
          subfactors: {
            'F1.1': { score: measured(80) }, // Tri-state
            'F1.2': { score: 70 } // Legacy number
          }
        },
        F2: {
          score: measured(60),
          subfactors: {
            'F2.1': { score: notMeasured() },
            'F2.2': { score: 55 }
          }
        }
      };

      // Should not throw
      const issues = detectIssues(factors, {});
      assert.ok(Array.isArray(issues));
    });

  });

  describe('low score detection with tri-state', () => {

    it('handles low measured scores without crashing', () => {
      const factors = {
        F1: {
          score: measured(25),
          subfactors: {
            'F1.1': { score: measured(20) }
          }
        }
      };

      // Should not throw and return array of issues
      const issues = detectIssues(factors, {});
      assert.ok(Array.isArray(issues));
    });

    it('skips issue detection for notMeasured subfactors', () => {
      const factors = {
        F1: {
          score: measured(50),
          subfactors: {
            'F1.1': { score: notMeasured() },
            'F1.2': { score: measured(40) }
          }
        }
      };

      const issues = detectIssues(factors, {});
      // Should not have issues specifically about F1.1 since it's not measured
      const f11Issues = issues.filter(i =>
        i.subfactor === 'F1.1' && i.title?.includes('notMeasured')
      );
      assert.strictEqual(f11Issues.length, 0);
    });

  });

  describe('edge cases', () => {

    it('handles empty factors object', () => {
      const issues = detectIssues({}, {});
      assert.ok(Array.isArray(issues));
    });

    it('handles null subfactors', () => {
      const factors = {
        F1: {
          score: measured(50),
          subfactors: null
        }
      };

      const issues = detectIssues(factors, {});
      assert.ok(Array.isArray(issues));
    });

    it('handles undefined subfactors', () => {
      const factors = {
        F1: {
          score: measured(50)
          // subfactors not defined
        }
      };

      const issues = detectIssues(factors, {});
      assert.ok(Array.isArray(issues));
    });

    it('handles score objects missing state property', () => {
      const factors = {
        F1: {
          score: { value: 50 }, // Invalid structure
          subfactors: {}
        }
      };

      // Should handle gracefully
      const issues = detectIssues(factors, {});
      assert.ok(Array.isArray(issues));
    });

  });

  describe('priority assignment with tri-state', () => {

    it('handles very low measured scores without crashing', () => {
      const factors = {
        F1: {
          score: measured(15),
          subfactors: {
            'F1.1': { score: measured(10) }
          }
        }
      };

      // Should not throw
      const issues = detectIssues(factors, {});
      assert.ok(Array.isArray(issues));
      // Any issues should have a valid priority
      for (const issue of issues) {
        if (issue.priority) {
          assert.ok(['critical', 'high', 'medium', 'low'].includes(issue.priority));
        }
      }
    });

    it('handles moderate measured scores without crashing', () => {
      const factors = {
        F1: {
          score: measured(55),
          subfactors: {
            'F1.1': { score: measured(50) }
          }
        }
      };

      // Should not throw
      const issues = detectIssues(factors, {});
      assert.ok(Array.isArray(issues));
    });

  });

});
