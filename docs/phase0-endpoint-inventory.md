# Phase 0: Endpoint & Route Inventory

## Overview
All AI Citation Network endpoints are defined in `backend/routes/citationNetwork.js`.
Routes are mounted at `/api/citation-network/`.

---

## Endpoint Inventory

### Profile Management

| Route | Method | Handler | Purpose | Status | Frontend Caller |
|-------|--------|---------|---------|--------|-----------------|
| `/profile` | GET | authenticateToken | Get user's business profile | Working | `dashboard.js:2538`, `dashboard.js:4121` |
| `/profile` | POST | authenticateToken | Create/update business profile | Working | `dashboard.js:4170+` (profile form) |

### Checkout & Orders

| Route | Method | Handler | Purpose | Status | Frontend Caller |
|-------|--------|---------|---------|--------|-----------------|
| `/checkout-info` | GET | authenticateTokenOptional | Get checkout option (starter vs pack) | Working | `citation-network.html:372`, `dashboard.js:2340` |
| `/checkout` | POST | authenticateTokenOptional | Create Stripe checkout session | Working | `citation-network.html:461`, `dashboard.js:2361` |
| `/orders` | GET | authenticateToken | Get user's citation network orders | Working | `citation-network-success.html:227` |
| `/orders/:id` | GET | authenticateToken | Get specific order details | Working | `citation-network-success.html:227` |

### Entitlement & Allocation

| Route | Method | Handler | Purpose | Status | Frontend Caller |
|-------|--------|---------|---------|--------|-----------------|
| `/allocation` | GET | authenticateToken | Get current allocation (subscription + orders) | Working | `dashboard.js:2541` |
| `/entitlement` | GET | authenticateToken | Get user's entitlement calculation | Working | `start-submissions.js:43` |

### Campaign Management

| Route | Method | Handler | Purpose | Status | Frontend Caller |
|-------|--------|---------|---------|--------|-----------------|
| `/start-submissions` | POST | authenticateToken | Start new submission campaign | Working | `dashboard.js:2191`, `dashboard.js:2404`, `start-submissions.js:81` |
| `/active-campaign` | GET | authenticateToken | Check for active campaign | Working | `dashboard.js:2544`, `start-submissions.js:44` |
| `/campaign-runs` | GET | authenticateToken | Get user's campaign runs | Working | Not directly called |
| `/campaign-runs/:id` | GET | authenticateToken | Get specific campaign with submissions | Working | Not directly called |
| `/campaign-runs/:id/pause` | POST | authenticateToken | Pause a campaign | Working | Not directly called |
| `/campaign-runs/:id/resume` | POST | authenticateToken | Resume paused campaign | Working | Not directly called |
| `/campaign-runs/:id/cancel` | POST | authenticateToken | Cancel a campaign | Working | Not directly called |

### Submissions

| Route | Method | Handler | Purpose | Status | Frontend Caller |
|-------|--------|---------|---------|--------|-----------------|
| `/submissions` | GET | authenticateToken | Get user's submissions (legacy, order-based) | Working | Not commonly used |
| `/campaign-submissions` | GET | authenticateToken | Get campaign submissions (current) | Working | `dashboard.js:2770`, `start-submissions.js:293` |
| `/submissions/counts` | GET | authenticateToken | Get submission counts by status | Working | `dashboard.js:2547`, `start-submissions.js:45,294` |
| `/submission-progress` | GET | authenticateToken | Get submission progress stats | Working | `dashboard.js:2468,2500` |

### Directories

| Route | Method | Handler | Purpose | Status | Frontend Caller |
|-------|--------|---------|---------|--------|-----------------|
| `/directories` | GET | authenticateToken | Get available directories for preview | Working | Not directly called |
| `/directories/count` | GET | authenticateToken | Get count of eligible directories | Working | Not directly called |

### Credentials (Security Hardened)

| Route | Method | Handler | Purpose | Status | Frontend Caller |
|-------|--------|---------|---------|--------|-----------------|
| `/credentials` | GET | authenticateToken + rateLimit | Get stored credentials (masked) | Working | `dashboard.js:2819` |
| `/credentials/:id/handoff` | POST | authenticateToken + rateLimit | Request credential handoff | Working | `dashboard.js:3194` |
| `/credentials/:id/password` | GET | authenticateToken | Get password (DISABLED - 503) | Disabled | `dashboard.js:3134` |

### Stats & Reminders

| Route | Method | Handler | Purpose | Status | Frontend Caller |
|-------|--------|---------|---------|--------|-----------------|
| `/stats` | GET | authenticateToken | Get citation network stats for dashboard | Working | `dashboard.js:2535` |
| `/action-reminders` | GET | authenticateToken | Get submissions needing action | Working | Not directly called |

---

## Webhook Handler

**File:** `backend/services/citationNetworkWebhookHandler.js`
**Integration:** `backend/routes/stripe-webhook.js` (line 52-56)

Handles Stripe webhook events for one-time payments (directory packs).

---

## Rate Limiters

| Limiter | Window | Max Requests | Applied To |
|---------|--------|--------------|------------|
| `credentialRateLimiter` | 15 minutes | 30 | `/credentials` GET |
| `handoffRateLimiter` | 1 hour | 10 | `/credentials/:id/handoff` |

---

## Error Codes (Start Submissions)

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `PROFILE_REQUIRED` | 400 | No business profile exists |
| `PROFILE_INCOMPLETE` | 400 | Profile missing required fields |
| `ACTIVE_CAMPAIGN_EXISTS` | 400 | User already has an active campaign |
| `NO_ENTITLEMENT` | 400 | No remaining directory submissions |
| `NO_ELIGIBLE_DIRECTORIES` | 400 | Entitlement OK but no directories match filters |
| `DIRECTORIES_NOT_SEEDED` | 503 | No directories in database |

---

## Frontend Files Using Citation Network

| File | Usage |
|------|-------|
| `frontend/dashboard.js` | Main dashboard with Citation Network section |
| `frontend/js/start-submissions.js` | Start Submissions modal/flow |
| `frontend/citation-network.html` | Sales/checkout page |
| `frontend/citation-network-success.html` | Post-purchase success page |
