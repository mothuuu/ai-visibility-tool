/**
 * Unit tests for safe-http utility
 * RULEBOOK v1.2 Step C8: Tests for SSRF protection
 *
 * Run with: node --test backend/tests/unit/safe-http.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  isBlockedIP,
  isSameRegistrableDomain,
  getRegistrableDomain
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

});
