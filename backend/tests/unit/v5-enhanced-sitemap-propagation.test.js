/**
 * V5 Enhanced Engine Sitemap Propagation Test
 * Ensures scanEvidence.siteMetrics.sitemap retains classified lists/flags.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const V5EnhancedRubricEngine = require('../../analyzers/v5-enhanced-rubric-engine');
const SiteCrawler = require('../../analyzers/site-crawler');

describe('V5EnhancedRubricEngine sitemap propagation', () => {
  it('preserves classified sitemap lists/flags in scanEvidence', async () => {
    const originalCrawl = SiteCrawler.prototype.crawl;

    const pageEvidence = {
      url: 'https://example.com',
      navigation: { keyPages: {}, allNavLinks: [], headerLinks: [], navLinks: [], footerLinks: [] },
      structure: {
        hasNav: false,
        hasHeader: false,
        hasFooter: false,
        hasMain: true,
        headingHierarchy: [],
        headingCount: { h1: 1, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
        internalLinks: 0
      },
      content: {
        headings: { h1: ['Home'], h2: [], h3: [], h4: [], h5: [], h6: [] },
        paragraphs: [],
        faqs: [],
        lists: [],
        tables: [],
        wordCount: 0,
        bodyText: ''
      },
      technical: {
        structuredData: [],
        hasFAQSchema: false,
        hasArticleSchema: false,
        hasOrganizationSchema: false,
        isJSRendered: false
      },
      metadata: { title: '', description: '', lastModified: '', publishedTime: '' },
      media: { imageCount: 0, imagesWithAlt: 0, images: [], videos: [], audio: [] },
      performance: {},
      accessibility: {},
      entities: {},
      html: ''
    };

    const fakeSiteData = {
      pageCount: 1,
      pages: [{ url: 'https://example.com', evidence: pageEvidence }],
      sitemapDetected: true,
      sitemapLocation: 'sitemap.xml',
      sitemap: {
        detected: true,
        location: 'sitemap.xml',
        urls: ['https://example.com/blog', 'https://example.com/faq'],
        blogUrls: ['https://example.com/blog'],
        faqUrls: ['https://example.com/faq'],
        hasBlogUrls: true,
        hasFaqUrls: true
      },
      siteMetrics: {
        discoveredSections: { hasBlogUrl: true, hasFaqUrl: true },
        pagesWithQuestionHeadings: 0,
        pagesWithLists: 0,
        avgFleschScore: 60,
        avgSentenceLength: 20,
        pagesWithProperH1: 1,
        pagesWithSemanticHTML: 1,
        pagesWithGoodAltText: 1,
        pagesWithSchema: 0,
        pagesWithOrganizationSchema: 0,
        pagesWithLastModified: 0,
        pagesWithCurrentYear: 0,
        pagesWithLongTailKeywords: 0,
        pagesWithConversationalContent: 0,
        pillarPageCount: 0,
        topicClusterCoverage: 0,
        avgWordCount: 0,
        avgImageCount: 0,
        avgEntitiesPerPage: 0,
        pagesWithLocationData: 0,
        pagesWithFAQSchema: 0,
        pagesWithFAQs: 0
      }
    };

    SiteCrawler.prototype.crawl = async function crawl() {
      return fakeSiteData;
    };

    try {
      const engine = new V5EnhancedRubricEngine('https://example.com', {
        maxPages: 1,
        timeout: 1000,
        tier: 'diy',
        allowHeadless: false
      });
      await engine.analyze();

      assert.deepStrictEqual(engine.evidence.siteMetrics.sitemap.blogUrls, ['https://example.com/blog']);
      assert.deepStrictEqual(engine.evidence.siteMetrics.sitemap.faqUrls, ['https://example.com/faq']);
      assert.strictEqual(engine.evidence.siteMetrics.sitemap.hasBlogUrls, true);
      assert.strictEqual(engine.evidence.siteMetrics.sitemap.hasFaqUrls, true);
    } finally {
      SiteCrawler.prototype.crawl = originalCrawl;
    }
  });
});
