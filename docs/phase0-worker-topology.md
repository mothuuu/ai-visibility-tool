# Phase 0: Worker Process Reality Check

## Overview

This document analyzes how and where the submission worker runs in production.

---

## Worker Architecture

**File:** `backend/jobs/submissionWorker.js`

### Execution Modes

1. **Embedded in Web Server** (if `ENABLE_SUBMISSION_WORKER=1`)
   - Worker runs in same Node.js process as Express server
   - Started via `server.js` line 130-145

2. **Standalone Process**
   - Run directly: `node backend/jobs/submissionWorker.js`
   - Useful for dedicated worker instances

---

## Server Integration

**Location:** `backend/server.js` lines 130-145

```javascript
// Start submission worker if enabled
if (process.env.ENABLE_SUBMISSION_WORKER === '1') {
  const worker = getWorker();
  worker.start();
  console.log('[Server] Submission worker enabled and started');
} else {
  console.log('[Server] Submission worker disabled (set ENABLE_SUBMISSION_WORKER=1 to enable)');
}
```

---

## Production Deployment Configuration

### No Deployment Config Files Found

| File | Status |
|------|--------|
| `Procfile` | ❌ Not found |
| `render.yaml` | ❌ Not found |
| `docker-compose.yml` | ❌ Not found |
| `fly.toml` | ❌ Not found |
| `railway.json` | ❌ Not found |

### Package.json Scripts

```json
{
  "scripts": {
    "start": "node server.js"
  }
}
```

Only one start script. No separate worker script defined.

---

## Likely Production Reality

Based on code analysis:

### Scenario A: Worker Disabled (Most Likely)

If `ENABLE_SUBMISSION_WORKER` is not set:
- Worker never starts
- Submissions stay in `queued` status forever
- Users see "Pending" indefinitely

### Scenario B: Worker Running in Web Process

If `ENABLE_SUBMISSION_WORKER=1` is set:
- Worker runs in same process as web server
- Works but not ideal for scaling
- Worker competes with web requests for CPU

---

## Cron Job (Reminders)

**Location:** `backend/server.js` lines 137-140

```javascript
// Schedule reminder job (daily at 9am)
cron.schedule('0 9 * * *', async () => {
  console.log('[Server] Running daily action reminders...');
  await sendActionReminders();
});
```

**Dependency:** Requires `node-cron` package (added to package.json)

**Issue:** If using serverless (Lambda, Vercel), cron jobs won't run. They require a persistent process.

---

## Verification Steps

### 1. Check Environment Variables

```bash
# In production environment
echo $ENABLE_SUBMISSION_WORKER
```

Expected: `1` if worker should run, empty if disabled.

### 2. Check Logs

Look for these log messages:
```
[Server] Submission worker enabled and started
[SubmissionWorker] Starting...
[SubmissionWorker] Config: 50/day limit, batch size 5
```

OR:
```
[Server] Submission worker disabled (set ENABLE_SUBMISSION_WORKER=1 to enable)
```

### 3. Check Submission Status Distribution

```sql
SELECT status, COUNT(*) as count
FROM directory_submissions
GROUP BY status
ORDER BY count DESC;
```

If most are `queued` → Worker not running
If mix of `action_needed`, `submitted`, etc. → Worker running

---

## Recommended Production Setup

### Option 1: Render.com (Background Worker)

Create `render.yaml`:
```yaml
services:
  - type: web
    name: ai-visibility-web
    env: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: ENABLE_SUBMISSION_WORKER
        value: "0"  # Disable in web

  - type: worker
    name: ai-visibility-worker
    env: node
    buildCommand: npm install
    startCommand: node backend/jobs/submissionWorker.js
```

### Option 2: Heroku (Worker Dyno)

Create `Procfile`:
```
web: node backend/server.js
worker: ENABLE_SUBMISSION_WORKER=1 node backend/jobs/submissionWorker.js
```

### Option 3: Single Process (Simple)

Set `ENABLE_SUBMISSION_WORKER=1` on the web process.

Works for low-volume but not scalable.

---

## Cron Job Alternatives

### For Serverless Deployments

Use external cron services:
- **GitHub Actions** (scheduled workflows)
- **Vercel Cron** (if on Vercel)
- **AWS EventBridge** → Lambda
- **Render Cron Jobs**

### Example GitHub Action

```yaml
# .github/workflows/reminders.yml
name: Send Action Reminders
on:
  schedule:
    - cron: '0 14 * * *'  # 9am ET
jobs:
  remind:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger reminder endpoint
        run: curl -X POST ${{ secrets.API_URL }}/api/citation-network/trigger-reminders
```

---

## Summary

| Question | Answer |
|----------|--------|
| Is worker running as separate service? | ❌ No config found |
| Is worker running in web process? | ❔ Depends on `ENABLE_SUBMISSION_WORKER` |
| Are cron jobs running? | ❔ Requires persistent process |
| Is there a Procfile? | ❌ No |
| Is there a render.yaml? | ❌ No |

**Likely Current State:** Worker is disabled or not running, causing submissions to stay in `queued` status.

**Recommended Action:**
1. Check production env var `ENABLE_SUBMISSION_WORKER`
2. Check production logs for worker startup messages
3. Query `directory_submissions` to see status distribution
