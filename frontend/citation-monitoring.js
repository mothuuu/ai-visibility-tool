'use strict';

// Mirrors backend/config/platform-config.js — update here if platform-config changes
const CITATION_TOKEN_COST = 3;

// Maps citation_evidence.engine column values / results.assistants keys to display names.
// CITATION_ENGINES = ['chatgpt','claude','perplexity'] but the API uses 'openai','anthropic','perplexity'.
const ENGINE_DISPLAY = { openai: 'ChatGPT', anthropic: 'Claude', perplexity: 'Perplexity' };

const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : 'https://ai-visibility-tool.onrender.com/api';

let currentClusterId = null;
let clusters = [];

// ── Preserved utilities (verbatim) ────────────────────────────────────────

function getAuthToken() {
    return localStorage.getItem('authToken');
}

function getUser() {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); }
    catch { return null; }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;');
}

function formatPct(val) {
    if (val == null || isNaN(val)) return '—';
    return val.toFixed(1) + '%';
}

// ── Helper ─────────────────────────────────────────────────────────────────

function relativeTime(dateString) {
    if (!dateString) return 'unknown time';
    const diff = Date.now() - new Date(dateString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
}

// ── State management ───────────────────────────────────────────────────────

function showState(name) {
    ['empty', 'progress', 'populated'].forEach(function (s) {
        const el = document.getElementById('state-' + s);
        if (el) el.classList.toggle('hidden', s !== name);
    });
}

// ── Container helpers ──────────────────────────────────────────────────────

function showLoading(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
}

function showError(containerId, message) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<div class="error-msg">' + escapeHtml(message) + '</div>';
}

function showEmpty(containerId, message) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<p class="empty-msg">' + escapeHtml(message) + '</p>';
}

// ── SVG status icons ───────────────────────────────────────────────────────

function iconCited() {
    return '<svg class="ic ic-cited" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-label="Cited"><path d="M20 6 9 17l-5-5"/></svg>';
}

function iconMentioned() {
    return '<svg class="ic ic-ment" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#00B9DA" stroke-width="2" stroke-linecap="round" aria-label="Mentioned"><circle cx="12" cy="12" r="9"/><path fill="#00B9DA" d="M12 3a9 9 0 0 1 0 18z"/></svg>';
}

function iconNotFound() {
    return '<svg class="ic ic-none" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" aria-label="Not found"><line x1="6" y1="12" x2="18" y2="12"/></svg>';
}

function statusIcon(row) {
    if (row.cited) return iconCited();
    if (row.mentioned) return iconMentioned();
    return iconNotFound();
}

// ── Init ───────────────────────────────────────────────────────────────────

function initCitationMonitoring() {
    const token = getAuthToken();
    if (!token) { window.location.href = 'auth.html'; return; }

    const user = getUser();
    if (user) {
        const badge = document.getElementById('planBadge');
        if (badge) badge.textContent = (user.plan || 'free').toUpperCase();

        // Header identity — mirror the dashboard header: account email chip
        // (top-left) plus the scanned domain. Both come from the same cached
        // `user` object the dashboard header already uses (no new fetch, no new
        // endpoint). We never render a generic "User" placeholder: each slot is
        // shown only when it has real data, and the email chip carries identity
        // if the domain is unavailable.
        const email = user.email || null;
        const domain = user.primary_domain || null;

        const chip = document.getElementById('accountChip');
        const chipEmail = document.getElementById('accountChipEmail');
        const emailShown = !!(chip && chipEmail && email);
        if (emailShown) {
            chipEmail.textContent = email;
            chip.title = email;
            chip.style.display = 'flex';
        }

        const domainBadge = document.getElementById('accountDomainBadge');
        if (domainBadge) {
            // Prefer the scanned domain. If it's unavailable, fall back to the
            // email only when the chip isn't already showing it — so identity is
            // always present and we never duplicate the email or leave "User".
            const label = domain || (!emailShown ? email : null);
            if (label) {
                domainBadge.textContent = label;
                domainBadge.title = domain ? ('Scanned domain: ' + domain) : label;
                domainBadge.style.display = 'inline-flex';
            }
        }
    }

    loadClusters();
}

// ── Run bar ────────────────────────────────────────────────────────────────

async function loadClusters() {
    const token = getAuthToken();
    const selector = document.getElementById('clusterSelector');
    const hint = document.getElementById('tokenCostHint');

    selector.innerHTML = '<option value="">Loading…</option>';
    selector.disabled = true;
    if (hint) hint.textContent = '';

    try {
        const res = await fetch(API_BASE_URL + '/prompt-clusters', {
            headers: token ? { 'Authorization': 'Bearer ' + token } : {}
        });
        const json = await res.json();

        if (!json.success || !Array.isArray(json.data)) {
            selector.innerHTML = '<option value="">No prompts available</option>';
            showState('empty');
            return;
        }

        clusters = json.data;

        if (clusters.length === 0) {
            selector.innerHTML = '<option value="">No prompts configured</option>';
            showState('empty');
            return;
        }

        selector.innerHTML = clusters.map(function (c) {
            return '<option value="' + escapeAttr(String(c.id)) + '">' + escapeHtml(c.name) + '</option>';
        }).join('');
        selector.disabled = false;

        const engineLabels = Object.values(ENGINE_DISPLAY).join(', ');
        if (hint) {
            hint.innerHTML = '<i class="fas fa-coins"></i> Cost: ' + CITATION_TOKEN_COST +
                ' tokens &mdash; tests ' + escapeHtml(engineLabels);
        }

        currentClusterId = String(clusters[0].id);
        selector.value = currentClusterId;

        await checkAndShowState(currentClusterId);
    } catch {
        selector.innerHTML = '<option value="">Failed to load</option>';
        showState('empty');
    }
}

async function checkAndShowState(clusterId) {
    if (!clusterId) { showState('empty'); return; }
    const token = getAuthToken();
    try {
        const res = await fetch(
            API_BASE_URL + '/citation-test-runs?clusterId=' +
                encodeURIComponent(clusterId) + '&limit=1',
            { headers: token ? { 'Authorization': 'Bearer ' + token } : {} }
        );
        const json = await res.json();
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
            showState('populated');
            loadAllData(clusterId);
        } else {
            showState('empty');
        }
    } catch {
        showState('empty');
    }
}

function onClusterChange() {
    const selector = document.getElementById('clusterSelector');
    currentClusterId = selector.value || null;

    const errorEl = document.getElementById('runTestError');
    if (errorEl) errorEl.style.display = 'none';

    if (!currentClusterId) { showState('empty'); return; }

    checkAndShowState(currentClusterId);
}

async function runCitationTest() {
    const user = getUser();
    const token = getAuthToken();
    const errorEl = document.getElementById('runTestError');
    if (errorEl) errorEl.style.display = 'none';

    const rawDomain = user && user.primary_domain ? user.primary_domain : null;
    const url = rawDomain
        ? (rawDomain.startsWith('http') ? rawDomain : 'https://' + rawDomain)
        : null;

    if (!url) {
        if (errorEl) {
            errorEl.textContent = 'Please set your primary domain in the dashboard before running a citation test.';
            errorEl.style.display = 'block';
        }
        return;
    }

    if (!currentClusterId) {
        if (errorEl) {
            errorEl.textContent = 'No prompt cluster configured. Please contact support.';
            errorEl.style.display = 'block';
        }
        return;
    }

    const cluster = clusters.find(function (c) { return String(c.id) === currentClusterId; });
    if (!cluster) {
        if (errorEl) {
            errorEl.textContent = 'Configuration error. Please reload the page.';
            errorEl.style.display = 'block';
        }
        return;
    }

    const variants = Array.isArray(cluster.prompt_variants) ? cluster.prompt_variants : [];
    const queries = [cluster.canonical_prompt].concat(variants).filter(Boolean);

    if (queries.length === 0) {
        if (errorEl) {
            errorEl.textContent = 'No prompts configured for this test.';
            errorEl.style.display = 'block';
        }
        return;
    }

    const btn = document.getElementById('runTestBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running…';
    showState('progress');

    try {
        const body = { url: url, queries: queries, clusterId: cluster.id };
        if (cluster.industry) body.industry = cluster.industry;

        const res = await fetch(API_BASE_URL + '/test-ai-visibility', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify(body)
        });

        const json = await res.json();

        if (!res.ok) {
            let msg;
            if (res.status === 402) {
                msg = 'Insufficient tokens. This test requires ' + CITATION_TOKEN_COST + ' tokens.';
            } else if (res.status === 403) {
                msg = 'Your plan does not include Citation Monitoring.';
            } else if (res.status === 401) {
                msg = 'Authentication required. Please log in again.';
            } else {
                msg = json.error || 'Test failed. Please try again.';
            }
            if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
            await checkAndShowState(currentClusterId);
            return;
        }

        showState('populated');
        await loadAllData(currentClusterId);
    } catch {
        if (errorEl) {
            errorEl.textContent = 'Network error. Please check your connection and try again.';
            errorEl.style.display = 'block';
        }
        await checkAndShowState(currentClusterId);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-play"></i> Run Test';
    }
}

// ── Populated state — load functions ──────────────────────────────────────

function loadAllData(clusterId) {
    return Promise.all([
        loadLatestResults(clusterId),
        loadRunHistory(clusterId),
        loadBenchmarkStats(clusterId)
    ]);
}

async function loadLatestResults(clusterId) {
    if (!clusterId) return;
    const token = getAuthToken();
    showLoading('latestResultsContent');

    try {
        const res = await fetch(
            API_BASE_URL + '/citation-test-runs?clusterId=' +
                encodeURIComponent(clusterId) + '&limit=1',
            { headers: { 'Authorization': 'Bearer ' + token } }
        );
        const json = await res.json();

        if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
            showEmpty('latestResultsContent', 'No tests run yet.');
            return;
        }

        const run = json.data[0];

        if (run.status === 'pending') {
            showEmpty('latestResultsContent', 'Test queued — results will appear when the run completes.');
            return;
        }
        if (run.status === 'running') {
            showEmpty('latestResultsContent', 'Test in progress — results will appear when complete.');
            return;
        }
        if (run.status === 'failed') {
            showError('latestResultsContent', 'Last test failed — all engines did not respond. Try running again.');
            return;
        }

        // completed or partial — fetch evidence rows
        const evRes = await fetch(
            API_BASE_URL + '/citation-evidence?runId=' + encodeURIComponent(run.id),
            { headers: { 'Authorization': 'Bearer ' + token } }
        );
        const evJson = await evRes.json();

        if (!evJson.success || !Array.isArray(evJson.data)) {
            showError('latestResultsContent', 'Failed to load evidence for this run.');
            return;
        }

        renderLatestResults(run, evJson.data);
    } catch {
        showError('latestResultsContent', 'Failed to load latest results.');
    }
}

async function loadRunHistory(clusterId) {
    if (!clusterId) return;
    const token = getAuthToken();
    const barsEl = document.getElementById('historyBars');
    const listEl = document.getElementById('historyList');
    const legacyEl = document.getElementById('runHistoryContent');
    if (barsEl) barsEl.innerHTML = '';
    if (listEl) listEl.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
    if (legacyEl) legacyEl.innerHTML = '';

    try {
        const res = await fetch(
            API_BASE_URL + '/citation-test-runs?clusterId=' +
                encodeURIComponent(clusterId) + '&limit=20',
            { headers: { 'Authorization': 'Bearer ' + token } }
        );
        const json = await res.json();

        if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
            if (listEl) listEl.innerHTML = '<p class="empty-msg">No test runs found.</p>';
            return;
        }

        renderRunHistory(json.data);
    } catch {
        if (listEl) listEl.innerHTML = '<div class="error-msg">Failed to load run history.</div>';
    }
}

async function loadBenchmarkStats(clusterId) {
    if (!clusterId) return;
    const token = getAuthToken();
    const windowEl = document.getElementById('benchmarkWindowSelector');
    const windowVal = (windowEl && windowEl.value) ? windowEl.value : '30d';
    showLoading('benchmarkContent');

    try {
        const res = await fetch(
            API_BASE_URL + '/benchmark-stats?clusterId=' +
                encodeURIComponent(clusterId) + '&window=' + encodeURIComponent(windowVal),
            { headers: { 'Authorization': 'Bearer ' + token } }
        );
        const json = await res.json();

        if (!json.success) {
            showError('benchmarkContent', 'Failed to load benchmark stats.');
            return;
        }
        if (!json.data) {
            showEmpty('benchmarkContent', 'No benchmark data yet. Run a few tests to build up stats.');
            return;
        }

        const container = document.getElementById('benchmarkContent');
        if (container) container.innerHTML = renderBenchmark(json.data);
    } catch {
        showError('benchmarkContent', 'Failed to load benchmark stats.');
    }
}

// ── Render functions ───────────────────────────────────────────────────────

function renderLatestResults(run, evidenceRows) {
    const citedRows     = evidenceRows.filter(function (r) { return r.cited; });
    const mentionedOnly = evidenceRows.filter(function (r) { return r.mentioned && !r.cited; });
    const notFoundRows  = evidenceRows.filter(function (r) { return !r.cited && !r.mentioned; });
    const appeared      = citedRows.length + mentionedOnly.length;
    const total         = evidenceRows.length;

    // #lastRunContext — context line
    const ctxEl = document.getElementById('lastRunContext');
    if (ctxEl) ctxEl.textContent = 'Last run · ' + relativeTime(run.started_at) + ' · worldwide';

    // #heroText — hero summary
    const heroEl = document.getElementById('heroText');
    if (heroEl) heroEl.innerHTML =
        'Your brand appeared in <strong>' + appeared + '</strong> of <strong>' + total + '</strong> checks';

    // #metricCited / #metricMentioned / #metricNotFound — individual metric cards
    var mDefs = [
        { id: 'metricCited',     label: 'Cited',     value: citedRows.length },
        { id: 'metricMentioned', label: 'Mentioned', value: mentionedOnly.length },
        { id: 'metricNotFound',  label: 'Not Found', value: notFoundRows.length }
    ];
    mDefs.forEach(function (m) {
        var el = document.getElementById(m.id);
        if (el) el.innerHTML =
            '<div class="metric-chip">' +
                '<span class="metric-label">' + m.label + '</span>' +
                '<span class="metric-value">' + m.value + '</span>' +
            '</div>';
    });

    // #engineChatgpt / #engineClaude / #enginePerplexity — per-engine breakdown
    // Maps DB engine key (openai/anthropic/perplexity) to element ID
    var engineToEl = { openai: 'engineChatgpt', anthropic: 'engineClaude', perplexity: 'enginePerplexity' };
    Object.keys(engineToEl).forEach(function (key) {
        var el = document.getElementById(engineToEl[key]);
        if (!el) return;
        var rows = evidenceRows.filter(function (r) { return r.engine === key; });
        var name = escapeHtml(ENGINE_DISPLAY[key] || key);
        if (rows.length === 0) {
            el.innerHTML =
                '<div class="engine-card engine-untested">' +
                    '<div class="engine-header">' +
                        '<span class="engine-name">' + name + '</span>' +
                        '<div class="engine-metrics-summary"><span class="metric-pill">Not tested</span></div>' +
                    '</div>' +
                '</div>';
            return;
        }
        var eCited = rows.filter(function (r) { return r.cited; }).length;
        var eMent  = rows.filter(function (r) { return r.mentioned && !r.cited; }).length;
        el.innerHTML =
            '<div class="engine-card">' +
                '<div class="engine-header">' +
                    '<span class="engine-name">' + name + '</span>' +
                    '<div class="engine-metrics-summary">' +
                        '<span class="metric-pill' + (eCited ? ' active cite'    : '') + '">' + eCited + ' cited</span>' +
                        '<span class="metric-pill' + (eMent  ? ' active mention' : '') + '">' + eMent  + ' mentioned</span>' +
                    '</div>' +
                '</div>' +
            '</div>';
    });

    // #citationNudge — show/hide and populate
    var nudgeEl = document.getElementById('citationNudge');
    if (nudgeEl) {
        if (notFoundRows.length > 0) {
            // Retarget the nudge to the Findings (Diagnostics) section via the app's
            // existing in-app section routing. dashboard.html reads ?section= on load
            // (initDashboard) and calls navigateToSection('findings') — the same path
            // the sidebar "Findings" item uses — so this works across environments
            // without a hardcoded absolute URL.
            //
            // NOTE: ideally this would open Findings filtered to the citation-driven
            // findings for this account's latest run. No such filter mechanism exists
            // today: findings are scoped to scan_id only (015 schema) with no source
            // or citation_run_id linkage, and citation-monitoring produces evidence
            // rows (citation_test_runs / citation_evidence), not findings. Scoping to
            // citation-monitoring results would require a findings↔citation-run link
            // plus a Findings query param that reads it — inventing that schema is out
            // of scope here, so we open Findings unfiltered. FOLLOW-UP: add a citation
            // filter param once findings carry a citation-run source.
            nudgeEl.innerHTML =
                'Improve your AI visibility — <a href="dashboard.html?section=findings" class="nudge-link">view recommendations</a>.';
            nudgeEl.classList.remove('hidden');
        } else {
            nudgeEl.classList.add('hidden');
        }
    }

    // #latestResultsContent — partial banner + matrix table + expandable snippets only
    var matrixEl = document.getElementById('latestResultsContent');
    if (!matrixEl) return;

    var partialBanner = run.status === 'partial'
        ? '<div class="status-partial partial-banner">' +
              '<i class="fas fa-exclamation-triangle"></i> ' +
              'This test was partial — some engines did not respond. Results below are based on available engines.' +
          '</div>'
        : '';

    // Matrix: rows = unique prompt_text, cols = unique engines present in evidence
    var uniquePrompts = [];
    var seenPrompts = {};
    var uniqueEngines = [];
    var seenEngines = {};
    evidenceRows.forEach(function (r) {
        if (!seenPrompts[r.prompt_text]) { seenPrompts[r.prompt_text] = true; uniquePrompts.push(r.prompt_text); }
        if (!seenEngines[r.engine])      { seenEngines[r.engine]      = true; uniqueEngines.push(r.engine); }
    });

    var matrixHtml = '';
    if (uniquePrompts.length > 0 && uniqueEngines.length > 0) {
        var colHeaders = uniqueEngines.map(function (e) {
            return '<th scope="col" class="matrix-th-center">' + escapeHtml(ENGINE_DISPLAY[e] || e) + '</th>';
        }).join('');

        var tableRows = uniquePrompts.map(function (prompt) {
            var cells = uniqueEngines.map(function (engine) {
                var row = evidenceRows.find(function (r) { return r.prompt_text === prompt && r.engine === engine; });
                if (!row) return '<td class="matrix-td-center">—</td>';
                return '<td class="matrix-td-center" title="' + escapeAttr(row.detection_status || '') + '">' + statusIcon(row) + '</td>';
            }).join('');
            return '<tr><th scope="row" class="matrix-th-row">' + escapeHtml(prompt) + '</th>' + cells + '</tr>';
        }).join('');

        var legendHtml =
            '<div class="matrix-legend">' +
                iconCited() + ' Cited &nbsp;&nbsp;' +
                iconMentioned() + ' Mentioned &nbsp;&nbsp;' +
                iconNotFound() + ' Not found' +
            '</div>';

        matrixHtml =
            '<div class="matrix-wrapper">' +
                '<table class="matrix-table">' +
                    '<caption class="matrix-caption">AI citation results by prompt and engine</caption>' +
                    '<thead><tr class="matrix-thead-row">' +
                        '<th scope="col" class="matrix-th-left">Prompt</th>' + colHeaders +
                    '</tr></thead>' +
                    '<tbody>' + tableRows + '</tbody>' +
                '</table>' +
                legendHtml +
            '</div>';
    }

    // Expandable snippets — no URL field in evidence, pages-cited rollup omitted per contract
    var snippetRows = evidenceRows.filter(function (r) { return r.snippet; });
    var snippetsHtml = '';
    if (snippetRows.length > 0) {
        var items = snippetRows.map(function (r) {
            var sc = r.detection_status === 'detected' ? 'status-good'
                   : r.detection_status === 'failed'   ? 'status-error'
                   : 'status-neutral';
            return '<details class="snippet-details">' +
                '<summary class="snippet-summary">' +
                    statusIcon(r) +
                    escapeHtml(ENGINE_DISPLAY[r.engine] || r.engine) +
                    '<span class="snippet-prompt">' + escapeHtml(r.prompt_text) + '</span>' +
                '</summary>' +
                '<div class="snippet-body">' +
                    '<span class="status-badge ' + sc + '">' + escapeHtml(r.detection_status) + '</span>' +
                    '<div class="query-snippet">"' + escapeHtml(r.snippet) + '"</div>' +
                '</div>' +
            '</details>';
        }).join('');
        snippetsHtml = '<div class="snippets-container">' + items + '</div>';
    }

    matrixEl.innerHTML = partialBanner + matrixHtml + snippetsHtml;
}

function renderRunHistory(runs) {
    // Bar heights derived from status — run rows carry no per-run aggregate counts
    var barH = { completed: 100, partial: 50, running: 25, pending: 10, failed: 5 };
    var recent = runs.slice(0, 5);

    // #historyBars — mini bar chart for last 5 runs
    var barsEl = document.getElementById('historyBars');
    if (barsEl) {
        barsEl.innerHTML =
            '<div style="display:flex;align-items:flex-end;gap:4px;height:48px;padding:4px 28px 0;">' +
                recent.map(function (run, i) {
                    var h     = barH[run.status] != null ? barH[run.status] : 10;
                    var color = i === 0 ? 'var(--brand-cyan)' : 'var(--gray-300)';
                    var title = escapeAttr(run.status + ' · ' + relativeTime(run.started_at) + ' · bar height reflects run status, not success rate');
                    return '<div title="' + title + '" style="flex:1;display:flex;align-items:flex-end;height:100%;">' +
                        '<div style="width:100%;height:' + h + '%;background:' + color + ';border-radius:3px 3px 0 0;transition:height .2s;"></div>' +
                    '</div>';
                }).join('') +
            '</div>';
    }

    // #historyList — full run list
    var listEl = document.getElementById('historyList');
    if (!listEl) return;

    var scMap = {
        completed: 'status-completed',
        failed:    'status-failed',
        partial:   'status-partial',
        running:   'status-running',
        pending:   'status-pending'
    };

    listEl.innerHTML =
        '<div class="history-list" style="padding:0 28px 22px;">' +
            runs.map(function (run) {
                var dt = run.started_at ? new Date(run.started_at).toLocaleString() : '—';
                var sc = scMap[run.status] || '';
                return '<div class="run-card run-card-compact">' +
                    '<div class="run-card-header">' +
                        '<span class="status-badge ' + sc + '">' + escapeHtml(run.status) + '</span>' +
                        '<span class="run-time">' + escapeHtml(dt) + '</span>' +
                    '</div>' +
                '</div>';
            }).join('') +
        '</div>';
}

function renderBenchmark(data) {
    var pct = function (v) { return v != null && !isNaN(v) ? v * 100 : null; };
    var domains = Array.isArray(data.top_cited_domains) ? data.top_cited_domains : [];

    var domainsHtml = domains.length > 0
        ? '<div class="top-domains" style="margin-top:20px;">' +
              '<h4 style="font-size:13px;font-weight:600;color:var(--gray-700);margin:0 0 10px;">Top Cited Domains</h4>' +
              '<table class="domains-table">' +
                  '<thead><tr><th>Domain</th><th>Count</th><th>Share</th></tr></thead>' +
                  '<tbody>' +
                      domains.map(function (d) {
                          return '<tr>' +
                              '<td>' + escapeHtml(d.domain || '') + '</td>' +
                              '<td>' + (d.count != null ? d.count : '—') + '</td>' +
                              '<td>' + formatPct(d.share != null ? d.share * 100 : null) + '</td>' +
                          '</tr>';
                      }).join('') +
                  '</tbody>' +
              '</table>' +
          '</div>'
        : '';

    var updatedAt = data.updated_at ? new Date(data.updated_at).toLocaleString() : '—';

    return '<div class="benchmark-metrics">' +
            '<div class="metric-chip"><span class="metric-label">Mention Rate</span><span class="metric-value">' + formatPct(pct(data.mention_rate)) + '</span></div>' +
            '<div class="metric-chip"><span class="metric-label">Recommend Rate</span><span class="metric-value">' + formatPct(pct(data.recommendation_rate)) + '</span></div>' +
            '<div class="metric-chip"><span class="metric-label">Citation Rate</span><span class="metric-value">' + formatPct(pct(data.citation_rate)) + '</span></div>' +
            '<div class="metric-chip"><span class="metric-label">Citation SoV</span><span class="metric-value">' + formatPct(pct(data.citation_sov)) + '</span></div>' +
            '<div class="metric-chip"><span class="metric-label">Sample Size</span><span class="metric-value">' + (data.sample_size != null ? data.sample_size : '—') + '</span></div>' +
        '</div>' +
        domainsHtml +
        '<p class="updated-at" style="margin-top:14px;">Updated: ' + escapeHtml(updatedAt) + '</p>';
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', initCitationMonitoring);
