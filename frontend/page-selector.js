const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : 'https://ai-visibility-tool.onrender.com/api';

const MAX_PAGES = 5;
let selectedPages = [];
let baseDomain = '';

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
    const userPlan = await checkAuth();

    if (!userPlan) {
        alert('Please log in to continue');
        window.location.href = 'auth.html?redirect=page-selector.html';
        return;
    }

    // Check if user is on free plan - redirect them with upgrade prompt
    if (userPlan === 'free') {
        showFreePlanUpgradePrompt();
        return;
    }

    // Get domain from URL params (accepts both 'domain' and 'url')
    const urlParams = new URLSearchParams(window.location.search);
    baseDomain = urlParams.get('domain') || urlParams.get('url');

    if (!baseDomain) {
        showError('No domain specified');
        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 2000);
        return;
    }

    // Normalize domain (ensure it has protocol)
    if (!baseDomain.startsWith('http://') && !baseDomain.startsWith('https://')) {
        baseDomain = 'https://' + baseDomain;
    }

    // Display domain
    try {
        const url = new URL(baseDomain);
        document.getElementById('domainDisplay').textContent = url.hostname;
    } catch (error) {
        document.getElementById('domainDisplay').textContent = baseDomain;
    }

    // Add homepage by default
    addPageToList(baseDomain);

    // Enable enter key in input
    document.getElementById('pageUrlInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addPage();
        }
    });
});

// Check authentication using localStorage token and return user plan
async function checkAuth() {
    const authToken = localStorage.getItem('authToken');

    if (!authToken) {
        return null;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        // Check if email is verified
        if (data.user && !data.user.email_verified) {
            alert('Please verify your email first');
            window.location.href = 'verify.html';
            return null;
        }

        // Return user plan (default to 'free' if not set)
        return data.user?.plan || 'free';
    } catch (error) {
        console.error('Auth check failed:', error);
        return null;
    }
}

// Add page from input
function addPage() {
    const input = document.getElementById('pageUrlInput');
    const pageUrl = input.value.trim();
    
    if (!pageUrl) {
        showError('Please enter a page URL');
        return;
    }
    
    if (selectedPages.length >= MAX_PAGES) {
        showError(`Maximum ${MAX_PAGES} pages allowed`);
        return;
    }
    
    try {
        // Construct full URL
        let fullUrl;
        
        if (pageUrl.startsWith('http://') || pageUrl.startsWith('https://')) {
            // Full URL provided
            fullUrl = pageUrl;
            
            // Validate same domain
            const inputUrl = new URL(pageUrl);
            const baseUrl = new URL(baseDomain);
            
            if (inputUrl.hostname !== baseUrl.hostname) {
                showError('Page must be from the same domain');
                return;
            }
        } else {
            // Path provided
            const baseUrl = new URL(baseDomain);
            const path = pageUrl.startsWith('/') ? pageUrl : '/' + pageUrl;
            fullUrl = `${baseUrl.protocol}//${baseUrl.hostname}${path}`;
        }
        
        // Check for duplicates
        if (selectedPages.includes(fullUrl)) {
            showError('This page is already added');
            return;
        }
        
        // Add to list
        addPageToList(fullUrl);
        
        // Clear input
        input.value = '';
        
        // Show success message
        showInfo('Page added successfully');
        
    } catch (error) {
        console.error('Error adding page:', error);
        showError('Invalid URL format');
    }
}

// Add page to the list
function addPageToList(url) {
    selectedPages.push(url);
    updatePageList();
    updatePageCount();
    updateAnalyzeButton();
}

// Remove page from list
function removePage(url) {
    selectedPages = selectedPages.filter(page => page !== url);
    updatePageList();
    updatePageCount();
    updateAnalyzeButton();
}

// Update the page list UI
function updatePageList() {
    const pageList = document.getElementById('pageList');
    
    if (selectedPages.length === 0) {
        pageList.innerHTML = '<li class="empty-state">No pages selected yet. Add your first page above.</li>';
        return;
    }
    
    pageList.innerHTML = '';
    
    selectedPages.forEach(url => {
        const li = document.createElement('li');
        li.className = 'page-item';
        
        // Display shortened URL
        let displayUrl = url;
        try {
            const urlObj = new URL(url);
            displayUrl = urlObj.pathname === '/' ? urlObj.hostname : urlObj.pathname;
        } catch (error) {
            // Keep full URL if parsing fails
        }
        
        li.innerHTML = `
            <span>${displayUrl}</span>
            <button class="remove-btn" onclick="removePage('${url}')">Remove</button>
        `;
        
        pageList.appendChild(li);
    });
}

// Update page count display
function updatePageCount() {
    document.getElementById('pageCount').textContent = selectedPages.length;
    document.getElementById('selectedCount').textContent = selectedPages.length;
    
    // Disable add button if max reached
    const addBtn = document.querySelector('.add-page-btn');
    if (selectedPages.length >= MAX_PAGES) {
        addBtn.disabled = true;
    } else {
        addBtn.disabled = false;
    }
}

// Update analyze button state
function updateAnalyzeButton() {
    const analyzeBtn = document.getElementById('analyzeBtn');
    analyzeBtn.disabled = selectedPages.length === 0;
}

// Start analysis with proper auth token
async function startAnalysis() {
    if (selectedPages.length === 0) {
        showError('Please select at least one page');
        return;
    }
    
    const analyzeBtn = document.getElementById('analyzeBtn');
    const originalText = analyzeBtn.innerHTML;
    const authToken = localStorage.getItem('authToken');
    
    if (!authToken) {
        showError('Please log in to continue');
        setTimeout(() => {
            window.location.href = 'auth.html';
        }, 1500);
        return;
    }
    
    try {
        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<div class="loading-spinner"></div>Starting analysis...';
        
        console.log('Starting scan with pages:', selectedPages);
        
        const response = await fetch(`${API_BASE_URL}/scan/analyze`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: baseDomain,
                pages: selectedPages,
                scanType: 'multi-page'
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Analysis failed');
        }
        
        const data = await response.json();
        
        console.log('Scan response:', data);
        
        // FIXED: Backend returns scan.id nested in scan object
        const scanId = data.scan?.id || data.scanId || data.id;
        
        if (scanId) {
            window.location.href = `results.html?scanId=${scanId}`;
        } else {
            console.error('Full response:', data);
            throw new Error('No scan ID received');
        }
        
    } catch (error) {
        console.error('Analysis error:', error);
        showError(error.message || 'Failed to start analysis. Please try again.');
        
        analyzeBtn.disabled = false;
        analyzeBtn.innerHTML = originalText;
    }
}

// Show error message
function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    
    // Hide info message
    document.getElementById('infoMessage').style.display = 'none';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

// Show info message
function showInfo(message) {
    const infoDiv = document.getElementById('infoMessage');
    infoDiv.textContent = message;
    infoDiv.style.display = 'block';

    // Hide error message
    document.getElementById('errorMessage').style.display = 'none';

    // Auto-hide after 3 seconds
    setTimeout(() => {
        infoDiv.style.display = 'none';
    }, 3000);
}

// Show upgrade prompt for free plan users
function showFreePlanUpgradePrompt() {
    const container = document.querySelector('.selector-container');

    // Hide all existing content
    container.innerHTML = `
        <div style="text-align: center; padding: 60px 20px;">
            <div style="font-size: 4rem; margin-bottom: 20px;">🔒</div>
            <h2 style="font-size: 2rem; color: #333; margin-bottom: 20px;">
                Multi-Page Scanning Requires an Upgrade
            </h2>
            <p style="font-size: 1.2rem; color: #666; margin-bottom: 30px; line-height: 1.6;">
                Free plan users can scan the homepage only.<br>
                Upgrade to the <strong>DIY Plan</strong> to scan up to 5 pages from your website.
            </p>

            <div style="background: #f8f9fa; padding: 30px; border-radius: 15px; margin: 40px 0;">
                <h3 style="color: #333; margin-bottom: 20px;">DIY Plan Features</h3>
                <ul style="text-align: left; max-width: 400px; margin: 0 auto; color: #555; line-height: 2;">
                    <li>✓ Analyze up to 5 pages from your website</li>
                    <li>✓ Full AI visibility score (X/1000)</li>
                    <li>✓ Complete 8-pillar breakdown</li>
                    <li>✓ Detailed recommendations for each page</li>
                    <li>✓ Unlimited monthly scans</li>
                    <li>✓ Progress tracking over time</li>
                </ul>
            </div>

            <div style="margin-top: 40px;">
                <a href="checkout.html?plan=diy" style="
                    display: inline-block;
                    padding: 18px 40px;
                    background: linear-gradient(135deg, #00B9DA 0%, #7030A0 100%);
                    color: white;
                    text-decoration: none;
                    border-radius: 12px;
                    font-size: 1.2rem;
                    font-weight: bold;
                    margin-right: 15px;
                    transition: transform 0.2s, box-shadow 0.2s;
                " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 10px 25px rgba(112, 48, 160, 0.3)';"
                   onmouseout="this.style.transform=''; this.style.boxShadow='';">
                    Upgrade to DIY - $29/month
                </a>

                <a href="dashboard.html" style="
                    display: inline-block;
                    padding: 18px 40px;
                    background: white;
                    color: #666;
                    text-decoration: none;
                    border: 2px solid #e1e5e9;
                    border-radius: 12px;
                    font-size: 1.2rem;
                    font-weight: bold;
                    transition: border-color 0.2s;
                " onmouseover="this.style.borderColor='#00B9DA';"
                   onmouseout="this.style.borderColor='#e1e5e9';">
                    Back to Dashboard
                </a>
            </div>
        </div>
    `;
}