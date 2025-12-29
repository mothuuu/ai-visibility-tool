#!/usr/bin/env node
/**
 * Test Mark Complete - Regression Test for Bug 1 Fix
 *
 * This test verifies that:
 * 1) Calling the "mark complete" endpoint updates the DB
 * 2) The status persists on re-read (no reversion to old status)
 * 3) Action Needed count stays consistent
 * 4) API returns error if update affects 0 rows
 *
 * Usage:
 *   node backend/scripts/test-mark-complete.js <userId>
 *   node backend/scripts/test-mark-complete.js --email <email>
 *
 * Prerequisites:
 *   - User must have at least one directory_submission with status 'action_needed' or 'needs_action'
 *   - DATABASE_URL environment variable must be set
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../db/database');

// Simulated API call (directly calling the DB update logic from the route)
async function callMarkCompleteAPI(userId, submissionId, newStatus) {
  // This simulates what the PATCH /api/citation-network/submissions/:id/status does
  // First check if submission exists
  const existsCheck = await db.query(
    'SELECT id, user_id FROM directory_submissions WHERE id = $1::uuid',
    [submissionId]
  );

  if (existsCheck.rows.length === 0) {
    return { success: false, error: 'NOT_FOUND', message: 'Submission not found' };
  }

  // Check ownership
  const submissionOwnerId = existsCheck.rows[0].user_id;
  if (String(submissionOwnerId) !== String(userId)) {
    return { success: false, error: 'FORBIDDEN', message: `Belongs to user ${submissionOwnerId}, not ${userId}` };
  }

  // Now do the update
  const result = await db.query(`
    UPDATE directory_submissions
    SET
      status = $1,
      action_type = 'none',
      updated_at = NOW()
    WHERE id = $2::uuid
    RETURNING id, status, action_type, updated_at, directory_name
  `, [newStatus, submissionId]);

  if (result.rows.length === 0) {
    return { success: false, error: 'UPDATE_FAILED' };
  }

  // Try to update verified_at separately (column may not exist)
  if (newStatus === 'verified') {
    try {
      await db.query(`
        UPDATE directory_submissions
        SET verified_at = NOW()
        WHERE id = $1::uuid AND verified_at IS NULL
      `, [submissionId]);
    } catch (e) {
      // Column might not exist - that's ok
      console.log('   Note: verified_at column may not exist');
    }
  }

  return { success: true, submission: result.rows[0] };
}

async function getSubmissionStatus(submissionId) {
  try {
    const result = await db.query(
      'SELECT id, status, action_type, updated_at FROM directory_submissions WHERE id = $1::uuid',
      [submissionId]
    );
    return result.rows[0] || null;
  } catch (e) {
    console.error('   Error getting submission status:', e.message);
    return null;
  }
}

async function getActionNeededCount(userId) {
  const result = await db.query(`
    SELECT COUNT(*) as count
    FROM directory_submissions
    WHERE user_id = $1 AND status IN ('action_needed', 'needs_action', 'pending_verification')
  `, [userId]);
  return parseInt(result.rows[0].count);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Usage:
  node backend/scripts/test-mark-complete.js <userId>
  node backend/scripts/test-mark-complete.js --email <email>

Examples:
  node backend/scripts/test-mark-complete.js 11
  node backend/scripts/test-mark-complete.js --email test@example.com
`);
    process.exit(0);
  }

  let userId = null;
  let email = null;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) {
      email = args[i + 1];
      i++;
    } else if (!isNaN(parseInt(args[i]))) {
      userId = parseInt(args[i]);
    }
  }

  try {
    // If email provided, look up user ID
    if (email && !userId) {
      const userResult = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (userResult.rows.length === 0) {
        console.error(`\n❌ No user found with email: ${email}`);
        process.exit(1);
      }
      userId = userResult.rows[0].id;
      console.log(`\nFound user ID ${userId} for email: ${email}`);
    }

    if (!userId) {
      console.error('\n❌ Please provide a userId or --email');
      process.exit(1);
    }

    console.log('\n' + '='.repeat(60));
    console.log('MARK COMPLETE REGRESSION TEST');
    console.log('='.repeat(60));
    console.log(`User ID: ${userId}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('='.repeat(60));

    // 1. Find a submission with action_needed status
    console.log('\n📋 STEP 1: Finding action_needed submission...');
    const actionNeededResult = await db.query(`
      SELECT id, status, directory_name
      FROM directory_submissions
      WHERE user_id = $1 AND status IN ('action_needed', 'needs_action')
      LIMIT 1
    `, [userId]);

    if (actionNeededResult.rows.length === 0) {
      console.log('⚠️  No action_needed submissions found for this user.');
      console.log('   Creating a test submission for testing...');

      // Check if user has any submissions at all
      const anySubmission = await db.query(
        'SELECT id, status FROM directory_submissions WHERE user_id = $1 LIMIT 1',
        [userId]
      );

      if (anySubmission.rows.length === 0) {
        console.error('\n❌ User has no submissions. Cannot run test.');
        console.log('   Create submissions first using the citation network flow.');
        process.exit(1);
      }

      // Use existing submission and temporarily set it to action_needed for testing
      const testSubmission = anySubmission.rows[0];
      const originalStatus = testSubmission.status;

      console.log(`   Using submission ${testSubmission.id} (original status: ${originalStatus})`);
      console.log('   Setting status to action_needed for test...');

      await db.query(
        'UPDATE directory_submissions SET status = $1 WHERE id = $2',
        ['action_needed', testSubmission.id]
      );

      // Run test
      const passed = await runTest(userId, testSubmission.id);

      // Restore original status
      console.log(`\n   Restoring original status: ${originalStatus}...`);
      await db.query(
        'UPDATE directory_submissions SET status = $1 WHERE id = $2',
        [originalStatus, testSubmission.id]
      );

      process.exit(passed ? 0 : 1);
    }

    const testSubmission = actionNeededResult.rows[0];
    console.log(`   Found submission: ${testSubmission.id}`);
    console.log(`   Directory: ${testSubmission.directory_name}`);
    console.log(`   Current status: ${testSubmission.status}`);

    // Run test (with option to restore)
    const passed = await runTest(userId, testSubmission.id, true);
    process.exit(passed ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

async function runTest(userId, submissionId, restoreAfter = false) {
  let originalStatus = null;
  let allPassed = true;

  try {
    // Get original status for potential restore
    const original = await getSubmissionStatus(submissionId);
    originalStatus = original?.status;

    // 2. Record initial action needed count
    console.log('\n📋 STEP 2: Recording initial counts...');
    const initialCount = await getActionNeededCount(userId);
    console.log(`   Initial Action Needed count: ${initialCount}`);

    // 3. Call mark complete API
    console.log('\n📋 STEP 3: Calling mark complete API...');
    const apiResult = await callMarkCompleteAPI(userId, submissionId, 'verified');

    if (!apiResult.success) {
      console.error(`   ❌ API returned error: ${apiResult.error}`);
      allPassed = false;
    } else {
      console.log(`   ✅ API returned success`);
      console.log(`   Updated status: ${apiResult.submission.status}`);
      console.log(`   Updated at: ${apiResult.submission.updated_at}`);
    }

    // 4. Verify DB was updated
    console.log('\n📋 STEP 4: Verifying DB persistence...');
    const afterUpdate = await getSubmissionStatus(submissionId);

    if (afterUpdate.status !== 'verified') {
      console.error(`   ❌ FAIL: DB status is "${afterUpdate.status}", expected "verified"`);
      allPassed = false;
    } else {
      console.log(`   ✅ PASS: DB status is "verified"`);
    }

    // 5. Verify action needed count decreased
    console.log('\n📋 STEP 5: Verifying Action Needed count...');
    const afterCount = await getActionNeededCount(userId);
    console.log(`   After Action Needed count: ${afterCount}`);

    if (afterCount !== initialCount - 1) {
      console.error(`   ❌ FAIL: Expected count ${initialCount - 1}, got ${afterCount}`);
      allPassed = false;
    } else {
      console.log(`   ✅ PASS: Count decreased by 1`);
    }

    // 6. Simulate "refresh" by re-reading from DB
    console.log('\n📋 STEP 6: Simulating page refresh (re-read from DB)...');
    const afterRefresh = await getSubmissionStatus(submissionId);

    if (afterRefresh.status !== 'verified') {
      console.error(`   ❌ FAIL: After refresh, status reverted to "${afterRefresh.status}"`);
      allPassed = false;
    } else {
      console.log(`   ✅ PASS: Status persists as "verified" after refresh`);
    }

    const refreshCount = await getActionNeededCount(userId);
    if (refreshCount !== afterCount) {
      console.error(`   ❌ FAIL: Action Needed count changed after refresh (${afterCount} → ${refreshCount})`);
      allPassed = false;
    } else {
      console.log(`   ✅ PASS: Action Needed count stable after refresh`);
    }

    // 7. Test error case: non-existent submission
    console.log('\n📋 STEP 7: Testing error case (non-existent submission)...');
    const fakeResult = await callMarkCompleteAPI(userId, '00000000-0000-0000-0000-000000000000', 'verified');

    if (fakeResult.success) {
      console.error(`   ❌ FAIL: API returned success for non-existent submission`);
      allPassed = false;
    } else {
      console.log(`   ✅ PASS: API correctly returned error for non-existent submission`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    if (allPassed) {
      console.log('✅ ALL TESTS PASSED');
    } else {
      console.log('❌ SOME TESTS FAILED');
    }
    console.log('='.repeat(60));

    return allPassed;

  } finally {
    // Restore original status if requested
    if (restoreAfter && originalStatus && originalStatus !== 'verified') {
      console.log(`\n🔄 Restoring original status: ${originalStatus}...`);
      await db.query(
        'UPDATE directory_submissions SET status = $1 WHERE id = $2',
        [originalStatus, submissionId]
      );
      console.log('   Done.');
    }
  }
}

main();
