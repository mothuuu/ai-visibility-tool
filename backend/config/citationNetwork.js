/**
 * AI Citation Network Configuration
 *
 * Two products:
 * - Starter ($249): Non-subscribers, first purchase - 100 directories
 * - Pack ($99): Subscribers OR anyone who already bought starter - 100 additional directories
 */

const CITATION_NETWORK_CONFIG = {
  // Stripe Price IDs (from environment)
  prices: {
    STARTER_249: process.env.STRIPE_PRICE_SPRINT_249,
    PACK_99: process.env.STRIPE_PRICE_PACK_99
  },

  // Directories per purchase
  directoriesPerPurchase: 100,

  // Limits
  maxPacksPerYear: 2, // Max $99 packs per year (for subscribers)
  maxPacksPerStarter: 2, // Max $99 add-ons per $249 starter

  // Plan allocations (monthly) - for subscribers
  planAllocations: {
    freemium: 0,
    free: 0,
    diy: 10,
    pro: 25,
    enterprise: 50,
    agency: 100
  },

  // Order status values
  orderStatuses: {
    PENDING: 'pending',
    PAID: 'paid',
    PROCESSING: 'processing',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    REFUNDED: 'refunded',
    CANCELLED: 'cancelled'
  },

  // Submission status values
  submissionStatuses: {
    PENDING: 'pending',
    SUBMITTED: 'submitted',
    PENDING_APPROVAL: 'pending_approval',
    LIVE: 'live',
    REJECTED: 'rejected',
    NEEDS_ACTION: 'needs_action'
  }
};

module.exports = CITATION_NETWORK_CONFIG;
