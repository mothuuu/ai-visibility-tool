const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : 'https://ai-visibility-tool.onrender.com/api';

// Get token from URL
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');

// Redirect if no token
if (!token) {
    alert('Invalid reset link. Please request a new password reset.');
    window.location.href = 'forgot-password.html';
}

function showError(message) {
    const errorEl = document.getElementById('errorMessage');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    document.getElementById('successMessage').style.display = 'none';
}

function showSuccess(message) {
    const successEl = document.getElementById('successMessage');
    successEl.textContent = message;
    successEl.style.display = 'block';
    document.getElementById('errorMessage').style.display = 'none';
}

function hideMessages() {
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('successMessage').style.display = 'none';
}

// Password strength checker
document.getElementById('newPassword').addEventListener('input', function(e) {
    const password = e.target.value;
    const strengthDiv = document.getElementById('passwordStrength');
    
    if (password.length === 0) {
        strengthDiv.style.display = 'none';
        return;
    }
    
    let strength = 0;
    
    // Length
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    
    // Contains number
    if (/\d/.test(password)) strength++;
    
    // Contains uppercase and lowercase
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
    
    // Contains special character
    if (/[^A-Za-z0-9]/.test(password)) strength++;
    
    strengthDiv.className = 'password-strength';
    
    if (strength <= 2) {
        strengthDiv.classList.add('weak');
        strengthDiv.textContent = '⚠️ Weak password - Add numbers, uppercase, and special characters';
    } else if (strength <= 4) {
        strengthDiv.classList.add('medium');
        strengthDiv.textContent = '✓ Medium strength - Consider adding more characters';
    } else {
        strengthDiv.classList.add('strong');
        strengthDiv.textContent = '✅ Strong password!';
    }
});

// Handle form submission
document.getElementById('resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessages();
    
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    // Validate passwords match
    if (newPassword !== confirmPassword) {
        showError('Passwords do not match');
        return;
    }
    
    // Validate minimum length
    if (newPassword.length < 8) {
        showError('Password must be at least 8 characters');
        return;
    }
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Resetting password...';
    
    try {
        const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
                password: newPassword
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Password reset failed');
        }
        
        // Success!
        showSuccess('✅ Password reset successfully! Redirecting to login...');
        
        // Clear form
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        
        // Redirect to login after 2 seconds
        setTimeout(() => {
            window.location.href = 'auth.html?reset=success';
        }, 2000);
        
    } catch (error) {
        showError(error.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reset Password';
    }
});