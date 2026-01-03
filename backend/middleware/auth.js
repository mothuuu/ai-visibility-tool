const jwt = require('jsonwebtoken');
const db = require('../db/database');

/**
 * Test-only authentication bypass.
 * ONLY active when NODE_ENV==='test' AND header 'x-test-user-id' is set.
 * This does NOT weaken production authentication.
 */
function handleTestAuth(req) {
  if (process.env.NODE_ENV === 'test' && req.headers['x-test-user-id']) {
    // Parse user ID as integer since users.id is SERIAL (integer)
    const userId = parseInt(req.headers['x-test-user-id'], 10);
    return {
      id: isNaN(userId) ? req.headers['x-test-user-id'] : userId,
      email: req.headers['x-test-user-email'] || 'test@example.com',
      name: req.headers['x-test-user-name'] || 'Test User',
      role: req.headers['x-test-user-role'] || 'user',
      plan: req.headers['x-test-user-plan'] || 'pro'
    };
  }
  return null;
}

async function authenticateToken(req, res, next) {
  // Test auth bypass (only in test environment)
  const testUser = handleTestAuth(req);
  if (testUser) {
    req.user = testUser;
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('No token provided in request');
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get fresh user data with graceful fallback for missing columns
    let result;
    try {
      // Try full query with all optional columns
      result = await db.query(
        `SELECT id, email, name, role, plan, email_verified, scans_used_this_month,
                competitor_scans_used_this_month, recs_generated_this_month, quota_reset_date,
                primary_domain, primary_domain_changed_at,
                stripe_customer_id, industry, industry_custom, created_at, last_login
         FROM users WHERE id = $1`,
        [decoded.userId]
      );
    } catch (dbError) {
      // If any column doesn't exist, fall back to minimal safe query
      if (dbError.code === '42703') { // column does not exist
        console.log('Some columns not found, using minimal query. Missing:', dbError.message);
        result = await db.query(
          `SELECT id, email, name, plan, email_verified, scans_used_this_month,
                  competitor_scans_used_this_month, primary_domain, primary_domain_changed_at,
                  stripe_customer_id, industry, industry_custom, created_at, last_login
           FROM users WHERE id = $1`,
          [decoded.userId]
        );
        // Add default values for missing columns
        if (result.rows.length > 0) {
          result.rows[0].role = result.rows[0].role || 'user';
          result.rows[0].recs_generated_this_month = result.rows[0].recs_generated_this_month || 0;
          result.rows[0].quota_reset_date = result.rows[0].quota_reset_date || null;
        }
      } else {
        throw dbError;
      }
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// Optional auth - allows anonymous users
async function authenticateTokenOptional(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    let result;
    try {
      result = await db.query(
        'SELECT id, email, role, plan, scans_used_this_month FROM users WHERE id = $1',
        [decoded.userId]
      );
    } catch (dbError) {
      // If role column doesn't exist, query without it
      if (dbError.code === '42703') {
        result = await db.query(
          'SELECT id, email, plan, scans_used_this_month FROM users WHERE id = $1',
          [decoded.userId]
        );
        if (result.rows.length > 0) {
          result.rows[0].role = 'user';
        }
      } else {
        throw dbError;
      }
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authenticateToken, authenticateTokenOptional };