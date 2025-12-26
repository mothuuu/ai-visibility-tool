/**
 * Campaign Run Service
 *
 * Orchestrates the "Start Submissions" flow:
 * 1. Validate prerequisites (profile complete, no active campaign)
 * 2. Create immutable campaign run with snapshots
 * 3. Select directories based on entitlement + priority + filters
 * 4. Create directory_submissions records
 * 5. Consume entitlement
 *
 * UPDATED: Uses transactions for atomicity and row locks for race condition prevention
 * UPDATED: Distinct error codes for NO_ENTITLEMENT vs NO_ELIGIBLE_DIRECTORIES vs DIRECTORIES_NOT_SEEDED
 */

const db = require('../db/database');
const entitlementService = require('./entitlementService');
const { USABLE_ORDER_STATUSES } = require('./entitlementService');
const { normalizePlan } = require('../utils/planUtils');

// Debug logging helper - only logs when CITATION_DEBUG=1
function debugLog(requestId, ...args) {
  if (process.env.CITATION_DEBUG === '1') {
    const prefix = requestId ? `[CampaignRun:${requestId}]` : '[CampaignRun]';
    console.log(prefix, ...args);
  }
}

// Generate a unique request ID
function generateRequestId() {
  try {
    return require('crypto').randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

class CampaignRunService {

  /**
   * Start submissions - main entry point
   * FIXED: Uses transaction for atomicity
   *
   * @param {number} userId - User ID
   * @param {object} filters - Directory filters
   * @param {object} options - Options including requestId
   */
  async startSubmissions(userId, filters = {}, options = {}) {
    const requestId = options.requestId || generateRequestId();

    debugLog(requestId, '========== START SUBMISSIONS ==========');
    debugLog(requestId, 'userId:', userId, 'type:', typeof userId);
    debugLog(requestId, 'filters:', JSON.stringify(filters));

    const client = await db.getClient();
    debugLog(requestId, 'DB client acquired');

    try {
      await client.query('BEGIN');
      debugLog(requestId, 'Transaction started');

      // 0. Check if directories table is seeded
      debugLog(requestId, 'Step 0: Checking directories table...');
      const directoriesCheck = await this.checkDirectoriesSeeded(client);
      debugLog(requestId, 'Directories check:', directoriesCheck);

      if (!directoriesCheck.hasActive) {
        debugLog(requestId, 'DIRECTORIES_NOT_SEEDED - no active directories');
        throw new Error('DIRECTORIES_NOT_SEEDED');
      }
      if (!directoriesCheck.hasEligible) {
        debugLog(requestId, 'DIRECTORIES_NOT_SEEDED - no eligible (free/freemium) directories');
        throw new Error('DIRECTORIES_NOT_SEEDED');
      }

      // 1. Validate prerequisites
      debugLog(requestId, 'Step 1: Validating prerequisites...');
      const validation = await this.validatePrerequisites(userId);
      debugLog(requestId, 'Validation result:', validation);
      if (!validation.valid) {
        debugLog(requestId, 'Validation FAILED:', validation.error);
        throw new Error(validation.error);
      }

      // 2. Check for existing active campaign (with row lock)
      debugLog(requestId, 'Step 2: Checking for active campaign...');
      const activeCampaign = await this.getActiveCampaignWithLock(client, userId);
      if (activeCampaign) {
        debugLog(requestId, 'Active campaign exists:', activeCampaign.id);
        throw new Error('ACTIVE_CAMPAIGN_EXISTS');
      }

      // 3. Get entitlement
      debugLog(requestId, 'Step 3: Calculating entitlement...');
      const entitlement = await entitlementService.calculateEntitlement(userId, { requestId });

      debugLog(requestId, 'Entitlement result:', {
        remaining: entitlement.remaining,
        total: entitlement.total,
        used: entitlement.used,
        isSubscriber: entitlement.isSubscriber,
        plan: entitlement.plan,
        subscriptionRemaining: entitlement.breakdown?.subscriptionRemaining,
        ordersRemaining: entitlement.breakdown?.ordersRemaining
      });

      if (entitlement.remaining <= 0) {
        debugLog(requestId, 'NO_ENTITLEMENT - remaining is', entitlement.remaining);
        // Attach entitlement info to error for better debugging
        const error = new Error('NO_ENTITLEMENT');
        error.entitlement = entitlement;
        throw error;
      }

      // 4. Get business profile
      debugLog(requestId, 'Step 4: Getting business profile...');
      const profile = await this.getBusinessProfile(userId);
      debugLog(requestId, 'Profile:', profile ? {
        id: profile.id,
        business_name: profile.business_name
      } : 'NULL');

      // 5. Create campaign run (within transaction)
      debugLog(requestId, 'Step 5: Creating campaign run...');
      const campaignRun = await this.createCampaignRunTx(client, userId, profile, entitlement, filters);
      debugLog(requestId, 'Campaign run created:', campaignRun.id);

      // 6. Select directories
      debugLog(requestId, 'Step 6: Selecting directories (limit:', entitlement.remaining, ')...');
      const directories = await this.selectDirectoriesTx(client, campaignRun, filters, entitlement.remaining);

      debugLog(requestId, 'Directories selected:', {
        count: directories.length,
        firstThree: directories.slice(0, 3).map(d => ({ id: d.id, name: d.name }))
      });

      if (directories.length === 0) {
        debugLog(requestId, 'NO_ELIGIBLE_DIRECTORIES - entitlement OK but no directories match filters');
        // Update campaign status to failed
        await client.query(`
          UPDATE campaign_runs
          SET status = 'failed',
              error_message = $2,
              error_details = $3,
              updated_at = NOW()
          WHERE id = $1
        `, [campaignRun.id, 'No eligible directories found matching your criteria', JSON.stringify({ filters, entitlement: { remaining: entitlement.remaining } })]);

        const error = new Error('NO_ELIGIBLE_DIRECTORIES');
        error.entitlement = entitlement;
        throw error;
      }

      // 7. Create submission records (within transaction)
      debugLog(requestId, 'Step 7: Creating', directories.length, 'submission records...');
      const submissions = await this.createSubmissionsTx(client, campaignRun, directories);
      debugLog(requestId, 'Submissions created:', submissions.length);

      // 8. Consume entitlement (within transaction)
      debugLog(requestId, 'Step 8: Consuming', submissions.length, 'from entitlement...');
      await this.consumeEntitlementTx(client, userId, submissions.length, entitlement);
      debugLog(requestId, 'Entitlement consumed');

      // 9. Update campaign run status
      debugLog(requestId, 'Step 9: Updating campaign run status to queued...');
      await client.query(`
        UPDATE campaign_runs
        SET status = 'queued',
            directories_selected = $2,
            directories_queued = $2,
            started_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `, [campaignRun.id, submissions.length]);

      await client.query('COMMIT');
      debugLog(requestId, 'Transaction committed successfully');

      return {
        campaignRunId: campaignRun.id,
        directoriesQueued: submissions.length,
        entitlementRemaining: entitlement.remaining - submissions.length,
        submissions: submissions.map(s => ({
          id: s.id,
          directoryName: s.directory_snapshot?.name || s.directory_name,
          status: s.status,
          queuePosition: s.queue_position
        }))
      };

    } catch (error) {
      await client.query('ROLLBACK');
      debugLog(requestId, 'Transaction rolled back due to error:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if directories table is properly seeded
   * Returns { hasActive, hasEligible, activeCount, eligibleCount }
   */
  async checkDirectoriesSeeded(client) {
    const result = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = true) as active,
        COUNT(*) FILTER (WHERE is_active = true AND pricing_model IN ('free', 'freemium')) as eligible
      FROM directories
    `);

    const row = result.rows[0];
    return {
      hasActive: parseInt(row.active) > 0,
      hasEligible: parseInt(row.eligible) > 0,
      activeCount: parseInt(row.active),
      eligibleCount: parseInt(row.eligible),
      totalCount: parseInt(row.total)
    };
  }

  /**
   * Get active campaign with row lock to prevent race condition
   */
  async getActiveCampaignWithLock(client, userId) {
    const result = await client.query(`
      SELECT id, status, created_at
      FROM campaign_runs
      WHERE user_id = $1
        AND status IN ('created', 'selecting', 'queued', 'in_progress', 'paused')
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `, [userId]);

    return result.rows[0] || null;
  }

  /**
   * Validate prerequisites before starting
   */
  async validatePrerequisites(userId) {
    debugLog(null, 'validatePrerequisites for user:', userId);

    // Check business profile
    const profile = await this.getBusinessProfile(userId);

    if (!profile) {
      debugLog(null, 'No profile found for user', userId);
      return { valid: false, error: 'PROFILE_REQUIRED' };
    }

    debugLog(null, 'Profile found:', {
      id: profile.id,
      business_name: profile.business_name,
      website_url: profile.website_url ? 'present' : 'missing',
      short_description: profile.short_description ? 'present' : 'missing'
    });

    // Check minimum profile completeness
    const requiredFields = ['business_name', 'website_url', 'short_description'];
    for (const field of requiredFields) {
      if (!profile[field]) {
        debugLog(null, 'Missing required field:', field);
        return { valid: false, error: `PROFILE_INCOMPLETE:${field}` };
      }
    }

    debugLog(null, 'All prerequisites met');
    return { valid: true };
  }

  /**
   * Check for existing active campaign
   */
  async getActiveCampaign(userId) {
    const result = await db.query(`
      SELECT id, status, created_at
      FROM campaign_runs
      WHERE user_id = $1
        AND status IN ('created', 'selecting', 'queued', 'in_progress')
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);

    return result.rows[0] || null;
  }

  /**
   * Get business profile - uses ORDER BY to get most recent
   */
  async getBusinessProfile(userId) {
    const result = await db.query(`
      SELECT * FROM business_profiles
      WHERE user_id = $1
      ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
      LIMIT 1
    `, [userId]);
    return result.rows[0] || null;
  }

  /**
   * Create campaign run with snapshots
   */
  async createCampaignRun(userId, profile, entitlement, filters) {
    return this.createCampaignRunTx({ query: db.query.bind(db) }, userId, profile, entitlement, filters);
  }

  /**
   * Create campaign run with snapshots - transaction version
   */
  async createCampaignRunTx(client, userId, profile, entitlement, filters) {
    // Build profile snapshot (copy all relevant fields)
    const profileSnapshot = {
      id: profile.id,
      business_name: profile.business_name,
      website_url: profile.website_url,
      short_description: profile.short_description,
      business_description: profile.business_description,
      logo_url: profile.logo_url,
      phone: profile.phone,
      email: profile.email,
      address_line1: profile.address_line1,
      address_line2: profile.address_line2,
      city: profile.city,
      state: profile.state,
      country: profile.country,
      postal_code: profile.postal_code,
      primary_category: profile.primary_category,
      secondary_categories: profile.secondary_categories,
      social_links: profile.social_links,
      year_founded: profile.year_founded,
      number_of_employees: profile.number_of_employees,
      snapshot_at: new Date().toISOString()
    };

    // Build filters snapshot with defaults
    const filtersSnapshot = {
      phone_policy: filters.phone_policy || 'managed_only',
      exclude_customer_owned: filters.exclude_customer_owned !== false, // default true
      directory_types: filters.directory_types || null, // null = all types
      regions: filters.regions || ['global'],
      tiers: filters.tiers || [1, 2, 3],
      applied_at: new Date().toISOString()
    };

    const result = await client.query(`
      INSERT INTO campaign_runs (
        user_id,
        business_profile_id,
        profile_snapshot,
        plan_at_run,
        entitlement_source,
        entitlement_source_id,
        directories_entitled,
        filters_snapshot,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'selecting')
      RETURNING *
    `, [
      userId,
      profile.id,
      JSON.stringify(profileSnapshot),
      entitlement.plan,
      entitlement.source,
      entitlement.sourceId,
      entitlement.remaining,
      JSON.stringify(filtersSnapshot)
    ]);

    return result.rows[0];
  }

  /**
   * Consume entitlement within transaction
   * FIXED: Consume from subscription first, then orders
   */
  async consumeEntitlementTx(client, userId, count, entitlement) {
    if (count <= 0) return;

    let remaining = count;

    // 1. Try subscription first (if subscriber)
    if (entitlement.isSubscriber && remaining > 0) {
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth();
      const periodStartStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;

      // Get current allocation
      const subscriptionAvailable = entitlement.breakdown?.subscriptionRemaining || 0;
      const toConsumeFromSubscription = Math.min(subscriptionAvailable, remaining);

      if (toConsumeFromSubscription > 0) {
        await client.query(`
          UPDATE subscriber_directory_allocations
          SET submissions_used = submissions_used + $1,
              updated_at = NOW()
          WHERE user_id = $2 AND period_start = $3::date
        `, [toConsumeFromSubscription, userId, periodStartStr]);

        remaining -= toConsumeFromSubscription;
      }
    }

    // 2. Consume remaining from orders (FIFO) - use unified status definitions
    if (remaining > 0) {
      const orders = await client.query(`
        SELECT id, directories_allocated, directories_submitted
        FROM directory_orders
        WHERE user_id = $1
          AND status = ANY($2::text[])
          AND directories_submitted < directories_allocated
        ORDER BY created_at ASC
      `, [userId, USABLE_ORDER_STATUSES]);

      for (const order of orders.rows) {
        if (remaining <= 0) break;

        const available = order.directories_allocated - order.directories_submitted;
        const toConsume = Math.min(available, remaining);

        await client.query(`
          UPDATE directory_orders
          SET directories_submitted = directories_submitted + $1,
              updated_at = NOW()
          WHERE id = $2
        `, [toConsume, order.id]);

        remaining -= toConsume;
      }
    }

    if (remaining > 0) {
      console.warn(`Could not consume all entitlement. Remaining: ${remaining}`);
    }
  }

  /**
   * Select directories based on entitlement + priority + filters
   * FIXED: Uses correct schema columns (tier, region_scope)
   */
  async selectDirectories(campaignRun, filters, limit) {
    return this.selectDirectoriesTx({ query: db.query.bind(db) }, campaignRun, filters, limit);
  }

  /**
   * Select directories - transaction version
   * FIXED: Uses correct schema columns (tier, region_scope)
   */
  async selectDirectoriesTx(client, campaignRun, filters, limit) {
    const filtersSnapshot = typeof campaignRun.filters_snapshot === 'string'
      ? JSON.parse(campaignRun.filters_snapshot)
      : campaignRun.filters_snapshot;

    // Build WHERE conditions
    const conditions = ['d.is_active = true'];
    const params = [];
    let paramIndex = 1;

    // Filter: pricing (only free/freemium)
    conditions.push(`d.pricing_model IN ('free', 'freemium')`);

    // Filter: regions (region_scope is VARCHAR, not array)
    // Match directories where region_scope is 'global' OR in the requested regions
    if (filtersSnapshot.regions && filtersSnapshot.regions.length > 0) {
      const regions = [...new Set(['global', ...filtersSnapshot.regions])];
      conditions.push(`d.region_scope = ANY($${paramIndex}::text[])`);
      params.push(regions);
      paramIndex++;
    }

    // Filter: tiers (column is 'tier', not 'tier_num')
    if (filtersSnapshot.tiers && filtersSnapshot.tiers.length > 0) {
      conditions.push(`d.tier = ANY($${paramIndex}::int[])`);
      params.push(filtersSnapshot.tiers);
      paramIndex++;
    }

    // Filter: directory types
    if (filtersSnapshot.directory_types && filtersSnapshot.directory_types.length > 0) {
      conditions.push(`d.directory_type = ANY($${paramIndex}::text[])`);
      params.push(filtersSnapshot.directory_types);
      paramIndex++;
    }

    // Filter: exclude customer-owned directories
    if (filtersSnapshot.exclude_customer_owned) {
      conditions.push(`d.requires_customer_account = false`);
    }

    // Filter: phone policy
    if (filtersSnapshot.phone_policy === 'never') {
      conditions.push(`d.requires_phone_verification = false`);
      conditions.push(`d.publishes_phone_publicly = false`);
    } else if (filtersSnapshot.phone_policy === 'managed_only') {
      // Allow phone but not customer-owned that require phone
      conditions.push(`(d.requires_customer_account = false OR d.requires_phone_verification = false)`);
    }
    // 'case_by_case' = no additional filtering

    // Exclude already submitted directories (from any campaign)
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM directory_submissions ds
      WHERE ds.directory_id = d.id
        AND ds.user_id = $${paramIndex}
        AND ds.status NOT IN ('failed', 'skipped', 'blocked', 'rejected')
    )`);
    params.push(campaignRun.user_id);
    paramIndex++;

    // Add limit
    params.push(limit);

    const query = `
      SELECT
        d.*
      FROM directories d
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        COALESCE(d.priority_score, 0) DESC,
        d.tier ASC,
        d.name ASC
      LIMIT $${paramIndex}
    `;

    debugLog(null, 'selectDirectories query:', query);
    debugLog(null, 'selectDirectories params:', params);

    const result = await client.query(query, params);
    return result.rows;
  }

  /**
   * Create submission records for selected directories
   * UPDATED with correct column mapping
   */
  async createSubmissions(campaignRun, directories) {
    return this.createSubmissionsTx({ query: db.query.bind(db) }, campaignRun, directories);
  }

  /**
   * Create submission records - transaction version
   * UPDATED with correct column mapping
   */
  async createSubmissionsTx(client, campaignRun, directories) {
    if (directories.length === 0) {
      return [];
    }

    const submissions = [];

    for (let i = 0; i < directories.length; i++) {
      const directory = directories[i];

      // Create directory snapshot with actual column names
      const directorySnapshot = {
        id: directory.id,
        name: directory.name,
        slug: directory.slug || directory.name.toLowerCase().replace(/\s+/g, '-'),
        website_url: directory.url || directory.website_url,
        submission_url: directory.submission_url,
        submission_mode: directory.submission_mode || 'manual',
        verification_method: directory.verification_method || 'email',
        requires_account: directory.requires_account ?? true,
        requires_customer_account: directory.requires_customer_account || false,
        account_creation_url: directory.account_creation_url,
        required_fields: directory.required_fields || ["name", "url", "short_description"],
        approval_type: directory.approval_type || 'review',
        typical_approval_days: directory.typical_approval_days || 7,
        tier: directory.tier,
        priority_score: directory.priority_score,
        pricing_model: directory.pricing_model,
        directory_type: directory.directory_type,
        snapshot_at: new Date().toISOString()
      };

      const verificationStatus = (directory.verification_method === 'none' || !directory.verification_method)
        ? 'not_required'
        : 'pending';

      const result = await client.query(`
        INSERT INTO directory_submissions (
          campaign_run_id,
          user_id,
          directory_id,
          directory_name,
          directory_url,
          directory_snapshot,
          status,
          verification_type,
          verification_status,
          priority_score,
          queue_position,
          queued_at,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9, $10, NOW(), NOW(), NOW())
        RETURNING *
      `, [
        campaignRun.id,
        campaignRun.user_id,
        directory.id,
        directory.name,
        directory.url || directory.website_url,
        JSON.stringify(directorySnapshot),
        directory.verification_method || 'email',
        verificationStatus,
        directory.priority_score || 50,
        i + 1 // queue position (1-indexed)
      ]);

      submissions.push(result.rows[0]);
    }

    return submissions;
  }

  /**
   * Update campaign run status and counts
   */
  async updateCampaignStatus(campaignRunId, status, updates = {}) {
    const setClauses = ['status = $2', 'updated_at = NOW()'];
    const params = [campaignRunId, status];
    let paramIndex = 3;

    const allowedFields = [
      'directories_selected', 'directories_queued', 'directories_submitted',
      'directories_live', 'directories_failed', 'directories_action_needed',
      'started_at', 'completed_at', 'error_message', 'error_details'
    ];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    await db.query(`
      UPDATE campaign_runs
      SET ${setClauses.join(', ')}
      WHERE id = $1
    `, params);
  }

  /**
   * Get campaign run with submissions
   */
  async getCampaignRun(campaignRunId, userId) {
    const campaign = await db.query(`
      SELECT * FROM campaign_runs
      WHERE id = $1 AND user_id = $2
    `, [campaignRunId, userId]);

    if (campaign.rows.length === 0) {
      return null;
    }

    const submissions = await db.query(`
      SELECT * FROM directory_submissions
      WHERE campaign_run_id = $1
      ORDER BY queue_position ASC
    `, [campaignRunId]);

    return {
      ...campaign.rows[0],
      submissions: submissions.rows
    };
  }

  /**
   * Get all campaign runs for a user
   */
  async getCampaignRuns(userId, options = {}) {
    const { limit = 20, offset = 0 } = options;

    const result = await db.query(`
      SELECT * FROM campaign_runs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);

    return result.rows;
  }

  /**
   * Get all submissions for a user (across all campaigns)
   */
  async getUserSubmissions(userId, options = {}) {
    const { status, limit = 50, offset = 0 } = options;

    let query = `
      SELECT
        ds.*,
        d.name as directory_name,
        d.logo_url as directory_logo,
        d.website_url as directory_website,
        cr.status as campaign_status
      FROM directory_submissions ds
      LEFT JOIN directories d ON ds.directory_id = d.id
      LEFT JOIN campaign_runs cr ON ds.campaign_run_id = cr.id
      WHERE ds.user_id = $1
    `;

    const params = [userId];
    let paramIndex = 2;

    if (status) {
      if (Array.isArray(status)) {
        query += ` AND ds.status = ANY($${paramIndex})`;
        params.push(status);
      } else {
        query += ` AND ds.status = $${paramIndex}`;
        params.push(status);
      }
      paramIndex++;
    }

    query += ` ORDER BY ds.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get submission counts by status
   */
  async getSubmissionCounts(userId) {
    const result = await db.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM directory_submissions
      WHERE user_id = $1
      GROUP BY status
    `, [userId]);

    const counts = {
      total: 0,
      queued: 0,
      in_progress: 0,
      submitted: 0,
      pending_verification: 0,
      pending_approval: 0,
      action_needed: 0,
      needs_action: 0,
      live: 0,
      verified: 0,
      rejected: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0
    };

    for (const row of result.rows) {
      counts[row.status] = parseInt(row.count);
      counts.total += parseInt(row.count);
    }

    // Combine action_needed and needs_action for display
    counts.action_needed = (counts.action_needed || 0) + (counts.needs_action || 0);

    return counts;
  }

  /**
   * Pause a campaign run
   */
  async pauseCampaign(campaignRunId, userId) {
    const result = await db.query(`
      UPDATE campaign_runs
      SET status = 'paused', updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'in_progress')
      RETURNING *
    `, [campaignRunId, userId]);

    return result.rows[0] || null;
  }

  /**
   * Resume a paused campaign
   */
  async resumeCampaign(campaignRunId, userId) {
    const result = await db.query(`
      UPDATE campaign_runs
      SET status = 'queued', updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND status = 'paused'
      RETURNING *
    `, [campaignRunId, userId]);

    return result.rows[0] || null;
  }

  /**
   * Cancel a campaign run
   */
  async cancelCampaign(campaignRunId, userId) {
    // Get campaign first
    const campaign = await db.query(`
      SELECT * FROM campaign_runs
      WHERE id = $1 AND user_id = $2
    `, [campaignRunId, userId]);

    if (campaign.rows.length === 0) {
      return null;
    }

    // Update campaign status
    await db.query(`
      UPDATE campaign_runs
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1
    `, [campaignRunId]);

    // Mark queued submissions as cancelled
    await db.query(`
      UPDATE directory_submissions
      SET status = 'cancelled', updated_at = NOW()
      WHERE campaign_run_id = $1 AND status = 'queued'
    `, [campaignRunId]);

    return { ...campaign.rows[0], status: 'cancelled' };
  }

  /**
   * Refresh campaign counts from submissions
   */
  async refreshCampaignCounts(campaignRunId) {
    const counts = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued') as queued,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status IN ('submitted', 'pending_approval')) as submitted,
        COUNT(*) FILTER (WHERE status = 'live' OR status = 'verified') as live,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status IN ('action_needed', 'needs_action', 'pending_verification')) as action_needed
      FROM directory_submissions
      WHERE campaign_run_id = $1
    `, [campaignRunId]);

    if (counts.rows.length > 0) {
      const c = counts.rows[0];
      await db.query(`
        UPDATE campaign_runs
        SET
          directories_queued = $2,
          directories_submitted = $3,
          directories_live = $4,
          directories_failed = $5,
          directories_action_needed = $6,
          updated_at = NOW()
        WHERE id = $1
      `, [
        campaignRunId,
        parseInt(c.queued) + parseInt(c.in_progress),
        parseInt(c.submitted),
        parseInt(c.live),
        parseInt(c.failed),
        parseInt(c.action_needed)
      ]);
    }
  }
}

module.exports = new CampaignRunService();
module.exports.generateRequestId = generateRequestId;
