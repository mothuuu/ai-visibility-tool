'use strict';

/**
 * Phase 2.5.1: site-level FAQ dedup + question-form filter.
 *  - dedupeFaqs collapses cross-page duplicates (the scan-1001 pattern) while
 *    keeping the schema source and page-specific entries.
 *  - the interrogative filter drops non-question section titles
 *    ("Frequently Asked Questions") captured by the html method, without
 *    touching schema/details/aria or legitimate interrogative entries.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

const { ContentExtractor } = require('../../analyzers/content-extractor');
const { dedupeFaqs, isInterrogative } = require('../../utils/faqHygiene');

function extractFAQs(html, structuredData = []) {
  const $ = cheerio.load(html);
  return new ContentExtractor('https://example.com', {}).extractFAQs($, structuredData);
}
const qset = faqs => new Set(faqs.map(f => f.question));

// ---- Fixture 1: multi-page aggregation (scan-1001 cross-page duplicates) ----
describe('Phase 2.5.1: site-level dedup across pages', () => {
  // Shared head-template FAQPage schema present on BOTH pages.
  const sharedSchema = {
    type: 'FAQPage',
    raw: {
      '@type': 'FAQPage',
      mainEntity: [
        { '@type': 'Question', name: 'What is Visible2AI?', acceptedAnswer: { '@type': 'Answer', text: 'An AI visibility platform.' } },
        { '@type': 'Question', name: 'Who is Visible2AI for?', acceptedAnswer: { '@type': 'Answer', text: 'Marketing teams and agencies.' } },
        { '@type': 'Question', name: 'What is AI Visibility Score?', acceptedAnswer: { '@type': 'Answer', text: 'A 0-1000 measure of AI answer presence.' } },
      ],
    },
  };
  // Each page also has one page-specific visible FAQ.
  const homeFaqs = extractFAQs(
    '<body><section class="faq"><h3>Do you offer a free plan?</h3><p>Yes, a free tier is available to start.</p></section></body>',
    [sharedSchema]
  );
  const contactFaqs = extractFAQs(
    '<body><section class="faq"><h3>How do I contact support?</h3><p>Email support@visible2ai.com any time.</p></section></body>',
    [sharedSchema]
  );

  // Simulate the site-level aggregation (v5-enhanced-rubric-engine push(...faqs)).
  const aggregated = [...homeFaqs, ...contactFaqs];
  const deduped = dedupeFaqs(aggregated);

  it('per-page extraction repeats the shared schema questions across pages', () => {
    // Pre-dedup the aggregate carries each schema question twice.
    const countWhatIs = aggregated.filter(f => f.question === 'What is Visible2AI?').length;
    assert.equal(countWhatIs, 2, 'shared schema question appears once per page before site dedup');
  });

  it('site-level dedup: each schema question appears exactly ONCE, from schema', () => {
    const whatIs = deduped.filter(f => f.question === 'What is Visible2AI?');
    assert.equal(whatIs.length, 1);
    assert.equal(whatIs[0].source, 'schema');
    // all three shared schema questions present once
    for (const q of ['What is Visible2AI?', 'Who is Visible2AI for?', 'What is AI Visibility Score?']) {
      assert.equal(deduped.filter(f => f.question === q).length, 1, `${q} once`);
    }
  });

  it('page-specific entries are preserved', () => {
    assert.ok(qset(deduped).has('Do you offer a free plan?'));
    assert.ok(qset(deduped).has('How do I contact support?'));
  });

  it('no duplicate questions remain in the aggregate', () => {
    const keys = deduped.map(f => f.question.toLowerCase());
    assert.equal(new Set(keys).size, keys.length);
    // 3 shared + 2 page-specific = 5 distinct
    assert.equal(deduped.length, 5);
  });
});

// ---- Fixture 2: non-question section title dropped --------------------------
describe('Phase 2.5.1: question-form filter drops section titles', () => {
  const faqs = extractFAQs(`
    <body>
      <div class="faq">
        <h2>Frequently Asked Questions</h2>
        <h3>What is your refund policy?</h3>
        <p>Refunds are available within 30 days of purchase, no questions asked.</p>
      </div>
    </body>`);

  it('"Frequently Asked Questions" (non-interrogative html title) is dropped', () => {
    assert.ok(!qset(faqs).has('Frequently Asked Questions'));
  });
  it('the real Q&A is kept', () => {
    assert.ok(qset(faqs).has('What is your refund policy?'));
    const q = faqs.find(f => f.question === 'What is your refund policy?');
    assert.match(q.answer, /Refunds are available/);
  });
});

// ---- Unit coverage: isInterrogative + provenance exemption ------------------
describe('Phase 2.5.1: isInterrogative + schema exemption', () => {
  it('recognizes questions by ? or opening word', () => {
    assert.equal(isInterrogative('What is your refund policy?'), true);
    assert.equal(isInterrogative('Do you offer demos'), true);   // opening auxiliary
    assert.equal(isInterrogative('How it works'), true);         // opening interrogative word
    assert.equal(isInterrogative('Frequently Asked Questions'), false);
    assert.equal(isInterrogative('Pricing'), false);
    assert.equal(isInterrogative(''), false);
  });
  it('schema-source non-question ("Pricing") survives (exempt provenance)', () => {
    const faqs = extractFAQs('<body><main><h1>Home</h1></main></body>', [{
      type: 'FAQPage',
      raw: { '@type': 'FAQPage', mainEntity: [
        { '@type': 'Question', name: 'Pricing', acceptedAnswer: { '@type': 'Answer', text: 'Flat monthly fee per seat, billed annually.' } },
        { '@type': 'Question', name: 'What is included?', acceptedAnswer: { '@type': 'Answer', text: 'All features on every plan.' } },
      ] },
    }]);
    assert.ok(qset(faqs).has('Pricing'), 'schema "Pricing" not dropped by interrogative filter');
  });
});
