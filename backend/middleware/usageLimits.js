const db = require('../db/database');

const PLAN_LIMITS = {
  free: {
    scansPerMonth: 2,
    pagesPerScan: 1, // Homepage only
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
    multiPageScan: true,
    pageSelection: true,
    competitorAnalysis: true,
    pdfExport: true,
    jsonLdExport: true,
    progressTracking: true,
    pageTodoLists: true,
    brandVisibilityIndex: true, // AI visibility across engines
    outsideInCrawl: true // PR, reviews, social mentions
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
    
    // Check if user exceeded monthly limit
    if (req.user.scans_used_this_month >= limits.scansPerMonth) {
      const upgradeMessage = getUpgradeMessage(userPlan);
      
      return res.status(403).json({
        error: 'Scan limit reached',
        message: `You've used ${req.user.scans_used_this_month}/${limits.scansPerMonth} scans this month.`,
        currentPlan: userPlan,
        upgrade: upgradeMessage
      });
    }
    
    // Increment usage
    await db.query(
      'UPDATE users SET scans_used_this_month = scans_used_this_month + 1 WHERE id = $1',
      [userId]
    );
    
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