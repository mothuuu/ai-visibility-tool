// ========================================
// AI VISIBILITY TOOL - COMPLETE SCRIPT.JS
// ========================================

// API Configuration
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : 'https://ai-visibility-tool.onrender.com/api';

// DOM Elements
const scanForm = document.getElementById('scanForm');
const urlInput = document.getElementById('urlInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const loadingSection = document.getElementById('loadingSection');
const resultsSection = document.getElementById('resultsSection');
const categoriesContainer = document.getElementById('categoriesContainer');
const recommendationsContainer = document.getElementById('recommendationsContainer');
const errorMessage = document.getElementById('errorMessage');

// User state
let currentUser = null;
let authToken = null;

// ========================================
// INITIALIZATION
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    // Check authentication status
    checkAuthStatus();
    
    // Setup form handler
    if (scanForm) {
        scanForm.addEventListener('submit', handleScanSubmit);
    }
    
    // Setup logout if button exists
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
});

// ========================================
// AUTHENTICATION
// ========================================

function checkAuthStatus() {
    authToken = localStorage.getItem('authToken');
    const userStr = localStorage.getItem('user');
    
    if (authToken && userStr) {
        currentUser = JSON.parse(userStr);
        updateUIForAuthUser();
    } else {
        currentUser = null;
        updateUIForGuestUser();
    }
}

function updateUIForAuthUser() {
    // Update header or nav to show logged-in state
    const authLink = document.getElementById('authLink');
    const userDisplay = document.getElementById('userDisplay');
    
    if (authLink) {
        authLink.style.display = 'none';
    }
    
    if (userDisplay) {
        userDisplay.innerHTML = `
            <span>${currentUser.email}</span>
            <span class="plan-badge">${currentUser.plan}</span>
            <button id="logoutBtn" onclick="handleLogout()">Logout</button>
        `;
        userDisplay.style.display = 'flex';
    }
}

function updateUIForGuestUser() {
    const authLink = document.getElementById('authLink');
    const userDisplay = document.getElementById('userDisplay');
    
    if (authLink) {
        authLink.style.display = 'block';
    }
    
    if (userDisplay) {
        userDisplay.style.display = 'none';
    }
}

function handleLogout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    currentUser = null;
    authToken = null;
    updateUIForGuestUser();
    
    // Redirect to home
    window.location.href = 'index.html';
}

// ========================================
// SCAN FORM HANDLING
// ========================================

async function handleScanSubmit(e) {
    e.preventDefault();
    
    const url = urlInput.value.trim();
    
    if (!url) {
        showError('Please enter a valid URL');
        return;
    }
    
    // Validate URL format
    if (!isValidUrl(url)) {
        showError('Please enter a valid URL (e.g., https://example.com)');
        return;
    }
    
    // Start scan
    await runScan(url);
}

function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

// ========================================
// SCAN EXECUTION
// ========================================

async function runScan(url) {
    try {
        // Show loading state
        showLoading();
        hideError();
        
        // Prepare request
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // Add auth token if available
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }
        
        // Make API call
        const response = await fetch(`${API_BASE_URL}/scan`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ url })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Scan failed');
        }
        
        // Display results
        hideLoading();
        displayResults(data);
        
    } catch (error) {
        hideLoading();
        showError(error.message);
        console.error('Scan error:', error);
    }
}

// ========================================
// RESULTS DISPLAY ROUTER
// ========================================

function displayResults(results) {
    // Show results section
    resultsSection.style.display = 'block';
    
    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    // Route to appropriate display based on auth status
    if (currentUser) {
        displayFullResults(results);
    } else {
        displayFreemiumResults(results);
    }
}

// ========================================
// FREEMIUM DISPLAY (NEW - UPGRADED)
// ========================================

function displayFreemiumResults(results) {
    // 1. Overall Score Display
    const overallScoreHTML = `
        <div class="overall-score-card">
            <h2>Your AI Visibility Score</h2>
            <div class="score-display">
                <span class="score-value">${results.overallScore}/100</span>
                <span class="score-label">${getScoreLabel(results.overallScore)}</span>
            </div>
            <p class="score-description">
                ${getScoreDescription(results.overallScore)}
            </p>
        </div>
    `;
    
    // 2. Simplified Category Scores
    const categories = [
        { key: 'aiReadability', name: 'AI Readability & Multimodal', icon: '👁️', maxContribution: 10 },
        { key: 'searchReadiness', name: 'AI Search Readiness', icon: '🎯', maxContribution: 20 },
        { key: 'freshness', name: 'Content Freshness', icon: '🔄', maxContribution: 8 },
        { key: 'expertise', name: 'Expertise & Authority', icon: '🎓', maxContribution: 15 },
        { key: 'knowledgeGraph', name: 'Knowledge Graph Presence', icon: '🕸️', maxContribution: 12 },
        { key: 'technicalSEO', name: 'Technical SEO Foundation', icon: '⚙️', maxContribution: 15 },
        { key: 'userExperience', name: 'User Experience Signals', icon: '🎨', maxContribution: 10 },
        { key: 'brandSignals', name: 'Brand & Trust Signals', icon: '🏆', maxContribution: 10 }
    ];
    
    let categoriesHTML = '<div class="freemium-categories">';
    categoriesHTML += '<h3>Score Breakdown</h3>';
    categoriesHTML += '<p class="subtitle">See how each category contributes to your score</p>';
    
    categories.forEach(category => {
        const categoryScore = results.scores[category.key] || 0;
        const contribution = (categoryScore / 100) * category.maxContribution;
        const status = getStatusEmoji(contribution, category.maxContribution);
        const percentage = (contribution / category.maxContribution * 100).toFixed(0);
        
        categoriesHTML += `
            <div class="freemium-category-row">
                <div class="category-info">
                    <span class="category-icon">${category.icon}</span>
                    <span class="category-name">${category.name}</span>
                </div>
                <div class="category-score">
                    <span class="contribution">${contribution.toFixed(1)}/${category.maxContribution}</span>
                    <span class="status-indicator">${status}</span>
                </div>
                <div class="category-bar">
                    <div class="bar-fill" style="width: ${percentage}%"></div>
                </div>
            </div>
        `;
    });
    
    categoriesHTML += '</div>';
    
    // 3. Upgrade CTA
    const upgradePromptHTML = `
        <div class="upgrade-prompt-card">
            <div class="upgrade-icon">🔒</div>
            <h4>Want Detailed Breakdowns?</h4>
            <p>Sign up free to see:</p>
            <ul class="upgrade-benefits">
                <li>✓ Subcategory analysis for each pillar</li>
                <li>✓ Specific issues detected on your site</li>
                <li>✓ Complete recommendations list</li>
                <li>✓ 2 free scans per month</li>
            </ul>
            <button class="upgrade-btn" onclick="window.location.href='auth.html'">
                Sign Up Free - No Credit Card
            </button>
        </div>
    `;
    
    // 4. Top 3-5 Recommendations Only
    const topRecommendations = results.recommendations ? results.recommendations.slice(0, 5) : [];
    let recommendationsHTML = '<div class="freemium-recommendations">';
    recommendationsHTML += '<h3>Top Recommendations</h3>';
    recommendationsHTML += '<p class="subtitle">Priority actions to improve your AI visibility</p>';
    
    if (topRecommendations.length > 0) {
        topRecommendations.forEach((rec, index) => {
            recommendationsHTML += `
                <div class="recommendation-card">
                    <div class="rec-number">${index + 1}</div>
                    <div class="rec-content">
                        <h4>${rec.title}</h4>
                        <p>${rec.description}</p>
                        <span class="rec-impact">${rec.impact || 'High'} Impact</span>
                    </div>
                </div>
            `;
        });
        
        if (results.recommendations && results.recommendations.length > 5) {
            recommendationsHTML += `
                <div class="more-recommendations-notice">
                    <p>🔒 <strong>${results.recommendations.length - 5} more recommendations</strong> available with a free account</p>
                </div>
            `;
        }
    } else {
        recommendationsHTML += '<p>No recommendations available at this time.</p>';
    }
    
    recommendationsHTML += '</div>';
    
    // Render everything
    categoriesContainer.innerHTML = overallScoreHTML + categoriesHTML + upgradePromptHTML;
    recommendationsContainer.innerHTML = recommendationsHTML;
}

// ========================================
// FULL RESULTS DISPLAY (AUTHENTICATED USERS)
// ========================================

function displayFullResults(results) {
    // Overall Score
    let html = `
        <div class="overall-score-card">
            <h2>Your AI Visibility Score</h2>
            <div class="score-display">
                <span class="score-value">${results.overallScore}/100</span>
                <span class="score-label">${getScoreLabel(results.overallScore)}</span>
            </div>
            <p class="score-description">
                ${getScoreDescription(results.overallScore)}
            </p>
            ${currentUser && currentUser.plan === 'free' ? `
                <div class="upgrade-notice">
                    <p>🚀 Upgrade to Premium for multi-page scanning, competitor analysis, and more!</p>
                    <button onclick="window.location.href='checkout.html?url=${encodeURIComponent(results.url || '')}'" class="upgrade-btn-small">
                        Upgrade Now
                    </button>
                </div>
            ` : ''}
        </div>
    `;
    
    // Categories with Full Details
    html += '<div class="full-categories">';
    html += '<h3>Detailed Analysis</h3>';
    
    const categories = [
        { key: 'aiReadability', name: 'AI Readability & Multimodal', icon: '👁️', maxContribution: 10 },
        { key: 'searchReadiness', name: 'AI Search Readiness', icon: '🎯', maxContribution: 20 },
        { key: 'freshness', name: 'Content Freshness', icon: '🔄', maxContribution: 8 },
        { key: 'expertise', name: 'Expertise & Authority', icon: '🎓', maxContribution: 15 },
        { key: 'knowledgeGraph', name: 'Knowledge Graph Presence', icon: '🕸️', maxContribution: 12 },
        { key: 'technicalSEO', name: 'Technical SEO Foundation', icon: '⚙️', maxContribution: 15 },
        { key: 'userExperience', name: 'User Experience Signals', icon: '🎨', maxContribution: 10 },
        { key: 'brandSignals', name: 'Brand & Trust Signals', icon: '🏆', maxContribution: 10 }
    ];
    
    categories.forEach(category => {
        const categoryScore = results.scores[category.key] || 0;
        const contribution = (categoryScore / 100) * category.maxContribution;
        const status = getStatusEmoji(contribution, category.maxContribution);
        const percentage = (contribution / category.maxContribution * 100).toFixed(0);
        
        html += `
            <div class="category-card">
                <div class="category-header">
                    <div class="category-title">
                        <span class="category-icon">${category.icon}</span>
                        <h4>${category.name}</h4>
                    </div>
                    <div class="category-score-large">
                        <span class="score">${contribution.toFixed(1)}/${category.maxContribution}</span>
                        <span class="status">${status}</span>
                    </div>
                </div>
                <div class="category-bar-large">
                    <div class="bar-fill" style="width: ${percentage}%"></div>
                </div>
                <div class="category-details">
                    <p>Score: ${categoryScore}/100</p>
                    ${results.detailedAnalysis && results.detailedAnalysis[category.key] 
                        ? `<p class="detail-text">${results.detailedAnalysis[category.key]}</p>` 
                        : ''}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    
    categoriesContainer.innerHTML = html;
    
    // Full Recommendations
    let recsHTML = '<div class="full-recommendations">';
    recsHTML += '<h3>All Recommendations</h3>';
    
    if (results.recommendations && results.recommendations.length > 0) {
        results.recommendations.forEach((rec, index) => {
            recsHTML += `
                <div class="recommendation-card-full">
                    <div class="rec-number-full">${index + 1}</div>
                    <div class="rec-content-full">
                        <h4>${rec.title}</h4>
                        <p>${rec.description}</p>
                        <div class="rec-meta">
                            <span class="rec-impact">${rec.impact || 'Medium'} Impact</span>
                            ${rec.category ? `<span class="rec-category">${rec.category}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        });
    } else {
        recsHTML += '<p>Great job! No major issues detected.</p>';
    }
    
    recsHTML += '</div>';
    
    recommendationsContainer.innerHTML = recsHTML;
}

// ========================================
// HELPER FUNCTIONS
// ========================================

function getScoreLabel(score) {
    if (score >= 90) return '🌟 Excellent';
    if (score >= 75) return '✅ Good';
    if (score >= 60) return '🟡 Fair';
    if (score >= 40) return '🟠 Needs Work';
    return '❌ Critical';
}

function getScoreDescription(score) {
    if (score >= 90) return 'Your site is highly optimized for AI discovery and recommendation.';
    if (score >= 75) return 'Your site is well-positioned for AI visibility with room for improvement.';
    if (score >= 60) return 'Your site has moderate AI visibility. Focus on key improvements.';
    if (score >= 40) return 'Your site needs significant optimization for AI engines.';
    return 'Your site is not well-optimized for AI discovery. Immediate action needed.';
}

function getStatusEmoji(contribution, max) {
    const percentage = (contribution / max) * 100;
    if (percentage >= 80) return '✅';
    if (percentage >= 50) return '🟡';
    return '❌';
}

// ========================================
// UI STATE MANAGEMENT
// ========================================

function showLoading() {
    if (loadingSection) {
        loadingSection.style.display = 'block';
    }
    if (resultsSection) {
        resultsSection.style.display = 'none';
    }
    if (analyzeBtn) {
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Analyzing...';
    }
}

function hideLoading() {
    if (loadingSection) {
        loadingSection.style.display = 'none';
    }
    if (analyzeBtn) {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'Analyze Website';
    }
}

function showError(message) {
    if (errorMessage) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            hideError();
        }, 5000);
    } else {
        alert(message);
    }
}

function hideError() {
    if (errorMessage) {
        errorMessage.style.display = 'none';
    }
}

// ========================================
// EXPORT FOR TESTING
// ========================================

// Make functions available globally if needed
window.runScan = runScan;
window.handleLogout = handleLogout;
