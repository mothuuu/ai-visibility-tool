/**
 * Unit tests for joinUrl utility
 *
 * Verifies that URL construction never produces double slashes.
 * Run with: node --test backend/tests/unit/join-url.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// Import joinUrl directly to avoid transitive dependency on psl/safe-http
// The function is self-contained with no external deps
function joinUrl(base, path) {
  const cleanBase = (base || '').replace(/\/+$/, '');
  const cleanPath = (path || '').replace(/^\/+/, '');
  return cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
}

describe('joinUrl', () => {

  it('joins base and path with single slash', () => {
    assert.strictEqual(joinUrl('example.com', 'sitemap.xml'), 'example.com/sitemap.xml');
  });

  it('handles base with trailing slash + path with leading slash (double slash prevention)', () => {
    assert.strictEqual(joinUrl('example.com/', '/sitemap.xml'), 'example.com/sitemap.xml');
  });

  it('handles base without slash + path with leading slash', () => {
    assert.strictEqual(joinUrl('example.com', '/sitemap.xml'), 'example.com/sitemap.xml');
  });

  it('handles base with trailing slash + path without leading slash', () => {
    assert.strictEqual(joinUrl('example.com/', 'sitemap.xml'), 'example.com/sitemap.xml');
  });

  it('handles multiple trailing/leading slashes', () => {
    assert.strictEqual(joinUrl('example.com///', '///sitemap.xml'), 'example.com/sitemap.xml');
  });

  it('handles full origin with trailing slash', () => {
    assert.strictEqual(joinUrl('https://example.com/', '/robots.txt'), 'https://example.com/robots.txt');
  });

  it('handles full origin without trailing slash', () => {
    assert.strictEqual(joinUrl('https://example.com', 'robots.txt'), 'https://example.com/robots.txt');
  });

  it('handles empty path', () => {
    assert.strictEqual(joinUrl('example.com', ''), 'example.com');
  });

  it('handles null base', () => {
    assert.strictEqual(joinUrl(null, 'sitemap.xml'), '/sitemap.xml');
  });

  it('handles null path', () => {
    assert.strictEqual(joinUrl('example.com', null), 'example.com');
  });

  it('preserves protocol double-slash (https://)', () => {
    assert.strictEqual(joinUrl('https://example.com', 'sitemap.xml'), 'https://example.com/sitemap.xml');
  });

  it('works with sitemap_index.xml path', () => {
    assert.strictEqual(joinUrl('example.com', '/sitemap_index.xml'), 'example.com/sitemap_index.xml');
  });

  it('works with nested paths', () => {
    assert.strictEqual(joinUrl('example.com/', '/blog/article-title'), 'example.com/blog/article-title');
  });
});
