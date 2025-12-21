/**
 * Unit tests for safe-http utility
 * RULEBOOK v1.2 Step C8: Tests for SSRF protection
 * H1: PSL-based domain extraction tests
 * H2: Redirect validation tests
 *
 * Run with: node --test backend/tests/unit/safe-http.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  isBlockedIP,
  isIPAddress,
  isSameRegistrableDomain,
  getRegistrableDomain,
  isRedirect,
  validateRedirectTarget
} = require('../../utils/safe-http');

describe('safe-http', () => {

  describe('isBlockedIP', () => {

    it('blocks localhost 127.0.0.1', () => {
      assert.strictEqual(isBlockedIP('127.0.0.1'), true);
    });

    it('blocks localhost 127.x.x.x range', () => {
      assert.strictEqual(isBlockedIP('127.0.0.2'), true);
      assert.strictEqual(isBlockedIP('127.255.255.255'), true);
    });

    it('blocks private Class A (10.x.x.x)', () => {
      assert.strictEqual(isBlockedIP('10.0.0.1'), true);
      assert.strictEqual(isBlockedIP('10.255.255.255'), true);
    });

    it('blocks private Class B (172.16-31.x.x)', () => {
      assert.strictEqual(isBlockedIP('172.16.0.1'), true);
      assert.strictEqual(isBlockedIP('172.31.255.255'), true);
    });

    it('allows non-private 172.x ranges', () => {
      assert.strictEqual(isBlockedIP('172.15.0.1'), false);
      assert.strictEqual(isBlockedIP('172.32.0.1'), false);
    });

    it('blocks private Class C (192.168.x.x)', () => {
      assert.strictEqual(isBlockedIP('192.168.0.1'), true);
      assert.strictEqual(isBlockedIP('192.168.1.1'), true);
      assert.strictEqual(isBlockedIP('192.168.255.255'), true);
    });

    it('blocks link-local (169.254.x.x)', () => {
      assert.strictEqual(isBlockedIP('169.254.0.1'), true);
      assert.strictEqual(isBlockedIP('169.254.169.254'), true); // AWS metadata
    });

    it('blocks "this" network (0.x.x.x)', () => {
      assert.strictEqual(isBlockedIP('0.0.0.0'), true);
      assert.strictEqual(isBlockedIP('0.0.0.1'), true);
    });

    it('allows public IPs', () => {
      assert.strictEqual(isBlockedIP('8.8.8.8'), false);      // Google DNS
      assert.strictEqual(isBlockedIP('1.1.1.1'), false);      // Cloudflare DNS
      assert.strictEqual(isBlockedIP('93.184.216.34'), false); // example.com
      assert.strictEqual(isBlockedIP('151.101.1.140'), false); // Reddit
    });

    it('blocks IPv6 loopback (::1)', () => {
      assert.strictEqual(isBlockedIP('::1'), true);
    });

    it('blocks IPv6 private (fc00:)', () => {
      assert.strictEqual(isBlockedIP('fc00::1'), true);
      assert.strictEqual(isBlockedIP('FC00::1'), true); // case insensitive
    });

    it('blocks IPv6 link-local (fe80:)', () => {
      assert.strictEqual(isBlockedIP('fe80::1'), true);
      assert.strictEqual(isBlockedIP('FE80::1'), true); // case insensitive
    });

  });

  describe('isIPAddress', () => {

    it('identifies IPv4 addresses', () => {
      assert.strictEqual(isIPAddress('127.0.0.1'), true);
      assert.strictEqual(isIPAddress('192.168.1.1'), true);
      assert.strictEqual(isIPAddress('8.8.8.8'), true);
      assert.strictEqual(isIPAddress('169.254.169.254'), true);
    });

    it('identifies IPv6 loopback', () => {
      assert.strictEqual(isIPAddress('::1'), true);
    });

    it('identifies IPv6 addresses', () => {
      assert.strictEqual(isIPAddress('fe80::1'), true);
      assert.strictEqual(isIPAddress('fc00::1'), true);
      assert.strictEqual(isIPAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), true);
    });

    it('rejects hostnames', () => {
      assert.strictEqual(isIPAddress('example.com'), false);
      assert.strictEqual(isIPAddress('localhost'), false);
      assert.strictEqual(isIPAddress('www.google.com'), false);
    });

    it('rejects incomplete IP-like strings', () => {
      assert.strictEqual(isIPAddress('1.2.3'), false); // incomplete
      assert.strictEqual(isIPAddress('1.2'), false);
      assert.strictEqual(isIPAddress('1'), false);
    });

  });

  describe('getRegistrableDomain', () => {

    it('extracts domain from simple hostname', () => {
      assert.strictEqual(getRegistrableDomain('example.com'), 'example.com');
    });

    it('extracts registrable domain from subdomain', () => {
      assert.strictEqual(getRegistrableDomain('www.example.com'), 'example.com');
      assert.strictEqual(getRegistrableDomain('sub.example.com'), 'example.com');
      assert.strictEqual(getRegistrableDomain('deep.sub.example.com'), 'example.com');
    });

    it('handles single-part hostnames', () => {
      assert.strictEqual(getRegistrableDomain('localhost'), 'localhost');
    });

    it('normalizes to lowercase', () => {
      assert.strictEqual(getRegistrableDomain('WWW.EXAMPLE.COM'), 'example.com');
    });

    // H1: PSL-based domain extraction tests
    it('handles .co.uk TLD correctly', () => {
      assert.strictEqual(getRegistrableDomain('www.example.co.uk'), 'example.co.uk');
      assert.strictEqual(getRegistrableDomain('example.co.uk'), 'example.co.uk');
      assert.strictEqual(getRegistrableDomain('sub.example.co.uk'), 'example.co.uk');
    });

    it('handles .com.au TLD correctly', () => {
      assert.strictEqual(getRegistrableDomain('www.example.com.au'), 'example.com.au');
      assert.strictEqual(getRegistrableDomain('sub.example.com.au'), 'example.com.au');
    });

    it('handles github.io as public suffix', () => {
      // Each github.io subdomain is its own registrable domain
      assert.strictEqual(getRegistrableDomain('myapp.github.io'), 'myapp.github.io');
      assert.strictEqual(getRegistrableDomain('otherapp.github.io'), 'otherapp.github.io');
    });

    it('handles other public suffixes', () => {
      // .org.uk
      assert.strictEqual(getRegistrableDomain('www.example.org.uk'), 'example.org.uk');
      // .gov.uk
      assert.strictEqual(getRegistrableDomain('www.example.gov.uk'), 'example.gov.uk');
    });

    it('removes port from hostname', () => {
      assert.strictEqual(getRegistrableDomain('example.com:8080'), 'example.com');
      assert.strictEqual(getRegistrableDomain('www.example.co.uk:443'), 'example.co.uk');
    });

    it('returns null for empty input', () => {
      assert.strictEqual(getRegistrableDomain(''), null);
      assert.strictEqual(getRegistrableDomain(null), null);
      assert.strictEqual(getRegistrableDomain(undefined), null);
    });

  });

  describe('isSameRegistrableDomain', () => {

    it('returns true for same domain', () => {
      assert.strictEqual(
        isSameRegistrableDomain('https://example.com', 'https://example.com/page'),
        true
      );
    });

    it('returns true for subdomain of same registrable domain', () => {
      assert.strictEqual(
        isSameRegistrableDomain('https://example.com', 'https://www.example.com'),
        true
      );
      assert.strictEqual(
        isSameRegistrableDomain('https://example.com', 'https://sub.example.com'),
        true
      );
      assert.strictEqual(
        isSameRegistrableDomain('https://www.example.com', 'https://api.example.com'),
        true
      );
    });

    it('returns false for different domains', () => {
      assert.strictEqual(
        isSameRegistrableDomain('https://example.com', 'https://other.com'),
        false
      );
      assert.strictEqual(
        isSameRegistrableDomain('https://example.com', 'https://example.org'),
        false
      );
    });

    it('returns false for similar but different domains', () => {
      assert.strictEqual(
        isSameRegistrableDomain('https://example.com', 'https://myexample.com'),
        false
      );
      assert.strictEqual(
        isSameRegistrableDomain('https://example.com', 'https://example.com.evil.com'),
        false
      );
    });

    // H1: PSL-based domain matching
    it('handles .co.uk domains correctly', () => {
      assert.strictEqual(
        isSameRegistrableDomain('https://example.co.uk', 'https://www.example.co.uk'),
        true
      );
      assert.strictEqual(
        isSameRegistrableDomain('https://example.co.uk', 'https://other.co.uk'),
        false
      );
    });

    it('treats different github.io subdomains as different domains', () => {
      // This is the key security fix - different GitHub Pages are different "sites"
      assert.strictEqual(
        isSameRegistrableDomain('https://a.github.io', 'https://b.github.io'),
        false
      );
      assert.strictEqual(
        isSameRegistrableDomain('https://myapp.github.io', 'https://myapp.github.io/page'),
        true
      );
    });

    it('handles invalid URLs gracefully', () => {
      assert.strictEqual(
        isSameRegistrableDomain('not-a-url', 'https://example.com'),
        false
      );
      assert.strictEqual(
        isSameRegistrableDomain('https://example.com', 'not-a-url'),
        false
      );
    });

  });

  describe('isRedirect', () => {

    it('identifies 301 as redirect', () => {
      assert.strictEqual(isRedirect(301), true);
    });

    it('identifies 302 as redirect', () => {
      assert.strictEqual(isRedirect(302), true);
    });

    it('identifies 303 as redirect', () => {
      assert.strictEqual(isRedirect(303), true);
    });

    it('identifies 307 as redirect', () => {
      assert.strictEqual(isRedirect(307), true);
    });

    it('identifies 308 as redirect', () => {
      assert.strictEqual(isRedirect(308), true);
    });

    it('does not identify 200 as redirect', () => {
      assert.strictEqual(isRedirect(200), false);
    });

    it('does not identify 404 as redirect', () => {
      assert.strictEqual(isRedirect(404), false);
    });

    it('does not identify 500 as redirect', () => {
      assert.strictEqual(isRedirect(500), false);
    });

  });

  describe('validateRedirectTarget', () => {

    it('allows same-domain redirect when requireSameDomain is true', async () => {
      const result = await validateRedirectTarget(
        'https://www.example.com/new-page',
        'https://example.com',
        true
      );
      assert.strictEqual(result.safe, true);
    });

    it('blocks cross-domain redirect when requireSameDomain is true', async () => {
      const result = await validateRedirectTarget(
        'https://evil.com/page',
        'https://example.com',
        true
      );
      assert.strictEqual(result.safe, false);
      assert.ok(result.reason.includes('domain'));
    });

    it('allows cross-domain redirect when requireSameDomain is false', async () => {
      const result = await validateRedirectTarget(
        'https://other.com/page',
        'https://example.com',
        false
      );
      assert.strictEqual(result.safe, true);
    });

    it('blocks redirect to different github.io subdomain', async () => {
      const result = await validateRedirectTarget(
        'https://attacker.github.io/page',
        'https://victim.github.io',
        true
      );
      assert.strictEqual(result.safe, false);
    });

    it('blocks redirect to private IP (127.0.0.1)', async () => {
      const result = await validateRedirectTarget(
        'http://127.0.0.1/admin',
        'https://example.com',
        false
      );
      assert.strictEqual(result.safe, false);
      assert.ok(result.reason.includes('SSRF'));
    });

    it('blocks redirect to AWS metadata IP', async () => {
      const result = await validateRedirectTarget(
        'http://169.254.169.254/latest/meta-data',
        'https://example.com',
        false
      );
      assert.strictEqual(result.safe, false);
      assert.ok(result.reason.includes('SSRF'));
    });

    it('rejects invalid redirect URL', async () => {
      const result = await validateRedirectTarget(
        'not-a-valid-url',
        'https://example.com',
        false
      );
      assert.strictEqual(result.safe, false);
      assert.ok(result.reason.includes('Invalid'));
    });

  });

});
