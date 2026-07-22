'use strict';

/**
 * schemaArtifactGenerator.js — the schema (JSON-LD) generator for the paid
 * recommendation layer. Adapter over existing evidence + JSON-LD builders.
 *
 * Contract:
 *  - Determines what schema EXISTS by parsing scanEvidence.technical
 *    .structuredData[].raw with the schemaFamilies matchers (recurses @graph,
 *    handles @type arrays, tolerates null top-level `type`, skips malformed
 *    blocks). Never keys off the `hasOrganizationSchema` boolean alone, never
 *    off structuredData[].type (top-level type is often null on @graph sites).
 *  - Generates ONLY what is applicable AND missing (Organization/WebSite/WebPage
 *    core, FAQPage when the page has FAQ content, BreadcrumbList when the scanned
 *    URL has a real path). An "enhancement" block replaces a thin existing block.
 *  - Anti-hallucination: every field is evidence-backed. No value with no
 *    evidence is invented or placeholder-filled. The fabricated "/logo.png" and
 *    guessed social links from the legacy hooks are stripped.
 *  - Throws (→ caller rolls back the token spend) when evidence is too thin to
 *    build even a minimal Organization block, or when nothing is missing.
 *  - Every block's inner JSON is validated with JSON.parse before returning.
 */

const { extractSiteFacts } = require('../phase2_preserved/recommendation-engine/fact-extractor');
const { buildCoreJsonLd, buildFAQJsonLd } = require('../phase2_preserved/recommendation-engine/jsonld');
const { anyOrgFamilyInTypes, isOrgFamilyType, collectSchemaTypes } = require('../analyzers/schemaFamilies');

const HEAD_INSTRUCTIONS =
  'Paste this inside the <head> section of every page (or your site-wide header ' +
  "template). If you use WordPress, add it via your theme's header.php or a " +
  "header-scripts plugin. Then re-test with Google's Rich Results Test.";

function scriptTag(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

function factValue(facts, name, fallback) {
  const f = (facts || []).find(x => x && x.name === name);
  return f ? f.value : fallback;
}

/**
 * Strip fabricated/guessed values before they reach the JSON-LD builder.
 * extractLogo emits a "/logo.png" guess (source 'fallback', confidence 'low');
 * that must never be published. The domain-derived `brand` is LOW confidence but
 * is a real derivation of the actual URL, so it is kept.
 */
function sanitizeFacts(facts) {
  return (facts || [])
    .filter(f => f && f.name)
    .filter(f => {
      if (f.name === 'logo' && (f.source === 'fallback' || f.confidence === 'low')) return false;
      return true;
    });
}

function makeBlock(schemaType, status, obj) {
  const instructions = status === 'enhancement'
    ? `This REPLACES your existing ${schemaType} block (do not add a second one). ${HEAD_INSTRUCTIONS}`
    : HEAD_INSTRUCTIONS;
  return { schema_type: schemaType, status, jsonld: scriptTag(obj), instructions };
}

/** Recursively find the first Organization-family node in a parsed JSON-LD value. */
function findOrgFamilyNode(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findOrgFamilyNode(item);
      if (found) return found;
    }
    return null;
  }
  if (isOrgFamilyType(obj['@type'])) return obj;
  for (const key in obj) {
    if (key === '@type') continue;
    const val = obj[key];
    if (val && typeof val === 'object') {
      const found = findOrgFamilyNode(val);
      if (found) return found;
    }
  }
  return null;
}

/** Parse each structuredData[].raw safely and hand it to `fn`. */
function forEachRaw(structuredData, fn) {
  for (const entry of structuredData) {
    if (!entry || typeof entry !== 'object') continue;
    let raw = entry.raw;
    if (raw == null) continue;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (e) { continue; } // skip malformed, never throw
    }
    fn(raw);
  }
}

/** Does an existing Organization-family node already carry a non-empty `key`? */
function orgFamilyNodeHasKey(structuredData, key) {
  let has = false;
  forEachRaw(structuredData, raw => {
    if (has) return;
    const node = findOrgFamilyNode(raw);
    if (node && node[key] != null && (!Array.isArray(node[key]) || node[key].length > 0)) has = true;
  });
  return has;
}

/** FAQ {q,a} pairs from real on-page FAQ content (never fabricated). */
function faqPairsFromEvidence(scanEvidence) {
  const faqs = Array.isArray(scanEvidence.content?.faqs) ? scanEvidence.content.faqs : [];
  return faqs
    .map(f => ({ q: String(f && f.question || '').trim(), a: String(f && f.answer || '').trim() }))
    .filter(p => p.q && p.a)
    .slice(0, 10);
}

function humanizeSegment(seg) {
  let s = seg;
  try { s = decodeURIComponent(seg); } catch (e) { /* keep raw */ }
  s = s.replace(/\.(html?|php|aspx?)$/i, '').replace(/[-_]+/g, ' ').trim();
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * BreadcrumbList from the scanned URL's real path (Home > Segment > …). Labels
 * are derived from the actual path segments — evidence-backed, not invented.
 * Returns null for root/homepage URLs (no meaningful trail).
 */
function buildBreadcrumbFromUrl(url, brand) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length < 1) return null;
  const items = [{ name: (brand && String(brand).trim()) || 'Home', item: `${u.origin}/` }];
  let acc = u.origin;
  for (const seg of segs) {
    acc += `/${seg}`;
    items.push({ name: humanizeSegment(seg), item: acc });
  }
  if (items.length < 2) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1, name: it.name, item: it.item,
    })),
  };
}

/**
 * Generate the persisted schema artifact for a scan.
 *
 * @param {Object} scanEvidence - detailed_analysis.scanEvidence
 * @param {string} scanUrl      - the scan's URL (anchors @ids)
 * @param {number|null} [scanId] - stamped onto the artifact for provenance
 * @returns {{ blocks: Array, generated_at: string, source_scan_id: number|null }}
 * @throws when evidence is too thin, or nothing applicable is missing.
 */
function generateSchemaArtifact(scanEvidence, scanUrl, scanId = null) {
  const ev = scanEvidence || {};
  const url = scanUrl || ev.url;
  if (!url || typeof url !== 'string') {
    throw new Error('SCHEMA_GEN: no scan URL available to anchor schema @ids');
  }
  try { new URL(url); } catch (e) { throw new Error('SCHEMA_GEN: invalid scan URL'); }

  // 1) What EXISTS — from raw JSON-LD, subtype/@graph aware.
  const structuredData = Array.isArray(ev.technical?.structuredData) ? ev.technical.structuredData : [];
  const existing = new Set();
  forEachRaw(structuredData, raw => collectSchemaTypes(raw, existing));
  const hasOrg = anyOrgFamilyInTypes(existing);
  const hasWebSite = existing.has('WebSite');
  const hasWebPage = existing.has('WebPage');
  const hasFAQ = existing.has('FAQPage');
  const hasBreadcrumb = existing.has('BreadcrumbList');

  // 2) Evidence facts (strip fabricated logo/guesses).
  const facts = sanitizeFacts(extractSiteFacts(ev).extracted_facts);
  const brand = factValue(facts, 'brand');
  if (!brand || !String(brand).trim()) {
    throw new Error('SCHEMA_GEN: insufficient evidence — no business name to build Organization schema');
  }

  const blocks = [];

  // 3) Core Organization / WebSite / WebPage — include only what is MISSING.
  //    buildCoreJsonLd omits any field it has no evidence for (no placeholders).
  const core = buildCoreJsonLd(url, facts); // [Organization, WebSite, WebPage]
  const [orgBlock, siteBlock, pageBlock] = core;
  if (!hasOrg) blocks.push(makeBlock('Organization', 'missing', orgBlock));
  else {
    // Enhancement: Organization present but has no sameAs, and we have real
    // social links from evidence — offer a richer replacement block.
    const socials = factValue(facts, 'social_links', []);
    if (Array.isArray(socials) && socials.length && !orgFamilyNodeHasKey(structuredData, 'sameAs')) {
      blocks.push(makeBlock(orgBlock['@type'], 'enhancement', orgBlock));
    }
  }
  if (!hasWebSite) blocks.push(makeBlock('WebSite', 'missing', siteBlock));
  if (!hasWebPage) blocks.push(makeBlock('WebPage', 'missing', pageBlock));

  // 4) FAQPage — only when the page has real FAQ content and no FAQ schema.
  if (!hasFAQ) {
    const faq = buildFAQJsonLd(url, faqPairsFromEvidence(ev));
    if (faq) blocks.push(makeBlock('FAQPage', 'missing', faq));
  }

  // 5) BreadcrumbList — only when the scanned URL has a real path and none exists.
  if (!hasBreadcrumb) {
    const bc = buildBreadcrumbFromUrl(url, brand);
    if (bc) blocks.push(makeBlock('BreadcrumbList', 'missing', bc));
  }

  if (blocks.length === 0) {
    throw new Error('SCHEMA_GEN: nothing to generate — all applicable schema already present');
  }

  // Validate every block's inner JSON before persisting (parse failure → throw → rollback).
  for (const b of blocks) {
    const inner = b.jsonld.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    JSON.parse(inner);
  }

  return {
    blocks,
    generated_at: new Date().toISOString(),
    source_scan_id: scanId != null ? scanId : null,
  };
}

module.exports = {
  generateSchemaArtifact,
  // exported for unit tests
  sanitizeFacts,
  buildBreadcrumbFromUrl,
  faqPairsFromEvidence,
  findOrgFamilyNode,
  orgFamilyNodeHasKey,
};
