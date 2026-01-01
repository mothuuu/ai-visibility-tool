/**
 * Phase 5: Submission Services Index
 *
 * Exports all submission-related services.
 */

'use strict';

const StateMachineService = require('./StateMachineService');
const LockManager = require('./LockManager');
const WorkerService = require('./WorkerService');
const ArtifactWriter = require('./ArtifactWriter');
const ConnectorRegistry = require('./ConnectorRegistry');

module.exports = {
  stateMachine: StateMachineService,
  lockManager: LockManager,
  worker: WorkerService,
  artifactWriter: ArtifactWriter,
  connectorRegistry: ConnectorRegistry
};
