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
        // Step 1: Analyze website technically
        updateProgress('Analyzing website structure...', 25);
        const technicalData = await fetchTechnicalAnalysis(url);
        
        // Step 2: Detect industry
        updateProgress('Detecting industry type...', 50);
        const industry = detectIndustry(technicalData);
        
        // Step 3: Test AI visibility
        updateProgress('Testing AI assistant visibility...', 75);
        const aiVisibilityData = await testAIVisibility(url, industry);
        
        // Step 4: Generate recommendations
        updateProgress('Generating recommendations...', 100);
        
        // Combine results
        const results = {
            ...technicalData,
            industry,
            aiVisibilityResults: aiVisibilityData,
            combinedScore: calculateCombinedScore(technicalData, aiVisibilityData)
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

// API calls
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
    return data.data;
}

async function testAIVisibility(url, industry) {
    const queries = TEST_QUERIES[industry.key] || TEST_QUERIES.professional_services;
    
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

function detectIndustry(technicalData) {
    // Simple industry detection - enhance based on content analysis
    return {
        key: 'professional_services',
        name: 'Professional Services'
    };
}

function calculateCombinedScore(technicalData, aiVisibilityData) {
    let technicalScore = 0;
    
    // Calculate technical score based on factors
    if (technicalData.hasSSL) technicalScore += 15;
    if (technicalData.hasTitle) technicalScore += 10;
    if (technicalData.hasMetaDescription) technicalScore += 15;
    if (technicalData.hasStructuredData) technicalScore += 20;
    if (technicalData.hasFAQ) technicalScore += 15;
    if (technicalData.mobileOptimized) technicalScore += 25;
    
    // Calculate AI visibility score
    let aiScore = 0;
    if (aiVisibilityData?.overall) {
        aiScore = (aiVisibilityData.overall.mentionRate + 
                  aiVisibilityData.overall.recommendationRate + 
                  aiVisibilityData.overall.citationRate) / 3;
    }
    
    // Combined score (70% technical, 30% AI visibility)
    return Math.round((technicalScore * 0.7) + (aiScore * 0.3));
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
    // Update industry
    document.getElementById('detectedIndustry').textContent = results.industry.name;
    document.getElementById('websiteStats').textContent = 
        `Domain: ${new URL(results.url).hostname} | Analyzed: ${new Date(results.analyzedAt).toLocaleDateString()}`;
    
    // Update score
    document.getElementById('totalScore').textContent = results.combinedScore;
    
    const scoreCircle = document.getElementById('scoreCircle');
    const scoreTitle = document.getElementById('scoreTitle');
    const scoreDescription = document.getElementById('scoreDescription');
    
    if (results.combinedScore < 50) {
        scoreCircle.className = 'score-circle score-poor';
        scoreTitle.textContent = 'Critical AI Visibility Issues';
        scoreDescription.textContent = 'Your website has significant barriers preventing AI systems from finding and recommending you.';
    } else if (results.combinedScore < 75) {
        scoreCircle.className = 'score-circle score-fair';
        scoreTitle.textContent = 'Moderate AI Visibility';
        scoreDescription.textContent = 'Your website appears in some AI results but has room for substantial improvement.';
    } else {
        scoreCircle.className = 'score-circle score-good';
        scoreTitle.textContent = 'Strong AI Visibility';
        scoreDescription.textContent = 'Your website is well-optimized for AI discovery with minor optimization opportunities.';
    }
    
    // Display technical factors
    displayTechnicalAnalysis(results);
    
    // Display AI visibility results
    if (results.aiVisibilityResults) {
        displayAIVisibilityResults(results.aiVisibilityResults);
    }
    
    // Generate and display recommendations
    displayRecommendations(results);
}

function displayTechnicalAnalysis(results) {
    const categories = [
        { name: 'SSL Certificate', status: results.hasSSL, icon: '🔒' },
        { name: 'Meta Description', status: results.hasMetaDescription, icon: '📝' },
        { name: 'Structured Data', status: results.hasStructuredData, icon: '🏗️' },
        { name: 'FAQ Section', status: results.hasFAQ, icon: '❓' },
        { name: 'Mobile Optimized', status: results.mobileOptimized, icon: '📱' },
        { name: 'Page Load Speed', status: results.estimatedLoadTime === 'Fast', icon: '⚡' }
    ];
    
    const categoriesContainer = document.getElementById('scoreCategories');
    categoriesContainer.innerHTML = '';
    
    categories.forEach(category => {
        const categoryClass = category.status ? 'category-good' : 'category-poor';
        const statusEmoji = category.status ? '✅' : '❌';
        const score = category.status ? 25 : 0;
        
        const categoryDiv = document.createElement('div');
        categoryDiv.className = `category ${categoryClass}`;
        categoryDiv.innerHTML = `
            <h4>
                <span>${category.icon}</span>
                ${category.name}
                <span class="category-score">${score}/25 ${statusEmoji}</span>
            </h4>
            <p>Technical factor affecting AI crawling and understanding</p>
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
    const recommendations = generateRecommendations(results);
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
        `;
        quickWinsContainer.appendChild(recDiv);
    });
}

function generateRecommendations(results) {
    const recommendations = [];
    
    if (!results.hasSSL) {
        recommendations.push({
            title: 'Enable HTTPS',
            description: 'Secure your website with SSL certificate. AI assistants prioritize secure websites.',
            impact: 'Critical'
        });
    }
    
    if (!results.hasStructuredData) {
        recommendations.push({
            title: 'Add Schema Markup',
            description: 'Implement structured data to help AI systems understand your business information.',
            impact: 'High'
        });
    }
    
    if (!results.hasFAQ) {
        recommendations.push({
            title: 'Create FAQ Section',
            description: 'Add frequently asked questions that match what customers ask AI assistants.',
            impact: 'High'
        });
    }
    
    if (!results.mobileOptimized) {
        recommendations.push({
            title: 'Optimize for Mobile',
            description: 'Ensure your website works perfectly on mobile devices where most AI searches happen.',
            impact: 'Medium'
        });
    }
    
    if (results.aiVisibilityResults?.overall?.mentionRate < 20) {
        recommendations.push({
            title: 'Improve AI Discovery',
            description: 'Your company is rarely mentioned by AI assistants. Focus on creating more discoverable content.',
            impact: 'Critical'
        });
    }
    
    return recommendations.slice(0, 4);
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
document.getElementById('getFullReportBtn').addEventListener('click', (e) => {
    e.preventDefault();
    window.open('mailto:info@xeomarketing.com?subject=AI Visibility Report Request&body=Hi, I would like to request a detailed AI visibility analysis for my website. Here are my details:', '_blank');
});

document.getElementById('bookCallBtn').addEventListener('click', (e) => {
    e.preventDefault();
    window.open('https://calendly.com/xeo-marketing/schedule-a-callback', '_blank');
});
