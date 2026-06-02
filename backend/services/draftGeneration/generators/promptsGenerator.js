/**
 * Prompts generator — STUB.
 *
 * Produces visibility_profiles.tracked_prompts as
 *   [{ text, volume: null, is_monitored: bool }]
 *
 * Not automated yet; yields an empty list. A real impl will read ctx.profile.icps
 * (ICPs run first) and honour ctx.draftConfig.populated_prompts_min/max for how
 * many prompts to populate, and ctx.draftConfig.monitoring_cap for how many to
 * mark is_monitored. Volumes run afterwards on the populated prompts.
 */

const { makeStub } = require('./_interface');

module.exports = makeStub('prompts', { tracked_prompts: [] });
