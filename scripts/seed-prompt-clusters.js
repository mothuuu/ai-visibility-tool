#!/usr/bin/env node

/**
 * seed-prompt-clusters.js — One-time seed of prompt_clusters from the
 * existing FAQ libraries in backend/phase2_preserved/recommendation-engine/faq-libraries.
 *
 * Each library has 5 high-priority FAQ questions. We:
 *   1. Templatize brand placeholders ({{company_name}}, [Product Name], ...) → {domain}
 *   2. Categorize by intent tier (explore / compare / buy) via a keyword heuristic
 *   3. Augment each tier with vertical-aware generic templates so each cluster
 *      has 5–8 queries (FAQ library is small; the spec target is 15–30 / vertical)
 *   4. Insert one prompt_clusters row per (vertical, intent_tier)
 *
 * Plus one general catch-all (vertical='general') split into the same 3 tiers.
 *
 * Idempotent: skips a vertical when source='faq_library' rows already exist
 * for it. DRY_RUN=true logs what would be inserted without writing.
 *
 * Usage:
 *   DRY_RUN=true node scripts/seed-prompt-clusters.js
 *   node scripts/seed-prompt-clusters.js
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require(path.join(__dirname, '..', 'backend', 'db', 'database'));

const DRY_RUN = process.env.DRY_RUN === 'true';
const LIB_DIR = path.join(
  __dirname, '..', 'backend', 'phase2_preserved',
  'recommendation-engine', 'faq-libraries'
);

// ---------------------------------------------------------------------------
// Intent tier heuristic + per-tier generic templates
// ---------------------------------------------------------------------------
const COMPARE_PATTERNS = /\b(vs\.?|compare|comparison|alternative|alternatives|better\s+than|difference\s+between|other\s+\w+\s+tools|competitor)\b/i;
const BUY_PATTERNS     = /\b(price|pricing|cost|how\s+much|worth|buy|should\s+i\s+(?:use|choose|buy)|invest|roi|sign\s*up|trial)\b/i;

function classifyIntent(question) {
  if (COMPARE_PATTERNS.test(question)) return 'compare';
  if (BUY_PATTERNS.test(question))     return 'buy';
  return 'explore';
}

function exploreTemplates(vertical) {
  const v = humanizeVertical(vertical);
  return [
    `What is {domain}?`,
    `What does {domain} do?`,
    `How does {domain} work?`,
    `Tell me about {domain}'s ${v} features`,
    `What ${v} problems does {domain} solve?`,
    `Who uses {domain} for ${v}?`,
    `What are {domain}'s key ${v} capabilities?`,
  ];
}
function compareTemplates(vertical) {
  const v = humanizeVertical(vertical);
  return [
    `How does {domain} compare to other ${v} tools?`,
    `What are alternatives to {domain} for ${v}?`,
    `{domain} vs other ${v} platforms`,
    `Is {domain} better than competitors in ${v}?`,
    `What are the leading ${v} platforms?`,
    `Which ${v} tools are most similar to {domain}?`,
  ];
}
function buyTemplates(vertical) {
  const v = humanizeVertical(vertical);
  return [
    `Is {domain} worth it for ${v}?`,
    `Should I choose {domain} for ${v}?`,
    `How much does {domain} cost?`,
    `Is {domain} a good ${v} investment?`,
    `What is {domain}'s pricing for ${v}?`,
    `Should small teams use {domain} for ${v}?`,
  ];
}

function humanizeVertical(slug) {
  return String(slug || '').replace(/-/g, ' ').replace(/\bb2b\b/i, 'B2B');
}

// ---------------------------------------------------------------------------
// Placeholder substitution: brand → {domain}, leave other {{X}}/[X] alone
// ---------------------------------------------------------------------------
const BRAND_PLACEHOLDERS = [
  /\{\{company_name\}\}/gi,
  /\{\{company\}\}/gi,
  /\{\{product_name\}\}/gi,
  /\{\{brand\}\}/gi,
  /\{\{brand_name\}\}/gi,
  /\[Product\s+Name\]/gi,
  /\[Brand\s*Name\]/gi,
  /\[Company\s+Name\]/gi,
  /\[Vendor\s+Name\]/gi,
];
function templatize(question) {
  let q = String(question || '').trim();
  for (const re of BRAND_PLACEHOLDERS) q = q.replace(re, '{domain}');
  // Strip remaining {{X}} / [X] decorations to keep prompts readable; leave the inner text.
  q = q.replace(/\{\{([^}]+)\}\}/g, (_, inner) => inner.replace(/_/g, ' '));
  q = q.replace(/\[([^\]]+)\]/g,    (_, inner) => inner);
  return q.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Per-library extraction
// ---------------------------------------------------------------------------
function loadLibraryQuestions(file) {
  const lib = JSON.parse(fs.readFileSync(file, 'utf8')).faq_library;
  if (!lib || !Array.isArray(lib.faqs)) return [];
  return lib.faqs
    .map(f => (f && typeof f.question === 'string') ? f.question : null)
    .filter(Boolean);
}

function clustersForVertical(vertical, libraryQuestions) {
  const bucketed = { explore: [], compare: [], buy: [] };

  // 1. Categorize FAQ questions (templatized)
  for (const q of libraryQuestions) {
    const t = classifyIntent(q);
    bucketed[t].push(templatize(q));
  }

  // 2. Augment with generic per-tier templates so each tier has a useful set
  bucketed.explore.push(...exploreTemplates(vertical));
  bucketed.compare.push(...compareTemplates(vertical));
  bucketed.buy.push(...buyTemplates(vertical));

  // 3. De-dupe within tier (case-insensitive)
  for (const t of Object.keys(bucketed)) {
    const seen = new Set();
    bucketed[t] = bucketed[t].filter(q => {
      const k = q.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // Build cluster rows: skip empty tiers (shouldn't happen with augmentation,
  // but defensive)
  const out = [];
  const titleVertical = humanizeVertical(vertical)
    .replace(/\b\w/g, c => c.toUpperCase());
  for (const tier of ['explore', 'compare', 'buy']) {
    if (bucketed[tier].length === 0) continue;
    out.push({
      user_id: null,
      cluster_name: `${titleVertical} - ${tier[0].toUpperCase() + tier.slice(1)}`,
      vertical,
      intent_tier: tier,
      queries: bucketed[tier],
      source: 'faq_library',
      pack_run_id: null,
      active: true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// General catch-all (vertical='general')
// ---------------------------------------------------------------------------
function generalClusters() {
  const explore = [
    `What is {domain}?`,
    `What does {domain} do?`,
    `What problems does {domain} solve?`,
    `Who uses {domain}?`,
    `Tell me about {domain}`,
  ];
  const compare = [
    `What are alternatives to {domain}?`,
    `How does {domain} compare to competitors?`,
    `{domain} vs other options`,
    `Is {domain} a market leader?`,
  ];
  const buy = [
    `Is {domain} legit?`,
    `Should I use {domain}?`,
    `Is {domain} worth it?`,
    `What do customers say about {domain}?`,
    `{domain} reviews`,
    `{domain} pricing`,
  ];
  return [
    { user_id: null, cluster_name: 'General - Explore', vertical: 'general', intent_tier: 'explore', queries: explore, source: 'faq_library', pack_run_id: null, active: true },
    { user_id: null, cluster_name: 'General - Compare', vertical: 'general', intent_tier: 'compare', queries: compare, source: 'faq_library', pack_run_id: null, active: true },
    { user_id: null, cluster_name: 'General - Buy',     vertical: 'general', intent_tier: 'buy',     queries: buy,     source: 'faq_library', pack_run_id: null, active: true },
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function alreadySeeded(vertical) {
  const r = await db.pool.query(
    `SELECT count(*)::int AS n FROM prompt_clusters
     WHERE source = 'faq_library' AND vertical = $1`,
    [vertical]
  );
  return r.rows[0].n > 0;
}

async function insertCluster(client, c) {
  await client.query(
    `INSERT INTO prompt_clusters
       (user_id, cluster_name, vertical, intent_tier, queries, source, pack_run_id, active)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [c.user_id, c.cluster_name, c.vertical, c.intent_tier,
     JSON.stringify(c.queries), c.source, c.pack_run_id, c.active]
  );
}

async function main() {
  console.log('='.repeat(70));
  console.log('SEED prompt_clusters from FAQ libraries');
  console.log(DRY_RUN ? '>>> DRY RUN — no changes will be made <<<' : '>>> LIVE RUN <<<');
  console.log('='.repeat(70));

  const files = fs.readdirSync(LIB_DIR).filter(f => f.endsWith('.json')).sort();
  console.log(`Found ${files.length} FAQ libraries in ${LIB_DIR}`);

  let totalClusters = 0;
  let totalQueries = 0;
  let verticalsSeeded = 0;
  let verticalsSkipped = 0;

  for (const f of files) {
    const vertical = f.replace(/\.json$/, '');
    const seeded = await alreadySeeded(vertical);
    if (seeded) {
      verticalsSkipped++;
      console.log(`  SKIP ${vertical} — already seeded`);
      continue;
    }
    const questions = loadLibraryQuestions(path.join(LIB_DIR, f));
    const clusters = clustersForVertical(vertical, questions);
    const counts = { explore: 0, compare: 0, buy: 0 };
    for (const c of clusters) counts[c.intent_tier] = c.queries.length;
    const total = counts.explore + counts.compare + counts.buy;
    console.log(`  ${vertical}: ${counts.explore} explore, ${counts.compare} compare, ${counts.buy} buy queries (total=${total})`);

    if (!DRY_RUN) {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        for (const c of clusters) await insertCluster(client, c);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ERROR inserting clusters for ${vertical}: ${err.message}`);
        throw err;
      } finally {
        client.release();
      }
    }
    totalClusters += clusters.length;
    totalQueries += total;
    verticalsSeeded++;
  }

  // General catch-all
  const generalSeeded = await alreadySeeded('general');
  if (generalSeeded) {
    console.log('  SKIP general — already seeded');
    verticalsSkipped++;
  } else {
    const gen = generalClusters();
    const counts = { explore: 0, compare: 0, buy: 0 };
    for (const c of gen) counts[c.intent_tier] = c.queries.length;
    const total = counts.explore + counts.compare + counts.buy;
    console.log(`  general: ${counts.explore} explore, ${counts.compare} compare, ${counts.buy} buy queries (total=${total})`);
    if (!DRY_RUN) {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        for (const c of gen) await insertCluster(client, c);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    totalClusters += gen.length;
    totalQueries += total;
    verticalsSeeded++;
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Verticals seeded:  ${verticalsSeeded}`);
  console.log(`Verticals skipped: ${verticalsSkipped}`);
  console.log(`Clusters created:  ${totalClusters}`);
  console.log(`Total queries:     ${totalQueries}`);
  if (DRY_RUN) console.log('\n>>> DRY RUN complete — no changes were made <<<');

  await db.pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
