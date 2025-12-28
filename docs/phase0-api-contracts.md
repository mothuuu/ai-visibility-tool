# Phase 0: API Response Contracts

## Overview

This document defines the exact request/response shapes for all Citation Network API endpoints to prevent frontend/backend mismatches.

---

## Endpoint Contracts

### GET /api/citation-network/checkout-info

**Request:** None (uses auth token)

**Response:**
```json
{
  "product": "starter" | "pack",
  "price": 249 | 99,
  "priceId": "price_...",
  "description": "Get listed on 100+ directories" | "Add 100 more directories",
  "canPurchase": true,
  "reason": null | "Maximum 2 packs per year reached" | "Complete your business profile first",
  "isSubscriber": false,
  "hasProfile": false
}
```

---

### POST /api/citation-network/checkout

**Request:**
```json
{
  "email": "user@example.com"  // Required if not authenticated
}
```

**Response (Success):**
```json
{
  "sessionId": "cs_...",
  "url": "https://checkout.stripe.com/...",
  "orderId": "uuid",
  "orderType": "starter" | "pack",
  "amount": 249 | 99
}
```

**Response (Error):**
```json
{
  "error": "Please complete your business profile first",
  "code": "PROFILE_REQUIRED",
  "redirect": "/dashboard.html?tab=citation-network&action=profile"
}
```

---

### GET /api/citation-network/orders

**Response:**
```json
{
  "orders": [
    {
      "id": "uuid",
      "user_id": 123,
      "order_type": "starter" | "pack",
      "amount_cents": 24900 | 9900,
      "directories_allocated": 100,
      "directories_submitted": 0,
      "directories_live": 0,
      "status": "pending" | "paid" | "processing" | "in_progress" | "completed",
      "created_at": "2025-01-01T00:00:00Z",
      "paid_at": "2025-01-01T00:00:00Z",
      "submissions_count": 100,
      "live_count": 50
    }
  ]
}
```

---

### GET /api/citation-network/allocation

**Response (Subscriber):**
```json
{
  "type": "subscription",
  "plan": "diy" | "pro" | "enterprise" | "agency",
  "allocation": {
    "base": 10 | 25 | 100,
    "packs": 0,
    "total": 10,
    "used": 5,
    "remaining": 5
  },
  "debug": {
    "source": "subscription",
    "isSubscriber": true,
    "breakdown": { ... }
  }
}
```

**Response (Non-Subscriber):**
```json
{
  "type": "order_based",
  "allocation": {
    "total": 100,
    "submitted": 50,
    "live": 25,
    "remaining": 50
  },
  "debug": {
    "source": "orders",
    "isSubscriber": false,
    "breakdown": { ... }
  }
}
```

---

### GET /api/citation-network/profile

**Response (No Profile):**
```json
{
  "profile": null,
  "hasProfile": false
}
```

**Response (Has Profile):**
```json
{
  "profile": {
    "id": "uuid",
    "user_id": 123,
    "business_name": "Acme Corp",
    "website_url": "https://example.com",
    "phone": "+1-555-1234",
    "email": "hello@example.com",
    "address_line1": "123 Main St",
    "city": "Toronto",
    "state": "ON",
    "postal_code": "M5V 1A1",
    "country": "Canada",
    "business_description": "...",
    "short_description": "...",
    "primary_category": "Technology",
    "secondary_categories": ["SaaS", "AI"],
    "social_links": { "linkedin": "...", "twitter": "..." },
    "logo_url": "https://...",
    "is_complete": true,
    "completion_percentage": 85,
    "created_at": "2025-01-01T00:00:00Z",
    "updated_at": "2025-01-01T00:00:00Z"
  },
  "hasProfile": true,
  "isComplete": true,
  "completionPercentage": 85
}
```

---

### POST /api/citation-network/profile

**Request:**
```json
{
  "business_name": "Acme Corp",
  "website_url": "https://example.com",
  "phone": "+1-555-1234",
  "email": "hello@example.com",
  "address_line1": "123 Main St",
  "city": "Toronto",
  "state": "ON",
  "postal_code": "M5V 1A1",
  "country": "Canada",
  "business_description": "...",
  "short_description": "...",
  "primary_category": "Technology",
  "secondary_categories": ["SaaS", "AI"],
  "social_links": { "linkedin": "...", "twitter": "..." },
  "logo_url": "https://..."
}
```

**Response:**
```json
{
  "success": true,
  "profile": { ... },
  "isComplete": true,
  "completionPercentage": 85
}
```

---

### POST /api/citation-network/start-submissions

**Request:**
```json
{
  "filters": {
    "tiers": [1, 2, 3],
    "regions": ["global", "us"],
    "types": ["ai_tools", "saas_review"],
    "allowPhoneOnListings": true,
    "allowPhoneVerification": false
  }
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Started submissions for 25 directories",
  "campaignRunId": "uuid",
  "directoriesQueued": 25,
  "entitlementRemaining": 75,
  "entitlementSource": "subscription"
}
```

⚠️ **IMPORTANT:** Frontend expects `directoriesQueued` (camelCase). Some older code may return `directories_queued` (snake_case).

**Response (Error):**
```json
{
  "error": "Please complete your business profile before starting submissions",
  "code": "PROFILE_INCOMPLETE",
  "entitlement": {
    "isSubscriber": true,
    "total": 25,
    "used": 0,
    "remaining": 25,
    "source": "subscription"
  }
}
```

**Error Codes:**
| Code | HTTP | Description |
|------|------|-------------|
| `PROFILE_REQUIRED` | 400 | No business profile exists |
| `PROFILE_INCOMPLETE` | 400 | Profile missing required fields |
| `ACTIVE_CAMPAIGN_EXISTS` | 400 | Already have active campaign |
| `NO_ENTITLEMENT` | 400 | No remaining submissions |
| `NO_ELIGIBLE_DIRECTORIES` | 400 | No directories match filters |
| `DIRECTORIES_NOT_SEEDED` | 503 | No directories in database |

---

### GET /api/citation-network/campaign-submissions

**Request Query:**
```
?status=queued,in_progress&limit=50&offset=0
```

**Response:**
```json
{
  "submissions": [
    {
      "id": "uuid",
      "user_id": 123,
      "directory_id": 1,
      "campaign_run_id": "uuid",
      "directory_name": "G2",
      "directory_url": "https://g2.com",
      "directory_snapshot": { "name": "G2", "logo_url": "..." },
      "status": "queued" | "in_progress" | "action_needed" | "submitted" | "live",
      "action_type": "manual_submission",
      "action_instructions": "Please submit manually at...",
      "action_url": "https://g2.com/submit",
      "action_deadline": "2025-01-15T00:00:00Z",
      "queue_position": 1,
      "created_at": "2025-01-01T00:00:00Z",
      "updated_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

---

### GET /api/citation-network/submissions/counts

**Response:**
```json
{
  "counts": {
    "total": 100,
    "queued": 50,
    "inProgress": 10,
    "submitted": 20,
    "live": 15,
    "actionNeeded": 5,
    "rejected": 0
  }
}
```

⚠️ **Note:** Response uses camelCase (`actionNeeded`, `inProgress`) not snake_case.

---

### GET /api/citation-network/active-campaign

**Response (No Active):**
```json
{
  "hasActiveCampaign": false,
  "activeCampaign": null
}
```

**Response (Has Active):**
```json
{
  "hasActiveCampaign": true,
  "activeCampaign": {
    "id": "uuid",
    "status": "queued" | "in_progress",
    "directories_selected": 25,
    "directories_queued": 20,
    "directories_submitted": 5,
    "directories_live": 0,
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```

---

### GET /api/citation-network/entitlement

**Response:**
```json
{
  "entitlement": {
    "total": 25,
    "used": 10,
    "remaining": 15,
    "source": "subscription" | "orders",
    "isSubscriber": true,
    "plan": "pro",
    "breakdown": {
      "subscription": 25,
      "orders": 0,
      "ordersUsed": 0,
      "ordersRemaining": 0
    }
  }
}
```

---

### GET /api/citation-network/stats

**Response:**
```json
{
  "orders": 2,
  "directories": {
    "allocated": 200,
    "submitted": 150,
    "live": 75
  },
  "profile": {
    "hasProfile": true,
    "isComplete": true,
    "completionPercentage": 85
  }
}
```

---

### GET /api/citation-network/credentials

**Response:**
```json
{
  "credentials": [
    {
      "id": "uuid",
      "directoryId": 1,
      "directoryName": "G2",
      "directoryLogo": "https://...",
      "emailMasked": "u***@example.com",
      "usernameMasked": "u***123",
      "hasPassword": true,
      "createdAt": "2025-01-01T00:00:00Z",
      "lastLoginAt": "2025-01-01T00:00:00Z",
      "status": "active",
      "handoffStatus": "none" | "requested" | "completed",
      "handedOffAt": null,
      "handoffReason": null
    }
  ],
  "_security": "Passwords and secrets are never transmitted. Use handoff to request access."
}
```

---

### POST /api/citation-network/credentials/:id/handoff

**Request:**
```json
{
  "reason": "Need to update listing information"
}
```

**Response:**
```json
{
  "success": true,
  "status": "requested",
  "message": "Handoff request submitted. You will receive access credentials shortly."
}
```

---

### GET /api/citation-network/action-reminders

**Response:**
```json
{
  "reminders": [
    {
      "id": "uuid",
      "directoryName": "G2",
      "directoryLogo": "https://...",
      "status": "action_needed",
      "actionType": "manual_submission",
      "actionInstructions": "Please submit manually...",
      "actionRequiredAt": "2025-01-01T00:00:00Z",
      "deadline": "2025-01-15T00:00:00Z",
      "daysRemaining": 5,
      "urgency": "critical" | "high" | "medium" | "low"
    }
  ],
  "summary": {
    "total": 10,
    "critical": 2,
    "high": 3
  }
}
```

---

## Common Response Patterns

### Error Response
```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE"
}
```

### Success with Data
```json
{
  "success": true,
  "data": { ... }
}
```

### Paginated List
```json
{
  "items": [ ... ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

---

## Known Mismatches (Fixed/To Fix)

| Issue | Backend Returns | Frontend Expects | Status |
|-------|-----------------|------------------|--------|
| Status value | `action_needed` | `needs_action` | Fixed (frontend handles both) |
| Start submissions | `directoriesQueued` | `directoriesQueued` | OK |
| Counts | `actionNeeded` | `actionNeeded` | OK |
