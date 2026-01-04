const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const EXPECTED_VERSIONS = ['000','001','002','003','004','005','006','007','008','009','010'];

const checks = [
  {
    name: `All Phase 1 migrations applied (${EXPECTED_VERSIONS.length} versions)`,
    query: `
      SELECT COUNT(*) as c FROM schema_migrations
      WHERE rolled_back_at IS NULL
      AND version IN (${EXPECTED_VERSIONS.map(v => `'${v}'`).join(',')})
    `,
    validate: r => parseInt(r.rows[0].c) === EXPECTED_VERSIONS.length
  },
  { name: 'Tables exist', query: `SELECT COUNT(*) as c FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('organizations', 'organization_members', 'roles', 'domains', 'usage_periods', 'usage_events')`, validate: r => parseInt(r.rows[0].c) === 6 },
  { name: 'All users have org', query: `SELECT COUNT(*) as c FROM users WHERE organization_id IS NULL`, validate: r => parseInt(r.rows[0].c) === 0 },
  { name: 'All users are members', query: `SELECT COUNT(*) as c FROM users u WHERE NOT EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = u.id)`, validate: r => parseInt(r.rows[0].c) === 0 },
  { name: 'System roles exist (5)', query: `SELECT COUNT(*) as c FROM roles WHERE is_system = true`, validate: r => parseInt(r.rows[0].c) === 5 },
  { name: 'Scans linked to orgs (95%+)', query: `SELECT COUNT(*) as t, COUNT(organization_id) as l FROM scans`, validate: r => parseInt(r.rows[0].t) === 0 || parseInt(r.rows[0].l) / parseInt(r.rows[0].t) > 0.95 },
  { name: 'Domains exist', query: `SELECT COUNT(*) as c FROM domains`, validate: r => parseInt(r.rows[0].c) > 0 },
  { name: 'Single primary per org', query: `SELECT COUNT(*) as c FROM (SELECT organization_id FROM domains WHERE is_primary = true GROUP BY organization_id HAVING COUNT(*) > 1) x`, validate: r => parseInt(r.rows[0].c) === 0 },
  { name: 'Usage periods = orgs', query: `SELECT (SELECT COUNT(*) FROM organizations) as o, (SELECT COUNT(*) FROM usage_periods WHERE is_current = true) as p`, validate: r => parseInt(r.rows[0].o) === parseInt(r.rows[0].p) },
  { name: 'Recs have org (95%+)', query: `SELECT COUNT(*) as t, COUNT(organization_id) as l FROM scan_recommendations`, validate: r => parseInt(r.rows[0].t) === 0 || parseInt(r.rows[0].l) / parseInt(r.rows[0].t) > 0.95 },
  { name: 'Usage functions work', query: `SELECT * FROM get_usage_summary((SELECT id FROM organizations LIMIT 1))`, validate: r => r.rows.length > 0 },
  { name: 'Integrity checks pass', query: `SELECT * FROM check_recommendations_integrity()`, validate: r => !r.rows.some(row => row.status === 'FAIL') }
];

async function run() {
  console.log('\n🔍 Phase 1 Verification\n' + '='.repeat(50));
  let passed = 0, failed = 0;

  for (const c of checks) {
    try {
      const r = await pool.query(c.query);
      if (c.validate(r)) {
        console.log(`✅ ${c.name}`);
        passed++;
      } else {
        console.log(`❌ ${c.name}`);
        console.log(`   Result: ${JSON.stringify(r.rows)}`);
        failed++;
      }
    } catch (e) {
      console.log(`❌ ${c.name}: ${e.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log('⚠️  Some checks failed. Review before proceeding.\n');
  } else {
    console.log('✅ All checks passed. Phase 1 complete!\n');
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run();
