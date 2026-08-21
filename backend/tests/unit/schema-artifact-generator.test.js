'use strict';

/**
 * Phase 1: schema artifact generator + pricing config.
 * Exercises evidence detection (subtype/@graph aware), anti-hallucination
 * (no invented sameAs/logo), missing-only generation, enhancement, JSON
 * validity, and the throw paths that roll back a token spend.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { generateSchemaArtifact } = require('../../services/schemaArtifactGenerator');
const { getPricing, categoryForSubfactorKey } = require('../../config/recommendationPricing');

// Parse the inner JSON of a block's <script> tag.
function innerJson(block) {
  const inner = block.jsonld.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  return JSON.parse(inner);
}
function blockOfType(artifact, t) {
  return artifact.blocks.find(b => b.schema_type === t);
}

// Minimal evidence: enough to build a valid Organization, no existing schema.
function baseEvidence(overrides = {}) {
  return {
    url: 'https://acme.example.com',
    metadata: { ogTitle: 'Acme Inc', ogDescription: 'We do things', ogImage: 'https://acme.example.com/og.png' },
    content: { headings: { h1: ['Acme Inc'] }, paragraphs: ['Welcome to Acme.'], faqs: [] },
    technical: { structuredData: [] },
    html: '',
    ...overrides,
  };
}

describe('Phase 1: recommendationPricing config', () => {
  it('schema price is 10 tokens, per_scan_all_applicable', () => {
    const p = getPricing('schema');
    assert.equal(p.tokens, 10);
    assert.equal(p.unit, 'per_scan_all_applicable');
  });
  it('unknown type → null', () => {
    assert.equal(getPricing('nope'), null);
  });
  it('categoryForSubfactorKey maps schema-family keys → "schema"', () => {
    assert.equal(categoryForSubfactorKey('technical_setup.organization_schema'), 'schema');
    assert.equal(categoryForSubfactorKey('organization_schema_missing'), 'schema');
    assert.equal(categoryForSubfactorKey('technical_setup.structured_data_coverage'), 'schema');
    assert.equal(categoryForSubfactorKey('faq_schema_missing'), 'schema');
    assert.equal(categoryForSubfactorKey('trust_authority.author_bios'), null);
    assert.equal(categoryForSubfactorKey(null), null);
  });
});

describe('Phase 1: generateSchemaArtifact — missing schema', () => {
  it('produces Organization + WebSite + WebPage when none exist, valid JSON', () => {
    const art = generateSchemaArtifact(baseEvidence(), 'https://acme.example.com', 932);
    assert.equal(art.source_scan_id, 932);
    assert.ok(art.generated_at);
    const org = blockOfType(art, 'Organization');
    assert.ok(org, 'Organization block present');
    assert.equal(org.status, 'missing');
    const parsed = innerJson(org);
    assert.equal(parsed['@type'], 'Organization');
    assert.equal(parsed.name, 'Acme Inc');
    assert.equal(parsed.url, 'https://acme.example.com');
    // every block validates as JSON and is wrapped in a script tag
    for (const b of art.blocks) {
      assert.match(b.jsonld, /^<script type="application\/ld\+json">/);
      assert.doesNotThrow(() => innerJson(b));
      assert.ok(b.instructions.includes('<head>'));
    }
  });

  it('ANTI-HALLUCINATION: no invented sameAs / logo when evidence lacks them', () => {
    // ogImage present → logo allowed; but no social links in html → no sameAs.
    const art = generateSchemaArtifact(baseEvidence(), 'https://acme.example.com');
    const org = innerJson(blockOfType(art, 'Organization'));
    assert.equal(org.sameAs, undefined, 'must not invent social profiles');
    // logo only from real ogImage, never a guessed /logo.png
    if (org.logo) assert.match(org.logo.url, /og\.png$/);
  });

  it('uses real social links from evidence html (no fabrication)', () => {
    const ev = baseEvidence({ html: '<a href="https://linkedin.com/company/acme">li</a>' });
    const art = generateSchemaArtifact(ev, 'https://acme.example.com');
    const org = innerJson(blockOfType(art, 'Organization'));
    assert.ok(Array.isArray(org.sameAs) && org.sameAs.some(s => /linkedin\.com\/company\/acme/.test(s)));
  });
});

describe('Phase 1: generateSchemaArtifact — @graph / subtype detection (regression guard)', () => {
  it('Organization present via @graph (no top-level type) → not regenerated', () => {
    const ev = baseEvidence({
      technical: { structuredData: [
        { type: null, raw: { '@context': 'https://schema.org', '@graph': [
          { '@type': 'WebSite' }, { '@type': 'Organization', name: 'Acme' },
        ] } },
      ] },
    });
    const art = generateSchemaArtifact(ev, 'https://acme.example.com');
    assert.equal(blockOfType(art, 'Organization'), undefined, 'existing @graph Organization not regenerated');
  });

  it('subtype-only (RealEstateAgent) counts as Organization present → not regenerated', () => {
    const ev = baseEvidence({
      technical: { structuredData: [
        { type: 'RealEstateAgent', raw: { '@type': ['RealEstateAgent', 'Place'], name: 'Goldwynn' } },
      ] },
    });
    const art = generateSchemaArtifact(ev, 'https://goldwynn.example.com');
    assert.equal(blockOfType(art, 'Organization'), undefined, 'subtype org not flagged missing');
  });
});

describe('Phase 1: generateSchemaArtifact — FAQ + Breadcrumb applicability', () => {
  it('adds FAQPage when the page has FAQ content and no FAQ schema', () => {
    const ev = baseEvidence({
      content: { headings: { h1: ['Acme'] }, faqs: [
        { question: 'Is it free?', answer: 'Yes, forever.' },
        { question: 'How fast?', answer: 'Instant.' },
      ] },
    });
    const art = generateSchemaArtifact(ev, 'https://acme.example.com');
    const faq = blockOfType(art, 'FAQPage');
    assert.ok(faq, 'FAQPage generated');
    const parsed = innerJson(faq);
    assert.equal(parsed.mainEntity.length, 2);
    assert.equal(parsed.mainEntity[0].name, 'Is it free?');
  });

  it('no FAQ content → no FAQPage block (never fabricated)', () => {
    const art = generateSchemaArtifact(baseEvidence(), 'https://acme.example.com');
    assert.equal(blockOfType(art, 'FAQPage'), undefined);
  });

  it('BreadcrumbList only when the URL has a real path', () => {
    const deep = generateSchemaArtifact(baseEvidence(), 'https://acme.example.com/services/seo');
    const bc = blockOfType(deep, 'BreadcrumbList');
    assert.ok(bc, 'breadcrumb from path');
    const parsed = innerJson(bc);
    assert.equal(parsed.itemListElement.length, 3); // Home > Services > Seo
    assert.equal(parsed.itemListElement[2].name, 'Seo');
    // homepage → no breadcrumb
    const root = generateSchemaArtifact(baseEvidence(), 'https://acme.example.com/');
    assert.equal(blockOfType(root, 'BreadcrumbList'), undefined);
  });
});

describe('Phase 1: generateSchemaArtifact — enhancement', () => {
  it('Organization present but no sameAs + evidence has socials → enhancement block', () => {
    const ev = baseEvidence({
      html: '<a href="https://twitter.com/acme">tw</a>',
      technical: { structuredData: [
        { type: 'Organization', raw: { '@type': 'Organization', name: 'Acme', url: 'https://acme.example.com' } },
      ] },
    });
    const art = generateSchemaArtifact(ev, 'https://acme.example.com');
    const enh = art.blocks.find(b => b.status === 'enhancement');
    assert.ok(enh, 'enhancement emitted');
    assert.match(enh.instructions, /REPLACES/i);
    const parsed = innerJson(enh);
    assert.ok(parsed.sameAs.some(s => /twitter\.com\/acme/.test(s)));
  });
});

describe('Phase 1: generateSchemaArtifact — throw paths (roll back the spend)', () => {
  it('throws when there is no business name / evidence too thin', () => {
    const ev = { url: '', metadata: {}, content: {}, technical: { structuredData: [] }, html: '' };
    assert.throws(() => generateSchemaArtifact(ev, ''), /no scan URL|insufficient evidence/i);
  });

  it('throws when nothing applicable is missing (all core + no FAQ/breadcrumb)', () => {
    const ev = baseEvidence({
      technical: { structuredData: [
        { type: 'Organization', raw: { '@type': 'Organization', name: 'Acme', url: 'https://acme.example.com', sameAs: ['https://x.com/acme'] } },
        { type: 'WebSite', raw: { '@type': 'WebSite' } },
        { type: 'WebPage', raw: { '@type': 'WebPage' } },
      ] },
    });
    assert.throws(() => generateSchemaArtifact(ev, 'https://acme.example.com'), /nothing to generate/i);
  });
});

// ===========================================================================
// Phase 1.2: output polish — the four scan-789 defects
// ===========================================================================
const {
  cleanBrandName, normalizeUrl, sanitizeUrlsDeep, isCtaQuestion, isJunkAnswer,
} = require('../../services/schemaArtifactGenerator');

// Reproduces scan 789: title with SEO separators + trailing pipe, a trailing-
// slash URL, and numbered / duplicate / CTA-badge-junk FAQs.
function scan789Evidence(overrides = {}) {
  return {
    url: 'https://idrilservices.io/',
    metadata: {
      title: 'Idril Services | Your Technology Partner |',
      description: 'We deliver technology services.',
    },
    content: {
      headings: { h1: ['Idril Services'] },
      paragraphs: ['We deliver technology services to government and enterprise.'],
      faqs: [
        // numbered + short answer (duplicate #1)
        { question: '1. What counts as a valid assessment?', answer: 'It is a review of your systems.' },
        // quoted duplicate with the LONGER answer (dedupe should keep this one)
        { question: '"What counts as a valid assessment?"', answer: 'It is a thorough review of your systems and controls, delivered with a written report.' },
        // CTA question + trust-badge / nav junk answer → dropped
        { question: 'Want a fast assessment instead of guessing?', answer: 'Request an Assessment 8(a) Certified\n GSA Schedule\n WOSB\n CMMI Level 3\n SOC 2 · ISO 27001 · NIST 800-171' },
        // clean second question → keeps us at 2 valid FAQs
        { question: '2. How long does onboarding take?', answer: 'Typically two to three weeks depending on scope.' },
      ],
    },
    technical: { structuredData: [] },
    html: '',
    ...overrides,
  };
}

describe('Phase 1.2: cleanup helpers (unit)', () => {
  it('Defect 1 — cleanBrandName strips separators/tagline/trailing pipe', () => {
    assert.equal(cleanBrandName('Idril Services | Your Technology Partner |'), 'Idril Services');
    assert.equal(cleanBrandName('Acme — The Best Widgets'), 'Acme');
    assert.equal(cleanBrandName('Acme :: Home'), 'Acme');
    assert.equal(cleanBrandName('"Acme Inc"'), 'Acme Inc');
    // real names preserved: hyphen split needs surrounding spaces
    assert.equal(cleanBrandName('Mercedes-Benz'), 'Mercedes-Benz');
    assert.equal(cleanBrandName('Ben & Jerry\'s'), 'Ben & Jerry\'s');
    assert.equal(cleanBrandName('|||'), '');
  });
  it('Defect 2 — normalizeUrl strips trailing slash; sanitizeUrlsDeep collapses //#', () => {
    assert.equal(normalizeUrl('https://idrilservices.io/'), 'https://idrilservices.io');
    assert.equal(normalizeUrl('https://x.io/services/'), 'https://x.io/services');
    assert.equal(normalizeUrl('https://x.io'), 'https://x.io');
    const fixed = sanitizeUrlsDeep({ '@id': 'https://idrilservices.io//#webpage', url: 'https://x.io/ok' });
    assert.equal(fixed['@id'], 'https://idrilservices.io/#webpage');
    assert.equal(fixed.url, 'https://x.io/ok'); // https:// untouched
  });
  it('Defects 3/4 — CTA question + junk answer detectors', () => {
    assert.equal(isCtaQuestion('Want a fast assessment instead of guessing?'), true);
    assert.equal(isCtaQuestion('Ready to get started?'), true);
    assert.equal(isCtaQuestion('What counts as a valid assessment?'), false);
    assert.equal(isJunkAnswer('Request an Assessment 8(a) Certified\n GSA Schedule\n WOSB\n CMMI Level 3\n SOC 2 · ISO 27001'), true);
    assert.equal(isJunkAnswer('It is a thorough review of your systems and controls.'), false);
  });
});

describe('Phase 1.2: generateSchemaArtifact — clean output on the 789 fixture', () => {
  const art = generateSchemaArtifact(scan789Evidence(), 'https://idrilservices.io/', 789);

  it('Defect 1 — Organization name is the clean brand, not the raw title', () => {
    const org = innerJson(blockOfType(art, 'Organization'));
    assert.equal(org.name, 'Idril Services');
    assert.ok(!/\|/.test(org.name), 'no pipe in name');
  });

  it('Defect 2 — no `//#` in any @id/url across the whole artifact', () => {
    const whole = JSON.stringify(art);
    assert.ok(!/\/\/#/.test(whole), 'no double-slash-before-fragment anywhere');
    // sanity: the webpage @id is well formed
    const page = innerJson(blockOfType(art, 'WebPage'));
    assert.equal(page['@id'], 'https://idrilservices.io/#webpage');
  });

  it('Defects 3/4 — FAQPage is clean: no numbering, no dupes, no CTA/badge junk', () => {
    const faq = innerJson(blockOfType(art, 'FAQPage'));
    const names = faq.mainEntity.map(m => m.name);
    // exactly the 2 valid questions survive
    assert.equal(names.length, 2);
    // no leading enumeration
    assert.ok(names.every(n => !/^\s*\d+[.)]/.test(n)), 'no numbered questions');
    // deduped case-insensitively
    const keys = names.map(n => n.toLowerCase());
    assert.equal(new Set(keys).size, keys.length, 'no duplicate questions');
    // the kept duplicate carries the LONGER answer
    const counts = faq.mainEntity.find(m => /valid assessment/i.test(m.name));
    assert.match(counts.acceptedAnswer.text, /written report/);
    // no CTA question, no badge text anywhere
    const blob = JSON.stringify(faq);
    assert.ok(!/Want a fast assessment/.test(blob), 'CTA question dropped');
    assert.ok(!/8\(a\)|GSA Schedule|WOSB/.test(blob), 'badge/nav junk dropped');
  });
});

describe('Phase 1.2: FAQPage omitted when < 2 clean FAQs survive', () => {
  it('one clean + one CTA-junk → no FAQPage block', () => {
    const ev = scan789Evidence({
      content: {
        headings: { h1: ['Idril Services'] },
        paragraphs: ['We deliver technology services.'],
        faqs: [
          { question: 'What counts as a valid assessment?', answer: 'It is a thorough review of your systems.' },
          { question: 'Want a fast assessment instead of guessing?', answer: 'Request an Assessment 8(a) Certified\n GSA Schedule\n WOSB\n CMMI Level 3' },
        ],
      },
    });
    const art = generateSchemaArtifact(ev, 'https://idrilservices.io/');
    assert.equal(blockOfType(art, 'FAQPage'), undefined, 'FAQPage omitted (only 1 valid FAQ)');
    // core blocks still generated → artifact is non-empty
    assert.ok(blockOfType(art, 'Organization'));
  });
});
