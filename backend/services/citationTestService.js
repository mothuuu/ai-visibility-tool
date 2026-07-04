/**
 * CitationTestService
 *
 * Sends test queries to AI engines and records whether the brand was cited.
 *
 *   runTestSuite(userId, options)  → orchestrates a full run, persists results
 *   runSingleTest(query, engine, domain, competitorDomains?) → one-shot debug helper
 *
 * Engine adapters live in services/engines/<name>Adapter.js. Each exposes
 *   runQuery(query, options) → { response_text, model_used, tokens_used }
 *
 * Sequential within each engine (1 s delay between calls to respect rate
 * limits), parallel across engines (each engine has its own queue).
 */

const db = require('../db/database');
const { analyzeCitation } = require('../utils/citationParser');

const MAX_QUERIES_PER_RUN = parseInt(process.env.CITATION_MAX_QUERIES_PER_RUN, 10) || 100;
const SAME_ENGINE_DELAY_MS = parseInt(process.env.CITATION_SAME_ENGINE_DELAY_MS, 10) || 1000;
const PREVIEW_SNIPPET_LEN = 500;

// Per-1K-token cost estimates (USD). Used only for logging; not authoritative.
const COST_PER_1K = {
  claude:     0.003,   // sonnet-class
  chatgpt:    0.001,   // 4o-mini-class
  perplexity: 0.0006,  // sonar-small
};

// Lazy-load adapters so tests can stub them without triggering API-key checks.
function loadAdapter(engine) {
  switch (engine) {
    case 'claude':     return require('./engines/claudeAdapter');
    case 'chatgpt':    return require('./engines/chatgptAdapter');
    case 'perplexity': return require('./engines/perplexityAdapter');
    default: throw new Error(`Unknown engine: ${engine}`);
  }
}

const VALID_ENGINES = new Set(['claude', 'chatgpt', 'perplexity']);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------
/**
 * @param {number} userId
 * @param {object} options
 * @param {number} [options.scanId]
 * @param {'scan_time'|'scheduled'} options.runType
 * @param {string[]} options.queries
 * @param {string[]} options.engines       e.g. ['claude','chatgpt']
 * @param {string}   options.domain        user's domain, e.g. 'visible2ai.com'
 * @param {string[]} [options.competitorDomains]
 * @param {boolean}  [options.storePro]    if true, persist response_snippet + competitor_cited
 * @returns {Promise<{testRunId:number, totalQueries:number, citedCount:number,
 *                    notCitedCount:number, failedCount:number, results:Array}>}
 */
async function runTestSuite(userId, options = {}) {
  const {
    scanId = null,
    runType,
    queries = [],
    engines = [],
    domain,
    competitorDomains = [],
    storePro = false,
  } = options;

  if (!userId)                                  throw new Error('userId is required');
  if (runType !== 'scan_time' && runType !== 'scheduled') {
    throw new Error("runType must be 'scan_time' or 'scheduled'");
  }
  if (!Array.isArray(queries) || queries.length === 0) throw new Error('queries[] is required');
  if (!Array.isArray(engines) || engines.length === 0) throw new Error('engines[] is required');
  if (!domain)                                  throw new Error('domain is required');
  for (const e of engines) {
    if (!VALID_ENGINES.has(e)) throw new Error(`Unsupported engine: ${e}`);
  }

  // Cap queries to MAX_QUERIES_PER_RUN to bound cost.
  const cappedQueries = queries.slice(0, MAX_QUERIES_PER_RUN);
  if (cappedQueries.length < queries.length) {
    console.warn(`[CitationTest] capped queries: ${queries.length} → ${cappedQueries.length} (MAX_QUERIES_PER_RUN)`);
  }

  // Create test run row
  const runRes = await db.query(
    `INSERT INTO citation_test_runs
       (user_id, run_type, scan_id, engines_tested, status, started_at)
     VALUES ($1, $2, $3, $4::text[], 'running', NOW())
     RETURNING id`,
    [userId, runType, scanId, engines]
  );
  const testRunId = runRes.rows[0].id;
  console.log(`[CitationTest] run ${testRunId} started: ${cappedQueries.length} queries × ${engines.length} engines = ${cappedQueries.length * engines.length} total`);

  // Run each engine's queue in parallel; queries within an engine are sequential with a delay.
  const enginePromises = engines.map(engine =>
    runEngineQueue({
      testRunId, engine, queries: cappedQueries, domain, competitorDomains, storePro
    }).catch(err => {
      console.error(`[CitationTest] engine ${engine} aborted: ${err.message}`);
      return { engine, results: [], failed: cappedQueries.length, tokens: 0, error: err.message };
    })
  );
  const perEngine = await Promise.all(enginePromises);

  // Aggregate
  let citedCount = 0;
  let notCitedCount = 0;
  let failedCount = 0;
  let totalTokens = 0;
  let estCostUsd = 0;
  const summary = [];
  for (const eng of perEngine) {
    for (const r of eng.results) {
      summary.push(r);
      if (r.cited) citedCount++; else notCitedCount++;
    }
    failedCount += eng.failed || 0;
    totalTokens += eng.tokens || 0;
    const rate = COST_PER_1K[eng.engine] || 0;
    estCostUsd += (eng.tokens || 0) / 1000 * rate;
  }

  const totalAttempted = cappedQueries.length * engines.length;
  const successCount = citedCount + notCitedCount;
  console.log(`[CitationTest] run ${testRunId}: ${successCount} of ${totalAttempted} queries completed successfully; cited=${citedCount}, not_cited=${notCitedCount}, failed=${failedCount}, tokens~=${totalTokens}, est_cost~=$${estCostUsd.toFixed(4)}`);

  // Update test run row
  if (successCount === 0 && failedCount > 0) {
    await db.query(
      `UPDATE citation_test_runs
         SET status='failed', completed_at=NOW(),
             prompts_tested=$2, cited_count=0, not_cited_count=0,
             error_message=$3
       WHERE id=$1`,
      [testRunId, cappedQueries.length, 'All queries failed across all engines']
    );
  } else {
    await db.query(
      `UPDATE citation_test_runs
         SET status='completed', completed_at=NOW(),
             prompts_tested=$2, cited_count=$3, not_cited_count=$4
       WHERE id=$1`,
      [testRunId, cappedQueries.length, citedCount, notCitedCount]
    );
  }

  return {
    testRunId,
    totalQueries: cappedQueries.length,
    citedCount,
    notCitedCount,
    failedCount,
    results: summary,
  };
}

async function runEngineQueue({ testRunId, engine, queries, domain, competitorDomains, storePro }) {
  const adapter = loadAdapter(engine);
  const results = [];
  let failed = 0;
  let tokens = 0;
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    try {
      const resp = await adapter.runQuery(query);
      tokens += resp.tokens_used || 0;

      const analysis = analyzeCitation(resp.response, domain, competitorDomains);
      await persistEvidence({
        testRunId, query, engine, analysis,
        responseText: resp.response, storePro
      });
      results.push({
        query, engine, cited: analysis.cited, citation_type: analysis.citation_type,
        domain_mentioned: analysis.domain_mentioned,
      });
    } catch (err) {
      failed++;
      console.error(`[CitationTest] ${engine} query "${query.slice(0, 60)}" failed: ${err.message}`);
    }
    // Delay between same-engine calls (skip after last)
    if (i < queries.length - 1) await sleep(SAME_ENGINE_DELAY_MS);
  }
  return { engine, results, failed, tokens };
}

async function persistEvidence({ testRunId, query, engine, analysis, responseText, storePro }) {
  const snippet = storePro && responseText
    ? String(responseText).slice(0, PREVIEW_SNIPPET_LEN)
    : null;
  const competitorCited = storePro
    ? (analysis.competitor_cited || [])
    : [];

  await db.query(
    `INSERT INTO citation_evidence
       (test_run_id, query_text, engine, cited, citation_type,
        response_snippet, competitor_cited, domain_mentioned)
     VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8)`,
    [testRunId, query, engine,
     analysis.cited, analysis.citation_type,
     snippet, competitorCited, analysis.domain_mentioned]
  );
}

/**
 * One-shot debug helper. Does NOT persist anything.
 * @returns {Promise<{response_text, model_used, tokens_used, analysis}>}
 */
async function runSingleTest(query, engine, domain, competitorDomains = []) {
  if (!VALID_ENGINES.has(engine)) throw new Error(`Unsupported engine: ${engine}`);
  const adapter = loadAdapter(engine);
  const resp = await adapter.runQuery(query);
  const analysis = analyzeCitation(resp.response, domain, competitorDomains);
  return { ...resp, analysis };
}

module.exports = {
  runTestSuite,
  runSingleTest,
  // Exposed for tests
  _internal: { runEngineQueue, persistEvidence, loadAdapter, sleep },
};
