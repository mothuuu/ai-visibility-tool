# Visible2AI - Error Codes Catalog
## Standardized Error Responses

**Version:** 1.1  
**Date:** 2026-01-03

---

## Overview

This catalog defines all standardized error codes used across the Visible2AI platform. Every error response follows the standard API envelope and uses codes from this catalog.

**Goals:**
- Consistent error handling across all endpoints
- Clear mapping between internal errors and user-facing messages
- Support for i18n-ready error messages
- Debugging-friendly error codes

---

## Response Format

All errors follow the standard API envelope:

```json
{
  "success": false,
  "error": {
    "code": "QUOTA_SCANS_EXCEEDED",
    "message": "You've used all 2 scans this month",
    "details": {
      "used": 2,
      "limit": 2,
      "resets_at": "2026-02-01T00:00:00Z"
    }
  },
  "meta": {
    "request_id": "req_1704283200_a7b3c9d2",
    "timestamp": "2026-01-03T12:00:00.000Z"
  }
}
```

---

## Error Code Format

```
{CATEGORY}_{SPECIFIC_ERROR}

Examples:
- AUTH_TOKEN_EXPIRED
- QUOTA_EXCEEDED
- SCAN_TIMEOUT
- VALIDATION_INVALID_URL
```

**Categories:**
- `AUTH_` — Authentication errors
- `AUTHZ_` — Authorization/permission errors
- `VALIDATION_` — Input validation errors
- `QUOTA_` — Usage limit errors
- `RATE_` — Rate limiting errors
- `SCAN_` — Scanning pipeline errors
- `PAYMENT_` — Stripe/billing errors
- `DOMAIN_` — Domain verification errors
- `INTERNAL_` — Server errors (don't expose details)

---

## Authentication Errors (401)

| Code | HTTP | Message | When |
|------|------|---------|------|
| `AUTH_TOKEN_MISSING` | 401 | Authentication required | No token provided |
| `AUTH_TOKEN_INVALID` | 401 | Invalid authentication token | Token malformed or signature invalid |
| `AUTH_TOKEN_EXPIRED` | 401 | Session expired, please log in again | Access token expired |
| `AUTH_REFRESH_EXPIRED` | 401 | Session expired, please log in again | Refresh token expired |
| `AUTH_USER_NOT_FOUND` | 401 | Account not found | User deleted or doesn't exist |
| `AUTH_INVALID_CREDENTIALS` | 401 | Invalid email or password | Login failed |

### Implementation

```javascript
// Do NOT distinguish between "user not found" and "wrong password"
// to prevent email enumeration attacks
if (!user || !validPassword) {
  throw new AppError('AUTH_INVALID_CREDENTIALS', 401);
}
```

---

## Authorization Errors (403)

| Code | HTTP | Message | When |
|------|------|---------|------|
| `AUTHZ_EMAIL_NOT_VERIFIED` | 403 | Please verify your email to continue | Email verification required |
| `AUTHZ_PLAN_REQUIRED` | **402** | Upgrade to {plan} to access this feature | Feature requires higher plan |
| `AUTHZ_DOMAIN_NOT_VERIFIED` | 403 | Please verify domain ownership first | Domain verification required |
| `AUTHZ_ORG_ACCESS_DENIED` | 403 | You don't have access to this organization | Wrong org or no membership |
| `AUTHZ_RESOURCE_ACCESS_DENIED` | 403 | You don't have access to this resource | Scan/domain belongs to another user |
| `AUTHZ_FORBIDDEN` | 403 | Access denied | Generic forbidden |

**Note:** `AUTHZ_PLAN_REQUIRED` returns **402** (not 403) because upgrading fixes it. This aligns with the OpenAPI contract and the "402 = user can fix by upgrading" rule.

### Details Object

```json
{
  "code": "AUTHZ_PLAN_REQUIRED",
  "message": "Upgrade to Pro to access page optimization",
  "details": {
    "feature": "page_optimization",
    "current_plan": "diy",
    "required_plans": ["pro", "enterprise", "agency"],
    "upgrade_url": "/billing/upgrade"
  }
}
```

---

## Validation Errors (400)

| Code | HTTP | Message | When |
|------|------|---------|------|
| `VALIDATION_INVALID_INPUT` | 400 | Invalid input provided | Generic validation failure |
| `VALIDATION_INVALID_URL` | 400 | Please enter a valid URL | URL format invalid |
| `VALIDATION_INVALID_EMAIL` | 400 | Please enter a valid email address | Email format invalid |
| `VALIDATION_INVALID_DOMAIN` | 400 | Invalid domain format | Domain doesn't parse |
| `VALIDATION_DOMAIN_MISMATCH` | 400 | All pages must be from the same domain | Multi-page scan with mixed domains |
| `VALIDATION_DUPLICATE_URL` | 400 | This URL is already in your scan | Duplicate URL in multi-page |
| `VALIDATION_PASSWORD_WEAK` | 400 | Password must be at least 8 characters | Password requirements not met |
| `VALIDATION_REQUIRED_FIELD` | 400 | {field} is required | Missing required field |

### Details Object

```json
{
  "code": "VALIDATION_INVALID_INPUT",
  "message": "Invalid input provided",
  "details": {
    "fields": [
      { "field": "email", "message": "Invalid email format" },
      { "field": "password", "message": "Must be at least 8 characters" }
    ]
  }
}
```

---

## Quota Errors (402)

| Code | HTTP | Message | When |
|------|------|---------|------|
| `QUOTA_SCANS_EXCEEDED` | 402 | You've used all {limit} scans this month | Scan quota hit |
| `QUOTA_PAGES_EXCEEDED` | 402 | Your plan allows {limit} pages per scan | Page limit hit |
| `QUOTA_COMPETITORS_EXCEEDED` | 402 | Your plan allows {limit} competitor domains | Competitor limit hit |
| `QUOTA_AI_QUERIES_EXCEEDED` | 402 | AI query limit reached for this period | AI test quota hit |
| `QUOTA_CONTENT_CREDITS_EXCEEDED` | 402 | Content generation credits exhausted | Content studio credits |
| `QUOTA_API_DAILY_EXCEEDED` | 402 | Daily API limit reached | API daily quota hit |

### Details Object

```json
{
  "code": "QUOTA_SCANS_EXCEEDED",
  "message": "You've used all 2 scans this month",
  "details": {
    "event_type": "SCAN_CREATED",
    "used": 2,
    "limit": 2,
    "resets_at": "2026-02-01T00:00:00Z",
    "upgrade_plan": "diy",
    "upgrade_url": "/billing/upgrade"
  }
}
```

### Note on 402 vs 403

- **402 Payment Required**: User CAN fix by upgrading (quota)
- **403 Forbidden**: User CANNOT fix by upgrading (permission/verification)

### Upgrade URL Convention

**All `QUOTA_*` and `AUTHZ_PLAN_REQUIRED` errors MUST include:**
- `details.upgrade_url` — Link to upgrade page (e.g., `/billing/upgrade`)
- `details.required_plans` — Array of plans that unlock the feature
- `details.current_plan` — User's current plan (for context)

This enables consistent frontend upgrade prompts across all paywall scenarios.

---

## Rate Limit Errors (429)

| Code | HTTP | Message | When |
|------|------|---------|------|
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests, please slow down | Per-minute rate limit |
| `RATE_LIMIT_AUTH` | 429 | Too many login attempts, try again in {minutes} minutes | Auth endpoint rate limit |
| `RATE_LIMIT_SCAN` | 429 | Please wait before starting another scan | Scan rate limit |

### Headers

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1704283260
```

### Details Object

```json
{
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests, please slow down",
  "details": {
    "limit": 100,
    "window_seconds": 60,
    "retry_after": 45
  }
}
```

---

## Scan Errors (Various)

| Code | HTTP | Message | When |
|------|------|---------|------|
| `SCAN_NOT_FOUND` | 404 | Scan not found | Invalid scan ID |
| `SCAN_TIMEOUT` | 504 | Scan timed out, please try again | Scan exceeded time limit |
| `SCAN_URL_UNREACHABLE` | 422 | Unable to reach {url} | Target site down/blocked |
| `SCAN_URL_BLOCKED` | 422 | This URL cannot be scanned | robots.txt or other block |
| `SCAN_FAILED` | 500 | Scan failed, please try again | Generic scan failure |

**Note:** For "scan already running" conflicts, use `CONFLICT_SCAN_RUNNING` (409) from the Conflict section.

### Details Object

```json
{
  "code": "SCAN_TIMEOUT",
  "message": "Scan timed out, please try again",
  "details": {
    "scan_id": "scan_abc123",
    "url": "https://example.com",
    "timeout_seconds": 120,
    "stage": "ai_analysis"
  }
}
```

---

## Payment Errors (Various)

| Code | HTTP | Message | When |
|------|------|---------|------|
| `PAYMENT_FAILED` | 402 | Payment failed, please update your card | Card declined |
| `PAYMENT_CARD_EXPIRED` | 402 | Your card has expired | Card expiration |
| `PAYMENT_SUBSCRIPTION_INACTIVE` | 402 | Your subscription is inactive | Subscription canceled/past_due |
| `PAYMENT_CUSTOMER_NOT_FOUND` | 400 | Billing account not found | No Stripe customer |
| `PAYMENT_WEBHOOK_INVALID` | 400 | Invalid webhook signature | Webhook verification failed |

---

## Domain Verification Errors (Various)

| Code | HTTP | Message | When |
|------|------|---------|------|
| `DOMAIN_NOT_FOUND` | 404 | Domain not found | Invalid domain ID |
| `DOMAIN_ALREADY_EXISTS` | 409 | This domain is already registered | Duplicate domain |
| `DOMAIN_ALREADY_VERIFIED` | 409 | This domain is already verified | Re-verification attempt |
| `DOMAIN_VERIFICATION_FAILED` | 422 | Domain verification failed | DNS/meta/file not found |
| `DOMAIN_VERIFICATION_PENDING` | 202 | Verification in progress, please wait | DNS propagation |

### Details Object

```json
{
  "code": "DOMAIN_VERIFICATION_FAILED",
  "message": "Domain verification failed",
  "details": {
    "domain": "example.com",
    "method": "dns_txt",
    "expected": "visible2ai-verify=abc123",
    "found": null,
    "hint": "DNS changes can take up to 48 hours to propagate"
  }
}
```

---

## Not Found Errors (404)

**Note:** Resource-specific 404 codes are also documented in their respective sections (Scan, Domain, etc.) for context. Use the specific code, not generic `NOT_FOUND`.

| Code | HTTP | Message | When |
|------|------|---------|------|
| `NOT_FOUND` | 404 | Resource not found | **Fallback only** — use specific codes below |
| `SCAN_NOT_FOUND` | 404 | Scan not found | Scan ID invalid |
| `DOMAIN_NOT_FOUND` | 404 | Domain not found | Domain ID invalid |
| `USER_NOT_FOUND` | 404 | User not found | User ID invalid |
| `ORG_NOT_FOUND` | 404 | Organization not found | Org ID invalid |

---

## Conflict Errors (409)

**Note:** Use resource-specific codes (e.g., `DOMAIN_ALREADY_EXISTS`, `CONFLICT_SCAN_RUNNING`) rather than generic conflict codes. This provides clearer context for error handling.

| Code | HTTP | Message | When |
|------|------|---------|------|
| `CONFLICT_EMAIL_EXISTS` | 409 | An account with this email already exists | Duplicate signup |
| `CONFLICT_SCAN_RUNNING` | 409 | A scan is already in progress | Duplicate scan |

**Canonical codes by resource:**
- Email conflicts → `CONFLICT_EMAIL_EXISTS`
- Domain conflicts → `DOMAIN_ALREADY_EXISTS` (in Domain section)
- Scan conflicts → `CONFLICT_SCAN_RUNNING`

---

## Internal Errors (500)

| Code | HTTP | Message | When |
|------|------|---------|------|
| `INTERNAL_ERROR` | 500 | Something went wrong, please try again | Generic server error |
| `INTERNAL_DATABASE_ERROR` | 500 | Something went wrong, please try again | Database failure |
| `INTERNAL_AI_PROVIDER_ERROR` | 500 | Something went wrong, please try again | AI API failure |

**IMPORTANT:** Never expose internal error details to users. Log full details server-side with `request_id`.

```javascript
// BAD - exposes internals
res.json({ error: { message: error.stack } });

// GOOD - generic message, log internally
logger.error('Database error', { request_id, error: error.message, stack: error.stack });
res.json({ 
  error: { 
    code: 'INTERNAL_ERROR', 
    message: 'Something went wrong, please try again' 
  },
  meta: { request_id }
});
```

---

## Error Code Registry

### Full Code List (Alphabetical)

```javascript
const ERROR_CODES = {
  // Auth (401)
  AUTH_INVALID_CREDENTIALS: { http: 401, message: 'Invalid email or password' },
  AUTH_REFRESH_EXPIRED: { http: 401, message: 'Session expired, please log in again' },
  AUTH_TOKEN_EXPIRED: { http: 401, message: 'Session expired, please log in again' },
  AUTH_TOKEN_INVALID: { http: 401, message: 'Invalid authentication token' },
  AUTH_TOKEN_MISSING: { http: 401, message: 'Authentication required' },
  AUTH_USER_NOT_FOUND: { http: 401, message: 'Account not found' },
  
  // Authorization (403, except AUTHZ_PLAN_REQUIRED which is 402)
  AUTHZ_DOMAIN_NOT_VERIFIED: { http: 403, message: 'Please verify domain ownership first' },
  AUTHZ_EMAIL_NOT_VERIFIED: { http: 403, message: 'Please verify your email to continue' },
  AUTHZ_FORBIDDEN: { http: 403, message: 'Access denied' },
  AUTHZ_ORG_ACCESS_DENIED: { http: 403, message: "You don't have access to this organization" },
  AUTHZ_PLAN_REQUIRED: { http: 402, message: 'Upgrade required to access this feature' }, // 402: upgrade fixes it
  AUTHZ_RESOURCE_ACCESS_DENIED: { http: 403, message: "You don't have access to this resource" },
  
  // Conflict (409)
  CONFLICT_EMAIL_EXISTS: { http: 409, message: 'An account with this email already exists' },
  CONFLICT_SCAN_RUNNING: { http: 409, message: 'A scan is already in progress' },
  
  // Domain (various)
  DOMAIN_ALREADY_EXISTS: { http: 409, message: 'This domain is already registered' },
  DOMAIN_ALREADY_VERIFIED: { http: 409, message: 'This domain is already verified' },
  DOMAIN_NOT_FOUND: { http: 404, message: 'Domain not found' },
  DOMAIN_VERIFICATION_FAILED: { http: 422, message: 'Domain verification failed' },
  DOMAIN_VERIFICATION_PENDING: { http: 202, message: 'Verification in progress, please wait' },
  
  // Internal (500)
  INTERNAL_AI_PROVIDER_ERROR: { http: 500, message: 'Something went wrong, please try again' },
  INTERNAL_DATABASE_ERROR: { http: 500, message: 'Something went wrong, please try again' },
  INTERNAL_ERROR: { http: 500, message: 'Something went wrong, please try again' },
  
  // Not Found (404)
  NOT_FOUND: { http: 404, message: 'Resource not found' }, // Fallback only
  ORG_NOT_FOUND: { http: 404, message: 'Organization not found' },
  SCAN_NOT_FOUND: { http: 404, message: 'Scan not found' },
  USER_NOT_FOUND: { http: 404, message: 'User not found' },
  
  // Payment (various)
  PAYMENT_CARD_EXPIRED: { http: 402, message: 'Your card has expired' },
  PAYMENT_CUSTOMER_NOT_FOUND: { http: 400, message: 'Billing account not found' },
  PAYMENT_FAILED: { http: 402, message: 'Payment failed, please update your card' },
  PAYMENT_SUBSCRIPTION_INACTIVE: { http: 402, message: 'Your subscription is inactive' },
  PAYMENT_WEBHOOK_INVALID: { http: 400, message: 'Invalid webhook signature' },
  
  // Quota (402)
  QUOTA_AI_QUERIES_EXCEEDED: { http: 402, message: 'AI query limit reached for this period' },
  QUOTA_API_DAILY_EXCEEDED: { http: 402, message: 'Daily API limit reached' },
  QUOTA_COMPETITORS_EXCEEDED: { http: 402, message: 'Competitor domain limit reached' },
  QUOTA_CONTENT_CREDITS_EXCEEDED: { http: 402, message: 'Content generation credits exhausted' },
  QUOTA_PAGES_EXCEEDED: { http: 402, message: 'Page limit reached for this scan' },
  QUOTA_SCANS_EXCEEDED: { http: 402, message: 'Scan limit reached for this period' },
  
  // Rate Limit (429)
  RATE_LIMIT_AUTH: { http: 429, message: 'Too many login attempts, please try again later' },
  RATE_LIMIT_EXCEEDED: { http: 429, message: 'Too many requests, please slow down' },
  RATE_LIMIT_SCAN: { http: 429, message: 'Please wait before starting another scan' },
  
  // Scan (various)
  // Note: For scan conflicts, use CONFLICT_SCAN_RUNNING (409)
  SCAN_FAILED: { http: 500, message: 'Scan failed, please try again' },
  SCAN_NOT_FOUND: { http: 404, message: 'Scan not found' },
  SCAN_TIMEOUT: { http: 504, message: 'Scan timed out, please try again' },
  SCAN_URL_BLOCKED: { http: 422, message: 'This URL cannot be scanned' },
  SCAN_URL_UNREACHABLE: { http: 422, message: 'Unable to reach the specified URL' },
  
  // Validation (400)
  VALIDATION_DOMAIN_MISMATCH: { http: 400, message: 'All pages must be from the same domain' },
  VALIDATION_DUPLICATE_URL: { http: 400, message: 'This URL is already in your scan' },
  VALIDATION_INVALID_DOMAIN: { http: 400, message: 'Invalid domain format' },
  VALIDATION_INVALID_EMAIL: { http: 400, message: 'Please enter a valid email address' },
  VALIDATION_INVALID_INPUT: { http: 400, message: 'Invalid input provided' },
  VALIDATION_INVALID_URL: { http: 400, message: 'Please enter a valid URL' },
  VALIDATION_PASSWORD_WEAK: { http: 400, message: 'Password must be at least 8 characters' },
  VALIDATION_REQUIRED_FIELD: { http: 400, message: 'Required field missing' },
};

module.exports = { ERROR_CODES };
```

---

## Usage Example

```javascript
// utils/errors.js
const { ERROR_CODES } = require('./errorCodes');

class AppError extends Error {
  constructor(code, details = null) {
    const errorDef = ERROR_CODES[code] || ERROR_CODES.INTERNAL_ERROR;
    super(errorDef.message);
    this.code = code;
    this.statusCode = errorDef.http;
    this.details = details;
    this.isOperational = true;
  }
}

// Usage
throw new AppError('QUOTA_SCANS_EXCEEDED', {
  used: 2,
  limit: 2,
  resets_at: '2026-02-01T00:00:00Z'
});
```

---

## Frontend Error Handling

```typescript
// services/errorHandler.ts
import { ERROR_CODES } from './errorCodes';

function getErrorMessage(error: ApiError): string {
  // Use server message if available
  if (error.message) return error.message;
  
  // Fallback to code lookup
  const def = ERROR_CODES[error.code];
  return def?.message || 'Something went wrong';
}

function isRetryable(code: string): boolean {
  return ['INTERNAL_ERROR', 'SCAN_TIMEOUT', 'RATE_LIMIT_EXCEEDED'].includes(code);
}

function shouldShowUpgrade(code: string): boolean {
  return code.startsWith('QUOTA_') || code === 'AUTHZ_PLAN_REQUIRED';
}
```

---

## Summary

| Category | HTTP Codes | Count |
|----------|------------|-------|
| Authentication | 401 | 6 |
| Authorization | 402-403 | 6 |
| Validation | 400 | 8 |
| Quota | 402 | 6 |
| Rate Limit | 429 | 3 |
| Scan | Various | 5 |
| Payment | Various | 5 |
| Domain | Various | 5 |
| Not Found | 404 | 5 |
| Conflict | 409 | 2 |
| Internal | 500 | 3 |
| **Total** | | **54** |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.1 | 2026-01-03 | **Contract fixes:** AUTHZ_PLAN_REQUIRED now 402 (not 403) to match OpenAPI; fixed example to use QUOTA_SCANS_EXCEEDED; removed SCAN_ALREADY_RUNNING (use CONFLICT_SCAN_RUNNING); removed CONFLICT_DOMAIN_EXISTS (use DOMAIN_ALREADY_EXISTS); added upgrade_url convention |
| 1.0 | 2026-01-03 | Initial error codes catalog |
