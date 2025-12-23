/**
 * Diagnose Profile Mismatch
 * Check if profile is saved with correct user_id
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('./database');

async function diagnose() {
  try {
    console.log('=== DIAGNOSIS: Profile vs User Mismatch ===\n');

    // 1. Check all business profiles
    console.log('1. All Business Profiles:');
    const profiles = await db.query(`
      SELECT
        bp.id,
        bp.user_id,
        bp.business_name,
        bp.website_url,
        bp.short_description,
        LEFT(bp.logo_url, 50) as logo_url_preview,
        bp.is_complete,
        bp.completion_percentage,
        bp.created_at,
        u.email as user_email
      FROM business_profiles bp
      LEFT JOIN users u ON bp.user_id = u.id
      ORDER BY bp.created_at DESC
      LIMIT 10
    `);

    if (profiles.rows.length === 0) {
      console.log('   ❌ NO BUSINESS PROFILES FOUND IN DATABASE!');
    } else {
      profiles.rows.forEach(p => {
        console.log(`   Profile ID: ${p.id}`);
        console.log(`   User ID: ${p.user_id} (${p.user_email || 'NO USER FOUND'})`);
        console.log(`   Business: ${p.business_name}`);
        console.log(`   Website: ${p.website_url}`);
        console.log(`   Short Desc: ${p.short_description ? p.short_description.substring(0, 50) + '...' : 'EMPTY'}`);
        console.log(`   Logo: ${p.logo_url_preview ? 'YES' : 'NO'}`);
        console.log(`   Complete: ${p.is_complete} (${p.completion_percentage}%)`);
        console.log(`   Created: ${p.created_at}`);
        console.log('   ---');
      });
    }

    // 2. Check all users
    console.log('\n2. All Users:');
    const users = await db.query(`
      SELECT id, email, plan, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 10
    `);

    users.rows.forEach(u => {
      console.log(`   User ID: ${u.id} | Email: ${u.email} | Plan: ${u.plan}`);
    });

    // 3. Check if any user has a profile
    console.log('\n3. Users WITH Profiles:');
    const usersWithProfiles = await db.query(`
      SELECT
        u.id as user_id,
        u.email,
        bp.id as profile_id,
        bp.business_name
      FROM users u
      INNER JOIN business_profiles bp ON u.id = bp.user_id
    `);

    if (usersWithProfiles.rows.length === 0) {
      console.log('   ❌ NO USERS HAVE PROFILES!');
    } else {
      usersWithProfiles.rows.forEach(r => {
        console.log(`   ✓ User ${r.user_id} (${r.email}) has profile: ${r.business_name}`);
      });
    }

    // 4. Check if there are profiles with non-existent users
    console.log('\n4. Orphan Profiles (no matching user):');
    const orphanProfiles = await db.query(`
      SELECT bp.id, bp.user_id, bp.business_name
      FROM business_profiles bp
      LEFT JOIN users u ON bp.user_id = u.id
      WHERE u.id IS NULL
    `);

    if (orphanProfiles.rows.length === 0) {
      console.log('   ✓ No orphan profiles');
    } else {
      orphanProfiles.rows.forEach(p => {
        console.log(`   ❌ Profile ${p.id} has user_id ${p.user_id} but no matching user!`);
      });
    }

    // 5. Check the required fields for Start Submissions
    console.log('\n5. Profile Completeness Check (required for Start Submissions):');
    const profileCheck = await db.query(`
      SELECT
        id,
        user_id,
        business_name,
        website_url,
        short_description,
        CASE WHEN business_name IS NOT NULL AND business_name != '' THEN '✓' ELSE '❌' END as has_name,
        CASE WHEN website_url IS NOT NULL AND website_url != '' THEN '✓' ELSE '❌' END as has_website,
        CASE WHEN short_description IS NOT NULL AND short_description != '' THEN '✓' ELSE '❌' END as has_short_desc
      FROM business_profiles
      ORDER BY created_at DESC
      LIMIT 5
    `);

    profileCheck.rows.forEach(p => {
      console.log(`   Profile ${p.id} (user ${p.user_id}):`);
      console.log(`     business_name: ${p.has_name} "${p.business_name || ''}"`);
      console.log(`     website_url: ${p.has_website} "${p.website_url || ''}"`);
      console.log(`     short_description: ${p.has_short_desc} "${(p.short_description || '').substring(0, 30)}..."`);
    });

    // 6. Check recent API activity
    console.log('\n6. Checking campaign_runs table:');
    const campaigns = await db.query(`
      SELECT id, user_id, status, created_at, error_message
      FROM campaign_runs
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if (campaigns.rows.length === 0) {
      console.log('   No campaign runs yet');
    } else {
      campaigns.rows.forEach(c => {
        console.log(`   Campaign ${c.id}: user=${c.user_id}, status=${c.status}, error=${c.error_message || 'none'}`);
      });
    }

    console.log('\n=== END DIAGNOSIS ===');

  } catch (error) {
    console.error('Diagnosis error:', error);
  } finally {
    process.exit(0);
  }
}

diagnose();
