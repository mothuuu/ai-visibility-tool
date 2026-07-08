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

// scan_recommendations.priority → card severity. The evidence engine emits a
// severity word ("medium"); normalise casing, band numerics defensively.
function normalizeSeverity(priority) {
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
// engine's own recommendation_text lead-in (e.g. "Missing Organization
// Schema"). Returns null when it can't be inferred, so the card falls back to
// just the status-led title rather than inventing a label.
function deriveStatus(recommendationText) {
  const t = String(recommendationText || '').trim().toLowerCase();
  if (!t) return null;
  if (t.startsWith('missing') || t.startsWith('no ') || t.startsWith('add ')) return 'Missing';
  if (t.startsWith('partial') || t.startsWith('incomplete') || t.startsWith('improve')) return 'Partial';
  if (t.startsWith('enhance') || t.startsWith('could') || t.startsWith('optimize') || t.startsWith('strengthen') || t.startsWith('expand')) return 'Could be enhanced';
  return null;
}

// score-gain: estimated_impact is a point delta from the engine. Presented as a
// gain, never as a raw pillar score and never with a /100 denominator.
function normalizeScoreGain(impact) {
  const n = Number(impact);
  if (!Number.isFinite(n) || n === 0) return null;
  return n; // caller renders "+n"
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
  const severity = normalizeSeverity(row.priority);
  const whatWeFound = stripHundredScale(row.findings || '');
  const whyItMatters = stripHundredScale(row.why_it_matters || row.impact_description || '');
  const status = deriveStatus(row.recommendation_text);
  const steps = toStepArray(row.action_steps);
  const title = stripHundredScale(row.recommendation_text || row.category || 'Finding');

  return {
    id: row.id,
    severity,                                  // from the issue, not a score band
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
    score_gain: normalizeScoreGain(row.estimated_impact),
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
