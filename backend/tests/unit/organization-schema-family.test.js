/**
 * Phase 0.5: Organization schema subtype-blindness fix.
 *
 * Proves the corrected Organization-family match across the four fixtures from
 * the task, exercised through BOTH real code paths that feed the detector:
 *   - content-extractor.js extractTechnical() → technical.hasOrganizationSchema
 *   - evidenceHelpers.js hasOrganizationSchema() fallback (re-verify from stored
 *     structuredData[].raw, the shape used for historical scans)
 *
 * Fixture 4 (no org-family type) must stay FALSE — the detector must still fire
 * on genuinely missing schema.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

const {
  isOrgFamilyType, anyOrgFamilyInTypes, rawJsonLdHasOrgFamily,
} = require('../../analyzers/schemaFamilies');
const { ContentExtractor } = require('../../analyzers/content-extractor');
const { hasOrganizationSchema } = require('../../phase2_preserved/evidenceHelpers');

// Build a minimal HTML doc embedding the given JSON-LD objects as separate
// <script type="application/ld+json"> blocks. No indexnow-key meta → no network.
function htmlWithJsonLd(blocks) {
  const scripts = blocks
    .map(b => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
    .join('\n');
  return `<!doctype html><html><head>${scripts}</head><body><h1>Test</h1></body></html>`;
}

// Run the REAL extractor over the HTML and return technical.hasOrganizationSchema.
async function extractOrgFlag(blocks) {
  const html = htmlWithJsonLd(blocks);
  const $ = cheerio.load(html);
  const extractor = new ContentExtractor('https://example.com', {});
  const technical = await extractor.extractTechnical($, { html, headers: {} });
  return technical.hasOrganizationSchema;
}

// Build the stored-evidence shape a historical scan persists: structuredData
// entries carry a top-level `type` (often null on @graph blocks) plus `raw`.
// Deliberately omit technical.hasOrganizationSchema so the FALLBACK is tested.
function evidenceFromBlocks(blocks) {
  const structuredData = [];
  for (const b of blocks) {
    if (b['@graph'] && Array.isArray(b['@graph'])) {
      b['@graph'].forEach(item => {
        let t = item['@type'] || 'Unknown';
        if (Array.isArray(t)) t = t[0];
        structuredData.push({ type: t, raw: item, source: 'json-ld-graph' });
      });
    } else {
      let t = b['@type'] || 'Unknown';
      if (Array.isArray(t)) t = t[0];
      structuredData.push({ type: t, raw: b, source: 'json-ld' });
    }
  }
  return { technical: { structuredData } };
}

// ---- The four fixtures --------------------------------------------------------
const FIX = {
  topLevelOrg: [{ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' }],
  // Goldwynn shape: @graph-wrapped, NO top-level @type on the script object
  graphOrg: [{
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'Site' },
      { '@type': 'Organization', name: 'Acme' },
    ],
  }],
  subtypeOnly: [
    { '@context': 'https://schema.org', '@type': 'ProfessionalService', name: 'Safe Arbor' },
    { '@context': 'https://schema.org', '@type': ['RealEstateAgent', 'Place'], name: 'Realty' },
  ],
  noOrg: [
    { '@context': 'https://schema.org', '@type': 'Article', headline: 'Post' },
    { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Page' },
  ],
};

describe('Phase 0.5: ORGANIZATION_SCHEMA_FAMILY matcher', () => {
  it('isOrgFamilyType: string, array, and negatives', () => {
    assert.equal(isOrgFamilyType('Organization'), true);
    assert.equal(isOrgFamilyType('RealEstateAgent'), true);
    assert.equal(isOrgFamilyType(['RealEstateAgent', 'Place']), true);
    assert.equal(isOrgFamilyType(['Place', 'Corporation']), true); // org not first
    assert.equal(isOrgFamilyType('Article'), false);
    assert.equal(isOrgFamilyType(['Article', 'WebPage']), false);
    assert.equal(isOrgFamilyType(null), false);
    assert.equal(isOrgFamilyType(undefined), false);
  });

  it('anyOrgFamilyInTypes: Set from recursive type extraction', () => {
    assert.equal(anyOrgFamilyInTypes(new Set(['WebSite', 'Organization'])), true);
    assert.equal(anyOrgFamilyInTypes(new Set(['LocalBusiness'])), true);
    assert.equal(anyOrgFamilyInTypes(new Set(['Article', 'WebPage'])), false);
    assert.equal(anyOrgFamilyInTypes(new Set()), false);
    assert.equal(anyOrgFamilyInTypes(null), false);
  });

  it('rawJsonLdHasOrgFamily: recurses @graph / nested / @type arrays; never throws', () => {
    assert.equal(rawJsonLdHasOrgFamily(FIX.graphOrg[0]), true);
    assert.equal(rawJsonLdHasOrgFamily(FIX.subtypeOnly[1]), true);
    assert.equal(rawJsonLdHasOrgFamily(FIX.noOrg[0]), false);
    assert.equal(rawJsonLdHasOrgFamily(null), false);
    assert.equal(rawJsonLdHasOrgFamily('not-an-object'), false);
  });
});

describe('Phase 0.5: extractor path (content-extractor → hasOrganizationSchema flag)', () => {
  it('Fixture 1: top-level Organization → true', async () => {
    assert.equal(await extractOrgFlag(FIX.topLevelOrg), true);
  });
  it('Fixture 2: @graph-wrapped Organization, no top-level @type → true (regression guard, scan 922)', async () => {
    assert.equal(await extractOrgFlag(FIX.graphOrg), true);
  });
  it('Fixture 3: subtype-only (ProfessionalService, [RealEstateAgent,Place]) → true (the fix)', async () => {
    assert.equal(await extractOrgFlag(FIX.subtypeOnly), true);
  });
  it('Fixture 4: no org-family type (Article + WebPage) → false (still detects missing)', async () => {
    assert.equal(await extractOrgFlag(FIX.noOrg), false);
  });
});

describe('Phase 0.5: evidence fallback path (evidenceHelpers.hasOrganizationSchema, flag absent)', () => {
  it('Fixture 1: top-level Organization → true', () => {
    assert.equal(hasOrganizationSchema(evidenceFromBlocks(FIX.topLevelOrg)), true);
  });
  it('Fixture 2: @graph-wrapped (stored type null on script) → true via raw recursion', () => {
    const ev = evidenceFromBlocks(FIX.graphOrg);
    assert.equal(hasOrganizationSchema(ev), true);
  });
  it('Fixture 3: subtype-only → true', () => {
    assert.equal(hasOrganizationSchema(evidenceFromBlocks(FIX.subtypeOnly)), true);
  });
  it('Fixture 4: no org-family type → false', () => {
    assert.equal(hasOrganizationSchema(evidenceFromBlocks(FIX.noOrg)), false);
  });
  it('malformed raw string is skipped, not thrown', () => {
    const ev = { technical: { structuredData: [{ type: null, raw: '{bad json' }] } };
    assert.doesNotThrow(() => hasOrganizationSchema(ev));
    assert.equal(hasOrganizationSchema(ev), false);
  });
  it('primary flag still honored when true', () => {
    assert.equal(hasOrganizationSchema({ technical: { hasOrganizationSchema: true } }), true);
  });
});
