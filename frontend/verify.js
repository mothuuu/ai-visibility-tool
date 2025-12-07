const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : 'https://ai-visibility-tool.onrender.com/api';

// Get URL parameters
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');
const scanUrl = urlParams.get('scanUrl');

// Show email from localStorage or URL
const user = JSON.parse(localStorage.getItem('user') || '{}');
document.getElementById('userEmail').textContent = user.email || 'your email address';

// If token in URL, auto-verify
if (token) {
    verifyEmailWithToken(token);
} else {
    // Just show the waiting screen
    document.getElementById('mainContent').style.display = 'block';
}

// Verify email with token
async function verifyEmailWithToken(verificationToken) {
    const mainContent = document.getElementById('mainContent');
    const verifyingState = document.getElementById('verifyingState');
    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');

    // Show spinner
    mainContent.style.display = 'none';
    verifyingState.style.display = 'block';

    try {
        const response = await fetch(`${API_BASE_URL}/auth/verify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: verificationToken })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Verification failed');
        }

        // Success! Update user in localStorage
        const updatedUser = { ...user, email_verified: true };
        localStorage.setItem('user', JSON.stringify(updatedUser));

        // Show success message
        verifyingState.style.display = 'none';
        mainContent.style.display = 'block';
        successMessage.style.display = 'block';

        // Redirect after 2 seconds
        setTimeout(() => {
            if (scanUrl) {
                // User was trying to scan something
                window.location.href = `dashboard.html?scanUrl=${encodeURIComponent(scanUrl)}`;
            } else {
                window.location.href = 'dashboard.html';
            }
        }, 2000);

    } catch (error) {
        console.error('Verification error:', error);
        
        verifyingState.style.display = 'none';
        mainContent.style.display = 'block';
        errorMessage.textContent = '❌ ' + error.message;
        errorMessage.style.display = 'block';
    }
}

// Resend verification email
document.getElementById('resendBtn').addEventListener('click', async function() {
    const btn = this;
    const errorMessage = document.getElementById('errorMessage');
    const successMessage = document.getElementById('successMessage');
    const authToken = localStorage.getItem('authToken');

    if (!authToken) {
        errorMessage.textContent = '❌ Please log in again';
        errorMessage.style.display = 'block';
        setTimeout(() => {
            window.location.href = 'auth.html';
        }, 2000);
        return;
    }

    // Disable button
    btn.disabled = true;
    btn.textContent = '⏳ Sending...';
    errorMessage.style.display = 'none';
    successMessage.style.display = 'none';

    try {
        const response = await fetch(`${API_BASE_URL}/auth/resend-verification`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to resend email');
        }

        // Show success
        successMessage.textContent = '✅ Verification email sent! Please check your inbox.';
        successMessage.style.display = 'block';
        btn.textContent = '✓ Email Sent!';

        // Re-enable after 30 seconds
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = '🔄 Resend Verification Email';
        }, 30000);

    } catch (error) {
        console.error('Resend error:', error);
        errorMessage.textContent = '❌ ' + error.message;
        errorMessage.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '🔄 Resend Verification Email';
    }
});

// Check if user is already verified (shouldn't be on this page)
if (user.email_verified === true) {
    window.location.href = 'dashboard.html';
}