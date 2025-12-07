const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : 'https://ai-visibility-tool.onrender.com';

let pollingInterval;
let pollingAttempts = 0;
const MAX_POLLING_ATTEMPTS = 30; // 30 attempts × 2 seconds = 1 minute

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
    // Get session ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    
    if (!sessionId) {
        showError('No payment session found');
        return;
    }
    
    // Start polling for webhook completion
    startPolling(sessionId);
});

// Start polling for subscription verification
function startPolling(sessionId) {
    pollingInterval = setInterval(async () => {
        pollingAttempts++;
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/subscription/verify-session`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ sessionId })
            });
            
            const data = await response.json();
            
            if (response.ok && data.verified) {
                // Subscription verified!
                clearInterval(pollingInterval);
                showVerified(data);
            } else if (pollingAttempts >= MAX_POLLING_ATTEMPTS) {
                // Timeout - stop polling
                clearInterval(pollingInterval);
                showTimeout();
            }
            
        } catch (error) {
            console.error('Polling error:', error);
            
            if (pollingAttempts >= MAX_POLLING_ATTEMPTS) {
                clearInterval(pollingInterval);
                showTimeout();
            }
        }
    }, 2000); // Poll every 2 seconds
}

// Show verified state
function showVerified(data) {
    // Update status box
    const statusBox = document.getElementById('statusBox');
    statusBox.className = 'status-box verified';
    statusBox.innerHTML = `
        <h3>✅ Subscription Verified!</h3>
        <p>Your account has been successfully upgraded. You can now start analyzing your website.</p>
    `;
    
    // Update progress steps
    const steps = document.querySelectorAll('.progress-step');
    steps.forEach(step => step.classList.add('completed'));
    
    // Enable continue button
    const continueBtn = document.getElementById('continueBtn');
    continueBtn.disabled = false;
    
    // Store domain for page selector
    if (data.domain) {
        sessionStorage.setItem('scanDomain', data.domain);
    }
}

// Show timeout state
function showTimeout() {
    const statusBox = document.getElementById('statusBox');
    statusBox.className = 'status-box processing';
    statusBox.innerHTML = `
        <h3>⏱️ Taking Longer Than Expected</h3>
        <p>Your payment was successful, but we're still verifying your subscription. This sometimes takes a few minutes.</p>
        <p style="margin-top: 15px;">
            <strong>What you can do:</strong><br>
            • Check your dashboard - your subscription may already be active<br>
            • Wait a few more minutes and refresh this page<br>
            • Contact support if the issue persists
        </p>
    `;
    
    // Enable dashboard button
    document.querySelector('.btn-secondary').textContent = 'Check Dashboard';
}

// Show error state
function showError(message) {
    const statusBox = document.getElementById('statusBox');
    statusBox.className = 'status-box processing';
    statusBox.innerHTML = `
        <h3>⚠️ Error</h3>
        <p>${message}</p>
        <p style="margin-top: 15px;">
            Please go to your dashboard or contact support if you need assistance.
        </p>
    `;
}

// Proceed to page selector
function proceedToPageSelector() {
    const domain = sessionStorage.getItem('scanDomain');
    
    if (domain) {
        window.location.href = `page-selector.html?domain=${encodeURIComponent(domain)}`;
    } else {
        // No domain stored, go to dashboard
        window.location.href = 'dashboard.html';
    }
}