const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : 'https://ai-visibility-tool.onrender.com/api';

// ============================================================================
// SUBMISSION STATUS CONSTANTS & VERIFICATION POLICY
// ============================================================================

const SUBMISSION_STATUS = {
    QUEUED: 'queued',
    IN_PROGRESS: 'in_progress',
    SUBMITTED: 'submitted',
    NEEDS_ACTION: 'needs_action',
    BLOCKED: 'blocked',
    IN_REVIEW: 'in_review',
    VERIFIED: 'verified',
    LIVE: 'live',
    REJECTED: 'rejected',
    FAILED: 'failed'
};

const ACTION_REQUIRED_TYPE = {
    NONE: 'none',
    EMAIL: 'email',
    SMS: 'sms',
    PHONE: 'phone',
    POSTCARD: 'postcard',
    VIDEO: 'video',
    CAPTCHA: 'captcha',
    MANUAL_REVIEW: 'manual_review'
};

// Dashboard display mapping for statuses
const STATUS_DISPLAY = {
    [SUBMISSION_STATUS.QUEUED]: { label: 'Pending', color: 'gray', icon: 'fa-clock', bgClass: 'status-pending' },
    [SUBMISSION_STATUS.IN_PROGRESS]: { label: 'Processing', color: 'blue', icon: 'fa-spinner fa-spin', bgClass: 'status-processing' },
    [SUBMISSION_STATUS.SUBMITTED]: { label: 'Submitted', color: 'blue', icon: 'fa-paper-plane', bgClass: 'status-submitted' },
    [SUBMISSION_STATUS.NEEDS_ACTION]: { label: 'Action Needed', color: 'orange', icon: 'fa-exclamation-circle', bgClass: 'status-action' },
    'action_needed': { label: 'Action Needed', color: 'orange', icon: 'fa-exclamation-circle', bgClass: 'status-action' }, // DB uses this variant
    [SUBMISSION_STATUS.BLOCKED]: { label: 'Blocked', color: 'red', icon: 'fa-ban', bgClass: 'status-blocked' },
    [SUBMISSION_STATUS.IN_REVIEW]: { label: 'In Review', color: 'blue', icon: 'fa-eye', bgClass: 'status-review' },
    [SUBMISSION_STATUS.VERIFIED]: { label: 'Verifying', color: 'teal', icon: 'fa-check-circle', bgClass: 'status-verifying' },
    [SUBMISSION_STATUS.LIVE]: { label: 'Live', color: 'green', icon: 'fa-check', bgClass: 'status-live' },
    [SUBMISSION_STATUS.REJECTED]: { label: 'Rejected', color: 'red', icon: 'fa-times', bgClass: 'status-rejected' },
    [SUBMISSION_STATUS.FAILED]: { label: 'Failed', color: 'red', icon: 'fa-exclamation-triangle', bgClass: 'status-failed' },
    // Phase 4: Already Listed status - business already has a listing
    'already_listed': { label: 'Already Listed', color: 'green', icon: 'fa-check-double', bgClass: 'status-already-listed' }
};

// Action type display mapping
const ACTION_TYPE_DISPLAY = {
    [ACTION_REQUIRED_TYPE.NONE]: { label: 'None', icon: 'fa-check', description: '' },
    [ACTION_REQUIRED_TYPE.EMAIL]: { label: 'Email Verification', icon: 'fa-envelope', description: 'Click verification link in your email' },
    [ACTION_REQUIRED_TYPE.SMS]: { label: 'SMS Code', icon: 'fa-mobile-alt', description: 'Enter the code sent to your phone' },
    [ACTION_REQUIRED_TYPE.PHONE]: { label: 'Phone Call', icon: 'fa-phone', description: 'Answer call and enter PIN shown below' },
    [ACTION_REQUIRED_TYPE.POSTCARD]: { label: 'Postcard Verification', icon: 'fa-envelope-open-text', description: 'Enter code from postcard mailed to your address' },
    [ACTION_REQUIRED_TYPE.VIDEO]: { label: 'Video Verification', icon: 'fa-video', description: 'Complete a short video verification' },
    [ACTION_REQUIRED_TYPE.CAPTCHA]: { label: 'CAPTCHA', icon: 'fa-robot', description: 'Complete the CAPTCHA challenge' },
    [ACTION_REQUIRED_TYPE.MANUAL_REVIEW]: { label: 'Manual Review', icon: 'fa-user-check', description: 'Awaiting manual review by directory' },
    // Phase 4: Duplicate detection action types
    'duplicate_review': { label: 'Verify Listing', icon: 'fa-search', description: 'We found a possible existing listing. Please verify if this is your business.' },
    'manual_submission': { label: 'Manual Submission', icon: 'fa-hand-pointer', description: 'Automatic submission was skipped. Please submit your listing manually.' }
};

// Valid status transitions
const VALID_TRANSITIONS = {
    [SUBMISSION_STATUS.QUEUED]: [SUBMISSION_STATUS.IN_PROGRESS, SUBMISSION_STATUS.FAILED],
    [SUBMISSION_STATUS.IN_PROGRESS]: [SUBMISSION_STATUS.SUBMITTED, SUBMISSION_STATUS.FAILED],
    [SUBMISSION_STATUS.SUBMITTED]: [
        SUBMISSION_STATUS.NEEDS_ACTION,
        SUBMISSION_STATUS.IN_REVIEW,
        SUBMISSION_STATUS.VERIFIED,
        SUBMISSION_STATUS.REJECTED,
        SUBMISSION_STATUS.FAILED
    ],
    [SUBMISSION_STATUS.NEEDS_ACTION]: [
        SUBMISSION_STATUS.VERIFIED,
        SUBMISSION_STATUS.BLOCKED,
        SUBMISSION_STATUS.FAILED
    ],
    [SUBMISSION_STATUS.BLOCKED]: [SUBMISSION_STATUS.NEEDS_ACTION], // Can resume
    [SUBMISSION_STATUS.IN_REVIEW]: [
        SUBMISSION_STATUS.VERIFIED,
        SUBMISSION_STATUS.REJECTED,
        SUBMISSION_STATUS.FAILED
    ],
    [SUBMISSION_STATUS.VERIFIED]: [SUBMISSION_STATUS.LIVE, SUBMISSION_STATUS.FAILED],
    [SUBMISSION_STATUS.LIVE]: [], // Terminal state
    [SUBMISSION_STATUS.REJECTED]: [], // Terminal state
    [SUBMISSION_STATUS.FAILED]: [SUBMISSION_STATUS.QUEUED] // Can retry
};

// Helper function to validate transition
function isValidTransition(fromStatus, toStatus) {
    return VALID_TRANSITIONS[fromStatus]?.includes(toStatus) ?? false;
}

// Timeout policy constants (in days)
const TIMEOUT_POLICY = {
    REMINDER_1_DAYS: 2,
    REMINDER_2_DAYS: 5,
    BLOCK_DAYS: 10
};

// ============================================================================
// AUTH TOKEN HELPER
// ============================================================================

/**
 * Get normalized auth token from localStorage
 * Handles both 'authToken' and 'token' keys, strips accidental 'Bearer ' prefix
 */
function getNormalizedAuthToken() {
    const raw = localStorage.getItem('authToken') || localStorage.getItem('token');
    if (!raw) return null;
    // Strip "Bearer " prefix if accidentally stored with it
    return raw.startsWith('Bearer ') ? raw.slice(7) : raw;
}

// ============================================================================
// JWT DECODE & USER-SCOPED STORAGE
// ============================================================================

/**
 * Decode JWT and extract payload (no external library needed)
 * @param {string} token - JWT token (with or without Bearer prefix)
 * @returns {object|null} Decoded payload or null if invalid
 */
function decodeJWT(token) {
    try {
        if (!token) return null;
        // Remove 'Bearer ' prefix if present
        const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
        // JWT is base64url encoded: header.payload.signature
        const parts = cleanToken.split('.');
        if (parts.length !== 3) return null;
        // Decode payload (middle part) - handle base64url encoding
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload;
    } catch (e) {
        console.error('[JWT] Failed to decode:', e);
        return null;
    }
}

/**
 * Get current user ID from JWT token - deterministic, no async
 * @returns {number|string|null} User ID or null if not logged in
 */
function getCurrentUserId() {
    const token = getNormalizedAuthToken();
    if (!token) return null;
    const payload = decodeJWT(token);
    return payload?.id || payload?.userId || payload?.user_id || payload?.sub || null;
}

/**
 * Get user-scoped storage key to prevent data bleed between users
 * @param {string} key - Base storage key
 * @returns {string} User-scoped key (e.g., "businessProfile:123")
 */
function getUserStorageKey(key) {
    const userId = getCurrentUserId();
    return userId ? `${key}:${userId}` : key;
}

// Track last known user to detect user changes
let lastKnownUserId = null;

/**
 * Check if user changed (call on app init and after login)
 * Clears old user data if user switched accounts
 */
function checkUserChanged() {
    const currentUserId = getCurrentUserId();

    // Initialize on first call
    if (lastKnownUserId === null) {
        lastKnownUserId = currentUserId;
        return;
    }

    // Detect user change
    if (lastKnownUserId && currentUserId && lastKnownUserId !== currentUserId) {
        console.log(`[Auth] User changed from ${lastKnownUserId} to ${currentUserId}, clearing old user data`);
        clearUserLocalStorage(lastKnownUserId);
    }

    lastKnownUserId = currentUserId;
}

/**
 * Clear user-scoped localStorage data
 * @param {string|number|null} userId - Specific user ID to clear, or null for current user
 */
function clearUserLocalStorage(userId = null) {
    const targetUserId = userId || getCurrentUserId();
    if (!targetUserId) return;

    const keysToRemove = [
        `businessProfile:${targetUserId}`,
        `citationNetworkState:${targetUserId}`,
        `profileDraft:${targetUserId}`,
        `submissionFilters:${targetUserId}`,
        `dashboardPrefs:${targetUserId}`
    ];

    keysToRemove.forEach(key => {
        if (localStorage.getItem(key)) {
            localStorage.removeItem(key);
            console.log(`[Storage] Removed ${key}`);
        }
    });

    console.log(`[Storage] Cleared data for user ${targetUserId}`);
}

/**
 * Logout helper - clears user data and tokens
 */
function handleLogout() {
    clearUserLocalStorage();
    localStorage.removeItem('authToken');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('organization');
    localStorage.removeItem('quota');
    localStorage.removeItem('quotaLegacy');
    lastKnownUserId = null;
    console.log('[Auth] Logged out, cleared all user data');
    // Redirect to login
    window.location.href = '/login.html';
}

// Initialize user tracking on page load
document.addEventListener('DOMContentLoaded', () => {
    checkUserChanged();
});

// ============================================================================

/**
 * Convert backend score (0-100) to display score (0-1000)
 */
function getDisplayScore(backendScore) {
    return Math.round(backendScore * 10);
}

// Global state
let user = null;
let organization = null;  // Phase 3A: Organization data
let quotaData = null;     // Phase 3A: v2 quota object
let quotaLegacy = null;   // Phase 3A: Legacy quota fallback
let quota = { used: 0, limit: 2 };  // Backwards compatible quota
let currentSection = 'dashboard-home';
let selectedScanType = 'single-page'; // Track selected scan type (single-page or multi-page)

// Initialize dashboard
async function initDashboard() {
    // Check authentication
    const authToken = localStorage.getItem('authToken');
    if (!authToken) {
        console.log('Dashboard: No auth token found, redirecting to auth');
        window.location.href = 'auth.html';
        return;
    }

    try {
        console.log('Dashboard: Fetching user data from', API_BASE_URL);
        // Fetch user data
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        console.log('Dashboard: /auth/me response status:', response.status);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Dashboard: /auth/me failed:', response.status, errorData);
            throw new Error(errorData.error || 'Not authenticated');
        }

        const data = await response.json();
        user = data.user;
        console.log('Dashboard: User loaded, email_verified:', user.email_verified);

        // Phase 3A: Store organization and quota data
        organization = data.organization || null;
        quotaData = data.quota || null;
        quotaLegacy = data.quotaLegacy || null;

        // Check email verification
        if (!user.email_verified) {
            console.log('Dashboard: Email not verified, redirecting to verify.html');
            window.location.href = 'verify.html';
            return;
        }

        // Store user and org data in localStorage
        localStorage.setItem('user', JSON.stringify(user));
        if (organization) {
            localStorage.setItem('organization', JSON.stringify(organization));
        }
        if (quotaData) {
            localStorage.setItem('quota', JSON.stringify(quotaData));
        }
        if (quotaLegacy) {
            localStorage.setItem('quotaLegacy', JSON.stringify(quotaLegacy));
        }

        // Update UI
        updateUserInfo();
        updateOrgInfo();  // Phase 3A: Update org display
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

    } catch (error) {
        console.error('Dashboard init error:', error.message);
        console.error('Dashboard: Full error:', error);
        console.log('Dashboard: Clearing auth and redirecting to auth.html');
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
        localStorage.removeItem('organization');
        localStorage.removeItem('quota');
        localStorage.removeItem('quotaLegacy');
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

// Phase 3A: Update organization info in header and settings
function updateOrgInfo() {
    // Update org name in header (if element exists)
    const orgNameHeader = document.getElementById('orgNameHeader');
    if (orgNameHeader) {
        if (organization && organization.name) {
            orgNameHeader.textContent = organization.name;
            orgNameHeader.style.display = 'block';
        } else {
            orgNameHeader.style.display = 'none';
        }
    }

    // Update org info in settings section
    const orgNameSettings = document.getElementById('orgNameSettings');
    const orgIdSettings = document.getElementById('orgIdSettings');
    const orgPlanSettings = document.getElementById('orgPlanSettings');
    const orgSection = document.getElementById('organizationSection');

    if (orgSection) {
        if (organization) {
            orgSection.style.display = 'block';
            if (orgNameSettings) orgNameSettings.textContent = organization.name || 'N/A';
            if (orgIdSettings) orgIdSettings.textContent = organization.id || 'N/A';
            if (orgPlanSettings) orgPlanSettings.textContent = organization.plan || user.plan || 'free';
        } else {
            // Hide org section when no organization data
            orgSection.style.display = 'none';
        }
    }
}

// Update quota display
// Phase 3A: Use QuotaUtils helper for unified quota handling
function updateQuota() {
    const planLimits = {
        free: { primary: 2, competitor: 0, pages: 1 },
        diy: { primary: 25, competitor: 2, pages: 5 },
        pro: { primary: 50, competitor: 3, pages: 25 },
        agency: { primary: -1, competitor: 0, pages: -1 },
        enterprise: { primary: -1, competitor: 10, pages: -1 }
    };

    const limits = planLimits[user.plan] || planLimits.free;

    // Phase 3A: Try to use normalized quota from QuotaUtils
    let normalizedQuota = null;
    if (window.QuotaUtils) {
        normalizedQuota = window.QuotaUtils.getQuotaDisplay(quotaData, quotaLegacy);
        if (!normalizedQuota) {
            normalizedQuota = window.QuotaUtils.getQuotaFromUser(user);
        }
    }

    // Primary scan quota (use normalized if available, fallback to legacy)
    if (normalizedQuota) {
        quota = {
            used: normalizedQuota.primary.used,
            limit: normalizedQuota.primary.limit === -1 ? Infinity : normalizedQuota.primary.limit
        };
    } else {
        quota = {
            used: user.scans_used_this_month || 0,
            limit: limits.primary === -1 ? Infinity : limits.primary
        };
    }

    // Update dashboard stats
    const scansUsedText = quota.limit === Infinity
        ? `${quota.used} (Unlimited)`
        : `${quota.used}/${quota.limit}`;
    const scansPercent = quota.limit === Infinity
        ? 0
        : (quota.limit > 0 ? Math.round((quota.used / quota.limit) * 100) : 0);

    const dashboardScansUsed = document.getElementById('dashboardScansUsed');
    const dashboardScansPercent = document.getElementById('dashboardScansPercent');
    if (dashboardScansUsed) dashboardScansUsed.textContent = scansUsedText;
    if (dashboardScansPercent) dashboardScansPercent.textContent = `${scansPercent}% used`;

    // Update page selector limits
    const pageSelectorLimit = document.getElementById('pageSelectorLimit');
    if (pageSelectorLimit) {
        pageSelectorLimit.textContent = limits.pages === -1 ? 'Unlimited' : limits.pages;
    }

    // Phase 3A: Update competitor quota display if elements exist
    if (normalizedQuota) {
        const competitorQuotaEl = document.getElementById('competitorQuotaDisplay');
        if (competitorQuotaEl) {
            const cLimit = normalizedQuota.competitor.limit;
            const cUsed = normalizedQuota.competitor.used;
            competitorQuotaEl.textContent = cLimit === -1
                ? `${cUsed} (Unlimited)`
                : `${cUsed}/${cLimit}`;
        }
    }
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
    // Validate section exists - fallback to citation-network if not found
    const targetSection = document.getElementById(sectionId);
    if (!targetSection) {
        console.error(`navigateToSection: section "${sectionId}" not found, falling back to citation-network`);
        sectionId = 'citation-network';
    }

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

    // Track scan started
    if (window.Analytics) {
        window.Analytics.trackScanStarted(url);
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
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => {
                    throw new Error(err.error || err.message || `Request failed with status ${response.status}`);
                });
            }
            return response.json();
        })
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
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => {
                    throw new Error(err.error || err.message || `Request failed with status ${response.status}`);
                });
            }
            return response.json();
        })
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
    localStorage.removeItem('organization');
    localStorage.removeItem('quota');
    localStorage.removeItem('quotaLegacy');
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

// Loading helpers with progress bar animation
let scanProgressInterval = null;

function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    const progressBar = document.getElementById('scanProgressBar');

    if (overlay) {
        overlay.style.display = 'flex';

        // Reset and animate progress bar
        if (progressBar) {
            progressBar.style.width = '0%';
            let progress = 0;

            // Clear any existing interval
            if (scanProgressInterval) {
                clearInterval(scanProgressInterval);
            }

            // Animate progress bar up to 90%
            scanProgressInterval = setInterval(() => {
                progress += Math.random() * 15;
                if (progress > 90) progress = 90; // Stop at 90% until complete
                progressBar.style.width = progress + '%';
            }, 500);
        }
    }
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    const progressBar = document.getElementById('scanProgressBar');

    // Clear progress interval
    if (scanProgressInterval) {
        clearInterval(scanProgressInterval);
        scanProgressInterval = null;
    }

    // Complete progress bar before hiding
    if (progressBar) {
        progressBar.style.width = '100%';
    }

    // Brief delay to show 100% before hiding
    setTimeout(() => {
        if (overlay) overlay.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';
    }, 300);
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

// ============================================================================
// AI CITATION NETWORK FUNCTIONS
// ============================================================================

// Mock state for Citation Network (Phase 1 - UI only)
const citationNetworkState = {
    // User's plan
    plan: 'diy', // 'diy', 'pro', 'agency', 'enterprise'
    monthlyAllocation: 10, // Based on plan

    // Profile status
    hasBusinessProfile: false, // Will be set to true when profile is completed

    // Included allocation status
    includedStatus: 'no_profile', // 'no_profile', 'ready', 'in_progress', 'complete'
    includedProgress: {
        total: 10,
        submitted: 0,
        live: 0,
        pending: 0,
        actionNeeded: 0,
        blocked: 0
    },

    // Boost status
    boostsUsedThisYear: 0,
    boostsRemaining: 2,
    hasActiveBoost: false,
    boostProgress: {
        total: 100,
        submitted: 0,
        live: 0,
        pending: 0,
        actionNeeded: 0,
        blocked: 0
    },

    // Directory submissions tracking
    submissions: [],

    // Blocked submissions backlog
    blockedSubmissions: [],

    // Credentials stored in vault
    credentials: [],

    // Phone policy settings (from business profile)
    phonePolicy: {
        allowPhoneOnListings: true,
        allowPhoneVerification: true,
        verificationPhone: ''
    }
};

// Mock submissions data for demo
const mockSubmissions = [
    {
        id: 'sub_001',
        directoryId: 'dir_001',
        directoryName: 'G2',
        directoryLogo: 'https://logo.clearbit.com/g2.com',
        status: SUBMISSION_STATUS.LIVE,
        actionType: ACTION_REQUIRED_TYPE.NONE,
        submittedAt: '2024-12-15T10:00:00Z',
        liveAt: '2024-12-18T14:30:00Z',
        listingUrl: 'https://g2.com/products/example'
    },
    {
        id: 'sub_002',
        directoryId: 'dir_002',
        directoryName: 'Capterra',
        directoryLogo: 'https://logo.clearbit.com/capterra.com',
        status: SUBMISSION_STATUS.VERIFIED,
        actionType: ACTION_REQUIRED_TYPE.NONE,
        submittedAt: '2024-12-16T09:00:00Z',
        verifiedAt: '2024-12-20T11:00:00Z'
    },
    {
        id: 'sub_003',
        directoryId: 'dir_003',
        directoryName: 'Product Hunt',
        directoryLogo: 'https://logo.clearbit.com/producthunt.com',
        status: SUBMISSION_STATUS.NEEDS_ACTION,
        actionType: ACTION_REQUIRED_TYPE.EMAIL,
        actionInstructions: 'Click the verification link sent to your email',
        actionRequiredAt: '2024-12-19T15:00:00Z',
        submittedAt: '2024-12-17T12:00:00Z',
        daysRemaining: 7
    },
    {
        id: 'sub_004',
        directoryId: 'dir_004',
        directoryName: 'Yelp',
        directoryLogo: 'https://logo.clearbit.com/yelp.com',
        status: SUBMISSION_STATUS.NEEDS_ACTION,
        actionType: ACTION_REQUIRED_TYPE.PHONE,
        actionInstructions: 'Answer the verification call and enter PIN: 4829',
        actionRequiredAt: '2024-12-18T10:00:00Z',
        submittedAt: '2024-12-16T14:00:00Z',
        daysRemaining: 4
    },
    {
        id: 'sub_005',
        directoryId: 'dir_005',
        directoryName: 'TrustRadius',
        directoryLogo: 'https://logo.clearbit.com/trustradius.com',
        status: SUBMISSION_STATUS.IN_PROGRESS,
        actionType: ACTION_REQUIRED_TYPE.NONE,
        submittedAt: null
    },
    {
        id: 'sub_006',
        directoryId: 'dir_006',
        directoryName: 'SoftwareAdvice',
        directoryLogo: 'https://logo.clearbit.com/softwareadvice.com',
        status: SUBMISSION_STATUS.QUEUED,
        actionType: ACTION_REQUIRED_TYPE.NONE
    }
];

// Mock blocked submissions
const mockBlockedSubmissions = [
    {
        id: 'sub_blocked_001',
        directoryId: 'dir_010',
        directoryName: 'Clutch',
        directoryLogo: 'https://logo.clearbit.com/clutch.co',
        status: SUBMISSION_STATUS.BLOCKED,
        actionType: ACTION_REQUIRED_TYPE.POSTCARD,
        blockedAt: '2024-12-10T12:00:00Z',
        blockedReason: 'Verification timeout - postcard code not entered within 10 days',
        replacedById: 'sub_007',
        replacedByName: 'Trustpilot'
    }
];

// Mock credentials
const mockCredentials = [
    {
        id: 'cred_001',
        directoryName: 'G2',
        accountUrl: 'https://my.g2.com/login',
        createdAt: '2024-12-15T10:00:00Z',
        handedOffAt: null
    },
    {
        id: 'cred_002',
        directoryName: 'Capterra',
        accountUrl: 'https://vendors.capterra.com',
        createdAt: '2024-12-16T09:00:00Z',
        handedOffAt: null
    },
    {
        id: 'cred_003',
        directoryName: 'Product Hunt',
        accountUrl: 'https://producthunt.com/login',
        createdAt: '2024-12-17T12:00:00Z',
        handedOffAt: null
    }
];

// Plan allocation mapping
const planAllocations = {
    'diy': { allocation: 10, label: '10 directories/month', planName: 'DIY Plan' },
    'pro': { allocation: 25, label: '25 directories/month', planName: 'Pro Plan' },
    'agency': { allocation: 25, label: '25 directories/domain', planName: 'Agency Plan' },
    'enterprise': { allocation: 75, label: '75 directories shared', planName: 'Enterprise Plan' }
};

// Initialize Citation Network UI
async function initCitationNetwork() {
    // Load real data from API (will update state)
    await loadCitationNetworkData();

    // Initialize submissions data from API
    await initSubmissionsData();

    // Update main Citation Network UI
    updateCitationNetworkUI();

    // Render the submissions tabs
    renderCitationNetworkTabs();

    // Check for success/cancelled params
    checkCitationNetworkParams();
}

// Check URL params for checkout success/cancelled
function checkCitationNetworkParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const tab = urlParams.get('tab');
    const success = urlParams.get('success');
    const cancelled = urlParams.get('cancelled');
    const orderId = urlParams.get('order');

    if (tab === 'citation-network') {
        // Navigate to citation network section
        navigateToSection('citation-network');

        if (success === 'true') {
            showXeoAlert('Purchase Successful!', 'Your directory pack has been activated. We\'ll start submitting to directories within 24 hours.');
            // Clean up URL
            window.history.replaceState({}, '', window.location.pathname);
            // Reload data
            loadCitationNetworkData();
        }

        if (cancelled === 'true') {
            showXeoAlert('Checkout Cancelled', 'Your checkout was cancelled. You can try again whenever you\'re ready.');
            // Clean up URL
            window.history.replaceState({}, '', window.location.pathname);
        }
    }
}

// Update Citation Network UI based on state
function updateCitationNetworkUI() {
    const state = citationNetworkState;

    // Update plan allocation display
    const planConfig = planAllocations[state.plan] || planAllocations['diy'];
    const allocationEl = document.getElementById('citationAllocation');
    const planTypeEl = document.getElementById('citationPlanType');

    if (allocationEl) allocationEl.textContent = planConfig.label;
    if (planTypeEl) planTypeEl.textContent = planConfig.planName;

    // Update included card based on status
    const noProfileEl = document.getElementById('citationNoProfile');
    const readyEl = document.getElementById('citationReadyToStart');
    const inProgressEl = document.getElementById('citationInProgress');
    const includedCTABtn = document.getElementById('includedCTABtn');

    // Hide all states first
    if (noProfileEl) noProfileEl.style.display = 'none';
    if (readyEl) readyEl.style.display = 'none';
    if (inProgressEl) inProgressEl.style.display = 'none';

    // Check if user has a business profile first
    if (!state.hasBusinessProfile) {
        // No profile - show prompt to complete profile
        if (noProfileEl) noProfileEl.style.display = 'block';
        if (includedCTABtn) {
            includedCTABtn.innerHTML = '<i class="fas fa-user-edit"></i> Complete Business Profile';
            includedCTABtn.className = 'btn-citation-primary';
        }
    } else {
        // Has profile - show appropriate state based on status
        switch (state.includedStatus) {
            case 'no_profile':
                if (noProfileEl) noProfileEl.style.display = 'block';
                if (includedCTABtn) {
                    includedCTABtn.innerHTML = '<i class="fas fa-user-edit"></i> Complete Business Profile';
                    includedCTABtn.className = 'btn-citation-primary';
                }
                break;
            case 'ready':
                if (readyEl) readyEl.style.display = 'block';
                if (includedCTABtn) {
                    includedCTABtn.innerHTML = '<i class="fas fa-play-circle"></i> Start Submissions';
                    includedCTABtn.className = 'btn-citation-primary';
                }
                break;
            case 'in_progress':
            case 'complete':
                if (inProgressEl) inProgressEl.style.display = 'block';
                updateIncludedProgress();
                if (includedCTABtn) {
                    includedCTABtn.innerHTML = '<i class="fas fa-eye"></i> View Details';
                    includedCTABtn.className = 'btn-citation-secondary';
                }
                break;
        }
    }

    // Update boost card
    updateBoostCardUI();
}

// Update included progress section
function updateIncludedProgress() {
    const progress = citationNetworkState.includedProgress;
    const total = progress.total || 10;
    const submitted = progress.submitted || 0;
    const percentage = total > 0 ? (submitted / total) * 100 : 0;

    const progressFill = document.getElementById('includedProgressFill');
    const progressCurrent = document.getElementById('includedProgressCurrent');
    const progressTotal = document.getElementById('includedProgressTotal');

    if (progressFill) progressFill.style.width = percentage + '%';
    if (progressCurrent) progressCurrent.textContent = submitted;
    if (progressTotal) progressTotal.textContent = total;

    // Update status counts
    const submittedEl = document.getElementById('includedSubmitted');
    const liveEl = document.getElementById('includedLive');
    const pendingEl = document.getElementById('includedPending');
    const actionNeededEl = document.getElementById('includedActionNeeded');

    if (submittedEl) submittedEl.textContent = progress.submitted || 0;
    if (liveEl) liveEl.textContent = progress.live || 0;
    if (pendingEl) pendingEl.textContent = progress.pending || 0;
    if (actionNeededEl) actionNeededEl.textContent = progress.actionNeeded || 0;
}

// Update boost card UI
function updateBoostCardUI() {
    const state = citationNetworkState;
    const boostsRemainingEl = document.getElementById('boostsRemaining');
    const boostProgressEl = document.getElementById('boostProgress');
    const boostCTABtn = document.getElementById('boostCTABtn');

    // Update boosts remaining text
    if (boostsRemainingEl) {
        boostsRemainingEl.innerHTML = `<i class="fas fa-bolt" style="color: var(--brand-cyan); margin-right: 0.5rem;"></i>
            You have <strong>${state.boostsRemaining}</strong> boost${state.boostsRemaining !== 1 ? 's' : ''} remaining`;
    }

    // Show/hide boost progress
    if (boostProgressEl) {
        boostProgressEl.style.display = state.hasActiveBoost ? 'block' : 'none';
    }

    // Update boost progress if active
    if (state.hasActiveBoost) {
        updateBoostProgress();
    }

    // Update CTA button
    if (boostCTABtn) {
        if (state.boostsRemaining <= 0 && !state.hasActiveBoost) {
            boostCTABtn.innerHTML = '<i class="fas fa-ban"></i> Maximum Reached';
            boostCTABtn.className = 'btn-citation-disabled';
            boostCTABtn.disabled = true;
            boostCTABtn.title = 'Next boost available next year';
        } else if (state.hasActiveBoost) {
            // Check if submissions need to be started (no queued or submitted directories)
            const progress = state.boostProgress || {};
            const needsStart = (progress.pending || 0) === 0 &&
                               (progress.submitted || 0) === 0 &&
                               (progress.live || 0) === 0;
            if (needsStart) {
                boostCTABtn.innerHTML = '<i class="fas fa-play-circle"></i> Start Submissions';
                boostCTABtn.className = 'btn-citation-primary';
                boostCTABtn.disabled = false;
            } else {
                boostCTABtn.innerHTML = '<i class="fas fa-chart-line"></i> View Progress';
                boostCTABtn.className = 'btn-citation-secondary';
                boostCTABtn.disabled = false;
            }
        } else {
            const btnText = state.boostsUsedThisYear > 0 ? 'Purchase Another — $99' : 'Purchase Boost — $99';
            boostCTABtn.innerHTML = `<i class="fas fa-shopping-cart"></i> ${btnText}`;
            boostCTABtn.className = 'btn-citation-primary';
            boostCTABtn.disabled = false;
        }
    }
}

// Update boost progress section
function updateBoostProgress() {
    const progress = citationNetworkState.boostProgress;
    const total = progress.total || 100;
    const submitted = progress.submitted || 0;
    const percentage = total > 0 ? (submitted / total) * 100 : 0;

    const progressFill = document.getElementById('boostProgressFill');
    const progressCurrent = document.getElementById('boostProgressCurrent');
    const progressTotal = document.getElementById('boostProgressTotal');

    if (progressFill) progressFill.style.width = percentage + '%';
    if (progressCurrent) progressCurrent.textContent = submitted;
    if (progressTotal) progressTotal.textContent = total;

    // Update status counts
    const submittedEl = document.getElementById('boostSubmitted');
    const liveEl = document.getElementById('boostLive');
    const pendingEl = document.getElementById('boostPending');
    const actionNeededEl = document.getElementById('boostActionNeeded');

    if (submittedEl) submittedEl.textContent = progress.submitted || 0;
    if (liveEl) liveEl.textContent = progress.live || 0;
    if (pendingEl) pendingEl.textContent = progress.pending || 0;
    if (actionNeededEl) actionNeededEl.textContent = progress.actionNeeded || 0;
}

// Handle included plan CTA button click
async function handleIncludedCTA() {
    const state = citationNetworkState;

    // First check if we have a business profile
    if (!state.hasBusinessProfile) {
        // Navigate to business profile form
        navigateToSection('business-profile');
        return;
    }

    switch (state.includedStatus) {
        case 'no_profile':
            // Navigate to business profile form
            navigateToSection('business-profile');
            break;
        case 'ready':
            // Start submissions - call real API
            await startDirectorySubmissions();
            break;
        case 'in_progress':
        case 'complete':
            // Show details - navigate to submissions tab
            const submissionsTab = document.querySelector('[data-citation-tab="submissions"]');
            if (submissionsTab) {
                submissionsTab.click();
            }
            break;
    }
}

// Start directory submissions via API
async function startDirectorySubmissions() {
    const authToken = getNormalizedAuthToken();
    if (!authToken) {
        showXeoAlert('Login Required', 'Please log in to start submissions.');
        return;
    }

    // Show loading state on button
    const btn = document.getElementById('includedCTABtn');
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="loading-spinner"></span> Starting...';
    }

    try {
        const response = await fetch(`${API_BASE_URL}/citation-network/start-submissions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filters: {} })
        });

        const data = await response.json();

        if (!response.ok) {
            // Handle specific errors
            if (data.code === 'PROFILE_REQUIRED' || data.code === 'PROFILE_INCOMPLETE') {
                // Restore button before showing dialog
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = originalHtml;
                }
                showXeoConfirm('Complete Your Profile',
                    'Please complete your business profile before starting submissions.\n\nWould you like to complete it now?',
                    function(confirmed) {
                        if (confirmed) {
                            navigateToSection('business-profile');
                        }
                    }
                );
                return;
            }

            if (data.code === 'ACTIVE_CAMPAIGN_EXISTS') {
                showXeoAlert('Campaign Active', 'You already have an active submission campaign running. Check the progress below.');
                citationNetworkState.includedStatus = 'in_progress';
                updateCitationNetworkUI();
                return;
            }

            if (data.code === 'NO_ENTITLEMENT') {
                showXeoAlert('No Submissions Available', 'You have used all your directory submissions for this period.\n\nUpgrade your plan or purchase a boost to continue.');
                return;
            }

            if (data.code === 'NO_DIRECTORIES_AVAILABLE') {
                showXeoAlert('No Directories Found', 'No eligible directories found matching your criteria.\n\nTry adjusting your filters or check back later.');
                return;
            }

            throw new Error(data.error || 'Failed to start submissions');
        }

        // Success! Use fallback pattern for response field name
        const queued = data.directoriesQueued ?? data.submissionsQueued ?? data.directories_queued ?? 0;
        const remaining = data.entitlementRemaining ?? data.entitlement_remaining ?? 0;

        showXeoAlert('Submissions Started!',
            `${queued} directories have been queued for submission!\n\n` +
            `We'll submit to ~3-5 directories per day.\n\n` +
            `${remaining} submissions remaining${citationNetworkState.plan !== 'freemium' ? ' this month' : ''}.`
        );

        // Update state
        citationNetworkState.includedStatus = 'in_progress';
        citationNetworkState.includedProgress = {
            total: queued,
            submitted: 0,
            live: 0,
            pending: queued,
            actionNeeded: 0
        };

        // Refresh the UI
        updateCitationNetworkUI();

        // Also refresh from API to get latest data
        await loadCitationNetworkData();

    } catch (error) {
        console.error('Start submissions error:', error);
        showXeoAlert('Error', error.message || 'Failed to start submissions. Please try again.');
    } finally {
        // Restore button
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

// Handle boost purchase button click - Connects to real Stripe checkout
async function handleBoostPurchase() {
    const state = citationNetworkState;

    // FIRST check if user has an active boost that needs attention
    if (state.hasActiveBoost) {
        // Check if submissions need to be started
        const progress = state.boostProgress || {};
        const needsStart = (progress.pending || 0) === 0 &&
                           (progress.submitted || 0) === 0 &&
                           (progress.live || 0) === 0;

        if (needsStart) {
            // Start submissions for this boost
            showXeoConfirm('Start Directory Submissions',
                `You have ${progress.total || 100} directory submissions ready.\n\nStart submitting to directories now?\n\n• We'll submit to 3-5 directories per day\n• You'll be notified of any actions needed\n• Track progress in this dashboard`,
                async function(confirmed) {
                    if (confirmed) {
                        await startDirectorySubmissions();
                    }
                }
            );
        } else {
            // Show progress
            showXeoAlert('Boost Progress',
                `Current Boost Progress:\n\n` +
                `• Submitted: ${progress.submitted || 0}/${progress.total || 100}\n` +
                `• Live: ${progress.live || 0}\n` +
                `• Pending: ${progress.pending || 0}\n` +
                `• Action Needed: ${progress.actionNeeded || 0}`);
        }
        return;
    }

    // Only check boosts remaining when trying to purchase a NEW boost
    if (state.boostsRemaining <= 0) {
        showXeoAlert('Maximum Boosts Reached', 'You have used both of your annual boosts.\n\nYour next boost will be available at the start of the next year.');
        return;
    }

    // No active boost, try to purchase one
    // Real Stripe checkout integration
    try {
        // First check if we can purchase (for business profile requirement)
        const checkoutInfo = await fetchCitationNetworkCheckoutInfo();

        if (!checkoutInfo.canPurchase) {
            if (checkoutInfo.reason && checkoutInfo.reason.includes('profile')) {
                showXeoConfirm('Business Profile Required',
                    'Please complete your business profile before purchasing a directory pack.\n\nWould you like to set it up now?',
                    function(confirmed) {
                        if (confirmed) {
                            navigateToSection('business-profile');
                        }
                    }
                );
            } else {
                showXeoAlert('Cannot Purchase', checkoutInfo.reason || 'Unable to complete purchase at this time.');
            }
            return;
        }

        // Show BOOST purchase confirmation (this IS the boost button, so show boost info)
        // Don't use checkoutInfo.product/price - those may be wrong due to subscription check issues
        showXeoConfirm('Purchase Boost Pack',
            `Add 100 directory submissions for $99?\n\n• One-time purchase\n• 30-day delivery\n• Full tracking dashboard`,
            async function(confirmed) {
                if (confirmed) {
                    // Use /packs/checkout with explicit pack_type to bypass subscription check issues
                    await startBoostPackCheckout();
                }
            }
        );
    } catch (error) {
        console.error('Error checking checkout info:', error);
        showXeoAlert('Error', 'Unable to load checkout information. Please try again.');
    }
}

// Fetch checkout info from API
async function fetchCitationNetworkCheckoutInfo() {
    const authToken = localStorage.getItem('authToken');
    const response = await fetch(`${API_BASE_URL}/citation-network/checkout-info`, {
        headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    });

    if (!response.ok) {
        throw new Error('Failed to fetch checkout info');
    }

    return await response.json();
}

// Start Boost Pack checkout - explicitly requests boost pack
async function startBoostPackCheckout() {
    const authToken = localStorage.getItem('authToken');

    if (!authToken) {
        showXeoAlert('Login Required', 'Please log in to purchase a boost pack.');
        return;
    }

    try {
        // Use /packs/checkout with explicit pack_type: 'boost'
        const response = await fetch(`${API_BASE_URL}/citation-network/packs/checkout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ pack_type: 'boost' })
        });

        const data = await response.json();

        if (!response.ok) {
            if (data.redirect) {
                navigateToSection('business-profile');
                return;
            }
            throw new Error(data.error?.message || data.error || 'Checkout failed');
        }

        // Redirect to Stripe checkout
        if (data.data?.checkoutUrl) {
            window.location.href = data.data.checkoutUrl;
        } else if (data.url) {
            window.location.href = data.url;
        } else {
            throw new Error('No checkout URL received');
        }
    } catch (error) {
        console.error('Boost checkout error:', error);
        showXeoAlert('Checkout Failed', error.message || 'Unable to start checkout. Please try again.');
    }
}

// Start the Stripe checkout process
async function startCitationNetworkCheckout() {
    const authToken = localStorage.getItem('authToken');

    if (!authToken) {
        showXeoAlert('Login Required', 'Please log in to purchase a directory pack.');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/citation-network/checkout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        const data = await response.json();

        if (!response.ok) {
            if (data.redirect) {
                navigateToSection('business-profile');
                return;
            }
            throw new Error(data.error || 'Checkout failed');
        }

        // Redirect to Stripe checkout
        if (data.url) {
            window.location.href = data.url;
        } else {
            throw new Error('No checkout URL received');
        }
    } catch (error) {
        console.error('Checkout error:', error);
        showXeoAlert('Checkout Failed', error.message || 'Unable to start checkout. Please try again.');
    }
}

// Start directory submissions via API
async function startDirectorySubmissions() {
    const authToken = localStorage.getItem('authToken');

    if (!authToken) {
        showXeoAlert('Login Required', 'Please log in to start submissions.');
        return;
    }

    try {
        showXeoAlert('Starting Submissions', 'Please wait while we queue your directory submissions...');

        const response = await fetch(`${API_BASE_URL}/citation-network/start-submissions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok) {
            if (data.code === 'PROFILE_INCOMPLETE') {
                showXeoConfirm('Complete Your Profile',
                    'Please complete your business profile before starting submissions.\n\nWould you like to complete it now?',
                    function(confirmed) {
                        if (confirmed) {
                            navigateToSection('citation-network-profile');
                        }
                    }
                );
                return;
            }
            if (data.code === 'ALREADY_IN_PROGRESS') {
                showXeoAlert('Submissions In Progress', 'You already have directory submissions in progress. Check the progress below.');
                await refreshSubmissionProgress();
                return;
            }
            throw new Error(data.error || 'Failed to start submissions');
        }

        // Success - update UI
        const queued = data.directoriesQueued ?? data.submissionsQueued ?? data.directories_queued ?? 0;
        showXeoAlert('Submissions Started!',
            `${queued} directories have been queued for submission.\n\n` +
            `We'll submit to 3-5 directories per day.\n\n` +
            `Check back here to monitor progress.`
        );

        // Update state
        citationNetworkState.includedStatus = 'in_progress';
        citationNetworkState.includedProgress = {
            total: queued,
            submitted: 0,
            live: 0,
            pending: queued,
            actionNeeded: 0
        };
        updateCitationNetworkUI();

    } catch (error) {
        console.error('Start submissions error:', error);
        showXeoAlert('Error', error.message || 'Failed to start submissions. Please try again.');
    }
}

// Show detailed submission progress
async function showSubmissionProgressDetails() {
    const authToken = localStorage.getItem('authToken');

    if (!authToken) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/citation-network/submission-progress`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
            const progress = await response.json();

            showXeoAlert('Submission Progress',
                `Directory Submission Status:\n\n` +
                `• Queued: ${progress.queued}\n` +
                `• In Progress: ${progress.inProgress}\n` +
                `• Submitted: ${progress.submitted}\n` +
                `• Live: ${progress.live}\n` +
                `• Action Needed: ${progress.actionNeeded}\n` +
                `• Rejected: ${progress.rejected}\n\n` +
                `Total: ${progress.total} directories`
            );
        }
    } catch (error) {
        console.error('Error fetching progress:', error);
    }
}

// Refresh submission progress and update UI
async function refreshSubmissionProgress() {
    const authToken = localStorage.getItem('authToken');

    if (!authToken) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/citation-network/submission-progress`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
            const progress = await response.json();

            if (progress.total > 0) {
                citationNetworkState.includedStatus = progress.live === progress.total ? 'complete' : 'in_progress';
                citationNetworkState.includedProgress = {
                    total: progress.total,
                    submitted: progress.submitted + progress.live,
                    live: progress.live,
                    pending: progress.queued + progress.inProgress + progress.submitted,
                    actionNeeded: progress.actionNeeded
                };
                updateCitationNetworkUI();
            }
        }
    } catch (error) {
        console.error('Error refreshing progress:', error);
    }
}

// Load real citation network data from API
async function loadCitationNetworkData() {
    const authToken = getNormalizedAuthToken();

    if (!authToken) {
        return; // Not logged in, keep mock state
    }

    try {
        // Fetch stats, profile, allocation, active campaign, and submission counts in parallel
        const [statsRes, profileRes, allocationRes, activeCampaignRes, countsRes] = await Promise.all([
            fetch(`${API_BASE_URL}/citation-network/stats`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            }),
            fetch(`${API_BASE_URL}/citation-network/profile`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            }),
            fetch(`${API_BASE_URL}/citation-network/allocation`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            }),
            fetch(`${API_BASE_URL}/citation-network/active-campaign`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            }),
            fetch(`${API_BASE_URL}/citation-network/submissions/counts`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            })
        ]);

        // Update state with real data
        if (statsRes.ok) {
            const stats = await statsRes.json();
            // Use DB-backed boostsRemaining from API (counts boost orders this year)
            citationNetworkState.boostsUsedThisYear = stats.boostsThisYear || 0;
            citationNetworkState.boostsRemaining = stats.boostsRemaining ?? Math.max(0, 2 - (stats.boostsThisYear || 0));
            citationNetworkState.hasActiveBoost = stats.directories?.allocated > 0;

            if (stats.directories) {
                citationNetworkState.boostProgress = {
                    total: stats.directories.allocated || 0,
                    submitted: stats.directories.submitted || 0,
                    live: stats.directories.live || 0,
                    pending: (stats.directories.submitted || 0) - (stats.directories.live || 0),
                    actionNeeded: 0
                };
            }
        }

        if (profileRes.ok) {
            const profileData = await profileRes.json();

            // Use BACKEND is_complete, not just hasProfile
            const profileComplete = profileData?.profile?.is_complete === true;

            citationNetworkState.hasBusinessProfile = profileComplete;
            citationNetworkState.includedStatus = profileComplete ? 'ready' : 'no_profile';

            // Sync localStorage with backend truth (user-scoped)
            if (profileData.profile) {
                const storageKey = getUserStorageKey('businessProfile');
                const localProfile = JSON.parse(localStorage.getItem(storageKey) || '{}');
                if (localProfile.is_complete !== profileComplete) {
                    // Backend disagrees with local - backend wins
                    localStorage.setItem(storageKey, JSON.stringify({
                        ...localProfile,
                        ...profileData.profile,
                        is_complete: profileComplete
                    }));
                }
            }
        } else {
            // No profile or error
            citationNetworkState.hasBusinessProfile = false;
            citationNetworkState.includedStatus = 'no_profile';
        }

        // Check for active campaign
        if (activeCampaignRes.ok) {
            const activeCampaignData = await activeCampaignRes.json();
            if (activeCampaignData.hasActiveCampaign) {
                citationNetworkState.includedStatus = 'in_progress';
                citationNetworkState.activeCampaign = activeCampaignData.activeCampaign;
            }
        }

        // Get submission counts
        if (countsRes.ok) {
            const countsData = await countsRes.json();
            const counts = countsData.counts || {};

            citationNetworkState.includedProgress = {
                total: counts.total || 0,
                submitted: (counts.submitted || 0) + (counts.pending_approval || 0),
                live: (counts.live || 0) + (counts.verified || 0),
                pending: (counts.queued || 0) + (counts.in_progress || 0),
                actionNeeded: (counts.action_needed || 0) + (counts.needs_action || 0) + (counts.pending_verification || 0)
            };

            // If we have any submissions but no active campaign, we're likely complete
            if (counts.total > 0 && citationNetworkState.includedStatus !== 'in_progress') {
                citationNetworkState.includedStatus = 'in_progress';
            }
        }

        if (allocationRes.ok) {
            const allocation = await allocationRes.json();

            // Update plan from allocation response (backend now returns plan, planDisplayName, planAllocation)
            if (allocation.plan) {
                citationNetworkState.plan = allocation.plan;
            }

            // Also use the user object's plan as fallback
            if (!citationNetworkState.plan && user && user.plan) {
                const normalizedPlan = (user.plan || 'diy').toLowerCase().replace('plan_', '');
                if (['diy', 'pro', 'agency', 'enterprise', 'free', 'freemium'].includes(normalizedPlan)) {
                    citationNetworkState.plan = normalizedPlan;
                }
            }

            // Update monthly allocation from API
            if (allocation.planAllocation) {
                citationNetworkState.monthlyAllocation = allocation.planAllocation;
            }

            if (allocation.type === 'subscription') {
                citationNetworkState.monthlyAllocation = allocation.allocation.base || allocation.planAllocation || 10;
                // Merge with existing progress, don't overwrite
                citationNetworkState.includedProgress.total = Math.max(
                    citationNetworkState.includedProgress.total,
                    allocation.allocation.total || 10
                );
            }
        }

        // Update UI with real data
        updateCitationNetworkUI();

    } catch (error) {
        console.error('Error loading citation network data:', error);
        // Keep using mock data on error
    }
}

// Helper to show confirm dialog with callback
function showXeoConfirm(title, message, callback) {
    const modal = document.getElementById('xeoConfirmModal');
    const titleEl = document.getElementById('xeoConfirmTitle');
    const messageEl = document.getElementById('xeoConfirmMessage');

    if (modal && titleEl && messageEl) {
        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.style.display = 'flex';

        // Store callback for later
        window.xeoConfirmCallback = callback;
    }
}

// Update closeXeoConfirm to use callback
const originalCloseXeoConfirm = window.closeXeoConfirm;
window.closeXeoConfirm = function(confirmed) {
    const modal = document.getElementById('xeoConfirmModal');
    if (modal) {
        modal.style.display = 'none';
    }

    // Call the stored callback if it exists
    if (typeof window.xeoConfirmCallback === 'function') {
        window.xeoConfirmCallback(confirmed);
        window.xeoConfirmCallback = null;
    }
};

// ============================================================================
// VERIFICATION POLICY & STATUS MANAGEMENT FUNCTIONS
// ============================================================================

// Phone policy update handler
function updatePhonePolicy() {
    const allowPhoneOnListings = document.getElementById('allowPhoneOnListings')?.checked ?? true;
    const allowPhoneVerification = document.getElementById('allowPhoneVerification')?.checked ?? true;

    // Update state
    citationNetworkState.phonePolicy.allowPhoneOnListings = allowPhoneOnListings;
    citationNetworkState.phonePolicy.allowPhoneVerification = allowPhoneVerification;

    // Show/hide warnings
    const listingsWarning = document.getElementById('phoneListingsWarning');
    const verificationWarning = document.getElementById('phoneVerificationWarning');
    const verificationPhoneSection = document.getElementById('verificationPhoneSection');

    if (listingsWarning) {
        listingsWarning.style.display = allowPhoneOnListings ? 'none' : 'flex';
    }
    if (verificationWarning) {
        verificationWarning.style.display = allowPhoneVerification ? 'none' : 'flex';
    }
    if (verificationPhoneSection) {
        verificationPhoneSection.style.display = allowPhoneVerification ? 'block' : 'none';
    }

    // Update form validation
    validateSaveButton();
}

// Copy business phone to verification phone
function copyBusinessPhone() {
    const businessPhone = document.getElementById('businessPhone')?.value;
    const verificationPhone = document.getElementById('verificationPhone');
    if (businessPhone && verificationPhone) {
        verificationPhone.value = businessPhone;
    }
}

// Get status display info
function getStatusDisplay(status) {
    return STATUS_DISPLAY[status] || STATUS_DISPLAY[SUBMISSION_STATUS.QUEUED];
}

// Check if status is action needed (handles both 'needs_action' and 'action_needed' from DB)
function isActionNeededStatus(status) {
    return status === SUBMISSION_STATUS.NEEDS_ACTION || status === 'action_needed';
}

// Get action type display info
function getActionTypeDisplay(actionType) {
    return ACTION_TYPE_DISPLAY[actionType] || ACTION_TYPE_DISPLAY[ACTION_REQUIRED_TYPE.NONE];
}

// Render status badge HTML
function renderStatusBadge(status) {
    const display = getStatusDisplay(status);
    return `<span class="submission-status-badge ${display.bgClass}">
        <i class="fas ${display.icon}"></i>
        ${display.label}
    </span>`;
}

// Calculate days remaining for action
function calculateDaysRemaining(actionRequiredAt) {
    if (!actionRequiredAt) return null;
    const actionDate = new Date(actionRequiredAt);
    const now = new Date();
    const blockDate = new Date(actionDate);
    blockDate.setDate(blockDate.getDate() + TIMEOUT_POLICY.BLOCK_DAYS);
    const diff = blockDate - now;
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// Initialize submissions data - fetch from API
async function initSubmissionsData() {
    const authToken = getNormalizedAuthToken();

    if (!authToken) {
        // Not logged in - show empty state
        citationNetworkState.submissions = [];
        citationNetworkState.blockedSubmissions = [];
        citationNetworkState.credentials = [];
        updateProgressFromSubmissions();
        return;
    }

    try {
        // Fetch real submissions from API
        const response = await fetch(`${API_BASE_URL}/citation-network/campaign-submissions`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            const submissions = data.submissions || [];

            // Debug: log raw submission statuses from API
            console.log('[Submissions] Raw statuses from API:', submissions.map(s => ({ id: s.id, status: s.status })));

            // Map backend data to frontend format
            citationNetworkState.submissions = submissions.map(sub => ({
                id: sub.id,
                directoryId: sub.directory_id,
                directoryName: sub.directory_snapshot?.name || sub.directory_name || 'Unknown Directory',
                directoryLogo: sub.directory_snapshot?.logo_url || `https://logo.clearbit.com/${sub.directory_snapshot?.domain || 'example.com'}`,
                status: sub.status || SUBMISSION_STATUS.QUEUED,
                actionType: sub.action_type || ACTION_REQUIRED_TYPE.NONE,
                actionInstructions: sub.action_instructions,
                actionUrl: sub.action_url,
                actionRequiredAt: sub.action_required_at,
                submittedAt: sub.submitted_at,
                liveAt: sub.live_at,
                verifiedAt: sub.verified_at,
                listingUrl: sub.listing_url,
                blockedAt: sub.blocked_at,
                blockedReason: sub.blocked_reason,
                daysRemaining: sub.action_required_at ? calculateDaysRemaining(sub.action_required_at) : null
            }));

            // Separate blocked submissions
            citationNetworkState.blockedSubmissions = citationNetworkState.submissions.filter(
                sub => sub.status === SUBMISSION_STATUS.BLOCKED
            );

            console.log('[Submissions] Loaded', citationNetworkState.submissions.length, 'real submissions');
        } else {
            console.warn('[Submissions] Failed to fetch, using empty state');
            citationNetworkState.submissions = [];
            citationNetworkState.blockedSubmissions = [];
        }
    } catch (error) {
        console.error('[Submissions] Error fetching submissions:', error);
        citationNetworkState.submissions = [];
        citationNetworkState.blockedSubmissions = [];
    }

    // Fetch real credentials from credential vault API
    try {
        const credentialsResponse = await fetch(`${API_BASE_URL}/citation-network/credentials`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (credentialsResponse.ok) {
            const credData = await credentialsResponse.json();
            citationNetworkState.credentials = credData.credentials || [];
            console.log('[Credentials] Loaded', citationNetworkState.credentials.length, 'real credentials');
        } else {
            console.warn('[Credentials] Failed to fetch, using empty state');
            citationNetworkState.credentials = [];
        }
    } catch (error) {
        console.error('[Credentials] Error fetching credentials:', error);
        citationNetworkState.credentials = [];
    }

    // Calculate progress from submissions
    updateProgressFromSubmissions();
}

// Update progress counters from submissions
function updateProgressFromSubmissions() {
    const submissions = citationNetworkState.submissions;
    const counts = {
        total: submissions.length,
        submitted: 0,
        live: 0,
        pending: 0,
        actionNeeded: 0,
        blocked: 0
    };

    submissions.forEach(sub => {
        switch (sub.status) {
            case SUBMISSION_STATUS.LIVE:
                counts.live++;
                counts.submitted++;
                break;
            case SUBMISSION_STATUS.VERIFIED:
            case SUBMISSION_STATUS.IN_REVIEW:
                counts.submitted++;
                break;
            case SUBMISSION_STATUS.SUBMITTED:
                counts.submitted++;
                counts.pending++;
                break;
            case SUBMISSION_STATUS.NEEDS_ACTION:
            case 'action_needed': // DB uses this variant
                counts.actionNeeded++;
                break;
            case SUBMISSION_STATUS.BLOCKED:
                counts.blocked++;
                break;
            case SUBMISSION_STATUS.QUEUED:
            case SUBMISSION_STATUS.IN_PROGRESS:
                counts.pending++;
                break;
        }
    });

    citationNetworkState.includedProgress = counts;
}

// Render submissions list
function renderSubmissionsList(containerId, submissions) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (submissions.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--gray-500);">
                <i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.5;"></i>
                <p>No submissions yet</p>
            </div>
        `;
        return;
    }

    container.innerHTML = submissions.map(sub => {
        const statusDisplay = getStatusDisplay(sub.status);
        const needsAction = isActionNeededStatus(sub.status);
        const actionDisplay = getActionTypeDisplay(sub.actionType);
        const daysRemaining = calculateDaysRemaining(sub.actionRequiredAt);

        return `
            <div class="submission-item ${needsAction ? 'needs-action' : ''}" data-id="${sub.id}">
                <img src="${sub.directoryLogo}" alt="${sub.directoryName}" class="submission-logo"
                     onerror="this.src='https://via.placeholder.com/40?text=${sub.directoryName[0]}'">
                <div class="submission-info">
                    <div class="submission-name">${sub.directoryName}</div>
                    <div class="submission-meta">
                        ${sub.submittedAt ? `Submitted ${formatRelativeTime(sub.submittedAt)}` : 'Queued'}
                        ${sub.listingUrl ? ` • <a href="${sub.listingUrl}" target="_blank" style="color: var(--brand-cyan);">View listing</a>` : ''}
                    </div>
                </div>
                <div class="submission-action">
                    ${needsAction ? `
                        <button class="action-required-badge" onclick="showActionModal('${sub.id}')">
                            <i class="fas ${actionDisplay.icon}"></i>
                            ${actionDisplay.label}
                        </button>
                        ${daysRemaining !== null ? `
                            <span class="days-remaining ${daysRemaining <= 3 ? 'urgent' : ''}">
                                ${daysRemaining} days remaining
                            </span>
                        ` : ''}
                    ` : renderStatusBadge(sub.status)}
                </div>
            </div>
        `;
    }).join('');
}

// Format relative time
function formatRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return date.toLocaleDateString();
}

// Show action modal
function showActionModal(submissionId) {
    const submission = citationNetworkState.submissions.find(s => s.id === submissionId);
    if (!submission) return;

    const actionDisplay = getActionTypeDisplay(submission.actionType);
    const daysRemaining = calculateDaysRemaining(submission.actionRequiredAt);

    const modalHtml = `
        <div class="action-modal-overlay" id="actionModalOverlay" onclick="closeActionModal(event)">
            <div class="action-modal" onclick="event.stopPropagation()">
                <div class="action-modal-header">
                    <h3 class="action-modal-title">Action Required: ${submission.directoryName}</h3>
                    <button class="action-modal-close" onclick="closeActionModal()">&times;</button>
                </div>
                <div class="action-modal-body">
                    <div class="action-type-display">
                        <div class="action-type-icon">
                            <i class="fas ${actionDisplay.icon}"></i>
                        </div>
                        <div class="action-type-info">
                            <h4>${actionDisplay.label}</h4>
                            <p>${actionDisplay.description}</p>
                        </div>
                    </div>

                    ${submission.actionInstructions ? `
                        <div style="background: var(--gray-50); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
                            <p style="margin: 0; font-size: 0.875rem; color: var(--gray-700);">
                                <strong>Instructions:</strong> ${submission.actionInstructions}
                            </p>
                        </div>
                    ` : ''}

                    ${daysRemaining !== null ? `
                        <div style="background: ${daysRemaining <= 3 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(249, 115, 22, 0.1)'}; padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem;">
                            <p style="margin: 0; font-size: 0.8rem; color: ${daysRemaining <= 3 ? '#ef4444' : '#f97316'};">
                                <i class="fas fa-clock" style="margin-right: 0.5rem;"></i>
                                <strong>${daysRemaining} days remaining</strong> before this submission is blocked
                            </p>
                        </div>
                    ` : ''}

                    ${submission.actionUrl ? `
                        <a href="${submission.actionUrl}" target="_blank" rel="noopener noreferrer"
                           class="btn-profile-save"
                           style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; width: 100%; padding: 0.875rem 1.25rem; margin-bottom: 1rem; text-decoration: none; font-size: 1rem;">
                            <i class="fas fa-external-link-alt"></i> Go to Directory
                        </a>
                    ` : ''}

                    ${(submission.actionType === ACTION_REQUIRED_TYPE.SMS || submission.actionType === ACTION_REQUIRED_TYPE.PHONE) ? `
                        <div class="action-code-input">
                            <label>Enter verification code</label>
                            <input type="text" id="verificationCodeInput" placeholder="Enter code" maxlength="10">
                        </div>
                    ` : ''}
                </div>
                <div class="action-modal-footer">
                    <button class="btn-profile-cancel" onclick="closeActionModal()">Close</button>
                    ${(submission.actionType === ACTION_REQUIRED_TYPE.SMS || submission.actionType === ACTION_REQUIRED_TYPE.PHONE) ? `
                        <button class="btn-profile-save" onclick="submitVerificationCode('${submissionId}')" style="padding: 0.625rem 1.25rem;">
                            <i class="fas fa-check"></i> Verify
                        </button>
                    ` : `
                        <button class="btn-profile-save" onclick="markActionComplete('${submissionId}')" style="padding: 0.625rem 1.25rem;">
                            <i class="fas fa-check"></i> Mark Complete
                        </button>
                    `}
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// Close action modal
function closeActionModal(event) {
    if (event && event.target.id !== 'actionModalOverlay') return;
    const modal = document.getElementById('actionModalOverlay');
    if (modal) modal.remove();
}

// Submit verification code
async function submitVerificationCode(submissionId) {
    const codeInput = document.getElementById('verificationCodeInput');
    const code = codeInput?.value?.trim();

    if (!code) {
        showXeoAlert('Error', 'Please enter the verification code.');
        return;
    }

    showXeoAlert('Verifying...', 'Checking your verification code...');

    // Add small delay for UX, then call the API
    await new Promise(resolve => setTimeout(resolve, 1000));
    await markActionComplete(submissionId);
}

// Mark action as complete - Bug 1 Fix: Now persists to database via API
async function markActionComplete(submissionId) {
    const submission = citationNetworkState.submissions.find(s => s.id === submissionId);
    if (!submission) {
        showXeoAlert('Error', 'Submission not found in local state.');
        return;
    }

    const authToken = getNormalizedAuthToken();
    if (!authToken) {
        showXeoAlert('Error', 'Please log in to mark submissions as complete.');
        return;
    }

    // Close modal first for better UX
    closeActionModal();

    console.log(`[MarkComplete] Updating submission ${submissionId} to verified...`);

    try {
        // Call API to persist the status change
        const response = await fetch(`${API_BASE_URL}/citation-network/submissions/${submissionId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                status: 'verified',
                actionType: 'none'
            })
        });

        // Handle non-JSON responses (e.g., HTML error pages)
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.error('[MarkComplete] Non-JSON response:', response.status, contentType);
            showXeoAlert('Error', `Server error (${response.status}). Please try again.`);
            return;
        }

        const data = await response.json();

        if (!response.ok || !data.success) {
            const errorMsg = data.error?.message || 'Failed to update submission status';
            const errorCode = data.error?.code || 'UNKNOWN';
            console.error(`[MarkComplete] API error (${errorCode}):`, data);
            showXeoAlert('Error', errorMsg);
            return;
        }

        console.log('[MarkComplete] Success:', data);

        // Update local state only after successful API call
        submission.status = SUBMISSION_STATUS.VERIFIED;
        submission.actionType = ACTION_REQUIRED_TYPE.NONE;
        submission.verifiedAt = data.submission?.updatedAt || new Date().toISOString();

        // Show success
        showXeoAlert('Verification Complete!', `${submission.directoryName} is now verified and will go live soon.`);

        // Re-render to update counts and UI
        updateProgressFromSubmissions();
        renderCitationNetworkTabs();

    } catch (error) {
        console.error('[MarkComplete] Exception:', error);
        // Provide more specific error message based on error type
        if (error instanceof TypeError && error.message.includes('fetch')) {
            showXeoAlert('Error', 'Network error. Check your internet connection.');
        } else if (error instanceof SyntaxError) {
            showXeoAlert('Error', 'Server returned invalid response. Please try again.');
        } else {
            showXeoAlert('Error', `Error: ${error.message || 'Unknown error'}`);
        }
    }
}

// Render credentials list
function renderCredentialsList() {
    const container = document.getElementById('credentialsList');
    if (!container) return;

    const credentials = citationNetworkState.credentials;

    if (credentials.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--gray-500);">
                <i class="fas fa-key" style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.5;"></i>
                <p>No credentials stored yet</p>
            </div>
        `;
        return;
    }

    // Helper to get handoff status display
    const getHandoffBadge = (cred) => {
        if (cred.handoffStatus === 'requested') {
            return '<span class="submission-status-badge status-pending">Handoff Requested</span>';
        } else if (cred.handoffStatus === 'completed' || cred.handedOffAt) {
            return '<span class="submission-status-badge status-live">Handed Off</span>';
        }
        return '';
    };

    container.innerHTML = credentials.map(cred => `
        <div class="credential-card" data-id="${cred.id}">
            <div class="credential-header">
                <h4>${cred.directoryName}</h4>
                ${getHandoffBadge(cred)}
            </div>
            <div class="credential-fields">
                <div class="credential-field">
                    <label>Account URL</label>
                    <a href="${cred.accountUrl || cred.directoryUrl}" target="_blank" style="color: var(--brand-cyan); font-size: 0.8rem;">${cred.accountUrl || cred.directoryUrl}</a>
                </div>
                <div class="credential-field">
                    <label>Username/Email</label>
                    <span class="masked" id="username-${cred.id}">${cred.emailMasked || cred.usernameMasked || '••••••••'}</span>
                </div>
                <div class="credential-field">
                    <label>Password</label>
                    <span class="masked" id="password-${cred.id}">${cred.hasPassword ? '••••••••' : 'Not stored'}</span>
                </div>
            </div>
            <div class="credential-actions">
                ${cred.hasPassword ? `
                    <button class="btn-reveal" onclick="revealCredentials('${cred.id}')" ${cred.handoffStatus !== 'completed' ? 'disabled title="Request handoff to access"' : ''}>
                        <i class="fas fa-eye"></i> Reveal
                    </button>
                ` : ''}
                ${cred.handoffStatus !== 'requested' && cred.handoffStatus !== 'completed' ? `
                    <button class="btn-handoff" onclick="requestHandoff('${cred.id}')">
                        <i class="fas fa-hand-holding"></i> Request Handoff
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

// Reveal credentials - currently disabled for security hardening
async function revealCredentials(credentialId) {
    const authToken = getNormalizedAuthToken();
    if (!authToken) {
        showXeoAlert('Error', 'Please log in to view credentials');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/citation-network/credentials/${credentialId}/password`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.status === 503) {
            // Password reveal is disabled for security
            showXeoAlert(
                'Feature Temporarily Disabled',
                'Password reveal is temporarily disabled for security hardening.\n\nPlease use the "Request Handoff" button to securely receive your credentials.'
            );
            return;
        }

        if (!response.ok) {
            const error = await response.json();
            showXeoAlert('Error', error.error || 'Failed to reveal credentials');
            return;
        }

        const data = await response.json();

        const usernameEl = document.getElementById(`username-${credentialId}`);
        const passwordEl = document.getElementById(`password-${credentialId}`);

        if (usernameEl && data.email) {
            usernameEl.innerHTML = `<code>${data.email}</code>`;
        }

        if (passwordEl && data.password) {
            passwordEl.innerHTML = `<code>${data.password}</code> <button onclick="copyToClipboard('${data.password}')" style="background: none; border: none; color: var(--brand-cyan); cursor: pointer; font-size: 0.75rem;"><i class="fas fa-copy"></i></button>`;
        }
    } catch (error) {
        console.error('Reveal credentials error:', error);
        showXeoAlert('Error', 'Failed to reveal credentials. Please try again.');
    }
}

// Copy text to clipboard
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showXeoAlert('Copied', 'Copied to clipboard');
    }).catch(() => {
        showXeoAlert('Error', 'Failed to copy to clipboard');
    });
}

// Request credential handoff
function requestHandoff(credentialId) {
    showXeoConfirm(
        'Request Credential Handoff',
        'After handoff, you\'ll have full ownership of this directory account. We\'ll no longer manage it for you. Continue?',
        async function(confirmed) {
            if (confirmed) {
                const authToken = getNormalizedAuthToken();
                if (!authToken) {
                    showXeoAlert('Error', 'Please log in to complete handoff');
                    return;
                }

                try {
                    const response = await fetch(`${API_BASE_URL}/citation-network/credentials/${credentialId}/handoff`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${authToken}` }
                    });

                    if (response.ok) {
                        const cred = citationNetworkState.credentials.find(c => c.id === credentialId);
                        if (cred) {
                            cred.handedOffAt = new Date().toISOString();
                            cred.status = 'handed_off';
                        }
                        showXeoAlert('Handoff Complete', `You now have full ownership of the ${cred?.directoryName || 'directory'} account.`);
                        renderCredentialsList();
                    } else {
                        const error = await response.json();
                        showXeoAlert('Error', error.error || 'Failed to complete handoff');
                    }
                } catch (error) {
                    console.error('Handoff error:', error);
                    showXeoAlert('Error', 'Failed to complete handoff. Please try again.');
                }
            }
        }
    );
}

// Export all credentials
function exportCredentials() {
    showXeoConfirm(
        'Export All Credentials',
        'This will download all your directory credentials as a file. Make sure you\'re in a secure location. Continue?',
        function(confirmed) {
            if (confirmed) {
                // In real app, this would call API with audit logging
                const credentials = citationNetworkState.credentials.map(c => ({
                    directory: c.directoryName,
                    accountUrl: c.accountUrl,
                    username: 'user@example.com',
                    password: '********',
                    createdAt: c.createdAt
                }));

                const blob = new Blob([JSON.stringify(credentials, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'visible2ai-credentials.json';
                a.click();
                URL.revokeObjectURL(url);

                showXeoAlert('Export Complete', 'Your credentials have been downloaded.');
            }
        }
    );
}

// Render blocked submissions
function renderBlockedList() {
    const container = document.getElementById('blockedList');
    if (!container) return;

    const blocked = citationNetworkState.blockedSubmissions;

    if (blocked.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--gray-500);">
                <i class="fas fa-check-circle" style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.5; color: var(--complete-teal);"></i>
                <p>No blocked submissions</p>
            </div>
        `;
        return;
    }

    container.innerHTML = blocked.map(sub => `
        <div class="blocked-item" data-id="${sub.id}">
            <img src="${sub.directoryLogo}" alt="${sub.directoryName}" class="submission-logo"
                 onerror="this.src='https://via.placeholder.com/40?text=${sub.directoryName[0]}'">
            <div class="blocked-info">
                <div class="submission-name">${sub.directoryName}</div>
                <div class="blocked-reason">${sub.blockedReason}</div>
                ${sub.replacedByName ? `
                    <div class="blocked-replacement">
                        <i class="fas fa-exchange-alt"></i>
                        Replaced with: ${sub.replacedByName}
                    </div>
                ` : ''}
            </div>
            <button class="btn-resume" onclick="resumeBlockedSubmission('${sub.id}')">
                <i class="fas fa-play"></i> Resume
            </button>
        </div>
    `).join('');
}

// Resume a blocked submission
function resumeBlockedSubmission(submissionId) {
    showXeoConfirm(
        'Resume Submission',
        'This will restart the verification process. You\'ll have 10 days to complete verification. Continue?',
        function(confirmed) {
            if (confirmed) {
                const blocked = citationNetworkState.blockedSubmissions.find(s => s.id === submissionId);
                if (blocked) {
                    // Move from blocked back to needs_action
                    blocked.status = SUBMISSION_STATUS.NEEDS_ACTION;
                    blocked.actionRequiredAt = new Date().toISOString();

                    // Remove from blocked list
                    citationNetworkState.blockedSubmissions = citationNetworkState.blockedSubmissions.filter(s => s.id !== submissionId);

                    // Add to main submissions
                    citationNetworkState.submissions.push(blocked);

                    showXeoAlert('Submission Resumed', `${blocked.directoryName} is now active again. Complete verification within 10 days.`);

                    // Re-render
                    updateProgressFromSubmissions();
                    renderCitationNetworkTabs();
                }
            }
        }
    );
}

// Render Citation Network tabs and content
function renderCitationNetworkTabs() {
    // Get counts for badges
    const actionCount = citationNetworkState.submissions.filter(s => isActionNeededStatus(s.status)).length;
    const blockedCount = citationNetworkState.blockedSubmissions.length;

    // Update tab badges
    const actionBadge = document.getElementById('actionTabBadge');
    const blockedBadge = document.getElementById('blockedTabBadge');

    if (actionBadge) {
        actionBadge.textContent = actionCount;
        actionBadge.style.display = actionCount > 0 ? 'inline' : 'none';
    }
    if (blockedBadge) {
        blockedBadge.textContent = blockedCount;
        blockedBadge.style.display = blockedCount > 0 ? 'inline' : 'none';
    }

    // Render submissions list
    renderSubmissionsList('allSubmissionsList', citationNetworkState.submissions);

    // Render action needed list (filtered)
    const actionNeeded = citationNetworkState.submissions.filter(s => isActionNeededStatus(s.status));
    renderSubmissionsList('actionSubmissionsList', actionNeeded);

    // Render credentials
    renderCredentialsList();

    // Render blocked
    renderBlockedList();
}

// Switch Citation Network tab
function switchCitationTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.citation-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.citation-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}TabContent`);
    });
}

// ============================================================================
// BUSINESS PROFILE FORM FUNCTIONS
// ============================================================================

// Business profile state
let businessProfileData = {
    business_name: '',
    website_url: '',
    category: '',
    tagline: '',
    short_description: '',
    long_description: '',
    extended_description: '',
    has_physical_address: null,
    street_address: '',
    suite_unit: '',
    city: '',
    state_province: '',
    postal_code: '',
    country: '',
    headquarters_country: '',
    phone: '',
    business_email: '',
    contact_person: '',
    inbox_preference: 'managed',
    customer_verification_email: '',
    verification_phone: '',
    logo_url: '',
    year_founded: '',
    linkedin_url: '',
    twitter_url: '',
    facebook_url: '',
    is_saas_product: false,
    pricing_model: '',
    key_features: [],
    integrations: '',
    use_case_tags: [],
    consent_accepted: false
};

// Initialize Business Profile Form
function initBusinessProfileForm() {
    // Populate year founded dropdown
    populateYearFoundedDropdown();

    // Set up form input listeners
    setupProfileFormListeners();

    // Update managed inbox preview when business name changes
    const businessNameInput = document.getElementById('businessName');
    if (businessNameInput) {
        businessNameInput.addEventListener('input', updateManagedInboxPreview);
    }

    // Initial completeness update
    updateProfileCompleteness();
}

// Populate year founded dropdown
function populateYearFoundedDropdown() {
    const yearSelect = document.getElementById('yearFounded');
    if (!yearSelect) return;

    const currentYear = new Date().getFullYear();
    for (let year = currentYear; year >= 1900; year--) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    }
}

// Set up form input listeners
function setupProfileFormListeners() {
    const form = document.getElementById('businessProfileForm');
    if (!form) return;

    // Add input listeners to all form fields for real-time completeness tracking
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('input', () => {
            updateProfileCompleteness();
            validateSaveButton();
        });
        input.addEventListener('change', () => {
            updateProfileCompleteness();
            validateSaveButton();
        });
    });
}

// Update character count
function updateCharCount(fieldId, maxLength) {
    const field = document.getElementById(fieldId);
    const countEl = document.getElementById(fieldId + 'CharCount');

    if (!field || !countEl) return;

    const currentLength = field.value.length;
    countEl.textContent = `${currentLength}/${maxLength} characters`;

    // Update styling based on length
    countEl.classList.remove('warning', 'over');
    if (currentLength > maxLength) {
        countEl.classList.add('over');
    } else if (currentLength > maxLength * 0.9) {
        countEl.classList.add('warning');
    }
}

// Toggle address fields based on physical address selection
function toggleAddressFields(hasPhysicalAddress) {
    const physicalFields = document.getElementById('physicalAddressFields');
    const remoteFields = document.getElementById('remoteBusinessFields');
    const hasAddressYes = document.getElementById('hasAddressYes');
    const hasAddressNo = document.getElementById('hasAddressNo');

    if (hasPhysicalAddress) {
        if (physicalFields) physicalFields.classList.add('visible');
        if (remoteFields) remoteFields.classList.remove('visible');
        if (hasAddressYes) hasAddressYes.classList.add('selected');
        if (hasAddressNo) hasAddressNo.classList.remove('selected');
    } else {
        if (physicalFields) physicalFields.classList.remove('visible');
        if (remoteFields) remoteFields.classList.add('visible');
        if (hasAddressYes) hasAddressYes.classList.remove('selected');
        if (hasAddressNo) hasAddressNo.classList.add('selected');
    }

    updateProfileCompleteness();
    validateSaveButton();
}

// Toggle inbox preference
function toggleInboxPreference(preference) {
    const managedOption = document.getElementById('inboxManaged');
    const customerOption = document.getElementById('inboxCustomer');
    const customerEmailFields = document.getElementById('customerEmailFields');

    if (preference === 'managed') {
        if (managedOption) managedOption.classList.add('selected');
        if (customerOption) customerOption.classList.remove('selected');
        if (customerEmailFields) customerEmailFields.style.display = 'none';
    } else {
        if (managedOption) managedOption.classList.remove('selected');
        if (customerOption) customerOption.classList.add('selected');
        if (customerEmailFields) customerEmailFields.style.display = 'block';
    }

    updateProfileCompleteness();
    validateSaveButton();
}

// Update managed inbox preview
function updateManagedInboxPreview() {
    const businessName = document.getElementById('businessName')?.value || '';
    const previewEl = document.getElementById('managedEmailPreview');

    if (previewEl) {
        if (businessName.trim()) {
            const slug = generateSlug(businessName);
            previewEl.textContent = `${slug}@listings.visible2ai.com`;
        } else {
            previewEl.textContent = 'your-business@listings.visible2ai.com';
        }
    }
}

// Generate URL-safe slug from business name
function generateSlug(name) {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 30);
}

// Copy business phone to verification phone
function copyBusinessPhone() {
    const businessPhone = document.getElementById('businessPhone')?.value || '';
    const verificationPhone = document.getElementById('verificationPhone');

    if (verificationPhone) {
        verificationPhone.value = businessPhone;
    }
}

// Toggle SaaS fields
function toggleSaasFields() {
    const checkbox = document.getElementById('isSaasProduct');
    const saasFields = document.getElementById('saasFields');

    if (checkbox && saasFields) {
        if (checkbox.checked) {
            saasFields.classList.add('visible');
        } else {
            saasFields.classList.remove('visible');
        }
    }

    updateProfileCompleteness();
    validateSaveButton();
}

// Handle logo upload
function handleLogoUpload(input) {
    const file = input.files[0];
    if (!file) return;

    // Validate file type
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
        showXeoAlert('Invalid File Type', 'Please upload a PNG or JPG image.');
        input.value = '';
        return;
    }

    // Validate file size (2MB)
    if (file.size > 2 * 1024 * 1024) {
        showXeoAlert('File Too Large', 'Please upload an image smaller than 2MB.');
        input.value = '';
        return;
    }

    // Preview the image and store the data URL
    const reader = new FileReader();
    reader.onload = function(e) {
        const previewContainer = document.getElementById('logoPreviewContainer');
        const preview = document.getElementById('logoPreview');
        const uploadPrompt = document.getElementById('logoUploadPrompt');
        const uploadArea = document.getElementById('logoUploadArea');

        // Store the data URL for form submission
        currentLogoDataUrl = e.target.result;

        if (preview && previewContainer && uploadPrompt && uploadArea) {
            preview.src = e.target.result;
            previewContainer.style.display = 'block';
            uploadPrompt.style.display = 'none';
            uploadArea.classList.add('has-file');
        }

        updateProfileCompleteness();
    };
    reader.readAsDataURL(file);
}

// Logo data URL storage
let currentLogoDataUrl = null;

// Feature tags management
let keyFeatures = [];
let useCaseTags = [];

function handleFeatureKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        addFeatureTag();
    }
}

function addFeatureTag() {
    const input = document.getElementById('newFeatureInput');
    if (!input || !input.value.trim()) return;

    if (keyFeatures.length >= 5) {
        showXeoAlert('Maximum Reached', 'You can only add up to 5 key features.');
        return;
    }

    const feature = input.value.trim();
    if (!keyFeatures.includes(feature)) {
        keyFeatures.push(feature);
        renderFeatureTags();
        input.value = '';
        updateProfileCompleteness();
    }
}

function removeFeatureTag(index) {
    keyFeatures.splice(index, 1);
    renderFeatureTags();
    updateProfileCompleteness();
}

function renderFeatureTags() {
    const container = document.getElementById('keyFeaturesTags');
    if (!container) return;

    container.innerHTML = keyFeatures.map((feature, index) => `
        <span class="profile-feature-tag">
            ${feature}
            <span class="remove-tag" onclick="removeFeatureTag(${index})">&times;</span>
        </span>
    `).join('');
}

function handleUseCaseKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        addUseCaseTag();
    }
}

function addUseCaseTag() {
    const input = document.getElementById('newUseCaseInput');
    if (!input || !input.value.trim()) return;

    if (useCaseTags.length >= 5) {
        showXeoAlert('Maximum Reached', 'You can only add up to 5 use case tags.');
        return;
    }

    const tag = input.value.trim();
    if (!useCaseTags.includes(tag)) {
        useCaseTags.push(tag);
        renderUseCaseTags();
        input.value = '';
        updateProfileCompleteness();
    }
}

function removeUseCaseTag(index) {
    useCaseTags.splice(index, 1);
    renderUseCaseTags();
    updateProfileCompleteness();
}

function renderUseCaseTags() {
    const container = document.getElementById('useCaseTags');
    if (!container) return;

    container.innerHTML = useCaseTags.map((tag, index) => `
        <span class="profile-feature-tag">
            ${tag}
            <span class="remove-tag" onclick="removeUseCaseTag(${index})">&times;</span>
        </span>
    `).join('');
}

// Update consent state
function updateConsentState() {
    validateSaveButton();
}

// Validate save button
function validateSaveButton() {
    const saveBtn = document.getElementById('saveProfileBtn');
    if (!saveBtn) return;

    const isValid = validateProfileForm(false);
    saveBtn.disabled = !isValid;
}

// Validate profile form
function validateProfileForm(showErrors = true) {
    let isValid = true;
    const errors = [];

    // Clear all previous errors first
    if (showErrors) {
        clearProfileFormErrors();
    }

    // Required fields
    const businessName = document.getElementById('businessName')?.value?.trim();
    if (!businessName) {
        errors.push({ field: 'businessName', message: 'Business name is required' });
        isValid = false;
    }

    const websiteUrl = document.getElementById('websiteUrl')?.value?.trim();
    if (!websiteUrl) {
        errors.push({ field: 'websiteUrl', message: 'Website URL is required' });
        isValid = false;
    } else if (!/^https?:\/\/.+/.test(websiteUrl)) {
        errors.push({ field: 'websiteUrl', message: 'Please enter a valid URL starting with http:// or https://' });
        isValid = false;
    }

    const category = document.getElementById('businessCategory')?.value;
    if (!category) {
        errors.push({ field: 'businessCategory', errorId: 'categoryError', message: 'Please select a category' });
        isValid = false;
    }

    const tagline = document.getElementById('tagline')?.value?.trim();
    if (!tagline) {
        errors.push({ field: 'tagline', message: 'Tagline is required' });
        isValid = false;
    }

    const shortDescription = document.getElementById('shortDescription')?.value?.trim();
    if (!shortDescription) {
        errors.push({ field: 'shortDescription', message: 'Short description is required' });
        isValid = false;
    }

    const phone = document.getElementById('businessPhone')?.value?.trim();
    if (!phone) {
        errors.push({ field: 'businessPhone', errorId: 'phoneError', message: 'Business phone is required' });
        isValid = false;
    }

    const email = document.getElementById('businessEmail')?.value?.trim();
    if (!email) {
        errors.push({ field: 'businessEmail', errorId: 'emailError', message: 'Business email is required' });
        isValid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ field: 'businessEmail', errorId: 'emailError', message: 'Please enter a valid email address' });
        isValid = false;
    }

    // Physical address selection is required
    const hasPhysicalAddress = document.querySelector('input[name="has_physical_address"]:checked')?.value;
    if (!hasPhysicalAddress) {
        errors.push({ field: 'hasAddressYes', errorId: 'addressTypeError', message: 'Please select whether you have a physical address' });
        isValid = false;
    } else if (hasPhysicalAddress === 'true') {
        // Physical address fields required
        if (!document.getElementById('streetAddress')?.value?.trim()) {
            errors.push({ field: 'streetAddress', message: 'Street address is required' });
            isValid = false;
        }
        if (!document.getElementById('city')?.value?.trim()) {
            errors.push({ field: 'city', message: 'City is required' });
            isValid = false;
        }
        if (!document.getElementById('stateProvince')?.value?.trim()) {
            errors.push({ field: 'stateProvince', message: 'State/Province is required' });
            isValid = false;
        }
        if (!document.getElementById('postalCode')?.value?.trim()) {
            errors.push({ field: 'postalCode', message: 'Postal code is required' });
            isValid = false;
        }
        if (!document.getElementById('country')?.value) {
            errors.push({ field: 'country', message: 'Country is required' });
            isValid = false;
        }
    } else if (hasPhysicalAddress === 'false') {
        if (!document.getElementById('headquartersCountry')?.value) {
            errors.push({ field: 'headquartersCountry', message: 'Headquarters country is required' });
            isValid = false;
        }
    }

    // Conditional: Customer verification email
    const inboxPreference = document.querySelector('input[name="inbox_preference"]:checked')?.value;
    if (inboxPreference === 'customer') {
        const customerEmail = document.getElementById('customerVerificationEmail')?.value?.trim();
        if (!customerEmail) {
            errors.push({ field: 'customerVerificationEmail', message: 'Verification email is required when using your own email' });
            isValid = false;
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
            errors.push({ field: 'customerVerificationEmail', message: 'Please enter a valid email address' });
            isValid = false;
        }
    }

    // Conditional: SaaS pricing model
    const isSaasProduct = document.getElementById('isSaasProduct')?.checked;
    if (isSaasProduct) {
        if (!document.getElementById('pricingModel')?.value) {
            errors.push({ field: 'pricingModel', message: 'Pricing model is required for SaaS products' });
            isValid = false;
        }
    }

    // Consent is required
    const consentAccepted = document.getElementById('consentAccepted')?.checked;
    if (!consentAccepted) {
        errors.push({ field: 'consentAccepted', errorId: 'consentError', message: 'You must accept the authorization to continue' });
        isValid = false;
    }

    // Show errors if requested
    if (showErrors && errors.length > 0) {
        errors.forEach(err => {
            const errorId = err.errorId || (err.field + 'Error');
            const errorEl = document.getElementById(errorId);
            const inputEl = document.getElementById(err.field);

            if (errorEl) {
                errorEl.classList.add('visible');
                errorEl.textContent = err.message;
            }
            if (inputEl) {
                inputEl.classList.add('error');
            }
        });

        // Scroll to first error
        const firstErrorField = document.getElementById(errors[0].field);
        if (firstErrorField) {
            firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
            firstErrorField.focus();
        }
    }

    return isValid;
}

// Clear all form errors
function clearProfileFormErrors() {
    const errorEls = document.querySelectorAll('.profile-form-error');
    errorEls.forEach(el => el.classList.remove('visible'));

    const inputEls = document.querySelectorAll('.profile-form-input.error, .profile-form-select.error, .profile-form-textarea.error');
    inputEls.forEach(el => el.classList.remove('error'));
}

// Update profile completeness
function updateProfileCompleteness() {
    let completedItems = 0;
    const totalItems = 6;

    // Check core information
    const coreComplete = checkCoreInfoComplete();
    updateCompletenessItem('completeness-core', coreComplete);
    if (coreComplete) completedItems++;

    // Check location & contact
    const locationComplete = checkLocationComplete();
    updateCompletenessItem('completeness-location', locationComplete);
    if (locationComplete) completedItems++;

    // Check verification settings
    const verificationComplete = checkVerificationComplete();
    updateCompletenessItem('completeness-verification', verificationComplete);
    if (verificationComplete) completedItems++;

    // Check logo
    const logoComplete = document.getElementById('logoUploadArea')?.classList.contains('has-file') || false;
    updateCompletenessItem('completeness-logo', logoComplete);
    if (logoComplete) completedItems++;

    // Check social links
    const socialComplete = checkSocialComplete();
    updateCompletenessItem('completeness-social', socialComplete);
    if (socialComplete) completedItems++;

    // Check SaaS details
    const saasComplete = checkSaasComplete();
    updateCompletenessItem('completeness-saas', saasComplete);
    if (saasComplete) completedItems++;

    // Update progress bar
    const percentage = Math.round((completedItems / totalItems) * 100);
    const percentEl = document.getElementById('profileCompletenessPercent');
    const fillEl = document.getElementById('profileCompletenessFill');

    if (percentEl) percentEl.textContent = percentage + '%';
    if (fillEl) fillEl.style.width = percentage + '%';

    // Update progress steps
    updateProgressSteps(completedItems);
}

function updateCompletenessItem(id, isComplete) {
    const item = document.getElementById(id);
    if (!item) return;

    const icon = item.querySelector('i');
    if (isComplete) {
        item.classList.add('completed');
        if (icon) {
            icon.classList.remove('far', 'fa-circle');
            icon.classList.add('fas', 'fa-check-circle');
        }
    } else {
        item.classList.remove('completed');
        if (icon) {
            icon.classList.remove('fas', 'fa-check-circle');
            icon.classList.add('far', 'fa-circle');
        }
    }
}

function checkCoreInfoComplete() {
    return !!(
        document.getElementById('businessName')?.value?.trim() &&
        document.getElementById('websiteUrl')?.value?.trim() &&
        document.getElementById('businessCategory')?.value &&
        document.getElementById('tagline')?.value?.trim() &&
        document.getElementById('shortDescription')?.value?.trim()
    );
}

function checkLocationComplete() {
    const hasPhysicalAddress = document.querySelector('input[name="has_physical_address"]:checked')?.value;
    const phone = document.getElementById('businessPhone')?.value?.trim();
    const email = document.getElementById('businessEmail')?.value?.trim();

    if (!phone || !email) return false;

    if (hasPhysicalAddress === 'true') {
        return !!(
            document.getElementById('streetAddress')?.value?.trim() &&
            document.getElementById('city')?.value?.trim() &&
            document.getElementById('stateProvince')?.value?.trim() &&
            document.getElementById('postalCode')?.value?.trim() &&
            document.getElementById('country')?.value
        );
    } else if (hasPhysicalAddress === 'false') {
        return !!document.getElementById('headquartersCountry')?.value;
    }

    return false;
}

function checkVerificationComplete() {
    const inboxPreference = document.querySelector('input[name="inbox_preference"]:checked')?.value;

    if (inboxPreference === 'managed') {
        return true;
    } else if (inboxPreference === 'customer') {
        const email = document.getElementById('customerVerificationEmail')?.value?.trim();
        return !!(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    }

    return false;
}

function checkSocialComplete() {
    return !!(
        document.getElementById('linkedinUrl')?.value?.trim() ||
        document.getElementById('twitterUrl')?.value?.trim() ||
        document.getElementById('facebookUrl')?.value?.trim()
    );
}

function checkSaasComplete() {
    const isSaasProduct = document.getElementById('isSaasProduct')?.checked;

    if (!isSaasProduct) return false;

    return !!(
        document.getElementById('pricingModel')?.value &&
        (keyFeatures.length > 0 || useCaseTags.length > 0)
    );
}

function updateProgressSteps(completedItems) {
    const steps = document.querySelectorAll('.progress-step');

    steps.forEach((step, index) => {
        step.classList.remove('active', 'completed');

        if (index < Math.min(completedItems, 3)) {
            step.classList.add('completed');
            const numberEl = step.querySelector('.progress-step-number');
            if (numberEl) numberEl.innerHTML = '<i class="fas fa-check"></i>';
        } else if (index === Math.min(completedItems, 3)) {
            step.classList.add('active');
            const numberEl = step.querySelector('.progress-step-number');
            if (numberEl) numberEl.textContent = index + 1;
        } else {
            const numberEl = step.querySelector('.progress-step-number');
            if (numberEl) numberEl.textContent = index + 1;
        }
    });
}

// Handle profile form submission
async function handleProfileSubmit(event) {
    event.preventDefault();

    if (!validateProfileForm(true)) {
        showXeoAlert('Validation Error', 'Please fill in all required fields correctly.');
        return;
    }

    // Collect form data
    const formData = collectProfileFormData();

    // Generate managed inbox email if selected
    if (formData.inbox_preference === 'managed') {
        formData.managed_inbox_email = generateSlug(formData.business_name) + '@listings.visible2ai.com';
    }

    // Save to backend and localStorage
    await saveBusinessProfile(formData);
}

function collectProfileFormData() {
    // Collect social links
    const social_links = {};
    const linkedinUrl = document.getElementById('linkedinUrl')?.value?.trim();
    const twitterUrl = document.getElementById('twitterUrl')?.value?.trim();
    const facebookUrl = document.getElementById('facebookUrl')?.value?.trim();
    if (linkedinUrl) social_links.linkedin = linkedinUrl;
    if (twitterUrl) social_links.twitter = twitterUrl;
    if (facebookUrl) social_links.facebook = facebookUrl;

    // Build long description from multiple fields
    const longDesc = document.getElementById('longDescription')?.value?.trim() || '';
    const extendedDesc = document.getElementById('extendedDescription')?.value?.trim() || '';
    const business_description = extendedDesc ? `${longDesc}\n\n${extendedDesc}` : longDesc;

    // Get country - use headquarters country if no physical address
    const hasPhysicalAddress = document.querySelector('input[name="has_physical_address"]:checked')?.value === 'true';
    const country = hasPhysicalAddress
        ? (document.getElementById('country')?.value || 'United States')
        : (document.getElementById('headquartersCountry')?.value || 'United States');

    // Return data matching backend API field names
    return {
        // Core fields (backend expects these exact names)
        business_name: document.getElementById('businessName')?.value?.trim() || '',
        website_url: document.getElementById('websiteUrl')?.value?.trim() || '',
        short_description: document.getElementById('shortDescription')?.value?.trim() || '',
        business_description: business_description,
        primary_category: document.getElementById('businessCategory')?.value || '',
        phone: document.getElementById('businessPhone')?.value?.trim() || '',
        email: document.getElementById('businessEmail')?.value?.trim() || '',
        address_line1: document.getElementById('streetAddress')?.value?.trim() || '',
        address_line2: document.getElementById('suiteUnit')?.value?.trim() || '',
        city: document.getElementById('city')?.value?.trim() || '',
        state: document.getElementById('stateProvince')?.value?.trim() || '',
        postal_code: document.getElementById('postalCode')?.value?.trim() || '',
        country: country,
        year_founded: document.getElementById('yearFounded')?.value || null,
        logo_url: currentLogoDataUrl || '',
        social_links: social_links,

        // Additional fields for frontend state (not saved to backend profile table)
        _frontend_extra: {
            tagline: document.getElementById('tagline')?.value?.trim() || '',
            has_physical_address: hasPhysicalAddress,
            contact_person: document.getElementById('contactPerson')?.value?.trim() || '',
            inbox_preference: document.querySelector('input[name="inbox_preference"]:checked')?.value || 'managed',
            customer_verification_email: document.getElementById('customerVerificationEmail')?.value?.trim() || '',
            verification_phone: document.getElementById('verificationPhone')?.value?.trim() || '',
            allow_phone_on_listings: document.getElementById('allowPhoneOnListings')?.checked ?? true,
            allow_phone_verification: document.getElementById('allowPhoneVerification')?.checked ?? true,
            is_saas_product: document.getElementById('isSaasProduct')?.checked || false,
            pricing_model: document.getElementById('pricingModel')?.value || '',
            key_features: keyFeatures,
            integrations: document.getElementById('integrations')?.value?.trim() || '',
            use_case_tags: useCaseTags,
            consent_accepted: document.getElementById('consentAccepted')?.checked || false,
            consent_accepted_at: new Date().toISOString(),
            profile_completed_at: new Date().toISOString()
        }
    };
}

async function saveBusinessProfile(formData) {
    try {
        const authToken = getNormalizedAuthToken();
        if (!authToken) {
            showXeoAlert('Login Required', 'Please log in to save your business profile.');
            return;
        }

        const response = await fetch(`${API_BASE_URL}/citation-network/profile`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(formData)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Failed to save profile to backend:', errorData);
            throw new Error(errorData.error || 'Failed to save profile to server');
        }

        const result = await response.json();
        console.log('Profile saved to backend:', result);

        // Use BACKEND-confirmed completion status (not local assumption)
        const isComplete = result.isComplete ?? result.profile?.is_complete ?? false;
        const completionPercentage = result.completionPercentage ?? result.profile?.completion_percentage ?? 0;

        // Update state based on BACKEND response
        citationNetworkState.hasBusinessProfile = isComplete;
        citationNetworkState.includedStatus = isComplete ? 'ready' : 'no_profile';

        // Save to localStorage with backend completion fields (user-scoped)
        localStorage.setItem(getUserStorageKey('businessProfile'), JSON.stringify({
            ...formData,
            ...result.profile,
            is_complete: isComplete,
            completion_percentage: completionPercentage
        }));

        // Update phone policy state
        citationNetworkState.phonePolicy = {
            allowPhoneOnListings: formData.allow_phone_on_listings ?? formData._frontend_extra?.allow_phone_on_listings,
            allowPhoneVerification: formData.allow_phone_verification ?? formData._frontend_extra?.allow_phone_verification,
            verificationPhone: formData.verification_phone ?? formData._frontend_extra?.verification_phone
        };

        // Show appropriate message based on completion status
        const message = isComplete
            ? 'Your business profile has been saved successfully.\n\nYou can now start directory submissions.'
            : 'Your business profile has been saved.\n\nPlease complete all required fields to start submissions.';

        showXeoAlert('Profile Saved!', message);

        // Navigate back to citation network
        navigateToSection('citation-network');

        // Update Citation Network UI
        updateCitationNetworkUI();

    } catch (error) {
        console.error('Failed to save profile:', error);
        showXeoAlert('Save Failed', error.message || 'Failed to save profile. Please try again.');
    }
}

// Cancel profile form
function cancelProfileForm() {
    showXeoConfirm('Cancel Profile Setup?',
        'Are you sure you want to cancel? Any unsaved changes will be lost.',
        function(confirmed) {
            if (confirmed) {
                navigateToSection('citation-network');
            }
        }
    );
}

// Load existing profile if available (user-scoped)
function loadExistingProfile() {
    try {
        const savedProfile = localStorage.getItem(getUserStorageKey('businessProfile'));
        if (savedProfile) {
            const profile = JSON.parse(savedProfile);
            populateProfileForm(profile);
            citationNetworkState.hasBusinessProfile = true;
        }
    } catch (error) {
        console.error('Failed to load profile:', error);
    }
}

function populateProfileForm(profile) {
    // Handle both backend API format and frontend extra fields
    const extra = profile._frontend_extra || {};

    // Populate form fields with saved data (handle both old and new field names)
    if (profile.business_name) document.getElementById('businessName').value = profile.business_name;
    if (profile.website_url) document.getElementById('websiteUrl').value = profile.website_url;

    // Category: backend uses primary_category, old localStorage used category
    const category = profile.primary_category || profile.category;
    if (category) document.getElementById('businessCategory').value = category;

    // Tagline is frontend-only
    const tagline = extra.tagline || profile.tagline;
    if (tagline) document.getElementById('tagline').value = tagline;

    if (profile.short_description) document.getElementById('shortDescription').value = profile.short_description;

    // Description: backend uses business_description, old localStorage used long_description
    const longDesc = profile.business_description || profile.long_description;
    if (longDesc) document.getElementById('longDescription').value = longDesc;

    // Extended description is frontend-only
    if (profile.extended_description) document.getElementById('extendedDescription').value = profile.extended_description;

    if (profile.phone) document.getElementById('businessPhone').value = profile.phone;

    // Email: backend uses email, old localStorage used business_email
    const email = profile.email || profile.business_email;
    if (email) document.getElementById('businessEmail').value = email;

    // Contact person is frontend-only
    const contactPerson = extra.contact_person || profile.contact_person;
    if (contactPerson) document.getElementById('contactPerson').value = contactPerson;

    const verificationPhone = extra.verification_phone || profile.verification_phone;
    if (verificationPhone) document.getElementById('verificationPhone').value = verificationPhone;

    if (profile.year_founded) document.getElementById('yearFounded').value = profile.year_founded;

    // Social links: backend stores as object, old localStorage used separate fields
    if (profile.social_links) {
        if (profile.social_links.linkedin) document.getElementById('linkedinUrl').value = profile.social_links.linkedin;
        if (profile.social_links.twitter) document.getElementById('twitterUrl').value = profile.social_links.twitter;
        if (profile.social_links.facebook) document.getElementById('facebookUrl').value = profile.social_links.facebook;
    } else {
        if (profile.linkedin_url) document.getElementById('linkedinUrl').value = profile.linkedin_url;
        if (profile.twitter_url) document.getElementById('twitterUrl').value = profile.twitter_url;
        if (profile.facebook_url) document.getElementById('facebookUrl').value = profile.facebook_url;
    }

    const integrations = extra.integrations || profile.integrations;
    if (integrations) document.getElementById('integrations').value = integrations;

    // Restore logo if available
    if (profile.logo_url) {
        currentLogoDataUrl = profile.logo_url;
        const previewContainer = document.getElementById('logoPreviewContainer');
        const preview = document.getElementById('logoPreview');
        const uploadPrompt = document.getElementById('logoUploadPrompt');
        const uploadArea = document.getElementById('logoUploadArea');

        if (preview && previewContainer && uploadPrompt && uploadArea) {
            preview.src = profile.logo_url;
            previewContainer.style.display = 'block';
            uploadPrompt.style.display = 'none';
            uploadArea.classList.add('has-file');
        }
    }

    // Handle address fields (check both old and new field names)
    const hasPhysicalAddress = extra.has_physical_address ?? profile.has_physical_address;
    const hasAddress = profile.address_line1 || profile.street_address || profile.city;

    if (hasPhysicalAddress !== undefined || hasAddress) {
        const radioValue = (hasPhysicalAddress || hasAddress) ? 'true' : 'false';
        const radio = document.querySelector(`input[name="has_physical_address"][value="${radioValue}"]`);
        if (radio) {
            radio.checked = true;
            toggleAddressFields(hasPhysicalAddress || hasAddress);
        }

        if (hasPhysicalAddress || hasAddress) {
            // Handle both backend (address_line1) and old localStorage (street_address) names
            const streetAddress = profile.address_line1 || profile.street_address;
            const suiteUnit = profile.address_line2 || profile.suite_unit;
            const state = profile.state || profile.state_province;

            if (streetAddress) document.getElementById('streetAddress').value = streetAddress;
            if (suiteUnit) document.getElementById('suiteUnit').value = suiteUnit;
            if (profile.city) document.getElementById('city').value = profile.city;
            if (state) document.getElementById('stateProvince').value = state;
            if (profile.postal_code) document.getElementById('postalCode').value = profile.postal_code;
            if (profile.country) document.getElementById('country').value = profile.country;
        } else {
            const hqCountry = profile.headquarters_country || profile.country;
            if (hqCountry) document.getElementById('headquartersCountry').value = hqCountry;
        }
    }

    // Handle inbox preference (frontend-only)
    const inboxPreference = extra.inbox_preference || profile.inbox_preference;
    if (inboxPreference) {
        const radio = document.querySelector(`input[name="inbox_preference"][value="${inboxPreference}"]`);
        if (radio) {
            radio.checked = true;
            toggleInboxPreference(inboxPreference);
        }
        const custEmail = extra.customer_verification_email || profile.customer_verification_email;
        if (custEmail) {
            document.getElementById('customerVerificationEmail').value = custEmail;
        }
    }

    // Handle SaaS fields (frontend-only)
    const isSaas = extra.is_saas_product || profile.is_saas_product;
    if (isSaas) {
        document.getElementById('isSaasProduct').checked = true;
        toggleSaasFields();
        const pricingModel = extra.pricing_model || profile.pricing_model;
        if (pricingModel) document.getElementById('pricingModel').value = pricingModel;

        keyFeatures = extra.key_features || profile.key_features || [];
        useCaseTags = extra.use_case_tags || profile.use_case_tags || [];
        renderFeatureTags();
        renderUseCaseTags();
    }

    // Handle consent (frontend-only)
    const consentAccepted = extra.consent_accepted || profile.consent_accepted;
    if (consentAccepted) {
        document.getElementById('consentAccepted').checked = true;
    }

    // Update character counts
    updateCharCount('tagline', 50);
    updateCharCount('shortDescription', 160);
    updateCharCount('longDescription', 500);
    updateCharCount('extendedDescription', 1500);

    // Update managed inbox preview
    updateManagedInboxPreview();

    // Update completeness
    updateProfileCompleteness();
    validateSaveButton();
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', initDashboard);
window.addEventListener('DOMContentLoaded', initCitationNetwork);
window.addEventListener('DOMContentLoaded', initBusinessProfileForm);
window.addEventListener('DOMContentLoaded', loadExistingProfile);
