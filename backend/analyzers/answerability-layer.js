// backend/analyzers/answerability-layer.js
/**
 * ANSWERABILITY LAYER
 *
 * Per rulebook "AI Consumption Readiness (Answerability Layer)":
 * Evaluates how well content can be consumed and cited by AI systems.
 *
 * Measures:
 * - Citation readiness (can AI cite this source?)
 * - Question answerability (can AI answer questions from this content?)
 * - Entity extraction quality
 * - Fact density and clarity
 * - Structured data completeness
 */

const { CONFIDENCE_LEVELS, EVIDENCE_SOURCES } = require('../config/diagnostic-types');
const VOCABULARY = require('../config/detection-vocabulary');

/**
 * Answerability dimensions
 */
const ANSWERABILITY_DIMENSIONS = {
  CITATION_READY: 'citation-ready',       // Can be cited as a source
  QUESTION_READY: 'question-ready',       // Can answer questions
  ENTITY_RICH: 'entity-rich',             // Contains extractable entities
  FACT_DENSE: 'fact-dense',               // Contains verifiable facts
  STRUCTURE_CLEAR: 'structure-clear'      // Clear content structure
};

/**
 * Question types that content might answer
 */
const QUESTION_TYPES = {
  WHAT: 'what',           // Definitions, descriptions
  HOW: 'how',             // Processes, instructions
  WHY: 'why',             // Explanations, reasoning
  WHO: 'who',             // People, organizations
  WHERE: 'where',         // Locations
  WHEN: 'when',           // Dates, timelines
  WHICH: 'which',         // Comparisons, selections
  FAQ: 'faq'              // Explicit Q&A content
};

/**
 * Analyze answerability of content
 * @param {Object} evidence - Scan evidence
 * @returns {Object} - Answerability analysis
 */
function analyzeAnswerability(evidence) {
  const analysis = {
    overallScore: 0,
    dimensions: {},
    questionTypes: {},
    citations: {},
    recommendations: [],
    summary: {}
  };

  // Analyze each dimension
  analysis.dimensions.citationReady = analyzeCitationReadiness(evidence);
  analysis.dimensions.questionReady = analyzeQuestionReadiness(evidence);
  analysis.dimensions.entityRich = analyzeEntityRichness(evidence);
  analysis.dimensions.factDense = analyzeFactDensity(evidence);
  analysis.dimensions.structureClear = analyzeStructureClarity(evidence);

  // Analyze question type coverage
  analysis.questionTypes = analyzeQuestionTypeCoverage(evidence);

  // Analyze citation potential
  analysis.citations = analyzeCitationPotential(evidence);

  // Calculate overall score
  const dimensionScores = Object.values(analysis.dimensions).map(d => d.score);
  analysis.overallScore = Math.round(
    dimensionScores.reduce((a, b) => a + b, 0) / dimensionScores.length
  );

  // Generate recommendations
  analysis.recommendations = generateAnswerabilityRecommendations(analysis);

  // Summary
  analysis.summary = {
    answerabilityGrade: getAnswerabilityGrade(analysis.overallScore),
    strongestDimension: getStrongestDimension(analysis.dimensions),
    weakestDimension: getWeakestDimension(analysis.dimensions),
    citationReadiness: analysis.citations.readinessLevel,
    questionCoverage: Object.keys(analysis.questionTypes.covered).length
  };

  return analysis;
}

/**
 * Analyze citation readiness
 */
function analyzeCitationReadiness(evidence) {
  const signals = {
    hasAuthor: false,
    hasPublishDate: false,
    hasOrganization: false,
    hasCanonicalUrl: false,
    hasTitle: false,
    hasDescription: false,
    hasSchema: false
  };

  let score = 0;
  const issues = [];

  // Check for author
  const authorSignals = checkAuthorPresence(evidence);
  signals.hasAuthor = authorSignals.found;
  if (signals.hasAuthor) score += 20;
  else issues.push('No author attribution found');

  // Check for publish date
  if (evidence.metadata?.publishedTime || evidence.metadata?.lastModified) {
    signals.hasPublishDate = true;
    score += 15;
  } else {
    issues.push('No publish/modified date found');
  }

  // Check for organization
  const orgSchema = (evidence.technical?.structuredData || [])
    .find(s => s.type === 'Organization' || s.type === 'Corporation');
  if (orgSchema?.raw?.name) {
    signals.hasOrganization = true;
    score += 20;
  } else {
    issues.push('No organization schema found');
  }

  // Check for canonical URL
  if (evidence.technical?.hasCanonical) {
    signals.hasCanonicalUrl = true;
    score += 10;
  }

  // Check for title and description
  if (evidence.metadata?.title) {
    signals.hasTitle = true;
    score += 15;
  } else {
    issues.push('No page title found');
  }

  if (evidence.metadata?.description) {
    signals.hasDescription = true;
    score += 10;
  }

  // Check for structured data
  if ((evidence.technical?.structuredData || []).length > 0) {
    signals.hasSchema = true;
    score += 10;
  }

  return {
    dimension: ANSWERABILITY_DIMENSIONS.CITATION_READY,
    score: Math.min(score, 100),
    signals,
    issues,
    confidence: score >= 60 ? CONFIDENCE_LEVELS.HIGH :
                score >= 40 ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.LOW
  };
}

/**
 * Check for author presence
 */
function checkAuthorPresence(evidence) {
  const result = { found: false, source: null, name: null };

  // Check schema
  const articleSchema = (evidence.technical?.structuredData || [])
    .find(s => s.type === 'Article' || s.type === 'BlogPosting');
  if (articleSchema?.raw?.author) {
    result.found = true;
    result.source = 'schema';
    result.name = typeof articleSchema.raw.author === 'object'
      ? articleSchema.raw.author.name
      : articleSchema.raw.author;
    return result;
  }

  // Check meta tags
  if (evidence.metadata?.author) {
    result.found = true;
    result.source = 'meta';
    result.name = evidence.metadata.author;
    return result;
  }

  // Check content for author patterns
  const html = evidence.html || '';
  const authorPatterns = VOCABULARY.CSS_SELECTORS.author;
  for (const pattern of authorPatterns) {
    if (html.includes(pattern.replace(/[\[\]]/g, ''))) {
      result.found = true;
      result.source = 'html';
      break;
    }
  }

  return result;
}

/**
 * Analyze question readiness
 */
function analyzeQuestionReadiness(evidence) {
  const signals = {
    hasFaqs: false,
    hasDefinitions: false,
    hasHowTo: false,
    hasExplanations: false,
    hasQuestionHeadings: false
  };

  let score = 0;
  const issues = [];

  // Check for FAQs
  const faqs = evidence.content?.faqs || [];
  if (faqs.length > 0) {
    signals.hasFaqs = true;
    score += Math.min(30, faqs.length * 5);
  } else {
    issues.push('No FAQ content detected');
  }

  // Check for question-style headings
  const allHeadings = [
    ...(evidence.content?.headings?.h2 || []),
    ...(evidence.content?.headings?.h3 || []),
    ...(evidence.content?.headings?.h4 || [])
  ];
  const questionHeadings = allHeadings.filter(h => h.includes('?'));
  if (questionHeadings.length > 0) {
    signals.hasQuestionHeadings = true;
    score += Math.min(20, questionHeadings.length * 5);
  }

  // Check content patterns
  const bodyText = evidence.content?.bodyText || '';

  // Look for definitions (what is X, X is defined as)
  if (/what is \w+|is defined as|means that|refers to/i.test(bodyText)) {
    signals.hasDefinitions = true;
    score += 15;
  }

  // Look for how-to content
  if (/how to|step \d|steps to|instructions|guide/i.test(bodyText)) {
    signals.hasHowTo = true;
    score += 15;
  }

  // Look for explanations
  if (/because|therefore|this is why|the reason|explains/i.test(bodyText)) {
    signals.hasExplanations = true;
    score += 10;
  }

  // Bonus for FAQ schema
  if (evidence.technical?.hasFAQSchema) {
    score += 10;
  }

  return {
    dimension: ANSWERABILITY_DIMENSIONS.QUESTION_READY,
    score: Math.min(score, 100),
    signals,
    issues,
    questionHeadingCount: questionHeadings.length,
    faqCount: faqs.length
  };
}

/**
 * Analyze entity richness
 */
function analyzeEntityRichness(evidence) {
  const entities = {
    organizations: [],
    people: [],
    locations: [],
    products: [],
    dates: [],
    numbers: []
  };

  let score = 0;
  const html = evidence.html || '';
  const bodyText = evidence.content?.bodyText || '';

  // Extract from schema
  const schemas = evidence.technical?.structuredData || [];
  for (const schema of schemas) {
    if (schema.raw?.name) {
      if (['Organization', 'Corporation', 'LocalBusiness'].includes(schema.type)) {
        entities.organizations.push(schema.raw.name);
      } else if (schema.type === 'Person') {
        entities.people.push(schema.raw.name);
      } else if (['Place', 'LocalBusiness'].includes(schema.type)) {
        entities.locations.push(schema.raw.name);
      } else if (['Product', 'Service'].includes(schema.type)) {
        entities.products.push(schema.raw.name);
      }
    }
  }

  // Extract dates
  const dateMatches = bodyText.match(/\b\d{4}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}\b/gi);
  if (dateMatches) {
    entities.dates = [...new Set(dateMatches)].slice(0, 10);
  }

  // Extract numbers/statistics
  const statMatches = bodyText.match(/\b\d+%|\$[\d,]+|\b\d+\s*(?:million|billion|thousand|users|customers|years)\b/gi);
  if (statMatches) {
    entities.numbers = [...new Set(statMatches)].slice(0, 10);
  }

  // Calculate score based on entity richness
  const entityCount =
    entities.organizations.length +
    entities.people.length +
    entities.locations.length +
    entities.products.length;

  score += Math.min(40, entityCount * 10);
  score += Math.min(30, entities.dates.length * 5);
  score += Math.min(30, entities.numbers.length * 5);

  return {
    dimension: ANSWERABILITY_DIMENSIONS.ENTITY_RICH,
    score: Math.min(score, 100),
    entities,
    entityCount,
    hasStatistics: entities.numbers.length > 0,
    hasDates: entities.dates.length > 0
  };
}

/**
 * Analyze fact density
 */
function analyzeFactDensity(evidence) {
  const signals = {
    hasNumbers: false,
    hasStatistics: false,
    hasClaims: false,
    hasEvidence: false,
    hasComparisons: false
  };

  let score = 0;
  const bodyText = evidence.content?.bodyText || '';
  const wordCount = evidence.content?.wordCount || 0;

  // Check for numbers
  const numberMatches = bodyText.match(/\b\d+(?:\.\d+)?(?:%|\s*(?:times|percent|million|billion|thousand))?\b/gi);
  if (numberMatches && numberMatches.length > 0) {
    signals.hasNumbers = true;
    const density = numberMatches.length / (wordCount / 100);
    score += Math.min(25, density * 5);
  }

  // Check for statistics
  if (/\b\d+%|percent|average|median|majority|minority/i.test(bodyText)) {
    signals.hasStatistics = true;
    score += 20;
  }

  // Check for factual claims
  const claimPatterns = /according to|research shows|studies indicate|data suggests|evidence shows|proven|confirmed/i;
  if (claimPatterns.test(bodyText)) {
    signals.hasClaims = true;
    score += 20;
  }

  // Check for supporting evidence
  if (/source:|reference:|citation:|per|according to (?:the|a) (?:study|report|survey)/i.test(bodyText)) {
    signals.hasEvidence = true;
    score += 20;
  }

  // Check for comparisons
  if (/compared to|versus|vs\.|more than|less than|better than|worse than/i.test(bodyText)) {
    signals.hasComparisons = true;
    score += 15;
  }

  return {
    dimension: ANSWERABILITY_DIMENSIONS.FACT_DENSE,
    score: Math.min(score, 100),
    signals,
    numberCount: numberMatches?.length || 0,
    wordCount
  };
}

/**
 * Analyze structure clarity
 */
function analyzeStructureClarity(evidence) {
  const signals = {
    hasHeadingHierarchy: false,
    hasLists: false,
    hasTables: false,
    hasSections: false,
    hasShortParagraphs: false
  };

  let score = 0;
  const issues = [];

  // Check heading hierarchy
  const headings = evidence.content?.headings || {};
  const h1Count = headings.h1?.length || 0;
  const h2Count = headings.h2?.length || 0;
  const h3Count = headings.h3?.length || 0;

  if (h1Count === 1 && h2Count > 0) {
    signals.hasHeadingHierarchy = true;
    score += 25;
    if (h3Count > 0) score += 10;
  } else {
    issues.push('Heading hierarchy could be improved');
  }

  // Check for lists
  const listCount = evidence.content?.lists?.length || 0;
  if (listCount > 0) {
    signals.hasLists = true;
    score += Math.min(20, listCount * 5);
  }

  // Check for tables
  const tableCount = evidence.content?.tables?.length || 0;
  if (tableCount > 0) {
    signals.hasTables = true;
    score += Math.min(15, tableCount * 5);
  }

  // Check for semantic sections
  if (evidence.structure?.hasSection || evidence.structure?.hasArticle) {
    signals.hasSections = true;
    score += 15;
  }

  // Check paragraph length (shorter is better for AI parsing)
  const paragraphs = evidence.content?.paragraphs || [];
  const avgLength = paragraphs.length > 0
    ? paragraphs.reduce((sum, p) => sum + p.length, 0) / paragraphs.length
    : 0;

  if (avgLength > 0 && avgLength < 500) {
    signals.hasShortParagraphs = true;
    score += 15;
  } else if (avgLength > 800) {
    issues.push('Paragraphs may be too long for optimal AI parsing');
  }

  return {
    dimension: ANSWERABILITY_DIMENSIONS.STRUCTURE_CLEAR,
    score: Math.min(score, 100),
    signals,
    issues,
    metrics: {
      h2Count,
      h3Count,
      listCount,
      tableCount,
      avgParagraphLength: Math.round(avgLength)
    }
  };
}

/**
 * Analyze question type coverage
 */
function analyzeQuestionTypeCoverage(evidence) {
  const coverage = {
    covered: {},
    missing: [],
    suggestions: []
  };

  const bodyText = evidence.content?.bodyText || '';
  const faqs = evidence.content?.faqs || [];

  // Check what type
  if (/what is|definition|means|refers to/i.test(bodyText) || faqs.some(f => /^what/i.test(f.question))) {
    coverage.covered[QUESTION_TYPES.WHAT] = { detected: true, source: 'content' };
  } else {
    coverage.missing.push(QUESTION_TYPES.WHAT);
    coverage.suggestions.push('Add definitions or "What is X?" sections');
  }

  // Check how type
  if (/how to|steps|instructions|process|method/i.test(bodyText) || faqs.some(f => /^how/i.test(f.question))) {
    coverage.covered[QUESTION_TYPES.HOW] = { detected: true, source: 'content' };
  } else {
    coverage.missing.push(QUESTION_TYPES.HOW);
    coverage.suggestions.push('Add how-to guides or process explanations');
  }

  // Check why type
  if (/why|because|reason|purpose|benefit/i.test(bodyText) || faqs.some(f => /^why/i.test(f.question))) {
    coverage.covered[QUESTION_TYPES.WHY] = { detected: true, source: 'content' };
  } else {
    coverage.missing.push(QUESTION_TYPES.WHY);
  }

  // Check who type
  if (/who|team|founder|expert|author/i.test(bodyText)) {
    coverage.covered[QUESTION_TYPES.WHO] = { detected: true, source: 'content' };
  }

  // Check where type
  if (/where|location|address|office|headquarters/i.test(bodyText)) {
    coverage.covered[QUESTION_TYPES.WHERE] = { detected: true, source: 'content' };
  }

  // Check when type
  if (/when|date|time|schedule|timeline/i.test(bodyText)) {
    coverage.covered[QUESTION_TYPES.WHEN] = { detected: true, source: 'content' };
  }

  // Check FAQ type
  if (faqs.length > 0) {
    coverage.covered[QUESTION_TYPES.FAQ] = {
      detected: true,
      source: evidence.technical?.hasFAQSchema ? 'schema' : 'content',
      count: faqs.length
    };
  } else {
    coverage.missing.push(QUESTION_TYPES.FAQ);
    coverage.suggestions.push('Add FAQ section with common questions');
  }

  return coverage;
}

/**
 * Analyze citation potential
 */
function analyzeCitationPotential(evidence) {
  const potential = {
    readinessLevel: 'low',
    citableElements: [],
    missingElements: [],
    enhancementSuggestions: []
  };

  // Check required citation elements
  const elements = [
    { name: 'Title', present: !!evidence.metadata?.title, required: true },
    { name: 'Author', present: checkAuthorPresence(evidence).found, required: true },
    { name: 'Date', present: !!(evidence.metadata?.publishedTime || evidence.metadata?.lastModified), required: true },
    { name: 'Organization', present: !!(evidence.technical?.structuredData || []).find(s => s.type === 'Organization'), required: false },
    { name: 'URL', present: !!evidence.url, required: true },
    { name: 'Description', present: !!evidence.metadata?.description, required: false }
  ];

  let requiredCount = 0;
  let presentCount = 0;

  for (const element of elements) {
    if (element.present) {
      potential.citableElements.push(element.name);
      presentCount++;
    } else {
      potential.missingElements.push(element.name);
      if (element.required) {
        potential.enhancementSuggestions.push(`Add ${element.name} for citation readiness`);
      }
    }
    if (element.required) requiredCount++;
  }

  // Calculate readiness level
  const requiredPresent = elements.filter(e => e.required && e.present).length;
  const requiredTotal = elements.filter(e => e.required).length;

  if (requiredPresent === requiredTotal) {
    potential.readinessLevel = 'high';
  } else if (requiredPresent >= requiredTotal - 1) {
    potential.readinessLevel = 'medium';
  } else {
    potential.readinessLevel = 'low';
  }

  potential.score = Math.round((requiredPresent / requiredTotal) * 100);

  return potential;
}

/**
 * Generate answerability recommendations
 */
function generateAnswerabilityRecommendations(analysis) {
  const recommendations = [];

  // Citation recommendations
  if (analysis.dimensions.citationReady.score < 60) {
    for (const issue of analysis.dimensions.citationReady.issues) {
      recommendations.push({
        dimension: 'citation',
        priority: 'high',
        issue,
        action: `Add ${issue.replace('No ', '').replace(' found', '')} to enable AI citations`
      });
    }
  }

  // Question readiness recommendations
  if (analysis.dimensions.questionReady.score < 50) {
    if (!analysis.dimensions.questionReady.signals.hasFaqs) {
      recommendations.push({
        dimension: 'question',
        priority: 'high',
        issue: 'No FAQ content',
        action: 'Add FAQ section with common customer questions'
      });
    }
  }

  // Entity recommendations
  if (analysis.dimensions.entityRich.score < 40) {
    recommendations.push({
      dimension: 'entity',
      priority: 'medium',
      issue: 'Low entity density',
      action: 'Add more named entities (people, organizations, products) with context'
    });
  }

  // Fact density recommendations
  if (analysis.dimensions.factDense.score < 50) {
    if (!analysis.dimensions.factDense.signals.hasStatistics) {
      recommendations.push({
        dimension: 'facts',
        priority: 'medium',
        issue: 'No statistics found',
        action: 'Add data points, percentages, or research findings'
      });
    }
  }

  // Structure recommendations
  if (analysis.dimensions.structureClear.score < 60) {
    for (const issue of (analysis.dimensions.structureClear.issues || [])) {
      recommendations.push({
        dimension: 'structure',
        priority: 'low',
        issue,
        action: 'Improve content structure for better AI parsing'
      });
    }
  }

  // Question coverage recommendations
  for (const suggestion of analysis.questionTypes.suggestions || []) {
    recommendations.push({
      dimension: 'coverage',
      priority: 'medium',
      issue: 'Question type gap',
      action: suggestion
    });
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));

  return recommendations;
}

/**
 * Get answerability grade
 */
function getAnswerabilityGrade(score) {
  if (score >= 80) return { grade: 'A', label: 'Excellent', description: 'Content is highly AI-consumable' };
  if (score >= 60) return { grade: 'B', label: 'Good', description: 'Content is reasonably AI-friendly' };
  if (score >= 40) return { grade: 'C', label: 'Fair', description: 'Content needs improvement for AI' };
  if (score >= 20) return { grade: 'D', label: 'Poor', description: 'Content has significant AI readability issues' };
  return { grade: 'F', label: 'Failing', description: 'Content is not AI-ready' };
}

/**
 * Get strongest dimension
 */
function getStrongestDimension(dimensions) {
  return Object.entries(dimensions)
    .reduce((a, b) => a[1].score > b[1].score ? a : b)[0];
}

/**
 * Get weakest dimension
 */
function getWeakestDimension(dimensions) {
  return Object.entries(dimensions)
    .reduce((a, b) => a[1].score < b[1].score ? a : b)[0];
}

module.exports = {
  analyzeAnswerability,
  analyzeCitationReadiness,
  analyzeQuestionReadiness,
  analyzeEntityRichness,
  analyzeFactDensity,
  analyzeStructureClarity,
  analyzeQuestionTypeCoverage,
  analyzeCitationPotential,
  ANSWERABILITY_DIMENSIONS,
  QUESTION_TYPES
};
