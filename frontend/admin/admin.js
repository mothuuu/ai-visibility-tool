// Admin Dashboard Shared JavaScript Utilities

const API_BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3001/api'
    : 'https://ai-visibility-tool.onrender.com/api';

// Get auth token from localStorage
function getAuthToken() {
    return localStorage.getItem('authToken');
}

// Check if user is authenticated admin
async function checkAdminAuth() {
    const token = getAuthToken();

    if (!token) {
        redirectToLogin();
        return null;
    }

    try {
        // Verify admin access with a simple API call
        const response = await fetch(`${API_BASE_URL}/admin/overview`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                // Not authenticated or not an admin
                localStorage.removeItem('authToken');
                redirectToLogin();
                return null;
            }
            throw new Error('Failed to verify admin access');
        }

        return token;
    } catch (error) {
        console.error('Admin auth check failed:', error);
        redirectToLogin();
        return null;
    }
}

// Redirect to login page
function redirectToLogin() {
    window.location.href = './login.html';
}

// Logout function
function logout() {
    localStorage.removeItem('authToken');
    redirectToLogin();
}

// Make authenticated API request
async function apiRequest(endpoint, options = {}) {
    const token = getAuthToken();

    if (!token) {
        redirectToLogin();
        throw new Error('No auth token');
    }

    const defaultHeaders = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            ...defaultHeaders,
            ...options.headers
        }
    });

    if (response.status === 401 || response.status === 403) {
        // Token expired or no permission
        localStorage.removeItem('authToken');
        redirectToLogin();
        throw new Error('Authentication failed');
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'Request failed');
    }

    return response.json();
}

// Format currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

// Format number with commas
function formatNumber(num) {
    return new Intl.NumberFormat('en-US').format(num);
}

// Format date
function formatDate(dateString) {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Format full date
function formatFullDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Show toast notification
function showToast(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    // Add styles
    const styles = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#00B9DA'};
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        font-weight: 600;
        font-size: 14px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    toast.style.cssText = styles;

    // Add to page
    document.body.appendChild(toast);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Add CSS animations
if (!document.getElementById('toast-animations')) {
    const style = document.createElement('style');
    style.id = 'toast-animations';
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(400px);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
}

// Get plan badge HTML
function getPlanBadge(plan) {
    const badges = {
        free: '<span class="badge badge-free">Free</span>',
        diy: '<span class="badge badge-diy">DIY</span>',
        pro: '<span class="badge badge-pro">Pro</span>'
    };
    return badges[plan] || badges.free;
}

// Get status badge HTML
function getStatusBadge(status) {
    const badges = {
        active: '<span class="badge badge-active">● Active</span>',
        inactive: '<span class="badge badge-inactive">● Inactive</span>',
        at_risk: '<span class="badge badge-at-risk">⚠ At Risk</span>'
    };
    return badges[status] || badges.inactive;
}

// Show loading state
function showLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <p>Loading...</p>
            </div>
        `;
    }
}

// Show error state
function showError(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = `
            <div class="error-message">
                <strong>Error:</strong> ${message}
            </div>
        `;
    }
}

// Initialize sidebar navigation
function initSidebar(activePage) {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        const href = item.getAttribute('href');
        if (href && href.includes(activePage)) {
            item.classList.add('active');
        }
    });
}

// Export functions for use in other scripts
window.AdminUtils = {
    API_BASE_URL,
    getAuthToken,
    checkAdminAuth,
    redirectToLogin,
    logout,
    apiRequest,
    formatCurrency,
    formatNumber,
    formatDate,
    formatFullDate,
    showToast,
    getPlanBadge,
    getStatusBadge,
    showLoading,
    showError,
    initSidebar
};
