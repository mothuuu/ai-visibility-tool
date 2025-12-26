require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const aiTestingRoutes = require('./routes/ai-testing');
const authRoutes = require('./routes/auth');
const subscriptionRoutes = require('./routes/subscription');
const scanRoutes = require('./routes/scan');
const recommendationRoutes = require('./routes/recommendations');
const competitorRoutes = require('./routes/competitors');
const feedbackRoutes = require('./routes/feedback');
const supportChatRoutes = require('./routes/support-chat');
const waitlistRoutes = require('./routes/waitlist');
const adminRoutes = require('./routes/admin');
const stripeWebhookRoutes = require('./routes/stripe-webhook');
const citationNetworkRoutes = require('./routes/citationNetwork');

// Background jobs
const { getWorker } = require('./jobs/submissionWorker');
const { sendActionReminders } = require('./jobs/citationNetworkReminders');

const app = express();
const PORT = process.env.PORT || 3001;

// CRITICAL: Trust proxy for Render deployment
// Set to 1 to trust the first proxy (Render's reverse proxy)
// This is required for rate limiting and IP-based features to work correctly
app.set('trust proxy', 1);

// Stripe webhook needs raw body - must be before express.json()
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use('/api/subscription/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security middleware
app.use(helmet());
app.use(compression());

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()) || [
  'https://www.visible2ai.com',
  'https://visible2ai.com',
  'https://ai-visibility-tool.onrender.com',
  'http://localhost:3000',
  'http://localhost:8000'
];

console.log('🌐 Allowed CORS origins:', allowedOrigins);

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Rate limiting - Fixed for Render
// Trust proxy is set at app level, don't override it here
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 50,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW_MS) / 1000 / 60)
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return req.path === '/health';
  }
});

app.use('/api/', limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/api/webhooks', stripeWebhookRoutes); // Stripe webhooks (must be before other routes)
app.use('/api/auth', authRoutes);
app.use('/api', aiTestingRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/competitors', competitorRoutes); // Competitive tracking (Elite mode)
app.use('/api/feedback', feedbackRoutes);
app.use('/api/support-chat', supportChatRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/admin', adminRoutes); // Admin routes
app.use('/api/citation-network', citationNetworkRoutes); // AI Citation Network
app.use('/api/test', require('./routes/test-routes'));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`AI Visibility API server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);

  // ============================================================================
  // Background Workers & Scheduled Jobs
  // ============================================================================

  // Start submission worker (processes queued directory submissions)
  if (process.env.ENABLE_SUBMISSION_WORKER === '1') {
    console.log('[Server] Starting submission worker...');
    const worker = getWorker();
    worker.start();

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('[Server] SIGTERM received, stopping worker...');
      worker.stop();
    });
    process.on('SIGINT', () => {
      console.log('[Server] SIGINT received, stopping worker...');
      worker.stop();
    });
  } else {
    console.log('[Server] Submission worker disabled (set ENABLE_SUBMISSION_WORKER=1 to enable)');
  }

  // Schedule citation network reminder emails (daily at 9am UTC)
  if (process.env.ENABLE_CITATION_REMINDERS === '1') {
    console.log('[Server] Scheduling citation network reminders (daily at 9am UTC)...');
    cron.schedule('0 9 * * *', async () => {
      console.log('[Cron] Running citation network reminders...');
      try {
        const result = await sendActionReminders();
        console.log('[Cron] Reminders complete:', result);
      } catch (error) {
        console.error('[Cron] Reminder job failed:', error);
      }
    });
  } else {
    console.log('[Server] Citation reminders disabled (set ENABLE_CITATION_REMINDERS=1 to enable)');
  }
});