# Backend Bug-Pattern Audit

Read-only scan of `backend/` (excluded `new backend/` and vendored
`backend/node_modules/`, `backend/phase2_preserved/`, `*.backup` files).
Scope per task: `backend/routes/`, `backend/services/`, `backend/jobs/`,
`backend/middleware/`.

---

## Summary

| Pattern | In-scope findings | Bugs | OK | Out-of-scope notes |
|---|---|---|---|---|
| 1 — Destructured `pool` / `db` from non-exporting module | 0 exact matches; 3 same-named-binding aliases | **1** | 2 | — |
| 2 — Unbounded upstream calls (axios / fetch / openai / anthropic / puppeteer) | 5 awaited upstream calls in scope | **1** | 4 | `analyzers/content-extractor.js` uses `puppeteer-core` outside scope; not audited here |

**Headline:** one live request-path crash bug (`pool.connect()` against the
namespace object, not the Pool — affects 3 call sites in
`StateMachineService.js`) and one live request-path hang risk
(unbounded `anthropic.messages.create` in support-chat).

---

## Highest-risk items (live request paths first)

1. **`backend/routes/support-chat.js:334`** — `anthropic.messages.create(...)`
   in a request handler with **no timeout, no AbortSignal, no
   `maxRetries` override**. The Anthropic SDK default request timeout is
   ~10 minutes; under upstream slowness this ties up workers exactly
   like the issue we already fixed in `new backend/`. **HIGH** —
   user-facing, hit on every chat turn.
2. **`backend/services/submission/StateMachineService.js`** — three
   `await pool.connect()` calls at **lines 78, 482, 544** against an
   alias whose underlying module exports `{ query, pool, getClient }`
   (no top-level `connect`). `pool.connect` is `undefined`; `await
   undefined` resolves to `undefined`; the next `client.query(...)` /
   `client.release()` throws `TypeError: Cannot read properties of
   undefined`. Reachable from `submissionWorker` and any route that
   drives the state machine. **HIGH** — silent crash on every
   transactional path.
3. *(Background only)* — none. All other identified upstream calls are
   bounded by explicit `timeout`.

---

## PATTERN 1 — Destructured pool / db from non-exporting module

**Exact pattern (`const { pool } = require(...)` or `const { db } = require(...)`):**

`grep -rEn "const \{[^}]*\b(pool|db)\b[^}]*\}\s*=\s*require\(['\"]\.\.?/(db|database|connect)" backend/{routes,services,jobs,middleware}` → **0 matches.**

**Wider check** — `const pool = require('.../db/database')` (whole-module
assigned to a variable named `pool`, then dereferenced as if it were the
pg `Pool`):

| File:line | require source | Module's actual exports | Methods called on the alias | Verdict |
|---|---|---|---|---|
| `backend/services/submission/StateMachineService.js:17` | `'../../db/database'` | `{ query, pool, getClient }` (see `backend/db/database.js:21-26`) | `pool.connect()` at **L78, L482, L544** | **BUG** — namespace has no `connect`; later `client.query/release` throws. |
| `backend/services/submission/ArtifactWriter.js:15` | `'../../db/database'` | same as above | only `pool.query(...)` (L132, L309, L333, L357, L379, L392) | **OK** — namespace exposes `query`. |
| `backend/routes/api/submissions.js:16` | `'../../db/database'` | same as above | only `pool.query(...)` (L39, L74, L134, L182, L434) | **OK** — namespace exposes `query`. |

**Note:** even the OK rows are misleading because the alias is named
`pool` but is actually the namespace object. Future contributors will
likely write `pool.connect(...)` and reproduce the StateMachine bug.
Recommend renaming to `db` for consistency with the rest of the
codebase (38 other files already do `const db = require('../db/database')`).

All 39+ `const db = require('.../db/database')` sites in scope use only
`db.query(...)` / `db.getClient()` and are correct.

---

## PATTERN 2 — Unbounded upstream calls

Awaited calls to `axios`, `fetch`, `@anthropic-ai/sdk`, `openai`, or
`puppeteer` in scope:

| File:line | Call | Context | Timeout / Abort | Verdict |
|---|---|---|---|---|
| `backend/routes/support-chat.js:334` | `await anthropic.messages.create({ model, max_tokens, system, messages })` | **Request handler** (POST chat) | none — no `timeout`, no `signal`, no `maxRetries` | **UNBOUNDED** |
| `backend/routes/ai-testing.js:26` | `await axios.get(url, { timeout, ... })` (inside `fetchText`, default 12 000 ms) | Request handler (`/analyze-website`) | `timeout: 12000` | BOUNDED |
| `backend/routes/ai-testing.js:1172` | `await axios.post(cfg.endpoint, body, { headers, timeout: 30000 })` (LLM provider proxy) | Request handler (`/test-ai-visibility`) | `timeout: 30000` | BOUNDED |
| `backend/services/duplicateCheckerService.js:178` | `await axios.get(url, { timeout: REQUEST_TIMEOUT_MS, ... })` (inside `fetchWithRetry`) | Service called from background duplicate checks | `timeout: REQUEST_TIMEOUT_MS` | BOUNDED |
| `backend/services/duplicateDetectionService.js:162` | `await axios.get(searchUrl, { timeout: REQUEST_TIMEOUT, ... })` | Service used by submission flow | `timeout: REQUEST_TIMEOUT` | BOUNDED |

**No `await fetch(...)` calls in scope.** **No `puppeteer`/`puppeteer-core`
calls in scope** (only `backend/analyzers/content-extractor.js` and
`backend/phase2_preserved/...`, both out of scope per the audit
boundaries).

**Note on `support-chat.js:334`**: even with a timeout configured, the
request handler also lacks an `AbortController` linked to the HTTP
request, so a client disconnect won't cancel the upstream call. The
`new backend/` route already solved both problems via
`utils/withTimeout.js`; that pattern can be lifted over.

---

## Files scanned

- `backend/routes/` — 19 .js files (excluding `*.backup`)
- `backend/services/` — 19 .js files including `submission/*`
- `backend/jobs/` — 3 files (`citationNetworkReminders.js`,
  `submissionWorker.js`, `tokenExpiry.js`)
- `backend/middleware/` — 12 files

Excluded by audit boundary: `backend/analyzers/`, `backend/db/`,
`backend/scripts/`, `backend/migrations/`, `backend/tests/`,
`backend/phase2_preserved/`, `backend/node_modules/`, `*.backup`.

---

## Recommended next steps (not done in this PR — read-only audit)

1. Fix `StateMachineService.js`: replace `await pool.connect()` with
   `await db.getClient()` (or rename the import to `db`) at L78, L482,
   L544. Rename the misleading `pool` aliases in
   `ArtifactWriter.js:15` and `routes/api/submissions.js:16` to `db`
   to prevent recurrence.
2. Wrap `anthropic.messages.create` in `support-chat.js:334` with a
   timeout (e.g., 30 s) and an `AbortController` chained to a
   request-level deadline; map timeout → `504 UPSTREAM_TIMEOUT`,
   matching the contract in `new backend/utils/withTimeout.js`.
3. Add a lint rule (or CI grep) blocking `const pool = require('.../db/database')`
   so the misleading alias can't reappear.
