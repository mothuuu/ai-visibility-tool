# Tier 0 Critical Implementation Details

This document captures critical implementation details discovered during the Phase 1-3 foundation work.

---

## T0-1: Stripe Webhook Raw Body (FIXED)

**Problem:** Stripe signature verification fails if `express.json()` middleware parses the request body before the webhook handler.

**Solution Implemented:**

1. **`server.js`** - Webhook routes mounted BEFORE body parsing:
   ```javascript
   // CRITICAL: Mount BEFORE express.json()
   app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);
   app.post('/api/subscription/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

   // Body parsing AFTER webhook routes
   app.use(express.json({ limit: '10mb' }));
   ```

2. **`routes/stripe-webhook.js`** - Exports handler function directly (not a router).

**Commit:** `916f1fa`

---

## T0-2: Migration Mechanism Detection (DOCUMENTED)

**Finding:** Two migration patterns exist in this codebase:

### Pattern 1: SQL Files (Recommended for new migrations)
- **Location:** `backend/migrations/*.sql`
- **Runner:** `node migrations/run-migration.js migrations/<filename>.sql`
- **Naming:** `snake_case_description.sql`
- **Example:** `fix_entitlement_system.sql`

### Pattern 2: JavaScript Files (Legacy)
- **Location:** `backend/db/migrate-*.js`
- **Runner:** `node db/migrate-<name>.js`
- **Usage:** For complex migrations requiring programmatic logic

**New migrations MUST use the SQL file pattern to maintain consistency.**

---

## T0-3: Database Type Detection (VERIFIED)

**Finding:** `users.id` is `SERIAL PRIMARY KEY` (INTEGER)

**From `backend/db/setup.js`:**
```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  ...
);
```

### Foreign Key Requirements

All new tables with `user_id` foreign keys MUST use:
```sql
user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
```

**DO NOT use:**
- `BIGINT` for user_id (type mismatch)
- `UUID` for user_id (type mismatch)

**Verified existing tables use `INTEGER` consistently:**
- `directory_orders.user_id INTEGER`
- `directory_submissions.user_id INTEGER`
- `campaign_runs.user_id INTEGER`
- `subscriber_directory_allocations.user_id INTEGER`
- `credential_vault.user_id INTEGER`

---

## T0-4: User ID Type Safety (VERIFIED SAFE)

**Finding:** No `parseInt(user_id)` patterns exist for Stripe metadata.

**Current correct implementation in `citationNetworkStripeService.js`:**
```javascript
// When storing in Stripe metadata - convert to string
metadata: { user_id: userId ? userId.toString() : 'guest' }

// When passing to database - pass directly (PostgreSQL handles coercion)
await db.query('INSERT INTO ... VALUES ($1, ...)', [userId]);
```

**Current correct implementation in `citationNetworkWebhookHandler.js`:**
```javascript
// User ID comes from database record, not from Stripe metadata
let userId = order.user_id;
```

**Pattern to follow:**
```javascript
// CORRECT - works for INTEGER, BIGINT, and UUID:
const dbUserId = user_id; // Pass as-is, PostgreSQL coerces

// WRONG - breaks for UUID:
const dbUserId = parseInt(user_id);
```

---

## T0-5: Plan Normalization + Subscriber Eligibility (FIXED)

**Problem:** Plan casing mismatch + "null status treated as subscriber" = zero entitlement for paying users.

**Solution in `backend/config/citationNetwork.js`:**
```javascript
const ALLOWED_STRIPE_STATUSES = ['active', 'trialing'];

function isActiveSubscriber(user) {
  const planNormalized = normalizePlan(user.plan);

  // Manual override for enterprise deals
  if (user.subscription_manual_override === true) {
    return SUBSCRIBER_PLANS.includes(planNormalized);
  }

  // MUST have explicit active status - null/undefined NOT valid
  const stripeStatus = (user.stripe_subscription_status || '').toLowerCase().trim();
  return SUBSCRIBER_PLANS.includes(planNormalized) &&
         ALLOWED_STRIPE_STATUSES.includes(stripeStatus);
}
```

**Commit:** `73d5c25`

---

## T0-6: Monthly Allocation Correctness (FIXED)

**Problem:** Wrong `period_start` type or missing constraint = duplicate/missing allocations.

**Solution in `entitlementService.js`:**
```javascript
async getOrCreateMonthlyAllocationWithClient(client, userId, plan) {
  return client.query(`
    INSERT INTO subscriber_directory_allocations (...)
    VALUES ($1, DATE_TRUNC('month', NOW())::date, ...)
    ON CONFLICT (user_id, period_start) DO UPDATE SET ...
    RETURNING *
  `, [userId, baseAllocation]);
}
```

**Key:** Use `DATE_TRUNC('month', NOW())::date` instead of JS date strings.

**Commit:** `c9790ce`

---

## T0-7: Transactional Reservation with User Row Lock (FIXED)

**Problem:** Without user row lock, concurrent requests double-consume credits.

**Solution in `campaignRunService.js`:**
```javascript
async startSubmissions(userId, filters, options) {
  await client.query('BEGIN');

  // CRITICAL: Lock user row FIRST
  const userResult = await client.query(
    'SELECT * FROM users WHERE id = $1 FOR UPDATE',
    [userId]
  );

  // Check idempotency key
  if (idempotencyKey) { /* return existing if duplicate */ }

  // All entitlement ops use client-based methods
  const entitlement = await entitlementService.calculateEntitlementWithClient(client, ...);
  const consumeResult = await entitlementService.consumeEntitlementWithClient(client, ...);

  await client.query('COMMIT');
}
```

**Commit:** `c9790ce`

---

## T0-8: WithClient Functions Must Use Client Consistently (VERIFIED)

**Problem:** Functions internally calling `pool.query` break transaction isolation.

**Verification:** All `*WithClient` functions use `client.query`:

| Method | Lines | Uses `client.query` |
|--------|-------|---------------------|
| `getOrCreateMonthlyAllocationWithClient` | 436-481 | ✓ Line 452 |
| `calculateEntitlementWithClient` | 492-569 | ✓ Lines 517, 526 |
| `consumeEntitlementWithClient` | 580-645 | ✓ Lines 594, 609, 625 |

**Note:** The non-WithClient versions (e.g., `getMonthlyAllocation`) correctly use `db.query` for non-transactional use cases.

---

## T0-9: Atomic Webhook Idempotency (FIXED)

**Problem:** SELECT → INSERT race condition. Two concurrent webhooks both pass SELECT, causing double-processing.

**Solution in `backend/routes/stripe-webhook.js`:**
```javascript
async function stripeWebhookHandler(req, res) {
  // Verify signature first
  const event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);

  // T0-9: ATOMIC idempotency check - INSERT is the lock
  const eventLogResult = await db.query(`
    INSERT INTO stripe_events (event_id, event_type, ...)
    VALUES ($1, $2, ...)
    ON CONFLICT (event_id) DO NOTHING
    RETURNING id
  `, [event.id, event.type, ...]);

  // If nothing returned, this event was already processed
  if (eventLogResult.rows.length === 0) {
    return res.json({ received: true, duplicate: true });
  }

  const eventId = eventLogResult.rows[0].id;

  try {
    // Process event...
    await db.query('UPDATE stripe_events SET processed = TRUE WHERE id = $1', [eventId]);
    res.json({ received: true });
  } catch (error) {
    // T0-9: If processing fails, remove record so retry can work
    await db.query('DELETE FROM stripe_events WHERE id = $1', [eventId]);
    res.status(500).json({ error: 'Processing failed' });
  }
}
```

**Key:** INSERT is the lock. On failure, DELETE allows retry.

---

## T0-10: Only Grant Pack on Paid Status (FIXED)

**Problem:** `checkout.session.completed` doesn't guarantee payment succeeded.

**Solution in `backend/services/citationNetworkWebhookHandler.js`:**
```javascript
async function handlePaymentSuccess(orderId, session) {
  // T0-10: CRITICAL - Only grant entitlement if actually paid
  if (session.payment_status !== 'paid') {
    console.log(`Session ${session.id} not paid (status: ${session.payment_status}), skipping`);
    return;
  }

  // T0-10: Also verify it's a one-time payment (not subscription)
  if (session.mode !== 'payment') {
    console.log(`Session ${session.id} is not payment mode (mode: ${session.mode}), skipping`);
    return;
  }

  // Now safe to grant entitlement...
}
```

**Key:** Check `payment_status === 'paid'` AND `mode === 'payment'` before granting.

---

## Quick Reference: Creating New Migrations

1. Create SQL file: `backend/migrations/my_migration_name.sql`
2. Use `IF NOT EXISTS` for idempotency
3. Use `INTEGER` for user_id foreign keys
4. Run: `node migrations/run-migration.js migrations/my_migration_name.sql`

Example template:
```sql
-- Migration: Description
-- Date: YYYY-MM-DD

-- Add column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'my_table' AND column_name = 'my_column'
  ) THEN
    ALTER TABLE my_table ADD COLUMN my_column INTEGER;
  END IF;
END $$;

-- Create table if not exists
CREATE TABLE IF NOT EXISTS my_new_table (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add index if not exists
CREATE INDEX IF NOT EXISTS idx_my_table_column ON my_table(my_column);
```
