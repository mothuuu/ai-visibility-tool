/**
 * Campaign Run Service
 *
 * Orchestrates the "Start Submissions" flow:
 * 1. Validate prerequisites (profile complete, no active campaign)
 * 2. Create immutable campaign run with snapshots
 * 3. Select directories based on entitlement + priority + filters
 * 4. Create directory_submissions records
 * 5. Consume entitlement
 */

const db = require('../db/database');
const entitlementService = require('./entitlementService');

class CampaignRunService {

  /**
   * Start submissions - main entry point
   */
  async startSubmissions(userId, filters = {}) {
    // 1. Validate prerequisites
    const validation = await this.validatePrerequisites(userId);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // 2. Check for existing active campaign
    const activeCampaign = await this.getActiveCampaign(userId);
    if (activeCampaign) {
      throw new Error('ACTIVE_CAMPAIGN_EXISTS');
    }

    // 3. Get entitlement
    const entitlement = await entitlementService.calculateEntitlement(userId);
    if (entitlement.remaining <= 0) {
      throw new Error('NO_ENTITLEMENT');
    }

    // 4. Get business profile
    const profile = await this.getBusinessProfile(userId);

    // 5. Create campaign run (immutable snapshot)
    const campaignRun = await this.createCampaignRun(userId, profile, entitlement, filters);

    // 6. Select directories
    const directories = await this.selectDirectories(campaignRun, filters, entitlement.remaining);

    if (directories.length === 0) {
      // Update campaign status to failed if no directories found
      await this.updateCampaignStatus(campaignRun.id, 'failed', {
        error_message: 'No eligible directories found matching your criteria',
        error_details: JSON.stringify({ filters })
      });
      throw new Error('NO_DIRECTORIES_AVAILABLE');
    }

    // 7. Create submission records
    const submissions = await this.createSubmissions(campaignRun, directories);

    // 8. Consume entitlement
    await entitlementService.consumeEntitlement(
      userId,
      submissions.length,
      entitlement.source,
      entitlement.sourceId
    );

    // 9. Update campaign run status
    await this.updateCampaignStatus(campaignRun.id, 'queued', {
      directories_selected: directories.length,
      directories_queued: submissions.length,
      started_at: new Date()
    });

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
  }

  /**
   * Validate prerequisites before starting
   */
  async validatePrerequisites(userId) {
    // Check business profile
    const profile = await this.getBusinessProfile(userId);
    if (!profile) {
      return { valid: false, error: 'PROFILE_REQUIRED' };
    }

    // Check minimum profile completeness
    const requiredFields = ['business_name', 'website_url', 'short_description'];
    for (const field of requiredFields) {
      if (!profile[field]) {
        return { valid: false, error: `PROFILE_INCOMPLETE:${field}` };
      }
    }

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
   * Get business profile
   */
  async getBusinessProfile(userId) {
    const result = await db.query(
      'SELECT * FROM business_profiles WHERE user_id = $1',
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Create campaign run with snapshots
   */
  async createCampaignRun(userId, profile, entitlement, filters) {
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

    const result = await db.query(`
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
   * Select directories based on entitlement + priority + filters
   */
  async selectDirectories(campaignRun, filters, limit) {
    const filtersSnapshot = typeof campaignRun.filters_snapshot === 'string'
      ? JSON.parse(campaignRun.filters_snapshot)
      : campaignRun.filters_snapshot;

    // Build WHERE conditions
    const conditions = ['d.is_active = true'];
    const params = [];
    let paramIndex = 1;

    // Filter: pricing (only free/freemium)
    conditions.push(`d.pricing_model IN ('free', 'freemium')`);

    // Filter: regions
    if (filtersSnapshot.regions && filtersSnapshot.regions.length > 0) {
      // Always include 'global' + specified regions
      const regions = [...new Set(['global', ...filtersSnapshot.regions])];
      conditions.push(`d.region_scope = ANY($${paramIndex})`);
      params.push(regions);
      paramIndex++;
    }

    // Filter: tiers
    if (filtersSnapshot.tiers && filtersSnapshot.tiers.length > 0) {
      conditions.push(`d.tier = ANY($${paramIndex})`);
      params.push(filtersSnapshot.tiers);
      paramIndex++;
    }

    // Filter: directory types
    if (filtersSnapshot.directory_types && filtersSnapshot.directory_types.length > 0) {
      conditions.push(`d.directory_type = ANY($${paramIndex})`);
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

    // Exclude already submitted directories (from any campaign, excluding failed/skipped)
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM directory_submissions ds
      WHERE ds.directory_id = d.id
        AND ds.user_id = $${paramIndex}
        AND ds.status NOT IN ('failed', 'skipped', 'cancelled', 'blocked')
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
      ORDER BY d.priority_score DESC, d.tier ASC, d.name ASC
      LIMIT $${paramIndex}
    `;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Create submission records for selected directories
   */
  async createSubmissions(campaignRun, directories) {
    if (directories.length === 0) {
      return [];
    }

    const submissions = [];

    for (let i = 0; i < directories.length; i++) {
      const directory = directories[i];

      // Create directory snapshot
      const directorySnapshot = {
        id: directory.id,
        name: directory.name,
        slug: directory.slug,
        website_url: directory.website_url,
        submission_url: directory.submission_url,
        submission_mode: directory.submission_mode,
        verification_method: directory.verification_method,
        requires_account: directory.requires_account,
        account_creation_url: directory.account_creation_url,
        required_fields: directory.required_fields,
        approval_type: directory.approval_type,
        typical_approval_days: directory.typical_approval_days,
        snapshot_at: new Date().toISOString()
      };

      const verificationStatus = directory.verification_method === 'none' ? 'not_required' : 'pending';

      const result = await db.query(`
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
        directory.website_url,
        JSON.stringify(directorySnapshot),
        directory.verification_method,
        verificationStatus,
        directory.priority_score,
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
