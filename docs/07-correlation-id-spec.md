# Visible2AI - Correlation ID & Request Tracking
## Observability Implementation

**Version:** 1.1  
**Date:** 2026-01-03

---

## Overview

Every request gets a unique correlation ID that flows through:
- All log entries
- Error reports (Sentry)
- API responses
- Database queries (optional)
- External API calls

This enables tracing a single user action through the entire system.

---

## Accepted Incoming Headers

The middleware accepts correlation IDs from upstream services via these headers (checked in order):

| Header | Standard | Notes |
|--------|----------|-------|
| `X-Request-ID` | Common | Primary, most widely used |
| `X-Correlation-ID` | Common | Alternative naming |
| `traceparent` | W3C Trace Context | OpenTelemetry compatible (extracts trace-id) |

If none provided, a new ID is generated.

---

## Request ID Format

```
req_{timestamp}_{random}

Example: req_1704283200_a7b3c9d2
```

**Components:**
- `req_` - Prefix for identification
- `{timestamp}` - Unix timestamp (seconds)
- `{random}` - 8 character random hex string

---

## Middleware Implementation

### Express Middleware

```javascript
// backend/middleware/requestId.js
const crypto = require('crypto');

function generateRequestId() {
  const timestamp = Math.floor(Date.now() / 1000);
  const random = crypto.randomBytes(4).toString('hex');
  return `req_${timestamp}_${random}`;
}

// Extract trace ID from W3C traceparent header
// Format: 00-{trace-id}-{parent-id}-{flags}
function extractTraceId(traceparent) {
  if (!traceparent) return null;
  const parts = traceparent.split('-');
  if (parts.length >= 2 && parts[1].length === 32) {
    return `trace_${parts[1].substring(0, 16)}`; // Use first 16 chars
  }
  return null;
}

function requestIdMiddleware(req, res, next) {
  // Check headers in priority order
  const requestId = 
    req.headers['x-request-id'] ||
    req.headers['x-correlation-id'] ||
    extractTraceId(req.headers['traceparent']) ||
    generateRequestId();
  
  // Attach to request object
  req.requestId = requestId;
  
  // Set response header (always use X-Request-ID for consistency)
  res.setHeader('X-Request-ID', requestId);
  
  // Set on response locals for use in templates
  res.locals.requestId = requestId;
  
  next();
}

module.exports = { requestIdMiddleware, generateRequestId };
```

### Apply to All Routes

```javascript
// backend/server.js
const { requestIdMiddleware } = require('./middleware/requestId');

// Apply before any routes
app.use(requestIdMiddleware);
```

---

## Logging Integration

### Winston Configuration

```javascript
// backend/config/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'visible2ai-api' },
  transports: [
    new winston.transports.Console(),
    // Add file transport for production
  ]
});

// Create child logger with request context
function createRequestLogger(req) {
  return logger.child({
    request_id: req.requestId,
    user_id: req.user?.id,
    org_id: req.user?.organizationId,
    path: req.path,
    method: req.method
  });
}

module.exports = { logger, createRequestLogger };
```

### Usage in Route Handlers

```javascript
// backend/controllers/scanController.js
const { createRequestLogger } = require('../config/logger');

async function createScan(req, res) {
  const log = createRequestLogger(req);
  
  log.info('Scan requested', { url: req.body.url });
  
  try {
    const scan = await scanService.create(req.body.url, req.user);
    log.info('Scan created', { scan_id: scan.id });
    
    res.json({ success: true, data: scan });
  } catch (error) {
    log.error('Scan creation failed', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}
```

### Log Output Format

```json
{
  "level": "info",
  "message": "Scan requested",
  "timestamp": "2026-01-03T12:00:00.000Z",
  "service": "visible2ai-api",
  "request_id": "req_1704283200_a7b3c9d2",
  "user_id": 123,
  "org_id": 456,
  "path": "/api/scans",
  "method": "POST",
  "url": "https://example.com"
}
```

---

## Sentry Integration

### Configure Sentry with Request ID

```javascript
// backend/config/sentry.js
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION,
  
  beforeSend(event, hint) {
    // Add request ID to all events
    if (hint.originalException?.requestId) {
      event.tags = event.tags || {};
      event.tags.request_id = hint.originalException.requestId;
    }
    return event;
  }
});
```

### Middleware to Attach Request ID to Errors

```javascript
// backend/middleware/errorHandler.js
function errorHandler(err, req, res, next) {
  // Attach request ID to error for Sentry
  err.requestId = req.requestId;
  
  // Log error
  const log = createRequestLogger(req);
  log.error('Request failed', {
    error: err.message,
    stack: err.stack,
    code: err.code
  });
  
  // Send to Sentry
  Sentry.captureException(err);
  
  // Send response
  res.status(err.statusCode || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred'
    },
    meta: {
      request_id: req.requestId,
      timestamp: new Date().toISOString()
    }
  });
}
```

---

## API Response Format

### Success Response

```json
{
  "success": true,
  "data": {
    "scan_id": 123,
    "status": "queued"
  },
  "meta": {
    "request_id": "req_1704283200_a7b3c9d2",
    "timestamp": "2026-01-03T12:00:00.000Z"
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "You've used all 2 scans this month",
    "details": {
      "used": 2,
      "limit": 2
    }
  },
  "meta": {
    "request_id": "req_1704283200_a7b3c9d2",
    "timestamp": "2026-01-03T12:00:00.000Z"
  }
}
```

### Response Helper

```javascript
// backend/utils/response.js
function sendSuccess(res, data, statusCode = 200) {
  res.status(statusCode).json({
    success: true,
    data,
    meta: {
      request_id: res.locals.requestId,
      timestamp: new Date().toISOString()
    }
  });
}

function sendError(res, code, message, details = null, statusCode = 400) {
  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(details && { details })
    },
    meta: {
      request_id: res.locals.requestId,
      timestamp: new Date().toISOString()
    }
  });
}

module.exports = { sendSuccess, sendError };
```

---

## Job Correlation

### Pass Request ID to Jobs

```javascript
// When creating a job
const job = await scanQueue.add('scan', {
  url: url,
  userId: user.id,
  orgId: user.organizationId,
  requestId: req.requestId  // Pass it through
});
```

### Use in Job Worker

```javascript
// backend/workers/scanWorker.js
scanQueue.process('scan', async (job) => {
  const { url, userId, orgId, requestId } = job.data;
  
  const log = logger.child({
    request_id: requestId,
    job_id: job.id,
    user_id: userId,
    org_id: orgId
  });
  
  log.info('Starting scan job', { url });
  
  try {
    // ... scan logic
    log.info('Scan job completed', { scan_id: result.id });
  } catch (error) {
    log.error('Scan job failed', { error: error.message });
    throw error;
  }
});
```

---

## External API Call Tracing

### Pass Request ID to External Services

```javascript
// backend/services/aiService.js
async function generateRecommendations(evidence, requestId) {
  const log = logger.child({ request_id: requestId });
  
  log.info('Calling AI provider');
  
  const response = await anthropic.messages.create({
    model: 'claude-3-sonnet-20240229',
    messages: [...],
    // Include request ID in metadata for tracing
    metadata: {
      user_id: `request_${requestId}`
    }
  });
  
  log.info('AI provider responded', { 
    tokens_used: response.usage.output_tokens 
  });
  
  return response;
}
```

---

## Database Query Tracing (Optional)

### Add Request ID as Comment

```javascript
// backend/utils/db.js
async function query(sql, params, requestId) {
  // Add request ID as SQL comment for debugging
  const tracedSql = `/* request_id: ${requestId} */ ${sql}`;
  
  const start = Date.now();
  const result = await pool.query(tracedSql, params);
  const duration = Date.now() - start;
  
  if (duration > 100) {
    logger.warn('Slow query', {
      request_id: requestId,
      duration_ms: duration,
      sql: sql.substring(0, 100)
    });
  }
  
  return result;
}
```

---

## Frontend Integration

### Capture Request ID from Response

```javascript
// frontend/services/apiClient.js
import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api'
});

// Log request ID on errors for user support
apiClient.interceptors.response.use(
  response => {
    // Store last request ID for debugging
    window.__lastRequestId = response.headers['x-request-id'];
    return response;
  },
  error => {
    const requestId = error.response?.headers?.['x-request-id'] 
      || error.response?.data?.meta?.request_id;
    
    console.error('API Error', {
      requestId,
      status: error.response?.status,
      message: error.response?.data?.error?.message
    });
    
    // Show to user on critical errors
    if (error.response?.status >= 500) {
      alert(`Something went wrong. Reference: ${requestId}`);
    }
    
    return Promise.reject(error);
  }
);
```

### Display in Error UI

```jsx
function ErrorMessage({ error, requestId }) {
  return (
    <div className="error-message">
      <p>{error.message}</p>
      <small className="text-muted">
        Reference: {requestId}
      </small>
    </div>
  );
}
```

---

## Searching Logs

### By Request ID

```bash
# CloudWatch
aws logs filter-log-events \
  --log-group-name visible2ai-api \
  --filter-pattern '{ $.request_id = "req_1704283200_a7b3c9d2" }'

# grep (local/file logs)
grep "req_1704283200_a7b3c9d2" logs/*.log
```

### Sentry Search

```
tags.request_id:req_1704283200_a7b3c9d2
```

---

## Health Endpoint Logging

Health checks should also include `request_id` for incident debugging, but with **sampling** to avoid log spam.

```javascript
// backend/routes/health.js
const HEALTH_LOG_SAMPLE_RATE = 0.01; // Log 1% of health checks

router.get('/health', async (req, res) => {
  const log = createRequestLogger(req);
  const shouldLog = Math.random() < HEALTH_LOG_SAMPLE_RATE;
  
  const checks = await runHealthChecks();
  const { status } = aggregateStatus(checks);
  
  // Always log if degraded/unhealthy, sample if healthy
  if (status !== 'healthy' || shouldLog) {
    log.info('Health check', { 
      status,
      sampled: shouldLog,
      checks: Object.fromEntries(
        Object.entries(checks).map(([k, v]) => [k, v.status])
      )
    });
  }
  
  // ... rest of handler
});
```

**Why sample:**
- Health checks may run every 10-30 seconds from multiple sources (LB, monitoring)
- Without sampling, health logs can dominate log volume
- Always log degraded/unhealthy for incident response

---

## Summary

| Layer | Request ID Usage |
|-------|-----------------|
| HTTP Header | `X-Request-ID` / `X-Correlation-ID` / `traceparent` (in), `X-Request-ID` (out) |
| Request Object | `req.requestId` |
| Response Locals | `res.locals.requestId` |
| All Log Entries | `request_id` field |
| Error Reports | Sentry tag |
| API Responses | `meta.request_id` |
| Job Data | `requestId` field |
| External Calls | Metadata/comments |
| Database | SQL comment (optional) |
| Frontend | Header + error display |
| Health Checks | Sampled logging (1% healthy, 100% degraded/unhealthy) |

This enables tracing any issue from user report → API → job → database → external service.
