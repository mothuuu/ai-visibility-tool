'use strict';

const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : 'https://ai-visibility-tool.onrender.com/api';

let currentClusterId = null;
let clusters = [];

function getAuthToken() {
    return localStorage.getItem('authToken');
}

function getUser() {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); }
    catch { return null; }
}

function initCitationMonitoring() {
    const token = getAuthToken();
    if (!token) { window.location.href = 'auth.html'; return; }

    const user = getUser();
    if (user) {
        const badge = document.getElementById('planBadge');
        if (badge) badge.textContent = (user.plan || 'free').toUpperCase();
    }

    loadClusters();
}

async function loadClusters() {
    const token = getAuthToken();
    const selector = document.getElementById('clusterSelector');
    const hint = document.getElementById('tokenCostHint');

    selector.innerHTML = '<option value="">Loading...</option>';
    selector.disabled = true;
    hint.textContent = '';

    try {
        const res = await fetch(`${API_BASE_URL}/citation-monitoring/prompt-clusters`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        const json = await res.json();

        if (!json.success || !Array.isArray(json.data)) {
            selector.innerHTML = '<option value="">No clusters available</option>';
            return;
        }

        clusters = json.data;

        if (clusters.length === 0) {
            selector.innerHTML = '<option value="">No clusters found — create one in the dashboard</option>';
            return;
        }

        selector.innerHTML = clusters.map(c =>
            `<option value="${escapeAttr(String(c.id))}">${escapeHtml(c.name)}</option>`
        ).join('');
        selector.disabled = false;

        hint.innerHTML = '<i class="fas fa-coins"></i> Cost: 3 tokens per test';

        currentClusterId = String(clusters[0].id);
        selector.value = currentClusterId;

        loadLatestResults(currentClusterId);
        loadRunHistory(currentClusterId);
        loadBenchmarkStats(currentClusterId);

    } catch {
        selector.innerHTML = '<option value="">Failed to load clusters</option>';
    }
}

function onClusterChange() {
    const selector = document.getElementById('clusterSelector');
    currentClusterId = selector.value || null;

    const errorEl = document.getElementById('runTestError');
    errorEl.style.display = 'none';

    if (!currentClusterId) return;

    loadLatestResults(currentClusterId);
    loadRunHistory(currentClusterId);
    loadBenchmarkStats(currentClusterId);
}

async function runCitationTest() {
    const user = getUser();
    const token = getAuthToken();
    const errorEl = document.getElementById('runTestError');
    errorEl.style.display = 'none';

    const url = user && user.primary_domain
        ? (user.primary_domain.startsWith('http')
            ? user.primary_domain
            : 'https://' + user.primary_domain)
        : null;

    if (!url) {
        errorEl.textContent = 'Please set your primary domain in the dashboard before running a citation test.';
        errorEl.style.display = 'block';
        return;
    }

    if (!currentClusterId) {
        errorEl.textContent = 'Please select a prompt cluster.';
        errorEl.style.display = 'block';
        return;
    }

    const cluster = clusters.find(c => String(c.id) === currentClusterId);
    if (!cluster) {
        errorEl.textContent = 'Selected cluster not found. Please reload the page.';
        errorEl.style.display = 'block';
        return;
    }

    const queries = [
        cluster.canonical_prompt,
        ...(Array.isArray(cluster.prompt_variants) ? cluster.prompt_variants : [])
    ].filter(Boolean);

    if (queries.length === 0) {
        errorEl.textContent = 'This cluster has no prompts configured.';
        errorEl.style.display = 'block';
        return;
    }

    const btn = document.getElementById('runTestBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running...';
    showLoading('latestResultsContent');

    try {
        const body = { url, queries, clusterId: cluster.id };
        if (cluster.industry) body.industry = cluster.industry;

        const res = await fetch(`${API_BASE_URL}/test-ai-visibility`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(body)
        });

        const json = await res.json();

        if (!res.ok) {
            if (res.status === 402) {
                errorEl.textContent = `Insufficient tokens. This test requires ${json.required || 3} tokens (you have ${json.available || 0}).`;
            } else if (res.status === 403) {
                errorEl.textContent = 'Your plan does not include citation tests. Please upgrade to Starter or Pro.';
            } else if (res.status === 401) {
                errorEl.textContent = 'Authentication required. Please log in again.';
            } else {
                errorEl.textContent = json.error || 'Test failed. Please try again.';
            }
            errorEl.style.display = 'block';
            showEmpty('latestResultsContent', 'Test did not complete.');
            return;
        }

        const results = json.data;
        const isPro = user && user.plan === 'pro';
        renderLatestResults(results, isPro);

        loadRunHistory(currentClusterId);
        loadBenchmarkStats(currentClusterId);

    } catch {
        errorEl.textContent = 'Network error. Please check your connection and try again.';
        errorEl.style.display = 'block';
        showEmpty('latestResultsContent', 'Test did not complete.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-play"></i> Run Test';
    }
}

async function loadLatestResults(clusterId) {
    if (!clusterId) return;
    const token = getAuthToken();
    showLoading('latestResultsContent');

    try {
        const res = await fetch(
            `${API_BASE_URL}/citation-monitoring/citation-test-runs?clusterId=${encodeURIComponent(clusterId)}&limit=1`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const json = await res.json();

        if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
            showEmpty('latestResultsContent', 'No tests run yet for this cluster. Run your first test above.');
            return;
        }

        const container = document.getElementById('latestResultsContent');
        container.innerHTML = renderRunCard(json.data[0], true);
    } catch {
        showError('latestResultsContent', 'Failed to load latest results.');
    }
}

async function loadRunHistory(clusterId) {
    if (!clusterId) return;
    const token = getAuthToken();
    showLoading('runHistoryContent');

    try {
        const res = await fetch(
            `${API_BASE_URL}/citation-monitoring/citation-test-runs?clusterId=${encodeURIComponent(clusterId)}&limit=20`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const json = await res.json();

        if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
            showEmpty('runHistoryContent', 'No test runs found for this cluster.');
            return;
        }

        const container = document.getElementById('runHistoryContent');
        container.innerHTML = `<div class="history-list">${json.data.map(run => renderRunCard(run, false)).join('')}</div>`;
    } catch {
        showError('runHistoryContent', 'Failed to load run history.');
    }
}

async function loadBenchmarkStats(clusterId) {
    if (!clusterId) return;
    const token = getAuthToken();
    const windowVal = document.getElementById('benchmarkWindowSelector').value || '30d';
    showLoading('benchmarkContent');

    try {
        const res = await fetch(
            `${API_BASE_URL}/citation-monitoring/benchmark-stats?clusterId=${encodeURIComponent(clusterId)}&window=${encodeURIComponent(windowVal)}`,
            { headers: { 'Authorization': `Bearer ${token}` } }
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
        container.innerHTML = renderBenchmark(json.data);
    } catch {
        showError('benchmarkContent', 'Failed to load benchmark stats.');
    }
}

function renderLatestResults(results, isPro) {
    const container = document.getElementById('latestResultsContent');

    if (!results || !results.assistants) {
        showEmpty('latestResultsContent', 'No results returned.');
        return;
    }

    const overall = results.overall || {};
    const engineHtml = Object.entries(results.assistants)
        .map(([engine, result]) => renderEngineResult(engine, result, isPro))
        .join('');

    container.innerHTML = `
        <div class="overall-metrics">
            <div class="metric-chip">
                <span class="metric-label">Mention Rate</span>
                <span class="metric-value">${formatPct(overall.mentionRate)}</span>
            </div>
            <div class="metric-chip">
                <span class="metric-label">Recommendation Rate</span>
                <span class="metric-value">${formatPct(overall.recommendationRate)}</span>
            </div>
            <div class="metric-chip">
                <span class="metric-label">Citation Rate</span>
                <span class="metric-value">${formatPct(overall.citationRate)}</span>
            </div>
        </div>
        <div class="engines-grid">${engineHtml}</div>
    `;
}

function renderEngineResult(engine, result, isPro) {
    const engineNames = { openai: 'ChatGPT', anthropic: 'Claude', perplexity: 'Perplexity' };
    const name = engineNames[engine] || engine;

    if (!result || !result.tested) {
        const reason = result ? (result.reason || result.error || 'Not tested') : 'No data';
        return `
            <div class="engine-card engine-untested">
                <div class="engine-header">
                    <span class="engine-name">${escapeHtml(name)}</span>
                    <span class="status-badge status-failed">Not Tested</span>
                </div>
                <p class="untested-reason">${escapeHtml(reason)}</p>
            </div>`;
    }

    const metrics = result.metrics || {};
    const queries = Array.isArray(result.queries) ? result.queries : [];

    return `
        <div class="engine-card">
            <div class="engine-header">
                <span class="engine-name">${escapeHtml(name)}</span>
                <div class="engine-metrics-summary">
                    <span class="metric-pill mention${metrics.mentionRate > 0 ? ' active' : ''}">
                        Mention ${formatPct(metrics.mentionRate)}
                    </span>
                    <span class="metric-pill recommend${metrics.recommendationRate > 0 ? ' active' : ''}">
                        Recommend ${formatPct(metrics.recommendationRate)}
                    </span>
                    <span class="metric-pill cite${metrics.citationRate > 0 ? ' active' : ''}">
                        Cite ${formatPct(metrics.citationRate)}
                    </span>
                </div>
            </div>
            ${queries.length > 0 ? `<div class="query-results">${queries.map(q => renderQueryRow(q, isPro)).join('')}</div>` : ''}
        </div>`;
}

function renderQueryRow(q, isPro) {
    const statusClass = { detected: 'status-good', failed: 'status-error', skipped: 'status-neutral' }[q.detectionStatus] || 'status-neutral';
    const icon = v => v
        ? '<i class="fas fa-check icon-yes"></i>'
        : '<i class="fas fa-times icon-no"></i>';

    return `
        <div class="query-row">
            <div class="query-text">${escapeHtml(q.query || '')}</div>
            <div class="query-signals">
                <span class="signal">${icon(q.mentioned)} Mentioned</span>
                <span class="signal">${icon(q.recommended)} Recommended</span>
                <span class="signal">${icon(q.cited)} Cited</span>
                <span class="status-badge ${statusClass}">${escapeHtml(q.detectionStatus || 'unknown')}</span>
            </div>
            ${q.snippet ? `<div class="query-snippet">&ldquo;${escapeHtml(q.snippet)}&rdquo;</div>` : ''}
            ${isPro && q.reasoning ? `<div class="query-reasoning"><strong>Reasoning:</strong> ${escapeHtml(q.reasoning)}</div>` : ''}
        </div>`;
}

function renderRunCard(run, compact) {
    const statusClass = {
        completed: 'status-completed',
        failed: 'status-failed',
        partial: 'status-partial',
        running: 'status-running',
        pending: 'status-pending'
    }[run.status] || '';

    const startedAt = run.started_at ? new Date(run.started_at).toLocaleString() : '—';
    const completedAt = run.completed_at ? new Date(run.completed_at).toLocaleString() : '—';
    const engines = Array.isArray(run.engines_tested)
        ? run.engines_tested.join(', ')
        : (run.engines_tested ? String(run.engines_tested) : '—');

    const costHtml = run.token_cost != null
        ? `<span class="token-cost"><i class="fas fa-coins"></i> ${run.token_cost} tokens</span>`
        : '';

    const metaHtml = compact
        ? `<div class="run-card-meta"><span>Engines: ${escapeHtml(engines)}</span></div>`
        : `<div class="run-card-meta">
               <span>Completed: ${completedAt}</span>
               ${engines !== '—' ? `<span>Engines: ${escapeHtml(engines)}</span>` : ''}
           </div>`;

    return `
        <div class="run-card${compact ? ' run-card-compact' : ''}">
            <div class="run-card-header">
                <span class="status-badge ${statusClass}">${escapeHtml(run.status || 'unknown')}</span>
                <span class="run-time">${startedAt}</span>
                ${costHtml}
            </div>
            ${metaHtml}
        </div>`;
}

function renderBenchmark(data) {
    const domains = Array.isArray(data.top_cited_domains) ? data.top_cited_domains : [];
    const toRate = v => v != null ? v * 100 : null;

    const domainsHtml = domains.length > 0 ? `
        <div class="top-domains">
            <h4>Top Cited Domains</h4>
            <table class="domains-table">
                <thead><tr><th>Domain</th><th>Count</th><th>Share</th></tr></thead>
                <tbody>${domains.map(d => `
                    <tr>
                        <td>${escapeHtml(d.domain || '')}</td>
                        <td>${d.count != null ? d.count : '—'}</td>
                        <td>${formatPct(d.share != null ? d.share * 100 : null)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>` : '';

    return `
        <div class="benchmark-metrics">
            <div class="metric-chip">
                <span class="metric-label">Mention Rate</span>
                <span class="metric-value">${formatPct(toRate(data.mention_rate))}</span>
            </div>
            <div class="metric-chip">
                <span class="metric-label">Recommendation Rate</span>
                <span class="metric-value">${formatPct(toRate(data.recommendation_rate))}</span>
            </div>
            <div class="metric-chip">
                <span class="metric-label">Citation Rate</span>
                <span class="metric-value">${formatPct(toRate(data.citation_rate))}</span>
            </div>
            <div class="metric-chip">
                <span class="metric-label">Citation SoV</span>
                <span class="metric-value">${formatPct(toRate(data.citation_sov))}</span>
            </div>
            <div class="metric-chip">
                <span class="metric-label">Sample Size</span>
                <span class="metric-value">${data.sample_size != null ? data.sample_size : '—'}</span>
            </div>
        </div>
        ${domainsHtml}
        <p class="updated-at">Updated: ${data.updated_at ? new Date(data.updated_at).toLocaleString() : '—'}</p>`;
}

function showLoading(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
}

function showError(containerId, message) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = `<div class="error-msg">${escapeHtml(message)}</div>`;
}

function showEmpty(containerId, message) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = `<p class="empty-msg">${escapeHtml(message)}</p>`;
}

function formatPct(val) {
    if (val == null || isNaN(val)) return '—';
    return val.toFixed(1) + '%';
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

document.addEventListener('DOMContentLoaded', initCitationMonitoring);
