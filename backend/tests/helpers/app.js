/**
 * Test App Factory
 *
 * Creates an Express app instance for testing without starting the server.
 * Mounts only the routes needed for submission tests.
 */

'use strict';

const express = require('express');
const submissionRoutes = require('../../routes/api/submissions');
const { registerTestConnector } = require('../../services/submission/connectors/TestConnector');
const connectorRegistry = require('../../services/submission/ConnectorRegistry');

/**
 * Creates a test Express app
 *
 * @param {Object} options - App options
 * @param {boolean} [options.registerTestConnector=true] - Register the test connector
 * @returns {Object} Express app instance
 */
function createTestApp(options = {}) {
  const { registerTestConnector: shouldRegister = true } = options;

  // Create Express app
  const app = express();

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Mount submission routes
  app.use('/api/submissions', submissionRoutes);

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', env: 'test' });
  });

  // Error handling
  app.use((err, req, res, next) => {
    console.error('Test app error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error'
    });
  });

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  // Register test connector if requested
  if (shouldRegister) {
    registerTestConnector(connectorRegistry);
  }

  return app;
}

module.exports = { createTestApp };
