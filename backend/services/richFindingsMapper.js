'use strict';

/**
 * richFindingsMapper — maps persisted `scan_recommendations` rows (the v5.x
 * evidence-engine output) into the findings-card contract consumed by
 * frontend/results.js and frontend/dashboard.js.
 *
 * Pure functions, no DB access, so the exact same mapping can be exercised by
 * scripts/verify-rich-findings.js against real data on Render before/after the
 * route change ships.
 *
 * Part of the "re-route the scan-results findings surface to the evidence
 * engine" change: results reads the rich persisted recommendations instead of
 * the thin findingsExtractor rows in the `findings` table.
 *
 * Card contract (Step 3): status (Missing/Partial/Could be enhanced), score
 * gain, difficulty, what-we-found, why-it-matters, how-to-implement steps, and
 * severity taken from the issue (not a score band). Legacy thin fields
 * (severity/title/pillar/description) stay populated so the dashboard's
 * existing renderer keeps working unchanged.
 */

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'];

// Severity from the issue's own evidence gap (threshold - score) using the same
// bands the detector uses. The persisted v5.1 rows carry a degenerate
// `priority` (every row is 'medium'), so priority alone would flatten every
// finding and never surface Critical. `evidence_json.gap` is the per-issue
// signal — not a pillar score-band — so we prefer it and fall back to the
// priority column only when a gap isn't present.
function normalizeSeverity(gap, priority) {
  const g = Number(gap);
  if (Number.isFinite(g)) {
    if (g > 40) return 'critical';
    if (g > 25) return 'high';
    if (g > 10) return 'medium';
    return 'low';
  }
  if (priority == null) return 'medium';
  const p = String(priority).trim().toLowerCase();
  if (VALID_SEVERITIES.includes(p)) return p;
  const n = Number(p);
  if (Number.isFinite(n)) {
    if (n >= 80) return 'critical';
    if (n >= 60) return 'high';
    if (n >= 30) return 'medium';
    return 'low';
  }
  return 'medium';
}

// estimated_effort (S/M/L or words) → difficulty label.
function normalizeDifficulty(effort) {
  if (effort == null || effort === '') return null;
  const e = String(effort).trim().toLowerCase();
  const map = {
    s: 'Easy', m: 'Medium', l: 'Hard',
    small: 'Easy', med: 'Medium', large: 'Hard',
    easy: 'Easy', medium: 'Medium', hard: 'Hard',
  };
  if (map[e]) return map[e];
  return e.charAt(0).toUpperCase() + e.slice(1);
}

// Derive detection status (Missing / Partial / Could be enhanced) from the
// engine's own recommendation_text lead-in. Real v5.1 lead words observed:
// Missing, No, Limited, Only, Incomplete, Weak, Crawler. Returns null when it
// can't be inferred (e.g. "Crawler Access Issues"), so the card falls back to
// the status-led title rather than inventing a label.
const STATUS_BY_LEAD = {
  missing: 'Missing', no: 'Missing', add: 'Missing', absent: 'Missing',
  partial: 'Partial', incomplete: 'Partial', limited: 'Partial', only: 'Partial', few: 'Partial',
  weak: 'Could be enhanced', enhance: 'Could be enhanced', improve: 'Could be enhanced',
  could: 'Could be enhanced', optimize: 'Could be enhanced', optimise: 'Could be enhanced',
  strengthen: 'Could be enhanced', expand: 'Could be enhanced', low: 'Could be enhanced',
};
function deriveStatus(recommendationText) {
  const t = String(recommendationText || '').trim().toLowerCase();
  if (!t) return null;
  const lead = t.split(/\s+/)[0];
  return STATUS_BY_LEAD[lead] || null;
}

// score-gain: recoverable points for the issue. Prefer the engine's own gap
// (threshold - score) since estimated_impact is a degenerate constant (3) in
// the persisted v5.1 rows; fall back to estimated_impact. Presented as a gain,
// never as a raw pillar score and never with a /100 denominator.
function normalizeScoreGain(gap, impact) {
  const g = Number(gap);
  if (Number.isFinite(g) && g > 0) return Math.round(g);
  const n = Number(impact);
  if (Number.isFinite(n) && n !== 0) return n;
  return null; // caller renders "+n"
}

// Guardrail (Step 4): no "/100" may render on the findings surface. The single
// normalization helper — if a bare N/100 appears in engine prose, rescale to
// /1000 (×10) so the surface only ever speaks in the app's /1000 scale.
function stripHundredScale(text) {
  if (text == null) return text;
  return String(text).replace(/\b(\d{1,3})\s*\/\s*100\b/g, (_, n) => `${Number(n) * 10}/1000`);
}

// action_steps may arrive as a JS array (JSONB) or a JSON/text string.
function toStepArray(actionSteps) {
  if (Array.isArray(actionSteps)) {
    return actionSteps.filter(s => s != null).map(s => stripHundredScale(String(s)));
  }
  if (typeof actionSteps === 'string') {
    const s = actionSteps.trim();
    if (!s) return [];
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.filter(x => x != null).map(x => stripHundredScale(String(x)));
    } catch (_) { /* not JSON — treat as a single step */ }
    return [stripHundredScale(s)];
  }
  return [];
}

/**
 * Map one scan_recommendations row → findings card object.
 * @param {Object} row - a scan_recommendations row
 * @returns {Object}
 */
function mapRecommendationToFinding(row) {
  const severity = normalizeSeverity(row.gap, row.priority);
  const whatWeFound = stripHundredScale(row.findings || '');
  const whyItMatters = stripHundredScale(row.why_it_matters || row.impact_description || '');
  const status = deriveStatus(row.recommendation_text);
  const steps = toStepArray(row.action_steps);
  const title = stripHundredScale(row.recommendation_text || row.category || 'Finding');

  return {
    id: row.id,
    severity,                                  // from the issue's evidence gap, not a pillar score-band
    title,                                     // status-led; never a raw pillar number
    pillar: row.category || '',
    // legacy thin field so the dashboard card still reads well
    description: whyItMatters || whatWeFound || '',
    impacted_url_count: 0,
    suggested_pack_type: null,
    // rich fields (results page)
    status,
    what_we_found: whatWeFound,
    why_it_matters: whyItMatters,
    how_to_implement: steps,
    score_gain: normalizeScoreGain(row.gap, row.estimated_impact),
    difficulty: normalizeDifficulty(row.estimated_effort),
    subfactor_key: row.subfactor_key || null,
    engine_version: row.engine_version || null,
  };
}

function severityCounts(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (counts[f.severity] != null) counts[f.severity] += 1;
  }
  return counts;
}

module.exports = {
  mapRecommendationToFinding,
  severityCounts,
  normalizeSeverity,
  normalizeDifficulty,
  deriveStatus,
  normalizeScoreGain,
  stripHundredScale,
  toStepArray,
  VALID_SEVERITIES,
};
