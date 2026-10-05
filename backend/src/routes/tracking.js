const crypto = require('crypto');
const express = require('express');
const { isConfigured } = require('../utils/canadaPost');
const { syncShippedOrders } = require('../utils/trackingSync');

const router = express.Router();

// Compares hashes so the check takes the same time whatever the input.
const tokenMatches = (given) => {
  const expected = process.env.TRACKING_SYNC_TOKEN || '';
  if (!expected || !given) return false;
  const digest = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(given), digest(expected));
};

// ─── POST /api/tracking/sync ───────────────────────────────────────────────────
// Called every few hours by .github/workflows/tracking-sync.yml with
// "Authorization: Bearer <TRACKING_SYNC_TOKEN>".
router.post('/sync', async (req, res) => {
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tokenMatches(given)) return res.status(401).json({ error: 'Unauthorized' });
  if (!isConfigured()) return res.status(503).json({ error: 'Canada Post tracking is not configured' });
  try {
    res.json(await syncShippedOrders());
  } catch (err) {
    console.error('Tracking sync error:', err);
    res.status(500).json({ error: 'Tracking sync failed' });
  }
});

module.exports = router;
