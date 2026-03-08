// backend/analyzers/recommendation-engine/types.js
// Minimal runtime validator (no external deps). Use zod if you prefer.

function normalizeEvidence(raw) {
  const profile = raw.detected_profile || raw.profile || {};
  const facts = raw.extracted_facts || raw.facts || [];
  return {
    profile: {
      site_type: profile.site_type || 'small_multi',
      routes_count: Number(profile.routes_count || 1),
      anchors: Array.isArray(profile.anchors) ? profile.anchors : [],
      sections: profile.sections || {}
    },
    facts: Array.isArray(facts) ? facts : []
  };
}

function factValue(facts, name, fallback = undefined) {
  const f = facts.find(x => x.name === name);
  return f ? f.value : fallback;
}

module.exports = { normalizeEvidence, factValue };