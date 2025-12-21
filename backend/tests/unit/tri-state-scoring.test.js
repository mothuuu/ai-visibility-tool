/**
 * Unit tests for tri-state scoring utilities
 * RULEBOOK v1.2 Step G5: Tests for tri-state score handling
 *
 * Run with: node --test backend/tests/unit/tri-state-scoring.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  ScoreState,
  measured,
  notMeasured,
  notApplicable,
  isMeasured,
  getScore,
  aggregateScores
} = require('../../analyzers/score-types');

describe('score-types', () => {

  describe('ScoreState constants', () => {

    it('has MEASURED state', () => {
      assert.strictEqual(ScoreState.MEASURED, 'measured');
    });

    it('has NOT_MEASURED state', () => {
      assert.strictEqual(ScoreState.NOT_MEASURED, 'not_measured');
    });

    it('has NOT_APPLICABLE state', () => {
      assert.strictEqual(ScoreState.NOT_APPLICABLE, 'not_applicable');
    });

  });

  describe('measured()', () => {

    it('creates measured score with correct state', () => {
      const result = measured(75);
      assert.strictEqual(result.state, ScoreState.MEASURED);
      assert.strictEqual(result.score, 75);
    });

    it('clamps score to 0 minimum', () => {
      const result = measured(-10);
      assert.strictEqual(result.score, 0);
    });

    it('clamps score to 100 maximum', () => {
      const result = measured(150);
      assert.strictEqual(result.score, 100);
    });

    it('rounds decimal scores', () => {
      const result = measured(75.7);
      assert.strictEqual(result.score, 76);
    });

    it('includes evidence refs when provided', () => {
      const refs = ['evidence1', 'evidence2'];
      const result = measured(80, refs);
      assert.deepStrictEqual(result.evidenceRefs, refs);
    });

    it('defaults to empty evidence refs', () => {
      const result = measured(80);
      assert.deepStrictEqual(result.evidenceRefs, []);
    });

  });

  describe('notMeasured()', () => {

    it('creates not_measured result with null score', () => {
      const result = notMeasured();
      assert.strictEqual(result.state, ScoreState.NOT_MEASURED);
      assert.strictEqual(result.score, null);
    });

    it('uses default reason', () => {
      const result = notMeasured();
      assert.strictEqual(result.reason, 'Insufficient data');
    });

    it('accepts custom reason', () => {
      const result = notMeasured('No FAQ content detected');
      assert.strictEqual(result.reason, 'No FAQ content detected');
    });

  });

  describe('notApplicable()', () => {

    it('creates not_applicable result with null score', () => {
      const result = notApplicable();
      assert.strictEqual(result.state, ScoreState.NOT_APPLICABLE);
      assert.strictEqual(result.score, null);
    });

    it('uses default reason', () => {
      const result = notApplicable();
      assert.strictEqual(result.reason, 'Not applicable');
    });

    it('accepts custom reason', () => {
      const result = notApplicable('Page type does not support this metric');
      assert.strictEqual(result.reason, 'Page type does not support this metric');
    });

  });

  describe('isMeasured()', () => {

    it('returns true for measured scores', () => {
      assert.strictEqual(isMeasured(measured(75)), true);
    });

    it('returns false for not_measured', () => {
      assert.strictEqual(isMeasured(notMeasured()), false);
    });

    it('returns false for not_applicable', () => {
      assert.strictEqual(isMeasured(notApplicable()), false);
    });

    it('returns false for null input', () => {
      assert.strictEqual(isMeasured(null), false);
    });

    it('returns false for undefined input', () => {
      assert.strictEqual(isMeasured(undefined), false);
    });

    it('returns false for object with wrong state', () => {
      assert.strictEqual(isMeasured({ score: 50, state: 'invalid' }), false);
    });

    it('returns false if score is not a number', () => {
      assert.strictEqual(isMeasured({ score: '50', state: ScoreState.MEASURED }), false);
    });

  });

  describe('getScore()', () => {

    it('returns score for measured results', () => {
      assert.strictEqual(getScore(measured(75)), 75);
    });

    it('returns null for not_measured', () => {
      assert.strictEqual(getScore(notMeasured()), null);
    });

    it('returns null for not_applicable', () => {
      assert.strictEqual(getScore(notApplicable()), null);
    });

    it('returns null for null input', () => {
      assert.strictEqual(getScore(null), null);
    });

    it('returns null for undefined input', () => {
      assert.strictEqual(getScore(undefined), null);
    });

  });

  describe('aggregateScores()', () => {

    it('averages multiple measured scores', () => {
      const scores = [measured(60), measured(80), measured(100)];
      const result = aggregateScores(scores);
      assert.strictEqual(result.score, 80);
      assert.strictEqual(result.state, ScoreState.MEASURED);
      assert.strictEqual(result.measuredCount, 3);
      assert.strictEqual(result.totalCount, 3);
    });

    it('excludes not_measured from average', () => {
      const scores = [measured(60), notMeasured(), measured(80)];
      const result = aggregateScores(scores);
      assert.strictEqual(result.score, 70);
      assert.strictEqual(result.measuredCount, 2);
      assert.strictEqual(result.totalCount, 3);
    });

    it('excludes not_applicable from average', () => {
      const scores = [measured(50), notApplicable(), measured(100)];
      const result = aggregateScores(scores);
      assert.strictEqual(result.score, 75);
      assert.strictEqual(result.measuredCount, 2);
      assert.strictEqual(result.totalCount, 3);
    });

    it('returns not_measured when all scores are unmeasured', () => {
      const scores = [notMeasured(), notApplicable(), notMeasured()];
      const result = aggregateScores(scores);
      assert.strictEqual(result.score, null);
      assert.strictEqual(result.state, ScoreState.NOT_MEASURED);
      assert.strictEqual(result.measuredCount, 0);
      assert.strictEqual(result.totalCount, 3);
    });

    it('returns not_measured for empty array', () => {
      const result = aggregateScores([]);
      assert.strictEqual(result.score, null);
      assert.strictEqual(result.state, ScoreState.NOT_MEASURED);
      assert.strictEqual(result.measuredCount, 0);
      assert.strictEqual(result.totalCount, 0);
    });

    it('rounds aggregated score', () => {
      const scores = [measured(33), measured(33), measured(34)];
      const result = aggregateScores(scores);
      assert.strictEqual(result.score, 33); // (33+33+34)/3 = 33.33... rounds to 33
    });

  });

});
