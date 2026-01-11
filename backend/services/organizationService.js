/**
 * Organization Service
 *
 * Manages org + domain context for users and scans.
 * Ensures every NEW scan has organization_id and domain_id populated.
 *
 * Phase 2: Makes org context reliable for usage tracking and recommendations.
 */

const db = require('../db/database');

// =============================================================================
// DOMAIN HELPERS
// =============================================================================

/**
 * Normalize a domain string
 * - Lowercase
 * - Strip www.
 * - Remove trailing slash
 *
 * @param {string} hostname - Raw hostname
 * @returns {string} - Normalized domain
 */
function normalizeDomain(hostname) {
  if (!hostname) return null;

  let normalized = hostname.toLowerCase().trim();

  // Remove www. prefix
  if (normalized.startsWith('www.')) {
    normalized = normalized.substring(4);
  }

  // Remove trailing slash
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Extract hostname from URL robustly
 *
 * @param {string} url - Full URL
 * @returns {string|null} - Hostname or null if invalid
 */
function extractHostname(url) {
  if (!url) return null;

  try {
    // Handle URLs without protocol
    let urlToParse = url;
    if (!url.match(/^https?:\/\//i)) {
      urlToParse = 'https://' + url;
    }

    const parsed = new URL(urlToParse);
    return parsed.hostname;
  } catch (error) {
    // Try regex fallback
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\?#]+)/i);
    return match ? match[1] : null;
  }
}

// =============================================================================
// ORGANIZATION FUNCTIONS
// =============================================================================

/**
 * Get or create organization for a user
 * Uses user_organizations if exists; else creates org + links; else fallback to userId as orgId
 *
 * @param {number} userId - User ID
 * @returns {Promise<{ orgId: number, isNew: boolean, source: string }>}
 */
async function getOrCreateOrgForUser(userId) {
  // First, check if organizations table exists
  const tableCheck = await db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'organizations'
    ) as exists
  `);

  if (!tableCheck.rows[0].exists) {
    // No organizations table - use userId as pseudo-orgId
    return {
      orgId: userId,
      isNew: false,
      source: 'user_id_fallback'
    };
  }

  // Check if user already has an organization via organization_id column
  const userResult = await db.query(
    'SELECT organization_id FROM users WHERE id = $1',
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw new Error(`User ${userId} not found`);
  }

  const existingOrgId = userResult.rows[0].organization_id;

  if (existingOrgId) {
    // User already has an org
    return {
      orgId: existingOrgId,
      isNew: false,
      source: 'user_organization_id'
    };
  }

  // Check if user has an org via organization_members table
  const memberResult = await db.query(`
    SELECT organization_id
    FROM organization_members
    WHERE user_id = $1 AND status = 'active'
    ORDER BY created_at ASC
    LIMIT 1
  `, [userId]);

  if (memberResult.rows.length > 0) {
    const orgId = memberResult.rows[0].organization_id;

    // Update user's organization_id for faster lookups
    await db.query(
      'UPDATE users SET organization_id = $1 WHERE id = $2',
      [orgId, userId]
    );

    return {
      orgId,
      isNew: false,
      source: 'organization_members'
    };
  }

  // No org exists - create one
  const user = await db.query('SELECT email, name FROM users WHERE id = $1', [userId]);
  const userName = user.rows[0]?.name || user.rows[0]?.email?.split('@')[0] || 'User';

  const orgResult = await db.query(`
    INSERT INTO organizations (name, slug, type, owner_user_id, created_at, updated_at)
    VALUES ($1, $2, 'personal', $3, NOW(), NOW())
    RETURNING id
  `, [
    `${userName}'s Organization`,
    `org-${userId}-${Date.now()}`,
    userId
  ]);

  const newOrgId = orgResult.rows[0].id;

  // Link user to org
  await db.query(
    'UPDATE users SET organization_id = $1 WHERE id = $2',
    [newOrgId, userId]
  );

  // Add user as owner member
  await db.query(`
    INSERT INTO organization_members (organization_id, user_id, role_id, status, created_at)
    SELECT $1, $2, r.id, 'active', NOW()
    FROM roles r WHERE r.name = 'owner'
    LIMIT 1
  `, [newOrgId, userId]);

  console.log(`[OrganizationService] Created org ${newOrgId} for user ${userId}`);

  return {
    orgId: newOrgId,
    isNew: true,
    source: 'newly_created'
  };
}

// =============================================================================
// DOMAIN FUNCTIONS
// =============================================================================

/**
 * Get or create domain record
 *
 * @param {number} orgId - Organization ID
 * @param {string} hostname - Raw hostname/URL
 * @returns {Promise<{ domainId: number|null, hostname: string, isNew: boolean }>}
 */
async function getOrCreateDomain(orgId, hostname) {
  const normalizedHostname = normalizeDomain(extractHostname(hostname) || hostname);

  if (!normalizedHostname) {
    return { domainId: null, hostname: null, isNew: false };
  }

  // Check if domains table exists
  const tableCheck = await db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'domains'
    ) as exists
  `);

  if (!tableCheck.rows[0].exists) {
    // No domains table - return null id but still return hostname
    return {
      domainId: null,
      hostname: normalizedHostname,
      isNew: false
    };
  }

  // Check if domain already exists for this org
  const existingResult = await db.query(`
    SELECT id FROM domains
    WHERE organization_id = $1 AND hostname = $2
  `, [orgId, normalizedHostname]);

  if (existingResult.rows.length > 0) {
    return {
      domainId: existingResult.rows[0].id,
      hostname: normalizedHostname,
      isNew: false
    };
  }

  // Create new domain
  const createResult = await db.query(`
    INSERT INTO domains (organization_id, hostname, is_primary, verification_status, created_at, updated_at)
    VALUES ($1, $2, false, 'unverified', NOW(), NOW())
    ON CONFLICT (organization_id, hostname) DO UPDATE SET updated_at = NOW()
    RETURNING id
  `, [orgId, normalizedHostname]);

  console.log(`[OrganizationService] Created domain ${normalizedHostname} for org ${orgId}`);

  return {
    domainId: createResult.rows[0].id,
    hostname: normalizedHostname,
    isNew: true
  };
}

// =============================================================================
// SCAN CONTEXT
// =============================================================================

/**
 * Ensure a scan has org and domain context populated
 * Called after scan creation to set organization_id and domain_id
 *
 * @param {number} scanId - Scan ID
 * @param {number} userId - User ID
 * @param {string} url - Scan URL
 * @returns {Promise<{ organizationId: number, domainId: number|null, updated: boolean }>}
 */
async function ensureScanHasOrgContext(scanId, userId, url) {
  // Get or create org for user
  const { orgId } = await getOrCreateOrgForUser(userId);

  // Get or create domain
  const { domainId, hostname } = await getOrCreateDomain(orgId, url);

  // Check if scan already has context
  const scanResult = await db.query(
    'SELECT organization_id, domain_id FROM scans WHERE id = $1',
    [scanId]
  );

  if (scanResult.rows.length === 0) {
    throw new Error(`Scan ${scanId} not found`);
  }

  const scan = scanResult.rows[0];

  // Update if missing
  if (!scan.organization_id || !scan.domain_id) {
    await db.query(`
      UPDATE scans
      SET organization_id = COALESCE(organization_id, $1),
          domain_id = COALESCE(domain_id, $2),
          updated_at = NOW()
      WHERE id = $3
    `, [orgId, domainId, scanId]);

    console.log(`[OrganizationService] Set scan ${scanId} context: org=${orgId}, domain=${domainId}`);

    return {
      organizationId: orgId,
      domainId,
      updated: true
    };
  }

  return {
    organizationId: scan.organization_id,
    domainId: scan.domain_id,
    updated: false
  };
}

/**
 * Get org context for a user (for request enrichment)
 *
 * @param {number} userId - User ID
 * @returns {Promise<{ orgId: number, domainCount: number } | null>}
 */
async function getOrgContext(userId) {
  try {
    const { orgId } = await getOrCreateOrgForUser(userId);

    // Get domain count if domains table exists
    let domainCount = 0;
    try {
      const countResult = await db.query(
        'SELECT COUNT(*) as count FROM domains WHERE organization_id = $1',
        [orgId]
      );
      domainCount = parseInt(countResult.rows[0].count) || 0;
    } catch (e) {
      // Domains table might not exist
    }

    return { orgId, domainCount };
  } catch (error) {
    console.error('[OrganizationService] Error getting org context:', error.message);
    return null;
  }
}

// =============================================================================
// MAINTENANCE HELPERS
// =============================================================================

/**
 * Backfill org IDs for scans that are missing them
 * Safe to run - only updates scans without org context
 *
 * @param {object} options
 * @param {number} options.limit - Max scans to process
 * @returns {Promise<{ processed: number, updated: number, errors: number }>}
 */
async function backfillScanOrgIds({ limit = 100 } = {}) {
  console.log(`[OrganizationService] Starting backfill (limit: ${limit})...`);

  const result = await db.query(`
    SELECT s.id, s.user_id, s.url, s.domain
    FROM scans s
    WHERE s.organization_id IS NULL
      AND s.user_id IS NOT NULL
    ORDER BY s.created_at DESC
    LIMIT $1
  `, [limit]);

  let processed = 0;
  let updated = 0;
  let errors = 0;

  for (const scan of result.rows) {
    try {
      const url = scan.url || scan.domain;
      if (url) {
        await ensureScanHasOrgContext(scan.id, scan.user_id, url);
        updated++;
      }
      processed++;
    } catch (error) {
      console.error(`[OrganizationService] Backfill error for scan ${scan.id}:`, error.message);
      errors++;
      processed++;
    }
  }

  console.log(`[OrganizationService] Backfill complete: ${processed} processed, ${updated} updated, ${errors} errors`);

  return { processed, updated, errors };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Domain helpers
  normalizeDomain,
  extractHostname,

  // Organization functions
  getOrCreateOrgForUser,

  // Domain functions
  getOrCreateDomain,

  // Scan context
  ensureScanHasOrgContext,
  getOrgContext,

  // Maintenance
  backfillScanOrgIds
};
