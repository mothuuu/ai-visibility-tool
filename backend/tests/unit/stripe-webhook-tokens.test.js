/**
 * Phase 1.8: Stripe Webhook Token Handler Tests
 *
 * Tests for token top-up (checkout.session.completed),
 * monthly token grant on renewal (invoice.payment_succeeded),
 * and token expiry on cancellation (customer.subscription.deleted).
 *
 * Run with: node --test backend/tests/unit/stripe-webhook-tokens.test.js
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// =============================================================================
// MOCK SETUP
// =============================================================================

// Track calls to TokenService methods
let tokenServiceCalls = {};
// Track DB queries
let dbQueryResults = {};
let dbQueryCalls = [];

const mockTokenService = {
  creditPurchasedTokens: async (...args) => {
    tokenServiceCalls.creditPurchasedTokens = (tokenServiceCalls.creditPurchasedTokens || []);
    tokenServiceCalls.creditPurchasedTokens.push(args);
    return { monthly_remaining: 0, purchased_balance: args[1], total_available: args[1] };
  },
  expireMonthlyTokens: async (...args) => {
    tokenServiceCalls.expireMonthlyTokens = (tokenServiceCalls.expireMonthlyTokens || []);
    tokenServiceCalls.expireMonthlyTokens.push(args);
  },
  grantMonthlyTokens: async (...args) => {
    tokenServiceCalls.grantMonthlyTokens = (tokenServiceCalls.grantMonthlyTokens || []);
    tokenServiceCalls.grantMonthlyTokens.push(args);
    return { monthly_remaining: args[1], purchased_balance: 0, total_available: args[1] };
  },
  expireAllTokens: async (...args) => {
    tokenServiceCalls.expireAllTokens = (tokenServiceCalls.expireAllTokens || []);
    tokenServiceCalls.expireAllTokens.push(args);
  }
};

const mockPlanService = {
  syncPlanFromWebhook: async () => {},
  handleSubscriptionDeleted: async () => {},
  upsertOrgStripeFields: async () => ({ success: false }),
  clearOrgStripeFields: async () => ({ success: false }),
  getEntitlements: (planName) => {
    const entitlements = {
      free: { tokensPerCycle: 0 },
      starter: { tokensPerCycle: 60 },
      diy: { tokensPerCycle: 60 },
      pro: { tokensPerCycle: 200 }
    };
    return entitlements[planName] || entitlements.free;
  }
};

const mockDb = {
  pool: {
    connect: async () => mockClient
  },
  query: async () => ({ rows: [] }),
  getClient: async () => mockClient
};

let mockClient;
function createMockClient() {
  const queryFn = async (sql, params) => {
    dbQueryCalls.push({ sql: sql.trim(), params });

    // processed_stripe_events INSERT — return event_id to indicate new event
    if (sql.includes('processed_stripe_events')) {
      return { rows: [{ event_id: 'evt_test' }] };
    }

    // token_transactions duplicate check
    if (sql.includes('token_transactions') && sql.includes('reference_type')) {
      const refId = params?.[0];
      if (dbQueryResults.tokenTransactionExists?.[refId]) {
        return { rows: [{ id: 1 }] };
      }
      return { rows: [] };
    }

    // User lookup by stripe_customer_id
    if (sql.includes('stripe_customer_id') && sql.includes('SELECT')) {
      return { rows: dbQueryResults.userByCustomer || [] };
    }

    // User lookup by id
    if (sql.includes('users WHERE id')) {
      return { rows: dbQueryResults.userById || [] };
    }

    return { rows: [] };
  };

  return {
    query: queryFn,
    release: () => {}
  };
}

const mockStripe = {
  webhooks: {
    constructEvent: (body, sig, secret) => {
      // Return the body parsed as event
      return JSON.parse(body);
    }
  }
};

// Override require for dependencies
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../db/database' || id.endsWith('/db/database')) {
    return mockDb;
  }
  if (id === '../services/tokenService' || id.endsWith('/services/tokenService')) {
    return mockTokenService;
  }
  if (id === '../services/planService' || id.endsWith('/services/planService')) {
    return mockPlanService;
  }
  if (id === '../services/citationNetworkWebhookHandler' || id.endsWith('/services/citationNetworkWebhookHandler')) {
    return {
      handleCitationNetworkWebhook: async () => false // Never handle — let switch handle
    };
  }
  if (id.startsWith('stripe')) {
    return () => mockStripe;
  }
  return originalRequire.apply(this, arguments);
};

// Import the webhook handler AFTER mocking
const handleStripeWebhook = require('../../routes/stripe-webhook');

// =============================================================================
// HELPERS
// =============================================================================

function makeReq(event) {
  return {
    headers: { 'stripe-signature': 'sig_test' },
    body: Buffer.from(JSON.stringify(event))
  };
}

function makeRes() {
  let statusCode = 200;
  let responseBody = null;
  return {
    status(code) { statusCode = code; return this; },
    json(body) { responseBody = body; statusCode = statusCode; return this; },
    getStatus() { return statusCode; },
    getBody() { return responseBody; }
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('Phase 1.8: Stripe Webhook Token Handlers', () => {

  beforeEach(() => {
    tokenServiceCalls = {};
    dbQueryResults = {};
    dbQueryCalls = [];
    mockClient = createMockClient();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_SECRET_KEY = 'sk_test';
  });

  // =========================================================================
  // TOKEN TOP-UP: checkout.session.completed
  // =========================================================================

  describe('Token Top-Up (checkout.session.completed)', () => {

    it('should credit tokens for a valid token top-up session', async () => {
      dbQueryResults.userById = [{ id: 42 }];

      const event = {
        id: 'evt_topup_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            mode: 'payment',
            payment_status: 'paid',
            metadata: {
              type: 'token_topup',
              user_id: '42',
              token_amount: '50'
            },
            client_reference_id: null
          }
        }
      };

      const req = makeReq(event);
      const res = makeRes();
      await handleStripeWebhook(req, res);

      assert.ok(tokenServiceCalls.creditPurchasedTokens, 'creditPurchasedTokens should be called');
      assert.strictEqual(tokenServiceCalls.creditPurchasedTokens.length, 1);
      const [userId, amount, refType, refId] = tokenServiceCalls.creditPurchasedTokens[0];
      assert.strictEqual(userId, 42);
      assert.strictEqual(amount, 50);
      assert.strictEqual(refType, 'stripe_checkout_session');
      assert.strictEqual(refId, 'cs_test_123');
    });

    it('should skip non-topup checkout sessions', async () => {
      const event = {
        id: 'evt_sub_checkout',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_sub',
            mode: 'subscription',
            payment_status: 'paid',
            metadata: {}
          }
        }
      };

      const req = makeReq(event);
      const res = makeRes();
      await handleStripeWebhook(req, res);

      assert.strictEqual(tokenServiceCalls.creditPurchasedTokens, undefined,
        'creditPurchasedTokens should NOT be called for subscription checkout');
    });

    it('should skip unpaid sessions', async () => {
      const event = {
        id: 'evt_unpaid',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_unpaid',
            mode: 'payment',
            payment_status: 'unpaid',
            metadata: { type: 'token_topup', user_id: '42', token_amount: '50' }
          }
        }
      };

      const req = makeReq(event);
      const res = makeRes();
      await handleStripeWebhook(req, res);

      assert.strictEqual(tokenServiceCalls.creditPurchasedTokens, undefined,
        'creditPurchasedTokens should NOT be called for unpaid session');
    });

    it('should skip if token_transactions already has this session (idempotency)', async () => {
      dbQueryResults.tokenTransactionExists = { 'cs_test_dup': true };

      const event = {
        id: 'evt_dup_topup',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_dup',
            mode: 'payment',
            payment_status: 'paid',
            metadata: { type: 'token_topup', user_id: '42', token_amount: '50' }
          }
        }
      };

      const req = makeReq(event);
      const res = makeRes();
      await handleStripeWebhook(req, res);

      assert.strictEqual(tokenServiceCalls.creditPurchasedTokens, undefined,
        'creditPurchasedTokens should NOT be called for duplicate session');
    });

    it('should reject invalid token amounts', async () => {
      dbQueryResults.userById = [{ id: 42 }];

      const event = {
        id: 'evt_bad_amount',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_bad',
            mode: 'payment',
            payment_status: 'paid',
            metadata: { type: 'token_topup', user_id: '42', token_amount: '999' }
          }
        }
      };

      const req = makeReq(event);
      const res = makeRes();
      await handleStripeWebhook(req, res);

      assert.strictEqual(tokenServiceCalls.creditPurchasedTokens, undefined,
        'creditPurchasedTokens should NOT be called for invalid amount');
    });

    it('should reject if client_reference_id mismatches user_id', async () => {
      dbQueryResults.userById = [{ id: 42 }];

      const event = {
        id: 'evt_mismatch',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_mismatch',
            mode: 'payment',
            payment_status: 'paid',
            client_reference_id: '99',
            metadata: { type: 'token_topup', user_id: '42', token_amount: '50' }
          }
        }
      };

      const req = makeReq(event);
      const res = makeRes();
      await handleStripeWebhook(req, res);

      assert.strictEqual(tokenServiceCalls.creditPurchasedTokens, undefined,
        'creditPurchasedTokens should NOT be called for mismatched client_reference_id');
    });

    it('should accept all valid token amounts: 20, 50, 120, 250', async () => {
      for (const amount of [20, 50, 120, 250]) {
        tokenServiceCalls = {};
        dbQueryCalls = [];
        mockClient = createMockClient();
        dbQueryResults.userById = [{ id: 1 }];

        const event = {
          id: `evt_amt_${amount}`,
          type: 'checkout.session.completed',
          data: {
            object: {
              id: `cs_amt_${amount}`,
              mode: 'payment',
              payment_status: 'paid',
              metadata: { type: 'token_topup', user_id: '1', token_amount: String(amount) }
            }
          }
        };

        const req = makeReq(event);
        const res = makeRes();
        await handleStripeWebhook(req, res);

        assert.ok(tokenServiceCalls.creditPurchasedTokens,
          `creditPurchasedTokens should be called for amount ${amount}`);
        assert.strictEqual(tokenServiceCalls.creditPurchasedTokens[0][1], amount);
      }
    });
  });

  // =========================================================================
  // MONTHLY TOKEN GRANT: invoice.payment_succeeded (renewal)
  // =========================================================================

  describe('Monthly Token Grant (invoice.payment_succeeded renewal)', () => {

    it('should grant monthly tokens on subscription_cycle renewal', async () => {
      dbQueryResults.userByCustomer = [{ id: 10, email: 'user@test.com', plan: 'pro' }];

      const event = {
        id: 'evt_renewal_1',
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_test_renewal',
            customer: 'cus_test_10',
            amount_paid: 4900,
            billing_reason: 'subscription_cycle',
            period_start: 1700000000,
            period_end: 1702592000
          }
        }
      };

      const req = makeReq(event);
      const res = makeRes();
      await handleStripeWebhook(req, res);

      // Should expire old monthly tokens first
      assert.ok(tokenServiceCalls.expireMonthlyTokens, 'expireMonthlyTokens should be called');
      assert.strictEqual(tokenServiceCalls.expireMonthlyTokens[0][0], 10);

      // Should grant new monthly tokens
      assert.ok(tokenServiceCalls.grantMonthlyTokens, 'grantMonthlyTokens should be called');
      const [userId, tokensPerCycle, startDate, endDate] = tokenServiceCalls.grantMonthlyTokens[0];
      assert.strictEqual(userId, 10);
      assert.strictEqual(tokensPerCycle, 200); // pro plan
      assert.ok(startDate instanceof Date);
      assert.ok(endDate instanceof Date);
    });

    it('should skip token grant for non-renewal invoices', async () => {
      dbQueryResults.userByCustomer = [{ id: 10, email: 'user@test.com', plan: 'pro' }];

      const event = {
        id: 'evt_initial_pay',
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_test_initial',
            customer: 'cus_test_10',
            amount_paid: 4900,
            billing_reason: 'subscription_create'
          }
        }
      };

      const req = makeReq(event);
      const res = makeRes();
      await handleStripeWebhook(req, res);

      assert.strictEqual(tokenServiceCalls.grantMonthlyTokens, undefined,
        'grantMonthlyTokens should NOT be called for initial subscription');
    });

    it('should skip token grant for free plan (0 tokensPerCycle)', async () => {
      dbQueryResults.userByCustomer = [{ id: 10, email: 'user@test.com', plan: 'free' }];

      const event = {
        id: 'evt_free_renewal',
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_test_free',
            customer: 'cus_test_10',
            amount_paid: 0,
            billing_reason: 'subscription_cycle',
            period_start: 1700000000,
            period_end: 1702592000
          }
        }
      };

      const req = makeReq(event);
      const res = makeRes();
      await handleStripeWebhook(req, res);

      assert.strictEqual(tokenServiceCalls.grantMonthlyTokens, undefined,
        'grantMonthlyTokens should NOT be called for free plan');
    });

    it('should skip if token_transactions already has this invoice (idempotency)', async () => {
      dbQueryResults.userByCustomer = [{ id: 10, email: 'user@test.com', plan: 'pro' }];
      dbQueryResults.tokenTransactionExists = { 'in_test_dup_renewal': true };

      const event = {
        id: 'evt_dup_renewal',
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_test_dup_renewal',
            customer: 'cus_test_10',
            amount_paid: 4900,
            billing_reason: 'subscription_cycle',
            period_start: 1700000000,
            period_end: 1702592000
          }
        }
      };

      const req = makeReq(event);
      const res = makeRes();
      await handleStripeWebhook(req, res);

      assert.strictEqual(tokenServiceCalls.grantMonthlyTokens, undefined,
        'grantMonthlyTokens should NOT be called for duplicate invoice');
    });
  });

  // =========================================================================
  // SUBSCRIPTION CANCELLATION: customer.subscription.deleted
  // =========================================================================

  describe('Token Expiry on Cancellation (customer.subscription.deleted)', () => {

    it('should expire all tokens when subscription is deleted', async () => {
      dbQueryResults.userByCustomer = [{ id: 5, email: 'cancel@test.com', plan: 'pro' }];

      const event = {
        id: 'evt_cancel_1',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_test_cancel',
            customer: 'cus_test_5',
            status: 'canceled'
          }
        }
      };

      const req = makeReq(event);
      const res = makeRes();
      await handleStripeWebhook(req, res);

      assert.ok(tokenServiceCalls.expireAllTokens, 'expireAllTokens should be called');
      assert.strictEqual(tokenServiceCalls.expireAllTokens[0][0], 5);
    });

    it('should still downgrade plan even if token expiry fails', async () => {
      dbQueryResults.userByCustomer = [{ id: 5, email: 'cancel@test.com', plan: 'pro' }];

      // Make expireAllTokens throw
      const originalExpire = mockTokenService.expireAllTokens;
      mockTokenService.expireAllTokens = async () => {
        tokenServiceCalls.expireAllTokens = (tokenServiceCalls.expireAllTokens || []);
        tokenServiceCalls.expireAllTokens.push([5]);
        throw new Error('DB connection failed');
      };

      const event = {
        id: 'evt_cancel_fail',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_test_cancel_fail',
            customer: 'cus_test_5',
            status: 'canceled'
          }
        }
      };

      const req = makeReq(event);
      const res = makeRes();
      await handleStripeWebhook(req, res);

      // Should still complete (200 response) even though token expiry failed
      const body = res.getBody();
      assert.ok(body.received, 'Should still return received: true');

      // Restore
      mockTokenService.expireAllTokens = originalExpire;
    });
  });
});
