/**
 * ADMIN CONSOLE BROWSER DIAGNOSTIC
 *
 * Run this in your browser console (F12) on the admin overview page:
 *
 * Instructions:
 * 1. Open admin overview page in browser
 * 2. Press F12 to open Developer Tools
 * 3. Go to "Console" tab
 * 4. Copy and paste this entire script
 * 5. Press Enter
 * 6. Share the output
 */

(async function runAdminDiagnostic() {
  console.log('🔍 AI Visibility Admin Console Diagnostic\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const API_BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3001/api'
    : 'https://ai-visibility-tool.onrender.com/api';

  // Test 1: Check Auth Token
  console.log('1️⃣  Checking Authentication...');
  const token = localStorage.getItem('authToken');
  if (!token) {
    console.error('❌ No auth token found in localStorage');
    console.log('   → You need to log in again\n');
    return;
  }
  console.log('✅ Auth token found:', token.substring(0, 20) + '...\n');

  // Test 2: Verify Token Works
  console.log('2️⃣  Verifying Admin Access...');
  try {
    const testResponse = await fetch(`${API_BASE_URL}/admin/overview`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('   Status Code:', testResponse.status);
    console.log('   Status Text:', testResponse.statusText);

    if (testResponse.status === 401) {
      console.error('❌ Token expired or invalid (401 Unauthorized)');
      console.log('   → Log out and log in again\n');
      return;
    }

    if (testResponse.status === 403) {
      console.error('❌ Admin access denied (403 Forbidden)');
      console.log('   → Your account does not have admin role');
      console.log('   → Ask developer to run: node backend/test-admin-data.js\n');
      return;
    }

    if (!testResponse.ok) {
      console.error('❌ API request failed:', testResponse.status);
      const errorText = await testResponse.text();
      console.error('   Error:', errorText);
      return;
    }

    console.log('✅ Admin access verified\n');

    // Test 3: Check Response Data
    console.log('3️⃣  Checking API Response Data...');
    const data = await testResponse.json();

    console.log('   Response structure:', Object.keys(data));
    console.log('   Success:', data.success);

    if (!data.data) {
      console.error('❌ No data object in response');
      console.log('   Full response:', data);
      return;
    }

    console.log('   Data keys:', Object.keys(data.data));
    console.log('\n✅ API Response Structure is correct\n');

    // Test 4: Inspect Actual Data Values
    console.log('4️⃣  Checking Data Values...');
    const metrics = data.data.metrics;

    console.log('   📊 Hero Metrics:');
    console.log('      Total Users:', metrics.totalUsers?.value);
    console.log('      Monthly Revenue:', metrics.monthlyRevenue?.formatted, `($${metrics.monthlyRevenue?.value})`);
    console.log('      Scans This Month:', metrics.scansThisMonth?.value);
    console.log('      Churn Rate:', metrics.churnRate?.formatted);

    if (metrics.totalUsers?.value === 0) {
      console.warn('⚠️  Total users is 0 - no users in database!\n');
    } else {
      console.log('\n✅ Metrics have data\n');
    }

    // Test 5: Check Recent Users
    console.log('5️⃣  Checking Recent Users...');
    const recentUsers = data.data.recentUsers;

    if (!recentUsers || recentUsers.length === 0) {
      console.warn('⚠️  No recent users in response');
      console.log('   This might be why you see static data\n');
    } else {
      console.log(`   Found ${recentUsers.length} recent users:`);
      recentUsers.forEach((user, i) => {
        console.log(`   ${i + 1}. ${user.email}`);
        console.log(`      Last Activity: ${user.lastActivity}`);
        console.log(`      Status: ${user.status}`);
        console.log(`      Plan: ${user.plan}`);

        if (user.lastActivity) {
          const date = new Date(user.lastActivity);
          const now = new Date();
          const diffMs = now - date;
          const diffHours = Math.floor(diffMs / 3600000);
          const diffDays = Math.floor(diffMs / 86400000);
          console.log(`      → That was ${diffDays} days and ${diffHours % 24} hours ago`);
        }
      });
      console.log('\n✅ Recent users data looks good\n');
    }

    // Test 6: Check if DOM is being updated
    console.log('6️⃣  Checking DOM Elements...');
    const totalUsersElement = document.getElementById('totalUsers');
    const scansElement = document.getElementById('scansThisMonth');
    const revenueElement = document.getElementById('monthlyRevenue');
    const tableElement = document.getElementById('recentUsersTable');

    console.log('   Total Users Element:', totalUsersElement ? '✅ Found' : '❌ Missing');
    console.log('   Scans Element:', scansElement ? '✅ Found' : '❌ Missing');
    console.log('   Revenue Element:', revenueElement ? '✅ Found' : '❌ Missing');
    console.log('   Recent Users Table:', tableElement ? '✅ Found' : '❌ Missing');

    if (totalUsersElement) {
      console.log('   Current value in DOM:', totalUsersElement.textContent);
      console.log('   Should be:', metrics.totalUsers?.value);

      if (totalUsersElement.textContent === '-') {
        console.error('❌ DOM still shows placeholder "-"');
        console.log('   → Data is fetched but not rendered!');
        console.log('   → Check browser console for JavaScript errors\n');
      } else if (totalUsersElement.textContent != metrics.totalUsers?.value) {
        console.error('❌ DOM shows different value than API');
        console.log('   → Browser might be showing cached/old data\n');
      } else {
        console.log('✅ DOM matches API data\n');
      }
    }

    // Test 7: Check for JavaScript Errors
    console.log('7️⃣  Recommendation...');
    if (totalUsersElement?.textContent === '-') {
      console.log('⚠️  ISSUE FOUND: Data is fetched but DOM not updated');
      console.log('\n📋 Try these fixes:');
      console.log('   1. Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)');
      console.log('   2. Clear browser cache completely');
      console.log('   3. Check for JavaScript errors in Console tab');
      console.log('   4. Try incognito/private browsing mode\n');
    } else if (metrics.totalUsers?.value === 0) {
      console.log('⚠️  ISSUE FOUND: Database has no data');
      console.log('\n📋 Ask developer to:');
      console.log('   1. Run: node backend/test-admin-data.js');
      console.log('   2. Check if users and scans exist in database');
      console.log('   3. Verify admin role is set correctly\n');
    } else {
      console.log('✅ Everything looks good!');
      console.log('   If you still see old data, try:');
      console.log('   1. Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)');
      console.log('   2. Clear browser cache\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Diagnostic Complete!\n');

  } catch (error) {
    console.error('❌ Diagnostic Failed:', error.message);
    console.error(error);
  }
})();
