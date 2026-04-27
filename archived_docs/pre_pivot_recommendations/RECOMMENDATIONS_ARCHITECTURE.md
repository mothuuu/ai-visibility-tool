> ⚠️ **ARCHIVED (Pre-Pivot)** — This document describes the old recommendation lifecycle system that was removed in Phase 1. It does not reflect the current production architecture. For current documentation, see DOCS_INDEX.md at repo root.

---

# AI Visibility Tool - Recommendations & Scans Architecture

## Executive Summary

The AI Visibility Tool uses a hybrid recommendation system with progressive unlock features, storing comprehensive metadata about how recommendations are generated, delivered, and tracked. The system integrates scoring, recommendation generation, and user progress tracking into a cohesive workflow.

---

## 1. DATA MODELS & DATABASE SCHEMA

### Core Tables

#### **scans** Table
Primary repository for scan results and metadata.

**Location:** `/home/user/ai-visibility-tool/backend/db/migrate-scans.js`

**Key Columns:**
```
- id (SERIAL PRIMARY KEY)
- user_id (FK → users)
- url TEXT
- status VARCHAR(50) - 'pending', 'processing', 'completed', 'failed'
- domain_type VARCHAR(50) - 'primary', 'competitor'
- extracted_domain TEXT
- rubric_version VARCHAR(10) - 'V5'

SCORING COLUMNS:
- total_score INTEGER
- ai_readability_score INTEGER
- ai_search_readiness_score INTEGER
- content_freshness_score INTEGER
- content_structure_score INTEGER
- speed_ux_score INTEGER
- technical_setup_score INTEGER
- trust_authority_score INTEGER
- voice_optimization_score INTEGER

METADATA:
- industry VARCHAR(100)
- page_count INTEGER
- pages_analyzed JSONB
- detailed_analysis JSONB
- recommendations JSONB (legacy - now in scan_recommendations table)
- faq_schema JSONB

TIMESTAMPS:
- created_at TIMESTAMP
- completed_at TIMESTAMP
- updated_at TIMESTAMP
```

**Indexes:**
- idx_scans_user_id
- idx_scans_status
- idx_scans_created_at DESC

---

#### **scan_recommendations** Table
Stores individual recommendations with complete metadata for each scan.

**Location:** `/home/user/ai-visibility-tool/backend/db/migrate-scans.js` (base)
**Extensions:** Multiple migration files add columns

**Full Column Set:**
```
BASE COLUMNS (migrate-scans.js):
- id SERIAL PRIMARY KEY
- scan_id FK → scans(id)
- category VARCHAR(100)
- recommendation_text TEXT
- priority VARCHAR(20) - 'high', 'medium', 'low'
- estimated_impact INTEGER
- estimated_effort VARCHAR(20)
- status VARCHAR(50)
- implemented_at TIMESTAMP
- user_feedback TEXT
- user_rating INTEGER

ACTION & DETAILS (add-recommendation-columns.js):
- action_steps JSONB
- findings TEXT
- code_snippet TEXT

HYBRID SYSTEM (add-hybrid-columns.js, migrate-hybrid-recommendations.js):
- recommendation_type VARCHAR(20) - 'site-wide' or 'page-specific'
- page_url TEXT (NULL for site-wide)
- page_priority INTEGER (1-5 for user page ranking)
- skip_enabled_at TIMESTAMP (5 days after unlock)

PROGRESSIVE UNLOCK (migrate-progressive-unlock.js):
- unlock_state VARCHAR(20) - 'locked', 'active', 'completed', 'verified'
- batch_number INTEGER
- unlocked_at TIMESTAMP
- marked_complete_at TIMESTAMP
- verified_at TIMESTAMP
- skip_verification BOOLEAN

STRUCTURED CONTENT (add-structured-recommendation-columns.js):
- customized_implementation TEXT (before/after HTML)
- ready_to_use_content TEXT (copy-ready content)
- implementation_notes JSONB (array of bullet points)
- quick_wins JSONB (array of 3-5 quick actions)
- validation_checklist JSONB (array of checkboxes)

ADDITIONAL (scan.js observations):
- impact_description TEXT
```

**Indexes:**
- idx_scan_recommendations_scan_id
- idx_scan_recommendations_type (scan_id, recommendation_type)
- idx_scan_recommendations_page (scan_id, page_url)
- idx_scan_recommendations_priority (scan_id, page_priority)

---

#### **user_progress** Table
Tracks user's progress through recommendations for each scan.

**Location:** `/home/user/ai-visibility-tool/backend/db/migrate-progressive-unlock.js`

**Columns:**
```
- id SERIAL PRIMARY KEY
- user_id FK → users
- scan_id FK → scans
  
PROGRESS TRACKING:
- total_recommendations INTEGER
- active_recommendations INTEGER
- completed_recommendations INTEGER
- verified_recommendations INTEGER
- current_batch INTEGER (1, 2, 3, 4...)

UNLOCK TRACKING:
- last_unlock_date DATE
- unlocks_today INTEGER
- next_unlock_available_at TIMESTAMP
- last_activity_date DATE

HYBRID SYSTEM (migrate-hybrid-recommendations.js additions):
- site_wide_total INTEGER
- site_wide_completed INTEGER
- site_wide_active INTEGER
- page_specific_total INTEGER
- page_specific_completed INTEGER
- site_wide_complete BOOLEAN
- current_page_url TEXT (which page is currently unlocked)

BATCH DATES (from saveHybridRecommendations):
- batch_1_unlock_date TIMESTAMP (immediate)
- batch_2_unlock_date TIMESTAMP (+5 days)
- batch_3_unlock_date TIMESTAMP (+10 days)
- batch_4_unlock_date TIMESTAMP (+15 days)
- total_batches INTEGER

GAMIFICATION:
- completion_streak INTEGER
- last_activity_date DATE

TIMESTAMPS:
- created_at TIMESTAMP
- updated_at TIMESTAMP

CONSTRAINT:
- UNIQUE(user_id, scan_id) - one record per user per scan
```

**Indexes:**
- idx_user_progress_user_id
- idx_user_progress_scan_id

---

#### **page_priorities** Table
Tracks priority ranking of pages for multi-page scans.

**Location:** `/home/user/ai-visibility-tool/backend/db/migrate-hybrid-recommendations.js`

**Columns:**
```
- id SERIAL PRIMARY KEY
- scan_id FK → scans
- page_url TEXT (which page)
- priority_rank INTEGER (1-5, user's ranking)

PAGE METRICS:
- page_score INTEGER
- total_recommendations INTEGER (expected)
- completed_recommendations INTEGER
- unlocked BOOLEAN
- unlocked_at TIMESTAMP

TIMESTAMPS:
- created_at TIMESTAMP
- updated_at TIMESTAMP

CONSTRAINT:
- UNIQUE(scan_id, page_url)
```

**Indexes:**
- idx_page_priorities_scan_id
- idx_page_priorities_rank (scan_id, priority_rank)

---

#### **recommendation_feedback** Table
Stores user feedback on recommendations.

**Location:** `/home/user/ai-visibility-tool/backend/db/migrate-recommendation-feedback.js`

**Columns:**
```
- id SERIAL PRIMARY KEY
- scan_id FK → scans
- recommendation_id TEXT
- subfactor TEXT

FEEDBACK DATA:
- rating INTEGER (1-5, CHECK constraint)
- helpful BOOLEAN
- implemented BOOLEAN DEFAULT FALSE
- comment TEXT

CONTEXT:
- user_id FK → users
- industry TEXT
- page_url TEXT
- recommendation_variant TEXT

METADATA:
- created_at TIMESTAMP
- updated_at TIMESTAMP
```

**Indexes:**
- idx_feedback_subfactor
- idx_feedback_rating
- idx_feedback_created DESC
- idx_feedback_user

---

#### **recommendation_interactions** Table
Tracks implicit user interactions (views, expansions, copies).

**Location:** `/home/user/ai-visibility-tool/backend/db/migrate-recommendation-feedback.js`

**Columns:**
```
- id SERIAL PRIMARY KEY
- scan_id FK → scans
- recommendation_id TEXT

INTERACTION EVENTS:
- viewed BOOLEAN DEFAULT TRUE
- expanded BOOLEAN DEFAULT FALSE
- copied_code BOOLEAN DEFAULT FALSE
- downloaded BOOLEAN DEFAULT FALSE
- time_spent_seconds INTEGER

METADATA:
- user_id FK → users
- created_at TIMESTAMP

CONSTRAINT:
- UNIQUE(scan_id, recommendation_id, user_id) - prevent duplicates
```

**Indexes:**
- idx_interactions_scan
- idx_interactions_user

---

#### **recommendation_quality_metrics** Table
Aggregated metrics for quality tracking and improvement.

**Location:** `/home/user/ai-visibility-tool/backend/db/migrate-recommendation-feedback.js`

**Columns:**
```
- id SERIAL PRIMARY KEY
- subfactor TEXT
- variant TEXT

AGGREGATED METRICS:
- total_shown INTEGER
- total_helpful INTEGER
- total_not_helpful INTEGER
- avg_rating DECIMAL(3,2)
- implementation_rate DECIMAL(5,2)
- avg_time_spent DECIMAL(8,2)

BREAKDOWN:
- industry TEXT
- period_start DATE
- period_end DATE

METADATA:
- updated_at TIMESTAMP

CONSTRAINT:
- UNIQUE(subfactor, variant, industry, period_start, period_end)
```

**Indexes:**
- idx_quality_subfactor
- idx_quality_period

---

#### **ai_testing_results** Table
Tracks recommendations mentioned in AI assistant responses.

**Location:** `/home/user/ai-visibility-tool/backend/db/migrate-progressive-unlock.js`

**Columns:**
```
- id SERIAL PRIMARY KEY
- scan_id FK → scans
- user_id FK → users

TEST CONFIGURATION:
- ai_assistant VARCHAR(50) - 'chatgpt', 'claude', 'perplexity'
- query_text TEXT (the question asked)
- query_category VARCHAR(100)

RESULTS:
- was_mentioned BOOLEAN DEFAULT FALSE
- was_recommended BOOLEAN DEFAULT FALSE
- was_cited BOOLEAN DEFAULT FALSE
- mention_context TEXT
- recommendation_rank INTEGER
- citation_url TEXT

METADATA:
- full_response TEXT (for debugging)
- created_at TIMESTAMP
```

**Indexes:**
- idx_ai_testing_scan_id
- idx_ai_testing_user_id
- idx_ai_testing_created_at DESC

---

## 2. RECOMMENDATION GENERATION & STORAGE FLOW

### Architecture Diagram

```
USER SUBMITS SCAN
    ↓
/api/scan/analyze (routes/scan.js)
    ↓
performV5Scan() function
    ├─→ V5EnhancedRubricEngine.analyze()
    │   ├─ SiteCrawler (crawl up to 15 pages)
    │   ├─ ContentExtractor (extract content)
    │   ├─ certification detection (optional)
    │   └─ Return: v5Results with category scores
    │
    ├─→ transformV5ToSubfactors()
    │   └─ Flatten nested V5 scores for issue detector
    │
    ├─→ generateCompleteRecommendations()
    │   (recommendation-generator.js)
    │   ├─ Issue Detection Phase
    │   │  └─ detectPageIssues() / detectMultiPageIssues()
    │   │     └─ Compares scores against ISSUE_THRESHOLDS
    │   │
    │   ├─ Recommendation Generation Phase
    │   │  └─ generateRecommendations() (rec-generator.js)
    │   │     ├─ Top 5 AI-generated (OpenAI)
    │   │     ├─ Certification recs (if industry specified)
    │   │     └─ Rest from templates
    │   │
    │   ├─ FAQ Generation Phase
    │   │  └─ generateCustomizedFAQ() (DIY+ only)
    │   │
    │   └─ Tier Filtering Phase
    │      └─ filterByTier() → returns 3-all recs based on plan
    │
    └─→ saveHybridRecommendations()
        (utils/hybrid-recommendation-helper.js)
        ├─ Classify recommendations:
        │  ├─ SITE_WIDE: indexnow, sitemap, robots.txt, https, ssl, schemas
        │  └─ PAGE_SPECIFIC: all others
        │
        ├─ Limit site-wide to 15 max
        ├─ Distribute page-specific across pages
        │
        ├─ Set initial active count based on plan:
        │  ├─ Free: 3 recs
        │  ├─ DIY: 5 recs (batch 1)
        │  └─ Pro: all recs active
        │
        ├─ Save each rec to scan_recommendations with:
        │  ├─ unlock_state (active/locked based on plan)
        │  ├─ batch_number (1, 2, 3, 4...)
        │  ├─ unlocked_at timestamp
        │  ├─ skip_enabled_at (+5 days if active)
        │  └─ All structured content fields
        │
        ├─ Create page_priorities entries
        │
        └─ Create user_progress record with:
           ├─ Counts: total, active, completed, verified
           ├─ Batch unlock dates (5 day intervals)
           └─ Site-wide vs page-specific breakdown

RESPONSE RETURNED TO CLIENT
    ↓
Client stores scan with recommendations
```

---

### Generation Process Details

#### **Issue Detection (issue-detector.js)**

Issues are detected by comparing subfactor scores against hardcoded thresholds:

```javascript
ISSUE_THRESHOLDS = {
  aiReadability: { altTextScore: 70, captionsTranscriptsScore: 60, ... },
  aiSearchReadiness: { questionHeadingsScore: 70, faqScore: 70, ... },
  contentFreshness: { lastUpdatedScore: 60, ... },
  contentStructure: { headingHierarchyScore: 75, ... },
  speedUX: { lcpScore: 70, mobileScore: 75, ... },
  technicalSetup: { crawlerAccessScore: 80, sitemapScore: 80, ... },
  trustAuthority: { ... },
  voiceOptimization: { ... }
}

// If score < threshold → issue detected
```

#### **Recommendation Generation Priority (rec-generator.js)**

1. **Curated Library** (future/optional)
2. **Programmatic output** (deterministic: structured data, OG tags, question headings)
3. **ChatGPT** (high quality copy where needed) - Top 5 recommendations
4. **Smart Templates** (free tier or fallback)

**Special Handlers:**
- Certification recommendations (if industry provided)
- FAQ Library + Customization (DIY+ tiers)
- JSON-LD generation (programmatic)

#### **Hybrid Classification**

```javascript
SITE_WIDE_CATEGORIES = [
  'indexNowScore', 'sitemapScore', 'robotsTxtScore',
  'httpsScore', 'mobileScore', 'speedScore',
  'coreWebVitalsScore', 'organizationSchema', 'brandSchema'
]

SITE_WIDE_KEYWORDS = [
  'indexnow', 'sitemap', 'robots.txt', 'https', 'ssl',
  'site-wide', 'entire site', 'all pages',
  'organization schema', 'brand schema'
]

// Recommendation classified as 'site-wide' if:
// - Category matches SITE_WIDE_CATEGORIES
// - Text contains SITE_WIDE_KEYWORDS
// - Otherwise: 'page-specific'
```

#### **Progressive Unlock Logic**

```
FREE TIER:
├─ 3 recommendations active immediately
└─ Rest locked (no unlock available)

DIY TIER:
├─ Batch 1: 5 recs active immediately
├─ Batch 2: 5 recs unlock (+5 days)
├─ Batch 3: 5 recs unlock (+10 days)
└─ Batch 4: 5 recs unlock (+15 days)
├─ Max 1 unlock per day
└─ Can complete all active to request manual unlock

PRO TIER:
└─ All recommendations active immediately
   (999 in initialActive count)

COMPETITOR SCANS:
└─ Scores only, NO recommendations saved
```

---

## 3. HOW SCANS ARE TRACKED & RELATIONSHIPS

### Scan Tracking Relationships

```
SCAN TRACKING HIERARCHY:
┌─────────────────────────────────────────┐
│ scans (parent record)                   │
│ ├─ id (primary key)                     │
│ ├─ user_id (which user)                 │
│ ├─ url (what was scanned)               │
│ ├─ domain_type (primary/competitor)     │
│ ├─ status (pending/processing/completed)│
│ ├─ all 8 category scores                │
│ └─ timestamps                           │
└─────────────────────────────────────────┘
              │
    ┌─────────┼─────────┬──────────────┐
    ↓         ↓         ↓              ↓
┌────────────────────────────────────────────┐
│ scan_recommendations (many)                │
│ ├─ Each recommendation linked to scan_id   │
│ ├─ unlock_state (locked/active/verified)   │
│ ├─ batch_number (1-4)                      │
│ ├─ recommendation_type (site/page-specific)│
│ └─ page_url (if page-specific)             │
└────────────────────────────────────────────┘
    │
    └─→ Linked to pages in page_priorities
        
┌────────────────────────────────────────────┐
│ user_progress (one per user per scan)      │
│ ├─ user_id + scan_id (unique)              │
│ ├─ Aggregated counts:                      │
│ │  ├─ total_recommendations                │
│ │  ├─ active_recommendations               │
│ │  ├─ completed_recommendations            │
│ │  ├─ verified_recommendations             │
│ │  └─ current_batch                        │
│ ├─ Batch unlock dates:                     │
│ │  ├─ batch_1_unlock_date (now)            │
│ │  ├─ batch_2_unlock_date (+5 days)        │
│ │  └─ ...                                  │
│ └─ Site-wide vs page-specific split        │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ page_priorities (for multi-page scans)     │
│ ├─ Ranks pages by priority (1-5)           │
│ ├─ Tracks recommendations per page         │
│ ├─ Tracks completion per page              │
│ └─ Tracks unlock status per page           │
└────────────────────────────────────────────┘
```

### Scan Types & Their Flow

#### **Primary Domain Scan**
1. User's main domain
2. Generates full recommendations
3. Creates scan_recommendations records
4. Creates user_progress record
5. Tracked for quota (limited per month)

#### **Competitor Scan**
1. Different domain than user's primary
2. **SCORES ONLY** - no recommendations saved
3. No scan_recommendations created
4. No user_progress created
5. Separate quota (2-10 per month depending on plan)
6. Indicates different domain type in scans table

#### **Multi-Page Scan**
1. Single scan with 5 or 25 pages analyzed
2. Site-wide recs apply to all pages
3. Page-specific recs distributed across pages
4. page_priorities tracks each page
5. user_progress tracks site-wide vs page-specific breakdown

---

## 4. DATA FLOW THROUGH THE SYSTEM

### API Endpoints

#### **POST /api/scan/guest** (routes/scan.js:56)
- No authentication required
- Returns scores only, no recommendations
- Saves scan to database with user_id = NULL
- Guest tier view only

#### **POST /api/scan/analyze** (routes/scan.js:145)
**Main scanning endpoint**
- Authenticated users only
- Creates scan with status='processing'
- Calls performV5Scan()
- Saves scores to scans table
- Calls saveHybridRecommendations() to save recs
- Returns full scan with initial active recommendations

**Request Flow:**
```
1. Validate URL format
2. Get user info (plan, industry, primary domain)
3. Check quotas (scans/month, competitor scans/month)
4. Create scan record (status='processing')
5. Run V5EnhancedRubricEngine.analyze()
6. Save scores to scans table
7. Generate recommendations via generateCompleteRecommendations()
8. Save recommendations via saveHybridRecommendations()
9. Update user quota counters
10. Return scan with recommendations and next batch info
```

#### **GET /api/scan/:id** (routes/scan.js:470)
- Retrieves a specific scan with recommendations
- Auto-unlocks batches if dates have passed
- Returns progress information
- Returns next batch unlock date

#### **GET /api/scan/list/recent** (routes/scan.js:652)
- Paginated list of user's recent scans
- Returns scan metadata, scores, basic info
- Not full recommendation details

#### **POST /api/scan/:id/unlock** (routes/scan.js:700)
- Manual unlock request for DIY tier
- Checks daily limits
- Unlocks next batch (5 recs)
- Updates user_progress

#### **GET /api/recommendations/active** (routes/recommendations.js:98)
- Returns only active (unlocked) recommendations
- Filters by user and optionally by scan_id
- Used by UI to show available recs

#### **GET /api/recommendations/scan/:scanId** (routes/recommendations.js:142)
- All recommendations for a specific scan (all states)
- Returns with progress information
- Shows locked/active/completed status

#### **POST /api/recommendations/:id/mark-complete** (routes/recommendations.js:10)
- Mark a single recommendation as completed
- Updates unlock_state to 'completed'
- Updates marked_complete_at timestamp
- Updates user_progress counters

#### **POST /api/recommendations/unlock-next** (routes/recommendations.js:201)
- Request next batch of recommendations
- Checks plan and daily limits
- Updates batch_number
- Unlocks up to 10 (pro) or 5 (diy) recs

#### **POST /api/feedback/recommendation** (routes/feedback.js:9)
- Submit feedback on specific recommendation
- Stores rating (1-5), helpful flag, comments
- Tracks variant and implementation status
- Async updates recommendation_quality_metrics

#### **POST /api/feedback/interaction** (routes/feedback.js:94)
- Track implicit interactions
- Views, expansions, code copies
- Time spent on recommendations
- Prevents duplicates with UNIQUE constraint

---

### Data Retrieval Patterns

#### **Getting All Recommendations for a Scan:**
```sql
SELECT *
FROM scan_recommendations
WHERE scan_id = $1
ORDER BY batch_number, priority DESC, estimated_impact DESC
```

#### **Getting Only Active (Unlocked) Recommendations:**
```sql
SELECT *
FROM scan_recommendations
WHERE scan_id = $1 AND unlock_state = 'active'
ORDER BY batch_number, priority DESC
```

#### **Getting User's Progress:**
```sql
SELECT *
FROM user_progress
WHERE user_id = $1 AND scan_id = $2
```

#### **Getting Page-Specific Recommendations:**
```sql
SELECT *
FROM scan_recommendations
WHERE scan_id = $1 AND page_url = $2
ORDER BY priority DESC
```

---

## 5. VERSIONING & HISTORICAL TRACKING

### Timestamp-Based Versioning

All tables include automatic timestamp tracking:
```
- created_at: When record was first created (immutable)
- updated_at: Automatically updated on any change (via PostgreSQL trigger)
```

**Trigger Function:**
```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';
```

Applied to:
- scans
- scan_recommendations
- user_progress
- page_priorities
- recommendation_feedback

---

### State Machine Tracking

#### **Scan Status Progression:**
```
pending → processing → completed
            └─→ failed
```

Stored in `scans.status` column.

#### **Recommendation State Progression:**
```
locked → active → completed → verified
  ↓ (after 5 days)
  skipped/dismissed available
```

Stored in `scan_recommendations.unlock_state` with supporting timestamps:
- `unlocked_at`: When moved from locked → active
- `marked_complete_at`: When moved to completed
- `verified_at`: When moved to verified
- `skip_enabled_at`: When skip becomes available (5 days after unlock)

---

### Batch-Based Versioning

Progressive unlock creates "versions" of recommendation sets:

```
BATCH 1 (immediate):
├─ batch_number = 1
├─ unlocked_at = NOW
└─ unlock_state = 'active'

BATCH 2 (+5 days):
├─ batch_number = 2
├─ unlocked_at = NULL initially, then becomes batch 2 unlock date
└─ unlock_state = 'locked' → 'active'

BATCH 3 (+10 days):
├─ batch_number = 3
└─ ...

BATCH 4 (+15 days):
├─ batch_number = 4
└─ ...
```

Stored in `scan_recommendations.batch_number`

---

### User Progress Snapshots

`user_progress` tracks the current state at any point:

```
Snapshot includes:
- total_recommendations (never changes)
- active_recommendations (increases as batches unlock)
- completed_recommendations (user-driven)
- verified_recommendations (admin-verified)
- current_batch (1, 2, 3, 4)
- Batch unlock dates (calculated at save time)
- Site-wide vs page-specific breakdown
- Last activity date (for engagement tracking)
- Completion streak (for gamification)
```

This allows calculating progress deltas over time.

---

### Feedback & Quality Tracking

#### **Individual Feedback Records:**
- `recommendation_feedback` stores every feedback submission
- Includes rating, helpful flag, implementation status
- Timestamped (created_at)
- Can track changes over time

#### **Aggregated Quality Metrics:**
- `recommendation_quality_metrics` summarizes by subfactor
- Calculates: avg_rating, implementation_rate, avg_time_spent
- Includes period_start/period_end for temporal analysis
- updated_at timestamp tracks when aggregation ran

#### **Interaction History:**
- `recommendation_interactions` logs every user interaction
- Prevents duplicates (one record per scan_id + rec_id + user_id)
- Tracks: views, expansions, code copies, download, time_spent
- Can calculate engagement metrics over time

---

### AI Testing Results

`ai_testing_results` tracks recommendation visibility in AI responses:
- When a recommendation was mentioned/recommended/cited
- Which AI assistant (ChatGPT, Claude, Perplexity)
- Query context and recommendation rank
- Historical record of how recommendations are discovered

---

## 6. KEY ARCHITECTURAL DECISIONS

### Hybrid Recommendation System
- **Site-wide recs** (15 max): Affect entire site (sitemap, robots.txt, https, etc.)
- **Page-specific recs**: Affect individual pages (headings, content, etc.)
- Separate tracking allows showing progress by type

### Progressive Unlock
- **Gamification**: Daily unlock limits drive user engagement
- **Cost control**: Batches prevent overwhelming users
- **Batch dates**: 5-day intervals create predictable unlock schedule
- **Batches of 5**: Manageable chunk sizes

### Hybrid Recommendation Generation
- **Top 5 AI-generated**: Higher quality, using OpenAI
- **Certifications**: Programmatic if industry provided
- **FAQ Library**: Curated for industries
- **Templates**: Fallback for common issues

### Competitor Scan Optimization
- **Scores only**: No recommendations = lower token costs
- **Separate quota**: Allows competitive analysis without limiting primary domain scans
- **No user_progress**: Prevents clutter in user's main dashboard

---

## 7. KEY FILE LOCATIONS

### Core API Routes
- `/home/user/ai-visibility-tool/backend/routes/scan.js` - Main scan endpoints
- `/home/user/ai-visibility-tool/backend/routes/recommendations.js` - Recommendation management
- `/home/user/ai-visibility-tool/backend/routes/feedback.js` - Feedback/interactions

### Database & Migrations
- `/home/user/ai-visibility-tool/backend/db/database.js` - PostgreSQL connection
- `/home/user/ai-visibility-tool/backend/db/migrate-scans.js` - Core scan tables
- `/home/user/ai-visibility-tool/backend/db/migrate-progressive-unlock.js` - user_progress, ai_testing_results
- `/home/user/ai-visibility-tool/backend/db/migrate-hybrid-recommendations.js` - page_priorities, hybrid columns
- `/home/user/ai-visibility-tool/backend/db/migrate-recommendation-feedback.js` - Feedback tables
- `/home/user/ai-visibility-tool/backend/db/add-recommendation-columns.js` - action_steps, findings, code_snippet
- `/home/user/ai-visibility-tool/backend/db/add-structured-recommendation-columns.js` - customized_implementation, ready_to_use_content
- `/home/user/ai-visibility-tool/backend/db/add-hybrid-columns.js` - recommendation_type, page_url, page_priority

### Recommendation Generation
- `/home/user/ai-visibility-tool/backend/analyzers/recommendation-generator.js` - Main orchestrator
- `/home/user/ai-visibility-tool/backend/analyzers/recommendation-engine/rec-generator.js` - Generates recommendations
- `/home/user/ai-visibility-tool/backend/analyzers/recommendation-engine/issue-detector.js` - Detects problems
- `/home/user/ai-visibility-tool/backend/analyzers/v5-enhanced-rubric-engine.js` - V5 scoring engine
- `/home/user/ai-visibility-tool/backend/utils/hybrid-recommendation-helper.js` - Saves recommendations with hybrid logic

### Specialized Generators
- `/home/user/ai-visibility-tool/backend/analyzers/recommendation-engine/certification-recommendation-generators.js` - Certification recs
- `/home/user/ai-visibility-tool/backend/analyzers/recommendation-engine/faq-customizer.js` - FAQ generation
- `/home/user/ai-visibility-tool/backend/analyzers/recommendation-engine/tier-filter.js` - Filters by plan

---

## 8. SUMMARY TABLE: Columns by Purpose

### Scan Identification
- scans.id, scans.user_id, scans.url, scans.domain_type

### Scoring Results
- scans.(8 category scores), scans.total_score

### Recommendation Content
- scan_recommendations.recommendation_text, action_steps, code_snippet
- scan_recommendations.customized_implementation, ready_to_use_content
- scan_recommendations.implementation_notes, quick_wins, validation_checklist

### Recommendation Organization
- scan_recommendations.recommendation_type (site-wide/page-specific)
- scan_recommendations.page_url (for page-specific)
- scan_recommendations.category, scan_recommendations.priority

### Recommendation State
- scan_recommendations.unlock_state (locked/active/completed/verified)
- scan_recommendations.batch_number (1-4)
- scan_recommendations.unlocked_at, marked_complete_at, verified_at

### User Progress
- user_progress.current_batch (which batch unlocked)
- user_progress.(total/active/completed/verified)_recommendations
- user_progress.batch_(1-4)_unlock_date (schedule)
- user_progress.last_unlock_date, unlocks_today (quota tracking)

### Feedback & Quality
- recommendation_feedback.(rating, helpful, implemented, comment)
- recommendation_quality_metrics.(avg_rating, implementation_rate)
- recommendation_interactions.(expanded, copied_code, time_spent)

---

## 9. QUERY PERFORMANCE OPTIMIZATION

### Critical Indexes
1. `idx_scan_recommendations_scan_id` - Most common filter
2. `idx_user_progress_user_id` - User-scoped queries
3. `idx_scans_user_id` - User's scans list
4. `idx_scan_recommendations_type` - Hybrid system queries
5. `idx_user_progress_scan_id` - Progress lookups

### Query Examples

**Fast - Uses indexes:**
```sql
-- Get all recs for a scan (uses idx_scan_recommendations_scan_id)
SELECT * FROM scan_recommendations WHERE scan_id = 123

-- Get user's progress (uses idx_user_progress_user_id)
SELECT * FROM user_progress WHERE user_id = 1

-- Get user's scans (uses idx_scans_user_id)
SELECT * FROM scans WHERE user_id = 1 ORDER BY created_at DESC
```

**Slower - Table scan:**
```sql
-- Get all recommendations by type (uses idx_scan_recommendations_type)
SELECT * FROM scan_recommendations WHERE recommendation_type = 'site-wide'
```

