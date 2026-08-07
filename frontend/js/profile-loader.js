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

/* ==========================================================================
   Sidebar profile entry points (dashboard only)

   Reveals the PAID profile entry points off the user's EFFECTIVE PLAN:
     1. The native "Profile" nav item (#navVisibilityProfile) — the dashboard's
        own reveal keys solely off GET /api/profile's draft_config.draft_enabled,
        which resolves the plan ORG-FIRST server-side. For accounts whose org
        row is unprovisioned (org.plan 'free' / no org Stripe) while users.plan
        is paid — the same accounts that show hasV2Quota:false and 401/403 on
        entitlement endpoints — that response says draft_enabled:false and the
        nav never appears, even though the user is genuinely Pro.
     2. An injected "Set Up Profile" item that opens the intake/onboarding form
        (profile-setup.html) directly, independent of the completion-redirect
        gate (which stops routing to the intake once a profile is complete).

   Reveal condition (deliberately DECOUPLED from /api/competitors, citation, or
   any quota/entitlement call): paid = the /auth/me plan the dashboard caches in
   localStorage 'user' (starter/diy/pro/enterprise), OR the dashboard's own
   draft_config reveal having fired (covers org-resolved paid accounts whose
   users.plan is stale). Reveal-only: once shown, never re-hidden.

   Also unlocks the dashboard's Profile section gate (the script-global
   `visibilityProfileEnabled` lexical binding declared by dashboard.js) so the
   revealed native item opens the real profile section, not the upgrade lock.

   On pages without #navVisibilityProfile (e.g. profile-setup.html) this whole
   block is a no-op; for free users nothing is shown.
   ========================================================================== */
(function () {
  'use strict';
  var SETUP_ROUTE = '/profile-setup.html';
  // Paid tiers with a visibility profile — mirrors backend getDraftConfig()
  // (draft_enabled:true for starter/diy/pro/enterprise; freemium/free false).
  var PAID_PLANS = { starter: 1, diy: 1, pro: 1, enterprise: 1 };
  var POLL_MS = 500, MAX_POLLS = 40; // ~20s covers a slow /auth/me on login

  function planIsPaid(plan) {
    return PAID_PLANS[String(plan == null ? '' : plan).trim().toLowerCase()] === 1;
  }

  // Effective plan as the dashboard itself resolves it client-side: the
  // /auth/me user payload it writes to localStorage on every init.
  function storedUserIsPaid() {
    try {
      var u = JSON.parse(localStorage.getItem('user') || 'null');
      return !!(u && planIsPaid(u.plan));
    } catch (_) { return false; }
  }

  function inject() {
    var profileNav = document.getElementById('navVisibilityProfile');
    if (!profileNav) return;                       // not the dashboard — skip
    if (document.getElementById('navProfileSetup')) return; // already added

    var item = document.createElement('div');
    item.className = profileNav.className;          // match nav-item styling
    item.id = 'navProfileSetup';
    item.style.display = 'none';                    // hidden until proven paid
    item.addEventListener('click', function (e) {
      // Ours must win over the dashboard's generic .nav-item handler (which
      // would navigateToSection(null) since this item has no data-section).
      if (e && e.stopImmediatePropagation) e.stopImmediatePropagation();
      window.location.href = SETUP_ROUTE;
    });
    item.innerHTML = '<i class="fas fa-clipboard-list"></i><span>Set Up Profile</span>';
    profileNav.insertAdjacentElement('afterend', item);

    var revealed = false;
    var gateUnlocked = false;

    function unlockSectionGate() {
      if (gateUnlocked) return;
      // Script-global `let` from dashboard.js — shared lexical binding across
      // classic scripts. Throws only if dashboard.js hasn't executed yet (or
      // isn't on the page); retried from the poll until it sticks.
      try { visibilityProfileEnabled = true; gateUnlocked = true; } catch (_) {}
    }

    function maybeReveal() {
      if (!revealed) {
        var nativeShown = profileNav.style.display !== 'none';
        if (nativeShown || storedUserIsPaid()) {
          revealed = true;
          profileNav.style.display = '';
          item.style.display = '';
        }
      }
      if (revealed) unlockSectionGate();
      return revealed && gateUnlocked;
    }

    if (maybeReveal()) return;

    // The dashboard's own draft_config reveal may fire later — react instantly.
    var obs = null;
    try {
      obs = new MutationObserver(function () {
        if (maybeReveal() && obs) obs.disconnect();
      });
      obs.observe(profileNav, { attributes: true, attributeFilter: ['style'] });
    } catch (_) { /* MutationObserver unavailable — the poll still covers it */ }

    // /auth/me may not have written localStorage yet on a fresh login — poll
    // briefly. Also retries the section-gate unlock until dashboard.js has run.
    var polls = 0;
    var timer = setInterval(function () {
      polls++;
      if (maybeReveal() || polls >= MAX_POLLS) {
        clearInterval(timer);
        if (obs && revealed) obs.disconnect();
      }
    }, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
