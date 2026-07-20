/**
 * Admin Routes
 * Phase 2.1: Admin endpoints for org and plan management
 *
 * All routes require admin authentication
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticateAdmin, authenticateSuperAdmin, requirePermission, createAuditLog } = require('../middleware/adminAuth');
const { setOrgPlanOverride, resolvePlanForRequest, getOrgRow } = require('../services/planService');
const { getEntitlements } = require('../services/scanEntitlementService');
const { extractRootDomain } = require('../utils/domain-extractor');
const { buildCsv } = require('../utils/csvSanitizer');

// ============================================
// GET /api/admin/orgs/:orgId - Get organization details
// ============================================
router.get('/orgs/:orgId', authenticateAdmin, async (req, res) => {
  try {
    const { orgId } = req.params;

    const result = await db.query(`
      SELECT
        o.id,
        o.name,
        o.slug,
        o.org_type,
        o.plan,
        o.plan_source,
        o.plan_override,
        o.plan_override_set_at,
        o.plan_override_set_by,
        o.plan_override_reason,
        o.stripe_customer_id,
        o.stripe_subscription_id,
        o.stripe_subscription_status,
        o.stripe_price_id,
        o.stripe_current_period_start,
        o.stripe_current_period_end,
        o.seat_limit,
        o.owner_user_id,
        o.created_at,
        o.updated_at,
        u.email as owner_email
      FROM organizations o
      LEFT JOIN users u ON o.owner_user_id = u.id
      WHERE o.id = $1
    `, [orgId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const org = result.rows[0];

    // Resolve effective plan
    const planResolution = await resolvePlanForRequest({ orgId: parseInt(orgId) });

    res.json({
      success: true,
      organization: org,
      effectivePlan: {
        plan: planResolution.plan,
        source: planResolution.source
      },
      entitlements: getEntitlements(planResolution.plan)
    });
  } catch (error) {
    console.error('Admin get org error:', error);
    res.status(500).json({ error: 'Failed to get organization', details: error.message });
  }
});

// ============================================
// POST /api/admin/orgs/:orgId/plan-override - Set/clear plan override
// ============================================
router.post('/orgs/:orgId/plan-override', authenticateSuperAdmin, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { plan_override, reason } = req.body;
    const adminUserId = req.user.id;

    // Validate input
    if (plan_override !== null && plan_override !== undefined) {
      const validPlans = ['free', 'diy', 'pro', 'agency', 'enterprise'];
      if (!validPlans.includes(plan_override.toLowerCase())) {
        return res.status(400).json({
          error: 'Invalid plan',
          message: `Plan must be one of: ${validPlans.join(', ')}`
        });
      }
    }

    if (!reason) {
      return res.status(400).json({
        error: 'Reason required',
        message: 'Please provide a reason for setting/clearing the override'
      });
    }

    // Get org before update for audit log
    const orgBefore = await getOrgRow(parseInt(orgId));
    if (!orgBefore) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Set the override
    const result = await setOrgPlanOverride(
      parseInt(orgId),
      plan_override || null,
      adminUserId,
      reason
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Resolve effective plan after update
    const planResolution = await resolvePlanForRequest({ orgId: parseInt(orgId) });

    // Create audit log
    await createAuditLog(
      req.user,
      plan_override ? 'SET_PLAN_OVERRIDE' : 'CLEAR_PLAN_OVERRIDE',
      'organization',
      orgId,
      `${plan_override ? `Set plan override to ${plan_override}` : 'Cleared plan override'}: ${reason}`,
      {
        before: {
          plan_source: orgBefore.plan_source,
          plan_override: orgBefore.plan_override
        },
        after: {
          plan_source: result.org.plan_source,
          plan_override: result.org.plan_override
        }
      }
    );

    console.log(`[Admin] Org ${orgId} plan override ${plan_override ? `set to ${plan_override}` : 'cleared'} by ${req.user.email}`);

    res.json({
      success: true,
      orgId: parseInt(orgId),
      plan_source: result.org.plan_source,
      plan_override: result.org.plan_override,
      effective_plan: planResolution.plan,
      effective_source: planResolution.source,
      entitlements: getEntitlements(planResolution.plan)
    });
  } catch (error) {
    console.error('Admin set plan override error:', error);
    res.status(500).json({ error: 'Failed to set plan override', details: error.message });
  }
});

// ============================================
// GET /api/admin/users/:userId/plan - Get user's effective plan
// ============================================
router.get('/users/:userId/plan', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user with org
    const userResult = await db.query(`
      SELECT u.id, u.email, u.plan as user_plan, u.organization_id,
             o.id as org_id, o.name as org_name, o.plan as org_plan,
             o.plan_source, o.plan_override
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE u.id = $1
    `, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Resolve effective plan
    const planResolution = await resolvePlanForRequest({
      userId: parseInt(userId),
      orgId: user.organization_id
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        user_plan: user.user_plan,
        organization_id: user.organization_id
      },
      organization: user.org_id ? {
        id: user.org_id,
        name: user.org_name,
        org_plan: user.org_plan,
        plan_source: user.plan_source,
        plan_override: user.plan_override
      } : null,
      effectivePlan: {
        plan: planResolution.plan,
        source: planResolution.source
      },
      entitlements: getEntitlements(planResolution.plan)
    });
  } catch (error) {
    console.error('Admin get user plan error:', error);
    res.status(500).json({ error: 'Failed to get user plan', details: error.message });
  }
});

// ============================================
// GET /api/admin/health - Admin API health check
// ============================================
router.get('/health', authenticateAdmin, async (req, res) => {
  res.json({
    success: true,
    message: 'Admin API healthy',
    admin: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role
    }
  });
});

// ============================================
// GET /api/admin/scans/export - One-click "Export All" leads CSV (BDR outreach)
// ============================================
//
// Read-only. Aggregates one row per LEAD from every scan:
//   - registered users (user_id set) → grouped by user
//   - guests (user_id NULL)          → grouped by canonical domain of the URL
// No pagination, no filters — always the full dataset. Domain grouping reuses
// the tested extractRootDomain() (www/subdomain stripping) because guest scans
// don't persist a domain column. Score is scans.total_score (/1000; NULL while
// processing/failed — excluded from trend math but the scan still counts).
const LEAD_EXPORT_SQL = `
  SELECT s.id, s.url, s.total_score AS score, s.created_at,
         s.user_id, u.email AS user_email, u.plan AS user_plan
    FROM scans s
    LEFT JOIN users u ON s.user_id = u.id
   ORDER BY s.created_at ASC NULLS LAST, s.id ASC
`;

const LEAD_EXPORT_HEADER = [
  'lead_type', 'email', 'plan', 'primary_domain', 'total_scans',
  'first_scan_date', 'last_scan_date', 'latest_score', 'first_score',
  'score_trend', 'all_domains_scanned',
];

// Aggregate raw scan rows (from LEAD_EXPORT_SQL, created_at ASC) into one lead
// per registered user / per guest root-domain. Pure — no DB, no res — so the
// verification harness can run it against live rows with zero HTTP/auth/deploy.
function aggregateScanLeads(rows) {
  const groups = new Map();
  const domainOf = (url) => {
    const d = extractRootDomain(url);
    return (d && d.trim()) ? d.trim().toLowerCase() : (url || '(unknown)');
  };

  for (const r of rows) {
    const isGuest = r.user_id == null;
    const domain = domainOf(r.url);
    const key = isGuest ? `guest::${domain}` : `user::${r.user_id}`;

    let g = groups.get(key);
    if (!g) {
      g = {
        lead_type: isGuest ? 'guest' : 'user',
        email: isGuest ? '' : (r.user_email || ''),
        plan: isGuest ? 'guest' : (r.user_plan || 'free'),
        scans: [],
        domainCounts: new Map(),  // domain → count (for most-scanned)
        domainOrder: [],          // distinct domains, first-seen order
      };
      groups.set(key, g);
    }

    const score = (r.score === null || r.score === undefined) ? null : Number(r.score);
    g.scans.push({ domain, score, created_at: r.created_at });

    if (!g.domainCounts.has(domain)) g.domainOrder.push(domain);
    g.domainCounts.set(domain, (g.domainCounts.get(domain) || 0) + 1);
  }

  const fmtDate = (d) => {
    if (!d) return '';
    const dt = (d instanceof Date) ? d : new Date(d);
    return isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10); // YYYY-MM-DD
  };

  const leads = [];
  for (const g of groups.values()) {
    // Scans arrive in created_at ASC order from SQL; keep that for first/last.
    const scans = g.scans;
    const total_scans = scans.length;
    const first_scan_date = fmtDate(scans[0] && scans[0].created_at);
    const last_scan_date = fmtDate(scans[total_scans - 1] && scans[total_scans - 1].created_at);

    // Score trend from SCORED scans only (NULL scores don't count as data points).
    const scored = scans.filter(s => s.score !== null && Number.isFinite(s.score));
    const first_score = scored.length ? scored[0].score : '';
    const latest_score = scored.length ? scored[scored.length - 1].score : '';
    let score_trend;
    if (scored.length <= 1) {
      score_trend = 'single_scan';
    } else {
      const diff = scored[scored.length - 1].score - scored[0].score;
      if (Math.abs(diff) <= 3) score_trend = 'flat';
      else score_trend = diff > 0 ? 'improving' : 'declining';
    }

    // primary_domain = most-scanned domain (ties → most recently seen).
    let primary_domain = '';
    let best = -1;
    for (const dom of g.domainOrder) {
      const c = g.domainCounts.get(dom);
      if (c >= best) { best = c; primary_domain = dom; } // >= so later (more recent) wins ties
    }

    leads.push({
      lead_type: g.lead_type,
      email: g.email,
      plan: g.plan,
      primary_domain,
      total_scans,
      first_scan_date,
      last_scan_date,
      latest_score,
      first_score,
      score_trend,
      all_domains_scanned: g.domainOrder.join(';'),
    });
  }

  // Sort: warm leads (guests + free-plan users) first, then total_scans DESC,
  // then most-recent activity — warmest outreach targets at the top.
  const isWarm = (l) => l.lead_type === 'guest' || String(l.plan).toLowerCase() === 'free';
  leads.sort((a, b) => {
    const wa = isWarm(a) ? 0 : 1;
    const wb = isWarm(b) ? 0 : 1;
    if (wa !== wb) return wa - wb;
    if (b.total_scans !== a.total_scans) return b.total_scans - a.total_scans;
    return (b.last_scan_date || '').localeCompare(a.last_scan_date || '');
  });

  return leads;
}

function buildLeadsCsv(leads) {
  return buildCsv(LEAD_EXPORT_HEADER, leads.map(l => LEAD_EXPORT_HEADER.map(h => l[h])));
}

router.get('/scans/export', authenticateAdmin, requirePermission('export_data'), async (req, res) => {
  try {
    const { rows } = await db.query(LEAD_EXPORT_SQL);
    const leads = aggregateScanLeads(rows);
    const csv = buildLeadsCsv(leads);
    const today = new Date().toISOString().slice(0, 10);

    try {
      await createAuditLog(
        req.user, 'EXPORT_SCAN_LEADS', 'scans', null,
        `Exported ${leads.length} scan leads to CSV`, { count: leads.length }
      );
    } catch (_) { /* audit failure must not block the download */ }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="visible2ai-scan-leads-${today}.csv"`);
    return res.send(csv);
  } catch (error) {
    console.error('[Admin Scans Export] Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to export scan leads', message: error.message });
  }
});

// Expose the pure helpers (and SQL) for the read-only verification harness.
router.LEAD_EXPORT_SQL = LEAD_EXPORT_SQL;
router.LEAD_EXPORT_HEADER = LEAD_EXPORT_HEADER;
router.aggregateScanLeads = aggregateScanLeads;
router.buildLeadsCsv = buildLeadsCsv;

module.exports = router;
