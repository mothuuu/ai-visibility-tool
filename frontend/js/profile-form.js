/* ==========================================================================
   Visibility Profile Form — reusable render module
   Step 7: static scaffold.  Step 8: data-driven population + per-field states.

   window.ProfileForm.render(mountEl, { mode, data, config })  -> injects markup.
     mode   : 'onboarding' | 'edit'   (CTA label + header copy)
     data   : the GET /api/profile `profile` object (or null/{} -> empty form)
     config : the GET /api/profile `draft_config` object (or null)

   PURE: data in -> markup out. No fetching, no polling, no state (that's the
   loader). Still SCOPE-LIMITED to rendering: every control is present but
   NON-FUNCTIONAL (no event handlers) — interactivity is Step 9, progress/CTA
   enable is Step 10, submit is Step 11.

   Per-field visual state (Step 8): a field with an AI-provided value -> "AI";
   a REQUIRED field with no value -> "Required"; optional -> "Optional".

   Terminology: AI-populated content is "draft"/"suggestion", never
   "recommendation".
   ========================================================================== */
(function () {
  'use strict';

  const ICP_MAX = 5;
  const PROMPT_SOFT_CAP = 10;
  const DEFAULT_PRIORITY_FOCUS = 'All — optimize for the whole brand';

  // ---- html / value helpers ---------------------------------------------
  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const str = (v) => (v == null ? '' : String(v)).trim();
  const arr = (v) => (Array.isArray(v) ? v : []);

  // ICP / competitor entries may be plain strings or objects — extract text.
  const itemText = (it) =>
    typeof it === 'string' ? it : str(it && (it.text || it.label || it.name));

  // ---- per-field visual state -------------------------------------------
  // hasValue + aiEligible -> 'ai'; else required -> 'required'; else 'optional'.
  function fieldState({ hasValue, aiEligible, required }) {
    if (hasValue && aiEligible) return 'ai';
    if (required) return 'required';
    return 'optional';
  }

  const BADGE_META = {
    ai: ['vp-badge--ai', 'AI'],
    required: ['vp-badge--required', 'Required'],
    optional: ['vp-badge--optional', 'Optional'],
    locked: ['vp-badge--locked', 'Locked'],
  };
  const badge = (type, field) => {
    const [cls, label] = BADGE_META[type];
    const attr = field ? ` data-field-badge="${field}"` : '';
    return `<span class="vp-badge ${cls}"${attr}>${label}</span>`;
  };

  // Expose the pure state resolver for testing.
  function resolveStates(data) {
    const d = data || {};
    const has = (v) => str(v).length > 0;
    const hasList = (v) => arr(v).length > 0;
    return {
      display_name: fieldState({ hasValue: has(d.display_name), aiEligible: true, required: true }),
      company_name: fieldState({ hasValue: has(d.company_name), aiEligible: true, required: false }),
      industry: fieldState({ hasValue: has(d.industry), aiEligible: true, required: false }),
      location: fieldState({ hasValue: has(d.location), aiEligible: true, required: false }),
      business_description: fieldState({ hasValue: has(d.business_description), aiEligible: true, required: true }),
      icps: fieldState({ hasValue: hasList(d.icps), aiEligible: true, required: true }),
      competitors_business: fieldState({ hasValue: hasList(d.competitors_business), aiEligible: true, required: true }),
      competitors_visibility: fieldState({ hasValue: hasList(d.competitors_visibility), aiEligible: true, required: true }),
      prompts: fieldState({ hasValue: hasList(d.tracked_prompts), aiEligible: true, required: true }),
      avg_customer_value: 'optional',
      priority_focus: 'optional',
      domain: 'locked',
    };
  }

  // Format a tracked-prompt volume for the read-only chip.
  function formatVolume(volume) {
    if (typeof volume === 'number' && isFinite(volume)) return `~ ${volume.toLocaleString('en-US')} / mo`;
    const s = str(volume);
    return s || 'Volume pending';
  }

  // ---- section renderers -------------------------------------------------

  function sectionHeader(mode) {
    const subhead =
      mode === 'edit'
        ? 'Update anything that has changed. Edits are picked up by your next scan.'
        : "We've pre-filled what we could find. Confirm what's yours and answer the few things only you can.";
    return `
      <header class="vp-header">
        <h1>Set up your AI visibility profile</h1>
        <p class="vp-subhead">${esc(subhead)}</p>
        <div class="vp-legend" role="note">
          <span class="vp-legend-item">${badge('ai')} We drafted this from your scan — edit anything.</span>
          <span class="vp-legend-item">${badge('required')} Needed to build your dashboard.</span>
          <span class="vp-legend-item">${badge('optional')} Nice to have — you can skip it.</span>
        </div>
      </header>`;
  }

  // 1. What should I call you?
  function sectionCallYou(d, st) {
    return `
      <section class="vp-section" data-section="call-you">
        <div class="vp-section-head">
          <h2 class="vp-section-title">What should I call you? ${badge(st.display_name, 'display_name')}</h2>
        </div>
        <div class="vp-field">
          <input class="vp-input" type="text" data-field="display_name" value="${esc(str(d.display_name))}" placeholder="Your name" />
        </div>
      </section>`;
  }

  // 2. The basics (2-col grid of 4)
  function sectionBasics(d, st) {
    return `
      <section class="vp-section" data-section="basics">
        <div class="vp-section-head">
          <h2 class="vp-section-title">The basics ${badge('ai')}</h2>
        </div>
        <div class="vp-grid-2">
          <div class="vp-field">
            <label class="vp-label">Domain ${badge('locked')}</label>
            <input class="vp-input vp-input--locked" type="text" value="${esc(str(d.domain))}" placeholder="—" readonly />
          </div>
          <div class="vp-field">
            <label class="vp-label">Company name ${badge(st.company_name, 'company_name')}</label>
            <input class="vp-input" type="text" data-field="company_name" value="${esc(str(d.company_name))}" placeholder="Your company" />
          </div>
          <div class="vp-field">
            <label class="vp-label">Industry ${badge(st.industry, 'industry')}</label>
            <input class="vp-input" type="text" data-field="industry" value="${esc(str(d.industry))}" placeholder="e.g. Marketing technology" />
          </div>
          <div class="vp-field">
            <label class="vp-label">Location ${badge(st.location, 'location')}</label>
            <input class="vp-input" type="text" data-field="location" value="${esc(str(d.location))}" placeholder="e.g. Berlin, Germany" />
          </div>
        </div>
      </section>`;
  }

  // 3. Tell us about your business
  function sectionAbout(d, st) {
    return `
      <section class="vp-section" data-section="about">
        <div class="vp-section-head">
          <h2 class="vp-section-title">Tell us about your business ${badge(st.business_description, 'business_description')}</h2>
        </div>
        <div class="vp-field">
          <textarea class="vp-textarea" rows="5" data-field="business_description" placeholder="A sentence or two about what you do and who you serve.">${esc(str(d.business_description))}</textarea>
        </div>
      </section>`;
  }

  // 4. Who are you reaching in AI answers? (ICPs)
  function sectionIcps(d, st) {
    const icps = arr(d.icps);
    const remaining = Math.max(0, ICP_MAX - icps.length);
    const rows = icps
      .map((it) => {
        const selected = typeof it === 'object' && it && it.selected === false ? '' : 'checked';
        return `
          <div class="vp-icp-row">
            <input class="vp-checkbox" type="checkbox" ${selected} />
            <input class="vp-input" type="text" value="${esc(itemText(it))}" />
            <button class="vp-icon-btn vp-icon-btn--danger" type="button" title="Remove" aria-label="Remove">
              <i class="fas fa-times"></i>
            </button>
          </div>`;
      })
      .join('');
    const emptyHint = icps.length === 0
      ? `<p class="vp-hint">No audiences yet — add the ones whose questions you want to win.</p>`
      : '';
    return `
      <section class="vp-section" data-section="icps">
        <div class="vp-section-head">
          <h2 class="vp-section-title">Who are you reaching in AI answers? ${badge(st.icps)}</h2>
          <p class="vp-section-sub">Pick the audiences whose questions you want to win. Up to ${ICP_MAX}.</p>
        </div>
        <div class="vp-list">${rows}</div>
        ${emptyHint}
        <button class="vp-add-btn" type="button">
          <i class="fas fa-plus"></i> Add another <span class="vp-add-remaining">(${remaining} remaining)</span>
        </button>
      </section>`;
  }

  // 5. Your competitive landscape (two columns)
  function competitorColumn(title, sub, items) {
    const rows = arr(items)
      .map(
        (it, i) => `
          <div class="vp-comp-row">
            <span class="vp-priority">${i + 1}</span>
            <input class="vp-input" type="text" value="${esc(itemText(it))}" />
            <span class="vp-chevrons">
              <button class="vp-chev" type="button" title="Move up" aria-label="Move up"><i class="fas fa-chevron-up"></i></button>
              <button class="vp-chev" type="button" title="Move down" aria-label="Move down"><i class="fas fa-chevron-down"></i></button>
            </span>
            <button class="vp-icon-btn vp-icon-btn--danger" type="button" title="Delete" aria-label="Delete">
              <i class="fas fa-trash"></i>
            </button>
          </div>`
      )
      .join('');
    return `
      <div class="vp-comp-col">
        <p class="vp-comp-col-head">${esc(title)}</p>
        <p class="vp-comp-col-sub">${esc(sub)}</p>
        ${rows}
        <button class="vp-add-btn" type="button"><i class="fas fa-plus"></i> Add</button>
      </div>`;
  }

  function sectionCompetitors(d, st) {
    return `
      <section class="vp-section" data-section="competitors">
        <div class="vp-section-head">
          <h2 class="vp-section-title">Your competitive landscape ${badge(st.competitors_business)}</h2>
        </div>
        <div class="vp-comp-cols">
          ${competitorColumn('Business competitors', 'Real-world rivals you compete with.', d.competitors_business)}
          ${competitorColumn('AI visibility competitors', 'Sources and lists AI models cite as authorities.', d.competitors_visibility)}
        </div>
      </section>`;
  }

  // 6. Top queries in your vertical (prompts)
  function sectionPrompts(d, st) {
    const prompts = arr(d.tracked_prompts);
    const rows = prompts
      .map(
        (p) => `
          <div class="vp-prompt-row">
            <input class="vp-input" type="text" value="${esc(itemText(p))}" />
            <span class="vp-volume">${esc(formatVolume(p && p.volume))}</span>
            <button class="vp-icon-btn vp-icon-btn--danger" type="button" title="Delete" aria-label="Delete">
              <i class="fas fa-trash"></i>
            </button>
          </div>`
      )
      .join('');
    const emptyHint = prompts.length === 0
      ? `<p class="vp-hint">No queries yet — add the prompts you want to track.</p>`
      : '';
    return `
      <section class="vp-section" data-section="prompts">
        <div class="vp-section-head">
          <h2 class="vp-section-title">Top queries in your vertical ${badge(st.prompts)}</h2>
          <p class="vp-section-sub">These will be the discovery prompts we track across ChatGPT, Claude, Perplexity, and Gemini.</p>
        </div>
        <div class="vp-list">${rows}</div>
        ${emptyHint}
        <button class="vp-add-btn" type="button">
          <i class="fas fa-plus"></i> Add <span class="vp-add-remaining">(up to ${PROMPT_SOFT_CAP})</span>
        </button>
      </section>`;
  }

  // 7. A few extras (optional)
  function sectionExtras(d) {
    const priorityFocus = str(d.priority_focus) || DEFAULT_PRIORITY_FOCUS;
    return `
      <section class="vp-section" data-section="extras">
        <div class="vp-section-head">
          <h2 class="vp-section-title">A few extras ${badge('optional')}</h2>
        </div>
        <div class="vp-field" style="margin-bottom:18px;">
          <label class="vp-label">What is an average customer worth to you?</label>
          <input class="vp-input" type="text" data-field="avg_customer_value" value="${esc(str(d.avg_customer_value))}" placeholder="e.g. $5,000 / year" />
          <p class="vp-hint">Helps us prioritize findings tied to higher-value queries.</p>
        </div>
        <div class="vp-field">
          <label class="vp-label">Any specific product or service you want to prioritize?</label>
          <input class="vp-input" type="text" data-field="priority_focus" value="${esc(priorityFocus)}" />
          <p class="vp-hint">Leave as is to optimize across your whole brand.</p>
        </div>
      </section>`;
  }

  // 8. CTA row
  function sectionCta(mode) {
    const label = mode === 'edit' ? 'Save' : 'Build my dashboard →';
    return `
      <div class="vp-cta-row" data-section="cta">
        <span class="vp-progress">0 of 5 required fields ready · 0 of 2 optional answered</span>
        <button class="vp-cta" type="button" disabled>${esc(label)}</button>
      </div>`;
  }

  // ---- working-profile state model (Step 9a) ----------------------------
  // ONE in-memory object initialized from the loaded GET data. All controls
  // read their initial values from it and write edits back to it. Lists are
  // copied (not aliased to the GET payload) so 9b/9c can mutate them freely.
  // Step 11 serializes this to POST /api/profile.
  function createWorkingProfile(data) {
    const d = data || {};
    return {
      display_name: str(d.display_name),
      company_name: str(d.company_name),
      industry: str(d.industry),
      location: str(d.location),
      business_description: str(d.business_description),
      avg_customer_value: str(d.avg_customer_value),
      priority_focus: str(d.priority_focus) || DEFAULT_PRIORITY_FOCUS,
      // List sections — mutated by Step 9b (icps, tracked_prompts) and
      // Step 9c (competitors_*). Deep-ish copies so edits never touch GET data.
      icps: arr(d.icps).map((it) => (it && typeof it === 'object' ? { ...it } : it)),
      competitors_business: arr(d.competitors_business).map((it) => (it && typeof it === 'object' ? { ...it } : it)),
      competitors_visibility: arr(d.competitors_visibility).map((it) => (it && typeof it === 'object' ? { ...it } : it)),
      tracked_prompts: arr(d.tracked_prompts).map((p) => (p && typeof p === 'object' ? { ...p } : p)),
      // Read-only mirror for render; NOT an editable field (no domain column).
      domain: str(d.domain),
    };
  }

  // Simple fields whose badge flips between AI/Required (or Optional) on edit.
  const FLIP_SPEC = {
    display_name: { aiEligible: true, required: true },
    company_name: { aiEligible: true, required: false },
    industry: { aiEligible: true, required: false },
    location: { aiEligible: true, required: false },
    business_description: { aiEligible: true, required: true },
  };

  // Resolve the badge type for a single simple field given its current value.
  function simpleFieldState(field, value) {
    const spec = FLIP_SPEC[field];
    if (!spec) return 'optional';
    return fieldState({ hasValue: str(value).length > 0, aiEligible: spec.aiEligible, required: spec.required });
  }

  // Swap a field's pill badge in place to reflect its current value.
  function updateFieldBadge(el, field, value) {
    if (!FLIP_SPEC[field]) return; // optional fields never flip
    const badgeEl = el.querySelector('[data-field-badge="' + field + '"]');
    if (!badgeEl) return;
    const [cls, label] = BADGE_META[simpleFieldState(field, value)];
    badgeEl.className = 'vp-badge ' + cls;
    badgeEl.textContent = label;
  }

  // Bind change handlers for the SIMPLE fields (domain is locked → unbound).
  function bindSimpleFields(el, state) {
    const controls = el.querySelectorAll('[data-field]');
    Array.prototype.forEach.call(controls, (input) => {
      const field = input.getAttribute('data-field');
      const onEdit = () => {
        state[field] = input.value;
        updateFieldBadge(el, field, input.value);
      };
      input.addEventListener('input', onEdit);
      input.addEventListener('change', onEdit);
    });
  }

  // Working-profile accessor (Step 11 reads this to serialize).
  function getState(mountEl) {
    const el = typeof mountEl === 'string' ? document.querySelector(mountEl) : mountEl;
    return (el && el.__vpProfileState) || null;
  }

  // ---- public render -----------------------------------------------------
  function render(mountEl, opts) {
    const el = typeof mountEl === 'string' ? document.querySelector(mountEl) : mountEl;
    if (!el) {
      console.error('[ProfileForm] mount element not found');
      return;
    }
    const o = opts || {};
    const mode = o.mode === 'edit' ? 'edit' : 'onboarding';

    // Build the working-profile state, then render FROM it (controls read their
    // initial values from state; edits write back to the same object).
    const state = createWorkingProfile(o.data || {});
    const st = resolveStates(state);

    el.classList.add('vp-scope');
    el.innerHTML = `
      <div class="vp-form" data-mode="${mode}">
        ${sectionHeader(mode)}
        ${sectionCallYou(state, st)}
        ${sectionBasics(state, st)}
        ${sectionAbout(state, st)}
        ${sectionIcps(state, st)}
        ${sectionCompetitors(state, st)}
        ${sectionPrompts(state, st)}
        ${sectionExtras(state)}
        ${sectionCta(mode)}
      </div>`;

    el.__vpProfileState = state;     // single source of truth for edits
    bindSimpleFields(el, state);     // wire simple-field editing
    return state;
  }

  window.ProfileForm = {
    render,
    resolveStates,
    formatVolume,
    createWorkingProfile,
    simpleFieldState,
    getState,
  };
})();
