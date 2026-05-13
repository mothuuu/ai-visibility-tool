/**
 * Benchmark Aggregation Cron
 *
 * Weekly on Sunday at 3 AM UTC. Walks completed scans, groups them by
 * industry, and computes per-vertical percentiles (overall + per-pillar)
 * into benchmark_stats. Verticals with < MIN_SAMPLE_SIZE are skipped; a
 * 'global' row is always computed across all completed scans as a fallback.
 *
 * Schedule: '0 3 * * 0' (Sunday 3 AM UTC), offset from daily jobs.
 * Disable:  DISABLE_BENCHMARK_CRON=true
 *
 * Pillar column names mirror the actual scans schema rather than any
 * idealized list, so callers get a stable shape they can join against:
 *
 *   ai_readability_score, ai_search_readiness_score,
 *   content_freshness_score, content_structure_score,
 *   speed_ux_score, technical_setup_score,
 *   trust_authority_score, voice_optimization_score
 *
 * Historical benchmark_stats rows are preserved (the unique constraint
 * is (vertical, computed_at), and computed_at is truncated to a day so
 * a re-run on the same day upserts in place).
 */

const cron = require('node-cron');
const db = require('../db/database');

const MIN_SAMPLE_SIZE = parseInt(process.env.BENCHMARK_MIN_SAMPLE_SIZE, 10) || 20;

const PILLAR_COLUMNS = Object.freeze([
  'ai_readability_score',
  'ai_search_readiness_score',
  'content_freshness_score',
  'content_structure_score',
  'speed_ux_score',
  'technical_setup_score',
  'trust_authority_score',
  'voice_optimization_score',
]);

let isRunning = false;

// ---------------------------------------------------------------------------
// Percentile math (nearest-rank, p in [0, 100])
// ---------------------------------------------------------------------------
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (p <= 0)   return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(1, rank) - 1];
}

function avg(arr) {
  if (arr.length === 0) return null;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function statsFromValues(values) {
  const cleaned = values
    .filter(v => v != null && Number.isFinite(Number(v)))
    .map(v => Number(v))
    .sort((a, b) => a - b);
  if (cleaned.length === 0) return null;
  return {
    avg: round2(avg(cleaned)),
    p25: round2(percentile(cleaned, 25)),
    p50: round2(percentile(cleaned, 50)),
    p75: round2(percentile(cleaned, 75)),
    p90: round2(percentile(cleaned, 90)),
  };
}

function round2(n) {
  if (n == null) return null;
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------
function aggregateScans(scans) {
  // Compute overall + per-pillar stats from a slice of scan rows.
  // total_score may be null on legacy rows; fall back to `score` column.
  const overallValues = [];
  const pillarValues = {};
  for (const col of PILLAR_COLUMNS) pillarValues[col] = [];

  for (const s of scans) {
    const overall = (s.total_score != null) ? s.total_score : s.score;
    if (overall != null) overallValues.push(overall);
    for (const col of PILLAR_COLUMNS) {
      const v = s[col];
      if (v != null) pillarValues[col].push(v);
    }
  }

  const overall = statsFromValues(overallValues);
  if (!overall) return null;

  const pillar_stats = {};
  for (const col of PILLAR_COLUMNS) {
    const ps = statsFromValues(pillarValues[col]);
    if (ps) pillar_stats[col] = ps;
  }

  return {
    sample_size: overallValues.length,
    overall_avg: overall.avg,
    overall_p25: overall.p25,
    overall_p50: overall.p50,
    overall_p75: overall.p75,
    overall_p90: overall.p90,
    pillar_stats,
  };
}

// ---------------------------------------------------------------------------
// DB I/O
// ---------------------------------------------------------------------------
async function loadCompletedScans() {
  const cols = ['id', 'industry', 'total_score', 'score', ...PILLAR_COLUMNS].join(', ');
  const res = await db.query(
    `SELECT ${cols} FROM scans
      WHERE status = 'completed'
        AND ((total_score IS NOT NULL) OR (score IS NOT NULL))`
  );
  return res.rows;
}

async function upsertBenchmark(vertical, stats, computedAt) {
  await db.query(
    `INSERT INTO benchmark_stats
       (vertical, sample_size, overall_avg, overall_p25, overall_p50, overall_p75, overall_p90, pillar_stats, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     ON CONFLICT (vertical, computed_at) DO UPDATE SET
       sample_size  = EXCLUDED.sample_size,
       overall_avg  = EXCLUDED.overall_avg,
       overall_p25  = EXCLUDED.overall_p25,
       overall_p50  = EXCLUDED.overall_p50,
       overall_p75  = EXCLUDED.overall_p75,
       overall_p90  = EXCLUDED.overall_p90,
       pillar_stats = EXCLUDED.pillar_stats`,
    [
      vertical,
      stats.sample_size,
      stats.overall_avg,
      stats.overall_p25,
      stats.overall_p50,
      stats.overall_p75,
      stats.overall_p90,
      JSON.stringify(stats.pillar_stats),
      computedAt,
    ]
  );
}

function todayUtc() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function normalizeVertical(v) {
  if (!v) return null;
  return String(v).toLowerCase().trim() || null;
}

// ---------------------------------------------------------------------------
// Public job
// ---------------------------------------------------------------------------
async function runBenchmarkJob() {
  if (isRunning) {
    console.log('[Benchmark] Job already running, skipping');
    return { skipped: true };
  }
  isRunning = true;

  try {
    console.log('[Benchmark] starting weekly aggregation…');

    const scans = await loadCompletedScans();
    console.log(`[Benchmark] loaded ${scans.length} completed scans`);

    // Group by normalized vertical
    const byVertical = new Map();
    for (const s of scans) {
      const v = normalizeVertical(s.industry);
      const key = v || '__no_industry__';
      if (!byVertical.has(key)) byVertical.set(key, []);
      byVertical.get(key).push(s);
    }

    const computedAt = todayUtc();
    let verticalsComputed = 0;
    let verticalsSkipped = 0;
    let totalProcessed = 0;
    let globalCount = scans.length;

    for (const [key, rows] of byVertical.entries()) {
      const v = (key === '__no_industry__') ? null : key;
      // Scans with no industry only flow into 'global'
      if (!v) {
        console.log(`[Benchmark] ${rows.length} scans have no industry; contributing to 'global' only`);
        continue;
      }
      if (rows.length < MIN_SAMPLE_SIZE) {
        verticalsSkipped++;
        console.log(`[Benchmark] Skipping ${v}: only ${rows.length} scans (minimum ${MIN_SAMPLE_SIZE})`);
        continue;
      }
      const stats = aggregateScans(rows);
      if (!stats) {
        console.log(`[Benchmark] ${v}: no valid scores after aggregation, skipping`);
        continue;
      }
      await upsertBenchmark(v, stats, computedAt);
      verticalsComputed++;
      totalProcessed += stats.sample_size;
      console.log(`[Benchmark] ${v}: n=${stats.sample_size}, p50=${stats.overall_p50}, avg=${stats.overall_avg}`);
    }

    // 'global' across ALL completed scans (regardless of industry)
    if (globalCount >= MIN_SAMPLE_SIZE) {
      const gStats = aggregateScans(scans);
      if (gStats) {
        await upsertBenchmark('global', gStats, computedAt);
        console.log(`[Benchmark] global: n=${gStats.sample_size}, p50=${gStats.overall_p50}, avg=${gStats.overall_avg}`);
        verticalsComputed++;
      }
    } else {
      console.log(`[Benchmark] global skipped: total completed scans ${globalCount} < ${MIN_SAMPLE_SIZE}`);
      verticalsSkipped++;
    }

    const summary = {
      verticals_computed: verticalsComputed,
      verticals_skipped: verticalsSkipped,
      total_scans_processed: totalProcessed,
      total_scans_seen: scans.length,
    };
    console.log(`[Benchmark] complete:`, summary);
    return summary;
  } finally {
    isRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Public helper: percentile for a single scan
// ---------------------------------------------------------------------------
/**
 * Returns the user's percentile vs the latest benchmark for their vertical
 * (or 'global' fallback). NOT a job — meant for routes/UI to call.
 *
 * @param {number} scanId
 * @returns {Promise<{
 *   scanId: number, vertical: string, fallbackUsed: boolean,
 *   overall: { score: number, percentile: number, avg: number, p25,p50,p75,p90 },
 *   pillars: Record<string, { score: number, percentile: number, avg: number, p25,p50,p75,p90 }>,
 *   sampleSize: number, computedAt: Date
 * } | null>}
 */
async function getBenchmarkForScan(scanId) {
  const cols = ['id', 'industry', 'total_score', 'score', ...PILLAR_COLUMNS].join(', ');
  const scanRes = await db.query(`SELECT ${cols} FROM scans WHERE id = $1`, [scanId]);
  if (scanRes.rows.length === 0) return null;
  const scan = scanRes.rows[0];

  const vertical = normalizeVertical(scan.industry);
  let bench = null;
  let fallbackUsed = false;
  if (vertical) {
    const r = await db.query(
      `SELECT * FROM benchmark_stats WHERE vertical = $1 ORDER BY computed_at DESC LIMIT 1`,
      [vertical]
    );
    if (r.rows.length > 0) bench = r.rows[0];
  }
  if (!bench) {
    const r = await db.query(
      `SELECT * FROM benchmark_stats WHERE vertical = 'global' ORDER BY computed_at DESC LIMIT 1`
    );
    if (r.rows.length === 0) return null;
    bench = r.rows[0];
    fallbackUsed = true;
  }

  const overallScore = (scan.total_score != null) ? scan.total_score : scan.score;
  const overall = {
    score: overallScore,
    percentile: estimatePercentile(overallScore, bench, null),
    avg: numOrNull(bench.overall_avg),
    p25: numOrNull(bench.overall_p25),
    p50: numOrNull(bench.overall_p50),
    p75: numOrNull(bench.overall_p75),
    p90: numOrNull(bench.overall_p90),
  };

  const pillars = {};
  const pillarStats = bench.pillar_stats || {};
  for (const col of PILLAR_COLUMNS) {
    const ps = pillarStats[col];
    if (!ps) continue;
    pillars[col] = {
      score: scan[col],
      percentile: estimatePercentile(scan[col], null, ps),
      avg: numOrNull(ps.avg),
      p25: numOrNull(ps.p25),
      p50: numOrNull(ps.p50),
      p75: numOrNull(ps.p75),
      p90: numOrNull(ps.p90),
    };
  }

  return {
    scanId: scan.id,
    vertical: bench.vertical,
    fallbackUsed,
    overall,
    pillars,
    sampleSize: bench.sample_size,
    computedAt: bench.computed_at,
  };
}

// Estimate where a score lands given the percentile breakpoints.
// We have p25/p50/p75/p90. Linear interpolation between bands; clamp at edges.
function estimatePercentile(score, overallBench, pillarStats) {
  if (score == null) return null;
  const ps = pillarStats || {
    p25: overallBench && overallBench.overall_p25,
    p50: overallBench && overallBench.overall_p50,
    p75: overallBench && overallBench.overall_p75,
    p90: overallBench && overallBench.overall_p90,
  };
  const breakpoints = [
    { pct: 0,   v: 0 },
    { pct: 25,  v: numOrNull(ps.p25) },
    { pct: 50,  v: numOrNull(ps.p50) },
    { pct: 75,  v: numOrNull(ps.p75) },
    { pct: 90,  v: numOrNull(ps.p90) },
    { pct: 100, v: 1000 },
  ].filter(b => b.v != null)
   .sort((a, b) => a.v - b.v);

  if (breakpoints.length < 2) return null;

  if (score <= breakpoints[0].v) return breakpoints[0].pct;
  if (score >= breakpoints[breakpoints.length - 1].v) return breakpoints[breakpoints.length - 1].pct;

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const a = breakpoints[i], b = breakpoints[i + 1];
    if (score >= a.v && score <= b.v) {
      if (b.v === a.v) return b.pct;
      const t = (score - a.v) / (b.v - a.v);
      return Math.round(a.pct + t * (b.pct - a.pct));
    }
  }
  return null;
}

function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
function startBenchmarkCron() {
  if (process.env.DISABLE_BENCHMARK_CRON === 'true') {
    console.log('[Benchmark] Cron disabled (DISABLE_BENCHMARK_CRON=true)');
    return null;
  }
  console.log('[Benchmark] Scheduling weekly benchmark aggregation (Sun 3 AM UTC)…');
  const task = cron.schedule('0 3 * * 0', async () => {
    console.log('[Cron] Running benchmark aggregation…');
    try {
      const result = await runBenchmarkJob();
      console.log('[Cron] Benchmark complete:', result);
    } catch (err) {
      console.error('[Cron] Benchmark failed:', err);
    }
  });
  return task;
}

module.exports = {
  startBenchmarkCron,
  runBenchmarkJob,
  getBenchmarkForScan,
  _internal: { aggregateScans, percentile, statsFromValues, estimatePercentile,
               normalizeVertical, PILLAR_COLUMNS, MIN_SAMPLE_SIZE },
};
