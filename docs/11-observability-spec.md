# Visible2AI - Observability Specification
## Logging, Errors, Metrics & Alerting

**Version:** 1.1  
**Date:** 2026-01-03

---

## Overview

Observability enables us to understand system behavior, debug issues, and proactively prevent problems. This spec covers:

1. **Request Correlation** - Trace requests end-to-end
2. **Error Tracking** - Capture and alert on errors
3. **Logging** - Structured, queryable logs
4. **Metrics** - Key performance indicators
5. **Alerting** - Proactive notification
6. **Dashboards** - Visual monitoring

---

## 1. Request Correlation

### Request ID Format
```
req_{timestamp}_{random}
Example: req_1704283200_a7b3c9d2
```

**Note:** `randomBytes(4)` produces 8 hex chars. If collisions are observed at scale, bump to `randomBytes(8)` for 16 hex chars.

### Flow
```
[Browser] → [API Gateway] → [Backend] → [Job Worker] → [Database]
    │            │              │             │             │
    └────────────┴──────────────┴─────────────┴─────────────┘
                    Same request_id everywhere
```

### Implementation

```javascript
// middleware/requestId.js
const crypto = require('crypto');

function generateRequestId() {
  const timestamp = Math.floor(Date.now() / 1000);
  const random = crypto.randomBytes(4).toString('hex');
  return `req_${timestamp}_${random}`;
}

// Extract trace ID from W3C traceparent header
function extractTraceId(traceparent) {
  if (!traceparent) return null;
  const parts = traceparent.split('-');
  if (parts.length >= 2 && parts[1].length === 32) {
    return `trace_${parts[1].substring(0, 16)}`;
  }
  return null;
}

function requestIdMiddleware(req, res, next) {
  // Accept multiple header formats (per correlation-id-spec v1.1)
  req.requestId = 
    req.headers['x-request-id'] ||
    req.headers['x-correlation-id'] ||
    extractTraceId(req.headers['traceparent']) ||
    generateRequestId();
  
  res.setHeader('X-Request-ID', req.requestId);
  next();
}
```

### Accepted Headers (Priority Order)
| Header | Standard | Notes |
|--------|----------|-------|
| `X-Request-ID` | Common | Primary |
| `X-Correlation-ID` | Common | Alternative |
| `traceparent` | W3C Trace Context | OpenTelemetry compatible |

### Where Request ID Appears
- HTTP response header: `X-Request-ID`
- All log entries: `request_id` field
- Error reports: Sentry tag
- API responses: `meta.request_id`
- Job payloads: `requestId` field
- Database queries: SQL comment (optional)

---

## 2. Error Tracking (Sentry)

### Setup

```javascript
// config/sentry.js
const Sentry = require('@sentry/node');
const { ProfilingIntegration } = require('@sentry/profiling-node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION,
  
  integrations: [
    new ProfilingIntegration(),
  ],
  
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  profilesSampleRate: 0.1,
  
  ignoreErrors: [
    'TokenExpiredError',
    'ECONNRESET',
  ],
});
```

### Request Scope Middleware (Reliable Request ID Tagging)

**Important:** Don't rely on `hint.originalException?.requestId` in `beforeSend()` — it often won't exist. Instead, set Sentry scope tags for the lifetime of each request:

```javascript
// middleware/sentryScope.js
const Sentry = require('@sentry/node');

function sentryRequestScope(req, res, next) {
  Sentry.configureScope(scope => {
    scope.setTag('request_id', req.requestId);
    scope.setTag('path', req.path);
    scope.setTag('method', req.method);
    
    if (req.user) {
      scope.setUser({ 
        id: req.user.id, 
        email: req.user.email,
        org_id: req.user.organizationId 
      });
      scope.setTag('org_id', req.user.organizationId);
      scope.setTag('plan', req.user.plan);
    }
  });
  next();
}

// Apply AFTER requestIdMiddleware and auth middleware
app.use(sentryRequestScope);
```

### Handling Quota/Expected Errors

**Don't drop quota errors entirely** — they should be:
- ❌ NOT sent to Sentry (noise)
- ✅ Counted in metrics (for abuse/capacity monitoring)
- ✅ Logged at `info` or `warn` level (for debugging)
- ✅ Include `request_id` in response meta (for user support tracing)

```javascript
// middleware/errorHandler.js
function errorHandler(err, req, res, next) {
  const log = createRequestLogger(req);
  
  if (err.code === 'QUOTA_EXCEEDED' || err.code === 'RATE_LIMIT') {
    // Log for debugging/audit (not Sentry)
    log.info('Expected limit error', {
      code: err.code,
      user_id: req.user?.id,
      limit: err.limit,
      used: err.used,
    });
    
    // Count in metrics
    quotaErrorCounter.inc({ 
      type: err.code, 
      plan: req.user?.plan || 'unknown' 
    });
    
    // Don't send to Sentry
    return res.status(err.code === 'RATE_LIMIT' ? 429 : 402).json({
      success: false,
      error: { code: err.code, message: err.message },
      meta: { request_id: req.requestId }
    });
  }
  
  // Unexpected errors go to Sentry
  Sentry.captureException(err);
  // ... rest of error handling
}
```

### Error Classification

| Level | When to Use | Example |
|-------|-------------|---------|
| `fatal` | System cannot continue | Database connection lost |
| `error` | Operation failed | Scan failed after retries |
| `warning` | Unexpected but handled | AI API timeout, using fallback |
| `info` | Noteworthy events | User upgraded plan |

### Custom Error Context

```javascript
// Always include context when capturing errors
try {
  await processPayment(userId, amount);
} catch (error) {
  Sentry.withScope(scope => {
    scope.setTag('request_id', req.requestId);
    scope.setTag('operation', 'payment');
    scope.setUser({ id: userId, email: user.email });
    scope.setContext('payment', {
      amount,
      currency: 'USD',
      stripe_customer_id: user.stripeCustomerId,
    });
    Sentry.captureException(error);
  });
  throw error;
}
```

### Error Grouping

Configure fingerprinting for better grouping:

```javascript
Sentry.init({
  // ...
  beforeSend(event, hint) {
    // Group AI API errors together
    if (event.message?.includes('AI_PROVIDER')) {
      event.fingerprint = ['ai-provider-error', event.tags?.provider];
    }
    
    // Group scan failures by type
    if (event.tags?.operation === 'scan') {
      event.fingerprint = ['scan-error', event.tags?.scan_type];
    }
    
    return event;
  },
});
```

---

## 3. Logging

### Logger Configuration

```javascript
// config/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  
  defaultMeta: {
    service: 'visible2ai-api',
    version: process.env.APP_VERSION,
    build_sha: process.env.BUILD_SHA || process.env.GIT_COMMIT || 'unknown',
    env: process.env.NODE_ENV,
  },
  
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'development'
        ? winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        : winston.format.json()
    }),
  ],
});

// Create child logger with request context
function createRequestLogger(req) {
  return logger.child({
    request_id: req.requestId,
    user_id: req.user?.id,
    org_id: req.user?.organizationId,
    ip: req.ip,
    path: req.path,
    method: req.method,
  });
}
```

### Log Levels

| Level | Use For | Example |
|-------|---------|---------|
| `error` | Failures requiring attention | Scan failed, payment failed |
| `warn` | Potential issues | Slow query, rate limit approaching |
| `info` | Key business events | Scan complete, user signed up |
| `debug` | Development details | Request payload, SQL query |
| `silly` | Verbose debugging | Loop iterations, cache hits |

### Standard Log Fields

Every log entry MUST include:
- `timestamp` - ISO 8601 format
- `level` - error/warn/info/debug
- `message` - Human-readable description
- `request_id` - Correlation ID (if in request context)

Every log entry SHOULD include:
- `user_id` - If authenticated
- `org_id` - If authenticated
- `duration_ms` - For operations with timing
- `operation` - What was being done

### Log Examples

```javascript
// Good: Structured with context
log.info('Scan completed', {
  scan_id: scan.id,
  url: scan.url,
  score: scan.totalScore,
  duration_ms: Date.now() - startTime,
  recommendation_count: recommendations.length,
});

// Bad: Unstructured, no context
log.info(`Scan ${scan.id} finished with score ${scan.totalScore}`);
```

### Sensitive Data

NEVER log:
- Passwords (even hashed)
- Full credit card numbers
- API keys or secrets
- Full email addresses in debug logs
- Personal health information

Redact when necessary:
```javascript
function redactEmail(email) {
  const [local, domain] = email.split('@');
  return `${local.substring(0, 2)}***@${domain}`;
}
```

---

## 4. Metrics

### Key Performance Indicators (KPIs)

| Metric | Type | Target | Alert Threshold |
|--------|------|--------|-----------------|
| Scan success rate | Percentage | > 95% | < 90% |
| Scan p95 latency | Duration | < 30s | > 60s |
| Zero-rec rate | Percentage | < 1% | > 5% |
| API error rate | Percentage | < 1% | > 5% |
| Webhook success rate | Percentage | > 99% | < 95% |
| Queue depth | Count | < 50 | > 200 |
| Active scans | Count | < 20 | > 50 |

**Zero-rec rate definition:** Computed at the API layer — a scan counts as "zero-rec" if the recommendations array is empty OR contains only diagnostic/metadata entries. This metric is based on the API contract (Never Zero), not UI display caps (`recommendationsVisible`).

### Custom Metrics

```javascript
// metrics/index.js
const prometheus = require('prom-client');

// Counters
const scanCounter = new prometheus.Counter({
  name: 'visible2ai_scans_total',
  help: 'Total number of scans',
  labelNames: ['status', 'plan'],
});

// Histograms
const scanDuration = new prometheus.Histogram({
  name: 'visible2ai_scan_duration_seconds',
  help: 'Scan duration in seconds',
  labelNames: ['plan'],
  buckets: [5, 10, 20, 30, 45, 60, 90, 120],
});

// Gauges
const activeScans = new prometheus.Gauge({
  name: 'visible2ai_active_scans',
  help: 'Number of currently active scans',
});

// Usage
function recordScanComplete(scan, durationMs) {
  scanCounter.inc({ status: 'complete', plan: scan.plan });
  scanDuration.observe({ plan: scan.plan }, durationMs / 1000);
}
```

### Metrics Endpoint

```javascript
// routes/metrics.js
const METRICS_TOKEN = process.env.METRICS_TOKEN;
const ALLOWED_IPS = (process.env.METRICS_ALLOWED_IPS || '').split(',').filter(Boolean);

function metricsAuth(req, res, next) {
  // Option 1: Token auth (for external scrapers)
  const token = req.headers['x-metrics-token'];
  if (METRICS_TOKEN && token === METRICS_TOKEN) {
    return next();
  }
  
  // Option 2: IP allowlist (for internal/VPC)
  const clientIp = req.ip || req.connection.remoteAddress;
  if (ALLOWED_IPS.length > 0 && ALLOWED_IPS.includes(clientIp)) {
    return next();
  }
  
  // Option 3: Localhost only (development)
  if (process.env.NODE_ENV === 'development' && 
      (clientIp === '127.0.0.1' || clientIp === '::1')) {
    return next();
  }
  
  return res.status(403).json({ 
    success: false,
    error: { code: 'FORBIDDEN', message: 'Metrics endpoint access denied' },
    meta: { request_id: req.requestId, timestamp: new Date().toISOString() }
  });
}

router.get('/metrics', metricsAuth, async (req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.end(await prometheus.register.metrics());
});
```

**Production Options:**
- Set `METRICS_TOKEN` for external Prometheus/Datadog
- Set `METRICS_ALLOWED_IPS` for VPC-internal scraping
- Use a separate internal port (e.g., 9090) not exposed to public

**Important:** Ensure `requestIdMiddleware` runs before the `/metrics` route so `req.requestId` exists for the 403 envelope.

---

## 5. Alerting

### Alert Channels

| Channel | Use For | Response Time |
|---------|---------|---------------|
| PagerDuty | Critical (P1) | 5 minutes |
| Slack #alerts | High (P2) | 30 minutes |
| Slack #warnings | Medium (P3) | 4 hours |
| Email | Low (P4) | Next business day |

### Alert Rules

#### Critical (P1) - Page Immediately

```yaml
# System down
- name: SystemUnhealthy
  condition: health_status == "unhealthy" for 2m
  severity: critical
  action: pagerduty

# Database down
- name: DatabaseDown
  condition: database_health == "down" for 1m
  severity: critical
  action: pagerduty

# Zero scans completing
- name: ScanPipelineDead
  condition: scan_success_count == 0 for 10m during business_hours
  severity: critical
  action: pagerduty
```

#### High (P2) - Slack Alert

```yaml
# High error rate
- name: HighErrorRate
  condition: api_error_rate > 5% for 5m
  severity: high
  action: slack_alerts

# Many scan failures
- name: ScanFailureSpike
  condition: scan_failure_rate > 10% for 5m
  severity: high
  action: slack_alerts

# Webhook failures
- name: WebhookFailures
  condition: webhook_failure_rate > 5% for 5m
  severity: high
  action: slack_alerts
```

#### Medium (P3) - Slack Warning

```yaml
# Slow scans
- name: SlowScans
  condition: scan_p95_latency > 60s for 10m
  severity: medium
  action: slack_warnings

# Queue building up
- name: QueueBacklog
  condition: queue_depth > 100 for 5m
  severity: medium
  action: slack_warnings

# Zero recommendations
- name: ZeroRecSpike
  condition: zero_recommendation_rate > 3% for 15m
  severity: medium
  action: slack_warnings

# Database capacity
- name: DatabaseCapacity
  condition: database_used_percent > 80%
  severity: medium
  action: slack_warnings
```

### Alert Message Format

```
🚨 [CRITICAL] SystemUnhealthy

Environment: production
Triggered: 2026-01-03 12:00:00 UTC

Condition: Health endpoint returned "unhealthy" for 2 minutes

Current Status:
- Database: down
- Redis: up
- Stripe: up

Runbook: docs/runbooks/system-unhealthy.md

Acknowledge: [Button]
```

---

## 6. Dashboards

### Overview Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│ VISIBLE2AI OPERATIONS                     [Last 24 hours ▼] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [HEALTHY]      [95.2%]        [28s]         [2]           │
│   System      Scan Success    Scan P95    Active Scans     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Scans Over Time                    Errors Over Time        │
│  ╭──────────────────╮              ╭──────────────────╮    │
│  │    ╱╲    ╱╲     │              │         ╱╲       │    │
│  │   ╱  ╲  ╱  ╲    │              │        ╱  ╲      │    │
│  │  ╱    ╲╱    ╲   │              │       ╱    ╲     │    │
│  ╰──────────────────╯              ╰──────────────────╯    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Recent Errors                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 12:05 | ERROR | Scan timeout | req_xxx | user_123   │   │
│  │ 11:58 | WARN  | Slow query   | req_xxx | 2500ms     │   │
│  │ 11:45 | ERROR | AI API 429   | req_xxx | retry 2    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Dashboard Panels

1. **System Health** - Traffic light (green/yellow/red)
2. **Scan Success Rate** - Percentage gauge
3. **Scan Latency** - P50, P95, P99 graph
4. **Active Scans** - Current count
5. **Queue Depth** - Jobs waiting
6. **Error Rate** - By type over time
7. **Zero-Rec Rate** - Percentage
8. **Revenue Metrics** - MRR, conversions

---

## 7. Runbooks

### Quick Reference

| Issue | Runbook |
|-------|---------|
| System unhealthy | `docs/runbooks/system-unhealthy.md` |
| High error rate | `docs/runbooks/high-error-rate.md` |
| Scan failures | `docs/runbooks/scan-failures.md` |
| Zero recs spike | `docs/runbooks/zero-recommendations.md` |
| Database slow | `docs/runbooks/database-slow.md` |
| Queue stuck | `docs/runbooks/queue-stuck.md` |

**Note:** Create these runbook files as issues are encountered. Use the template below.

### Runbook Template

```markdown
# Runbook: [Issue Name]

## Symptoms
- What alerts fire
- What users see

## Impact
- Who is affected
- Business impact

## Diagnosis
1. Step to identify cause
2. Step to confirm

## Resolution
1. Immediate fix
2. Verification step

## Prevention
- Long-term fix
- Monitoring to add
```

---

## 8. Implementation Checklist

### Immediate (Phase 0)
- [ ] Set up Sentry project
- [ ] Configure DSN in environment variables
- [ ] Deploy request ID middleware
- [ ] Deploy structured logging
- [ ] Create health endpoint
- [ ] Set up Slack webhook for alerts

### Phase 2 (Core Services)
- [ ] Add metrics collection
- [ ] Create main dashboard
- [ ] Configure alert rules
- [ ] Document runbooks

### Ongoing
- [ ] Review and tune alerts monthly
- [ ] Update runbooks after incidents
- [ ] Add metrics for new features
