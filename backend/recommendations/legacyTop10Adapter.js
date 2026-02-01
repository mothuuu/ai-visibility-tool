/**
 * GET-time Legacy Top 10 Adapter
 * File: backend/recommendations/legacyTop10Adapter.js
 *
 * Phase 4A.3c: Enriches legacy recommendation rows at GET time by:
 * 1. Matching recommendation_text titles to Top10 canonical keys
 * 2. Running the Phase 4A.3c renderer (template resolution + detection state)
 * 3. Writing output into BOTH legacy fields (instant UI fix) AND v2 fields
 *
 * This adapter exists because existing DB rows have null rec_key/subfactor_key,
 * so canonical key matching from the previous approach always fails.
 * Title-based matching is the only reliable strategy for existing data.
 */

const { getPlaybookEntry } = require('./subfactorPlaybookMap');
const { buildEvidenceContext } = require('./evidenceHelpers');
const { buildPlaceholderContext } = require('./renderer');
const { resolveTemplate, resolveTemplateArray } = require('./placeholderResolver');
const { getDetectionState, hasDetectionFunction, shouldSuppressRecommendation } = require('./detectionStates.top10');
const TOP_10_SUBFACTORS = require('./topSubfactors.phase4a3c.json').top10;
const TOP_10_SET = new Set(TOP_10_SUBFACTORS);

// ============================================
// TITLE NORMALIZATION
// ============================================

function normTitle(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.]+$/g, '');
}

// ============================================
// TITLE DICTIONARY (33 entries, verified from production DB)
// ============================================

const RAW_TITLE_TO_CANONICAL = {
  // 5 confirmed from DevTools scans 693/694
  'Add FAQ Schema Markup': 'ai_search_readiness.icp_faqs',
  'Implement XML Sitemap with Priority Signals': 'technical_setup.sitemap_indexing',
  'Add Author Bio and Credentials': 'trust_authority.author_bios',
  'Add Organization Schema with Social Links': 'technical_setup.organization_schema',
  'Optimize Image Alt Text for AI Understanding': 'ai_readability.alt_text_coverage',

  // 4 newly matched from full DB title audit
  'Add Open Graph & Twitter Card meta tags': 'technical_setup.social_meta_tags',
  'Weak Evidence & Proof Points': 'ai_search_readiness.evidence_proof_points',
  'Crawler Access Issues': 'technical_setup.crawler_access',
  'Limited Structured Data Coverage': 'technical_setup.structured_data_coverage',

  // Aliases: same Top10 key, different title phrasing
  'Add FAQ Structured Data': 'ai_search_readiness.icp_faqs',
  'Missing ICP-Specific FAQs': 'ai_search_readiness.icp_faqs',
  'Improve faqScore': 'ai_search_readiness.icp_faqs',
  'Improve faq Schema': 'ai_search_readiness.icp_faqs',
  'Missing or Incomplete Sitemap': 'technical_setup.sitemap_indexing',
  'Optimize XML Sitemap': 'technical_setup.sitemap_indexing',
  'Improve sitemapScore': 'technical_setup.sitemap_indexing',
  'Add Comprehensive Author Profiles': 'trust_authority.author_bios',
  'Missing Author & Team Credentials': 'trust_authority.author_bios',
  'Add Organization + WebSite + WebPage schema': 'technical_setup.organization_schema',
  'Missing Organization Schema': 'technical_setup.organization_schema',
  'Improve altTextScore': 'ai_readability.alt_text_coverage',
  'Incomplete Image Alt Text': 'ai_readability.alt_text_coverage',
  'AI Readability: Image Alt Text': 'ai_readability.alt_text_coverage',
  'AI Readability: altTextScore': 'ai_readability.alt_text_coverage',
  'Improve openGraphScore': 'technical_setup.social_meta_tags',
  'Technical Setup: Open Graph & Social Meta Tags': 'technical_setup.social_meta_tags',
  'Improve painPointsScore': 'ai_search_readiness.evidence_proof_points',
  'Improve crawlerAccessScore': 'technical_setup.crawler_access',
  'Technical Setup: crawlerAccessScore': 'technical_setup.crawler_access',
  'Implement Structured Data': 'technical_setup.structured_data_coverage',
  'Implement Structured Data Schema': 'technical_setup.structured_data_coverage',
  'Improve structuredDataScore': 'technical_setup.structured_data_coverage',
  'Technical Setup: Schema Markup': 'technical_setup.structured_data_coverage',
};

// Build normalized lookup
const TITLE_TO_CANONICAL = Object.fromEntries(
  Object.entries(RAW_TITLE_TO_CANONICAL).map(([k, v]) => [normTitle(k), v])
);

// ============================================
// KEYWORD FALLBACK (Conservative — Low Collision Risk Only)
// ============================================

function keywordFallback(title, category) {
  const t = (title || '').toLowerCase();
  const c = (category || '').toLowerCase();
  if (t.includes('faq') && t.includes('schema')) return 'ai_search_readiness.icp_faqs';
  if (t.includes('sitemap') && t.includes('xml')) return 'technical_setup.sitemap_indexing';
  if (t.includes('author') && (t.includes('bio') || t.includes('credentials'))) return 'trust_authority.author_bios';
  if (t.includes('organization') && t.includes('schema')) return 'technical_setup.organization_schema';
  if (t.includes('alt') && t.includes('text') && c.includes('readability')) return 'ai_readability.alt_text_coverage';
  if (t.includes('open graph') || t.includes('twitter card')) return 'technical_setup.social_meta_tags';
  if (c.includes('ai search') && (t.includes('proof') || t.includes('evidence'))) return 'ai_search_readiness.evidence_proof_points';
  if (t.includes('crawler') && t.includes('access')) return 'technical_setup.crawler_access';
  if (t.includes('structured data') && (t.includes('coverage') || t.includes('limited'))) return 'technical_setup.structured_data_coverage';
  return null;
}

// ============================================
// KEY RESOLUTION
// ============================================

function getCanonicalKey(rec) {
  // Strategy 1: Exact title match (normalized)
  const titleKey = TITLE_TO_CANONICAL[normTitle(rec.recommendation_text)];
  if (titleKey) return { key: titleKey, matched_by: 'title' };

  // Strategy 2: rec_key if populated (future-proofing)
  if (rec.rec_key && TOP_10_SET.has(rec.rec_key)) {
    return { key: rec.rec_key, matched_by: 'rec_key' };
  }

  // Strategy 3: subfactor_key if populated (future-proofing)
  if (rec.subfactor_key && TOP_10_SET.has(rec.subfactor_key)) {
    return { key: rec.subfactor_key, matched_by: 'subfactor_key' };
  }

  // Strategy 4: Keyword fallback (conservative)
  const fallbackKey = keywordFallback(rec.recommendation_text, rec.category);
  if (fallbackKey) return { key: fallbackKey, matched_by: 'keyword' };

  return null;
}

// ============================================
// SINGLE-KEY RENDERER
// Calls the same template resolution as the full renderer (renderer.js lines 547-565)
// but for one canonical key at a time.
// ============================================

function renderSingleTop10(canonicalKey, scanEvidence, scan) {
  const entry = getPlaybookEntry(canonicalKey);
  if (!entry) return null;

  // Check detection state
  let detectionState = null;
  if (hasDetectionFunction(canonicalKey)) {
    detectionState = getDetectionState(canonicalKey, scanEvidence);
    if (shouldSuppressRecommendation(detectionState)) {
      return null; // COMPLETE — issue resolved, don't overwrite
    }
  }

  // Build same merged context as renderer.js line 467
  const placeholderContext = buildPlaceholderContext(scanEvidence, {}, scan);
  const evidenceContext = buildEvidenceContext(scanEvidence);
  const mergedContext = { ...placeholderContext, ...evidenceContext };

  const resolveOpts = { detectionState: detectionState || 'default' };

  // Resolve 5 sections using strict resolver (same as renderer.js lines 547-565)
  const finding = entry.finding_templates
    ? resolveTemplate(entry.finding_templates, mergedContext, resolveOpts)
    : '';
  const whyItMatters = resolveTemplate(entry.why_it_matters_template, mergedContext, resolveOpts);
  const recommendation = entry.recommendation_template
    ? resolveTemplate(entry.recommendation_template, mergedContext, resolveOpts)
    : '';
  const whatToInclude = entry.what_to_include_template
    ? resolveTemplate(entry.what_to_include_template, mergedContext, resolveOpts)
    : '';
  const actionItems = resolveTemplateArray(entry.action_items_template, mergedContext, resolveOpts);

  return {
    finding,
    why_it_matters: whyItMatters,
    recommendation,
    what_to_include: whatToInclude,
    how_to_implement: actionItems,
    detection_state: detectionState
  };
}

// ============================================
// MAIN ENRICHMENT FUNCTION
// ============================================

/**
 * Enrich legacy recommendation rows with Phase 4A.3c 5-section output.
 *
 * @param {Object} params
 * @param {Object[]} params.recommendations - DB rows from scan_recommendations
 * @param {Object} params.detailedAnalysis - scan.detailed_analysis (may contain scanEvidence)
 * @param {Object} [params.scan] - Scan row (for domain/url context)
 * @param {boolean} [params.debug=false] - Include _debug breadcrumbs
 * @returns {{ recommendations: Object[], debugInfo: Object }}
 */
function enrichLegacyRecommendations({ recommendations, detailedAnalysis, scan, debug }) {
  // Extract scanEvidence from detailed_analysis (same structure renderer uses)
  let scanEvidence = {};
  if (detailedAnalysis) {
    if (typeof detailedAnalysis === 'string') {
      try { scanEvidence = JSON.parse(detailedAnalysis); } catch { scanEvidence = {}; }
    } else {
      scanEvidence = detailedAnalysis;
    }
    // detailed_analysis may nest evidence under scanEvidence key
    if (scanEvidence.scanEvidence) {
      scanEvidence = scanEvidence.scanEvidence;
    }
  }

  const debugInfo = {
    enriched_count: 0,
    unmatched_titles: [],
    matched_by_counts: {}
  };
  const unmatchedTitleSet = new Set();

  const enriched = (recommendations || []).map(rec => {
    const next = { ...rec }; // Shallow copy — never mutate original
    const match = getCanonicalKey(next);

    if (match) {
      try {
        const rendered = renderSingleTop10(match.key, scanEvidence, scan);

        if (!rendered) {
          // COMPLETE or suppressed — mark as implemented/resolved
          const now = new Date().toISOString();

          // Move out of Active into Implemented/Resolved
          if (!next.status || next.status === 'pending') {
            next.status = 'implemented';
          }
          next.implemented_at = next.implemented_at || now;

          // Optional bookkeeping (safe)
          next.archived_reason = next.archived_reason || 'resolved_by_latest_scan';
          next.validation_status = next.validation_status || 'complete';

          // User-facing clarity (legacy fields the UI already renders)
          next.findings = 'Detected as complete in the latest scan — no action needed.';
          next.impact_description = 'This item appears properly implemented on your site.';

          // V2 fields (null is fine — these sections aren't needed for resolved items)
          next.recommendation = next.recommendation || null;
          next.what_to_include = next.what_to_include || null;
          next.how_to_implement = next.how_to_implement || null;

          if (debug) {
            next._debug_renderer_path = 'resolved_complete';
            next._debug_canonical_key = match.key;
            next._debug_matched_by = match.matched_by;
            next._debug_is_top10 = true;
          }
          return next;
        }

        // Write into LEGACY fields (instant UI improvement, no frontend changes needed):
        next.findings = rendered.finding || next.findings;
        next.impact_description = rendered.why_it_matters || next.impact_description;
        if (rendered.how_to_implement) {
          next.action_steps = Array.isArray(rendered.how_to_implement)
            ? rendered.how_to_implement
            : rendered.how_to_implement.split('\n').filter(s => s.trim());
        }

        // Write into V2 fields (for future frontend upgrade):
        next.recommendation = rendered.recommendation || null;
        next.what_to_include = rendered.what_to_include || null;
        next.how_to_implement = rendered.how_to_implement || null;
        next.finding = rendered.finding || null;
        next.why_it_matters = rendered.why_it_matters || null;

        debugInfo.enriched_count++;
        debugInfo.matched_by_counts[match.matched_by] =
          (debugInfo.matched_by_counts[match.matched_by] || 0) + 1;

        if (debug) {
          next._debug_renderer_path = 'top10';
          next._debug_canonical_key = match.key;
          next._debug_matched_by = match.matched_by;
          next._debug_is_top10 = true;
        }
      } catch (err) {
        // Renderer error must NOT break the response — continue with legacy data
        console.error(`Phase 4A.3c render error for ${match.key}:`, err.message);
        if (debug) {
          next._debug_renderer_path = 'error';
          next._debug_canonical_key = match.key;
          next._debug_matched_by = match.matched_by;
          next._debug_error = err.message;
        }
      }
    } else {
      if (next.recommendation_text) unmatchedTitleSet.add(next.recommendation_text);
      if (debug) {
        next._debug_renderer_path = 'legacy';
        next._debug_canonical_key = null;
        next._debug_matched_by = null;
        next._debug_is_top10 = false;
      }
    }

    return next;
  });

  debugInfo.unmatched_titles = Array.from(unmatchedTitleSet);

  return { recommendations: enriched, debugInfo };
}

module.exports = {
  enrichLegacyRecommendations,
  // Exported for testing
  getCanonicalKey,
  normTitle,
  keywordFallback,
  renderSingleTop10,
  TITLE_TO_CANONICAL,
  RAW_TITLE_TO_CANONICAL,
  TOP_10_SET
};
