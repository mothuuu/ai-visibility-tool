# Visible2AI - Health Endpoint Specification
## System Health Monitoring

**Version:** 1.1  
**Date:** 2026-01-03

---

## Overview

The health endpoint provides real-time status of all system components. It's used for:
- Load balancer health checks
- Monitoring and alerting
- Debugging system issues
- Deployment readiness checks

### Endpoint Strategy

| Endpoint | Purpose | HTTP Response | Used By |
|----------|---------|---------------|---------|
| `GET /api/healthz` | **Shallow check** - Process alive | Always 200 if process up | Load balancer |
| `GET /api/health` | **Deep check** - All dependencies | 200 (healthy/degraded) or 503 (unhealthy) | Monitoring, support |

**Why two endpoints:**
- Load balancers should use `/healthz` (fast, always 200 if process runs)
- Monitoring/alerting should use `/health` (full status, may return 503)

If using a single endpoint, configure LB to match on 200 only while monitoring alerts on `status: degraded/unhealthy`.

---

## Endpoint

```
GET /api/health      # Deep check (monitoring)
GET /api/healthz     # Shallow check (load balancer)
```

**Authentication:** None required (public endpoint)

---

## Response Format

### Healthy System (HTTP 200)

```json
{
  "status": "healthy",
  "timestamp": "2026-01-03T12:00:00.000Z",
  "version": "2.1.0",
  "build_sha": "a1b2c3d4e5f6",
  "env": "production",
  "uptime_seconds": 86400,
  "checks": {
    "database": {
      "status": "up",
      "latency_ms": 5,
      "details": {
        "pool_size": 10,
        "active_connections": 3
      }
    },
    "redis": {
      "status": "up",
      "latency_ms": 2,
      "details": {
        "connected_clients": 5,
        "memory_used_mb": 128
      }
    },
    "stripe": {
      "status": "up",
      "latency_ms": null,
      "details": {
        "last_webhook_at": "2026-01-03T11:55:00.000Z",
        "api_key_valid": true
      }
    },
    "ai_provider": {
      "status": "up",
      "latency_ms": null,
      "details": {
        "primary": "anthropic",
        "fallback": "openai",
        "api_key_valid": true
      }
    },
    "queue": {
      "status": "up",
      "latency_ms": 3,
      "details": {
        "pending_jobs": 5,
        "active_jobs": 2,
        "failed_jobs_24h": 1
      }
    }
  }
}
```

### Degraded System (HTTP 200)

```json
{
  "status": "degraded",
  "timestamp": "2026-01-03T12:00:00.000Z",
  "version": "2.1.0",
  "build_sha": "a1b2c3d4e5f6",
  "env": "production",
  "uptime_seconds": 86400,
  "checks": {
    "database": {
      "status": "up",
      "latency_ms": 5
    },
    "redis": {
      "status": "down",
      "latency_ms": null,
      "error": "Connection refused"
    },
    "stripe": {
      "status": "up",
      "latency_ms": null
    },
    "ai_provider": {
      "status": "up",
      "latency_ms": null
    },
    "queue": {
      "status": "degraded",
      "latency_ms": null,
      "error": "Redis unavailable, using in-memory queue"
    }
  },
  "degraded_services": ["redis", "queue"],
  "message": "System operating with reduced functionality"
}
```

### Unhealthy System (HTTP 503)

```json
{
  "status": "unhealthy",
  "timestamp": "2026-01-03T12:00:00.000Z",
  "version": "2.1.0",
  "build_sha": "a1b2c3d4e5f6",
  "env": "production",
  "uptime_seconds": 86400,
  "checks": {
    "database": {
      "status": "down",
      "latency_ms": null,
      "error": "Connection timeout after 5000ms"
    },
    "redis": {
      "status": "up",
      "latency_ms": 2
    },
    "stripe": {
      "status": "up",
      "latency_ms": null
    },
    "ai_provider": {
      "status": "up",
      "latency_ms": null
    },
    "queue": {
      "status": "up",
      "latency_ms": 3
    }
  },
  "failed_services": ["database"],
  "message": "Critical service unavailable"
}
```

---

## Status Definitions

### Overall Status

| Status | HTTP Code | Meaning |
|--------|-----------|---------|
| `healthy` | 200 | All services operational |
| `degraded` | 200 | Non-critical services down, system functional |
| `unhealthy` | 503 | Critical services down, system non-functional |

### Service Status

| Status | Meaning |
|--------|---------|
| `up` | Service responding normally |
| `degraded` | Service responding with issues |
| `down` | Service not responding |

---

## Individual Health Checks

### Database Check

**What it checks:**
- Can execute `SELECT 1`
- Response time < 100ms
- Connection pool has available connections

**Implementation:**
```javascript
async function checkDatabase() {
  const start = Date.now();
  try {
    const result = await pool.query('SELECT 1 as health');
    const latency = Date.now() - start;
    
    return {
      status: latency < 100 ? 'up' : 'degraded',
      latency_ms: latency,
      details: {
        pool_size: pool.options.max,
        active_connections: pool.totalCount - pool.idleCount
      }
    };
  } catch (error) {
    return {
      status: 'down',
      latency_ms: null,
      error: error.message
    };
  }
}
```

**Criticality:** CRITICAL - System cannot function without database

---

### Redis Check

**What it checks:**
- Can execute `PING`
- Response time < 50ms

**Implementation:**
```javascript
async function checkRedis() {
  const start = Date.now();
  try {
    await redis.ping();
    const latency = Date.now() - start;
    
    const info = await redis.info('clients');
    const memory = await redis.info('memory');
    
    return {
      status: latency < 50 ? 'up' : 'degraded',
      latency_ms: latency,
      details: {
        connected_clients: parseInfo(info, 'connected_clients'),
        memory_used_mb: parseMemoryToMB(memory, 'used_memory')  // Returns numeric MB
      }
    };
  } catch (error) {
    return {
      status: 'down',
      latency_ms: null,
      error: error.message
    };
  }
}

// Helper: parse Redis used_memory (bytes) to MB
function parseMemoryToMB(info, key) {
  const bytes = parseInt(parseInfo(info, key), 10);
  return Math.round(bytes / 1024 / 1024);
}
```

**Criticality:** NON-CRITICAL for caching, but **DEGRADED impact on queue**
- Redis down → caching disabled (minor performance impact)
- Redis down → queue falls back to in-memory (jobs may be lost on restart)
- See "Degraded System" example: Redis down causes queue to show `status: degraded`

---

### Stripe Check

**What it checks:**
- API key is valid (cached, refreshed every 5 minutes)
- Recent webhook received (within last hour)

**Implementation:**
```javascript
// Cached check - don't hit Stripe on every health request
let stripeKeyValid = null;
let stripeKeyCheckedAt = null;

async function checkStripe() {
  const now = Date.now();
  
  // Refresh cache every 5 minutes
  if (!stripeKeyCheckedAt || now - stripeKeyCheckedAt > 5 * 60 * 1000) {
    try {
      await stripe.customers.list({ limit: 1 });
      stripeKeyValid = true;
    } catch (error) {
      stripeKeyValid = false;
    }
    stripeKeyCheckedAt = now;
  }
  
  // Check last webhook
  const lastWebhook = await pool.query(
    'SELECT created_at FROM webhook_events ORDER BY created_at DESC LIMIT 1'
  );
  
  return {
    status: stripeKeyValid ? 'up' : 'down',
    latency_ms: null,  // Don't measure, it's cached
    details: {
      api_key_valid: stripeKeyValid,
      last_webhook_at: lastWebhook.rows[0]?.created_at || null
    }
  };
}
```

**Criticality:** NON-CRITICAL - Existing subscriptions work, new signups may fail

---

### AI Provider Check

**What it checks:**
- Primary provider API key valid (cached)
- Fallback provider available

**Implementation:**
```javascript
let aiProviderValid = null;
let aiProviderCheckedAt = null;

async function checkAIProvider() {
  const now = Date.now();
  
  // Refresh cache every 5 minutes
  if (!aiProviderCheckedAt || now - aiProviderCheckedAt > 5 * 60 * 1000) {
    try {
      // Minimal API call to verify key
      await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }]
      });
      aiProviderValid = true;
    } catch (error) {
      aiProviderValid = false;
    }
    aiProviderCheckedAt = now;
  }
  
  return {
    status: aiProviderValid ? 'up' : 'degraded',
    latency_ms: null,
    details: {
      primary: 'anthropic',
      fallback: 'openai',
      api_key_valid: aiProviderValid
    }
  };
}
```

**Criticality:** NON-CRITICAL - Fallback templates available

---

### Queue Check

**What it checks:**
- Queue is accessible
- Job counts

**Implementation:**
```javascript
async function checkQueue() {
  try {
    const pending = await scanQueue.getWaitingCount();
    const active = await scanQueue.getActiveCount();
    const failed = await scanQueue.getFailedCount();
    
    return {
      status: 'up',
      latency_ms: 3,
      details: {
        pending_jobs: pending,
        active_jobs: active,
        failed_jobs_24h: failed
      }
    };
  } catch (error) {
    return {
      status: 'down',
      latency_ms: null,
      error: error.message
    };
  }
}
```

**Criticality:** DEGRADED - Scans queue in memory, may lose on restart

---

## Aggregation Logic

```javascript
function aggregateStatus(checks) {
  const criticalServices = ['database'];
  const allServices = Object.keys(checks);
  
  // Any critical service down = unhealthy
  for (const service of criticalServices) {
    if (checks[service]?.status === 'down') {
      return {
        status: 'unhealthy',
        failed_services: [service],
        message: 'Critical service unavailable'
      };
    }
  }
  
  // Any service degraded or down = degraded
  const degraded = allServices.filter(
    s => checks[s]?.status === 'down' || checks[s]?.status === 'degraded'
  );
  
  if (degraded.length > 0) {
    return {
      status: 'degraded',
      degraded_services: degraded,
      message: 'System operating with reduced functionality'
    };
  }
  
  return {
    status: 'healthy'
  };
}
```

---

## Complete Implementation

```javascript
// backend/routes/health.js
const express = require('express');
const router = express.Router();

// Environment variables (set at build/deploy time)
const BUILD_SHA = process.env.BUILD_SHA || process.env.GIT_COMMIT || 'unknown';
const ENV = process.env.NODE_ENV || 'development';
const APP_VERSION = process.env.APP_VERSION || '2.1.0';

// ─────────────────────────────────────────────────────────────────────────
// Shallow health check (for load balancers)
// Always returns 200 if process is alive
// ─────────────────────────────────────────────────────────────────────────
router.get('/healthz', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    build_sha: BUILD_SHA,
    env: ENV
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Deep health check (for monitoring)
// Returns 503 if critical services are down
// ─────────────────────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  const startTime = process.hrtime();
  
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    stripe: await checkStripe(),
    ai_provider: await checkAIProvider(),
    queue: await checkQueue()
  };
  
  const { status, ...statusDetails } = aggregateStatus(checks);
  
  const response = {
    status,
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    build_sha: BUILD_SHA,
    env: ENV,
    uptime_seconds: Math.floor(process.uptime()),
    checks,
    ...statusDetails
  };
  
  const httpStatus = status === 'unhealthy' ? 503 : 200;
  res.status(httpStatus).json(response);
});

module.exports = router;
```

---

## Load Balancer Configuration

**Recommendation:** Use `/api/healthz` for load balancers (always 200 if process up).
Use `/api/health` for monitoring/alerting (returns 503 when unhealthy).

### AWS ALB

```yaml
# Use shallow check for LB (fast, always 200 if alive)
HealthCheckPath: /api/healthz
HealthCheckIntervalSeconds: 30
HealthCheckTimeoutSeconds: 5
HealthyThresholdCount: 2
UnhealthyThresholdCount: 3
Matcher:
  HttpCode: 200
```

### Render

```yaml
healthCheckPath: /api/healthz
```

---

## Monitoring Integration

**Use `/api/health` (deep check) for monitoring** - alerts on actual dependency failures.

### Datadog

```yaml
# datadog.yaml
init_config:
instances:
  - url: https://api.visible2ai.com/api/health
    name: visible2ai_health
    timeout: 5
    # Accept both 200 (healthy/degraded) and 503 (unhealthy)
    # Alert based on status field, not HTTP code
    http_response_status_code: 200,503
```

### Prometheus

```yaml
# prometheus scrape config
- job_name: 'visible2ai'
  scrape_interval: 30s
  metrics_path: /api/health
  static_configs:
    - targets: ['api.visible2ai.com']
```

---

## Alerting Rules

| Condition | Severity | Action |
|-----------|----------|--------|
| status = unhealthy for 2min | CRITICAL | Page on-call |
| status = degraded for 5min | WARNING | Slack alert |
| database.latency_ms > 100 for 5min | WARNING | Slack alert |
| queue.failed_jobs_24h > 10 | WARNING | Slack alert |
