# Phase 4A.3c.5 — Refill Active to Cap After Enrichment & Resolution

## Pool Verification

Run the pool check script to verify DB pool sizes:

```bash
node backend/scripts/check-rec-pool.js
```

### Case A: pool > cap (rec_count 15–30 per scan)
GET-time refill works from the existing DB pool. No changes needed.

### Case B: pool == cap (most scans only have 3/5/8 rows)
Refill cannot work. Raise `PERSIST_POOL_LIMIT` in `backend/config/planCaps.js`.

## Discovery Commands (use -E for alternation)

```bash
# Find persistence/insert points for scan_recommendations
grep -rEn "INSERT.*scan_recommendations|scan_recommendations.*INSERT|persist.*recommendation" backend/ --include="*.js" | head -80

# Find where recommendations are sliced/limited at write time
grep -rEn "slice\(|applyCap\(|recommendationLimit|PLAN_CAPS|PERSIST_POOL_LIMIT" backend/ --include="*.js" | head -120
```

## IMPORTANT — No Backfill

- Raising persistence (`PERSIST_POOL_LIMIT`) only affects NEW scans going forward.
- Existing scans already stored with pool == cap will continue to underfill active slots until rescanned.
- We will NOT backfill old scans (no migration script). Too risky for production data consistency.

## Debug Verification

Hit `/api/scan/<id>?debug=1` as admin to inspect refill meta:

- `_debug.refill.active_total` — total active candidates before cap
- `_debug.refill.active_returned` — active returned after cap
- `_debug.refill.implemented_count` — resolved items
- `_debug.active_titles` — first 10 active rec titles
- `_debug.implemented_titles` — first 10 implemented rec titles
