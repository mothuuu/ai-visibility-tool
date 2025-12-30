# Phase 4: Duplicate Detection

Pre-check if a business is already listed in a directory before queueing submissions.

## Overview

Phase 4 adds duplicate detection to prevent:
- Wasting entitlement on directories where the business is already listed
- Creating duplicate listings that may be rejected by directories
- User frustration from redundant submission attempts

## Search Type Behaviors

| Search Type | Status | Implementation |
|-------------|--------|----------------|
| `internal_search` | **Implemented** | HTTP request to directory's search URL, cheerio parsing, confidence scoring |
| `site_search` | Skipped | Requires compliant search API (no Google scraping) |
| `api_search` | Skipped | Per-directory API integration (future work) |
| `none` | Skipped | Directory has no search capability |

## Confidence Thresholds

```javascript
const CONFIDENCE_THRESHOLDS = {
  MATCH_FOUND: 0.85,      // High confidence → already_listed
  POSSIBLE_MATCH: 0.50,   // Medium confidence → blocked for review
  DOMAIN_BOOST_MIN: 0.70  // Domain match boosts to match_found
};
```

### Scoring Logic

| Signal | Confidence Boost |
|--------|------------------|
| Website domain found in text/links | 0.85 |
| Business name in link text/href | 0.70 |
| Business name in page text | 0.65 |
| Slug in link href | 0.55 |
| Domain match with 70%+ confidence | → `match_found` |

## Status Determination

| Duplicate Check Result | Confidence | Submission Status | Entitlement |
|------------------------|------------|-------------------|-------------|
| `match_found` | >= 85% | `already_listed` | NOT consumed |
| `match_found` | < 85% | `blocked` | NOT consumed |
| `no_match` | any | `queued` | Consumed |
| `possible_match` | any | `blocked` | NOT consumed |
| `skipped` | N/A | `blocked` | NOT consumed |
| `error` | N/A | `blocked` | NOT consumed |

## Evidence JSON Schema

```typescript
interface DuplicateCheckEvidence {
  // Always present
  directory: string;           // Directory name
  directoryId: number;         // Directory ID (for safe joining)

  // For internal_search
  searchUrl?: string;          // URL that was searched
  httpStatus?: number;         // HTTP response status
  reasons?: string[];          // Match reasons (e.g., ['website_domain_match', 'domain_in_link'])
  excerpt?: string;            // First 500 chars of relevant page content
  listingUrlCandidate?: string; // Potential listing URL found
  linkCount?: number;          // Number of links found on page
  textLength?: number;         // Length of page text

  // For skipped/error
  reason?: string;             // Why check was skipped/failed
  error?: string;              // Error type (timeout, dns_error, etc.)
  errorMessage?: string;       // Error message details

  // Metadata (added by campaignRunService)
  confidence?: number;         // 0.0 - 1.0
  checkedAt?: string;          // ISO timestamp
}
```

## URL Template Tokens

When configuring `search_url_template` for a directory, use these tokens:

| Token | Description | Example Input | Example Output |
|-------|-------------|---------------|----------------|
| `{business_name}` | URL-encoded business name | "My SaaS Tool" | "My%20SaaS%20Tool" |
| `{website_domain}` | Domain without www | "https://www.example.com" | "example.com" |
| `{slug}` | Slugified business name | "My SaaS Tool" | "my-saas-tool" |

### Example Templates

```
https://www.g2.com/search?query={business_name}
https://www.futurepedia.io/search?q={business_name}
https://www.npmjs.com/search?q={business_name}
```

## Entitlement Rules

### BILLABLE_STATUSES

Only these statuses consume entitlement:

```javascript
const BILLABLE_STATUSES = [
  'queued',           // In queue, work will be done
  'in_progress',      // Worker is processing
  'submitted',        // Successfully submitted
  'pending_approval', // Awaiting directory approval
  'action_needed',    // User action required
  'live',             // Listing is live
  'verified',         // Verification complete
  'rejected',         // Directory rejected (work was done)
  'failed'            // Submission failed (work was attempted)
];
```

### NOT Billable

- `already_listed` - No submission needed
- `blocked` - Blocked before any work (e.g., ambiguous duplicate check)
- `cancelled` - Cancelled by user
- `skipped` - User skipped directory

## Database Columns

### directory_submissions (Phase 4 additions)

| Column | Type | Description |
|--------|------|-------------|
| `listing_url` | TEXT | URL of existing listing if found |
| `listing_found_at` | TIMESTAMP | When existing listing was found |
| `duplicate_check_performed_at` | TIMESTAMP | When check was performed |
| `duplicate_check_method` | VARCHAR(50) | internal_search, api_search, site_search, manual, skipped, error |
| `duplicate_check_status` | VARCHAR(50) | not_checked, no_match, possible_match, match_found, skipped, error |
| `duplicate_check_evidence` | JSONB | Structured proof (see schema above) |

### CHECK Constraints

```sql
-- duplicate_check_method values
CHECK (duplicate_check_method IN ('internal_search', 'api_search', 'site_search', 'manual', 'skipped', 'error'))

-- duplicate_check_status values
CHECK (duplicate_check_status IN ('not_checked', 'no_match', 'possible_match', 'match_found', 'skipped', 'error'))
```

## API Endpoints

### Manual Duplicate Check

```
POST /api/citation-network/submissions/:id/check-duplicate
```

Triggers a duplicate check on an existing submission.

**Response:**
```json
{
  "submission": {
    "id": "uuid",
    "directoryName": "G2",
    "status": "already_listed",
    "duplicateCheckStatus": "match_found",
    "duplicateCheckMethod": "internal_search",
    "duplicateCheckPerformedAt": "2024-01-15T10:30:00Z",
    "listingUrl": "https://www.g2.com/products/my-product",
    "confidence": 0.92
  },
  "checkResult": {
    "status": "match_found",
    "confidence": 0.92,
    "listingUrl": "https://www.g2.com/products/my-product",
    "method": "internal_search",
    "searchUrl": "https://www.g2.com/search?query=My%20Product"
  },
  "statusChanged": true,
  "message": "Match found with 92% confidence. Status updated to already_listed."
}
```

### Duplicate Check Stats

```
GET /api/citation-network/duplicate-check/stats
```

Returns duplicate check statistics for the user.

## Safety Rules

1. **ID-Safe Matching**: Always use `resultsMap.get(directory.id)`, NEVER array index
2. **No Google Scraping**: `site_search` is skipped to avoid ToS violations
3. **Structured Evidence**: All check results include `directoryId` for safe joins
4. **Tri-State Outcomes**: match_found / no_match / everything else (blocked)
5. **Confidence Threshold**: Only 85%+ confidence sets `already_listed`

## Rate Limiting

- **Concurrent Requests**: 3 max
- **Batch Delay**: 800ms between batches
- **Request Timeout**: 12 seconds
- **Cache TTL**: 24 hours (via `isRecentCheckValid`)

## Migration

```bash
# Run the Phase 4 migration
node backend/migrations/run-migration.js phase4_duplicate_detection.sql
```

## Files

| File | Purpose |
|------|---------|
| `backend/migrations/phase4_duplicate_detection.sql` | Database schema changes |
| `backend/services/duplicateDetectionService.js` | Core detection logic |
| `backend/services/campaignRunService.js` | Integration with start-submissions |
| `backend/config/citationNetwork.js` | BILLABLE_STATUSES constant |
| `backend/routes/citationNetwork.js` | Manual check endpoint |
