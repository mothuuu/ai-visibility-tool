/* ==========================================================================
   Visibility Profile Loader — fetch / poll / state (Step 8)

   window.ProfileLoader.start(mountEl, options) -> Promise

   Responsibilities (the render module stays pure):
     - Fetch GET /api/profile using the existing auth pattern (Bearer authToken).
     - draft_ready true on first fetch  -> render the populated form immediately
       (normal returning-user / edit path; no polling).
     - draft_ready false                -> render a "Setting up your profile…"
       state and poll GET /api/profile (~3s) until it flips true, then render.
     - Poll timeout (~90s)              -> stop polling and render the form with
       whatever data is present (covers the no-scan case where a draft never
       generates) so the user can complete it manually.
     - Fetch error                      -> retryable error state.
     - 401                              -> redirect to auth (existing pattern).

   SCOPE: loading + state rendering only. No interactivity / progress / submit.

   options (all optional):
     mode            'onboarding' | 'edit'   (default 'onboarding')
     apiBaseUrl      API base (default: window.API_BASE_URL or '/api')
     pollIntervalMs  default 3000
     maxPollAttempts default 30  (~90s with 3s interval)
     fetchImpl       fetch override (testing); default window.fetch
     authToken       token override (testing); default localStorage 'authToken'
     onAuthFail      override redirect (testing); default -> auth.html
   ========================================================================== */
(function () {
  'use strict';

  const DEFAULTS = { pollIntervalMs: 3000, maxPollAttempts: 30, mode: 'onboarding' };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function resolveOpts(options) {
    const o = options || {};
    return {
      mode: o.mode === 'edit' ? 'edit' : 'onboarding',
      apiBaseUrl: o.apiBaseUrl || (typeof window !== 'undefined' && window.API_BASE_URL) || '/api',
      pollIntervalMs: o.pollIntervalMs != null ? o.pollIntervalMs : DEFAULTS.pollIntervalMs,
      maxPollAttempts: o.maxPollAttempts != null ? o.maxPollAttempts : DEFAULTS.maxPollAttempts,
      fetchImpl: o.fetchImpl || (typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null),
      getToken: o.authToken != null
        ? () => o.authToken
        : () => (typeof localStorage !== 'undefined' ? localStorage.getItem('authToken') : null),
      onAuthFail: o.onAuthFail || (() => { if (typeof window !== 'undefined') window.location.href = 'auth.html'; }),
    };
  }

  function getMount(mountEl) {
    return typeof mountEl === 'string' ? document.querySelector(mountEl) : mountEl;
  }

  // ---- transient states (rendered by the loader, not the pure form) ------
  function renderLoading(el) {
    el.classList.add('vp-scope');
    el.innerHTML = `
      <div class="vp-form">
        <div class="vp-status" data-status="loading" role="status" aria-live="polite">
          <div class="vp-spinner" aria-hidden="true"></div>
          <h2 class="vp-status-title">Setting up your profile…</h2>
          <p class="vp-status-sub">We're drafting suggestions from your scan. This usually takes a few seconds.</p>
        </div>
      </div>`;
  }

  function renderError(el, message, retry) {
    el.classList.add('vp-scope');
    el.innerHTML = `
      <div class="vp-form">
        <div class="vp-status" data-status="error" role="alert">
          <h2 class="vp-status-title">We couldn't load your profile</h2>
          <p class="vp-status-sub">${escapeHtml(message || 'Something went wrong.')}</p>
          <button class="vp-add-btn" type="button" data-action="retry"><i class="fas fa-rotate-right"></i> Try again</button>
        </div>
      </div>`;
    const btn = el.querySelector('[data-action="retry"]');
    if (btn && typeof retry === 'function') btn.addEventListener('click', retry);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderForm(el, mode, body) {
    window.ProfileForm.render(el, {
      mode,
      data: (body && body.profile) || {},
      config: (body && body.draft_config) || null,
    });
  }

  // ---- single fetch ------------------------------------------------------
  // Returns { ok, status, body } | throws on network failure.
  async function fetchProfile(opts) {
    const token = opts.getToken();
    const resp = await opts.fetchImpl(`${opts.apiBaseUrl}/profile`, {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    let body = null;
    try { body = await resp.json(); } catch (_) { /* non-JSON */ }
    return { ok: resp.ok, status: resp.status, body };
  }

  // ---- main entry --------------------------------------------------------
  async function start(mountEl, options) {
    const el = getMount(mountEl);
    if (!el) { console.error('[ProfileLoader] mount element not found'); return; }
    const opts = resolveOpts(options);
    if (!opts.fetchImpl) { console.error('[ProfileLoader] no fetch available'); return; }

    const run = () => load(el, opts);
    return run();
  }

  async function load(el, opts) {
    let res;
    try {
      res = await fetchProfile(opts);
    } catch (err) {
      renderError(el, 'Network error. Check your connection and try again.', () => load(el, opts));
      return { state: 'error', error: String(err && err.message || err) };
    }

    if (res.status === 401) {
      opts.onAuthFail();
      return { state: 'auth_redirect' };
    }
    if (!res.ok) {
      renderError(el, `Server returned ${res.status}.`, () => load(el, opts));
      return { state: 'error', status: res.status };
    }

    // Ready on first fetch -> render immediately, no polling.
    if (res.body && res.body.draft_ready) {
      renderForm(el, opts.mode, res.body);
      return { state: 'ready', polled: 0, body: res.body };
    }

    // Not ready -> show "setting up…" and poll.
    renderLoading(el);
    let attempts = 0;
    while (attempts < opts.maxPollAttempts) {
      await sleep(opts.pollIntervalMs);
      attempts++;
      let pr;
      try {
        pr = await fetchProfile(opts);
      } catch (_) {
        continue; // transient network blip during polling — keep trying
      }
      if (pr.status === 401) { opts.onAuthFail(); return { state: 'auth_redirect', polled: attempts }; }
      if (pr.ok && pr.body && pr.body.draft_ready) {
        renderForm(el, opts.mode, pr.body);
        return { state: 'ready', polled: attempts, body: pr.body };
      }
      res = pr.ok ? pr : res; // keep latest good payload for the timeout fallback
    }

    // Timeout: render with whatever we have so the user can complete manually
    // (covers the no-scan case where a draft never generates). Polling stops.
    renderForm(el, opts.mode, res.body || {});
    return { state: 'timeout', polled: attempts, body: res.body || null };
  }

  window.ProfileLoader = { start, _load: load, _resolveOpts: resolveOpts };
})();
