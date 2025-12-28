# Phase 0: Status Universe & Constraints

## Overview

This document defines all valid status values and their transitions, plus database constraints for data integrity.

---

## Status Value Inconsistency (CRITICAL)

### The Problem

Two different values are used for "action needed" status:

| Location | Value Used |
|----------|------------|
| `backend/config/citationNetwork.js` | `NEEDS_ACTION: 'needs_action'` |
| `backend/jobs/submissionWorker.js` | `status = 'action_needed'` |
| `frontend/dashboard.js` (constant) | `NEEDS_ACTION: 'needs_action'` |
| Database (actual rows) | `'action_needed'` |

### Current Fix

Frontend now handles both:
```javascript
function isActionNeededStatus(status) {
  return status === 'needs_action' || status === 'action_needed';
}

const STATUS_DISPLAY = {
  'needs_action': { label: 'Action Needed', ... },
  'action_needed': { label: 'Action Needed', ... },  // alias
};
```

### Recommended Fix

Standardize to `'action_needed'` everywhere (matches database reality).

---

## directory_submissions.status

### Valid Values

| Status | Description | Set By |
|--------|-------------|--------|
| `queued` | Waiting in queue | campaignRunService.createSubmissions() |
| `in_progress` | Worker is processing | submissionWorker.processNextBatch() |
| `action_needed` | User must take action | submissionWorker.markActionNeeded() |
| `submitted` | Submitted to directory | submissionWorker.markSubmitted() |
| `pending_verification` | Awaiting verification | Future |
| `pending_approval` | Awaiting directory approval | Future |
| `verified` | Verification complete | Future |
| `live` | Listing is live | User marks |
| `rejected` | Directory rejected | User marks |
| `failed` | Processing failed | submissionWorker.markFailed() |
| `blocked` | Blocked (deadline missed) | Future |
| `skipped` | User skipped | Future |
| `cancelled` | Cancelled | campaignRunService.cancelCampaign() |

### State Transitions

```
                    ┌─────────────┐
                    │   queued    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ in_progress │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │action_needed│ │  submitted  │ │   failed    │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           │        ┌──────▼──────┐        │
           │        │    live     │        │
           │        └─────────────┘        │
           │                               │
    ┌──────▼──────┐                 ┌──────▼──────┐
    │   blocked   │                 │  (retry →   │
    └─────────────┘                 │   queued)   │
                                    └─────────────┘
```

---

## campaign_runs.status

### Valid Values

| Status | Description |
|--------|-------------|
| `created` | Just created, not yet started |
| `selecting` | Selecting directories |
| `queued` | Directories queued for submission |
| `in_progress` | Worker is processing |
| `paused` | User paused campaign |
| `completed` | All submissions processed |
| `cancelled` | User cancelled |
| `failed` | Campaign failed |

### State Transitions

```
created → selecting → queued → in_progress → completed
                          ↓           ↓
                       paused      failed
                          ↓
                      cancelled
```

---

## directory_orders.status

### Valid Values

| Status | Description | Set By |
|--------|-------------|--------|
| `pending` | Checkout created | citationNetworkStripeService |
| `paid` | Payment confirmed | webhook handler |
| `processing` | Ready for submissions | webhook handler |
| `in_progress` | Submissions started | campaignRunService |
| `completed` | All delivered | Future |
| `refunded` | Payment refunded | Future |
| `cancelled` | Checkout expired | webhook handler |

### State Transitions

```
pending → paid → processing → in_progress → completed
    ↓
cancelled
```

---

## Database Constraints

### Existing Unique Constraints

```sql
-- subscriber_directory_allocations
UNIQUE (user_id, period_start)  -- unique_user_period

-- credential_vault
UNIQUE (user_id, directory_id)  -- unique_user_directory_cred

-- directories
UNIQUE (slug)
```

### Missing Constraints (Recommended)

```sql
-- Prevent duplicate submissions per user/directory
ALTER TABLE directory_submissions
ADD CONSTRAINT unique_user_directory_submission
UNIQUE (user_id, directory_id)
WHERE status NOT IN ('cancelled', 'failed', 'skipped');

-- Ensure campaign_runs status is valid
ALTER TABLE campaign_runs
ADD CONSTRAINT check_campaign_status
CHECK (status IN ('created', 'selecting', 'queued', 'in_progress', 'paused', 'completed', 'cancelled', 'failed'));

-- Ensure directory_submissions status is valid
ALTER TABLE directory_submissions
ADD CONSTRAINT check_submission_status
CHECK (status IN ('queued', 'in_progress', 'action_needed', 'submitted', 'pending_verification', 'pending_approval', 'verified', 'live', 'rejected', 'failed', 'blocked', 'skipped', 'cancelled'));

-- Ensure directory_orders status is valid
ALTER TABLE directory_orders
ADD CONSTRAINT check_order_status
CHECK (status IN ('pending', 'paid', 'processing', 'in_progress', 'completed', 'refunded', 'cancelled'));
```

---

## Index Recommendations

### Existing Indexes

```sql
-- directory_submissions
idx_directory_submissions_order (order_id)
idx_directory_submissions_user (user_id)
idx_directory_submissions_status (status)
idx_directory_submissions_directory (directory_id)
idx_submissions_campaign (campaign_run_id)
idx_submissions_queue (campaign_run_id, queue_position)
idx_submissions_action (status, action_deadline) WHERE status IN ('action_needed', 'needs_action')
idx_submissions_verification (status, verification_deadline) WHERE status = 'pending_verification'

-- campaign_runs
idx_campaign_runs_user (user_id)
idx_campaign_runs_status (status)
idx_campaign_runs_created (created_at DESC)

-- credential_vault
idx_credentials_user (user_id)
idx_credentials_directory (directory_id)
```

### Recommended Additional Indexes

```sql
-- For worker batch selection
CREATE INDEX idx_submissions_worker_batch
ON directory_submissions(status, retry_count, queue_position)
WHERE status = 'queued';

-- For active campaign check
CREATE INDEX idx_campaign_runs_active
ON campaign_runs(user_id, status)
WHERE status IN ('created', 'selecting', 'queued', 'in_progress');

-- For entitlement calculation
CREATE INDEX idx_orders_entitlement
ON directory_orders(user_id, status)
WHERE status IN ('paid', 'processing', 'in_progress');
```

---

## Verification Queries

### Check Status Distribution

```sql
-- directory_submissions
SELECT status, COUNT(*) as count
FROM directory_submissions
GROUP BY status
ORDER BY count DESC;

-- campaign_runs
SELECT status, COUNT(*) as count
FROM campaign_runs
GROUP BY status
ORDER BY count DESC;

-- directory_orders
SELECT status, COUNT(*) as count
FROM directory_orders
GROUP BY status
ORDER BY count DESC;
```

### Find Invalid Status Values

```sql
-- Any unexpected submission statuses
SELECT DISTINCT status
FROM directory_submissions
WHERE status NOT IN (
  'queued', 'in_progress', 'action_needed', 'needs_action',
  'submitted', 'pending_verification', 'pending_approval',
  'verified', 'live', 'rejected', 'failed', 'blocked', 'skipped', 'cancelled'
);

-- Any unexpected campaign statuses
SELECT DISTINCT status
FROM campaign_runs
WHERE status NOT IN (
  'created', 'selecting', 'queued', 'in_progress',
  'paused', 'completed', 'cancelled', 'failed'
);
```

---

## Summary

| Table | Status Column | Values Used | Constraint Exists |
|-------|---------------|-------------|-------------------|
| directory_submissions | status | 10+ values | ❌ No |
| campaign_runs | status | 8 values | ❌ No |
| directory_orders | status | 7 values | ❌ No |
| credential_vault | account_status | 'active' | ❌ No |
| credential_vault | handoff_status | none/requested/completed | ❌ No |

**Recommendation:** Add CHECK constraints to ensure data integrity.
