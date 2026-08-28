'use strict';

/**
 * Phase 3 (Build 2): FAQ Pack generator — anti-hallucination contract.
 * Uses a synthetic library (libraryOverride) to exercise extraction, fallback,
 * skip-no-fallback, thin block, sub-3 throw, placeholder-leak safety, Xeo
 * safety, within-block dedupe, stage tagging, and JSON-LD validity.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { generateFaqArtifact, resolvePlaceholder, stageBucket, isSafeText } =
  require('../../services/faqArtifactGenerator');

function lib(faqs) { return { faq_library: { industry: 'Test', faqs } }; }
// A generic safe filler entry (fallback-only), stage defaults to consideration (mofu).
function filler(n, stage = 'consideration') {
  return {
    question: `What is feature ${n}?`,
    answer_fallback: `Feature ${n} helps teams work more effectively.`,
    implementation_notes: { buyer_stage: stage },
  };
}
const EV = {
  url: 'https://acme.example.com',
  metadata: { description: 'We serve fintech companies and engineering teams' },
  content: { headings: { h1: ['Acme'] }, paragraphs: ['A platform for fintech.'], faqs: [] },
};
const SCAN = { id: 4242, industry: 'test' };
const innerJson = jsonld => JSON.parse(jsonld.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));

// Entries
const E_EXTRACTED = {
  question: 'What kind of teams do you serve?',
  answer_template: 'We serve {{segment}} teams.',
  answer_fallback: 'We serve many kinds of teams.',
  extraction_rules: { segment: { method: 'keyword_scan', keywords: ['fintech', 'healthcare'], confidence_threshold: 0.7, fallback: 'various' } },
  implementation_notes: { buyer_stage: 'consideration' },
};
const E_FALLBACK = {
  question: 'How fast is it?',
  answer_template: 'Median latency is {{latency}}ms.',
  answer_fallback: 'It runs reliably with low latency.',
  extraction_rules: { latency: { method: 'pattern_scan', patterns: ['(\\d+)ms latency'], confidence_threshold: 0.8, fallback: 'low' } },
  implementation_notes: { buyer_stage: 'consideration' },
};
const E_SKIP_NO_FALLBACK = {
  question: 'What is your uptime?',
  answer_template: 'Uptime is {{uptime}}%.',
  extraction_rules: { uptime: { method: 'pattern_scan', patterns: ['(\\d+)% uptime'], confidence_threshold: 0.8, validation: 'must be between 1-100' } },
  implementation_notes: { buyer_stage: 'consideration' },
  // no answer_fallback → unsafe when extraction fails
};

describe('Phase 3: resolvePlaceholder', () => {
  it('keyword/entity match from evidence, else null', () => {
    assert.equal(resolvePlaceholder({ method: 'keyword_scan', keywords: ['fintech'] }, 'we serve fintech'), 'fintech');
    assert.equal(resolvePlaceholder({ method: 'keyword_scan', keywords: ['banking'] }, 'we serve fintech'), null);
  });
  it('pattern_scan captures a group; validation rejects out-of-range', () => {
    assert.equal(resolvePlaceholder({ method: 'pattern_scan', patterns: ['(\\d+)% uptime'] }, '99% uptime'), '99');
    assert.equal(resolvePlaceholder({ method: 'pattern_scan', patterns: ['(\\d+)% uptime'], validation: 'must be between 1-100' }, '250% uptime'), null);
  });
  it('stageBucket maps freeform labels', () => {
    assert.equal(stageBucket('awareness to consideration'), 'tofu');
    assert.equal(stageBucket('consideration to decision'), 'bofu');
    assert.equal(stageBucket('consideration'), 'mofu');
  });
});

describe('Phase 3: generateFaqArtifact — resolution modes', () => {
  it('full-extraction entry → answer built from evidence, resolution "extracted"', () => {
    const art = generateFaqArtifact(EV, EV.url, SCAN, null, lib([E_EXTRACTED, filler(1), filler(2)]));
    const e = art.faqs.find(f => /teams do you serve/i.test(f.question));
    assert.ok(e);
    assert.equal(e.resolution, 'extracted');
    assert.equal(e.answer, 'We serve fintech teams.'); // real extracted value
  });

  it('fallback entry (placeholder unresolved) → answer_fallback, resolution "fallback"', () => {
    const art = generateFaqArtifact(EV, EV.url, SCAN, null, lib([E_FALLBACK, filler(1), filler(2)]));
    const e = art.faqs.find(f => /how fast/i.test(f.question));
    assert.equal(e.resolution, 'fallback');
    assert.equal(e.answer, 'It runs reliably with low latency.');
  });

  it('skip-no-fallback entry is omitted (never leaks a placeholder)', () => {
    const art = generateFaqArtifact(EV, EV.url, SCAN, null, lib([E_SKIP_NO_FALLBACK, filler(1), filler(2), filler(3)]));
    assert.ok(!art.faqs.some(f => /uptime/i.test(f.question)), 'no-fallback entry dropped');
    assert.ok(art.faqs.every(f => !/\{\{/.test(f.answer)), 'no placeholder leak in any answer');
  });
});

describe('Phase 3: generateFaqArtifact — block rules', () => {
  it('delivers up to 5', () => {
    const art = generateFaqArtifact(EV, EV.url, SCAN, null, lib([filler(1), filler(2), filler(3), filler(4), filler(5), filler(6)]));
    assert.equal(art.faqs.length, 5);
  });

  it('thin block: exactly 3 safe → delivers 3 (min honored)', () => {
    const art = generateFaqArtifact(EV, EV.url, SCAN, null, lib([filler(1), filler(2), filler(3)]));
    assert.equal(art.faqs.length, 3);
  });

  it('sub-3 safe → throws (→ rollback / not charged)', () => {
    assert.throws(
      () => generateFaqArtifact(EV, EV.url, SCAN, null, lib([filler(1), filler(2)])),
      /insufficient safe FAQ coverage/
    );
  });

  it('within-block dedupe on the question', () => {
    const dup = filler(1); // same question as another filler(1)
    const art = generateFaqArtifact(EV, EV.url, SCAN, null, lib([filler(1), dup, filler(2), filler(3)]));
    const keys = art.faqs.map(f => f.question.toLowerCase());
    assert.equal(new Set(keys).size, keys.length, 'no duplicate questions in the block');
  });

  it('stage filter selects only that bucket', () => {
    const entries = [filler(1, 'awareness'), filler(2, 'awareness'), filler(3, 'awareness'), filler(4, 'consideration')];
    const art = generateFaqArtifact(EV, EV.url, SCAN, 'tofu', lib(entries));
    assert.ok(art.faqs.every(f => f.stage === 'tofu'));
    assert.equal(art.stage, 'tofu');
  });
});

describe('Phase 3: generateFaqArtifact — safety + output shape', () => {
  it('perspective: entries with Xeo/Visible2AI content are dropped', () => {
    const xeo = { question: 'Why choose us?', answer_fallback: 'Xeo Marketing optimizes your visibility.', implementation_notes: { buyer_stage: 'decision' } };
    const art = generateFaqArtifact(EV, EV.url, SCAN, null, lib([xeo, filler(1), filler(2), filler(3)]));
    assert.ok(!/xeo|visible2ai/i.test(JSON.stringify(art.faqs)), 'no Xeo copy published');
    assert.ok(!art.faqs.some(f => /why choose us/i.test(f.question)));
  });

  it('isSafeText rejects branding and leaks', () => {
    assert.equal(isSafeText('clean answer'), true);
    assert.equal(isSafeText('Xeo Marketing helps'), false);
    assert.equal(isSafeText('Uptime is {{uptime}}%'), false);
  });

  it('artifact shape: FAQPage JSON-LD valid, mainEntity matches faqs, stage-tagged', () => {
    const art = generateFaqArtifact(EV, EV.url, SCAN, null, lib([E_EXTRACTED, filler(1), filler(2), filler(3)]));
    assert.equal(art.source_scan_id, 4242);
    assert.ok(art.instructions.includes('FAQPage'));
    const parsed = innerJson(art.jsonld);
    assert.equal(parsed['@type'], 'FAQPage');
    assert.equal(parsed.mainEntity.length, art.faqs.length);
    assert.ok(art.faqs.every(f => typeof f.buyer_stage === 'string' && ['tofu', 'mofu', 'bofu'].includes(f.stage)));
  });

  it('throws when no library available', () => {
    assert.throws(() => generateFaqArtifact(EV, EV.url, SCAN, null, { faq_library: { faqs: [] } }), /no FAQ library/);
  });
});
