const express = require('express');
const router = express.Router();
const db = require('../db/database');

const { extractRootDomain, isPrimaryDomain } = require('../utils/domain-extractor');
const { calculateScanComparison, getHistoricalTimeline } = require('../utils/scan-comparison');
const { computePageSetHash } = require('../utils/page-context');
const UsageTrackerService = require('../services/usage-tracker-service');
const GuestScanCacheService = require('../services/guest-scan-cache-service');
const { generateFindings } = require('../services/findingsService');
const { createGuestRateLimiter } = require('../middleware/guestRateLimit');
const { loadOrgContext } = require('../middleware/orgContext');

// Phase 2: Core Services - Single source of truth for plan, entitlements, usage, org
// Phase 2.1: Use resolvePlanForRequest for org-first plan resolution
const { resolvePlanForRequest } = require('../services/planService');
const { getEntitlements, canScan, canScanPages, getUpgradeSuggestion } = require('../services/scanEntitlementService');
const { canPerformScan, incrementUsageEvent, getUsageSummary, checkAndResetLegacyIfNeeded } = require('../services/usageService');
const { ensureScanHasOrgContext, getOrCreateOrgForUser } = require('../services/organizationService');
const { USAGE_EVENT_TYPES } = require('../constants/usageEventTypes');

// Initialize guest services
const guestScanCache = new GuestScanCacheService(db);
const guestRateLimiter = createGuestRateLimiter({ maxScansPerDay: 5, db });

// ============================================
// 🚀 IMPORT REAL ENGINES (NEW!)
// ============================================
const V5EnhancedRubricEngine = require('../analyzers/v5-enhanced-rubric-engine'); // Import the ENHANCED class
const V5RubricEngine = V5EnhancedRubricEngine; // Alias for compatibility
const { canonicalizeUrl, canonicalizeWithRedirects, getCacheKey } = require('../utils/url-canonicalizer');

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Plan limits imported from middleware (single source of truth)
const { PLAN_LIMITS } = require('../middleware/usageLimits');

const usageTracker = new UsageTrackerService(db);

/**
 * Phase 4A.3c: Check if user has admin role (for debug mode gating).
 * Only queries DB when debug mode is requested.
 */
async function isAdminUser(userId) {
  try {
    const result = await db.query(
      `SELECT role FROM users WHERE id = $1`,
      [userId]
    );
    if (result.rows.length === 0) return false;
    const adminRoles = ['super_admin', 'content_manager', 'system_admin', 'support_agent', 'analyst'];
    return adminRoles.includes(result.rows[0].role);
  } catch {
    return false;
  }
}

// V5 Rubric Category Weights
const V5_WEIGHTS = {
  aiReadability: 0.10,           // 10%
  aiSearchReadiness: 0.20,       // 20%
  contentFreshness: 0.08,        // 8%
  contentStructure: 0.15,        // 15%
  speedUX: 0.05,                 // 5%
  technicalSetup: 0.18,          // 18%
  trustAuthority: 0.12,          // 12%
  voiceOptimization: 0.12        // 12%
};


// ============================================
// POST /api/scan/guest - Guest scan (no auth)
// With caching and rate limiting
// ============================================
router.post('/guest', guestRateLimiter.middleware(), async (req, res) => {
  try {
    const { url: userInputUrl } = req.body;

    if (!userInputUrl) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL format
    let validUrl;
    try {
      validUrl = new URL(userInputUrl.startsWith('http') ? userInputUrl : `https://${userInputUrl}`);
      if (validUrl.protocol !== 'http:' && validUrl.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
    } catch (e) {
      return res.status(400).json({
        error: 'Invalid URL format. Please use http:// or https://'
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RULEBOOK v1.2 Step C5: URL CANONICALIZATION - Do this FIRST before anything else
    // ═══════════════════════════════════════════════════════════════════════════
    let urlInfo;
    try {
      urlInfo = await canonicalizeWithRedirects(userInputUrl);
    } catch (e) {
      console.error('[Scan] Canonicalization failed:', e);
      urlInfo = {
        requestedUrl: userInputUrl,
        canonicalUrl: canonicalizeUrl(userInputUrl),
        error: e.message
      };
    }

    const scanTarget = urlInfo.canonicalUrl;
    const cacheKey = getCacheKey(scanTarget);

    // Store URL metadata for evidence
    const urlMetadata = {
      requestedUrl: userInputUrl,
      normalizedUrl: urlInfo.normalizedUrl,
      finalUrl: urlInfo.finalUrl,
      canonicalUrl: urlInfo.canonicalUrl,
      canonicalWarnings: urlInfo.canonicalWarnings,
      redirectCount: urlInfo.redirectChain?.length || 0
    };

    console.log('[Scan] URL canonicalized:', {
      input: userInputUrl,
      canonical: scanTarget,
      redirects: urlMetadata.redirectCount,
      warnings: urlMetadata.canonicalWarnings
    });

    console.log('🔍 Guest scan requested for:', scanTarget);

    // CHECK CACHE FIRST - prevent redundant analysis (use canonical URL for cache)
    const cachedResult = await guestScanCache.getCachedResult(scanTarget);
    if (cachedResult) {
      console.log('📦 Returning cached guest scan result');

      // Still record for rate limiting (cache hits count toward limit)
      await req.rateLimiter.recordScan(req);

      return res.json({
        success: true,
        total_score: cachedResult.totalScore,
        rubric_version: 'V5',
        url: scanTarget,
        requestedUrl: userInputUrl,
        urlMetadata,
        categories: cachedResult.categories,
        categoryBreakdown: cachedResult.categories,
        categoryWeights: V5_WEIGHTS,
        recommendations: cachedResult.recommendations || [],
        faq: null,
        upgrade: cachedResult.upgrade || null,
        message: 'Sign up free to unlock your top 3 recommendations',
        guest: true,
        cached: true,
        cacheInfo: {
          message: 'Results cached for 24 hours. Sign up for fresh scans anytime.',
          ttlHours: 24
        }
      });
    }

    // NO CACHE - Perform fresh V5 rubric scan
    // Use 'guest' tier - NO recommendations shown to anonymous users
    // Skip recommendation generation entirely (guests never see them anyway)
    // Use scanTarget (canonical URL) for all operations
    const scanResult = await performV5Scan(scanTarget, 'guest', null, null, null, 'optimization', true);

    // Record scan for rate limiting (only count fresh scans)
    await req.rateLimiter.recordScan(req);

    // CACHE THE RESULT for future requests (use canonical URL)
    await guestScanCache.setCachedResult(scanTarget, {
      totalScore: scanResult.totalScore,
      categories: scanResult.categories,
      recommendations: scanResult.recommendations,
      upgrade: scanResult.upgrade,
      industry: scanResult.industry
    });

    // Save guest scan to database for analytics (with user_id = NULL)
    // NOTE: Round scores to integers since DB columns are INTEGER type
    try {
      await db.query(
        `INSERT INTO scans (
          user_id, url, status, page_count, rubric_version,
          total_score, ai_readability_score, ai_search_readiness_score,
          content_freshness_score, content_structure_score, speed_ux_score,
          technical_setup_score, trust_authority_score, voice_optimization_score,
          industry, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)`,
        [
          null, // user_id is NULL for guest scans
          scanTarget,  // Use canonical URL for database storage
          'completed',
          1, // page_count
          'V5',
          Math.round(scanResult.totalScore),  // Round to integer
          Math.round(scanResult.categories.aiReadability),
          Math.round(scanResult.categories.aiSearchReadiness),
          Math.round(scanResult.categories.contentFreshness),
          Math.round(scanResult.categories.contentStructure),
          Math.round(scanResult.categories.speedUX),
          Math.round(scanResult.categories.technicalSetup),
          Math.round(scanResult.categories.trustAuthority),
          Math.round(scanResult.categories.voiceOptimization),
          scanResult.industry
        ]
      );
      console.log('✅ Guest scan saved to database for analytics');
    } catch (dbError) {
      console.error('⚠️  Failed to save guest scan to database:', dbError.message);
      console.error('⚠️  DB Error details:', dbError);
      // Continue anyway - don't fail the response if DB save fails
    }

    // Return results
    res.json({
      success: true,
      total_score: scanResult.totalScore,
      rubric_version: 'V5',
      url: scanTarget,
      requestedUrl: userInputUrl,
      urlMetadata,
      categories: scanResult.categories,
      categoryBreakdown: scanResult.categories,
      categoryWeights: V5_WEIGHTS, // Include weights for display
      recommendations: scanResult.recommendations, // Will be empty array for guest tier
      faq: null, // No FAQ for guest
      upgrade: scanResult.upgrade || null, // CTA to sign up
      message: 'Sign up free to unlock your top 3 recommendations',
      guest: true,
      cached: false
    });

  } catch (error) {
    console.error('❌ Guest scan error:', error);
    res.status(500).json({
      error: 'Scan blocked',
      details: error.message
    });
  }
});

// ============================================
// POST /api/scan/analyze - Authenticated scan
// ============================================
router.post('/analyze', authenticateToken, loadOrgContext, async (req, res) => {
  let scan = null; // Define outside try block for error handling

  try {
    const { url: userInputUrl, pages } = req.body;
    const userId = req.userId;

    if (!userInputUrl) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL format
    let validUrl;
    try {
      validUrl = new URL(userInputUrl.startsWith('http') ? userInputUrl : `https://${userInputUrl}`);
      if (validUrl.protocol !== 'http:' && validUrl.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
    } catch (e) {
      return res.status(400).json({
        error: 'Invalid URL format. Please use http:// or https://'
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RULEBOOK v1.2 Step C5: URL CANONICALIZATION - Do this FIRST before anything else
    // ═══════════════════════════════════════════════════════════════════════════
    let urlInfo;
    try {
      urlInfo = await canonicalizeWithRedirects(userInputUrl);
    } catch (e) {
      console.error('[Scan] Canonicalization failed:', e);
      urlInfo = {
        requestedUrl: userInputUrl,
        canonicalUrl: canonicalizeUrl(userInputUrl),
        error: e.message
      };
    }

    const scanTarget = urlInfo.canonicalUrl;

    // Store URL metadata for evidence
    const urlMetadata = {
      requestedUrl: userInputUrl,
      normalizedUrl: urlInfo.normalizedUrl,
      finalUrl: urlInfo.finalUrl,
      canonicalUrl: urlInfo.canonicalUrl,
      canonicalWarnings: urlInfo.canonicalWarnings,
      redirectCount: urlInfo.redirectChain?.length || 0
    };

    console.log('[Scan] URL canonicalized:', {
      input: userInputUrl,
      canonical: scanTarget,
      redirects: urlMetadata.redirectCount,
      warnings: urlMetadata.canonicalWarnings
    });

    // Get user info (including industry preference and primary domain)
    // Note: stripe_current_period_* columns may not exist - usageService handles this gracefully
    const userResult = await db.query(
      `SELECT plan, scans_used_this_month, industry, industry_custom,
              primary_domain, competitor_scans_used_this_month, primary_domain_changed_at,
              organization_id, quota_reset_date
       FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Phase 2: Get org context for usage tracking
    let orgContext = null;
    try {
      orgContext = await getOrCreateOrgForUser(userId);
    } catch (orgError) {
      console.warn(`[Scan] Could not get org context: ${orgError.message}`);
    }

    // Phase 2.1: Use org-first plan resolution (Option A)
    // Precedence: manual_override > stripe > org.plan fallback > user.plan
    const orgId = orgContext?.orgId || user.organization_id || null;
    const planResolution = await resolvePlanForRequest({ userId, orgId });

    // Get entitlements based on resolved plan
    const entitlements = getEntitlements(planResolution.plan);
    const planLimits = {
      scansPerMonth: entitlements.scans_per_period,
      pagesPerScan: entitlements.pages_per_scan,
      competitorScans: entitlements.competitor_scans
    };

    // Phase 2.1: Log plan resolution with source for debugging
    console.log(`[Scan] User ${userId} Org ${orgId}: plan=${planResolution.plan} source=${planResolution.source} limits=${JSON.stringify(planLimits)}`);

    // Phase 2: CRITICAL - Check and reset legacy usage counters if needed
    // This fixes the "monthly reset broken" bug
    await checkAndResetLegacyIfNeeded(userId);

    // Re-fetch user after potential reset
    const refreshedUserResult = await db.query(
      `SELECT scans_used_this_month, competitor_scans_used_this_month FROM users WHERE id = $1`,
      [userId]
    );
    if (refreshedUserResult.rows.length > 0) {
      user.scans_used_this_month = refreshedUserResult.rows[0].scans_used_this_month;
      user.competitor_scans_used_this_month = refreshedUserResult.rows[0].competitor_scans_used_this_month;
    }

    // Log user's industry preference if set
    if (user.industry) {
      console.log(`👤 User industry preference: ${user.industry}${user.industry_custom ? ` (${user.industry_custom})` : ''}`);
    }

    // Extract domain from scan URL (use canonical URL)
    const scanDomain = extractRootDomain(scanTarget);
    if (!scanDomain) {
      return res.status(400).json({ error: 'Unable to extract domain from URL' });
    }

    // Determine if this is a primary domain or competitor scan
    let domainType = 'primary';
    let isCompetitorScan = false;

    if (!user.primary_domain) {
      // First scan - set as primary domain
      console.log(`🏠 Setting primary domain for user ${userId}: ${scanDomain}`);
      await db.query(
        'UPDATE users SET primary_domain = $1 WHERE id = $2',
        [scanDomain, userId]
      );
      user.primary_domain = scanDomain;
    } else if (!isPrimaryDomain(scanTarget, user.primary_domain)) {
      // Different domain - this is a competitor scan
      domainType = 'competitor';
      isCompetitorScan = true;
      console.log(`🔍 Competitor scan detected: ${scanDomain} (primary: ${user.primary_domain})`);

      // Phase 2: Check competitor scan quota using centralized canScan
      const usageSummary = {
        scansUsed: user.scans_used_this_month || 0,
        competitorScansUsed: user.competitor_scans_used_this_month || 0
      };
      const competitorCheck = canScan(entitlements, usageSummary, true);

      if (!competitorCheck.allowed) {
        const upgradeSuggestion = getUpgradeSuggestion(entitlements.plan);
        return res.status(403).json({
          error: 'Competitor scan quota exceeded',
          message: competitorCheck.reason,
          quota: {
            type: 'competitor',
            used: competitorCheck.used,
            limit: competitorCheck.limit,
            remaining: competitorCheck.remaining
          },
          primaryDomain: user.primary_domain,
          upgrade: upgradeSuggestion
        });
      }
    }

    // Phase 2: Check primary scan quota using centralized canScan
    if (!isCompetitorScan) {
      const usageSummary = {
        scansUsed: user.scans_used_this_month || 0,
        competitorScansUsed: user.competitor_scans_used_this_month || 0
      };
      const primaryCheck = canScan(entitlements, usageSummary, false);

      if (!primaryCheck.allowed) {
        const upgradeSuggestion = getUpgradeSuggestion(entitlements.plan);
        return res.status(403).json({
          error: 'Scan quota exceeded',
          message: primaryCheck.reason,
          quota: {
            type: 'primary',
            used: primaryCheck.used,
            limit: primaryCheck.limit,
            remaining: primaryCheck.remaining
          },
          upgrade: upgradeSuggestion
        });
      }
    }

    // Phase 2: Validate page count using centralized canScanPages
    const requestedPageCount = pages ? pages.length : 1;
    const pageCheck = canScanPages(entitlements, requestedPageCount);
    const pageCount = pageCheck.maxPages === -1
      ? requestedPageCount
      : Math.min(requestedPageCount, pageCheck.maxPages);

    console.log(`🔍 Authenticated scan for user ${userId} (${planResolution.plan} via ${planResolution.source}) - ${scanTarget} [${domainType}]`);

    const { pageSetHash, normalizedPages } = computePageSetHash(scanTarget, pages || []);

    // Create scan record with status 'processing'
    // Phase 2: Include organization_id and domain_id from org context
    const scanRecord = await db.query(
      `INSERT INTO scans (
        user_id, url, status, page_count, rubric_version, domain_type, extracted_domain, domain, pages_analyzed, organization_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, url, status, created_at, organization_id`,
      [
        userId,
        scanTarget,  // Use canonical URL for database storage
        'processing',
        pageCount,
        'V5',
        domainType,
        scanDomain,
        scanDomain,
        JSON.stringify({ pages: normalizedPages, page_set_hash: pageSetHash }),
        orgContext?.orgId || null
      ]
    );

    scan = scanRecord.rows[0];

    // Phase 2: Ensure scan has org context (sets domain_id too)
    try {
      const orgContextResult = await ensureScanHasOrgContext(scan.id, userId, scanTarget);
      scan.organization_id = orgContextResult.organizationId;
      scan.domain_id = orgContextResult.domainId;
      console.log(`[Scan] Org context set: org=${scan.organization_id}, domain=${scan.domain_id}`);
    } catch (orgError) {
      console.warn(`[Scan] Could not set org context: ${orgError.message}`);
    }

    // Perform appropriate scan type
    let scanResult;
    if (isCompetitorScan) {
      // Lightweight competitor scan (scores only, no recommendations)
      console.log(`🔍 Performing lightweight competitor scan (scores only)`);
      scanResult = await performCompetitorScan(scanTarget);
    } else {
      // Full V5 rubric scan
      // Phase 2.1: Use resolved plan
      scanResult = await performV5Scan(scanTarget, planResolution.plan, pages, null, user.industry);
    }

    // Validate scan result structure
    if (!scanResult || !scanResult.categories) {
      console.error('❌ CRITICAL: performV5Scan returned invalid structure');
      console.error('   scanResult:', JSON.stringify(scanResult, null, 2));
      throw new Error('Scan analyzer returned incomplete data');
    }

    // Validate category structure (categories should be numbers 0-100, not objects)
    const requiredCategories = ['aiReadability', 'aiSearchReadiness', 'contentFreshness',
                                 'contentStructure', 'speedUX', 'technicalSetup',
                                 'trustAuthority', 'voiceOptimization'];

    for (const cat of requiredCategories) {
      const value = scanResult.categories[cat];
      if (typeof value !== 'number' || isNaN(value)) {
        console.error(`❌ CRITICAL: Missing or invalid category: ${cat}`);
        console.error(`   Expected number, got:`, typeof value, value);
        throw new Error(`Invalid category data: ${cat} - expected number, got ${typeof value}`);
      }
    }

    console.log('✅ Scan result validation passed');

    // Phase 2: Increment scan usage using centralized usageService
    // This handles legacy counters AND v2 events if dual-write enabled
    const eventType = isCompetitorScan
      ? USAGE_EVENT_TYPES.COMPETITOR_SCAN
      : USAGE_EVENT_TYPES.SCAN_COMPLETED;

    await incrementUsageEvent({
      userId,
      orgId: scan.organization_id,
      eventType,
      scanId: scan.id
    });

    // Update scan record with results
    // NOTE: Round scores to integers since DB columns are INTEGER type
    await db.query(
      `UPDATE scans SET
        status = $1,
        total_score = $2,
        ai_readability_score = $3,
        ai_search_readiness_score = $4,
        content_freshness_score = $5,
        content_structure_score = $6,
        speed_ux_score = $7,
        technical_setup_score = $8,
        trust_authority_score = $9,
        voice_optimization_score = $10,
        industry = $11,
        detailed_analysis = $12,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = $13`,
      [
        'completed',
        Math.round(scanResult.totalScore),  // Round to integer
        Math.round(scanResult.categories.aiReadability),
        Math.round(scanResult.categories.aiSearchReadiness),
        Math.round(scanResult.categories.contentFreshness),
        Math.round(scanResult.categories.contentStructure),
        Math.round(scanResult.categories.speedUX),
        Math.round(scanResult.categories.technicalSetup),
        Math.round(scanResult.categories.trustAuthority),
        Math.round(scanResult.categories.voiceOptimization),
        scanResult.industry,
        JSON.stringify(scanResult.detailedAnalysis),
        scan.id
      ]
    );
    

    // Generate findings for the scan
    try {
      await generateFindings(scan.id);
    } catch (findingsErr) {
      console.error(`[Findings] Error generating findings for scan ${scan.id}:`, findingsErr.message);
      // Non-critical: do not fail the scan completion
    }

    // 🔥 Save FAQ schema if available
    if (scanResult.faq && scanResult.faq.length > 0) {
      await db.query(
        `UPDATE scans SET faq_schema = $1 WHERE id = $2`,
        [JSON.stringify(scanResult.faq), scan.id]
      );
    }

    // 🏆 Update competitive tracking if this is a tracked competitor
    if (isCompetitorScan) {
      try {
        // Check if this competitor is being tracked
        const competitorResult = await db.query(
          `SELECT id, score_history FROM competitive_tracking
           WHERE user_id = $1 AND competitor_url = $2 AND is_active = true`,
          [userId, scanTarget]
        );

        if (competitorResult.rows.length > 0) {
          const competitor = competitorResult.rows[0];
          const scoreHistory = competitor.score_history || [];

          // Add new score to history
          const newHistoryEntry = {
            date: new Date().toISOString(),
            score: Math.round(scanResult.totalScore),
            categories: {
              aiReadability: Math.round(scanResult.categories.aiReadability),
              aiSearchReadiness: Math.round(scanResult.categories.aiSearchReadiness),
              contentFreshness: Math.round(scanResult.categories.contentFreshness),
              contentStructure: Math.round(scanResult.categories.contentStructure),
              speedUX: Math.round(scanResult.categories.speedUX),
              technicalSetup: Math.round(scanResult.categories.technicalSetup),
              trustAuthority: Math.round(scanResult.categories.trustAuthority),
              voiceOptimization: Math.round(scanResult.categories.voiceOptimization)
            }
          };

          scoreHistory.push(newHistoryEntry);

          // Update competitor tracking record
          await db.query(
            `UPDATE competitive_tracking
             SET latest_total_score = $1,
                 latest_scan_date = CURRENT_TIMESTAMP,
                 last_scanned_at = CURRENT_TIMESTAMP,
                 score_history = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [Math.round(scanResult.totalScore), JSON.stringify(scoreHistory), competitor.id]
          );

          console.log(`🏆 Updated competitive tracking for competitor ${competitor.id}`);
        }
      } catch (competitorError) {
        console.error('⚠️  Competitive tracking update failed (non-critical):', competitorError.message);
        // Don't fail the scan if competitive tracking fails
      }
    }

    // Log usage
    await db.query(
      'INSERT INTO usage_logs (user_id, action, metadata) VALUES ($1, $2, $3)',
      [userId, 'scan', JSON.stringify({ url: scanTarget, score: scanResult.totalScore, scan_id: scan.id })]
    );

    console.log(`✅ Scan ${scan.id} completed with score: ${scanResult.totalScore}`);

    // Return results
    res.json({
      success: true,
      scan: {
        id: scan.id,
        url: scanTarget,
        requestedUrl: userInputUrl,  // Original user input for reference
        urlMetadata,  // Full canonicalization metadata
        status: 'completed',
        total_score: scanResult.totalScore,
        rubric_version: 'V5',
        domain_type: domainType,
        extracted_domain: scanDomain,
        primary_domain: user.primary_domain,
        categories: scanResult.categories,
        categoryBreakdown: scanResult.categories, // Frontend expects this field name
        categoryWeights: V5_WEIGHTS, // Include weights for display
        recommendations: scanResult.recommendations || [],
        faq: (!isCompetitorScan && scanResult.faq) ? scanResult.faq : null,
        upgrade: scanResult.upgrade || null,
        created_at: scan.created_at,
        is_competitor: isCompetitorScan
      },
      // Phase 2: Return comprehensive usage summary
      quota: {
        primary: {
          used: (user.scans_used_this_month || 0) + (isCompetitorScan ? 0 : 1),
          limit: entitlements.scans_per_period,
          remaining: entitlements.scans_per_period === -1 ? -1 : Math.max(0, entitlements.scans_per_period - (user.scans_used_this_month || 0) - (isCompetitorScan ? 0 : 1))
        },
        competitor: {
          used: (user.competitor_scans_used_this_month || 0) + (isCompetitorScan ? 1 : 0),
          limit: entitlements.competitor_scans,
          remaining: Math.max(0, entitlements.competitor_scans - (user.competitor_scans_used_this_month || 0) - (isCompetitorScan ? 1 : 0))
        }
      },
      plan: entitlements.plan,
      organization_id: scan.organization_id,
      domain_id: scan.domain_id,
      message: isCompetitorScan
        ? `Competitor scan complete. Scores only - recommendations not available for competitor domains.`
        : null
    });

  } catch (error) {
    console.error('❌ Authenticated scan error:', error);
    console.error('Stack trace:', error.stack);

    // Mark scan as failed if we created a scan record
    if (scan && scan.id) {
      await db.query(
        `UPDATE scans SET status = $1, completed_at = CURRENT_TIMESTAMP WHERE id = $2`,
        ['failed', scan.id]
      );
    }

    res.status(500).json({
      error: 'Scan blocked',
      details: error.message
    });
  }
});

// ============================================
// GET /api/scan/list/recent - List recent scans
// ============================================
// IMPORTANT: This route MUST be defined BEFORE router.get('/:id', ...)
// because Express matches routes in order. If /:id comes first, it would
// interpret '/list/recent' as id='list' and never reach this handler.
router.get('/list/recent', authenticateToken, loadOrgContext, async (req, res) => {
  try {
    const userId = req.userId;
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

    // Try full query first, fall back to basic query if columns don't exist
    let result;
    try {
      result = await db.query(
        `SELECT
          id, url, status, total_score, rubric_version,
          page_count, industry, domain_type, extracted_domain,
          ai_readability_score, ai_search_readiness_score,
          content_freshness_score, content_structure_score,
          speed_ux_score, technical_setup_score,
          trust_authority_score, voice_optimization_score,
          created_at, completed_at
         FROM scans
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );
    } catch (dbError) {
      if (dbError.code === '42703') { // column does not exist
        console.log('Some scan columns missing, using basic query');
        result = await db.query(
          `SELECT
            id, url, score as total_score, industry, page_count, created_at
           FROM scans
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [userId, limit, offset]
        );
        // Add default values for missing columns
        result.rows = result.rows.map(row => ({
          ...row,
          status: 'completed',
          rubric_version: 'V5',
          completed_at: row.created_at
        }));
      } else {
        throw dbError;
      }
    }

    const countResult = await db.query(
      'SELECT COUNT(*) as total FROM scans WHERE user_id = $1',
      [userId]
    );

    res.json({
      success: true,
      scans: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit,
        offset,
        hasMore: offset + result.rows.length < parseInt(countResult.rows[0].total)
      }
    });

  } catch (error) {
    console.error('❌ List scans error:', error);
    res.status(500).json({ error: 'Failed to retrieve scans' });
  }
});

// ============================================
// GET /api/scan/:id - Get scan results
// ============================================
router.get('/:id', authenticateToken, loadOrgContext, async (req, res) => {
  try {
    const scanId = req.params.id;
    const userId = req.userId;

    const result = await db.query(
      `SELECT
        id, user_id, url, status, total_score, rubric_version,
        ai_readability_score, ai_search_readiness_score,
        content_freshness_score, content_structure_score,
        speed_ux_score, technical_setup_score,
        trust_authority_score, voice_optimization_score,
        industry, page_count, pages_analyzed, recommendations,
        detailed_analysis, faq_schema, created_at, completed_at,
        domain, extracted_domain, domain_type
       FROM scans
       WHERE id = $1 AND user_id = $2`,
      [scanId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    const scan = result.rows[0];
    // Read-only: get historical recommendations for this scan
    const recResult = await db.query(
      `SELECT
        id, category, recommendation_text, priority,
        estimated_impact, estimated_effort, status,
        action_steps, findings, code_snippet,
        impact_description,
        customized_implementation, ready_to_use_content,
        implementation_notes, quick_wins, validation_checklist,
        user_rating, user_feedback, implemented_at,
        subfactor_key, rec_key, why_it_matters, evidence_json,
        confidence, evidence_quality, engine_version
       FROM scan_recommendations
       WHERE scan_id = $1
       ORDER BY priority DESC, estimated_impact DESC`,
      [scan.id]
    );

    const categoryScores = {
      aiReadability: scan.ai_readability_score,
      aiSearchReadiness: scan.ai_search_readiness_score,
      contentFreshness: scan.content_freshness_score,
      contentStructure: scan.content_structure_score,
      speedUX: scan.speed_ux_score,
      technicalSetup: scan.technical_setup_score,
      trustAuthority: scan.trust_authority_score,
      voiceOptimization: scan.voice_optimization_score
    };

    // ============================================
    // HISTORIC COMPARISON LOGIC
    // ============================================
    let comparisonData = null;
    let historicalTimeline = null;

    try {
      if (scan.domain) {
        const previousScanResult = await db.query(
          `SELECT
            id, url, total_score, created_at,
            ai_readability_score, ai_search_readiness_score,
            content_freshness_score, content_structure_score,
            speed_ux_score, technical_setup_score,
            trust_authority_score, voice_optimization_score
          FROM scans
          WHERE user_id = $1
            AND domain = $2
            AND id < $3
            AND status = 'completed'
          ORDER BY created_at DESC
          LIMIT 1`,
          [userId, scan.domain, scanId]
        );

        if (previousScanResult.rows.length > 0) {
          comparisonData = calculateScanComparison(scan, previousScanResult.rows[0]);
        }

        const historicalScansResult = await db.query(
          `SELECT
            id, url, total_score, created_at,
            ai_readability_score, ai_search_readiness_score,
            content_freshness_score, content_structure_score,
            speed_ux_score, technical_setup_score,
            trust_authority_score, voice_optimization_score
          FROM scans
          WHERE user_id = $1
            AND domain = $2
            AND status = 'completed'
          ORDER BY created_at DESC
          LIMIT 10`,
          [userId, scan.domain]
        );

        if (historicalScansResult.rows.length > 1) {
          historicalTimeline = getHistoricalTimeline(historicalScansResult.rows);
        }
      }
    } catch (comparisonError) {
      console.error('Error calculating comparison (non-fatal):', comparisonError);
    }

    res.json({
      success: true,
      scan: {
        ...scan,
        categories: categoryScores,
        categoryBreakdown: categoryScores,
        categoryWeights: V5_WEIGHTS,
        recommendations: recResult.rows,
        faq: scan.faq_schema ? JSON.parse(scan.faq_schema) : null,
        comparison: comparisonData,
        historicalTimeline: historicalTimeline
      }
    });

  } catch (error) {
    console.error('❌ Get scan error:', error);
    res.status(500).json({ error: 'Failed to retrieve scan' });
  }
});


// ============================================
// DELETE /api/scan/:id - Delete a scan
// ============================================
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const scanId = req.params.id;
    const userId = req.userId;

    const result = await db.query(
      'DELETE FROM scans WHERE id = $1 AND user_id = $2 RETURNING id',
      [scanId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    res.json({
      success: true,
      message: 'Scan deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete scan error:', error);
    res.status(500).json({ error: 'Failed to delete scan' });
  }
});

// ============================================
// 🔥 CORRECTED - PERFORM V5 RUBRIC SCAN
// Now properly uses the V5RubricEngine class!
// ============================================
/**
 * Lightweight Competitor Scan - Scores Only
 * Skips recommendation generation to save API tokens
 */
async function performCompetitorScan(url) {
  console.log('🔬 Starting lightweight competitor scan for:', url);

  try {
    // Run V5 Rubric Engine for scoring only
    // RULEBOOK v1.2 Step C7: Disable headless for competitor scans (save budget)
    console.log('📊 Running V5 Rubric Engine (scores only)...');
    const engine = new V5RubricEngine(url, {
      maxPages: 25,  // Set to 25 pages per user request
      timeout: 10000,
      allowHeadless: false  // Don't waste headless budget on competitor scans
    });
    const v5Results = await engine.analyze();

    // Extract scores from category results
    const categories = {
      aiReadability: v5Results.categories.aiReadability.score || 0,
      aiSearchReadiness: v5Results.categories.aiSearchReadiness.score || 0,
      contentFreshness: v5Results.categories.contentFreshness.score || 0,
      contentStructure: v5Results.categories.contentStructure.score || 0,
      speedUX: v5Results.categories.speedUX.score || 0,
      technicalSetup: v5Results.categories.technicalSetup.score || 0,
      trustAuthority: v5Results.categories.trustAuthority.score || 0,
      voiceOptimization: v5Results.categories.voiceOptimization.score || 0
    };

    const totalScore = v5Results.totalScore;

    console.log(`✅ Competitor scan complete. Total score: ${totalScore}/100`);
    console.log(`💰 Saved token costs by skipping recommendations`);

    return {
      totalScore,
      categories,
      recommendations: [], // No recommendations for competitor scans
      faq: null, // No FAQ for competitor scans
      upgrade: null,
      industry: v5Results.industry || 'General',
      detailedAnalysis: {
        url,
        scannedAt: new Date().toISOString(),
        rubricVersion: 'V5',
        categoryBreakdown: categories,
        summary: 'Competitor scan - scores only',
        metadata: v5Results.metadata
      }
    };

  } catch (error) {
    console.error('❌ Competitor scan error:', error);
    throw new Error(`Competitor scan failed: ${error.message}`);
  }
}




async function performV5Scan(url, plan, pages = null, userProgress = null, userIndustry = null) {
  console.log('🔬 Starting V5 rubric analysis for:', url);

  try {
    // Create V5 Rubric Engine instance and run analysis
    // RULEBOOK v1.2 Step C7: Pass tier for headless rendering budget
    console.log('📊 Running V5 Rubric Engine...');
    const engine = new V5RubricEngine(url, {
      maxPages: 25,  // Set to 25 pages per user request
      timeout: 10000,
      industry: userIndustry,  // Pass industry for certification detection
      tier: plan,  // Pass tier for headless rendering budget
      allowHeadless: plan !== 'guest' && plan !== 'free'  // Only paid tiers get headless
    });
    const v5Results = await engine.analyze();

    // Extract scores from category results
    const categories = {
      aiReadability: v5Results.categories.aiReadability.score || 0,
      aiSearchReadiness: v5Results.categories.aiSearchReadiness.score || 0,
      contentFreshness: v5Results.categories.contentFreshness.score || 0,
      contentStructure: v5Results.categories.contentStructure.score || 0,
      speedUX: v5Results.categories.speedUX.score || 0,
      technicalSetup: v5Results.categories.technicalSetup.score || 0,
      trustAuthority: v5Results.categories.trustAuthority.score || 0,
      voiceOptimization: v5Results.categories.voiceOptimization.score || 0
    };

    const totalScore = v5Results.totalScore;
    const scanEvidence = engine.evidence;

    // Add certification data to scanEvidence
    if (v5Results.certificationData) {
      scanEvidence.certificationData = v5Results.certificationData;
    }

    // Determine industry
    const finalIndustry = userIndustry || v5Results.industry || 'General';

    console.log(`✅ V5 scan complete. Total score: ${totalScore}/100 (${finalIndustry})`);

    // Add industry prompt if certification data was detected without user-selected industry
    let industryPrompt = null;
    if (!userIndustry && v5Results.certificationData && v5Results.certificationData.industry === 'Generic') {
      industryPrompt = {
        message: "Set your industry in settings for tailored certification recommendations",
        actionUrl: "/settings.html#industry",
        actionLabel: "Set Industry"
      };
    }

    return {
      totalScore,
      categories,
      recommendations: [], // Recommendation generation removed (Phase 2 pack engine)
      faq: null,
      upgrade: null,
      industry: v5Results.industry || 'General',
      industryPrompt,
      detailedAnalysis: {
        url,
        scannedAt: new Date().toISOString(),
        rubricVersion: 'V5',
        categoryBreakdown: categories,
        metadata: v5Results.metadata,
        scanEvidence: scanEvidence
      }
    };

  } catch (error) {
    console.error('❌ V5 Scan error:', error);
    throw new Error(`V5 scan failed: ${error.message}`);
  }
}


// ============================================
// GET /api/scan/competitive - Get competitive tracking data
// ============================================
router.get('/competitive', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    const result = await db.query(
      `SELECT * FROM competitive_tracking
       WHERE user_id = $1 AND is_active = true
       ORDER BY tracking_since DESC`,
      [userId]
    );

    res.json({ success: true, competitors: result.rows });

  } catch (error) {
    console.error('❌ Get competitive tracking error:', error);
    res.status(500).json({ error: 'Failed to fetch competitive tracking data' });
  }
});

// ============================================
// POST /api/scan/competitive - Add competitor to track
// ============================================
router.post('/competitive', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { competitorName, competitorDomain, scanId } = req.body;

    if (!competitorName || !competitorDomain) {
      return res.status(400).json({ error: 'Competitor name and domain are required' });
    }

    // Check user mode - competitive tracking is Elite only
    const modeResult = await db.query(
      `SELECT current_mode FROM user_modes WHERE user_id = $1`,
      [userId]
    );

    if (modeResult.rows.length === 0 || modeResult.rows[0].current_mode !== 'elite') {
      return res.status(403).json({ error: 'Competitive tracking is only available in Elite mode' });
    }

    // Check if already tracking
    const existingResult = await db.query(
      `SELECT id FROM competitive_tracking WHERE user_id = $1 AND competitor_domain = $2`,
      [userId, competitorDomain]
    );

    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: 'Already tracking this competitor' });
    }

    // Add competitor
    const insertResult = await db.query(
      `INSERT INTO competitive_tracking
       (user_id, competitor_name, competitor_domain, competitor_scan_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, competitorName, competitorDomain, scanId]
    );

    res.json({ success: true, competitor: insertResult.rows[0] });

  } catch (error) {
    console.error('❌ Add competitor error:', error);
    res.status(500).json({ error: 'Failed to add competitor' });
  }
});

// ============================================
// DELETE /api/scan/competitive/:id - Remove competitor tracking
// ============================================
router.delete('/competitive/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const competitorId = req.params.id;

    await db.query(
      `UPDATE competitive_tracking
       SET is_active = false
       WHERE id = $1 AND user_id = $2`,
      [competitorId, userId]
    );

    res.json({ success: true, message: 'Competitor tracking removed' });

  } catch (error) {
    console.error('❌ Remove competitor error:', error);
    res.status(500).json({ error: 'Failed to remove competitor' });
  }
});

// ============================================
// GET /api/scan/competitive/alerts - Get competitive alerts
// ============================================
router.get('/competitive/alerts', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    const result = await db.query(
      `SELECT * FROM competitive_alerts
       WHERE user_id = $1 AND is_dismissed = false
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    res.json({ success: true, alerts: result.rows });

  } catch (error) {
    console.error('❌ Get competitive alerts error:', error);
    res.status(500).json({ error: 'Failed to fetch competitive alerts' });
  }
});


module.exports = router;