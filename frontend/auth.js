// API Configuration - Dynamic based on environment
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : 'https://ai-visibility-tool.onrender.com/api';

// Industry categories for signup dropdown
const INDUSTRY_CATEGORIES = [
  { category: 'Ecommerce & Retail', industries: ['Ecommerce', 'Marketplace Platform', 'Retail'] },
  { category: 'Education', industries: ['Corporate Training', 'EdTech / Education Technology', 'Education / Training'] },
  { category: 'Finance & Banking', industries: ['Accounting', 'Accounting Software', 'Banking', 'Finance', 'FinTech / Financial Technology', 'Insurance', 'InsurTech / Insurance Technology', 'Wealth Management'] },
  { category: 'Hardware & Equipment', industries: ['Computer Hardware', 'Enterprise Hardware', 'ICT Hardware', 'Networking Equipment'] },
  { category: 'Healthcare', industries: ['Healthcare / Medical Services', 'HealthTech / Healthcare Technology', 'Medical Devices', 'Telemedicine'] },
  { category: 'Hospitality', industries: ['Hospitality'] },
  { category: 'Infrastructure & Cloud', industries: ['Cloud Infrastructure', 'Data Infrastructure', 'Digital Infrastructure', 'Network Infrastructure'] },
  { category: 'Marketing & Advertising', industries: ['Content Marketing', 'Marketing Agency', 'MarTech / Marketing Technology', 'Media & Advertising', 'Public Relations'] },
  { category: 'Nonprofit & Government', industries: ['Government / Public Sector', 'Nonprofit Organization'] },
  { category: 'Operations & Logistics', industries: ['Logistics / Supply Chain', 'Manufacturing', 'Transportation', 'Warehouse Management'] },
  { category: 'Professional Services', industries: ['Accounting Services', 'Consulting', 'HR / Recruiting', 'HR Technology / HCM', 'IT Staffing', 'Legal / Law Firm', 'LegalTech / Legal Technology', 'Managed Service Providers (MSP)'] },
  { category: 'Real Estate & Construction', industries: ['Construction', 'Construction Technology', 'PropTech / Property Technology', 'Real Estate'] },
  { category: 'Sales & Customer', industries: ['Customer Success Platform', 'Customer Support', 'Sales Technology / CRM'] },
  { category: 'Technology & Software', industries: ['AI / Machine Learning', 'Computer Hardware & Software', 'Cybersecurity', 'Data & Analytics', 'Developer Tools / DevOps', 'IT Services', 'SaaS / Cloud Software'] },
  { category: 'Telecommunications', industries: ['Mobile Connectivity/eSIM', 'Telecom Reseller', 'Telecommunications', 'Telecom Software', 'Unified Communications', 'VoIP / Cloud Communications'] },
  { category: 'Utilities & Energy', industries: ['Energy', 'Power & Electric', 'Utilities', 'Water & Wastewater'] }
];

// UI Elements
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');

// Switch between login and signup tabs
function switchTab(tab) {
  const loginTab = document.querySelectorAll('.auth-tab')[0];
  const signupTab = document.querySelectorAll('.auth-tab')[1];
  
  if (tab === 'login') {
    loginTab.classList.add('active');
    signupTab.classList.remove('active');
    loginForm.classList.add('active');
    signupForm.classList.remove('active');
  } else {
    signupTab.classList.add('active');
    loginTab.classList.remove('active');
    signupForm.classList.add('active');
    loginForm.classList.remove('active');
  }
  
  // Clear messages when switching tabs
  hideMessages();
}

// Show error message
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
  successMessage.style.display = 'none';
  
  // Scroll to top to show message
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Show success message
function showSuccess(message) {
  successMessage.textContent = message;
  successMessage.style.display = 'block';
  errorMessage.style.display = 'none';
  
  // Scroll to top to show message
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Hide all messages
function hideMessages() {
  errorMessage.style.display = 'none';
  successMessage.style.display = 'none';
}

// Handle Login Form Submission
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessages();
  
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  
  // Client-side validation
  if (!email || !password) {
    showError('Please enter both email and password');
    return;
  }
  
  // Disable submit button
  const submitBtn = loginForm.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in...';
  
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }
    
    if (data.success && data.accessToken) {
      // Store token in localStorage
      localStorage.setItem('authToken', data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      
      // Show success message
      showSuccess('Login successful! Redirecting...');
      
      // Redirect to dashboard after 1 second
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 1000);
    } else {
      throw new Error('Invalid response from server');
    }
    
  } catch (error) {
    showError(error.message || 'Login failed. Please try again.');
    submitBtn.disabled = false;
    submitBtn.textContent = originalBtnText;
  }
});

// Handle Signup Form Submission
signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessages();
  
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const confirmPassword = document.getElementById('signupPasswordConfirm').value;
  const industry = document.getElementById('signupIndustry').value;
  const industryCustom = document.getElementById('signupIndustryCustom').value.trim();

  // Client-side validation
  if (!email || !password || !confirmPassword) {
    showError('Please fill in all fields');
    return;
  }

  // Strong password validation
  if (password.length < 8) {
    showError('Password must be at least 8 characters');
    return;
  }

  // Check for strong password requirements
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[^A-Za-z0-9]/.test(password);

  if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecialChar) {
    showError('Password must include uppercase, lowercase, number, and special character');
    return;
  }

  if (password !== confirmPassword) {
    showError('Passwords do not match');
    return;
  }

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showError('Please enter a valid email address');
    return;
  }

  // Validate custom industry if "Other" is selected
  if (industry === 'Other' && !industryCustom) {
    showError('Please specify your industry');
    return;
  }

  // Disable submit button
  const submitBtn = signupForm.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account...';

  // Prepare signup data
  const signupData = {
    email,
    password,
    name: email.split('@')[0] // Use email prefix as name
  };

  // Add industry if provided
  if (industry) {
    signupData.industry = industry === 'Other' ? industryCustom : industry;
    if (industry === 'Other') {
      signupData.industryCustom = industryCustom;
    }
  }

  // Add tracking data
  const trackingData = getTrackingData();
  Object.assign(signupData, trackingData);

  console.log('📝 Signup data with tracking:', signupData);

  try {
    const response = await fetch(`${API_URL}/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(signupData)
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Signup failed');
    }
    
    if (data.success && data.accessToken) {
      // Store token in localStorage
      localStorage.setItem('authToken', data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      
      // Show success message
      showSuccess('Account created! Please check your email to verify your account. Redirecting...');
      
      // Redirect to dashboard after 2 seconds
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 2000);
    } else {
      throw new Error('Invalid response from server');
    }
    
  } catch (error) {
    showError(error.message || 'Signup failed. Please try again.');
    submitBtn.disabled = false;
    submitBtn.textContent = originalBtnText;
  }
});

// Populate industry dropdown
function populateIndustryDropdown() {
  const select = document.getElementById('signupIndustry');
  if (!select) return;

  // Add optgroups for each category
  INDUSTRY_CATEGORIES.forEach(category => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = category.category;

    category.industries.forEach(industry => {
      const option = document.createElement('option');
      option.value = industry;
      option.textContent = industry;
      optgroup.appendChild(option);
    });

    select.appendChild(optgroup);
  });

  // Add "Other" option at the end
  const otherOption = document.createElement('option');
  otherOption.value = 'Other';
  otherOption.textContent = 'Other (please specify)';
  select.appendChild(otherOption);
}

// Handle industry dropdown change (show/hide custom field)
function handleIndustryChange() {
  const select = document.getElementById('signupIndustry');
  const customGroup = document.getElementById('customIndustryGroup');

  if (!select || !customGroup) return;

  select.addEventListener('change', () => {
    if (select.value === 'Other') {
      customGroup.style.display = 'block';
      document.getElementById('signupIndustryCustom').setAttribute('required', 'required');
    } else {
      customGroup.style.display = 'none';
      document.getElementById('signupIndustryCustom').removeAttribute('required');
      document.getElementById('signupIndustryCustom').value = '';
    }
  });
}

// Capture UTM parameters and tracking data
function captureTrackingData() {
  const urlParams = new URLSearchParams(window.location.search);

  const trackingData = {
    utm_source: urlParams.get('utm_source') || urlParams.get('source'),
    utm_medium: urlParams.get('utm_medium') || urlParams.get('medium'),
    utm_campaign: urlParams.get('utm_campaign') || urlParams.get('campaign'),
    utm_content: urlParams.get('utm_content'),
    utm_term: urlParams.get('utm_term'),
    affiliate_id: urlParams.get('ref') || urlParams.get('affiliate') || urlParams.get('aff'),
    referrer: document.referrer || null,
    landing_page: window.location.pathname
  };

  // Store in sessionStorage (persists across page navigation in same session)
  sessionStorage.setItem('trackingData', JSON.stringify(trackingData));

  console.log('📊 Tracking data captured:', trackingData);
  return trackingData;
}

// Get stored tracking data
function getTrackingData() {
  const stored = sessionStorage.getItem('trackingData');
  if (stored) {
    return JSON.parse(stored);
  }
  return captureTrackingData();
}

// Check if user is already logged in
window.addEventListener('DOMContentLoaded', () => {
  // Capture tracking data on page load
  captureTrackingData();

  // Populate industry dropdown
  populateIndustryDropdown();
  handleIndustryChange();

  const token = localStorage.getItem('authToken');
  if (token) {
    // Verify token is still valid
    fetch(`${API_URL}/auth/verify`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.authenticated) {
        // User is already logged in, redirect to dashboard
        window.location.href = 'dashboard.html';
      }
    })
    .catch(() => {
      // Token is invalid, clear it
      localStorage.removeItem('authToken');
      localStorage.removeItem('user');
    });
  }
});