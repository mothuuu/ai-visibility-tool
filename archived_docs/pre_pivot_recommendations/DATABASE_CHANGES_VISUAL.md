> ⚠️ **ARCHIVED (Pre-Pivot)** — This document describes the old recommendation lifecycle system that was removed in Phase 1. It does not reflect the current production architecture. For current documentation, see DOCS_INDEX.md at repo root.

---

# Database Schema Changes - Visual Guide

**Comparison of Current vs. Proposed Schemas**

---

## Current Database Schema (Relevant Tables)

```
┌─────────────────────────────────────────────────┐
│ scans                                           │
├─────────────────────────────────────────────────┤
│ • id (PK)                                       │
│ • user_id (FK → users)                          │
│ • url                                           │
│ • status                                        │
│ • total_score                                   │
│ • ai_readability_score                          │
│ • ai_search_readiness_score                     │
│ • content_freshness_score                       │
│ • content_structure_score                       │
│ • speed_ux_score                                │
│ • technical_setup_score                         │
│ • trust_authority_score                         │
│ • voice_optimization_score                      │
│ • created_at                                    │
│ • completed_at                                  │
│ • updated_at                                    │
└─────────────────────────────────────────────────┘
         │
         │ 1:N
         ↓
┌─────────────────────────────────────────────────┐
│ scan_recommendations                            │
├─────────────────────────────────────────────────┤
│ • id (PK)                                       │
│ • scan_id (FK → scans)                          │
│ • category                                      │
│ • recommendation_text                           │
│ • recommendation_type (site-wide/page-specific) │
│ • page_url                                      │
│ • priority                                      │
│ • estimated_impact                              │
│ • estimated_effort                              │
│ • unlock_state (locked/active/completed)        │
│ • batch_number                                  │
│ • unlocked_at                                   │
│ • marked_complete_at                            │
│ • verified_at                                   │
│ • created_at                                    │
│ • updated_at                                    │
└─────────────────────────────────────────────────┘
```

**Current Limitations:**
- ❌ No link between scans of same domain
- ❌ No way to compare recommendations across scans
- ❌ No historical tracking
- ❌ Can't identify "same recommendation" in multiple scans

---

## Option B: Lightweight Changes (RECOMMENDED)

**Changes shown in 🟦 BLUE**

```
┌─────────────────────────────────────────────────┐
│ scans                                           │
├─────────────────────────────────────────────────┤
│ • id (PK)                                       │
│ • user_id (FK → users)                          │
│ • url                                           │
│ 🟦 domain (NEW - extracted root domain)         │
│ 🟦 previous_scan_id (NEW - FK → scans.id)       │
│ 🟦 comparison_data (NEW - JSONB)                │
│ • status                                        │
│ • total_score                                   │
│ • [all 8 category scores]                       │
│ • created_at                                    │
│ • completed_at                                  │
│ • updated_at                                    │
└─────────────────────────────────────────────────┘
         │
         │ 1:N
         ↓
┌─────────────────────────────────────────────────┐
│ scan_recommendations                            │
├─────────────────────────────────────────────────┤
│ • id (PK)                                       │
│ • scan_id (FK → scans)                          │
│ • category                                      │
│ • recommendation_text                           │
│ • recommendation_type                           │
│ • page_url                                      │
│ • priority                                      │
│ 🟦 comparison_status (NEW - 'new'/'similar'/NULL)│
│ • estimated_impact                              │
│ • estimated_effort                              │
│ • unlock_state                                  │
│ • batch_number                                  │
│ • unlocked_at                                   │
│ • marked_complete_at                            │
│ • verified_at                                   │
│ • created_at                                    │
│ • updated_at                                    │
└─────────────────────────────────────────────────┘
```

**Migration SQL:**
```sql
-- Lightweight migration (3 columns, 2 indexes)
ALTER TABLE scans
ADD COLUMN domain VARCHAR(255),
ADD COLUMN previous_scan_id INTEGER REFERENCES scans(id),
ADD COLUMN comparison_data JSONB;

ALTER TABLE scan_recommendations
ADD COLUMN comparison_status VARCHAR(20);

CREATE INDEX idx_scans_domain ON scans(user_id, domain);
CREATE INDEX idx_scans_previous ON scans(previous_scan_id);
```

**What `comparison_data` JSONB contains:**
```json
{
  "previous_scan_id": 12340,
  "days_between": 14,
  "score_change": 8.5,
  "categories": {
    "ai_readability": { "old": 65, "new": 70, "change": +5 },
    "ai_search_readiness": { "old": 72, "new": 78, "change": +6 },
    "speed_ux": { "old": 82, "new": 75, "change": -7 }
  },
  "summary": {
    "categories_improved": 5,
    "categories_declined": 2,
    "categories_unchanged": 1
  }
}
```

**Impact:**
- ✅ Minimal schema changes (4 columns total)
- ✅ No new tables
- ✅ Backward compatible
- ✅ Migration time: < 1 minute
- ✅ Zero downtime

---

## Option A: Full Historical Tracking System

**Changes shown in 🟦 BLUE, New tables in 🟩 GREEN**

```
┌─────────────────────────────────────────────────┐
│ scans                                           │
├─────────────────────────────────────────────────┤
│ • id (PK)                                       │
│ • user_id (FK → users)                          │
│ • url                                           │
│ 🟦 domain (NEW)                                 │
│ 🟦 previous_scan_id (NEW - FK → scans)          │
│ 🟦 has_comparison (NEW)                         │
│ 🟦 comparison_id (NEW - FK → scan_comparisons)  │
│ • status                                        │
│ • total_score                                   │
│ • [all 8 category scores]                       │
│ • created_at, completed_at, updated_at          │
└─────────────────────────────────────────────────┘
         │                            │
         │ 1:N                        │ 1:1
         ↓                            ↓
┌──────────────────────┐    ┌────────────────────────┐
│ scan_recommendations │    │ 🟩 scan_comparisons   │
├──────────────────────┤    │ (NEW TABLE)           │
│ • id (PK)            │    ├────────────────────────┤
│ • scan_id (FK)       │    │ • id (PK)             │
│ • category           │    │ • previous_scan_id    │
│ • recommendation_text│    │ • current_scan_id     │
│ 🟦 recommendation_    │    │ • user_id             │
│   fingerprint (NEW)  │    │ • domain              │
│ 🟦 history_id (NEW)  │────│ • recs_resolved       │
│ 🟦 comparison_status │    │ • recs_persisting     │
│ 🟦 previous_detection│    │ • recs_new            │
│   _count (NEW)       │    │ • score_change        │
│ 🟦 first_detected_at │    │ • category_changes    │
│ • priority           │    │ • days_between_scans  │
│ • unlock_state       │    │ • comparison_data     │
│ • batch_number       │    │ • created_at          │
│ • timestamps...      │    └────────────────────────┘
└──────────────────────┘
         │
         │ N:1
         ↓
┌──────────────────────────────────────────────────┐
│ 🟩 recommendation_history (NEW TABLE)           │
├──────────────────────────────────────────────────┤
│ • id (PK)                                        │
│ • user_id (FK → users)                           │
│ • domain                                         │
│ • recommendation_fingerprint (MD5 hash)          │
│ • category                                       │
│ • recommendation_text (snapshot)                 │
│ • recommendation_type                            │
│ • page_url                                       │
│ • priority                                       │
│ • first_detected_scan_id (FK → scans)            │
│ • first_detected_at                              │
│ • last_detected_scan_id (FK → scans)             │
│ • last_detected_at                               │
│ • resolution_scan_id (FK → scans)                │
│ • resolved_at                                    │
│ • current_status (active/resolved/recurring)     │
│ • times_detected                                 │
│ • total_scans_in_period                          │
│ • user_marked_complete                           │
│ • user_marked_complete_at                        │
│ • user_marked_complete_scan_id                   │
│ • created_at                                     │
│ • updated_at                                     │
│ • UNIQUE(user_id, domain, fingerprint)           │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│ 🟩 domain_tracking (NEW TABLE)                  │
├──────────────────────────────────────────────────┤
│ • id (PK)                                        │
│ • user_id (FK → users)                           │
│ • domain                                         │
│ • first_scan_id (FK → scans)                     │
│ • first_scan_at                                  │
│ • latest_scan_id (FK → scans)                    │
│ • latest_scan_at                                 │
│ • total_scans                                    │
│ • total_recommendations_ever                     │
│ • total_recommendations_resolved                 │
│ • avg_resolution_time_days                       │
│ • is_primary_domain                              │
│ • created_at                                     │
│ • updated_at                                     │
│ • UNIQUE(user_id, domain)                        │
└──────────────────────────────────────────────────┘
```

**Migration SQL:**
```sql
-- Full system migration (3 new tables, 9 new columns, 10+ indexes)

-- Modify existing tables
ALTER TABLE scans
ADD COLUMN domain VARCHAR(255),
ADD COLUMN previous_scan_id INTEGER REFERENCES scans(id),
ADD COLUMN has_comparison BOOLEAN DEFAULT false,
ADD COLUMN comparison_id INTEGER;

ALTER TABLE scan_recommendations
ADD COLUMN recommendation_fingerprint VARCHAR(64),
ADD COLUMN history_id INTEGER,
ADD COLUMN comparison_status VARCHAR(20),
ADD COLUMN previous_detection_count INTEGER DEFAULT 0,
ADD COLUMN first_detected_at TIMESTAMP;

-- Create new tables (see full schema in main document)
CREATE TABLE recommendation_history (...);
CREATE TABLE scan_comparisons (...);
CREATE TABLE domain_tracking (...);

-- Add foreign keys (after tables exist)
ALTER TABLE scans
ADD CONSTRAINT fk_scans_comparison
  FOREIGN KEY (comparison_id) REFERENCES scan_comparisons(id);

ALTER TABLE scan_recommendations
ADD CONSTRAINT fk_scan_recommendations_history
  FOREIGN KEY (history_id) REFERENCES recommendation_history(id);

-- Create indexes (10+ indexes)
CREATE INDEX idx_scans_domain ON scans(user_id, domain);
CREATE INDEX idx_scans_previous ON scans(previous_scan_id);
CREATE INDEX idx_scan_recommendations_fingerprint ON scan_recommendations(recommendation_fingerprint);
CREATE INDEX idx_rec_history_user_domain ON recommendation_history(user_id, domain);
-- ... more indexes
```

**Impact:**
- ⚠️ Complex schema changes (3 new tables, 9 columns)
- ⚠️ Multiple foreign key relationships
- ⚠️ Migration time: 5-10 minutes (for existing data)
- ⚠️ Backfill fingerprints: 10-30 minutes
- ✅ Zero downtime possible (with careful ordering)

---

## Storage Impact Estimation

### Option B (Lightweight)

**Per Scan:**
- `domain`: ~20 bytes
- `previous_scan_id`: 4 bytes
- `comparison_data`: ~500 bytes (JSON)
- `comparison_status`: ~10 bytes per recommendation

**Total per scan:** ~600 bytes + (10 bytes × # recommendations)
**For 10,000 scans:** ~6 MB additional storage
**Annual growth:** < 50 MB

### Option A (Full System)

**Per Scan:**
- Same as Option B: ~600 bytes
- `recommendation_history` entries: ~400 bytes × # unique recommendations
- `scan_comparisons` entry: ~800 bytes
- `domain_tracking` entry: ~200 bytes (one-time per domain)

**Total per scan:** ~2 KB + (400 bytes × # new unique recommendations)
**For 10,000 scans:** ~20-40 MB additional storage
**Annual growth:** ~200-300 MB

---

## Query Performance Comparison

### Option B Queries

```sql
-- Get comparison for current scan (SIMPLE)
SELECT comparison_data
FROM scans
WHERE id = $1;

-- Get previous scan's recommendations (SIMPLE)
SELECT *
FROM scan_recommendations
WHERE scan_id = (
  SELECT previous_scan_id FROM scans WHERE id = $1
);
```

**Query time:** < 50ms

### Option A Queries

```sql
-- Get full recommendation history for domain (COMPLEX)
SELECT rh.*, sr.recommendation_text
FROM recommendation_history rh
LEFT JOIN scan_recommendations sr ON rh.id = sr.history_id
WHERE rh.user_id = $1 AND rh.domain = $2
ORDER BY rh.first_detected_at DESC;

-- Get comparison across multiple scans (COMPLEX)
SELECT
  sc.*,
  s1.url as previous_url,
  s1.total_score as previous_score,
  s2.url as current_url,
  s2.total_score as current_score
FROM scan_comparisons sc
JOIN scans s1 ON sc.previous_scan_id = s1.id
JOIN scans s2 ON sc.current_scan_id = s2.id
WHERE sc.user_id = $1 AND sc.domain = $2
ORDER BY sc.created_at DESC
LIMIT 10;

-- Get recommendations that persisted across N scans (VERY COMPLEX)
SELECT
  rh.*,
  COUNT(DISTINCT sr.scan_id) as times_seen
FROM recommendation_history rh
JOIN scan_recommendations sr ON rh.id = sr.history_id
WHERE rh.user_id = $1
  AND rh.current_status = 'active'
  AND rh.times_detected >= 3
GROUP BY rh.id
ORDER BY rh.times_detected DESC;
```

**Query time:** 100-500ms (with proper indexes)

---

## Index Strategy

### Option B Indexes (2 total)
```sql
CREATE INDEX idx_scans_domain
  ON scans(user_id, domain);

CREATE INDEX idx_scans_previous
  ON scans(previous_scan_id);
```

### Option A Indexes (12+ total)
```sql
-- Scans table
CREATE INDEX idx_scans_domain ON scans(user_id, domain);
CREATE INDEX idx_scans_previous ON scans(previous_scan_id);
CREATE INDEX idx_scans_comparison ON scans(comparison_id);

-- Scan recommendations table
CREATE INDEX idx_scan_recommendations_fingerprint
  ON scan_recommendations(recommendation_fingerprint);
CREATE INDEX idx_scan_recommendations_history
  ON scan_recommendations(history_id);

-- Recommendation history table
CREATE INDEX idx_rec_history_user_domain
  ON recommendation_history(user_id, domain);
CREATE INDEX idx_rec_history_fingerprint
  ON recommendation_history(recommendation_fingerprint);
CREATE INDEX idx_rec_history_status
  ON recommendation_history(current_status);
CREATE INDEX idx_rec_history_first_detected
  ON recommendation_history(first_detected_at);

-- Scan comparisons table
CREATE INDEX idx_scan_comparisons_current
  ON scan_comparisons(current_scan_id);
CREATE INDEX idx_scan_comparisons_user
  ON scan_comparisons(user_id, domain);

-- Domain tracking table
CREATE INDEX idx_domain_tracking_user
  ON domain_tracking(user_id);
CREATE INDEX idx_domain_tracking_primary
  ON domain_tracking(user_id, is_primary_domain);
```

---

## Migration Complexity Comparison

### Option B Migration

**Steps:**
1. Run ALTER TABLE statements (30 seconds)
2. Create indexes (30 seconds)
3. Done ✅

**Rollback:** Simple (DROP columns and indexes)
**Risk:** 🟢 LOW

### Option A Migration

**Steps:**
1. Create new tables (1 minute)
2. Run ALTER TABLE statements on existing tables (1 minute)
3. Add foreign key constraints (30 seconds)
4. Create indexes (2-3 minutes)
5. Backfill fingerprints for existing recommendations (5-30 minutes)
6. Update application code
7. Test foreign key relationships
8. Done ✅

**Rollback:** Complex (many dependencies)
**Risk:** 🟡 MEDIUM

---

## Visual Comparison Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    DATABASE IMPACT SUMMARY                   │
├──────────────────┬──────────────────┬───────────────────────┤
│                  │  Option B (Lite) │  Option A (Full)      │
├──────────────────┼──────────────────┼───────────────────────┤
│ New Tables       │        0         │         3             │
│ Modified Tables  │        2         │         2             │
│ New Columns      │        4         │        14             │
│ New Indexes      │        2         │        12+            │
│ Foreign Keys     │        1         │         7             │
│ Migration Time   │    < 1 min       │     5-10 min          │
│ Backfill Time    │      None        │    10-30 min          │
│ Rollback Risk    │    🟢 Easy       │    🟡 Moderate        │
│ Storage Growth   │    < 50 MB/yr    │   200-300 MB/yr       │
│ Query Complexity │    🟢 Simple     │    🟡 Complex         │
│ Ongoing Maint.   │    🟢 Low        │    🟡 Medium          │
└──────────────────┴──────────────────┴───────────────────────┘
```

---

## Conclusion

**Option B** makes surgical changes to existing schema - minimal disruption, quick implementation.

**Option A** requires significant schema redesign - powerful features but higher complexity and risk.

**Recommendation:** Start with Option B, migrate to Option A only if user demand validates the investment.

---

**Related Documents:**
- Full analysis: `HISTORIC_COMPARISON_ANALYSIS.md`
- Decision guide: `COMPARISON_FEATURE_DECISION_SUMMARY.md`
