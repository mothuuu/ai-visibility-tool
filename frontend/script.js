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

/* ========================================
   UPSELL MOMENTS CSS - Add to bottom of styles.css
   ======================================== */

/* Competitor Teaser Card (Locked) */
.competitor-teaser-card {
    background: white;
    border-radius: 15px;
    padding: 30px;
    margin: 30px 0;
    box-shadow: 0 4px 15px rgba(0,0,0,0.08);
}

.teaser-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.teaser-header h3 {
    font-size: 1.4rem;
    color: #333;
    margin: 0;
}

.pro-badge {
    background: linear-gradient(135deg, #7030A0, #00B9DA);
    color: white;
    padding: 6px 16px;
    border-radius: 20px;
    font-size: 0.85rem;
    font-weight: 700;
    text-transform: uppercase;
}

.teaser-preview {
    position: relative;
    min-height: 200px;
}

.competitor-comparison-blur {
    display: flex;
    flex-direction: column;
    gap: 15px;
}

.comparison-row {
    display: flex;
    align-items: center;
    gap: 15px;
}

.comparison-row span:first-child {
    min-width: 120px;
    font-weight: 500;
    color: #555;
}

.score-bar-blur {
    flex: 1;
    height: 30px;
    background: linear-gradient(90deg, #00B9DA, #4DACA6);
    border-radius: 5px;
    opacity: 0.6;
}

.comparison-row span:last-child {
    min-width: 60px;
    text-align: right;
    font-weight: 600;
    color: #333;
}

.blur-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
}

.unlock-content {
    text-align: center;
    max-width: 400px;
    padding: 20px;
}

.lock-icon {
    font-size: 3rem;
    margin-bottom: 15px;
}

.unlock-content h4 {
    font-size: 1.5rem;
    color: #333;
    margin-bottom: 10px;
}

.unlock-content p {
    color: #666;
    margin-bottom: 20px;
}

.unlock-btn {
    background: linear-gradient(135deg, #7030A0, #00B9DA);
    color: white;
    border: none;
    padding: 15px 30px;
    border-radius: 10px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.2s ease;
}

.unlock-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 20px rgba(112, 48, 160, 0.3);
}

/* Deeper Insights Prompt */
.deeper-insights-prompt {
    background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
    border: 2px solid #00B9DA;
    border-radius: 15px;
    padding: 35px;
    text-align: center;
    margin: 30px 0;
}

.insights-icon {
    font-size: 3.5rem;
    margin-bottom: 15px;
}

.deeper-insights-prompt h3 {
    font-size: 1.6rem;
    color: #333;
    margin-bottom: 10px;
}

.deeper-insights-prompt p {
    color: #666;
    font-size: 1.05rem;
    margin-bottom: 25px;
}

.insights-features {
    max-width: 500px;
    margin: 0 auto 25px;
    text-align: left;
}

.insight-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
}

.insight-item .check {
    color: #4DACA6;
    font-size: 1.3rem;
    font-weight: bold;
}

.insight-item span:last-child {
    color: #555;
    font-size: 0.95rem;
}

.insights-btn {
    background: linear-gradient(135deg, #00B9DA 0%, #7030A0 100%);
    color: white;
    border: none;
    padding: 16px 35px;
    border-radius: 10px;
    font-size: 1.1rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.2s ease;
}

.insights-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0, 185, 218, 0.3);
}

/* Tier Comparison Card */
.tier-comparison-card {
    background: linear-gradient(135deg, rgba(112, 48, 160, 0.05) 0%, rgba(0, 185, 218, 0.05) 100%);
    border: 1px solid rgba(0, 185, 218, 0.3);
    border-radius: 20px;
    padding: 40px;
    margin: 40px 0;
}

.tier-comparison-card h3 {
    text-align: center;
    font-size: 2rem;
    color: #333;
    margin-bottom: 10px;
}

.tier-subtitle {
    text-align: center;
    color: #666;
    margin-bottom: 35px;
    font-size: 1.05rem;
}

.tier-comparison-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 25px;
    margin-top: 30px;
}

.tier-card {
    background: white;
    border-radius: 15px;
    padding: 30px;
    position: relative;
    box-shadow: 0 4px 15px rgba(0,0,0,0.08);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.tier-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 8px 25px rgba(0,0,0,0.12);
}

.tier-badge {
    position: absolute;
    top: -12px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #F31C7E, #DA4E91);
    color: white;
    padding: 6px 20px;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    white-space: nowrap;
}

.tier-header {
    text-align: center;
    margin-bottom: 25px;
    padding-bottom: 20px;
    border-bottom: 2px solid #f0f0f0;
}

.tier-header h4 {
    font-size: 1.4rem;
    color: #333;
    margin-bottom: 10px;
}

.tier-price {
    font-size: 2.5rem;
    font-weight: bold;
    color: #00B9DA;
}

.tier-price span {
    font-size: 1.2rem;
    color: #666;
    font-weight: normal;
}

.tier-features {
    margin-bottom: 25px;
}

.tier-feature {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid #f5f5f5;
}

.tier-feature:last-child {
    border-bottom: none;
}

.feature-icon {
    color: #4DACA6;
    font-size: 1.2rem;
    font-weight: bold;
}

.tier-feature span:last-child {
    color: #555;
    font-size: 0.95rem;
    line-height: 1.4;
}

.tier-btn {
    width: 100%;
    padding: 15px;
    border-radius: 10px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    border: none;
}

.tier-btn-primary {
    background: linear-gradient(135deg, #00B9DA 0%, #7030A0 100%);
    color: white;
}

.tier-btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(0, 185, 218, 0.4);
}

.tier-btn-secondary {
    background: white;
    color: #00B9DA;
    border: 2px solid #00B9DA;
}

.tier-btn-secondary:hover {
    background: #00B9DA;
    color: white;
}

/* Highlight Starter Tier */
.tier-starter {
    border: 2px solid #00B9DA;
}

.tier-starter .tier-header {
    border-bottom-color: #00B9DA;
}

/* Responsive */
@media (max-width: 768px) {
    .tier-comparison-grid {
        grid-template-columns: 1fr;
    }
    
    .teaser-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
    }
    
    .comparison-row {
        flex-wrap: wrap;
    }
    
    .comparison-row span:first-child {
        min-width: 100px;
        font-size: 0.9rem;
    }
    
    .unlock-content h4 {
        font-size: 1.3rem;
    }
    
    .deeper-insights-prompt {
        padding: 25px 20px;
    }
    
    .tier-comparison-card {
        padding: 25px 15px;
    }
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
