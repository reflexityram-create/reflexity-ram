const express = require('express');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { optionalAuth } = require('../middleware/auth');
const { INTERNATIONAL_COUNTRIES } = require('../config/shipping');
const { isConfigured } = require('../utils/canadaPost');
const { internationalOptions } = require('../utils/internationalShipping');
const { validGuestSessionId } = require('../utils/guestSession');

const router = express.Router();

// Sticks in the buyer's cart that website checkout would charge for.
const cartStickCount = async (req) => {
  const userId = req.user?._id;
  const sessionId = validGuestSessionId(req.headers['x-session-id'] || req.cookies?.cartSessionId);   // a `j:{...}` cookie parses to an object: never a raw query value
  if (!userId && !sessionId) return 0;
  const cart = await Cart.findOne(userId ? { user: userId } : { sessionId });
  if (!cart?.items?.length) return 0;
  const slugs = [...new Set(cart.items.map((item) => item.slug).filter(Boolean))];
  const products = await Product.find({ slug: { $in: slugs }, isActive: true, line: 'Server' }).select('slug');
  const sellable = new Set(products.map((p) => p.slug));
  return cart.items.filter((item) => sellable.has(item.slug)).reduce((n, item) => n + (Number(item.qty) || 0), 0);
};

// ─── GET /api/shipping/countries — where website checkout ships outside Canada
router.get('/countries', (_req, res) => {
  res.json({ countries: isConfigured() ? INTERNATIONAL_COUNTRIES : [] });
});

// ─── POST /api/shipping/international-quote { country } ───────────────────────
router.post('/international-quote', optionalAuth, async (req, res) => {
  const country = String(req.body?.country || '').toUpperCase();
  if (!isConfigured() || !INTERNATIONAL_COUNTRIES.includes(country)) {
    return res.status(400).json({ error: 'Website checkout does not ship there. Email us for a quote.' });
  }
  try {
    const sticks = await cartStickCount(req);
    if (!sticks) return res.status(400).json({ error: 'Your cart is empty' });
    const options = await internationalOptions({ country, sticks });
    if (!options.length) {
      return res.status(422).json({ error: 'Canada Post has no tracked service to that country right now. Email us for a quote.' });
    }
    res.json({ country, sticks, options });
  } catch (err) {
    console.error('International quote error:', err.message);
    res.status(502).json({ error: 'Could not get Canada Post prices right now. Please try again.' });
  }
});

module.exports = router;
module.exports.cartStickCount = cartStickCount;
