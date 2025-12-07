const express = require('express');
const router = express.Router();
const db = require('../db/database');

const { saveHybridRecommendations } = require('../utils/hybrid-recommendation-helper');
const { extractRootDomain, isPrimaryDomain } = require('../utils/domain-extractor');
const { calculateScanComparison, getHistoricalTimeline } = require('../utils/scan-comparison');
const { computePageSetHash } = require('../utils/page-context');
const UsageTrackerService = require('../services/usage-tracker-service');
const RecommendationContextService = require('../services/recommendation-context-service');
const RefreshCycleService = require('../services/refresh-cycle-service');

// ============================================
// 🚀 IMPORT REAL ENGINES (NEW!)
// ============================================
const V5EnhancedRubricEngine = require('../analyzers/v5-enhanced-rubric-engine'); // Import the ENHANCED class
const V5RubricEngine = V5EnhancedRubricEngine; // Alias for compatibility
const { generateCompleteRecommendations } = require('../analyzers/recommendation-generator');

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

const refreshService = new RefreshCycleService();
const usageTracker = new UsageTrackerService(db);

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

async function findReusableScanContext({ userId, domain, pageSetHash, withinDays = 5 }) {
  const candidateResult = await db.query(
    `SELECT s.id as scan_id, rrc.next_cycle_date, rrc.cycle_number, rrc.cycle_start_date
     FROM scans s
     JOIN recommendation_refresh_cycles rrc ON rrc.scan_id = s.id AND rrc.user_id = s.user_id
     WHERE s.user_id = $1
       AND s.domain = $2
       AND s.domain_type = 'primary'
       AND s.status = 'completed'
       AND s.pages_analyzed ->> 'page_set_hash' = $3
       AND s.completed_at >= NOW() - INTERVAL '1 day' * $4
     ORDER BY s.completed_at DESC
     LIMIT 1`,
    [userId, domain, pageSetHash, withinDays]
  );

  if (candidateResult.rows.length === 0) return null;

  const candidate = candidateResult.rows[0];
  const nextCycleDate = candidate.next_cycle_date ? new Date(candidate.next_cycle_date) : null;
  const cycleDue = nextCycleDate ? nextCycleDate <= new Date() : true;

  return { ...candidate, cycle_due: cycleDue };
}

// ============================================
// POST /api/scan/guest - Guest scan (no auth)
// ============================================
router.post('/guest', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL format
    let validUrl;
    try {
      validUrl = new URL(url);
      if (validUrl.protocol !== 'http:' && validUrl.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
    } catch (e) {
      return res.status(400).json({ 
        error: 'Invalid URL format. Please use http:// or https://' 
      });
    }

    console.log('🔍 Guest scan requested for:', url);

    // Perform V5 rubric scan
    // Use 'guest' tier - NO recommendations shown to anonymous users
    const scanResult = await performV5Scan(url, 'guest');

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
          url,
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
      url: url,
      categories: scanResult.categories,
      categoryBreakdown: scanResult.categories,
      categoryWeights: V5_WEIGHTS, // Include weights for display
      recommendations: scanResult.recommendations, // Will be empty array for guest tier
      faq: null, // No FAQ for guest
      upgrade: scanResult.upgrade || null, // CTA to sign up
      message: 'Sign up free to unlock your top 3 recommendations',
      guest: true
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
router.post('/analyze', authenticateToken, async (req, res) => {
  let scan = null; // Define outside try block for error handling

  try {
    const { url, pages } = req.body;
    const userId = req.userId;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL format
    let validUrl;
    try {
      validUrl = new URL(url);
      if (validUrl.protocol !== 'http:' && validUrl.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
    } catch (e) {
      return res.status(400).json({
        error: 'Invalid URL format. Please use http:// or https://'
      });
    }

    // Get user info (including industry preference and primary domain)
    const userResult = await db.query(
      `SELECT plan, scans_used_this_month, industry, industry_custom,
              primary_domain, competitor_scans_used_this_month, primary_domain_changed_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const planLimits = PLAN_LIMITS[user.plan];

    // Defensive guard: Ensure plan is valid
    if (!planLimits) {
      console.error(`⚠️ CRITICAL: Invalid plan detected for user ${userId}: "${user.plan}"`);

      // Log to database for monitoring
      await db.query(
        'INSERT INTO usage_logs (user_id, action, metadata) VALUES ($1, $2, $3)',
        [userId, 'invalid_plan_detected', JSON.stringify({
          invalidPlan: user.plan,
          timestamp: new Date().toISOString()
        })]
      );

      // Return error instead of silently downgrading
      return res.status(500).json({
        error: 'Invalid plan configuration',
        message: 'Your account has an invalid plan. Please contact support.',
        supportEmail: 'support@yourapp.com'
      });
    }

    // Log user's industry preference if set
    if (user.industry) {
      console.log(`👤 User industry preference: ${user.industry}${user.industry_custom ? ` (${user.industry_custom})` : ''}`);
    }

    // Extract domain from scan URL
    const scanDomain = extractRootDomain(url);
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
    } else if (!isPrimaryDomain(url, user.primary_domain)) {
      // Different domain - this is a competitor scan
      domainType = 'competitor';
      isCompetitorScan = true;
      console.log(`🔍 Competitor scan detected: ${scanDomain} (primary: ${user.primary_domain})`);

      // Check competitor scan quota
      const competitorScansUsed = user.competitor_scans_used_this_month || 0;
      if (competitorScansUsed >= planLimits.competitorScans) {
        return res.status(403).json({
          error: 'Competitor scan quota exceeded',
          message: `Your ${user.plan} plan allows ${planLimits.competitorScans} competitor scans per month. You've used ${competitorScansUsed}.`,
          quota: {
            type: 'competitor',
            used: competitorScansUsed,
            limit: planLimits.competitorScans
          },
          primaryDomain: user.primary_domain,
          upgrade: user.plan === 'free' ? {
            message: 'Upgrade to DIY to scan 2 competitors per month',
            cta: 'Upgrade to DIY - $29/month',
            ctaUrl: '/checkout.html?plan=diy'
          } : user.plan === 'diy' ? {
            message: 'Upgrade to Pro for 10 competitor scans per month',
            cta: 'Upgrade to Pro - $99/month',
            ctaUrl: '/checkout.html?plan=pro'
          } : null
        });
      }
    }

    // Check primary scan quota (only for primary domain scans)
    if (!isCompetitorScan && user.scans_used_this_month >= planLimits.scansPerMonth) {
      return res.status(403).json({
        error: 'Scan quota exceeded',
        quota: {
          type: 'primary',
          used: user.scans_used_this_month,
          limit: planLimits.scansPerMonth
        }
      });
    }

    // Validate page count for plan
    const pageCount = pages ? Math.min(pages.length, planLimits.pagesPerScan) : 1;

    console.log(`🔍 Authenticated scan for user ${userId} (${user.plan}) - ${url} [${domainType}]`);

    const { pageSetHash, normalizedPages } = computePageSetHash(url, pages || []);

    // Free users get 30-day context window, paid users get 5-day
    const contextWindowDays = user.plan === 'free' ? 30 : 5;

    const reusableContext = await findReusableScanContext({
      userId,
      domain: scanDomain,
      pageSetHash,
      withinDays: contextWindowDays
    });

    const contextScanId = reusableContext?.scan_id;
    let shouldReuseRecommendations = Boolean(contextScanId);

    // Create scan record with status 'processing'
    const scanRecord = await db.query(
      `INSERT INTO scans (
        user_id, url, status, page_count, rubric_version, domain_type, extracted_domain, domain, pages_analyzed, recommendations
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, url, status, created_at`,
      [
        userId,
        url,
        'processing',
        pageCount,
        'V5',
        domainType,
        scanDomain,
        scanDomain,
        JSON.stringify({ pages: normalizedPages, page_set_hash: pageSetHash }),
        contextScanId ? JSON.stringify({ context_scan_id: contextScanId, page_set_hash: pageSetHash }) : null
      ]
    );

    scan = scanRecord.rows[0];

    // Get existing user progress for this scan (if any) - only for primary domain scans
    let userProgress = null;
    if (!isCompetitorScan) {
      const existingProgressResult = await db.query(
        `SELECT * FROM user_progress WHERE user_id = $1 AND scan_id = $2`,
        [userId, scan.id]
      );
      userProgress = existingProgressResult.rows.length > 0 ? existingProgressResult.rows[0] : null;
    }

    // Get current mode for user (before generating recommendations) - only for primary domain scans
    let currentMode = 'optimization'; // Default
    if (!isCompetitorScan) {
      const { getCurrentMode } = require('../utils/mode-manager');
      const modeData = await getCurrentMode(userId);
      currentMode = modeData?.current_mode || 'optimization';
      console.log(`🎯 User recommendation mode: ${currentMode}`);
    }

    // CHECK FOR ACTIVE RECOMMENDATION CONTEXT (5-day window)
    // If user has scanned this same domain/pages within 5 days,
    // reuse existing recommendations instead of generating new ones.
    let activeContext = null;
    // Note: shouldReuseRecommendations already declared above based on contextScanId

    if (!isCompetitorScan) {
      const contextService = new RecommendationContextService(db.pool);
      const contextCheck = await contextService.shouldSkipRecommendationGeneration(
        userId,
        scanDomain,
        pages || [],
        isCompetitorScan
      );

      if (contextCheck.shouldSkip && contextCheck.activeContext) {
        activeContext = contextCheck.activeContext;
        shouldReuseRecommendations = true;
        console.log(`📎 Active recommendation context found (within 5-day window)`);
        console.log(`   Primary scan: ${activeContext.primaryScanId}`);
        console.log(`   Expires: ${activeContext.expiresAt}`);
        if (contextCheck.refreshProcessed) {
          console.log(`   ✓ Refresh cycle processed - implemented/skipped recs replaced`);
        }
        console.log(`   → Will reuse existing recommendations instead of generating new ones`);
      } else {
        console.log(`📎 No active context - will generate new recommendations`);
      }
    }

    // Perform appropriate scan type
    let scanResult;
    if (isCompetitorScan) {
      // Lightweight competitor scan (scores only, no recommendations)
      console.log(`🔍 Performing lightweight competitor scan (scores only)`);
      scanResult = await performCompetitorScan(url);
    } else if (shouldReuseRecommendations && activeContext) {
      // Scan with REUSED recommendations (within 5-day window)
      // Perform scoring only, then fetch existing recommendations
      console.log(`🔄 Performing scan with reused recommendations (5-day context active)`);
      scanResult = await performV5Scan(url, user.plan, pages, userProgress, user.industry, currentMode, true);

      // Fetch existing recommendations from primary scan
      const existingRecs = await db.query(`
        SELECT * FROM scan_recommendations
        WHERE scan_id = $1
          AND unlock_state IN ('active', 'locked')
          AND status NOT IN ('archived')
        ORDER BY impact_score DESC
      `, [activeContext.primaryScanId]);

      // Attach existing recommendations to scan result
      scanResult.recommendations = existingRecs.rows;
      scanResult.reusedFromContext = true;
      scanResult.primaryScanId = activeContext.primaryScanId;
      console.log(`   ✓ Reused ${existingRecs.rows.length} recommendations from scan ${activeContext.primaryScanId}`);
    } else {
      // Check if Free user has exhausted monthly recommendation quota (3 total)
      const FREE_MONTHLY_REC_LIMIT = 3;
      let skipRecsForFreeUser = false;

      if (user.plan === 'free') {
        const recsUsed = user.recs_generated_this_month || 0;
        if (recsUsed >= FREE_MONTHLY_REC_LIMIT) {
          console.log(`⚠️ Free user ${userId} has used ${recsUsed}/${FREE_MONTHLY_REC_LIMIT} recommendations this month`);
          console.log(`   → Skipping recommendation generation (monthly limit reached)`);
          skipRecsForFreeUser = true;
        } else {
          console.log(`📊 Free user has ${recsUsed}/${FREE_MONTHLY_REC_LIMIT} recommendations used this month`);
        }
      }

      // Full V5 rubric scan with NEW recommendations (mode-aware)
      // For Free users who hit their limit, skip recommendation generation
      scanResult = await performV5Scan(url, user.plan, pages, userProgress, user.industry, currentMode, skipRecsForFreeUser);

      // Add message for Free users who hit their limit
      if (skipRecsForFreeUser) {
        scanResult.recommendations = [];
        scanResult.freeRecLimitReached = true;
        scanResult.freeRecLimitMessage = `You've used your ${FREE_MONTHLY_REC_LIMIT} free recommendations this month. Upgrade to DIY for unlimited recommendations.`;
      }
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

    // Increment appropriate scan count AFTER successful scan
    // Using central UsageTrackerService to prevent double-counting
    const scanType = isCompetitorScan ? 'competitor' : 'primary';
    await UsageTrackerService.incrementScanUsage(userId, scanType);

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
    

    // 🔥 Save recommendations with HYBRID SYSTEM (NEW!)
    // Skip saving recommendations for competitor scans
let progressInfo = null;
if (!isCompetitorScan && scanResult.recommendations && scanResult.recommendations.length > 0 && !scanResult.reusedFromContext) {
  // Prepare page priorities from request
  const selectedPages = pages && pages.length > 0
    ? pages.map((pageUrl, index) => ({
        url: pageUrl,
        priority: index + 1 // First page = priority 1, etc.
      }))
    : [{ url: url, priority: 1 }]; // Just main URL if no pages specified

  // Save with hybrid system (pass score for tracking)
  progressInfo = await saveHybridRecommendations(
    scan.id,
    userId,
    url,
    selectedPages,
    scanResult.recommendations,
    user.plan,
    Math.round(scanResult.totalScore),  // Score at creation for tracking
    null  // Context ID will be set after context creation
  );

  // Initialize refresh cycle for paid users only (Free users don't need refresh cycles)
  if (user.plan !== 'free') {
    try {
      await refreshService.initializeRefreshCycle(userId, scan.id);
      console.log(`🔄 Refresh cycle initialized for scan ${scan.id}`);
    } catch (refreshError) {
      console.error('⚠️ Failed to initialize refresh cycle:', refreshError.message);
      // Don't fail the scan if refresh cycle fails
    }
  } else {
    console.log(`⏭️ Skipping refresh cycle for Free user ${userId}`);

    // Increment Free user's monthly recommendation counter
    // Count how many recommendations were actually saved (limited to 3 for Free)
    const recsSaved = Math.min(scanResult.recommendations.length, 3);
    if (recsSaved > 0) {
      await db.query(
        `UPDATE users SET recs_generated_this_month = COALESCE(recs_generated_this_month, 0) + $1 WHERE id = $2`,
        [recsSaved, userId]
      );
      console.log(`📊 Updated Free user rec counter: +${recsSaved} recommendations`);
    }
  }
}

    // 📎 MANAGE RECOMMENDATION CONTEXT (5-day persistence)
    if (!isCompetitorScan) {
      const contextService = new RecommendationContextService(db.pool);

      if (shouldReuseRecommendations && activeContext) {
        // Link this scan to the existing context (pass latest score for tracking)
        await contextService.linkScanToContext(activeContext.contextId, scan.id, Math.round(scanResult.totalScore));
        console.log(`📎 Scan ${scan.id} linked to existing context (expires: ${activeContext.expiresAt})`);
      } else if (!shouldReuseRecommendations && scanResult.recommendations && scanResult.recommendations.length > 0) {
        // Create new context for this scan (it has the primary recommendations)
        // Pass the initial score for "improved by X points" tracking
        // Pass user plan for plan-specific context duration (Free=30 days, DIY/Pro=5 days)
        await contextService.createContext(userId, scan.id, scanDomain, pages || [], Math.round(scanResult.totalScore), user.plan);
        console.log(`📎 New recommendation context created for scan ${scan.id}`);
      }
    }

    // 🔥 Save FAQ schema if available (DIY tier only)
    if (scanResult.faq && scanResult.faq.length > 0) {
      await db.query(
        `UPDATE scans SET faq_schema = $1 WHERE id = $2`,
        [JSON.stringify(scanResult.faq), scan.id]
      );
    }

    // 🔍 Validate previous recommendations (Phase 3: Partial Implementation Detection)
    if (!isCompetitorScan && scanResult.detailedAnalysis) {
      try {
        const { validatePreviousRecommendations } = require('../utils/validation-engine');
        const validationResults = await validatePreviousRecommendations(
          userId,
          scan.id,
          scanResult.detailedAnalysis.scanEvidence || {}
        );

        if (validationResults.validated) {
          console.log(`🔍 Validation complete: ${validationResults.verified_complete} verified, ${validationResults.partial_progress} partial, ${validationResults.not_implemented} not implemented`);
        }
      } catch (validationError) {
        console.error('⚠️  Validation failed (non-critical):', validationError.message);
        // Don't fail the scan if validation fails
      }
    }

    // 🎯 Check and update recommendation mode (Phase 4: Score-Based Mode Transition)
    let modeInfo = null;
    let refreshCycle = null; // Will be populated by refresh cycle service if applicable
    if (!isCompetitorScan) {
      try {
        const { checkAndUpdateMode } = require('../utils/mode-manager');
        modeInfo = await checkAndUpdateMode(userId, scan.id, scanResult.totalScore, user.plan);

        if (modeInfo.modeChanged) {
          console.log(`🎯 Mode changed: ${modeInfo.previousMode} → ${modeInfo.currentMode} (score: ${modeInfo.currentScore})`);
        } else {
          console.log(`🎯 Mode check: ${modeInfo.currentMode} (score: ${modeInfo.currentScore})`);
        }
      } catch (modeError) {
        console.error('⚠️  Mode check failed (non-critical):', modeError.message);
        // Don't fail the scan if mode check fails
      }
    }

    // 🏆 Update competitive tracking if this is a tracked competitor (Phase 5: Elite Mode)
    if (isCompetitorScan) {
      try {
        // Check if this competitor is being tracked
        const competitorResult = await db.query(
          `SELECT id, score_history FROM competitive_tracking
           WHERE user_id = $1 AND competitor_url = $2 AND is_active = true`,
          [userId, url]
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
      [userId, 'scan', JSON.stringify({ url, score: scanResult.totalScore, scan_id: scan.id })]
    );

    console.log(`✅ Scan ${scan.id} completed with score: ${scanResult.totalScore}`);

    // Return results
    res.json({
      success: true,
      scan: {
        id: scan.id,
        url: url,
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
      quota: {
        primary: {
          used: user.scans_used_this_month + (isCompetitorScan ? 0 : 1),
          limit: planLimits.scansPerMonth
        },
        competitor: {
          used: (user.competitor_scans_used_this_month || 0) + (isCompetitorScan ? 1 : 0),
          limit: planLimits.competitorScans
        }
      },
      mode: !isCompetitorScan ? modeInfo : null, // Mode information for primary domain scans
      refreshCycle,
      progress: progressInfo,
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
// GET /api/scan/:id - Get scan results
// ============================================
router.get('/:id', authenticateToken, async (req, res) => {
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
    let contextScanId = scan.id;

    // First, check if scan.recommendations JSON has context_scan_id (old system)
    if (scan.recommendations) {
      try {
        const recMeta = typeof scan.recommendations === 'string'
          ? JSON.parse(scan.recommendations)
          : scan.recommendations;
        contextScanId = recMeta?.context_scan_id || scan.id;
      } catch (parseError) {
        contextScanId = scan.id;
      }
    }

    // If no context_scan_id found in JSON, check context_scan_links table (new system)
    if (contextScanId === scan.id) {
      try {
        const contextLinkResult = await db.query(`
          SELECT rc.primary_scan_id
          FROM context_scan_links csl
          JOIN recommendation_contexts rc ON csl.context_id = rc.id
          WHERE csl.scan_id = $1
          LIMIT 1
        `, [scanId]);

        if (contextLinkResult.rows.length > 0 && contextLinkResult.rows[0].primary_scan_id) {
          contextScanId = contextLinkResult.rows[0].primary_scan_id;
          console.log(`📎 Scan ${scanId} linked to context, using primary scan ${contextScanId} for recommendations`);
        }
      } catch (contextError) {
        // Table might not exist yet, continue with current scan id
        console.log(`⚠️ Context lookup failed (table may not exist): ${contextError.message}`);
      }
    }

    // Get recommendations
    const recResult = await db.query(
      `SELECT
        id, category, recommendation_text, priority,
        estimated_impact, estimated_effort, status,
        action_steps, findings, code_snippet,
        impact_description,
        customized_implementation, ready_to_use_content,
        implementation_notes, quick_wins, validation_checklist,
        user_rating, user_feedback, implemented_at
       FROM scan_recommendations
       WHERE scan_id = $1
       ORDER BY priority DESC, estimated_impact DESC`,
      [contextScanId]
    );

    // Get user progress (for DIY progressive unlock)
    const progressResult = await db.query(
      `SELECT
        total_recommendations, active_recommendations,
        completed_recommendations, verified_recommendations,
        current_batch, last_unlock_date, unlocks_today,
        site_wide_total, site_wide_completed, site_wide_active,
        page_specific_total, page_specific_completed,
        site_wide_complete,
        batch_1_unlock_date, batch_2_unlock_date,
        batch_3_unlock_date, batch_4_unlock_date,
        total_batches
       FROM user_progress
       WHERE user_id = $1 AND scan_id = $2`,
      [userId, contextScanId]
    );

    let userProgress = progressResult.rows.length > 0 ? progressResult.rows[0] : null;

    // Check if replacement cycle is due (replaces old batch unlock logic)
    const { checkAndExecuteReplacement } = require('../utils/replacement-engine');
    let replacementResult = null;

    if (userProgress) {
      try {
        replacementResult = await checkAndExecuteReplacement(userId, contextScanId);

        if (replacementResult.replaced) {
          console.log(`🔄 Replacement executed: ${replacementResult.replacedCount} recommendations unlocked`);
          console.log(`   Next replacement: ${replacementResult.nextReplacementDate}`);

          // Refresh user progress after replacement
          const updatedProgressResult = await db.query(
            `SELECT * FROM user_progress WHERE user_id = $1 AND scan_id = $2`,
            [userId, contextScanId]
          );
          if (updatedProgressResult.rows.length > 0) {
            userProgress = updatedProgressResult.rows[0];
          }
        } else {
          console.log(`🔄 Replacement check: ${replacementResult.reason || 'not due yet'}`);
        }
      } catch (replacementError) {
        console.error('⚠️  Replacement check failed:', replacementError.message);
        // Continue without failing the scan retrieval
      }
    }

    // Legacy: Keep old batch unlock logic for backward compatibility (deprecated)
    let batchesUnlocked = 0;
    if (false && userProgress && userProgress.total_batches > 0) { // Disabled - using replacement engine now
      const now = new Date();
      const batchDates = [
        userProgress.batch_1_unlock_date,
        userProgress.batch_2_unlock_date,
        userProgress.batch_3_unlock_date,
        userProgress.batch_4_unlock_date
      ];

      let targetBatch = 1;
      for (let i = 0; i < 4; i++) {
        if (batchDates[i] && new Date(batchDates[i]) <= now) {
          targetBatch = i + 1;
        }
      }

      if (targetBatch > userProgress.current_batch) {
        console.log(`🔓 [DEPRECATED] Auto-unlocking batches ${userProgress.current_batch + 1} to ${targetBatch} for scan ${scanId}`);

        const recsPerBatch = 5;
        const currentlyActive = userProgress.active_recommendations || 0;
        const shouldBeActive = Math.min(targetBatch * recsPerBatch, userProgress.total_recommendations);
        const toUnlock = shouldBeActive - currentlyActive;

        if (toUnlock > 0) {
          // Unlock the next batch of recommendations
          await db.query(
            `UPDATE scan_recommendations
             SET unlock_state = 'active',
                 unlocked_at = NOW(),
                 skip_enabled_at = NOW() + INTERVAL '5 days'
             WHERE scan_id = $1
               AND unlock_state = 'locked'
               AND batch_number <= $2
             ORDER BY batch_number, id
             LIMIT $3`,
            [scanId, targetBatch, toUnlock]
          );

          // Update user progress
          await db.query(
            `UPDATE user_progress
             SET current_batch = $1,
                 active_recommendations = $2
             WHERE user_id = $3 AND scan_id = $4`,
            [targetBatch, shouldBeActive, userId, scanId]
          );

          batchesUnlocked = targetBatch - userProgress.current_batch;
          console.log(`   ✅ Unlocked ${toUnlock} recommendations (batches ${userProgress.current_batch + 1}-${targetBatch})`);

          // Refresh user progress
          const updatedProgress = await db.query(
            `SELECT * FROM user_progress WHERE user_id = $1 AND scan_id = $2`,
            [userId, scanId]
          );
          Object.assign(userProgress, updatedProgress.rows[0]);
        }
      }
    }

    // Get updated recommendations after potential unlock (with new delivery system fields)
    const updatedRecResult = await db.query(
      `SELECT
        id, category, recommendation_text, priority,
        estimated_impact, estimated_effort, status,
        action_steps, findings, code_snippet,
        impact_description,
        customized_implementation, ready_to_use_content,
        implementation_notes, quick_wins, validation_checklist,
        user_rating, user_feedback, implemented_at,
        unlock_state, batch_number, unlocked_at, skipped_at,
        recommendation_type, page_url,
        -- New delivery system fields
        recommendation_mode, elite_category, impact_score,
        implementation_difficulty, compounding_effect_score,
        industry_relevance_score, last_refresh_date, next_refresh_date,
        refresh_cycle_number, implementation_progress, previous_findings,
        is_partial_implementation, validation_status, validation_errors,
        last_validated_at, affected_pages, pages_implemented,
        auto_detected_at, archived_at, archived_reason, skip_enabled_at
       FROM scan_recommendations
       WHERE scan_id = $1
       ORDER BY batch_number, priority DESC, impact_score DESC NULLS LAST, estimated_impact DESC`,
      [contextScanId]
    );

    // Calculate next batch unlock info
    let nextBatchUnlock = null;
    if (userProgress && userProgress.current_batch < userProgress.total_batches) {
      const nextBatchNum = userProgress.current_batch + 1;
      const nextBatchDate = userProgress[`batch_${nextBatchNum}_unlock_date`];
      if (nextBatchDate) {
        const now = new Date();
        const unlockDate = new Date(nextBatchDate);
        const daysUntilUnlock = Math.ceil((unlockDate - now) / (1000 * 60 * 60 * 24));

        nextBatchUnlock = {
          batchNumber: nextBatchNum,
          unlockDate: nextBatchDate,
          daysRemaining: Math.max(0, daysUntilUnlock),
          recommendationsInBatch: 5
        };
      }
    }

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
    // RECOMMENDATION DELIVERY SYSTEM DATA
    // ============================================

    // Get or create user mode
    let userMode = null;
    try {
      const modeResult = await db.query(
        `SELECT * FROM user_modes WHERE user_id = $1`,
        [userId]
      );

      if (modeResult.rows.length > 0) {
        userMode = modeResult.rows[0];
      } else {
        // Create initial mode for user (Optimization mode by default)
        const insertMode = await db.query(
          `INSERT INTO user_modes (user_id, current_mode, current_score, score_at_mode_entry, highest_score_achieved)
           VALUES ($1, 'optimization', $2, $2, $2)
           RETURNING *`,
          [userId, scan.total_score]
        );
        userMode = insertMode.rows[0];
      }

      // Update current score
      await db.query(
        `UPDATE user_modes SET current_score = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
        [scan.total_score, userId]
      );
      userMode.current_score = scan.total_score;

    } catch (modeError) {
      console.error('⚠️  Error fetching user mode:', modeError);
    }

    // Get unread notifications
    let notifications = [];
    try {
      const notifResult = await db.query(
        `SELECT id, notification_type, category, priority, title, message,
                action_label, action_url, scan_id, recommendation_id,
                is_read, created_at, expires_at
         FROM user_notifications
         WHERE user_id = $1 AND is_dismissed = false
         ORDER BY created_at DESC
         LIMIT 50`,
        [userId]
      );
      notifications = notifResult.rows;
    } catch (notifError) {
      console.error('⚠️  Error fetching notifications:', notifError);
    }

    // Get current refresh cycle
    let currentCycle = null;
    try {
      const cycleResult = await db.query(
        `SELECT * FROM recommendation_refresh_cycles
         WHERE user_id = $1 AND scan_id = $2
         ORDER BY cycle_number DESC
         LIMIT 1`,
        [userId, contextScanId]
      );
      if (cycleResult.rows.length > 0) {
        currentCycle = cycleResult.rows[0];
      }
    } catch (cycleError) {
      console.error('⚠️  Error fetching refresh cycle:', cycleError);
    }

    // Get implementation detections (for auto-detected recommendations)
    let recentDetections = [];
    try {
      const detectionResult = await db.query(
        `SELECT d.*, r.recommendation_text, r.category
         FROM implementation_detections d
         JOIN scan_recommendations r ON d.recommendation_id = r.id
         WHERE d.user_id = $1 AND d.current_scan_id = $2
         ORDER BY d.detected_at DESC
         LIMIT 10`,
        [userId, scanId]
      );
      recentDetections = detectionResult.rows;
    } catch (detectionError) {
      console.error('⚠️  Error fetching detections:', detectionError);
    }

    // ============================================
    // HISTORIC COMPARISON LOGIC
    // ============================================
    let comparisonData = null;
    let historicalTimeline = null;

    try {
      // Check if scan has domain field for comparison
      if (scan.domain) {
        // Fetch previous scan for the same domain by this user
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
          const previousScan = previousScanResult.rows[0];
          comparisonData = calculateScanComparison(scan, previousScan);
          console.log(`📊 Comparison calculated for scan ${scanId} vs ${previousScan.id}`);
        }

        // Fetch all scans for this domain for timeline visualization (last 10)
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
          console.log(`📈 Historical timeline generated with ${historicalScansResult.rows.length} data points`);
        }
      }
    } catch (comparisonError) {
      console.error('⚠️  Error calculating comparison (non-fatal):', comparisonError);
      // Continue without comparison data - it's optional
    }

    res.json({
      success: true,
      scan: {
        ...scan,
        categories: categoryScores,
        categoryBreakdown: categoryScores, // Frontend expects this field name
        categoryWeights: V5_WEIGHTS, // Include weights for display
        recommendations: updatedRecResult.rows,
        faq: scan.faq_schema ? JSON.parse(scan.faq_schema) : null,
        userProgress: userProgress, // Include progress for DIY tier
        nextBatchUnlock: nextBatchUnlock, // Next batch unlock info
        batchesUnlocked: batchesUnlocked, // How many batches were just unlocked
        comparison: comparisonData, // Historic comparison data
        historicalTimeline: historicalTimeline, // Timeline data for visualization
        // Recommendation Delivery System data
        userMode: userMode, // User mode (optimization/elite)
        notifications: notifications, // User notifications
        currentCycle: currentCycle, // Current refresh cycle
        recentDetections: recentDetections, // Auto-detected implementations
        unreadNotificationCount: notifications.filter(n => !n.is_read).length
      }
    });

  } catch (error) {
    console.error('❌ Get scan error:', error);
    res.status(500).json({ error: 'Failed to retrieve scan' });
  }
});

// ============================================
// GET /api/scan/list/recent - List recent scans
// ============================================
router.get('/list/recent', authenticateToken, async (req, res) => {
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

// POST /api/scan/:id/recommendation/:recId/feedback
// Learning Loop: Track user actions
// ============================================
router.post('/:id/recommendation/:recId/feedback', authenticateToken, async (req, res) => {
  try {
    const { id: scanId, recId } = req.params;
    const userId = req.userId;
    const { status, feedback, rating } = req.body;

    // Verify scan belongs to user
    const scanCheck = await db.query(
      'SELECT id FROM scans WHERE id = $1 AND user_id = $2',
      [scanId, userId]
    );

    if (scanCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    // Update recommendation
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (status) {
      updateFields.push(`status = $${paramCount++}`);
      updateValues.push(status);
      
      if (status === 'implemented') {
        updateFields.push(`implemented_at = CURRENT_TIMESTAMP`);
      }
    }

    if (feedback) {
      updateFields.push(`user_feedback = $${paramCount++}`);
      updateValues.push(feedback);
    }

    if (rating !== undefined) {
      updateFields.push(`user_rating = $${paramCount++}`);
      updateValues.push(rating);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    updateValues.push(recId, scanId);

    await db.query(
      `UPDATE scan_recommendations
       SET ${updateFields.join(', ')}
       WHERE id = $${paramCount++} AND scan_id = $${paramCount}`,
      updateValues
    );

    // If marking as implemented, update user progress
    if (status === 'implemented') {
      await db.query(
        `UPDATE user_progress
         SET completed_recommendations = completed_recommendations + 1
         WHERE user_id = $1 AND scan_id = $2`,
        [userId, scanId]
      );
    }

    res.json({
      success: true,
      message: status === 'implemented'
        ? 'Recommendation marked as implemented! Your progress has been updated.'
        : 'Feedback recorded for learning loop'
    });

  } catch (error) {
    console.error('❌ Feedback error:', error);
    res.status(500).json({ error: 'Failed to record feedback' });
  }
});

// ============================================
// POST /api/scan/:id/recommendation/:recId/skip
// Skip a recommendation (available after 5 days)
// ============================================
router.post('/:id/recommendation/:recId/skip', authenticateToken, async (req, res) => {
  try {
    const { id: scanId, recId } = req.params;
    const userId = req.userId;
    const { skipData } = req.body;

    // Verify scan belongs to user
    const scanCheck = await db.query(
      'SELECT id FROM scans WHERE id = $1 AND user_id = $2',
      [scanId, userId]
    );

    if (scanCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    // Get recommendation details
    const recResult = await db.query(
      `SELECT id, unlock_state, skip_enabled_at, skipped_at, status
       FROM scan_recommendations
       WHERE id = $1 AND scan_id = $2`,
      [recId, scanId]
    );

    if (recResult.rows.length === 0) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }

    const recommendation = recResult.rows[0];

    // Check if already skipped
    if (recommendation.skipped_at) {
      return res.status(400).json({
        error: 'Already skipped',
        message: 'This recommendation has already been skipped.'
      });
    }

    // Check if recommendation is locked
    if (recommendation.unlock_state === 'locked') {
      return res.status(403).json({
        error: 'Recommendation not yet unlocked',
        message: 'You can only skip unlocked recommendations.'
      });
    }

    // Check if skip is enabled (5 days after unlock)
    const now = new Date();
    const skipEnabledAt = recommendation.skip_enabled_at ? new Date(recommendation.skip_enabled_at) : null;

    if (skipEnabledAt && skipEnabledAt > now) {
      const daysRemaining = Math.ceil((skipEnabledAt - now) / (1000 * 60 * 60 * 24));
      return res.status(403).json({
        error: 'Skip not yet available',
        message: `You can skip this recommendation in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}.`,
        skipEnabledAt: skipEnabledAt.toISOString(),
        daysRemaining
      });
    }

    // Mark as skipped and store skip data
    await db.query(
      `UPDATE scan_recommendations
       SET skipped_at = NOW(),
           status = 'skipped',
           user_feedback = $3
       WHERE id = $1 AND scan_id = $2`,
      [recId, scanId, skipData || null]
    );

    // Update user progress (skipped counts as completed)
    await db.query(
      `UPDATE user_progress
       SET completed_recommendations = completed_recommendations + 1
       WHERE user_id = $1 AND scan_id = $2`,
      [userId, scanId]
    );

    console.log(`⏭️  User ${userId} skipped recommendation ${recId} for scan ${scanId}`);

    res.json({
      success: true,
      message: 'Recommendation skipped. It will appear in your "Skipped" tab.'
    });

  } catch (error) {
    console.error('❌ Skip recommendation error:', error);
    res.status(500).json({ error: 'Failed to skip recommendation' });
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
    console.log('📊 Running V5 Rubric Engine (scores only)...');
    const engine = new V5RubricEngine(url, {
      maxPages: 25,  // Set to 25 pages per user request
      timeout: 10000
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

/**
 * Transform V5 categories structure to flat subfactor scores
 * The new V5 engine returns nested objects and different key names
 * This function flattens and renames to match what the issue detector expects
 */
function transformV5ToSubfactors(v5Categories) {
  const subfactors = {};

  // AI Readability - Scale from 0-2/0-10 to 0-100 and rename keys
  if (v5Categories.aiReadability) {
    const ar = v5Categories.aiReadability;
    subfactors.aiReadability = {
      altTextScore: (ar.altText || 0) * 50,  // 0-2 scale → 0-100
      captionsTranscriptsScore: (ar.transcription || 0) * 10,  // 0-10 scale → 0-100
      interactiveAccessScore: (ar.interactive || 0) * 50,  // 0-2 scale → 0-100
      crossMediaScore: (ar.crossMedia || 0) * 50  // 0-2 scale → 0-100
    };
  }

  // AI Search Readiness - Extract from nested structure and scale
  if (v5Categories.aiSearchReadiness) {
    const asr = v5Categories.aiSearchReadiness;
    const directAnswer = asr.subfactors?.directAnswerStructure || {};  // CRITICAL FIX: Added .subfactors
    const topical = asr.subfactors?.topicalAuthority || {};  // CRITICAL FIX: Added .subfactors

    subfactors.aiSearchReadiness = {
      questionHeadingsScore: (directAnswer.factors?.questionDensity || 0) * 50,  // 0-2 → 0-100 (hybrid scoring)
      scannabilityScore: (directAnswer.factors?.scannability || 0) * 50,  // 0-2 → 0-100
      readabilityScore: (directAnswer.factors?.readability || 0) * 50,  // 0-2 → 0-100 (factor max is 2.0)
      faqScore: (directAnswer.factors?.icpQA || 0) * 50,  // 0-2 → 0-100 (FIXED: was * 33, now * 50)
      snippetEligibleScore: (directAnswer.factors?.answerCompleteness || 0) * 50,  // 0-2 → 0-100
      pillarPagesScore: (topical.factors?.pillarPages || 0) * 50,  // 0-2 → 0-100 (max is 2.0, not 3.0)
      linkedSubpagesScore: (topical.factors?.semanticLinking || 0) * 50,  // 0-2 → 0-100 (max is 2.0)
      painPointsScore: (topical.factors?.contentDepth || 0) * 50,  // 0-2 → 0-100 (max is 2.0)
      geoContentScore: 50  // Default middle value if not available
    };
  }

  // Content Freshness - Scale from 0-2 to 0-100
  if (v5Categories.contentFreshness) {
    const cf = v5Categories.contentFreshness;
    subfactors.contentFreshness = {
      lastUpdatedScore: (cf.lastModified || 0) * 50,  // 0-2 → 0-100
      versioningScore: (cf.versioning || 0) * 50,  // 0-2 → 0-100
      timeSensitiveScore: (cf.timeSensitive || 0) * 50,  // 0-2 → 0-100
      auditProcessScore: (cf.auditProcess || 0) * 50,  // 0-2 → 0-100
      liveDataScore: (cf.realTimeInfo || 0) * 50,  // 0-2 → 0-100
      httpFreshnessScore: 50,  // Not in new structure, use default
      editorialCalendarScore: 50  // Not in new structure, use default
    };
  }

  // Content Structure - Extract from nested structure and scale
  if (v5Categories.contentStructure) {
    const cs = v5Categories.contentStructure;
    const semantic = cs.subfactors?.semanticHTML || {};  // CRITICAL FIX: Added .subfactors
    const entity = cs.subfactors?.entityRecognition || {};  // CRITICAL FIX: Added .subfactors

    subfactors.contentStructure = {
      headingHierarchyScore: (semantic.factors?.headingHierarchy || 0) * 66.7,  // 0-1.5 → 0-100
      navigationScore: (semantic.factors?.contentSectioning || 0) * 66.7,  // 0-1.5 → 0-100
      entityCuesScore: (entity.factors?.namedEntities || 0) * 66.7,  // 0-1.5 → 0-100
      accessibilityScore: (semantic.factors?.accessibility || 0) * 66.7,  // 0-1.5 → 0-100
      geoMetaScore: (entity.factors?.geoEntities || 0) * 66.7  // 0-1.5 → 0-100
    };
  }

  // Speed & UX - Scale from 0-1 to 0-100
  if (v5Categories.speedUX) {
    const su = v5Categories.speedUX;
    subfactors.speedUX = {
      lcpScore: (su.lcp || 0) * 100,  // 0-1 → 0-100
      clsScore: (su.cls || 0) * 100,  // 0-1 → 0-100
      inpScore: (su.inp || 0) * 100,  // 0-1 → 0-100
      mobileScore: (su.mobile || 0) * 100,  // 0-1 → 0-100
      crawlerResponseScore: (su.crawlerResponse || 0) * 100  // 0-1 → 0-100
    };
  }

  // Technical Setup - Extract from nested structure and scale
  if (v5Categories.technicalSetup) {
    const ts = v5Categories.technicalSetup;
    const crawler = ts.subfactors?.crawlerAccess || {};  // CRITICAL FIX: Added .subfactors
    const structured = ts.subfactors?.structuredData || {};  // CRITICAL FIX: Added .subfactors

    subfactors.technicalSetup = {
      crawlerAccessScore: (crawler.factors?.robotsTxt || 0) * 55.6,  // 0-1.8 → 0-100
      structuredDataScore: (structured.factors?.schemaMarkup || 0) * 55.6,  // 0-1.8 → 0-100
      canonicalHreflangScore: 50,  // Not in new structure, use default
      openGraphScore: 50,  // Not in new structure, use default
      sitemapScore: (crawler.factors?.sitemap || 0) * 55.6,  // 0-1.8 → 0-100 (FIXED: was reading serverResponse!)
      indexNowScore: 50,  // Not in new structure, use default
      rssFeedScore: 50  // Not in new structure, use default
    };
  }

  // Trust & Authority - Extract from nested structure and scale
  if (v5Categories.trustAuthority) {
    const ta = v5Categories.trustAuthority;
    const eeat = ta.subfactors?.eeat || {};  // CRITICAL FIX: Added .subfactors
    const authority = ta.subfactors?.authorityNetwork || {};  // CRITICAL FIX: Added .subfactors

    subfactors.trustAuthority = {
      authorBiosScore: (eeat.factors?.authorProfiles || 0) * 50,  // 0-2 → 0-100
      certificationsScore: (eeat.factors?.credentials || 0) * 50,  // 0-2 → 0-100 (legacy)
      professionalCertifications: (eeat.factors?.professionalCertifications || 0) * 83.3,  // 0-1.2 → 0-100
      teamCredentials: (eeat.factors?.teamCredentials || 0) * 83.3,  // 0-1.2 → 0-100
      industryMemberships: (authority.factors?.industryMemberships || 0) * 83.3,  // 0-1.2 → 0-100
      domainAuthorityScore: (authority.factors?.domainAuthority || 0) * 33,  // 0-3 → 0-100
      thoughtLeadershipScore: (authority.factors?.thoughtLeadership || 0) * 33,  // 0-3 → 0-100
      thirdPartyProfilesScore: (authority.factors?.socialAuthority || 0) * 50  // 0-2 → 0-100
    };
  }

  // Voice Optimization - Extract from nested structure and scale
  if (v5Categories.voiceOptimization) {
    const vo = v5Categories.voiceOptimization;
    const conversational = vo.subfactors?.conversationalKeywords || {};  // CRITICAL FIX: Added .subfactors
    const voice = vo.subfactors?.voiceSearch || {};  // CRITICAL FIX: Added .subfactors

    subfactors.voiceOptimization = {
      longTailScore: (conversational.factors?.longTail || 0) * 83,  // 0-1.2 → 0-100
      localIntentScore: (conversational.factors?.localIntent || 0) * 83,  // 0-1.2 → 0-100
      conversationalTermsScore: (voice.factors?.conversationalFlow || 0) * 83,  // 0-1.2 → 0-100
      snippetFormatScore: (conversational.factors?.snippetOptimization || 0) * 83,  // 0-1.2 → 0-100 (hybrid scoring)
      multiTurnScore: (conversational.factors?.followUpQuestions || 0) * 83  // 0-1.2 → 0-100
    };
  }

  return subfactors;
}

async function performV5Scan(url, plan, pages = null, userProgress = null, userIndustry = null, mode = 'optimization', skipRecommendationGeneration = false) {
  console.log('🔬 Starting V5 rubric analysis for:', url);
  console.log(`🎯 Recommendation mode: ${mode}`);
  if (skipRecommendationGeneration) {
    console.log(`📎 Recommendation generation will be SKIPPED (reusing from active context)`);
  }

  try {
    // Step 1: Create V5 Rubric Engine instance and run analysis
    console.log('📊 Running V5 Rubric Engine...');
    const engine = new V5RubricEngine(url, {
      maxPages: 25,  // Set to 25 pages per user request
      timeout: 10000,
      industry: userIndustry  // Pass industry for certification detection
    });
    const v5Results = await engine.analyze();

    // Debug: Log sitemap detection from crawler
    console.log('[DEBUG] Sitemap detected:', engine.evidence?.technical?.sitemapDetected || engine.evidence?.technical?.hasSitemap);
    console.log('[DEBUG] Technical Setup category:', JSON.stringify(v5Results.categories.technicalSetup, null, 2));

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

    // Add certification data to scanEvidence for recommendation generation
    if (v5Results.certificationData) {
      scanEvidence.certificationData = v5Results.certificationData;
      console.log(`🏆 Certification data added to scanEvidence:`, {
        detected: v5Results.certificationData.detected?.length || 0,
        missing: v5Results.certificationData.missing?.length || 0,
        coverage: v5Results.certificationData.overallCoverage || 0
      });
    }

    // Transform V5 categories structure to flat subfactor scores for issue detection
    // The V5 engine returns nested structures, but issue detector expects flat key-value pairs
    const subfactorScores = transformV5ToSubfactors(v5Results.categories);
    console.log('[V5Transform] Transformed subfactor scores for issue detection');
    console.log('[V5Transform] Technical Setup subfactors:', JSON.stringify(subfactorScores.technicalSetup, null, 2));

    // Determine industry: Prioritize user-selected > auto-detected > fallback
    const finalIndustry = userIndustry || v5Results.industry || 'General';
    const industrySource = userIndustry ? 'user-selected' : (v5Results.industry ? 'auto-detected' : 'default');

    console.log(`🏢 Industry for recommendations: ${finalIndustry} (${industrySource})`);

    // Step 2: Generate recommendations based on mode (UNLESS skipped for context reuse)
    let recommendationResults = null;

    if (skipRecommendationGeneration) {
      // Skip recommendation generation - will be fetched from existing context
      console.log('📎 Skipping recommendation generation (active context will provide recommendations)');
      recommendationResults = {
        data: {
          recommendations: [], // Will be populated from context
          faq: null,
          upgrade: null
        },
        summary: null
      };
    } else {
      // Generate new recommendations
      console.log('🤖 Generating recommendations...');

      recommendationResults = await generateCompleteRecommendations(
        {
          v5Scores: subfactorScores,
          scanEvidence: scanEvidence
        },
        plan,
        finalIndustry,
        userProgress, // Pass userProgress for progressive unlock
        mode // Pass mode for strategy selection
      );

      console.log(`📊 Generated ${recommendationResults.data.recommendations.length} recommendations`);
    }

    console.log(`✅ V5 scan complete. Total score: ${totalScore}/100 (${finalIndustry})`);

    // Add industry prompt if certification data was detected without user-selected industry
    let industryPrompt = null;
    if (!userIndustry && v5Results.certificationData && v5Results.certificationData.industry === 'Generic') {
      industryPrompt = {
        message: "💡 Set your industry in settings for tailored certification recommendations",
        actionUrl: "/settings.html#industry",
        actionLabel: "Set Industry"
      };
      console.log(`💡 Industry prompt added (using Generic certification library)`);
    }

    return {
      totalScore,
      categories,
      recommendations: recommendationResults.data.recommendations,
      faq: recommendationResults.data.faq || null,
      upgrade: recommendationResults.data.upgrade || null,
      industry: v5Results.industry || 'General',
      industryPrompt: industryPrompt, // UI prompt to set industry
      detailedAnalysis: {
        url,
        scannedAt: new Date().toISOString(),
        rubricVersion: 'V5',
        categoryBreakdown: categories,
        summary: recommendationResults.summary,
        metadata: v5Results.metadata,
        scanEvidence: scanEvidence // Add evidence for validation
      }
    };

  } catch (error) {
    console.error('❌ V5 Scan error:', error);
    throw new Error(`V5 scan failed: ${error.message}`);
  }
}

// ============================================
// RECOMMENDATION DELIVERY SYSTEM ENDPOINTS
// ============================================

// ============================================
// GET /api/scan/notifications - Get user notifications
// ============================================
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { unreadOnly } = req.query;

    let query = `
      SELECT id, notification_type, category, priority, title, message,
             action_label, action_url, scan_id, recommendation_id,
             is_read, read_at, created_at, expires_at
      FROM user_notifications
      WHERE user_id = $1 AND is_dismissed = false
    `;

    if (unreadOnly === 'true') {
      query += ` AND is_read = false`;
    }

    query += ` ORDER BY created_at DESC LIMIT 100`;

    const result = await db.query(query, [userId]);

    res.json({
      success: true,
      notifications: result.rows,
      unreadCount: result.rows.filter(n => !n.is_read).length
    });

  } catch (error) {
    console.error('❌ Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ============================================
// POST /api/scan/notifications/:id/read - Mark notification as read
// ============================================
router.post('/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const notificationId = req.params.id;

    await db.query(
      `UPDATE user_notifications
       SET is_read = true, read_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );

    res.json({ success: true, message: 'Notification marked as read' });

  } catch (error) {
    console.error('❌ Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// ============================================
// POST /api/scan/notifications/:id/dismiss - Dismiss notification
// ============================================
router.post('/notifications/:id/dismiss', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const notificationId = req.params.id;

    await db.query(
      `UPDATE user_notifications
       SET is_dismissed = true, dismissed_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );

    res.json({ success: true, message: 'Notification dismissed' });

  } catch (error) {
    console.error('❌ Dismiss notification error:', error);
    res.status(500).json({ error: 'Failed to dismiss notification' });
  }
});

// ============================================
// GET /api/scan/mode - Get user mode details
// ============================================
router.get('/mode', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    const result = await db.query(
      `SELECT * FROM user_modes WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // Create default mode for user
      const insertResult = await db.query(
        `INSERT INTO user_modes (user_id, current_mode, current_score, score_at_mode_entry, highest_score_achieved)
         VALUES ($1, 'optimization', 0, 0, 0)
         RETURNING *`,
        [userId]
      );
      return res.json({ success: true, userMode: insertResult.rows[0] });
    }

    res.json({ success: true, userMode: result.rows[0] });

  } catch (error) {
    console.error('❌ Get mode error:', error);
    res.status(500).json({ error: 'Failed to fetch user mode' });
  }
});

// ============================================
// GET /api/scan/mode/history - Get mode transition history
// ============================================
router.get('/mode/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;

    const result = await db.query(
      `SELECT * FROM mode_transition_history
       WHERE user_id = $1
       ORDER BY transitioned_at DESC
       LIMIT 50`,
      [userId]
    );

    res.json({ success: true, transitions: result.rows });

  } catch (error) {
    console.error('❌ Get mode history error:', error);
    res.status(500).json({ error: 'Failed to fetch mode history' });
  }
});

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

// ============================================
// POST /api/scan/:id/detection/:detectionId/confirm - Confirm auto-detection
// ============================================
router.post('/:id/detection/:detectionId/confirm', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { id: scanId, detectionId } = req.params;
    const { confirmed, feedback } = req.body;

    // Update detection
    await db.query(
      `UPDATE implementation_detections
       SET user_confirmed = $1, user_feedback = $2, user_notified = true
       WHERE id = $3 AND user_id = $4`,
      [confirmed, feedback, detectionId, userId]
    );

    // If confirmed, mark recommendation as implemented
    if (confirmed) {
      const detectionResult = await db.query(
        `SELECT recommendation_id FROM implementation_detections WHERE id = $1`,
        [detectionId]
      );

      if (detectionResult.rows.length > 0) {
        const recommendationId = detectionResult.rows[0].recommendation_id;
        await db.query(
          `UPDATE scan_recommendations
           SET status = 'implemented', implemented_at = CURRENT_TIMESTAMP, auto_detected_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [recommendationId]
        );
      }
    }

    res.json({ success: true, message: 'Detection confirmed' });

  } catch (error) {
    console.error('❌ Confirm detection error:', error);
    res.status(500).json({ error: 'Failed to confirm detection' });
  }
});

module.exports = router;