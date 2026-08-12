/**
 * Org-fallback plan reconcile tests.
 *
 * resolvePlanForRequest() resolves ORG-FIRST. For legacy accounts whose upgrade
 * was recorded on the USERS row while the org row was never provisioned
 * (org.plan 'free', no org Stripe, no manual override), the weak
 * `org_plan_fallback` used to resolve 'free' — hiding the paid profile from a
 * genuine Pro user. The rescue path (preferPaidUserPlanOverOrgFallback) must:
 *   - lift ONLY that shape (fallback + free) up to a paid user-level plan
 *   - never second-guess a manual override or org Stripe state
 *   - never downgrade anyone
 *   - fail open to the org result if the user lookup throws
 *
 * Run with: node --test backend/tests/unit/plan-org-fallback.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// ---------------------------------------------------------------------------
// Mock the db module BEFORE requiring the service. Queries are routed by SQL
// shape; each test sets `mock.org` / `mock.user` rows.
// ---------------------------------------------------------------------------
const mock = { org: null, user: null, failUserQuery: false };

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../db/database' || id.endsWith('/db/database')) {
    return {
      query: async (sql) => {
        const s = String(sql);
        if (s.includes('FROM organizations')) {
          return { rows: mock.org ? [mock.org] : [] };
        }
        if (s.includes('SELECT organization_id FROM users')) {
          return { rows: mock.user ? [{ organization_id: mock.user.organization_id ?? null }] : [] };
        }
        if (s.includes('FROM users')) {
          if (mock.failUserQuery) throw new Error('users query boom');
          return { rows: mock.user ? [mock.user] : [] };
        }
        return { rows: [] };
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

const { resolvePlanForRequest } = require('../../services/planService');

// Row factories --------------------------------------------------------------
function orgRow(over = {}) {
  return {
    id: 7,
    plan: 'free',
    plan_source: null,
    plan_override: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_subscription_status: null,
    stripe_price_id: null,
    stripe_current_period_start: null,
    stripe_current_period_end: null,
    ...over
  };
}
function userRow(over = {}) {
  return {
    id: 1,
    email: 'x@y.z',
    plan: 'pro',
    organization_id: 7,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_subscription_status: null,
    stripe_price_id: null,
    stripe_current_period_start: null,
    stripe_current_period_end: null,
    ...over
  };
}

describe('resolvePlanForRequest — org-fallback reconcile with user plan', () => {
  beforeEach(() => { mock.org = null; mock.user = null; mock.failUserQuery = false; });

  it('rescues the unprovisioned-org shape: org fallback free + users.plan pro -> pro', async () => {
    mock.org = orgRow();               // free, no stripe, no override
    mock.user = userRow({ plan: 'pro' });
    const r = await resolvePlanForRequest({ userId: 1, orgId: 7 });
    assert.strictEqual(r.plan, 'pro');
    assert.match(r.source, /^user_plan_over_org_fallback_/);
    assert.strictEqual(r.details.user_plan, 'pro');
  });

  it('rescues via the orgId-from-user path too (only userId given)', async () => {
    mock.org = orgRow();
    mock.user = userRow({ plan: 'enterprise' });
    const r = await resolvePlanForRequest({ userId: 1 });
    assert.strictEqual(r.plan, 'enterprise');
    assert.match(r.source, /^user_plan_over_org_fallback_/);
    assert.strictEqual(r.orgId, 7);
  });

  it('does NOT rescue when the org fallback already resolves a paid plan', async () => {
    mock.org = orgRow({ plan: 'pro' });
    mock.user = userRow({ plan: 'enterprise' });
    const r = await resolvePlanForRequest({ userId: 1, orgId: 7 });
    assert.strictEqual(r.plan, 'pro');            // org's own plan stands
    assert.strictEqual(r.source, 'org_plan_fallback');
  });

  it('manual override stays authoritative even when it says free', async () => {
    mock.org = orgRow({ plan_source: 'manual', plan_override: 'free' });
    mock.user = userRow({ plan: 'pro' });
    const r = await resolvePlanForRequest({ userId: 1, orgId: 7 });
    assert.strictEqual(r.plan, 'free');
    assert.strictEqual(r.source, 'manual_override');
  });

  it('user with inactive user-level subscription is NOT lifted (resolves free)', async () => {
    mock.org = orgRow();
    mock.user = userRow({
      plan: 'pro',
      stripe_subscription_id: 'sub_1',
      stripe_subscription_status: 'canceled'
    });
    const r = await resolvePlanForRequest({ userId: 1, orgId: 7 });
    assert.strictEqual(r.plan, 'free');           // stripe says the sub is dead
    assert.strictEqual(r.source, 'org_plan_fallback');
  });

  it('free user stays free (no rescue when users.plan is free)', async () => {
    mock.org = orgRow();
    mock.user = userRow({ plan: 'free' });
    const r = await resolvePlanForRequest({ userId: 1, orgId: 7 });
    assert.strictEqual(r.plan, 'free');
    assert.strictEqual(r.source, 'org_plan_fallback');
  });

  it('fails open to the org result if the user lookup throws', async () => {
    mock.org = orgRow();
    mock.user = userRow({ plan: 'pro' });
    mock.failUserQuery = true;
    const r = await resolvePlanForRequest({ userId: 1, orgId: 7 });
    assert.strictEqual(r.plan, 'free');
    assert.strictEqual(r.source, 'org_plan_fallback');
  });

  it('no userId in context -> org fallback result untouched', async () => {
    mock.org = orgRow();
    const r = await resolvePlanForRequest({ orgId: 7 });
    assert.strictEqual(r.plan, 'free');
    assert.strictEqual(r.source, 'org_plan_fallback');
  });
});
