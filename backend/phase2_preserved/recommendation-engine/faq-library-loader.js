/**
 * FAQ LIBRARY LOADER
 * File: backend/analyzers/recommendation-engine/faq-library-loader.js
 * 
 * Loads industry-specific FAQ libraries from JSON files.
 * Auto-detects available industries.
 */

const fs = require('fs');
const path = require('path');

// Path to FAQ libraries folder
const LIBRARIES_PATH = path.join(__dirname, 'faq-libraries');

/**
 * Industry mapping - maps user input to library filenames
 */
const INDUSTRY_MAPPING = {
  // UCaaS / Cloud Communications
  'ucaas': 'ucaas',
  'cloud communications': 'ucaas',
  'unified communications': 'ucaas',
  'voip': 'ucaas',
  
  // Marketing Agencies
  'marketing agency': 'marketing-agencies',
  'marketing agencies': 'marketing-agencies',
  'digital marketing': 'marketing-agencies',
  'marketing': 'marketing-agencies',
  
  // ICT Hardware
  'ict hardware': 'ict-hardware',
  'hardware': 'ict-hardware',
  'it hardware': 'ict-hardware',
  
  // Telecom Service Providers
  'telecom service provider': 'telecom-service-providers',
  'telecom services': 'telecom-service-providers',
  'telecommunications': 'telecom-service-providers',
  
  // Telecom Software
  'telecom software': 'telecom-software',
  'telecommunications software': 'telecom-software',
  
  // AI Infrastructure
  'ai infrastructure': 'ai-infrastructure',
  'artificial intelligence infrastructure': 'ai-infrastructure',
  
  // Digital Infrastructure
  'digital infrastructure': 'digital-infrastructure',
  
  // Data Center
  'data center': 'data-center',
  'datacenter': 'data-center',
  'data centre': 'data-center',
  
  // Fintech
  'fintech': 'fintech',
  'financial technology': 'fintech',
  'financial services': 'fintech',
  
  // Cybersecurity
  'cybersecurity': 'cybersecurity',
  'cyber security': 'cybersecurity',
  'infosec': 'cybersecurity',
  'security': 'cybersecurity',
  
  // SaaS B2B
  'saas': 'saas-b2b',
  'saas b2b': 'saas-b2b',
  'software as a service': 'saas-b2b',
  'b2b saas': 'saas-b2b',
  
  // Managed Service Providers
  'msp': 'managed-service-providers',
  'managed service provider': 'managed-service-providers',
  'managed services': 'managed-service-providers',
  
  // AI Startups
  'ai startup': 'ai-startups',
  'ai startups': 'ai-startups',
  'artificial intelligence startup': 'ai-startups',
  
  // Mobile Connectivity/eSIM
  'mobile connectivity': 'mobile-connectivity-esim',
  'esim': 'mobile-connectivity-esim',
  'mobile': 'mobile-connectivity-esim'
};

/**
 * Get available industries (auto-detect from folder)
 * @returns {Array} - List of available industry IDs
 */
function getAvailableIndustries() {
  try {
    if (!fs.existsSync(LIBRARIES_PATH)) {
      console.warn('⚠️  FAQ libraries folder not found. Creating it...');
      fs.mkdirSync(LIBRARIES_PATH, { recursive: true });
      return [];
    }

    const files = fs.readdirSync(LIBRARIES_PATH);
    const industries = files
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''));

    console.log(`📚 Found ${industries.length} FAQ libraries:`, industries);
    return industries;
  } catch (error) {
    console.error('❌ Error reading FAQ libraries:', error);
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
 * Load FAQ library for an industry
 * @param {string} industry - Industry name
 * @returns {Object|null} - Loaded library or null
 */
function loadLibrary(industry) {
  const normalized = normalizeIndustry(industry);
  
  if (!normalized) {
    console.log(`⚠️  No mapping found for industry: ${industry}`);
    return null;
  }
  
  const filePath = path.join(LIBRARIES_PATH, `${normalized}.json`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  Library not found: ${normalized}.json`);
    return null;
  }
  
  try {
    const rawData = fs.readFileSync(filePath, 'utf8');
    const library = JSON.parse(rawData);
    
    // Validate library structure
    if (!library.faq_library || !library.faq_library.faqs) {
      console.error(`❌ Invalid library structure in ${normalized}.json`);
      return null;
    }
    
    console.log(`✅ Loaded library: ${library.faq_library.industry} (${library.faq_library.metadata.total_faqs} FAQs)`);
    return library.faq_library;
    
  } catch (error) {
    console.error(`❌ Error loading library ${normalized}.json:`, error.message);
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
      industry: library.faq_library.industry,
      industry_id: library.faq_library.industry_id,
      version: library.faq_library.version,
      total_faqs: library.faq_library.metadata.total_faqs,
      last_updated: library.faq_library.last_updated,
      status: library.faq_library.metadata.completion_status
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
        industry_name: library.faq_library.industry,
        total_faqs: library.faq_library.metadata.total_faqs,
        version: library.faq_library.version,
        status: library.faq_library.metadata.completion_status
      };
    } catch (error) {
      return {
        industry_id: industryId,
        error: 'Failed to load'
      };
    }
  });
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
  INDUSTRY_MAPPING
};