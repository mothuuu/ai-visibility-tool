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

  // ICP / competitor / prompt entries may be plain strings or objects, and the
  // generators accept several key aliases for the text/name (text|query|prompt,
  // name|title|company|brand|source|publication). Mirror those here so stored
  // items always render regardless of which key holds the value.
  const itemText = (it) =>
    typeof it === 'string'
      ? it
      : str(it && (it.text || it.query || it.prompt || it.name || it.label || it.title || it.company || it.brand || it.source || it.publication));

  // Pull a competitor's url, mirroring the generators' url aliases.
  const itemUrl = (it) =>
    it && typeof it === 'object' ? cleanUrl(it.url || it.website || it.link || it.homepage) : null;

  // Normalize list items into the fixed working-profile shapes (Step 9b).
  // ICP item: { text, selected }.  Prompt item: { text, volume, is_monitored }.
  function normalizeIcp(it) {
    if (it && typeof it === 'object') return { text: itemText(it), selected: it.selected !== false };
    return { text: str(it), selected: true };
  }
  function normalizePromptItem(p) {
    if (p && typeof p === 'object') {
      return { text: itemText(p), volume: p.volume == null ? null : p.volume, is_monitored: p.is_monitored !== false, funnel_stage: normalizeFunnelStage(p.funnel_stage) };
    }
    return { text: str(p), volume: null, is_monitored: true, funnel_stage: null };
  }
  // Competitor item: { name, url }. Priority IS the array index + 1 (no stored field).
  function normalizeCompetitor(it) {
    if (it && typeof it === 'object') return { name: itemText(it), url: itemUrl(it) };
    return { name: str(it), url: null };
  }

  // url: trimmed non-empty string (lenient — no format enforcement), else null.
  function cleanUrl(v) {
    const s = str(v);
    return s || null;
  }

  // funnel stage: TOFU/MOFU/BOFU (case-insensitive), else null (untagged).
  const PROMPT_STAGE_KEYS = ['TOFU', 'MOFU', 'BOFU'];
  const COMP_MAX = 5; // hard cap per competitor column
  function normalizeFunnelStage(v) {
    const s = str(v).toUpperCase();
    return PROMPT_STAGE_KEYS.indexOf(s) !== -1 ? s : null;
  }

  // Competitor column wiring: data-col key -> state array; plus its opposite + label.
  const COMP_COLS = { business: 'competitors_business', visibility: 'competitors_visibility' };
  const COMP_OTHER = { business: 'visibility', visibility: 'business' };
  const COMP_LABEL = { business: 'business competitors', visibility: 'AI visibility competitors' };

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

  // Required-list badge: has items -> AI, empty -> Required (mirrors resolveStates).
  const listBadgeType = (hasItems) => (hasItems ? 'ai' : 'required');

  // 4. Who are you reaching in AI answers? (ICPs)
  // Inner markup is re-rendered on add/remove from state (single source of truth).
  function icpsInner(state) {
    const icps = arr(state.icps);
    const remaining = Math.max(0, ICP_MAX - icps.length);
    const atMax = icps.length >= ICP_MAX;
    const rows = icps
      .map(
        (it, i) => `
          <div class="vp-icp-row" data-idx="${i}">
            <input class="vp-checkbox" type="checkbox" data-act="icp-toggle" ${it.selected !== false ? 'checked' : ''} />
            <input class="vp-input" type="text" data-act="icp-text" value="${esc(itemText(it))}" />
            <button class="vp-icon-btn vp-icon-btn--danger" type="button" data-act="icp-remove" title="Remove" aria-label="Remove">
              <i class="fas fa-times"></i>
            </button>
          </div>`
      )
      .join('');
    const emptyHint = icps.length === 0
      ? `<p class="vp-hint">No audiences yet — add the ones whose questions you want to win.</p>`
      : '';
    const addBtn = atMax
      ? `<button class="vp-add-btn" type="button" data-act="icp-add" disabled>
           <i class="fas fa-plus"></i> Add another <span class="vp-add-remaining">(max ${ICP_MAX} reached)</span>
         </button>`
      : `<button class="vp-add-btn" type="button" data-act="icp-add">
           <i class="fas fa-plus"></i> Add another <span class="vp-add-remaining">(${remaining} remaining)</span>
         </button>`;
    return `
      <div class="vp-section-head">
        <h2 class="vp-section-title">Who are you reaching in AI answers? ${badge(listBadgeType(icps.length > 0), 'icps')}</h2>
        <p class="vp-section-sub">Pick the audiences whose questions you want to win. Up to ${ICP_MAX}.</p>
      </div>
      <div class="vp-list">${rows}</div>
      ${emptyHint}
      ${addBtn}`;
  }

  function sectionIcps(state) {
    return `<section class="vp-section" data-section="icps">${icpsInner(state)}</section>`;
  }

  // 5. Your competitive landscape (two columns). Priority = array index + 1,
  // renumbered on every mutation. Re-rendered from state (single source).
  function competitorColumn(col, title, sub, items) {
    const list = arr(items);
    const otherLabel = COMP_LABEL[COMP_OTHER[col]];
    const atMax = list.length >= COMP_MAX;
    const rows = list
      .map(
        (it, i) => `
          <div class="vp-comp-row" data-idx="${i}">
            <span class="vp-priority" title="Priority ${i + 1}">${i + 1}</span>
            <div class="vp-comp-fields">
              <input class="vp-input" type="text" data-act="comp-name" value="${esc(it.name)}" placeholder="Competitor name" />
              <input class="vp-input vp-comp-url" type="text" data-act="comp-url" value="${esc(it.url || '')}" placeholder="Website (optional)" />
            </div>
            <span class="vp-chevrons">
              <button class="vp-chev" type="button" data-act="comp-up" title="Move up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}><i class="fas fa-chevron-up"></i></button>
              <button class="vp-chev" type="button" data-act="comp-down" title="Move down" aria-label="Move down" ${i === list.length - 1 ? 'disabled' : ''}><i class="fas fa-chevron-down"></i></button>
            </span>
            <button class="vp-icon-btn" type="button" data-act="comp-move" title="Move to ${esc(otherLabel)}" aria-label="Move to ${esc(otherLabel)}">
              <i class="fas fa-right-left"></i>
            </button>
            <button class="vp-icon-btn vp-icon-btn--danger" type="button" data-act="comp-delete" title="Delete" aria-label="Delete">
              <i class="fas fa-trash"></i>
            </button>
          </div>`
      )
      .join('');
    const addBtn = atMax
      ? `<button class="vp-add-btn" type="button" data-act="comp-add" disabled><i class="fas fa-plus"></i> Add <span class="vp-add-remaining">(max ${COMP_MAX} reached)</span></button>`
      : `<button class="vp-add-btn" type="button" data-act="comp-add"><i class="fas fa-plus"></i> Add</button>`;
    return `
      <div class="vp-comp-col" data-col="${col}">
        <p class="vp-comp-col-head">${esc(title)}</p>
        <p class="vp-comp-col-sub">${esc(sub)}</p>
        ${rows}
        ${addBtn}
      </div>`;
  }

  function competitorsInner(state) {
    const filled = arr(state.competitors_business).length > 0 && arr(state.competitors_visibility).length > 0;
    return `
      <div class="vp-section-head">
        <h2 class="vp-section-title">Your competitive landscape ${badge(listBadgeType(filled), 'competitors')}</h2>
        <p class="vp-section-sub">Order sets priority — 1 is highest. Use the arrows to reorder. Up to ${COMP_MAX} per column; website is optional.</p>
      </div>
      <div class="vp-comp-cols">
        ${competitorColumn('business', 'Business competitors', 'Real-world rivals you compete with.', state.competitors_business)}
        ${competitorColumn('visibility', 'AI visibility competitors', 'Sources and lists AI models cite as authorities.', state.competitors_visibility)}
      </div>`;
  }

  function sectionCompetitors(state) {
    return `<section class="vp-section" data-section="competitors">${competitorsInner(state)}</section>`;
  }

  // Monitoring-cap display text. null cap (Enterprise) -> custom / no numeric limit.
  function monitoringCapText(state, config) {
    const monitored = arr(state.tracked_prompts).filter((p) => p && p.is_monitored).length;
    const cap = config ? config.monitoring_cap : null;
    if (cap == null) return `Tracking ${monitored} (custom — no limit)`;
    return `Tracking ${monitored} of up to ${cap}`;
  }

  // Funnel-stage groups for the prompts section (labels shown in the UI).
  const PROMPT_GROUPS = [
    { key: 'TOFU', label: 'TOFU · Awareness' },
    { key: 'MOFU', label: 'MOFU · Comparison' },
    { key: 'BOFU', label: 'BOFU · Decision' },
  ];

  // One prompt row. `i` is the index in the flat state.tracked_prompts array
  // (grouping is purely presentational; state stays a single ordered list).
  function promptRow(p, i) {
    const stage = p.funnel_stage || '';
    const opt = (v, l) => `<option value="${v}" ${stage === v ? 'selected' : ''}>${l}</option>`;
    return `
      <div class="vp-prompt-row" data-idx="${i}">
        <input class="vp-checkbox" type="checkbox" data-act="prompt-monitor" title="Monitor this query" aria-label="Monitor this query" ${p.is_monitored ? 'checked' : ''} />
        <input class="vp-input" type="text" data-act="prompt-text" value="${esc(itemText(p))}" />
        <select class="vp-stage-select" data-act="prompt-stage" title="Funnel stage" aria-label="Funnel stage">
          ${stage === '' ? '<option value="" selected>Untagged</option>' : ''}
          ${opt('TOFU', 'TOFU')}${opt('MOFU', 'MOFU')}${opt('BOFU', 'BOFU')}
        </select>
        <span class="vp-volume">${esc(formatVolume(p && p.volume))}</span>
        <button class="vp-icon-btn vp-icon-btn--danger" type="button" data-act="prompt-delete" title="Delete" aria-label="Delete">
          <i class="fas fa-trash"></i>
        </button>
      </div>`;
  }

  // 6. Top queries in your vertical (prompts) — grouped by funnel stage.
  // Inner markup re-renders from state on add/delete/monitor-toggle/re-tag.
  function promptsInner(state, config, ui) {
    const prompts = arr(state.tracked_prompts);
    const atCap = prompts.length >= PROMPT_SOFT_CAP;
    const indexed = prompts.map((p, i) => ({ p, i }));

    const groupsHtml = PROMPT_GROUPS.map((g) => {
      const items = indexed.filter(({ p }) => (p.funnel_stage || null) === g.key);
      const rows = items.map(({ p, i }) => promptRow(p, i)).join('') || '<p class="vp-hint vp-group-empty">None yet.</p>';
      const addBtn = atCap
        ? `<button class="vp-add-btn" type="button" data-act="prompt-add" data-stage="${g.key}" disabled><i class="fas fa-plus"></i> Add to ${g.key} <span class="vp-add-remaining">(max ${PROMPT_SOFT_CAP})</span></button>`
        : `<button class="vp-add-btn" type="button" data-act="prompt-add" data-stage="${g.key}"><i class="fas fa-plus"></i> Add to ${g.key}</button>`;
      return `
        <div class="vp-prompt-group" data-stage="${g.key}">
          <div class="vp-prompt-group-head">${g.label} <span class="vp-group-count">(${items.length})</span></div>
          <div class="vp-list">${rows}</div>
          ${addBtn}
        </div>`;
    }).join('');

    const untagged = indexed.filter(({ p }) => !p.funnel_stage);
    const untaggedHtml = untagged.length
      ? `<div class="vp-prompt-group" data-stage="untagged">
           <div class="vp-prompt-group-head">Untagged <span class="vp-group-count">(${untagged.length})</span></div>
           <div class="vp-list">${untagged.map(({ p, i }) => promptRow(p, i)).join('')}</div>
         </div>`
      : '';

    const capHint = ui && ui.promptCapHint && config && config.monitoring_cap != null
      ? `<p class="vp-hint vp-cap-hint">You can monitor up to ${config.monitoring_cap} queries on your plan. Turn one off first.</p>`
      : '';
    // Token pop-up CTA — visible only on plans with token_query_unlock_enabled.
    const tokenCta = config && config.token_query_unlock_enabled
      ? `<button class="vp-token-cta" type="button" data-act="token-cta">
           <i class="fas fa-unlock"></i> See all your queries + volumes
         </button>`
      : '';
    return `
      <div class="vp-section-head">
        <h2 class="vp-section-title">Top queries in your vertical ${badge(listBadgeType(prompts.length > 0), 'prompts')}</h2>
        <p class="vp-section-sub">These will be the discovery prompts we track across ChatGPT, Claude, Perplexity, and Gemini. Grouped by funnel stage — re-tag with the dropdown.</p>
      </div>
      <div class="vp-monitor-cap" data-monitor-cap>${esc(monitoringCapText(state, config))}</div>
      ${capHint}
      ${groupsHtml}
      ${untaggedHtml}
      <div class="vp-prompt-actions">
        ${tokenCta}
      </div>`;
  }

  function sectionPrompts(state, config, ui) {
    return `<section class="vp-section" data-section="prompts">${promptsInner(state, config, ui)}</section>`;
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
      <div data-section="cta">
        <div class="vp-cta-row">
          <span class="vp-progress">0 of 6 required fields ready · 0 of 2 optional answered</span>
          <button class="vp-cta" type="button" data-cta-label="${esc(label)}" disabled>${esc(label)}</button>
        </div>
        <p class="vp-cta-reason" style="display:none"></p>
        <p class="vp-submit-msg" role="status" style="display:none"></p>
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
      // Step 9c (competitors_*). Normalized to fixed item shapes; copies so
      // edits never touch the GET payload.
      icps: arr(d.icps).map(normalizeIcp),
      competitors_business: arr(d.competitors_business).map(normalizeCompetitor),
      competitors_visibility: arr(d.competitors_visibility).map(normalizeCompetitor),
      tracked_prompts: arr(d.tracked_prompts).map(normalizePromptItem),
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

  // ---- progress + CTA readiness (Step 10) -------------------------------
  // MIRRORS Step 5's server validateProfilePayload EXACTLY so an enabled CTA
  // always corresponds to a payload the server would accept. Step 5 is lenient:
  // icps / competitors_* require only array length >= 1 (no selected/name check);
  // prompts require length >= 3 AND every prompt has non-empty text; the cap rule
  // is monitored(is_monitored===true) count <= monitoring_cap (skipped when null).
  const hasText = (v) => str(typeof v === 'string' ? v : (v && v.text)).length > 0;

  function evaluateReadiness(state, config) {
    const s = state || {};
    const icps = arr(s.icps);
    const cb = arr(s.competitors_business);
    const cv = arr(s.competitors_visibility);
    const prompts = arr(s.tracked_prompts);

    // ICP counts only when selected AND non-empty text; competitor only when it
    // has a non-empty name. Mirrors Step 5's server validation verbatim.
    const icpOk = (it) => {
      const text = typeof it === 'string' ? it : (it && it.text);
      const selected = typeof it === 'string' ? true : !!(it && it.selected);
      return selected && str(text).length > 0;
    };
    const namedOk = (it) => str(typeof it === 'string' ? it : (it && it.name)).length > 0;

    // Required FIELD rules (denominator of "N of N required fields ready").
    const rules = [
      { key: 'display_name', ok: str(s.display_name).length > 0 },
      { key: 'business_description', ok: str(s.business_description).length > 0 },
      { key: 'icps', ok: icps.some(icpOk) },
      { key: 'competitors_business', ok: cb.some(namedOk) },
      { key: 'competitors_visibility', ok: cv.some(namedOk) },
      { key: 'tracked_prompts', ok: prompts.length >= 3 && prompts.every(hasText) },
    ];
    const readyCount = rules.filter((r) => r.ok).length;
    const total = rules.length; // derived from the rule set, not hardcoded

    // Monitoring cap — a constraint (mirrors Step 5), folded into allReady but
    // NOT counted as a "field" (it's a cap, not something to fill). Already
    // enforced live in 9b, so it can only fail on pre-over-cap loaded data.
    const cap = config ? config.monitoring_cap : null;
    const monitoredCount = prompts.filter((p) => p && typeof p === 'object' && p.is_monitored === true).length;
    const capOk = cap == null || monitoredCount <= cap;

    const allReady = readyCount === total && capOk;

    // Optional answered (cosmetic): avg non-empty; priority_focus changed from
    // the untouched default.
    const optionalAnswered =
      (str(s.avg_customer_value).length > 0 ? 1 : 0) +
      (str(s.priority_focus).length > 0 && str(s.priority_focus) !== DEFAULT_PRIORITY_FOCUS ? 1 : 0);

    return { rules, readyCount, total, capOk, allReady, optionalAnswered, optionalTotal: 2, cap, monitoredCount };
  }

  // Recompute the progress line + CTA disabled state from current state. Single
  // entry point called after EVERY mutation (and on initial render).
  function recomputeProgress(mountEl) {
    const el = typeof mountEl === 'string' ? document.querySelector(mountEl) : mountEl;
    if (!el || !el.__vpProfileState) return null;
    const r = evaluateReadiness(el.__vpProfileState, el.__vpConfig);
    const progressEl = el.querySelector('.vp-progress');
    if (progressEl) {
      progressEl.textContent =
        `${r.readyCount} of ${r.total} required fields ready · ${r.optionalAnswered} of ${r.optionalTotal} optional answered`;
    }
    const cta = el.querySelector('.vp-cta');
    // Stay disabled while a submit is in flight; otherwise gate on readiness.
    if (cta) cta.disabled = el.__vpSubmitting ? true : !r.allReady;

    // Over-cap CTA reason — shown ONLY when the cap is the specific blocker
    // (all field rules pass but monitored count exceeds the cap, e.g. a plan
    // downgrade). Not shown for ordinary field shortfalls.
    const reasonEl = el.querySelector('.vp-cta-reason');
    if (reasonEl) {
      if (r.readyCount === r.total && !r.capOk && r.cap != null) {
        const over = r.monitoredCount - r.cap;
        reasonEl.textContent = `Monitoring ${r.monitoredCount} of ${r.cap} allowed — unmonitor ${over} to continue.`;
        reasonEl.style.display = '';
      } else {
        reasonEl.textContent = '';
        reasonEl.style.display = 'none';
      }
    }
    return r;
  }

  // ---- submit / save flow (Step 11) -------------------------------------

  // Serialize the working profile into POST /api/profile's body (Step 5).
  // domain is EXCLUDED (no column). Sends full icps/competitors/prompts arrays.
  function serializeProfile(s) {
    const st0 = s || {};
    return {
      display_name: str(st0.display_name),
      company_name: str(st0.company_name),
      industry: str(st0.industry),
      location: str(st0.location),
      business_description: str(st0.business_description),
      icps: arr(st0.icps).map((it) => ({ text: str(it && it.text), selected: !!(it && it.selected) })),
      competitors_business: arr(st0.competitors_business).map((it) => ({ name: str(it && it.name), url: cleanUrl(it && it.url) })),
      competitors_visibility: arr(st0.competitors_visibility).map((it) => ({ name: str(it && it.name), url: cleanUrl(it && it.url) })),
      tracked_prompts: arr(st0.tracked_prompts).map((p) => ({
        text: str(p && p.text),
        funnel_stage: normalizeFunnelStage(p && p.funnel_stage),
        volume: p && p.volume != null ? p.volume : null,
        is_monitored: !!(p && p.is_monitored),
      })),
      avg_customer_value: str(st0.avg_customer_value),
      priority_focus: str(st0.priority_focus),
    };
  }

  function resolveSubmitOpts(sub) {
    const o = sub || {};
    return {
      apiBaseUrl: o.apiBaseUrl || (typeof window !== 'undefined' && window.API_BASE_URL) || '/api',
      fetchImpl: o.fetchImpl || (typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null),
      getToken: o.authToken != null
        ? () => o.authToken
        : () => (typeof localStorage !== 'undefined' ? localStorage.getItem('authToken') : null),
      redirect: o.redirect || ((url) => { if (typeof window !== 'undefined') window.location.href = url; }),
      onAuthFail: o.onAuthFail || (() => { if (typeof window !== 'undefined') window.location.href = 'auth.html'; }),
    };
  }

  const CTA_LABEL = { onboarding: 'Build my dashboard →', edit: 'Save' };
  const CTA_BUSY = { onboarding: 'Building your dashboard…', edit: 'Saving…' };

  function setCtaBusy(el, busy) {
    const cta = el.querySelector('.vp-cta');
    if (!cta) return;
    const mode = el.__vpMode === 'edit' ? 'edit' : 'onboarding';
    if (busy) {
      cta.disabled = true;
      cta.textContent = CTA_BUSY[mode];
    } else {
      cta.textContent = CTA_LABEL[mode];
      recomputeProgress(el); // restores disabled = !allReady
    }
  }

  function setSubmitMsg(el, type, text) {
    const m = el.querySelector('.vp-submit-msg');
    if (!m) return;
    if (!text) { m.textContent = ''; m.style.display = 'none'; m.className = 'vp-submit-msg'; return; }
    m.textContent = text;
    m.className = 'vp-submit-msg vp-submit-msg--' + type;
    m.style.display = '';
  }

  // CTA submit handler — active only when the CTA is enabled. Edits are NEVER
  // wiped: state is untouched on every error path.
  async function submitProfile(mountEl) {
    const el = typeof mountEl === 'string' ? document.querySelector(mountEl) : mountEl;
    if (!el || !el.__vpProfileState) return;
    const cta = el.querySelector('.vp-cta');
    if (!cta || cta.disabled) return;       // enabled-only
    if (el.__vpSubmitting) return;          // in-flight guard (no double-submit)
    // Safety: never submit an incomplete/over-cap profile.
    if (!evaluateReadiness(el.__vpProfileState, el.__vpConfig).allReady) return;

    const mode = el.__vpMode === 'edit' ? 'edit' : 'onboarding';
    const sub = el.__vpSubmit || resolveSubmitOpts(null);
    if (!sub.fetchImpl) { console.error('[ProfileForm] no fetch available'); return; }

    el.__vpSubmitting = true;
    setSubmitMsg(el, null);
    setCtaBusy(el, true);

    let resp;
    try {
      const token = sub.getToken();
      resp = await sub.fetchImpl(`${sub.apiBaseUrl}/profile`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
        body: JSON.stringify(serializeProfile(el.__vpProfileState)),
      });
    } catch (err) {
      // Network failure — edits preserved, recoverable, re-enable for retry.
      el.__vpSubmitting = false;
      setCtaBusy(el, false);
      setSubmitMsg(el, 'error', 'Network error. Your changes are safe — please try again.');
      return { state: 'error', error: String(err && err.message || err) };
    }

    if (resp.status === 401) {
      sub.onAuthFail(); // edits preserved (state untouched); leave CTA busy during redirect
      return { state: 'auth_redirect' };
    }

    if (resp.ok) {
      if (mode === 'onboarding') {
        sub.redirect('dashboard.html'); // Step 6 gate now passes; keep CTA busy during redirect
        return { state: 'redirect' };
      }
      // edit: stay on page, confirm, restore CTA
      el.__vpSubmitting = false;
      setCtaBusy(el, false);
      setSubmitMsg(el, 'success', 'Saved — changes apply to your next scan and monitoring run.');
      return { state: 'saved' };
    }

    // Non-OK: edits preserved, re-enable for retry.
    let body = null;
    try { body = await resp.json(); } catch (_) { /* non-JSON */ }
    el.__vpSubmitting = false;
    setCtaBusy(el, false);
    if (resp.status === 400 && body && Array.isArray(body.fields)) {
      // Defensive — lockstep validation should prevent reaching here.
      const msg = body.fields.map((f) => f.message).join(' · ');
      setSubmitMsg(el, 'error', 'Please fix: ' + msg);
      return { state: 'validation_error', fields: body.fields };
    }
    setSubmitMsg(el, 'error', 'Something went wrong saving your profile. Please try again.');
    return { state: 'error', status: resp.status };
  }

  // Bind the CTA click once via delegation on the mount (survives re-renders).
  function bindCta(el) {
    if (el.__vpCtaBound) return;
    el.addEventListener('click', (e) => {
      const cta = e.target.closest && e.target.closest('.vp-cta');
      if (cta) submitProfile(el);
    });
    el.__vpCtaBound = true;
  }

  // ---- list section editing (Step 9b: ICPs + prompts) -------------------

  // Placeholder for Walther's separate token-inquiry feature. Step 9b only
  // wires the CTA to this stub — it does NOT implement the real flow.
  function onTokenQueryUnlockRequested(ctx) {
    console.log('[ProfileForm] Token query-unlock requested (placeholder — Walther feature).', ctx || {});
  }

  function rerenderIcps(el) {
    const section = el.querySelector('[data-section="icps"]');
    if (section) section.innerHTML = icpsInner(el.__vpProfileState);
    recomputeProgress(el);
  }
  function rerenderPrompts(el) {
    const section = el.querySelector('[data-section="prompts"]');
    if (section) section.innerHTML = promptsInner(el.__vpProfileState, el.__vpConfig, el.__vpUi);
    recomputeProgress(el);
  }
  function rerenderCompetitors(el) {
    const section = el.querySelector('[data-section="competitors"]');
    if (section) section.innerHTML = competitorsInner(el.__vpProfileState);
    recomputeProgress(el);
  }

  const rowIdx = (target) => {
    const row = target.closest && target.closest('[data-idx]');
    return row ? parseInt(row.getAttribute('data-idx'), 10) : -1;
  };
  const actOf = (target) => {
    const node = target.closest && target.closest('[data-act]');
    return node ? node.getAttribute('data-act') : null;
  };

  // Delegated handlers live on the SECTION elements (not the rows), so they
  // survive re-rendering the section's inner HTML. Text edits update state
  // without re-rendering (preserve focus); add/remove/toggle re-render.
  function bindListSections(el) {
    const icps = el.querySelector('[data-section="icps"]');
    if (icps) {
      icps.addEventListener('input', (e) => {
        if (e.target.getAttribute('data-act') === 'icp-text') {
          const i = rowIdx(e.target);
          if (i >= 0) el.__vpProfileState.icps[i].text = e.target.value;
        }
      });
      icps.addEventListener('change', (e) => {
        if (e.target.getAttribute('data-act') === 'icp-toggle') {
          const i = rowIdx(e.target);
          if (i >= 0) el.__vpProfileState.icps[i].selected = e.target.checked;
        }
      });
      icps.addEventListener('click', (e) => {
        const act = actOf(e.target);
        const state = el.__vpProfileState;
        if (act === 'icp-remove') {
          const i = rowIdx(e.target);
          if (i >= 0) { state.icps.splice(i, 1); rerenderIcps(el); }
        } else if (act === 'icp-add') {
          if (state.icps.length >= ICP_MAX) return; // MAX enforcement (no floor)
          state.icps.push({ text: '', selected: true });
          rerenderIcps(el);
        }
      });
    }

    const prompts = el.querySelector('[data-section="prompts"]');
    if (prompts) {
      prompts.addEventListener('input', (e) => {
        if (e.target.getAttribute('data-act') === 'prompt-text') {
          const i = rowIdx(e.target);
          if (i >= 0) el.__vpProfileState.tracked_prompts[i].text = e.target.value;
        }
      });
      prompts.addEventListener('change', (e) => {
        const act = e.target.getAttribute('data-act');
        if (act === 'prompt-stage') {
          const i = rowIdx(e.target);
          if (i >= 0) {
            el.__vpProfileState.tracked_prompts[i].funnel_stage = e.target.value || null;
            rerenderPrompts(el); // re-group under the new stage
          }
          return;
        }
        if (act !== 'prompt-monitor') return;
        const i = rowIdx(e.target);
        if (i < 0) return;
        const state = el.__vpProfileState;
        const cap = el.__vpConfig ? el.__vpConfig.monitoring_cap : null;
        if (e.target.checked) {
          const monitoredNow = state.tracked_prompts.filter((p) => p.is_monitored).length;
          if (cap != null && monitoredNow >= cap) {
            // Block turning ON beyond the cap; revert via re-render + hint.
            el.__vpUi.promptCapHint = true;
            rerenderPrompts(el);
            return;
          }
          state.tracked_prompts[i].is_monitored = true;
        } else {
          state.tracked_prompts[i].is_monitored = false; // turning OFF always allowed
        }
        el.__vpUi.promptCapHint = false;
        rerenderPrompts(el); // refresh "Tracking X of up to N"
      });
      prompts.addEventListener('click', (e) => {
        const act = actOf(e.target);
        const state = el.__vpProfileState;
        if (act === 'prompt-delete') {
          const i = rowIdx(e.target);
          if (i >= 0) { state.tracked_prompts.splice(i, 1); el.__vpUi.promptCapHint = false; rerenderPrompts(el); }
        } else if (act === 'prompt-add') {
          if (state.tracked_prompts.length >= PROMPT_SOFT_CAP) return; // soft-cap MAX
          // New prompts are meant to be tracked: default is_monitored = true when
          // under the monitoring cap, false when already at it (keeps the invariant).
          const cap = el.__vpConfig ? el.__vpConfig.monitoring_cap : null;
          const monitoredNow = state.tracked_prompts.filter((p) => p.is_monitored).length;
          const monitored = cap == null || monitoredNow < cap;
          // Pre-set the new item's stage from the group's add button.
          const btn = e.target.closest('[data-act]');
          const stage = normalizeFunnelStage(btn && btn.getAttribute('data-stage'));
          state.tracked_prompts.push({ text: '', volume: null, is_monitored: monitored, funnel_stage: stage });
          el.__vpUi.promptCapHint = false;
          rerenderPrompts(el);
        } else if (act === 'token-cta') {
          onTokenQueryUnlockRequested({ source: 'prompts_section' });
        }
      });
    }

    // 9c: competitor two-column — edit / add / delete / reorder / reclassify.
    const comp = el.querySelector('[data-section="competitors"]');
    if (comp) {
      const colOf = (target) => {
        const c = target.closest && target.closest('[data-col]');
        return c ? c.getAttribute('data-col') : null;
      };
      comp.addEventListener('input', (e) => {
        const act = e.target.getAttribute('data-act');
        if (act !== 'comp-name' && act !== 'comp-url') return;
        const col = colOf(e.target);
        const i = rowIdx(e.target);
        if (!col || i < 0) return;
        const item = el.__vpProfileState[COMP_COLS[col]][i];
        if (act === 'comp-name') item.name = e.target.value;  // no re-render (preserve focus)
        else item.url = e.target.value;
      });
      comp.addEventListener('click', (e) => {
        const act = actOf(e.target);
        if (!act) return;
        const state = el.__vpProfileState;
        const col = colOf(e.target);
        if (!col) return;
        const list = state[COMP_COLS[col]];
        if (act === 'comp-add') {
          if (list.length >= COMP_MAX) return; // 5-cap per column
          list.push({ name: '', url: null });
          rerenderCompetitors(el);
          return;
        }
        const i = rowIdx(e.target);
        if (i < 0) return;
        if (act === 'comp-up') {
          if (i > 0) { const t = list[i - 1]; list[i - 1] = list[i]; list[i] = t; rerenderCompetitors(el); }
        } else if (act === 'comp-down') {
          if (i < list.length - 1) { const t = list[i + 1]; list[i + 1] = list[i]; list[i] = t; rerenderCompetitors(el); }
        } else if (act === 'comp-delete') {
          list.splice(i, 1); rerenderCompetitors(el); // no removal floor
        } else if (act === 'comp-move') {
          const target = state[COMP_COLS[COMP_OTHER[col]]];
          if (target.length >= COMP_MAX) return;           // target column full — don't move
          const item = list.splice(i, 1)[0];               // remove from source
          target.push(item);                               // append to target
          rerenderCompetitors(el);                         // re-render + renumber BOTH
        }
      });
    }
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
    const config = o.config || null;

    // Build the working-profile state, then render FROM it (controls read their
    // initial values from state; edits write back to the same object).
    const state = createWorkingProfile(o.data || {});
    const ui = { promptCapHint: false };
    const st = resolveStates(state);

    el.classList.add('vp-scope');
    el.innerHTML = `
      <div class="vp-form" data-mode="${mode}">
        ${sectionHeader(mode)}
        ${sectionCallYou(state, st)}
        ${sectionBasics(state, st)}
        ${sectionAbout(state, st)}
        ${sectionIcps(state)}
        ${sectionCompetitors(state)}
        ${sectionPrompts(state, config, ui)}
        ${sectionExtras(state)}
        ${sectionCta(mode)}
      </div>`;

    el.__vpProfileState = state;     // single source of truth for edits
    el.__vpConfig = config;          // draft_config (monitoring_cap, token unlock)
    el.__vpUi = ui;                  // transient UI flags (cap hint)
    el.__vpMode = mode;              // onboarding | edit (CTA label + submit behavior)
    el.__vpSubmit = resolveSubmitOpts(o.submit); // POST target / auth / redirect (injectable)
    el.__vpSubmitting = false;       // in-flight guard
    bindSimpleFields(el, state);     // wire simple-field editing (9a)
    bindListSections(el);            // wire ICPs + prompts + competitors editing (9b/9c)
    bindCta(el);                     // wire CTA submit/save (Step 11)

    // Step 10: single recompute trigger. Root-level input/change listeners fire
    // (via bubbling) AFTER the inner mutation handlers run, covering text edits
    // and checkbox toggles that don't re-render; structural changes recompute
    // inside the rerender* helpers. Both cover every mutation in both modes.
    if (!el.__vpProgressBound) {
      el.addEventListener('input', () => recomputeProgress(el));
      el.addEventListener('change', () => recomputeProgress(el));
      el.__vpProgressBound = true;
    }
    recomputeProgress(el);           // initial progress + CTA state
    return state;
  }

  window.ProfileForm = {
    render,
    resolveStates,
    formatVolume,
    createWorkingProfile,
    simpleFieldState,
    getState,
    onTokenQueryUnlockRequested,
    evaluateReadiness,
    recomputeProgress,
    serializeProfile,
    submitProfile,
  };
})();
