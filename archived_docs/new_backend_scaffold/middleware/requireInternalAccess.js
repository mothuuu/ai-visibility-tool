// ---------------------------------------------------------
// AOME | requireInternalAccess middleware
// ---------------------------------------------------------
// Gates ops-only endpoints (e.g. /pool-stats) that leak infrastructure
// internals. The full project does not yet have an admin-auth layer in
// the new backend, so this is the MVP fallback: a shared header-based
// key, compared in constant time, fail-closed when unset.
//
// Operator setup:
//   - Set `INTERNAL_METRICS_KEY` (≥32 random bytes) in the prod secret
//     manager. Do NOT commit it.
//   - Callers must send `x-metrics-key: <value>`.
//   - If the env var is unset, every request is rejected — this avoids
//     silently exposing the endpoint after a misconfigured deploy.
//
// Notes:
// - Never logs the supplied or expected key.
// - Returns 401 with `{ code: "UNAUTHORIZED" }` for any failure mode so
//   we don't leak whether the env var is configured.
// ---------------------------------------------------------
'use strict';

const crypto = require('crypto');

const HEADER = 'x-metrics-key';

function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function unauthorized(res) {
  return res.status(401).json({
    error: 'Unauthorized',
    code: 'UNAUTHORIZED',
  });
}

function requireInternalAccess(req, res, next) {
  const expected = process.env.INTERNAL_METRICS_KEY;

  // Fail-closed: no key configured ⇒ no access.
  if (!expected || expected.length < 16) {
    return unauthorized(res);
  }

  const provided = req.get(HEADER);
  if (!provided || !timingSafeStringEqual(provided, expected)) {
    return unauthorized(res);
  }

  return next();
}

module.exports = requireInternalAccess;
module.exports.HEADER = HEADER;
