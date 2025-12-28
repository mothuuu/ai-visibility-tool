# Phase 0: Pack Purchase & Entitlement Flow Audit

## Overview

This document traces the complete purchase-to-entitlement flow for AI Citation Network directory packs.

---

## Products & Pricing

| Product | Price | Directories | Target User |
|---------|-------|-------------|-------------|
| Starter | $249 | 100 | Non-subscribers, first purchase |
| Pack | $99 | 100 | Subscribers OR returning buyers |

---

## Stripe Configuration

**Location:** `backend/config/citationNetwork.js`

```javascript
prices: {
  STARTER_249: process.env.STRIPE_PRICE_SPRINT_249,  // Note: env var is "SPRINT" not "STARTER"
  PACK_99: process.env.STRIPE_PRICE_PACK_99
}
```

**Environment Variables Required:**
```bash
STRIPE_SECRET_KEY=sk_...
STRIPE_PRICE_SPRINT_249=price_...  # $249 product
STRIPE_PRICE_PACK_99=price_...     # $99 product
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## Purchase Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. CHECKOUT INFO                                                         │
│    GET /api/citation-network/checkout-info                              │
│    Returns: { product, price, canPurchase, reason }                     │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. CREATE CHECKOUT                                                       │
│    POST /api/citation-network/checkout                                  │
│    Body: { email? } (for guest checkout)                                │
│    Returns: { sessionId, url, orderId, orderType, amount }              │
│                                                                          │
│    Actions:                                                              │
│    - Creates directory_orders record (status: 'pending')                │
│    - Creates Stripe checkout session                                    │
│    - Updates order with session ID                                      │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. STRIPE CHECKOUT (External)                                           │
│    User completes payment on Stripe hosted checkout                     │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. WEBHOOK: checkout.session.completed                                   │
│    POST /api/stripe/webhook → handleCitationNetworkWebhook()            │
│                                                                          │
│    Actions:                                                              │
│    a. Update order status: 'pending' → 'paid' → 'processing'            │
│    b. For guests: Create user account from email                        │
│    c. For packs (subscribers): Add to pack_allocation                   │
│    d. Set delivery_started_at = NOW()                                   │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. ENTITLEMENT CALCULATION                                               │
│    Called when user tries to start submissions                          │
│    entitlementService.calculateEntitlement(userId)                      │
│                                                                          │
│    Sources checked:                                                      │
│    1. Subscription: subscriber_directory_allocations (monthly)          │
│    2. Orders: directory_orders WHERE status IN ('paid','processing',    │
│               'in_progress') - sum of directories_allocated - submitted │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### 1. GET /checkout-info

**Purpose:** Determine which product user should see

**Response:**
```json
{
  "product": "starter" | "pack",
  "price": 249 | 99,
  "priceId": "price_...",
  "description": "Get listed on 100+ directories",
  "canPurchase": true,
  "reason": null,
  "isSubscriber": false,
  "hasProfile": false
}
```

**Business Logic:**
- Non-subscriber without prior purchase → starter ($249)
- Subscriber → pack ($99)
- Non-subscriber with prior starter → pack ($99)

### 2. POST /checkout

**Purpose:** Create Stripe checkout session

**Request:**
```json
{
  "email": "user@example.com"  // Required for guest checkout
}
```

**Response:**
```json
{
  "sessionId": "cs_...",
  "url": "https://checkout.stripe.com/...",
  "orderId": "uuid",
  "orderType": "starter" | "pack",
  "amount": 249 | 99
}
```

### 3. Webhook: checkout.session.completed

**Metadata expected:**
```json
{
  "order_id": "uuid",
  "user_id": "123" | "guest",
  "order_type": "starter" | "pack",
  "directories": "100",
  "product": "citation_network"
}
```

---

## Order Status Transitions

```
pending → paid → processing → in_progress → completed
                           ↘ cancelled (on timeout/refund)
```

| Status | Meaning |
|--------|---------|
| `pending` | Checkout created, awaiting payment |
| `paid` | Payment confirmed via webhook |
| `processing` | Ready for submissions to be started |
| `in_progress` | Submissions have been queued |
| `completed` | All directories processed |
| `cancelled` | Checkout expired or refunded |
| `refunded` | Payment refunded |

---

## Entitlement Calculation

**Location:** `backend/services/entitlementService.js`

### For Subscribers

```javascript
// Monthly allocation from subscriber_directory_allocations
SELECT * FROM subscriber_directory_allocations
WHERE user_id = $1
  AND period_start <= DATE_TRUNC('month', NOW())::date
  AND period_end >= DATE_TRUNC('month', NOW())::date

// Entitlement = base_allocation + pack_allocation - submissions_used
```

### For Non-Subscribers (Order-based)

```javascript
// Sum from directory_orders
SELECT
  COALESCE(SUM(directories_allocated), 0) as total_allocated,
  COALESCE(SUM(directories_submitted), 0) as total_submitted
FROM directory_orders
WHERE user_id = $1
  AND status IN ('paid', 'processing', 'in_progress')

// Entitlement = total_allocated - total_submitted
```

---

## Pack Limits

| User Type | Limit | Scope |
|-----------|-------|-------|
| Subscriber | 2 packs | Per calendar year |
| Non-subscriber | 2 packs | Total (as add-ons to starter) |

---

## Database Tables

### directory_orders

```sql
CREATE TABLE directory_orders (
  id UUID PRIMARY KEY,
  user_id INTEGER,
  business_profile_id UUID,
  order_type VARCHAR(50),  -- 'starter' or 'pack'
  stripe_checkout_session_id VARCHAR(255),
  stripe_payment_intent_id VARCHAR(255),
  stripe_price_id VARCHAR(255),
  amount_cents INTEGER,
  currency VARCHAR(3) DEFAULT 'usd',
  directories_allocated INTEGER DEFAULT 100,
  directories_submitted INTEGER DEFAULT 0,
  directories_live INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  delivery_started_at TIMESTAMP,
  delivery_completed_at TIMESTAMP,
  created_at TIMESTAMP,
  paid_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### subscriber_directory_allocations

```sql
CREATE TABLE subscriber_directory_allocations (
  id UUID PRIMARY KEY,
  user_id INTEGER,
  period_start DATE,
  period_end DATE,
  base_allocation INTEGER,  -- From plan: 10/25/100
  pack_allocation INTEGER DEFAULT 0,  -- From $99 packs
  submissions_used INTEGER DEFAULT 0,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE (user_id, period_start)
);
```

---

## Verification Queries

```sql
-- Check order statuses used
SELECT status, order_type, COUNT(*)
FROM directory_orders
GROUP BY status, order_type
ORDER BY status;

-- Check entitlement for a user
SELECT
  u.id,
  u.email,
  u.plan,
  do.order_type,
  do.status as order_status,
  do.directories_allocated,
  do.directories_submitted,
  sda.base_allocation,
  sda.pack_allocation,
  sda.submissions_used
FROM users u
LEFT JOIN directory_orders do ON u.id = do.user_id
LEFT JOIN subscriber_directory_allocations sda ON u.id = sda.user_id
  AND sda.period_start <= CURRENT_DATE
  AND sda.period_end >= CURRENT_DATE
WHERE u.id = ?;
```

---

## Known Issues

### 1. Environment Variable Naming
The env var is `STRIPE_PRICE_SPRINT_249` but the product is called "Starter". This could cause confusion.

### 2. Guest Checkout Account Creation
When a guest completes checkout:
- User is created with `email_verified = false`
- Password is set to a random hash (unusable)
- TODO comment exists for "send welcome email with password setup link"
- **This email is NOT being sent**

### 3. Webhook Idempotency
No explicit idempotency check. If webhook is received twice, `paid_at` would be overwritten but status transitions should be safe due to WHERE clause.

### 4. Missing Webhook Events
Only handling:
- `checkout.session.completed`
- `checkout.session.expired`

Missing (should consider adding):
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
