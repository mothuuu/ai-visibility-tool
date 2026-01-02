/**
 * Phase 5: ConnectorRegistry
 *
 * Registry for directory submission connectors.
 * Each connector implements the submit() interface.
 */

'use strict';

const ManualPacketConnector = require('./connectors/ManualPacketConnector');
const BetaListConnector = require('./connectors/BetaListConnector');

class ConnectorRegistry {
  constructor() {
    this.connectors = new Map();

    // Register built-in connectors
    this.register('manual', new ManualPacketConnector());
    this.register('manual_packet', new ManualPacketConnector());

    // Register directory-specific connectors
    this.register('betalist-v1', new BetaListConnector());
  }

  /**
   * Registers a connector
   *
   * @param {string} key - Unique connector key
   * @param {Object} connector - Connector instance with submit() method
   */
  register(key, connector) {
    if (!connector.submit || typeof connector.submit !== 'function') {
      throw new Error(`Connector ${key} must implement submit() method`);
    }
    this.connectors.set(key, connector);
  }

  /**
   * Gets a connector by key
   *
   * @param {string} key - Connector key (from directory.connector_key)
   * @returns {Object|null} Connector instance or null
   */
  getConnector(key) {
    // Default to manual connector if not specified
    if (!key) {
      return this.connectors.get('manual');
    }
    return this.connectors.get(key) || this.connectors.get('manual');
  }

  /**
   * Lists all registered connector keys
   *
   * @returns {string[]} Array of connector keys
   */
  listConnectors() {
    return Array.from(this.connectors.keys());
  }

  /**
   * Checks if a connector exists
   *
   * @param {string} key - Connector key
   * @returns {boolean}
   */
  hasConnector(key) {
    return this.connectors.has(key);
  }
}

module.exports = new ConnectorRegistry();
