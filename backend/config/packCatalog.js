/**
 * Pack Catalog — single source of truth for pack metadata.
 *
 * Each entry: { name, cost (tokens), minPlan, category, description }.
 * minPlan uses the effective plan keys: 'free', 'starter', 'pro'.
 */

// requiresAI defaults to true; only audit_pdf is purely formatting (no Claude call).
const PACK_CATALOG = Object.freeze({
  quick_wins:             { name: 'Quick Wins',              cost: 15,  minPlan: 'starter', category: 'fix',      description: 'Low-effort, high-impact fixes',                requiresAI: true  },
  faq_pack:               { name: 'FAQ Pack',                cost: 35,  minPlan: 'starter', category: 'fix',      description: 'Industry-specific FAQ schema + content',       requiresAI: true  },
  evidence_trust:         { name: 'Evidence / Trust',        cost: 40,  minPlan: 'starter', category: 'fix',      description: 'Trust signals, citations, authority markers',  requiresAI: true  },
  entity_clarity:         { name: 'Entity Clarity',          cost: 45,  minPlan: 'starter', category: 'fix',      description: 'Entity disambiguation + schema',               requiresAI: true  },
  schema_pack:            { name: 'Schema Pack',             cost: 60,  minPlan: 'starter', category: 'fix',      description: 'Full JSON-LD schema generation',               requiresAI: true  },
  content_brief:          { name: 'Content Brief',           cost: 30,  minPlan: 'starter', category: 'create',   description: 'AI-optimized content brief',                   requiresAI: true  },
  comparison:             { name: 'Comparison/Counter',      cost: 70,  minPlan: 'pro',     category: 'create',   description: 'Competitive comparison content',               requiresAI: true  },
  ai_ready_draft:         { name: 'AI-Ready Draft',          cost: 80,  minPlan: 'starter', category: 'create',   description: 'Full draft optimized for AI consumption',      requiresAI: true  },
  audit_pdf:              { name: 'Audit PDF',               cost: 10,  minPlan: 'starter', category: 'research', description: 'Downloadable scan report',                     requiresAI: false },
  refresh:                { name: 'Refresh',                 cost: 20,  minPlan: 'starter', category: 'research', description: 'Re-run scan + version comparison',             requiresAI: true  },
  citation_lift:          { name: 'Citation Lift',           cost: 45,  minPlan: 'starter', category: 'research', description: 'Citation improvement recommendations',         requiresAI: true  },
  query_refresh:          { name: 'Query Refresh',           cost: 60,  minPlan: 'starter', category: 'research', description: 'Re-run + version query baseline',              requiresAI: true  },
  narrative_repair:       { name: 'Narrative Repair',        cost: 70,  minPlan: 'pro',     category: 'research', description: 'Fix negative AI narratives',                   requiresAI: true  },
  query_baseline_starter: { name: 'Query Baseline Starter',  cost: 90,  minPlan: 'starter', category: 'research', description: 'Custom prompt set for monitoring',             requiresAI: true  },
  query_baseline_pro:     { name: 'Query Baseline Pro',      cost: 150, minPlan: 'pro',     category: 'research', description: 'Extended prompt set + competitor queries',     requiresAI: true  }
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
