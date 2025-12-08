/**
 * Guest Scan Cache Service
 *
 * Caches scan results to prevent redundant analysis for:
 * 1. Same guest rescanning same URL within 24 hours
 * 2. Different guests scanning same URL (shared cache)
 *
 * Cache key: normalized domain (homepage scans only for guests)
 * TTL: 24 hours (configurable)
 */

const crypto = require('crypto');

class GuestScanCacheService {
  constructor(db) {
    this.db = db;
    this.memoryCache = new Map();
    this.CACHE_TTL_HOURS = 24;
    this.MAX_MEMORY_CACHE_SIZE = 1000; // Prevent memory bloat
  }

  /**
   * Normalize URL to cache key
   * For guests, we cache by domain since they only scan homepage
   */
  generateCacheKey(url) {
    try {
      const urlObj = new URL(url);
      // Normalize: lowercase, remove www, remove trailing slash
      let domain = urlObj.hostname.toLowerCase();
      domain = domain.replace(/^www\./, '');
      return domain;
    } catch {
      // Fallback to hash if URL parsing fails
      return crypto.createHash('md5').update(url.toLowerCase()).digest('hex');
    }
  }

  /**
   * Check if cached result exists and is still valid
   * @param {string} url - URL to check
   * @returns {Object|null} Cached result or null
   */
  async getCachedResult(url) {
    const cacheKey = this.generateCacheKey(url);
    const now = Date.now();

    // Check memory cache first (fastest)
    const memCached = this.memoryCache.get(cacheKey);
    if (memCached && memCached.expiresAt > now) {
      console.log(`📦 Guest cache HIT (memory): ${cacheKey}`);
      return memCached.data;
    }

    // Check database cache (persistent across restarts)
    try {
      const result = await this.db.query(`
        SELECT scan_data, expires_at
        FROM guest_scan_cache
        WHERE cache_key = $1
          AND expires_at > CURRENT_TIMESTAMP
        LIMIT 1
      `, [cacheKey]);

      if (result.rows.length > 0) {
        const cached = result.rows[0];
        const scanData = typeof cached.scan_data === 'string'
          ? JSON.parse(cached.scan_data)
          : cached.scan_data;

        // Populate memory cache for faster subsequent access
        this.setMemoryCache(cacheKey, scanData, new Date(cached.expires_at).getTime());

        console.log(`📦 Guest cache HIT (database): ${cacheKey}`);
        return scanData;
      }
    } catch (dbError) {
      // If table doesn't exist or query fails, continue without cache
      if (dbError.code !== '42P01') { // 42P01 = table doesn't exist
        console.error('⚠️ Guest cache DB lookup failed:', dbError.message);
      }
    }

    console.log(`📭 Guest cache MISS: ${cacheKey}`);
    return null;
  }

  /**
   * Store scan result in cache
   * @param {string} url - Scanned URL
   * @param {Object} scanResult - Scan result to cache
   */
  async setCachedResult(url, scanResult) {
    const cacheKey = this.generateCacheKey(url);
    const expiresAt = Date.now() + (this.CACHE_TTL_HOURS * 60 * 60 * 1000);

    // Store in memory cache
    this.setMemoryCache(cacheKey, scanResult, expiresAt);

    // Store in database for persistence
    try {
      await this.db.query(`
        INSERT INTO guest_scan_cache (cache_key, url, scan_data, expires_at)
        VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))
        ON CONFLICT (cache_key)
        DO UPDATE SET
          scan_data = EXCLUDED.scan_data,
          expires_at = EXCLUDED.expires_at,
          updated_at = CURRENT_TIMESTAMP
      `, [cacheKey, url, JSON.stringify(scanResult), expiresAt]);

      console.log(`💾 Guest cache SET: ${cacheKey} (expires in ${this.CACHE_TTL_HOURS}h)`);
    } catch (dbError) {
      // If table doesn't exist, try to create it
      if (dbError.code === '42P01') {
        await this.ensureTableExists();
        // Retry the insert
        try {
          await this.db.query(`
            INSERT INTO guest_scan_cache (cache_key, url, scan_data, expires_at)
            VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))
          `, [cacheKey, url, JSON.stringify(scanResult), expiresAt]);
        } catch (retryError) {
          console.error('⚠️ Guest cache DB write failed after table creation:', retryError.message);
        }
      } else {
        console.error('⚠️ Guest cache DB write failed:', dbError.message);
      }
    }
  }

  /**
   * Helper to set memory cache with LRU eviction
   */
  setMemoryCache(key, data, expiresAt) {
    // Simple LRU: if at capacity, delete oldest entries
    if (this.memoryCache.size >= this.MAX_MEMORY_CACHE_SIZE) {
      const oldestKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(oldestKey);
    }

    this.memoryCache.set(key, { data, expiresAt });
  }

  /**
   * Ensure the cache table exists
   */
  async ensureTableExists() {
    try {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS guest_scan_cache (
          id SERIAL PRIMARY KEY,
          cache_key VARCHAR(255) UNIQUE NOT NULL,
          url TEXT NOT NULL,
          scan_data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP NOT NULL
        )
      `);

      // Create index for faster lookups
      await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_guest_scan_cache_key
        ON guest_scan_cache(cache_key)
      `);

      await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_guest_scan_cache_expires
        ON guest_scan_cache(expires_at)
      `);

      console.log('✅ guest_scan_cache table created');
    } catch (error) {
      console.error('⚠️ Failed to create guest_scan_cache table:', error.message);
    }
  }

  /**
   * Clean up expired cache entries (call periodically)
   */
  async cleanupExpired() {
    // Clean memory cache
    const now = Date.now();
    for (const [key, value] of this.memoryCache) {
      if (value.expiresAt <= now) {
        this.memoryCache.delete(key);
      }
    }

    // Clean database cache
    try {
      const result = await this.db.query(`
        DELETE FROM guest_scan_cache
        WHERE expires_at < CURRENT_TIMESTAMP
        RETURNING cache_key
      `);

      if (result.rows.length > 0) {
        console.log(`🧹 Cleaned ${result.rows.length} expired guest cache entries`);
      }
    } catch (error) {
      // Ignore if table doesn't exist
      if (error.code !== '42P01') {
        console.error('⚠️ Guest cache cleanup failed:', error.message);
      }
    }
  }

  /**
   * Get cache stats for monitoring
   */
  getStats() {
    return {
      memoryCacheSize: this.memoryCache.size,
      maxMemoryCacheSize: this.MAX_MEMORY_CACHE_SIZE,
      ttlHours: this.CACHE_TTL_HOURS
    };
  }
}

module.exports = GuestScanCacheService;
