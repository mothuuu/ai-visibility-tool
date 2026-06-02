/**
 * Generator REGISTRY — the single place draft generators are registered.
 *
 * The pipeline order encodes the field dependencies required by the job:
 *   scan_extraction -> icps -> competitors_business -> competitors_visibility
 *   -> prompts -> volumes
 * (ICPs feed prompts; prompts feed volumes.)
 *
 * Swapping a stub for a real implementation is a ONE-LINE change here: point the
 * require at the real module. The DraftGenerationService never changes.
 */

const scanExtraction = require('./scanExtractionGenerator');
const icps = require('./icpGenerator');
const competitorsBusiness = require('./competitorsBusinessGenerator');
const competitorsVisibility = require('./competitorsVisibilityGenerator');
const prompts = require('./promptsGenerator');
const volumes = require('./volumesGenerator');

// Ordered pipeline — DO NOT reorder without revisiting the dependencies above.
const PIPELINE = [
  scanExtraction,
  icps,
  competitorsBusiness,
  competitorsVisibility,
  prompts,
  volumes,
];

module.exports = { PIPELINE };
