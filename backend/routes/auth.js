const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db/database');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');
const { authenticateToken } = require('../middleware/auth');
const { loadOrgContext } = require('../middleware/orgContext');
const { buildAuthQuotaResponse } = require('../services/entitlements-v2-service');
const router = express.Router();

// POST /api/auth/signup - Create account
router.post('/signup', async (req, res) => {
  try {
    const {
      email, password, name, industry, industryCustom,
      // UTM and tracking parameters
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      referrer, landing_page, affiliate_id
    } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Strong password validation
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecialChar = /[^A-Za-z0-9]/.test(password);

    if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecialChar) {
      return res.status(400).json({
        error: 'Password must include uppercase, lowercase, number, and special character'
      });
    }

    // Check if user exists
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Create user with tracking data
    const result = await db.query(
      `INSERT INTO users (
        email, password_hash, name, plan, verification_token, email_verified,
        industry, industry_custom,
        signup_source, signup_medium, signup_campaign, signup_content, signup_term,
        referrer_url, landing_page, affiliate_id
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id, email, name, plan, email_verified, industry, industry_custom,
                 signup_source, signup_medium, affiliate_id`,
      [
        email, passwordHash, name || 'User', 'free', verificationToken, false,
        industry || null, industryCustom || null,
        utm_source || null, utm_medium || null, utm_campaign || null,
        utm_content || null, utm_term || null,
        referrer || null, landing_page || null, affiliate_id || null
      ]
    );

    const user = result.rows[0];

    const trackingInfo = [
      user.signup_source && `Source: ${user.signup_source}`,
      user.signup_medium && `Medium: ${user.signup_medium}`,
      user.affiliate_id && `Affiliate: ${user.affiliate_id}`
    ].filter(Boolean).join(', ');

    console.log(`✅ New user signup: ${email}${industry ? ` (Industry: ${industry})` : ''}${trackingInfo ? ` | ${trackingInfo}` : ''}`);

    // Generate JWT
    const accessToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    // Send verification email
    await sendVerificationEmail(email, verificationToken);

    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        email_verified: user.email_verified,
        industry: user.industry,
        industry_custom: user.industry_custom
      },
      accessToken
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// POST /api/auth/login - Sign in
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    // Get user with organization data
    const result = await db.query(
      `SELECT
        u.id, u.email, u.password_hash, u.name, u.plan, u.email_verified,
        u.scans_used_this_month, u.competitor_scans_used_this_month,
        u.primary_domain, u.primary_domain_changed_at,
        u.industry, u.industry_custom, u.organization_id,
        o.id as org_id, o.name as org_name, o.slug as org_slug,
        o.org_type, o.plan as org_plan, o.settings as org_settings
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    
    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login
    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    
    // Generate JWT
    const accessToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    // Build response object
    const response = {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,  // Keep as user.plan (NOT org_plan) - no behavior change
        email_verified: user.email_verified,
        scans_used_this_month: user.scans_used_this_month || 0,
        competitor_scans_used_this_month: user.competitor_scans_used_this_month || 0,
        primary_domain: user.primary_domain,
        primary_domain_changed_at: user.primary_domain_changed_at,
        industry: user.industry,
        industry_custom: user.industry_custom,
        organization_id: user.organization_id  // Always include (safe addition)
      },
      accessToken
    };

    // Add organization object ONLY when feature flag enabled
    if (process.env.ORG_CONTEXT_ENABLED === 'true' && user.org_id) {
      response.organization = {
        id: user.org_id,
        name: user.org_name,
        slug: user.org_slug,
        type: user.org_type,
        plan: user.org_plan,
        settings: user.org_settings || {}
      };
    }

    // Phase 2D: ALWAYS add quota (v2 or legacy based on flags)
    const quotaResult = await buildAuthQuotaResponse(user, user.org_id);
    response.quota = quotaResult.quota;
    if (quotaResult.quotaLegacy) {
      response.quotaLegacy = quotaResult.quotaLegacy;
    }

    res.json(response);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout - Sign out
router.post('/logout', authenticateToken, async (req, res) => {
  // In a JWT-based system, logout is handled client-side by removing the token
  // But we can still provide an endpoint for consistency
  res.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/auth/me - Get current user
router.get('/me', authenticateToken, loadOrgContext, async (req, res) => {
  try {
    // Query includes org data directly for backwards compatibility
    // (does not rely on req.org from middleware)
    const result = await db.query(`
      SELECT
        u.id, u.email, u.name, u.plan, u.email_verified,
        u.scans_used_this_month, u.competitor_scans_used_this_month,
        u.primary_domain, u.primary_domain_changed_at,
        u.industry, u.industry_custom, u.organization_id,
        o.id as org_id, o.name as org_name, o.slug as org_slug,
        o.org_type, o.plan as org_plan, o.settings as org_settings
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE u.id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const row = result.rows[0];

    const response = {
      success: true,
      user: {
        id: row.id,
        email: row.email,
        name: row.name,
        plan: row.plan,
        email_verified: row.email_verified,
        scans_used_this_month: row.scans_used_this_month || 0,
        competitor_scans_used_this_month: row.competitor_scans_used_this_month || 0,
        primary_domain: row.primary_domain,
        primary_domain_changed_at: row.primary_domain_changed_at,
        industry: row.industry,
        industry_custom: row.industry_custom,
        organization_id: row.organization_id
      }
    };

    // Add organization ONLY when feature flag enabled
    if (process.env.ORG_CONTEXT_ENABLED === 'true' && row.org_id) {
      response.organization = {
        id: row.org_id,
        name: row.org_name,
        slug: row.org_slug,
        type: row.org_type,
        plan: row.org_plan,
        settings: row.org_settings || {}
      };
    }

    // Phase 2D: ALWAYS add quota (v2 or legacy based on flags)
    const quotaResult = await buildAuthQuotaResponse(row, row.org_id);
    response.quota = quotaResult.quota;
    if (quotaResult.quotaLegacy) {
      response.quotaLegacy = quotaResult.quotaLegacy;
    }

    res.json(response);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// GET /api/auth/verify - Check if user is authenticated
router.get('/verify', authenticateToken, async (req, res) => {
  res.json({
    authenticated: true,
    userId: req.user.id,
    email: req.user.email,
    plan: req.user.plan
  });
});

// POST /api/auth/verify-email - Verify email with token
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Verification token required' });
    }
    
    // Find user with this token
    const result = await db.query(
      'SELECT id, email FROM users WHERE verification_token = $1',
      [token]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }
    
    const user = result.rows[0];
    
    // Update user as verified
    await db.query(
      'UPDATE users SET email_verified = true, verification_token = NULL WHERE id = $1',
      [user.id]
    );
    
    res.json({
      success: true,
      message: 'Email verified successfully'
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Email verification failed' });
  }
});

// POST /api/auth/resend-verification - Resend verification email
router.post('/resend-verification', authenticateToken, async (req, res) => {
  try {
    // authenticateToken middleware already provides req.user
    const user = req.user;
    
    if (user.email_verified) {
      return res.status(400).json({ error: 'Email already verified' });
    }
    
    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    // Update user
    await db.query(
      'UPDATE users SET verification_token = $1 WHERE id = $2',
      [verificationToken, user.id]
    );
    
    // Send verification email
    await sendVerificationEmail(user.email, verificationToken);
    
    res.json({
      success: true,
      message: 'Verification email sent'
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

// POST /api/auth/forgot-password - Request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }
    
    // Find user
    const result = await db.query('SELECT id, email FROM users WHERE email = $1', [email]);
    
    // Always return success to prevent email enumeration
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        message: 'If an account exists with that email, a password reset link has been sent'
      });
    }
    
    const user = result.rows[0];
    
    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 3600000); // 1 hour
    
    // Save token
    await db.query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [resetToken, resetTokenExpires, user.id]
    );
    
    // Send password reset email
    await sendPasswordResetEmail(user.email, resetToken);
    
    res.json({
      success: true,
      message: 'If an account exists with that email, a password reset link has been sent'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// POST /api/auth/reset-password - Reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password required' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    // Find user with valid token
    const result = await db.query(
      'SELECT id, email FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()',
      [token]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }
    
    const user = result.rows[0];
    
    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Update password and clear reset token
    await db.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [passwordHash, user.id]
    );
    
    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// POST /api/auth/change-primary-domain - Change primary domain (once per month)
router.post('/change-primary-domain', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { newDomain } = req.body;

    if (!newDomain) {
      return res.status(400).json({ error: 'New domain is required' });
    }

    // Validate domain format
    let domain = newDomain.trim();
    if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
      domain = 'https://' + domain;
    }

    try {
      const url = new URL(domain);
      domain = url.hostname.replace(/^www\./, '');
    } catch (err) {
      return res.status(400).json({ error: 'Invalid domain format' });
    }

    // Check if user has already changed primary domain this month
    const user = req.user;

    if (user.primary_domain_changed_at) {
      const lastChanged = new Date(user.primary_domain_changed_at);
      const now = new Date();
      const daysSinceChange = Math.floor((now - lastChanged) / (1000 * 60 * 60 * 24));

      if (daysSinceChange < 30) {
        const daysRemaining = 30 - daysSinceChange;
        return res.status(403).json({
          error: `You can only change your primary domain once per month. Please wait ${daysRemaining} more day${daysRemaining === 1 ? '' : 's'}.`,
          daysRemaining: daysRemaining
        });
      }
    }

    // Update primary domain
    await db.query(
      `UPDATE users
       SET primary_domain = $1,
           primary_domain_changed_at = CURRENT_TIMESTAMP,
           scans_used_this_month = 0,
           competitor_scans_used_this_month = 0
       WHERE id = $2`,
      [domain, userId]
    );

    console.log(`✅ Primary domain changed for user ${userId}: ${user.primary_domain} → ${domain}`);

    res.json({
      success: true,
      message: 'Primary domain updated successfully',
      newDomain: domain
    });

  } catch (error) {
    console.error('Change primary domain error:', error);
    res.status(500).json({ error: 'Failed to change primary domain' });
  }
});

module.exports = router;