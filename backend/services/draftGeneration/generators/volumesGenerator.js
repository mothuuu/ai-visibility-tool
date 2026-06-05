/**
 * Volumes generator — STUB.
 *
 * Enriches the populated prompts (visibility_profiles.tracked_prompts) with
 * search-volume figures. This runs LAST and depends on the prompts generator.
 *
 * Gated by plan: only runs when draftConfig.baseline_volume is true (paid
 * tiers). When it doesn't run, prompts keep volume: null.
 *
 * Not automated yet; even when it runs it currently returns the prompts
 * unchanged (no volumes). A real impl would attach a `volume` to the top
 * prompts only.
 */

module.exports = {
  name: 'volumes',
  automated: false,

  // Volumes only apply on paid tiers that get baseline volume.
  shouldRun(ctx) {
    return Boolean(ctx.draftConfig && ctx.draftConfig.baseline_volume);
  },

  empty() {
    // No-op contribution: leaves tracked_prompts as the prompts generator left it.
    return {};
  },

  async run() {
    // Stub: no volumes attached yet.
    return {};
  },
};
