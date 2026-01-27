/**
 * Phase 4A.3c Tests: Evidence-Based Recommendations + 5-Section Output
 *
 * Covers:
 * - 9A: Placeholder safety (no leaks for Top 10)
 * - 9B: 5-section presence for Top 10
 * - 9C: COMPLETE suppression for detection state
 * - Strict placeholder resolver
 * - Evidence helpers
 * - Detection states
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ========================================
// 9A: PLACEHOLDER SAFETY
// ========================================

describe('Phase 4A.3c: Placeholder Safety', () => {
  const {
    resolveTemplate,
    resolveTemplateArray,
    validateNoPlaceholderLeaks,
    isUsableValue,
    cleanupText,
    SAFE_FALLBACKS
  } = require('../../recommendations/placeholderResolver');

  it('resolves {{key}} from context', () => {
    const result = resolveTemplate('Hello {{name}}!', { name: 'World' });
    assert.equal(result, 'Hello World!');
  });

  it('uses safe fallback when context value missing', () => {
    const result = resolveTemplate('Visit {{domain}} today', {});
    assert.equal(result, 'Visit your website today');
  });

  it('replaces unresolved placeholders with empty string (never leaves {{...}})', () => {
    const result = resolveTemplate('Check {{unknown_key_xyz}} now', {});
    assert.ok(!result.includes('{{'));
    assert.ok(!result.includes('}}'));
  });

  it('never outputs [placeholder_name] brackets', () => {
    const result = resolveTemplate('Test {{nonexistent_placeholder_test}}', {});
    assert.ok(!result.includes('[nonexistent_placeholder_test]'));
  });

  it('handles state-keyed template objects', () => {
    const template = {
      NOT_FOUND: 'Nothing found on {{domain}}',
      PARTIAL: 'Some data on {{domain}}',
      default: 'Check {{domain}}'
    };
    const result = resolveTemplate(template, { domain: 'example.com' }, { detectionState: 'NOT_FOUND' });
    assert.equal(result, 'Nothing found on example.com');
  });

  it('falls back to default state when state not found', () => {
    const template = { NOT_FOUND: 'Missing', default: 'Default text for {{domain}}' };
    const result = resolveTemplate(template, { domain: 'test.com' }, { detectionState: 'UNKNOWN_STATE' });
    assert.equal(result, 'Default text for test.com');
  });

  it('resolves dot-notation paths in context', () => {
    const result = resolveTemplate('Name: {{company.name}}', { company: { name: 'Acme' } });
    assert.equal(result, 'Name: Acme');
  });

  it('handles null/undefined templates gracefully', () => {
    assert.equal(resolveTemplate(null, {}), '');
    assert.equal(resolveTemplate(undefined, {}), '');
    assert.equal(resolveTemplate('', {}), '');
  });

  it('resolveTemplateArray filters empty results', () => {
    const result = resolveTemplateArray(['Step 1: {{step}}', '', '  '], { step: 'Do this' });
    assert.equal(result.length, 1);
    assert.equal(result[0], 'Step 1: Do this');
  });

  it('cleanupText removes double spaces and empty parens', () => {
    assert.equal(cleanupText('Hello  World'), 'Hello World');
    assert.equal(cleanupText('Test () here'), 'Test here');
    assert.equal(cleanupText('End..'), 'End.');
  });

  it('isUsableValue rejects null, undefined, empty, "undefined", "null"', () => {
    assert.equal(isUsableValue(null), false);
    assert.equal(isUsableValue(undefined), false);
    assert.equal(isUsableValue(''), false);
    assert.equal(isUsableValue('hello'), true);
    assert.equal(isUsableValue(0), true); // 0 is usable
    assert.equal(isUsableValue(42), true);
  });

  it('validateNoPlaceholderLeaks detects {{...}} leaks', () => {
    const result = validateNoPlaceholderLeaks({ text: 'Hello {{leaked}}' });
    assert.equal(result.valid, false);
    assert.ok(result.leaks.length > 0);
  });

  it('validateNoPlaceholderLeaks passes on clean output', () => {
    const result = validateNoPlaceholderLeaks({ text: 'Hello World', count: 5 });
    assert.equal(result.valid, true);
    assert.equal(result.leaks.length, 0);
  });

  // Test all Top 10 playbook entries resolve without leaks
  describe('Top 10 playbook entries resolve without leaks', () => {
    const { SUBFACTOR_TO_PLAYBOOK } = require('../../recommendations/subfactorPlaybookMap');
    const TOP_10 = require('../../recommendations/topSubfactors.phase4a3c.json').top10;

    const sampleContext = {
      domain: 'example.com',
      company_name: 'Acme Corp',
      site_url: 'https://example.com',
      icp_roles: 'CTOs and engineering leads',
      industry: 'technology',
      product_name: 'Acme Platform',
      schema_count: '2',
      detected_schemas: 'Organization, WebSite',
      missing_schemas: 'FAQPage, BreadcrumbList',
      heading_count: '15',
      total_images: '20',
      images_without_alt: '8',
      images_with_alt: '12',
      faq_count: '3',
      pages_checked_count: '5',
      pages_with_faqs: 'https://example.com/faq',
      ttfb: '350',
      error_summary: 'missing required name property',
      error_count: '2',
      pages_checked_list: 'homepage, about, pricing',
      industry_specific_schema: 'SoftwareApplication'
    };

    for (const key of TOP_10) {
      it(`${key}: finding_templates resolve without leaks`, () => {
        const entry = SUBFACTOR_TO_PLAYBOOK[key];
        assert.ok(entry, `Playbook entry for ${key} must exist`);

        if (entry.finding_templates) {
          for (const [state, template] of Object.entries(entry.finding_templates)) {
            const resolved = resolveTemplate(template, sampleContext);
            const check = validateNoPlaceholderLeaks(resolved);
            assert.ok(check.valid, `${key} finding_templates.${state} has leaks: ${check.leaks.join(', ')}`);
          }
        }
      });

      it(`${key}: recommendation_template resolves without leaks`, () => {
        const entry = SUBFACTOR_TO_PLAYBOOK[key];
        if (entry.recommendation_template) {
          if (typeof entry.recommendation_template === 'object') {
            for (const [state, template] of Object.entries(entry.recommendation_template)) {
              const resolved = resolveTemplate(template, sampleContext);
              const check = validateNoPlaceholderLeaks(resolved);
              assert.ok(check.valid, `${key} recommendation_template.${state} has leaks: ${check.leaks.join(', ')}`);
            }
          } else {
            const resolved = resolveTemplate(entry.recommendation_template, sampleContext);
            const check = validateNoPlaceholderLeaks(resolved);
            assert.ok(check.valid, `${key} recommendation_template has leaks: ${check.leaks.join(', ')}`);
          }
        }
      });

      it(`${key}: what_to_include_template resolves without leaks`, () => {
        const entry = SUBFACTOR_TO_PLAYBOOK[key];
        if (entry.what_to_include_template) {
          const resolved = resolveTemplate(entry.what_to_include_template, sampleContext);
          const check = validateNoPlaceholderLeaks(resolved);
          assert.ok(check.valid, `${key} what_to_include has leaks: ${check.leaks.join(', ')}`);
        }
      });
    }
  });
});

// ========================================
// 9B: 5-SECTION PRESENCE
// ========================================

describe('Phase 4A.3c: 5-Section Presence for Top 10', () => {
  const { SUBFACTOR_TO_PLAYBOOK } = require('../../recommendations/subfactorPlaybookMap');
  const TOP_10 = require('../../recommendations/topSubfactors.phase4a3c.json').top10;
  const { resolveTemplate, resolveTemplateArray } = require('../../recommendations/placeholderResolver');

  const sampleContext = {
    domain: 'example.com',
    company_name: 'Acme Corp',
    site_url: 'https://example.com',
    icp_roles: 'CTOs',
    industry: 'technology',
    schema_count: '2',
    detected_schemas: 'Organization',
    missing_schemas: 'FAQPage',
    heading_count: '10',
    total_images: '15',
    images_without_alt: '5',
    faq_count: '0',
    pages_checked_count: '5',
    ttfb: '300',
    error_summary: 'validation error',
    error_count: '1',
    industry_specific_schema: 'SoftwareApplication'
  };

  for (const key of TOP_10) {
    describe(`${key}`, () => {
      const entry = SUBFACTOR_TO_PLAYBOOK[key];

      it('has finding_templates (object with state variants)', () => {
        assert.ok(entry.finding_templates, `${key} must have finding_templates`);
        assert.equal(typeof entry.finding_templates, 'object');
        assert.ok(entry.finding_templates.NOT_FOUND || entry.finding_templates.default,
          `${key} finding_templates must have NOT_FOUND or default`);
      });

      it('finding resolves to non-empty string', () => {
        const finding = resolveTemplate(entry.finding_templates, sampleContext, { detectionState: 'NOT_FOUND' });
        assert.ok(finding.length > 0, `${key} finding must be non-empty`);
      });

      it('has why_it_matters_template (non-empty)', () => {
        assert.ok(entry.why_it_matters_template, `${key} must have why_it_matters_template`);
        const resolved = resolveTemplate(entry.why_it_matters_template, sampleContext);
        assert.ok(resolved.length > 0, `${key} why_it_matters must resolve non-empty`);
      });

      it('has recommendation_template', () => {
        assert.ok(entry.recommendation_template, `${key} must have recommendation_template`);
        const resolved = resolveTemplate(entry.recommendation_template, sampleContext, { detectionState: 'NOT_FOUND' });
        assert.ok(resolved.length >= 20, `${key} recommendation must be >= 20 chars, got ${resolved.length}`);
      });

      it('has what_to_include_template (defined, can be empty)', () => {
        assert.ok(entry.what_to_include_template !== undefined, `${key} must have what_to_include_template defined`);
        // Can be empty string, just must be defined
        assert.equal(typeof entry.what_to_include_template, 'string');
      });

      it('has action_items_template with >= 1 items', () => {
        assert.ok(Array.isArray(entry.action_items_template), `${key} must have action_items_template array`);
        assert.ok(entry.action_items_template.length >= 1, `${key} must have at least 1 action item`);
        const resolved = resolveTemplateArray(entry.action_items_template, sampleContext);
        assert.ok(resolved.length >= 1, `${key} must resolve to at least 1 action item`);
      });
    });
  }
});

// ========================================
// 9C: COMPLETE SUPPRESSION
// ========================================

describe('Phase 4A.3c: COMPLETE State Suppression', () => {
  const {
    DETECTION_STATE,
    getDetectionState,
    hasDetectionFunction,
    shouldSuppressRecommendation
  } = require('../../recommendations/detectionStates.top10');

  it('shouldSuppressRecommendation returns true for COMPLETE', () => {
    assert.equal(shouldSuppressRecommendation(DETECTION_STATE.COMPLETE), true);
  });

  it('shouldSuppressRecommendation returns false for NOT_FOUND', () => {
    assert.equal(shouldSuppressRecommendation(DETECTION_STATE.NOT_FOUND), false);
  });

  it('shouldSuppressRecommendation returns false for PARTIAL', () => {
    assert.equal(shouldSuppressRecommendation(DETECTION_STATE.PARTIAL), false);
  });

  // Test organization_schema COMPLETE detection
  it('organization_schema: COMPLETE when hasOrganizationSchema is true', () => {
    const evidence = {
      technical: {
        hasOrganizationSchema: true,
        structuredData: [{ type: 'Organization' }]
      }
    };
    const state = getDetectionState('technical_setup.organization_schema', evidence);
    assert.equal(state, DETECTION_STATE.COMPLETE);
  });

  it('organization_schema: NOT_FOUND when no schema', () => {
    const evidence = { technical: { structuredData: [] } };
    const state = getDetectionState('technical_setup.organization_schema', evidence);
    assert.equal(state, DETECTION_STATE.NOT_FOUND);
  });

  // Test icp_faqs COMPLETE detection
  it('icp_faqs: COMPLETE when >= 5 FAQs with schema', () => {
    const evidence = {
      content: { faqs: [{}, {}, {}, {}, {}, {}] },
      technical: { hasFAQSchema: true }
    };
    const state = getDetectionState('ai_search_readiness.icp_faqs', evidence);
    assert.equal(state, DETECTION_STATE.COMPLETE);
  });

  it('icp_faqs: CONTENT_NO_SCHEMA when FAQs present but no schema', () => {
    const evidence = {
      content: { faqs: [{}, {}, {}] },
      technical: { hasFAQSchema: false }
    };
    const state = getDetectionState('ai_search_readiness.icp_faqs', evidence);
    assert.equal(state, DETECTION_STATE.CONTENT_NO_SCHEMA);
  });

  it('icp_faqs: NOT_FOUND when no FAQs', () => {
    const evidence = { content: { faqs: [] }, technical: {} };
    const state = getDetectionState('ai_search_readiness.icp_faqs', evidence);
    assert.equal(state, DETECTION_STATE.NOT_FOUND);
  });

  // Test alt_text_coverage COMPLETE detection
  it('alt_text_coverage: COMPLETE when >= 90% coverage', () => {
    const evidence = {
      media: { imageCount: 10, imagesWithAlt: 9, imagesWithoutAlt: 1 }
    };
    const state = getDetectionState('ai_readability.alt_text_coverage', evidence);
    assert.equal(state, DETECTION_STATE.COMPLETE);
  });

  it('alt_text_coverage: COMPLETE when no images', () => {
    const evidence = { media: { imageCount: 0 } };
    const state = getDetectionState('ai_readability.alt_text_coverage', evidence);
    assert.equal(state, DETECTION_STATE.COMPLETE);
  });

  it('alt_text_coverage: NOT_FOUND when 0% coverage', () => {
    const evidence = {
      media: { imageCount: 10, imagesWithAlt: 0, imagesWithoutAlt: 10 }
    };
    const state = getDetectionState('ai_readability.alt_text_coverage', evidence);
    assert.equal(state, DETECTION_STATE.NOT_FOUND);
  });

  // All Top 10 have detection functions
  it('all Top 10 subfactors have detection functions', () => {
    const TOP_10 = require('../../recommendations/topSubfactors.phase4a3c.json').top10;
    for (const key of TOP_10) {
      assert.ok(hasDetectionFunction(key), `${key} must have a detection function`);
    }
  });

  // Unknown subfactors default to NOT_FOUND
  it('unknown subfactor returns NOT_FOUND', () => {
    const state = getDetectionState('unknown.subfactor', {});
    assert.equal(state, DETECTION_STATE.NOT_FOUND);
  });

  // Null evidence doesn't throw
  it('handles null evidence without throwing', () => {
    const state = getDetectionState('technical_setup.organization_schema', null);
    assert.equal(state, DETECTION_STATE.NOT_FOUND);
  });
});

// ========================================
// EVIDENCE HELPERS
// ========================================

describe('Phase 4A.3c: Evidence Helpers', () => {
  const {
    getEvidence,
    getPath,
    faqCount,
    hasFAQSchema,
    hasOrganizationSchema,
    schemaTypeCount,
    imageAltStats,
    headingInfo,
    buildEvidenceContext,
    missingCommonSchemas
  } = require('../../recommendations/evidenceHelpers');

  it('getEvidence unwraps detailed_analysis', () => {
    const scan = { detailed_analysis: { technical: { foo: 'bar' } } };
    const ev = getEvidence(scan);
    assert.equal(ev.technical.foo, 'bar');
  });

  it('getEvidence returns {} for null/undefined', () => {
    assert.deepEqual(getEvidence(null), {});
    assert.deepEqual(getEvidence(undefined), {});
  });

  it('getPath supports dot-notation', () => {
    assert.equal(getPath({ a: { b: { c: 42 } } }, 'a.b.c'), 42);
    assert.equal(getPath({}, 'a.b.c'), undefined);
    assert.equal(getPath(null, 'a'), undefined);
  });

  it('faqCount returns count from content.faqs array', () => {
    assert.equal(faqCount({ content: { faqs: [{}, {}, {}] } }), 3);
    assert.equal(faqCount({}), 0);
  });

  it('hasFAQSchema detects from boolean flag', () => {
    assert.equal(hasFAQSchema({ technical: { hasFAQSchema: true } }), true);
    assert.equal(hasFAQSchema({}), false);
  });

  it('hasOrganizationSchema detects from structuredData array', () => {
    assert.equal(hasOrganizationSchema({ technical: { structuredData: [{ type: 'Organization' }] } }), true);
    assert.equal(hasOrganizationSchema({}), false);
  });

  it('schemaTypeCount counts structured data entries', () => {
    assert.equal(schemaTypeCount({ technical: { structuredData: [{}, {}, {}] } }), 3);
    assert.equal(schemaTypeCount({}), 0);
  });

  it('imageAltStats returns correct breakdown', () => {
    const stats = imageAltStats({ media: { imageCount: 10, imagesWithAlt: 7 } });
    assert.equal(stats.total, 10);
    assert.equal(stats.withAlt, 7);
    assert.equal(stats.withoutAlt, 3);
  });

  it('headingInfo detects missing H1', () => {
    const info = headingInfo({ content: { headings: { h2: ['A', 'B'] } } });
    assert.equal(info.h1Count, 0);
    assert.ok(info.issues.includes('Missing H1'));
  });

  it('missingCommonSchemas identifies gaps', () => {
    const missing = missingCommonSchemas({
      technical: { structuredData: [{ type: 'Organization' }] }
    });
    assert.ok(missing.includes('WebSite'));
    assert.ok(missing.includes('FAQPage'));
    assert.ok(!missing.includes('Organization'));
  });

  it('buildEvidenceContext returns flat key-value map', () => {
    const ctx = buildEvidenceContext({
      content: { faqs: [{}, {}], headings: { h1: ['Title'], h2: ['Sub'] } },
      media: { imageCount: 5, imagesWithAlt: 3 },
      technical: { structuredData: [{ type: 'Organization' }] }
    });
    assert.equal(ctx.faq_count, '2');
    assert.equal(ctx.h1_count, '1');
    assert.equal(ctx.total_images, '5');
    assert.equal(ctx.images_without_alt, '2');
    assert.equal(ctx.schema_count, '1');
    assert.equal(typeof ctx.heading_issues, 'string');
  });
});

// ========================================
// RENDERER INTEGRATION: 5-SECTION OUTPUT
// ========================================

describe('Phase 4A.3c: Renderer outputs 5 sections for Top 10', () => {
  const { renderRecommendations, TOP_10_SUBFACTORS } = require('../../recommendations/renderer');

  // Build a rubricResult where the top 10 subfactors all fail
  function buildFailingRubric() {
    const categories = {};
    for (const key of TOP_10_SUBFACTORS) {
      const [cat, sub] = key.split('.');
      if (!categories[cat]) {
        categories[cat] = { score: 30, subfactors: {} };
      }
      categories[cat].subfactors[sub] = 20; // Below 70 threshold
    }
    return { categories };
  }

  it('rendered Top 10 recs have all 5 sections', async () => {
    const recs = await renderRecommendations({
      scan: { id: 'test-5section', domain: 'example.com' },
      rubricResult: buildFailingRubric(),
      scanEvidence: {
        url: 'https://example.com',
        content: { headings: { h1: ['Test'] }, faqs: [] },
        technical: { structuredData: [] },
        media: { imageCount: 10, imagesWithAlt: 2, imagesWithoutAlt: 8 },
        metadata: { title: 'Test Page' }
      },
      context: { detected_industry: 'technology', icp_roles: ['CTOs'] }
    });

    assert.ok(recs.length > 0, 'Should produce at least 1 recommendation');

    const top10Recs = recs.filter(r => r.is_top10);
    assert.ok(top10Recs.length > 0, 'Should have at least 1 Top 10 rec');

    for (const rec of top10Recs) {
      // Section 1: finding
      assert.ok(typeof rec.finding === 'string', `${rec.subfactor_key}: finding must be string`);

      // Section 2: why_it_matters
      assert.ok(rec.why_it_matters.length > 0, `${rec.subfactor_key}: why_it_matters must be non-empty`);

      // Section 3: recommendation
      assert.ok(typeof rec.recommendation === 'string', `${rec.subfactor_key}: recommendation must be string`);

      // Section 4: what_to_include
      assert.ok(typeof rec.what_to_include === 'string', `${rec.subfactor_key}: what_to_include must be defined`);

      // Section 5: how_to_implement (alias of action_items)
      assert.ok(Array.isArray(rec.how_to_implement), `${rec.subfactor_key}: how_to_implement must be array`);
      assert.ok(rec.how_to_implement.length >= 1, `${rec.subfactor_key}: how_to_implement must have >= 1 item`);

      // Backward compat: action_items still present
      assert.deepEqual(rec.action_items, rec.how_to_implement);

      // No placeholder leaks
      const { validateNoPlaceholderLeaks } = require('../../recommendations/placeholderResolver');
      const leakCheck = validateNoPlaceholderLeaks({
        finding: rec.finding,
        why_it_matters: rec.why_it_matters,
        recommendation: rec.recommendation,
        what_to_include: rec.what_to_include
      });
      assert.ok(leakCheck.valid, `${rec.subfactor_key} has leaks: ${leakCheck.leaks.join(', ')}`);
    }
  });

  it('COMPLETE state suppresses recommendation', async () => {
    // Provide evidence that makes organization_schema COMPLETE
    const recs = await renderRecommendations({
      scan: { id: 'test-complete', domain: 'example.com' },
      rubricResult: {
        categories: {
          technical_setup: {
            score: 40,
            subfactors: {
              organization_schema: 20 // Fails threshold, but evidence says COMPLETE
            }
          }
        }
      },
      scanEvidence: {
        url: 'https://example.com',
        technical: {
          hasOrganizationSchema: true,
          structuredData: [{ type: 'Organization' }]
        },
        content: { headings: { h1: ['Test'] } },
        metadata: { title: 'Test' }
      },
      context: {}
    });

    // organization_schema should be suppressed because detection state is COMPLETE
    const orgRec = recs.find(r => r.subfactor_key === 'technical_setup.organization_schema');
    assert.equal(orgRec, undefined, 'organization_schema rec should be suppressed when COMPLETE');
  });

  it('non-Top10 recs still have finding and how_to_implement fields', async () => {
    const recs = await renderRecommendations({
      scan: { id: 'test-non-top10', domain: 'example.com' },
      rubricResult: {
        categories: {
          content_freshness: {
            score: 30,
            subfactors: { last_updated: 20 }
          }
        }
      },
      scanEvidence: {
        url: 'https://example.com',
        content: { headings: { h1: ['Test'] } },
        metadata: { title: 'Test' }
      },
      context: {}
    });

    if (recs.length > 0) {
      const rec = recs[0];
      // Non-top10 should still have the fields (even if empty)
      assert.ok('finding' in rec, 'Non-top10 rec should have finding field');
      assert.ok('how_to_implement' in rec, 'Non-top10 rec should have how_to_implement field');
    }
  });
});
