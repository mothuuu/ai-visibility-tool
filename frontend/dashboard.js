const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : 'https://ai-visibility-tool.onrender.com/api';

/**
 * Convert backend score (0-100) to display score (0-1000)
 */
function getDisplayScore(backendScore) {
    return Math.round(backendScore * 10);
}

// Global state
let user = null;
let quota = { used: 0, limit: 2 };
let currentSection = 'dashboard-home';
let selectedScanType = 'single-page'; // Track selected scan type (single-page or multi-page)

// Initialize dashboard
async function initDashboard() {
    showLoading();

    // Check authentication
    const authToken = localStorage.getItem('authToken');
    if (!authToken) {
        window.location.href = 'auth.html';
        return;
    }

    try {
        // Fetch user data
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) {
            throw new Error('Not authenticated');
        }

        const data = await response.json();
        user = data.user;

        // Check email verification
        if (!user.email_verified) {
            window.location.href = 'verify.html';
            return;
        }

        // Store user
        localStorage.setItem('user', JSON.stringify(user));

        // Update UI
        updateUserInfo();
        updateQuota();
        await loadDashboardData();

        // Setup navigation
        setupNavigation();

        // Setup mobile menu
        setupMobileMenu();

        // Setup scan type card selection
        setupScanTypeCards();

        // Check URL params for section navigation
        const urlParams = new URLSearchParams(window.location.search);
        const section = urlParams.get('section');
        if (section) {
            navigateToSection(section);
        }

        hideLoading();

    } catch (error) {
        console.error('Dashboard init error:', error);
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
        window.location.href = 'auth.html';
    }
}

// Update user info in header
function updateUserInfo() {
    const displayName = user.name || user.email.split('@')[0];

    // Update header userName
    const headerUserName = document.getElementById('userName');
    if (headerUserName) {
        headerUserName.textContent = displayName;
    }

    // Update welcome section userName
    const welcomeUserName = document.getElementById('welcomeUserName');
    if (welcomeUserName) {
        welcomeUserName.textContent = displayName;
    }

    // Update plan badge in welcome section
    const planNames = {
        free: 'Free Plan',
        diy: 'DIY Plan',
        pro: 'Pro Plan',
        enterprise: 'Enterprise Plan'
    };
    const planBadge = document.getElementById('planBadge');
    if (planBadge) {
        planBadge.textContent = planNames[user.plan] || 'Free Plan';
    }

    // Update scans remaining in welcome section
    const scansRemaining = document.getElementById('scansRemaining');
    if (scansRemaining && user.scans_used_this_month !== undefined) {
        const planLimits = {
            free: 2,
            diy: 25,
            pro: 50,
            enterprise: 200
        };
        const limit = planLimits[user.plan] || 2;
        const remaining = Math.max(0, limit - user.scans_used_this_month);
        scansRemaining.textContent = `${remaining} of ${limit} scans`;
    }

    // Show/hide upgrade button based on plan
    const upgradeBtn = document.getElementById('upgradeBtn');
    if (upgradeBtn) {
        // Hide upgrade button for paid plans
        if (user.plan === 'diy' || user.plan === 'pro' || user.plan === 'enterprise') {
            upgradeBtn.classList.add('hidden');
        } else {
            upgradeBtn.classList.remove('hidden');
        }
    }

    // Update scan plan info in purple section
    const scanPlanInfo = document.getElementById('scanPlanInfo');
    if (scanPlanInfo) {
        const planLimits = {
            free: 1,
            diy: 5,
            pro: 25,
            enterprise: 100
        };
        const pageLimit = planLimits[user.plan] || 1;
        const planDisplayNames = {
            free: 'Free plan',
            diy: 'DIY plan',
            pro: 'Pro plan',
            enterprise: 'Enterprise plan'
        };
        scanPlanInfo.textContent = `${planDisplayNames[user.plan] || 'Free plan'}: Analyze up to ${pageLimit} pages`;
    }

    // Primary domain badge
    const primaryDomainBadge = document.getElementById('primaryDomainBadge');
    if (user.primary_domain) {
        primaryDomainBadge.textContent = user.primary_domain;
        primaryDomainBadge.title = `Primary domain: ${user.primary_domain}\nClick to change (once per month)`;
    } else {
        primaryDomainBadge.textContent = '🏠 Not set';
        primaryDomainBadge.title = 'Primary domain will be set on first scan';
    }

    // Update competitor count badge
    updateCompetitorBadge();

    // Update tier-based locking
    updateFeatureLocking();
}

// Update competitor count badge
async function updateCompetitorBadge() {
    const competitorBadge = document.getElementById('competitorBadge');
    if (!competitorBadge) return;

    const competitorLimits = {
        free: 0,
        diy: 2,
        pro: 3,
        enterprise: 10
    };

    const competitorLimit = competitorLimits[user.plan] || 0;

    try {
        // Fetch competitor data from API
        const authToken = localStorage.getItem('authToken');
        const response = await fetch(`${API_BASE_URL}/competitors`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            const competitorCount = data.competitors ? data.competitors.length : 0;
            const competitorCountElement = document.getElementById('competitorCount');
            if (competitorCountElement) {
                competitorCountElement.textContent = `${competitorCount}/${competitorLimit} competitors`;
            }
        } else {
            // If API call fails, just show the limit
            const competitorCountElement = document.getElementById('competitorCount');
            if (competitorCountElement) {
                competitorCountElement.textContent = `0/${competitorLimit} competitors`;
            }
        }
    } catch (error) {
        console.error('Error fetching competitor count:', error);
        // Fallback to showing limit only
        const competitorCountElement = document.getElementById('competitorCount');
        if (competitorCountElement) {
            competitorCountElement.textContent = `0/${competitorLimit} competitors`;
        }
    }

    // Hide badge if free plan
    if (competitorLimit === 0) {
        competitorBadge.style.display = 'none';
    } else {
        competitorBadge.style.display = 'flex';
    }
}

// Update feature locking based on user plan
function updateFeatureLocking() {
    const isPro = user.plan === 'pro';
    const isDiyPlus = user.plan === 'diy' || isPro;

    // Brand Visibility Index - Pro+ only
    const brandVisibilityLocked = document.getElementById('brandVisibilityLocked');
    const brandVisibilityUnlocked = document.getElementById('brandVisibilityUnlocked');
    const brandVisibilityNav = document.querySelector('[data-section="brand-visibility"]');

    if (isPro) {
        if (brandVisibilityLocked) brandVisibilityLocked.style.display = 'none';
        if (brandVisibilityUnlocked) brandVisibilityUnlocked.style.display = 'block';
        brandVisibilityNav?.classList.remove('locked');
    } else {
        if (brandVisibilityLocked) brandVisibilityLocked.style.display = 'flex';
        if (brandVisibilityUnlocked) brandVisibilityUnlocked.style.display = 'none';
        brandVisibilityNav?.classList.add('locked');
    }

    // AI Discoverability - Pro+ only
    const aiDiscoverabilityLocked = document.getElementById('aiDiscoverabilityLocked');
    const aiDiscoverabilityUnlocked = document.getElementById('aiDiscoverabilityUnlocked');
    const aiDiscoverabilityNav = document.querySelector('[data-section="ai-discoverability"]');

    if (isPro) {
        if (aiDiscoverabilityLocked) aiDiscoverabilityLocked.style.display = 'none';
        if (aiDiscoverabilityUnlocked) aiDiscoverabilityUnlocked.style.display = 'block';
        aiDiscoverabilityNav?.classList.remove('locked');
    } else {
        if (aiDiscoverabilityLocked) aiDiscoverabilityLocked.style.display = 'flex';
        if (aiDiscoverabilityUnlocked) aiDiscoverabilityUnlocked.style.display = 'none';
        aiDiscoverabilityNav?.classList.add('locked');
    }

    // Scan options - enable based on plan
    const includeCompetitorComparison = document.getElementById('includeCompetitorComparison');
    const generatePdfReport = document.getElementById('generatePdfReport');
    const testAiDiscoverability = document.getElementById('testAiDiscoverability');

    if (includeCompetitorComparison) includeCompetitorComparison.disabled = !isDiyPlus;
    if (generatePdfReport) generatePdfReport.disabled = !isDiyPlus;
    if (testAiDiscoverability) testAiDiscoverability.disabled = !isPro;
}

// Update quota display
function updateQuota() {
    const planLimits = {
        free: { primary: 2, competitor: 0, pages: 1 },
        diy: { primary: 25, competitor: 2, pages: 5 },
        pro: { primary: 50, competitor: 3, pages: 25 },
        enterprise: { primary: 200, competitor: 10, pages: 100 }
    };

    const limits = planLimits[user.plan] || planLimits.free;

    // Primary scan quota
    quota = {
        used: user.scans_used_this_month || 0,
        limit: limits.primary
    };

    // Update dashboard stats
    const scansUsed = `${quota.used}/${quota.limit}`;
    const scansPercent = quota.limit > 0 ? Math.round((quota.used / quota.limit) * 100) : 0;

    document.getElementById('dashboardScansUsed').textContent = scansUsed;
    document.getElementById('dashboardScansPercent').textContent = `${scansPercent}% used`;

    // Update page selector limits
    const pageSelectorLimit = document.getElementById('pageSelectorLimit');
    if (pageSelectorLimit) pageSelectorLimit.textContent = limits.pages;
}

// Setup navigation
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const section = item.getAttribute('data-section');

            // Don't navigate if locked
            if (item.classList.contains('locked')) {
                return;
            }

            navigateToSection(section);
        });
    });
}

// Navigate to a specific section
function navigateToSection(sectionId) {
    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-section') === sectionId) {
            item.classList.add('active');
        }
    });

    // Update active section
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
        if (section.id === sectionId) {
            section.classList.add('active');
        }
    });

    // Close mobile menu if open
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.remove('open');
    }

    currentSection = sectionId;

    // Load section-specific data
    if (sectionId === 'billing-subscription') {
        loadBillingData();
    }

    // Update URL without reload
    const url = new URL(window.location);
    url.searchParams.set('section', sectionId);
    window.history.pushState({}, '', url);

    // Scroll to top
    document.getElementById('mainContent').scrollTop = 0;
}

// Setup mobile menu
function setupMobileMenu() {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar?.classList.toggle('open');
        });
    }

    // Close sidebar when clicking on main content (mobile only)
    if (mainContent) {
        mainContent.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                sidebar?.classList.remove('open');
            }
        });
    }
}

// Setup scan type card selection
function setupScanTypeCards() {
    const singlePageCard = document.getElementById('singlePageScanCard');
    const multiPageCard = document.getElementById('multiPageScanCard');

    if (!singlePageCard || !multiPageCard) {
        return; // Cards not found, exit gracefully
    }

    // Set initial selection to single-page
    singlePageCard.classList.add('selected');
    selectedScanType = 'single-page';

    // Single-page card click handler
    singlePageCard.addEventListener('click', function() {
        singlePageCard.classList.add('selected');
        multiPageCard.classList.remove('selected');
        selectedScanType = 'single-page';
        console.log('Selected scan type: single-page');
    });

    // Multi-page card click handler
    multiPageCard.addEventListener('click', function() {
        multiPageCard.classList.add('selected');
        singlePageCard.classList.remove('selected');
        selectedScanType = 'multi-page';
        console.log('Selected scan type: multi-page');
    });
}

// Load all dashboard data
async function loadDashboardData() {
    await Promise.all([
        loadRecentScans(),
        loadLatestScores(),
        loadTrackedPages(),
        loadRecommendations(),
        loadSubscriptionData()
    ]);
}

// Load recent scans and populate dashboard home
async function loadRecentScans() {
    const authToken = localStorage.getItem('authToken');

    try {
        const response = await fetch(`${API_BASE_URL}/scan/list/recent`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) {
            throw new Error('Failed to load scans');
        }

        const data = await response.json();
        const scans = data.scans || [];

        // Update recent activity table
        const recentActivityTable = document.getElementById('recentActivityTable');
        if (recentActivityTable) {
            if (scans.length === 0) {
                recentActivityTable.innerHTML = `
                    <tr>
                        <td colspan="5">
                            <div class="empty-state">
                                <div class="empty-icon">📊</div>
                                <div class="empty-text">No recent scans. Start your first scan to see results here!</div>
                            </div>
                        </td>
                    </tr>
                `;
            } else {
                recentActivityTable.innerHTML = scans.slice(0, 10).map(scan => {
                    const date = new Date(scan.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    });
                    const displayScore = getDisplayScore(scan.total_score || 0);
                    const statusBadge = scan.status === 'complete'
                        ? '<span class="badge badge-good">Complete</span>'
                        : '<span class="badge badge-high">Pending</span>';

                    return `
                        <tr style="cursor: pointer;" onclick="window.location.href='results.html?scanId=${scan.id}'">
                            <td>${date}</td>
                            <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${scan.url}</td>
                            <td><strong>${displayScore}/1000</strong></td>
                            <td><span class="stat-change">--</span></td>
                            <td>${statusBadge}</td>
                        </tr>
                    `;
                }).join('');
            }
        }

        // Update scan history table
        const scanHistoryTable = document.getElementById('scanHistoryTable');
        if (scanHistoryTable) {
            if (scans.length === 0) {
                scanHistoryTable.innerHTML = `
                    <tr>
                        <td colspan="7">
                            <div class="empty-state">
                                <div class="empty-icon">📊</div>
                                <div class="empty-text">No scans found</div>
                            </div>
                        </td>
                    </tr>
                `;
            } else {
                scanHistoryTable.innerHTML = scans.map(scan => {
                    const date = new Date(scan.created_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    const displayScore = getDisplayScore(scan.total_score || 0);
                    const statusBadge = scan.status === 'complete'
                        ? '<span class="badge badge-good">Complete</span>'
                        : '<span class="badge badge-high">Pending</span>';

                    return `
                        <tr>
                            <td>${date}</td>
                            <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${scan.url}</td>
                            <td><strong>${displayScore}/1000</strong></td>
                            <td><span class="stat-change">--</span></td>
                            <td>~3 min</td>
                            <td>${statusBadge}</td>
                            <td>
                                <button class="btn btn-ghost" style="padding: 0.5rem 1rem;" onclick="window.location.href='results.html?scanId=${scan.id}'">
                                    View
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }

    } catch (error) {
        console.error('Error loading scans:', error);
    }
}

// Load latest scan scores
async function loadLatestScores() {
    const authToken = localStorage.getItem('authToken');

    try {
        const response = await fetch(`${API_BASE_URL}/scan/list/recent?limit=1`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) {
            return;
        }

        const data = await response.json();
        const scans = data.scans || [];

        if (scans.length === 0) {
            // No scans yet
            document.getElementById('dashboardWebsiteScore').textContent = '--';
            document.getElementById('dashboardWebsiteChange').textContent = 'No scans yet';
            document.getElementById('websiteScoreValue').textContent = '--';
            return;
        }

        const latestScan = scans[0];
        const displayScore = getDisplayScore(latestScan.total_score || 0);

        // Update dashboard home stats
        document.getElementById('dashboardWebsiteScore').textContent = displayScore;
        document.getElementById('dashboardWebsiteChange').textContent = '↑ +15 (30 days)'; // TODO: Calculate actual change

        // Update Website Visibility Index
        document.getElementById('websiteScoreValue').textContent = displayScore;

        // Determine grade
        let grade = 'Poor';
        if (displayScore >= 800) grade = 'Excellent';
        else if (displayScore >= 700) grade = 'Good';
        else if (displayScore >= 600) grade = 'Fair';

        document.getElementById('websiteScoreGrade').textContent = `Grade: ${grade}`;
        document.getElementById('websiteScoreComparison').textContent = 'vs Industry Avg: +120 points';
        document.getElementById('websiteScorePotential').textContent = `Potential Gain: +${1000 - displayScore} points`;
        document.getElementById('websiteScoreLastScan').textContent = `Last scan: ${new Date(latestScan.created_at).toLocaleDateString()}`;

        // Load 8-pillar breakdown
        load8PillarBreakdown(latestScan);

    } catch (error) {
        console.error('Error loading latest scores:', error);
    }
}

// Load 8-pillar breakdown
function load8PillarBreakdown(scan) {
    const pillars = [
        { key: 'technical_setup_score', label: '1. Technical Setup' },
        { key: 'content_structure_score', label: '2. Content Structure' },
        { key: 'content_freshness_score', label: '3. Content Freshness' },
        { key: 'ai_search_readiness_score', label: '4. Schema Markup' },
        { key: 'speed_ux_score', label: '5. Speed & UX' },
        { key: 'trust_authority_score', label: '6. Trust & Authority' },
        { key: 'voice_optimization_score', label: '7. Voice Optimization' },
        { key: 'ai_readability_score', label: '8. AI Readability' }
    ];

    const pillarGrid = document.getElementById('pillarGrid');
    if (!pillarGrid) return;

    pillarGrid.innerHTML = pillars.map(pillar => {
        const score = scan[pillar.key] || 0;
        const displayScore = getDisplayScore(score);
        const percentage = score;

        let color = 'var(--critical-red)';
        let fillClass = 'red';
        let statusIcon = '❌';

        if (percentage >= 70) {
            color = 'var(--good-green)';
            fillClass = 'green';
            statusIcon = '✅';
        } else if (percentage >= 50) {
            color = 'var(--high-yellow)';
            fillClass = 'yellow';
            statusIcon = '⚠️';
        }

        return `
            <div class="pillar-card">
                <div class="pillar-header">
                    <div class="pillar-name">${pillar.label}</div>
                    <div class="pillar-score" style="color: ${color};">${displayScore}/125 ${statusIcon}</div>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill ${fillClass}" style="width: ${percentage}%"></div>
                </div>
                <div class="pillar-summary">
                    ${percentage < 50 ? 'Critical - Needs immediate attention' :
                      percentage < 70 ? 'Moderate - Room for improvement' :
                      'Good - Minor optimizations available'}
                </div>
                <div class="pillar-footer">
                    <span class="pillar-issues">${Math.floor(Math.random() * 5) + 1} issues found</span>
                    <button class="btn btn-ghost" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;">View Details →</button>
                </div>
            </div>
        `;
    }).join('');
}

// Load tracked pages
async function loadTrackedPages() {
    // For now, show placeholder
    const trackedPagesTotal = document.getElementById('trackedPagesTotal');
    const trackedPagesCount = document.getElementById('trackedPagesCount');
    const pageSelectorCount = document.getElementById('pageSelectorCount');
    const dashboardPagesTracked = document.getElementById('dashboardPagesTracked');

    if (trackedPagesTotal) trackedPagesTotal.textContent = '0';
    if (trackedPagesCount) trackedPagesCount.textContent = '0';
    if (pageSelectorCount) pageSelectorCount.textContent = '0';
    if (dashboardPagesTracked) dashboardPagesTracked.textContent = '0';
}

// Load recommendations
async function loadRecommendations() {
    // For now, show placeholder counts
    const recommendationsCount = document.getElementById('recommendationsCount');
    const criticalIssuesCount = document.getElementById('criticalIssuesCount');
    const quickWinsCount = document.getElementById('quickWinsCount');

    if (recommendationsCount) recommendationsCount.textContent = '0';
    if (criticalIssuesCount) criticalIssuesCount.textContent = '0';
    if (quickWinsCount) quickWinsCount.textContent = '0';

    // Placeholder for recommendation stats
    document.getElementById('recoCriticalCount').textContent = '0';
    document.getElementById('recoHighCount').textContent = '0';
    document.getElementById('recoMediumCount').textContent = '0';
    document.getElementById('recoCompletedCount').textContent = '0';

    document.getElementById('criticalIssuesTotal').textContent = '0';
    document.getElementById('quickWinsTotal').textContent = '0';
}

// Start new scan
function startNewScan() {
    let url = document.getElementById('scanUrlInput')?.value.trim();
    const authToken = localStorage.getItem('authToken');

    if (!url) {
        showXeoAlert('URL Required', 'Please enter a URL to scan');
        return;
    }

    // Normalize URL (add https:// if missing)
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    // For free users - scan homepage immediately
    if (user.plan === 'free') {
        showLoading();
        fetch(`${API_BASE_URL}/scan/analyze`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: url,
                scanType: 'homepage'
            })
        })
        .then(response => response.json())
        .then(data => {
            hideLoading();
            if (data.scan && data.scan.id) {
                window.location.href = `results.html?scanId=${data.scan.id}`;
            } else if (data.scanId) {
                window.location.href = `results.html?scanId=${data.scanId}`;
            }
        })
        .catch(error => {
            hideLoading();
            console.error('Scan error:', error);
            showXeoAlert('Scan Failed', 'Failed to start scan. Please try again.');
        });
        return;
    }

    // For DIY/Pro users - check scan type selection
    if (selectedScanType === 'multi-page') {
        // Multi-page scan: redirect to page selector
        window.location.href = `page-selector.html?domain=${encodeURIComponent(url)}`;
    } else {
        // Single-page scan: perform inline scan
        showLoading();
        fetch(`${API_BASE_URL}/scan/analyze`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: url,
                scanType: 'single-page'
            })
        })
        .then(response => response.json())
        .then(data => {
            hideLoading();
            if (data.scan && data.scan.id) {
                window.location.href = `results.html?scanId=${data.scan.id}`;
            } else if (data.scanId) {
                window.location.href = `results.html?scanId=${data.scanId}`;
            } else {
                throw new Error('No scan ID in response');
            }
        })
        .catch(error => {
            hideLoading();
            console.error('Scan error:', error);
            showXeoAlert('Scan Failed', error.message || 'Failed to start scan. Please try again.');
        });
    }
}

// Add tracked page
function addTrackedPage() {
    showXeoAlert('Coming Soon', 'This feature is coming soon!');
}

// Change Domain Modal Functions
async function openDomainModal() {
    if (!user || !user.primary_domain) {
        showXeoAlert('No Primary Domain', 'No primary domain set yet. Your primary domain will be set automatically on your first scan.');
        return;
    }

    document.getElementById('currentDomainText').textContent = user.primary_domain;
    document.getElementById('newDomainInput').value = '';
    document.getElementById('domainChangeError').style.display = 'none';
    document.getElementById('changeDomainModal').style.display = 'flex';
}

function closeDomainModal() {
    document.getElementById('changeDomainModal').style.display = 'none';
}

async function confirmDomainChange() {
    const newDomain = document.getElementById('newDomainInput').value.trim();
    const errorDiv = document.getElementById('domainChangeError');
    const btn = document.getElementById('changeDomainBtn');
    const originalText = btn.innerHTML;

    if (!newDomain) {
        errorDiv.textContent = 'Please enter a new domain';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        btn.disabled = true;
        btn.innerHTML = '⏳ Changing...';
        errorDiv.style.display = 'none';

        const authToken = localStorage.getItem('authToken');

        const response = await fetch(`${API_BASE_URL}/auth/change-primary-domain`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ newDomain })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to change primary domain');
        }

        showXeoAlert('Success', `Primary domain changed successfully to: ${data.newDomain}\n\nYour scan quotas have been reset. Page will now refresh.`);
        setTimeout(() => {
            closeDomainModal();
            window.location.reload();
        }, 2000);

    } catch (error) {
        console.error('Domain change error:', error);
        errorDiv.textContent = error.message;
        errorDiv.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Logout functions
function logout() {
    document.getElementById('logoutModal').style.display = 'flex';
}

function closeLogoutModal() {
    document.getElementById('logoutModal').style.display = 'none';
}

function confirmLogout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}

// Close modals when clicking outside
document.addEventListener('click', function(event) {
    const logoutModal = document.getElementById('logoutModal');
    if (logoutModal && event.target === logoutModal) {
        closeLogoutModal();
    }

    const changeDomainModal = document.getElementById('changeDomainModal');
    if (changeDomainModal && event.target === changeDomainModal) {
        closeDomainModal();
    }

    const comingSoonModal = document.getElementById('comingSoonModal');
    if (comingSoonModal && event.target === comingSoonModal) {
        closeComingSoonModal();
    }
});

// Loading helpers
function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
}

// Xeo Branded Modal Functions
let xeoConfirmCallback = null;

function showXeoAlert(title, message) {
    document.getElementById('xeoAlertTitle').textContent = title;
    document.getElementById('xeoAlertMessage').textContent = message;
    document.getElementById('xeoAlertModal').style.display = 'flex';
}

function closeXeoAlert() {
    document.getElementById('xeoAlertModal').style.display = 'none';
}

function showXeoConfirm(title, message) {
    return new Promise((resolve) => {
        document.getElementById('xeoConfirmTitle').textContent = title;
        document.getElementById('xeoConfirmMessage').textContent = message;
        document.getElementById('xeoConfirmModal').style.display = 'flex';
        xeoConfirmCallback = resolve;
    });
}

function closeXeoConfirm(result) {
    document.getElementById('xeoConfirmModal').style.display = 'none';
    if (xeoConfirmCallback) {
        xeoConfirmCallback(result);
        xeoConfirmCallback = null;
    }
}

// Subscription Management Functions
async function openStripePortal() {
    const authToken = localStorage.getItem('authToken');

    if (!authToken) {
        showXeoAlert('Authentication Required', 'Please log in to access the billing portal.');
        return;
    }

    try {
        showLoading();

        const response = await fetch(`${API_BASE_URL}/subscription/portal`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to open billing portal');
        }

        // Redirect to Stripe Customer Portal
        window.location.href = data.url;

    } catch (error) {
        hideLoading();
        console.error('Portal error:', error);
        showXeoAlert('Error', `Unable to open billing portal: ${error.message}\n\nPlease try again or contact support.`);
    }
}

// Load subscription data
async function loadSubscriptionData() {
    if (!user) return;

    try {
        // Set plan-based information
        const planInfo = {
            free: {
                name: 'Free Plan',
                price: '$0/month',
                features: [
                    '2 scans per month',
                    'Track 1 page',
                    'Basic visibility score',
                    'Community support'
                ],
                scansLimit: 2,
                pagesLimit: 1,
                competitorsLimit: 0
            },
            diy: {
                name: 'DIY Plan',
                price: '$29/month',
                features: [
                    '25 scans per month',
                    'Up to 5 pages of the same domain',
                    'Website Visibility Index (full)',
                    'Copy-paste code snippets',
                    'Competitor scanning'
                ],
                scansLimit: 25,
                pagesLimit: 5,
                competitorsLimit: 2
            },
            pro: {
                name: 'Pro Plan',
                price: '$149/month',
                features: [
                    '50 scans per month',
                    'Up to 25 pages of the same domain',
                    'Website Visibility Index (full) & Brand Visibility Index (Lite)',
                    'Copy-paste code snippets',
                    '3 competitor analyses'
                ],
                scansLimit: 50,
                pagesLimit: 25,
                competitorsLimit: 3
            },
            enterprise: {
                name: 'Enterprise Plan',
                price: '$499/month',
                features: [
                    '200 scans per month',
                    'Up to 100 pages of the same domain',
                    'Website Visibility Index (full) & Brand Visibility Index (Full)',
                    '10 competitor analyses',
                    'Advanced AI monitoring (50+ queries)',
                    'Media & social tracking'
                ],
                scansLimit: 200,
                pagesLimit: 100,
                competitorsLimit: 10
            }
        };

        const currentPlan = planInfo[user.plan] || planInfo.free;

        // Update plan information
        document.getElementById('billingPlanName').textContent = currentPlan.name;
        document.getElementById('billingPlanPrice').textContent = currentPlan.price;

        // Update features
        const featuresHtml = currentPlan.features.map(feature =>
            `<li style="padding: 0.5rem 0; display: flex; align-items: center;"><i class="fas fa-check" style="color: var(--brand-cyan); margin-right: 0.75rem; font-size: 1rem;"></i><span style="color: var(--gray-700);">${feature}</span></li>`
        ).join('');
        document.getElementById('billingPlanFeatures').innerHTML = featuresHtml;

        // Calculate renewal date (example: 30 days from now)
        const renewalDate = new Date();
        renewalDate.setDate(renewalDate.getDate() + 30);
        document.getElementById('billingRenewalDate').textContent = `Renews ${renewalDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

        // Update usage statistics
        const scansUsed = user.scans_used_this_month || 0;
        const scansLimit = currentPlan.scansLimit;
        const scansPercent = scansLimit > 0 ? Math.round((scansUsed / scansLimit) * 100) : 0;
        const scansRemaining = scansLimit - scansUsed;

        document.getElementById('billingScansUsed').textContent = `${scansUsed}/${scansLimit}`;
        document.getElementById('billingScansProgress').style.width = `${scansPercent}%`;
        document.getElementById('billingScansRemaining').textContent = scansRemaining > 0 ? `${scansRemaining} scans remaining` : 'At limit';

        // Pages tracked (placeholder - would come from backend)
        const pagesUsed = 0; // TODO: Get from backend
        const pagesLimit = currentPlan.pagesLimit;
        const pagesPercent = pagesLimit > 0 ? Math.round((pagesUsed / pagesLimit) * 100) : 0;
        const pagesRemaining = pagesLimit - pagesUsed;

        document.getElementById('billingPagesTracked').textContent = `${pagesUsed}/${pagesLimit}`;
        document.getElementById('billingPagesProgress').style.width = `${pagesPercent}%`;
        document.getElementById('billingPagesRemaining').textContent = pagesRemaining > 0 ? `${pagesRemaining} pages remaining` : 'At limit - upgrade for more';

        // Competitors (placeholder - would come from backend)
        const competitorsUsed = 0; // TODO: Get from backend
        const competitorsLimit = currentPlan.competitorsLimit;
        const competitorsPercent = competitorsLimit > 0 ? Math.round((competitorsUsed / competitorsLimit) * 100) : 0;
        const competitorsRemaining = competitorsLimit - competitorsUsed;

        document.getElementById('billingCompetitors').textContent = `${competitorsUsed}/${competitorsLimit}`;
        document.getElementById('billingCompetitorsProgress').style.width = `${competitorsPercent}%`;
        document.getElementById('billingCompetitorsRemaining').textContent = competitorsRemaining > 0 ? `${competitorsRemaining} remaining` : 'At limit';

        // Calculate quota reset date
        const resetDate = new Date();
        resetDate.setDate(1); // First day of month
        resetDate.setMonth(resetDate.getMonth() + 1); // Next month
        const daysUntilReset = Math.ceil((resetDate - new Date()) / (1000 * 60 * 60 * 24));

        const quotaResetElement = document.getElementById('billingQuotaResetDate');
        if (quotaResetElement) {
            quotaResetElement.textContent = `Resets in ${daysUntilReset} days (${resetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })})`;
        }

    } catch (error) {
        console.error('Error loading subscription data:', error);
    }
}

// Billing Page Functions
let selectedPlanForChange = null;

function openChangePlanModal() {
    document.getElementById('changePlanModal').style.display = 'flex';

    // Hide the dynamic note initially
    document.getElementById('planChangeNote').style.display = 'none';

    // Plan hierarchy for comparison
    const planRanks = {
        free: 0,
        diy: 1,
        pro: 2,
        enterprise: 3
    };

    // Show current plan badge
    const currentPlanRank = planRanks[user.plan] || 0;

    // Setup plan selection handlers
    document.querySelectorAll('.plan-option').forEach(option => {
        const planType = option.dataset.plan;

        // Remove any existing current badges
        const existingBadge = option.querySelector('.current-badge, #proCurrentBadge, #diyCurrentBadge, #enterpriseCurrentBadge');
        if (existingBadge) {
            existingBadge.style.display = 'none';
        }

        // Show CURRENT badge on user's current plan
        if (planType === user.plan) {
            // For Pro plan, show the badge
            if (planType === 'pro') {
                const proBadge = document.getElementById('proCurrentBadge');
                if (proBadge) proBadge.style.display = 'inline-block';
            } else {
                // For other plans, add badge dynamically
                const header = option.querySelector('div[style*="font-weight: 700"]');
                if (header && !header.querySelector('.current-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'current-badge';
                    badge.style.cssText = 'font-size: 0.625rem; background: var(--brand-cyan); color: white; padding: 0.25rem 0.5rem; border-radius: 10px; font-weight: 700; margin-left: 0.5rem;';
                    badge.textContent = 'CURRENT';
                    header.appendChild(badge);
                }
            }
        }

        option.addEventListener('click', function() {
            // Remove selected from all
            document.querySelectorAll('.plan-option').forEach(o => o.classList.remove('selected'));
            // Add selected to clicked
            this.classList.add('selected');
            selectedPlanForChange = this.dataset.plan;

            // Show/hide dynamic note based on upgrade or downgrade
            const selectedPlanRank = planRanks[selectedPlanForChange] || 0;
            const noteDiv = document.getElementById('planChangeNote');
            const noteText = document.getElementById('planChangeNoteText');

            if (selectedPlanForChange === user.plan) {
                // Same plan - hide note
                noteDiv.style.display = 'none';
            } else if (selectedPlanRank > currentPlanRank) {
                // Upgrading
                noteDiv.style.display = 'block';
                noteText.innerHTML = '<i class="fas fa-info-circle"></i> <strong>Note:</strong> Plan changes are pro-rated. You\'ll be credited for unused time on your current plan.';
            } else {
                // Downgrading
                noteDiv.style.display = 'block';

                // Calculate renewal date (example: 30 days from now)
                const renewalDate = new Date();
                renewalDate.setDate(renewalDate.getDate() + 30);
                const formattedDate = renewalDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

                const planDisplayNames = {
                    free: 'Free',
                    diy: 'DIY',
                    pro: 'Pro',
                    enterprise: 'Enterprise'
                };
                const currentPlanName = planDisplayNames[user.plan] || 'current';

                noteText.innerHTML = `📅 <strong>Your access continues until: ${formattedDate}</strong><br>You won't be charged again, and you can keep using ${currentPlanName} features until this date.`;
            }
        });
    });
}

function closeChangePlanModal() {
    document.getElementById('changePlanModal').style.display = 'none';
    selectedPlanForChange = null;
    // Remove all selected classes
    document.querySelectorAll('.plan-option').forEach(o => o.classList.remove('selected'));
}

async function confirmPlanChange() {
    if (!selectedPlanForChange) {
        showXeoAlert('Select a Plan', 'Please select a plan before confirming.');
        return;
    }

    if (selectedPlanForChange === user.plan) {
        showXeoAlert('Same Plan', 'You are already on this plan.');
        return;
    }

    // FIX FOR MODAL STACKING: Close the change plan modal FIRST
    closeChangePlanModal();

    // Wait brief moment for modal close animation
    await new Promise(resolve => setTimeout(resolve, 200));

    // Check if selected plan is Pro or Enterprise - show "Coming Soon" modal
    if (selectedPlanForChange === 'pro' || selectedPlanForChange === 'enterprise') {
        document.getElementById('comingSoonModal').style.display = 'flex';
        return;
    }

    // For DIY plan - proceed with plan change
    const planNames = {
        free: 'Free Plan',
        diy: 'DIY Plan ($29/month)',
        pro: 'Pro Plan ($149/month)',
        enterprise: 'Enterprise Plan ($499/month)'
    };

    const confirmed = await showXeoConfirm(
        'Confirm Plan Change',
        `Are you sure you want to change to ${planNames[selectedPlanForChange]}?\n\nChanges will be pro-rated and take effect immediately.`
    );

    if (!confirmed) {
        // If user cancels, reopen the change plan modal
        openChangePlanModal();
        return;
    }

    try {
        showLoading();

        // In production, this would call the backend API
        // For now, we'll show a message to use Stripe Portal
        hideLoading();
        showXeoAlert('Plan Change', 'Please use the Stripe Portal to change your plan. This ensures secure payment processing and immediate activation.');

        // Optionally open Stripe Portal
        setTimeout(() => {
            openStripePortal();
        }, 2000);

    } catch (error) {
        hideLoading();
        console.error('Plan change error:', error);
        showXeoAlert('Error', `Unable to change plan: ${error.message}`);
    }
}

function openCancelSubscriptionModal() {
    // Update the access until date based on current billing cycle
    const renewalDate = new Date();
    renewalDate.setDate(renewalDate.getDate() + 30);
    document.getElementById('cancelAccessUntilDate').textContent =
        renewalDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // Update current plan name in the cancel message
    const planDisplayNames = {
        free: 'Free',
        diy: 'DIY',
        pro: 'Pro',
        enterprise: 'Enterprise'
    };
    const cancelCurrentPlanName = document.getElementById('cancelCurrentPlanName');
    if (cancelCurrentPlanName) {
        cancelCurrentPlanName.textContent = planDisplayNames[user.plan] || 'Pro';
    }

    document.getElementById('cancelSubscriptionModal').style.display = 'flex';
}

function closeCancelSubscriptionModal() {
    document.getElementById('cancelSubscriptionModal').style.display = 'none';
}

async function confirmCancelSubscription() {
    try {
        closeCancelSubscriptionModal();
        showLoading();

        console.log('🚫 Cancelling subscription via API...');

        const authToken = localStorage.getItem('authToken');
        if (!authToken) {
            throw new Error('Not authenticated');
        }

        // Call the backend API to cancel the subscription
        const response = await fetch(`${API_BASE_URL}/subscription/cancel`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Cancel response status:', response.status);

        const data = await response.json();
        console.log('Cancel response data:', data);

        hideLoading();

        if (!response.ok) {
            // If no active subscription, user is already on free plan
            if (data.error && data.error.includes('No active subscription')) {
                await showXeoAlert(
                    'Already on Free Plan',
                    'You are already on the Free plan. No active subscription to cancel.'
                );
                return;
            }
            throw new Error(data.error || 'Failed to cancel subscription');
        }

        // Show success message with period end date
        const periodEndDate = data.periodEnd ? new Date(data.periodEnd * 1000).toLocaleDateString() : '';
        const message = periodEndDate
            ? `Your subscription has been cancelled and will end on ${periodEndDate}.\n\nAfter that, you'll be on the Free plan with 2 scans per month.`
            : 'Your subscription has been cancelled. You will be downgraded to the Free plan at the end of your billing period.';

        await showXeoAlert('Subscription Cancelled', message);

        // Refresh billing data to show updated status
        await loadBillingData();

    } catch (error) {
        hideLoading();
        console.error('❌ Cancellation error:', error);
        await showXeoAlert('Cancellation Failed', `Unable to cancel subscription: ${error.message}\n\nPlease try again or contact support.`);
    }
}

// Load billing page data
async function loadBillingData() {
    if (!user) return;

    try {
        const planInfo = {
            free: {
                name: 'Free Plan',
                price: '$0/month',
                features: [
                    '2 scans per month',
                    'Track 1 page',
                    'Basic visibility score',
                    'Community support'
                ],
                scansLimit: 2,
                pagesLimit: 1,
                competitorsLimit: 0
            },
            diy: {
                name: 'DIY Plan',
                price: '$29/month',
                features: [
                    '25 scans per month',
                    'Up to 5 pages of the same domain',
                    'Website Visibility Index (full)',
                    'Copy-paste code snippets',
                    'Competitor scanning'
                ],
                scansLimit: 25,
                pagesLimit: 5,
                competitorsLimit: 2
            },
            pro: {
                name: 'Pro Plan',
                price: '$149/month',
                features: [
                    '50 scans per month',
                    'Up to 25 pages of the same domain',
                    'Website Visibility Index (full) & Brand Visibility Index (Lite)',
                    'Copy-paste code snippets',
                    '3 competitor analyses'
                ],
                scansLimit: 50,
                pagesLimit: 25,
                competitorsLimit: 3
            },
            enterprise: {
                name: 'Enterprise Plan',
                price: '$499/month',
                features: [
                    '200 scans per month',
                    'Up to 100 pages of the same domain',
                    'Website Visibility Index (full) & Brand Visibility Index (Full)',
                    '10 competitor analyses',
                    'Advanced AI monitoring (50+ queries)',
                    'Media & social tracking'
                ],
                scansLimit: 200,
                pagesLimit: 100,
                competitorsLimit: 10
            }
        };

        const currentPlan = planInfo[user.plan] || planInfo.free;

        // Update Current Plan section
        document.getElementById('billingPlanName').textContent = currentPlan.name;
        document.getElementById('billingPlanPrice').textContent = currentPlan.price;

        // Update renewal date
        const renewalDate = new Date();
        renewalDate.setMonth(renewalDate.getMonth() + 1);
        document.getElementById('billingRenewalDate').textContent =
            `Renews on ${renewalDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

        // Update plan features
        const featuresHtml = currentPlan.features.map(feature =>
            `<li style="padding: 0.5rem 0; color: var(--gray-600); font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem;">
                <i class="fas fa-check-circle" style="color: var(--good-green);"></i>
                ${feature}
            </li>`
        ).join('');
        document.getElementById('billingPlanFeatures').innerHTML = featuresHtml;

        // Update Usage Statistics
        const scansUsed = user.scans_used_this_month || 23; // Demo data
        const scansLimit = currentPlan.scansLimit;
        const scansPercent = scansLimit > 0 ? Math.round((scansUsed / scansLimit) * 100) : 0;
        const scansRemaining = Math.max(0, scansLimit - scansUsed);

        document.getElementById('billingScansUsed').textContent = `${scansUsed}/${scansLimit}`;
        document.getElementById('billingScansProgress').style.width = `${scansPercent}%`;
        document.getElementById('billingScansRemaining').textContent = `${scansRemaining} scans remaining`;

        // Pages tracked (demo data)
        const pagesUsed = 25;
        const pagesLimit = currentPlan.pagesLimit;
        const pagesPercent = pagesLimit > 0 ? Math.round((pagesUsed / pagesLimit) * 100) : 0;
        const pagesRemaining = Math.max(0, pagesLimit - pagesUsed);

        document.getElementById('billingPagesTracked').textContent = `${pagesUsed}/${pagesLimit}`;
        document.getElementById('billingPagesProgress').style.width = `${pagesPercent}%`;
        document.getElementById('billingPagesRemaining').textContent =
            pagesRemaining > 0 ? `${pagesRemaining} pages available` : 'At limit - upgrade for more';

        // Competitors (demo data)
        const competitorsUsed = 3;
        const competitorsLimit = currentPlan.competitorsLimit;
        const competitorsPercent = competitorsLimit > 0 ? Math.round((competitorsUsed / competitorsLimit) * 100) : 0;

        document.getElementById('billingCompetitors').textContent = `${competitorsUsed}/${competitorsLimit}`;
        document.getElementById('billingCompetitorsProgress').style.width = `${competitorsPercent}%`;
        document.getElementById('billingCompetitorsRemaining').textContent = 'At limit';

        // Quota reset date
        const resetDate = new Date();
        resetDate.setDate(1);
        resetDate.setMonth(resetDate.getMonth() + 1);
        document.getElementById('billingQuotaResetDate').textContent =
            resetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    } catch (error) {
        console.error('Error loading billing data:', error);
    }
}

// Coming Soon Modal Functions
function closeComingSoonModal() {
    document.getElementById('comingSoonModal').style.display = 'none';
}

async function selectDiyPlan() {
    // Close coming soon modal
    closeComingSoonModal();

    // Wait brief moment
    await new Promise(resolve => setTimeout(resolve, 200));

    // Set selected plan to DIY
    selectedPlanForChange = 'diy';

    // Open change plan modal with DIY pre-selected
    openChangePlanModal();

    // Pre-select DIY plan
    const diyOption = document.querySelector('.plan-option[data-plan="diy"]');
    if (diyOption) {
        document.querySelectorAll('.plan-option').forEach(o => o.classList.remove('selected'));
        diyOption.classList.add('selected');

        // Trigger the selection logic to show the upgrade note
        diyOption.click();
    }
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', initDashboard);
