/**
 * Generator REGISTRY — the single place BACKGROUND draft generators are registered.
 *
 * The pipeline order encodes the field dependencies required by the job:
 *   scan_extraction -> icps -> competitors_business -> competitors_visibility
 * (basics feed ICPs/competitors). The background draft run produces basics +
 * ICPs + competitors only.
 *
 * Prompts are NO LONGER generated in the background: promptsGenerator now runs at
 * SAVE time (first profile completion) to return 10 suggestions per funnel stage
 * for the picker — see routes/profile.js and promptsGenerator.js. `volumes` only
 * ever enriched prompts, so it is not in the background pipeline either. Both
 * modules remain for direct/future use.
 *
 * Swapping a stub for a real implementation is a ONE-LINE change here: point the
 * require at the real module. The DraftGenerationService never changes.
 */

const scanExtraction = require('./scanExtractionGenerator');
const icps = require('./icpGenerator');
const competitorsBusiness = require('./competitorsBusinessGenerator');
const competitorsVisibility = require('./competitorsVisibilityGenerator');

// Ordered pipeline — DO NOT reorder without revisiting the dependencies above.
const PIPELINE = [
  scanExtraction,
  icps,
  competitorsBusiness,
  competitorsVisibility,
];

module.exports = { PIPELINE };
