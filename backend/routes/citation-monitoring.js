// backend/routes/citation-monitoring.js
// Phase 3 — read/write endpoints for the Citation Monitoring product.
//
// Endpoints (all mounted under /api by server.js):
//   GET    /api/prompt-clusters
//   POST   /api/prompt-clusters         (create or update)
//   GET    /api/citation-test-runs
//   GET    /api/benchmark-stats
//
// This router is INTENTIONALLY separate from /api/citation-network
// (directory submissions). They share no tables.
'use strict';

const express = require('express');
const {
  authenticateToken,
  authenticateTokenOptional,
} = require('../middleware/auth');
const {
  createCitationMonitoringService,
  ALLOWED_WINDOWS,
} = require('../services/citationMonitoringService');
const planService = require('../services/planService');
const db = require('../db/database');

function buildRouter({ service } = {}) {
  const router = express.Router();
  // Resolve lazily so tests can swap in a fake before each request.
  const svc = service || createCitationMonitoringService();

  // ---------- prompt clusters ----------
  router.get('/prompt-clusters', authenticateTokenOptional, async (req, res) => {
    try {
      const orgId = req.user?.org_id ?? null;
      const userId = req.user?.id ?? null;
      const limit = parseInt(req.query.limit, 10) || 100;
      const rows = await svc.listClusters({ orgId, userId, limit });
      return res.json({ success: true, data: rows });
    } catch (err) {
      console.error('listClusters failed:', err.message);
      return res
        .status(500)
        .json({ success: false, error: 'failed_to_list_clusters' });
    }
  });

  router.post('/prompt-clusters', authenticateToken, async (req, res) => {
    const {
      id,
      name,
      canonicalPrompt,
      promptVariants,
      industry,
      persona,
      funnelStage,
      competitorDomains,
    } = req.body || {};
    if (!name || !canonicalPrompt) {
      return res.status(400).json({
        success: false,
        error: 'name and canonicalPrompt are required',
      });
    }
    try {
      const resolvedPlan = await planService.resolvePlanForRequest({
        userId: req.user.id,
        orgId: req.user.organization_id ?? null,
      });
      if (!planService.canAccessFeature(resolvedPlan.plan, 'hasCitation')) {
        return res.status(403).json({
          error: 'plan_upgrade_required',
          message: 'Citation tests require Starter or Pro plan',
        });
      }
      const row = await svc.upsertCluster({
        id,
        orgId: req.user?.org_id ?? null,
        userId: req.user?.id ?? null,
        name,
        canonicalPrompt,
        promptVariants,
        industry,
        persona,
        funnelStage,
        competitorDomains,
      });
      return res.status(id ? 200 : 201).json({ success: true, data: row });
    } catch (err) {
      console.error('upsertCluster failed:', err.message);
      return res
        .status(500)
        .json({ success: false, error: 'failed_to_save_cluster' });
    }
  });

  // ---------- runs ----------
  router.get('/citation-test-runs', authenticateTokenOptional, async (req, res) => {
    const clusterId = parseInt(req.query.clusterId, 10);
    if (!clusterId) {
      return res
        .status(400)
        .json({ success: false, error: 'clusterId is required' });
    }
    const limit = parseInt(req.query.limit, 10) || 50;
    try {
      const rows = await svc.listRuns({ clusterId, limit });
      return res.json({ success: true, data: rows });
    } catch (err) {
      console.error('listRuns failed:', err.message);
      return res
        .status(500)
        .json({ success: false, error: 'failed_to_list_runs' });
    }
  });

  // ---------- citation evidence ----------
  router.get('/citation-evidence', authenticateToken, async (req, res) => {
    const runId = Number(req.query.runId);
    if (!Number.isInteger(runId) || runId <= 0) {
      return res
        .status(400)
        .json({ success: false, error: 'runId is required' });
    }
    try {
      const resolvedPlan = await planService.resolvePlanForRequest({
        userId: req.user.id,
        orgId: req.user.organization_id ?? null,
      });
      if (!planService.canAccessFeature(resolvedPlan.plan, 'hasCitation')) {
        return res.status(403).json({ error: 'plan_upgrade_required' });
      }

      const isPro =
        planService.getEntitlements(resolvedPlan.plan).hasCitation === 'pro';

      let owned = false;
      const client = await db.getClient();
      try {
        const { rows: ownerRows } = await client.query(
          `SELECT ctr.id
             FROM citation_test_runs ctr
             JOIN personal_orgs po ON po.id = ctr.initiated_by_org_id
            WHERE ctr.id = $1
              AND po.user_id = $2`,
          [runId, req.user.id]
        );
        owned = ownerRows.length > 0;
      } finally {
        client.release();
      }

      if (!owned) {
        return res
          .status(404)
          .json({ success: false, error: 'run_not_found' });
      }

      const rows = await svc.getEvidence({ runId });
      return res.json({ success: true, data: rows, meta: { isPro } });
    } catch (err) {
      console.error('listEvidence failed:', err.message);
      return res
        .status(500)
        .json({ success: false, error: 'failed_to_list_evidence' });
    }
  });

  // ---------- benchmark stats ----------
  router.get('/benchmark-stats', authenticateTokenOptional, async (req, res) => {
    const clusterId = parseInt(req.query.clusterId, 10);
    const window = (req.query.window || '30d').toString();
    if (!clusterId) {
      return res
        .status(400)
        .json({ success: false, error: 'clusterId is required' });
    }
    if (!ALLOWED_WINDOWS.has(window)) {
      return res
        .status(400)
        .json({ success: false, error: 'unsupported window' });
    }
    try {
      const row = await svc.getBenchmark({ clusterId, window });
      return res.json({ success: true, data: row });
    } catch (err) {
      console.error('getBenchmark failed:', err.message);
      return res
        .status(500)
        .json({ success: false, error: 'failed_to_get_benchmark' });
    }
  });

  return router;
}

// Default export is a fully wired router using the real DB; tests can
// import buildRouter and inject a stub service.
module.exports = buildRouter();
module.exports.buildRouter = buildRouter;
