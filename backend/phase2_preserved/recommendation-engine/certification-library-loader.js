/**
 * CERTIFICATION LIBRARY LOADER
 * File: backend/analyzers/recommendation-engine/certification-library-loader.js
 *
 * Loads industry-specific certification libraries from JSON files.
 * Auto-detects available industries and maps certifications to detection patterns.
 */

const fs = require('fs');
const path = require('path');

// Path to certification libraries folder
const LIBRARIES_PATH = path.join(__dirname, 'certification-libraries');

/**
 * Industry mapping - maps user input to library filenames
 * Uses same mapping as FAQ libraries for consistency
 */
const INDUSTRY_MAPPING = {
  // Generic (fallback for all industries)
  'generic': 'generic',
  'general': 'generic',

  // Healthcare
  'healthcare': 'healthcare',
  'health': 'healthcare',
  'medical': 'healthcare',
  'hospital': 'healthcare',

  // UCaaS / Cloud Communications
  'ucaas': 'ucaas',
  'cloud communications': 'ucaas',
  'unified communications': 'ucaas',
  'voip': 'ucaas',

  // Fintech
  'fintech': 'fintech',
  'financial technology': 'fintech',
  'financial services': 'fintech',
  'finance': 'fintech',

  // Cybersecurity
  'cybersecurity': 'cybersecurity',
  'cyber security': 'cybersecurity',
  'infosec': 'cybersecurity',
  'security': 'cybersecurity',

  // Marketing Agencies
  'marketing agency': 'marketing-agencies',
  'marketing agencies': 'marketing-agencies',
  'digital marketing': 'marketing-agencies',
  'marketing': 'marketing-agencies',

  // SaaS B2B
  'saas': 'saas-b2b',
  'saas b2b': 'saas-b2b',
  'software as a service': 'saas-b2b',
  'b2b saas': 'saas-b2b',

  // Managed Service Providers
  'msp': 'managed-service-providers',
  'managed service provider': 'managed-service-providers',
  'managed services': 'managed-service-providers',

  // Data Center
  'data center': 'data-center',
  'datacenter': 'data-center',
  'data centre': 'data-center'
};

/**
 * Get available industries (auto-detect from folder)
 * @returns {Array} - List of available industry IDs
 */
function getAvailableIndustries() {
  try {
    if (!fs.existsSync(LIBRARIES_PATH)) {
      console.warn('⚠️  Certification libraries folder not found.');
      return [];
    }

    const files = fs.readdirSync(LIBRARIES_PATH);
    const industries = files
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''));

    console.log(`🏆 Found ${industries.length} certification libraries:`, industries);
    return industries;
  } catch (error) {
    console.error('❌ Error reading certification libraries:', error);
    return [];
  }
}

/**
 * Normalize industry name to library filename
 * @param {string} industry - User's industry input
 * @returns {string|null} - Library filename or null if not found
 */
function normalizeIndustry(industry) {
  if (!industry) return null;

  const industryLower = industry.toLowerCase().trim();

  // Check direct mapping
  if (INDUSTRY_MAPPING[industryLower]) {
    return INDUSTRY_MAPPING[industryLower];
  }

  // Check if partial match
  for (const [key, value] of Object.entries(INDUSTRY_MAPPING)) {
    if (industryLower.includes(key) || key.includes(industryLower)) {
      return value;
    }
  }

  return null;
}

/**
 * Check if library exists for an industry
 * @param {string} industry - Industry name
 * @returns {boolean}
 */
function hasLibrary(industry) {
  const normalized = normalizeIndustry(industry);
  if (!normalized) return false;

  const filePath = path.join(LIBRARIES_PATH, `${normalized}.json`);
  return fs.existsSync(filePath);
}

/**
 * Load certification library for an industry
 * @param {string} industry - Industry name
 * @returns {Object|null} - Loaded library or null
 */
function loadLibrary(industry) {
  const normalized = normalizeIndustry(industry);

  if (!normalized) {
    console.log(`⚠️  No certification mapping found for industry: ${industry}`);
    return null;
  }

  const filePath = path.join(LIBRARIES_PATH, `${normalized}.json`);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  Certification library not found: ${normalized}.json`);
    return null;
  }

  try {
    const rawData = fs.readFileSync(filePath, 'utf8');
    const library = JSON.parse(rawData);

    // Validate library structure
    if (!library.certification_library || !library.certification_library.certifications) {
      console.error(`❌ Invalid library structure in ${normalized}.json`);
      return null;
    }

    console.log(`✅ Loaded certification library: ${library.certification_library.industry} (${library.certification_library.metadata.total_certifications} certifications)`);
    return library.certification_library;

  } catch (error) {
    console.error(`❌ Error loading certification library ${normalized}.json:`, error.message);
    return null;
  }
}

/**
 * Get library info without loading full content
 * @param {string} industry - Industry name
 * @returns {Object|null} - Library metadata
 */
function getLibraryInfo(industry) {
  const normalized = normalizeIndustry(industry);
  if (!normalized) return null;

  const filePath = path.join(LIBRARIES_PATH, `${normalized}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const rawData = fs.readFileSync(filePath, 'utf8');
    const library = JSON.parse(rawData);

    return {
      industry: library.certification_library.industry,
      industry_id: library.certification_library.industry_id,
      version: library.certification_library.version,
      total_certifications: library.certification_library.metadata.total_certifications,
      last_updated: library.certification_library.last_updated
    };
  } catch (error) {
    return null;
  }
}

/**
 * List all available libraries with their info
 * @returns {Array} - Array of library info objects
 */
function listAllLibraries() {
  const industries = getAvailableIndustries();

  return industries.map(industryId => {
    const filePath = path.join(LIBRARIES_PATH, `${industryId}.json`);
    try {
      const rawData = fs.readFileSync(filePath, 'utf8');
      const library = JSON.parse(rawData);
      return {
        industry_id: industryId,
        industry_name: library.certification_library.industry,
        total_certifications: library.certification_library.metadata.total_certifications,
        version: library.certification_library.version
      };
    } catch (error) {
      return {
        industry_id: industryId,
        error: 'Failed to load'
      };
    }
  });
}

/**
 * Get all detection patterns from a library
 * Useful for building unified detection logic
 * @param {string} industry - Industry name
 * @returns {Object} - Object with certifications and their detection patterns
 */
function getDetectionPatterns(industry) {
  const library = loadLibrary(industry);
  if (!library) return null;

  const patterns = {};
  library.certifications.forEach(cert => {
    patterns[cert.id] = {
      name: cert.name,
      priority: cert.priority,
      patterns: cert.detection_patterns,
      badge_patterns: cert.badge_patterns || []
    };
  });

  return patterns;
}

/**
 * Get certifications by priority level
 * @param {string} industry - Industry name
 * @param {string} priority - 'critical', 'important', or 'relevant'
 * @returns {Array} - Array of certifications for that priority
 */
function getCertificationsByPriority(industry, priority) {
  const library = loadLibrary(industry);
  if (!library) return [];

  return library.certifications.filter(cert => cert.priority === priority);
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  getAvailableIndustries,
  normalizeIndustry,
  hasLibrary,
  loadLibrary,
  getLibraryInfo,
  listAllLibraries,
  getDetectionPatterns,
  getCertificationsByPriority,
  INDUSTRY_MAPPING
};
