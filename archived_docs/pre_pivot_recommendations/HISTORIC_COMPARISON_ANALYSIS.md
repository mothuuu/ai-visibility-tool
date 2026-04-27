> ⚠️ **ARCHIVED (Pre-Pivot)** — This document describes the old recommendation lifecycle system that was removed in Phase 1. It does not reflect the current production architecture. For current documentation, see DOCS_INDEX.md at repo root.

---

# Historic Comparison & Implementation Tracking Analysis

**Document Date:** 2025-11-13
**Purpose:** Feasibility analysis for tracking recommendation history and implementation progress across scans
**Status:** 🔬 EXPLORATION PHASE - NO IMPLEMENTATION

---

## Executive Summary

This document analyzes the effort and impact of adding a feature to track:
1. **What recommendations were made** in each scan
2. **Which recommendations were detected as implemented or partially implemented** in subsequent scans
3. **Implementation progress tracking** over time

### Key Findings:
- ⚠️ **Moderate-to-High Complexity** (3-4 week effort)
- 🟡 **Medium Risk** to existing users (requires careful migration)
- 💾 **Database Changes Required** (3 new tables + 2 table modifications)
- 🤖 **AI/Logic Required** for implementation detection
- 💰 **Cost Impact** from additional OpenAI API calls
- 📊 **High Value** for users tracking long-term improvements

---

## 1. Current System Architecture Summary

### 1.1 Existing Data Model

Your system currently has:

**Core Tables:**
- `scans` - Stores scan results with 8 category scores
- `scan_recommendations` - Individual recommendations with 40+ columns
- `user_progress` - Aggregated progress per scan
- `page_priorities` - Multi-page scan organization (5 pages max)

**Key Characteristics:**
- Each scan is **independent** - no linkage between scans
- Recommendations are tied to `scan_id`
- Historical data exists (timestamps) but no comparison logic
- Progressive unlock system (batches released every 5 days)
- State machine: `locked` → `active` → `completed` → `verified`

### 1.2 Current Tracking Capabilities

**✅ What You Have:**
- Complete scan history (all scans stored with timestamps)
- Recommendation state tracking (locked/active/completed/verified)
- User marking recommendations as complete
- Timestamps: `created_at`, `unlocked_at`, `marked_complete_at`, `verified_at`
- Batch unlock dates (4 batches per scan)
- User feedback and ratings per recommendation

**❌ What You Don't Have:**
- No linkage between scans of the same domain
- No comparison of recommendations across scans
- No automatic detection of implementation
- No historical trend visualization
- No "recommendation lifecycle" tracking across multiple scans

---

## 2. Feature Requirements Definition

### 2.1 User Stories

1. **As a user**, I want to see what recommendations I received in my last scan vs. this scan
2. **As a user**, I want to know which recommendations I completed and are now detected as "fixed" by the tool
3. **As a user**, I want to track my progress over time (how many recommendations implemented month-over-month)
4. **As a user**, I want to see if new issues emerged that weren't present in previous scans
5. **As a user**, I want a "recommendation history" timeline showing when each recommendation appeared, was addressed, and disappeared

### 2.2 Core Capabilities Required

**Must Have:**
1. **Scan Linking** - Associate multiple scans of the same domain
2. **Recommendation Fingerprinting** - Identify "same recommendation" across scans
3. **Implementation Detection** - AI/logic to detect if an issue is now resolved
4. **Historical Storage** - Keep recommendation history across scans
5. **Comparison View** - Show previous vs. current recommendations side-by-side
6. **Progress Metrics** - Calculate implementation rate, time-to-fix, etc.

**Nice to Have:**
1. Timeline visualization
2. Export historical data (CSV/PDF)
3. Trend analysis (scores improving over time)
4. Recommendation retention (how long issues persist)

---

## 3. Implementation Approach - Option A: Full Tracking System

### 3.1 Database Schema Changes

#### **New Tables Required:**

#### 3.1.1 `recommendation_history`
Tracks all recommendations across all scans for a domain.

```sql
CREATE TABLE recommendation_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  domain VARCHAR(255) NOT NULL,  -- Root domain (extracted from URL)
  recommendation_fingerprint VARCHAR(64) NOT NULL,  -- MD5 hash of key attributes

  -- Recommendation details (snapshot)
  category VARCHAR(100) NOT NULL,
  recommendation_text TEXT NOT NULL,
  recommendation_type VARCHAR(20),  -- 'site-wide' or 'page-specific'
  page_url TEXT,
  priority VARCHAR(20),

  -- Lifecycle tracking
  first_detected_scan_id INTEGER REFERENCES scans(id),
  first_detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_detected_scan_id INTEGER REFERENCES scans(id),
  last_detected_at TIMESTAMP,
  resolution_scan_id INTEGER REFERENCES scans(id),  -- Scan where it was no longer detected
  resolved_at TIMESTAMP,

  -- Status
  current_status VARCHAR(20) DEFAULT 'active',  -- active, resolved, recurring
  times_detected INTEGER DEFAULT 1,
  total_scans_in_period INTEGER DEFAULT 1,

  -- User actions
  user_marked_complete BOOLEAN DEFAULT false,
  user_marked_complete_at TIMESTAMP,
  user_marked_complete_scan_id INTEGER REFERENCES scans(id),

  -- Indexes
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(user_id, domain, recommendation_fingerprint)
);

CREATE INDEX idx_rec_history_user_domain ON recommendation_history(user_id, domain);
CREATE INDEX idx_rec_history_fingerprint ON recommendation_history(recommendation_fingerprint);
CREATE INDEX idx_rec_history_status ON recommendation_history(current_status);
```

#### 3.1.2 `scan_comparisons`
Stores scan-to-scan comparison results.

```sql
CREATE TABLE scan_comparisons (
  id SERIAL PRIMARY KEY,
  previous_scan_id INTEGER NOT NULL REFERENCES scans(id),
  current_scan_id INTEGER NOT NULL REFERENCES scans(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  domain VARCHAR(255) NOT NULL,

  -- Comparison metrics
  recommendations_resolved INTEGER DEFAULT 0,
  recommendations_persisting INTEGER DEFAULT 0,
  recommendations_new INTEGER DEFAULT 0,

  -- Score changes
  score_change DECIMAL(5,2),  -- Difference in total score
  category_score_changes JSONB,  -- Detailed category changes

  -- Time elapsed
  days_between_scans INTEGER,

  -- Comparison data
  comparison_data JSONB,  -- Detailed diff of recommendations

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(previous_scan_id, current_scan_id)
);

CREATE INDEX idx_scan_comparisons_current ON scan_comparisons(current_scan_id);
CREATE INDEX idx_scan_comparisons_user ON scan_comparisons(user_id, domain);
```

#### 3.1.3 `domain_tracking`
Central registry of domains being tracked by users.

```sql
CREATE TABLE domain_tracking (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  domain VARCHAR(255) NOT NULL,

  -- First and latest scans
  first_scan_id INTEGER REFERENCES scans(id),
  first_scan_at TIMESTAMP,
  latest_scan_id INTEGER REFERENCES scans(id),
  latest_scan_at TIMESTAMP,

  -- Aggregate metrics
  total_scans INTEGER DEFAULT 0,
  total_recommendations_ever INTEGER DEFAULT 0,
  total_recommendations_resolved INTEGER DEFAULT 0,
  avg_resolution_time_days DECIMAL(10,2),

  -- Status
  is_primary_domain BOOLEAN DEFAULT false,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(user_id, domain)
);

CREATE INDEX idx_domain_tracking_user ON domain_tracking(user_id);
CREATE INDEX idx_domain_tracking_primary ON domain_tracking(user_id, is_primary_domain);
```

#### **Modifications to Existing Tables:**

#### 3.1.4 Add columns to `scan_recommendations`
```sql
ALTER TABLE scan_recommendations
ADD COLUMN recommendation_fingerprint VARCHAR(64),  -- Links to history
ADD COLUMN history_id INTEGER REFERENCES recommendation_history(id),
ADD COLUMN comparison_status VARCHAR(20),  -- 'new', 'persisting', 'resolved'
ADD COLUMN previous_detection_count INTEGER DEFAULT 0,
ADD COLUMN first_detected_at TIMESTAMP;

CREATE INDEX idx_scan_recommendations_fingerprint
  ON scan_recommendations(recommendation_fingerprint);
CREATE INDEX idx_scan_recommendations_history
  ON scan_recommendations(history_id);
```

#### 3.1.5 Add columns to `scans`
```sql
ALTER TABLE scans
ADD COLUMN domain VARCHAR(255),  -- Extracted root domain
ADD COLUMN previous_scan_id INTEGER REFERENCES scans(id),
ADD COLUMN has_comparison BOOLEAN DEFAULT false,
ADD COLUMN comparison_id INTEGER REFERENCES scan_comparisons(id);

CREATE INDEX idx_scans_domain ON scans(user_id, domain);
CREATE INDEX idx_scans_previous ON scans(previous_scan_id);
```

### 3.2 Recommendation Fingerprinting Logic

**Challenge:** How to determine if two recommendations are "the same" across scans?

**Proposed Solution:**
Generate a fingerprint (MD5 hash) based on:
- Category
- Recommendation type (site-wide vs page-specific)
- Page URL (if page-specific)
- Core issue identified (normalized text)

**Example Code:**
```javascript
function generateRecommendationFingerprint(rec) {
  const crypto = require('crypto');

  // Normalize text to essential issue description
  const normalizedText = normalizeRecommendationText(rec.recommendation_text);

  const fingerprintInput = [
    rec.category,
    rec.recommendation_type || 'page-specific',
    rec.page_url || 'site-wide',
    normalizedText
  ].join('|');

  return crypto.createHash('md5').update(fingerprintInput).digest('hex');
}

function normalizeRecommendationText(text) {
  // Remove specific values, keep core issue
  // Example: "Your page is 45KB" → "Your page is large"
  // This is the tricky part - needs AI or regex patterns
  return text
    .toLowerCase()
    .replace(/\d+/g, 'X')  // Replace numbers
    .replace(/https?:\/\/[^\s]+/g, 'URL')  // Replace URLs
    .substring(0, 200);  // Use first 200 chars
}
```

**Issue:** Normalization is complex - may need OpenAI to extract "core issue" from recommendation text.

### 3.3 Implementation Detection Logic

**Two Approaches:**

#### **Approach A: Score-Based Detection (Simpler)**
- If a recommendation appears in Scan 1 but not Scan 2, consider it "resolved"
- Compare category scores:
  - If category score improved by 10+ points → recommendations in that category likely addressed

**Pros:** Simple, no AI required
**Cons:** False positives (recommendation might change wording), false negatives (issue persists but different recommendation)

#### **Approach B: AI-Powered Detection (More Accurate)**
- After each new scan, run comparison:
  - For each previous recommendation, ask OpenAI:
    - "Based on the new scan evidence, was this recommendation implemented?"
    - Provide: old recommendation text + old scan data + new scan data
  - OpenAI returns: `implemented`, `partially_implemented`, `not_implemented`, `cannot_determine`

**Pros:** More accurate
**Cons:** **Expensive** - adds 10-50 OpenAI API calls per scan comparison, **Slower** scan times

**Cost Estimate:**
- Average scan has ~20 recommendations from previous scan to check
- 20 calls × $0.005/call = **$0.10 per scan comparison**
- 1000 scans/month = **$100/month additional cost**

### 3.4 API Endpoints Required

#### **New Endpoints:**

```
GET  /api/scans/:scanId/comparison
     - Get comparison between this scan and previous scan
     - Returns: recommendations resolved, new, persisting

GET  /api/recommendations/history/:domain
     - Get recommendation history for a domain
     - Returns: all recommendations ever seen, their lifecycle

GET  /api/domains/:domain/progress
     - Get progress metrics for a domain over time
     - Returns: implementation rate, avg resolution time, trend data

POST /api/scans/:scanId/compare/:previousScanId
     - Manually trigger comparison between two specific scans
     - For admin/debugging

GET  /api/recommendations/:recId/history
     - Get history of a specific recommendation
     - Returns: when first seen, how many times, resolution status
```

#### **Modified Endpoints:**

```
POST /api/scan/authenticated
     - After scan completes, automatically:
       1. Extract domain
       2. Find previous scan for domain
       3. Generate recommendation fingerprints
       4. Run comparison logic
       5. Save to recommendation_history
       6. Create scan_comparisons record
       7. Update domain_tracking
```

### 3.5 Processing Flow

**When a new scan completes:**

```
1. Extract root domain from URL
2. Query: Find latest previous scan for this domain + user
3. If no previous scan → Initialize domain_tracking, skip comparison
4. If previous scan exists:
   a. Load previous scan's recommendations
   b. Generate fingerprints for both old and new recommendations
   c. Compare fingerprints:
      - Matching fingerprint → "persisting"
      - In previous but not current → "resolved"
      - In current but not previous → "new"
   d. (Optional) Run AI implementation detection for "resolved" items
   e. Save to recommendation_history
   f. Create scan_comparisons record
   g. Update domain_tracking metrics
5. Return scan results + comparison data
```

**Processing Time Estimate:**
- Domain extraction: 10ms
- Query previous scan: 50ms
- Fingerprint generation: 100ms (for ~40 recommendations)
- Comparison logic: 200ms
- AI detection (if enabled): 5-15 seconds (parallel API calls)
- Database saves: 300ms

**Total: 0.7 seconds without AI, 6-16 seconds with AI detection**

### 3.6 Frontend Changes Required

**New UI Components:**

1. **Scan Comparison View**
   - Side-by-side: Previous Scan | Current Scan
   - Highlight: Resolved (green), New (yellow), Persisting (grey)
   - Score delta visualization

2. **Recommendation History Card**
   - For each recommendation, show:
     - First detected: Date
     - Times seen: Count
     - Status: Active / Resolved
     - User action: Marked complete on [date]

3. **Domain Progress Dashboard**
   - Timeline chart: Score over time
   - Implementation rate: X% recommendations resolved
   - Average time to fix: Y days
   - Persistent issues: Recommendations seen 3+ times

4. **Historical Trends Chart**
   - Line graph: Total score across scans
   - Bar chart: Recommendations resolved per scan
   - Heat map: Category scores over time

**Estimated Frontend Effort:** 2-3 weeks

---

## 4. Implementation Approach - Option B: Lightweight Version

### 4.1 Simplified Requirements

Instead of full tracking, implement a **lightweight comparison**:

**What Changes:**
- Only compare **most recent scan** vs **current scan** (no full history)
- **Store minimal comparison data** in existing tables
- **No fingerprinting** - simple text matching or category-based detection
- **No AI detection** - purely score-based

### 4.2 Minimal Database Changes

**Add to `scans` table:**
```sql
ALTER TABLE scans
ADD COLUMN domain VARCHAR(255),
ADD COLUMN previous_scan_id INTEGER REFERENCES scans(id),
ADD COLUMN comparison_data JSONB;  -- Store simple comparison
```

**Add to `scan_recommendations` table:**
```sql
ALTER TABLE scan_recommendations
ADD COLUMN comparison_status VARCHAR(20);  -- 'new', 'similar', NULL
```

**That's it!** No new tables.

### 4.3 Simplified Logic

```javascript
async function compareScans(currentScanId, previousScanId) {
  // Get both scans' recommendations
  const currentRecs = await db.query(
    'SELECT * FROM scan_recommendations WHERE scan_id = $1',
    [currentScanId]
  );
  const previousRecs = await db.query(
    'SELECT * FROM scan_recommendations WHERE scan_id = $1',
    [previousScanId]
  );

  // Simple category-based comparison
  const comparison = {
    categories_improved: [],
    categories_declined: [],
    new_categories: [],
    resolved_categories: []
  };

  // Compare category scores
  const previousByCategory = groupByCategory(previousRecs.rows);
  const currentByCategory = groupByCategory(currentRecs.rows);

  for (const category in currentByCategory) {
    if (!previousByCategory[category]) {
      comparison.new_categories.push(category);
    }
  }

  for (const category in previousByCategory) {
    if (!currentByCategory[category]) {
      comparison.resolved_categories.push(category);
    }
  }

  // Save comparison
  await db.query(
    'UPDATE scans SET comparison_data = $1 WHERE id = $2',
    [JSON.stringify(comparison), currentScanId]
  );

  return comparison;
}
```

### 4.4 Effort Estimate: Lightweight Version

- **Backend:** 3-5 days
- **Frontend:** 1 week
- **Testing:** 2-3 days
- **Total:** ~2 weeks

**Pros:**
- Minimal disruption
- Quick to implement
- Low risk

**Cons:**
- Less detailed tracking
- No long-term history
- No recommendation-level tracking (only category-level)

---

## 5. Risk Assessment & Disruption Analysis

### 5.1 Risks to Existing Users

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Migration fails** | HIGH | Run in staging first, have rollback plan |
| **Scan times increase** | MEDIUM | Make comparison async, don't block scan completion |
| **Database performance degrades** | MEDIUM | Add indexes, monitor query times |
| **Existing scans lack comparison** | LOW | Only apply to new scans, don't backfill |
| **Users confused by new UI** | LOW | Make comparison opt-in, add help tooltips |
| **Cost increase from AI calls** | MEDIUM | Make AI detection optional, offer as Pro-only feature |

### 5.2 Database Migration Strategy

**Recommended Approach: Zero-Downtime Migration**

1. **Phase 1: Add new tables and columns**
   - Run migration during low-traffic hours
   - New columns have defaults, won't break existing code
   - Estimated downtime: **0 seconds** (additive changes only)

2. **Phase 2: Deploy code that uses new columns**
   - Gradual rollout (10% → 50% → 100%)
   - Monitor error rates

3. **Phase 3: Backfill historical data (optional)**
   - Run background job to analyze existing scans
   - Generate fingerprints for past recommendations
   - Not critical for launch

**Data Migration Concerns:**
- Existing `scan_recommendations` rows: ~50,000 estimated (based on system age)
- Adding columns: < 1 minute
- Backfilling fingerprints: ~10 minutes (can run in background)

### 5.3 Performance Impact

**Current Scan Time:** ~5-10 seconds (based on V5 rubric engine)

**With Full Tracking (Option A):**
- Without AI detection: +0.7 seconds (7-14% increase)
- With AI detection: +6-16 seconds (60-160% increase) ❌ **NOT ACCEPTABLE**

**With Lightweight Version (Option B):**
- +0.3 seconds (3-6% increase) ✅ **ACCEPTABLE**

**Recommendation:** Use lightweight version initially, or make AI detection async (run after scan returns results).

### 5.4 Cost Impact

**Option A with AI Detection:**
- Additional OpenAI calls: 10-50 per scan comparison
- Cost per scan: $0.05 - $0.15
- Monthly cost increase (1000 scans): **$50 - $150/month**

**Option B (Lightweight):**
- No additional API calls
- Cost increase: **$0/month**

**Recommendation:** Start with Option B, add AI detection as opt-in Pro feature.

---

## 6. Phased Implementation Recommendation

### **Phase 1: Foundation (Week 1-2)**
- Add `domain` column to `scans` table
- Add `previous_scan_id` column to `scans` table
- Extract root domain on every scan
- Link scans of same domain
- **No comparison logic yet**, just setup infrastructure

**Risk:** LOW | **Effort:** 3-5 days | **Disruption:** Minimal

---

### **Phase 2: Basic Comparison (Week 3-4)**
- Add `comparison_data` JSONB column to `scans`
- Implement category-level comparison (Lightweight Option B)
- Add simple comparison API endpoint
- Add basic comparison view in frontend (score deltas)

**Risk:** LOW-MEDIUM | **Effort:** 1-2 weeks | **Disruption:** Minimal

---

### **Phase 3: Recommendation-Level Tracking (Week 5-8)**
- Add `recommendation_history` table
- Implement fingerprinting logic
- Track recommendations across scans
- Add "Recommendation History" UI

**Risk:** MEDIUM | **Effort:** 2-3 weeks | **Disruption:** Low-Medium

---

### **Phase 4: Advanced Features (Week 9-12)**
- Add `scan_comparisons` and `domain_tracking` tables
- Implement AI-powered implementation detection (opt-in)
- Add historical trends dashboard
- Add export functionality

**Risk:** MEDIUM-HIGH | **Effort:** 3-4 weeks | **Disruption:** Medium

---

## 7. Alternative Approaches

### 7.1 Store Comparison Data in JSONB

Instead of creating multiple tables, store everything in JSONB columns:

**Pros:**
- Faster to implement
- Flexible schema (can change structure easily)
- No complex joins

**Cons:**
- Harder to query efficiently
- No referential integrity
- Can't index deeply nested data
- Performance degrades with large datasets

**Verdict:** ❌ Not recommended for production long-term, but OK for MVP

---

### 7.2 Use External Service (e.g., Mixpanel, Amplitude)

Send scan events and recommendations to analytics platform.

**Pros:**
- No database changes needed
- Built-in visualization
- Proven at scale

**Cons:**
- Additional cost ($100-500/month)
- Data leaves your system
- Less control over features

**Verdict:** 🤔 Consider as complement, not replacement

---

### 7.3 Snapshot Entire Scan Results

Store complete scan JSON in `comparison_snapshots` table, compare on-demand.

**Pros:**
- Simple storage model
- Can always recompute comparisons
- No fingerprinting complexity

**Cons:**
- Large storage footprint (100KB+ per scan)
- Slow comparison (process entire JSON each time)
- Expensive queries

**Verdict:** ⚠️ OK for small scale (<10k scans), doesn't scale

---

## 8. Recommendation & Next Steps

### **Recommended Approach:**

**Start with Phased Implementation - Phase 1 & 2 (Lightweight)**

**Rationale:**
1. ✅ Minimal disruption to existing users
2. ✅ Low risk (additive changes only)
3. ✅ Quick time-to-value (2-4 weeks)
4. ✅ No cost increase
5. ✅ Validates user demand before heavy investment
6. ✅ Foundation for more advanced features later

**Then, based on user feedback:**
- If users love it → Proceed to Phase 3 & 4
- If users don't use it → Stop, no sunk cost
- If users want more detail → Add AI detection as Pro feature

---

### **Immediate Next Steps (If Approved):**

1. **Week 1: Planning**
   - [ ] Create detailed technical spec
   - [ ] Design database migration scripts
   - [ ] Plan rollout strategy
   - [ ] Set up monitoring/alerting for new features

2. **Week 2: Development - Phase 1**
   - [ ] Write migration script (add domain, previous_scan_id)
   - [ ] Implement domain extraction logic
   - [ ] Add scan linking logic
   - [ ] Write unit tests
   - [ ] Test in staging

3. **Week 3-4: Development - Phase 2**
   - [ ] Implement comparison logic (category-level)
   - [ ] Create API endpoints
   - [ ] Build frontend comparison view
   - [ ] Integration tests
   - [ ] Beta test with 5-10 users

4. **Week 5: Rollout**
   - [ ] Deploy to production (gradual rollout)
   - [ ] Monitor performance and errors
   - [ ] Collect user feedback
   - [ ] Iterate based on feedback

---

## 9. Open Questions for Discussion

1. **Should comparison be automatic or opt-in?**
   - Auto: Every scan compares to previous (default on)
   - Opt-in: User must enable "Track Progress" (default off)

2. **Should we backfill historical scans?**
   - Pro: Users can see full history immediately
   - Con: Complex, might slow down database, might have errors

3. **Should AI detection be Pro-only or DIY+?**
   - Pro-only: Justifies cost increase
   - DIY+: More accessible, drives upgrades from Free

4. **How long should we keep recommendation history?**
   - Forever: Best user experience, large database
   - 12 months: Reasonable compromise
   - 6 months: Minimal storage, less useful

5. **Should we show "persistent issues" (seen 3+ times) differently?**
   - Could highlight chronic problems
   - Might demotivate users ("I keep failing!")

---

## 10. Cost-Benefit Analysis

### **Costs:**
- **Development:** 4-12 weeks (depending on phase)
- **Ongoing:** Additional storage (~5GB/year), minimal compute
- **AI Detection (optional):** $50-150/month in API costs

### **Benefits:**
- **User Retention:** Users can see progress → more engaged → less churn
- **Upgrade Driver:** "See full history" can be Pro feature
- **Competitive Advantage:** Few tools offer this level of tracking
- **Customer Success:** Users can prove ROI to stakeholders
- **Support Reduction:** Fewer "did I already get this recommendation?" tickets

### **Estimated Impact:**
- **Churn Reduction:** -10-15% (users seeing progress stay longer)
- **Upgrade Rate:** +5-10% (history/trends valuable for Pro users)
- **Customer Satisfaction:** +20-30% (based on similar features in SaaS tools)

**ROI Projection:**
- If churn reduces by 10% → Save ~$5k-10k MRR annually
- If upgrades increase by 5% → Gain ~$2k-5k MRR annually
- Development cost amortized over 12 months: ~$3k-8k

**Net Benefit:** $4k-7k/year (assuming conservative estimates)

---

## Appendix A: Example Comparison Output

```json
{
  "scan_id": 12345,
  "previous_scan_id": 12340,
  "domain": "example.com",
  "days_between_scans": 14,
  "score_change": +8.5,
  "recommendations": {
    "resolved": [
      {
        "recommendation": "Add schema markup to homepage",
        "category": "AI Search Readiness",
        "first_seen": "2025-10-15",
        "last_seen": "2025-10-22",
        "resolution_detected": "2025-11-01",
        "user_marked_complete": true,
        "status": "implemented"
      }
    ],
    "new": [
      {
        "recommendation": "Optimize images for faster loading",
        "category": "Speed & UX",
        "severity": "medium",
        "status": "new_issue"
      }
    ],
    "persisting": [
      {
        "recommendation": "Add FAQ section for voice search",
        "category": "Voice Optimization",
        "first_seen": "2025-09-20",
        "times_detected": 4,
        "status": "persistent",
        "user_action": "marked_complete_but_not_detected"
      }
    ]
  },
  "category_changes": {
    "AI Search Readiness": {
      "previous_score": 65,
      "current_score": 78,
      "change": +13,
      "recommendations_resolved": 2
    },
    "Speed & UX": {
      "previous_score": 82,
      "current_score": 75,
      "change": -7,
      "recommendations_new": 1
    }
  }
}
```

---

## Appendix B: Fingerprinting Examples

**Example 1: Site-wide Recommendation**
```
Input:
  category: "AI Search Readiness"
  type: "site-wide"
  text: "Add schema markup to your homepage. Current implementation is missing Organization and WebSite schemas."

Fingerprint Input: "ai search readiness|site-wide|site-wide|add schema markup to your homepage current implementation is missing organization and website schemas"
Fingerprint: "a3f5d8b9c2e1..."
```

**Example 2: Page-specific Recommendation**
```
Input:
  category: "Content Structure"
  type: "page-specific"
  page_url: "https://example.com/about"
  text: "Your page has 3 H1 tags. Reduce to 1 for better clarity."

Fingerprint Input: "content structure|page-specific|https://example.com/about|your page has x hx tags reduce to x for better clarity"
Fingerprint: "7b2e9f4d1a6c..."
```

**Collision Handling:**
If two different recommendations produce the same fingerprint (rare), they'll be treated as the same. This is acceptable for MVP - can be refined later with more sophisticated NLP.

---

**END OF ANALYSIS**

---

**Document Version:** 1.0
**Last Updated:** 2025-11-13
**Next Review:** After stakeholder discussion
