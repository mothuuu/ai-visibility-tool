const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { getPlanLimits } = require('../middleware/usageLimits');

// Check user quota by email
router.get('/check-quota-by-email/:email', async (req, res) => {
  try {
    const { email } = req.params;

    const user = await db.query(
      'SELECT id, email, plan, scans_used_this_month FROM users WHERE email = $1',
      [email]
    );

    if (user.rows.length === 0) {
      return res.json({ error: 'User not found' });
    }

    const userData = user.rows[0];

    // Use centralized plan limits (single source of truth)
    const limits = getPlanLimits(userData.plan);

    if (!limits) {
      return res.status(400).json({
        error: 'INVALID_PLAN',
        message: `Invalid plan: "${userData.plan}"`,
        userId: userData.id,
        email: userData.email
      });
    }

    const scanLimit = limits.scansPerMonth;

    res.json({
      userId: userData.id,
      email: userData.email,
      plan: userData.plan,
      scansUsed: userData.scans_used_this_month,
      scanLimit: scanLimit,
      remaining: scanLimit - userData.scans_used_this_month,
      quotaExceeded: userData.scans_used_this_month >= scanLimit
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


module.exports = router;