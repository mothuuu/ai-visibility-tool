/**
 * ICP generator — STUB.
 *
 * Produces the visibility_profiles.icps array. Not automated yet: wiring an
 * LLM generator (see services/engines/*Adapter.js) is a later step. Until then
 * this yields an empty list so the job completes cleanly.
 *
 * To make it real: replace this module's export with a real generator in
 * ./index.js — the job is untouched. ICPs run BEFORE prompts, so a real impl
 * can write ctx.profile.icps for the prompt generator to consume.
 */

const { makeStub } = require('./_interface');

module.exports = makeStub('icps', { icps: [] });
