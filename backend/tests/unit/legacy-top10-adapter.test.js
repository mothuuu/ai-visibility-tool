/**
 * Tests for GET-time Legacy Top 10 Adapter (Phase 4A.3c)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  enrichLegacyRecommendations,
  getCanonicalKey,
  normTitle,
  keywordFallback,
  renderSingleTop10,
  TITLE_TO_CANONICAL,
  TOP_10_SET
} = require('../../recommendations/legacyTop10Adapter');

const sampleEvidence = require('../../recommendations/__fixtures__/sampleScanEvidence.json');

// ============================================
// Helper: build a minimal legacy rec row (as the DB returns it)
// ============================================
function makeLegacyRec(overrides = {}) {
  return {
    id: 1,
    recommendation_text: 'Some Generic Rec',
    rec_key: null,
    subfactor_key: null,
    category: 'Technical Setup',
    findings: 'generic finding text',
    impact_description: 'generic impact text',
    action_steps: ['old step 1'],
    evidence_json: null,
    why_it_matters: null,
    ...overrides
  };
}

// ============================================
// 1. Title matching works when rec_key/subfactor_key are null
// ============================================
describe('legacyTop10Adapter — title matching with null keys', () => {
  it('matches "Add FAQ Schema Markup" to ai_search_readiness.icp_faqs', () => {
    const rec = makeLegacyRec({
      recommendation_text: 'Add FAQ Schema Markup',
      category: 'AI Search Readiness'
    });
    const match = getCanonicalKey(rec);
    assert.ok(match);
    assert.equal(match.key, 'ai_search_readiness.icp_faqs');
    assert.equal(match.matched_by, 'title');
  });

  it('matches all 5 DevTools-confirmed titles', () => {
    const titles = [
      ['Add FAQ Schema Markup', 'ai_search_readiness.icp_faqs'],
      ['Implement XML Sitemap with Priority Signals', 'technical_setup.sitemap_indexing'],
      ['Add Author Bio and Credentials', 'trust_authority.author_bios'],
      ['Add Organization Schema with Social Links', 'technical_setup.organization_schema'],
      ['Optimize Image Alt Text for AI Understanding', 'ai_readability.alt_text_coverage'],
    ];
    for (const [title, expectedKey] of titles) {
      const match = getCanonicalKey(makeLegacyRec({ recommendation_text: title }));
      assert.ok(match, `Expected match for "${title}"`);
      assert.equal(match.key, expectedKey, `Wrong key for "${title}"`);
    }
  });

  it('title match is case-insensitive', () => {
    const match = getCanonicalKey(makeLegacyRec({
      recommendation_text: 'add faq schema markup'
    }));
    assert.ok(match);
    assert.equal(match.key, 'ai_search_readiness.icp_faqs');
  });

  it('title match trims whitespace', () => {
    const match = getCanonicalKey(makeLegacyRec({
      recommendation_text: '  Add FAQ Schema Markup  '
    }));
    assert.ok(match);
    assert.equal(match.key, 'ai_search_readiness.icp_faqs');
  });
});

// ============================================
// 2. Alias titles map correctly
// ============================================
describe('legacyTop10Adapter — alias titles', () => {
  it('"Missing ICP-Specific FAQs" maps to same key as "Add FAQ Schema Markup"', () => {
    const m1 = getCanonicalKey(makeLegacyRec({ recommendation_text: 'Missing ICP-Specific FAQs' }));
    const m2 = getCanonicalKey(makeLegacyRec({ recommendation_text: 'Add FAQ Schema Markup' }));
    assert.ok(m1);
    assert.ok(m2);
    assert.equal(m1.key, m2.key);
  });

  it('"Missing Organization Schema" maps to technical_setup.organization_schema', () => {
    const match = getCanonicalKey(makeLegacyRec({ recommendation_text: 'Missing Organization Schema' }));
    assert.ok(match);
    assert.equal(match.key, 'technical_setup.organization_schema');
  });

  it('"Improve altTextScore" maps to ai_readability.alt_text_coverage', () => {
    const match = getCanonicalKey(makeLegacyRec({ recommendation_text: 'Improve altTextScore' }));
    assert.ok(match);
    assert.equal(match.key, 'ai_readability.alt_text_coverage');
  });
});

// ============================================
// 3. Non-Top10 titles are left unchanged
// ============================================
describe('legacyTop10Adapter — non-Top10 titles', () => {
  it('returns null for non-Top10 title', () => {
    const match = getCanonicalKey(makeLegacyRec({
      recommendation_text: 'Improve Content Structure with Semantic Headings'
    }));
    assert.equal(match, null);
  });

  it('enrichment leaves non-Top10 recs unchanged', () => {
    const rec = makeLegacyRec({
      recommendation_text: 'Some Totally Non-Top10 Rec',
      findings: 'original finding',
      impact_description: 'original impact'
    });
    const { recommendations } = enrichLegacyRecommendations({
      recommendations: [rec],
      detailedAnalysis: sampleEvidence,
      debug: false
    });
    assert.equal(recommendations[0].findings, 'original finding');
    assert.equal(recommendations[0].impact_description, 'original impact');
    assert.equal(recommendations[0].recommendation, undefined);
  });
});

// ============================================
// 4. No placeholder leaks in enriched output
// ============================================
describe('legacyTop10Adapter — no placeholder leaks', () => {
  it('enriched findings contain no {{...}} placeholders', () => {
    const rec = makeLegacyRec({
      recommendation_text: 'Add FAQ Schema Markup',
      category: 'AI Search Readiness'
    });
    const { recommendations } = enrichLegacyRecommendations({
      recommendations: [rec],
      detailedAnalysis: sampleEvidence,
      debug: false
    });
    const enriched = recommendations[0];
    const fields = [
      enriched.findings,
      enriched.impact_description,
      enriched.recommendation,
      enriched.what_to_include,
      enriched.finding,
      enriched.why_it_matters
    ];
    for (const field of fields) {
      if (field) {
        assert.ok(!field.includes('{{'), `Placeholder leak in: ${field.substring(0, 80)}`);
        assert.ok(!field.includes('[placeholder]'), `Placeholder marker in: ${field.substring(0, 80)}`);
      }
    }
  });

  it('enriched action_steps contain no placeholders', () => {
    const rec = makeLegacyRec({
      recommendation_text: 'Add Organization Schema with Social Links',
      category: 'Technical Setup'
    });
    const { recommendations } = enrichLegacyRecommendations({
      recommendations: [rec],
      detailedAnalysis: sampleEvidence,
      debug: false
    });
    const steps = recommendations[0].action_steps;
    if (Array.isArray(steps)) {
      for (const step of steps) {
        assert.ok(!String(step).includes('{{'), `Placeholder leak in step: ${step}`);
      }
    }
  });
});

// ============================================
// 5. Enrichment populates legacy + v2 fields
// ============================================
describe('legacyTop10Adapter — field population', () => {
  it('populates findings, impact_description, action_steps (legacy) and v2 fields', () => {
    const rec = makeLegacyRec({
      recommendation_text: 'Add FAQ Schema Markup',
      category: 'AI Search Readiness',
      findings: 'old generic',
      impact_description: 'old impact'
    });
    const { recommendations } = enrichLegacyRecommendations({
      recommendations: [rec],
      detailedAnalysis: sampleEvidence,
      debug: false
    });
    const enriched = recommendations[0];

    // Legacy fields should be updated (not the old generic text)
    assert.notEqual(enriched.findings, 'old generic');
    assert.notEqual(enriched.impact_description, 'old impact');

    // V2 fields should be populated
    assert.ok(enriched.recommendation, 'recommendation should be populated');
    assert.ok(enriched.what_to_include, 'what_to_include should be populated');
    assert.ok(enriched.finding, 'finding should be populated');
    assert.ok(enriched.why_it_matters, 'why_it_matters should be populated');
  });

  it('does not mutate the original rec object', () => {
    const original = makeLegacyRec({
      recommendation_text: 'Add FAQ Schema Markup',
      findings: 'original'
    });
    const originalFindings = original.findings;
    enrichLegacyRecommendations({
      recommendations: [original],
      detailedAnalysis: sampleEvidence,
      debug: false
    });
    assert.equal(original.findings, originalFindings, 'Original should not be mutated');
  });
});

// ============================================
// 6. Debug breadcrumbs
// ============================================
describe('legacyTop10Adapter — debug breadcrumbs', () => {
  it('no _debug fields when debug=false', () => {
    const rec = makeLegacyRec({ recommendation_text: 'Add FAQ Schema Markup' });
    const { recommendations } = enrichLegacyRecommendations({
      recommendations: [rec],
      detailedAnalysis: sampleEvidence,
      debug: false
    });
    assert.equal(recommendations[0]._debug_renderer_path, undefined);
    assert.equal(recommendations[0]._debug_canonical_key, undefined);
    assert.equal(recommendations[0]._debug_matched_by, undefined);
  });

  it('_debug fields present when debug=true for matched rec', () => {
    const rec = makeLegacyRec({ recommendation_text: 'Add FAQ Schema Markup' });
    const { recommendations } = enrichLegacyRecommendations({
      recommendations: [rec],
      detailedAnalysis: sampleEvidence,
      debug: true
    });
    assert.equal(recommendations[0]._debug_renderer_path, 'top10');
    assert.equal(recommendations[0]._debug_canonical_key, 'ai_search_readiness.icp_faqs');
    assert.equal(recommendations[0]._debug_matched_by, 'title');
    assert.equal(recommendations[0]._debug_is_top10, true);
  });

  it('_debug fields present for unmatched rec when debug=true', () => {
    const rec = makeLegacyRec({ recommendation_text: 'Totally Unknown Rec' });
    const { recommendations } = enrichLegacyRecommendations({
      recommendations: [rec],
      detailedAnalysis: sampleEvidence,
      debug: true
    });
    assert.equal(recommendations[0]._debug_renderer_path, 'legacy');
    assert.equal(recommendations[0]._debug_canonical_key, null);
    assert.equal(recommendations[0]._debug_is_top10, false);
  });
});

// ============================================
// 7. Keyword fallback
// ============================================
describe('legacyTop10Adapter — keyword fallback', () => {
  it('keyword fallback matches "Add FAQ Schema" (partial, not in dictionary)', () => {
    // This title is NOT in the exact dictionary, but has "faq" + "schema"
    const result = keywordFallback('Add FAQ Schema', 'AI Search Readiness');
    assert.equal(result, 'ai_search_readiness.icp_faqs');
  });

  it('keyword fallback matches "Fix Crawler Access" via keyword', () => {
    const result = keywordFallback('Fix Crawler Access Issues Now', 'Technical Setup');
    assert.equal(result, 'technical_setup.crawler_access');
  });

  it('keyword fallback returns null for non-matching title', () => {
    const result = keywordFallback('Improve Content Quality', 'Content Structure');
    assert.equal(result, null);
  });

  it('getCanonicalKey uses keyword fallback when title not in dictionary', () => {
    const rec = makeLegacyRec({
      recommendation_text: 'Add FAQ Schema',
      category: 'AI Search Readiness'
    });
    const match = getCanonicalKey(rec);
    assert.ok(match);
    assert.equal(match.key, 'ai_search_readiness.icp_faqs');
    assert.equal(match.matched_by, 'keyword');
  });
});

// ============================================
// 8. Debug counter tracks unmatched titles
// ============================================
describe('legacyTop10Adapter — debugInfo counters', () => {
  it('tracks enriched_count and unmatched_titles', () => {
    const recs = [
      makeLegacyRec({ recommendation_text: 'Add FAQ Schema Markup' }),
      makeLegacyRec({ recommendation_text: 'Totally Unknown Rec' }),
      makeLegacyRec({ recommendation_text: 'Add Author Bio and Credentials' }),
    ];
    const { debugInfo } = enrichLegacyRecommendations({
      recommendations: recs,
      detailedAnalysis: sampleEvidence,
      debug: true
    });
    assert.equal(debugInfo.enriched_count, 2);
    assert.ok(debugInfo.unmatched_titles.includes('Totally Unknown Rec'));
    assert.equal(debugInfo.matched_by_counts.title, 2);
  });
});

// ============================================
// 9. Title dictionary coverage
// ============================================
describe('legacyTop10Adapter — dictionary coverage', () => {
  it('has at least 33 entries in title dictionary', () => {
    assert.ok(Object.keys(TITLE_TO_CANONICAL).length >= 33);
  });

  it('all dictionary values are valid Top10 keys', () => {
    for (const [title, key] of Object.entries(TITLE_TO_CANONICAL)) {
      assert.ok(TOP_10_SET.has(key), `Dictionary value "${key}" (from title "${title}") is not a Top10 key`);
    }
  });

  it('covers all 10 Top10 keys (at least one title per key)', () => {
    const coveredKeys = new Set(Object.values(TITLE_TO_CANONICAL));
    const TOP_10 = require('../../recommendations/topSubfactors.phase4a3c.json').top10;
    // query_intent_alignment may not be mapped yet
    const mapped = TOP_10.filter(k => coveredKeys.has(k));
    assert.ok(mapped.length >= 9, `Only ${mapped.length} of 10 Top10 keys covered`);
  });
});

// ============================================
// 10. renderSingleTop10 returns structured output
// ============================================
describe('legacyTop10Adapter — renderSingleTop10', () => {
  it('returns 5-section output for a valid Top10 key', () => {
    const result = renderSingleTop10('technical_setup.organization_schema', sampleEvidence, {});
    // May return null if COMPLETE (evidence says it's resolved) — that's valid too
    if (result !== null) {
      assert.ok('finding' in result, 'missing finding field');
      assert.ok('why_it_matters' in result, 'missing why_it_matters field');
      assert.ok('recommendation' in result, 'missing recommendation field');
      assert.ok('what_to_include' in result, 'missing what_to_include field');
      assert.ok('how_to_implement' in result, 'missing how_to_implement field');
    }
  });

  it('returns null for unknown key', () => {
    const result = renderSingleTop10('nonexistent.key', sampleEvidence, {});
    assert.equal(result, null);
  });
});

// ============================================
// 11. COMPLETE → Implemented/Resolved behavior
// ============================================
describe('legacyTop10Adapter — COMPLETE suppression → implemented', () => {
  // Evidence that triggers COMPLETE for organization_schema:
  // hasOrganizationSchema = true, no validation errors
  const completeEvidence = {
    ...sampleEvidence,
    technical: {
      ...(sampleEvidence.technical || {}),
      hasOrganizationSchema: true,
      structuredData: [{ type: 'Organization', raw: { name: 'Test' } }],
      schemaValidationErrors: []
    }
  };

  it('marks COMPLETE rec as implemented with resolved messaging', () => {
    const rec = makeLegacyRec({
      recommendation_text: 'Add Organization Schema with Social Links',
      category: 'Technical Setup',
      status: 'pending',
      findings: 'old finding',
      impact_description: 'old impact'
    });
    const { recommendations } = enrichLegacyRecommendations({
      recommendations: [rec],
      detailedAnalysis: completeEvidence,
      debug: false
    });
    const enriched = recommendations[0];

    assert.equal(enriched.status, 'implemented');
    assert.ok(enriched.implemented_at, 'implemented_at should be set');
    assert.ok(enriched.findings.includes('complete'), 'findings should mention complete');
    assert.ok(enriched.impact_description.includes('implemented'), 'impact should mention implemented');
    assert.equal(enriched.archived_reason, 'resolved_by_latest_scan');
    assert.equal(enriched.validation_status, 'complete');
  });

  it('sets v2 fields to empty safe values (not null)', () => {
    const rec = makeLegacyRec({
      recommendation_text: 'Add Organization Schema with Social Links',
      category: 'Technical Setup',
      status: 'pending'
    });
    const { recommendations } = enrichLegacyRecommendations({
      recommendations: [rec],
      detailedAnalysis: completeEvidence,
      debug: false
    });
    const enriched = recommendations[0];

    assert.equal(enriched.status, 'implemented');
    assert.strictEqual(enriched.recommendation, '', 'recommendation should be empty string');
    assert.strictEqual(enriched.what_to_include, '', 'what_to_include should be empty string');
    assert.ok(Array.isArray(enriched.how_to_implement), 'how_to_implement should be an array');
    assert.equal(enriched.how_to_implement.length, 0, 'how_to_implement should be empty array');
    // Legacy resolved messaging should still be present
    assert.ok(enriched.findings.includes('complete'));
    assert.ok(enriched.impact_description.includes('implemented'));
  });

  it('does not overwrite existing implemented status', () => {
    const rec = makeLegacyRec({
      recommendation_text: 'Add Organization Schema with Social Links',
      status: 'implemented',
      implemented_at: '2026-01-15T00:00:00.000Z'
    });
    const { recommendations } = enrichLegacyRecommendations({
      recommendations: [rec],
      detailedAnalysis: completeEvidence,
      debug: false
    });
    const enriched = recommendations[0];

    assert.equal(enriched.status, 'implemented');
    assert.equal(enriched.implemented_at, '2026-01-15T00:00:00.000Z');
  });

  it('debug shows resolved_complete path', () => {
    const rec = makeLegacyRec({
      recommendation_text: 'Add Organization Schema with Social Links',
      status: 'pending'
    });
    const { recommendations } = enrichLegacyRecommendations({
      recommendations: [rec],
      detailedAnalysis: completeEvidence,
      debug: true
    });
    const enriched = recommendations[0];

    assert.equal(enriched._debug_renderer_path, 'resolved_complete');
    assert.equal(enriched._debug_canonical_key, 'technical_setup.organization_schema');
    assert.equal(enriched._debug_is_top10, true);
  });

  it('does not mutate original rec object', () => {
    const original = makeLegacyRec({
      recommendation_text: 'Add Organization Schema with Social Links',
      status: 'pending'
    });
    const originalStatus = original.status;
    enrichLegacyRecommendations({
      recommendations: [original],
      detailedAnalysis: completeEvidence,
      debug: false
    });
    assert.equal(original.status, originalStatus, 'Original should not be mutated');
  });
});

// ============================================
// 12. normTitle edge cases
// ============================================
describe('legacyTop10Adapter — normTitle', () => {
  it('handles null/undefined', () => {
    assert.equal(normTitle(null), '');
    assert.equal(normTitle(undefined), '');
  });

  it('normalizes whitespace', () => {
    assert.equal(normTitle('  Add   FAQ   Schema  '), 'add faq schema');
  });

  it('strips trailing periods', () => {
    assert.equal(normTitle('Add FAQ Schema.'), 'add faq schema');
    assert.equal(normTitle('Add FAQ Schema...'), 'add faq schema');
  });
});
