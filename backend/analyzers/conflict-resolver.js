// backend/analyzers/conflict-resolver.js
/**
 * CONFLICT RESOLVER
 *
 * Per rulebook "Evidence Confidence & Conflict Resolution":
 * Handles cases where multiple data sources provide conflicting information.
 *
 * Resolution strategies:
 * 1. Source priority (schema > meta > content > inferred)
 * 2. Specificity (more specific wins)
 * 3. Freshness (newer data wins)
 * 4. Consensus (majority wins)
 */

const { CONFIDENCE_LEVELS, EVIDENCE_SOURCES, createConflict } = require('../config/diagnostic-types');

/**
 * Source priority for conflict resolution
 * Higher number = higher priority
 */
const SOURCE_PRIORITY = {
  [EVIDENCE_SOURCES.JSON_LD]: 100,
  [EVIDENCE_SOURCES.MICRODATA]: 95,
  [EVIDENCE_SOURCES.RDFA]: 90,
  [EVIDENCE_SOURCES.META_TAG]: 80,
  [EVIDENCE_SOURCES.SEMANTIC_HTML]: 70,
  [EVIDENCE_SOURCES.ARIA_ATTRIBUTE]: 65,
  [EVIDENCE_SOURCES.HEADING_TEXT]: 60,
  [EVIDENCE_SOURCES.BODY_TEXT]: 50,
  [EVIDENCE_SOURCES.NAVIGATION_LINK]: 45,
  [EVIDENCE_SOURCES.FOOTER_LINK]: 40,
  [EVIDENCE_SOURCES.CSS_CLASS]: 30,
  [EVIDENCE_SOURCES.URL_PATTERN]: 25,
  [EVIDENCE_SOURCES.CRAWLER]: 20,
  [EVIDENCE_SOURCES.HEURISTIC]: 10,
  [EVIDENCE_SOURCES.FALLBACK]: 5
};

/**
 * Conflict types
 */
const CONFLICT_TYPES = {
  VALUE_MISMATCH: 'value-mismatch',       // Same field, different values
  TYPE_MISMATCH: 'type-mismatch',         // Data type inconsistency
  PRESENCE_CONFLICT: 'presence-conflict', // One source says exists, another says doesn't
  PARTIAL_OVERLAP: 'partial-overlap',     // Some values match, some don't
  SEMANTIC_CONFLICT: 'semantic-conflict'  // Logically contradictory
};

/**
 * Resolution strategies
 */
const RESOLUTION_STRATEGIES = {
  HIGHEST_PRIORITY: 'highest-priority',
  MOST_SPECIFIC: 'most-specific',
  CONSENSUS: 'consensus',
  FRESHEST: 'freshest',
  MANUAL_REVIEW: 'manual-review'
};

/**
 * Conflict Resolver class
 */
class ConflictResolver {
  constructor() {
    this.conflicts = [];
    this.resolutions = [];
  }

  /**
   * Detect and resolve conflicts for a specific field
   * @param {string} fieldName - Name of the field being checked
   * @param {Array} sources - Array of { source, value, confidence, timestamp? }
   * @returns {Object} - Resolution result
   */
  resolveField(fieldName, sources) {
    if (!sources || sources.length < 2) {
      return {
        hasConflict: false,
        resolvedValue: sources?.[0]?.value || null,
        source: sources?.[0]?.source || null,
        confidence: sources?.[0]?.confidence || CONFIDENCE_LEVELS.LOW
      };
    }

    // Check for conflicts
    const uniqueValues = this.getUniqueValues(sources);

    if (uniqueValues.length <= 1) {
      // No conflict - all sources agree
      const bestSource = this.selectBestSource(sources);
      return {
        hasConflict: false,
        resolvedValue: bestSource.value,
        source: bestSource.source,
        confidence: bestSource.confidence,
        consensus: true
      };
    }

    // We have a conflict!
    const conflict = this.createConflictRecord(fieldName, sources, uniqueValues);
    this.conflicts.push(conflict);

    // Resolve using priority strategy
    const resolution = this.resolveByPriority(fieldName, sources, conflict);
    this.resolutions.push(resolution);

    return resolution;
  }

  /**
   * Get unique values from sources (handles objects and primitives)
   */
  getUniqueValues(sources) {
    const seen = new Set();
    const unique = [];

    for (const source of sources) {
      const valueKey = this.normalizeValue(source.value);
      if (!seen.has(valueKey)) {
        seen.add(valueKey);
        unique.push(source.value);
      }
    }

    return unique;
  }

  /**
   * Normalize value for comparison
   */
  normalizeValue(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return value.toLowerCase().trim();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * Select best source based on priority
   */
  selectBestSource(sources) {
    return sources.reduce((best, current) => {
      const currentPriority = SOURCE_PRIORITY[current.source] || 0;
      const bestPriority = SOURCE_PRIORITY[best.source] || 0;
      return currentPriority > bestPriority ? current : best;
    }, sources[0]);
  }

  /**
   * Create a conflict record
   */
  createConflictRecord(fieldName, sources, uniqueValues) {
    return {
      field: fieldName,
      type: this.determineConflictType(sources, uniqueValues),
      sources: sources.map(s => ({
        source: s.source,
        value: s.value,
        confidence: s.confidence,
        priority: SOURCE_PRIORITY[s.source] || 0
      })),
      uniqueValues,
      detectedAt: new Date().toISOString()
    };
  }

  /**
   * Determine the type of conflict
   */
  determineConflictType(sources, uniqueValues) {
    // Check for presence conflicts
    const hasNull = sources.some(s => s.value === null || s.value === undefined);
    const hasValue = sources.some(s => s.value !== null && s.value !== undefined);

    if (hasNull && hasValue) {
      return CONFLICT_TYPES.PRESENCE_CONFLICT;
    }

    // Check for type mismatches
    const types = new Set(sources.map(s => typeof s.value));
    if (types.size > 1) {
      return CONFLICT_TYPES.TYPE_MISMATCH;
    }

    // Check for partial overlap (arrays)
    if (Array.isArray(sources[0]?.value)) {
      return CONFLICT_TYPES.PARTIAL_OVERLAP;
    }

    return CONFLICT_TYPES.VALUE_MISMATCH;
  }

  /**
   * Resolve conflict using priority strategy
   */
  resolveByPriority(fieldName, sources, conflict) {
    // Sort by priority
    const sorted = [...sources].sort((a, b) => {
      const priorityA = SOURCE_PRIORITY[a.source] || 0;
      const priorityB = SOURCE_PRIORITY[b.source] || 0;
      return priorityB - priorityA;
    });

    const winner = sorted[0];

    // Calculate confidence in resolution
    let resolutionConfidence = winner.confidence;

    // Lower confidence if sources strongly disagree
    if (conflict.uniqueValues.length > 2) {
      resolutionConfidence = CONFIDENCE_LEVELS.LOW;
    } else if (conflict.uniqueValues.length === 2) {
      // Check if second-highest priority source has similar priority
      const runnerUp = sorted[1];
      const priorityGap = (SOURCE_PRIORITY[winner.source] || 0) - (SOURCE_PRIORITY[runnerUp.source] || 0);

      if (priorityGap < 20) {
        // Close call - lower confidence
        resolutionConfidence = CONFIDENCE_LEVELS.MEDIUM;
      }
    }

    return {
      hasConflict: true,
      field: fieldName,
      resolvedValue: winner.value,
      source: winner.source,
      confidence: resolutionConfidence,
      strategy: RESOLUTION_STRATEGIES.HIGHEST_PRIORITY,
      conflict: {
        type: conflict.type,
        alternativeValues: conflict.uniqueValues.filter(v => this.normalizeValue(v) !== this.normalizeValue(winner.value)),
        sourceCount: sources.length,
        uniqueValueCount: conflict.uniqueValues.length
      },
      reasoning: `Selected value from ${winner.source} (priority: ${SOURCE_PRIORITY[winner.source] || 0}) over ${sources.length - 1} other source(s)`
    };
  }

  /**
   * Resolve conflict using consensus strategy
   */
  resolveByConsensus(fieldName, sources, conflict) {
    // Count votes for each value
    const votes = {};
    for (const source of sources) {
      const key = this.normalizeValue(source.value);
      if (!votes[key]) {
        votes[key] = { value: source.value, count: 0, sources: [] };
      }
      votes[key].count++;
      votes[key].sources.push(source.source);
    }

    // Find winner
    const winner = Object.values(votes).reduce((a, b) => a.count > b.count ? a : b);

    const resolutionConfidence = winner.count > sources.length / 2
      ? CONFIDENCE_LEVELS.HIGH
      : CONFIDENCE_LEVELS.MEDIUM;

    return {
      hasConflict: true,
      field: fieldName,
      resolvedValue: winner.value,
      source: winner.sources[0], // Primary source
      confidence: resolutionConfidence,
      strategy: RESOLUTION_STRATEGIES.CONSENSUS,
      conflict: {
        type: conflict.type,
        voteCounts: Object.fromEntries(Object.entries(votes).map(([k, v]) => [k, v.count])),
        winningVotes: winner.count,
        totalVotes: sources.length
      },
      reasoning: `Selected value with ${winner.count}/${sources.length} votes`
    };
  }

  /**
   * Resolve multiple fields at once
   * @param {Object} fieldSources - { fieldName: [sources] }
   * @returns {Object} - All resolutions
   */
  resolveAll(fieldSources) {
    const resolutions = {};

    for (const [field, sources] of Object.entries(fieldSources)) {
      resolutions[field] = this.resolveField(field, sources);
    }

    return {
      resolutions,
      conflicts: this.conflicts,
      summary: {
        totalFields: Object.keys(fieldSources).length,
        fieldsWithConflicts: this.conflicts.length,
        resolutionStrategiesUsed: [...new Set(Object.values(resolutions).map(r => r.strategy).filter(Boolean))]
      }
    };
  }

  /**
   * Get all detected conflicts
   */
  getConflicts() {
    return this.conflicts;
  }

  /**
   * Get all resolutions
   */
  getResolutions() {
    return this.resolutions;
  }

  /**
   * Generate conflict report
   */
  generateReport() {
    return {
      conflictCount: this.conflicts.length,
      conflicts: this.conflicts.map(c => ({
        field: c.field,
        type: c.type,
        uniqueValueCount: c.uniqueValues.length,
        sources: c.sources.map(s => s.source)
      })),
      resolutions: this.resolutions.map(r => ({
        field: r.field,
        strategy: r.strategy,
        confidence: r.confidence,
        resolvedValue: typeof r.resolvedValue === 'string'
          ? r.resolvedValue.substring(0, 50)
          : r.resolvedValue
      })),
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Helper function to extract field values from multiple evidence sources
 * @param {Object} evidence - Scan evidence
 * @param {string} fieldName - Field to extract
 * @returns {Array} - Array of { source, value, confidence }
 */
function extractFieldFromAllSources(evidence, fieldName) {
  const sources = [];

  // Field-specific extraction logic
  switch (fieldName) {
    case 'brandName':
      // From Organization schema
      const orgSchema = (evidence.technical?.structuredData || [])
        .find(s => s.type === 'Organization' || s.type === 'Corporation');
      if (orgSchema?.raw?.name) {
        sources.push({
          source: EVIDENCE_SOURCES.JSON_LD,
          value: orgSchema.raw.name,
          confidence: CONFIDENCE_LEVELS.HIGH
        });
      }

      // From OG title
      if (evidence.metadata?.ogTitle) {
        sources.push({
          source: EVIDENCE_SOURCES.META_TAG,
          value: cleanBrandName(evidence.metadata.ogTitle),
          confidence: CONFIDENCE_LEVELS.HIGH
        });
      }

      // From title tag
      if (evidence.metadata?.title) {
        sources.push({
          source: EVIDENCE_SOURCES.META_TAG,
          value: cleanBrandName(evidence.metadata.title),
          confidence: CONFIDENCE_LEVELS.MEDIUM
        });
      }

      // From H1
      const h1s = evidence.content?.headings?.h1 || [];
      if (h1s.length > 0) {
        sources.push({
          source: EVIDENCE_SOURCES.HEADING_TEXT,
          value: cleanBrandName(h1s[0]),
          confidence: CONFIDENCE_LEVELS.MEDIUM
        });
      }
      break;

    case 'description':
      if (evidence.metadata?.description) {
        sources.push({
          source: EVIDENCE_SOURCES.META_TAG,
          value: evidence.metadata.description,
          confidence: CONFIDENCE_LEVELS.HIGH
        });
      }
      if (evidence.metadata?.ogDescription) {
        sources.push({
          source: EVIDENCE_SOURCES.META_TAG,
          value: evidence.metadata.ogDescription,
          confidence: CONFIDENCE_LEVELS.HIGH
        });
      }
      const orgSchemaDesc = (evidence.technical?.structuredData || [])
        .find(s => s.type === 'Organization');
      if (orgSchemaDesc?.raw?.description) {
        sources.push({
          source: EVIDENCE_SOURCES.JSON_LD,
          value: orgSchemaDesc.raw.description,
          confidence: CONFIDENCE_LEVELS.HIGH
        });
      }
      break;

    case 'logoUrl':
      if (evidence.metadata?.ogImage) {
        sources.push({
          source: EVIDENCE_SOURCES.META_TAG,
          value: evidence.metadata.ogImage,
          confidence: CONFIDENCE_LEVELS.HIGH
        });
      }
      const logoSchema = (evidence.technical?.structuredData || [])
        .find(s => s.type === 'Organization');
      if (logoSchema?.raw?.logo) {
        sources.push({
          source: EVIDENCE_SOURCES.JSON_LD,
          value: logoSchema.raw.logo,
          confidence: CONFIDENCE_LEVELS.HIGH
        });
      }
      const logoImg = (evidence.media?.images || [])
        .find(img => img.alt && /logo/i.test(img.alt));
      if (logoImg?.src) {
        sources.push({
          source: EVIDENCE_SOURCES.SEMANTIC_HTML,
          value: logoImg.src,
          confidence: CONFIDENCE_LEVELS.MEDIUM
        });
      }
      break;

    case 'hasFaq':
      // From schema
      if (evidence.technical?.hasFAQSchema) {
        sources.push({
          source: EVIDENCE_SOURCES.JSON_LD,
          value: true,
          confidence: CONFIDENCE_LEVELS.HIGH
        });
      }
      // From content
      if ((evidence.content?.faqs?.length || 0) > 0) {
        sources.push({
          source: EVIDENCE_SOURCES.SEMANTIC_HTML,
          value: true,
          confidence: CONFIDENCE_LEVELS.MEDIUM
        });
      }
      // From navigation
      if (evidence.navigation?.keyPages?.faq) {
        sources.push({
          source: EVIDENCE_SOURCES.NAVIGATION_LINK,
          value: true,
          confidence: CONFIDENCE_LEVELS.MEDIUM
        });
      }
      break;
  }

  return sources;
}

/**
 * Clean brand name helper
 */
function cleanBrandName(raw) {
  return raw
    .replace(/\s*[-|–—]\s*(Home|Welcome|Official Site|Website).*$/i, '')
    .trim();
}

/**
 * Resolve all major fields from evidence
 * @param {Object} evidence - Scan evidence
 * @returns {Object} - Resolved fields with conflict info
 */
function resolveEvidenceConflicts(evidence) {
  const resolver = new ConflictResolver();

  const fieldsToResolve = {
    brandName: extractFieldFromAllSources(evidence, 'brandName'),
    description: extractFieldFromAllSources(evidence, 'description'),
    logoUrl: extractFieldFromAllSources(evidence, 'logoUrl'),
    hasFaq: extractFieldFromAllSources(evidence, 'hasFaq')
  };

  const result = resolver.resolveAll(fieldsToResolve);

  return {
    resolvedFields: result.resolutions,
    conflictReport: resolver.generateReport(),
    summary: result.summary
  };
}

module.exports = {
  ConflictResolver,
  resolveEvidenceConflicts,
  extractFieldFromAllSources,
  SOURCE_PRIORITY,
  CONFLICT_TYPES,
  RESOLUTION_STRATEGIES
};
