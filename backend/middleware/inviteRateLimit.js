/**
 * Lightweight In-Memory Rate Limiter for Invite Endpoints
 *
 * Phase 3B.1C - No external dependencies
 *
 * Note: This is best-effort for single-instance deployments.
 * For multi-instance, use Redis-based rate limiting.
 */

// In-memory stores (cleared on server restart)
const inviteCreateStore = new Map(); // key: orgId, value: { count, resetTime }
const inviteAcceptStore = new Map(); // key: IP, value: { count, resetTime }

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of inviteCreateStore) {
    if (value.resetTime < now) inviteCreateStore.delete(key);
  }
  for (const [key, value] of inviteAcceptStore) {
    if (value.resetTime < now) inviteAcceptStore.delete(key);
  }
}, 10 * 60 * 1000);

/**
 * Rate limit invite creation: 10 per hour per org
 */
function rateLimitInviteCreate(req, res, next) {
  const orgId = req.orgId;
  if (!orgId) return next(); // Skip if no org context

  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const maxRequests = 10;

  const key = `org_${orgId}`;
  let record = inviteCreateStore.get(key);

  if (!record || record.resetTime < now) {
    record = { count: 0, resetTime: now + windowMs };
  }

  record.count++;
  inviteCreateStore.set(key, record);

  if (record.count > maxRequests) {
    console.log(`⚠️ Rate limit exceeded: invite create for org ${orgId}`);
    return res.status(429).json({
      error: 'Too many invite requests',
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'You can send up to 10 invites per hour. Please try again later.',
      retryAfter: Math.ceil((record.resetTime - now) / 1000)
    });
  }

  next();
}

/**
 * Rate limit invite acceptance: 30 per hour per IP
 */
function rateLimitInviteAccept(req, res, next) {
  // Get client IP (trust proxy for Render)
  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const maxRequests = 30;

  const key = `ip_${ip}`;
  let record = inviteAcceptStore.get(key);

  if (!record || record.resetTime < now) {
    record = { count: 0, resetTime: now + windowMs };
  }

  record.count++;
  inviteAcceptStore.set(key, record);

  if (record.count > maxRequests) {
    console.log(`⚠️ Rate limit exceeded: invite accept from IP ${ip}`);
    return res.status(429).json({
      error: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many invite acceptance attempts. Please try again later.',
      retryAfter: Math.ceil((record.resetTime - now) / 1000)
    });
  }

  next();
}

module.exports = {
  rateLimitInviteCreate,
  rateLimitInviteAccept
};
