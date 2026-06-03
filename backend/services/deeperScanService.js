/**
 * Deeper-scan trigger (intake/profile build, Step 5).
 *
 * Single, clearly-named integration seam for the "deeper/targeted" scan that
 * runs ONCE when a user first confirms their visibility profile.
 *
 * IMPORTANT — scope:
 * There is currently no distinct targeted-scan engine in the codebase (scans
 * are created inline in routes/scan.js via the standard V5 scan). Per Step 5
 * scope we do NOT build a new scanning pipeline here. This function is the
 * one place the trigger is wired; the caller is responsible for the
 * exactly-once guard (deeper_scan_triggered_at), so this stays a no-op-safe
 * seam that records intent and logs.
 *
 * TODO(targeted-scan): when the targeted/deeper scan variant exists, implement
 * the actual enqueue here using the confirmed profile as context — e.g. resolve
 * the user's site URL (latest scan / users.primary_domain), then enqueue a scan
 * that passes profile context (ICPs, tracked_prompts, competitors). Use the
 * provided `client` so the enqueue commits atomically with profile completion.
 *
 * @param {object}  args
 * @param {number}  args.userId           - confirmed profile owner
 * @param {object}  args.profile          - the confirmed profile (server-validated)
 * @param {string}  args.plan             - resolved effective plan
 * @param {object}  [args.client]         - in-transaction DB client (enqueue here later)
 * @returns {Promise<{ triggered: boolean }>}
 */
async function triggerDeeperScan({ userId, profile, plan, client }) {
  // The caller sets deeper_scan_triggered_at inside the same transaction and
  // only invokes this on FIRST completion, so reaching here means "fire once".
  console.log(
    `[DeeperScan] Triggering deeper scan for user ${userId} (plan=${plan}) ` +
      `from confirmed profile (${(profile.tracked_prompts || []).length} tracked prompts, ` +
      `${(profile.icps || []).length} ICPs) — TODO: wire targeted-scan engine`
  );

  // No targeted-scan pipeline yet — intentionally does not enqueue a standard
  // scan to avoid building a new pipeline / producing side-effect scan rows.
  return { triggered: true };
}

module.exports = { triggerDeeperScan };
