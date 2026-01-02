/**
 * Phase 5 Step 3A: BetaList Connector Unit Tests
 *
 * Tests for BetaListConnector validation and submission behavior.
 * Uses Node.js built-in test runner.
 */

'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const BetaListConnector = require('../../../services/submission/connectors/BetaListConnector');
const {
  STATUS_REASON,
  ACTION_NEEDED_TYPE,
  ERROR_TYPE
} = require('../../../constants/submission-enums');

describe('BetaListConnector', async () => {
  let connector;

  beforeEach(() => {
    connector = new BetaListConnector();
  });

  // ============================================
  // getCapabilities() Tests
  // ============================================

  describe('getCapabilities()', async () => {
    it('should return validate and submit capabilities', () => {
      const capabilities = connector.getCapabilities();

      assert.ok(Array.isArray(capabilities));
      assert.ok(capabilities.includes('validate'));
      assert.ok(capabilities.includes('submit'));
      assert.strictEqual(capabilities.length, 2);
    });
  });

  // ============================================
  // validate() Tests - Success Cases
  // ============================================

  describe('validate() - success cases', async () => {
    it('should pass validation for a correct listing', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          tagline: 'The best startup platform ever',
          description: 'This is a comprehensive description of our amazing startup platform that helps users discover new products and services. We provide innovative solutions for modern businesses.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS', 'Productivity']
        }
      };

      const result = connector.validate(listing);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should pass validation with short_description instead of tagline', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          short_description: 'A great product for everyone',
          description: 'This is a comprehensive description of our amazing startup platform that helps users discover new products and services. We provide innovative solutions for modern businesses.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['Technology']
        }
      };

      const result = connector.validate(listing);

      assert.strictEqual(result.valid, true);
    });

    it('should derive tagline from description when not provided', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          // No tagline or short_description - will be derived
          description: 'Amazing startup platform. This is a comprehensive description that provides all the information needed to understand what we do and why we are unique in the market.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['Technology']
        }
      };

      const result = connector.validate(listing);

      // Should pass because tagline is derived from first sentence
      assert.strictEqual(result.valid, true);
    });

    it('should derive tagline by truncating long description', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          // No tagline - description first sentence is too long
          description: 'This is a comprehensive description of our amazing startup platform that helps users discover new products and services and provides innovative solutions for modern businesses all over the world.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com'
        }
      };

      const result = connector.validate(listing);

      // Should pass because tagline is derived (truncated)
      assert.strictEqual(result.valid, true);
    });

    it('should add warning for missing logo_url but still pass', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          tagline: 'Great product',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day. We help businesses grow.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS']
        }
      };

      const result = connector.validate(listing);

      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.length > 0);
      assert.ok(result.warnings.some(w => w.field === 'logo_url'));
    });

    it('should add warning for tagline ending with period', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          tagline: 'Great product for everyone.',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day. We help businesses grow.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS'],
          logo_url: 'https://example.com/logo.png'
        }
      };

      const result = connector.validate(listing);

      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.code === 'STYLE_PERIOD'));
    });

    it('should add warning for tagline starting with article', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          tagline: 'A great product for everyone',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day. We help businesses grow.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS'],
          logo_url: 'https://example.com/logo.png'
        }
      };

      const result = connector.validate(listing);

      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.code === 'STYLE_ARTICLE'));
    });
  });

  // ============================================
  // validate() Tests - Failure Cases
  // ============================================

  describe('validate() - failure cases', async () => {
    it('should fail for tagline exceeding 60 characters', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          tagline: 'This is an extremely long tagline that definitely exceeds the sixty character limit imposed by BetaList',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS']
        }
      };

      const result = connector.validate(listing);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.field === 'short_description' && e.code === 'MAX_LENGTH'));
    });

    it('should fail for description under 160 characters', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          tagline: 'Great product',
          description: 'This is too short a description.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS']
        }
      };

      const result = connector.validate(listing);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.field === 'long_description' && e.code === 'MIN_LENGTH'));
    });

    it('should fail for description exceeding 500 characters', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          tagline: 'Great product',
          description: 'A'.repeat(501), // 501 characters
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS']
        }
      };

      const result = connector.validate(listing);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.field === 'long_description' && e.code === 'MAX_LENGTH'));
    });

    it('should warn (not fail) for missing categories', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          tagline: 'Great product',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com'
          // categories missing - operator must select during submission
        }
      };

      const result = connector.validate(listing);

      // Should pass validation but with warning
      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.field === 'categories' && w.code === 'MISSING_CATEGORIES'));
    });

    it('should warn (not fail) for empty categories array', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          tagline: 'Great product',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: [] // empty array - operator must select
        }
      };

      const result = connector.validate(listing);

      // Should pass validation but with warning
      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.field === 'categories'));
    });

    it('should fail for missing business name', () => {
      const listing = {
        business: {
          tagline: 'Great product',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS']
        }
      };

      const result = connector.validate(listing);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.field === 'business_name' && e.code === 'REQUIRED'));
    });

    it('should fail for invalid URL', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          tagline: 'Great product',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day.',
          website: 'not-a-valid-url',
          email: 'contact@teststartup.com',
          categories: ['SaaS']
        }
      };

      const result = connector.validate(listing);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.field === 'website_url' && e.code === 'INVALID_FORMAT'));
    });

    it('should fail for invalid email', () => {
      const listing = {
        business: {
          name: 'TestStartup',
          tagline: 'Great product',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day.',
          website: 'https://teststartup.com',
          email: 'not-an-email',
          categories: ['SaaS']
        }
      };

      const result = connector.validate(listing);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.field === 'contact_email' && e.code === 'INVALID_FORMAT'));
    });

    it('should fail for business name exceeding 100 characters', () => {
      const listing = {
        business: {
          name: 'A'.repeat(101),
          tagline: 'Great product',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS']
        }
      };

      const result = connector.validate(listing);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.field === 'business_name' && e.code === 'MAX_LENGTH'));
    });
  });

  // ============================================
  // submit() Tests
  // ============================================

  describe('submit()', async () => {
    it('should return ACTION_NEEDED status with correct enum values', async () => {
      const payload = {
        business: {
          name: 'TestStartup',
          tagline: 'The best startup platform',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS', 'Productivity']
        },
        directory: {
          id: 1,
          name: 'BetaList'
        },
        submission: {
          targetId: 'test-target-123'
        }
      };

      const result = await connector.submit(payload, {});

      assert.strictEqual(result.status, 'action_needed');
      // CRITICAL: reason must be STATUS_REASON enum value
      assert.strictEqual(result.reason, STATUS_REASON.VERIFICATION_REQUIRED);
      // actionNeeded.type must be ACTION_NEEDED_TYPE enum value
      assert.strictEqual(result.actionNeeded.type, ACTION_NEEDED_TYPE.MANUAL_REVIEW);
      assert.strictEqual(result.actionNeeded.url, 'https://betalist.com/submit');
    });

    it('should include manual packet with field mapping', async () => {
      const payload = {
        business: {
          name: 'TestStartup',
          tagline: 'The best startup platform',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS']
        },
        directory: { id: 1, name: 'BetaList' },
        submission: { targetId: 'test-target-123' }
      };

      const result = await connector.submit(payload, {});

      assert.ok(result.rawResponse);
      const packet = result.rawResponse;

      // Check packet structure
      assert.strictEqual(packet.directoryName, 'BetaList');
      assert.strictEqual(packet.directorySlug, 'betalist');
      assert.strictEqual(packet.submissionUrl, 'https://betalist.com/submit');

      // Check field mapping exists
      assert.ok(packet.formFieldMap);
      assert.strictEqual(packet.formFieldMap.business_name, 'startup[name]');
      assert.strictEqual(packet.formFieldMap.short_description, 'startup[tagline]');

      // Check prefill data
      assert.ok(packet.prefillData);
      assert.strictEqual(packet.prefillData['startup[name]'], 'TestStartup');
      assert.strictEqual(packet.prefillData['startup[tagline]'], 'The best startup platform');

      // Check operator instructions
      assert.ok(Array.isArray(packet.operatorInstructions));
      assert.ok(packet.operatorInstructions.length > 0);

      // Check compliance notice
      assert.ok(packet.complianceNotice);
      assert.strictEqual(packet.automationEnabled, false);
    });

    it('should include validation warnings in packet', async () => {
      const payload = {
        business: {
          name: 'TestStartup',
          tagline: 'A great product for everyone.', // Ends with period, starts with article
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS']
          // logo_url missing
        },
        directory: { id: 1, name: 'BetaList' },
        submission: { targetId: 'test-target-123' }
      };

      const result = await connector.submit(payload, {});
      const packet = result.rawResponse;

      assert.ok(packet.validationSummary);
      assert.ok(packet.validationSummary.warningCount >= 2); // At least logo + style warnings
    });

    it('should return error for invalid listing', async () => {
      const payload = {
        business: {
          name: 'TestStartup',
          // Missing required fields
        },
        directory: { id: 1, name: 'BetaList' },
        submission: { targetId: 'test-target-123' }
      };

      const result = await connector.submit(payload, {});

      assert.strictEqual(result.status, 'error');
      assert.strictEqual(result.errorType, ERROR_TYPE.VALIDATION_ERROR);
      assert.strictEqual(result.retryable, false);
      assert.ok(result.errorMessage.includes('Validation failed'));
    });

    it('should set deadline 10 days from now', async () => {
      const payload = {
        business: {
          name: 'TestStartup',
          tagline: 'Great product',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS']
        },
        directory: { id: 1, name: 'BetaList' },
        submission: { targetId: 'test-target-123' }
      };

      const before = Date.now();
      const result = await connector.submit(payload, {});
      const after = Date.now();

      const deadline = new Date(result.actionNeeded.deadline);
      const tenDaysMs = 10 * 24 * 60 * 60 * 1000;

      assert.ok(deadline.getTime() >= before + tenDaysMs - 1000);
      assert.ok(deadline.getTime() <= after + tenDaysMs + 1000);
    });

    it('should include instructions text', async () => {
      const payload = {
        business: {
          name: 'TestStartup',
          tagline: 'Great product',
          description: 'This is a comprehensive description of our startup that provides all the information needed to understand what we do and why we are unique in the market. We help businesses grow every day.',
          website: 'https://teststartup.com',
          email: 'contact@teststartup.com',
          categories: ['SaaS']
        },
        directory: { id: 1, name: 'BetaList' },
        submission: { targetId: 'test-target-123' }
      };

      const result = await connector.submit(payload, {});

      assert.ok(result.actionNeeded.instructions);
      assert.ok(typeof result.actionNeeded.instructions === 'string');
      assert.ok(result.actionNeeded.instructions.includes('https://betalist.com/submit'));
      assert.ok(result.actionNeeded.instructions.includes('TestStartup'));
    });
  });
});
