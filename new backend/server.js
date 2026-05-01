// ---------------------------------------------------------
// AOME | AI Visibility & Readiness Tool
// Production Server Setup (v2 - Integrated with new DB module)
// ---------------------------------------------------------

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const db = require('./db/connect'); // ✅ Single import, use namespace
const requireInternalAccess = require('./middleware/requireInternalAccess');

const app = express();
const PORT = process.env.PORT || 3001;

// ----------------------------------
// Utility: Timestamped logger
// ----------------------------------
const log = (...msg) => console.log(`[${new Date().toISOString()}]`, ...msg);

// ----------------------------------
// Basic Middleware (security + body parsing)
// ----------------------------------
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ----------------------------------
// Lightweight Request + Response Logging
// ----------------------------------
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ----------------------------------
// CORS Configuration
// ----------------------------------
const allowedOrigins =
  process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:8000',
  ];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

// ----------------------------------
// Rate Limiting
// ----------------------------------
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 50,
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ----------------------------------
// API Routes (v1 prefix for versioning)
// ----------------------------------
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/analyze', require('./routes/analyze'));
app.use('/api/v1/validate', require('./routes/validate'));
app.use('/api/v1/subscription', require('./routes/subscription'));

// ----------------------------------
// Health Check (includes DB status)
// ----------------------------------
app.get('/health', async (req, res) => {
  try {
    const health = await db.healthCheck(); // ✅ Use built-in health check
    res.status(health.healthy ? 200 : 503).json({
      status: health.healthy ? 'healthy' : 'degraded',
      database: health.healthy ? 'connected' : 'disconnected',
      timestamp: health.timestamp,
      uptime: process.uptime(),
    });
  } catch (err) {
    log('❌ Health check error:', err.message);
    res.status(503).json({
      status: 'unhealthy',
      database: 'error',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// ----------------------------------
// Pool Statistics (monitoring endpoint)
// Restricted: requires the `x-metrics-key` header matching
// INTERNAL_METRICS_KEY. Fail-closed if the env var is unset.
// ----------------------------------
app.get('/pool-stats', requireInternalAccess, (req, res) => {
  try {
    const stats = db.getPoolStats();
    if (!stats) {
      return res.status(503).json({ error: 'Pool not initialized' });
    }
    res.json({
      ...stats,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log('❌ Pool stats error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve pool stats' });
  }
});

// ----------------------------------
// 404 Handler
// ----------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ----------------------------------
// Global Error Handler
// ----------------------------------
app.use((err, req, res, next) => {
  log('❌ Unhandled Error:', err);
  
  const response = {
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' 
      ? err.message 
      : 'Something went wrong.',
  };

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(err.status || 500).json(response);
});

// ----------------------------------
// Graceful Shutdown
// NOTE: The db module already handles SIGINT/SIGTERM,
// but we add app-specific cleanup here if needed
// ----------------------------------
let isShuttingDown = false;

async function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log(`📡 Received ${signal}, shutting down server...`);
  
  // The db module will handle pool cleanup automatically
  // Add any other app-specific cleanup here (e.g., close Redis, etc.)
  
  process.exit(0);
}

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => handleShutdown(signal));
});

// ----------------------------------
// Server Bootstrapping
// ----------------------------------
(async () => {
  try {
    await db.connectDB(); // ✅ Initialize DB connection first
    
    app.listen(PORT, () => {
      log(`✅ AOME API running on port ${PORT}`);
      log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      log(`🔒 CORS enabled for: ${allowedOrigins.join(', ')}`);
    });
  } catch (err) {
    log('❌ Failed to start server:', err.message);
    process.exit(1);
  }
})();