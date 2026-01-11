/**
 * Repositories Index
 *
 * Central export point for all repository modules.
 * These repositories are the SINGLE SOURCE OF TRUTH for data access.
 */

const recommendationRepository = require('./recommendationRepository');
const progressRepository = require('./progressRepository');

module.exports = {
  recommendationRepository,
  progressRepository,

  // Re-export for convenience
  ...recommendationRepository,
  ...progressRepository
};
