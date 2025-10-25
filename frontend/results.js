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

        const response = await fetch(`${API_BASE_URL}/scan/${scanId}`, { headers });
        
        if (!response.ok) {
            throw new Error('Failed to load scan results');
        }

        const data = await response.json();
        
        if (data.success) {
            displayResults(data.scan, data.quota);
        } else {
            throw new Error(data.error || 'Unknown error');
        }
    } catch (error) {
        console.error('Error loading results:', error);
        showError('Failed to load scan results. Please try again.');
    }
}

function displayResults(scan, quota) {
    console.log('Scan data:', scan); // Debug log
    
    // Update header info
    document.getElementById('scanUrl').textContent = scan.url;
    document.getElementById('scanDate').textContent = new Date(scan.created_at).toLocaleDateString();
    
    // Display overall score (convert 0-100 to 0-1000)
    const displayScore = Math.round(scan.total_score * 10);
    document.getElementById('overallScore').textContent = displayScore;
    
    // Update score circle color
    const scoreCircle = document.getElementById('scoreCircle');
    if (displayScore >= 750) {
        scoreCircle.classList.add('text-green-600');
    } else if (displayScore >= 500) {
        scoreCircle.classList.add('text-yellow-600');
    } else {
        scoreCircle.classList.add('text-red-600');
    }

    // Display user plan and quota
    if (userData.plan) {
        document.getElementById('userPlan').textContent = userData.plan.toUpperCase();
        if (quota) {
            document.getElementById('scanQuota').textContent = `${quota.used}/${quota.limit} scans used`;
        }
    }

    // Display category scores
    if (scan.categoryBreakdown) {
        displayCategoryScores(scan.categoryBreakdown, scan.recommendations || []);
    }

    // Display recommendations with full details
    if (scan.recommendations && scan.recommendations.length > 0) {
        displayRecommendations(scan.recommendations, userData.plan);
    } else {
        document.getElementById('recommendationsList').innerHTML = '<p class="text-gray-500 text-center py-8">No recommendations available for this scan.</p>';
    }

    // Display FAQ section (DIY+ only)
    if (scan.faq && userData.plan !== 'free') {
        displayFAQSection(scan.faq);
    }

    // Display upgrade CTA based on tier
    if (scan.upgrade) {
        displayUpgradeCTA(scan.upgrade, userData.plan);
    }

    // Show export options for DIY+
    if (userData.plan !== 'free') {
        document.getElementById('exportSection').classList.remove('hidden');
    }
}

function displayCategoryScores(categories, recommendations) {
    const container = document.getElementById('categoryScores');
    container.innerHTML = '';

    Object.entries(categories).forEach(([categoryKey, score]) => {
        const displayScore = Math.round(score * 10); // Convert to 0-1000
        const categoryName = categoryNames[categoryKey] || formatCategoryName(categoryKey);
        const icon = categoryIcons[categoryKey] || '📊';
        
        // Get top 3 recommendations for this category
        const categoryRecs = recommendations
            .filter(rec => rec.category === categoryKey)
            .slice(0, 3);

        const card = document.createElement('div');
        card.className = 'bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow';
        card.innerHTML = `
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-3">
                    <span class="text-3xl">${icon}</span>
                    <h3 class="font-bold text-lg">${categoryName}</h3>
                </div>
                <span class="text-2xl font-bold ${getScoreColor(displayScore)}">${displayScore}/1000</span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-2 mb-4">
                <div class="h-2 rounded-full ${getScoreBarColor(displayScore)}" style="width: ${score}%"></div>
            </div>
            ${categoryRecs.length > 0 ? `
                <div class="mt-3 space-y-2">
                    <p class="text-sm font-semibold text-gray-700">Top Priorities:</p>
                    ${categoryRecs.map(rec => `
                        <div class="text-sm text-gray-600 pl-2 border-l-2 ${priorityColors[rec.priority]?.border || 'border-gray-300'}">
                            • ${rec.recommendation_text || rec.title || 'Recommendation'}
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        `;
        container.appendChild(card);
    });
}

function displayRecommendations(recommendations, userPlan) {
    const container = document.getElementById('recommendationsList');
    container.innerHTML = '';

    console.log('Displaying recommendations:', recommendations); // Debug log

    // Filter recommendations based on plan
    const displayRecs = userPlan === 'free' 
        ? recommendations.slice(0, 5) 
        : recommendations;

    if (displayRecs.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-8">No recommendations available for this scan.</p>';
        return;
    }

    displayRecs.forEach((rec, index) => {
        const recCard = createRecommendationCard(rec, index, userPlan);
        container.appendChild(recCard);
    });

    // Show upgrade message if free tier
    if (userPlan === 'free' && recommendations.length > 5) {
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
        container.appendChild(upgradeMsg);
    }
}

function createRecommendationCard(rec, index, userPlan) {
    const card = document.createElement('div');
    card.className = `recommendation-card bg-white rounded-lg shadow-md border-l-4 ${priorityColors[rec.priority]?.border || 'border-gray-300'} overflow-hidden`;
    card.id = `rec-${index}`;

    const priorityClass = priorityColors[rec.priority] || priorityColors.medium;
    const showCodeSnippet = userPlan !== 'free' && rec.code_snippet;
    
    // Use the correct field names from API
    const title = rec.recommendation_text || rec.title || 'Recommendation';
    const finding = rec.findings || rec.finding || '';
    const impact = rec.impact_description || rec.impact || '';
    const actionSteps = rec.action_steps || rec.actionSteps || [];
    const codeSnippet = rec.code_snippet || rec.codeSnippet || '';
    const estimatedImpact = rec.estimated_impact || rec.estimatedScoreGain || 0;
    const effort = rec.estimated_effort || rec.effort || '';

    card.innerHTML = `
        <div class="p-6">
            <!-- Header -->
            <div class="flex items-start justify-between mb-4">
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="px-3 py-1 rounded-full text-xs font-semibold ${priorityClass.bg} ${priorityClass.text}">
                            ${(rec.priority || 'medium').toUpperCase()}
                        </span>
                        <span class="text-sm text-gray-600">${formatCategoryName(rec.category)}</span>
                        ${effort ? `<span class="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded">${effort} Effort</span>` : ''}
                    </div>
                    <h3 class="text-xl font-bold text-gray-900 mb-2">${title}</h3>
                    ${estimatedImpact ? `
                        <div class="flex items-center gap-2 text-green-600 font-semibold">
                            <span>📈</span>
                            <span>Potential Gain: +${Math.round(estimatedImpact * 10)} points</span>
                        </div>
                    ` : ''}
                </div>
                <button onclick="toggleRecommendation(${index})" 
                        class="text-blue-600 hover:text-blue-800 font-semibold">
                    <span id="toggle-${index}">Expand ▼</span>
                </button>
            </div>

            <!-- Collapsible Content -->
            <div id="content-${index}" class="hidden mt-4 space-y-4 border-t pt-4">
                <!-- Finding -->
                ${finding ? `
                    <div>
                        <h4 class="font-bold text-gray-800 mb-2">🔍 Finding:</h4>
                        <p class="text-gray-700 leading-relaxed whitespace-pre-line">${finding}</p>
                    </div>
                ` : ''}

                <!-- Impact -->
                ${impact ? `
                    <div>
                        <h4 class="font-bold text-gray-800 mb-2">💡 Impact:</h4>
                        <p class="text-gray-700 leading-relaxed">${impact}</p>
                    </div>
                ` : ''}

                <!-- Action Steps -->
                ${actionSteps && actionSteps.length > 0 ? `
                    <div>
                        <h4 class="font-bold text-gray-800 mb-3">✅ Action Steps:</h4>
                        <ol class="list-decimal list-inside space-y-2">
                            ${actionSteps.map(step => `
                                <li class="text-gray-700 leading-relaxed ml-2">${step}</li>
                            `).join('')}
                        </ol>
                    </div>
                ` : ''}

                <!-- Code Snippet (DIY+ only) -->
                ${showCodeSnippet ? `
                    <div>
                        <h4 class="font-bold text-gray-800 mb-2">💻 Implementation Code:</h4>
                        <div class="relative">
                            <pre class="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm"><code id="code-${index}">${escapeHtml(codeSnippet)}</code></pre>
                            <button onclick="copyCode('code-${index}')" 
                                    class="absolute top-2 right-2 px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
                                Copy Code
                            </button>
                        </div>
                    </div>
                ` : ''}

                <!-- Mark as Implemented (for future learning loop) -->
                <div class="pt-4 border-t">
                    <button onclick="markImplemented(${rec.id || index})" 
                            class="px-4 py-2 bg-green-100 text-green-800 rounded-lg hover:bg-green-200 transition-colors font-semibold">
                        ✓ Mark as Implemented
                    </button>
                </div>
            </div>
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
                    <button onclick="copySchemaCode()" 
                            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold">
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
    } else {
        content.classList.add('hidden');
        toggle.textContent = 'Expand ▼';
    }
}

function copyCode(elementId) {
    const codeElement = document.getElementById(elementId);
    if (codeElement) {
        navigator.clipboard.writeText(codeElement.textContent);
        alert('Code copied to clipboard!');
    }
}

function copySchemaCode() {
    const schemaText = document.getElementById('schemaCodeText');
    if (schemaText) {
        schemaText.select();
        document.execCommand('copy');
        alert('Schema code copied to clipboard!');
    }
}

function markImplemented(recId) {
    console.log('Marking recommendation as implemented:', recId);
    alert('Feature coming soon: This will track your implementation progress and improve future recommendations!');
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

// Initialize on page load
document.addEventListener('DOMContentLoaded', loadScanResults);