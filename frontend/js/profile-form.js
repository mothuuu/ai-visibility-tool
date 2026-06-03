/* ==========================================================================
   Visibility Profile Form — reusable render module (Step 7, static scaffold)

   window.ProfileForm.render(mountEl, { mode })  ->  injects the full form markup.

   SCOPE: STATIC SHELL ONLY.
   - No data fetching (Step 8), no add/remove/reorder/reclassify (Step 9),
     no progress/CTA-enable logic (Step 10), no submit (Step 11).
   - Every control (add, remove ✕, reorder chevrons, delete) is PRESENT but
     NON-FUNCTIONAL — there are deliberately NO event handlers here.
   - Hardcoded placeholder/sample data demonstrates layout + the 3 visual states.

   Modes: 'onboarding' (default) | 'edit'. The 8 sections are identical across
   modes; only the CTA label (and lighter header copy in edit mode) differ.

   Terminology: AI-populated content is "draft"/"suggestion", never
   "recommendation".
   ========================================================================== */
(function () {
  'use strict';

  // ---- tiny html helpers -------------------------------------------------
  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const badge = (type) => {
    const map = {
      ai: ['vp-badge--ai', 'AI'],
      required: ['vp-badge--required', 'Required'],
      optional: ['vp-badge--optional', 'Optional'],
      locked: ['vp-badge--locked', 'Locked'],
    };
    const [cls, label] = map[type];
    return `<span class="vp-badge ${cls}">${label}</span>`;
  };

  // ---- placeholder / sample data (Step 8 will replace with /api/profile) --
  const DRAFT = {
    display_name: 'Monali',
    domain: 'xeo.marketing',
    company_name: 'Xeo Marketing',
    industry: 'Marketing technology',
    location: 'Berlin, Germany',
    business_description:
      'Xeo helps B2B brands measure and improve how they show up in AI answers — ' +
      'tracking citations and visibility across ChatGPT, Claude, Perplexity, and Gemini, ' +
      'and turning the gaps into a prioritized action plan.',
    icps: [
      'Heads of marketing at B2B SaaS companies',
      'Founders evaluating AI visibility tools',
      'Agencies managing multiple client brands',
    ],
    icp_max: 5,
    competitors_business: ['Profound', 'Peec AI', 'Otterly'],
    competitors_visibility: ['G2', 'Reddit', 'Wikipedia'],
    prompts: [
      { text: 'best ai visibility tools', volume: '~ 4,200 / mo' },
      { text: 'how to rank in chatgpt answers', volume: '~ 2,800 / mo' },
      { text: 'track brand mentions in ai search', volume: '~ 1,500 / mo' },
      { text: 'perplexity seo optimization', volume: '~ 980 / mo' },
      { text: 'llm citation monitoring tools', volume: '~ 640 / mo' },
    ],
    prompt_cap: 10,
    avg_customer_value: '',
    priority_focus: 'All — optimize for the whole brand',
  };

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
  function sectionCallYou() {
    return `
      <section class="vp-section" data-section="call-you">
        <div class="vp-section-head">
          <h2 class="vp-section-title">What should I call you? ${badge('required')} ${badge('ai')}</h2>
        </div>
        <div class="vp-field">
          <input class="vp-input" type="text" value="${esc(DRAFT.display_name)}" placeholder="Your name" />
        </div>
      </section>`;
  }

  // 2. The basics (2-col grid of 4)
  function sectionBasics() {
    return `
      <section class="vp-section" data-section="basics">
        <div class="vp-section-head">
          <h2 class="vp-section-title">The basics ${badge('ai')}</h2>
        </div>
        <div class="vp-grid-2">
          <div class="vp-field">
            <label class="vp-label">Domain ${badge('locked')}</label>
            <input class="vp-input vp-input--locked" type="text" value="${esc(DRAFT.domain)}" readonly />
          </div>
          <div class="vp-field">
            <label class="vp-label">Company name ${badge('ai')}</label>
            <input class="vp-input" type="text" value="${esc(DRAFT.company_name)}" />
          </div>
          <div class="vp-field">
            <label class="vp-label">Industry ${badge('ai')}</label>
            <input class="vp-input" type="text" value="${esc(DRAFT.industry)}" placeholder="e.g. Marketing technology" />
          </div>
          <div class="vp-field">
            <label class="vp-label">Location ${badge('ai')}</label>
            <input class="vp-input" type="text" value="${esc(DRAFT.location)}" />
          </div>
        </div>
      </section>`;
  }

  // 3. Tell us about your business
  function sectionAbout() {
    return `
      <section class="vp-section" data-section="about">
        <div class="vp-section-head">
          <h2 class="vp-section-title">Tell us about your business ${badge('required')} ${badge('ai')}</h2>
        </div>
        <div class="vp-field">
          <textarea class="vp-textarea" rows="5">${esc(DRAFT.business_description)}</textarea>
        </div>
      </section>`;
  }

  // 4. Who are you reaching in AI answers? (ICPs)
  function sectionIcps() {
    const remaining = Math.max(0, DRAFT.icp_max - DRAFT.icps.length);
    const rows = DRAFT.icps
      .map(
        (icp) => `
          <div class="vp-icp-row">
            <input class="vp-checkbox" type="checkbox" checked />
            <input class="vp-input" type="text" value="${esc(icp)}" />
            <button class="vp-icon-btn vp-icon-btn--danger" type="button" title="Remove" aria-label="Remove">
              <i class="fas fa-times"></i>
            </button>
          </div>`
      )
      .join('');
    return `
      <section class="vp-section" data-section="icps">
        <div class="vp-section-head">
          <h2 class="vp-section-title">Who are you reaching in AI answers? ${badge('required')}</h2>
          <p class="vp-section-sub">Pick the audiences whose questions you want to win. Up to ${DRAFT.icp_max}.</p>
        </div>
        <div class="vp-list">${rows}</div>
        <button class="vp-add-btn" type="button">
          <i class="fas fa-plus"></i> Add another <span class="vp-add-remaining">(${remaining} remaining)</span>
        </button>
      </section>`;
  }

  // 5. Your competitive landscape (two columns)
  function competitorColumn(title, sub, items) {
    const rows = items
      .map(
        (name, i) => `
          <div class="vp-comp-row">
            <span class="vp-priority">${i + 1}</span>
            <input class="vp-input" type="text" value="${esc(name)}" />
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

  function sectionCompetitors() {
    return `
      <section class="vp-section" data-section="competitors">
        <div class="vp-section-head">
          <h2 class="vp-section-title">Your competitive landscape ${badge('required')}</h2>
        </div>
        <div class="vp-comp-cols">
          ${competitorColumn(
            'Business competitors',
            'Real-world rivals you compete with.',
            DRAFT.competitors_business
          )}
          ${competitorColumn(
            'AI visibility competitors',
            'Sources and lists AI models cite as authorities.',
            DRAFT.competitors_visibility
          )}
        </div>
      </section>`;
  }

  // 6. Top queries in your vertical (prompts)
  function sectionPrompts() {
    const rows = DRAFT.prompts
      .map(
        (p) => `
          <div class="vp-prompt-row">
            <input class="vp-input" type="text" value="${esc(p.text)}" />
            <span class="vp-volume">${esc(p.volume)}</span>
            <button class="vp-icon-btn vp-icon-btn--danger" type="button" title="Delete" aria-label="Delete">
              <i class="fas fa-trash"></i>
            </button>
          </div>`
      )
      .join('');
    return `
      <section class="vp-section" data-section="prompts">
        <div class="vp-section-head">
          <h2 class="vp-section-title">Top queries in your vertical ${badge('required')}</h2>
          <p class="vp-section-sub">These will be the discovery prompts we track across ChatGPT, Claude, Perplexity, and Gemini.</p>
        </div>
        <div class="vp-list">${rows}</div>
        <button class="vp-add-btn" type="button">
          <i class="fas fa-plus"></i> Add <span class="vp-add-remaining">(up to ${DRAFT.prompt_cap})</span>
        </button>
      </section>`;
  }

  // 7. A few extras (optional)
  function sectionExtras() {
    return `
      <section class="vp-section" data-section="extras">
        <div class="vp-section-head">
          <h2 class="vp-section-title">A few extras ${badge('optional')}</h2>
        </div>
        <div class="vp-field" style="margin-bottom:18px;">
          <label class="vp-label">What is an average customer worth to you?</label>
          <input class="vp-input" type="text" value="${esc(DRAFT.avg_customer_value)}" placeholder="e.g. $5,000 / year" />
          <p class="vp-hint">Helps us prioritize findings tied to higher-value queries.</p>
        </div>
        <div class="vp-field">
          <label class="vp-label">Any specific product or service you want to prioritize?</label>
          <input class="vp-input" type="text" value="${esc(DRAFT.priority_focus)}" />
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

  // ---- public render -----------------------------------------------------
  function render(mountEl, opts) {
    const el = typeof mountEl === 'string' ? document.querySelector(mountEl) : mountEl;
    if (!el) {
      console.error('[ProfileForm] mount element not found');
      return;
    }
    const mode = (opts && opts.mode) === 'edit' ? 'edit' : 'onboarding';

    el.classList.add('vp-scope');
    el.innerHTML = `
      <div class="vp-form" data-mode="${mode}">
        ${sectionHeader(mode)}
        ${sectionCallYou()}
        ${sectionBasics()}
        ${sectionAbout()}
        ${sectionIcps()}
        ${sectionCompetitors()}
        ${sectionPrompts()}
        ${sectionExtras()}
        ${sectionCta(mode)}
      </div>`;
  }

  window.ProfileForm = { render };
})();
