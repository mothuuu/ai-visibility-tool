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
