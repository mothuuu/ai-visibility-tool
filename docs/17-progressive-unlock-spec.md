# Visible2AI — Progressive Unlock & Recommendation Delivery Spec (v1.2.1)

**Status:** Canonical (Phase 0 contract)  
**Last updated:** 2026-01-11  
**Goal:** Deliver recommendations in a controlled cadence (e.g., **5 per 5-day cycle**), prevent UI overload, support DIY monetization, and keep behavior consistent across API + frontend.

---

## 0. Why This Spec Exists

Progressive unlock is the product mechanic that prevents:
- The API returning **all** recommendations
- The UI "fallbacking" into showing everything when `userProgress` is missing
- Inconsistent behavior across devices/sessions
- Broken "mark implemented/skip" flows due to scan-scoped endpoints

This spec defines **server-canonical** rules for:
- Cycles + batch surfacing
- Unlock state + timestamps
- Skip/implemented lifecycle
- API response shape and UI rendering requirements

---

## 1. Definitions

### 1.1 Recommendation Pool vs Surfaced Set
- **Pool**: All generated recommendations for a given **(org, domain, scan context)**.
- **Surfaced (Active)**: Recommendations that are **unlocked and visible** to the user in the "Active" list.

### 1.2 Cycle
A **cycle** is the time window controlling how many new recommendations are surfaced.

**DIY default:**
- `cycle_days = 5`
- `batch_size = 5` (max recommendations surfaced per cycle)

### 1.3 Scope
Progressive unlock is computed at the **organization + domain** level:
- `organization_id`
- `domain_id`

**Canonical scope key:** `scope_key = (organization_id, domain_id)`
All cycle progression, batch surfacing, and recommendation visibility is computed by `scope_key` — **regardless of which scan result page is being viewed**.


> Future option: Per-user progressive unlock (Agency/Enterprise) can be layered later. Default is org+domain.

### 1.4 Canonical Naming (Avoid Drift)

Canonical fields and their known aliases (for migration compatibility):

| Canonical | Alias (if exists in code) | Purpose |
|-----------|---------------------------|---------|
| `surfaced_at` | `unlocked_at` | When a recommendation becomes visible/unlocked |
| `skip_available_at` | `skip_enabled_at` | Earliest time user can skip that recommendation |
| `unlock_state` | — | Current state enum |
| `batch_number` | — | Which cycle surfaced this rec (not aliased; use separate `cycle_id` FK if needed) |

If runtime uses alternate names, map as aliases during migration. New code should use canonical names.

### 1.5 Timezone Convention

**All timestamps are stored and compared in UTC.**

- Database columns use `TIMESTAMP` (without time zone) storing UTC values
- Server performs all cycle/skip comparisons in UTC
- API responses include ISO 8601 timestamps with `Z` suffix (e.g., `2026-01-11T10:00:00Z`)
- Frontend converts to user's local timezone for display only

---

## 2. Product Rules (Locked)

### 2.1 Server-Side Canonical
Server is the source of truth for:
- Which recommendations are unlocked
- When batches become available
- Whether skip is allowed

Frontend may cache UI state but must never decide unlock eligibility.

### 2.2 Entitlements Govern Cadence + Caps
Progressive unlock behavior is configured through plan entitlements (single source of truth).

Required entitlement keys:

| Key | Type | Description |
|-----|------|-------------|
| `recommendationsProgressiveUnlockEnabled` | bool | Is progressive unlock active for this plan? |
| `recommendationsCycleDays` | int | Days per cycle |
| `recommendationsBatchSize` | int | Max recs surfaced per cycle |
| `recommendationsActiveCap` | int | Max shown in Active at a time |
| `recommendationsMaxReturn` | int \| -1 | API safety cap (-1 = unlimited) |
| `recommendationsSkipDelayHours` | int | Hours after surfacing before skip allowed |
| `recommendationsSkipCooldownDays` | int | Days after skip before rec can resurface (0 = never) |
| `recommendationsFillToCapWithinCycle` | bool | If true, implementing one surfaces another mid-cycle |

### 2.3 Per-Plan Configuration

| Plan | batch_size | cycle_days | active_cap | skip_delay_hours | skip_cooldown_days | fill_to_cap |
|------|------------|------------|------------|------------------|-------------------|-------------|
| Free | 3 | 5 | 3 | 120 (5 days) | 30 | false |
| DIY | 5 | 5 | 5 | 120 (5 days) | 30 | true |
| Pro | 10 | 5 | 10 | 120 (5 days) | 30 | true |
| Agency | 15 | 5 | 15 | 72 (3 days) | 14 | true |
| Enterprise | -1 | 5 | -1 | 0 | 0 | true |

**Notes:**
- `-1` = unlimited
- DIY has `fill_to_cap = true` so implementing a rec immediately surfaces the next one
- Enterprise has no skip delay (immediate skip allowed)

### 2.5 Unlimited Representation (`-1` Convention)

When a plan has "unlimited" for `batch_size`, `active_cap`, or `recommendationsMaxReturn`:

| Layer | Convention | Behavior |
|-------|------------|----------|
| **Config/Entitlements** | `-1` | Sentinel value meaning "no limit" |
| **Database** | `NULL` | Store `NULL` for unlimited; never store `-1` in DB |
| **Service logic** | Check for `NULL` or `-1` | `if (limit === -1 || limit === null) { /* skip cap check */ }` |
| **API response** | Return actual count | For Enterprise, return `"active_cap": null` (not `-1`) |

**Pagination for Enterprise:**
- Even with unlimited caps, implemented/skipped lists should be **paginated by default** (e.g., 50 per page)
- API accepts `?page=N&per_page=50` for all list endpoints
- This prevents unbounded response sizes

### 2.4 DIY Baseline: "5 per 5-day cycle"
For DIY:
- Surface **up to 5** recommendations every **5 days**
- Active list is capped via `recommendationsActiveCap`
- Implementing reduces Active count; new rec surfaces immediately if `fill_to_cap = true`

---

## 3. Data Model (Contract)

This spec refers to the canonical table as `scan_recommendations`.

### 3.1 Required Columns on `scan_recommendations`

**Identity**
```sql
id                  SERIAL PRIMARY KEY
scan_id             INTEGER NOT NULL REFERENCES scans(id)
organization_id     INTEGER NOT NULL REFERENCES organizations(id)
domain_id           INTEGER REFERENCES domains(id)
pillar_id           TEXT NOT NULL
category            TEXT  -- or subfactor_id; choose one consistent approach
```

**Unlock + Lifecycle**
```sql
unlock_state        TEXT NOT NULL DEFAULT 'locked'  -- enum: see 3.2
rec_type            TEXT NOT NULL DEFAULT 'actionable'  -- enum: see 3.3
batch_number        INTEGER  -- which cycle surfaced this rec
surfaced_at         TIMESTAMP  -- when became active (alias: unlocked_at)
skip_available_at   TIMESTAMP  -- earliest skip time (alias: skip_enabled_at)
implemented_at      TIMESTAMP
skipped_at          TIMESTAMP
dismissed_at        TIMESTAMP
resurface_at        TIMESTAMP  -- when skipped rec can resurface (computed)
```

**Copy + Quality**
```sql
title               TEXT NOT NULL
marketing_copy      TEXT NOT NULL  -- default view (required)
technical_copy      TEXT  -- opt-in expanded view
exec_copy           TEXT  -- executive summary view
why_it_matters      TEXT
what_to_do          TEXT
how_to_do           TEXT
```

**Evidence + Traceability**
```sql
evidence            JSONB
detection_rule_id   TEXT
confidence_score    NUMERIC
engine_version      TEXT NOT NULL  -- e.g., 'rec_v1', 'rec_v2'
priority_score      INTEGER DEFAULT 0  -- for selection algorithm
```

**Dedup / Overlap**
```sql
dedup_key           TEXT NOT NULL  -- stable key across scans
cluster_id          TEXT  -- groups related recs
```

### 3.2 `unlock_state` Enum (Canonical)

Must be one of:
- `locked` — Generated but not yet visible
- `active` — Surfaced and actionable
- `implemented` — User marked as done
- `skipped` — User chose to skip (after delay)
- `dismissed` — Permanently hidden (optional)

**Critical:** Never allow nullable `unlock_state`. Default must be `locked`.

### 3.3 Recommendation Type (`rec_type`)

Recommendations have a type that affects cap counting:

| Type | Description | Counts Toward Caps? |
|------|-------------|---------------------|
| `actionable` | Normal recommendation from detection engine | **Yes** |
| `diagnostic` | System-generated "caught up" or maintenance message | **No** |

```sql
rec_type  TEXT NOT NULL DEFAULT 'actionable'  -- enum: 'actionable', 'diagnostic'
```

**Rule:** Diagnostic recommendations:
- Do NOT count toward `active_cap` or `surfaced_in_cycle`
- Cannot be implemented or skipped (no lifecycle actions)
- Are auto-dismissed when new actionable recommendations become available (server must omit diagnostics from `active` response, or mark them `dismissed`)

### 3.4 Dedup Key Algorithm

```
dedup_key = lowercase(pillar_id + '_' + category + '_' + normalized_target)
```

**Examples:**
- `schema_organization_homepage`
- `entity_recognition_company_name_missing`
- `faq_schema_no_faq_detected`

**Purpose:**
- Ensures same issue doesn't appear twice in the same cycle
- Enables resurface detection: if user skipped "Add Organization Schema" and rescan finds same issue, dedup_key matches
- Used for cluster grouping (related recs share cluster_id)

### 3.5 Dedup Upsert Rules (Prevents Pool Inflation)

On new scan completion, recommendations are **upserted by `(organization_id, domain_id, dedup_key)`**:

| Existing State | Same Issue Detected Again | Behavior |
|----------------|---------------------------|----------|
| `locked` | Yes | **Update** existing: refresh `evidence`, `priority_score`, `scan_id` |
| `active` | Yes | **Update** existing: refresh `evidence`, `priority_score` (keep `surfaced_at`) |
| `implemented` | Yes | **Create new** instance with `unlock_state = 'locked'` (issue regressed) |
| `skipped` (cooldown active) | Yes | **No action**: issue still skipped, wait for `resurface_at` |
| `skipped` (cooldown expired) | Yes | **Reset**: set `unlock_state = 'locked'`, clear `skipped_at`, eligible for resurfacing |
| None | Yes | **Insert** new row with `unlock_state = 'locked'` |

**SQL pattern:**
```sql
INSERT INTO scan_recommendations (organization_id, domain_id, dedup_key, ...)
VALUES ($1, $2, $3, ...)
ON CONFLICT (organization_id, domain_id, dedup_key) 
DO UPDATE SET 
  evidence = EXCLUDED.evidence,
  priority_score = EXCLUDED.priority_score,
  scan_id = EXCLUDED.scan_id,
  updated_at = NOW()
WHERE scan_recommendations.unlock_state IN ('locked', 'active');
-- Implemented/skipped rows are NOT updated; new scan creates fresh instance if needed
```

**Unique constraint required:**
```sql
CREATE UNIQUE INDEX idx_scan_recs_dedup 
  ON scan_recommendations(organization_id, domain_id, dedup_key) 
  WHERE unlock_state NOT IN ('implemented', 'skipped', 'dismissed');
```

### 3.6 Recommendation Progress Table (Required)

One row per (org, domain). Tracks cycle state.

```sql
CREATE TABLE recommendation_progress (
  id                  SERIAL PRIMARY KEY,
  organization_id     INTEGER NOT NULL REFERENCES organizations(id),
  domain_id           INTEGER REFERENCES domains(id),
  
  -- Cycle state
  cycle_number        INTEGER NOT NULL DEFAULT 1,
  cycle_started_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  next_cycle_at       TIMESTAMP NOT NULL,
  
  -- Limits (snapshot from entitlements at cycle start - FOR AUDIT ONLY)
  batch_size          INTEGER NOT NULL,
  cycle_days          INTEGER NOT NULL,
  
  -- Counters
  surfaced_in_cycle   INTEGER NOT NULL DEFAULT 0,
  
  -- Timestamps
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(organization_id, domain_id)
);
```

### 3.7 Plan-Change Precedence Rule

The `batch_size` and `cycle_days` stored in `recommendation_progress` are **snapshots for audit/history only**.

**Precedence rule:** On every fetch or action, the server uses **current plan entitlements** (not snapshot):

```
1. Lookup user's current plan from subscription/billing
2. Load entitlements for that plan (live, not cached snapshot)
3. Apply current caps/delays to all decisions
4. Optionally update snapshot fields if plan changed
```

**Why:** If a user upgrades mid-cycle from Free (3 recs) to DIY (5 recs), they should see additional recs immediately—not wait for next cycle.

**On plan change:**
- Upgrade: Surface additional recs up to new `active_cap` if `fill_to_cap = true`
- Downgrade: Do NOT revoke already-surfaced recs; apply new caps going forward

---

## 4. Server Behavior

### 4.1 On Scan Completion: Generate Pool + Initial Surfacing

When a site-level scan completes:

```
1. Insert the full recommendation pool with unlock_state = 'locked'
2. Upsert recommendation_progress for (org, domain)
3. If progressive unlock enabled:
   a. Select top batch_size recommendations (see §4.2)
   b. For each selected:
      - Set unlock_state = 'active'
      - Set batch_number = cycle_number
      - Set surfaced_at = NOW()
      - Set skip_available_at = NOW() + skip_delay_hours
   c. Update surfaced_in_cycle counter
```

### 4.2 Surfacing Selection Algorithm (Deterministic)

When selecting which recommendations to surface, use this priority order:

1. **Highest priority_score** (from detection engine)
2. **Highest impact** (pillar weight × confidence)
3. **Lowest effort** (implementation complexity)
4. **Pillar diversity**: Avoid surfacing all from same pillar if multiple pillars are weak
5. **Avoid duplicates**: Skip if `dedup_key` already surfaced in this cycle
6. **Respect skip cooldown**: Skip if `resurface_at > NOW()`

```sql
-- Example selection query
SELECT id, pillar_id, priority_score
FROM scan_recommendations
WHERE organization_id = $1
  AND domain_id = $2
  AND unlock_state = 'locked'
  AND (resurface_at IS NULL OR resurface_at <= NOW())
ORDER BY 
  priority_score DESC,
  CASE pillar_id  -- diversity bonus
    WHEN (SELECT pillar_id FROM scan_recommendations 
          WHERE unlock_state = 'active' 
          GROUP BY pillar_id ORDER BY COUNT(*) DESC LIMIT 1)
    THEN 1 ELSE 0 
  END ASC,
  created_at ASC
LIMIT $3;  -- batch_size
```

### 4.3 On Fetch: Enforce Cadence + Optional Fill-to-Cap

Endpoint: `GET /api/recommendations?domain_id=...`

Server must:

```
1. Resolve plan entitlements for requester
2. Read recommendation_progress for (org, domain)
3. If NOW() >= next_cycle_at:
   a. Increment cycle_number
   b. Reset surfaced_in_cycle = 0
   c. Set cycle_started_at = NOW()
   d. Set next_cycle_at = NOW() + cycle_days
   e. Surface next batch (up to batch_size)
4. Else if fill_to_cap_within_cycle = true:
   a. Count current active recs
   b. If active_count < active_cap AND surfaced_in_cycle < batch_size:
      - Surface additional recs up to MIN(active_cap - active_count, batch_size - surfaced_in_cycle)
5. Return recommendations grouped by state
```

### 4.4 Concurrency: Cycle Advancement Transaction

**Critical:** Cycle advancement + surfacing must be done in a **single transaction with a row lock** on `recommendation_progress` to prevent double-advances under concurrent requests.

```sql
-- Pattern: SELECT FOR UPDATE to lock the progress row
BEGIN;

SELECT * FROM recommendation_progress 
WHERE organization_id = $1 AND domain_id = $2
FOR UPDATE;

-- Check if cycle needs advancing
-- If yes, update progress + surface new batch
-- All within this transaction

COMMIT;
```

**Why:** Without locking, two concurrent requests at cycle boundary could both advance the cycle, resulting in:
- Double-increment of `cycle_number`
- Double-surfacing of recommendations
- Inconsistent `surfaced_in_cycle` counts

**Alternative:** Use advisory locks or optimistic locking with version column if row-level locks cause contention.

### 4.5 API Response Shape

API must not rely on client-side caps. Response includes cycle metadata.

```json
{
  "success": true,
  "data": {
    "domain_id": 123,
    "active": [
      {
        "id": 456,
        "pillar_id": "schema_markup",
        "title": "Add Organization Schema",
        "marketing_copy": "AI assistants can't verify your business...",
        "unlock_state": "active",
        "surfaced_at": "2026-01-06T10:00:00Z",
        "skip_available_at": "2026-01-11T10:00:00Z",
        "can_skip": false,
        "skip_available_in_hours": 48,
        "priority_score": 85
      }
    ],
    "implemented": [],
    "skipped": [],
    "locked_count": 42,
    "cycle": {
      "cycle_number": 3,
      "cycle_started_at": "2026-01-06T10:00:00Z",
      "next_cycle_at": "2026-01-11T10:00:00Z",
      "days_remaining": 2,
      "batch_size": 5,
      "cycle_days": 5,
      "surfaced_in_cycle": 5
    },
    "limits": {
      "active_cap": 5,
      "skip_delay_hours": 120,
      "fill_to_cap": true
    }
  },
  "error": null,
  "meta": {
    "request_id": "req_abc123"
  }
}
```

**Key fields:**
- `can_skip`: Server-computed boolean (`NOW() >= skip_available_at`)
- `skip_available_in_hours`: Countdown for UI display
- `locked_count`: Teaser for upgrade prompt

---

## 5. Lifecycle Transitions

All lifecycle changes MUST be recommendation-scoped (not scan-scoped) to avoid context mismatch.

### 5.0 Security: Tenancy Validation (Required)

**Every lifecycle endpoint MUST validate tenancy before any mutation:**

```javascript
// Pseudocode for all PATCH /api/recommendations/:id endpoints
async function validateTenancy(recId, callerId) {
  const rec = await db.query(`
    SELECT r.id, r.organization_id 
    FROM scan_recommendations r
    JOIN organization_members om ON r.organization_id = om.organization_id
    WHERE r.id = $1 AND om.user_id = $2
  `, [recId, callerId]);
  
  if (!rec) {
    throw new ForbiddenError('RECOMMENDATION_NOT_FOUND');  // Don't leak existence
  }
  return rec;
}
```

**Rules:**
- Recommendation must belong to caller's `organization_id`
- If `domain_id` is provided in request, it must match the recommendation's `domain_id`
- Return `404 RECOMMENDATION_NOT_FOUND` for both "doesn't exist" and "wrong org" (prevent enumeration)
- Log tenancy violations with `request_id` and `caller_id` for security audit

### 5.1 Implement

```
PATCH /api/recommendations/:id
Content-Type: application/json

{ "action": "implement" }
```

**Validation:**
- Recommendation must exist
- `unlock_state` must be `active`

**Effects:**
- `unlock_state = 'implemented'`
- `implemented_at = NOW()`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 456,
    "unlock_state": "implemented",
    "implemented_at": "2026-01-08T14:30:00Z"
  }
}
```

**If `fill_to_cap = true`:** Server automatically surfaces next recommendation from locked pool.

### 5.2 Skip

```
PATCH /api/recommendations/:id
Content-Type: application/json

{ "action": "skip" }
```

**Validation:**
- Recommendation must exist
- `unlock_state` must be `active`
- `NOW() >= skip_available_at`

**Effects:**
- `unlock_state = 'skipped'`
- `skipped_at = NOW()`
- `resurface_at = NOW() + skip_cooldown_days` (if cooldown > 0)

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 456,
    "unlock_state": "skipped",
    "skipped_at": "2026-01-11T14:30:00Z",
    "resurface_at": "2026-02-10T14:30:00Z"
  }
}
```

**Skip Not Available Response (403):**
```json
{
  "success": false,
  "error": {
    "code": "SKIP_NOT_AVAILABLE",
    "message": "Skip not available yet",
    "details": {
      "skip_available_at": "2026-01-11T10:00:00Z",
      "skip_available_in_hours": 48
    }
  }
}
```

### 5.3 Dismiss (Optional)

```
PATCH /api/recommendations/:id
Content-Type: application/json

{ "action": "dismiss" }
```

**Effects:**
- `unlock_state = 'dismissed'`
- `dismissed_at = NOW()`

Dismissed recommendations never resurface.

### 5.4 Error Codes

Add to `12-error-codes-catalog.md`:

| Code | HTTP | When |
|------|------|------|
| `SKIP_NOT_AVAILABLE` | 403 | `NOW() < skip_available_at` |
| `RECOMMENDATION_ALREADY_ACTIONED` | 409 | Already implemented/skipped/dismissed |
| `RECOMMENDATION_LOCKED` | 403 | Trying to action a locked recommendation |
| `RECOMMENDATION_NOT_FOUND` | 404 | ID doesn't exist or doesn't belong to user's org |

---

## 6. UI Requirements (Contract)

### 6.1 Render from Server State

UI must:
- Render Active tab from `data.active`
- Render Implemented/Skipped tabs from server lists
- Show locked count + "next batch" timer from cycle metadata
- Disable Skip button until `can_skip = true`
- Show countdown: "Skip available in X days"

UI must NOT:
- Decide unlock eligibility via localStorage
- Default missing `unlock_state` to active
- Show all recommendations if server returns partial data
- Implement its own caps separate from server

### 6.2 Default View vs Expanded Detail

| View | Field | When Shown |
|------|-------|------------|
| Default | `marketing_copy` | Always (collapsed card) |
| Expanded | `technical_copy` | User clicks "Show Details" |
| Executive | `exec_copy` | User toggles to "Executive View" (if available) |

### 6.3 Tab Structure

| Tab | Filter | Contents |
|-----|--------|----------|
| Active | `unlock_state = 'active'` | Actionable recommendations |
| Implemented | `unlock_state = 'implemented'` | Completed items (success state) |
| Skipped | `unlock_state = 'skipped'` | User-skipped items |
| Locked | `unlock_state = 'locked'` | Upgrade teaser (count only, or list for Pro+) |

### 6.4 Skip Button States

| Condition | Button State | Label |
|-----------|--------------|-------|
| `can_skip = false` | Disabled | "Skip in X days" |
| `can_skip = true` | Enabled | "Skip" |
| After skip | Hidden | (Rec moves to Skipped tab) |

---

## 7. Edge Cases (Must Handle)

### 7.1 Missing Progress Row
**Trigger:** First fetch for an org+domain with no prior cycle.
**Behavior:** Create progress row lazily with `cycle_number = 1`, `cycle_started_at = NOW()`, `next_cycle_at = NOW() + cycle_days`.

### 7.2 Legacy Null `unlock_state`
**Trigger:** Old recommendations with NULL state.
**Behavior:** Treat as `locked`. Backfill migration should set `unlock_state = 'locked' WHERE unlock_state IS NULL`.

### 7.3 Context Scan Reuse
**Trigger:** User views results for an older scan while newer scan exists.
**Behavior:** Lifecycle transitions are rec-scoped by `recommendation.id`, not `scan_id`. Transitions work regardless of which scan results page user is viewing.

### 7.4 New Scan Mid-Cycle
**Trigger:** User rescans their site before cycle ends.
**Behavior:** 
- New recommendations join locked pool
- Existing active recommendations remain active (no disruption)
- If `fill_to_cap = true` and active count dropped, may surface new recs
- Dedup by `dedup_key`: don't create duplicate rec if same issue already exists

### 7.5 Locked Pool Empty (Never-Zero)
**Trigger:** All recommendations have been actioned; nothing left to surface.
**Behavior:** 
- Show "caught up" maintenance message
- Surface a diagnostic recommendation with `rec_type = 'diagnostic'`:
  ```
  Title: "Your site is well-optimized!"
  Marketing copy: "You've addressed all current recommendations. 
                   Rescan in 30 days or after making significant changes 
                   to discover new optimization opportunities."
  rec_type: "diagnostic"
  unlock_state: "active"
  ```
- Diagnostic recs do NOT count toward `active_cap` or `surfaced_in_cycle` (per §3.3)
- Diagnostic recs cannot be implemented/skipped; auto-dismissed when new actionable recs appear

### 7.6 Plan Change Mid-Cycle
**Trigger:** User upgrades from Free to DIY mid-cycle.
**Behavior:**
- Apply new `batch_size` and `active_cap` going forward
- Do NOT revoke already-surfaced recommendations
- If upgrading increases cap, surface additional recs immediately (if `fill_to_cap = true`)
- If downgrading decreases cap, existing active recs remain until actioned (grandfather)

### 7.7 Skipped Rec Resurface
**Trigger:** User skipped a rec, cooldown passed, rescan detects same issue.
**Behavior:**
- If `resurface_at <= NOW()` AND new scan has same `dedup_key` issue
- Rec can be surfaced again in a future cycle
- Reset: `unlock_state = 'locked'`, clear `skipped_at`

---

## 8. Analytics & Observability

### 8.1 Events to Emit

| Event | When | Key Properties |
|-------|------|----------------|
| `recommendation_surfaced` | Rec becomes active | rec_id, pillar_id, cycle_number, batch_number |
| `recommendation_implemented` | User marks done | rec_id, time_to_implement_hours |
| `recommendation_skipped` | User skips | rec_id, time_surfaced_hours |
| `recommendation_dismissed` | User dismisses | rec_id |
| `recommendation_skip_blocked` | Skip attempted before allowed | rec_id, hours_remaining |
| `cycle_advanced` | New cycle starts | org_id, domain_id, old_cycle, new_cycle |
| `fill_to_cap_triggered` | Mid-cycle surfacing | org_id, domain_id, recs_surfaced |

### 8.2 Metrics

- `recommendations_surfaced_total{plan}` — Counter
- `recommendations_implemented_total{plan}` — Counter
- `recommendations_skipped_total{plan}` — Counter
- `recommendation_time_to_implement_seconds` — Histogram
- `recommendation_time_to_skip_seconds` — Histogram
- `skip_blocked_attempts_total{plan}` — Counter (UX friction indicator)
- `cycle_completion_rate{plan}` — % cycles where all active recs actioned

### 8.3 Alerts

- Alert if `skip_blocked_attempts` spikes (UX confusion, users don't understand delay)
- Alert if `time_to_implement` median > 14 days (recommendations not actionable)
- Alert if `implemented_total` is zero for 7+ days (feature not being used)

---

## 9. Test Checklist

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 1 | First scan for new org+domain | Surfaces exactly `batch_size` recs; rest locked |
| 2 | Fetch before `next_cycle_at` | No new recs surface; same active list |
| 3 | Fetch after `next_cycle_at` | New cycle starts; next batch surfaces |
| 4 | Mark implemented | Rec moves to Implemented; `implemented_at` set |
| 5 | Mark implemented with fill_to_cap=true | New rec surfaces immediately |
| 6 | Skip before delay elapsed | Returns 403 SKIP_NOT_AVAILABLE with countdown |
| 7 | Skip after delay elapsed | Rec moves to Skipped; `skipped_at` set |
| 8 | Legacy null unlock_state | Treated as locked, not active |
| 9 | Upgrade Free → DIY mid-cycle | New caps apply; additional recs surface if fill_to_cap |
| 10 | Downgrade Pro → DIY mid-cycle | Existing active recs remain; no revocation |
| 11 | Rescan mid-cycle | New recs join locked pool; active unchanged |
| 12 | All recs actioned | Never-zero: diagnostic "caught up" message appears |
| 13 | Skip cooldown passed + rescan | Skipped rec can resurface in new cycle |
| 14 | API response shape | Always includes `cycle` metadata + `locked_count` |
| 15 | Action on locked rec | Returns 403 RECOMMENDATION_LOCKED |

---

## 10. Migration Path

### Phase 1 Tasks (Database Foundation)

1. **Add missing columns** to `scan_recommendations`:
   ```sql
   ALTER TABLE scan_recommendations
     ADD COLUMN IF NOT EXISTS rec_type TEXT NOT NULL DEFAULT 'actionable',
     ADD COLUMN IF NOT EXISTS surfaced_at TIMESTAMP,
     ADD COLUMN IF NOT EXISTS skip_available_at TIMESTAMP,
     ADD COLUMN IF NOT EXISTS resurface_at TIMESTAMP,
     ADD COLUMN IF NOT EXISTS marketing_copy TEXT,
     ADD COLUMN IF NOT EXISTS technical_copy TEXT,
     ADD COLUMN IF NOT EXISTS exec_copy TEXT,
     ADD COLUMN IF NOT EXISTS dedup_key TEXT,
     ADD COLUMN IF NOT EXISTS cluster_id TEXT,
     ADD COLUMN IF NOT EXISTS priority_score INTEGER DEFAULT 0;
   ```

2. **Create column aliases** (if keeping old names for compatibility):
   ```sql
   -- If code uses unlocked_at, create view or rename
   -- Recommended: rename to canonical names
   ALTER TABLE scan_recommendations RENAME COLUMN unlocked_at TO surfaced_at;
   ALTER TABLE scan_recommendations RENAME COLUMN skip_enabled_at TO skip_available_at;
   ```

3. **Create `recommendation_progress` table** (see §3.4)

4. **Backfill unlock_state**:
   ```sql
   UPDATE scan_recommendations 
   SET unlock_state = 'locked' 
   WHERE unlock_state IS NULL;
   
   ALTER TABLE scan_recommendations 
   ALTER COLUMN unlock_state SET NOT NULL;
   ```

5. **Add entitlement keys** to `04-entitlements-config.js`:
   ```javascript
   // Per plan
   recommendationsProgressiveUnlockEnabled: true,
   recommendationsCycleDays: 5,
   recommendationsBatchSize: 5,
   recommendationsActiveCap: 5,
   recommendationsSkipDelayHours: 120,
   recommendationsSkipCooldownDays: 30,
   recommendationsFillToCapWithinCycle: true,
   ```

### Phase 4 Tasks (Recommendations Engine)

1. **Consolidate endpoints**: Deprecate scan-scoped endpoints; use `PATCH /api/recommendations/:id`
2. **Implement cycle logic**: Selection algorithm, fill-to-cap, cycle advancement
3. **Implement skip delay**: Server-side validation of `skip_available_at`
4. **Update frontend**: Use new response shape, render from server state only

---

## 11. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-11 | Initial draft |
| 1.1 | 2026-01-11 | Added per-plan limits table, error codes, dedup key algorithm, never-zero fallback details, edge case expansions, migration path |
| 1.2 | 2026-01-11 | **No-ambiguity release:** Added §2.5 unlimited representation (`-1`/`NULL` convention + pagination), §3.3 `rec_type` for diagnostic vs actionable, §3.5 dedup upsert rules, §3.7 plan-change precedence, §4.4 concurrency/transaction locking, §5.0 tenancy validation, §1.5 UTC timezone convention, locked `batch_number` as canonical (no alias) |
