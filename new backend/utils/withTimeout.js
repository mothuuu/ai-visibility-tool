// ---------------------------------------------------------
// AOME | Timeout + abort utilities for upstream calls
// ---------------------------------------------------------
// Centralises:
//   • Timeout values used across the analyze pipeline.
//   • A `TimeoutError` with stable `code: 'UPSTREAM_TIMEOUT'`.
//   • `withTimeout(promise, ms, { label, signal })` — races a promise
//     against a timer and (optionally) chains to a parent abort signal.
//   • `linkSignals(parent, child)` — fan-out helper so a request-level
//     deadline can abort multiple in-flight calls.
//
// Design notes:
// - We never log request payloads, URLs, or secrets. Only the call
//   `label` and elapsed ms are surfaced.
// - `withTimeout` aborts the per-call signal it creates so downstream
//   HTTP clients (fetch / OpenAI SDK) terminate the socket immediately
//   instead of leaking work after the route has responded.
// ---------------------------------------------------------
'use strict';

const TIMEOUTS = Object.freeze({
  // Per-upstream call budgets.
  FETCH_MS: parseInt(process.env.UPSTREAM_FETCH_TIMEOUT_MS, 10) || 15_000,
  SCORER_MS: parseInt(process.env.UPSTREAM_SCORER_TIMEOUT_MS, 10) || 30_000,
  RECOMMENDER_MS:
    parseInt(process.env.UPSTREAM_RECOMMENDER_TIMEOUT_MS, 10) || 30_000,
  // Whole-request deadline for POST /api/v1/analyze.
  ANALYZE_DEADLINE_MS:
    parseInt(process.env.ANALYZE_DEADLINE_MS, 10) || 75_000,
});

class TimeoutError extends Error {
  constructor(label, ms) {
    super(`Upstream call "${label}" exceeded ${ms}ms`);
    this.name = 'TimeoutError';
    this.code = 'UPSTREAM_TIMEOUT';
    this.label = label;
    this.timeoutMs = ms;
  }
}

function isAbortError(err) {
  if (!err) return false;
  return (
    err.name === 'AbortError' ||
    err.code === 'ABORT_ERR' ||
    err.code === 'ERR_CANCELED' ||
    err instanceof TimeoutError
  );
}

/**
 * Race `promise` against a timer. Returns whatever `promise` resolves to.
 * Throws `TimeoutError` if the deadline trips first; the per-call
 * AbortController is aborted so HTTP clients can release sockets.
 *
 * @param {(opts:{signal:AbortSignal}) => Promise<any> | Promise<any>} input
 *   Either a Promise, or a function that receives `{signal}` and returns
 *   a Promise (the latter form lets callers wire the signal into fetch /
 *   the OpenAI SDK).
 * @param {number} ms
 * @param {{label?: string, parentSignal?: AbortSignal}} [opts]
 */
function withTimeout(input, ms, opts = {}) {
  const label = opts.label || 'upstream';
  const controller = new AbortController();

  // Fan in: if a parent (request-level) signal aborts, abort us too.
  if (opts.parentSignal) {
    if (opts.parentSignal.aborted) {
      controller.abort(opts.parentSignal.reason);
    } else {
      opts.parentSignal.addEventListener(
        'abort',
        () => controller.abort(opts.parentSignal.reason),
        { once: true }
      );
    }
  }

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new TimeoutError(label, ms);
      controller.abort(err);
      reject(err);
    }, ms);
    // Don't keep the event loop alive for an upstream timer.
    if (typeof timer.unref === 'function') timer.unref();
  });

  const work =
    typeof input === 'function'
      ? Promise.resolve().then(() => input({ signal: controller.signal }))
      : Promise.resolve(input);

  return Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

module.exports = {
  TIMEOUTS,
  TimeoutError,
  withTimeout,
  isAbortError,
};
