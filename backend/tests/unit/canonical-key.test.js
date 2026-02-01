/**
 * Tests for canonical key normalization (Phase 4A.3c)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getCanonicalKey, isTop10, normalizePillarKey } = require('../../recommendations/canonicalKey');

describe('canonicalKey — getCanonicalKey()', () => {
  // Rule 1: subfactor_key exact match
  it('exact subfactor_key match returns canonical key', () => {
    const rec = { subfactor_key: 'technical_setup.organization_schema' };
    assert.equal(getCanonicalKey(rec), 'technical_setup.organization_schema');
  });

  it('all 10 Top 10 keys match via subfactor_key', () => {
    const top10 = require('../../recommendations/topSubfactors.phase4a3c.json').top10;
    for (const key of top10) {
      assert.equal(getCanonicalKey({ subfactor_key: key }), key);
    }
  });

  // Rule 2: rec_key with ::scanId suffix
  it('rec_key with ::scanId suffix matches', () => {
    const rec = { rec_key: 'ai_readability.alt_text_coverage::scan_684' };
    assert.equal(getCanonicalKey(rec), 'ai_readability.alt_text_coverage');
  });

  it('rec_key exact match (no suffix) works', () => {
    const rec = { rec_key: 'trust_authority.author_bios' };
    assert.equal(getCanonicalKey(rec), 'trust_authority.author_bios');
  });

  // Rule 3: Constructed pillar + subfactor suffix
  it('constructed match from pillar_key + subfactor suffix', () => {
    const rec = { pillar_key: 'technical_setup', subfactor_key: 'crawler_access' };
    assert.equal(getCanonicalKey(rec), 'technical_setup.crawler_access');
  });

  it('constructed match from display name pillar', () => {
    const rec = { pillar: 'AI Search Readiness', subfactor_key: 'icp_faqs' };
    assert.equal(getCanonicalKey(rec), 'ai_search_readiness.icp_faqs');
  });

  it('constructed match from category field', () => {
    const rec = { category: 'trust_authority', subfactor_key: 'author_bios' };
    assert.equal(getCanonicalKey(rec), 'trust_authority.author_bios');
  });

  // Rule 4: Unique suffix match
  it('unique suffix match works for unambiguous suffixes', () => {
    const rec = { subfactor_key: 'organization_schema' };
    assert.equal(getCanonicalKey(rec), 'technical_setup.organization_schema');
  });

  // Negative cases
  it('returns null for non-Top10 subfactor_key', () => {
    const rec = { subfactor_key: 'content_freshness.update_frequency' };
    assert.equal(getCanonicalKey(rec), null);
  });

  it('returns null for null rec', () => {
    assert.equal(getCanonicalKey(null), null);
  });

  it('returns null for empty rec', () => {
    assert.equal(getCanonicalKey({}), null);
  });

  it('returns null for rec with only irrelevant fields', () => {
    const rec = { title: 'Some rec', priority: 'high' };
    assert.equal(getCanonicalKey(rec), null);
  });
});

describe('canonicalKey — isTop10()', () => {
  it('returns true for Top 10 rec', () => {
    assert.equal(isTop10({ subfactor_key: 'technical_setup.sitemap_indexing' }), true);
  });

  it('returns false for non-Top10 rec', () => {
    assert.equal(isTop10({ subfactor_key: 'speed_ux.page_load_time' }), false);
  });

  it('returns false for null', () => {
    assert.equal(isTop10(null), false);
  });
});

describe('canonicalKey — normalizePillarKey()', () => {
  it('converts display name to snake_case', () => {
    assert.equal(normalizePillarKey('Technical Setup'), 'technical_setup');
    assert.equal(normalizePillarKey('AI Search Readiness'), 'ai_search_readiness');
    assert.equal(normalizePillarKey('Trust Authority'), 'trust_authority');
    assert.equal(normalizePillarKey('AI Readability'), 'ai_readability');
  });

  it('returns snake_case input unchanged', () => {
    assert.equal(normalizePillarKey('technical_setup'), 'technical_setup');
  });

  it('handles empty/null input', () => {
    assert.equal(normalizePillarKey(''), '');
    assert.equal(normalizePillarKey(null), '');
  });
});
