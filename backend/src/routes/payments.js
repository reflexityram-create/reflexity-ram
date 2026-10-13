const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { optionalAuth } = require('../middleware/auth');
const { publicPaymentMethods } = require('../utils/paymentMethods');
const {
  EtransferError, CA_PROVINCES, POSTAL_CODE, normalizePostalCode, placeEtransferOrder,
} = require('../utils/etransfer');
const { assertPermanentEmail } = require('../utils/disposableEmail');
const { validGuestSessionId } = require('../utils/guestSession');

// ─── Ways to pay besides Stripe's card page ────────────────────────────────────
//   GET  /api/payments/methods           which methods are on and what each one saves (no addresses, nothing private)
//   POST /api/payments/etransfer/orders  place an Interac e-Transfer order (unpaid, stock held; utils/etransfer.js)
// Bank debit is a Stripe Checkout session and lives in routes/stripe.js.

const orderRules = [
  body('buyer.firstName').isString().trim().isLength({ min: 1, max: 50 }).withMessage('First name required'),
  body('buyer.lastName').isString().trim().isLength({ min: 1, max: 50 }).withMessage('Last name required'),
  body('buyer.phone').isString().trim().matches(/^[0-9+()\-.\s]{7,25}$/).withMessage('Enter a phone number'),
  body('address.line1').isString().trim().isLength({ min: 3, max: 120 }).withMessage('Street address required'),
  body('address.line2').optional({ values: 'falsy' }).isString().trim().isLength({ max: 120 }),
  body('address.city').isString().trim().isLength({ min: 2, max: 80 }).withMessage('City required'),
  body('address.state').isString().trim().toUpperCase().isIn(CA_PROVINCES).withMessage('Choose a province'),
  body('address.zip').isString().trim().matches(POSTAL_CODE).withMessage('Enter a Canadian postal code').customSanitizer(normalizePostalCode),
  body('acceptTerms').custom((value) => value === true).withMessage('Please accept the payment terms'),
];

function createPaymentsRouter({ place = placeEtransferOrder, methods = publicPaymentMethods, assertEmail = assertPermanentEmail } = {}) {
  const router = express.Router();

  router.get('/methods', (req, res) => {
    // A minute of caching is plenty: the settings only change when the shop's host settings do.
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ methods: methods() });
  });

  router.post('/etransfer/orders', optionalAuth, orderRules, validate, async (req, res) => {
    try {
      const buyer = { ...req.body.buyer };
      if (!req.user) {
        const email = typeof buyer.email === 'string' ? buyer.email.trim() : '';
        if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          return res.status(400).json({ error: 'Enter a valid email address' });
        }
        assertEmail(email);
        buyer.email = email.toLowerCase();
      }
      const order = await place({
        user: req.user,
        sessionId: validGuestSessionId(req.headers['x-session-id'] || req.cookies?.cartSessionId),
        buyer,
        address: req.body.address,
        shipping: req.body.shipping && typeof req.body.shipping === 'object' ? req.body.shipping : {},
        analytics: req.body.analytics,
      });
      return res.status(201).json({
        orderNumber: order.orderNumber,
        email: req.user ? undefined : buyer.email,
        total: order.total,
        discount: order.discount,
        etransfer: {
          recipientEmail: order.etransfer.recipientEmail,
          amountDue: order.etransfer.amountDue,
          expiresAt: order.etransfer.expiresAt,
        },
      });
    } catch (err) {
      if (err instanceof EtransferError) return res.status(err.status).json({ error: err.publicMessage, ...(err.code ? { code: err.code } : {}) });
      if (err?.code === 'DISPOSABLE_EMAIL_BLOCKED') return res.status(err.statusCode || 400).json({ error: err.message, code: err.code });
      console.error('e-Transfer order error:', err);
      return res.status(500).json({ error: 'We could not place your order. Nothing was charged. Please try again.' });
    }
  });

  return router;
}

module.exports = { createPaymentsRouter };
