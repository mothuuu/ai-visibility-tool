/**
 * Pack Catalog — single source of truth for pack metadata.
 *
 * Each entry: { name, cost (tokens), minPlan, category, description }.
 * minPlan uses the effective plan keys: 'free', 'starter', 'pro'.
 */

// requiresAI defaults to true; only audit_pdf is purely formatting (no Claude call).
// live=false marks roadmap packs that aren't yet purchasable; the catalog still
// returns them so the marketplace can render "Coming Soon" cards.
const PACK_CATALOG = Object.freeze({
  quick_wins:             { name: 'Quick Wins',              cost: 15,  minPlan: 'free',    category: 'fix',      description: 'Low-effort, high-impact fixes',                requiresAI: true,  live: true  },
  faq_pack:               { name: 'FAQ Pack',                cost: 35,  minPlan: 'free',    category: 'fix',      description: 'Industry-specific FAQ schema + content',       requiresAI: true,  live: true  },
  evidence_trust:         { name: 'Evidence / Trust',        cost: 40,  minPlan: 'free',    category: 'fix',      description: 'Trust signals, citations, authority markers',  requiresAI: true,  live: false },
  entity_clarity:         { name: 'Entity Clarity',          cost: 45,  minPlan: 'free',    category: 'fix',      description: 'Entity disambiguation + schema',               requiresAI: true,  live: false },
  schema_pack:            { name: 'Schema Pack',             cost: 60,  minPlan: 'free',    category: 'fix',      description: 'Full JSON-LD schema generation',               requiresAI: true,  live: true  },
  content_brief:          { name: 'Content Brief',           cost: 30,  minPlan: 'free',    category: 'create',   description: 'AI-optimized content brief',                   requiresAI: true,  live: false },
  comparison:             { name: 'Comparison/Counter',      cost: 70,  minPlan: 'pro',     category: 'create',   description: 'Competitive comparison content',               requiresAI: true,  live: false },
  ai_ready_draft:         { name: 'AI-Ready Draft',          cost: 80,  minPlan: 'free',    category: 'create',   description: 'Full draft optimized for AI consumption',      requiresAI: true,  live: false },
  audit_pdf:              { name: 'Audit PDF',               cost: 10,  minPlan: 'free',    category: 'research', description: 'Downloadable scan report',                     requiresAI: false, live: true  },
  refresh:                { name: 'Refresh',                 cost: 20,  minPlan: 'free',    category: 'research', description: 'Re-run scan + version comparison',             requiresAI: true,  live: true  },
  citation_lift:          { name: 'Citation Lift',           cost: 45,  minPlan: 'free',    category: 'research', description: 'Citation improvement recommendations',         requiresAI: true,  live: false },
  query_refresh:          { name: 'Query Refresh',           cost: 60,  minPlan: 'free',    category: 'research', description: 'Re-run + version query baseline',              requiresAI: true,  live: false },
  narrative_repair:       { name: 'Narrative Repair',        cost: 70,  minPlan: 'pro',     category: 'research', description: 'Fix negative AI narratives',                   requiresAI: true,  live: false },
  query_baseline_starter: { name: 'Query Baseline Starter',  cost: 90,  minPlan: 'free',    category: 'research', description: 'Custom prompt set for monitoring',             requiresAI: true,  live: false },
  query_baseline_pro:     { name: 'Query Baseline Pro',      cost: 150, minPlan: 'pro',     category: 'research', description: 'Extended prompt set + competitor queries',     requiresAI: true,  live: false }
});

// Plan rank for minPlan comparison (higher = more capable)
const PLAN_RANK = Object.freeze({ free: 0, starter: 1, pro: 2 });

// Pack-type → primary artifact_type. Used by PackEngine when storing the
// generated deliverable. Only types in pack_artifacts CHECK constraint are valid.
const PACK_ARTIFACT_TYPE = Object.freeze({
  quick_wins:             'document',
  faq_pack:               'json_ld',
  evidence_trust:         'document',
  entity_clarity:         'json_ld',
  schema_pack:            'json_ld',
  content_brief:          'markdown',
  comparison:             'markdown',
  ai_ready_draft:         'markdown',
  audit_pdf:              'pdf',
  refresh:                'document',
  citation_lift:          'document',
  query_refresh:          'document',
  narrative_repair:       'document',
  query_baseline_starter: 'spreadsheet',
  query_baseline_pro:     'spreadsheet'
});

function getPackConfig(packType) {
  return PACK_CATALOG[packType] || null;
}

function getArtifactType(packType) {
  return PACK_ARTIFACT_TYPE[packType] || 'document';
}

/**
 * Returns true if the user's plan meets the pack's minPlan requirement.
 * Compares by PLAN_RANK so 'pro' satisfies 'starter', etc.
 */
function planMeetsRequirement(userPlan, minPlan) {
  const userRank = PLAN_RANK[userPlan] ?? -1;
  const minRank  = PLAN_RANK[minPlan]  ?? 0;
  return userRank >= minRank;
}

module.exports = {
  PACK_CATALOG,
  PLAN_RANK,
  PACK_ARTIFACT_TYPE,
  getPackConfig,
  getArtifactType,
  planMeetsRequirement
};
