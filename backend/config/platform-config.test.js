'use strict';

// backend/config/platform-config.test.js
// Run with: node --test backend/config/platform-config.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { CITATION_TEST_TOKEN_COST } = require('./platform-config');

describe('platform-config', () => {
  it('exports CITATION_TEST_TOKEN_COST === 3', () => {
    assert.strictEqual(CITATION_TEST_TOKEN_COST, 3);
  });
});
