# Phase 5 Step 2: Core Services Implementation

## Overview

Phase 5 Step 2 implements the core submission framework services with strict invariant enforcement.

## Invariants

### 1. Single Point of Status Change

**StateMachineService.transitionRunStatus()** is the ONLY way to change `submission_runs.status`.

```javascript
// CORRECT
await stateMachine.transitionRunStatus(runId, {
  toStatus: SUBMISSION_STATUS.DEFERRED,
  reason: STATUS_REASON.BACKOFF,
  triggeredBy: TRIGGERED_BY.WORKER
});

// WRONG - Never do this
await pool.query('UPDATE submission_runs SET status = $1 WHERE id = $2', ['deferred', runId]);
```

### 2. Atomic Transactions

Every status transition:
1. Runs in a database transaction
2. Locks the row with `FOR UPDATE`
3. Validates the transition is allowed
4. Updates the run status
5. Inserts a canonical `STATUS_CHANGE` event
6. Commits or rolls back atomically

### 3. STATUS_REASON Enum Safety

`status_reason` column is a PostgreSQL enum. Only values from `STATUS_REASON` are valid:

```javascript
// CORRECT - Uses STATUS_REASON enum value
reason: STATUS_REASON.VERIFICATION_REQUIRED

// WRONG - Uses ACTION_NEEDED_TYPE (will fail DB constraint)
reason: ACTION_NEEDED_TYPE.MANUAL_REVIEW
```

Use the helper to map ACTION_NEEDED_TYPE to STATUS_REASON:
```javascript
const { mapActionNeededToStatusReason } = require('../constants/submission-enums');
const statusReason = mapActionNeededToStatusReason(ACTION_NEEDED_TYPE.CAPTCHA);
// Returns: STATUS_REASON.CAPTCHA_REQUIRED
```

### 4. ACTION_NEEDED Requires action_needed_type

DB constraint enforces this. The StateMachineService validates:
```javascript
await stateMachine.transitionRunStatus(runId, {
  toStatus: SUBMISSION_STATUS.ACTION_NEEDED,
  reason: STATUS_REASON.VERIFICATION_REQUIRED,
  meta: {
    actionNeeded: {
      type: ACTION_NEEDED_TYPE.MANUAL_REVIEW, // REQUIRED
      url: 'https://...',
      deadline: new Date(...)
    }
  }
});
```

### 5. FAILED Requires last_error_type

DB constraint enforces this. The StateMachineService validates:
```javascript
await stateMachine.transitionRunStatus(runId, {
  toStatus: SUBMISSION_STATUS.FAILED,
  reason: STATUS_REASON.CONNECTOR_ERROR,
  meta: {
    errorType: ERROR_TYPE.NETWORK_ERROR, // REQUIRED
    errorMessage: 'Connection refused'
  }
});
```

### 6. Retry Uses DEFERRED (Not FAILED Then Update)

Retryable errors transition directly to DEFERRED:
```javascript
// CORRECT - Single transition to DEFERRED with error info
await stateMachine.transitionRunStatus(runId, {
  toStatus: SUBMISSION_STATUS.DEFERRED,
  reason: STATUS_REASON.NETWORK_ERROR,
  meta: {
    errorType: ERROR_TYPE.NETWORK_ERROR,
    errorMessage: 'Connection timeout',
    scheduleRetry: true,
    retryDelayMs: 5000
  }
});

// WRONG - Never transition to FAILED then UPDATE to DEFERRED
await stateMachine.transitionRunStatus(runId, { toStatus: SUBMISSION_STATUS.FAILED, ... });
await pool.query('UPDATE submission_runs SET status = $1', ['deferred']); // NO!
```

### 7. LIVE_VERIFICATION_RESULT is Run-Linked

Artifacts of type `LIVE_VERIFICATION_RESULT` must be linked to a run (not target):
```javascript
await artifactWriter.store({
  runId: run.id,  // REQUIRED for LIVE_VERIFICATION_RESULT
  type: ARTIFACT_TYPE.LIVE_VERIFICATION_RESULT,
  content: { verified: true, method: 'scrape_check' }
});
```

### 8. Lock Fields Are All-or-Nothing

DB constraint enforces: `locked_at`, `locked_by`, `lease_expires_at` must all be set or all be NULL.

## Extending with New Connectors

### Creating a New Connector

```javascript
// backend/services/submission/connectors/MyDirectoryConnector.js
const { STATUS_REASON, ACTION_NEEDED_TYPE } = require('../../../constants/submission-enums');

class MyDirectoryConnector {
  async submit(payload, config) {
    // ... submission logic ...

    // For success:
    return {
      status: 'submitted',
      externalId: 'dir-12345',
      rawStatus: 'pending_review'
    };

    // For action needed:
    return {
      status: 'action_needed',
      reason: STATUS_REASON.VERIFICATION_REQUIRED, // Must be STATUS_REASON
      actionNeeded: {
        type: ACTION_NEEDED_TYPE.CAPTCHA, // Must be ACTION_NEEDED_TYPE
        url: 'https://...'
      }
    };

    // For error:
    return {
      status: 'error',
      errorType: ERROR_TYPE.NETWORK_ERROR, // Must be ERROR_TYPE
      errorMessage: 'Failed to connect'
    };
  }
}
```

### Registering the Connector

```javascript
const connectorRegistry = require('./services/submission/ConnectorRegistry');
const MyDirectoryConnector = require('./services/submission/connectors/MyDirectoryConnector');

connectorRegistry.register('my_directory', new MyDirectoryConnector());
```

## API Endpoints

All endpoints require authentication and enforce ownership:

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/submissions/targets | List user's submission targets |
| GET | /api/submissions/targets/:id | Get specific target |
| GET | /api/submissions/runs/:id | Get specific run |
| GET | /api/submissions/runs/:id/events | Get run events |
| GET | /api/submissions/runs/:id/artifacts | Get run artifacts |
| POST | /api/submissions/runs/:id/pause | Pause a run |
| POST | /api/submissions/runs/:id/resume | Resume a paused run |
| POST | /api/submissions/runs/:id/cancel | Cancel a run |
| POST | /api/submissions/runs/:id/retry | Create retry run |
| POST | /api/submissions/runs/:id/acknowledge-changes | Acknowledge directory changes |
| POST | /api/submissions/runs/:id/complete-action | User completed action |

## Testing

Run invariant tests:
```bash
npm test -- tests/submission/invariants.test.js
```

Verify no direct status updates:
```bash
grep -R "UPDATE submission_runs" backend/services backend/routes -n | grep -v StateMachineService
```

## File Structure

```
backend/
├── constants/
│   └── submission-enums.js          # All enums, source of truth
├── services/
│   └── submission/
│       ├── index.js                  # Service exports
│       ├── StateMachineService.js    # THE status transition handler
│       ├── LockManager.js            # Distributed lock management
│       ├── WorkerService.js          # Connector coordination
│       ├── ArtifactWriter.js         # Artifact storage with redaction
│       ├── ConnectorRegistry.js      # Connector registration
│       └── connectors/
│           └── ManualPacketConnector.js
├── routes/
│   └── api/
│       └── submissions.js            # API endpoints
└── tests/
    └── submission/
        └── invariants.test.js        # Invariant tests
```
