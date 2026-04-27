> ⚠️ **ARCHIVED (Pre-Pivot)** — This document describes the old recommendation lifecycle system that was removed in Phase 1. It does not reflect the current production architecture. For current documentation, see DOCS_INDEX.md at repo root.

---

# Quick Reference Guide - Recommendations & Scans Architecture

## Key Tables at a Glance

| Table | Purpose | Key Identifiers | Relationships |
|-------|---------|-----------------|---------------|
| **scans** | Scan results & scores | id, user_id, url | Parent for recommendations, progress |
| **scan_recommendations** | Individual recommendations | id, scan_id | Linked to scans, user_progress |
| **user_progress** | User's progress state | user_id, scan_id (unique pair) | Aggregates from scan_recommendations |
| **page_priorities** | Page ranking for multi-page | scan_id, page_url (unique pair) | Multi-page scan organization |
| **recommendation_feedback** | User ratings & feedback | id, scan_id, recommendation_id | Quality tracking |
| **recommendation_interactions** | Click tracking & engagement | scan_id, recommendation_id, user_id (unique) | Engagement metrics |
| **recommendation_quality_metrics** | Aggregated quality data | subfactor, variant, industry, period | Continuous improvement |
| **ai_testing_results** | AI visibility tracking | id, scan_id, user_id | External integration tracking |

---

## Data Flow Summary (High Level)

```
Scan Request
    ↓
V5 Scoring Engine (15 pages max)
    ↓
Issue Detection (compare scores vs thresholds)
    ↓
Generate Recommendations (AI + templates + special handlers)
    ↓
Classify as Site-Wide or Page-Specific
    ↓
Save to scan_recommendations (with unlock_state, batch_number)
    ↓
Create user_progress (with batch dates)
    ↓
Return to Client (with unlocked recs in batch 1)
```

---

## Recommendation States Lifecycle

```
CREATION:
  unlock_state = 'locked' (for DIY batch 2-4)
  OR unlock_state = 'active' (for free/diy batch 1, pro all)

USER ACTION:
  active → completed (when user marks done)
  
TIME-BASED AUTO-UNLOCK:
  locked → active (when batch date passes)

VERIFICATION:
  completed → verified (admin action)

SKIP AVAILABLE:
  (5 days after unlocked_at, user can skip)
```

---

## Critical Business Logic

### Plan-Based Behavior

```
FREE:
  - 2 scans/month
  - 3 recommendations shown
  - Rest locked forever
  - No unlock option

DIY:
  - 25 scans/month
  - 5 initial recommendations
  - Progressive unlock (5 per batch every 5 days)
  - 1 unlock/day (or complete all active to unlock)
  - 2 competitor scans/month

PRO:
  - 50 scans/month
  - ALL recommendations active
  - 10 competitor scans/month
  - No daily unlock limits
```

### Competitor Scans

```
DETECTION:
  Different domain than user's primary_domain
  
TREATMENT:
  - Run V5 scoring (no recommendations)
  - Save scores only to scans
  - NO scan_recommendations created
  - NO user_progress created
  - Separate quota tracking
  
INDICATION:
  scans.domain_type = 'competitor'
```

---

## Query Patterns

### Most Common Operations

```sql
-- Get a user's recent scans
SELECT * FROM scans 
WHERE user_id = ? 
ORDER BY created_at DESC LIMIT 10;

-- Get all recommendations for a scan
SELECT * FROM scan_recommendations 
WHERE scan_id = ? 
ORDER BY batch_number, priority DESC;

-- Get user's progress
SELECT * FROM user_progress 
WHERE user_id = ? AND scan_id = ?;

-- Get active recommendations only
SELECT * FROM scan_recommendations 
WHERE scan_id = ? AND unlock_state = 'active';

-- Get site-wide vs page-specific counts
SELECT recommendation_type, COUNT(*), 
  SUM(CASE WHEN unlock_state='active' THEN 1 ELSE 0 END) as active
FROM scan_recommendations 
WHERE scan_id = ? 
GROUP BY recommendation_type;
```

---

## Performance Notes

### Index Coverage
- User's scans: `idx_scans_user_id`
- Scan's recommendations: `idx_scan_recommendations_scan_id`
- User's progress: `idx_user_progress_user_id`
- Hybrid filtering: `idx_scan_recommendations_type`
- Page-specific: `idx_scan_recommendations_page`

### Problematic Queries (avoid)
- Full table scans on scan_recommendations (always filter by scan_id first)
- Counting all recommendations (use aggregated metrics table)
- Fetching all feedback without date range (use period_start/period_end)

---

## Timestamp Columns & What They Track

| Column | What It Tracks | When Set | Updates |
|--------|----------------|----------|---------|
| scans.created_at | Scan submitted | At insert | Never |
| scans.completed_at | Scan finished | After analysis | Never |
| scans.updated_at | Any change | Auto trigger | Always |
| scan_recommendations.unlocked_at | Moved to active | When unlock happens | Once |
| scan_recommendations.marked_complete_at | User completed | POST mark-complete | Once |
| scan_recommendations.verified_at | Admin verified | Admin action | Once |
| scan_recommendations.skip_enabled_at | Skip becomes available | At unlock (+5 days) | Never |
| user_progress.last_unlock_date | Last DIY unlock | POST unlock-next | Updates daily |
| user_progress.last_activity_date | Last user action | POST mark-complete | Updates |
| recommendation_feedback.created_at | Feedback submitted | At insert | Never |
| recommendation_feedback.updated_at | Any feedback change | Auto trigger | Always |

---

## JSON Columns (JSONB)

| Column | Contains | Example |
|--------|----------|---------|
| scans.detailed_analysis | Full scan analysis result | { categories: {...}, metadata: {...} } |
| scans.faq_schema | FAQ schema markup | [{ "@type": "FAQPage", ... }] |
| scan_recommendations.action_steps | Step-by-step guide | ["Step 1: ...", "Step 2: ..."] |
| scan_recommendations.implementation_notes | Implementation details | ["Note 1", "Note 2"] |
| scan_recommendations.quick_wins | Quick actions | [{ title: "...", desc: "..." }] |
| scan_recommendations.validation_checklist | Verification steps | ["Check 1", "Check 2"] |

---

## Batch System Details

```
Calculated at save time:
- batch_1_unlock_date = NOW (immediate)
- batch_2_unlock_date = NOW + 5 days
- batch_3_unlock_date = NOW + 10 days
- batch_4_unlock_date = NOW + 15 days
- total_batches = CEIL(total_recommendations / 5)

Automatic unlock happens:
- When user fetches GET /api/scan/:id
- Checks if batch_N_unlock_date <= NOW
- If yes, unlocks batch N (auto-activates locked recs in batch N)
- Updates current_batch in user_progress
```

---

## Common Issues & Solutions

### Issue: Recommendations not showing after unlock
**Check:**
1. Is unlock_state='active'? (not 'locked')
2. Is user_id owner of scan?
3. Is batch_number <= current_batch?
4. Check user_progress.active_recommendations > 0

### Issue: Batch not auto-unlocking on schedule
**Check:**
1. Compare batch_N_unlock_date with current server time
2. Verify user_progress.current_batch not already at N
3. Check for timezone mismatches in date comparison

### Issue: Competitor scan created recommendations
**Check:**
1. Should verify scans.domain_type = 'competitor'
2. Check if domain actually differs from primary_domain
3. Verify user.primary_domain is set (first scan sets it)

---

## Schema Version History

| Migration | Changes | Purpose |
|-----------|---------|---------|
| migrate-scans.js | Core tables: scans, scan_recommendations, scan_pages | Foundation |
| migrate-progressive-unlock.js | user_progress, ai_testing_results | Unlock system |
| add-recommendation-columns.js | action_steps, findings, code_snippet | Structured content |
| add-hybrid-columns.js | recommendation_type, page_url, page_priority, state | Hybrid system v1 |
| migrate-hybrid-recommendations.js | page_priorities, site_wide/page_specific tracking | Hybrid system v2 |
| add-structured-recommendation-columns.js | customized_implementation, ready_to_use_content, notes, quick_wins, checklist | Rich content |
| migrate-recommendation-feedback.js | recommendation_feedback, recommendation_interactions, recommendation_quality_metrics | Quality tracking |

---

## Environment & Configuration

### Database Connection
- Location: `/home/user/ai-visibility-tool/backend/db/database.js`
- Uses environment variable: `DATABASE_URL`
- SSL required for cloud databases (Render, etc.)
- Local databases can use SSL: false

### Scoring Engine
- Location: `/home/user/ai-visibility-tool/backend/analyzers/v5-enhanced-rubric-engine.js`
- Max pages crawled: 15 (recently reverted from 50 to fix scan failures)
- Timeout: 10,000ms

### OpenAI Integration
- Used for top 5 recommendations (rec-generator.js)
- API key: `OPENAI_API_KEY` environment variable
- Fallback to templates if API fails

---

## Testing Endpoints

```bash
# Test basic scan
POST /api/scan/analyze
{
  "url": "https://example.com",
  "pages": ["https://example.com", "https://example.com/about"]
}

# Test recommendation retrieval
GET /api/scan/{scanId}
GET /api/recommendations/scan/{scanId}

# Test unlock
POST /api/scan/{scanId}/unlock
POST /api/recommendations/unlock-next
{ "scan_id": {scanId} }

# Test feedback
POST /api/feedback/recommendation
{
  "scanId": 123,
  "recommendationId": "rec-001",
  "helpful": true,
  "rating": 5,
  "implemented": false
}
```

