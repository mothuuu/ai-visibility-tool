# PHASE 0: AI Citation Network System Map

## Executive Summary

The AI Citation Network is a directory submission system designed to help businesses get listed on 100+ AI and business directories. This document summarizes the complete audit of the current implementation.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
│  dashboard.js │ citation-network.html │ start-submissions.js            │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │ HTTP/REST
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          BACKEND ROUTES                                  │
│                   /api/citation-network/*                               │
│                   citationNetwork.js (1150 lines)                       │
└──────┬──────────────────┬───────────────────┬───────────────────────────┘
       │                  │                   │
       ▼                  ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
│ Entitlement  │   │ CampaignRun  │   │ CitationNetwork  │
│   Service    │   │   Service    │   │  StripeService   │
│              │   │              │   │                  │
│ - Calculate  │   │ - Start      │   │ - Checkout       │
│ - Consume    │   │ - Select     │   │ - Webhook        │
│ - Reserve    │   │ - Create     │   │                  │
└──────┬───────┘   └──────┬───────┘   └────────┬─────────┘
       │                  │                    │
       └────────┬─────────┴────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           DATABASE (PostgreSQL)                          │
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────────────┐ │
│  │ business_       │  │ campaign_runs   │  │ directory_submissions    │ │
│  │ profiles        │  │                 │  │                          │ │
│  └─────────────────┘  └─────────────────┘  └──────────────────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────────────┐ │
│  │ directories     │  │ directory_      │  │ subscriber_directory_    │ │
│  │                 │  │ orders          │  │ allocations              │ │
│  └─────────────────┘  └─────────────────┘  └──────────────────────────┘ │
│  ┌─────────────────┐                                                     │
│  │ credential_     │                                                     │
│  │ vault           │                                                     │
│  └─────────────────┘                                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ CRON / Worker
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          BACKGROUND JOBS                                 │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐   │
│  │ submissionWorker.js         │  │ citationNetworkReminders.js     │   │
│  │                             │  │                                 │   │
│  │ Processes queued submissions│  │ Sends deadline reminders        │   │
│  │ (currently: marks as        │  │ (daily cron job)                │   │
│  │  action_needed only)        │  │                                 │   │
│  └─────────────────────────────┘  └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Current Capabilities (What Actually Works)

### ✅ Working End-to-End

| Feature | Status | Notes |
|---------|--------|-------|
| Business Profile | ✅ Working | Create/edit business profile |
| Stripe Checkout | ✅ Working | $249 starter / $99 pack purchases |
| Entitlement Calculation | ✅ Working | Subscription + order-based |
| Start Submissions | ✅ Working | Creates campaign + queues directories |
| Submission Tracking | ✅ Working | View submission status in dashboard |
| Credential Vault | ✅ Working | Store/mask credentials (handoff only) |
| Worker Processing | ✅ Working | Processes queue, marks as action_needed |

### ⚠️ Partially Working

| Feature | Status | Notes |
|---------|--------|-------|
| Status Display | ⚠️ Fixed | Was showing wrong status, now fixed |
| Campaign Controls | ⚠️ Backend Only | Pause/Resume/Cancel work but no UI |
| Action Reminders | ⚠️ Unknown | Job exists but email delivery unclear |

---

## 3. Known Broken

| Feature | Issue | Impact |
|---------|-------|--------|
| Automated Submission | Worker only marks as action_needed, doesn't submit | Users must manually submit to every directory |
| Password Reveal | Intentionally disabled (503) | Users can only use handoff |

---

## 4. Mocked/Placeholder

| Feature | Current State | What It Claims |
|---------|---------------|----------------|
| `submitViaAPI()` | Falls back to manual | Should auto-submit via API |
| API integrations | None implemented | Each directory needs specific integration |
| Form automation | None | Should fill forms automatically |

---

## 5. Missing Entirely

| Feature | Description |
|---------|-------------|
| Browser automation | Puppeteer/Playwright for form filling |
| Directory-specific APIs | Integrations with G2, Capterra, etc. |
| Live verification | Check if listing actually went live |
| Auto-retry verification | Periodically check pending submissions |
| Bulk status updates | User marks multiple as submitted |
| Notification system | Email users on status changes |
| Analytics dashboard | Track success rates, time to live |

---

## 6. Critical Dependencies

### Environment Variables

```bash
# Required for Stripe
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PACK=price_...

# Required for worker
ENABLE_SUBMISSION_WORKER=1

# Optional debugging
CITATION_DEBUG=1
```

### Database Prerequisites

1. All migrations must be run
2. `directories` table must be seeded with directory data
3. `pricing_model` column must have values ('free'/'freemium')

---

## 7. User Journey (Current Reality)

```
1. User completes business profile
2. User purchases directory pack ($249 or $99)
3. User clicks "Start Submissions"
4. System creates campaign_run with queued submissions
5. Worker processes queue → marks as "Action Needed"
6. User sees 100 directories to submit to MANUALLY
7. User goes to each directory website and submits
8. User marks each as submitted (or system tracks if possible)
9. User waits for directory approval
10. User marks as live when listing appears
```

**Key Insight:** The system is currently a "task list generator" not an "automated submission system."

---

## 8. Recommended Phase 1 Fixes

### Critical (Blocks Basic Functionality)

1. **Verify directories are seeded**
   - Run: `SELECT COUNT(*) FROM directories WHERE is_active = true`
   - If 0, seed the database with directory data

2. **Add missing columns**
   - Run all migrations in `backend/migrations/`
   - Verify `directories_in_progress`, `action_type`, etc. exist

3. **Fix status inconsistency**
   - ✅ Already fixed: Frontend handles both 'action_needed' and 'needs_action'
   - Consider: Standardize to one value in worker

### High Priority (Improves UX)

4. **Enable worker in production**
   - Set `ENABLE_SUBMISSION_WORKER=1`
   - Worker processes queue on 5-minute intervals

5. **Add bulk status update UI**
   - Let users mark multiple submissions as "submitted" at once
   - Reduces friction for manual submission workflow

6. **Improve deadline visibility**
   - Show days remaining prominently
   - Send reminder emails (verify email integration)

### Medium Priority (Adds Value)

7. **Add submission details modal**
   - Show directory requirements
   - Show action URL prominently
   - Show deadline countdown

8. **Add campaign controls to UI**
   - Pause/Resume buttons
   - Cancel with confirmation

9. **Build first API integration**
   - Pick one directory with good API
   - Prove automated submission works

---

## 9. File Reference

### Routes
- `backend/routes/citationNetwork.js` - All API endpoints

### Services
- `backend/services/entitlementService.js` - Entitlement calculation
- `backend/services/campaignRunService.js` - Campaign orchestration
- `backend/services/citationNetworkStripeService.js` - Stripe integration
- `backend/services/citationNetworkWebhookHandler.js` - Webhook handling

### Jobs
- `backend/jobs/submissionWorker.js` - Queue processor
- `backend/jobs/citationNetworkReminders.js` - Reminder sender

### Utilities
- `backend/utils/planUtils.js` - Plan definitions

### Migrations
- `backend/db/migrate-citation-network.js` - Core tables
- `backend/db/migrate-campaign-runs.js` - Campaign tables
- `backend/migrations/*.sql` - Additional columns

### Frontend
- `frontend/dashboard.js` - Main dashboard
- `frontend/js/start-submissions.js` - Start flow
- `frontend/citation-network.html` - Sales page

---

## 10. Related Documentation

- [phase0-endpoint-inventory.md](./phase0-endpoint-inventory.md) - All API endpoints
- [phase0-database-schema.md](./phase0-database-schema.md) - Database tables
- [phase0-directory-audit.md](./phase0-directory-audit.md) - Directory data
- [phase0-worker-state.md](./phase0-worker-state.md) - Worker analysis
- [phase0-service-map.md](./phase0-service-map.md) - Service layer
- [phase0-gaps-list.md](./phase0-gaps-list.md) - All gaps categorized

---

## Conclusion

The AI Citation Network has solid infrastructure for:
- User authentication and profiles
- Payment processing
- Entitlement management
- Queue management
- Status tracking

The critical gap is that **the worker does not actually submit to directories**. It only prepares a task list for users to execute manually. Building automated submission capability would transform this from a "task list generator" to a true "automated submission service."

The recommended path forward is to:
1. Fix critical blockers (seeding, columns)
2. Improve the manual workflow UX
3. Incrementally add automated submission for high-value directories
