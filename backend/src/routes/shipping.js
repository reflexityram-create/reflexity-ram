const express = require('express');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { optionalAuth } = require('../middleware/auth');
const { INTERNATIONAL_COUNTRIES, CANADA_POSTAL_CODE, normalizePostalCode } = require('../config/shipping');
const { isConfigured } = require('../utils/canadaPost');
const { internationalOptions } = require('../utils/internationalShipping');
const { canadaOptions } = require('../utils/canadaShipping');

const router = express.Router();

// Sticks in the buyer's cart that website checkout would charge for.
const cartStickCount = async (req) => {
  const userId = req.user?._id;
  const sessionId = req.headers['x-session-id'] || req.cookies?.cartSessionId;
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

// ─── POST /api/shipping/canada-quote { postalCode } ───────────────────────────
// Faster services inside Canada, priced by Canada Post for this postal code and the
// sticks in the buyer's cart. Standard delivery (the flat rate) never depends on this.
router.post('/canada-quote', optionalAuth, async (req, res) => {
  const postalCode = normalizePostalCode(req.body?.postalCode);
  if (!CANADA_POSTAL_CODE.test(postalCode)) {
    return res.status(400).json({ error: 'Enter a Canadian postal code, like M5V 2T6.' });
  }
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Faster delivery is not available right now. Standard delivery still works.' });
  }
  try {
    const sticks = await cartStickCount(req);
    if (!sticks) return res.status(400).json({ error: 'Your cart is empty' });
    const { options, signaturePrice } = await canadaOptions({ postalCode, sticks });
    res.json({ postalCode, sticks, options, signaturePrice });
  } catch (err) {
    console.error('Canada quote error:', err.message);
    res.status(502).json({ error: 'Could not get Canada Post prices right now. Standard delivery still works.' });
  }
});

module.exports = router;
module.exports.cartStickCount = cartStickCount;
