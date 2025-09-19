// Configuration
const API_BASE_URL = 'https://ai-visibility-tool.onrender.com/api';

// Industry-specific test queries
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

// Main form handler
document.getElementById('urlForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const url = document.getElementById('websiteUrl').value.trim();
    
    if (!isValidUrl(url)) {
        alert('Please enter a valid URL (e.g., https://example.com)');
        return;
    }
    
    await analyzeWebsite(url);
});

// Website analysis function
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

// Updated API call function
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

// Utility functions
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// UI functions
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

function displayCategoryAnalysis(results) {
    const scores = results.scores || {};
    
    // Define categories with their details
    const categories = [
        {
            key: 'aiSearchReadiness',
            name: 'AI Search Readiness',
            icon: '🎯',
            description: 'How well AI can find and cite your content',
            maxScore: 20
        },
        {
            key: 'contentStructure',
            name: 'Content Structure',
            icon: '🏗️',
            description: 'Semantic HTML and content organization',
            maxScore: 10
        },
        {
            key: 'voiceOptimization',
            name: 'Voice Optimization',
            icon: '🎤',
            description: 'Optimization for voice search queries',
            maxScore: 10
        },
        {
            key: 'technicalSetup',
            name: 'Technical Setup',
            icon: '⚙️',
            description: 'Technical factors for AI crawling',
            maxScore: 25
        },
        {
            key: 'trustAuthority',
            name: 'Trust & Authority',
            icon: '🛡️',
            description: 'Credibility signals for AI systems',
            maxScore: 20
        },
        {
            key: 'aiReadability',
            name: 'AI Readability',
            icon: '👁️',
            description: 'How well AI can understand your content',
            maxScore: 10
        },
        {
            key: 'speedUX',
            name: 'Speed & UX',
            icon: '⚡',
            description: 'Performance and user experience factors',
            maxScore: 10
        }
    ];
    
    const categoriesContainer = document.getElementById('scoreCategories');
    categoriesContainer.innerHTML = '';
    
    categories.forEach(category => {
        const score = scores[category.key] || 0;
        const percentage = Math.round((score / category.maxScore) * 100);
        
        let categoryClass, statusEmoji;
        if (percentage >= 70) {
            categoryClass = 'category-good';
            statusEmoji = '✅';
        } else if (percentage >= 40) {
            categoryClass = 'category-fair';
            statusEmoji = '🟡';
        } else {
            categoryClass = 'category-poor';
            statusEmoji = '❌';
        }
        
        const categoryDiv = document.createElement('div');
        categoryDiv.className = `category ${categoryClass}`;
        categoryDiv.innerHTML = `
            <h4>
                <span>${category.icon}</span>
                ${category.name}
                <span class="category-score">${score.toFixed(1)}/${category.maxScore} ${statusEmoji}</span>
            </h4>
            <p>${category.description}</p>
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

// CTA handlers
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
