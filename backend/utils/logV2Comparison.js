function sanitizeRecommendationsLength(result) {
  if (!result || !Array.isArray(result.recommendations)) {
    return 0;
  }
  return result.recommendations.length;
}

function logV2Comparison({ context = 'shadow', url, plan, mode, v1Result, v2Result, durationMs }) {
  const v1Score = v1Result?.totalScore ?? null;
  const v2Score = v2Result?.totalScore ?? null;
  const v1Recs = sanitizeRecommendationsLength(v1Result);
  const v2Recs = sanitizeRecommendationsLength(v2Result);

  const payload = {
    url,
    plan: plan || undefined,
    mode: mode || undefined,
    v1Score,
    v2Score,
    v1Recs,
    v2Recs
  };

  if (typeof durationMs === 'number') {
    payload.durationMs = durationMs;
  }

  if (typeof v1Score === 'number' && typeof v2Score === 'number') {
    payload.scoreDelta = v2Score - v1Score;
  }

  payload.recommendationDelta = v2Recs - v1Recs;

  console.log(`[V2 Shadow] ${context} scan complete`, payload);
}

module.exports = { logV2Comparison };
