/**
 * Blog/FAQ Detection Regression Tests
 * RULEBOOK v1.2 - Comprehensive fix verification
 *
 * Run with: node --test backend/tests/unit/blog-faq-detection.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const VOCABULARY = require('../../config/detection-vocabulary');

describe('Blog/FAQ Detection Regression Tests', () => {

  /**
   * TEST 1: Sitemap-only Blog
   * Homepage has no blog link, but sitemap includes /insights/*
   * Expected: Blog detected via sitemap
   */
  describe('Sitemap-only Blog Detection', () => {

    it('detects blog from sitemap when nav has no blog link', () => {
      const scanEvidence = {
        url: 'https://example.com',
        navigation: {
          allNavLinks: [
            { href: '/about', text: 'About' },
            { href: '/contact', text: 'Contact' }
          ],
          keyPages: { blog: false, faq: false, about: true, contact: true },
          hasBlogLink: false
        },
        technical: {
          hasArticleSchema: false,
          hasFAQSchema: false
        },
        content: { faqs: [] },
        crawler: {
          discoveredSections: { hasBlogUrl: false, hasFaqUrl: false }
        },
        siteMetrics: {
          sitemap: {
            detected: true,
            location: 'https://example.com/sitemap.xml',
            blogUrls: [
              'https://example.com/insights/post-1',
              'https://example.com/insights/post-2',
              'https://example.com/insights/post-3'
            ],
            faqUrls: [],
            hasBlogUrls: true,
            hasFaqUrls: false
          },
          discoveredSections: { hasBlogUrl: false }
        }
      };

      // Check sitemap has blog URLs
      assert.strictEqual(scanEvidence.siteMetrics.sitemap.hasBlogUrls, true);
      assert.strictEqual(scanEvidence.siteMetrics.sitemap.blogUrls.length, 3);

      // Simulate detection logic
      const blogFound =
        scanEvidence.crawler?.discoveredSections?.hasBlogUrl ||
        scanEvidence.siteMetrics?.sitemap?.hasBlogUrls ||
        scanEvidence.navigation?.keyPages?.blog ||
        scanEvidence.navigation?.hasBlogLink ||
        scanEvidence.technical?.hasArticleSchema;

      assert.strictEqual(blogFound, true, 'Blog should be detected via sitemap');
    });

  });

  /**
   * TEST 2: JS-rendered Nav
   * After headless render, nav should be populated
   * Expected: Blog/FAQ detected from nav
   */
  describe('JS-rendered Nav Detection', () => {

    it('detects blog/faq from nav after headless renders', () => {
      // Simulate post-headless extraction with nav populated
      const scanEvidence = {
        url: 'https://js-app.com',
        navigation: {
          allNavLinks: [
            { href: '/blog', text: 'Blog' },
            { href: '/faq', text: 'FAQ' },
            { href: '/about', text: 'About' }
          ],
          keyPages: { blog: true, faq: true, about: true },
          hasBlogLink: true,
          hasFAQLink: true
        },
        technical: {
          isJSRendered: true,
          rendered: true,
          renderSource: 'headless'
        },
        content: {
          wordCount: 1500,
          faqs: []
        },
        crawler: { discoveredSections: {} },
        siteMetrics: { sitemap: { detected: false } }
      };

      // Check nav-based detection
      assert.strictEqual(scanEvidence.navigation.keyPages.blog, true);
      assert.strictEqual(scanEvidence.navigation.keyPages.faq, true);
      assert.strictEqual(scanEvidence.navigation.hasBlogLink, true);
      assert.strictEqual(scanEvidence.navigation.hasFAQLink, true);

      // Simulate detection logic
      const blogFound =
        scanEvidence.navigation?.keyPages?.blog ||
        scanEvidence.navigation?.hasBlogLink;
      const faqFound =
        scanEvidence.navigation?.keyPages?.faq ||
        scanEvidence.navigation?.hasFAQLink;

      assert.strictEqual(blogFound, true, 'Blog should be detected via nav');
      assert.strictEqual(faqFound, true, 'FAQ should be detected via nav');
    });

  });

  /**
   * TEST 3: Synonym Coverage
   * Various URL patterns should be classified correctly
   */
  describe('Synonym Coverage', () => {

    it('classifies /guides/, /library/, /resources/ as blog', () => {
      const blogSynonymUrls = [
        'https://example.com/guides/getting-started',
        'https://example.com/library/whitepaper-1',
        'https://example.com/resources/case-study',
        'https://example.com/insights/thought-leadership',
        'https://example.com/learn/tutorial',
        'https://example.com/perspectives/ceo-letter',
        'https://example.com/blog/post',
        'https://example.com/news/announcement',
        'https://example.com/articles/feature',
        'https://example.com/thought-leadership/opinion',
        'https://example.com/whitepapers/report',
        'https://example.com/case-studies/client-success'
      ];

      for (const url of blogSynonymUrls) {
        const isBlog = VOCABULARY.URL_PATTERNS.blog.test(url);
        assert.strictEqual(isBlog, true, `${url} should match blog pattern`);
      }
    });

    it('classifies /help/, /support/, /q-and-a/ as FAQ', () => {
      const faqSynonymUrls = [
        'https://example.com/help/topic',
        'https://example.com/support/article',
        'https://example.com/knowledge-base/faq',
        'https://example.com/q-and-a/common',
        'https://example.com/faq',
        'https://example.com/faqs/general',
        'https://example.com/frequently-asked-questions',
        'https://example.com/questions/how-to',
        'https://example.com/answers/guide',
        'https://example.com/support-center/help'
      ];

      for (const url of faqSynonymUrls) {
        const isFaq = VOCABULARY.URL_PATTERNS.faq.test(url);
        assert.strictEqual(isFaq, true, `${url} should match FAQ pattern`);
      }
    });

    it('does not falsely classify unrelated URLs', () => {
      const nonBlogUrls = [
        'https://example.com/',
        'https://example.com/about',
        'https://example.com/contact',
        'https://example.com/pricing',
        'https://example.com/product/details'
      ];

      for (const url of nonBlogUrls) {
        const isBlog = VOCABULARY.URL_PATTERNS.blog.test(url);
        assert.strictEqual(isBlog, false, `${url} should NOT match blog pattern`);
      }
    });

  });

  /**
   * TEST 4: Sitemap classifier uses vocabulary
   */
  describe('Sitemap Classification Integration', () => {

    it('classifyUrls uses VOCABULARY and returns correct structure', () => {
      const urls = [
        'https://example.com/',
        'https://example.com/about',
        'https://example.com/insights/post-1',
        'https://example.com/resources/guide',
        'https://example.com/faq',
        'https://example.com/help/article'
      ];

      const result = VOCABULARY.classifyUrls(urls);

      // Check structure
      assert.ok(result.hasBlogUrls !== undefined, 'Should have hasBlogUrls flag');
      assert.ok(result.hasFaqUrls !== undefined, 'Should have hasFaqUrls flag');
      assert.ok(Array.isArray(result.blogUrls), 'Should have blogUrls array');
      assert.ok(Array.isArray(result.faqUrls), 'Should have faqUrls array');

      // Check classification
      assert.strictEqual(result.hasBlogUrls, true, 'Should detect blog URLs');
      assert.strictEqual(result.hasFaqUrls, true, 'Should detect FAQ URLs');
      assert.ok(result.blogUrls.length >= 2, 'Should find at least 2 blog URLs');
      assert.ok(result.faqUrls.length >= 2, 'Should find at least 2 FAQ URLs');
    });

  });

  /**
   * TEST 5: Nav text pattern matching
   */
  describe('Nav Text Pattern Matching', () => {

    it('matches blog nav text variations', () => {
      const blogTexts = ['Blog', 'News', 'Articles', 'Insights', 'Resources', 'Learn', 'Guides'];

      for (const text of blogTexts) {
        const matches = VOCABULARY.NAV_TEXT_PATTERNS.blog.test(text);
        assert.strictEqual(matches, true, `"${text}" should match blog nav pattern`);
      }
    });

    it('matches FAQ nav text variations', () => {
      const faqTexts = ['FAQ', 'FAQs', 'Help', 'Support', 'Questions', 'Q&A'];

      for (const text of faqTexts) {
        const matches = VOCABULARY.NAV_TEXT_PATTERNS.faq.test(text);
        assert.strictEqual(matches, true, `"${text}" should match FAQ nav pattern`);
      }
    });

  });

  /**
   * TEST 6: Multi-source detection priority
   */
  describe('Multi-source Detection Priority', () => {

    it('detects blog from any valid source', () => {
      // Test each source independently
      const sources = [
        { crawler: { discoveredSections: { hasBlogUrl: true } } },
        { siteMetrics: { sitemap: { hasBlogUrls: true } } },
        { navigation: { keyPages: { blog: true } } },
        { navigation: { hasBlogLink: true } },
        { technical: { hasArticleSchema: true } }
      ];

      for (const evidence of sources) {
        const blogFound =
          evidence.crawler?.discoveredSections?.hasBlogUrl ||
          evidence.siteMetrics?.sitemap?.hasBlogUrls ||
          evidence.navigation?.keyPages?.blog ||
          evidence.navigation?.hasBlogLink ||
          evidence.technical?.hasArticleSchema;

        assert.strictEqual(blogFound, true, `Should detect blog from: ${JSON.stringify(evidence)}`);
      }
    });

    it('returns false when no blog source is present', () => {
      const evidence = {
        crawler: { discoveredSections: { hasBlogUrl: false } },
        siteMetrics: { sitemap: { hasBlogUrls: false } },
        navigation: { keyPages: { blog: false }, hasBlogLink: false },
        technical: { hasArticleSchema: false }
      };

      const blogFound =
        evidence.crawler?.discoveredSections?.hasBlogUrl ||
        evidence.siteMetrics?.sitemap?.hasBlogUrls ||
        evidence.navigation?.keyPages?.blog ||
        evidence.navigation?.hasBlogLink ||
        evidence.technical?.hasArticleSchema;

      assert.strictEqual(blogFound, false, 'Should not detect blog when no source has it');
    });

  });

});
