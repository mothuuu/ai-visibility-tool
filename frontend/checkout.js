const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : 'https://ai-visibility-tool.onrender.com';

// Plan configurations
const PLANS = {
    diy: {
        name: 'DIY Plan',
        price: 29,
        features: [
            'Analyze 5 pages from your website',
            'Full AI visibility score (X/1000)',
            'Complete 8-pillar breakdown',
            'Detailed recommendations for each page',
            'Unlimited monthly scans',
            'Progress tracking over time',
            'Email support'
        ]
    },
    premium: {
        name: 'Premium Plan',
        price: 99,
        features: [
            'Coming Soon',
            'Join the waitlist for early access',
            'Multi-domain support',
            'Advanced analytics',
            'Priority support',
            'Custom recommendations'
        ]
    },
    agency: {
        name: 'Agency Plan',
        price: 499,
        features: [
            'Coming Soon',
            'Join the waitlist for early access',
            'Unlimited domains',
            'White-label reports',
            'API access',
            'Dedicated account manager'
        ]
    }
};

// Check authentication on page load
window.addEventListener('DOMContentLoaded', async () => {
    console.log('🔍 Checking authentication on checkout page load...');

    const isAuthenticated = await checkAuth();

    if (!isAuthenticated) {
        console.log('❌ Not authenticated, redirecting to login');
        await showAlertModal('Session Expired', 'Your session has expired. Please log in again to continue.', 'warning');

        // Store the redirect URL with plan parameter
        const currentUrl = 'checkout.html' + window.location.search;
        window.location.href = 'auth.html?redirect=' + encodeURIComponent(currentUrl);
        return;
    }

    console.log('✅ Authentication confirmed, loading checkout page');

    // Load plan details
    const urlParams = new URLSearchParams(window.location.search);
    const plan = urlParams.get('plan') || 'diy';

    loadPlanDetails(plan);

    // Handle form submission
    document.getElementById('checkoutForm').addEventListener('submit', handleCheckoutSubmit);
});

// Check if user is authenticated
async function checkAuth() {
    try {
        // Get token from localStorage
        const authToken = localStorage.getItem('authToken');

        if (!authToken) {
            console.log('No auth token found in localStorage');
            return false;
        }

        console.log('Checking auth with token:', authToken.substring(0, 20) + '...');

        const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Auth verify response status:', response.status);

        if (!response.ok) {
            console.error('Auth verify failed with status:', response.status);
            const errorText = await response.text();
            console.error('Error response:', errorText);
            return false;
        }

        const data = await response.json();
        console.log('Auth verify response:', data);

        // Check if user data is available
        if (!data.authenticated) {
            console.error('User not authenticated according to response');
            return false;
        }

        console.log('Auth check passed!');
        return true;
    } catch (error) {
        console.error('Auth check failed with exception:', error);
        return false;
    }
}

// Load plan details into the page
function loadPlanDetails(planKey) {
    const plan = PLANS[planKey];
    
    if (!plan) {
        showError('Invalid plan selected');
        return;
    }
    
    document.getElementById('planName').textContent = plan.name;
    document.getElementById('planPrice').textContent = plan.price;
    
    const featuresList = document.getElementById('planFeaturesList');
    featuresList.innerHTML = '';
    
    plan.features.forEach(feature => {
        const li = document.createElement('li');
        li.textContent = feature;
        featuresList.appendChild(li);
    });
    
    // If premium or agency, disable form and show waitlist message
    if (planKey === 'premium' || planKey === 'agency') {
        document.getElementById('checkoutForm').innerHTML = `
            <div style="text-align: center; padding: 30px; background: #f8f9fa; border-radius: 15px;">
                <h3 style="margin-bottom: 15px;">Coming Soon!</h3>
                <p style="color: #666; margin-bottom: 20px;">
                    This plan is currently in development. Join our waitlist to be notified when it launches.
                </p>
                <button type="button" onclick="window.location.href='dashboard.html'" class="checkout-btn">
                    Return to Dashboard
                </button>
            </div>
        `;
    }
}

// Handle checkout form submission
async function handleCheckoutSubmit(e) {
    e.preventDefault();
    
    const btn = document.getElementById('checkoutBtn');
    const originalText = btn.innerHTML;
    
    try {
        // Get and validate domain
        let domain = document.getElementById('domain').value.trim();
        
        if (!domain) {
            showError('Please enter a domain to analyze');
            return;
        }
        
        // Add protocol if missing
        if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
            domain = 'https://' + domain;
        }
        
        // Validate URL format
        try {
            new URL(domain);
        } catch (err) {
            showError('Please enter a valid domain (e.g., example.com or https://example.com)');
            return;
        }
        
        // Get plan from URL
        const urlParams = new URLSearchParams(window.location.search);
        const plan = urlParams.get('plan') || 'diy';
        
        // Disable button and show loading
        btn.disabled = true;
        btn.innerHTML = '<div class="loading-spinner"></div>Creating checkout session...';
        
        // Get auth token
        const authToken = localStorage.getItem('authToken');

        if (!authToken) {
            throw new Error('Please log in to continue');
        }

        // Create Stripe checkout session
        const response = await fetch(`${API_BASE_URL}/api/subscription/create-checkout-session`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                domain: domain,
                plan: plan
            })
        });

        console.log('Checkout response status:', response.status);
        console.log('Checkout response headers:', Object.fromEntries(response.headers.entries()));

        const data = await response.json();
        console.log('Checkout response data:', data);

        if (!response.ok) {
            throw new Error(data.error || 'Failed to create checkout session');
        }
        
        // Redirect to Stripe checkout
        if (data.url) {
            window.location.href = data.url;
        } else {
            throw new Error('No checkout URL received');
        }
        
    } catch (error) {
        console.error('Checkout error:', error);
        showError(error.message || 'Failed to process checkout. Please try again.');
        
        // Re-enable button
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Show error message
function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';

    // Auto-hide after 5 seconds
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);

    // Scroll to error
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Xeo-branded alert modal
function showAlertModal(title, message, type = 'info') {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;';

        const icons = {
            success: '✅',
            error: '❌',
            info: 'ℹ️',
            warning: '⚠️'
        };

        const icon = icons[type] || icons.info;

        modal.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 12px; max-width: 450px; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
                <div style="display: flex; align-items: flex-start; gap: 15px; margin-bottom: 20px;">
                    <span style="font-size: 28px; line-height: 1;">${icon}</span>
                    <div style="flex: 1;">
                        <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 10px; color: #2d3748;">${title}</h3>
                        <p style="color: #4a5568; line-height: 1.6; white-space: pre-line;">${message}</p>
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end;">
                    <button id="okBtn" style="padding: 12px 30px; border-radius: 8px; border: none; background: linear-gradient(135deg, #00B9DA 0%, #f31c7e 100%); color: white; font-weight: 600; cursor: pointer; font-size: 15px; transition: transform 0.2s;">
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

        okBtn.onmouseenter = () => okBtn.style.transform = 'scale(1.05)';
        okBtn.onmouseleave = () => okBtn.style.transform = 'scale(1)';

        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(true);
            }
        };

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