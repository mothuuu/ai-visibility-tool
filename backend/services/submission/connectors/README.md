# Directory Submission Connectors

This directory contains connector implementations for submitting to various directories.

## Architecture

Connectors implement the submission interface and are registered with the `ConnectorRegistry`. Each connector:

1. Has a unique `connector_key` (e.g., `betalist-v1`)
2. Implements required methods: `submit(payload, context)`
3. Optionally implements: `validate(listing)`, `getCapabilities()`
4. Returns results using enum values from `constants/submission-enums.js`

## Available Connectors

### ManualPacketConnector (`manual`, `manual_packet`)

Default connector for directories without automation. Generates manual submission instructions.

### BetaListConnector (`betalist-v1`)

**Bucket B (Form) - Manual-First Connector**

- **Directory**: [BetaList](https://betalist.com)
- **Mode**: Manual submission packet
- **TOS**: Automation not explicitly allowed

BetaList is a startup discovery platform. This connector generates high-quality submission packets for manual submission.

#### Features

- Validates business listing against BetaList's field requirements
- Derives tagline from description if not provided
- Generates step-by-step operator instructions
- Field mapping from canonical format to BetaList form fields

#### Field Requirements

| Field | Required | Constraints |
|-------|----------|-------------|
| business_name | Yes | Max 100 chars |
| tagline | Yes* | Max 60 chars (*derived from description if missing) |
| description | Yes | 160-500 chars |
| website_url | Yes | Valid URL |
| contact_email | Yes | Valid email |
| categories | Warn | Operator selects during manual submission |
| logo_url | Warn | Recommended for visibility |

#### Usage

```sql
-- Seed the BetaList directory
psql "$DATABASE_URL" -f backend/db/seeds/betalist-directory.sql
```

#### Future Automation

Automation is disabled by default. To enable in the future:

1. Review BetaList TOS for automation allowances
2. Update `tos_allows_automation = true` in the directory record
3. Implement automated form submission in connector
4. Add capability `'automated_submit'` to connector
5. Toggle behavior based on directory config

This is a placeholder - automated submission is NOT implemented.

## Creating New Connectors

1. Create a new file: `MyDirectoryConnector.js`
2. Implement the required interface:

```javascript
class MyDirectoryConnector {
  getCapabilities() {
    return ['validate', 'submit'];
  }

  validate(listing) {
    // Return { valid, errors, warnings }
  }

  async submit(payload, context) {
    // Return result with proper enum values:
    // - status: 'submitted' | 'action_needed' | 'already_listed' | 'error'
    // - reason: STATUS_REASON enum value
    // - For action_needed: actionNeeded.type = ACTION_NEEDED_TYPE enum
    // - For errors: errorType = ERROR_TYPE enum
  }
}
```

3. Register in `ConnectorRegistry.js`:

```javascript
const MyDirectoryConnector = require('./connectors/MyDirectoryConnector');
this.register('mydirectory-v1', new MyDirectoryConnector());
```

4. Create directory seed SQL in `db/seeds/`

## Testing

```bash
# Run connector unit tests
NODE_ENV=test node --test tests/submission/connectors/

# Run E2E tests (requires database)
NODE_ENV=test node --test tests/e2e/submission-betalist.e2e.test.js
```

## Invariants

All connectors MUST:

1. Return `STATUS_REASON` enum values for `reason` (not raw strings)
2. Return `ACTION_NEEDED_TYPE` for `actionNeeded.type`
3. Return `ERROR_TYPE` for `errorType`
4. Use the StateMachineService for all status transitions (via WorkerService)
5. NOT make direct SQL updates to status fields
