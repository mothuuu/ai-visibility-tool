# Citation Monitoring + Prompt Volume — Existing Scaffold Audit

Date: 2026-05-02
Branch: `claude/fix-exposed-db-secret-0XM8Q` @ `7528d2f`
Scope: `backend/` only. Excluded `archived_docs/`, `backend/node_modules/`, `backend/phase2_preserved/`.

> **Naming-trap reminder.** This audit covers **Citation Monitoring** (the Phase 3 AI-engine query feature: ChatGPT / Claude / Perplexity citing a brand). It **excludes** the **AI Citation Network** (directory submissions / ListingBot product) — that lives under `routes/citationNetwork.js`, `migrate-citation-network.js`, `services/citationNetworkStripeService.js`, `services/citationNetworkWebhookHandler.js`, `jobs/citationNetworkReminders.js`, `migrations/notification_deduplication.sql`, etc.

---

## Executive Summary

- **Persistence backbone exists for all four Phase 3 tables**, added very recently (commit `6112de2`). Migration is idempotent (`CREATE TABLE IF NOT EXISTS`) and ships a service + read router + tests. **Has not yet been executed against any environment.**
- **Engine integration is split between two files.** `routes/ai-testing.js` (1,202 lines, pre-existing) holds the actual OpenAI/Anthropic/Perplexity HTTP calls. `routes/citation-monitoring.js` (135 lines, new) holds the read endpoints. They share the persistence service.
- **No engine adapters exist** as separate files. `AI_CONFIGS` (an inline object in `ai-testing.js`) is the entire abstraction; engines are added by appending a `case` to `queryAIAssistant()`.
- **No frontend surface.** No HTML/JS in `frontend/` references AI testing, citation monitoring, prompt volume, or any of the new endpoints. The whole feature is currently API-only.
- **Plan gating is partial.** `/api/analyze-website` checks `PLAN_LIMITS`; `/api/test-ai-visibility` does not gate by plan at all (only requires optional auth). The new `prompt-clusters` POST requires auth but does not enforce plan tiers.
- **Biggest risk:** the `testAIVisibility` engine-call layer in `ai-testing.js` does ~1,100 lines of unrelated rubric scoring around the actual citation logic; mixing Phase 3 work into that file will make every change a 1k-LOC review.

---

## 1. Database Tables

| Table | Status | File | Notes |
|---|---|---|---|
| `prompt_clusters` | **EXISTS** | `backend/db/migrate-citation-monitoring.js:22` | id, org_id, user_id, name, canonical_prompt, prompt_variants jsonb, industry, persona, funnel_stage, competitor_domains jsonb, is_archived, created_at, updated_at. Indexes on (org_id, is_archived, updated_at), (user_id, is_archived, updated_at). |
| `citation_test_runs` | **EXISTS** | `backend/db/migrate-citation-monitoring.js:43` | id, cluster_id (FK→prompt_clusters cascade), initiated_by_user_id, initiated_by_org_id, engines_tested jsonb, status (CHECK in `running\|completed\|failed\|partial`), started_at, completed_at, cost_estimate_cents, notes. Indexes on (cluster_id, started_at) and (status, started_at). |
| `citation_evidence` | **EXISTS** | `backend/db/migrate-citation-monitoring.js:63` | id, run_id (FK→runs cascade), cluster_id (FK→clusters cascade), engine, model, prompt_text, response_text (nullable), citations_raw jsonb, citations_normalized jsonb, mentioned/recommended/cited bools, error, created_at. Indexes on (run_id) and (cluster_id, engine, created_at). |
| `benchmark_stats` | **EXISTS** | `backend/db/migrate-citation-monitoring.js:87` | id, cluster_id (FK→clusters cascade), window, sample_size, **prompt_volume_index NUMERIC (nullable — Phase 3+ placeholder)**, citation_rate, citation_sov, mention_rate, recommendation_rate, top_cited_domains jsonb, updated_at. **`UNIQUE (cluster_id, window)`** for upsert. Index on (cluster_id, window, updated_at). |

**Migration is committed but not run.** `backend/db/migrate-citation-monitoring.js:106` is `if (require.main === module) { migrate() }`. There is no record of it being executed; `backend/db/migrate.js` (the v6 migration runner) only reads `migrations/phase1`. Operators must invoke this script manually (the same pattern as `migrate-historic-comparison.js`).

**Other "citation"-named migrations (excluded — directory product, NOT Phase 3):**
- `backend/db/migrate-citation-network.js` — adds `users.stripe_subscription_status` and Citation Network tables for the directory product.
- `backend/migrations/notification_deduplication.sql` — defines `citation_notification_events` (FK to `submission_id` confirms it's the directory product).
- `backend/migrations/t0_13_directory_orders_bigserial.sql` — directory orders.

**SSOT-spec match:** all four tables match the requested schema. The only deliberate divergence is `benchmark_stats.prompt_volume_index` shipped as `NUMERIC NULL` rather than computed today — flagged in the migration as a Phase 3+ placeholder.

---

## 2. Backend Services and Routes

### `backend/routes/ai-testing.js` — 1,202 lines

Pre-existing. Hosts both `/api/analyze-website` (V5 rubric scoring) and `/api/test-ai-visibility` (engine querying). Recently extended to wire persistence into the engine path.

**Endpoints**
| Method + Path | Auth | Plan-gated | Persists? |
|---|---|---|---|
| `POST /api/analyze-website` (L984) | `authenticateTokenOptional` | Yes — `PLAN_LIMITS[userPlan]` enforces scans-per-month and pages-per-scan | Writes to `scans` |
| `POST /api/test-ai-visibility` (L1086) | `authenticateTokenOptional` | **No** — does not consult `PlanService` or `PLAN_LIMITS` | **Yes, only when `clusterId` is supplied** in the request body — calls `persistCitationRun` from the service to insert into `citation_test_runs`, `citation_evidence`, and to upsert `benchmark_stats`. Otherwise returns engine results without writing. |

**Functions (key ones only — full list 47 functions)**
- `fetchText` (L24), `fetchRobotsAndSitemaps` (L54), `extractSitemapUrls` (L77), `fetchMultiPageSample` (L95) — crawl helpers.
- `detectIndustryKeywordBased`, `detectIndustryWithAI`, `detectIndustryHybrid`, `detectIndustryMultiAI` (L223–L472) — industry classification (used by `/analyze-website`).
- `analyzePageMetrics` + ~30 sub-scorers (L480–L965) — V5 rubric. **Not part of Citation Monitoring** but lives in the same file.
- `testAIVisibility` (L1125), `testSingleAssistant` (L1140), `queryAIAssistant` (L1160) — engine-query loop. This is the core of the citation monitoring engine layer.
- `analyzeResponse` (L1181) — naive `mentioned/recommended/cited` heuristic on response text (string contains).
- `calculateOverallMetrics` (L1191), `extractCompanyName` (L1198).

**External API calls**
- `AI_CONFIGS` object at L184 holds endpoints + auth headers for `openai`, `anthropic`, `perplexity`.
- Read of env: `OPENAI_API_KEY` (L187), `ANTHROPIC_API_KEY` (L191), `PERPLEXITY_API_KEY` (L195).
- **No Gemini / Google AI Overviews integration.** No `GEMINI_API_KEY` reference anywhere in `backend/`.
- Calls go via `axios.post(cfg.endpoint, body, { headers, timeout: 30000 })` at L1172 — **bounded** (verified in last week's bug-pattern audit).

**Idempotency**
- `analyzeResponse` and the engine loop have no idempotency keys. Re-running with the same `(clusterId, queries)` produces a new run and a new set of evidence rows every time — by design (each run is a measurement). The only upsert is `benchmark_stats` on `(cluster_id, window)`.

**Wiring into scan flow**
- Standalone HTTP endpoint. **Not invoked by the scan worker, scan completion hook, or `findingsService`.** A scan completing does not trigger a citation test.

### `backend/routes/citation-monitoring.js` — 135 lines

New (commit `6112de2`). DI-friendly via `buildRouter({ service })` so tests can swap a fake service.

**Endpoints**
| Method + Path | Auth | Plan-gated | Idempotency |
|---|---|---|---|
| `GET /api/prompt-clusters` (L30) | `authenticateTokenOptional` | No — filters by `req.user.org_id`/`id` if present, returns all otherwise | n/a (read) |
| `POST /api/prompt-clusters` (L45) | `authenticateToken` (required) | **No plan check** | Idempotent on `id`: passes through to `service.upsertCluster`, which does an UPDATE if `id` is provided, INSERT otherwise. **No `(org_id, name)` uniqueness — duplicate clusters can be created by repeated POST without `id`.** |
| `GET /api/citation-test-runs?clusterId=` (L85) | `authenticateTokenOptional` | No | n/a |
| `GET /api/benchmark-stats?clusterId=&window=7d\|14d\|30d\|90d` (L105) | `authenticateTokenOptional` | No | n/a |

Mounted at `app.use('/api', require('./routes/citation-monitoring'))` in `backend/server.js:119`.

### `backend/services/citationMonitoringService.js` — 468 lines

New. DI factory `createCitationMonitoringService({ db })` with whole-namespace fallback to `require('../db/database')` (matches the established `db.getClient()` pattern in `tokenService.js`, `findingsService.js`, etc.).

**Surface**
- Cluster CRUD: `upsertCluster`, `listClusters`, `getCluster`.
- Run lifecycle: `createRun(status='running')`, `markRunCompleted(status='completed'|'failed'|'partial')`, `listRuns`.
- Evidence: `recordEvidenceBatch(rows[])` — per-row insert, no ON CONFLICT (duplicates allowed; no idempotency key).
- Stats: `computeAndStoreBenchmark({ clusterId, window })` — derives `citation_rate / mention_rate / recommendation_rate / citation_sov / top_cited_domains` from rows in `citation_evidence` newer than `NOW() - <window>`, then upserts on `(cluster_id, window)`.
- Orchestration helpers `persistCitationRun({ clusterId, url, queries, results, ... })` and `buildEvidenceRows(...)` — shared with `routes/ai-testing.js`.

**Plan gating:** none. The service is plan-agnostic; gating is the route layer's responsibility (and currently absent).

**Idempotency guards:**
- `benchmark_stats` upsert: `ON CONFLICT (cluster_id, window) DO UPDATE` — yes (L310).
- `citation_test_runs` insert: no idempotency key.
- `citation_evidence` insert: no idempotency key.
- `prompt_clusters` upsert: keyed only on `id` (caller-supplied).

### `backend/db/migrate-citation-monitoring.js` — 150 lines

New. Standalone `node ...` script per the existing `migrate-*.js` precedent. Lazy-requires `pg` so `STATEMENTS` is introspectable in tests.

### `backend/tests/unit/citation-monitoring.test.js` — 435 lines

New. `node:test` style. Three suites, eight subtests:
- DDL static introspection (CREATE TABLE for all four tables, FKs, indexes, UNIQUE constraint).
- End-to-end service flow against a fake DB (cluster → run → 4 evidence rows → benchmark with `citation_rate=0.75`, `mention_rate=0.5`, `recommendation_rate=0.25`, top domain `example.com` 3/4 share).
- Route persistence wire-up via `persistCitationRun` (success path + `cluster_not_found`).

**No real DB, no real network, no real engine calls.**

### Engine adapter files

**None.** No `openai-adapter.js`, `anthropic-adapter.js`, `perplexity-adapter.js`, `engines/`, or similar directory under `backend/services/`. The only engine abstraction is the inline `AI_CONFIGS` map + `queryAIAssistant` switch in `ai-testing.js:1160`.

### Cron jobs scheduling citation testing

**None.** All three jobs in `backend/jobs/` are unrelated:
- `citationNetworkReminders.js` — directory product (excluded; sends reminders for `submissions` rows).
- `submissionWorker.js` — directory product (excluded).
- `tokenExpiry.js` — billing.

No scheduled job runs `testAIVisibility` or queues prompt clusters for periodic re-testing.

---

## 3. Frontend Components

**No matches found** in `frontend/` (excluding `node_modules`) for any of:
- "AI Test", "AI Testing"
- "Citation Snapshot", "Citation Monitoring", "Citation Monitor"
- "Prompt Volume"
- "test-ai-visibility", "prompt-clusters", "benchmark-stats", "citation-test-runs"
- Looser regex `AI Visibility (Test|Testing)`, `Citation (Test|Snapshot|Monitor)`, `engine (test|query)`

The Phase 3 feature has **zero frontend surface**. There is no UI, no dashboard card, no admin page that hits these endpoints. Reachability: **orphaned by definition** — the API exists but nothing in the shipped frontend calls it.

---

## 4. Configuration

### `.env.example` (root)

| Var | Present | Notes |
|---|---|---|
| `OPENAI_API_KEY` | Yes (L30) | placeholder `sk-your-openai-api-key-here` |
| `ANTHROPIC_API_KEY` | Yes (L33) | placeholder `sk-ant-your-anthropic-key-here` |
| `PERPLEXITY_API_KEY` | **No** | Required by `ai-testing.js:195` but missing from `.env.example` |
| `GEMINI_API_KEY` | **No** | No Gemini code paths exist either — consistent. |

### Config objects

- `AI_CONFIGS` — inline in `backend/routes/ai-testing.js:184`. Three engines: `openai`, `anthropic`, `perplexity`. No Gemini. No way to disable an engine without editing source.
- No `backend/config/aiEngines.js` or similar; `backend/config/industries.js` is unrelated (industry detection).

### Feature flags

**None.** Searched for `CITATION_MONITORING`, `CITATION_FEATURE`, `FEATURE_AI_TEST` — zero matches in `backend/`. The feature is on whenever the env keys are set.

---

## 5. Tests

| File | Coverage |
|---|---|
| `backend/tests/unit/citation-monitoring.test.js` | DDL + service + persistence wire-up (8 subtests, all pass under `node --test`). No real DB or network. |

**No other test files** reference citation monitoring or `ai-testing.js`. `routes/ai-testing.js` itself has no dedicated test file (the rubric scoring side has unit tests under `backend/tests/unit/` but nothing exercises the `testAIVisibility` engine path).

---

## 6. Recommendation

### Pick: **A) REFACTOR AND EXTEND the existing `ai-testing.js` scaffold** — but with a structural carve-out.

Rationale:
1. **All four Phase 3 tables already exist** with the right indexes and an idempotency guard on the only upsert that needs one. Building new in parallel means re-doing this work and reconciling the migrations later.
2. **The persistence service is already DI-friendly and tested.** Eight green subtests cover the DB shape and the orchestration. Throwing this out is wasteful.
3. **The engine layer (`testAIVisibility` / `testSingleAssistant` / `queryAIAssistant` / `analyzeResponse`) is small** — ~75 lines from L1125 to L1199 — and is the only thing that benefits from being lifted out of `ai-testing.js`.
4. **The other ~1,100 lines of `ai-testing.js` are V5 rubric scoring** that has nothing to do with Phase 3 and should not be touched in this work.

Concretely:
- **Keep** `routes/citation-monitoring.js`, `services/citationMonitoringService.js`, `db/migrate-citation-monitoring.js`, and the test file as-is.
- **Extract** the engine layer from `routes/ai-testing.js:1125-1199` into `backend/services/engines/` with one adapter file per engine (`openaiAdapter.js`, `anthropicAdapter.js`, `perplexityAdapter.js`) plus an index exposing `runEngines({ engines, prompts, signal })`. This is where the Gemini adapter will be added later. Replace the inline `AI_CONFIGS` switch.
- **Add plan gating** to `POST /api/test-ai-visibility` (currently ungated) and to `POST /api/prompt-clusters` via `PlanService`. Decide whether free tier can run citation tests at all.
- **Schedule periodic re-testing** by adding a `jobs/citationMonitoringScheduler.js` that picks the N most-recently-touched clusters and replays their canonical + variant prompts. Hook into the existing cron pattern (separate from `submissionWorker`).
- **Add a frontend surface** — currently the API has no UI consumer.
- **Tighten `analyzeResponse`** (`ai-testing.js:1181`) — the current `mentioned/recommended/cited` detection is naive `lowercase.includes(name|host)` and will produce false positives. Move to a proper citation extractor before relying on `citation_sov`.

Path B (build alongside) duplicates work that's already done and tested. Path C (build new from spec) discards a passing test suite. Path A wins by margin if and only if the scope is contained: extract engines, add plan gating, schedule, build UI — do not touch the rubric-scoring half of `ai-testing.js`.

---

## 7. Open Questions for Monali

1. **Run the migration?** `migrate-citation-monitoring.js` is committed but never executed. Do you want it run against staging now, or wait until plan gating + scheduler are in?
2. **Plan tiers.** Should free, starter, pro all be able to run citation tests? At what cap (runs/month, prompts/run)? The route is currently ungated.
3. **Cluster ownership.** A cluster has both `org_id` and `user_id` columns and `listClusters` accepts either. Should clusters always belong to an org, with a user_id only as the creator?
4. **Engine selection per request.** Today every run hits all configured engines. Should the caller pick a subset (e.g., a "Pro" plan unlocks Perplexity)?
5. **Prompt Volume Index.** `benchmark_stats.prompt_volume_index` is reserved as nullable. What's the input source — search-volume API, log of organic prompts, or pure heuristic? This determines whether we need a sixth table.
6. **Gemini / AI Overviews.** Confirmed not in this slice. Is the next milestone after stabilising the three current engines?
7. **Citation extraction quality.** `analyzeResponse` does string-contains on company name + domain. Are we ok with that as the v0 detector, or does Phase 3 require a real URL parser + entity matcher before we publish `citation_sov`?
8. **Scan-flow integration.** Should completing a `scans` row auto-create a citation test run for the user's primary cluster, or stay manual?
9. **Frontend.** Is there an existing dashboard card mock-up for citation monitoring, or do we design from scratch?
10. **Data retention.** `citation_evidence.response_text` is currently always `null` to avoid storing arbitrary upstream content. Confirm that's the policy, or set a retention window if we should keep responses for QA.

---

## Out-of-scope items observed (NOT counted as Citation Monitoring)

These exist in `backend/` and use the word "citation" but belong to the **AI Citation Network** directory product. Listed once for reviewer clarity:

- `backend/routes/citationNetwork.js`
- `backend/services/citationNetworkStripeService.js`
- `backend/services/citationNetworkWebhookHandler.js`
- `backend/jobs/citationNetworkReminders.js`
- `backend/db/migrate-citation-network.js`
- `backend/migrations/notification_deduplication.sql` (defines `citation_notification_events` keyed on `submission_id`)
- `backend/migrations/t0_13_directory_orders_bigserial.sql`
- `STRIPE_PRICE_SPRINT_249`, `STRIPE_PRICE_PACK_99` in `.env.example` (under the `# AI Citation Network Stripe Prices` heading)

## "AMBIGUOUS — NEEDS REVIEW"

None. After tracing FKs and ownership comments, every "citation"-named artifact resolves cleanly to either Phase 3 Citation Monitoring or the AI Citation Network directory product.
