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
