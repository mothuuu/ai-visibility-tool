/**
 * Scan-extraction generator (REAL).
 *
 * Pulls core identity fields straight from the user's existing completed scan.
 * This never triggers a new scan — it only reads scan.detailed_analysis and the
 * scans.industry column that are already present.
 *
 *   company_name         derived from the scanned URL hostname (deterministic)
 *   industry             scans.industry column
 *   location             best-effort from detailed_analysis entities, else null
 *   business_description best-effort from detailed_analysis meta, else null
 *
 * Fields that can't be found degrade to null (not an error).
 */

const { URL } = require('url');

/**
 * Turn a scanned URL into a human-ish company name: "https://www.acme-co.com/x"
 * -> "Acme-co". Returns null if the URL can't be parsed.
 */
function deriveCompanyName(rawUrl) {
  if (!rawUrl) return null;
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./i, '');
    const core = host.split('.')[0];
    if (!core) return null;
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch {
    return null;
  }
}

/**
 * Best-effort dig for a business description from the scan's analysis blob.
 * The exact shape varies by rubric version, so every access is optional.
 */
function extractDescription(detailedAnalysis) {
  const da = detailedAnalysis || {};
  const ev = da.scanEvidence || {};
  return (
    da.meta?.description ||
    ev.technical?.metaTags?.description ||
    ev.technical?.meta?.description ||
    ev.content?.metaDescription ||
    null
  );
}

/**
 * Best-effort dig for a primary location from extracted entities.
 */
function extractLocation(detailedAnalysis) {
  const ev = (detailedAnalysis || {}).scanEvidence || {};
  const locations = ev.entities?.locations;
  if (Array.isArray(locations) && locations.length > 0) {
    return locations[0] || null;
  }
  return null;
}

module.exports = {
  name: 'scan_extraction',
  automated: true,

  empty() {
    return {
      company_name: null,
      industry: null,
      location: null,
      business_description: null,
    };
  },

  async run({ scan }) {
    return {
      company_name: deriveCompanyName(scan.url),
      industry: scan.industry || null,
      location: extractLocation(scan.detailed_analysis),
      business_description: extractDescription(scan.detailed_analysis),
    };
  },
};
