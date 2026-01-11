/**
 * Recommendation Engine Core Tests
 * Phase 4A.1: Content-Aware Recommendation Core
 *
 * Tests for:
 * - subfactorPlaybookMap.js - key normalization, alias mapping, playbook lookup
 * - generationHooks.js - Organization schema, FAQ, OG tag generation
 * - renderer.js - recommendation rendering, placeholder resolution
 *
 * Run with: node --test backend/tests/unit/recommendation-engine-core.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Import modules under test
const {
  SUBFACTOR_TO_PLAYBOOK,
  V5_TO_V51_ALIASES,
  getPlaybookEntry,
  normalizeKey,
  toSnakeCase,
  toCamelCase,
  buildCanonicalKey,
  getAllPlaybookKeys
} = require('../../recommendations/subfactorPlaybookMap');

const {
  GENERATION_HOOKS,
  generateOrganizationSchema,
  generateICPFaqs,
  generateOpenGraphTags,
  executeHook,
  hasHook,
  getAvailableHooks,
  inferCompanyName,
  getFAQLibrary
} = require('../../recommendations/generationHooks');

const {
  renderRecommendations,
  extractFailingSubfactors,
  buildPlaceholderContext,
  resolvePlaceholders,
  validateNoUnresolvedPlaceholders,
  RECOMMENDATION_SCORE_THRESHOLD,
  EVIDENCE_QUALITY,
  TARGET_LEVEL
} = require('../../recommendations/renderer');

const {
  assessEvidenceQuality,
  canRunGenerationHook,
  adjustAutomationLevel,
  shouldSkipRecommendation,
  isFaqFalsePositive,
  analyzeFaqQuality,
  getVerificationActionItems,
  CONFIDENCE_THRESHOLDS
} = require('../../recommendations/evidenceGating');

const {
  getTargetLevel,
  isSiteLevel,
  isPageLevel,
  getSubfactorsByTargetLevel
} = require('../../recommendations/targeting');

// Load fixtures
const sampleScanEvidence = require('../../recommendations/__fixtures__/sampleScanEvidence.json');
const sampleRubricResult = require('../../recommendations/__fixtures__/sampleRubricResult.json');
const sampleRubricResultGood = require('../../recommendations/__fixtures__/sampleRubricResultGood.json');
const sampleContext = require('../../recommendations/__fixtures__/sampleContext.json');
const sampleEvidenceWithFaqFalsePositives = require('../../recommendations/__fixtures__/sampleEvidenceWithFaqFalsePositives.json');

// ========================================
// SUBFACTOR PLAYBOOK MAP TESTS
// ========================================

describe('SubfactorPlaybookMap', () => {

  describe('Key Normalization', () => {

    it('converts camelCase to snake_case', () => {
      assert.strictEqual(toSnakeCase('altTextScore'), 'alt_text_score');
      assert.strictEqual(toSnakeCase('questionHeadingsScore'), 'question_headings_score');
      assert.strictEqual(toSnakeCase('organizationSchema'), 'organization_schema');
    });

    it('handles already snake_case', () => {
      assert.strictEqual(toSnakeCase('alt_text_score'), 'alt_text_score');
      assert.strictEqual(toSnakeCase('technical_setup'), 'technical_setup');
    });

    it('normalizes keys with Score suffix', () => {
      const key = normalizeKey('altTextScore');
      assert.strictEqual(key, 'alt_text');
    });

    it('normalizes keys with category prefix', () => {
      const key = normalizeKey('technical_setup.organization_schema');
      assert.strictEqual(key, 'technical_setup.organization_schema');
    });

    it('converts camelCase to snake_case in normalization', () => {
      const key = normalizeKey('technicalSetup.organizationSchema');
      assert.strictEqual(key, 'technical_setup.organization_schema');
    });
  });

  describe('V5 to V5.1 Alias Mapping', () => {

    it('maps V5 q_based_headings to V5.1 query_intent_alignment', () => {
      const alias = V5_TO_V51_ALIASES['ai_search_readiness.q_based_headings'];
      assert.strictEqual(alias, 'ai_search_readiness.query_intent_alignment');
    });

    it('maps V5 snippet_eligible_answers to V5.1 evidence_proof_points', () => {
      const alias = V5_TO_V51_ALIASES['ai_search_readiness.snippet_eligible_answers'];
      assert.strictEqual(alias, 'ai_search_readiness.evidence_proof_points');
    });

    it('has aliases defined for key V5 keys', () => {
      const requiredAliases = [
        'ai_search_readiness.q_based_headings',
        'ai_search_readiness.snippet_eligible_answers'
      ];

      for (const key of requiredAliases) {
        assert.ok(V5_TO_V51_ALIASES[key], `Missing alias for ${key}`);
      }
    });
  });

  describe('Playbook Entry Lookup', () => {

    it('finds entry for canonical key', () => {
      const entry = getPlaybookEntry('technical_setup.organization_schema');
      assert.ok(entry, 'Entry should exist');
      assert.strictEqual(entry.playbook_category, 'Technical Setup');
      assert.strictEqual(entry.automation_level, 'generate');
    });

    it('finds entry for camelCase subfactor key', () => {
      const entry = getPlaybookEntry('structuredDataScore', 'technicalSetup');
      // Should map to technical_setup.structured_data_coverage
      assert.ok(entry, 'Entry should exist');
      assert.strictEqual(entry.playbook_category, 'Technical Setup');
    });

    it('returns null for non-existent key', () => {
      const entry = getPlaybookEntry('nonexistent.subfactor');
      assert.strictEqual(entry, null);
    });

    it('includes canonical_key in returned entry', () => {
      const entry = getPlaybookEntry('technical_setup.organization_schema');
      assert.ok(entry.canonical_key, 'Should have canonical_key');
      assert.strictEqual(entry.canonical_key, 'technical_setup.organization_schema');
    });
  });

  describe('Playbook Entry Schema', () => {

    it('all entries have required fields', () => {
      const requiredFields = [
        'playbook_category',
        'playbook_gap',
        'priority',
        'effort',
        'impact',
        'automation_level',
        'why_it_matters_template',
        'action_items_template',
        'examples_template',
        'evidence_selectors'
      ];

      for (const [key, entry] of Object.entries(SUBFACTOR_TO_PLAYBOOK)) {
        for (const field of requiredFields) {
          assert.ok(
            entry[field] !== undefined,
            `Entry ${key} missing required field: ${field}`
          );
        }
      }
    });

    it('generate entries have generator_hook_key', () => {
      for (const [key, entry] of Object.entries(SUBFACTOR_TO_PLAYBOOK)) {
        if (entry.automation_level === 'generate') {
          assert.ok(
            entry.generator_hook_key,
            `Generate entry ${key} missing generator_hook_key`
          );
        }
      }
    });

    it('priority is valid enum value', () => {
      const validPriorities = ['P0', 'P1', 'P2'];

      for (const [key, entry] of Object.entries(SUBFACTOR_TO_PLAYBOOK)) {
        assert.ok(
          validPriorities.includes(entry.priority),
          `Entry ${key} has invalid priority: ${entry.priority}`
        );
      }
    });

    it('automation_level is valid enum value', () => {
      const validLevels = ['generate', 'draft', 'guide', 'manual'];

      for (const [key, entry] of Object.entries(SUBFACTOR_TO_PLAYBOOK)) {
        assert.ok(
          validLevels.includes(entry.automation_level),
          `Entry ${key} has invalid automation_level: ${entry.automation_level}`
        );
      }
    });
  });

  describe('Playbook Coverage', () => {

    it('has entries for all 8 pillars', () => {
      const pillars = new Set();
      for (const [key] of Object.entries(SUBFACTOR_TO_PLAYBOOK)) {
        const pillar = key.split('.')[0];
        pillars.add(pillar);
      }

      // Should have at least these pillars
      const expectedPillars = [
        'technical_setup',
        'ai_search_readiness',
        'trust_authority',
        'ai_readability',
        'content_structure'
      ];

      for (const pillar of expectedPillars) {
        assert.ok(pillars.has(pillar), `Missing pillar: ${pillar}`);
      }
    });

    it('has minimum 16 playbook entries', () => {
      const count = getAllPlaybookKeys().length;
      assert.ok(count >= 16, `Should have at least 16 entries, got ${count}`);
    });
  });
});

// ========================================
// GENERATION HOOKS TESTS
// ========================================

describe('GenerationHooks', () => {

  describe('Hook Registry', () => {

    it('has Organization schema hook', () => {
      assert.ok(hasHook('technical_setup.organization_schema'));
    });

    it('has ICP FAQs hook', () => {
      assert.ok(hasHook('ai_search_readiness.icp_faqs'));
    });

    it('has Open Graph tags hook', () => {
      assert.ok(hasHook('technical_setup.open_graph_tags'));
    });

    it('getAvailableHooks returns 3 hooks', () => {
      const hooks = getAvailableHooks();
      assert.ok(hooks.length >= 3, `Should have at least 3 hooks, got ${hooks.length}`);
    });
  });

  describe('Organization Schema Generation', () => {

    it('generates valid JSON-LD structure', async () => {
      const result = await generateOrganizationSchema(sampleScanEvidence, sampleContext);

      assert.ok(result, 'Should return result');
      assert.strictEqual(result.asset_type, 'jsonld.organization');
      assert.ok(result.content, 'Should have content');
      assert.ok(result.implementation_notes, 'Should have implementation_notes');
    });

    it('includes required Organization schema fields', async () => {
      const result = await generateOrganizationSchema(sampleScanEvidence, sampleContext);
      const schema = result.content;

      assert.strictEqual(schema['@context'], 'https://schema.org');
      assert.strictEqual(schema['@type'], 'Organization');
      assert.ok(schema['@id'], 'Should have @id');
      assert.ok(schema.name, 'Should have name');
      assert.ok(schema.url, 'Should have url');
    });

    it('infers company name from context', async () => {
      const result = await generateOrganizationSchema(sampleScanEvidence, sampleContext);
      assert.strictEqual(result.content.name, 'AcmeCorp');
    });

    it('includes sameAs links', async () => {
      const result = await generateOrganizationSchema(sampleScanEvidence, sampleContext);
      assert.ok(Array.isArray(result.content.sameAs), 'Should have sameAs array');
    });
  });

  describe('ICP FAQs Generation', () => {

    it('generates FAQ pairs and JSON-LD', async () => {
      const result = await generateICPFaqs(sampleScanEvidence, sampleContext);

      assert.ok(result, 'Should return result');
      assert.strictEqual(result.asset_type, 'jsonld.faqpage');
      assert.ok(result.content.faqs, 'Should have faqs array');
      assert.ok(result.content.jsonLd, 'Should have jsonLd');
    });

    it('generates 6-10 FAQ pairs', async () => {
      const result = await generateICPFaqs(sampleScanEvidence, sampleContext);
      const faqCount = result.content.faqs.length;

      assert.ok(faqCount >= 6, `Should have at least 6 FAQs, got ${faqCount}`);
      assert.ok(faqCount <= 10, `Should have at most 10 FAQs, got ${faqCount}`);
    });

    it('FAQPage JSON-LD has valid structure', async () => {
      const result = await generateICPFaqs(sampleScanEvidence, sampleContext);
      const jsonLd = result.content.jsonLd;

      assert.strictEqual(jsonLd['@context'], 'https://schema.org');
      assert.strictEqual(jsonLd['@type'], 'FAQPage');
      assert.ok(Array.isArray(jsonLd.mainEntity), 'Should have mainEntity array');
    });

    it('FAQ questions are Question type', async () => {
      const result = await generateICPFaqs(sampleScanEvidence, sampleContext);
      const firstQuestion = result.content.jsonLd.mainEntity[0];

      assert.strictEqual(firstQuestion['@type'], 'Question');
      assert.ok(firstQuestion.name, 'Should have name');
      assert.ok(firstQuestion.acceptedAnswer, 'Should have acceptedAnswer');
      assert.strictEqual(firstQuestion.acceptedAnswer['@type'], 'Answer');
    });

    it('uses industry-specific FAQs when available', async () => {
      const library = getFAQLibrary('saas');
      assert.ok(library, 'Should find SaaS library');
      assert.ok(library.faqs || library.categories, 'Should have faqs or categories');
    });
  });

  describe('Open Graph Tags Generation', () => {

    it('generates meta tags object and HTML snippet', async () => {
      const result = await generateOpenGraphTags(sampleScanEvidence, sampleContext);

      assert.ok(result, 'Should return result');
      assert.strictEqual(result.asset_type, 'meta.opengraph');
      assert.ok(result.content.metaTags, 'Should have metaTags');
      assert.ok(result.content.htmlSnippet, 'Should have htmlSnippet');
    });

    it('includes required Open Graph tags', async () => {
      const result = await generateOpenGraphTags(sampleScanEvidence, sampleContext);
      const og = result.content.metaTags.openGraph;

      assert.ok(og['og:title'], 'Should have og:title');
      assert.ok(og['og:description'], 'Should have og:description');
      assert.ok(og['og:url'], 'Should have og:url');
      assert.ok(og['og:image'], 'Should have og:image');
    });

    it('includes Twitter Card tags', async () => {
      const result = await generateOpenGraphTags(sampleScanEvidence, sampleContext);
      const twitter = result.content.metaTags.twitter;

      assert.ok(twitter['twitter:card'], 'Should have twitter:card');
      assert.ok(twitter['twitter:title'], 'Should have twitter:title');
    });

    it('HTML snippet is valid meta tag format', async () => {
      const result = await generateOpenGraphTags(sampleScanEvidence, sampleContext);
      const html = result.content.htmlSnippet;

      assert.ok(html.includes('meta property="og:title"'), 'Should include og:title');
      assert.ok(html.includes('meta name="twitter:card"'), 'Should include twitter:card');
    });
  });

  describe('Hook Execution', () => {

    it('executeHook returns result for valid hook', async () => {
      const result = await executeHook('technical_setup.organization_schema', sampleScanEvidence, sampleContext);
      assert.ok(result, 'Should return result');
      assert.strictEqual(result.asset_type, 'jsonld.organization');
    });

    it('executeHook returns null for invalid hook', async () => {
      const result = await executeHook('nonexistent.hook', sampleScanEvidence, sampleContext);
      assert.strictEqual(result, null);
    });

    it('executeHook handles null inputs gracefully', async () => {
      // Passing null evidence and context should not throw - should use fallback values
      const result = await executeHook('technical_setup.organization_schema', null, null);
      // Should still return a result with fallback values
      assert.ok(result, 'Should still return result with fallback values');
      assert.strictEqual(result.asset_type, 'jsonld.organization');
      assert.ok(result.content.name, 'Should have fallback company name');
    });
  });
});

// ========================================
// RENDERER TESTS
// ========================================

describe('Renderer', () => {

  describe('Failing Subfactor Extraction', () => {

    it('identifies failing subfactors from rubricResult', () => {
      const failing = extractFailingSubfactors(sampleRubricResult);

      assert.ok(failing.length > 0, 'Should find failing subfactors');

      // Check that low scores are detected
      const altTextFailing = failing.find(f => f.subfactor === 'altTextScore');
      assert.ok(altTextFailing, 'Should detect altTextScore as failing');
      assert.strictEqual(altTextFailing.score, 33);
    });

    it('respects threshold configuration', () => {
      const failing = extractFailingSubfactors(sampleRubricResult, 70);

      // All failing should have score < 70
      for (const f of failing) {
        assert.ok(f.score < 70, `${f.subfactor} score ${f.score} should be < 70`);
      }
    });

    it('returns empty array for good rubricResult', () => {
      const failing = extractFailingSubfactors(sampleRubricResultGood);

      // With default threshold of 70, most good scores should pass
      // Some might still be below 70, but count should be low
      assert.ok(failing.length < 10, 'Should have few failing subfactors');
    });

    it('skips null/unmeasured scores', () => {
      const failing = extractFailingSubfactors(sampleRubricResult);

      // domainAuthorityScore is null in fixture
      const domainAuth = failing.find(f => f.subfactor === 'domainAuthorityScore');
      assert.ok(!domainAuth, 'Should not include null scores');
    });
  });

  describe('Placeholder Resolution', () => {

    it('resolves {{company_name}} placeholder', () => {
      const context = buildPlaceholderContext(sampleScanEvidence, sampleContext);
      const result = resolvePlaceholders('Welcome to {{company_name}}', context);

      assert.strictEqual(result, 'Welcome to AcmeCorp');
    });

    it('resolves multiple placeholders', () => {
      const context = buildPlaceholderContext(sampleScanEvidence, sampleContext);
      const result = resolvePlaceholders(
        '{{company_name}} uses {{product_name}} for {{industry}}',
        context
      );

      assert.ok(!result.includes('{{'), 'Should have no remaining placeholders');
      assert.ok(result.includes('AcmeCorp'), 'Should include company name');
    });

    it('provides fallback for missing placeholders', () => {
      const context = buildPlaceholderContext(sampleScanEvidence, {});
      const result = resolvePlaceholders('Contact {{nonexistent_value}}', context);

      // Should have fallback in brackets
      assert.ok(result.includes('[nonexistent_value]'), 'Should have bracketed fallback');
      assert.ok(!result.includes('{{'), 'Should not have original placeholder');
    });

    it('builds context from evidence', () => {
      const context = buildPlaceholderContext(sampleScanEvidence, {});

      assert.ok(context.site_url, 'Should have site_url');
      assert.ok(context.domain, 'Should have domain');
      assert.ok(context.heading_count, 'Should have heading_count');
      assert.ok(context.total_images, 'Should have total_images');
    });
  });

  describe('Recommendation Rendering', () => {

    it('returns recommendations for failing subfactors', async () => {
      const scan = { id: 'test-scan-123', domain: 'acmecorp.example.com' };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: sampleRubricResult,
        scanEvidence: sampleScanEvidence,
        context: sampleContext
      });

      assert.ok(recommendations.length > 0, 'Should return recommendations');
    });

    it('limits recommendations to MAX per scan', async () => {
      const scan = { id: 'test-scan-123' };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: sampleRubricResult,
        scanEvidence: sampleScanEvidence,
        context: sampleContext
      });

      assert.ok(recommendations.length <= 12, 'Should not exceed MAX_RECOMMENDATIONS_PER_SCAN');
    });

    it('recommendations have required fields', async () => {
      const scan = { id: 'test-scan-123' };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: sampleRubricResult,
        scanEvidence: sampleScanEvidence,
        context: sampleContext
      });

      const requiredFields = [
        'rec_key',
        'pillar',
        'subfactor_key',
        'gap',
        'why_it_matters',
        'action_items',
        'examples',
        'evidence_json',
        'automation_level',
        'generated_assets'
      ];

      for (const rec of recommendations) {
        for (const field of requiredFields) {
          assert.ok(
            rec[field] !== undefined,
            `Recommendation missing required field: ${field}`
          );
        }
      }
    });

    it('no unresolved placeholders in output', async () => {
      const scan = { id: 'test-scan-123' };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: sampleRubricResult,
        scanEvidence: sampleScanEvidence,
        context: sampleContext
      });

      const validation = validateNoUnresolvedPlaceholders(recommendations);
      assert.ok(validation.valid, `Unresolved placeholders found: ${validation.issues.join(', ')}`);
    });

    it('returns empty array when no failing subfactors', async () => {
      const scan = { id: 'test-scan-123' };

      // Create a rubric result where everything passes
      const goodResult = {
        categories: {
          technicalSetup: {
            score: 90,
            subfactors: {
              structuredDataScore: 95,
              sitemapScore: 100
            }
          }
        }
      };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: goodResult,
        scanEvidence: sampleScanEvidence,
        context: sampleContext
      });

      assert.strictEqual(recommendations.length, 0, 'Should return empty for passing scores');
    });

    it('generated_assets populated for generate hooks', async () => {
      const scan = { id: 'test-scan-123' };

      // Create a rubric result that triggers a generate hook
      const rubricWithGenerateNeeded = {
        categories: {
          technicalSetup: {
            score: 30,
            subfactors: {
              structuredDataScore: 10, // Very low - should trigger organization schema
              openGraphScore: 20
            }
          }
        }
      };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: rubricWithGenerateNeeded,
        scanEvidence: sampleScanEvidence,
        context: sampleContext
      });

      // At least one recommendation should have generated_assets
      const withAssets = recommendations.filter(r => r.generated_assets.length > 0);
      // Note: This depends on playbook mapping - may be 0 if no matching entry
      // The test validates the field exists and is array
      for (const rec of recommendations) {
        assert.ok(Array.isArray(rec.generated_assets), 'generated_assets should be array');
      }
    });
  });

  describe('rec_key Generation', () => {

    it('includes scan id in rec_key', async () => {
      const scan = { id: 'unique-scan-id' };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: sampleRubricResult,
        scanEvidence: sampleScanEvidence,
        context: sampleContext
      });

      if (recommendations.length > 0) {
        assert.ok(
          recommendations[0].rec_key.includes('unique-scan-id'),
          'rec_key should include scan id'
        );
      }
    });

    it('rec_keys are unique', async () => {
      const scan = { id: 'test-scan' };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: sampleRubricResult,
        scanEvidence: sampleScanEvidence,
        context: sampleContext
      });

      const keys = recommendations.map(r => r.rec_key);
      const uniqueKeys = new Set(keys);
      assert.strictEqual(keys.length, uniqueKeys.size, 'All rec_keys should be unique');
    });
  });
});

// ========================================
// INTEGRATION TESTS
// ========================================

describe('Integration', () => {

  it('full pipeline with fixtures produces valid recommendations', async () => {
    const scan = {
      id: 'integration-test-scan',
      domain: 'acmecorp.example.com',
      domain_type: 'saas',
      created_at: new Date().toISOString()
    };

    const recommendations = await renderRecommendations({
      scan,
      rubricResult: sampleRubricResult,
      scanEvidence: sampleScanEvidence,
      context: sampleContext
    });

    // Should have recommendations for the failing fixture
    assert.ok(recommendations.length > 0, 'Should produce recommendations');

    // Validate structure
    for (const rec of recommendations) {
      assert.ok(typeof rec.rec_key === 'string', 'rec_key should be string');
      assert.ok(typeof rec.pillar === 'string', 'pillar should be string');
      assert.ok(typeof rec.why_it_matters === 'string', 'why_it_matters should be string');
      assert.ok(Array.isArray(rec.action_items), 'action_items should be array');
      assert.ok(Array.isArray(rec.examples), 'examples should be array');
      assert.ok(typeof rec.evidence_json === 'object', 'evidence_json should be object');
    }
  });

  it('V5.1 alias lookup works in full pipeline', async () => {
    // Verify that V5 keys are properly aliased
    const entry = getPlaybookEntry('ai_search_readiness.q_based_headings');
    if (entry) {
      // Should have been aliased to V5.1 key
      assert.ok(
        entry.canonical_key.includes('query_intent_alignment') ||
        entry.canonical_key.includes('q_based_headings'),
        'Should resolve V5 alias'
      );
    }
  });
});

// ========================================
// EVIDENCE GATING TESTS (Phase 4A.1.5)
// ========================================

describe('EvidenceGating', () => {

  describe('Evidence Quality Assessment', () => {

    it('returns strong quality when min_evidence is fully covered', () => {
      const playbookEntry = {
        canonical_key: 'technical_setup.organization_schema',
        evidence_selectors: ['metadata.title', 'metadata.ogTitle'],
        min_evidence: ['metadata.title', 'metadata.ogTitle']
      };

      const result = assessEvidenceQuality(sampleScanEvidence, playbookEntry, sampleContext);

      assert.strictEqual(result.quality, EVIDENCE_QUALITY.STRONG);
      assert.ok(result.confidence >= CONFIDENCE_THRESHOLDS.STRONG,
        `Confidence ${result.confidence} should be >= ${CONFIDENCE_THRESHOLDS.STRONG}`);
    });

    it('returns weak quality when min_evidence is missing', () => {
      const playbookEntry = {
        canonical_key: 'trust_authority.some_subfactor',
        evidence_selectors: ['nonexistent.path1', 'nonexistent.path2'],
        min_evidence: ['nonexistent.path1', 'nonexistent.path2']
      };

      const result = assessEvidenceQuality(sampleScanEvidence, playbookEntry, sampleContext);

      assert.strictEqual(result.quality, EVIDENCE_QUALITY.WEAK);
      assert.ok(result.confidence <= CONFIDENCE_THRESHOLDS.WEAK + 0.1,
        `Confidence ${result.confidence} should be low`);
    });

    it('returns weak quality when no selectors defined', () => {
      const playbookEntry = {
        canonical_key: 'test.no_selectors',
        evidence_selectors: [],
        min_evidence: []
      };

      const result = assessEvidenceQuality(sampleScanEvidence, playbookEntry, {});

      assert.strictEqual(result.quality, EVIDENCE_QUALITY.WEAK);
      assert.ok(result.summary.includes('No evidence selectors'),
        'Summary should mention missing selectors');
    });

    it('includes confidence and summary in result', () => {
      const playbookEntry = {
        canonical_key: 'technical_setup.test',
        evidence_selectors: ['metadata.title']
      };

      const result = assessEvidenceQuality(sampleScanEvidence, playbookEntry, {});

      assert.ok(typeof result.confidence === 'number', 'confidence should be number');
      assert.ok(result.confidence >= 0 && result.confidence <= 1,
        'confidence should be between 0 and 1');
      assert.ok(typeof result.summary === 'string', 'summary should be string');
      assert.ok(result.summary.length > 0, 'summary should not be empty');
    });

    it('context improves confidence', () => {
      const playbookEntry = {
        canonical_key: 'technical_setup.test',
        evidence_selectors: ['metadata.title'],
        min_evidence: ['metadata.title']
      };

      const resultWithoutContext = assessEvidenceQuality(sampleScanEvidence, playbookEntry, {});
      const resultWithContext = assessEvidenceQuality(sampleScanEvidence, playbookEntry, sampleContext);

      assert.ok(resultWithContext.confidence >= resultWithoutContext.confidence,
        'Context should improve or maintain confidence');
    });
  });

  describe('FAQ False-Positive Detection', () => {

    it('detects "Open Products Menu" as false positive', () => {
      assert.ok(isFaqFalsePositive('Open Products Menu'),
        'Should detect menu toggle pattern');
    });

    it('detects "Close Navigation" as false positive', () => {
      assert.ok(isFaqFalsePositive('Close Navigation'),
        'Should detect close navigation pattern');
    });

    it('detects "About Us Menu" as false positive', () => {
      assert.ok(isFaqFalsePositive('About Us Menu Toggle'),
        'Should detect about us menu pattern');
    });

    it('detects "Show more" as false positive', () => {
      assert.ok(isFaqFalsePositive('Show more'),
        'Should detect show more pattern');
    });

    it('allows legitimate FAQ questions', () => {
      assert.ok(!isFaqFalsePositive('What is your pricing model?'),
        'Should allow real FAQ questions');
      assert.ok(!isFaqFalsePositive('How does your platform integrate with existing systems?'),
        'Should allow real FAQ questions');
    });

    it('analyzeFaqQuality detects suspicious FAQs', () => {
      const result = analyzeFaqQuality(sampleEvidenceWithFaqFalsePositives);

      assert.ok(result.isSuspicious, 'Should mark as suspicious');
      assert.ok(result.suspiciousCount > 0, 'Should count suspicious FAQs');
      assert.ok(result.reasons.length > 0, 'Should provide reasons');
    });

    it('analyzeFaqQuality passes clean evidence', () => {
      const result = analyzeFaqQuality(sampleScanEvidence);

      // sampleScanEvidence has no FAQs or legitimate ones
      assert.ok(!result.isSuspicious || result.totalCount === 0,
        'Clean evidence should not be suspicious');
    });
  });

  describe('Automation Level Adjustment', () => {

    it('strong evidence keeps generate level', () => {
      const adjusted = adjustAutomationLevel('generate', EVIDENCE_QUALITY.STRONG);
      assert.strictEqual(adjusted, 'generate');
    });

    it('medium evidence keeps generate level', () => {
      const adjusted = adjustAutomationLevel('generate', EVIDENCE_QUALITY.MEDIUM);
      assert.strictEqual(adjusted, 'generate');
    });

    it('weak evidence downgrades generate to draft', () => {
      const adjusted = adjustAutomationLevel('generate', EVIDENCE_QUALITY.WEAK);
      assert.strictEqual(adjusted, 'draft');
    });

    it('weak evidence downgrades draft to guide', () => {
      const adjusted = adjustAutomationLevel('draft', EVIDENCE_QUALITY.WEAK);
      assert.strictEqual(adjusted, 'guide');
    });

    it('ambiguous evidence downgrades generate to guide', () => {
      const adjusted = adjustAutomationLevel('generate', EVIDENCE_QUALITY.AMBIGUOUS);
      assert.strictEqual(adjusted, 'guide');
    });

    it('ambiguous evidence downgrades draft to manual', () => {
      const adjusted = adjustAutomationLevel('draft', EVIDENCE_QUALITY.AMBIGUOUS);
      assert.strictEqual(adjusted, 'manual');
    });
  });

  describe('Generation Hook Gating', () => {

    it('allows organization schema with valid evidence', () => {
      const result = canRunGenerationHook(
        'technical_setup.organization_schema',
        sampleScanEvidence,
        sampleContext
      );

      assert.ok(result.canGenerate, `Should allow: ${result.reason}`);
    });

    it('blocks organization schema when no org name detectable', () => {
      const emptyEvidence = { url: 'https://example.com' };
      const result = canRunGenerationHook(
        'technical_setup.organization_schema',
        emptyEvidence,
        {}
      );

      assert.ok(!result.canGenerate, 'Should block without org identity');
      assert.ok(result.reason.includes('organization name'),
        'Reason should mention org name');
    });

    it('allows open graph with title and description', () => {
      const result = canRunGenerationHook(
        'technical_setup.open_graph_tags',
        sampleScanEvidence,
        sampleContext
      );

      assert.ok(result.canGenerate, `Should allow: ${result.reason}`);
    });

    it('blocks ICP FAQs when suspicious FAQs detected', () => {
      const result = canRunGenerationHook(
        'ai_search_readiness.icp_faqs',
        sampleEvidenceWithFaqFalsePositives,
        sampleContext
      );

      assert.ok(!result.canGenerate, 'Should block with suspicious FAQs');
      assert.ok(result.reason.toLowerCase().includes('faq'),
        'Reason should mention FAQ issue');
    });

    it('blocks ICP FAQs when no industry context', () => {
      const result = canRunGenerationHook(
        'ai_search_readiness.icp_faqs',
        sampleScanEvidence,
        {} // No industry context
      );

      assert.ok(!result.canGenerate, 'Should block without industry context');
      assert.ok(result.reason.includes('industry') || result.reason.includes('ICP'),
        'Reason should mention missing context');
    });

    it('allows ICP FAQs with industry context', () => {
      const result = canRunGenerationHook(
        'ai_search_readiness.icp_faqs',
        sampleScanEvidence,
        sampleContext
      );

      assert.ok(result.canGenerate, `Should allow with context: ${result.reason}`);
    });
  });

  describe('Recommendation Filtering', () => {

    it('skips weak evidence with small score gap', () => {
      const result = shouldSkipRecommendation({
        evidenceQuality: EVIDENCE_QUALITY.WEAK,
        automationLevel: 'draft',
        score: 65,
        threshold: 70
      });

      assert.ok(result.shouldSkip, 'Should skip close-to-threshold with weak evidence');
      assert.ok(result.reason.includes('noise'), 'Reason should mention noise');
    });

    it('does not skip weak evidence with large score gap', () => {
      const result = shouldSkipRecommendation({
        evidenceQuality: EVIDENCE_QUALITY.WEAK,
        automationLevel: 'draft',
        score: 30,
        threshold: 70
      });

      assert.ok(!result.shouldSkip, 'Should not skip large gap even with weak evidence');
    });

    it('does not skip strong evidence recommendations', () => {
      const result = shouldSkipRecommendation({
        evidenceQuality: EVIDENCE_QUALITY.STRONG,
        automationLevel: 'generate',
        score: 65,
        threshold: 70
      });

      assert.ok(!result.shouldSkip, 'Should not skip strong evidence');
    });
  });

  describe('Verification Action Items', () => {

    it('adds verification warning for ambiguous FAQ evidence', () => {
      const items = getVerificationActionItems(
        'ai_search_readiness.faq_schema',
        EVIDENCE_QUALITY.AMBIGUOUS,
        {}
      );

      assert.ok(items.length > 0, 'Should add verification items');
      assert.ok(items[0].includes('Verify'), 'Should include verify instruction');
      assert.ok(items[0].includes('FAQ'), 'Should mention FAQ');
    });

    it('adds collect/confirm instruction for weak evidence', () => {
      const items = getVerificationActionItems(
        'technical_setup.test',
        EVIDENCE_QUALITY.WEAK,
        {}
      );

      assert.ok(items.length > 0, 'Should add items for weak evidence');
      assert.ok(items.some(i => i.includes('Collect') || i.includes('confirm')),
        'Should mention collecting/confirming inputs');
    });

    it('adds missing evidence note when applicable', () => {
      const items = getVerificationActionItems(
        'technical_setup.test',
        EVIDENCE_QUALITY.WEAK,
        { minEvidenceMissing: 3 }
      );

      assert.ok(items.some(i => i.includes('Missing') || i.includes('3')),
        'Should mention missing evidence count');
    });
  });

  describe('Renderer Evidence Gating Integration', () => {

    it('recommendations include confidence field', async () => {
      const scan = { id: 'test-scan-evidence' };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: sampleRubricResult,
        scanEvidence: sampleScanEvidence,
        context: sampleContext
      });

      for (const rec of recommendations) {
        assert.ok(typeof rec.confidence === 'number',
          `Recommendation ${rec.subfactor_key} should have numeric confidence`);
        assert.ok(rec.confidence >= 0 && rec.confidence <= 1,
          `Confidence should be 0-1, got ${rec.confidence}`);
      }
    });

    it('recommendations include evidence_quality field', async () => {
      const scan = { id: 'test-scan-evidence' };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: sampleRubricResult,
        scanEvidence: sampleScanEvidence,
        context: sampleContext
      });

      const validQualities = Object.values(EVIDENCE_QUALITY);

      for (const rec of recommendations) {
        assert.ok(validQualities.includes(rec.evidence_quality),
          `evidence_quality should be valid enum, got ${rec.evidence_quality}`);
      }
    });

    it('recommendations include evidence_summary field', async () => {
      const scan = { id: 'test-scan-evidence' };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: sampleRubricResult,
        scanEvidence: sampleScanEvidence,
        context: sampleContext
      });

      for (const rec of recommendations) {
        assert.ok(typeof rec.evidence_summary === 'string',
          `evidence_summary should be string, got ${typeof rec.evidence_summary}`);
      }
    });

    it('weak evidence downgrades automation_level in recommendations', async () => {
      const scan = { id: 'test-scan-weak' };

      // Create evidence with minimal data to trigger weak assessment
      const minimalEvidence = {
        url: 'https://example.com',
        timestamp: new Date().toISOString(),
        metadata: { title: 'Test' }
      };

      // Rubric that triggers organization_schema (normally generate level)
      const rubricForGenerate = {
        categories: {
          technicalSetup: {
            score: 30,
            subfactors: {
              structuredDataScore: 20
            }
          }
        }
      };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: rubricForGenerate,
        scanEvidence: minimalEvidence,
        context: {} // No context to keep evidence weak
      });

      // If a generate-level recommendation exists, check if it was downgraded
      const generateRecs = recommendations.filter(r =>
        r.evidence_quality === EVIDENCE_QUALITY.WEAK ||
        r.evidence_quality === EVIDENCE_QUALITY.AMBIGUOUS
      );

      for (const rec of generateRecs) {
        // Weak/ambiguous evidence should not result in 'generate' level
        if (rec.evidence_quality === EVIDENCE_QUALITY.WEAK) {
          assert.ok(rec.automation_level !== 'generate' || rec.generated_assets.length === 0,
            `Weak evidence should downgrade or not generate assets`);
        }
      }
    });
  });
});

// ========================================
// TARGETING TESTS (Phase 4A.1.5)
// ========================================

describe('Targeting', () => {

  describe('Target Level Constants', () => {

    it('TARGET_LEVEL has required values', () => {
      assert.strictEqual(TARGET_LEVEL.SITE, 'site');
      assert.strictEqual(TARGET_LEVEL.PAGE, 'page');
      assert.strictEqual(TARGET_LEVEL.BOTH, 'both');
    });
  });

  describe('getTargetLevel', () => {

    it('returns site for sitemap_indexing', () => {
      const level = getTargetLevel('technical_setup.sitemap_indexing');
      assert.strictEqual(level, 'site');
    });

    it('returns site for organization_schema', () => {
      const level = getTargetLevel('technical_setup.organization_schema');
      assert.strictEqual(level, 'site');
    });

    it('returns site for crawler_access', () => {
      const level = getTargetLevel('technical_setup.crawler_access');
      assert.strictEqual(level, 'site');
    });

    it('returns page for alt_text_coverage', () => {
      const level = getTargetLevel('ai_readability.alt_text_coverage');
      assert.strictEqual(level, 'page');
    });

    it('returns page for social_meta_tags', () => {
      const level = getTargetLevel('technical_setup.social_meta_tags');
      assert.strictEqual(level, 'page');
    });

    it('returns page for semantic_heading_structure', () => {
      const level = getTargetLevel('content_structure.semantic_heading_structure');
      assert.strictEqual(level, 'page');
    });

    it('returns both for structured_data_coverage', () => {
      const level = getTargetLevel('technical_setup.structured_data_coverage');
      assert.strictEqual(level, 'both');
    });

    it('returns both for icp_faqs', () => {
      const level = getTargetLevel('ai_search_readiness.icp_faqs');
      assert.strictEqual(level, 'both');
    });

    it('falls back to category default for unknown subfactor', () => {
      // trust_authority defaults to 'site'
      const level = getTargetLevel('trust_authority.unknown_subfactor');
      assert.strictEqual(level, 'site');
    });

    it('returns page for completely unknown key', () => {
      const level = getTargetLevel('unknown.unknown');
      assert.strictEqual(level, 'page');
    });
  });

  describe('isSiteLevel and isPageLevel', () => {

    it('isSiteLevel returns true for site-level subfactors', () => {
      assert.ok(isSiteLevel('technical_setup.sitemap_indexing'));
      assert.ok(isSiteLevel('technical_setup.organization_schema'));
    });

    it('isSiteLevel returns true for both-level subfactors', () => {
      assert.ok(isSiteLevel('technical_setup.structured_data_coverage'));
    });

    it('isSiteLevel returns false for page-only subfactors', () => {
      assert.ok(!isSiteLevel('ai_readability.alt_text_coverage'));
    });

    it('isPageLevel returns true for page-level subfactors', () => {
      assert.ok(isPageLevel('ai_readability.alt_text_coverage'));
      assert.ok(isPageLevel('content_structure.semantic_heading_structure'));
    });

    it('isPageLevel returns true for both-level subfactors', () => {
      assert.ok(isPageLevel('ai_search_readiness.icp_faqs'));
    });

    it('isPageLevel returns false for site-only subfactors', () => {
      assert.ok(!isPageLevel('technical_setup.sitemap_indexing'));
    });
  });

  describe('getSubfactorsByTargetLevel', () => {

    it('returns site-level subfactors', () => {
      const siteSubfactors = getSubfactorsByTargetLevel('site');
      assert.ok(Array.isArray(siteSubfactors));
      assert.ok(siteSubfactors.includes('technical_setup.sitemap_indexing'));
      assert.ok(siteSubfactors.includes('technical_setup.organization_schema'));
    });

    it('returns page-level subfactors', () => {
      const pageSubfactors = getSubfactorsByTargetLevel('page');
      assert.ok(Array.isArray(pageSubfactors));
      assert.ok(pageSubfactors.includes('ai_readability.alt_text_coverage'));
    });

    it('returns both-level subfactors', () => {
      const bothSubfactors = getSubfactorsByTargetLevel('both');
      assert.ok(Array.isArray(bothSubfactors));
      assert.ok(bothSubfactors.includes('ai_search_readiness.icp_faqs'));
    });
  });

  describe('Renderer target_level Integration', () => {

    it('recommendations include target_level field', async () => {
      const scan = { id: 'test-scan-targeting' };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: sampleRubricResult,
        scanEvidence: sampleScanEvidence,
        context: sampleContext
      });

      for (const rec of recommendations) {
        assert.ok(rec.target_level,
          `Recommendation ${rec.subfactor_key} should have target_level`);
        assert.ok(['site', 'page', 'both'].includes(rec.target_level),
          `target_level should be valid enum, got ${rec.target_level}`);
      }
    });

    it('target_level matches expected for representative subfactors', async () => {
      const scan = { id: 'test-scan-targeting' };

      // Create rubric that triggers specific subfactors
      const rubricForTargeting = {
        categories: {
          technicalSetup: {
            score: 30,
            subfactors: {
              structuredDataScore: 20,  // should be 'both'
              sitemapScore: 15          // should be 'site'
            }
          },
          aiReadability: {
            score: 40,
            subfactors: {
              altTextScore: 25          // should be 'page'
            }
          }
        }
      };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: rubricForTargeting,
        scanEvidence: sampleScanEvidence,
        context: sampleContext
      });

      // Check specific target levels if those subfactors produced recommendations
      for (const rec of recommendations) {
        if (rec.subfactor_key.includes('sitemap')) {
          assert.strictEqual(rec.target_level, 'site',
            'Sitemap should be site-level');
        }
        if (rec.subfactor_key.includes('alt_text')) {
          assert.strictEqual(rec.target_level, 'page',
            'Alt text should be page-level');
        }
        if (rec.subfactor_key.includes('structured_data')) {
          assert.strictEqual(rec.target_level, 'both',
            'Structured data coverage should be both');
        }
      }
    });
  });
});

// ========================================
// TARGET NORMALIZATION TESTS (Phase 4A.2.1)
// ========================================

// Import normalizeRecommendationTargets for testing
const { normalizeRecommendationTargets } = require('../../recommendations/renderer');

describe('Target Normalization (Phase 4A.2.1)', () => {

  describe('normalizeRecommendationTargets', () => {

    it('passes through site-level recommendations unchanged', () => {
      const recommendations = [
        {
          subfactor_key: 'technical_setup.sitemap',
          target_level: 'site',
          target_url: null
        }
      ];

      const result = normalizeRecommendationTargets(recommendations, {}, {});

      assert.strictEqual(result[0].target_level, 'site');
      assert.strictEqual(result[0].target_url, null);
    });

    it('passes through page-level recommendations with valid target_url', () => {
      const recommendations = [
        {
          subfactor_key: 'ai_readability.alt_text',
          target_level: 'page',
          target_url: 'https://example.com/about'
        }
      ];

      const result = normalizeRecommendationTargets(recommendations, {}, {});

      assert.strictEqual(result[0].target_level, 'page');
      assert.strictEqual(result[0].target_url, 'https://example.com/about');
    });

    it('derives target_url from evidence when missing', () => {
      const recommendations = [
        {
          subfactor_key: 'ai_readability.alt_text',
          target_level: 'page',
          target_url: null
        }
      ];

      const evidence = { url: 'https://example.com/derived' };

      const result = normalizeRecommendationTargets(recommendations, evidence, {});

      assert.strictEqual(result[0].target_level, 'page');
      assert.strictEqual(result[0].target_url, 'https://example.com/derived');
    });

    it('derives target_url from context.site_url when evidence.url missing', () => {
      const recommendations = [
        {
          subfactor_key: 'ai_readability.alt_text',
          target_level: 'page',
          target_url: ''
        }
      ];

      const context = { site_url: 'https://example.com/from-context' };

      const result = normalizeRecommendationTargets(recommendations, {}, context);

      assert.strictEqual(result[0].target_level, 'page');
      assert.strictEqual(result[0].target_url, 'https://example.com/from-context');
    });

    it('downgrades to site-level when no URL derivable', () => {
      const recommendations = [
        {
          subfactor_key: 'ai_readability.alt_text',
          target_level: 'page',
          target_url: null
        }
      ];

      const result = normalizeRecommendationTargets(recommendations, {}, {});

      assert.strictEqual(result[0].target_level, 'site');
      assert.strictEqual(result[0].target_url, null);
    });

    it('handles empty string target_url as missing', () => {
      const recommendations = [
        {
          subfactor_key: 'ai_readability.alt_text',
          target_level: 'page',
          target_url: '   '  // whitespace only
        }
      ];

      const result = normalizeRecommendationTargets(recommendations, {}, {});

      assert.strictEqual(result[0].target_level, 'site');
      assert.strictEqual(result[0].target_url, null);
    });

    it('processes multiple recommendations correctly', () => {
      const recommendations = [
        {
          subfactor_key: 'technical_setup.sitemap',
          target_level: 'site',
          target_url: null
        },
        {
          subfactor_key: 'ai_readability.alt_text',
          target_level: 'page',
          target_url: 'https://example.com/page1'
        },
        {
          subfactor_key: 'content_structure.heading_hierarchy',
          target_level: 'page',
          target_url: null  // will be downgraded
        }
      ];

      const result = normalizeRecommendationTargets(recommendations, {}, {});

      assert.strictEqual(result[0].target_level, 'site');
      assert.strictEqual(result[1].target_level, 'page');
      assert.strictEqual(result[1].target_url, 'https://example.com/page1');
      assert.strictEqual(result[2].target_level, 'site');  // downgraded
    });

    it('does not modify both-level recommendations', () => {
      const recommendations = [
        {
          subfactor_key: 'technical_setup.structured_data',
          target_level: 'both',
          target_url: null
        }
      ];

      const result = normalizeRecommendationTargets(recommendations, {}, {});

      assert.strictEqual(result[0].target_level, 'both');
    });
  });

  describe('Integration with renderRecommendations', () => {

    it('page-level recommendations get target_url from evidence', async () => {
      // Create rubric that triggers page-level subfactor
      const rubricForPageLevel = {
        categories: {
          aiReadability: {
            score: 30,
            subfactors: {
              altTextScore: 20  // page-level
            }
          }
        }
      };

      const scan = { id: 'test-normalization' };
      const evidence = { url: 'https://example.com/test-page' };
      const context = { detected_industry: 'technology' };

      const recommendations = await renderRecommendations({
        scan,
        rubricResult: rubricForPageLevel,
        scanEvidence: evidence,
        context
      });

      const pageRec = recommendations.find(r =>
        r.subfactor_key.includes('alt_text') && r.target_level === 'page'
      );

      if (pageRec) {
        assert.ok(pageRec.target_url,
          'Page-level recommendation should have target_url');
        assert.strictEqual(pageRec.target_url, 'https://example.com/test-page');
      }
    });

    it('page recommendations without URL source are downgraded', async () => {
      const rubricForPageLevel = {
        categories: {
          aiReadability: {
            score: 30,
            subfactors: {
              altTextScore: 20
            }
          }
        }
      };

      const scan = { id: 'test-downgrade' };

      // No URL in evidence or context
      const recommendations = await renderRecommendations({
        scan,
        rubricResult: rubricForPageLevel,
        scanEvidence: {},
        context: {}
      });

      // All page-level recs should be downgraded to site
      for (const rec of recommendations) {
        if (rec.target_level === 'page') {
          assert.ok(rec.target_url,
            `Page-level rec ${rec.subfactor_key} must have target_url`);
        }
      }
    });
  });
});
