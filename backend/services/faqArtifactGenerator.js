'use strict';

/**
 * faqArtifactGenerator.js — the paid FAQ Pack generator (Build 2, v1).
 *
 * v1 is LIBRARY-ANCHORED: the industry FAQ libraries
 * (phase2_preserved/recommendation-engine/faq-libraries/*.json) are the source
 * of QUESTIONS. Answers are built from each entry's answer_template by resolving
 * its {{placeholders}} against the scan's stored evidence via the entry's
 * extraction_rules; on any failure the entry's generic-true answer_fallback is
 * used instead. NO LLM free-generation of factual specifics.
 *
 * Anti-hallucination constitution:
 *  - A placeholder is filled ONLY from a successful extraction against the scan
 *    evidence; the templated ("extracted") answer is used ONLY when EVERY
 *    placeholder resolves — otherwise the plain generic answer_fallback is used.
 *    (All-or-nothing avoids publishing half-templated claims / "majority%".)
 *  - The library's answer_human_friendly / answer_factual_backend PROSE is never
 *    emitted — it is Xeo Marketing's copy and would be published under the
 *    client's name. Only templates + fallbacks (client-perspective) are used, and
 *    any residual "Xeo"/"Visible2AI" mention or leftover {{placeholder}} makes
 *    the entry unsafe → skipped (or, if it reaches output, throws → rollback).
 *  - Questions come from the library only; extracted evidence feeds placeholder
 *    VALUES, never new questions (never promote extracted headings into Qs).
 *  - < 3 safe questions for the block → throw → the unlock rolls back (not charged).
 *
 * Internally stage-ready: accepts an optional `stage` filter, carries each
 * entry's buyer_stage through selection, and tags every delivered FAQ with its
 * stage. v1 ships one pooled block (stage=null); per-stage blocks are later a
 * config + gate change, not a rebuild.
 */

const { buildFAQJsonLd } = require('../phase2_preserved/recommendation-engine/jsonld');
const { getFAQLibrary } = require('../phase2_preserved/generationHooks');
const { cleanQuestion, isCtaQuestion, dedupeFaqs } = require('../utils/faqHygiene');

const MIN_FAQS = 3;
const MAX_FAQS = 5;

const INSTRUCTIONS =
  'Add this FAQ content to the relevant page, then paste the JSON-LD inside that ' +
  "page's <head>. Google's guideline is ONE FAQPage block per page: if you " +
  'unlock more FAQ content later, merge the new questions into this block\'s ' +
  '"mainEntity" array rather than adding a second FAQPage script. Re-test with ' +
  "Google's Rich Results Test.";

// Generous buyer_stage phrase → funnel bucket (freeform library labels).
function stageBucket(buyerStage) {
  const s = String(buyerStage || '').toLowerCase();
  if (s.includes('awareness')) return 'tofu';
  if (s.includes('decision')) return 'bofu';
  return 'mofu'; // consideration / evaluation / planning / retention / (none)
}

// Text a placeholder can be resolved against: the scan's stored page evidence.
function evidenceText(scanEvidence) {
  const ev = scanEvidence || {};
  const parts = [];
  const m = ev.metadata || {};
  parts.push(m.title, m.description, m.ogTitle, m.ogDescription, m.keywords);
  const h = ev.content?.headings || {};
  for (const level of Object.values(h)) if (Array.isArray(level)) parts.push(level.join(' '));
  if (Array.isArray(ev.content?.paragraphs)) parts.push(ev.content.paragraphs.join(' '));
  if (typeof ev.content?.bodyText === 'string') parts.push(ev.content.bodyText);
  if (Array.isArray(ev.content?.faqs)) {
    parts.push(ev.content.faqs.map(f => `${f && f.question || ''} ${f && f.answer || ''}`).join(' '));
  }
  return parts.filter(Boolean).join(' \n ');
}

// Resolve one placeholder from evidence via its extraction rule. Returns the
// extracted string value, or null on failure (→ triggers fallback).
function resolvePlaceholder(rule, text) {
  if (!rule || typeof rule !== 'object') return null;
  const method = rule.method;
  const hay = text.toLowerCase();

  if (method === 'entity_extraction' || method === 'keyword_scan') {
    const terms = rule.look_for || rule.keywords || [];
    for (const term of terms) {
      if (term && hay.includes(String(term).toLowerCase())) return String(term);
    }
    return null;
  }

  if (method === 'pattern_scan') {
    for (const pat of (rule.patterns || [])) {
      let re;
      try { re = new RegExp(pat, 'i'); } catch (e) { continue; }
      const m = text.match(re);
      if (m) {
        const val = m[1] != null ? m[1] : m[0];
        if (typeof rule.validation === 'string' && /between 1-100/i.test(rule.validation)) {
          const n = Number(val);
          if (!Number.isFinite(n) || n < 1 || n > 100) continue;
        }
        return String(val);
      }
    }
    return null;
  }
  return null;
}

// Build an entry's answer. Returns { answer, resolution } or null if unsafe.
function resolveAnswer(entry, text) {
  const template = typeof entry.answer_template === 'string' ? entry.answer_template : '';
  const fallback = typeof entry.answer_fallback === 'string' ? entry.answer_fallback.trim() : '';

  if (template) {
    const phs = [...template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(m => m[1]);
    const rules = entry.extraction_rules || {};
    let allResolved = phs.length > 0;
    let filled = template;
    for (const ph of phs) {
      const val = resolvePlaceholder(rules[ph], text);
      if (val == null) { allResolved = false; break; }
      filled = filled.replace(new RegExp(`\\{\\{\\s*${ph}\\s*\\}\\}`, 'g'), val);
    }
    if (allResolved && !/\{\{/.test(filled)) {
      return { answer: filled.trim(), resolution: 'extracted' };
    }
  }

  if (fallback) return { answer: fallback, resolution: 'fallback' };
  return null; // no safe answer (no fallback and extraction incomplete)
}

// A published question/answer must be client-safe: no Xeo/Visible2AI branding,
// no unresolved placeholder.
function isSafeText(...vals) {
  for (const v of vals) {
    const s = String(v || '');
    if (/\bxeo\b|visible2ai/i.test(s)) return false;
    if (/\{\{/.test(s)) return false;
  }
  return true;
}

/**
 * Generate the pooled FAQ Pack artifact for a scan.
 *
 * @param {Object} scanEvidence
 * @param {string} scanUrl
 * @param {Object} scan            - scan row (uses .industry to resolve the library)
 * @param {string|null} [stage]    - optional funnel filter ('tofu'|'mofu'|'bofu'); null = pooled
 * @param {Object} [libraryOverride] - inject a library (tests); else getFAQLibrary(scan.industry)
 * @returns {{ stage, faqs, jsonld, instructions, generated_at, source_scan_id }}
 * @throws when fewer than MIN_FAQS safe questions can be built, or JSON invalid.
 */
function generateFaqArtifact(scanEvidence, scanUrl, scan, stage = null, libraryOverride = null) {
  const ev = scanEvidence || {};
  const url = scanUrl || ev.url;
  if (!url || typeof url !== 'string') {
    throw new Error('FAQ_GEN: no scan URL available for the FAQPage @id');
  }

  const industry = (scan && scan.industry) || ev.industry || '';
  const library = libraryOverride || getFAQLibrary(industry);
  const entries = (library && (library.faqs || (library.faq_library && library.faq_library.faqs))) || [];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('FAQ_GEN: no FAQ library available for this industry');
  }

  const text = evidenceText(ev);

  // Build safe candidates (question + resolved answer), optionally stage-filtered.
  const candidates = [];
  for (const entry of entries) {
    const buyerStage = (entry.implementation_notes && entry.implementation_notes.buyer_stage) || entry.buyer_stage || '';
    const bucket = stageBucket(buyerStage);
    if (stage && bucket !== stage) continue;

    const question = cleanQuestion(entry.question);
    if (!question || isCtaQuestion(question)) continue;

    const resolved = resolveAnswer(entry, text);
    if (!resolved || !resolved.answer) continue;
    if (!isSafeText(question, resolved.answer)) continue; // never publish Xeo copy / leaks

    candidates.push({
      question,
      answer: resolved.answer,
      resolution: resolved.resolution,
      buyer_stage: buyerStage,
      stage: bucket,
      source: 'library',
      _priority: entry.priority === 'critical' ? 0 : entry.priority === 'high' ? 1 : 2,
      _found: Number(entry.found_on_percent) || 0,
    });
  }

  // Rank: prefer factually-resolved (extracted) answers, then priority, then prevalence.
  candidates.sort((a, b) => {
    if ((a.resolution === 'extracted') !== (b.resolution === 'extracted')) {
      return a.resolution === 'extracted' ? -1 : 1;
    }
    if (a._priority !== b._priority) return a._priority - b._priority;
    return b._found - a._found;
  });

  // Dedupe within the block, then take up to MAX.
  const deduped = dedupeFaqs(candidates).slice(0, MAX_FAQS);

  if (deduped.length < MIN_FAQS) {
    throw new Error(
      `FAQ_GEN: insufficient safe FAQ coverage for ${stage || 'pooled'} ` +
      `(have ${deduped.length}, need ${MIN_FAQS})`
    );
  }

  // FAQPage JSON-LD for the delivered questions.
  const faqObj = buildFAQJsonLd(url, deduped.map(f => ({ q: f.question, a: f.answer })));
  if (!faqObj) throw new Error('FAQ_GEN: could not build FAQPage JSON-LD');
  const jsonld = `<script type="application/ld+json">${JSON.stringify(faqObj)}</script>`;
  // Validate the inner JSON (parse failure → throw → rollback).
  JSON.parse(jsonld.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));

  return {
    stage: stage || 'pooled',
    faqs: deduped.map(f => ({
      question: f.question,
      answer: f.answer,
      resolution: f.resolution, // 'extracted' | 'fallback'
      buyer_stage: f.buyer_stage,
      stage: f.stage,
    })),
    jsonld,
    instructions: INSTRUCTIONS,
    generated_at: new Date().toISOString(),
    source_scan_id: scan && scan.id != null ? scan.id : null,
  };
}

module.exports = {
  generateFaqArtifact,
  // exported for unit tests
  stageBucket,
  evidenceText,
  resolvePlaceholder,
  resolveAnswer,
  isSafeText,
};
