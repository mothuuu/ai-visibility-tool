# Visible2AI — Domain Verification Specification (v1.2)

**Status:** Canonical (Phase 0 contract)  
**Last updated:** 2026-01-03  
**Applies to:** Domain management, onboarding, scan gating, agency/multi-org readiness

---

## 1. Purpose

Domain verification proves that a user (and their organization) controls a website domain. It enables:

- **Secure scan ownership** (prevent scanning/report access hijacking)
- **Enterprise/Agency workflows** (multiple users, multiple orgs, multiple domains)
- **Clean gating rules** for plans that require verified domains before scanning
- **Reliable attribution** of scans, recommendations, exports, and reports to an org-owned domain

This spec is a contract for **DB schema expectations**, **API behaviors**, **error semantics**, and **implementation rules**.

---

## 2. Core decisions (locked)

### 2.1 Verification is **non-exclusive**
**Decision:** Multiple organizations can verify the same domain in Visible2AI.

**Why:**
- Agencies/resellers legitimately manage the same client domain
- Avoids “ownership disputes” and support burden
- Verification = **proof of control**, not legal ownership

**Implementation note:** Domains are scoped by org (`UNIQUE(organization_id, domain)`), so each org has its own domain record and verification state.

### 2.2 Verification methods (phased)
- **MVP (Phase 1):** HTML meta tag verification
- **Phase 2:** HTML file verification + DNS TXT verification (optional)
- **Phase 3+:** Google Search Console integration, Cloudflare token, etc. (optional)

### 2.3 Robots.txt does **not** block verification
Verification is not crawling content; it is an ownership check.
- Verification requests should **not** be denied due to robots.txt.
- **Scanning/crawling** may still respect robots.txt (separate concern, separate errors).

### 2.4 Standard API response envelope
All endpoints return the platform standard envelope:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": { "request_id": "req_...", "timestamp": "..." }
}
```

Errors use the canonical error catalog codes + HTTP semantics.

---

## 3. Data Model (contract)

### 3.1 Table: `domains`
Each organization can store and verify the same domain independently.

**Uniqueness**
- `UNIQUE(organization_id, domain)` (not global unique)

**Required fields (minimum)**
- `id` (int, PK)
- `organization_id` (int, FK)
- `domain` (text) — normalized host (no scheme, no path), lowercase, no leading `www.`
- `display_url` (text) — canonicalized URL for UI (usually `https://{domain}`)
- `input_url` (text) — original user-entered URL (for audit/debug)
- `verification_token` (text) — generated token used by verification methods
- `verification_status` (enum) — `unverified | pending | verified | lapsed | failed`
- `verification_method` (enum nullable) — `meta_tag | html_file | dns_txt`
- `verified_at` (timestamp nullable)
- `last_checked_at` (timestamp nullable)
- `last_error_code` (text nullable)
- `last_error_message` (text nullable)
- `created_at`, `updated_at`

**Recommended fields (strongly suggested)**
- `verification_expires_at` (timestamp nullable) — used only if you implement token expiry
- `is_reachable` (boolean nullable) — reachability is UX-only unless you choose to enforce it
- `reachability_checked_at` (timestamp nullable)
- `reachability_fail_count` (int default 0)

### 3.2 Domain normalization rules (locked)
When a user submits a URL/domain:
1. Parse URL; allow `http/https` only.
2. Extract host; lowercase.
3. Remove leading `www.`.
4. Remove trailing dot.
5. Keep **subdomains distinct** (e.g., `blog.example.com` is different from `example.com`).
6. Store:
   - `domains.domain` = normalized host
   - `domains.input_url` = original input
   - `domains.display_url` = canonical `https://{domains.domain}` unless a different canonical is established later

### 3.3 Subdomain policy (locked)
- `www.example.com` and `example.com` are treated as the same domain (normalized to `example.com`).
- Other subdomains (e.g., `blog.example.com`) require separate domain records and verification.
- Plans may count subdomains as separate “domains” for limits (entitlements decides).

---

## 4. API Endpoints (contract)

> All endpoints require `Authorization: Bearer <token>` unless noted.

### 4.1 Create or link a domain
`POST /api/domains`

**Request**
```json
{ "website_url": "https://www.example.com/some/path" }
```

**Behavior**
- Normalizes domain.
- Upserts domain for the org:
  - If `(org, domain)` exists → return existing record
  - Else create new domain record with a new token
- **Does NOT auto-verify**.

**Success (201 created or 200 existing)**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "organization_id": 7,
    "domain": "example.com",
    "display_url": "https://example.com",
    "input_url": "https://www.example.com/some/path",
    "verification_status": "unverified",
    "verification_method": null,
    "verification_token": "v2ai_7f8a9b2c3d4e...",
    "verified_at": null
  },
  "error": null,
  "meta": { "request_id": "req_...", "timestamp": "..." }
}
```

**Errors**
- `VALIDATION_INVALID_URL` (422)
- `AUTH_REQUIRED` (401)
- `ORG_NOT_FOUND` (404) (if org context invalid)

---

### 4.2 Get domain details
`GET /api/domains/{domain_id}`

**Errors**
- `DOMAIN_NOT_FOUND` (404)

---

### 4.3 Start verification (set method + return instructions)
`POST /api/domains/{domain_id}/verify/start`

**Request**
```json
{ "method": "meta_tag" }
```

**Behavior**
- Sets `verification_method`
- Sets `verification_status` → `pending`
- Returns instructions + token

**Success (200)**
```json
{
  "success": true,
  "data": {
    "domain_id": 123,
    "domain": "example.com",
    "method": "meta_tag",
    "token": "v2ai_...",
    "instructions": {
      "steps": [
        "Add the meta tag to the <head> of your homepage",
        "Wait for your site to publish",
        "Click Verify"
      ],
      "meta_tag": "<meta name=\"visible2ai-verification\" content=\"v2ai_...\" />"
    }
  },
  "error": null,
  "meta": { "request_id": "req_...", "timestamp": "..." }
}
```

**Errors**
- `DOMAIN_NOT_FOUND` (404)
- `DOMAIN_ALREADY_VERIFIED` (409)
- `VALIDATION_REQUIRED_FIELD` (422)
- `VALIDATION_INVALID_ENUM` (422)

---

### 4.4 Perform verification check
`POST /api/domains/{domain_id}/verify/check`

**Request**
```json
{ "method": "meta_tag" }
```

**Success: Verified (200)**
```json
{
  "success": true,
  "data": {
    "domain_id": 123,
    "verification_status": "verified",
    "verified_at": "2026-01-03T12:34:56Z",
    "verification_method": "meta_tag"
  },
  "error": null,
  "meta": { "request_id": "req_...", "timestamp": "..." }
}
```

**Success: Pending (202)**  
Use when DNS propagation is expected (DNS TXT method) or async verification is in progress.
```json
{
  "success": true,
  "data": { "domain_id": 123, "verification_status": "pending" },
  "error": null,
  "meta": { "request_id": "req_...", "timestamp": "..." }
}
```

**Failure: Not verified (422)**  
Uses canonical code `DOMAIN_VERIFICATION_FAILED`. Provide details.reason for diagnostic clarity.
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "DOMAIN_VERIFICATION_FAILED",
    "message": "Domain verification failed",
    "details": {
      "method": "meta_tag",
      "reason": "META_TAG_NOT_FOUND",
      "checked_url": "https://example.com",
      "help": "Make sure the meta tag is inside <head> on the homepage."
    }
  },
  "meta": { "request_id": "req_...", "timestamp": "..." }
}
```

**Rate limit (429)**
- `RATE_LIMIT_EXCEEDED` with standard retry headers

**Errors**
- `DOMAIN_NOT_FOUND` (404)
- `DOMAIN_ALREADY_VERIFIED` (409)
- `DOMAIN_VERIFICATION_FAILED` (422)
- `DOMAIN_VERIFICATION_PENDING` (202)
- `RATE_LIMIT_EXCEEDED` (429)

---

### 4.5 Regenerate verification token
`POST /api/domains/{domain_id}/verify/token/regenerate`

**Behavior**
- Generates a new token
- Resets verification state:
  - `verification_status='unverified'`
  - clears `verified_at`
  - clears `verification_method`
  - clears last error fields

**Errors**
- `DOMAIN_NOT_FOUND` (404)
- `DOMAIN_ALREADY_VERIFIED` (409) (optional rule: disallow regeneration for verified domains unless forcing reverify)

---

## 5. Scan gating rules (contract)

### 5.1 Plans that require verified domains
If entitlements set `scanRequiresVerifiedDomain = true`:
- Starting a scan for an unverified domain returns:

**HTTP 403** with `AUTHZ_DOMAIN_NOT_VERIFIED`

```json
{
  "success": false,
  "error": {
    "code": "AUTHZ_DOMAIN_NOT_VERIFIED",
    "message": "Please verify domain ownership first",
    "details": {
      "domain_id": 123,
      "verification_status": "unverified",
      "verify_url": "/app/domains/123/verify"
    }
  },
  "meta": { "request_id": "req_...", "timestamp": "..." }
}
```

### 5.2 Plans that do not require verified domains
If `scanRequiresVerifiedDomain = false`, allow scans regardless of verification status.

---

## 6. Verification methods

## 6.1 Meta tag verification (MVP)
**Requirement:** homepage HTML contains:

```html
<meta name="visible2ai-verification" content="v2ai_..." />
```

**Where to check**
- Primary: `https://{domain}` (display_url)
- Fallback: `https://{domain}/` (ensure trailing slash)
- Optional: if `display_url` differs after canonicalization, check that too

**Parsing (no regex)**
Use an HTML parser (e.g., cheerio) and search:
- `meta[name="visible2ai-verification"]`
Read `content`.

**Result**
- If found and matches token → verified
- If found but token mismatch → failed (reason `TOKEN_MISMATCH`)
- If not found → failed (reason `META_TAG_NOT_FOUND`)

---

## 6.2 HTML file verification (Phase 2)
**Requirement:** a file exists at:

`https://{domain}/.well-known/visible2ai-verification.txt`

Content must equal the token (or `visible2ai:{token}`).

Return the same canonical error code on failure:
- `DOMAIN_VERIFICATION_FAILED` with `details.reason = FILE_NOT_FOUND | TOKEN_MISMATCH`

---

## 6.3 DNS TXT verification (Phase 2)
**Requirement:** TXT record exists:

- Name: `_visible2ai-verification.{domain}`
- Value: token

**Notes**
- DNS propagation can take time → allow `DOMAIN_VERIFICATION_PENDING` (202)
- Verification checks should query DNS using a resolver with timeouts and avoid blocking web threads.

---

## 7. Network + security requirements (implementation rules)

### 7.1 SSRF protection (mandatory)
Verification fetches must block:
- private IP ranges (RFC1918), loopback, link-local, multicast
- cloud metadata endpoints (e.g., `169.254.169.254`)
- IPv6 private/link-local ranges
- credentials in URL (`user:pass@host`)
- non-http(s) schemes

**Redirect safety**
- Max 3 redirects
- Re-resolve DNS on every redirect hop
- Validate destination IP is public each hop

### 7.2 Timeouts + limits
- Connect + response timeout: 5–10 seconds (AbortController)
- Max response bytes: 1MB
- User-Agent must be explicit: `Visible2AI-Verifier/1.0 (+https://visible2ai.com/bot)`

### 7.3 Fetch implementation (Node-safe)
Do not use non-standard `fetch(timeout)` signatures. Use `AbortController`.

Pseudo-code (illustrative):

```js
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);

try {
  const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
  // ...
} finally {
  clearTimeout(timeout);
}
```

---

## 8. Status transitions

### 8.1 Verification status state machine
- `unverified` → `pending` (start verification)
- `pending` → `verified` (check succeeds)
- `pending` → `failed` (check fails)
- `verified` → `lapsed` (scheduled re-check fails N times or token removed)
- `lapsed` → `verified` (user re-verifies)
- `failed` → `pending` (user fixes and checks again)

### 8.2 Lapse policy
Reverification is optional. If implemented:
- Weekly/Monthly re-check job for verified domains
- Mark `lapsed` after 3 consecutive verification failures
- Do **not** delete verification history

**Scan impact**
- If plan requires verified domains: block scans for lapsed domains (403 `AUTHZ_DOMAIN_NOT_VERIFIED`)
- Otherwise: allow scans but show a warning badge in UI

---

## 9. Rate limits

Recommended defaults:
- `POST /verify/check`: max 5 attempts per domain per hour
- `POST /domains`: max 10 domains per org per day
- Add per-IP burst limits for signup abuse

Rate-limit errors use:
- `RATE_LIMIT_EXCEEDED` (429) + standard headers.

---

## 10. Observability (must implement)

### 10.1 Structured logs (with request_id)
Include:
- `request_id`
- `user_id`, `organization_id`, `domain_id`
- `method`, `checked_url`
- `result` (verified/pending/failed)
- `reason` (META_TAG_NOT_FOUND, TOKEN_MISMATCH, DNS_FAILED, TIMEOUT, etc.)
- `duration_ms`

### 10.2 Metrics (recommended)
- verification_success_rate
- verification_time_to_success_seconds
- verification_fail_reason_count{reason}
- verification_attempts_per_domain
- domains_lapsed_count

---

## 11. Testing checklist (minimum)

1. Meta tag exists + matches token → verified
2. Meta tag exists + token mismatch → `DOMAIN_VERIFICATION_FAILED` reason TOKEN_MISMATCH
3. Meta tag missing → `DOMAIN_VERIFICATION_FAILED` reason META_TAG_NOT_FOUND
4. DNS failure/unreachable URL → `DOMAIN_VERIFICATION_FAILED` reason DNS_FAILED / TIMEOUT
5. SSRF blocked (private IP / metadata) → `DOMAIN_VERIFICATION_FAILED` reason SSRF_BLOCKED
6. Redirect chain > 3 → fails safely with reason REDIRECT_LIMIT
7. Multi-claim: same domain can exist for two orgs; each verifies independently
8. Lapsed state blocks scans only when `scanRequiresVerifiedDomain=true`

---

## 12. UI requirements (summary)

- Domains list shows:
  - domain, status badge, method
  - last_checked_at + last_error_message when failed/lapsed
- Verification screen shows:
  - step-by-step instructions
  - copy button for meta tag / TXT record
  - verify button
- For gated plans:
  - show “Verify Domain to Scan” CTA in onboarding + dashboard

---

## 13. Appendix: canonical reasons (details.reason)

The API code remains canonical (`DOMAIN_VERIFICATION_FAILED`) while `details.reason` provides granularity:

- `META_TAG_NOT_FOUND`
- `TOKEN_MISMATCH`
- `FILE_NOT_FOUND`
- `DNS_TXT_NOT_FOUND`
- `DNS_FAILED`
- `TIMEOUT`
- `HTTP_NON_200`
- `SSRF_BLOCKED`
- `REDIRECT_LIMIT`
- `UNKNOWN`

These are diagnostic labels, not primary error codes.

---
