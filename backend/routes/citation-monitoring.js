// backend/routes/citation-monitoring.js
// Citation Monitoring endpoints — aligned to 018 prod schema.
//
// Endpoints (all mounted under /api by server.js):
//   GET    /api/prompt-clusters
//   POST   /api/prompt-clusters         (create or update)
//   GET    /api/citation-test-runs
//   GET    /api/citation-evidence
//   GET    /api/benchmark-stats
//
// Column-name translation (DB → API) happens inside the service so the
// response shape matches what frontend/citation-monitoring.js already reads.
'use strict';

const express = require('express');
const {
  authenticateToken,
  authenticateTokenOptional,
} = require('../middleware/auth');
const {
  createCitationMonitoringService,
} = require('../services/citationMonitoringService');
const planService = require('../services/planService');
const db = require('../db/database');

function buildRouter({ service } = {}) {
  const router = express.Router();
  const svc = service || createCitationMonitoringService();

  // ---------- prompt clusters ----------
  router.get('/prompt-clusters', authenticateTokenOptional, async (req, res) => {
    try {
      const userId = req.user?.id ?? null;
      const limit = parseInt(req.query.limit, 10) || 100;
      const rows = await svc.listClusters({ userId, limit });
      return res.json({ success: true, data: rows });
    } catch (err) {
      console.error('listClusters failed:', err.message);
      return res.status(500).json({ success: false, error: 'failed_to_list_clusters' });
    }
  });

  router.post('/prompt-clusters', authenticateToken, async (req, res) => {
    const { name, canonicalPrompt, promptVariants } = req.body || {};
    if (!name || !canonicalPrompt) {
      return res.status(400).json({
        success: false,
        error: 'name and canonicalPrompt are required',
      });
    }
    try {
      const queries = [canonicalPrompt, ...(Array.isArray(promptVariants) ? promptVariants : [])];
      const row = await svc.upsertCluster({
        userId: req.user?.id ?? null,
        clusterName: name,
        queries,
        vertical: 'general',
        intentTier: 'explore',
        source: 'manual',
      });
      return res.status(201).json({ success: true, data: row });
    } catch (err) {
      console.error('upsertCluster failed:', err.message);
      return res.status(500).json({ success: false, error: 'failed_to_save_cluster' });
    }
  });

  // ---------- runs ----------
  router.get('/citation-test-runs', authenticateToken, async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50;
    try {
      const userId = req.user?.id ?? null;
      const rows = await svc.listRuns({ userId, limit });
      return res.json({ success: true, data: rows });
    } catch (err) {
      console.error('listRuns failed:', err.message);
      return res.status(500).json({ success: false, error: 'failed_to_list_runs' });
    }
  });

  // ---------- citation evidence ----------
  router.get('/citation-evidence', authenticateToken, async (req, res) => {
    const runId = Number(req.query.runId);
    if (!Number.isInteger(runId) || runId <= 0) {
      return res.status(400).json({ success: false, error: 'runId is required' });
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

      // Ownership check: run must belong to this user (no personal_orgs JOIN).
      const client = await db.getClient();
      let owned = false;
      try {
        const { rows: ownerRows } = await client.query(
          'SELECT id FROM citation_test_runs WHERE id = $1 AND user_id = $2',
          [runId, req.user.id]
        );
        owned = ownerRows.length > 0;
      } finally {
        client.release();
      }

      if (!owned) {
        return res.status(404).json({ success: false, error: 'run_not_found' });
      }

      const rows = await svc.getEvidence({ runId });
      return res.json({ success: true, data: rows, meta: { isPro } });
    } catch (err) {
      console.error('listEvidence failed:', err.message);
      return res.status(500).json({ success: false, error: 'failed_to_list_evidence' });
    }
  });

  // ---------- benchmark stats (stub) ----------
  router.get('/benchmark-stats', authenticateTokenOptional, async (_req, res) => {
    return res.json({ success: true, data: null });
  });

  return router;
}

module.exports = buildRouter();
module.exports.buildRouter = buildRouter;
