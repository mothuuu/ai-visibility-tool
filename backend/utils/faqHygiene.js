'use strict';

/**
 * faqHygiene.js — text-level cleanup for extracted FAQ Q&A pairs.
 *
 * Used by content-extractor's extractFAQs (Phase 2.5) to keep content.faqs[]
 * clean, since that array feeds BOTH the paid FAQ product AND faqCount (which
 * drives the icp_faqs detector + the rubric faqContent factor).
 *
 * The same rules already exist inline in services/schemaArtifactGenerator.js
 * (Phase 1.2), where they remain as artifact-side defense-in-depth. They are
 * mirrored here (not shared from there) because generators are out of scope for
 * this change; consolidate the two copies in a later pass.
 */

// Nodes whose text is navigation / trust-badge / CTA chrome, not answer prose.
// Used by the extractor to STOP answer accumulation before it swallows a badge
// strip or CTA button (the scan-789 bleed). Exported as a selector string so the
// cheerio-side check lives with the DOM code.
const NON_PROSE_SELECTOR =
  'button, nav, footer, aside, header, form, [role="button"], [role="navigation"], ' +
  '[class*="badge" i], [class*="cert" i], [class*="logo" i], [class*="cta" i], ' +
  '[class*="btn" i], [class*="nav" i], [class*="footer" i], [class*="social" i], ' +
  '[class*="menu" i], [class*="cookie" i]';

/** Strip wrapping quotes and leading list enumeration ("1. ", "2) ") from a question. */
function cleanQuestion(q) {
  let s = String(q == null ? '' : q).trim();
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();   // wrapping quotes
  s = s.replace(/^\s*\d+[.)]\s*/, '').trim();            // leading "1." / "2)"
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();   // quotes that wrapped the number
  return s;
}

/**
 * Case/punctuation-insensitive dedup key. Strips punctuation, collapses
 * whitespace, lowercases. NO truncation (the old 50-char cut let long distinct
 * questions collide and, combined with kept enumeration digits, let numbered
 * and plain variants of the SAME question miss each other).
 */
function normalizeQuestionKey(q) {
  return cleanQuestion(q).toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** A "question" that is really a call-to-action, not an informational question. */
function isCtaQuestion(q) {
  return /^(want|ready\s+(to|for)|looking\s+(to|for)|interested\b|need\s+(a|help|to|your)|let'?s|book\b|schedule\b|get\s+started|start\s+your|sign\s+up|request\s+(a|an|your))\b/i
    .test(String(q || '').trim());
}

/** Trust-badge / certification tokens that mark a non-prose answer. */
const BADGE_RE = /\b(8\(a\)|GSA\s*Schedule|WOSB|SDVOSB|HUBZone|CMMI(?:\s*Level\s*\d+)?|SOC\s*2|ISO\s*\d{4,5}|NIST|FedRAMP|CISA|CMMC)\b/gi;

/**
 * An answer that is nav / trust-badge / CTA junk rather than an informational
 * reply. Errs toward dropping — an entry lost from evidence is recoverable; a
 * CTA/badge strip published as an FAQ is not.
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

// Sources with explicit FAQ provenance — trusted even without interrogative form
// (schema mainEntity, <details>/<summary>, <dt> re-tagged to 'details', and
// aria accordions). Non-explicit html/section/heading candidates must look like
// a question (Phase 2.5.1 question-form filter — kills section titles such as
// "Frequently Asked Questions").
const EXPLICIT_FAQ_SOURCES = new Set(['schema', 'details', 'aria']);

/**
 * Does the text read as a question — ends with '?' or opens with an
 * interrogative/auxiliary word? Used to reject non-question section titles from
 * the non-explicit extraction methods.
 */
function isInterrogative(q) {
  const s = String(q || '').trim();
  if (!s) return false;
  if (s.endsWith('?')) return true;
  return /^(what|how|why|when|where|who|which|whose|whom|can|could|do|does|did|is|are|was|were|should|will|would|may|might|shall|has|have|had|am)\b/i.test(s);
}

/**
 * De-duplicate FAQ entries on the normalized question (Phase 2.5 rule, shared so
 * per-page AND site-level aggregation use ONE pass). On collision: keep the
 * authoritative schema source; otherwise the longer (more complete) answer.
 * First-seen key order is preserved. Entries are assumed already cleaned.
 */
function dedupeFaqs(faqs) {
  const preferKept = (a, b) => {
    const aSchema = a.source === 'schema', bSchema = b.source === 'schema';
    if (aSchema !== bSchema) return aSchema ? a : b;                 // schema is authoritative
    return String(b.answer || '').length > String(a.answer || '').length ? b : a; // else longer answer
  };
  const byKey = new Map();
  for (const faq of (Array.isArray(faqs) ? faqs : [])) {
    if (!faq || !faq.question) continue;
    const key = normalizeQuestionKey(faq.question);
    if (key.length <= 5) continue;
    const cur = byKey.get(key);
    byKey.set(key, cur ? preferKept(cur, faq) : faq);
  }
  return Array.from(byKey.values());
}

module.exports = {
  NON_PROSE_SELECTOR,
  EXPLICIT_FAQ_SOURCES,
  cleanQuestion,
  normalizeQuestionKey,
  isCtaQuestion,
  isJunkAnswer,
  isInterrogative,
  dedupeFaqs,
  BADGE_RE,
};
