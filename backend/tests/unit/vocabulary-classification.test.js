/**
 * Unit tests for vocabulary URL classification
 * RULEBOOK v1.2 Step G5: Tests for centralized VOCABULARY patterns
 *
 * Run with: node --test backend/tests/unit/vocabulary-classification.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const VOCABULARY = require('../../config/detection-vocabulary');

describe('detection-vocabulary', () => {

  describe('URL_PATTERNS', () => {

    describe('blog pattern', () => {

      it('matches /blog path', () => {
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/blog'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/blog/'));
      });

      it('matches /blog subpaths', () => {
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/blog/my-post'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/blog/2024/article'));
      });

      it('matches extended blog synonyms', () => {
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/news'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/articles'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/insights'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/resources'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/updates'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/journal'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/posts'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/learn'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/knowledge-base'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/help-center'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/guides'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/library'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/content'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/stories'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/perspectives'));
      });

      it('matches anchor links for single-page sites', () => {
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('#blog'));
        assert.ok(VOCABULARY.URL_PATTERNS.blog.test('/#blog'));
      });

      it('does not match unrelated paths', () => {
        assert.ok(!VOCABULARY.URL_PATTERNS.blog.test('/about'));
        assert.ok(!VOCABULARY.URL_PATTERNS.blog.test('/contact'));
        assert.ok(!VOCABULARY.URL_PATTERNS.blog.test('/blogging-tips')); // word boundary
      });

    });

    describe('faq pattern', () => {

      it('matches /faq path', () => {
        assert.ok(VOCABULARY.URL_PATTERNS.faq.test('/faq'));
        assert.ok(VOCABULARY.URL_PATTERNS.faq.test('/faq/'));
        assert.ok(VOCABULARY.URL_PATTERNS.faq.test('/faqs'));
      });

      it('matches faq synonyms', () => {
        assert.ok(VOCABULARY.URL_PATTERNS.faq.test('/frequently-asked'));
        assert.ok(VOCABULARY.URL_PATTERNS.faq.test('/help'));
        assert.ok(VOCABULARY.URL_PATTERNS.faq.test('/support'));
        assert.ok(VOCABULARY.URL_PATTERNS.faq.test('/questions'));
      });

      it('matches anchor links', () => {
        assert.ok(VOCABULARY.URL_PATTERNS.faq.test('#faq'));
        assert.ok(VOCABULARY.URL_PATTERNS.faq.test('/#faq'));
      });

    });

    describe('about pattern', () => {

      it('matches about variations', () => {
        assert.ok(VOCABULARY.URL_PATTERNS.about.test('/about'));
        assert.ok(VOCABULARY.URL_PATTERNS.about.test('/about-us'));
        assert.ok(VOCABULARY.URL_PATTERNS.about.test('/who-we-are'));
        assert.ok(VOCABULARY.URL_PATTERNS.about.test('/our-story'));
        assert.ok(VOCABULARY.URL_PATTERNS.about.test('/company'));
      });

    });

    describe('contact pattern', () => {

      it('matches contact variations', () => {
        assert.ok(VOCABULARY.URL_PATTERNS.contact.test('/contact'));
        assert.ok(VOCABULARY.URL_PATTERNS.contact.test('/contact-us'));
        assert.ok(VOCABULARY.URL_PATTERNS.contact.test('/get-in-touch'));
        assert.ok(VOCABULARY.URL_PATTERNS.contact.test('/reach-us'));
      });

    });

    describe('pricing pattern', () => {

      it('matches pricing variations', () => {
        assert.ok(VOCABULARY.URL_PATTERNS.pricing.test('/pricing'));
        assert.ok(VOCABULARY.URL_PATTERNS.pricing.test('/plans'));
        assert.ok(VOCABULARY.URL_PATTERNS.pricing.test('/packages'));
        assert.ok(VOCABULARY.URL_PATTERNS.pricing.test('/cost'));
        assert.ok(VOCABULARY.URL_PATTERNS.pricing.test('/rates'));
      });

    });

  });

  describe('matchesUrlPattern()', () => {

    it('returns true for matching URLs', () => {
      assert.strictEqual(VOCABULARY.matchesUrlPattern('/blog', 'blog'), true);
      assert.strictEqual(VOCABULARY.matchesUrlPattern('/faq', 'faq'), true);
      assert.strictEqual(VOCABULARY.matchesUrlPattern('/about', 'about'), true);
    });

    it('returns false for non-matching URLs', () => {
      assert.strictEqual(VOCABULARY.matchesUrlPattern('/blog', 'faq'), false);
      assert.strictEqual(VOCABULARY.matchesUrlPattern('/random', 'blog'), false);
    });

    it('returns false for unknown page type', () => {
      assert.strictEqual(VOCABULARY.matchesUrlPattern('/blog', 'unknownType'), false);
    });

  });

  describe('classifyUrl()', () => {

    it('returns array of matching categories', () => {
      const matches = VOCABULARY.classifyUrl('/blog');
      assert.ok(Array.isArray(matches));
      assert.ok(matches.includes('blog'));
    });

    it('returns multiple matches when applicable', () => {
      // A URL could theoretically match multiple patterns
      const matches = VOCABULARY.classifyUrl('/support');
      assert.ok(matches.includes('faq') || matches.includes('support'));
    });

    it('returns empty array for no matches', () => {
      const matches = VOCABULARY.classifyUrl('/random-page');
      assert.ok(Array.isArray(matches));
      assert.strictEqual(matches.length, 0);
    });

  });

  describe('classifyUrls()', () => {

    it('classifies array of URLs', () => {
      const urls = [
        'https://example.com/blog',
        'https://example.com/faq',
        'https://example.com/about',
        'https://example.com/random'
      ];

      const result = VOCABULARY.classifyUrls(urls);

      assert.ok(result.blogUrls.length > 0);
      assert.ok(result.faqUrls.length > 0);
      assert.ok(result.aboutUrls.length > 0);
      assert.strictEqual(result.hasBlogUrls, true);
      assert.strictEqual(result.hasFaqUrls, true);
      assert.strictEqual(result.hasAboutUrls, true);
    });

    it('sets boolean flags correctly when no matches', () => {
      const urls = ['https://example.com/random1', 'https://example.com/random2'];
      const result = VOCABULARY.classifyUrls(urls);

      assert.strictEqual(result.hasBlogUrls, false);
      assert.strictEqual(result.hasFaqUrls, false);
      assert.strictEqual(result.blogUrls.length, 0);
    });

    it('handles empty array', () => {
      const result = VOCABULARY.classifyUrls([]);
      assert.strictEqual(result.hasBlogUrls, false);
      assert.strictEqual(result.blogUrls.length, 0);
    });

    it('includes totalClassified count', () => {
      const urls = ['/blog', '/faq', '/contact'];
      const result = VOCABULARY.classifyUrls(urls);
      assert.ok(typeof result.totalClassified === 'number');
      assert.ok(result.totalClassified >= 3);
    });

  });

  describe('NAV_TEXT_PATTERNS', () => {

    it('matches blog nav text', () => {
      assert.ok(VOCABULARY.NAV_TEXT_PATTERNS.blog.test('Blog'));
      assert.ok(VOCABULARY.NAV_TEXT_PATTERNS.blog.test('News'));
      assert.ok(VOCABULARY.NAV_TEXT_PATTERNS.blog.test('Articles'));
    });

    it('matches faq nav text', () => {
      assert.ok(VOCABULARY.NAV_TEXT_PATTERNS.faq.test('FAQ'));
      assert.ok(VOCABULARY.NAV_TEXT_PATTERNS.faq.test('FAQs'));
      assert.ok(VOCABULARY.NAV_TEXT_PATTERNS.faq.test('Help'));
      assert.ok(VOCABULARY.NAV_TEXT_PATTERNS.faq.test('Support'));
    });

  });

  describe('classifyNavText()', () => {

    it('classifies nav link text', () => {
      assert.strictEqual(VOCABULARY.classifyNavText('Blog'), 'blog');
      assert.strictEqual(VOCABULARY.classifyNavText('FAQ'), 'faq');
      assert.strictEqual(VOCABULARY.classifyNavText('About'), 'about');
    });

    it('is case insensitive', () => {
      assert.strictEqual(VOCABULARY.classifyNavText('BLOG'), 'blog');
      assert.strictEqual(VOCABULARY.classifyNavText('faq'), 'faq');
    });

    it('returns null for unrecognized text', () => {
      assert.strictEqual(VOCABULARY.classifyNavText('Random Link'), null);
    });

  });

  describe('SCHEMA_TYPES', () => {

    it('has organization types', () => {
      assert.ok(VOCABULARY.SCHEMA_TYPES.organization.includes('Organization'));
      assert.ok(VOCABULARY.SCHEMA_TYPES.organization.includes('LocalBusiness'));
    });

    it('has faq types', () => {
      assert.ok(VOCABULARY.SCHEMA_TYPES.faq.includes('FAQPage'));
      assert.ok(VOCABULARY.SCHEMA_TYPES.faq.includes('Question'));
    });

    it('has article types', () => {
      assert.ok(VOCABULARY.SCHEMA_TYPES.article.includes('Article'));
      assert.ok(VOCABULARY.SCHEMA_TYPES.article.includes('BlogPosting'));
    });

  });

  describe('isSchemaType()', () => {

    it('identifies organization schema types', () => {
      assert.strictEqual(VOCABULARY.isSchemaType('Organization', 'organization'), true);
      assert.strictEqual(VOCABULARY.isSchemaType('LocalBusiness', 'organization'), true);
    });

    it('identifies FAQ schema types', () => {
      assert.strictEqual(VOCABULARY.isSchemaType('FAQPage', 'faq'), true);
      assert.strictEqual(VOCABULARY.isSchemaType('Question', 'faq'), true);
    });

    it('returns false for non-matching types', () => {
      assert.strictEqual(VOCABULARY.isSchemaType('FAQPage', 'organization'), false);
      assert.strictEqual(VOCABULARY.isSchemaType('Unknown', 'faq'), false);
    });

  });

  describe('TEXT_PATTERNS', () => {

    describe('questions patterns', () => {

      it('detects question words', () => {
        assert.ok(VOCABULARY.TEXT_PATTERNS.questions.questionWords.test('What is this?'));
        assert.ok(VOCABULARY.TEXT_PATTERNS.questions.questionWords.test('How does it work?'));
        assert.ok(VOCABULARY.TEXT_PATTERNS.questions.questionWords.test('Why should I use this?'));
      });

      it('detects question marks', () => {
        assert.ok(VOCABULARY.TEXT_PATTERNS.questions.endsWithQuestion.test('Is this correct?'));
        assert.ok(!VOCABULARY.TEXT_PATTERNS.questions.endsWithQuestion.test('This is a statement.'));
      });

      it('detects FAQ heading patterns', () => {
        assert.ok(VOCABULARY.TEXT_PATTERNS.questions.faqHeadings.test('Frequently Asked Questions'));
        assert.ok(VOCABULARY.TEXT_PATTERNS.questions.faqHeadings.test('FAQ'));
        assert.ok(VOCABULARY.TEXT_PATTERNS.questions.faqHeadings.test('Q&A'));
      });

    });

  });

  describe('KEYWORDS', () => {

    it('has AI crawler list', () => {
      assert.ok(VOCABULARY.KEYWORDS.aiCrawlers.includes('GPTBot'));
      assert.ok(VOCABULARY.KEYWORDS.aiCrawlers.includes('anthropic-ai'));
      assert.ok(VOCABULARY.KEYWORDS.aiCrawlers.includes('Google-Extended'));
    });

    it('isAiCrawler detects AI user agents', () => {
      assert.strictEqual(VOCABULARY.isAiCrawler('GPTBot/1.0'), true);
      assert.strictEqual(VOCABULARY.isAiCrawler('anthropic-ai'), true);
      assert.strictEqual(VOCABULARY.isAiCrawler('Googlebot/2.1'), false);
    });

  });

});
