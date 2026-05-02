// ---------------------------------------------------------
// PostgreSQL Connection Utility (Production-Ready)
// ---------------------------------------------------------
const { Pool } = require('pg');

let pool;
let connectionPromise;
let isShuttingDown = false;

/**
 * Safely parse integer environment variables
 */
function getEnvInt(key, defaultValue) {
  const val = process.env[key];
  if (!val) return defaultValue;
  
  const parsed = parseInt(val, 10);
  if (isNaN(parsed) || parsed <= 0) {
    console.warn(`⚠️  Invalid ${key}="${val}", using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Get SSL configuration based on environment
 */
function getSSLConfig() {
  if (process.env.NODE_ENV !== 'production') {
    return false;
  }

  // Allow disabling SSL verification for specific hosting platforms
  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
  
  const sslConfig = {
    rejectUnauthorized,
  };

  // Optional: Add custom CA certificate
  if (process.env.DB_SSL_CA) {
    sslConfig.ca = process.env.DB_SSL_CA;
  }

  return sslConfig;
}

/**
 * Create a new pool instance with event handlers
 */
async function createPool() {
  const newPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: getEnvInt('DB_MAX_CONNECTIONS', 20),
    idleTimeoutMillis: getEnvInt('DB_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMillis: getEnvInt('DB_CONN_TIMEOUT_MS', 2000),
    ssl: getSSLConfig(),
  });

  // Monitor pool-level errors (e.g., idle client disconnects)
  newPool.on('error', (err, client) => {
    console.error('❌ Unexpected pool error on idle client:', err.message);
  });

  // Optional: Log new connections (remove in production if too noisy)
  newPool.on('connect', (client) => {
    console.log('🔌 New client connected to pool');
  });

  // Health check to verify connection
  try {
    await newPool.query('SELECT NOW()');
    console.log('✅ Connected to PostgreSQL database.');
  } catch (err) {
    await newPool.end().catch(() => {}); // Clean up failed pool
    throw err;
  }

  return newPool;
}

/**
 * Thread-safe connection initializer.
 * Guarantees only one pool is ever created.
 */
async function connectDB() {
  if (pool) return pool;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      const p = await createPool();
      pool = p;
      return p;
    } catch (err) {
      console.error('❌ Database connection failed:', err.message);
      connectionPromise = undefined; // Reset for future retry attempts
      throw err;
    }
  })();

  return connectionPromise;
}

/**
 * Get the existing pool instance.
 * Throws an error if not yet initialized.
 */
function getPool() {
  if (!pool) {
    throw new Error(
      'Database pool not initialized. Call connectDB() first.'
    );
  }
  return pool;
}

/**
 * Health check - verifies database connectivity
 */
async function healthCheck() {
  try {
    const currentPool = getPool();
    const result = await currentPool.query('SELECT 1 AS health');
    return { healthy: true, timestamp: new Date() };
  } catch (err) {
    console.error('❌ Health check failed:', err.message);
    return { healthy: false, error: err.message, timestamp: new Date() };
  }
}

/**
 * Get current pool statistics (useful for monitoring)
 */
function getPoolStats() {
  if (!pool) {
    return null;
  }

  return {
    total: pool.totalCount,      // Total clients in pool
    idle: pool.idleCount,         // Idle clients available
    waiting: pool.waitingCount,   // Queries waiting for a client
  };
}

/**
 * Graceful shutdown - closes all connections
 */
async function closePool() {
  if (!pool) return;

  console.log('🧹 Closing PostgreSQL pool...');
  
  try {
    await pool.end();
    console.log('✅ Pool closed successfully');
  } catch (err) {
    console.error('❌ Error closing pool:', err.message);
  } finally {
    pool = undefined;
    connectionPromise = undefined;
  }
}

/**
 * Handle graceful shutdown signals
 */
async function handleShutdown(signal) {
  if (isShuttingDown) {
    console.log('⏳ Shutdown already in progress...');
    return;
  }

  isShuttingDown = true;
  console.log(`\n📡 Received ${signal}, shutting down gracefully...`);

  try {
    await closePool();
    console.log('👋 Shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during shutdown:', err.message);
    process.exit(1);
  }
}

// Register shutdown handlers
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => handleShutdown(signal));
});

// Handle uncaught exceptions
process.on('uncaughtException', async (err) => {
  console.error('❌ Uncaught Exception:', err);
  await closePool();
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  await closePool();
  process.exit(1);
});

module.exports = {
  connectDB,
  getPool,
  closePool,
  healthCheck,
  getPoolStats,
};