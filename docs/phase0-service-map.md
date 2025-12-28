# Phase 0: Service Layer Map

## Overview

The AI Citation Network uses a service-oriented architecture with the following key services:

---

## Service: `entitlementService.js`

**Location:** `backend/services/entitlementService.js`

**Purpose:** Calculate and manage directory submission entitlements.

### Public Methods

| Method | Description |
|--------|-------------|
| `calculateEntitlement(userId, options)` | Calculate total entitlement from subscription + orders |
| `getMonthlyAllocation(userId, plan, options)` | Get/create monthly allocation for subscriber |
| `getOrderAllocation(userId, options)` | Get order-based allocation |
| `consumeEntitlement(userId, count, source, sourceId)` | Consume entitlement after submissions |
| `reserveEntitlement(userId, requestedCount)` | Reserve entitlement for transactional safety |
| `hasEntitlement(userId)` | Check if user has remaining entitlement |
| `getEntitlementSummary(userId)` | Get display-friendly summary |
| `getUser(userId)` | Get user record |

### Plan Allocations

```javascript
// From planUtils.js
const PLAN_ALLOCATIONS = {
  free: 0,
  freemium: 0,
  diy: 10,      // per month
  pro: 25,      // per month
  enterprise: 100,
  agency: 100
};
```

### Entitlement Sources

1. **Subscription** - Monthly allocation based on plan
2. **Orders** - One-time purchases ($249 starter, $99 packs)

### Dependencies

- `db/database.js` - Database queries
- `utils/planUtils.js` - Plan normalization and allocation lookup

---

## Service: `campaignRunService.js`

**Location:** `backend/services/campaignRunService.js`

**Purpose:** Orchestrate the "Start Submissions" flow.

### Public Methods

| Method | Description |
|--------|-------------|
| `startSubmissions(userId, filters, options)` | Main entry point - starts a campaign |
| `checkDirectoriesSeeded(client)` | Verify directories table is populated |
| `validatePrerequisites(userId)` | Check profile complete, etc. |
| `getActiveCampaign(userId)` | Check for active campaign |
| `getActiveCampaignWithLock(client, userId)` | Same, with row lock |
| `getBusinessProfile(userId)` | Get user's business profile |
| `createCampaignRun(userId, profile, entitlement, filters)` | Create campaign run |
| `createCampaignRunTx(client, ...)` | Same, within transaction |
| `selectDirectories(campaignRun, filters, limit)` | Select directories to submit to |
| `selectDirectoriesTx(client, ...)` | Same, within transaction |
| `createSubmissions(campaignRun, directories)` | Create submission records |
| `createSubmissionsTx(client, ...)` | Same, within transaction |
| `consumeEntitlementTx(client, userId, count, entitlement)` | Consume entitlement |
| `updateCampaignStatus(campaignRunId, status, updates)` | Update campaign status |
| `getCampaignRun(campaignRunId, userId)` | Get campaign with submissions |
| `getCampaignRuns(userId, options)` | Get all campaigns for user |
| `getUserSubmissions(userId, options)` | Get all submissions for user |
| `getSubmissionCounts(userId)` | Get counts by status |
| `pauseCampaign(campaignRunId, userId)` | Pause a campaign |
| `resumeCampaign(campaignRunId, userId)` | Resume a campaign |
| `cancelCampaign(campaignRunId, userId)` | Cancel a campaign |
| `refreshCampaignCounts(campaignRunId)` | Refresh denormalized counts |

### Start Submissions Flow

```
1. Check directories are seeded
2. Validate prerequisites (profile complete)
3. Check no active campaign exists
4. Calculate entitlement
5. Get business profile
6. Create campaign_run record (with snapshots)
7. Select eligible directories
8. Create directory_submissions records
9. Consume entitlement
10. Update campaign_run status to 'queued'
```

### Dependencies

- `db/database.js` - Database queries
- `services/entitlementService.js` - Entitlement calculation
- `utils/planUtils.js` - Plan normalization

---

## Service: `citationNetworkStripeService.js`

**Location:** `backend/services/citationNetworkStripeService.js`

**Purpose:** Handle Stripe checkout for directory packs.

### Public Methods

| Method | Description |
|--------|-------------|
| `getCheckoutInfo(userId)` | Get checkout options (starter vs pack) |
| `createCheckout(userId, email)` | Create Stripe checkout session |

### Checkout Logic

1. First purchase → $249 starter (100 directories)
2. Subsequent → $99 pack (100 directories each)

### Dependencies

- Stripe SDK
- `db/database.js`

---

## Service: `citationNetworkWebhookHandler.js`

**Location:** `backend/services/citationNetworkWebhookHandler.js`

**Purpose:** Handle Stripe webhook events for citation network payments.

### Integration

Called from `backend/routes/stripe-webhook.js`:

```javascript
const handledByCitationNetwork = await handleCitationNetworkWebhook(event);
```

### Events Handled

- `checkout.session.completed` - Create directory_order record

---

## Utility: `planUtils.js`

**Location:** `backend/utils/planUtils.js`

**Purpose:** Single source of truth for plan definitions.

### Exports

| Export | Description |
|--------|-------------|
| `PLAN_ALLOCATIONS` | Monthly allocation per plan |
| `PAID_PLANS` | List of paid plan names |
| `PLAN_ALIASES` | Mapping for plan name variations |
| `normalizePlan(plan)` | Normalize plan string |
| `isPaidPlan(normalizedPlan)` | Check if plan grants subscription |
| `getPlanAllocation(normalizedPlan)` | Get monthly allocation |
| `analyzePlan(rawPlan)` | Debug helper |

---

## Worker: `submissionWorker.js`

**Location:** `backend/jobs/submissionWorker.js`

**Purpose:** Process queued submissions.

(See phase0-worker-state.md for details)

---

## Job: `citationNetworkReminders.js`

**Location:** `backend/jobs/citationNetworkReminders.js`

**Purpose:** Send reminders for submissions with approaching deadlines.

### Methods

| Method | Description |
|--------|-------------|
| `sendActionReminders()` | Query and send reminders |

### Scheduling

```javascript
// In server.js
cron.schedule('0 9 * * *', sendActionReminders); // Daily at 9am
```

---

## Service Dependency Graph

```
Routes (citationNetwork.js)
    │
    ├── entitlementService
    │       └── planUtils
    │       └── database
    │
    ├── campaignRunService
    │       ├── entitlementService
    │       ├── planUtils
    │       └── database
    │
    ├── citationNetworkStripeService
    │       └── Stripe SDK
    │       └── database
    │
    └── database (direct queries)

Webhook (stripe-webhook.js)
    └── citationNetworkWebhookHandler
            └── database

Worker (submissionWorker.js)
    └── database

Cron Jobs
    └── citationNetworkReminders
            └── database
```

---

## Configuration

**Location:** `backend/config/citationNetwork.js`

Contains configuration like:
- Stripe price IDs
- Checkout URLs
- Feature flags

---

## Key Design Patterns

1. **Snapshots** - Campaign runs store immutable snapshots of profile, entitlement, and filters
2. **Transactions** - Start submissions uses transactions for atomicity
3. **Row Locking** - `FOR UPDATE SKIP LOCKED` prevents race conditions
4. **UPSERT** - Monthly allocations use ON CONFLICT for create-on-read
5. **Denormalization** - Campaign runs have denormalized counts for quick access
6. **Rate Limiting** - Credential endpoints are rate-limited
