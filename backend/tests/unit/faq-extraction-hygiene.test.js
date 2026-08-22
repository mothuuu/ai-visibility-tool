'use strict';

/**
 * Phase 2.5: FAQ extraction hygiene in content-extractor.extractFAQs, plus the
 * mandatory detection-delta assertions (extraction feeds faqCount → icp_faqs).
 *
 * Reproduces the scan-789 patterns as cheerio-loadable HTML:
 *  - numbered question headings ("1. What counts…")
 *  - the same question extracted by two DOM regions (numbered + quoted variant)
 *  - a ?-CTA heading followed by a button and a footer trust-badge strip
 *  - a legitimate footer-adjacent FAQ (proves no over-stripping / no bleed)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

const { ContentExtractor } = require('../../analyzers/content-extractor');
const { getDetectionState, DETECTION_STATE } = require('../../phase2_preserved/detectionStates.top10');

function extractFAQs(html, structuredData = []) {
  const $ = cheerio.load(html);
  const ex = new ContentExtractor('https://example.com', {});
  return ex.extractFAQs($, structuredData);
}
const questionsOf = faqs => faqs.map(f => f.question);
const answersBlob = faqs => faqs.map(f => f.answer).join('\n');

// ---- Fixture 1: the dirty 789-shaped page --------------------------------
const DIRTY_789 = `
<body>
  <main>
    <h2>Frequently Asked Questions</h2>
    <h3>1. What counts as a valid assessment?</h3>
    <p>It is a thorough review of your systems and controls, delivered with a written report.</p>
    <h3>2. How long does onboarding take?</h3>
    <p>Typically two to three weeks depending on scope.</p>
    <h3>Want a fast assessment instead of guessing?</h3>
    <button class="cta-btn">Request an Assessment</button>
    <footer class="trust-badges">
      <div>8(a) Certified</div><div>GSA Schedule</div><div>WOSB</div><div>CMMI Level 3</div><div>SOC 2</div><div>ISO 27001</div>
    </footer>
  </main>
  <div class="faq-section">
    <h3>"What counts as a valid assessment?"</h3>
    <p>A short duplicate answer.</p>
  </div>
</body>`;

describe('Phase 2.5: extractFAQs cleans the 789-shaped page', () => {
  const faqs = extractFAQs(DIRTY_789);
  const qs = questionsOf(faqs);

  it('before→after: inflated/dirty DOM collapses to the clean unique set', () => {
    // The DOM yields the same 2 real questions via 3 methods (section/heading/html)
    // plus a numbered variant, a quoted duplicate, and a CTA pseudo-question.
    // After hygiene: exactly the 2 real, deduped questions.
    assert.equal(faqs.length, 2, `expected 2 clean FAQs, got ${faqs.length}: ${JSON.stringify(qs)}`);
    assert.deepEqual(
      new Set(qs),
      new Set(['What counts as a valid assessment?', 'How long does onboarding take?'])
    );
  });

  it('Defect: numbered/quoted enumeration stripped from questions', () => {
    assert.ok(qs.every(q => !/^\s*\d+[.)]/.test(q)), 'no leading "1." / "2)"');
    assert.ok(qs.every(q => !/^["“”']/.test(q)), 'no wrapping quotes');
  });

  it('Defect: duplicate (numbered vs quoted) merged, longer answer kept', () => {
    const withKey = new Set(qs.map(q => q.toLowerCase()));
    assert.equal(withKey.size, qs.length, 'no duplicate questions remain');
    const counts = faqs.find(f => /valid assessment/i.test(f.question));
    assert.match(counts.answer, /written report/, 'kept the longer answer of the duplicate pair');
  });

  it('Defect: CTA pseudo-question dropped', () => {
    assert.ok(!qs.some(q => /^want\b/i.test(q)), 'no "Want…?" CTA question');
  });

  it('Defect: no trust-badge / CTA-button text bled into any answer', () => {
    const blob = answersBlob(faqs);
    assert.ok(!/8\(a\)|GSA Schedule|WOSB|CMMI|ISO ?27001|SOC ?2/.test(blob), 'no badge tokens in answers');
    assert.ok(!/Request an Assessment/.test(blob), 'no CTA button text in answers');
  });

  it('detection delta: clean single-digit count, no schema → CONTENT_NO_SCHEMA (finding FIRES)', () => {
    const evidence = { content: { faqs }, technical: { hasFAQSchema: false, structuredData: [] } };
    const state = getDetectionState('ai_search_readiness.icp_faqs', evidence);
    assert.ok(faqs.length > 0 && faqs.length < 10, 'realistic single-digit count');
    assert.equal(state, DETECTION_STATE.CONTENT_NO_SCHEMA);
  });
});

// ---- Fixture 2: legitimate footer-adjacent FAQ (no over-stripping) --------
const LEGIT_FOOTER_ADJACENT = `
<body>
  <section class="faq-block">
    <h3>Do you offer remote support?</h3>
    <p>Yes, we provide remote support worldwide during business hours, with guaranteed response times.</p>
  </section>
  <footer class="site-footer">
    <nav><a href="/">Home</a> <a href="/contact">Contact</a></nav>
    <div class="badges">ISO 27001 SOC 2 CMMI Level 3</div>
  </footer>
</body>`;

describe('Phase 2.5: legitimate footer-adjacent FAQ is kept and not bled', () => {
  const faqs = extractFAQs(LEGIT_FOOTER_ADJACENT);
  it('the real FAQ survives (no over-stripping)', () => {
    assert.equal(faqs.length, 1);
    assert.equal(faqs[0].question, 'Do you offer remote support?');
    assert.match(faqs[0].answer, /remote support worldwide/);
  });
  it('adjacent footer nav/badge text does not appear in the answer', () => {
    assert.ok(!/ISO ?27001|SOC ?2|CMMI|Home|Contact/.test(faqs[0].answer));
  });
});

// ---- Fixture 3: FAQ-rich + FAQPage schema → COMPLETE (no over-filtering) ---
const FAQPAGE_SCHEMA = {
  type: 'FAQPage',
  raw: {
    '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: 'What is your pricing model?', acceptedAnswer: { '@type': 'Answer', text: 'We charge a flat monthly fee per seat.' } },
      { '@type': 'Question', name: 'Where are you located?', acceptedAnswer: { '@type': 'Answer', text: 'We are headquartered in Austin, Texas.' } },
      { '@type': 'Question', name: 'Do you offer a trial?', acceptedAnswer: { '@type': 'Answer', text: 'Yes, a 14-day free trial is available.' } },
      { '@type': 'Question', name: 'How is my data secured?', acceptedAnswer: { '@type': 'Answer', text: 'All data is encrypted in transit and at rest.' } },
      { '@type': 'Question', name: 'Can I export my data?', acceptedAnswer: { '@type': 'Answer', text: 'You can export to CSV at any time from settings.' } },
    ],
  },
};

describe('Phase 2.5: FAQ-rich + FAQPage schema still reaches COMPLETE', () => {
  const faqs = extractFAQs('<body><main><h1>Home</h1></main></body>', [FAQPAGE_SCHEMA]);
  it('all 5 schema FAQs extracted (no over-filtering)', () => {
    assert.equal(faqs.length, 5);
    assert.ok(faqs.every(f => f.source === 'schema'));
  });
  it('detection delta: 5+ FAQs + schema → COMPLETE (no new false positive)', () => {
    const evidence = { content: { faqs }, technical: { hasFAQSchema: true, structuredData: [FAQPAGE_SCHEMA] } };
    const state = getDetectionState('ai_search_readiness.icp_faqs', evidence);
    assert.equal(state, DETECTION_STATE.COMPLETE);
  });
});
