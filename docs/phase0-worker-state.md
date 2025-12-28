# Phase 0: Worker State Check

## Overview

The Submission Worker (`backend/jobs/submissionWorker.js`) is responsible for processing queued directory submissions. Without it running, submissions stay in "queued" status forever.

---

## Worker Location

**File:** `backend/jobs/submissionWorker.js`

---

## Enabling the Worker

### Via Environment Variable

```bash
ENABLE_SUBMISSION_WORKER=1 node backend/server.js
```

### Server Integration (server.js lines 130-145)

```javascript
if (process.env.ENABLE_SUBMISSION_WORKER === '1') {
  const worker = getWorker();
  worker.start();
  console.log('[Server] Submission worker enabled and started');
} else {
  console.log('[Server] Submission worker disabled (set ENABLE_SUBMISSION_WORKER=1 to enable)');
}
```

### Standalone Mode

```bash
node backend/jobs/submissionWorker.js
```

---

## Worker Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| `MAX_SUBMISSIONS_PER_DAY` | 50 | Global daily limit |
| `BATCH_SIZE` | 5 | Submissions per batch |
| `BATCH_INTERVAL_MS` | 5 minutes | Wait between batches |
| `ERROR_BACKOFF_MS` | 1 minute | Wait on error |
| `MAX_RETRY_COUNT` | 3 | Max retry attempts |

---

## Per-Directory Rate Limits

```javascript
const DIRECTORY_RATE_LIMITS = {
  'g2': 2,           // per hour
  'capterra': 2,
  'product-hunt': 1,
  'trustpilot': 3,
  'yelp': 2,
  'bbb': 1,
  'default': 5
};
```

---

## Processing Flow

### 1. Batch Selection

```sql
SELECT ds.*, d.name, d.slug, d.submission_mode
FROM directory_submissions ds
JOIN directories d ON ds.directory_id = d.id
WHERE ds.status = 'queued'
  AND ds.retry_count < 3
  AND ds.directory_id != ALL($1::uuid[])  -- exclude rate-limited
ORDER BY ds.queue_position ASC, ds.created_at ASC
LIMIT 5
FOR UPDATE SKIP LOCKED  -- concurrency safety
```

### 2. Mark In-Progress

```sql
UPDATE directory_submissions
SET status = 'in_progress',
    started_at = NOW(),
    updated_at = NOW()
WHERE id = ANY($1::uuid[])
```

### 3. Process Each Submission

For each submission, the worker:

1. Gets the user's business profile
2. Checks submission_mode:
   - **`api`**: Calls `submitViaAPI()` (placeholder - falls back to manual)
   - **`manual`** (default): Calls `markActionNeeded()`

### 4. Current Reality: ALL Submissions Become "Action Needed"

The worker currently does NOT actually submit to directories. It only:

```javascript
async processSubmission(submission) {
  const mode = submission.submission_mode || 'manual';

  if (mode === 'api') {
    // TODO: Implement directory-specific API integrations
    // For now, fall back to manual submission
    await this.markActionNeeded(...);
  } else {
    // Mark as action_needed for user to submit manually
    await this.markActionNeeded(
      submission.id,
      submission.campaign_run_id,
      'manual_submission',
      'Please submit your business listing manually at the directory website.',
      submission.submission_url
    );
  }
}
```

---

## Worker Methods

| Method | Description |
|--------|-------------|
| `start()` | Start the worker loop |
| `stop()` | Graceful shutdown |
| `processNextBatch()` | Process next batch of queued submissions |
| `processSubmission()` | Process single submission |
| `submitViaAPI()` | API submission (placeholder - falls back to manual) |
| `markActionNeeded()` | Set status to action_needed with deadline |
| `markSubmitted()` | Set status to submitted |
| `markFailed()` | Set status to failed or retry |
| `getStatus()` | Get worker status |

---

## Status Transitions

```
queued → in_progress → action_needed (manual)
                    → submitted (if API implemented)
                    → failed (on error, after retries)
```

---

## Campaign Run Counter Updates

The worker updates campaign_runs counters atomically:

```sql
UPDATE campaign_runs
SET directories_action_needed = COALESCE(directories_action_needed, 0) + 1,
    directories_in_progress = GREATEST(0, COALESCE(directories_in_progress, 0) - 1),
    updated_at = NOW()
WHERE id = $1
```

---

## Graceful Shutdown

Handles SIGTERM and SIGINT:

```javascript
process.on('SIGTERM', () => worker.stop());
process.on('SIGINT', () => worker.stop());
```

---

## Related Jobs

### Citation Network Reminders

**File:** `backend/jobs/citationNetworkReminders.js`

Sends reminders for submissions with approaching deadlines:

```javascript
// Scheduled via cron in server.js
const { sendActionReminders } = require('./jobs/citationNetworkReminders');
```

---

## Query: Current Submission States

```sql
SELECT status, COUNT(*)
FROM directory_submissions
GROUP BY status;

-- Recent activity
SELECT id, status, updated_at, action_type
FROM directory_submissions
ORDER BY updated_at DESC
LIMIT 10;
```

---

## Critical Observations

1. **Worker does NOT actually submit** - It only marks submissions as "action_needed"
2. **No API integrations** - The `submitViaAPI()` method is a placeholder
3. **All paths lead to manual** - Users must submit manually to each directory
4. **Rate limits are aspirational** - The per-directory limits exist but API submission doesn't

---

## Recommendations

The worker is essentially a "triage system" that:
1. Picks up queued submissions
2. Marks them as needing user action
3. Sets deadlines for user action

For automated submission, directory-specific API integrations would need to be built.
