/**
 * Draft generator interface (Step 3 — intake/profile draft).
 *
 * A "generator" produces one field-group of the visibility_profiles draft. Each
 * generator returns a PARTIAL object whose keys are visibility_profiles columns
 * (or, for volumes, an enrichment of an existing column). The orchestrator
 * merges contributions in pipeline order, so later generators can read earlier
 * results via ctx.profile (ICPs feed prompts; prompts feed volumes).
 *
 * Interface:
 *   {
 *     name:      string            // stable id, used in logs/reporting
 *     automated: boolean           // false => stub (not wired to a real impl yet)
 *     empty():   object            // empty contribution (the safe default)
 *     run(ctx):  Promise<object>   // produce the contribution
 *     shouldRun?(ctx): boolean     // optional gate; skipped (with empty default) when false
 *   }
 *
 * ctx = {
 *   userId:      number,
 *   scan:        object,   // most recent COMPLETED scan row (never null inside run)
 *   plan:        string,   // resolved effective plan
 *   draftConfig: object,   // PlanService.getDraftConfig(plan)
 *   profile:     object,   // accumulator of contributions merged so far
 * }
 *
 * Swapping a stub for a real implementation is a one-line change in
 * ./index.js (the registry) — the job never changes.
 */

/**
 * Build a default STUB generator that always yields its empty contribution.
 * Used for field-groups that aren't automated yet (competitors, prompts,
 * volumes — and ICPs until an LLM generator is wired).
 *
 * @param {string} name
 * @param {object} emptyContribution - e.g. { icps: [] }
 * @returns {object} generator
 */
function makeStub(name, emptyContribution) {
  const clone = () => JSON.parse(JSON.stringify(emptyContribution));
  return {
    name,
    automated: false,
    empty: clone,
    async run() {
      return clone();
    },
  };
}

module.exports = { makeStub };
