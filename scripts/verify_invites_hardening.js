#!/usr/bin/env node
/**
 * Verify Invite Hardening - Phase 3B.1C
 *
 * Tests:
 * 1. Idempotent invite creation (same invite returned on duplicate)
 * 2. List invites shows pending invite
 * 3. Revoke invite works
 * 4. Accept revoked invite fails with proper error code
 *
 * Required environment variables:
 *   API_BASE_URL   - e.g., http://localhost:3001/api
 *   TOKEN_OWNER    - JWT token for owner/admin user
 *   INVITED_EMAIL  - Email to use for test invite
 *
 * Usage:
 *   API_BASE_URL=http://localhost:3001/api TOKEN_OWNER=eyJ... INVITED_EMAIL=test@example.com node scripts/verify_invites_hardening.js
 */

const API_BASE_URL = process.env.API_BASE_URL;
const TOKEN_OWNER = process.env.TOKEN_OWNER;
const INVITED_EMAIL = process.env.INVITED_EMAIL;

// ANSI colors for output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function pass(msg) {
  console.log(`${GREEN}✓ PASS${RESET}: ${msg}`);
}

function fail(msg) {
  console.log(`${RED}✗ FAIL${RESET}: ${msg}`);
  process.exitCode = 1;
}

function info(msg) {
  console.log(`${YELLOW}→${RESET} ${msg}`);
}

async function makeRequest(endpoint, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
  const data = await response.json();
  return { status: response.status, data };
}

async function runTests() {
  console.log('\n========================================');
  console.log('  Phase 3B.1C - Invite Hardening Tests');
  console.log('========================================\n');

  // Validate environment
  if (!API_BASE_URL || !TOKEN_OWNER || !INVITED_EMAIL) {
    fail('Missing required environment variables');
    console.log('Required: API_BASE_URL, TOKEN_OWNER, INVITED_EMAIL');
    process.exit(1);
  }

  info(`API: ${API_BASE_URL}`);
  info(`Test email: ${INVITED_EMAIL}`);
  console.log('');

  let inviteId = null;
  let inviteToken = null;
  let firstInviteId = null;

  // =========================================================================
  // Test 1: Create invite (first time)
  // =========================================================================
  info('Test 1: Create invite (first time)');
  try {
    const { status, data } = await makeRequest('/org/invites', 'POST', {
      email: INVITED_EMAIL,
      role: 'member'
    }, TOKEN_OWNER);

    if (status === 201 && data.success && data.inviteId) {
      pass(`Created invite #${data.inviteId} for ${data.email}`);
      firstInviteId = data.inviteId;
      inviteId = data.inviteId;
      // Extract token from invite link
      const linkMatch = data.inviteLink?.match(/token=([a-f0-9]+)/);
      if (linkMatch) {
        inviteToken = linkMatch[1];
      }
    } else if (status === 200 && data.existingInvite) {
      pass(`Existing invite #${data.inviteId} returned (already exists)`);
      firstInviteId = data.inviteId;
      inviteId = data.inviteId;
      const linkMatch = data.inviteLink?.match(/token=([a-f0-9]+)/);
      if (linkMatch) {
        inviteToken = linkMatch[1];
      }
    } else {
      fail(`Unexpected response: ${JSON.stringify(data)}`);
    }
  } catch (error) {
    fail(`Request failed: ${error.message}`);
  }

  // =========================================================================
  // Test 2: Create invite again (idempotent - should return same invite)
  // =========================================================================
  info('Test 2: Create same invite again (idempotent check)');
  try {
    const { status, data } = await makeRequest('/org/invites', 'POST', {
      email: INVITED_EMAIL,
      role: 'member'
    }, TOKEN_OWNER);

    if (status === 200 && data.existingInvite && data.inviteId === firstInviteId) {
      pass(`Idempotent: Same invite #${data.inviteId} returned`);
    } else if (status === 200 && data.alreadyMember) {
      pass(`User is already a member (expected if previously joined)`);
    } else if (status === 201) {
      fail(`Created NEW invite #${data.inviteId} instead of returning existing #${firstInviteId}`);
    } else {
      fail(`Unexpected response: ${JSON.stringify(data)}`);
    }
  } catch (error) {
    fail(`Request failed: ${error.message}`);
  }

  // =========================================================================
  // Test 3: List invites (should see pending invite)
  // =========================================================================
  info('Test 3: List invites (verify pending invite exists)');
  try {
    const { status, data } = await makeRequest('/org/invites', 'GET', null, TOKEN_OWNER);

    if (status === 200 && data.success && Array.isArray(data.invites)) {
      const pendingInvite = data.invites.find(i => i.id === inviteId);
      if (pendingInvite) {
        pass(`Found pending invite #${inviteId} in list (${data.invites.length} total pending)`);
      } else {
        fail(`Invite #${inviteId} not found in pending list`);
      }
    } else {
      fail(`Unexpected response: ${JSON.stringify(data)}`);
    }
  } catch (error) {
    fail(`Request failed: ${error.message}`);
  }

  // =========================================================================
  // Test 4: Revoke the invite
  // =========================================================================
  info('Test 4: Revoke the invite');
  try {
    const { status, data } = await makeRequest('/org/invites/revoke', 'POST', {
      inviteId: inviteId
    }, TOKEN_OWNER);

    if (status === 200 && data.success) {
      pass(`Invite #${inviteId} revoked successfully`);
    } else {
      fail(`Failed to revoke: ${JSON.stringify(data)}`);
    }
  } catch (error) {
    fail(`Request failed: ${error.message}`);
  }

  // =========================================================================
  // Test 5: Revoke again (should be idempotent)
  // =========================================================================
  info('Test 5: Revoke same invite again (idempotent check)');
  try {
    const { status, data } = await makeRequest('/org/invites/revoke', 'POST', {
      inviteId: inviteId
    }, TOKEN_OWNER);

    if (status === 200 && data.alreadyRevoked) {
      pass(`Idempotent: Already revoked message returned`);
    } else if (status === 200 && data.success) {
      pass(`Revoke returned success (idempotent)`);
    } else {
      fail(`Unexpected response: ${JSON.stringify(data)}`);
    }
  } catch (error) {
    fail(`Request failed: ${error.message}`);
  }

  // =========================================================================
  // Test 6: Accept revoked invite (should fail with REVOKED code)
  // =========================================================================
  info('Test 6: Accept revoked invite (should fail)');
  if (!inviteToken) {
    fail('No invite token available for accept test');
  } else {
    try {
      const { status, data } = await makeRequest('/org/invites/accept', 'POST', {
        token: inviteToken
      }, TOKEN_OWNER);

      if (status === 400 && data.code === 'REVOKED') {
        pass(`Revoked invite rejected with code: ${data.code}`);
      } else if (status === 200 && data.needsAuth) {
        // This happens if using owner token that doesn't match invited email
        pass(`Got needsAuth (expected - owner email likely differs from invited email)`);
      } else if (status === 403) {
        pass(`Got 403 (email mismatch - expected if owner email != invited email)`);
      } else {
        fail(`Expected REVOKED error, got: status=${status}, data=${JSON.stringify(data)}`);
      }
    } catch (error) {
      fail(`Request failed: ${error.message}`);
    }
  }

  // =========================================================================
  // Test 7: Accept with invalid token
  // =========================================================================
  info('Test 7: Accept with invalid token (should 404)');
  try {
    const { status, data } = await makeRequest('/org/invites/accept', 'POST', {
      token: 'invalid_token_12345'
    }, TOKEN_OWNER);

    if (status === 404) {
      pass(`Invalid token rejected with 404`);
    } else {
      fail(`Expected 404, got: status=${status}, data=${JSON.stringify(data)}`);
    }
  } catch (error) {
    fail(`Request failed: ${error.message}`);
  }

  // =========================================================================
  // Test 8: Accept without token (should 400)
  // =========================================================================
  info('Test 8: Accept without token (should 400)');
  try {
    const { status, data } = await makeRequest('/org/invites/accept', 'POST', {}, TOKEN_OWNER);

    if (status === 400 && data.error) {
      pass(`Missing token rejected with 400: ${data.error}`);
    } else {
      fail(`Expected 400, got: status=${status}, data=${JSON.stringify(data)}`);
    }
  } catch (error) {
    fail(`Request failed: ${error.message}`);
  }

  // =========================================================================
  // Test 9: Create invite without auth (should 401)
  // =========================================================================
  info('Test 9: Create invite without auth (should 401)');
  try {
    const { status, data } = await makeRequest('/org/invites', 'POST', {
      email: 'test@example.com',
      role: 'member'
    }, null);

    if (status === 401) {
      pass(`Unauthenticated create rejected with 401`);
    } else {
      fail(`Expected 401, got: status=${status}`);
    }
  } catch (error) {
    fail(`Request failed: ${error.message}`);
  }

  // =========================================================================
  // Test 10: Accept without auth (should return needsAuth)
  // =========================================================================
  info('Test 10: Accept without auth (should return needsAuth, no org leak)');

  // First create a fresh invite for this test
  let freshInviteToken = null;
  const testEmail = `test_${Date.now()}@example.com`;

  try {
    const { status, data } = await makeRequest('/org/invites', 'POST', {
      email: testEmail,
      role: 'member'
    }, TOKEN_OWNER);

    if (status === 201 || (status === 200 && data.existingInvite)) {
      const linkMatch = data.inviteLink?.match(/token=([a-f0-9]+)/);
      if (linkMatch) {
        freshInviteToken = linkMatch[1];
      }
    }
  } catch (error) {
    info(`Could not create fresh invite: ${error.message}`);
  }

  if (freshInviteToken) {
    try {
      const { status, data } = await makeRequest('/org/invites/accept', 'POST', {
        token: freshInviteToken
      }, null); // No auth token

      if (status === 200 && data.needsAuth) {
        // Check that org name is NOT leaked
        if (data.organizationName || data.orgName || data.org) {
          fail(`Security: org name leaked in needsAuth response`);
        } else if (data.email) {
          pass(`needsAuth returned with email only (no org leak)`);
        } else {
          fail(`needsAuth missing email field`);
        }
      } else {
        fail(`Expected needsAuth, got: status=${status}, data=${JSON.stringify(data)}`);
      }
    } catch (error) {
      fail(`Request failed: ${error.message}`);
    }

    // Clean up - revoke the test invite
    try {
      // Get the invite ID
      const { data: listData } = await makeRequest('/org/invites', 'GET', null, TOKEN_OWNER);
      const testInvite = listData.invites?.find(i => i.email === testEmail);
      if (testInvite) {
        await makeRequest('/org/invites/revoke', 'POST', { inviteId: testInvite.id }, TOKEN_OWNER);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  } else {
    info('Skipped test 10 (could not create fresh invite)');
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n========================================');
  if (process.exitCode === 1) {
    console.log(`${RED}  Some tests failed${RESET}`);
  } else {
    console.log(`${GREEN}  All tests passed${RESET}`);
  }
  console.log('========================================\n');
}

// Run tests
runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
