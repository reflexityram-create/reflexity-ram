const express = require('express');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { optionalAuth } = require('../middleware/auth');
const { INTERNATIONAL_COUNTRIES } = require('../config/shipping');
const { isConfigured } = require('../utils/canadaPost');
const { internationalOptions } = require('../utils/internationalShipping');
const { quoteUnitedStates, usCheckoutAvailable, UsCheckoutError } = require('../utils/usCheckout');
const { validGuestSessionId } = require('../utils/guestSession');
const { resolveCartLines } = require('../utils/cartLines');

const router = express.Router();

// What the buyer's cart would charge for, as [{ product, qty }] (website checkout sells Server RAM only).
const cartLines = async (req) => {
  const userId = req.user?._id;
  const sessionId = validGuestSessionId(req.headers['x-session-id'] || req.cookies?.cartSessionId);   // a `j:{...}` cookie parses to an object: never a raw query value
  if (!userId && !sessionId) return [];
  const cart = await Cart.findOne(userId ? { user: userId } : { sessionId });
  if (!cart?.items?.length) return [];
  return (await resolveCartLines(cart.items)).map(({ item, product }) => ({ product, qty: Number(item.qty) || 0 }));
};

// Sticks in the buyer's cart that website checkout would charge for.
const cartStickCount = async (req) => (await cartLines(req)).reduce((n, line) => n + line.qty, 0);

// ─── GET /api/shipping/countries — where website checkout ships outside Canada
// The United States is listed only once a sellable product has its country of origin and HS code saved (the checkout
// declares them to customs, so it never guesses): until then US buyers are told to email, as before.
router.get('/countries', async (_req, res) => {
  const countries = isConfigured() ? [...INTERNATIONAL_COUNTRIES] : [];
  if (countries.length) {
    try {
      if (await usCheckoutAvailable()) countries.push('US');
    } catch (err) {
      console.error('US availability check failed:', err.message);
    }
  }
  res.json({ countries });
});

// ─── POST /api/shipping/international-quote { country } ───────────────────────
router.post('/international-quote', optionalAuth, async (req, res) => {
  const country = String(req.body?.country || '').toUpperCase();
  if (country === 'US') {
    // Shipping and prepaid duties together; see utils/usCheckout.js.
    try {
      const lines = await cartLines(req);
      if (!lines.length) return res.status(400).json({ error: 'Your cart is empty' });
      const quote = await quoteUnitedStates({ lines });
      return res.json({
        country: 'US',
        sticks: quote.sticks,
        options: [quote.service],
        duties: { amount: quote.duties.total, duties: quote.duties.duties, fees: quote.duties.fees, taxes: quote.duties.taxes },
      });
    } catch (err) {
      if (err instanceof UsCheckoutError) return res.status(err.status).json({ error: err.publicMessage });
      console.error('US quote error:', err.message);
      return res.status(502).json({ error: 'Could not get a United States quote right now. Please try again.' });
    }
  }
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
module.exports.cartLines = cartLines;
