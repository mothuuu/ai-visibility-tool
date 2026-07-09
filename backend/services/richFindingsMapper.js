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

// Pillar importance = the detector's own CATEGORY_WEIGHTS. Keyed by the
// human-readable `category` the v5.1 engine persists, with a keyword fallback.
const CATEGORY_WEIGHTS = {
  'ai search readiness': 20,
  'technical setup': 18,
  'content structure': 15,
  'trust & authority': 12,
  'trust and authority': 12,
  'voice optimization': 12,
  'ai readability': 10,
  'content freshness': 8,
  'speed & ux': 5,
  'speed/ux': 5,
};

function categoryWeight(category) {
  const k = String(category || '').trim().toLowerCase();
  if (CATEGORY_WEIGHTS[k] != null) return CATEGORY_WEIGHTS[k];
  if (k.includes('search')) return 20;
  if (k.includes('technical')) return 18;
  if (k.includes('structure')) return 15;
  if (k.includes('trust') || k.includes('authority')) return 12;
  if (k.includes('voice')) return 12;
  if (k.includes('readab')) return 10;
  if (k.includes('fresh')) return 8;
  if (k.includes('speed') || k.includes('ux')) return 5;
  return 10; // sensible default mid-weight
}

function severityFromWeight(w) {
  if (w >= 18) return 'critical';
  if (w >= 12) return 'high';
  if (w >= 8) return 'medium';
  return 'low';
}

// Severity for the findings card.
//
// Evidence-only generated rows (generate-on-miss) store the playbook priority
// P0/P1/P2, mapped here P0->critical, P1->high, P2->medium.
//
// The legacy v5.1 rows (e.g. scan 561) instead carry a degenerate priority
// ('medium' for every row) and degenerate scores, so they fall through to a
// pillar-importance gradient using the detector's own CATEGORY_WEIGHTS. Using
// the P-notation for new rows vs. the bare word 'medium' for legacy rows keeps
// the two cleanly separated, so 561 renders exactly as before (cache hit).
//
// An explicit critical/high/low (or numeric) priority is also respected.
function normalizeSeverity(category, priority) {
  const p = String(priority == null ? '' : priority).trim().toLowerCase();
  if (p === 'p0') return 'critical';
  if (p === 'p1') return 'high';
  if (p === 'p2') return 'medium';
  if (p === 'critical' || p === 'high' || p === 'low') return p;
  const n = Number(p);
  if (Number.isFinite(n) && p !== '') {
    if (n >= 80) return 'critical';
    if (n >= 60) return 'high';
    if (n >= 30) return 'medium';
    return 'low';
  }
  return severityFromWeight(categoryWeight(category));
}

// estimated_effort (S/M/L or words) → difficulty label.
function normalizeDifficulty(effort) {
  if (effort == null || effort === '') return null;
  const e = String(effort).trim().toLowerCase();
  const map = {
    s: 'Easy', m: 'Moderate', l: 'Hard',
    's-m': 'Easy', 'm-l': 'Hard',
    small: 'Easy', med: 'Moderate', large: 'Hard',
    easy: 'Easy', moderate: 'Moderate', medium: 'Moderate', hard: 'Hard',
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

// Flat severity-based score-gain on the /1000 frame, for evidence-only rows that
// have no rubric gap. Approved v1 (Step 6).
const SEVERITY_GAIN = { critical: 100, high: 60, medium: 30, low: 15 };

// score-gain (points, /1000 frame — never /100).
// - Legacy rows (scan 561) carry a real evidence gap → use it (renders unchanged).
// - Evidence-only generated rows have no gap → flat severity-based gain.
// TODO: weight-aware cap — clamp the gain to a fraction of the category's
// remaining headroom so low-weight pillars (e.g. Speed UX at 5%) don't show a
// +100 they can't yield. Fast-follow, not now.
function normalizeScoreGain(gap, severity, impact) {
  const g = Number(gap);
  if (Number.isFinite(g) && g > 0) return Math.round(g);
  if (severity && SEVERITY_GAIN[severity] != null) return SEVERITY_GAIN[severity];
  const n = Number(impact);
  if (Number.isFinite(n) && n !== 0) return n;
  return null; // caller renders "+n"; null → card omits the element
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
  const severity = normalizeSeverity(row.category, row.priority);
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
    score_gain: normalizeScoreGain(row.gap, severity, row.estimated_impact),
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
  categoryWeight,
  severityFromWeight,
  normalizeDifficulty,
  deriveStatus,
  normalizeScoreGain,
  stripHundredScale,
  toStepArray,
  VALID_SEVERITIES,
  CATEGORY_WEIGHTS,
};
