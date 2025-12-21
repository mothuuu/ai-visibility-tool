/**
 * Unit tests for evidence contract validation
 * RULEBOOK v1.2 Step G5: Tests for evidence contract enforcement
 *
 * Run with: node --test backend/tests/unit/evidence-contract.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  RULEBOOK_VERSION,
  CONTRACT_VERSION,
  REQUIRED_NAMESPACES,
  EXPECTED_NAMESPACES,
  FUTURE_NAMESPACES,
  FUTURE_NAMESPACE_SHAPES,
  REQUIRED_FIELDS,
  validateEvidence,
  createMockEvidence,
  getEvidenceField
} = require('../../analyzers/evidence-contract');

describe('evidence-contract', () => {

  describe('version constants', () => {

    it('has RULEBOOK_VERSION defined', () => {
      assert.ok(typeof RULEBOOK_VERSION === 'string');
      assert.ok(RULEBOOK_VERSION.length > 0);
    });

    it('has CONTRACT_VERSION defined', () => {
      assert.ok(typeof CONTRACT_VERSION === 'string');
      assert.match(CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
    });

  });

  describe('namespace definitions', () => {

    it('defines required namespaces', () => {
      assert.ok(Array.isArray(REQUIRED_NAMESPACES));
      assert.ok(REQUIRED_NAMESPACES.includes('url'));
      assert.ok(REQUIRED_NAMESPACES.includes('navigation'));
      assert.ok(REQUIRED_NAMESPACES.includes('structure'));
      assert.ok(REQUIRED_NAMESPACES.includes('content'));
      assert.ok(REQUIRED_NAMESPACES.includes('technical'));
    });

    it('defines expected namespaces', () => {
      assert.ok(Array.isArray(EXPECTED_NAMESPACES));
      assert.ok(EXPECTED_NAMESPACES.includes('crawler'));
      assert.ok(EXPECTED_NAMESPACES.includes('siteMetrics'));
    });

    it('defines future namespaces', () => {
      assert.ok(Array.isArray(FUTURE_NAMESPACES));
      assert.ok(FUTURE_NAMESPACES.includes('aiReadiness'));
      assert.ok(FUTURE_NAMESPACES.includes('trust'));
      assert.ok(FUTURE_NAMESPACES.includes('voice'));
      assert.ok(FUTURE_NAMESPACES.includes('freshness'));
    });

    it('has shapes for future namespaces', () => {
      assert.ok(typeof FUTURE_NAMESPACE_SHAPES === 'object');
      assert.ok(FUTURE_NAMESPACE_SHAPES.aiReadiness !== undefined);
      assert.ok(FUTURE_NAMESPACE_SHAPES.trust !== undefined);
      assert.ok(FUTURE_NAMESPACE_SHAPES.voice !== undefined);
      assert.ok(FUTURE_NAMESPACE_SHAPES.freshness !== undefined);
    });

  });

  describe('REQUIRED_FIELDS', () => {

    it('defines navigation required fields', () => {
      assert.ok(REQUIRED_FIELDS.navigation.includes('keyPages'));
      assert.ok(REQUIRED_FIELDS.navigation.includes('allNavLinks'));
      assert.ok(REQUIRED_FIELDS.navigation.includes('headerLinks'));
      assert.ok(REQUIRED_FIELDS.navigation.includes('navLinks'));
      assert.ok(REQUIRED_FIELDS.navigation.includes('footerLinks'));
    });

    it('defines structure required fields', () => {
      assert.ok(REQUIRED_FIELDS.structure.includes('hasNav'));
      assert.ok(REQUIRED_FIELDS.structure.includes('headingHierarchy'));
    });

    it('defines content required fields', () => {
      assert.ok(REQUIRED_FIELDS.content.includes('paragraphs'));
      assert.ok(REQUIRED_FIELDS.content.includes('headings'));
      assert.ok(REQUIRED_FIELDS.content.includes('wordCount'));
    });

    it('defines technical required fields', () => {
      assert.ok(REQUIRED_FIELDS.technical.includes('structuredData'));
      assert.ok(REQUIRED_FIELDS.technical.includes('hasFAQSchema'));
    });

  });

  describe('validateEvidence()', () => {

    it('validates complete evidence as valid', () => {
      const evidence = createMockEvidence();
      const result = validateEvidence(evidence);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('reports error for missing required namespace', () => {
      const evidence = createMockEvidence();
      delete evidence.navigation;

      const result = validateEvidence(evidence);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('navigation')));
    });

    it('reports error for missing url', () => {
      const evidence = createMockEvidence();
      delete evidence.url;

      const result = validateEvidence(evidence);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('url')));
    });

    it('reports warning for missing expected namespace', () => {
      const evidence = createMockEvidence();
      delete evidence.crawler;

      const result = validateEvidence(evidence);
      // May or may not be valid depending on validation strictness
      assert.ok(result.warnings.some(w => w.includes('crawler')));
    });

    it('reports error for missing navigation.footerLinks', () => {
      const evidence = createMockEvidence();
      delete evidence.navigation.footerLinks;

      const result = validateEvidence(evidence);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('footerLinks')));
    });

    it('reports error for missing navigation.headerLinks', () => {
      const evidence = createMockEvidence();
      delete evidence.navigation.headerLinks;

      const result = validateEvidence(evidence);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('headerLinks')));
    });

    it('reports error for missing structure.headingHierarchy', () => {
      const evidence = createMockEvidence();
      delete evidence.structure.headingHierarchy;

      const result = validateEvidence(evidence);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('headingHierarchy')));
    });

    it('reports error for non-array headingHierarchy', () => {
      const evidence = createMockEvidence();
      evidence.structure.headingHierarchy = 'not an array';

      const result = validateEvidence(evidence);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('headingHierarchy')));
    });

    it('includes contractVersion in result', () => {
      const evidence = createMockEvidence();
      const result = validateEvidence(evidence);
      assert.ok(result.contractVersion);
    });

    it('includes rulebookVersion in result', () => {
      const evidence = createMockEvidence();
      const result = validateEvidence(evidence);
      assert.ok(result.rulebookVersion);
    });

    it('warns when contractVersion missing from evidence', () => {
      const evidence = createMockEvidence();
      delete evidence.contractVersion;

      const result = validateEvidence(evidence);
      assert.ok(result.warnings.some(w => w.includes('contractVersion')));
    });

  });

  describe('createMockEvidence()', () => {

    it('creates valid mock evidence', () => {
      const mock = createMockEvidence();
      const result = validateEvidence(mock);
      assert.strictEqual(result.valid, true);
    });

    it('includes all required namespaces', () => {
      const mock = createMockEvidence();
      for (const ns of REQUIRED_NAMESPACES) {
        assert.ok(mock[ns] !== undefined, `Missing required namespace: ${ns}`);
      }
    });

    it('accepts overrides', () => {
      const mock = createMockEvidence({
        url: 'https://custom.example.com',
        content: {
          wordCount: 999
        }
      });

      assert.strictEqual(mock.url, 'https://custom.example.com');
      assert.strictEqual(mock.content.wordCount, 999);
    });

    it('deep merges nested overrides', () => {
      const mock = createMockEvidence({
        navigation: {
          keyPages: { custom: '/custom' }
        }
      });

      // Original keyPages should still exist
      assert.ok(mock.navigation.keyPages.about);
      // New keyPages should be added
      assert.strictEqual(mock.navigation.keyPages.custom, '/custom');
    });

    it('includes FAQ content by default', () => {
      const mock = createMockEvidence();
      assert.ok(mock.content.faqs.length > 0);
    });

    it('includes structured data by default', () => {
      const mock = createMockEvidence();
      assert.ok(mock.technical.structuredData.length > 0);
    });

  });

  describe('getEvidenceField()', () => {

    it('retrieves top-level fields', () => {
      const evidence = createMockEvidence();
      const url = getEvidenceField(evidence, 'url');
      assert.strictEqual(url, evidence.url);
    });

    it('retrieves nested fields', () => {
      const evidence = createMockEvidence();
      const wordCount = getEvidenceField(evidence, 'content.wordCount');
      assert.strictEqual(wordCount, evidence.content.wordCount);
    });

    it('retrieves deeply nested fields', () => {
      const evidence = createMockEvidence();
      const h1 = getEvidenceField(evidence, 'content.headings.h1');
      assert.deepStrictEqual(h1, evidence.content.headings.h1);
    });

    it('returns undefined for non-existent path', () => {
      const evidence = createMockEvidence();
      const result = getEvidenceField(evidence, 'does.not.exist');
      assert.strictEqual(result, undefined);
    });

    it('handles null/undefined evidence', () => {
      assert.strictEqual(getEvidenceField(null, 'url'), undefined);
      assert.strictEqual(getEvidenceField(undefined, 'url'), undefined);
    });

  });

  describe('FUTURE_NAMESPACE_SHAPES', () => {

    it('aiReadiness has expected null fields', () => {
      const shape = FUTURE_NAMESPACE_SHAPES.aiReadiness;
      assert.strictEqual(shape.questionHeadings, null);
      assert.strictEqual(shape.snippetEligibility, null);
      assert.strictEqual(shape.answerability, null);
    });

    it('trust has expected null fields', () => {
      const shape = FUTURE_NAMESPACE_SHAPES.trust;
      assert.strictEqual(shape.authorBios, null);
      assert.strictEqual(shape.testimonials, null);
      assert.strictEqual(shape.thirdPartyProfiles, null);
      assert.strictEqual(shape.teamPage, null);
      assert.strictEqual(shape.caseStudies, null);
    });

    it('voice has expected null fields', () => {
      const shape = FUTURE_NAMESPACE_SHAPES.voice;
      assert.strictEqual(shape.speakableContent, null);
      assert.strictEqual(shape.conversationalQueries, null);
    });

    it('freshness has expected null fields', () => {
      const shape = FUTURE_NAMESPACE_SHAPES.freshness;
      assert.strictEqual(shape.lastModified, null);
      assert.strictEqual(shape.publishDate, null);
      assert.strictEqual(shape.updateFrequency, null);
    });

  });

});
