# Visible2AI — Onboarding Wizard Specification (v1.6)
**Last updated:** 2026-01-03  
**Status:** Proposed → Ready for implementation (post–Phase 0 contracts)  

This document consolidates the onboarding wizard requirements **plus** the latest fixes/recommendations (state machine hardening, finite reminders, domain claim/verification rules, security/SSRF guardrails, enum drift prevention, analytics, and test coverage).

---

## 0. Goals

### 0.1 Primary goals
- Get users to **first value fast**: run a first scan and view recommendations.
- Collect **minimum viable context** to personalize recommendations, templates, and UI defaults.
- Preserve **marketing-first language** while keeping technical detail opt-in.

### 0.2 Non-goals
- Onboarding must **not** block scanning for plans that do not require verification.
- Onboarding is not a full CRM profile system (progressive profiling only).

---

## 1. Product Principles (applied here)

- **Marketing-first language:** default shows WHY/WHAT; HOW is available via expand/toggle and/or plan entitlement.
- **No silent failures:** onboarding endpoints always return standard error envelope + `meta.request_id`.
- **Site-first, page optional:** onboarding captures the **primary domain** for the first site scan (page-level is future).
- **Score scale contract:** onboarding does not compute scoring, but must not introduce type drift (IDs, enums, etc.).

---

## 2. User Experience Summary

### 2.1 When the wizard appears
Wizard prompt appears after **first successful email verification** and first authenticated session.

**Show prompt** on login if ALL are true:
- `users.email_verified_at` is set
- `users.onboarding_completed_at` is NULL
- `users.onboarding_skipped_at` is NULL
- `users.onboarding_started_at` is NULL
- `users.onboarding_prompt_snooze_until` is NULL OR <= now

**User closes prompt without action**:
- set `users.onboarding_prompt_closed_at = now`
- set `users.onboarding_prompt_snooze_until = now + 24h` (prevents prompt spam)
- DO NOT set started/skipped/completed

**User clicks “Get Started”**:
- set `users.onboarding_started_at = now`
- open Step 1

**User clicks “Skip for now” on prompt**:
- set `users.onboarding_skipped_at = now`
- show a reminder later (see §6)

> Rationale: “Close” is neither “started” nor “skipped”; we snooze for 24h to prevent repeated prompts in the same day.

### 2.2 Wizard steps (progressive profiling)
- **Step 1 (required):** role, company type, primary goal, website URL (if not already known)
- **Step 2 (optional):** ICP keywords, target regions, target audience (B2B/B2C), competitive set (future)

### 2.3 Completion semantics
- Step 1 submission **does not** set `onboarding_completed_at`
- Step 2 submission **does** set `onboarding_completed_at`
- Step 2 skip **does not** set `onboarding_completed_at`
- Users can set `onboarding_completed_at` later via **Settings → Profile → Finish onboarding**

---

## 3. Data Model

### 3.1 Tables (new or referenced)
- `users` (existing)
- `user_profiles` (new)
- `organizations` (existing)
- `org_profiles` (new)
- `domains` (existing/foundation)
- `domain_verifications` (future / referenced by spec 16)

### 3.2 Users table additions
Add these fields (all nullable):
- `onboarding_prompt_shown_at TIMESTAMP`
- `onboarding_prompt_closed_at TIMESTAMP`
- `onboarding_prompt_snooze_until TIMESTAMP`
- `onboarding_started_at TIMESTAMP`
- `onboarding_skipped_at TIMESTAMP`
- `onboarding_completed_at TIMESTAMP`
- `onboarding_reminder_dismissed_at TIMESTAMP`
- `onboarding_reminder_count INTEGER DEFAULT 0`
- `onboarding_reminder_snooze_until TIMESTAMP` (optional; used if you prefer “snooze” vs “dismiss”)
- `email_verified_at TIMESTAMP` (if not already present)

### 3.3 user_profiles (per-user)
```sql
CREATE TABLE IF NOT EXISTS user_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  role_other_text TEXT,
  recommendation_view TEXT NOT NULL DEFAULT 'marketing', -- 'marketing'|'technical'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);
```

### 3.4 org_profiles (per-org)
```sql
CREATE TABLE IF NOT EXISTS org_profiles (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_type TEXT NOT NULL,
  primary_goal TEXT NOT NULL,
  target_audience TEXT, -- 'b2b'|'b2c'|'both'
  icp_keywords TEXT[],  -- if Postgres; else store as JSON text
  regions TEXT[],       -- if Postgres; else store as JSON text
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(organization_id)
);
```

### 3.5 Domains: multi-claim until verified
This onboarding spec assumes domains are **org-scoped** (supports multiple orgs claiming same domain until verification is complete).

**Required constraint:**
- `UNIQUE(organization_id, domain)`

**Recommended columns (already in foundation schema or add if missing):**
- `domains.organization_id` (NOT NULL)
- `domains.domain` (normalized host, e.g., `example.com`)
- `domains.display_url` (canonical URL for UI, e.g., `https://example.com`)
- `domains.input_url` (raw input for audit/debug)
- `domains.is_reachable` (NULL|true|false)
- `domains.last_reachability_checked_at`
- `domains.last_reachability_error`
- `domains.reachability_fail_count INTEGER DEFAULT 0`
- `domains.is_verified BOOLEAN DEFAULT false`
- `domains.verified_at`, `domains.verified_method`

---

## 4. Enum Contracts (prevent drift)

Backend MUST validate enums. Unknown values → `VALIDATION_INVALID_ENUM`.

### 4.1 role enum
- `marketing`
- `product`
- `founder`
- `sales`
- `developer`
- `seo`
- `agency`
- `other`

### 4.2 company_type enum
Keep this list **exactly aligned** with UI options (choose one canonical set). Example canonical set:
- `b2b_saas`
- `ai_company`
- `telecom`
- `msp`
- `it_services`
- `ecommerce`
- `professional_services`
- `nonprofit`
- `other`

(If you want vertical-specific variants later, add them in a versioned update; do not let UI outgrow backend allowlist.)

### 4.3 primary_goal enum
- `get_discovered`
- `get_recommended`
- `increase_leads`
- `improve_trust`
- `benchmark_competitors`

### 4.4 regions enum
- `north_america`
- `europe`
- `uk_ireland`
- `middle_east`
- `asia_pacific`
- `latam`
- `africa`
- `global`

### 4.5 target_audience enum
- `b2b`
- `b2c`
- `both`

### 4.6 Contract test (required)
Add a CI test that asserts:
- UI option lists == backend enum allowlists
- Any change requires a version bump in this spec and OpenAPI.

---

## 5. Domain Handling & Verification

### 5.1 URL normalization
On Step 1 submission:
1) Parse `website_url`
2) Enforce scheme: http/https only
3) Normalize host → `domain` (lowercase, strip `www.`, remove port)
4) Set `display_url` to canonical `https://{domain}` unless user supplied `http://` only

### 5.2 Domain linking behavior (idempotent)
- If `(org_id, domain)` exists → reuse it
- Else create a new row scoped to org

**Never** reject a domain because it exists for another org (avoid domain enumeration and allow multi-claim).

### 5.3 Verification policy (decide and document)
You MUST choose one policy to avoid future ambiguity:

**Option A — Non-exclusive verification (recommended):**
- Multiple orgs can verify the same domain.
- Verification means “proof of control,” not exclusive ownership.
- Scans and recommendations are scoped by org+domain record.

**Option B — Exclusive claim (future/advanced):**
- First verified org becomes the “owner.”
- Other orgs are blocked from verifying; they can still scan unverified if allowed, or must contact support.

**v1.6 default:** Option A (non-exclusive).  
If you later move to exclusive claim, it must be a **breaking policy change** with a migration/support path.

### 5.4 Entitlement gating
If entitlements require verification:
- Step 1 CTA becomes **“Verify Domain to Scan”**
- Scan endpoints must block with a verification-required error code (per Error Catalog)

If verification is optional:
- Show “Unverified” badge in Settings → Domains
- Allow scans immediately

---

## 6. Reminder Banner Logic (finite + non-annoying)

### 6.1 When to show reminder banner
Show reminder on dashboard if:
- `onboarding_completed_at IS NULL`
AND
- user has explicitly engaged with onboarding OR has demonstrated product intent:
  - `onboarding_started_at IS NOT NULL` OR
  - `onboarding_skipped_at IS NOT NULL` OR
  - user has at least one scan completed

AND
- reminder is not snoozed:
  - `onboarding_reminder_dismissed_at IS NULL` OR `onboarding_reminder_dismissed_at <= now - 7 days`
AND
- `onboarding_reminder_count < 2`

### 6.2 Dismiss behavior
When user clicks “Dismiss”:
- Atomically increment `onboarding_reminder_count = onboarding_reminder_count + 1`
- Set `onboarding_reminder_dismissed_at = now`
- Hide for 7 days

After 2 dismisses:
- Do not show reminder again unless user explicitly opens onboarding from Settings.

---

## 7. Personalization Logic

### 7.1 Default recommendation view by role
- `developer` → default `recommendation_view = 'technical'`
- everyone else → default `recommendation_view = 'marketing'`

### 7.2 Priority boosts (safe ordering)
On rec generation or display ordering:
- apply small boosts based on `primary_goal`
- **cap boosts** (e.g., max 20)
- ensure `display_order` never goes below 0
- stable tie-breakers: `(display_order, priority, created_at)`

### 7.3 Templates & content
- Use `company_type`, `target_audience`, and `icp_keywords` to select FAQ templates and copy tone.
- Step 2 microcopy should explain WHY each optional field helps (FAQ templates, recommendation prioritization).

---

## 8. Reachability Checks (async)

### 8.1 Behavior
- Validate URL format synchronously.
- Run reachability checks asynchronously after Step 1 submit.
- Reachability failures **do not block onboarding** and **do not block scans** unless entitlements require verification.

### 8.2 SSRF protections (required)
- allow http/https only
- block credentials in URL (`user:pass@host`)
- resolve DNS → block private/loopback/link-local (IPv4 + IPv6)
- re-resolve DNS on each redirect hop (DNS rebinding guard)
- cap redirects (<= 3)
- timeout <= 5s
- max bytes <= 200KB
- user-agent fixed; no cookies; no auth headers
- record `last_reachability_error` without leaking internal network details

### 8.3 Logging/alerting
- first failure: log `info`
- warn after 3 consecutive failures for **primary domain**
- do not send to Sentry unless it indicates systemic outage (e.g., fetch service down)

---

## 9. API Endpoints (standard envelope)

All endpoints return:
```json
{ "success": true|false, "data": {...} | null, "error": {...} | null, "meta": { "request_id": "...", "timestamp": "..." } }
```

### 9.1 GET /api/onboarding/status
Returns computed status:
- `prompt_should_show`
- `step1_complete`
- `step2_has_data`
- `completed`
- `show_reminder`
- `requires_domain_verification`
- `primary_domain_id` (nullable)

### 9.2 POST /api/onboarding/step1
Input:
- `role`, `role_other_text?`
- `company_type`
- `primary_goal`
- `website_url` (required if no primary domain)

Output:
- linked/created `domain_id`
- computed `requires_domain_verification`
- next CTA: `verify_domain` | `run_first_scan` | `continue_step2`

### 9.3 POST /api/onboarding/step2
Input:
- `icp_keywords?`
- `regions?`
- `target_audience?`

Output:
- sets `onboarding_completed_at`
- redirect CTA: `verify_domain` | `run_first_scan` | `view_dashboard`

### 9.4 POST /api/onboarding/skip
- Used for prompt skip and step skip (include `context: 'prompt'|'step2'`)
- Sets `onboarding_skipped_at` (if prompt skip) OR records step2 skip event
- Does not set completed

### 9.5 Errors
Use Error Codes Catalog (v1.1):
- `VALIDATION_INVALID_ENUM`
- `VALIDATION_INVALID_URL`
- `RATE_LIMIT_EXCEEDED`
- `AUTHZ_PLAN_REQUIRED` (402 for upgrade-fixable gating)
- domain verification required error (as per domain verification spec)

---

## 10. Rate Limiting (abuse protection)

Recommended limits:
- Step 1: 10/min/user, 100/day/user, 500/day/org
- Step 2: 10/min/user, 100/day/user, 500/day/org
- Skip: 30/min/user

Return 429 with standard envelope and `Retry-After`.

---

## 11. Analytics Events (required)

Emit:
- `onboarding_prompt_shown`
- `onboarding_prompt_closed` (no action)
- `onboarding_prompt_skipped`
- `onboarding_started`
- `onboarding_step1_submitted`
- `onboarding_step2_submitted`
- `onboarding_step2_skipped`
- `onboarding_reminder_shown`
- `onboarding_reminder_dismissed`
- `onboarding_completed`

Include properties:
- `user_id`, `org_id`
- `domain_id`, `domain`
- `requires_domain_verification`
- `has_existing_domain`
- `is_reachable` (nullable)
- `company_type`, `role`, `primary_goal`
- step timing (`time_to_step1_ms`, `time_to_step2_ms`)

### Key activation KPIs
- % users with **first scan completed within 10 minutes** of email verification (or within 10 minutes of domain verification for gated plans)
- % users who **view recommendations** within X minutes of scan completion

---

## 12. Testing Checklist (minimum)

### State machine
- prompt shown → closed (snooze 24h) → not nagging
- prompt skip sets skipped and later reminder behavior
- started on mobile → reminder on desktop (resume CTA)

### Step flows
- step1 submit with new domain → creates domain record, links primary
- step1 submit with existing domain in same org → reuses
- step1 submit with same domain in different org → new claim created, no enumeration
- step2 submit sets completed
- step2 skip does not set completed; reminder appears later

### Verification gating
- plan requires verification → scan blocked until verified; CTA points to verification
- plan optional → scans allowed immediately

### SSRF & reachability
- blocks private IPv4/IPv6, loopback, metadata
- blocks credentialed URLs
- redirect chain cap and DNS re-resolve enforced

### Enum drift contract test
- UI list equals backend allowlist

### Reminder logic
- dismiss hides for 7 days
- max 2 dismisses then stops

---

## 13. Open Questions (must decide before build)
1) Prompt re-show policy beyond 24h snooze for repeated closes (e.g., max N closes before suppress)?
2) Domain verification policy: keep **non-exclusive** (recommended) or move to exclusive ownership later?

---

## Appendix: Implementation Notes
- If you support SQLite in any environment, replace `TEXT[]` with JSON strings and parse in application code.
- Ensure onboarding routes always include correlation IDs and standard error envelopes (no HTML errors).
