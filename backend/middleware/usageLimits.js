const db = require('../db/database');

/**
 * Check if monthly quota needs reset and perform reset if needed.
 * Self-healing: resets quota on first request of new month.
 * @param {number} userId - User ID
 * @param {number} currentScansUsed - Current scans_used_this_month value
 * @param {string|null} lastResetDate - Last quota_reset_date from DB
 * @returns {Promise<number>} - Updated scans used (0 if reset, original if not)
 */
async function checkAndResetMonthlyQuota(userId, currentScansUsed, lastResetDate) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Parse last reset date to get its month
  let lastResetMonth = null;
  if (lastResetDate) {
    const resetDate = new Date(lastResetDate);
    lastResetMonth = `${resetDate.getFullYear()}-${String(resetDate.getMonth() + 1).padStart(2, '0')}`;
  }

  // If different month (or never reset), reset the quota
  if (lastResetMonth !== currentMonth) {
    console.log(`🔄 Monthly quota reset for user ${userId}: ${lastResetMonth || 'never'} → ${currentMonth}`);

    await db.query(
      `UPDATE users
       SET scans_used_this_month = 0,
           competitor_scans_used_this_month = 0,
           recs_generated_this_month = 0,
           quota_reset_date = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [userId]
    );

    return 0; // Quota has been reset
  }

  return currentScansUsed; // No reset needed
}

const PLAN_LIMITS = {
  free: {
    scansPerMonth: 2,
    pagesPerScan: 1, // Homepage only
    competitorScans: 0,
    multiPageScan: false,
    pageSelection: false,
    competitorAnalysis: false,
    pdfExport: false,
    jsonLdExport: false,
    progressTracking: true,
    pageTodoLists: false,
    brandVisibilityIndex: false
  },
  diy: {
    scansPerMonth: 25, // Reasonable limit for DIY users
    pagesPerScan: 5, // Homepage + 4 additional pages
    competitorScans: 1,
    multiPageScan: true,
    pageSelection: true, // KEY FEATURE: User chooses which pages
    competitorAnalysis: false,
    pdfExport: false,
    jsonLdExport: true, // Basic JSON-LD export
    progressTracking: true,
    pageTodoLists: true, // Page-level recommendations
    brandVisibilityIndex: false
  },
  pro: {
    scansPerMonth: 50,
    pagesPerScan: 25,
    competitorScans: 3,
    multiPageScan: true,
    pageSelection: true,
    competitorAnalysis: true,
    pdfExport: true,
    jsonLdExport: true,
    progressTracking: true,
    pageTodoLists: true,
    brandVisibilityIndex: true, // AI visibility across engines
    outsideInCrawl: true // PR, reviews, social mentions
  },
  agency: {
    scansPerMonth: -1, // Unlimited
    pagesPerScan: -1,
    competitorScans: 10,
    multiPageScan: true,
    pageSelection: true,
    competitorAnalysis: true,
    pdfExport: true,
    jsonLdExport: true,
    progressTracking: true,
    pageTodoLists: true,
    brandVisibilityIndex: true,
    outsideInCrawl: true
  },
  enterprise: {
    scansPerMonth: -1, // Unlimited
    pagesPerScan: -1,
    competitorScans: 10,
    multiPageScan: true,
    pageSelection: true,
    competitorAnalysis: true,
    pdfExport: true,
    jsonLdExport: true,
    progressTracking: true,
    pageTodoLists: true,
    brandVisibilityIndex: true,
    outsideInCrawl: true
  }
};

async function checkScanLimit(req, res, next) {
  try {
    // Allow anonymous freemium users (1 scan)
    if (!req.user) {
      req.planLimits = {
        scansPerMonth: 1,
        pagesPerScan: 1,
        multiPageScan: false,
        isFreemium: true
      };
      return next();
    }

    const userId = req.user.id;
    const userPlan = req.user.plan || 'free';
    const limits = PLAN_LIMITS[userPlan];

    // Defensive guard: Ensure plan is valid
    if (!limits) {
      console.error(`⚠️ CRITICAL: Invalid plan detected for user ${userId}: "${userPlan}"`);
      await db.query(
        'INSERT INTO usage_logs (user_id, action, metadata) VALUES ($1, $2, $3)',
        [userId, 'invalid_plan_detected', JSON.stringify({
          invalidPlan: userPlan,
          timestamp: new Date().toISOString()
        })]
      );
      return res.status(500).json({
        error: 'Invalid plan configuration',
        message: 'Your account has an invalid plan. Please contact support.'
      });
    }

    // Self-healing monthly quota reset
    // If it's a new month since last reset, automatically reset the quota
    const scansUsed = await checkAndResetMonthlyQuota(
      userId,
      req.user.scans_used_this_month || 0,
      req.user.quota_reset_date
    );

    // Check if user exceeded monthly limit
    // NOTE: We only CHECK here, we do NOT increment.
    // Incrementing happens in the scan route AFTER a successful scan.
    // This prevents double-counting and ensures failed scans aren't counted.
    if (scansUsed >= limits.scansPerMonth) {
      const upgradeMessage = getUpgradeMessage(userPlan);

      return res.status(403).json({
        error: 'Scan limit reached',
        message: `You've used ${scansUsed}/${limits.scansPerMonth} scans this month.`,
        currentPlan: userPlan,
        upgrade: upgradeMessage
      });
    }

    // Pass limits to the route handler (no increment here!)
    req.planLimits = limits;
    next();
  } catch (error) {
    console.error('Usage limit check failed:', error);
    res.status(500).json({ error: 'Failed to check usage limits' });
  }
}

function getUpgradeMessage(currentPlan) {
  switch(currentPlan) {
    case 'free':
      return 'Upgrade to DIY ($29/mo) for 10 scans/month and page selection, or Pro ($99/mo) for 50 scans/month';
    case 'diy':
      return 'Upgrade to Pro ($99/mo) for 50 scans/month and advanced features';
    default:
      return null;
  }
}

function checkFeatureAccess(feature) {
  return (req, res, next) => {
    // Freemium users have no feature access
    if (!req.user) {
      return res.status(403).json({
        error: 'Feature not available',
        message: 'This feature requires a free account or paid plan.',
        upgrade: true
      });
    }

    const limits = PLAN_LIMITS[req.user.plan];

    // Defensive guard: Ensure plan is valid
    if (!limits) {
      console.error(`⚠️ CRITICAL: Invalid plan detected for user ${req.user.id}: "${req.user.plan}"`);
      return res.status(500).json({
        error: 'Invalid plan configuration',
        message: 'Your account has an invalid plan. Please contact support.'
      });
    }

    if (!limits[feature]) {
      const requiredPlan = getRequiredPlan(feature);
      return res.status(403).json({
        error: 'Feature not available',
        message: `This feature requires ${requiredPlan}. Current plan: ${req.user.plan}`,
        requiredPlan,
        upgrade: true
      });
    }
    
    next();
  };
}

function getRequiredPlan(feature) {
  if (PLAN_LIMITS.diy[feature]) return 'DIY plan or higher';
  if (PLAN_LIMITS.pro[feature]) return 'Pro plan';
  return 'a paid plan';
}

// Middleware to validate page count for scan
function validatePageCount(req, res, next) {
  const pageCount = req.body.pages?.length || 1;
  const limits = req.planLimits || PLAN_LIMITS.free;
  
  if (pageCount > limits.pagesPerScan) {
    return res.status(403).json({
      error: 'Page limit exceeded',
      message: `Your plan allows ${limits.pagesPerScan} pages per scan. You requested ${pageCount} pages.`,
      limit: limits.pagesPerScan,
      upgrade: pageCount <= 5 ? 'Upgrade to DIY for 5 pages' : 'Upgrade to Pro for 25 pages'
    });
  }
  
  next();
}

module.exports = { 
  checkScanLimit, 
  checkFeatureAccess, 
  validatePageCount,
  PLAN_LIMITS 
};