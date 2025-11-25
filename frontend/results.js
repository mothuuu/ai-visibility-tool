// Enhanced results.js - FIXED to match actual API response structure

const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : 'https://ai-visibility-tool.onrender.com/api';

// Get scan ID from URL
const urlParams = new URLSearchParams(window.location.search);
const scanId = urlParams.get('scanId');

// Check authentication
const authToken = localStorage.getItem('authToken');
const userData = JSON.parse(localStorage.getItem('user') || '{}');

if (!scanId) {
    window.location.href = 'dashboard.html';
}

// Priority color mapping
const priorityColors = {
    critical: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
    high: { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300' },
    medium: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' },
    low: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' }
};

/**
 * Convert numeric priority score to text label
 * @param {number|string} priority - Priority value (can be numeric score or text)
 * @returns {string} Priority label (CRITICAL, HIGH, MEDIUM, LOW)
 */
function getPriorityLabel(priority) {
    // If already a string label, normalize it
    if (typeof priority === 'string' && isNaN(priority)) {
        return priority.toLowerCase();
    }

    // Convert to number if it's a string number
    const score = typeof priority === 'string' ? parseFloat(priority) : priority;

    // If it's not a valid number, default to medium
    if (isNaN(score)) {
        return 'medium';
    }

    // Convert numeric score to priority category
    if (score >= 80) {
        return 'critical';
    } else if (score >= 60) {
        return 'high';
    } else if (score >= 40) {
        return 'medium';
    } else {
        return 'low';
    }
}

/**
 * Get priority badge color class
 * @param {string} priority - Priority label (critical, high, medium, low)
 * @returns {string} CSS class for priority badge
 */
function getPriorityBadgeClass(priority) {
    const normalizedPriority = priority.toLowerCase();

    if (normalizedPriority === 'critical' || normalizedPriority === 'high') {
        return 'rec-priority-badge high';
    } else if (normalizedPriority === 'medium') {
        return 'rec-priority-badge medium';
    } else {
        return 'rec-priority-badge low';
    }
}

// Global chart variable
let categoryRadarChart = null;

// Category icons mapping
const categoryIcons = {
    aiReadability: '📖',
    aiSearchReadiness: '🔍',
    technicalSetup: '⚙️',
    contentStructure: '📋',
    entityStrength: '🏢',
    trustAuthority: '⭐',
    voiceOptimization: '👥',
    contentFreshness: '🎯',
    speedUX: '⚡'
};

// Category name mapping
const categoryNames = {
    aiReadability: 'AI Readability',
    aiSearchReadiness: 'AI Search Readiness',
    technicalSetup: 'Technical Setup',
    contentStructure: 'Content Structure',
    entityStrength: 'Entity Strength',
    trustAuthority: 'Trust Authority',
    voiceOptimization: 'Voice Optimization',
    contentFreshness: 'Content Freshness',
    speedUX: 'Speed UX'
};

// Load and display scan results
async function loadScanResults() {
    try {
        const headers = authToken
            ? { 'Authorization': `Bearer ${authToken}` }
            : {};

        console.log('Loading scan results for scanId:', scanId);
        console.log('API URL:', `${API_BASE_URL}/scan/${scanId}`);

        const response = await fetch(`${API_BASE_URL}/scan/${scanId}`, { headers });

        console.log('Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Response not OK:', response.status, errorText);
            throw new Error(`Failed to load scan results: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Response data:', data);

        if (data.success) {
            try {
                displayResults(data.scan, data.quota);
            } catch (displayError) {
                console.error('Error in displayResults:', displayError);
                console.error('Display error stack:', displayError.stack);
                throw displayError;
            }
        } else {
            throw new Error(data.error || 'Unknown error');
        }
    } catch (error) {
        console.error('Error loading results:', error);
        console.error('Error stack:', error.stack);
        showError(`Failed to load scan results. ${error.message || 'Please try again.'}`);
    }
}

function displayResults(scan, quota) {
    console.log('Scan data:', scan); // Debug log

    // Determine user tier (guest, free, diy, pro)
    const userTier = authToken ? (userData.plan || 'free') : 'guest';

    // Update header info
    document.getElementById('scanUrl').innerHTML = `<strong>${scan.url}</strong>`;
    document.getElementById('scanDate').textContent = new Date(scan.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    // Display page count if available
    if (scan.page_count && scan.page_count > 1) {
        const pageCountEl = document.getElementById('pageCountMeta');
        if (pageCountEl) {
            pageCountEl.style.display = 'flex';
            document.getElementById('pageCount').textContent = `${scan.page_count} pages scanned`;
        }
    }

    // Display industry if available
    if (scan.industry) {
        const industryEl = document.getElementById('industryMeta');
        if (industryEl) {
            industryEl.style.display = 'flex';
            document.getElementById('scanIndustry').textContent = scan.industry;
        }
    }

    // Display overall score (convert 0-100 to 0-1000)
    const displayScore = Math.round(scan.total_score * 10);
    document.getElementById('overallScore').textContent = displayScore;

    // Display grade
    const grade = calculateGrade(displayScore);
    const gradeEl = document.getElementById('scoreGrade');
    if (gradeEl) {
        gradeEl.textContent = grade;
    }

    // Animate SVG progress ring
    animateScoreRing(scan.total_score);

    // Display user plan
    if (userData.plan) {
        document.getElementById('userPlan').textContent = userData.plan.toUpperCase();
    }

    // Display user mode indicator and notifications (if data available)
    console.log('🔍 Checking userMode:', scan.userMode);
    console.log('🔍 Auth token present:', !!authToken);
    console.log('🔍 User data:', userData);

    if (scan.userMode) {
        const recCount = scan.recommendations ? scan.recommendations.length : 0;
        console.log('✅ Displaying Optimization Mode section with score:', displayScore);
        displayModeIndicator(scan.userMode, displayScore, recCount);
    } else {
        console.log('⚠️ No userMode data found in scan response. User must be logged in to see Optimization Mode.');
    }
    if (scan.notifications) {
        displayNotificationCenter(scan.notifications, scan.unreadNotificationCount || 0);
    }
    if (scan.currentCycle) {
        displayRefreshCycle(scan.currentCycle);
    }
    if (scan.recentDetections && scan.recentDetections.length > 0) {
        displayAutoDetections(scan.recentDetections);
    }

    // Display category scores
    if (scan.categoryBreakdown) {
        displayCategoryScores(scan.categoryBreakdown, scan.recommendations || [], scan.categoryWeights || {});
    }

    // Update recommendations count
    const recCount = scan.recommendations ? scan.recommendations.length : 0;
    const recCountEl = document.getElementById('recCount');
    if (recCountEl) {
        recCountEl.textContent = `${recCount} actionable improvement${recCount !== 1 ? 's' : ''} to boost your AI visibility`;
    }

    // Display recommendations based on tier and scan type
    if (scan.is_competitor || scan.domain_type === 'competitor') {
        // Competitor scan - show info message instead of recommendations
        displayCompetitorScanMessage(scan);
    } else if (userTier === 'guest') {
        // Guest: Show NO recommendations, only signup CTA
        displayGuestRecommendations(scan);
    } else if (scan.recommendations && scan.recommendations.length > 0) {
        // Authenticated: Show recommendations based on plan
        displayRecommendations(scan.recommendations, userTier, scan.userProgress, scan.nextBatchUnlock, scan.batchesUnlocked);
    } else {
        document.getElementById('recommendationsList').innerHTML = '<p style="text-align: center; padding: 32px 0; color: #718096;">No recommendations available for this scan.</p>';
    }

    // Display FAQ section (DIY+ only)
    if (scan.faq && userTier !== 'free' && userTier !== 'guest') {
        displayFAQSection(scan.faq);
    }

    // Display upgrade CTA based on tier
    displayUpgradeCTA(userTier, scan.recommendations ? scan.recommendations.length : 0);

    // Show export options for DIY+
    if (userTier !== 'free' && userTier !== 'guest') {
        const exportSection = document.getElementById('exportSection');
        if (exportSection) {
            exportSection.style.display = 'flex';
        }
    }

    // Display historic comparison if available
    if (scan.comparison || scan.historicalTimeline) {
        displayHistoricComparison(scan.comparison, scan.historicalTimeline);
    }
}

function displayCategoryScores(categories, recommendations, weights = {}) {
    const container = document.getElementById('categoryScores');
    container.innerHTML = '';

    // Prepare category data with scores and weights
    const categoryData = Object.entries(categories).map(([categoryKey, score]) => {
        const displayScore = Math.round(score * 10); // Convert to 0-1000
        const categoryName = categoryNames[categoryKey] || formatCategoryName(categoryKey);
        const weight = weights[categoryKey] || 0;
        const weightPercent = Math.round(weight * 100); // Convert to percentage
        return { key: categoryKey, name: categoryName, score: score, displayScore: displayScore, weight: weight, weightPercent: weightPercent };
    });

    // Calculate and display metrics
    const metrics = calculateMetrics(categories);
    const strongEl = document.getElementById('strongCount');
    const warningEl = document.getElementById('warningCount');
    const criticalEl = document.getElementById('criticalCount');

    if (strongEl) strongEl.textContent = metrics.strong;
    if (warningEl) warningEl.textContent = metrics.warning;
    if (criticalEl) criticalEl.textContent = metrics.critical;

    // Create list items for each category
    categoryData.forEach(cat => {
        const displayScore = cat.displayScore;

        // Determine color class based on score
        let colorClass = 'category-item';
        if (displayScore < 400) {
            colorClass += ' critical';
        } else if (displayScore < 700) {
            colorClass += ' warning';
        }

        // Determine score color
        let scoreColor = 'category-score';
        if (displayScore < 400) {
            scoreColor += ' critical';
        } else if (displayScore < 700) {
            scoreColor += ' warning';
        }

        const item = document.createElement('div');
        item.className = colorClass;
        item.innerHTML = `
            <div class="category-info">
                <div class="category-name">${cat.name}</div>
                ${cat.weightPercent > 0 ? `<div class="category-weight" style="font-size: 12px; color: #718096; margin-top: 4px;">Weight: ${cat.weightPercent}% of total score</div>` : ''}
            </div>
            <div class="category-score-section">
                <div class="${scoreColor}">${displayScore}</div>
                <div class="category-max">/ 1000</div>
            </div>
        `;
        container.appendChild(item);
    });

    // Initialize bar chart with category data
    initializeBarChart(categoryData);
}

// Initialize Chart.js radar chart
function initializeRadarChart(categoryData) {
    const ctx = document.getElementById('categoryRadarChart');
    if (!ctx) return;

    // Destroy existing chart if it exists
    if (categoryRadarChart) {
        categoryRadarChart.destroy();
    }

    const chartLabels = categoryData.map(cat => cat.name);
    const chartScores = categoryData.map(cat => cat.score);

    categoryRadarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Your Score (%)',
                data: chartScores,
                fill: true,
                backgroundColor: 'rgba(0, 185, 218, 0.2)',
                borderColor: 'rgb(0, 185, 218)',
                pointBackgroundColor: 'rgb(243, 28, 126)',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: 'rgb(243, 28, 126)',
                pointRadius: 6,
                pointHoverRadius: 8,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            layout: {
                padding: {
                    top: 20,
                    right: 40,
                    bottom: 20,
                    left: 40
                }
            },
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        stepSize: 20,
                        font: {
                            size: 12
                        }
                    },
                    pointLabels: {
                        font: {
                            size: 13,
                            weight: 'bold'
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const score = context.parsed.r;
                            const displayScore = Math.round(score * 10);
                            return `Score: ${displayScore} / 1000`;
                        }
                    }
                }
            }
        }
    });
}

// Animate SVG progress ring
function animateScoreRing(score) {
    const circle = document.getElementById('scoreProgress');
    if (!circle) return;

    const radius = 78;
    const circumference = 2 * Math.PI * radius;
    const percentage = score / 100; // Score is 0-100
    const offset = circumference - (percentage * circumference);

    // Set initial state
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = circumference;

    // Animate to final state
    setTimeout(() => {
        circle.style.transition = 'stroke-dashoffset 1s ease-out';
        circle.style.strokeDashoffset = offset;
    }, 100);
}

// Guest recommendations - show signup CTA instead of recommendations
function displayCompetitorScanMessage(scan) {
    const container = document.getElementById('recommendationsList');
    container.innerHTML = `
        <div class="bg-gradient-to-r from-orange-50 to-yellow-50 rounded-lg p-12 text-center border-2 border-orange-300">
            <div class="text-6xl mb-4">🔍</div>
            <h3 class="text-2xl font-bold text-gray-900 mb-4">Competitor Scan Complete</h3>
            <p class="text-gray-700 mb-6 max-w-2xl mx-auto">
                This is a <span class="font-bold text-orange-600">competitor domain scan</span>.
                Your primary domain is <span class="font-bold text-blue-600">${scan.primary_domain}</span>.
            </p>
            <div class="bg-white rounded-lg p-6 mb-6 max-w-xl mx-auto border border-orange-200">
                <h4 class="font-bold text-lg mb-3 text-gray-900">Competitor Scan Includes:</h4>
                <div class="text-left mx-auto" style="max-width: 300px;">
                    <div class="flex items-center gap-2 text-green-600 font-semibold mb-2">
                        <span>✅</span> <span>AI Visibility Score</span>
                    </div>
                    <div class="flex items-center gap-2 text-green-600 font-semibold mb-2">
                        <span>✅</span> <span>8 Category Scores</span>
                    </div>
                    <div class="flex items-center gap-2 text-gray-400 font-semibold mb-2 line-through">
                        <span>❌</span> <span>Recommendations</span>
                    </div>
                    <div class="flex items-center gap-2 text-gray-400 font-semibold line-through">
                        <span>❌</span> <span>Implementation Guidance</span>
                    </div>
                </div>
            </div>
            <p class="text-sm text-gray-600 mb-4">
                To get recommendations and implementation guidance, scan your primary domain:
                <span class="font-bold text-blue-600">${scan.primary_domain}</span>
            </p>
            <a href="dashboard.html"
               class="inline-block px-8 py-4 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-bold rounded-full text-lg hover:shadow-xl transition-all transform hover:scale-105">
                ← Back to Dashboard
            </a>
        </div>
    `;
}

function displayGuestRecommendations(scan) {
    const container = document.getElementById('recommendationsList');
    container.innerHTML = `
        <div class="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-12 text-center border-2 border-blue-200">
            <div class="text-6xl mb-4">🔒</div>
            <h3 class="text-2xl font-bold text-gray-900 mb-4">Sign Up to Unlock Your Top 3 Recommendations</h3>
            <p class="text-gray-600 mb-6 max-w-2xl mx-auto">
                Your AI Visibility Score is <span class="font-bold text-purple-600">${Math.round(scan.total_score * 10)}/1000</span>.
                Sign up for free to see exactly what to fix and how to improve your ranking in AI search engines.
            </p>
            <div class="flex justify-center gap-4 mb-6">
                <div class="text-left">
                    <div class="flex items-center gap-2 text-green-600 font-semibold mb-2">
                        <span>✓</span> <span>Top 3 Priority Recommendations</span>
                    </div>
                    <div class="flex items-center gap-2 text-green-600 font-semibold mb-2">
                        <span>✓</span> <span>Detailed Action Steps</span>
                    </div>
                    <div class="flex items-center gap-2 text-green-600 font-semibold">
                        <span>✓</span> <span>Track Progress Over Time</span>
                    </div>
                </div>
            </div>
            <a href="auth.html?mode=signup&scanId=${scanId}"
               class="inline-block px-8 py-4 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-bold rounded-full text-lg hover:shadow-xl transition-all transform hover:scale-105">
                Sign Up Free - No Credit Card Required →
            </a>
            <p class="text-sm text-gray-500 mt-4">Already have an account? <a href="auth.html?mode=login" class="text-purple-600 font-semibold hover:underline">Sign In</a></p>
        </div>
    `;
}

function displayRecommendations(recommendations, userTier, userProgress, nextBatchUnlock, batchesUnlocked) {
    const container = document.getElementById('recommendationsList');
    container.innerHTML = '';

    console.log('Displaying recommendations:', recommendations); // Debug log
    console.log('User tier:', userTier);
    console.log('User progress:', userProgress);
    console.log('Next batch unlock:', nextBatchUnlock);
    console.log('Batches just unlocked:', batchesUnlocked);

    // Show batch unlock notification if batches were just unlocked
    if (batchesUnlocked && batchesUnlocked > 0) {
        const notification = document.createElement('div');
        notification.className = 'mb-6 p-6 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border-2 border-green-300';
        notification.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="text-4xl">🎉</span>
                <div>
                    <h3 class="text-xl font-bold text-gray-900 mb-1">New Recommendations Unlocked!</h3>
                    <p class="text-gray-700">
                        Batch ${batchesUnlocked} has been automatically unlocked.
                        ${nextBatchUnlock ? `Next batch unlocks in ${nextBatchUnlock.daysRemaining} day${nextBatchUnlock.daysRemaining !== 1 ? 's' : ''}.` : 'All batches unlocked!'}
                    </p>
                </div>
            </div>
        `;
        container.appendChild(notification);
    }

    // Show batch countdown timer if next batch is available
    if (nextBatchUnlock && nextBatchUnlock.daysRemaining > 0) {
        const countdownTimer = document.createElement('div');
        countdownTimer.className = 'mb-6 p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border-2 border-purple-200';
        countdownTimer.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <span class="text-3xl">⏰</span>
                    <div>
                        <h4 class="font-bold text-gray-900">Next Batch Unlock</h4>
                        <p class="text-sm text-gray-600">
                            ${nextBatchUnlock.recommendationsInBatch} more recommendations unlock in
                            <span class="font-bold text-purple-600">${nextBatchUnlock.daysRemaining} day${nextBatchUnlock.daysRemaining !== 1 ? 's' : ''}</span>
                        </p>
                    </div>
                </div>
                <div class="text-right">
                    <div class="text-2xl font-bold text-purple-600">${nextBatchUnlock.daysRemaining}</div>
                    <div class="text-xs text-gray-600">days left</div>
                </div>
            </div>
        `;
        container.appendChild(countdownTimer);
    }

    // Separate active, implemented, and skipped recommendations
    const implementedRecs = recommendations.filter(rec => rec.implemented_at || rec.status === 'implemented');
    const activeRecs = recommendations.filter(rec => !rec.skipped_at && !rec.implemented_at && rec.status !== 'implemented' && rec.unlock_state !== 'locked');
    const skippedRecs = recommendations.filter(rec => rec.skipped_at && !rec.implemented_at);
    const lockedRecs = recommendations.filter(rec => rec.unlock_state === 'locked');

    // Determine how many active recommendations to show based on tier
    let displayRecs;
    if (userTier === 'free') {
        // Free: Top 3 only
        displayRecs = activeRecs.slice(0, 3);
    } else if (userTier === 'diy' && userProgress) {
        // DIY: Show based on active_recommendations count
        const activeCount = userProgress.active_recommendations || 5;
        displayRecs = activeRecs.slice(0, activeCount);
    } else {
        // Pro: All active recommendations
        displayRecs = activeRecs;
    }

    // Create tab interface if there are skipped or implemented recommendations
    if (skippedRecs.length > 0 || implementedRecs.length > 0) {
        const tabsHTML = `
            <div class="mb-6 border-b border-gray-200">
                <div class="flex gap-4">
                    <button onclick="switchTab('active')" id="tab-active"
                            class="tab-button px-6 py-3 font-semibold border-b-2 tab-active-bg rounded-t-lg">
                        Active (${displayRecs.length})
                    </button>
                    ${implementedRecs.length > 0 ? `
                    <button onclick="switchTab('implemented')" id="tab-implemented"
                            class="tab-button px-6 py-3 font-semibold tab-inactive rounded-t-lg">
                        ✓ Implemented (${implementedRecs.length})
                    </button>
                    ` : ''}
                    ${skippedRecs.length > 0 ? `
                    <button onclick="switchTab('skipped')" id="tab-skipped"
                            class="tab-button px-6 py-3 font-semibold tab-inactive rounded-t-lg">
                        Skipped (${skippedRecs.length})
                    </button>
                    ` : ''}
                </div>
            </div>
            <div id="tab-content-active" class="tab-content"></div>
            ${implementedRecs.length > 0 ? '<div id="tab-content-implemented" class="tab-content hidden"></div>' : ''}
            ${skippedRecs.length > 0 ? '<div id="tab-content-skipped" class="tab-content hidden"></div>' : ''}
        `;
        container.innerHTML = tabsHTML;
    }

    // Get containers for active, implemented, and skipped
    const activeContainer = document.getElementById('tab-content-active') || container;
    const implementedContainer = document.getElementById('tab-content-implemented');
    const skippedContainer = document.getElementById('tab-content-skipped');

    if (displayRecs.length === 0 && skippedRecs.length === 0 && implementedRecs.length === 0) {
        activeContainer.innerHTML = '<p class="text-gray-500 text-center py-8">No recommendations available for this scan.</p>';
        return;
    }

    // Display active recommendations
    if (displayRecs.length > 0) {
        displayRecs.forEach((rec, index) => {
            const recCard = createRecommendationCard(rec, index, userTier);
            activeContainer.appendChild(recCard);

            // Attach copy button listeners immediately after adding to DOM
            attachCopyButtonListeners(recCard);
            // Attach action button listeners (Mark as Implemented, Skip)
            attachActionButtonListeners(recCard);
        });
    } else if (activeRecs.length === 0) {
        const otherTabs = [];
        if (implementedRecs.length > 0) otherTabs.push('Implemented');
        if (skippedRecs.length > 0) otherTabs.push('Skipped');
        const message = otherTabs.length > 0
            ? `No active recommendations. Check the ${otherTabs.join(' and ')} tab${otherTabs.length > 1 ? 's' : ''}.`
            : 'No active recommendations.';
        activeContainer.innerHTML = `<p class="text-gray-500 text-center py-8">${message}</p>`;
    }

    // Display implemented recommendations
    if (implementedContainer && implementedRecs.length > 0) {
        implementedRecs.forEach((rec, index) => {
            const recCard = createRecommendationCard(rec, index, userTier, false);
            implementedContainer.appendChild(recCard);

            // Attach copy button listeners immediately after adding to DOM
            attachCopyButtonListeners(recCard);
        });
    }

    // Display skipped recommendations
    if (skippedContainer && skippedRecs.length > 0) {
        skippedRecs.forEach((rec, index) => {
            const recCard = createRecommendationCard(rec, index + displayRecs.length, userTier, true);
            skippedContainer.appendChild(recCard);

            // Attach copy button listeners immediately after adding to DOM
            attachCopyButtonListeners(recCard);
            // Attach action button listeners (Mark as Implemented, Skip)
            attachActionButtonListeners(recCard);
        });
    }

    // Show DIY unlock button if applicable (only in active tab)
    if (userTier === 'diy' && userProgress) {
        const activeCount = userProgress.active_recommendations || 5;
        const totalCount = userProgress.total_recommendations || recommendations.length;
        const canUnlockMore = userProgress.unlocks_today < 5 && activeCount < totalCount;

        if (activeCount < totalCount) {
            displayUnlockButton(activeCount, totalCount, canUnlockMore, userProgress);
        }
    }

    // Show upgrade message if free tier (only in active tab)
    if (userTier === 'free' && recommendations.length > 3) {
        const upgradeMsg = document.createElement('div');
        upgradeMsg.className = 'mt-6 p-6 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border-2 border-blue-200 text-center';
        upgradeMsg.innerHTML = `
            <h3 class="text-xl font-bold mb-2">🔒 ${recommendations.length - 5} More Recommendations Available</h3>
            <p class="text-gray-700 mb-4">Upgrade to DIY Starter to unlock all recommendations, FAQ generation, and unlimited scans.</p>
            <a href="checkout.html?url=${encodeURIComponent(document.getElementById('scanUrl').textContent)}"
               class="inline-block px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-semibold hover:from-blue-700 hover:to-purple-700 transition-all">
                Upgrade to DIY - $29/month
            </a>
        `;
        activeContainer.appendChild(upgradeMsg);
    }

}

// Attach copy button listeners directly to buttons within a card
function attachCopyButtonListeners(cardElement) {
    console.log('📋 Attaching copy button listeners to card');

    // Find all copy buttons within this card
    const copyButtons = cardElement.querySelectorAll('.copy-btn');
    console.log(`   Found ${copyButtons.length} copy buttons in card`);

    copyButtons.forEach((button, idx) => {
        const targetId = button.getAttribute('data-target');
        console.log(`   Button ${idx}: target=${targetId}`);

        // Remove any existing listener to avoid duplicates
        button.removeEventListener('click', button._copyHandler);

        // Create and store the handler
        button._copyHandler = async function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('🖱️ Copy button clicked! Target:', targetId);
            await copyCode(targetId);
        };

        // Attach the listener
        button.addEventListener('click', button._copyHandler);
    });

    // Also handle schema copy buttons
    const schemaButtons = cardElement.querySelectorAll('.copy-schema-btn');
    console.log(`   Found ${schemaButtons.length} schema copy buttons in card`);

    schemaButtons.forEach((button) => {
        button.removeEventListener('click', button._schemaHandler);

        button._schemaHandler = async function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('🖱️ Schema copy button clicked!');
            await copySchemaCode();
        };

        button.addEventListener('click', button._schemaHandler);
    });
}

// Attach action button listeners (Mark as Implemented, Skip)
function attachActionButtonListeners(cardElement) {
    console.log('🔘 Attaching action button listeners to card');

    // Find mark implemented buttons
    const markImplementedButtons = cardElement.querySelectorAll('.mark-implemented-btn');
    console.log(`   Found ${markImplementedButtons.length} mark implemented buttons in card`);

    markImplementedButtons.forEach((button) => {
        const recId = button.getAttribute('data-rec-id');
        console.log(`   Mark Implemented button: rec-id=${recId}`);

        // Remove any existing listener to avoid duplicates
        button.removeEventListener('click', button._markImplementedHandler);

        // Create and store the handler
        button._markImplementedHandler = async function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('🖱️ Mark Implemented button clicked! Rec ID:', recId);
            await window.markImplemented(recId);
        };

        // Attach the listener
        button.addEventListener('click', button._markImplementedHandler);
    });

    // Find skip buttons
    const skipButtons = cardElement.querySelectorAll('.skip-rec-btn');
    console.log(`   Found ${skipButtons.length} skip buttons in card`);

    skipButtons.forEach((button) => {
        const recId = button.getAttribute('data-rec-id');
        const daysUntilSkip = parseInt(button.getAttribute('data-days-until-skip') || '0', 10);
        console.log(`   Skip button: rec-id=${recId}, days-until-skip=${daysUntilSkip}`);

        // Remove any existing listener to avoid duplicates
        button.removeEventListener('click', button._skipHandler);

        // Create and store the handler
        button._skipHandler = async function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('🖱️ Skip button clicked! Rec ID:', recId, 'Days until skip:', daysUntilSkip);
            await window.skipRecommendation(recId, daysUntilSkip);
        };

        // Attach the listener
        button.addEventListener('click', button._skipHandler);
    });
}

// Tab switching function
function switchTab(tabName) {
    // Update tab button styles - remove all color classes first
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('tab-active-bg', 'tab-implemented-bg', 'tab-skipped-bg', 'border-blue-600', 'text-blue-600', 'text-gray-500');
        btn.classList.add('tab-inactive');
    });

    // Apply the appropriate background class based on which tab is selected
    const activeTabBtn = document.getElementById(`tab-${tabName}`);
    if (activeTabBtn) {
        activeTabBtn.classList.remove('tab-inactive');

        // Apply specific pastel background based on tab type
        if (tabName === 'active') {
            activeTabBtn.classList.add('tab-active-bg', 'border-b-2');
        } else if (tabName === 'implemented') {
            activeTabBtn.classList.add('tab-implemented-bg', 'border-b-2');
        } else if (tabName === 'skipped') {
            activeTabBtn.classList.add('tab-skipped-bg', 'border-b-2');
        }
    }

    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });

    // Show selected tab content
    const selectedContent = document.getElementById(`tab-content-${tabName}`);
    if (selectedContent) {
        selectedContent.classList.remove('hidden');
    }
}

// Display unlock button for DIY users
function displayUnlockButton(activeCount, totalCount, canUnlockMore, userProgress) {
    const container = document.getElementById('recommendationsList');
    const remaining = totalCount - activeCount;
    const toUnlock = Math.min(5, remaining);

    const unlockCard = document.createElement('div');
    unlockCard.className = 'mt-6 p-8 bg-gradient-to-r from-cyan-50 to-purple-50 rounded-lg border-2 border-cyan-300 text-center';

    if (canUnlockMore) {
        unlockCard.innerHTML = `
            <div class="text-5xl mb-4">🎁</div>
            <h3 class="text-2xl font-bold text-gray-900 mb-2">Unlock ${toUnlock} More Recommendations</h3>
            <p class="text-gray-700 mb-4">
                You've unlocked ${activeCount} of ${totalCount} recommendations.
                Unlock ${toUnlock} more today to keep improving your AI visibility!
            </p>
            <p class="text-sm text-gray-600 mb-4">
                Daily unlocks: ${userProgress.unlocks_today || 0}/5 used today
            </p>
            <button onclick="unlockMoreRecommendations()"
                    class="px-8 py-4 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-bold rounded-full text-lg hover:shadow-xl transition-all transform hover:scale-105">
                Unlock ${toUnlock} More Recommendations →
            </button>
        `;
    } else {
        // Daily limit reached
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        unlockCard.innerHTML = `
            <div class="text-5xl mb-4">⏰</div>
            <h3 class="text-2xl font-bold text-gray-900 mb-2">Daily Unlock Limit Reached</h3>
            <p class="text-gray-700 mb-4">
                You've unlocked ${activeCount} of ${totalCount} recommendations.
                You've used all 5 daily unlocks. Come back tomorrow to unlock more!
            </p>
            <p class="text-sm text-purple-600 font-semibold">
                Next unlock available: ${tomorrow.toLocaleDateString()} at midnight
            </p>
        `;
    }

    container.appendChild(unlockCard);
}

// Unlock more recommendations (DIY tier)
async function unlockMoreRecommendations() {
    try {
        const response = await fetch(`${API_BASE_URL}/scan/${scanId}/unlock`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        const data = await response.json();

        if (data.success) {
            // Show success message
            await showAlertModal(
                'Success!',
                `${data.message}\n\nYou now have ${data.progress.active_recommendations} recommendations unlocked!`,
                'success'
            );
            // Reload page to show new recommendations
            window.location.reload();
        } else {
            await showAlertModal('Error', data.error || 'Failed to unlock recommendations', 'error');
        }
    } catch (error) {
        console.error('Unlock error:', error);
        await showAlertModal('Error', 'Failed to unlock recommendations. Please try again.', 'error');
    }
}

// Update upgrade CTA function
function displayUpgradeCTA(userTier, totalRecs) {
    const container = document.getElementById('upgradeCTA');
    if (!container) return;

    if (userTier === 'guest') {
        // Already shown in recommendations section
        return;
    }

    if (userTier === 'free') {
        container.innerHTML = `
            <div class="bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg p-8 text-center">
                <h3 class="text-2xl font-bold mb-4">Upgrade to DIY Starter</h3>
                <p class="mb-6">Get 5-page deep scans, personalized code, and daily recommendation unlocks</p>
                <a href="checkout.html?plan=diy" class="inline-block px-8 py-3 bg-white text-purple-600 font-bold rounded-full hover:bg-gray-100 transition-all">
                    Upgrade to DIY - $29/month →
                </a>
            </div>
        `;
        container.classList.remove('hidden');
    } else if (userTier === 'diy') {
        container.innerHTML = `
            <div class="bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg p-8 text-center">
                <h3 class="text-2xl font-bold mb-4">Coming Soon: Pro Tier</h3>
                <p class="mb-6">Triple Score Analysis: AI Visibility + Brand Visibility + Competitive Analysis</p>
                <a href="waitlist.html?plan=pro" class="inline-block px-8 py-3 bg-white text-purple-600 font-bold rounded-full hover:bg-gray-100 transition-all">
                    Join Pro Waitlist - $99/month →
                </a>
            </div>
        `;
        container.classList.remove('hidden');
    }
}

function createRecommendationCard(rec, index, userPlan, isSkipped = false) {
    const card = document.createElement('div');
    card.className = 'recommendation-card';
    card.id = `rec-${index}`;

    // Check if implemented or skipped
    const isImplemented = rec.status === 'implemented';

    // Check if skip is enabled (5 days after unlock)
    const now = new Date();
    const skipEnabledAt = rec.skip_enabled_at ? new Date(rec.skip_enabled_at) : null;
    const canSkip = !isSkipped && !isImplemented && (!skipEnabledAt || skipEnabledAt <= now);
    const daysUntilSkip = skipEnabledAt && skipEnabledAt > now
        ? Math.ceil((skipEnabledAt - now) / (1000 * 60 * 60 * 24))
        : 0;

    // Use the correct field names from API
    const title = rec.recommendation_text || rec.title || 'Recommendation';
    const subcategory = rec.subcategory || '';
    const finding = rec.findings || rec.finding || '';
    const impact = rec.impact_description || rec.impact || '';
    const actionSteps = rec.action_steps || rec.actionSteps || [];
    const codeSnippet = rec.code_snippet || rec.codeSnippet || '';
    const estimatedImpact = rec.estimated_impact || rec.estimatedScoreGain || 0;
    const effort = rec.estimated_effort || rec.effort || '';

    // NEW STRUCTURED FIELDS
    const customizedImplementation = rec.customized_implementation || rec.customizedImplementation || '';
    const readyToUseContent = rec.ready_to_use_content || rec.readyToUseContent || '';
    const implementationNotes = rec.implementation_notes || rec.implementationNotes || [];
    const quickWins = rec.quick_wins || rec.quickWins || [];
    const validationChecklist = rec.validation_checklist || rec.validationChecklist || [];

    // Convert numeric priority to text label
    const rawPriority = rec.priority != null ? rec.priority : 'medium';
    const priority = getPriorityLabel(rawPriority);
    const priorityBadgeClass = getPriorityBadgeClass(priority);

    // Delivery System fields
    const impactScore = rec.impact_score || null;
    const implementationDifficulty = rec.implementation_difficulty || null;
    const compoundingEffect = rec.compounding_effect_score || 0;
    const industryRelevance = rec.industry_relevance_score || 0;
    const isPartialImplementation = rec.is_partial_implementation || false;
    const implementationProgress = rec.implementation_progress || 0;
    const validationStatus = rec.validation_status || null;

    const showCodeSnippet = userPlan !== 'free' && codeSnippet;

    card.innerHTML = `
        <div class="rec-header" onclick="toggleAccordion(${index})">
            <div class="${priorityBadgeClass}">
                ${priority.toUpperCase()}
            </div>
            <div class="rec-title-section">
                <div class="rec-title">${title}</div>
                <div class="rec-category">${formatCategoryName(rec.category)}${subcategory ? ` → ${subcategory}` : ''}</div>
            </div>
            <div class="rec-metrics-section">
                ${impactScore ? `
                    <div class="rec-metric">
                        <div class="rec-metric-value score-gain" style="font-size: 18px; font-weight: bold; color: #10b981;">★ ${Math.round(impactScore)}</div>
                        <div class="rec-metric-label">Impact Score</div>
                    </div>
                ` : estimatedImpact ? `
                    <div class="rec-metric">
                        <div class="rec-metric-value score-gain">+${Math.round(estimatedImpact * 10)}</div>
                        <div class="rec-metric-label">Score Gain</div>
                    </div>
                ` : ''}
                ${implementationDifficulty ? `
                    <div class="rec-metric">
                        <div class="rec-metric-value effort">${implementationDifficulty}</div>
                        <div class="rec-metric-label">Difficulty</div>
                    </div>
                ` : effort ? `
                    <div class="rec-metric">
                        <div class="rec-metric-value effort">${effort}</div>
                        <div class="rec-metric-label">Effort</div>
                    </div>
                ` : ''}
                ${compoundingEffect > 0 ? `
                    <div class="rec-metric">
                        <div class="rec-metric-value" style="color: var(--purple);">🔄 ${Math.round(compoundingEffect)}</div>
                        <div class="rec-metric-label">Compound</div>
                    </div>
                ` : ''}
            </div>
            <div class="expand-icon">▼</div>
        </div>

        <div class="rec-body">
            ${(finding || impact) ? `
                <div class="rec-description">
                    ${finding ? `<p><strong>🔍 Finding:</strong> ${renderMarkdown(finding)}</p>` : ''}
                    ${impact ? `<p style="margin-top: ${finding ? '15px' : '0'};"><strong>💡 Why It Matters:</strong> ${renderMarkdown(impact)}</p>` : ''}
                </div>
            ` : ''}

            ${actionSteps && actionSteps.length > 0 ? `
                <div class="action-steps">
                    <div class="action-steps-title">How to Implement</div>
                    ${actionSteps.map((step, idx) => `
                        <div class="action-step">
                            <div class="step-number">${idx + 1}</div>
                            <div class="step-content">
                                <div class="step-text">${step}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            ${customizedImplementation && userPlan !== 'free' ? `
                <div style="background: #dbeafe; border-left: 4px solid #3b82f6; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                    <h4 style="font-size: 16px; font-weight: 700; color: #2d3748; margin-bottom: 12px;">🎯 Customized Implementation</h4>
                    <div style="font-size: 14px; line-height: 1.7; color: #4a5568;">
                        ${renderMarkdown(customizedImplementation)}
                    </div>
                </div>
            ` : ''}

            ${readyToUseContent && userPlan !== 'free' ? `
                <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                    <h4 style="font-size: 16px; font-weight: 700; color: #2d3748; margin-bottom: 12px;">📝 Ready-to-Use Content</h4>
                    <div style="position: relative;">
                        <pre style="background: white; border: 1px solid #a7f3d0; padding: 15px; border-radius: 8px; overflow-x: auto; font-size: 13px; white-space: pre-wrap; font-family: -apple-system, system-ui; color: #2d3748;"><code id="ready-content-${index}">${escapeHtml(readyToUseContent)}</code></pre>
                        <button class="copy-btn" data-target="ready-content-${index}" style="position: absolute; top: 8px; right: 8px; padding: 6px 12px; background: #10b981; color: white; border-radius: 6px; font-size: 11px; border: none; cursor: pointer;">
                            Copy
                        </button>
                    </div>
                </div>
            ` : ''}

            ${showCodeSnippet ? `
                <div style="background: #1f2937; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                    <h4 style="font-size: 16px; font-weight: 700; color: white; margin-bottom: 12px;">💻 Implementation Code</h4>
                    <div style="position: relative;">
                        <pre style="background: #111827; color: #e5e7eb; padding: 15px; border-radius: 8px; overflow-x: auto; font-size: 13px;"><code id="code-${index}">${escapeHtml(codeSnippet)}</code></pre>
                        <button class="copy-btn" data-target="code-${index}" style="position: absolute; top: 8px; right: 8px; padding: 6px 12px; background: #3b82f6; color: white; border-radius: 6px; font-size: 11px; border: none; cursor: pointer;">
                            Copy
                        </button>
                    </div>
                </div>
            ` : ''}

            ${implementationNotes && implementationNotes.length > 0 && userPlan !== 'free' ? `
                <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                    <h4 style="font-size: 16px; font-weight: 700; color: #2d3748; margin-bottom: 12px;">📌 Implementation Notes</h4>
                    <ul style="list-style: none; padding: 0;">
                        ${implementationNotes.map(note => `
                            <li style="margin-bottom: 10px; padding-left: 20px; position: relative; color: #4a5568; line-height: 1.6;">
                                <span style="position: absolute; left: 0; color: #f59e0b;">•</span>
                                ${note}
                            </li>
                        `).join('')}
                    </ul>
                </div>
            ` : ''}

            ${quickWins && quickWins.length > 0 && userPlan !== 'free' ? `
                <div style="background: #e9d5ff; border-left: 4px solid #a855f7; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                    <h4 style="font-size: 16px; font-weight: 700; color: #2d3748; margin-bottom: 12px;">⚡ Quick Wins</h4>
                    <ol style="list-style: none; padding: 0;">
                        ${quickWins.map((win, idx) => `
                            <li style="margin-bottom: 10px; padding-left: 25px; position: relative; color: #4a5568; line-height: 1.6;">
                                <span style="position: absolute; left: 0; color: #a855f7; font-weight: 600;">${idx + 1}.</span>
                                ${win}
                            </li>
                        `).join('')}
                    </ol>
                </div>
            ` : ''}

            ${validationChecklist && validationChecklist.length > 0 && userPlan !== 'free' ? `
                <div style="background: var(--purple-light); border-left: 4px solid var(--purple); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                    <h4 style="font-size: 16px; font-weight: 700; color: var(--gray-800); margin-bottom: 12px;">✓ Validation Checklist</h4>
                    <ul style="list-style: none; padding: 0;">
                        ${validationChecklist.map(item => `
                            <li style="margin-bottom: 10px; display: flex; align-items: start; color: #4a5568; line-height: 1.6;">
                                <input type="checkbox" style="margin-top: 4px; margin-right: 12px; width: 16px; height: 16px;">
                                <span>${item}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            ` : ''}

            ${isPartialImplementation && implementationProgress > 0 ? `
                <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #78350f; margin-bottom: 8px;">⚙️ Partial Implementation Detected</h4>
                    <p style="font-size: 13px; color: #92400e; margin-bottom: 10px;">This recommendation is ${Math.round(implementationProgress)}% complete</p>
                    <div style="width: 100%; background: #fde68a; border-radius: 9999px; height: 10px;">
                        <div style="background: #d97706; height: 10px; border-radius: 9999px; width: ${implementationProgress}%"></div>
                    </div>
                </div>
            ` : ''}

            ${validationStatus === 'validation_failed' ? `
                <div style="background: #fee2e2; border-left: 4px solid #dc2626; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #7f1d1d; margin-bottom: 8px;">⚠️ Validation Issues Detected</h4>
                    <p style="font-size: 13px; color: #991b1b;">The implementation needs attention. Please review and fix any errors.</p>
                </div>
            ` : validationStatus === 'validated' ? `
                <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #065f46;">✓ Implementation Validated</h4>
                    <p style="font-size: 13px; color: #047857;">This implementation has been verified and is working correctly.</p>
                </div>
            ` : ''}

            <div style="padding-top: 20px; border-top: 2px solid #f0f4f8; display: flex; gap: 12px; flex-wrap: wrap;">
                ${isImplemented ? `
                    <div style="padding: 10px 16px; background: #d1fae5; color: #065f46; border-radius: 8px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                        <span>✓</span>
                        <span>Implemented on ${new Date(rec.implemented_at).toLocaleDateString()}</span>
                    </div>
                ` : !isSkipped ? `
                    <button class="mark-implemented-btn" data-rec-id="${rec.id || index}" style="padding: 10px 16px; background: #d1fae5; color: #065f46; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; transition: background 0.3s;">
                        ✓ Mark as Implemented
                    </button>
                    ${canSkip ? `
                        <button class="skip-rec-btn" data-rec-id="${rec.id || index}" data-days-until-skip="0" style="padding: 10px 16px; background: #f3f4f6; color: #374151; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; transition: background 0.3s;">
                            ⊘ Skip
                        </button>
                    ` : daysUntilSkip > 0 ? `
                        <button class="skip-rec-btn" data-rec-id="${rec.id || index}" data-days-until-skip="${daysUntilSkip}" style="padding: 10px 16px; background: #f3f4f6; color: #374151; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; transition: background 0.3s;">
                            ⊘ Skip (${daysUntilSkip}d)
                        </button>
                    ` : ''}
                ` : `
                    <div style="padding: 10px 16px; background: #e5e7eb; color: #4b5563; border-radius: 8px; font-weight: 600;">
                        ⊘ Skipped on ${new Date(rec.skipped_at).toLocaleDateString()}
                    </div>
                `}
            </div>

            ${createFeedbackWidget(
                `${rec.category || 'general'}_${rec.id || index}`,
                rec.category || 'general',
                scanId
            )}
        </div>
    `;

    return card;
}

function displayFAQSection(faqData) {
    const faqSection = document.getElementById('faqSection');
    if (!faqSection) return;

    faqSection.classList.remove('hidden');
    const container = document.getElementById('faqList');
    container.innerHTML = '';

    // Display FAQ cards
    if (faqData.faqs && faqData.faqs.length > 0) {
        faqData.faqs.forEach((faq, index) => {
            const faqCard = document.createElement('div');
            faqCard.className = 'bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow';
            faqCard.innerHTML = `
                <div class="flex items-start gap-3">
                    <span class="text-2xl flex-shrink-0">❓</span>
                    <div class="flex-1">
                        <h4 class="font-bold text-lg text-gray-900 mb-2">${faq.question}</h4>
                        <p class="text-gray-700 leading-relaxed">${faq.answer_human_friendly?.text || faq.answer}</p>
                    </div>
                </div>
            `;
            container.appendChild(faqCard);
        });
    }

    // Display schema code
    if (faqData.fullSchemaCode) {
        const schemaContainer = document.getElementById('schemaCode');
        schemaContainer.innerHTML = `
            <div class="bg-white rounded-lg shadow-md p-6">
                <div class="flex items-center justify-between mb-4">
                    <h4 class="font-bold text-lg">📋 Complete FAQ Schema Code</h4>
                    <button class="copy-schema-btn px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold">
                        Copy Schema
                    </button>
                </div>
                <textarea id="schemaCodeText" readonly
                          class="w-full h-64 p-4 bg-gray-900 text-gray-100 rounded-lg font-mono text-sm resize-none">${escapeHtml(faqData.fullSchemaCode)}</textarea>
                <div class="mt-4 p-4 bg-blue-50 rounded-lg">
                    <p class="text-sm text-gray-700">
                        <strong>Implementation:</strong> Copy the code above and paste it into the <code class="bg-gray-200 px-2 py-1 rounded">&lt;head&gt;</code> 
                        section of your website. This structured data helps AI search engines understand your content better.
                    </p>
                </div>
            </div>
        `;

        // Attach copy button listener for FAQ schema
        console.log('📋 Setting up FAQ schema copy button');
        const schemaButton = schemaContainer.querySelector('.copy-schema-btn');
        if (schemaButton) {
            schemaButton.removeEventListener('click', schemaButton._schemaHandler);
            schemaButton._schemaHandler = async function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('🖱️ FAQ Schema copy button clicked!');
                await copySchemaCode();
            };
            schemaButton.addEventListener('click', schemaButton._schemaHandler);
            console.log('✅ FAQ schema button listener attached');
        }
    }
}

function displayUpgradeCTA(upgradeData, userPlan) {
    const upgradeSection = document.getElementById('upgradeSection');
    if (!upgradeSection || !upgradeData.show) return;

    upgradeSection.classList.remove('hidden');
    
    let ctaContent = '';

    if (upgradeData.comingSoon) {
        // Premium/Agency - Coming Soon
        ctaContent = `
            <div class="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl shadow-lg p-8 border-2 border-purple-200">
                <div class="flex items-start justify-between mb-4">
                    <div>
                        <span class="inline-block px-3 py-1 bg-yellow-400 text-yellow-900 rounded-full text-xs font-bold mb-3">
                            COMING SOON
                        </span>
                        <h3 class="text-2xl font-bold text-gray-900 mb-2">${upgradeData.title || 'Premium Plan'}</h3>
                        <p class="text-gray-700">${upgradeData.subtitle || 'Advanced AI visibility analysis for growing businesses'}</p>
                    </div>
                    <div class="text-right">
                        <div class="text-4xl font-bold text-purple-600">$99</div>
                        <div class="text-sm text-gray-600">/month</div>
                    </div>
                </div>
                
                ${upgradeData.benefits && upgradeData.benefits.length > 0 ? `
                    <div class="mb-6">
                        <h4 class="font-bold text-gray-800 mb-3">What's Included:</h4>
                        <ul class="grid md:grid-cols-2 gap-2">
                            ${upgradeData.benefits.map(benefit => `
                                <li class="flex items-center gap-2 text-gray-700">
                                    <span class="text-green-600">✓</span>
                                    <span>${benefit}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                ` : ''}

                <div class="flex gap-4">
                    <a href="/waitlist.html?plan=premium" 
                       class="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg font-semibold text-center hover:from-purple-700 hover:to-indigo-700 transition-all">
                        Join Waitlist - Get Notified
                    </a>
                    <button onclick="document.getElementById('upgradeSection').classList.add('hidden')" 
                            class="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-colors">
                        Maybe Later
                    </button>
                </div>
            </div>
        `;
    } else {
        // DIY Upgrade (for free users)
        ctaContent = `
            <div class="bg-gradient-to-br from-blue-50 to-teal-50 rounded-xl shadow-lg p-8 border-2 border-blue-200">
                <h3 class="text-2xl font-bold text-gray-900 mb-2">Unlock Full AI Visibility Analysis</h3>
                <p class="text-gray-700 mb-4">Get detailed recommendations, FAQ generation, and unlimited scans</p>
                
                <div class="mb-6">
                    <div class="flex items-baseline gap-2 mb-4">
                        <span class="text-4xl font-bold text-blue-600">$29</span>
                        <span class="text-gray-600">/month</span>
                    </div>
                    <ul class="space-y-2">
                        <li class="flex items-center gap-2 text-gray-700">
                            <span class="text-green-600">✓</span>
                            <span>Track 5 specific pages with unlimited scans</span>
                        </li>
                        <li class="flex items-center gap-2 text-gray-700">
                            <span class="text-green-600">✓</span>
                            <span>15+ detailed recommendations per scan</span>
                        </li>
                        <li class="flex items-center gap-2 text-gray-700">
                            <span class="text-green-600">✓</span>
                            <span>Custom FAQ generation with schema code</span>
                        </li>
                        <li class="flex items-center gap-2 text-gray-700">
                            <span class="text-green-600">✓</span>
                            <span>PDF export and progress tracking</span>
                        </li>
                    </ul>
                </div>

                <a href="checkout.html?url=${encodeURIComponent(document.getElementById('scanUrl')?.textContent || '')}" 
                   class="block w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-teal-600 text-white rounded-lg font-semibold text-center hover:from-blue-700 hover:to-teal-700 transition-all">
                    Upgrade to DIY Starter - $29/month
                </a>
            </div>
        `;
    }

    upgradeSection.innerHTML = ctaContent;
}

// Helper Functions
function toggleRecommendation(index) {
    const content = document.getElementById(`content-${index}`);
    const toggle = document.getElementById(`toggle-${index}`);

    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        toggle.textContent = 'Collapse ▲';

        // Track expansion (implicit engagement signal)
        if (typeof startTrackingTime === 'function') {
            startTrackingTime(`rec-${index}`);
        }
        if (typeof trackInteraction === 'function') {
            trackInteraction(`rec-${index}`, scanId, { expanded: true });
        }
    } else {
        content.classList.add('hidden');
        toggle.textContent = 'Expand ▼';

        // Track time spent when collapsing
        if (typeof stopTrackingTime === 'function') {
            stopTrackingTime(`rec-${index}`, scanId);
        }
    }
}

async function copyCode(elementId) {
    console.log('🔍 copyCode called with elementId:', elementId);

    const codeElement = document.getElementById(elementId);
    if (!codeElement) {
        console.error('❌ Code element not found:', elementId);
        showNotification('Failed to copy code - element not found', 'error');
        return;
    }

    console.log('✅ Code element found:', codeElement);

    try {
        // Try modern clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(codeElement.textContent);
            showNotification('Code copied to clipboard!', 'success');
        } else {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = codeElement.textContent;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            document.body.appendChild(textArea);
            textArea.select();

            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);

            if (successful) {
                showNotification('Code copied to clipboard!', 'success');
            } else {
                throw new Error('Copy command failed');
            }
        }

        // Track code copy interaction
        const recIndex = elementId.match(/\d+/)?.[0];
        if (recIndex && typeof trackCodeCopy === 'function') {
            trackCodeCopy(`rec-${recIndex}`, scanId);
        }
    } catch (error) {
        console.error('Copy failed:', error);
        showNotification('Failed to copy code. Please try selecting and copying manually.', 'error');
    }
}

async function copySchemaCode() {
    const schemaText = document.getElementById('schemaCodeText');
    if (!schemaText) {
        console.error('Schema code element not found');
        showNotification('Failed to copy schema - element not found', 'error');
        return;
    }

    try {
        // Try modern clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(schemaText.textContent || schemaText.value);
            showNotification('Schema code copied to clipboard!', 'success');
        } else {
            // Fallback for older browsers
            schemaText.select();
            const successful = document.execCommand('copy');

            if (successful) {
                showNotification('Schema code copied to clipboard!', 'success');
            } else {
                throw new Error('Copy command failed');
            }
        }
    } catch (error) {
        console.error('Copy schema failed:', error);
        showNotification('Failed to copy schema. Please try selecting and copying manually.', 'error');
    }
}

// Show notification helper
function showNotification(message, type = 'info') {
    const notificationDiv = document.createElement('div');
    const colors = {
        success: 'bg-green-100 border-green-500 text-green-700',
        error: 'bg-red-100 border-red-500 text-red-700',
        info: 'bg-blue-100 border-blue-500 text-blue-700',
        warning: 'bg-yellow-100 border-yellow-500 text-yellow-700'
    };

    notificationDiv.className = `fixed top-4 right-4 ${colors[type]} border-l-4 p-4 rounded shadow-lg z-50`;
    notificationDiv.style.maxWidth = '400px';
    notificationDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: bold;">${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(notificationDiv);
    setTimeout(() => notificationDiv.remove(), 5000);
}

// Show Xeo-branded alert modal helper (for success/info/error messages)
function showAlertModal(title, message, type = 'info') {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;';

        // Icon based on type
        const icons = {
            success: '✅',
            error: '❌',
            info: 'ℹ️',
            warning: '⚠️'
        };

        const icon = icons[type] || icons.info;

        modal.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 12px; max-width: 450px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); animation: slideDown 0.3s ease-out;">
                <div style="display: flex; align-items: flex-start; gap: 15px; margin-bottom: 20px;">
                    <span style="font-size: 28px; line-height: 1;">${icon}</span>
                    <div style="flex: 1;">
                        <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 10px; color: #2d3748;">${title}</h3>
                        <p style="color: #4a5568; line-height: 1.6; white-space: pre-line;">${message}</p>
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end;">
                    <button id="okBtn" style="padding: 12px 30px; border-radius: 8px; border: none; background: linear-gradient(135deg, var(--purple) 0%, var(--pink) 100%); color: white; font-weight: 600; cursor: pointer; font-size: 15px; transition: transform 0.2s;">
                        OK
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const okBtn = modal.querySelector('#okBtn');
        okBtn.onclick = () => {
            modal.remove();
            resolve(true);
        };

        // Hover effect for OK button
        okBtn.onmouseenter = () => okBtn.style.transform = 'scale(1.05)';
        okBtn.onmouseleave = () => okBtn.style.transform = 'scale(1)';

        // Close on backdrop click
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(true);
            }
        };

        // Close on Enter key
        const handleEnter = (e) => {
            if (e.key === 'Enter') {
                modal.remove();
                resolve(true);
                document.removeEventListener('keydown', handleEnter);
            }
        };
        document.addEventListener('keydown', handleEnter);
    });
}

// Show confirm modal helper
function showConfirmModal(title, message) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;';

        modal.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 12px; max-width: 400px; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
                <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 15px; color: #2d3748;">${title}</h3>
                <p style="color: #4a5568; margin-bottom: 25px; line-height: 1.6;">${message}</p>
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button id="cancelBtn" style="padding: 10px 20px; border-radius: 8px; border: 2px solid #e2e8f0; background: white; color: #4a5568; font-weight: 600; cursor: pointer;">
                        Cancel
                    </button>
                    <button id="confirmBtn" style="padding: 10px 20px; border-radius: 8px; border: none; background: linear-gradient(135deg, var(--purple) 0%, var(--pink) 100%); color: white; font-weight: 600; cursor: pointer;">
                        Confirm
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#confirmBtn').onclick = () => {
            modal.remove();
            resolve(true);
        };

        modal.querySelector('#cancelBtn').onclick = () => {
            modal.remove();
            resolve(false);
        };

        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(false);
            }
        };
    });
}

// Show detailed "Mark as Implemented" modal
function showImplementedModal() {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; overflow-y: auto; padding: 20px;';

        modal.innerHTML = `
            <div style="background: white; padding: 35px; border-radius: 12px; max-width: 450px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,0.3); margin: auto;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                    <span style="font-size: 32px;">✅</span>
                    <h3 style="font-size: 24px; font-weight: 700; color: #2d3748; margin: 0;">Mark as Implemented</h3>
                </div>

                <p style="color: #4a5568; margin-bottom: 30px; line-height: 1.6;">
                    Are you sure you want to mark this recommendation as implemented? It will be moved to your Dashboard → Implementation Progress section.
                </p>

                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button id="cancelBtn" style="padding: 12px 24px; border-radius: 8px; border: 2px solid #e2e8f0; background: white; color: #4a5568; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                        onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='white'">
                        Cancel
                    </button>
                    <button id="confirmBtn" style="padding: 12px 24px; border-radius: 8px; border: none; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(16, 185, 129, 0.3)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
                        Mark as Implemented
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const confirmBtn = modal.querySelector('#confirmBtn');
        const cancelBtn = modal.querySelector('#cancelBtn');

        confirmBtn.onclick = () => {
            const data = {
                implemented: true
            };
            modal.remove();
            resolve(data);
        };

        cancelBtn.onclick = () => {
            modal.remove();
            resolve(null);
        };

        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(null);
            }
        };
    });
}

// Show detailed "Skip Recommendation" modal
function showSkipModal(daysRemaining = 0) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; overflow-y: auto; padding: 20px;';

        const canSkipNow = daysRemaining === 0;
        const title = canSkipNow ? 'Skip Recommendation' : 'Skip Not Yet Available';
        const icon = canSkipNow ? '⏸️' : '⏳';
        const messageText = canSkipNow
            ? 'Are you sure you want to skip this recommendation? It will be moved to your Dashboard → Implementation Progress section.'
            : `You can skip this recommendation in <strong>${daysRemaining} day${daysRemaining > 1 ? 's' : ''}</strong>.<br><br>This waiting period helps ensure you've had time to consider implementing the recommendation.`;

        modal.innerHTML = `
            <div style="background: white; padding: 35px; border-radius: 12px; max-width: 450px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,0.3); margin: auto;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                    <span style="font-size: 32px;">${icon}</span>
                    <h3 style="font-size: 24px; font-weight: 700; color: #2d3748; margin: 0;">${title}</h3>
                </div>

                <p style="color: #4a5568; margin-bottom: 30px; line-height: 1.6;">
                    ${messageText}
                </p>

                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    ${canSkipNow ? `
                        <button id="cancelBtn" style="padding: 12px 24px; border-radius: 8px; border: 2px solid #e2e8f0; background: white; color: #4a5568; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                            onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='white'">
                            Cancel
                        </button>
                        <button id="confirmBtn" style="padding: 12px 24px; border-radius: 8px; border: none; background: linear-gradient(135deg, #64748b 0%, #475569 100%); color: white; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                            onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(100, 116, 139, 0.3)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
                            Skip
                        </button>
                    ` : `
                        <button id="closeBtn" style="padding: 12px 24px; border-radius: 8px; border: none; background: linear-gradient(135deg, #00B9DA 0%, #f31c7e 100%); color: white; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                            onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(0, 185, 218, 0.3)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
                            Got It
                        </button>
                    `}
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        if (canSkipNow) {
            const confirmBtn = modal.querySelector('#confirmBtn');
            const cancelBtn = modal.querySelector('#cancelBtn');

            confirmBtn.onclick = () => {
                const data = {
                    skipped: true
                };
                modal.remove();
                resolve(data);
            };

            cancelBtn.onclick = () => {
                modal.remove();
                resolve(null);
            };
        } else {
            const closeBtn = modal.querySelector('#closeBtn');
            closeBtn.onclick = () => {
                modal.remove();
                resolve(null);
            };
        }

        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(null);
            }
        };
    });
}

// Make functions globally accessible
window.copyCode = copyCode;
window.copySchemaCode = copySchemaCode;

window.markImplemented = async function(recId) {
    console.log('Marking recommendation as implemented:', recId);

    if (!authToken) {
        showNotification('You must be logged in to mark recommendations as implemented.', 'info');
        return;
    }

    // Show detailed implementation modal
    const implementationData = await showImplementedModal();

    if (!implementationData) {
        return; // User cancelled
    }

    try {
        const response = await fetch(`${API_BASE_URL}/scan/${scanId}/recommendation/${recId}/feedback`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: 'implemented',
                feedback: JSON.stringify(implementationData)
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Recommendation marked as implemented!', 'success');
            // Reload page after 2 seconds to update UI
            setTimeout(() => window.location.reload(), 2000);
        } else {
            showNotification(data.error || 'Failed to mark as implemented', 'error');
        }
    } catch (error) {
        console.error('Mark implemented error:', error);
        showNotification('Failed to mark recommendation as implemented. Please try again.', 'error');
    }
}

window.skipRecommendation = async function(recId, daysUntilSkip = 0) {
    console.log('Skipping recommendation:', recId, 'Days until skip:', daysUntilSkip);

    if (!authToken) {
        await showAlertModal('Login Required', 'You must be logged in to skip recommendations.', 'info');
        return;
    }

    // Show detailed skip modal with days remaining
    const skipData = await showSkipModal(daysUntilSkip);

    if (!skipData) {
        return; // User cancelled or just acknowledged the countdown
    }

    // Only proceed with API call if skip is confirmed and allowed
    if (daysUntilSkip > 0) {
        // This shouldn't happen since the modal won't return data if days > 0
        // But keep it as a safety check
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/scan/${scanId}/recommendation/${recId}/skip`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                skipData: JSON.stringify(skipData)
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');
            // Reload page after 2 seconds to update UI
            setTimeout(() => window.location.reload(), 2000);
        } else {
            // If backend returns error (e.g., days remaining changed), show the actual message
            if (data.daysRemaining && data.daysRemaining > 0) {
                await showSkipModal(data.daysRemaining);
            } else {
                const errorMsg = data.message ? `${data.error}: ${data.message}` : (data.error || 'Failed to skip recommendation');
                await showAlertModal('Cannot Skip Yet', errorMsg, 'warning');
            }
        }
    } catch (error) {
        console.error('Skip error:', error);
        await showAlertModal('Error', 'Failed to skip recommendation. Please try again.', 'error');
    }
}

function formatCategoryName(key) {
    return categoryNames[key] || key.replace(/([A-Z])/g, ' $1').trim();
}

function getScoreColor(score) {
    if (score >= 750) return 'text-green-600';
    if (score >= 500) return 'text-yellow-600';
    return 'text-red-600';
}

function getScoreBarColor(score) {
    if (score >= 750) return 'bg-green-500';
    if (score >= 500) return 'bg-yellow-500';
    return 'bg-red-500';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Simple markdown renderer for customizedImplementation
function renderMarkdown(markdown) {
    if (!markdown) return '';

    let html = markdown
        // Headers
        .replace(/^### (.*$)/gim, '<h3 class="text-lg font-bold mt-4 mb-2">$1</h3>')
        .replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold mt-6 mb-3">$1</h2>')
        .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-6 mb-4">$1</h1>')

        // Bold
        .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')

        // Code blocks
        .replace(/```html\n([\s\S]*?)\n```/gim, '<pre class="bg-gray-900 text-gray-100 p-3 rounded my-2 overflow-x-auto text-xs"><code>$1</code></pre>')
        .replace(/```([\s\S]*?)```/gim, '<pre class="bg-gray-900 text-gray-100 p-3 rounded my-2 overflow-x-auto text-xs"><code>$1</code></pre>')

        // Inline code
        .replace(/`([^`]+)`/gim, '<code class="bg-gray-200 px-2 py-1 rounded text-sm">$1</code>')

        // Horizontal rules
        .replace(/^---$/gim, '<hr class="my-4 border-gray-300">')

        // Paragraphs (simple - just add breaks for double newlines)
        .replace(/\n\n/gim, '<br><br>')
        .replace(/\n/gim, '<br>');

    return html;
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'fixed top-4 right-4 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded shadow-lg z-50';
    errorDiv.innerHTML = `
        <div class="flex items-center gap-2">
            <span class="font-bold">Error:</span>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

// Show progress summary
function showProgressSummary() {
    const urlParams = new URLSearchParams(window.location.search);
    const currentScanId = urlParams.get('scanId');

    if (!currentScanId) {
        showNotification('No scan data available to show progress.', 'info');
        return;
    }

    // Get the current scan data from the page
    fetch(`${API_BASE_URL}/scan/${currentScanId}`, {
        headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success || !data.scan.userProgress) {
            showNotification('Unable to load progress data. This feature is available for authenticated users with DIY or Pro plans.', 'info');
            return;
        }

        const progress = data.scan.userProgress;
        const total = progress.total_recommendations || 0;
        const active = progress.active_recommendations || 0;
        const completed = progress.completed_recommendations || 0;
        const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

        const progressMessage = `
Progress Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Total Recommendations: ${total}
🔓 Active Recommendations: ${active}
✅ Completed: ${completed}
📈 Progress: ${percentComplete}%

Keep up the great work! Each implementation improves your AI visibility score.
        `.trim();

        showNotification(progressMessage, 'success');
    })
    .catch(error => {
        console.error('Error loading progress:', error);
        showNotification('Failed to load progress data. Please try again.', 'error');
    });
}

// Create feedback widget with thumbs up/down → 5-star → comment flow
function createFeedbackWidget(widgetId, category, scanId) {
    const uniqueId = `feedback-${widgetId.replace(/[^a-zA-Z0-9]/g, '-')}`;

    return `
        <div id="${uniqueId}" style="margin-top: 20px; padding: 20px; background: #f7fafc; border-radius: 8px; border-top: 2px solid #e2e8f0;">
            <div id="${uniqueId}-initial" style="text-align: center;">
                <p style="font-size: 14px; font-weight: 600; color: #4a5568; margin-bottom: 12px;">Was this recommendation helpful?</p>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button onclick="handleFeedbackThumb('${uniqueId}', '${category}', '${scanId}', true)"
                            style="padding: 10px 20px; border-radius: 8px; border: 2px solid #10b981; background: white; color: #10b981; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.3s;"
                            onmouseover="this.style.background='#10b981'; this.style.color='white';"
                            onmouseout="this.style.background='white'; this.style.color='#10b981';">
                        <span style="font-size: 18px;">👍</span> Helpful
                    </button>
                    <button onclick="handleFeedbackThumb('${uniqueId}', '${category}', '${scanId}', false)"
                            style="padding: 10px 20px; border-radius: 8px; border: 2px solid #ef4444; background: white; color: #ef4444; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.3s;"
                            onmouseover="this.style.background='#ef4444'; this.style.color='white';"
                            onmouseout="this.style.background='white'; this.style.color='#ef4444';">
                        <span style="font-size: 18px;">👎</span> Not Helpful
                    </button>
                </div>
            </div>

            <div id="${uniqueId}-rating" style="display: none; text-align: center;">
                <p style="font-size: 14px; font-weight: 600; color: #4a5568; margin-bottom: 12px;">How would you rate this recommendation?</p>
                <div style="display: flex; gap: 8px; justify-content: center; margin-bottom: 15px;">
                    ${[1, 2, 3, 4, 5].map(star => `
                        <button onclick="handleFeedbackRating('${uniqueId}', '${category}', '${scanId}', ${star})"
                                style="background: none; border: none; cursor: pointer; font-size: 32px; transition: transform 0.2s;"
                                onmouseover="this.style.transform='scale(1.2)';"
                                onmouseout="this.style.transform='scale(1)';">
                            ⭐
                        </button>
                    `).join('')}
                </div>
            </div>

            <div id="${uniqueId}-comment" style="display: none;">
                <p style="font-size: 14px; font-weight: 600; color: #4a5568; margin-bottom: 12px;">How can we improve this recommendation?</p>
                <textarea id="${uniqueId}-comment-text"
                          placeholder="Share your thoughts on how we can make this recommendation more helpful..."
                          style="width: 100%; min-height: 100px; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 14px; font-family: inherit; resize: vertical;"></textarea>
                <div style="display: flex; gap: 10px; margin-top: 12px; justify-content: flex-end;">
                    <button onclick="skipFeedbackComment('${uniqueId}', '${category}', '${scanId}')"
                            style="padding: 8px 16px; border-radius: 6px; border: 2px solid #e2e8f0; background: white; color: #4a5568; font-weight: 600; cursor: pointer;">
                        Skip
                    </button>
                    <button onclick="submitFeedbackComment('${uniqueId}', '${category}', '${scanId}')"
                            style="padding: 8px 16px; border-radius: 6px; border: none; background: linear-gradient(135deg, var(--purple) 0%, var(--pink) 100%); color: white; font-weight: 600; cursor: pointer;">
                        Submit Feedback
                    </button>
                </div>
            </div>

            <div id="${uniqueId}-thanks" style="display: none; text-align: center; color: #10b981; font-weight: 600;">
                ✓ Thank you for your feedback!
            </div>
        </div>
    `;
}

// Handle thumbs up/down feedback
window.handleFeedbackThumb = function(widgetId, category, scanId, isHelpful) {
    console.log('Feedback thumb:', { widgetId, category, scanId, isHelpful });

    const widget = document.getElementById(widgetId);
    if (!widget) return;

    // Store whether it was helpful or not
    widget.dataset.helpful = isHelpful;

    // Hide initial thumbs
    const initial = document.getElementById(`${widgetId}-initial`);
    if (initial) initial.style.display = 'none';

    // Always show rating section for both helpful and not helpful
    const rating = document.getElementById(`${widgetId}-rating`);
    if (rating) rating.style.display = 'block';
}

// Handle star rating feedback
window.handleFeedbackRating = function(widgetId, category, scanId, rating) {
    console.log('Feedback rating:', { widgetId, category, scanId, rating });

    const widget = document.getElementById(widgetId);
    if (!widget) return;

    // Store rating temporarily
    widget.dataset.rating = rating;

    const wasHelpful = widget.dataset.helpful === 'true';

    // Hide rating section
    const ratingDiv = document.getElementById(`${widgetId}-rating`);
    if (ratingDiv) ratingDiv.style.display = 'none';

    // If rating is low (1-3) or was marked as not helpful, show comment section
    // Otherwise, just submit and show thank you
    if (!wasHelpful || rating <= 3) {
        const comment = document.getElementById(`${widgetId}-comment`);
        if (comment) comment.style.display = 'block';
    } else {
        // High rating and helpful - just submit and thank
        const thanks = document.getElementById(`${widgetId}-thanks`);
        if (thanks) thanks.style.display = 'block';

        submitFeedbackToBackend(category, scanId, {
            helpful: wasHelpful,
            rating: parseInt(rating)
        });
    }
}

// Skip comment and submit feedback with just rating
window.skipFeedbackComment = function(widgetId, category, scanId) {
    const widget = document.getElementById(widgetId);
    const rating = widget?.dataset?.rating || 3;
    const wasHelpful = widget?.dataset?.helpful === 'true';

    // Hide comment section
    const comment = document.getElementById(`${widgetId}-comment`);
    if (comment) comment.style.display = 'none';

    // Show thanks message
    const thanks = document.getElementById(`${widgetId}-thanks`);
    if (thanks) thanks.style.display = 'block';

    // Submit feedback with rating only
    submitFeedbackToBackend(category, scanId, {
        helpful: wasHelpful,
        rating: parseInt(rating)
    });
}

// Submit comment with feedback
window.submitFeedbackComment = function(widgetId, category, scanId) {
    const widget = document.getElementById(widgetId);
    const rating = widget?.dataset?.rating || 3;
    const wasHelpful = widget?.dataset?.helpful === 'true';
    const commentText = document.getElementById(`${widgetId}-comment-text`)?.value || '';

    // Hide comment section
    const comment = document.getElementById(`${widgetId}-comment`);
    if (comment) comment.style.display = 'none';

    // Show thanks message
    const thanks = document.getElementById(`${widgetId}-thanks`);
    if (thanks) thanks.style.display = 'block';

    // Submit feedback with rating and comment
    submitFeedbackToBackend(category, scanId, {
        helpful: wasHelpful,
        rating: parseInt(rating),
        comment: commentText
    });
}

// Submit feedback to backend
async function submitFeedbackToBackend(category, scanId, feedbackData) {
    try {
        const response = await fetch(`${API_BASE_URL}/scan/${scanId}/feedback`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
            },
            body: JSON.stringify({
                category: category,
                ...feedbackData
            })
        });

        const data = await response.json();

        if (data.success) {
            console.log('Feedback submitted successfully');
        } else {
            console.error('Feedback submission failed:', data.error);
        }
    } catch (error) {
        console.error('Error submitting feedback:', error);
    }
}

// Calculate grade from score
function calculateGrade(score) {
    if (score >= 900) return 'A+';
    if (score >= 850) return 'A';
    if (score >= 800) return 'A-';
    if (score >= 750) return 'B+';
    if (score >= 700) return 'B';
    if (score >= 650) return 'B-';
    if (score >= 600) return 'C+';
    if (score >= 550) return 'C';
    if (score >= 500) return 'C-';
    if (score >= 450) return 'D+';
    if (score >= 400) return 'D';
    if (score >= 350) return 'D-';
    return 'F';
}

// Calculate metrics (strong/warning/critical counts)
function calculateMetrics(categories) {
    let strong = 0;
    let warning = 0;
    let critical = 0;

    Object.values(categories).forEach(score => {
        const displayScore = Math.round(score * 10);
        if (displayScore >= 700) {
            strong++;
        } else if (displayScore >= 400) {
            warning++;
        } else {
            critical++;
        }
    });

    return { strong, warning, critical };
}

// Global bar chart variable
let categoryBarChart = null;

// Initialize bar chart
function initializeBarChart(categoryData) {
    const ctx = document.getElementById('categoryBarChart');
    if (!ctx) return;

    // Destroy existing chart if it exists
    if (categoryBarChart) {
        categoryBarChart.destroy();
    }

    const chartLabels = categoryData.map(cat => cat.name);
    const chartScores = categoryData.map(cat => cat.displayScore);
    const maxScores = categoryData.map(() => 1000); // Maximum score for each category

    categoryBarChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [
                {
                    label: 'Your Score',
                    data: chartScores,
                    backgroundColor: 'rgba(0, 185, 218, 0.8)',
                    borderColor: 'rgb(0, 185, 218)',
                    borderWidth: 2
                },
                {
                    label: 'Maximum Score',
                    data: maxScores,
                    backgroundColor: 'rgba(243, 28, 126, 0.2)',
                    borderColor: 'rgb(243, 28, 126)',
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 1000,
                    ticks: {
                        stepSize: 200
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y} / 1000`;
                        }
                    }
                }
            }
        }
    });
}

// Switch category view (list/chart) - ensure global scope
window.switchCategoryView = function(view) {
    const listView = document.getElementById('categoryListView');
    const chartView = document.getElementById('categoryChartView');
    const listBtn = document.querySelector('.toggle-btn:first-child');
    const chartBtn = document.querySelector('.toggle-btn:last-child');

    if (view === 'list') {
        listView.classList.add('active');
        chartView.classList.remove('active');
        listBtn.classList.add('active');
        chartBtn.classList.remove('active');
    } else {
        listView.classList.remove('active');
        chartView.classList.add('active');
        listBtn.classList.remove('active');
        chartBtn.classList.add('active');
    }
}

// Toggle individual accordion (ensure global scope)
window.toggleAccordion = function(index) {
    const card = document.getElementById(`rec-${index}`);
    if (card) {
        card.classList.toggle('expanded');
        console.log(`Toggled accordion ${index}, expanded:`, card.classList.contains('expanded'));
    } else {
        console.warn(`Card rec-${index} not found`);
    }
}

// Expand/Collapse all recommendations (ensure global scope)
window.expandAll = function() {
    const cards = document.querySelectorAll('.recommendation-card');
    console.log(`Expanding ${cards.length} recommendation cards`);
    cards.forEach(card => {
        card.classList.add('expanded');
    });
}

window.collapseAll = function() {
    const cards = document.querySelectorAll('.recommendation-card');
    console.log(`Collapsing ${cards.length} recommendation cards`);
    cards.forEach(card => {
        card.classList.remove('expanded');
    });
}

// ============================================
// HISTORIC COMPARISON FUNCTIONS
// ============================================

// Global variable to store timeline chart
let timelineChart = null;

// Toggle comparison section visibility
window.toggleComparison = function() {
    const content = document.getElementById('comparisonContent');
    const toggle = document.getElementById('comparisonToggle');

    if (content.classList.contains('active')) {
        content.classList.remove('active');
        toggle.classList.remove('expanded');
    } else {
        content.classList.add('active');
        toggle.classList.add('expanded');
    }
}

// Display historic comparison data
function displayHistoricComparison(comparison, historicalTimeline) {
    if (!comparison || !comparison.hasPreviousScan) {
        // No comparison data available
        return;
    }

    console.log('📊 Displaying historic comparison:', comparison);

    // Show comparison section
    const comparisonSection = document.getElementById('comparisonSection');
    if (comparisonSection) {
        comparisonSection.style.display = 'block';
    }

    // Update subtitle with date info
    const subtitle = document.getElementById('comparisonSubtitle');
    if (subtitle && comparison.previousScanDate) {
        const prevDate = new Date(comparison.previousScanDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        subtitle.textContent = `Compared with scan from ${prevDate} (${comparison.daysBetweenScans} days ago)`;
    }

    // Display score change summary
    displayScoreChangeSummary(comparison);

    // Display category comparison table
    displayCategoryComparisonTable(comparison);

    // Display timeline if available
    if (historicalTimeline && historicalTimeline.dataPoints && historicalTimeline.dataPoints.length > 1) {
        displayTimeline(historicalTimeline);
    }
}

// Display score change summary cards
function displayScoreChangeSummary(comparison) {
    const container = document.getElementById('scoreChangeSummary');
    if (!container) return;

    const scoreChange = comparison.scoreChange;
    const improved = comparison.summary.improved;
    const declined = comparison.summary.declined;

    let scoreChangeClass = 'neutral';
    let scoreChangeSign = '';
    if (scoreChange.total > 0) {
        scoreChangeClass = 'positive';
        scoreChangeSign = '+';
    } else if (scoreChange.total < 0) {
        scoreChangeClass = 'negative';
    }

    container.innerHTML = `
        <div class="score-change-card ${scoreChangeClass}">
            <div class="score-change-label">Overall Score Change</div>
            <div class="score-change-value ${scoreChangeClass}">
                ${scoreChangeSign}${Math.round(scoreChange.total * 10)}
            </div>
            <div class="score-change-delta">
                ${Math.round(scoreChange.previous * 10)} → ${Math.round(scoreChange.current * 10)}
            </div>
        </div>

        <div class="score-change-card positive">
            <div class="score-change-label">Categories Improved</div>
            <div class="score-change-value positive">${improved}</div>
            <div class="score-change-delta">
                ${improved === 1 ? 'category' : 'categories'} got better
            </div>
        </div>

        <div class="score-change-card ${declined > 0 ? 'negative' : 'neutral'}">
            <div class="score-change-label">Categories Declined</div>
            <div class="score-change-value ${declined > 0 ? 'negative' : 'neutral'}">${declined}</div>
            <div class="score-change-delta">
                ${declined === 1 ? 'category' : 'categories'} need attention
            </div>
        </div>
    `;
}

// Display category comparison table
function displayCategoryComparisonTable(comparison) {
    const container = document.getElementById('categoryComparisonTable');
    if (!container) return;

    const allCategories = [...comparison.categoriesImproved, ...comparison.categoriesDeclined];

    // Sort by absolute change (biggest changes first)
    allCategories.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    if (allCategories.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #718096;">
                <p style="font-size: 16px; margin-bottom: 10px;">✨ No significant changes detected</p>
                <p style="font-size: 14px;">All categories remained stable (±5 points)</p>
            </div>
        `;
        return;
    }

    let tableHTML = `
        <h3 style="font-size: 18px; font-weight: 700; color: #2d3748; margin-bottom: 15px; margin-top: 20px;">
            Category Changes
        </h3>
        <table class="category-comparison-table">
            <thead>
                <tr>
                    <th>Category</th>
                    <th>Previous Score</th>
                    <th>Current Score</th>
                    <th>Change</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
    `;

    allCategories.forEach(cat => {
        const changeClass = cat.change > 0 ? 'positive' : 'negative';
        const changeSign = cat.change > 0 ? '+' : '';
        const statusClass = cat.change > 0 ? 'improved' : 'declined';
        const statusText = cat.change > 0 ? 'Improved' : 'Declined';
        const arrow = cat.change > 0 ? '↑' : '↓';

        tableHTML += `
            <tr>
                <td class="category-name-cell">${cat.name}</td>
                <td>${Math.round(cat.previousScore * 10)}</td>
                <td>${Math.round(cat.currentScore * 10)}</td>
                <td>
                    <div class="change-indicator ${changeClass}">
                        <span class="change-arrow">${arrow}</span>
                        <span>${changeSign}${Math.round(cat.change * 10)}</span>
                    </div>
                </td>
                <td>
                    <span class="score-badge ${statusClass}">${statusText}</span>
                </td>
            </tr>
        `;
    });

    tableHTML += `
            </tbody>
        </table>
    `;

    container.innerHTML = tableHTML;
}

// Display timeline chart
function displayTimeline(historicalTimeline) {
    const timelineSection = document.getElementById('timelineSection');
    if (timelineSection) {
        timelineSection.style.display = 'block';
    }

    const ctx = document.getElementById('timelineChart');
    if (!ctx) return;

    // Destroy existing chart if it exists
    if (timelineChart) {
        timelineChart.destroy();
    }

    // Prepare data
    const dataPoints = historicalTimeline.dataPoints;
    const labels = dataPoints.map(dp => {
        const date = new Date(dp.date);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const scores = dataPoints.map(dp => Math.round(dp.totalScore * 10));

    // Create gradient
    const canvas = ctx.getContext('2d');
    const gradient = canvas.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(0, 185, 218, 0.4)');
    gradient.addColorStop(1, 'rgba(0, 185, 218, 0.0)');

    timelineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total Score',
                data: scores,
                borderColor: '#7D41A5',
                backgroundColor: gradient,
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: 6,
                pointHoverRadius: 8,
                pointBackgroundColor: '#7D41A5',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointHoverBackgroundColor: '#f31c7e',
                pointHoverBorderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    titleFont: {
                        size: 14,
                        weight: 'bold'
                    },
                    bodyFont: {
                        size: 13
                    },
                    callbacks: {
                        label: function(context) {
                            return `Score: ${context.parsed.y}/1000`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 1000,
                    ticks: {
                        stepSize: 200,
                        font: {
                            size: 12
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    ticks: {
                        font: {
                            size: 12
                        }
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });

    console.log('📈 Timeline chart created with', dataPoints.length, 'data points');
}

// ============================================
// RECOMMENDATION DELIVERY SYSTEM UI COMPONENTS
// ============================================

/**
 * Display user mode indicator (Optimization vs Elite)
 */
function displayModeIndicator(userMode, currentScore, recommendationsCount = 0) {
    const container = document.createElement('div');
    container.id = 'mode-indicator';
    container.className = 'mb-6';

    const isElite = userMode.current_mode === 'elite';
    const modeIcon = isElite ? '👑' : '🚀';
    const modeTitle = isElite ? 'Elite Maintenance Mode' : 'Optimization Mode';
    const modeDescription = isElite
        ? 'You\'ve achieved elite status! Focus on maintaining your high score and staying ahead of competitors.'
        : 'Keep improving! Reach 850+ to unlock Elite mode with competitive tracking.';

    // Calculate stats for optimization mode
    let statsSection = '';
    if (!isElite && currentScore) {
        const progress = Math.min((currentScore / 850) * 100, 100);
        const remaining = Math.max(850 - currentScore, 0);

        statsSection = `
            <div class="stat-item">
                <div class="stat-value">${Math.round(progress)}%</div>
                <div class="stat-label">Progress to Elite Mode</div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progress}%"></div>
                </div>
            </div>

            <div class="stat-item">
                <div class="stat-value">${remaining} points</div>
                <div class="stat-label">Needed to reach Elite Mode (850+)</div>
            </div>

            <div class="stat-item highlight">
                <div class="stat-value">${recommendationsCount} actionable improvement${recommendationsCount !== 1 ? 's' : ''}</div>
                <div class="stat-label">to boost your AI visibility</div>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="optimization-status-card">
            <div class="optimization-header">
                <div class="optimization-icon">${modeIcon}</div>
                <div class="optimization-title-section">
                    <h3 class="optimization-mode-title">${modeTitle}</h3>
                    <p class="optimization-subtitle">${modeDescription}</p>
                </div>
            </div>

            <div class="optimization-stats">
                <div class="stat-item primary-stat">
                    <div class="stat-number">${currentScore}</div>
                    <div class="stat-label">Current Score</div>
                </div>

                ${statsSection}
            </div>
        </div>
    `;

    // Insert after the scan header
    const recCountEl = document.getElementById('recCount');
    if (recCountEl && recCountEl.parentElement) {
        recCountEl.parentElement.insertBefore(container, recCountEl);
    }
}

/**
 * Display notification center
 */
function displayNotificationCenter(notifications, unreadCount) {
    const container = document.createElement('div');
    container.id = 'notification-center';
    container.className = 'mb-6';

    if (notifications.length === 0) {
        return; // Don't show if no notifications
    }

    const unreadBadge = unreadCount > 0
        ? `<span class="ml-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">${unreadCount}</span>`
        : '';

    const notificationItems = notifications.slice(0, 5).map(notif => {
        const priorityColor = {
            high: 'border-red-400 bg-red-50',
            medium: 'border-yellow-400 bg-yellow-50',
            low: 'border-blue-400 bg-blue-50'
        }[notif.priority] || 'border-gray-300 bg-gray-50';

        const isRead = notif.is_read;
        const opacity = isRead ? 'opacity-60' : '';

        return `
            <div class="border-l-4 ${priorityColor} ${opacity} p-4 mb-3 rounded">
                <div class="flex items-start justify-between">
                    <div class="flex-1">
                        <h4 class="font-semibold text-gray-900">${notif.title}</h4>
                        <p class="text-sm text-gray-700 mt-1">${notif.message}</p>
                        <p class="text-xs text-gray-500 mt-2">${new Date(notif.created_at).toLocaleString()}</p>
                    </div>
                    ${!isRead ? `
                        <button onclick="markNotificationRead(${notif.id})" class="ml-4 text-blue-600 hover:text-blue-800 text-sm">
                            Mark Read
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="bg-white border-2 border-blue-200 rounded-lg p-6 shadow-md">
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-bold text-gray-900 flex items-center">
                    🔔 Notifications
                    ${unreadBadge}
                </h3>
                <button onclick="toggleNotifications()" class="text-blue-600 hover:text-blue-800 text-sm font-semibold">
                    View All
                </button>
            </div>
            <div id="notification-list" class="max-h-96 overflow-y-auto">
                ${notificationItems}
            </div>
        </div>
    `;

    const modeIndicator = document.getElementById('mode-indicator');
    if (modeIndicator) {
        modeIndicator.after(container);
    }
}

/**
 * Display refresh cycle countdown
 */
function displayRefreshCycle(cycle) {
    const container = document.createElement('div');
    container.id = 'refresh-cycle';
    container.className = 'mb-6';

    const nextDate = new Date(cycle.next_cycle_date);
    const now = new Date();
    const daysRemaining = Math.ceil((nextDate - now) / (1000 * 60 * 60 * 24));

    container.innerHTML = `
        <div class="bg-gradient-to-r from-green-50 to-blue-50 border-2 border-green-200 rounded-lg p-4">
            <div class="flex items-center justify-between">
                <div>
                    <h4 class="font-semibold text-gray-900">📅 Refresh Cycle ${cycle.cycle_number}</h4>
                    <p class="text-sm text-gray-700 mt-1">
                        ${cycle.implemented_count} implemented • ${cycle.skipped_count} skipped • ${cycle.auto_detected_count} auto-detected
                    </p>
                </div>
                <div class="text-right">
                    <div class="text-2xl font-bold text-green-600">${daysRemaining}</div>
                    <div class="text-xs text-gray-600">days until refresh</div>
                </div>
            </div>
        </div>
    `;

    const notifCenter = document.getElementById('notification-center');
    const modeIndicator = document.getElementById('mode-indicator');
    const insertAfter = notifCenter || modeIndicator;
    if (insertAfter) {
        insertAfter.after(container);
    }
}

/**
 * Display auto-detection confirmations
 */
function displayAutoDetections(detections) {
    const container = document.createElement('div');
    container.id = 'auto-detections';
    container.className = 'mb-6';

    const detectionItems = detections.map(detection => `
        <div class="border-l-4 border-green-400 bg-green-50 p-4 mb-3 rounded">
            <div class="flex items-start justify-between">
                <div class="flex-1">
                    <h4 class="font-semibold text-gray-900">✅ ${detection.recommendation_text || 'Recommendation'}</h4>
                    <p class="text-sm text-gray-700 mt-1">
                        We detected this might be implemented. Confidence: ${detection.confidence_score}%
                    </p>
                    <p class="text-xs text-gray-500 mt-2">${new Date(detection.detected_at).toLocaleString()}</p>
                </div>
                <div class="flex gap-2 ml-4">
                    <button onclick="confirmDetection(${detection.id}, true)"
                            class="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700">
                        Confirm
                    </button>
                    <button onclick="confirmDetection(${detection.id}, false)"
                            class="px-3 py-1 bg-gray-300 text-gray-700 text-sm rounded hover:bg-gray-400">
                        Not Yet
                    </button>
                </div>
            </div>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="bg-white border-2 border-green-200 rounded-lg p-6 shadow-md">
            <h3 class="text-lg font-bold text-gray-900 mb-4">🎯 Implementation Detected</h3>
            <div>${detectionItems}</div>
        </div>
    `;

    const refreshCycle = document.getElementById('refresh-cycle');
    const notifCenter = document.getElementById('notification-center');
    const modeIndicator = document.getElementById('mode-indicator');
    const insertAfter = refreshCycle || notifCenter || modeIndicator;
    if (insertAfter) {
        insertAfter.after(container);
    }
}

/**
 * Mark notification as read
 */
window.markNotificationRead = async function(notificationId) {
    try {
        const response = await fetch(`${API_BASE_URL}/scan/notifications/${notificationId}/read`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            location.reload(); // Refresh to update UI
        }
    } catch (error) {
        console.error('Failed to mark notification as read:', error);
    }
};

/**
 * Confirm auto-detection
 */
window.confirmDetection = async function(detectionId, confirmed) {
    try {
        const response = await fetch(`${API_BASE_URL}/scan/${scanId}/detection/${detectionId}/confirm`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ confirmed, feedback: null })
        });

        if (response.ok) {
            showNotification(
                confirmed ? 'Implementation confirmed!' : 'Detection dismissed',
                confirmed ? 'success' : 'info'
            );
            setTimeout(() => location.reload(), 1500);
        }
    } catch (error) {
        console.error('Failed to confirm detection:', error);
    }
};

/**
 * Toggle notifications view
 */
window.toggleNotifications = function() {
    // You could implement a modal or expand/collapse here
    alert('Full notification center coming soon!');
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', loadScanResults);