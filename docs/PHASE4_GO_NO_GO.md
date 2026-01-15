# Phase 4 Go/No-Go Checklist

A 5-minute pre-flight checklist to run before starting Phase 4 work.

## Quick Start (Render Shell)

```bash
# SSH into Render shell, then:
cd ~/project/src/backend

# Run the checklist (default org 110)
node scripts/phase4-go-no-go.js

# Or with specific org and verbose output
node scripts/phase4-go-no-go.js --org-id 110 --verbose

# With API checks (optional)
API_BASE=https://visible2ai.onrender.com node scripts/phase4-go-no-go.js
```

**Expected time:** 1-2 minutes

---

## What It Checks

| # | Check | Required | Description |
|---|-------|----------|-------------|
| 1 | Environment | ✅ | NODE_ENV, DATABASE_URL, USAGE_V2 flags |
| 2 | Migrations | ✅ | Phase 2.1 columns exist, schema_migrations tracked |
| 3 | Quota | ✅ | verify_quota_modes.js passes |
| 4 | Stripe | ✅ | No inconsistent active/trialing status |
| 5 | Database | ✅ | Org exists, usage_events present |
| 6 | API | ⚪ | API responds (optional, needs API_BASE) |

---

## Interpreting Results

### ✅ GO

```
✅ GO: All checks passed (safe to proceed to Phase 4)
```

You're ready to start Phase 4 work.

### ❌ NO-GO

```
❌ NO-GO: One or more checks failed
```

Review the failed checks and take action:

| Failure | Action |
|---------|--------|
| Phase 2.1 columns missing | Run migration: `psql $DATABASE_URL -f db/migrations/phase2/002_add_stripe_org_fields.sql` |
| Inconsistent Stripe state | Run reconciliation: `node scripts/reconcile-stripe-state.js --apply` |
| USAGE_V2 flags not set | Set env vars in Render dashboard |
| Org not found | Verify org ID exists in database |
| verify_quota_modes.js failed | Check quota logic and env vars |

---

## Command Reference

### Basic Run (Read-Only)
```bash
node scripts/phase4-go-no-go.js
```

### With Options
```bash
# Specific org
node scripts/phase4-go-no-go.js --org-id 110

# Verbose output
node scripts/phase4-go-no-go.js --verbose

# Skip certain checks
node scripts/phase4-go-no-go.js --skip-api
node scripts/phase4-go-no-go.js --skip-stripe
node scripts/phase4-go-no-go.js --skip-quota

# With API checks
API_BASE=https://visible2ai.onrender.com node scripts/phase4-go-no-go.js
```

### Exit Codes
- `0` = GO (all checks pass)
- `1` = NO-GO (one or more checks failed)

---

## Known Expected State

### User vs Organization Plan Difference

With org-first plan resolution (Phase 2.1), it's **expected** that:

- `organizations.plan` may differ from `users.plan`
- `organizations.plan_override` takes precedence when `plan_source='manual'`
- A user with `plan='free'` can still get `plan='pro'` entitlements if their org has `plan_override='pro'`

**Example (Org 110):**
```
organizations.id = 110
  plan = 'pro'
  plan_source = 'manual'
  plan_override = 'pro'

users.id = 4
  plan = 'free'              ← This is OK!
  organization_id = 110

Effective plan for user 4 = 'pro' (from org override)
```

This is correct behavior. The go/no-go script checks for this and marks it as expected.

---

## Pre-Phase 4 Checklist (Manual)

If you prefer manual checks:

### 1. Environment Variables
```bash
echo "NODE_ENV: $NODE_ENV"
echo "USAGE_V2_READ_ENABLED: $USAGE_V2_READ_ENABLED"
echo "USAGE_V2_DUAL_WRITE_ENABLED: $USAGE_V2_DUAL_WRITE_ENABLED"
```

Expected:
- `USAGE_V2_READ_ENABLED=true`
- `USAGE_V2_DUAL_WRITE_ENABLED=true`

### 2. Phase 2.1 Columns
```bash
psql "$DATABASE_URL" -c "\d organizations" | grep -E "plan_source|plan_override|stripe_price_id"
```

Expected: All columns present.

### 3. Org 110 State
```bash
psql "$DATABASE_URL" -c "
  SELECT id, name, plan, plan_source, plan_override,
         stripe_subscription_status
  FROM organizations WHERE id = 110
"
```

Expected:
- `plan_source = 'manual'`
- `plan_override = 'pro'`

### 4. Stripe State
```bash
psql "$DATABASE_URL" -c "
  SELECT COUNT(*) FROM organizations
  WHERE stripe_subscription_status IN ('active', 'trialing')
    AND (plan_source IS DISTINCT FROM 'manual' AND plan_override IS NULL)
    AND (stripe_subscription_id IS NULL OR stripe_price_id IS NULL)
"
```

Expected: `0`

### 5. Usage Events
```bash
psql "$DATABASE_URL" -c "
  SELECT event_type, COUNT(*)
  FROM usage_events
  WHERE organization_id = 110
    AND created_at >= date_trunc('month', NOW())
  GROUP BY event_type
"
```

Expected: Some rows (or 0 if no recent scans).

---

## Troubleshooting

### "psql: command not found"
Use the Render shell (not local terminal). Render includes psql.

### "DATABASE_URL not set"
In Render shell, it should be auto-set. If not:
```bash
export DATABASE_URL=$(printenv DATABASE_URL || echo "missing")
```

### "Phase 2.1 columns missing"
Run the migration:
```bash
psql "$DATABASE_URL" -f db/migrations/phase2/002_add_stripe_org_fields.sql
```

### "Inconsistent Stripe state"
Run reconciliation:
```bash
node scripts/reconcile-stripe-state.js --dry-run   # Preview
node scripts/reconcile-stripe-state.js --apply     # Fix
```

### "verify_quota_modes.js failed"
Check the script output:
```bash
node scripts/verify_quota_modes.js
```

---

## Related Scripts

| Script | Purpose |
|--------|---------|
| `scripts/phase4-go-no-go.js` | This checklist |
| `scripts/reconcile-stripe-state.js` | Fix Stripe inconsistencies |
| `scripts/verify_quota_modes.js` | Verify quota mode resolution |
| `scripts/sql/stripe-state-report.sql` | Detailed Stripe state report |
| `scripts/sql/stripe-state-verify.sql` | Post-reconciliation verification |

---

## Version History

| Date | Version | Notes |
|------|---------|-------|
| 2026-01-15 | 1.0 | Initial Phase 4 go/no-go checklist |
