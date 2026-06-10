'use strict';

// Central home for platform-wide constants that cross service boundaries.
// Add only values here that are agreed across the team; do not add speculative
// entitlements or feature flags — those will be defined in future checkpoints.

const CITATION_TEST_TOKEN_COST = 3;
const CITATION_ENGINES = ['chatgpt', 'claude', 'perplexity'];

module.exports = { CITATION_TEST_TOKEN_COST, CITATION_ENGINES };
