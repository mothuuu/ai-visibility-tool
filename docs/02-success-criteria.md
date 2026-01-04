# Visible2AI - Success Criteria
## Definition of "Done" for System Reliability

**Version:** 2.3  
**Date:** 2026-01-03

This document defines what "working correctly" means for each major operation. Use these criteria for testing, monitoring, and incident response.

---

## Critical Contracts (Non-Negotiable)

These contracts apply to ALL operations and must NEVER be violated:

**🔒 SCORING SCALE: 0–1000 EVERYWHERE**
- Total score: 0–1000 (not 0–100, not percentages)
- Each pillar: 0–125 (8 pillars × 125 = 1000)
- All thresholds, comparisons, displays, and API responses use this scale
- Database columns: `INTEGER` (not DECIMAL, not VARCHAR)

**🔒 ISSUE DETECTION IS DETERMINISTIC (NO LLM)**
- Issue detection uses rules-based logic only (`14-detection-rules.md`)
- LLM is used only for copy generation (with template fallback)
- If all LLM APIs fail, recommendations still appear (from templates)

**🔒 NEVER ZERO RECOMMENDATIONS**
- `GET /api/scans/:id/recommendations` NEVER returns empty array
- If issues exist → return actionable recommendations
- If no issues → return "locked" state with positive message
- If error → return template-based fallback

---

## 1. Scan Complete

A scan is considered **complete** when ALL of the following are true:

### Database State
- [ ] `scans.status` = `'complete'`
- [ ] `scans.completed_at` is set (not NULL)
- [ ] `scan_results` row exists with `scan_id` FK
- [ ] `scan_results.total_score` is between 0-1000
- [ ] All 8 pillar scores are populated (not NULL)
- [ ] `scan_evidence` row exists with extracted data
- [ ] At least 1 recommendation exists for this scan

### Detection Scope
Scan must check for (see `14-detection-rules.md` for implementation details):

| Pillar | Internal ID | What We Detect |
|--------|-------------|----------------|
| Schema Markup | `schema_markup` | Organization, FAQPage, Product, Article, LocalBusiness JSON-LD |
| Content Structure | `content_structure` | H1 presence, heading hierarchy, paragraph length, FAQ sections |
| Entity Recognition | `entity_recognition` | Brand mentions, product names, service keywords, founder/team |
| Trust & Authority | `trust_authority` | About page, team page, certifications, testimonials, press mentions |
| Citation Worthiness | `citation_worthiness` | Statistics, original research, expert quotes, source links |
| Voice Optimization | `voice_optimization` | Question-format content, conversational tone, direct answers |
| Speed & UX | `speed_ux` | Page load time, mobile-friendly, Core Web Vitals |
| Technical Setup | `technical_setup` | Robots.txt, sitemap, HTTPS, canonical tags, meta descriptions |

**Note:** Internal IDs (column 2) are used in code, database, and API. Canonical names (column 1) are used in reports and UI. See `13-pillar-display-map.json` for full mapping.

### Timing
- [ ] Scan completed within 60 seconds (soft limit)
- [ ] Scan completed within 120 seconds (hard limit, else timeout)

### Job State
- [ ] `jobs.status` = `'complete'`
- [ ] `jobs.steps_completed` includes: `['crawling', 'scoring', 'recommendations']`
- [ ] `jobs.output_result` contains summary metadata

### NOT Complete If
- ❌ `scans.status` = `'failed'` or `'timeout'`
- ❌ `scan_results` row missing
- ❌ Any pillar score is NULL
- ❌ Zero recommendations generated
- ❌ `jobs.status` = `'failed'`

---

## 2. Recommendations Generated

Recommendations are considered **generated** when ALL of the following are true:

### Quantity
- [ ] At least 1 recommendation exists for the scan
- [ ] For scores < 600: minimum 5 recommendations
- [ ] For scores 600-800: minimum 3 recommendations  
- [ ] For scores > 800: minimum 1 recommendation (maintenance/optimization)

### Quality
- [ ] Every recommendation has `title` (not empty)
- [ ] Every recommendation has `category` (valid pillar ID)
- [ ] Every recommendation has `marketing_copy` populated
- [ ] Every recommendation has `impact` (high/medium/low)
- [ ] Every recommendation has `display_order` set

### Structure
- [ ] Recommendations are de-duplicated (no exact title matches)
- [ ] `is_locked` flags applied based on user's plan
- [ ] `required_plan` set for locked recommendations

### Diagnostic Fallback
If detector finds 0 issues:
- [ ] Create 1 diagnostic recommendation
- [ ] Title: "Your site is well-optimized"
- [ ] Category: "maintenance"
- [ ] Include: what was checked, why no issues found

### NOT Generated If
- ❌ Zero recommendations in database
- ❌ Any recommendation missing title
- ❌ All recommendations have same title (duplicate bug)
- ❌ `marketing_copy` is NULL or empty string

---

## 3. User Authentication

Authentication is **successful** when:

### Login
- [ ] Valid credentials → JWT access token returned
- [ ] Refresh token set as HttpOnly cookie
- [ ] `users.last_login` updated
- [ ] `users.failed_login_attempts` reset to 0

### Signup  
- [ ] User row created with hashed password (bcrypt, cost 12)
- [ ] Personal organization created automatically
- [ ] User added as 'owner' of personal org
- [ ] Verification email sent within 30 seconds
- [ ] Response includes `requiresVerification: true`

### Email Verification
- [ ] 6-digit code validated
- [ ] `users.email_verified` set to `true`
- [ ] New tokens issued with verified status
- [ ] User can access protected routes
- [ ] Onboarding wizard triggered (see Section 9)

### Password Security
- [ ] Minimum 8 characters enforced
- [ ] Password hashed with bcrypt (cost factor 12)
- [ ] Failed attempts tracked and rate-limited (5 per 15min)
- [ ] Account lockout after 10 consecutive failures

### NOT Successful If
- ❌ Password stored in plaintext
- ❌ No organization created for new user
- ❌ Tokens returned for unverified user without flag
- ❌ Failed login doesn't increment attempts counter

---

## 4. Usage Tracking

Usage is **tracked correctly** when:

### Period Management
- [ ] Current period determined by subscription billing cycle (paid) or calendar month (free)
- [ ] `usage_periods` row exists for current period
- [ ] Period boundaries align with Stripe `current_period_start/end`

### Event Recording
- [ ] Each scan creates `usage_events` row
- [ ] Event linked to correct `period_id`
- [ ] `usage_periods.scan_count` incremented

### Quota Checking
- [ ] `can_scan` returns `false` when at limit
- [ ] Quota check happens BEFORE scan starts
- [ ] User sees clear "quota exceeded" message

### Period Rollover
- [ ] New period starts automatically when old one ends
- [ ] No cron job required
- [ ] First scan of new period creates new period row

### NOT Tracked Correctly If
- ❌ Usage counter manually reset by cron
- ❌ Events not linked to periods
- ❌ Scan starts when user is at quota
- ❌ Period boundaries don't match Stripe

---

## 5. Stripe Webhook Processing

Webhook is **processed correctly** when:

### Idempotency
- [ ] Event ID checked in `webhook_events` table
- [ ] Duplicate events skipped (not reprocessed)
- [ ] New events recorded before processing

### Subscription Events
- [ ] `checkout.session.completed` → org plan updated
- [ ] `customer.subscription.updated` → period dates synced
- [ ] `customer.subscription.deleted` → org downgraded to free
- [ ] `invoice.payment_failed` → org marked `past_due`

### Data Consistency
- [ ] `subscriptions.current_period_start/end` match Stripe
- [ ] `organizations.plan` matches subscription status
- [ ] Entitlements immediately reflect new plan

### NOT Processed Correctly If
- ❌ Same event processed multiple times
- ❌ Plan doesn't update after successful checkout
- ❌ Period dates out of sync with Stripe
- ❌ Webhook returns 500 (causes Stripe retries)

---

## 6. Healthy System

System is **healthy** when health endpoint returns:

```json
{
  "status": "healthy",
  "timestamp": "2026-01-03T12:00:00Z",
  "checks": {
    "database": { "status": "up", "latency_ms": 5 },
    "redis": { "status": "up", "latency_ms": 2 },
    "stripe": { "status": "up" },
    "ai_provider": { "status": "up" }
  },
  "version": "2.1.0"
}
```

### Individual Checks
- [ ] **Database:** Can execute `SELECT 1` within 100ms
- [ ] **Redis:** Can `PING` within 50ms
- [ ] **Stripe:** API key valid (cached check, refresh every 5min)
- [ ] **AI Provider:** API key valid (cached check)

### Degraded State
System is **degraded** (not down) when:
- AI provider unavailable → use fallback templates
- Redis unavailable → skip caching, continue
- Non-critical service unavailable

### NOT Healthy If
- ❌ Database unreachable
- ❌ Any check throws unhandled exception
- ❌ Health endpoint itself returns 500

---

## 7. API Response

API response is **correct** when:

### Success Response (2xx)
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "request_id": "req_abc123",
    "timestamp": "2026-01-03T12:00:00Z"
  }
}
```

### Error Response (4xx/5xx)
```json
{
  "success": false,
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "You've used all 2 scans this month",
    "details": {
      "used": 2,
      "limit": 2,
      "resets_at": "2026-02-01T00:00:00Z"
    }
  },
  "meta": {
    "request_id": "req_abc123",
    "timestamp": "2026-01-03T12:00:00Z"
  }
}
```

### Required Fields
- [ ] Every response has `request_id` for correlation
- [ ] Every error has `code` (machine-readable)
- [ ] Every error has `message` (human-readable)
- [ ] HTTP status matches error type (400 vs 401 vs 500)

### NOT Correct If
- ❌ Success response with error inside
- ❌ Missing request_id
- ❌ Generic "Something went wrong" without code
- ❌ 200 status with error body

---

## 8. Domain Verification

Domain verification is **successful** when:

### MVP Method: Meta Tag
- [ ] Unique token generated for each domain claim (`v2ai_<random>`)
- [ ] User instructed to add: `<meta name="visible2ai-verification" content="<token>">`
- [ ] System fetches homepage and parses for meta tag
- [ ] Token matches exactly (case-sensitive)
- [ ] `domains.verified_at` timestamp set
- [ ] `domains.verification_method` = `'meta_tag'`

### Verification Flow
- [ ] Token generated on "Add Domain" action
- [ ] User shown copy-paste instructions
- [ ] "Verify" button triggers check
- [ ] Success: domain marked verified, user can scan
- [ ] Failure: clear error message ("Meta tag not found" or "Token mismatch")

### Re-verification
- [ ] Verified domains checked periodically (every 30 days)
- [ ] If meta tag removed, domain marked `verification_lapsed`
- [ ] User notified via email
- [ ] Scanning still allowed for 7-day grace period

### Future Methods (Not MVP)
- HTML file upload: `visible2ai-verify-<token>.html`
- DNS TXT record: `visible2ai-verification=<token>`

### NOT Verified If
- ❌ Token not found on homepage
- ❌ Token found but doesn't match
- ❌ Homepage returns non-200 status
- ❌ Redirect chain > 3 hops
- ❌ SSL certificate invalid

---

## 9. User Onboarding

Onboarding is **successful** when:

### Trigger
- [ ] Wizard appears after first email verification
- [ ] Wizard is skippable ("Skip for now" visible)
- [ ] Progress indicator shows steps (1 of 2)
- [ ] Does NOT block access to scanning

### Step 1 Data Captured (Required fields)
- [ ] `user_profiles.role` - enum: marketing, founder, product, sales, dev, agency, other
- [ ] `org_profiles.company_type` - enum: b2b_saas, msp, telecom, agency, ecommerce, professional_services, other
- [ ] `org_profiles.primary_goal` - enum: be_recommended, fix_basics, content_plan, competitor_compare
- [ ] Website URL captured:
  - `domains.domain` = normalized domain (e.g., `"example.com"`)
  - `domains.display_url` = full URL (e.g., `"https://example.com"`)

### Step 2 Data Captured (Optional fields)
- [ ] `org_profiles.target_audience` - enum: smb, mid_market, enterprise, consumer
- [ ] `org_profiles.icp_keywords` - text array (e.g., ["CPaaS", "billing"])
- [ ] `org_profiles.regions` - text array (e.g., ["North America", "EMEA"])

### Personalization Applied
- [ ] Role = 'dev' → `recommendation_view` defaults to 'technical'
- [ ] Role = 'marketing'/'founder' → `recommendation_view` defaults to 'marketing'
- [ ] Company type → influences FAQ templates suggested
- [ ] Primary goal → affects recommendation priority/ordering
- [ ] ICP keywords → used in content generation (Phase 2)

### Completion States
- [ ] `users.onboarding_completed_at` set when finished
- [ ] `users.onboarding_skipped_at` set if skipped
- [ ] Incomplete onboarding → show reminder banner (not blocker)

### NOT Successful If
- ❌ Wizard blocks scanning
- ❌ Required fields not validated
- ❌ Personalization not applied to recommendations
- ❌ User can't edit later in Settings

---

## 10. Team Management (Enterprise)

Team management is **successful** when:

### Invite Flow
- [ ] Owner can invite by email
- [ ] Invitation email sent with unique token
- [ ] Token expires after 7 days
- [ ] Invitee can accept/decline

### Role Assignment
- [ ] `owner` - full access, billing, can delete org
- [ ] `admin` - full access except billing
- [ ] `member` - can scan, view results
- [ ] `viewer` - read-only access

### Access Control
- [ ] Members see only their org's data
- [ ] Viewers cannot initiate scans
- [ ] Only owner can change billing
- [ ] Only owner/admin can invite/remove members

### NOT Successful If
- ❌ Invitee can access org before accepting
- ❌ Member can see other org's scans
- ❌ Non-owner can access billing portal
- ❌ Removed member retains access

---

## 11. Multi-Factor Authentication (Future)

MFA is **successful** when:

### Enrollment
- [ ] User can enable MFA in Settings
- [ ] TOTP (authenticator app) supported
- [ ] Recovery codes generated (10 codes)
- [ ] Recovery codes shown once, user must save

### Login with MFA
- [ ] After password, prompt for TOTP code
- [ ] Code validated (30-second window, ±1 drift)
- [ ] Recovery code accepted as fallback
- [ ] Used recovery codes marked as consumed

### NOT Successful If
- ❌ MFA can be disabled without re-authentication
- ❌ Recovery codes reusable
- ❌ No rate limiting on code attempts

---

## Monitoring Thresholds

### Alerting Triggers

| Metric | Warning | Critical |
|--------|---------|----------|
| Scan success rate | < 95% | < 90% |
| Scan p95 latency | > 30s | > 60s |
| Zero-rec scans | > 1% | > 5% |
| API error rate | > 1% | > 5% |
| Health endpoint | degraded | unhealthy |
| Webhook failures | > 0.1% | > 1% |
| Domain verification failures | > 10% | > 25% |
| Onboarding completion | < 50% | < 30% |

### Key Queries

```sql
-- Zero-rec scan detection (CRITICAL if > 0)
SELECT s.id, s.status, sr.total_score, COUNT(r.id) as rec_count
FROM scans s
JOIN scan_results sr ON s.id = sr.scan_id
LEFT JOIN recommendations r ON s.id = r.scan_id
WHERE s.status = 'complete'
  AND s.created_at > NOW() - INTERVAL '24 hours'
GROUP BY s.id, s.status, sr.total_score
HAVING COUNT(r.id) = 0;

-- Scan success rate
SELECT 
  COUNT(*) FILTER (WHERE status = 'complete') * 100.0 / COUNT(*) as success_rate
FROM scans
WHERE created_at > NOW() - INTERVAL '1 hour';

-- Average scan duration
SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_seconds
FROM scans
WHERE status = 'complete'
  AND created_at > NOW() - INTERVAL '1 hour';

-- Onboarding completion rate
SELECT 
  COUNT(*) FILTER (WHERE onboarding_completed_at IS NOT NULL) * 100.0 / COUNT(*) as completion_rate
FROM users
WHERE created_at > NOW() - INTERVAL '7 days';

-- Domain verification success rate
SELECT 
  COUNT(*) FILTER (WHERE verified_at IS NOT NULL) * 100.0 / COUNT(*) as verification_rate
FROM domains
WHERE created_at > NOW() - INTERVAL '7 days';
```

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `14-detection-rules.md` | What we scan for (implementation details) |
| `15-onboarding-wizard-spec.md` | Onboarding UX and copy |
| `16-domain-verification-spec.md` | Domain verification implementation |
| `10-entitlements.v1.json` | Plan limits and features |

---

## Checklist for Each Release

Before deploying:

- [ ] All success criteria tests passing
- [ ] Zero-rec query returns 0 results on staging
- [ ] Scan success rate > 95% on staging
- [ ] Health endpoint returns healthy
- [ ] No new Sentry errors in staging
- [ ] Domain verification flow tested
- [ ] Onboarding wizard tested

After deploying:

- [ ] Health endpoint returns healthy in production
- [ ] Run 3 test scans, verify recommendations generated
- [ ] Check zero-rec query in production
- [ ] Monitor error rate for 30 minutes
- [ ] Verify onboarding wizard appears for new signups

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.3 | 2026-01-03 | Added Critical Contracts section (0-1000 scale, deterministic detection, never zero) |
| 2.2 | 2026-01-03 | Expanded domain field mapping (`domain` + `display_url`) for full consistency |
| 2.1 | 2026-01-03 | Added pillar internal IDs to detection scope table, fixed domain field naming |
| 2.0 | 2026-01-03 | Added: Domain Verification, Onboarding, Detection Scope, Team Management, MFA |
| 1.0 | 2026-01-03 | Initial version |
