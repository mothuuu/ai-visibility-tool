/**
 * Unit tests for render context isolation
 * RULEBOOK v1.2 Step G5: Tests for per-scan headless budget
 *
 * Run with: node --test backend/tests/unit/render-context.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  createRenderContext,
  canRender,
  recordRender,
  RENDER_CONFIG
} = require('../../analyzers/content-extractor');

describe('render-context', () => {

  describe('createRenderContext()', () => {

    it('creates context with default values', () => {
      const ctx = createRenderContext();

      assert.ok(typeof ctx.budget === 'number');
      assert.ok(ctx.budget > 0);
      assert.strictEqual(ctx.rendered, 0);
      assert.ok(typeof ctx.startTime === 'number');
      assert.ok(Array.isArray(ctx.pages));
      assert.strictEqual(ctx.pages.length, 0);
    });

    it('uses tier-based budget from RENDER_CONFIG', () => {
      const ctx = createRenderContext({ tier: 'agency' });
      assert.strictEqual(ctx.budget, RENDER_CONFIG.tierBudgets.agency);
      assert.strictEqual(ctx.tier, 'agency');
    });

    it('defaults to diy tier', () => {
      const ctx = createRenderContext();
      assert.strictEqual(ctx.tier, 'diy');
      assert.strictEqual(ctx.budget, RENDER_CONFIG.tierBudgets.diy);
    });

    it('sets startTime to current timestamp', () => {
      const before = Date.now();
      const ctx = createRenderContext();
      const after = Date.now();

      assert.ok(ctx.startTime >= before);
      assert.ok(ctx.startTime <= after);
    });

    it('creates isolated contexts for concurrent scans', () => {
      const ctx1 = createRenderContext({ tier: 'pro' });
      const ctx2 = createRenderContext({ tier: 'agency' });

      // Modify ctx1
      recordRender(ctx1, { url: 'https://example.com/page1' });

      // ctx2 should be unaffected
      assert.strictEqual(ctx1.rendered, 1);
      assert.strictEqual(ctx2.rendered, 0);
      assert.strictEqual(ctx1.pages.length, 1);
      assert.strictEqual(ctx2.pages.length, 0);
    });

  });

  describe('canRender()', () => {

    it('allows render when under budget', () => {
      const ctx = createRenderContext({ tier: 'agency' }); // agency = 10
      const result = canRender(ctx);

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.reason, undefined);
    });

    it('denies render when budget exhausted', () => {
      const ctx = createRenderContext({ tier: 'diy' }); // diy = 2
      ctx.rendered = ctx.budget;

      const result = canRender(ctx);

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.reason, 'budget_exhausted');
    });

    it('denies render when time budget exhausted', () => {
      const ctx = createRenderContext();
      // Simulate time passing beyond maxTotalTime
      ctx.startTime = Date.now() - (ctx.maxTotalTime + 1000);

      const result = canRender(ctx);

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.reason, 'time_budget_exhausted');
    });

    it('returns false for null context', () => {
      const result = canRender(null);
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.reason, 'no_context');
    });

    it('returns false for undefined context', () => {
      const result = canRender(undefined);
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.reason, 'no_context');
    });

    it('allows when one render remaining', () => {
      const ctx = createRenderContext({ tier: 'agency' }); // agency = 10
      ctx.rendered = ctx.budget - 1; // One more allowed

      const result = canRender(ctx);
      assert.strictEqual(result.allowed, true);
    });

    it('denies at exact budget limit', () => {
      const ctx = createRenderContext({ tier: 'agency' }); // agency = 10
      ctx.rendered = ctx.budget; // Exactly at limit

      const result = canRender(ctx);
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.reason, 'budget_exhausted');
    });

  });

  describe('recordRender()', () => {

    it('increments rendered count', () => {
      const ctx = createRenderContext();
      assert.strictEqual(ctx.rendered, 0);

      recordRender(ctx);
      assert.strictEqual(ctx.rendered, 1);

      recordRender(ctx);
      assert.strictEqual(ctx.rendered, 2);
    });

    it('records page info when provided', () => {
      const ctx = createRenderContext();

      recordRender(ctx, {
        url: 'https://example.com/page1',
        duration: 500,
        htmlLength: 10000
      });

      assert.strictEqual(ctx.pages.length, 1);
      assert.strictEqual(ctx.pages[0].url, 'https://example.com/page1');
      assert.strictEqual(ctx.pages[0].duration, 500);
      assert.strictEqual(ctx.pages[0].htmlLength, 10000);
      assert.ok(typeof ctx.pages[0].timestamp === 'number');
    });

    it('handles missing page info gracefully', () => {
      const ctx = createRenderContext();
      recordRender(ctx);

      assert.strictEqual(ctx.rendered, 1);
      assert.strictEqual(ctx.pages.length, 0); // No URL = no page record
    });

    it('handles null context gracefully', () => {
      const result = recordRender(null);
      assert.strictEqual(result, null);
    });

    it('handles undefined context gracefully', () => {
      const result = recordRender(undefined);
      assert.strictEqual(result, undefined);
    });

    it('returns the context for chaining', () => {
      const ctx = createRenderContext();
      const result = recordRender(ctx, { url: 'https://example.com' });
      assert.strictEqual(result, ctx);
    });

    it('accumulates multiple page records', () => {
      const ctx = createRenderContext();

      recordRender(ctx, { url: 'https://example.com/page1', duration: 100 });
      recordRender(ctx, { url: 'https://example.com/page2', duration: 200 });
      recordRender(ctx, { url: 'https://example.com/page3', duration: 300 });

      assert.strictEqual(ctx.rendered, 3);
      assert.strictEqual(ctx.pages.length, 3);
      assert.strictEqual(ctx.pages[0].url, 'https://example.com/page1');
      assert.strictEqual(ctx.pages[1].url, 'https://example.com/page2');
      assert.strictEqual(ctx.pages[2].url, 'https://example.com/page3');
    });

  });

  describe('concurrent scan isolation', () => {

    it('maintains independent state between contexts', () => {
      const scan1 = createRenderContext({ budget: 3 });
      const scan2 = createRenderContext({ budget: 3 });

      // Exhaust scan1's budget
      recordRender(scan1, { url: 'https://site1.com/a' });
      recordRender(scan1, { url: 'https://site1.com/b' });
      recordRender(scan1, { url: 'https://site1.com/c' });

      // scan2 should still have budget
      assert.strictEqual(canRender(scan1).allowed, false);
      assert.strictEqual(canRender(scan2).allowed, true);
      assert.strictEqual(scan2.rendered, 0);
    });

    it('tracks pages independently', () => {
      const scan1 = createRenderContext();
      const scan2 = createRenderContext();

      recordRender(scan1, { url: 'https://site1.com/page' });
      recordRender(scan2, { url: 'https://site2.com/page' });

      assert.strictEqual(scan1.pages.length, 1);
      assert.strictEqual(scan2.pages.length, 1);
      assert.strictEqual(scan1.pages[0].url, 'https://site1.com/page');
      assert.strictEqual(scan2.pages[0].url, 'https://site2.com/page');
    });

  });

  describe('time budget enforcement', () => {

    it('allows render within time budget', () => {
      const ctx = createRenderContext({ tier: 'agency' });
      // startTime is just now, so we're well within budget

      const result = canRender(ctx);
      assert.strictEqual(result.allowed, true);
    });

    it('enforces time budget even when render budget remains', () => {
      const ctx = createRenderContext({ tier: 'agency' }); // Plenty of budget
      // Simulate time passing beyond maxTotalTime
      ctx.startTime = Date.now() - (ctx.maxTotalTime + 1000);

      const result = canRender(ctx);
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.reason, 'time_budget_exhausted');
      assert.strictEqual(ctx.rendered, 0); // Still has render budget
    });

  });

});
