/**
 * Start Submissions Flow
 *
 * Handles the UI for starting directory submissions:
 * - Check entitlement
 * - Check active campaigns
 * - Start new campaign
 * - Display results
 */

const StartSubmissions = {
  API_BASE_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : 'https://ai-visibility-tool.onrender.com',

  state: {
    entitlement: null,
    activeCampaign: null,
    isLoading: false,
    counts: null
  },

  /**
   * Initialize the component
   */
  async init() {
    await this.loadData();
    this.render();
  },

  /**
   * Load entitlement and active campaign data
   */
  async loadData() {
    const authToken = localStorage.getItem('authToken');
    if (!authToken) return;

    const headers = { 'Authorization': `Bearer ${authToken}` };

    try {
      // Load data in parallel
      const [entitlementRes, activeCampaignRes, countsRes] = await Promise.all([
        fetch(`${this.API_BASE_URL}/api/citation-network/entitlement`, { headers }),
        fetch(`${this.API_BASE_URL}/api/citation-network/active-campaign`, { headers }),
        fetch(`${this.API_BASE_URL}/api/citation-network/submissions/counts`, { headers })
      ]);

      if (entitlementRes.ok) {
        const data = await entitlementRes.json();
        this.state.entitlement = data.entitlement;
      }

      if (activeCampaignRes.ok) {
        const data = await activeCampaignRes.json();
        this.state.activeCampaign = data.activeCampaign;
      }

      if (countsRes.ok) {
        const data = await countsRes.json();
        this.state.counts = data.counts;
      }
    } catch (error) {
      console.error('Failed to load start submissions data:', error);
    }
  },

  /**
   * Start submissions
   */
  async startSubmissions(filters = {}) {
    const authToken = localStorage.getItem('authToken');
    if (!authToken) {
      window.location.href = '/auth.html?redirect=' + encodeURIComponent(window.location.href);
      return;
    }

    this.state.isLoading = true;
    this.render();

    try {
      const response = await fetch(`${this.API_BASE_URL}/api/citation-network/start-submissions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filters })
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle redirects
        if (data.redirect) {
          window.location.href = data.redirect;
          return;
        }

        throw new Error(data.error || 'Failed to start submissions');
      }

      // Success - show modal and refresh data
      this.showSuccessModal(data);
      await this.loadData();
      this.render();

      // Refresh the submissions table if it exists
      if (window.SubmissionsTable && typeof window.SubmissionsTable.refresh === 'function') {
        window.SubmissionsTable.refresh();
      }

    } catch (error) {
      console.error('Start submissions error:', error);
      this.showError(error.message);
    } finally {
      this.state.isLoading = false;
      this.render();
    }
  },

  /**
   * Render the start submissions button and info
   */
  render() {
    const container = document.getElementById('start-submissions-container');
    if (!container) return;

    const { entitlement, activeCampaign, isLoading, counts } = this.state;

    // Determine button state
    let buttonText = 'Start Submissions';
    let buttonDisabled = false;
    let buttonClass = 'btn-primary';
    let infoText = '';

    if (isLoading) {
      buttonText = '<span class="loading-spinner"></span> Starting...';
      buttonDisabled = true;
    } else if (activeCampaign) {
      buttonText = 'Submissions In Progress';
      buttonDisabled = true;
      buttonClass = 'btn-secondary';
      infoText = 'You have an active campaign running. Check the progress below.';
    } else if (!entitlement || entitlement.remaining <= 0) {
      buttonText = 'No Submissions Available';
      buttonDisabled = true;
      buttonClass = 'btn-secondary';
      infoText = '<a href="/citation-network.html">Purchase a directory pack</a> to start submitting.';
    }

    const entitlementInfo = entitlement
      ? `<p class="entitlement-info"><strong>${entitlement.remaining}</strong> directories available${entitlement.isSubscriber ? ' this month' : ''}</p>`
      : '';

    const countsInfo = counts && counts.total > 0
      ? `<div class="submission-stats">
          <span class="stat"><strong>${counts.queued || 0}</strong> queued</span>
          <span class="stat"><strong>${counts.live || 0}</strong> live</span>
          <span class="stat ${(counts.action_needed || 0) > 0 ? 'highlight' : ''}"><strong>${counts.action_needed || 0}</strong> need action</span>
         </div>`
      : '';

    container.innerHTML = `
      <div class="start-submissions-section">
        ${entitlementInfo}
        ${countsInfo}
        <button
          id="start-submissions-btn"
          class="btn ${buttonClass} btn-lg"
          ${buttonDisabled ? 'disabled' : ''}
        >
          ${buttonText}
        </button>
        ${infoText ? `<p class="hint">${infoText}</p>` : ''}
      </div>
    `;

    // Add click handler
    const btn = document.getElementById('start-submissions-btn');
    if (btn && !buttonDisabled) {
      btn.addEventListener('click', () => this.startSubmissions());
    }
  },

  /**
   * Show success modal
   */
  showSuccessModal(result) {
    // Remove existing modal
    const existingModal = document.getElementById('submissions-success-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'submissions-success-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>Submissions Started!</h2>
        </div>
        <div class="modal-body">
          <p class="success-count">
            <strong>${result.directoriesQueued}</strong> directories queued for submission
          </p>
          <p>We'll submit to directories at a pace of ~3-5 per day to ensure quality.</p>
          <p class="remaining">
            ${result.entitlementRemaining} submissions remaining${this.state.entitlement?.isSubscriber ? ' this month' : ''}
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" id="close-success-modal">
            View Progress
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Add close handler
    document.getElementById('close-success-modal').addEventListener('click', () => {
      modal.remove();
    });

    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  },

  /**
   * Show error message
   */
  showError(message) {
    // Remove existing error
    const existingError = document.getElementById('submissions-error');
    if (existingError) existingError.remove();

    const errorDiv = document.createElement('div');
    errorDiv.id = 'submissions-error';
    errorDiv.className = 'error-toast';
    errorDiv.innerHTML = `
      <span>${message}</span>
      <button class="close-btn" onclick="this.parentElement.remove()">&times;</button>
    `;

    document.body.appendChild(errorDiv);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (errorDiv.parentElement) errorDiv.remove();
    }, 5000);
  }
};

/**
 * Submission Tracking Table
 */
const SubmissionsTable = {
  API_BASE_URL: StartSubmissions.API_BASE_URL,

  state: {
    submissions: [],
    counts: null,
    filter: null,
    isLoading: false
  },

  /**
   * Initialize the table
   */
  async init(filter = null) {
    this.state.filter = filter;
    await this.loadData();
    this.render();
  },

  /**
   * Load submissions data
   */
  async loadData() {
    const authToken = localStorage.getItem('authToken');
    if (!authToken) return;

    this.state.isLoading = true;

    const headers = { 'Authorization': `Bearer ${authToken}` };

    try {
      const filterParam = this.state.filter ? `?status=${this.state.filter}` : '';

      const [submissionsRes, countsRes] = await Promise.all([
        fetch(`${this.API_BASE_URL}/api/citation-network/campaign-submissions${filterParam}`, { headers }),
        fetch(`${this.API_BASE_URL}/api/citation-network/submissions/counts`, { headers })
      ]);

      if (submissionsRes.ok) {
        const data = await submissionsRes.json();
        this.state.submissions = data.submissions || [];
      }

      if (countsRes.ok) {
        const data = await countsRes.json();
        this.state.counts = data.counts;
      }
    } catch (error) {
      console.error('Failed to load submissions:', error);
    } finally {
      this.state.isLoading = false;
    }
  },

  /**
   * Refresh the table
   */
  async refresh() {
    await this.loadData();
    this.render();
  },

  /**
   * Set filter and reload
   */
  async setFilter(filter) {
    this.state.filter = filter;
    await this.loadData();
    this.render();

    // Update URL
    const url = new URL(window.location.href);
    if (filter) {
      url.searchParams.set('filter', filter);
    } else {
      url.searchParams.delete('filter');
    }
    history.replaceState(null, '', url.toString());
  },

  /**
   * Render the table
   */
  render() {
    const container = document.getElementById('submissions-table-container');
    if (!container) return;

    const { submissions, counts, filter, isLoading } = this.state;

    // Status configuration
    const STATUS_CONFIG = {
      queued: { label: 'Queued', color: 'gray', icon: '&#x23F3;' },
      in_progress: { label: 'Processing', color: 'blue', icon: '&#x1F504;' },
      submitted: { label: 'Submitted', color: 'blue', icon: '&#x1F4E4;' },
      pending_approval: { label: 'Pending', color: 'blue', icon: '&#x23F3;' },
      pending_verification: { label: 'Verifying', color: 'yellow', icon: '&#x2709;' },
      action_needed: { label: 'Action Needed', color: 'orange', icon: '&#x26A0;' },
      needs_action: { label: 'Action Needed', color: 'orange', icon: '&#x26A0;' },
      live: { label: 'Live', color: 'green', icon: '&#x2713;' },
      verified: { label: 'Live', color: 'green', icon: '&#x2713;' },
      rejected: { label: 'Rejected', color: 'red', icon: '&#x2717;' },
      failed: { label: 'Failed', color: 'red', icon: '&#x26A0;' },
      blocked: { label: 'Blocked', color: 'red', icon: '&#x1F6AB;' },
      skipped: { label: 'Skipped', color: 'gray', icon: '&#x21AA;' },
      cancelled: { label: 'Cancelled', color: 'gray', icon: '&#x2717;' }
    };

    // Tabs
    const tabs = `
      <div class="tabs">
        <a href="#" class="tab ${!filter ? 'active' : ''}" data-filter="">
          All <span class="count">${counts?.total || 0}</span>
        </a>
        <a href="#" class="tab ${filter === 'action_needed,needs_action' ? 'active' : ''} ${(counts?.action_needed || 0) > 0 ? 'highlight' : ''}" data-filter="action_needed,needs_action">
          Action Needed <span class="count">${counts?.action_needed || 0}</span>
        </a>
        <a href="#" class="tab ${filter === 'live,verified' ? 'active' : ''}" data-filter="live,verified">
          Live <span class="count">${(counts?.live || 0) + (counts?.verified || 0)}</span>
        </a>
        <a href="#" class="tab ${filter === 'queued,in_progress' ? 'active' : ''}" data-filter="queued,in_progress">
          Queued <span class="count">${(counts?.queued || 0) + (counts?.in_progress || 0)}</span>
        </a>
        <a href="#" class="tab ${filter === 'blocked,failed' ? 'active' : ''}" data-filter="blocked,failed">
          Blocked <span class="count">${(counts?.blocked || 0) + (counts?.failed || 0)}</span>
        </a>
      </div>
    `;

    // Table content
    let tableContent;
    if (isLoading) {
      tableContent = '<div class="loading">Loading submissions...</div>';
    } else if (submissions.length === 0) {
      tableContent = `
        <div class="empty-state">
          <p>No submissions yet. Click "Start Submissions" to begin building your citation network.</p>
        </div>
      `;
    } else {
      const rows = submissions.map(s => {
        const status = STATUS_CONFIG[s.status] || STATUS_CONFIG.queued;
        const dirName = s.directory_name || s.directory_snapshot?.name || 'Unknown Directory';
        const dirLogo = s.directory_logo || '';
        const dirUrl = s.directory_website || s.directory_snapshot?.website_url || '';

        const dateStr = this.formatDate(s.submitted_at || s.queued_at || s.created_at);
        const deadlineStr = s.action_deadline ? this.formatDeadline(s.action_deadline) : '';

        return `
          <tr>
            <td class="directory-cell">
              ${dirLogo ? `<img src="${dirLogo}" alt="" class="directory-logo" />` : '<div class="directory-logo-placeholder"></div>'}
              <div>
                <strong>${this.escapeHtml(dirName)}</strong>
                ${s.listing_url ? `<a href="${s.listing_url}" target="_blank" rel="noopener noreferrer">View listing</a>` : ''}
              </div>
            </td>
            <td>
              <span class="status-badge status-${status.color}">
                ${status.icon} ${status.label}
              </span>
              ${deadlineStr ? `<span class="deadline">${deadlineStr}</span>` : ''}
            </td>
            <td>${dateStr}</td>
            <td>
              ${s.status === 'action_needed' || s.status === 'needs_action'
                ? `<button class="btn btn-sm btn-action" onclick="SubmissionsTable.handleAction('${s.id}')">${this.getActionLabel(s.action_type)}</button>`
                : (dirUrl ? `<a href="${dirUrl}" target="_blank" class="btn btn-sm btn-link">View Site</a>` : '')}
            </td>
          </tr>
        `;
      }).join('');

      tableContent = `
        <table class="submissions-table">
          <thead>
            <tr>
              <th>Directory</th>
              <th>Status</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      `;
    }

    container.innerHTML = `
      <div class="submission-tracking">
        ${tabs}
        ${tableContent}
      </div>
    `;

    // Add tab click handlers
    container.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        const newFilter = tab.dataset.filter || null;
        this.setFilter(newFilter);
      });
    });
  },

  /**
   * Handle action button click
   */
  handleAction(submissionId) {
    // Find the submission
    const submission = this.state.submissions.find(s => s.id === submissionId);
    if (!submission) return;

    // Show action instructions if available
    if (submission.action_instructions || submission.action_url) {
      alert(submission.action_instructions || `Please visit: ${submission.action_url}`);
    } else {
      alert('Please check your email for verification instructions.');
    }
  },

  /**
   * Format date for display
   */
  formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  },

  /**
   * Format deadline relative to now
   */
  formatDeadline(dateStr) {
    const deadline = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'Expired';
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return '1 day left';
    return `${diffDays} days left`;
  },

  /**
   * Get action button label
   */
  getActionLabel(actionType) {
    const labels = {
      email_verify: 'Verify Email',
      phone_verify: 'Phone Call',
      complete_profile: 'Complete Profile',
      approve_listing: 'Approve',
      captcha: 'Solve CAPTCHA',
      manual_review: 'Review'
    };
    return labels[actionType] || 'Take Action';
  },

  /**
   * Escape HTML
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

// Make available globally
window.StartSubmissions = StartSubmissions;
window.SubmissionsTable = SubmissionsTable;

// Auto-initialize if containers exist
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('start-submissions-container')) {
    StartSubmissions.init();
  }
  if (document.getElementById('submissions-table-container')) {
    // Get filter from URL
    const urlParams = new URLSearchParams(window.location.search);
    const filter = urlParams.get('filter') || null;
    SubmissionsTable.init(filter);
  }
});
