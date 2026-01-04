require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false
});

async function runAudit() {
  const report = [];
  const timestamp = new Date().toISOString();

  report.push(`# Visible2AI Database Audit Report\n`);
  report.push(`**Generated:** ${timestamp}`);
  report.push(`**Database:** Render PostgreSQL`);
  report.push(`**Purpose:** Phase 1 Migration Planning\n`);

  try {
    // Query 1: Table Inventory
    report.push(`## 1. Table Inventory`);
    const tableInventory = await pool.query(`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    report.push('```');
    report.push('Table Name                              | Type');
    report.push('----------------------------------------|----------');
    for (const row of tableInventory.rows) {
      report.push(`${row.table_name.padEnd(40)}| ${row.table_type}`);
    }
    report.push('```\n');

    // Query 2: Data Volumes
    report.push(`## 2. Data Volumes`);
    const keyTables = ['users', 'scans', 'scan_recommendations', 'scan_pages', 'business_profiles', 'directories', 'directory_orders', 'directory_submissions'];
    report.push('```');
    report.push('Table                    | Row Count');
    report.push('-------------------------|----------');
    for (const table of keyTables) {
      try {
        const count = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        report.push(`${table.padEnd(25)}| ${count.rows[0].count}`);
      } catch (e) {
        report.push(`${table.padEnd(25)}| TABLE NOT FOUND`);
      }
    }
    report.push('```\n');

    // Query 3: Users Table Schema
    report.push(`## 3. Users Table Schema`);
    const usersSchema = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    report.push('```');
    report.push('Column Name                    | Data Type           | Nullable | Default');
    report.push('-------------------------------|---------------------|----------|--------');
    for (const row of usersSchema.rows) {
      const defaultVal = row.column_default ? row.column_default.substring(0, 20) : '';
      report.push(`${row.column_name.padEnd(31)}| ${row.data_type.padEnd(20)}| ${row.is_nullable.padEnd(9)}| ${defaultVal}`);
    }
    report.push('```\n');

    // Query 4: Scans Table Schema
    report.push(`## 4. Scans Table Schema`);
    const scansSchema = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'scans' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    report.push('```');
    report.push('Column Name                    | Data Type           | Nullable | Default');
    report.push('-------------------------------|---------------------|----------|--------');
    for (const row of scansSchema.rows) {
      const defaultVal = row.column_default ? row.column_default.substring(0, 20) : '';
      report.push(`${row.column_name.padEnd(31)}| ${row.data_type.padEnd(20)}| ${row.is_nullable.padEnd(9)}| ${defaultVal}`);
    }
    report.push('```\n');

    // Query 5: Recommendations Table Schema + subfactor column check
    report.push(`## 5. Recommendations Table Schema`);
    const recsSchema = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'scan_recommendations' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    report.push('```');
    report.push('Column Name                    | Data Type           | Nullable | Default');
    report.push('-------------------------------|---------------------|----------|--------');
    for (const row of recsSchema.rows) {
      const defaultVal = row.column_default ? row.column_default.substring(0, 20) : '';
      report.push(`${row.column_name.padEnd(31)}| ${row.data_type.padEnd(20)}| ${row.is_nullable.padEnd(9)}| ${defaultVal}`);
    }
    report.push('```');
    const hasSubfactor = recsSchema.rows.some(r => r.column_name === 'subfactor');
    report.push(`\n**subfactor column exists:** ${hasSubfactor ? 'YES' : 'NO'}\n`);

    // Query 6: Target v2.1 Table Status (organizations, etc.)
    report.push(`## 6. Target v2.1 Table Status`);
    const targetTables = ['organizations', 'organization_members', 'organization_invites', 'organization_billing'];
    report.push('```');
    report.push('Table                    | Exists');
    report.push('-------------------------|--------');
    for (const table of targetTables) {
      const exists = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        )
      `, [table]);
      report.push(`${table.padEnd(25)}| ${exists.rows[0].exists ? 'YES' : 'NO'}`);
    }
    report.push('```\n');

    // Query 7: Existing Constraints
    report.push(`## 7. Existing Constraints (Key Tables)`);
    const constraints = await pool.query(`
      SELECT tc.table_name, tc.constraint_name, tc.constraint_type
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
        AND tc.table_name IN ('users', 'scans', 'scan_recommendations', 'scan_pages')
      ORDER BY tc.table_name, tc.constraint_type
    `);
    report.push('```');
    report.push('Table                    | Constraint Name                    | Type');
    report.push('-------------------------|------------------------------------|-----------');
    for (const row of constraints.rows) {
      report.push(`${row.table_name.padEnd(25)}| ${row.constraint_name.padEnd(35)}| ${row.constraint_type}`);
    }
    report.push('```\n');

    // Query 8: Existing Indexes
    report.push(`## 8. Existing Indexes (Key Tables)`);
    const indexes = await pool.query(`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('users', 'scans', 'scan_recommendations', 'scan_pages')
      ORDER BY tablename, indexname
    `);
    report.push('```');
    for (const row of indexes.rows) {
      report.push(`${row.tablename}: ${row.indexname}`);
    }
    report.push('```\n');

    // Query 9: Existing Functions
    report.push(`## 9. Existing Functions`);
    const functions = await pool.query(`
      SELECT routine_name, routine_type
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      ORDER BY routine_name
    `);
    report.push('```');
    if (functions.rows.length === 0) {
      report.push('No custom functions found');
    } else {
      for (const row of functions.rows) {
        report.push(`${row.routine_name} (${row.routine_type})`);
      }
    }
    report.push('```\n');

    // Query 10: Existing Enums
    report.push(`## 10. Existing Enums`);
    const enums = await pool.query(`
      SELECT t.typname as enum_name, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) as values
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      GROUP BY t.typname
      ORDER BY t.typname
    `);
    report.push('```');
    if (enums.rows.length === 0) {
      report.push('No enums found');
    } else {
      for (const row of enums.rows) {
        report.push(`${row.enum_name}: ${row.values}`);
      }
    }
    report.push('```\n');

    // Query 11: User Distribution by Plan
    report.push(`## 11. User Distribution by Plan`);
    const planDist = await pool.query(`
      SELECT plan, COUNT(*) as count
      FROM users
      GROUP BY plan
      ORDER BY count DESC
    `);
    report.push('```');
    report.push('Plan           | Count');
    report.push('---------------|------');
    for (const row of planDist.rows) {
      report.push(`${(row.plan || 'NULL').padEnd(15)}| ${row.count}`);
    }
    report.push('```\n');

    // Query 12: Scan Status Distribution
    report.push(`## 12. Scan Status Distribution`);
    const scanStatus = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM scans
      GROUP BY status
      ORDER BY count DESC
    `);
    report.push('```');
    report.push('Status         | Count');
    report.push('---------------|------');
    for (const row of scanStatus.rows) {
      report.push(`${(row.status || 'NULL').padEnd(15)}| ${row.count}`);
    }
    report.push('```\n');

    // Query 13: Billing Data Location
    report.push(`## 13. Billing Data Location`);
    const billingCols = await pool.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name LIKE '%stripe%' OR column_name LIKE '%billing%' OR column_name LIKE '%subscription%')
      ORDER BY table_name, column_name
    `);
    report.push('```');
    report.push('Table                    | Column');
    report.push('-------------------------|---------------------------');
    for (const row of billingCols.rows) {
      report.push(`${row.table_name.padEnd(25)}| ${row.column_name}`);
    }
    report.push('```\n');

    // Query 14: Org Columns on Scans
    report.push(`## 14. Org Columns on Scans`);
    const orgCols = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'scans'
        AND table_schema = 'public'
        AND (column_name LIKE '%org%' OR column_name LIKE '%organization%')
    `);
    report.push('```');
    if (orgCols.rows.length === 0) {
      report.push('No organization columns found on scans table');
    } else {
      for (const row of orgCols.rows) {
        report.push(`${row.column_name}: ${row.data_type}`);
      }
    }
    report.push('```\n');

    // Query 15: Sample Recommendation Data
    report.push(`## 15. Sample Recommendation Data`);
    const sampleRecs = await pool.query(`
      SELECT id, scan_id, category, priority, status, recommendation_type,
             LEFT(recommendation_text, 100) as text_preview
      FROM scan_recommendations
      LIMIT 5
    `);
    report.push('```');
    if (sampleRecs.rows.length === 0) {
      report.push('No recommendations found');
    } else {
      for (const row of sampleRecs.rows) {
        report.push(`ID: ${row.id} | Scan: ${row.scan_id} | Category: ${row.category}`);
        report.push(`   Priority: ${row.priority} | Status: ${row.status} | Type: ${row.recommendation_type}`);
        report.push(`   Text: ${row.text_preview}...`);
        report.push('');
      }
    }
    report.push('```\n');

    // Summary Section
    report.push(`---\n`);
    report.push(`## Summary: Migration Risks\n`);

    // Check for v2.1 tables that need to be created
    const tablesToCreate = [];
    for (const table of targetTables) {
      const exists = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        )
      `, [table]);
      if (!exists.rows[0].exists) {
        tablesToCreate.push(table);
      }
    }

    report.push(`### Tables to CREATE (don't exist):`);
    if (tablesToCreate.length > 0) {
      for (const t of tablesToCreate) {
        report.push(`- ${t}`);
      }
    } else {
      report.push(`- None - all target tables exist`);
    }
    report.push('');

    // Tables that may need alteration
    report.push(`### Tables to ALTER (exist but may need columns):`);
    report.push(`- users (may need organization_id FK)`);
    report.push(`- scans (may need organization_id FK)`);
    if (!hasSubfactor) {
      report.push(`- scan_recommendations (needs subfactor column)`);
    }
    report.push('');

    // Data Backfill Required
    report.push(`### Data Backfill Required:`);
    report.push(`- [ ] Create organizations for existing users`);
    report.push(`- [ ] Link scans to organizations`);
    report.push(`- [ ] Migrate plan data from users to organizations`);

    // Check for users with stripe data
    const usersWithStripe = await pool.query(`
      SELECT COUNT(*) as count FROM users
      WHERE stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL
    `);
    if (usersWithStripe.rows[0].count > 0) {
      report.push(`- [ ] Migrate ${usersWithStripe.rows[0].count} users with Stripe billing data`);
    }
    report.push('');

    // Potential Conflicts
    report.push(`### Potential Conflicts:`);

    // Check for plan column type
    const planColumn = await pool.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'plan' AND table_schema = 'public'
    `);
    if (planColumn.rows.length > 0 && planColumn.rows[0].data_type !== 'USER-DEFINED') {
      report.push(`- users.plan is ${planColumn.rows[0].data_type} (may need enum conversion)`);
    }

    // Check for organization_id on key tables
    const orgIdCheck = await pool.query(`
      SELECT table_name FROM information_schema.columns
      WHERE column_name = 'organization_id' AND table_schema = 'public'
    `);
    if (orgIdCheck.rows.length > 0) {
      report.push(`- organization_id already exists on: ${orgIdCheck.rows.map(r => r.table_name).join(', ')}`);
    } else {
      report.push(`- No organization_id column exists on any table yet`);
    }

    report.push('');

    // Output the report
    const reportContent = report.join('\n');
    console.log(reportContent);

    // Write to file
    const outputPath = './DATABASE_AUDIT_REPORT.md';
    fs.writeFileSync(outputPath, reportContent);
    console.log(`\n\n✅ Report saved to ${outputPath}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Audit failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

runAudit();
