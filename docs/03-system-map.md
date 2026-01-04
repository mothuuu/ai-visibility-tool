# Visible2AI - System Map
## Current State → Target State

**Version:** 1.2  
**Date:** 2026-01-03

---

## Current Architecture (As-Is)

### Overview
```
┌─────────────────────────────────────────────────────────────────┐
│                        CURRENT STATE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐       │
│  │   Frontend  │────▶│   Backend   │────▶│ PostgreSQL  │       │
│  │ (Vanilla JS)│     │  (Express)  │     │             │       │
│  │   VERCEL    │     │   RENDER    │     │   RENDER    │       │
│  └─────────────┘     └─────────────┘     └─────────────┘       │
│                             │                                   │
│                             ▼                                   │
│                      ┌─────────────┐                           │
│                      │  Claude API │                           │
│                      │  (Primary)  │                           │
│                      └─────────────┘                           │
│                             │                                   │
│                             ▼                                   │
│                      ┌─────────────┐                           │
│                      │ ChatGPT API │                           │
│                      │ (Fallback)  │                           │
│                      └─────────────┘                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Current Tech Stack

| Layer | Technology | Hosting |
|-------|------------|---------|
| Frontend | Vanilla JavaScript | Vercel |
| Backend | Node.js + Express | Render |
| Database | PostgreSQL | Render (Managed) |
| AI (Primary) | Claude API | Anthropic |
| AI (Fallback) | ChatGPT API | OpenAI |
| Payments | Stripe | - |

### Current Database Schema (Simplified)
```
users
├── id
├── email
├── password_hash
├── plan (free/diy/pro/enterprise/agency)
├── scans_used_this_month  ← PROBLEM: counter needs reset
├── quota_reset_date       ← PROBLEM: cron-dependent
└── stripe_customer_id

scans
├── id
├── user_id  ← PROBLEM: should be org_id
├── url
├── status
├── overall_score
└── scan_data (JSONB)

recommendations (if exists)
├── scan_id
├── title
├── description
└── [limited fields]
```

### Current Issues

| Component | Problem | Impact |
|-----------|---------|--------|
| **Usage Tracking** | Counter reset via cron | Quota failures when cron fails |
| **Data Model** | User-centric, not org-centric | Can't support teams/agencies |
| **Recommendations** | Filtered before storage | Zero recommendations shown |
| **Recommendations** | Technical language | Users don't understand |
| **Recommendations** | Duplicate across pillars | Same fix shown multiple times |
| **Scanning** | No job queue | Timeout, no retry |
| **Scanning** | Status not tracked | Can't show progress |
| **Evidence** | Not stored separately | Can't debug/rescore |
| **Versioning** | None | Can't evolve algorithms safely |

### Current Flow: Scan
```
1. User clicks "Scan"
2. Frontend calls POST /api/scans
3. Backend crawls page (synchronous)
4. Backend scores page (synchronous)
5. Backend generates recommendations (synchronous)
6. Backend returns results
7. ❌ If any step fails → entire scan fails
8. ❌ If timeout → user sees nothing
9. ❌ No retry mechanism
```

### Current Flow: Recommendations
```
1. Scoring complete
2. Call Claude API for recommendations
3. If Claude fails → try ChatGPT
4. If ChatGPT fails → generic templates
5. Filter recommendations by plan limit  ← PROBLEM
6. Store filtered recommendations         ← PROBLEM
7. ❌ If filter removes all → 0 shown
8. ❌ Technical language not adapted
```

---

## Target Architecture (To-Be)

### Overview
```
┌─────────────────────────────────────────────────────────────────┐
│                        TARGET STATE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐       │
│  │   Frontend  │────▶│   Backend   │────▶│ PostgreSQL  │       │
│  │   (React)   │     │  (Express)  │     │    v2.1     │       │
│  │   VERCEL    │     │   RENDER    │     │   RENDER    │       │
│  └─────────────┘     └─────────────┘     └─────────────┘       │
│         │                   │                    │              │
│         │                   │                    │              │
│         ▼                   ▼                    │              │
│  ┌─────────────┐     ┌─────────────┐            │              │
│  │  Progress   │     │    Redis    │◀───────────┘              │
│  │  (Polling)  │     │   RENDER    │                           │
│  └─────────────┘     └─────────────┘                           │
│   ↑ WebSocket                │                                  │
│     optional v2              ▼                                  │
│                      ┌─────────────┐                           │
│                      │ Job Worker  │                           │
│                      │   RENDER    │                           │
│                      └─────────────┘                           │
│                             │                                   │
│              ┌──────────────┼──────────────┐                   │
│              ▼              ▼              ▼                   │
│       ┌──────────┐   ┌──────────┐   ┌──────────┐              │
│       │ Crawler  │   │ Scorer   │   │  Issue   │              │
│       │ Service  │   │ Service  │   │ Detector │ ← RULES-BASED│
│       └──────────┘   └──────────┘   └──────────┘              │
│                                            │                   │
│                                            ▼                   │
│                                     ┌──────────┐              │
│                                     │   Copy   │              │
│                                     │Generator │ ← LLM + TMPL │
│                                     └──────────┘              │
│                                            │                   │
│              ┌─────────────────────────────┤                   │
│              ▼                             ▼                   │
│       ┌──────────┐                  ┌──────────┐              │
│       │ Template │ ← FALLBACK       │ Claude   │              │
│       │ Library  │                  │   API    │              │
│       └──────────┘                  └──────────┘              │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Observability                         │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │   │
│  │  │ Sentry  │  │ PostHog │  │ Logs    │  │ Health  │    │   │
│  │  │ Errors  │  │Analytics│  │ w/IDs   │  │Endpoint │    │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Critical Architecture Contracts

**🔒 SCORING SCALE: 0–1000 EVERYWHERE**
- Total score: 0–1000
- Each pillar: 0–125 (8 pillars × 125 = 1000)
- All thresholds, comparisons, and UI displays use this scale
- Never mix with 0–100 or percentage representations in code

**🔒 ISSUE DETECTION IS DETERMINISTIC (NO LLM)**
- Issue Detector runs **rules-based logic only** (14-detection-rules.md)
- LLM is used **only** for copy rewriting (marketing/technical/exec phrasing)
- If LLM fails → template fallback ensures recommendations still appear
- **Guarantee:** Recommendations exist even when all LLM APIs are down

### Recommendation Pipeline (Critical Contract)

```
STAGE 1: Issue Detection (DETERMINISTIC - No LLM)
├── Input: scan_evidence + pillar_scores
├── Process: Rule-based matching against 14-detection-rules.md
├── Output: scan_issues rows (links to issue_library)
└── Guarantee: Always produces issues if any pillar < 125 (or total < 1000)

STAGE 2: Copy Generation (LLM with Template Fallback)
├── Input: scan_issues + audience (marketing/technical/exec)
├── Process: LLM rewrites template for audience, OR uses template directly
├── Output: recommendation_copy rows (per-audience text)
└── Fallback: If LLM fails, use pre-written template copy
```

**API Contract:** `GET /api/scans/:id/recommendations` NEVER returns empty array.
- If issues detected → return actionable recommendations
- If no issues → return "locked" state with diagnostic info
- If error → return fallback recommendations with `source: 'template'`

### Target Tech Stack

| Layer | Technology | Hosting |
|-------|------------|---------|
| Frontend | React 18+ | Vercel |
| Backend | Node.js + Express | Render |
| Database | PostgreSQL (schema v2.1) | Render (Managed) |
| Cache/Queue | Redis + Bull/MQ | Render |
| AI (Primary) | Claude API | Anthropic |
| AI (Fallback) | ChatGPT API | OpenAI |
| AI (Testing) | Perplexity API | Perplexity |
| Payments | Stripe | - |
| Error Tracking | Sentry | - |
| Analytics | PostHog | - |

### Target Database Schema (Simplified)
```
organizations              ← NEW: billing/team entity
├── id
├── name
├── plan
└── owner_user_id

users
├── id
├── email
└── password_hash
                          ← REMOVED: plan, quota counters

organization_members       ← NEW: RBAC
├── organization_id
├── user_id
└── role_id

subscriptions             ← NEW: Stripe sync
├── organization_id
├── stripe_subscription_id
├── current_period_start  ← From Stripe
└── current_period_end    ← From Stripe

usage_periods             ← NEW: period-based tracking
├── organization_id
├── period_start
├── period_end
└── scan_count

usage_events              ← NEW: event-level tracking
├── organization_id
├── period_id
├── event_type
└── resource_id

domains                   ← NEW: first-class entity
├── organization_id
├── domain                ← normalized (example.com)
├── display_url           ← full URL (https://example.com)
├── verification_method   ← 'meta_tag', 'dns_txt', 'html_file'
├── verification_token
├── verified_at
└── status                ← 'pending', 'verified', 'lapsed'

user_profiles             ← NEW: personalization
├── user_id
├── role                  ← marketing, founder, product, etc.
├── onboarding_completed_at
└── onboarding_skipped_at

org_profiles              ← NEW: personalization
├── organization_id
├── company_type          ← b2b_saas, msp, telecom, etc.
├── primary_goal          ← be_recommended, fix_basics, etc.
├── target_audience       ← smb, enterprise, consumer
└── icp_keywords[]        ← for recommendation language

jobs                      ← NEW: async pipeline
├── organization_id
├── job_type
├── status
├── current_step
└── steps_completed

scans
├── organization_id       ← CHANGED: was user_id
├── domain_id             ← NEW: link to domain
├── job_id                ← NEW: link to job
└── status

scan_results              ← SPLIT from scans
├── scan_id
├── total_score
├── [8 pillar scores]
└── engine_version        ← NEW: versioning

scan_evidence             ← NEW: raw data storage
├── scan_id
├── content
├── schema_data
└── evidence_version

issue_library             ← NEW: canonical issue definitions (seeded)
├── id
├── issue_code            ← e.g., 'MISSING_ORG_SCHEMA'
├── pillar_id             ← FK to pillar
├── severity              ← critical, high, medium, low
└── default_templates     ← JSONB: {marketing, technical, exec}

scan_issues               ← NEW: detected issues per scan
├── scan_id
├── issue_id              ← FK to issue_library
├── evidence_snapshot     ← what triggered detection
└── detected_at

recommendations           ← ENHANCED: audience-specific copy
├── scan_id
├── scan_issue_id         ← FK to scan_issues
├── marketing_copy        ← NEW: audience view
├── technical_copy        ← NEW: audience view
├── exec_copy             ← NEW: audience view
├── copy_source           ← 'llm' or 'template'
├── is_locked             ← NEW: visibility control
├── required_plan         ← NEW: upgrade prompt
└── generator_version     ← NEW: versioning
```

### Target Flow: Scan
```
1. User clicks "Scan"
2. Frontend calls POST /api/scans
3. Backend checks quota (period-based)
4. Backend creates scan + job record
5. Backend queues job in Redis
6. Backend returns job_id immediately
7. Worker picks up job
8. Worker: crawl → score → detect issues → generate copy
9. Each step updates job status
10. Frontend polls GET /api/jobs/:id for progress (2s interval)
    ↳ WebSocket optional enhancement (v2)
11. ✅ If step fails → retry with backoff
12. ✅ If all retries fail → mark failed with reason
13. ✅ User always sees status/error
```

### Target Flow: Recommendations
```
STAGE 1: Issue Detection (DETERMINISTIC)
├── Input: pillar_scores + scan_evidence
├── Process: Rule engine matches against 14-detection-rules.md
├── Output: scan_issues rows (FK to issue_library)
└── Guarantee: No LLM dependency, always succeeds

STAGE 2: Copy Generation (LLM + Template Fallback)
├── Input: scan_issues + audience (marketing/technical/exec) + org_profiles
├── Process: 
│   ├── Try: LLM generates audience-specific copy
│   └── Fallback: Use pre-written template from issue_library
├── Output: recommendations rows (with copy_source = 'llm' or 'template')
└── Guarantee: Always produces copy (LLM or template)

STAGE 3: Storage & Visibility
├── Store ALL recommendations (never filter)
├── Apply is_locked based on plan entitlements
├── Set required_plan for upgrade prompts
└── Return with user's preferred audience view

✅ API GUARANTEE: GET /api/scans/:id/recommendations NEVER returns []
   - Has issues → return actionable recommendations
   - No issues → return locked state with "Your site is well-optimized"
   - Error → return template-based fallback
```

---

## Migration Path

### Phase Mapping

| Current | Target | Migration |
|---------|--------|-----------|
| `users.plan` | `organizations.plan` | Create org per user, move plan |
| `users.scans_used_this_month` | `usage_periods` + `usage_events` | Backfill from scan history |
| `users.stripe_customer_id` | `subscriptions` table | Move to subscriptions |
| `scans.user_id` | `scans.organization_id` | Update FK |
| `scans.scan_data` | `scan_results` + `scan_evidence` | Split JSONB |
| N/A | `domains` | Create from scan URLs |
| N/A | `jobs` | New table |
| N/A | `issue_library` | Seed canonical issues |
| N/A | `scan_issues` | New table |

### Data Migration Steps

1. **Create new tables** (empty)
2. **Migrate users → organizations**
   - Create personal org for each user
   - Set org.plan = user.plan
   - Create organization_members record
3. **Migrate subscriptions**
   - Create subscriptions record per Stripe customer
   - Sync current_period from Stripe API
4. **Migrate scans**
   - Update user_id → organization_id
   - Extract domains, create domain records
   - Split scan_data into scan_results + scan_evidence
5. **Migrate recommendations**
   - Add new columns (is_locked, marketing_copy, etc.)
   - Backfill marketing_copy from existing content
6. **Backfill usage**
   - Create usage_periods from scan history
   - Create usage_events from scans

### Rollback Plan

1. Keep old tables for 30 days
2. Dual-write during transition
3. Feature flag for new vs old code paths
4. If issues: flip flag, restore old behavior

---

## Gap Analysis

| Area | Current | Target | Gap |
|------|---------|--------|-----|
| **Multi-tenant** | User-centric | Org-centric | Schema change + migration |
| **Usage tracking** | Counter + cron | Period-based events | New tables + logic |
| **Job pipeline** | Synchronous | Async with queue | Redis + Bull/MQ + workers |
| **Recommendations** | Filter before store | Store all, lock display | Schema + generator rewrite |
| **Audience views** | None | Marketing/Technical/Exec | New columns + templates |
| **Deduplication** | None | Canonical issues + clusters | New tables + logic |
| **Versioning** | None | Full versioning | New columns everywhere |
| **Observability** | Basic | Correlation IDs + health | Middleware + endpoint |

---

## Key Architectural Changes

### 1. Sync → Async
**Before:** Request waits for scan to complete  
**After:** Request returns immediately, job processes in background

### 2. User → Organization
**Before:** Everything keyed by user_id  
**After:** Everything keyed by organization_id

### 3. Counter → Events
**Before:** Increment counter, reset via cron  
**After:** Record events, count per period

### 4. Monolith → Services
**Before:** All logic in route handlers  
**After:** Dedicated services (Auth, Usage, Scan, Recommendation, etc.)

### 5. Filter → Lock
**Before:** Hide recommendations user can't access  
**After:** Show all, lock ones requiring upgrade

---

## Success Metrics for Migration

| Metric | Target |
|--------|--------|
| Data integrity | 100% users migrated with correct orgs |
| Feature parity | All existing features work |
| Performance | Scan latency ≤ current |
| Zero-rec rate | < 1% (vs current ~5-10%) |
| Quota accuracy | 100% (vs current ~90%) |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.2 | 2026-01-03 | Separated Issue Detector (rules) from Copy Generator (LLM+template); added "never zero" API contract; polling as default (WebSocket optional v2); added domain verification fields; added user_profiles/org_profiles; clarified 0-1000 score scale; renamed recommendation_issues → issue_library + scan_issues; added Critical Architecture Contracts section (0-1000 scale + deterministic detection) |
| 1.1 | 2026-01-03 | Added Vercel/Render hosting labels; added Tech Stack tables |
| 1.0 | 2026-01-03 | Initial version |
