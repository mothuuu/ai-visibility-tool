/**
 * Unit tests for url-canonicalizer utility
 * RULEBOOK v1.2 Step C8: Tests for URL canonicalization
 *
 * Run with: node --test backend/tests/unit/url-canonicalizer.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  canonicalizeUrl,
  urlsAreEquivalent,
  getCacheKey,
  parseCanonicalTag
} = require('../../utils/url-canonicalizer');

describe('url-canonicalizer', () => {

  describe('canonicalizeUrl', () => {

    it('adds https:// to bare domain', () => {
      assert.strictEqual(canonicalizeUrl('example.com'), 'https://example.com/');
    });

    it('upgrades http to https', () => {
      const result = canonicalizeUrl('http://example.com');
      assert.ok(result.startsWith('https://'));
    });

    it('removes www prefix', () => {
      const result = canonicalizeUrl('https://www.example.com');
      assert.ok(!result.includes('www.'));
      assert.strictEqual(result, 'https://example.com/');
    });

    it('removes trailing slash except for root', () => {
      assert.strictEqual(canonicalizeUrl('https://example.com/page/'), 'https://example.com/page');
      assert.strictEqual(canonicalizeUrl('https://example.com/'), 'https://example.com/');
    });

    it('strips tracking parameters', () => {
      const result = canonicalizeUrl('https://example.com/page?utm_source=google&utm_medium=cpc&valid=1');
      assert.ok(!result.includes('utm_source'));
      assert.ok(!result.includes('utm_medium'));
      assert.ok(result.includes('valid=1'));
    });

    it('strips fbclid and gclid', () => {
      const result = canonicalizeUrl('https://example.com/page?fbclid=abc&gclid=xyz&keep=1');
      assert.ok(!result.includes('fbclid'));
      assert.ok(!result.includes('gclid'));
      assert.ok(result.includes('keep=1'));
    });

    it('removes hash fragments', () => {
      const result = canonicalizeUrl('https://example.com/page#section');
      assert.ok(!result.includes('#'));
    });

    it('normalizes hostname to lowercase', () => {
      const result = canonicalizeUrl('https://EXAMPLE.COM/Page');
      assert.ok(result.includes('example.com'));
    });

    it('handles malformed URLs gracefully', () => {
      // Should not throw
      const result = canonicalizeUrl('not a url');
      assert.ok(typeof result === 'string');
    });

  });

  describe('urlsAreEquivalent', () => {

    it('matches same URLs', () => {
      assert.strictEqual(
        urlsAreEquivalent('https://example.com', 'https://example.com'),
        true
      );
    });

    it('matches www vs non-www', () => {
      assert.strictEqual(
        urlsAreEquivalent('https://www.example.com', 'https://example.com'),
        true
      );
    });

    it('matches http vs https', () => {
      assert.strictEqual(
        urlsAreEquivalent('http://example.com', 'https://example.com'),
        true
      );
    });

    it('matches with/without trailing slash', () => {
      assert.strictEqual(
        urlsAreEquivalent('https://example.com/page/', 'https://example.com/page'),
        true
      );
    });

    it('matches ignoring tracking params', () => {
      assert.strictEqual(
        urlsAreEquivalent(
          'https://example.com/page?utm_source=google',
          'https://example.com/page'
        ),
        true
      );
    });

    it('does not match different paths', () => {
      assert.strictEqual(
        urlsAreEquivalent('https://example.com/page1', 'https://example.com/page2'),
        false
      );
    });

    it('does not match different domains', () => {
      assert.strictEqual(
        urlsAreEquivalent('https://example.com', 'https://other.com'),
        false
      );
    });

  });

  describe('getCacheKey', () => {

    it('removes protocol from URL', () => {
      const key = getCacheKey('https://example.com/page');
      assert.ok(!key.includes('https://'));
      assert.ok(!key.includes('http://'));
    });

    it('generates same key for http and https', () => {
      assert.strictEqual(
        getCacheKey('http://example.com/page'),
        getCacheKey('https://example.com/page')
      );
    });

    it('generates same key for www and non-www', () => {
      assert.strictEqual(
        getCacheKey('https://www.example.com/page'),
        getCacheKey('https://example.com/page')
      );
    });

    it('is lowercase', () => {
      const key = getCacheKey('https://EXAMPLE.COM/Page');
      assert.strictEqual(key, key.toLowerCase());
    });

  });

  describe('parseCanonicalTag', () => {

    it('extracts absolute canonical URL', () => {
      const html = '<link rel="canonical" href="https://example.com/page">';
      const result = parseCanonicalTag(html, 'https://example.com');
      assert.strictEqual(result.url, 'https://example.com/page');
      assert.strictEqual(result.source, 'link-tag');
    });

    it('handles double quotes', () => {
      const html = '<link rel="canonical" href="https://example.com/page">';
      const result = parseCanonicalTag(html, 'https://example.com');
      assert.strictEqual(result.url, 'https://example.com/page');
    });

    it('handles single quotes', () => {
      const html = "<link rel='canonical' href='https://example.com/page'>";
      const result = parseCanonicalTag(html, 'https://example.com');
      assert.strictEqual(result.url, 'https://example.com/page');
    });

    it('resolves relative canonical URL', () => {
      const html = '<link rel="canonical" href="/page">';
      const result = parseCanonicalTag(html, 'https://example.com/other');
      assert.strictEqual(result.url, 'https://example.com/page');
      assert.ok(result.warnings.some(w => w.toLowerCase().includes('relative')));
    });

    it('warns on multiple canonical tags', () => {
      const html = '<link rel="canonical" href="/a"><link rel="canonical" href="/b">';
      const result = parseCanonicalTag(html, 'https://example.com');
      assert.ok(result.warnings.some(w => w.toLowerCase().includes('multiple')));
      // Should use first one
      assert.strictEqual(result.url, 'https://example.com/a');
    });

    it('warns on cross-domain canonical', () => {
      const html = '<link rel="canonical" href="https://other.com/page">';
      const result = parseCanonicalTag(html, 'https://example.com');
      assert.ok(result.warnings.some(w => w.toLowerCase().includes('cross-domain')));
    });

    it('returns null when no canonical tag found', () => {
      const html = '<html><head><title>Test</title></head></html>';
      const result = parseCanonicalTag(html, 'https://example.com');
      assert.strictEqual(result, null);
    });

    it('returns null when href is missing', () => {
      const html = '<link rel="canonical">';
      const result = parseCanonicalTag(html, 'https://example.com');
      assert.strictEqual(result, null);
    });

    it('is case insensitive for rel attribute', () => {
      const html = '<link REL="CANONICAL" href="https://example.com/page">';
      const result = parseCanonicalTag(html, 'https://example.com');
      assert.strictEqual(result.url, 'https://example.com/page');
    });

    it('handles extra attributes in link tag', () => {
      const html = '<link type="text/html" rel="canonical" href="https://example.com/page" data-test="true">';
      const result = parseCanonicalTag(html, 'https://example.com');
      assert.strictEqual(result.url, 'https://example.com/page');
    });

  });

});
