'use strict';

/**
 * Visibility Opportunity (Winnability) scoring — config-driven weights and the
 * contestability sub-formula. v1 starting hypothesis; tunable. NOT hardcoded at
 * the call site.
 *
 * Three signals, each normalized to 0..1, weighted into a 0..100 score:
 *
 *  1. BRAND-PRESENCE GAP (anchor, dominant): brand_present=false => 1 (you're
 *     absent, room to win); true => 0 (already in the answer set).
 *  2. SPECIFICITY: funnel proximity. BOFU > MOFU > TOFU — a more specific,
 *     decision-stage query has less incumbent lock-in, so it's more winnable.
 *     (Text-length/token specificity is a documented future extension; v1 uses
 *     funnel_stage only, which keeps the band stable on re-run.)
 *  3. FIELD CONTESTABILITY: combines competitor_count (fragmentation) and
 *     media_count (positive). See contestability() for the transparent formula.
 *
 * Display is the BAND (coarse, stable); score is the internal/auditable value.
 */

// Top-level signal weights (sum = 1.0). Starting hypothesis — tune here, not inline.
const WEIGHTS = Object.freeze({
  brand_presence: 0.40, // anchor / dominant
  specificity:    0.35,
  contestability: 0.25,
});

// Specificity by funnel stage. More specific (decision-stage) = more winnable.
const SPECIFICITY_BY_STAGE = Object.freeze({ BOFU: 1.0, MOFU: 0.6, TOFU: 0.3 });
const SPECIFICITY_DEFAULT = 0.5; // untagged / unknown stage — neutral

/**
 * Contestability sub-formula constants. Contestability = "how enterable is this
 * field" in 0..1:
 *
 *   fragmentation = min(competitor_count / COMPETITOR_SATURATION, 1)
 *     A small set of incumbents (low competitor_count) reads as a concentrated,
 *     locked field => LOW. A fragmented field (many distinct competitors) =>
 *     HIGHER (no single incumbent owns the answer).
 *   media_positive = min(media_count / MEDIA_SATURATION, 1)
 *     Product decision: an editorial/media-heavy field is MORE enterable than a
 *     competitor-locked one, so media_count NUDGES WINNABILITY UP.
 *
 *   contestability = FRAGMENTATION_WEIGHT * fragmentation
 *                  + MEDIA_WEIGHT       * media_positive          (clamped 0..1)
 */
const CONTESTABILITY = Object.freeze({
  COMPETITOR_SATURATION: 5, // competitor_count at/above which fragmentation maxes
  MEDIA_SATURATION:      3, // media_count at/above which the media term maxes
  FRAGMENTATION_WEIGHT:  0.6,
  MEDIA_WEIGHT:          0.4, // internal split (sum = 1.0)
});

// Score (0..100) -> band (1..5). Fixed thresholds keep the band coarse + stable.
//   <20 => 1, >=20 => 2, >=40 => 3, >=60 => 4, >=80 => 5
const BAND_THRESHOLDS = Object.freeze([20, 40, 60, 80]);

const BASIS = 'winnability_v1';

module.exports = {
  WEIGHTS,
  SPECIFICITY_BY_STAGE,
  SPECIFICITY_DEFAULT,
  CONTESTABILITY,
  BAND_THRESHOLDS,
  BASIS,
};
