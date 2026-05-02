const express = require('express');
const router = express.Router();

// Temporary route for testing
router.get('/', (req, res) => {
  res.json({ message: 'Subscription route placeholder working' });
});

module.exports = router;
