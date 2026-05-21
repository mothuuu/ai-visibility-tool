/**
 * Citation Monitoring Cron
 *
 * Runs daily at 2 AM UTC. For each paid (starter/diy/pro) verified user
 * whose last citation_test_runs.completed_at is older than the per-tier
 * cadence (14d for starter, 7d for pro), runs a scheduled citation test
 * suite, computes the delta vs the previous run, and flags Pro users
 * for email alerting when something gained or was lost.
 *
 * Schedule: '0 2 * * *' (offset from token expiry at midnight).
 * Disable:  DISABLE_CITATION_MONITORING_CRON=true
 *
 * Idempotent and serial: users are processed one at a time with a delay
 * between them to keep API rate limits in check across the whole tenant
 * base. In-memory `isRunning` flag prevents overlapping ticks.
 */

const cron = require('node-cron');
const db = require('../db/database');
const CitationTestService = require('../services/citationTestService');
const { getEntitlements, getEffectivePlan } = require('../services/planService');
const { CITATION_TIER_CONFIG } = require('../services/citationSnapshotService');

// engine → env var holding its API key (mirrors citationSnapshotService)
const ENGINE_KEY_ENV = Object.freeze({
  claude:     'ANTHROPIC_API_KEY',
  chatgpt:    'OPENAI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
});

const TIER_CADENCE_DAYS = Object.freeze({
  standard: 14, // starter / diy
  pro:      7,
});

const USER_DELAY_MS = parseInt(process.env.CITATION_MONITORING_USER_DELAY_MS, 10) || 5000;
const FIRST_RUN_FORCE = true; // users with no prior runs are due immediately

let isRunning = false;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Core job
// ---------------------------------------------------------------------------
async function runCitationMonitoringJob() {
  if (isRunning) {
    console.log('[CitationMonitoring] Job already running, skipping');
    return { skipped: true, checked: 0, due: 0, completed: 0, skippedUsers: 0, errors: 0 };
  }
  isRunning = true;

  const stats = { checked: 0, due: 0, completed: 0, skippedUsers: 0, errors: 0 };

  try {
    console.log('[CitationMonitoring] starting daily sweep…');

    // 1) Load paid + verified users
    const users = await db.query(
      `SELECT id, email, plan, primary_domain, industry
         FROM users
        WHERE plan IN ('starter', 'pro', 'diy')
          AND email_verified = true`
    );
    stats.checked = users.rows.length;
    console.log(`[CitationMonitoring] ${stats.checked} paid verified users to evaluate`);

    for (const user of users.rows) {
      try {
        const handled = await processUser(user);
        if (handled === 'due')       { stats.due++; stats.completed++; }
        else if (handled === 'skip') { stats.skippedUsers++; }
        else if (handled === 'error'){ stats.errors++; }
      } catch (err) {
        stats.errors++;
        console.error(`[CitationMonitoring] user ${user.id} (${user.email}) failed: ${err.message}`);
      }
      await sleep(USER_DELAY_MS);
    }

    console.log(
      `[CitationMonitoring] complete: checked=${stats.checked}, due=${stats.due}, ` +
      `completed=${stats.completed}, skipped=${stats.skippedUsers}, errors=${stats.errors}`
    );
    return stats;
  } finally {
    isRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Per-user
// ---------------------------------------------------------------------------
async function processUser(user) {
  const effectivePlan = getEffectivePlan(user.plan);
  const tier = getEntitlements(effectivePlan).hasCitation;
  const cadenceDays = TIER_CADENCE_DAYS[tier];
  if (!cadenceDays) {
    console.log(`[CitationMonitoring] user ${user.id}: unknown tier '${tier}', skipping`);
    return 'skip';
  }

  // Cadence check
  const lastRun = await getLastRun(user.id);
  if (lastRun) {
    const daysSince = Math.floor((Date.now() - new Date(lastRun.completed_at).getTime()) / 86400000);
    if (daysSince < cadenceDays) {
      console.log(`[CitationMonitoring] user ${user.id} not due (last run ${daysSince} days ago, cadence ${cadenceDays} days)`);
      return 'skip';
    }
  } else if (!FIRST_RUN_FORCE) {
    return 'skip';
  }

  // Domain: primary_domain on the user, falling back to most recent completed scan
  let domain = user.primary_domain;
  if (!domain) {
    const scanRow = await getLastScanDomain(user.id);
    if (!scanRow) {
      console.log(`[CitationMonitoring] user ${user.id} has no completed scans, skipping`);
      return 'skip';
    }
    domain = scanRow.primary_domain;
  }

  // Tier config and engine filter
  const tierConfig = CITATION_TIER_CONFIG[tier];
  const availableEngines = tierConfig.engines.filter(e => Boolean(process.env[ENGINE_KEY_ENV[e]]));
  if (availableEngines.length === 0) {
    console.warn(`[CitationMonitoring] no API keys configured for tier '${tier}'; user ${user.id} skipped`);
    return 'skip';
  }

  // Query selection: user clusters → vertical clusters → general clusters
  let queries = await loadUserClusters(user.id);
  if (queries.length === 0 && user.industry) {
    queries = await loadVerticalClusters(user.industry);
  }
  if (queries.length === 0) {
    queries = await loadGeneralClusters();
  }
  if (queries.length === 0) {
    console.warn(`[CitationMonitoring] user ${user.id}: no clusters available, skipping`);
    return 'skip';
  }
  if (queries.length > tierConfig.maxQueries) queries = queries.slice(0, tierConfig.maxQueries);

  console.log(
    `[CitationMonitoring] user ${user.id} tier=${tier} domain=${domain} ` +
    `engines=${availableEngines.join(',')} queries=${queries.length}`
  );

  // Execute
  let suiteResult;
  try {
    suiteResult = await CitationTestService.runTestSuite(user.id, {
      runType: 'scheduled',
      queries,
      engines: availableEngines,
      domain,
      competitorDomains: [],
      storePro: tierConfig.storePro,
    });
  } catch (err) {
    console.error(`[CitationMonitoring] runTestSuite failed for user ${user.id}: ${err.message}`);
    return 'error';
  }

  console.log(
    `[CitationMonitoring] scheduled citation run for user ${user.id} (${domain}): ` +
    `${suiteResult.totalQueries} queries, ${suiteResult.citedCount} cited`
  );

  // Delta vs previous run
  try {
    const delta = await computeDelta(user.id, suiteResult.testRunId);
    const proAlert = effectivePlan === 'pro' && (delta.gained_count > 0 || delta.lost_count > 0);
    await db.query(
      `UPDATE citation_test_runs
          SET delta_summary = $1::jsonb,
              pro_alert_pending = $2
        WHERE id = $3`,
      [JSON.stringify(delta), proAlert, suiteResult.testRunId]
    );
    if (proAlert) {
      console.log(`[CitationMonitoring] Citation changes detected for Pro user ${user.id}: +${delta.gained_count} -${delta.lost_count}`);
    }
  } catch (err) {
    console.warn(`[CitationMonitoring] delta computation failed for user ${user.id}: ${err.message}`);
  }

  return 'due';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function getLastRun(userId) {
  const r = await db.query(
    `SELECT id, completed_at FROM citation_test_runs
      WHERE user_id = $1
        AND status = 'complete'
        AND run_type IN ('scan_time', 'scheduled')
      ORDER BY completed_at DESC LIMIT 1`,
    [userId]
  );
  return r.rows[0] || null;
}

async function getLastScanDomain(userId) {
  const r = await db.query(
    `SELECT primary_domain FROM scans
      WHERE user_id = $1 AND status = 'completed'
      ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return r.rows[0] || null;
}

function flattenQueries(rows) {
  const out = [];
  for (const r of rows) {
    const qs = r.queries;
    if (Array.isArray(qs)) {
      for (const q of qs) {
        if (typeof q === 'string' && q.trim()) out.push(q.trim());
        else if (q && typeof q.text === 'string') out.push(q.text.trim());
      }
    }
  }
  return out;
}

async function loadUserClusters(userId) {
  try {
    const r = await db.query(
      `SELECT queries FROM prompt_clusters WHERE user_id = $1 AND active = true`,
      [userId]
    );
    return flattenQueries(r.rows);
  } catch (e) {
    console.warn(`[CitationMonitoring] prompt_clusters lookup failed: ${e.message}`);
    return [];
  }
}

async function loadVerticalClusters(vertical) {
  try {
    const r = await db.query(
      `SELECT queries FROM prompt_clusters
        WHERE user_id IS NULL AND active = true AND vertical = $1`,
      [vertical]
    );
    return flattenQueries(r.rows);
  } catch {
    return [];
  }
}

async function loadGeneralClusters() {
  try {
    const r = await db.query(
      `SELECT queries FROM prompt_clusters
        WHERE user_id IS NULL AND active = true AND vertical = 'general'`
    );
    return flattenQueries(r.rows);
  } catch {
    return [];
  }
}

/**
 * Compare this run's evidence against the user's previous completed run.
 * Returns { gained_count, lost_count, gained_queries, lost_queries }.
 */
async function computeDelta(userId, currentRunId) {
  const currentRes = await db.query(
    `SELECT query_text, engine, cited FROM citation_evidence WHERE test_run_id = $1`,
    [currentRunId]
  );

  const prevRunRes = await db.query(
    `SELECT id FROM citation_test_runs
      WHERE user_id = $1 AND status = 'complete' AND id != $2
      ORDER BY completed_at DESC LIMIT 1`,
    [userId, currentRunId]
  );
  if (prevRunRes.rows.length === 0) {
    return { gained_count: 0, lost_count: 0, gained_queries: [], lost_queries: [],
             baseline: true };
  }
  const prevRunId = prevRunRes.rows[0].id;
  const prevRes = await db.query(
    `SELECT query_text, engine, cited FROM citation_evidence WHERE test_run_id = $1`,
    [prevRunId]
  );

  const prevMap = new Map();
  for (const row of prevRes.rows) prevMap.set(`${row.engine}|${row.query_text}`, row.cited);

  const gained = [];
  const lost = [];
  for (const row of currentRes.rows) {
    const key = `${row.engine}|${row.query_text}`;
    if (!prevMap.has(key)) continue; // not comparable
    const prevCited = prevMap.get(key);
    if (!prevCited && row.cited)     gained.push({ engine: row.engine, query: row.query_text });
    else if (prevCited && !row.cited) lost.push({ engine: row.engine, query: row.query_text });
  }

  return {
    gained_count: gained.length,
    lost_count: lost.length,
    gained_queries: gained,
    lost_queries: lost,
    previous_run_id: prevRunId,
  };
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
function startCitationMonitoringCron() {
  if (process.env.DISABLE_CITATION_MONITORING_CRON === 'true') {
    console.log('[CitationMonitoring] Cron disabled (DISABLE_CITATION_MONITORING_CRON=true)');
    return null;
  }
  console.log('[CitationMonitoring] Scheduling daily citation monitoring (2 AM UTC)…');
  const task = cron.schedule('0 2 * * *', async () => {
    console.log('[Cron] Running citation monitoring job…');
    try {
      const result = await runCitationMonitoringJob();
      console.log('[Cron] Citation monitoring complete:', result);
    } catch (err) {
      console.error('[Cron] Citation monitoring failed:', err);
    }
  });
  return task;
}

module.exports = {
  startCitationMonitoringCron,
  runCitationMonitoringJob,
  // Exposed for tests
  _internal: { processUser, computeDelta, getLastRun, loadUserClusters, loadVerticalClusters,
               loadGeneralClusters, TIER_CADENCE_DAYS, ENGINE_KEY_ENV },
};
