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
