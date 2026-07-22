/**
 * schemaFamilies.js — Single source of truth for schema.org type families used
 * in detection.
 *
 * Currently defines the Organization family: the set of schema.org @type values
 * that count as valid organization markup. Google (and AI answer engines) treat
 * Organization subtypes such as LocalBusiness / RealEstateAgent / Corporation as
 * valid organization identity — so the detector must too.
 *
 * This is deliberately an EXPLICIT ALLOWLIST, not a schema.org graph traversal:
 * deterministic, reviewable, and cheap. When a new organization subtype turns up
 * in the wild, APPEND it here — this one constant feeds every consumer.
 *
 * Consumers:
 *   - backend/analyzers/content-extractor.js   (sets technical.hasOrganizationSchema)
 *   - backend/phase2_preserved/evidenceHelpers.js (hasOrganizationSchema fallback)
 */

'use strict';

// schema.org Organization type family — exact-match against @type values.
const ORGANIZATION_SCHEMA_FAMILY = new Set([
  'Organization',
  // Common direct subtypes
  'LocalBusiness', 'Corporation', 'ProfessionalService', 'OnlineBusiness',
  'EducationalOrganization', 'GovernmentOrganization', 'MedicalOrganization',
  'NGO', 'NewsMediaOrganization', 'SportsOrganization', 'PerformingGroup',
  'Airline', 'Consortium', 'FundingScheme', 'LibrarySystem', 'ResearchOrganization',
  'WorkersUnion',
  // High-frequency LocalBusiness subtypes seen in our verticals
  'RealEstateAgent', 'Restaurant', 'Store', 'Hotel', 'Resort', 'LodgingBusiness',
  'FinancialService', 'LegalService', 'MedicalBusiness', 'AutomotiveBusiness',
  'FoodEstablishment', 'HealthAndBeautyBusiness', 'HomeAndConstructionBusiness',
  'TravelAgency', 'Dentist', 'Physician', 'AccountingService', 'InsuranceAgency',
  'RealEstateListing'
]);

/**
 * Is a single @type value (string OR array) in the Organization family?
 * JSON-LD permits `"@type": ["RealEstateAgent", "Organization"]`, so every
 * element of an array is checked. Non-string / empty values are ignored.
 * @param {string|string[]|*} typeValue
 * @returns {boolean}
 */
function isOrgFamilyType(typeValue) {
  if (!typeValue) return false;
  if (Array.isArray(typeValue)) {
    return typeValue.some(t => typeof t === 'string' && ORGANIZATION_SCHEMA_FAMILY.has(t));
  }
  return typeof typeValue === 'string' && ORGANIZATION_SCHEMA_FAMILY.has(typeValue);
}

/**
 * Does any @type value in an iterable of type strings belong to the family?
 * Accepts a Set or Array (e.g. the `allSchemaTypes` set produced by
 * content-extractor's recursive `extractAllSchemaTypes`).
 * @param {Iterable<string>} types
 * @returns {boolean}
 */
function anyOrgFamilyInTypes(types) {
  if (!types || typeof types[Symbol.iterator] !== 'function') return false;
  for (const t of types) {
    if (isOrgFamilyType(t)) return true;
  }
  return false;
}

/**
 * Recursively walk a parsed JSON-LD object/array collecting @type values and
 * test them against the Organization family. Mirrors the traversal used to
 * build `allSchemaTypes` (handles @graph arrays, nested objects, @type arrays),
 * but is self-contained so evidence-stage callers can re-check stored `raw`
 * blocks whose top-level `type` is null (the common @graph shape).
 *
 * Never throws: non-object input returns false.
 * @param {*} obj - parsed JSON-LD value
 * @returns {boolean}
 */
function rawJsonLdHasOrgFamily(obj) {
  if (!obj || typeof obj !== 'object') return false;

  if (Array.isArray(obj)) {
    return obj.some(item => rawJsonLdHasOrgFamily(item));
  }

  if (isOrgFamilyType(obj['@type'])) return true;

  for (const key in obj) {
    if (key === '@type') continue;
    const val = obj[key];
    if (val && typeof val === 'object' && rawJsonLdHasOrgFamily(val)) return true;
  }
  return false;
}

module.exports = {
  ORGANIZATION_SCHEMA_FAMILY,
  isOrgFamilyType,
  anyOrgFamilyInTypes,
  rawJsonLdHasOrgFamily,
};
