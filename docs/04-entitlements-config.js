/**
 * Visible2AI - Entitlements Configuration
 * Version: 1.2.1
 * Date: 2026-01-03
 * 
 * SINGLE SOURCE OF TRUTH for all plan limits and feature access.
 * 
 * Rules:
 * - -1 means unlimited
 * - All code must import from this file
 * - No hardcoded limits anywhere else
 * - Update version when changing limits
 * 
 * Key Terms:
 * - crawlPagesPerDomain: Number of pages crawler fetches for site-level scoring
 * - pageOptimizationEnabled: Content Studio feature (separate product from scanning)
 * - aiCitationNetwork: Directory listing / citation network feature
 * - recommendationsDefaultVisible: UI display cap (what user sees by default)
 * - recommendationsMaxReturn: API return cap (ALWAYS -1 per "Never Zero" contract)
 * 
 * Critical Contracts:
 * - API always returns ALL recommendations (recommendationsMaxReturn = -1)
 * - UI may cap display, but never filter to zero
 * - Recommendations are stored first, visibility applied second
 */

const ENTITLEMENTS_VERSION = '1.2.1';

// ═══════════════════════════════════════════════════════════════════════════
// CANONICAL USAGE EVENT TYPES
// Use these exact strings in usage_events table to prevent naming drift
// 
// NOTE: Not all events are entitlement-gated. Some are analytics/health only:
// - SCAN_COMPLETED, SCAN_FAILED: For monitoring/analytics, not quota enforcement
// - EXPORT_PDF, EXPORT_CSV: Feature-gated (boolean), not quota-counted
// - DOMAIN_ADDED, DOMAIN_VERIFIED, TEAM_MEMBER_INVITED: Tracked but counted separately
// 
// Only events in getLimitKeyForEventType() are enforced against period quotas.
// ═══════════════════════════════════════════════════════════════════════════
const USAGE_EVENT_TYPES = {
  // Scanning (SCAN_CREATED = quota; COMPLETED/FAILED = analytics only)
  SCAN_CREATED: 'scan_created',
  SCAN_COMPLETED: 'scan_completed',   // Analytics/health only
  SCAN_FAILED: 'scan_failed',         // Analytics/health only
  
  // Competitor Analysis
  COMPETITOR_ADDED: 'competitor_added',           // Adding a new competitor domain to track
  COMPETITOR_SCAN_CREATED: 'competitor_scan_created', // Running a scan on a competitor
  
  // Exports
  EXPORT_PDF: 'export_pdf',
  EXPORT_CSV: 'export_csv',
  
  // BVI / AI Testing
  AI_TEST_QUERY: 'ai_test_query',
  
  // Content Studio / Page Optimization
  PAGE_OPTIMIZATION_RUN: 'page_optimization_run',
  CONTENT_CREDIT_USED: 'content_credit_used',
  
  // AI Citation Network
  DIRECTORY_LISTING_SUBMISSION: 'directory_listing_submission',
  
  // API
  API_CALL: 'api_call',
  
  // Domain
  DOMAIN_ADDED: 'domain_added',
  DOMAIN_VERIFIED: 'domain_verified',
  
  // Team
  TEAM_MEMBER_INVITED: 'team_member_invited',
};

const PLAN_ENTITLEMENTS = {
  // ═══════════════════════════════════════════════════════════════════════════
  // FREE TIER
  // ═══════════════════════════════════════════════════════════════════════════
  free: {
    // Display
    displayName: 'Free',
    description: 'Get started with basic AI visibility insights',
    
    // ─────────────────────────────────────────────────────────────────────────
    // Scanning
    // ─────────────────────────────────────────────────────────────────────────
    scansPerPeriod: 2,
    crawlPagesPerDomain: 1,       // Homepage only (crawler scope, not optimization)
    periodType: 'calendar_month', // Resets on 1st of month
    
    // ─────────────────────────────────────────────────────────────────────────
    // Recommendations (NEVER ZERO CONTRACT)
    // - API always returns ALL (recommendationsMaxReturn = -1)
    // - UI caps display (recommendationsDefaultVisible)
    // ─────────────────────────────────────────────────────────────────────────
    recommendationsDefaultVisible: 5,  // UI: "Top 5 recommendations" shown
    recommendationsMaxReturn: -1,      // API: ALWAYS return all (never filter)
    codeSnippetsEnabled: false,        // Can see copy-paste code
    
    // Audience Views
    recommendationViewDefault: 'marketing',
    marketingCopyEnabled: true,
    technicalCopyEnabled: false,  // Gated
    execCopyEnabled: false,
    
    // ─────────────────────────────────────────────────────────────────────────
    // Domains
    // ─────────────────────────────────────────────────────────────────────────
    maxDomains: 1,
    domainVerificationRequired: false,
    scanRequiresVerifiedDomain: false,  // Can scan without verification
    
    // ─────────────────────────────────────────────────────────────────────────
    // Competitors
    // - maxCompetitors: how many competitor domains you can track
    // - competitorScansPerPeriod: how many competitor scans per billing period
    // ─────────────────────────────────────────────────────────────────────────
    competitorScansEnabled: false,
    maxCompetitors: 0,
    competitorScansPerPeriod: 0,
    
    // ─────────────────────────────────────────────────────────────────────────
    // BVI (Brand Visibility Index)
    // ─────────────────────────────────────────────────────────────────────────
    bviLiteEnabled: false,
    bviFullEnabled: false,
    aiTestQueriesPerPeriod: 0,
    
    // ─────────────────────────────────────────────────────────────────────────
    // AI Citation Network (Directory Listing)
    // ─────────────────────────────────────────────────────────────────────────
    aiCitationNetworkEnabled: false,
    directoryListingEnabled: false,
    
    // ─────────────────────────────────────────────────────────────────────────
    // Page Optimization (Content Studio) - SEPARATE FROM SCANNING
    // ─────────────────────────────────────────────────────────────────────────
    pageOptimizationEnabled: false,
    maxPageOptimizationsPerPeriod: 0,
    
    // ─────────────────────────────────────────────────────────────────────────
    // Export
    // ─────────────────────────────────────────────────────────────────────────
    pdfExportEnabled: false,
    csvExportEnabled: false,
    
    // ─────────────────────────────────────────────────────────────────────────
    // History & Retention
    // ─────────────────────────────────────────────────────────────────────────
    historyRetentionDays: 30,
    scoreTrendAnalysisEnabled: false,
    
    // ─────────────────────────────────────────────────────────────────────────
    // Team
    // ─────────────────────────────────────────────────────────────────────────
    maxTeamMembers: 1,  // Just the owner
    
    // ─────────────────────────────────────────────────────────────────────────
    // API
    // ─────────────────────────────────────────────────────────────────────────
    apiAccessEnabled: false,
    apiRateLimitPerMinute: 0,
    apiRateLimitPerDay: 0,
    
    // ─────────────────────────────────────────────────────────────────────────
    // Agency
    // ─────────────────────────────────────────────────────────────────────────
    maxClients: 0,
    whitelabelEnabled: false,
    
    // ─────────────────────────────────────────────────────────────────────────
    // Content Generation
    // ─────────────────────────────────────────────────────────────────────────
    contentCreditsPerPeriod: 0,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DIY TIER ($29/month or $19/month annual)
  // For hands-on marketers optimizing their own site
  // ═══════════════════════════════════════════════════════════════════════════
  diy: {
    displayName: 'DIY',
    description: 'For hands-on marketers',
    
    // Scanning
    scansPerPeriod: 25,
    crawlPagesPerDomain: 5,       // Up to 5 pages crawled for site scoring
    periodType: 'billing_cycle',  // Resets with Stripe billing
    
    // Recommendations (NEVER ZERO CONTRACT)
    recommendationsDefaultVisible: 10,  // UI: "Up to 10 detailed recommendations"
    recommendationsMaxReturn: -1,       // API: ALWAYS return all
    codeSnippetsEnabled: true,
    recommendationViewDefault: 'marketing',
    marketingCopyEnabled: true,
    technicalCopyEnabled: true,
    execCopyEnabled: false,
    
    // Domains
    maxDomains: 1,
    domainVerificationRequired: true,
    scanRequiresVerifiedDomain: false,  // Can scan, but some features gated
    
    // Competitors
    competitorScansEnabled: true,
    maxCompetitors: 2,              // How many competitor domains you can track
    competitorScansPerPeriod: 10,   // How many competitor scans per period
    
    // BVI
    bviLiteEnabled: false,
    bviFullEnabled: false,
    aiTestQueriesPerPeriod: 0,
    
    // AI Citation Network
    aiCitationNetworkEnabled: true,
    directoryListingEnabled: true,
    
    // Page Optimization (Content Studio)
    pageOptimizationEnabled: false,
    maxPageOptimizationsPerPeriod: 0,
    
    // Export
    pdfExportEnabled: true,
    csvExportEnabled: true,
    
    // History
    historyRetentionDays: 90,
    scoreTrendAnalysisEnabled: false,
    
    // Team
    maxTeamMembers: 1,
    
    // API
    apiAccessEnabled: false,
    apiRateLimitPerMinute: 0,
    apiRateLimitPerDay: 0,
    
    // Agency
    maxClients: 0,
    whitelabelEnabled: false,
    
    // Content
    contentCreditsPerPeriod: 0,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRO TIER ($149/month or $99/month annual)
  // For growing teams with competitor analysis and BVI
  // ═══════════════════════════════════════════════════════════════════════════
  pro: {
    displayName: 'Pro',
    description: 'For growing teams',
    
    // Scanning
    scansPerPeriod: 50,
    crawlPagesPerDomain: 25,      // Up to 25 pages crawled for site scoring
    periodType: 'billing_cycle',
    
    // Recommendations (NEVER ZERO CONTRACT)
    recommendationsDefaultVisible: 25,  // UI: "Up to 25 detailed recommendations"
    recommendationsMaxReturn: -1,       // API: ALWAYS return all
    codeSnippetsEnabled: true,
    recommendationViewDefault: 'marketing',
    marketingCopyEnabled: true,
    technicalCopyEnabled: true,
    execCopyEnabled: true,
    
    // Domains
    maxDomains: 1,
    domainVerificationRequired: true,
    scanRequiresVerifiedDomain: false,
    
    // Competitors
    competitorScansEnabled: true,
    maxCompetitors: 3,              // "3 competitor analyses"
    competitorScansPerPeriod: 25,   // How many competitor scans per period
    
    // BVI
    bviLiteEnabled: true,
    bviFullEnabled: false,
    aiTestQueriesPerPeriod: 10,
    
    // AI Citation Network
    aiCitationNetworkEnabled: true,
    directoryListingEnabled: true,
    
    // Page Optimization (Content Studio)
    pageOptimizationEnabled: true,
    maxPageOptimizationsPerPeriod: 5,
    
    // Export
    pdfExportEnabled: true,
    csvExportEnabled: true,
    whitelabelReportsEnabled: false,
    
    // History
    historyRetentionDays: -1,     // Unlimited
    scoreTrendAnalysisEnabled: true,
    
    // Team
    maxTeamMembers: 3,
    
    // API
    apiAccessEnabled: false,
    apiRateLimitPerMinute: 0,
    apiRateLimitPerDay: 0,
    
    // Agency
    maxClients: 0,
    whitelabelEnabled: false,
    
    // Content
    contentCreditsPerPeriod: 5,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ENTERPRISE TIER ($499/month or $349/month annual)
  // Full-scale AI visibility for large organizations with API access
  // ═══════════════════════════════════════════════════════════════════════════
  enterprise: {
    displayName: 'Enterprise',
    description: 'For large organizations',
    
    // Scanning
    scansPerPeriod: 200,
    crawlPagesPerDomain: 100,     // Up to 100 pages crawled for site scoring
    periodType: 'billing_cycle',
    
    // Recommendations (NEVER ZERO CONTRACT)
    recommendationsDefaultVisible: -1,  // UI: Unlimited
    recommendationsMaxReturn: -1,       // API: ALWAYS return all
    codeSnippetsEnabled: true,
    recommendationViewDefault: 'marketing',
    marketingCopyEnabled: true,
    technicalCopyEnabled: true,
    execCopyEnabled: true,
    
    // Domains
    maxDomains: 3,
    domainVerificationRequired: true,
    scanRequiresVerifiedDomain: true,   // Require verification for enterprise
    
    // Competitors
    competitorScansEnabled: true,
    maxCompetitors: 10,             // "10 competitor analyses"
    competitorScansPerPeriod: 100,  // How many competitor scans per period
    
    // BVI
    bviLiteEnabled: true,
    bviFullEnabled: true,
    aiTestQueriesPerPeriod: 50,
    
    // AI Citation Network
    aiCitationNetworkEnabled: true,
    directoryListingEnabled: true,
    
    // Media & Social Tracking
    mediaTrackingEnabled: true,
    socialMediaMonitoringEnabled: true,
    
    // Page Optimization (Content Studio)
    pageOptimizationEnabled: true,
    maxPageOptimizationsPerPeriod: 100,
    
    // Export
    pdfExportEnabled: true,
    csvExportEnabled: true,
    whitelabelReportsEnabled: true,
    
    // History
    historyRetentionDays: -1,
    scoreTrendAnalysisEnabled: true,
    
    // Team
    maxTeamMembers: 10,
    
    // API
    apiAccessEnabled: true,
    apiRateLimitPerMinute: 60,
    apiRateLimitPerDay: 1000,
    
    // Agency
    maxClients: 0,
    whitelabelEnabled: false,
    
    // Content
    contentCreditsPerPeriod: 20,
    
    // Support
    prioritySupportEnabled: true,
    onboardingCallIncluded: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENCY TIER ($499/month)
  // Full white-label solution for marketing agencies & consultants
  // Includes: Pro features × 10 domains + unlimited team + whitelabel + API
  // ═══════════════════════════════════════════════════════════════════════════
  agency: {
    displayName: 'Agency',
    description: 'For agencies managing clients',
    
    // Scanning (Pro limits × 10 domains)
    scansPerPeriod: 500,          // 50 scans per domain × 10 domains
    scansPerDomainPerPeriod: 50,  // Per-domain limit
    crawlPagesPerDomain: 25,      // Same as Pro (not 100)
    periodType: 'billing_cycle',
    
    // Recommendations (NEVER ZERO CONTRACT)
    recommendationsDefaultVisible: -1,
    recommendationsMaxReturn: -1,
    codeSnippetsEnabled: true,
    recommendationViewDefault: 'marketing',
    marketingCopyEnabled: true,
    technicalCopyEnabled: true,
    execCopyEnabled: true,
    
    // Domains
    maxDomains: 10,
    domainVerificationRequired: true,
    scanRequiresVerifiedDomain: true,
    
    // Competitors
    competitorScansEnabled: true,
    maxCompetitors: -1,             // Unlimited competitor domains
    competitorScansPerPeriod: -1,   // Unlimited competitor scans
    
    // BVI
    bviLiteEnabled: true,
    bviFullEnabled: true,
    aiTestQueriesPerPeriod: 100,
    
    // AI Citation Network
    aiCitationNetworkEnabled: true,
    directoryListingEnabled: true,
    
    // Page Optimization (Content Studio)
    pageOptimizationEnabled: true,
    maxPageOptimizationsPerPeriod: -1,
    
    // Export
    pdfExportEnabled: true,
    csvExportEnabled: true,
    whitelabelReportsEnabled: true,
    
    // History
    historyRetentionDays: -1,
    scoreTrendAnalysisEnabled: true,
    
    // Team
    maxTeamMembers: -1,           // Unlimited
    
    // API
    apiAccessEnabled: true,
    apiRateLimitPerMinute: 120,
    apiRateLimitPerDay: 5000,
    
    // Agency Features
    maxClients: -1,
    whitelabelEnabled: true,
    dedicatedAccountManager: true,
    customOnboarding: true,
    
    // Content
    contentCreditsPerPeriod: 50,
    
    // Support
    prioritySupportEnabled: true,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get entitlements for a plan
 * @param {string} plan - Plan name (free, diy, pro, enterprise, agency)
 * @returns {object} Entitlements object
 */
function getEntitlements(plan) {
  const entitlements = PLAN_ENTITLEMENTS[plan];
  if (!entitlements) {
    console.warn(`Unknown plan: ${plan}, defaulting to free`);
    return PLAN_ENTITLEMENTS.free;
  }
  return entitlements;
}

/**
 * Check if a feature is enabled for a plan
 * @param {string} plan - Plan name
 * @param {string} feature - Feature key (e.g., 'bviLiteEnabled')
 * @returns {boolean}
 */
function isFeatureEnabled(plan, feature) {
  const entitlements = getEntitlements(plan);
  return entitlements[feature] === true;
}

/**
 * Get a numeric limit for a plan
 * @param {string} plan - Plan name
 * @param {string} limitKey - Limit key (e.g., 'scansPerPeriod')
 * @returns {number} Limit value (-1 for unlimited)
 */
function getLimit(plan, limitKey) {
  const entitlements = getEntitlements(plan);
  const limit = entitlements[limitKey];
  return typeof limit === 'number' ? limit : 0;
}

/**
 * Check if user has capacity for an action
 * @param {string} plan - Plan name
 * @param {string} limitKey - Limit key
 * @param {number} currentUsage - Current usage count
 * @returns {boolean}
 */
function hasCapacity(plan, limitKey, currentUsage) {
  const limit = getLimit(plan, limitKey);
  if (limit === -1) return true;  // Unlimited
  return currentUsage < limit;
}

/**
 * Get remaining capacity
 * @param {string} plan - Plan name
 * @param {string} limitKey - Limit key
 * @param {number} currentUsage - Current usage count
 * @returns {number} Remaining capacity (-1 for unlimited)
 */
function getRemainingCapacity(plan, limitKey, currentUsage) {
  const limit = getLimit(plan, limitKey);
  if (limit === -1) return -1;  // Unlimited
  return Math.max(0, limit - currentUsage);
}

/**
 * Get the minimum plan required for a feature
 * @param {string} feature - Feature key
 * @returns {string|null} Plan name or null if no plan has it
 */
function getMinimumPlanForFeature(feature) {
  const planOrder = ['free', 'diy', 'pro', 'enterprise', 'agency'];
  for (const plan of planOrder) {
    if (PLAN_ENTITLEMENTS[plan][feature] === true) {
      return plan;
    }
  }
  return null;
}

/**
 * Get the minimum plan required for a limit
 * @param {string} limitKey - Limit key
 * @param {number} requiredValue - Required minimum value
 * @returns {string|null} Plan name or null
 */
function getMinimumPlanForLimit(limitKey, requiredValue) {
  const planOrder = ['free', 'diy', 'pro', 'enterprise', 'agency'];
  for (const plan of planOrder) {
    const limit = PLAN_ENTITLEMENTS[plan][limitKey];
    if (limit === -1 || limit >= requiredValue) {
      return plan;
    }
  }
  return null;
}

/**
 * Check if a usage event type is valid
 * @param {string} eventType - Event type to validate
 * @returns {boolean}
 */
function isValidUsageEventType(eventType) {
  return Object.values(USAGE_EVENT_TYPES).includes(eventType);
}

/**
 * Get the limit key for a usage event type
 * Maps event types to their corresponding limit keys for usage_events enforcement
 * 
 * ENFORCEMENT MODEL:
 * - Most limits enforced via usage_events table (counted per period)
 * - API minute rate limit: enforced by middleware/gateway (not usage_events)
 * - API daily rate limit: enforced via usage_events
 * 
 * @param {string} eventType - Usage event type
 * @returns {string|null} Limit key or null if no limit applies
 */
function getLimitKeyForEventType(eventType) {
  const eventToLimit = {
    // Scanning
    [USAGE_EVENT_TYPES.SCAN_CREATED]: 'scansPerPeriod',
    
    // Competitors (two separate limits)
    [USAGE_EVENT_TYPES.COMPETITOR_ADDED]: 'maxCompetitors',           // Domain tracking limit
    [USAGE_EVENT_TYPES.COMPETITOR_SCAN_CREATED]: 'competitorScansPerPeriod', // Scan count limit
    
    // BVI
    [USAGE_EVENT_TYPES.AI_TEST_QUERY]: 'aiTestQueriesPerPeriod',
    
    // Content Studio
    [USAGE_EVENT_TYPES.PAGE_OPTIMIZATION_RUN]: 'maxPageOptimizationsPerPeriod',
    [USAGE_EVENT_TYPES.CONTENT_CREDIT_USED]: 'contentCreditsPerPeriod',
    
    // API (daily limit via usage_events; minute limit via middleware)
    [USAGE_EVENT_TYPES.API_CALL]: 'apiRateLimitPerDay',
  };
  return eventToLimit[eventType] || null;
}

/**
 * API Rate Limit Enforcement Notes:
 * 
 * MINUTE LIMIT (apiRateLimitPerMinute):
 * - Enforced by API gateway/middleware (e.g., express-rate-limit with Redis)
 * - NOT tracked in usage_events (too granular, would flood table)
 * - Returns 429 immediately when exceeded
 * 
 * DAILY LIMIT (apiRateLimitPerDay):
 * - Enforced via usage_events table
 * - Each API_CALL event counted against daily limit
 * - Returns 429 with reset time when exceeded
 * 
 * Implementation:
 * - Middleware checks minute limit FIRST (fast path)
 * - If minute OK, record usage_event and check daily limit
 * - Both must pass for request to proceed
 */

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  ENTITLEMENTS_VERSION,
  USAGE_EVENT_TYPES,
  PLAN_ENTITLEMENTS,
  getEntitlements,
  isFeatureEnabled,
  getLimit,
  hasCapacity,
  getRemainingCapacity,
  getMinimumPlanForFeature,
  getMinimumPlanForLimit,
  isValidUsageEventType,
  getLimitKeyForEventType,
};
