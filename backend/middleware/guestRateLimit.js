/**
 * Guest Rate Limiting Middleware
 *
 * Soft limit on guest scans per IP to prevent abuse.
 * Default: 5 scans per IP per 24 hours
 *
 * Uses in-memory tracking with optional database persistence.
 */

class GuestRateLimiter {
  constructor(options = {}) {
    this.maxScansPerDay = options.maxScansPerDay || 5;
    this.windowMs = options.windowMs || 24 * 60 * 60 * 1000; // 24 hours
    this.ipTracking = new Map();
    this.db = options.db || null;

    // Clean up expired entries every hour
    setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  /**
   * Get client IP from request
   * Handles proxies (X-Forwarded-For) and direct connections
   */
  getClientIP(req) {
    // Check for proxy headers first
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      // Take first IP in chain (original client)
      return forwarded.split(',')[0].trim();
    }

    // Check for other common proxy headers
    const realIP = req.headers['x-real-ip'];
    if (realIP) {
      return realIP;
    }

    // Fallback to direct connection
    return req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           req.ip ||
           'unknown';
  }

  /**
   * Check if IP is rate limited
   * @returns {Object} { allowed: boolean, remaining: number, resetAt: Date }
   */
  async checkLimit(req) {
    const ip = this.getClientIP(req);
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get or create tracking entry for this IP
    let tracking = this.ipTracking.get(ip);

    if (!tracking) {
      tracking = { scans: [], firstScan: now };
      this.ipTracking.set(ip, tracking);
    }

    // Filter out scans outside the window
    tracking.scans = tracking.scans.filter(timestamp => timestamp > windowStart);

    const scanCount = tracking.scans.length;
    const remaining = Math.max(0, this.maxScansPerDay - scanCount);
    const resetAt = tracking.scans.length > 0
      ? new Date(tracking.scans[0] + this.windowMs)
      : new Date(now + this.windowMs);

    return {
      allowed: scanCount < this.maxScansPerDay,
      remaining,
      used: scanCount,
      limit: this.maxScansPerDay,
      resetAt,
      ip
    };
  }

  /**
   * Record a scan for rate limiting
   */
  async recordScan(req) {
    const ip = this.getClientIP(req);
    const now = Date.now();

    let tracking = this.ipTracking.get(ip);
    if (!tracking) {
      tracking = { scans: [], firstScan: now };
      this.ipTracking.set(ip, tracking);
    }

    tracking.scans.push(now);

    // Optionally persist to database for cross-instance consistency
    if (this.db) {
      try {
        await this.db.query(`
          INSERT INTO guest_rate_limits (ip_address, scan_count, first_scan_at, last_scan_at)
          VALUES ($1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (ip_address)
          DO UPDATE SET
            scan_count = guest_rate_limits.scan_count + 1,
            last_scan_at = CURRENT_TIMESTAMP
        `, [ip]);
      } catch (error) {
        // Non-critical, continue without DB persistence
        if (error.code !== '42P01') { // table doesn't exist
          console.error('⚠️ Rate limit DB recording failed:', error.message);
        }
      }
    }
  }

  /**
   * Clean up expired tracking entries
   */
  cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [ip, tracking] of this.ipTracking) {
      // Remove scans outside window
      tracking.scans = tracking.scans.filter(t => t > windowStart);

      // Remove entry if no recent scans
      if (tracking.scans.length === 0) {
        this.ipTracking.delete(ip);
      }
    }
  }

  /**
   * Express middleware function
   */
  middleware() {
    return async (req, res, next) => {
      const limitStatus = await this.checkLimit(req);

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', limitStatus.limit);
      res.setHeader('X-RateLimit-Remaining', limitStatus.remaining);
      res.setHeader('X-RateLimit-Reset', limitStatus.resetAt.toISOString());

      if (!limitStatus.allowed) {
        console.log(`🚫 Guest rate limit exceeded for IP: ${limitStatus.ip}`);

        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: `You've reached the limit of ${this.maxScansPerDay} scans per day. Please try again later or sign up for a free account.`,
          limit: limitStatus.limit,
          used: limitStatus.used,
          resetAt: limitStatus.resetAt.toISOString(),
          upgrade: {
            message: 'Create a free account for more scans',
            url: '/signup.html'
          }
        });
      }

      // Attach limiter to request for recording after successful scan
      req.rateLimiter = this;

      next();
    };
  }

  /**
   * Get stats for monitoring
   */
  getStats() {
    return {
      trackedIPs: this.ipTracking.size,
      maxScansPerDay: this.maxScansPerDay,
      windowHours: this.windowMs / (60 * 60 * 1000)
    };
  }
}

// Create singleton instance
let instance = null;

function createGuestRateLimiter(options = {}) {
  if (!instance) {
    instance = new GuestRateLimiter(options);
  }
  return instance;
}

function getGuestRateLimiter() {
  return instance;
}

module.exports = {
  GuestRateLimiter,
  createGuestRateLimiter,
  getGuestRateLimiter
};
