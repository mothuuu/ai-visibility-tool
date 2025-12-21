/**
 * Score Types Utility Module
 *
 * Provides structured handling for score states:
 * - MEASURED: Score was successfully calculated
 * - NOT_MEASURED: Score couldn't be calculated due to insufficient data
 * - NOT_APPLICABLE: Score doesn't apply to this page/site type
 */

const ScoreState = {
  MEASURED: 'measured',
  NOT_MEASURED: 'not_measured',
  NOT_APPLICABLE: 'not_applicable'
};

function measured(score, evidenceRefs = []) {
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    state: ScoreState.MEASURED,
    evidenceRefs
  };
}

function notMeasured(reason = 'Insufficient data') {
  return { score: null, state: ScoreState.NOT_MEASURED, reason };
}

function notApplicable(reason = 'Not applicable') {
  return { score: null, state: ScoreState.NOT_APPLICABLE, reason };
}

function isMeasured(scoreResult) {
  return scoreResult?.state === ScoreState.MEASURED && typeof scoreResult?.score === 'number';
}

function getScore(scoreResult) {
  return isMeasured(scoreResult) ? scoreResult.score : null;
}

module.exports = { ScoreState, measured, notMeasured, notApplicable, isMeasured, getScore };
