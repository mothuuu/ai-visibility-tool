// Configuration
const API_BASE_URL = 'https://ai-visibility-tool.onrender.com/api';

// Industry-specific test queries (keep existing)
const TEST_QUERIES = {
    msp: [
        "Best managed service providers for cybersecurity",
        "Top IT support companies for small business",
        "Reliable MSP for remote work solutions"
    ],
    telecom: [
        "Best internet service providers in Ontario",
        "Reliable fiber internet companies",
        "Top telecommunications providers for business"
    ],
    startup: [
        "AI automation solutions for startups",
        "Best technology platforms for scaling",
        "Startup-friendly software solutions"
    ],
    professional_services: [
        "Best consulting firms for business strategy",
        "Top professional service providers",
        "Business advisory services near me"
    ]
};

// Main form handler (keep existing)
document.getElementById('urlForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const url = document.getElementById('websiteUrl').value.trim();
    
    if (!isValidUrl(url)) {
        alert('Please enter a valid URL (e.g., https://example.com)');
        return;
    }
    
    await analyzeWebsite(url);
});

// Website analysis function (keep existing)
async function analyzeWebsite(url) {
    showLoading();
    
    try {
        // Step 1: Analyze website with the new backend
        updateProgress('Analyzing website structure...', 25);
        const analysisData = await fetchTechnicalAnalysis(url);
        
        // Step 2: Test AI visibility (if needed)
        updateProgress('Testing AI assistant visibility...', 75);
        let aiVisibilityData = null;
        try {
            aiVisibilityData = await testAIVisibility(url, analysisData.industry);
        } catch (error) {
            console.log('AI visibility testing failed, continuing without it:', error);
        }
        
        // Step 3: Combine results
        updateProgress('Finalizing results...', 100);
        
        const results = {
            ...analysisData,
            aiVisibilityResults: aiVisibilityData
        };
        
        // Display results
        setTimeout(() => {
            showResults(results);
        }, 1000);
        
    } catch (error) {
        console.error('Analysis failed:', error);
        showError(error.message || 'Analysis failed. Please try again.');
    }
}

// Updated API call function (keep existing)
async function fetchTechnicalAnalysis(url) {
    const response = await fetch(`${API_BASE_URL}/analyze-website`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    });
    
    if (!response.ok) {
        throw new Error(`Technical analysis failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Debug logging
    console.log('Full API Response:', data);
    console.log('Scores object:', data.data?.scores);
    console.log('Analysis object:', data.data?.analysis);
    console.log('Industry:', data.data?.industry);
    console.log('Recommendations:', data.data?.recommendations);
    
    return data.data;
}

async function testAIVisibility(url, industry) {
    const queries = TEST_QUERIES[industry?.key] || TEST_QUERIES.professional_services;
    
    const response = await fetch(`${API_BASE_URL}/test-ai-visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, industry, queries })
    });
    
    if (!response.ok) {
        throw new Error(`AI visibility testing failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.data;
}

// Utility functions (keep existing)
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// UI functions (keep existing)
function showLoading() {
    document.getElementById('inputSection').style.display = 'none';
    document.getElementById('loadingSection').style.display = 'block';
    document.getElementById('errorSection').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'none';
}

function updateProgress(text, percentage) {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('progressFill').style.width = percentage + '%';
}

function showError(message) {
    document.getElementById('inputSection').style.display = 'none';
    document.getElementById('loadingSection').style.display = 'none';
    document.getElementById('errorSection').style.display = 'block';
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('errorMessage').textContent = message;
}

function showResults(results) {
    document.getElementById('inputSection').style.display = 'none';
    document.getElementById('loadingSection').style.display = 'none';
    document.getElementById('errorSection').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'block';
    
    displayResults(results);
}

function displayResults(results) {
    // Update industry detection
    document.getElementById('detectedIndustry').textContent = results.industry?.name || 'Professional Services';
    document.getElementById('websiteStats').textContent = 
        `Domain: ${new URL(results.url).hostname} | Analyzed: ${new Date(results.analyzedAt).toLocaleDateString()}`;
    
    // Update total score
    const totalScore = Math.round(results.scores?.total || 0);
    document.getElementById('totalScore').textContent = totalScore;
    
    const scoreCircle = document.getElementById('scoreCircle');
    const scoreTitle = document.getElementById('scoreTitle');
    const scoreDescription = document.getElementById('scoreDescription');
    
    // Update score styling and messages based on total score
    if (totalScore < 30) {
        scoreCircle.className = 'score-circle score-poor';
        scoreTitle.textContent = 'Critical AI Visibility Issues';
        scoreDescription.textContent = 'Your website has significant barriers preventing AI systems from finding and recommending you.';
    } else if (totalScore < 60) {
        scoreCircle.className = 'score-circle score-fair';
        scoreTitle.textContent = 'Moderate AI Visibility';
        scoreDescription.textContent = 'Your website appears in some AI results but has room for substantial improvement.';
    } else {
        scoreCircle.className = 'score-circle score-good';
        scoreTitle.textContent = 'Strong AI Visibility';
        scoreDescription.textContent = 'Your website is well-optimized for AI discovery with minor optimization opportunities.';
    }
    
    // Display category analysis
    displayCategoryAnalysis(results);
    
    // Display AI visibility results if available
    if (results.aiVisibilityResults) {
        displayAIVisibilityResults(results.aiVisibilityResults);
    }
    
    // Display recommendations
    displayRecommendations(results);
}

// UPDATED V5 CATEGORY DISPLAY FUNCTION
function displayCategoryAnalysis(results) {
    const scores = results.scores || {};
    const analysis = results.analysis || {};
    
    // V5 Categories with proper names and contribution percentages
    const categories = [
        {
            key: 'aiReadabilityMultimodal',
            name: 'AI Readability & Multimodal Access',
            icon: '👁️',
            description: 'How well AI can process your images, videos, and multimedia content',
            maxContribution: 10
        },
        {
            key: 'aiSearchReadiness', 
            name: 'AI Search Readiness & Content Depth',
            icon: '🎯',
            description: 'Content structure and depth for AI search optimization',
            maxContribution: 20
        },
        {
            key: 'contentFreshness',
            name: 'Content Freshness & Maintenance', 
            icon: '🔄',
            description: 'Content currency and maintenance indicators for AI trust',
            maxContribution: 8
        },
        {
            key: 'contentStructure',
            name: 'Content Structure & Entity Recognition',
            icon: '🏗️', 
            description: 'Semantic structure and entity clarity for AI understanding',
            maxContribution: 15
        },
        {
            key: 'speedUX',
            name: 'Speed & User Experience',
            icon: '⚡',
            description: 'Core Web Vitals and performance metrics for AI crawlers',
            maxContribution: 5
        },
        {
            key: 'technicalSetup',
            name: 'Technical Setup & Structured Data',
            icon: '⚙️',
            description: 'Technical infrastructure for AI crawler access and understanding', 
            maxContribution: 18
        },
        {
            key: 'trustAuthority',
            name: 'Trust, Authority & Verification',
            icon: '🛡️',
            description: 'E-E-A-T signals and credibility indicators for AI systems',
            maxContribution: 12
        },
        {
            key: 'voiceOptimization',
            name: 'Voice & Conversational Optimization', 
            icon: '🎤',
            description: 'Natural language and conversational query optimization',
            maxContribution: 12
        }
    ];
    
    const categoriesContainer = document.getElementById('scoreCategories');
    categoriesContainer.innerHTML = '';
    
    categories.forEach(category => {
        // Get the category analysis from backend response
        const categoryResult = analysis[category.key];
        let categoryPercentage = 0;
        
        // Handle both V5 and V4 response formats
        if (categoryResult && typeof categoryResult.total === 'number') {
            categoryPercentage = categoryResult.total;
        } else if (scores[category.key] && typeof scores[category.key] === 'number') {
            categoryPercentage = scores[category.key];
        }
        
        // Calculate actual contribution to final score
        const actualContribution = (categoryPercentage / 100) * category.maxContribution;
        
        let categoryClass, statusEmoji;
        const contributionPercentage = (actualContribution / category.maxContribution) * 100;
        
        if (contributionPercentage >= 70) {
            categoryClass = 'category-good';
            statusEmoji = '✅';
        } else if (contributionPercentage >= 40) {
            categoryClass = 'category-fair'; 
            statusEmoji = '🟡';
        } else {
            categoryClass = 'category-poor';
            statusEmoji = '❌';
        }
        
        const categoryDiv = document.createElement('div');
        categoryDiv.className = `category ${categoryClass}`;
        
        // Clean display without internal technical details
        categoryDiv.innerHTML = `
            <h4>
                <span>${category.icon}</span>
                ${category.name}
                <span class="category-score">${actualContribution.toFixed(1)}/${category.maxContribution} pts ${statusEmoji}</span>
            </h4>
            <p>${category.description}</p>
            <div class="category-progress">
                <div class="progress-bar-small">
                    <div class="progress-fill-small" style="width: ${Math.min(100, contributionPercentage)}%"></div>
                </div>
                <span class="progress-text">${categoryPercentage.toFixed(0)}% optimized</span>
            </div>
        `;
        
        categoriesContainer.appendChild(categoryDiv);
    });
}

function displayAIVisibilityResults(aiResults) {
    const aiResultsContainer = document.getElementById('aiVisibilityResults');
    
    if (!aiResults || !aiResults.overall) {
        aiResultsContainer.innerHTML = `
            <h3>AI Visibility Testing</h3>
            <p>AI assistant testing was not available for this analysis.</p>
        `;
        return;
    }
    
    aiResultsContainer.innerHTML = `
        <h3>Live AI Assistant Testing Results</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0;">
            <div style="text-align: center; background: white; padding: 20px; border-radius: 10px;">
                <div style="font-size: 2rem; font-weight: bold; color: #00B9DA;">${Math.round(aiResults.overall.mentionRate)}%</div>
                <div>Mention Rate</div>
                <small>How often you're mentioned</small>
            </div>
            <div style="text-align: center; background: white; padding: 20px; border-radius: 10px;">
                <div style="font-size: 2rem; font-weight: bold; color: #4DACA6;">${Math.round(aiResults.overall.recommendationRate)}%</div>
                <div>Recommendation Rate</div>
                <small>How often you're recommended</small>
            </div>
            <div style="text-align: center; background: white; padding: 20px; border-radius: 10px;">
                <div style="font-size: 2rem; font-weight: bold; color: #7030A0;">${Math.round(aiResults.overall.citationRate)}%</div>
                <div>Citation Rate</div>
                <small>How often you're cited</small>
            </div>
        </div>
        <p><strong>Queries tested:</strong> ${aiResults.testedQueries}</p>
    `;
}

function displayRecommendations(results) {
    const recommendations = results.recommendations || [];
    const quickWinsContainer = document.getElementById('quickWins');
    quickWinsContainer.innerHTML = '';
    
    if (recommendations.length === 0) {
        quickWinsContainer.innerHTML = `
            <div class="quick-win">
                <h4>Excellent Optimization!</h4>
                <p>Your website is well-optimized for AI visibility. Continue monitoring for new opportunities.</p>
            </div>
        `;
        return;
    }
    
    // Display the recommendations from the backend
    recommendations.forEach(rec => {
        const colors = { 
            'Critical': '#F31C7E', 
            'High': '#FF6B35', 
            'Medium': '#FFA726', 
            'Low': '#4DACA6' 
        };
        
        const recDiv = document.createElement('div');
        recDiv.className = 'quick-win';
        recDiv.innerHTML = `
            <h4 style="display: flex; justify-content: space-between; align-items: center;">
                ${rec.title}
                <span style="background: ${colors[rec.impact]}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem;">
                    ${rec.impact}
                </span>
            </h4>
            <p>${rec.description}</p>
            ${rec.quickWin ? `<p><strong>Quick Win:</strong> ${rec.quickWin}</p>` : ''}
        `;
        quickWinsContainer.appendChild(recDiv);
    });
}

function resetForm() {
    document.getElementById('inputSection').style.display = 'block';
    document.getElementById('loadingSection').style.display = 'none';
    document.getElementById('errorSection').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('websiteUrl').value = '';
    document.getElementById('progressFill').style.width = '0%';
}

// CTA handlers (keep existing)
document.addEventListener('DOMContentLoaded', function() {
    const getReportBtn = document.getElementById('getFullReportBtn');
    const bookCallBtn = document.getElementById('bookCallBtn');
    
    if (getReportBtn) {
        getReportBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.open('mailto:info@xeomarketing.com?subject=AI Visibility Report Request&body=Hi, I would like to request a detailed AI visibility analysis for my website. Here are my details:', '_blank');
        });
    }
    
    if (bookCallBtn) {
        bookCallBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.open('https://calendly.com/xeo-marketing/schedule-a-callback', '_blank');
        });
    }
});
