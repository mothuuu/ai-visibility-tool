/**
 * CERTIFICATION DETECTOR
 * File: backend/analyzers/recommendation-engine/certification-detector.js
 *
 * Detects professional certifications, industry memberships, and credentials
 * from website evidence (text, schema.org, images).
 *
 * Detection methods:
 * 1. Text pattern matching (body text, headings)
 * 2. Schema.org fields (Person.hasCredential, Organization.award, etc.)
 * 3. Badge image detection (alt text, src patterns)
 * 4. Industry library matching
 */

const certificationLibraryLoader = require('./certification-library-loader');

/**
 * Main certification detection function
 * @param {Object} siteData - Full site data with pages and evidence
 * @param {string} industry - Industry name for library loading
 * @returns {Object} - Detected certifications and analysis
 */
function detectCertifications(siteData, industry) {
  console.log(`\n🔍 Starting certification detection for industry: ${industry}`);

  // Load industry library
  const library = certificationLibraryLoader.loadLibrary(industry);

  const result = {
    libraryLoaded: !!library,
    industry: industry,
    detected: [],
    missing: [],
    unknown: [],
    coverage: {
      critical: { found: 0, expected: 0 },
      important: { found: 0, expected: 0 },
      relevant: { found: 0, expected: 0 }
    },
    detectionSources: {
      textPatterns: [],
      schemaFields: [],
      badges: [],
      unknown: []
    }
  };

  // If no library, do basic detection
  if (!library) {
    console.log('⚠️  No certification library for this industry, performing basic detection only');
    result.detected = detectBasicCertifications(siteData);
    result.unknown = result.detected; // All are unknown without a library
    return result;
  }

  // Get expected certifications by priority
  const expectedCertifications = {
    critical: library.certifications.filter(c => c.priority === 'critical'),
    important: library.certifications.filter(c => c.priority === 'important'),
    relevant: library.certifications.filter(c => c.priority === 'relevant')
  };

  result.coverage.critical.expected = expectedCertifications.critical.length;
  result.coverage.important.expected = expectedCertifications.important.length;
  result.coverage.relevant.expected = expectedCertifications.relevant.length;

  // Scan all pages for certifications
  const detectedCertIds = new Set();

  siteData.pages.forEach((page, index) => {
    console.log(`  📄 Scanning page ${index + 1}/${siteData.pages.length}: ${page.url}`);

    const pageDetections = detectCertificationsOnPage(
      page.evidence,
      library.certifications
    );

    pageDetections.forEach(detection => {
      if (!detectedCertIds.has(detection.id)) {
        detectedCertIds.add(detection.id);
        result.detected.push(detection);

        // Track detection source
        if (detection.source === 'text') {
          result.detectionSources.textPatterns.push(detection.name);
        } else if (detection.source === 'schema') {
          result.detectionSources.schemaFields.push(detection.name);
        } else if (detection.source === 'badge') {
          result.detectionSources.badges.push(detection.name);
        }

        // Update coverage
        if (detection.priority === 'critical') result.coverage.critical.found++;
        if (detection.priority === 'important') result.coverage.important.found++;
        if (detection.priority === 'relevant') result.coverage.relevant.found++;
      }
    });
  });

  // Determine missing certifications
  library.certifications.forEach(cert => {
    if (!detectedCertIds.has(cert.id)) {
      result.missing.push({
        id: cert.id,
        name: cert.name,
        priority: cert.priority,
        expectedImpact: cert.expected_impact,
        recommendation: cert.display_recommendation
      });
    }
  });

  // Calculate coverage percentages
  result.coveragePercentage = {
    critical: result.coverage.critical.expected > 0
      ? Math.round((result.coverage.critical.found / result.coverage.critical.expected) * 100)
      : 100,
    important: result.coverage.important.expected > 0
      ? Math.round((result.coverage.important.found / result.coverage.important.expected) * 100)
      : 100,
    relevant: result.coverage.relevant.expected > 0
      ? Math.round((result.coverage.relevant.found / result.coverage.relevant.expected) * 100)
      : 100
  };

  // Overall coverage (weighted)
  const totalExpected = result.coverage.critical.expected +
                        result.coverage.important.expected +
                        result.coverage.relevant.expected;
  const totalFound = result.coverage.critical.found +
                     result.coverage.important.found +
                     result.coverage.relevant.found;

  result.overallCoverage = totalExpected > 0
    ? Math.round((totalFound / totalExpected) * 100)
    : 0;

  console.log(`\n✅ Certification detection complete:`);
  console.log(`   - Found: ${result.detected.length}`);
  console.log(`   - Missing: ${result.missing.length}`);
  console.log(`   - Coverage: ${result.overallCoverage}%`);
  console.log(`   - Critical: ${result.coverage.critical.found}/${result.coverage.critical.expected}`);
  console.log(`   - Important: ${result.coverage.important.found}/${result.coverage.important.expected}`);
  console.log(`   - Relevant: ${result.coverage.relevant.found}/${result.coverage.relevant.expected}`);

  return result;
}

/**
 * Detect certifications on a single page
 * @param {Object} evidence - Page evidence object
 * @param {Array} certifications - Array of certification objects from library
 * @returns {Array} - Array of detected certifications
 */
function detectCertificationsOnPage(evidence, certifications) {
  const detected = [];

  certifications.forEach(cert => {
    let found = false;
    let source = '';

    // Method 1: Text pattern detection
    if (!found) {
      found = detectInText(evidence, cert.detection_patterns);
      if (found) source = 'text';
    }

    // Method 2: Schema.org detection
    if (!found) {
      found = detectInSchema(evidence, cert.schema_fields, cert.detection_patterns);
      if (found) source = 'schema';
    }

    // Method 3: Badge image detection
    if (!found && cert.badge_patterns) {
      found = detectInBadges(evidence, cert.badge_patterns);
      if (found) source = 'badge';
    }

    if (found) {
      detected.push({
        id: cert.id,
        name: cert.name,
        fullName: cert.full_name,
        priority: cert.priority,
        category: cert.category,
        expectedImpact: cert.expected_impact,
        source: source
      });
    }
  });

  return detected;
}

/**
 * Detect certification mentions in text content
 * @param {Object} evidence - Page evidence
 * @param {Array} patterns - Detection patterns
 * @returns {boolean}
 */
function detectInText(evidence, patterns) {
  if (!evidence.content || !patterns) return false;

  // Combine all text sources
  const bodyText = (evidence.content.bodyText || '').toLowerCase();
  const headings = [
    ...(evidence.content.headings?.h1 || []),
    ...(evidence.content.headings?.h2 || []),
    ...(evidence.content.headings?.h3 || [])
  ].join(' ').toLowerCase();

  const combinedText = `${bodyText} ${headings}`;

  // Check if any pattern matches
  return patterns.some(pattern =>
    combinedText.includes(pattern.toLowerCase())
  );
}

/**
 * Detect certifications in schema.org data
 * @param {Object} evidence - Page evidence
 * @param {Array} schemaFields - Expected schema fields
 * @param {Array} patterns - Detection patterns for validation
 * @returns {boolean}
 */
function detectInSchema(evidence, schemaFields, patterns) {
  if (!evidence.technical?.schemas || !schemaFields) return false;

  const schemas = evidence.technical.schemas;

  // Check various schema types
  for (const schema of schemas) {
    // Check Organization.award or Organization.accreditation
    if (schema['@type'] === 'Organization') {
      if (schema.award || schema.accreditation || schema.credentials) {
        // Validate against patterns
        const schemaText = JSON.stringify(schema).toLowerCase();
        if (patterns.some(p => schemaText.includes(p.toLowerCase()))) {
          return true;
        }
      }
    }

    // Check Person.hasCredential
    if (schema['@type'] === 'Person') {
      if (schema.hasCredential || schema.credential || schema.award) {
        const schemaText = JSON.stringify(schema).toLowerCase();
        if (patterns.some(p => schemaText.includes(p.toLowerCase()))) {
          return true;
        }
      }
    }

    // Check EducationalOccupationalCredential
    if (schema['@type'] === 'EducationalOccupationalCredential') {
      const schemaText = JSON.stringify(schema).toLowerCase();
      if (patterns.some(p => schemaText.includes(p.toLowerCase()))) {
        return true;
      }
    }

    // Check Organization.memberOf for industry memberships
    if (schema['@type'] === 'Organization' && schema.memberOf) {
      const schemaText = JSON.stringify(schema.memberOf).toLowerCase();
      if (patterns.some(p => schemaText.includes(p.toLowerCase()))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Detect certification badges in images
 * @param {Object} evidence - Page evidence
 * @param {Array} badgePatterns - Badge image patterns
 * @returns {boolean}
 */
function detectInBadges(evidence, badgePatterns) {
  if (!evidence.media?.images || !badgePatterns) return false;

  const images = evidence.media.images;

  // Check image alt text and src for badge patterns
  return images.some(img => {
    const altText = (img.alt || '').toLowerCase();
    const src = (img.src || '').toLowerCase();

    return badgePatterns.some(pattern =>
      altText.includes(pattern.toLowerCase()) ||
      src.includes(pattern.toLowerCase())
    );
  });
}

/**
 * Basic certification detection without library
 * Detects generic certification keywords
 * @param {Object} siteData - Full site data
 * @returns {Array} - Array of detected generic certifications
 */
function detectBasicCertifications(siteData) {
  const detected = [];
  const genericPatterns = [
    'certified', 'certification', 'accredited', 'accreditation',
    'iso 27001', 'soc 2', 'hipaa', 'pci dss', 'gdpr', 'fedramp',
    'cissp', 'cisa', 'ceh', 'oscp', 'licensed', 'compliance'
  ];

  const detectedSet = new Set();

  siteData.pages.forEach(page => {
    if (!page.evidence.content) return;

    const bodyText = (page.evidence.content.bodyText || '').toLowerCase();

    genericPatterns.forEach(pattern => {
      if (bodyText.includes(pattern) && !detectedSet.has(pattern)) {
        detectedSet.add(pattern);
        detected.push({
          name: pattern,
          source: 'text',
          priority: 'unknown',
          note: 'Detected without industry library - impact unknown'
        });
      }
    });
  });

  return detected;
}

/**
 * Calculate certification score
 * Uses hybrid scoring for known and unknown certifications
 * @param {Object} certificationData - Result from detectCertifications
 * @returns {number} - Score from 0-100
 */
function calculateCertificationScore(certificationData) {
  if (!certificationData.libraryLoaded) {
    // Without library, give partial credit for any detections
    const unknownBonus = Math.min(certificationData.unknown.length * 15, 45);
    return unknownBonus;
  }

  // Weighted scoring: Critical (50%), Important (30%), Relevant (20%)
  const criticalScore = certificationData.coveragePercentage.critical * 0.50;
  const importantScore = certificationData.coveragePercentage.important * 0.30;
  const relevantScore = certificationData.coveragePercentage.relevant * 0.20;

  // Unknown certifications get partial credit
  const unknownBonus = Math.min(certificationData.unknown.length * 5, 15);

  const totalScore = criticalScore + importantScore + relevantScore + unknownBonus;

  return Math.min(Math.round(totalScore), 100);
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  detectCertifications,
  calculateCertificationScore,
  detectBasicCertifications
};
