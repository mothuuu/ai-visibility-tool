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

// ---- Text / URL cleanup (Phase 1.2 output polish) ---------------------------

/**
 * Clean a business name derived from a <title>/OG tag (Defect 1): split on
 * common SEO separators (| — – , " - " with surrounding spaces, ::), take the
 * first segment, strip wrapping quotes, trim. A real org name rarely contains
 * these, so an already-clean name is unchanged; a hyphenated name
 * (Mercedes-Benz, Coca-Cola) is preserved because the "-" split requires
 * surrounding spaces. Returns '' when nothing survives.
 */
function cleanBrandName(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  const parts = s
    .split(/\s*\|\s*|\s+[—–]\s+|\s+-\s+|\s*::\s*/)
    .map(p => p.trim())
    .filter(Boolean);
  // parts is empty only when the input was all separators → nothing survives.
  s = parts.length ? parts[0] : '';
  return s.trim();
}

/**
 * Canonical URL form for anchoring @ids (Defect 2): strip trailing slash(es)
 * from the path so `${url}/#fragment` concatenations can't produce `//#`.
 * Query and hash are dropped from the anchor. Falsy/invalid input is returned
 * with only trailing slashes trimmed.
 */
function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch (e) {
    return String(raw || '').replace(/\/+$/, '');
  }
}

/** Collapse any `//#` (double slash before a fragment) left by concatenation. */
function fixFragmentSlashes(s) {
  return s.replace(/\/{2,}#/g, '/#');
}

/**
 * Defensively repair URL-concatenation artifacts in every string of a built
 * JSON-LD object (Defect 2 — belt-and-suspenders on top of normalizeUrl).
 * Mutates in place and returns the node.
 */
function sanitizeUrlsDeep(node) {
  if (typeof node === 'string') return fixFragmentSlashes(node);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = sanitizeUrlsDeep(node[i]);
    return node;
  }
  if (node && typeof node === 'object') {
    for (const k in node) node[k] = sanitizeUrlsDeep(node[k]);
    return node;
  }
  return node;
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
  return { schema_type: schemaType, status, jsonld: scriptTag(sanitizeUrlsDeep(obj)), instructions };
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

// ---- FAQ hygiene (Phase 1.2, Defects 3 & 4) --------------------------------

/** Strip wrapping quotes and leading list enumeration ("1. ", "2) ") from a question. */
function cleanQuestion(q) {
  let s = String(q == null ? '' : q).trim();
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();   // wrapping quotes
  s = s.replace(/^\s*\d+[.)]\s*/, '').trim();            // leading "1." / "2)"
  return s;
}

/** Case/punctuation-insensitive key for de-duplicating questions. */
function normalizeQuestionKey(q) {
  return String(q || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** A "question" that is really a call-to-action, not an informational question. */
function isCtaQuestion(q) {
  return /^(want|ready\s+(to|for)|looking\s+to|need\s+(a|help|to|your)|let'?s|book\b|schedule\b|get\s+started|start\s+your|sign\s+up|request\s+(a|an|your))\b/i
    .test(String(q || '').trim());
}

/** Trust-badge / certification tokens that mark a non-prose answer. */
const BADGE_RE = /\b(8\(a\)|GSA\s*Schedule|WOSB|SDVOSB|HUBZone|CMMI(?:\s*Level\s*\d+)?|SOC\s*2|ISO\s*\d{4,5}|NIST|FedRAMP|CISA|CMMC)\b/gi;

/**
 * An answer that is nav / trust-badge / CTA junk rather than an informational
 * reply (Defect 4). Errs toward dropping — a smaller clean FAQPage beats a
 * larger dirty one, and the free finding still exists.
 */
function isJunkAnswer(a) {
  const text = String(a || '');
  if (!text.trim()) return true;
  // 2+ certification/trust-badge tokens → a badge strip, not prose.
  if ((text.match(BADGE_RE) || []).length >= 2) return true;
  // 3+ consecutive short line-broken fragments → menu/nav dump.
  const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  let run = 0;
  for (const ln of lines) {
    const fragment = ln.length <= 40 && !/[.!?]$/.test(ln);
    run = fragment ? run + 1 : 0;
    if (run >= 3) return true;
  }
  // A short answer that is itself a CTA pitch.
  if (text.length < 200 &&
      /^\s*(request an?|book an?|contact us|get in touch|schedule an?|start your|sign up|call us)\b/i.test(text)) {
    return true;
  }
  return false;
}

/**
 * FAQ {q,a} pairs from real on-page FAQ content, cleaned and de-duplicated
 * (never fabricated):
 *  - strip enumeration/quotes from questions (Defect 3)
 *  - drop CTA "questions" and nav/badge/CTA-junk answers (Defect 4)
 *  - dedupe case-insensitively on the question, keeping the longer answer (Defect 3)
 * The caller omits the FAQPage block when fewer than 2 pairs survive.
 */
function faqPairsFromEvidence(scanEvidence) {
  const faqs = Array.isArray(scanEvidence.content?.faqs) ? scanEvidence.content.faqs : [];
  const byKey = new Map(); // normalized question → {q,a} (longest answer wins)
  for (const f of faqs) {
    const q = cleanQuestion(f && f.question);
    const a = String(f && f.answer || '').trim();
    if (!q || !a) continue;
    if (isCtaQuestion(q)) continue;
    if (isJunkAnswer(a)) continue;
    const key = normalizeQuestionKey(q);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || a.length > existing.a.length) byKey.set(key, { q, a });
  }
  return Array.from(byKey.values()).slice(0, 10);
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
  const rawUrl = scanUrl || ev.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('SCHEMA_GEN: no scan URL available to anchor schema @ids');
  }
  try { new URL(rawUrl); } catch (e) { throw new Error('SCHEMA_GEN: invalid scan URL'); }
  // Canonical, trailing-slash-free form so @id concatenations can't produce `//#`.
  const url = normalizeUrl(rawUrl);

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
  // Clean the org name (Defect 1): a title/OG-derived name carries SEO
  // separators and taglines; take the first clean segment.
  const brand = cleanBrandName(factValue(facts, 'brand'));
  if (!brand) {
    throw new Error('SCHEMA_GEN: insufficient evidence — no business name to build Organization schema');
  }
  // Feed the cleaned brand back so buildCoreJsonLd uses it for all name fields.
  const factsForBuild = facts.map(f => (f && f.name === 'brand') ? { ...f, value: brand } : f);

  const blocks = [];

  // 3) Core Organization / WebSite / WebPage — include only what is MISSING.
  //    buildCoreJsonLd omits any field it has no evidence for (no placeholders).
  const core = buildCoreJsonLd(url, factsForBuild); // [Organization, WebSite, WebPage]
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
  //    Omit unless at least 2 clean FAQs survive hygiene filtering (Defect 4).
  if (!hasFAQ) {
    const pairs = faqPairsFromEvidence(ev);
    if (pairs.length >= 2) {
      const faq = buildFAQJsonLd(url, pairs);
      if (faq) blocks.push(makeBlock('FAQPage', 'missing', faq));
    }
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
  cleanBrandName,
  normalizeUrl,
  sanitizeUrlsDeep,
  cleanQuestion,
  isCtaQuestion,
  isJunkAnswer,
};
