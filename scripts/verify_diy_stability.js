#!/usr/bin/env node
/**
 * Verify DIY Plan Stability - Phase DIY-002
 *
 * Performs three sanity checks:
 * A) Limits sanity: Verify usage_periods has correct DIY limits
 * B) Parity check: Compare legacy vs v2 usage counts for a canary org
 * C) Competitor truth validation: Verify scans.domain_type matches usage_events
 *
 * Required environment variables:
 *   DATABASE_URL - PostgreSQL connection string
 *   ORG_ID       - Organization ID to check (default: 37)
 *
 * Usage:
 *   DATABASE_URL=postgres://... ORG_ID=37 node scripts/verify_diy_stability.js
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const ORG_ID = parseInt(process.env.ORG_ID || '37', 10);

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ANSI colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function pass(msg) { console.log(`${GREEN}✓ PASS${RESET}: ${msg}`); }
function fail(msg) { console.log(`${RED}✗ FAIL${RESET}: ${msg}`); process.exitCode = 1; }
function warn(msg) { console.log(`${YELLOW}⚠ WARN${RESET}: ${msg}`); }
function info(msg) { console.log(`→ ${msg}`); }

async function run() {
  console.log('\n========================================');
  console.log('  DIY Plan Stability Verification');
  console.log('========================================\n');
  info(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
  info(`Canary Org ID: ${ORG_ID}\n`);

  try {
    // =========================================================================
    // A) Limits Sanity Check
    // =========================================================================
    console.log('--- A) Limits Sanity Check ---\n');

    const limitsResult = await pool.query(`
      SELECT plan, limits->'scans' as scans, limits->'competitor_scans' as competitor_scans
      FROM usage_periods
      WHERE plan = 'diy' AND is_current = true
      LIMIT 5
    `);

    if (limitsResult.rows.length === 0) {
      warn('No current DIY usage_periods found');
    } else {
      let allCorrect = true;
      for (const row of limitsResult.rows) {
        const scans = parseInt(row.scans, 10);
        const competitor = parseInt(row.competitor_scans, 10);
        if (scans !== 25 || competitor !== 2) {
          fail(`DIY period has incorrect limits: scans=${scans} (expected 25), competitor=${competitor} (expected 2)`);
          allCorrect = false;
        }
      }
      if (allCorrect) {
        pass(`DIY usage_periods have correct limits: scans=25, competitor_scans=2 (checked ${limitsResult.rows.length} periods)`);
      }
    }

    // =========================================================================
    // B) Parity Check for Canary Org
    // =========================================================================
    console.log('\n--- B) Parity Check (Org ' + ORG_ID + ') ---\n');

    // Get org info
    const orgResult = await pool.query(`
      SELECT o.id, o.name, o.plan, o.owner_user_id
      FROM organizations o
      WHERE o.id = $1
    `, [ORG_ID]);

    if (orgResult.rows.length === 0) {
      warn(`Organization ${ORG_ID} not found`);
    } else {
      const org = orgResult.rows[0];
      info(`Org: ${org.name} (${org.plan} plan)`);

      // Get legacy counts from owner user
      const legacyResult = await pool.query(`
        SELECT
          scans_used_this_month,
          competitor_scans_used_this_month
        FROM users
        WHERE id = $1
      `, [org.owner_user_id]);

      const legacy = legacyResult.rows[0] || { scans_used_this_month: 0, competitor_scans_used_this_month: 0 };
      info(`Legacy counts: primary=${legacy.scans_used_this_month}, competitor=${legacy.competitor_scans_used_this_month}`);

      // Get v2 counts from usage_events in current period
      const v2Result = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE event_type = 'scan_completed') as primary_scans,
          COUNT(*) FILTER (WHERE event_type = 'competitor_scan') as competitor_scans
        FROM usage_events ue
        JOIN usage_periods up ON up.id = ue.period_id
        WHERE up.organization_id = $1 AND up.is_current = true
      `, [ORG_ID]);

      const v2 = v2Result.rows[0] || { primary_scans: '0', competitor_scans: '0' };
      const v2Primary = parseInt(v2.primary_scans, 10);
      const v2Competitor = parseInt(v2.competitor_scans, 10);
      info(`V2 counts: primary=${v2Primary}, competitor=${v2Competitor}`);

      // Calculate deltas
      const primaryDelta = Math.abs((legacy.scans_used_this_month || 0) - v2Primary);
      const competitorDelta = Math.abs((legacy.competitor_scans_used_this_month || 0) - v2Competitor);

      if (primaryDelta === 0 && competitorDelta === 0) {
        pass('Legacy and V2 counts are in sync');
      } else {
        warn(`Count deltas: primary=${primaryDelta}, competitor=${competitorDelta}`);
        info('Note: Small deltas may occur if legacy includes historical counts outside v2 window');
      }
    }

    // =========================================================================
    // C) Competitor Truth Validation
    // =========================================================================
    console.log('\n--- C) Competitor Truth Validation (Org ' + ORG_ID + ') ---\n');

    // Get current period for org
    const periodResult = await pool.query(`
      SELECT id, period_start, period_end
      FROM usage_periods
      WHERE organization_id = $1 AND is_current = true
    `, [ORG_ID]);

    if (periodResult.rows.length === 0) {
      warn(`No current usage_period for org ${ORG_ID}`);
    } else {
      const period = periodResult.rows[0];
      info(`Current period: ${period.period_start.toISOString().split('T')[0]} to ${period.period_end.toISOString().split('T')[0]}`);

      // Count completed competitor scans from scans table (using domain_type)
      const scansResult = await pool.query(`
        SELECT COUNT(*) as count, array_agg(id ORDER BY id DESC) as scan_ids
        FROM scans
        WHERE organization_id = $1
          AND domain_type = 'competitor'
          AND status = 'completed'
          AND completed_at >= $2
          AND completed_at < $3
      `, [ORG_ID, period.period_start, period.period_end]);

      const scansCount = parseInt(scansResult.rows[0].count, 10);
      const scanIds = scansResult.rows[0].scan_ids || [];
      info(`Completed competitor scans (domain_type='competitor'): ${scansCount}`);

      // Count competitor_scan events in usage_events
      const eventsResult = await pool.query(`
        SELECT COUNT(*) as count, array_agg(scan_id ORDER BY scan_id DESC) as scan_ids
        FROM usage_events
        WHERE period_id = $1 AND event_type = 'competitor_scan'
      `, [period.id]);

      const eventsCount = parseInt(eventsResult.rows[0].count, 10);
      const eventScanIds = eventsResult.rows[0].scan_ids || [];
      info(`Competitor usage_events: ${eventsCount}`);

      if (scansCount === eventsCount) {
        pass('Competitor scan count matches usage_events count');
      } else {
        fail(`Count mismatch: scans=${scansCount}, events=${eventsCount}`);

        // Find missing scan_ids
        const missingScanIds = scanIds.filter(id => !eventScanIds.includes(id));
        if (missingScanIds.length > 0) {
          info(`Missing usage_events for scan_ids (up to 20): ${missingScanIds.slice(0, 20).join(', ')}`);
        }

        // Find orphan events (events without matching scan)
        const orphanEventIds = eventScanIds.filter(id => id && !scanIds.includes(id));
        if (orphanEventIds.length > 0) {
          info(`Orphan event scan_ids (up to 20): ${orphanEventIds.slice(0, 20).join(', ')}`);
        }
      }

      // Also check primary scans
      console.log('');
      const primaryScansResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM scans
        WHERE organization_id = $1
          AND domain_type = 'primary'
          AND status = 'completed'
          AND completed_at >= $2
          AND completed_at < $3
      `, [ORG_ID, period.period_start, period.period_end]);

      const primaryScansCount = parseInt(primaryScansResult.rows[0].count, 10);
      info(`Completed primary scans (domain_type='primary'): ${primaryScansCount}`);

      const primaryEventsResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM usage_events
        WHERE period_id = $1 AND event_type = 'scan_completed'
      `, [period.id]);

      const primaryEventsCount = parseInt(primaryEventsResult.rows[0].count, 10);
      info(`Primary usage_events: ${primaryEventsCount}`);

      if (primaryScansCount === primaryEventsCount) {
        pass('Primary scan count matches usage_events count');
      } else {
        warn(`Primary count mismatch: scans=${primaryScansCount}, events=${primaryEventsCount}`);
      }
    }

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('\n========================================');
    if (process.exitCode === 1) {
      console.log(`${RED}  Some checks failed${RESET}`);
    } else {
      console.log(`${GREEN}  All checks passed${RESET}`);
    }
    console.log('========================================\n');

  } catch (error) {
    console.error('❌ Script error:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
