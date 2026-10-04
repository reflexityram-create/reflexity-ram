const express = require('express');
const { body, param } = require('express-validator');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Review = require('../models/Review');
const ReviewEmailOptOut = require('../models/ReviewEmailOptOut');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { verifyReviewToken } = require('../utils/reviewLinks');
const {
  isReviewableOrder,
  orderEmail,
  orderFirstName,
  cancelPendingReviewRequestsFor,
} = require('../utils/reviewRequests');

const router = express.Router();

const INVALID_LINK = 'This review link is invalid or has expired.';
const reviewRules = [
  body('rating').isInt({ min: 1, max: 5 }).toInt(),
  body('title').optional().trim().isLength({ max: 120 }),
  body('body').trim().isLength({ min: 10, max: 2000 }),
];
const tokenRule = body('token').isString().isLength({ min: 20, max: 200 });

async function orderForToken(token) {
  const verified = verifyReviewToken(token);
  if (!verified) return null;
  return Order.findById(verified.orderId).populate('user', 'firstName email').lean();
}

// One entry per product in the order, with the review already left for it.
async function orderReviewItems(order) {
  const items = order.items || [];
  const ids = items.map((item) => item.product).filter(Boolean);
  const slugs = items.map((item) => item.slug).filter(Boolean);
  const products = await Product.find({ $or: [{ _id: { $in: ids } }, { slug: { $in: slugs } }] })
    .select('_id slug name images isActive')
    .lean();
  const productFor = (item) => (
    (item.product && products.find((product) => String(product._id) === String(item.product)))
    || products.find((product) => product.slug === item.slug)
  );
  const reviews = await Review.find({ order: order._id, product: { $in: products.map((product) => product._id) } })
    .select('product rating title body createdAt')
    .lean();

  const seen = new Set();
  const entries = [];
  for (const item of items) {
    const product = productFor(item);
    const key = product ? String(product._id) : `slug:${item.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const review = product && reviews.find((entry) => String(entry.product) === String(product._id));
    entries.push({
      productId: product?._id,
      slug: product?.slug || item.slug,
      name: item.name,
      image: product?.images?.[0]?.url || item.image || null,
      reviewable: Boolean(product?.isActive),
      review: review
        ? { rating: review.rating, title: review.title, body: review.body, createdAt: review.createdAt }
        : null,
    });
  }
  return entries;
}

const publicItem = ({ productId, ...item }) => item;

function emailHint(email) {
  const [name, domain] = email.split('@');
  if (!name || !domain) return '';
  return `${name.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(name.length - 1, 6)))}@${domain}`;
}

// Public reviews contain only approved feedback from authenticated purchasers.
router.get('/product/:slug', async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, isActive: true }).select('_id').lean();
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const reviews = await Review.find({ product: product._id, status: 'approved' })
      .select('displayName rating title body verifiedPurchase createdAt')
      .sort({ createdAt: -1 })
      .lean();
    const summary = reviews.reduce((result, review) => {
      result.count += 1;
      result.total += review.rating;
      result.breakdown[review.rating] += 1;
      return result;
    }, { count: 0, total: 0, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    summary.average = summary.count ? Number((summary.total / summary.count).toFixed(1)) : 0;
    delete summary.total;
    res.json({ reviews, summary });
  } catch (err) {
    console.error('Reviews fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

router.post(
  '/product/:slug',
  authenticate,
  [
    param('slug').trim().notEmpty(),
    ...reviewRules,
  ],
  validate,
  async (req, res) => {
    try {
      const product = await Product.findOne({ slug: req.params.slug, isActive: true }).lean();
      if (!product) return res.status(404).json({ error: 'Product not found' });

      const order = await Order.findOne({
        user: req.user._id,
        paymentStatus: 'paid',
        status: { $in: ['shipped', 'delivered'] },
        'items.product': product._id,
      }).sort({ createdAt: -1 }).lean();
      if (!order) {
        return res.status(403).json({ error: 'Reviews are available after your paid order ships.' });
      }

      const existing = await Review.findOne({ product: product._id, order: order._id, user: req.user._id });
      if (existing) return res.status(409).json({ error: 'You already reviewed this purchase.' });

      const review = await Review.create({
        product: product._id,
        order: order._id,
        user: req.user._id,
        displayName: req.user.firstName || 'Verified customer',
        rating: req.body.rating,
        title: req.body.title || undefined,
        body: req.body.body,
        verifiedPurchase: true,
        status: 'approved',
      });
      res.status(201).json({ review });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'You already reviewed this purchase.' });
      console.error('Review create error:', err);
      res.status(500).json({ error: 'Failed to submit review' });
    }
  }
);

// ─── Emailed review links (work for guest checkouts too) ─────────────────────
// The token travels in the request body, never in a URL, so it stays out of
// request logs.

router.post('/request/lookup', [tokenRule], validate, async (req, res) => {
  try {
    const order = await orderForToken(req.body.token);
    if (!order) return res.status(401).json({ error: INVALID_LINK });
    const email = orderEmail(order);
    const [items, optedOut] = await Promise.all([
      orderReviewItems(order),
      email ? ReviewEmailOptOut.exists({ email }) : null,
    ]);
    res.json({
      order: { orderNumber: order.orderNumber, firstName: orderFirstName(order) },
      eligible: isReviewableOrder(order),
      items: items.map(publicItem),
      unsubscribed: Boolean(optedOut),
      emailHint: email ? emailHint(email) : '',
    });
  } catch (err) {
    console.error('Review link lookup error:', err);
    res.status(500).json({ error: 'Failed to load this order' });
  }
});

router.post(
  '/request/reviews',
  [tokenRule, body('slug').isString().trim().notEmpty().isLength({ max: 200 }), ...reviewRules],
  validate,
  async (req, res) => {
    try {
      const order = await orderForToken(req.body.token);
      if (!order) return res.status(401).json({ error: INVALID_LINK });
      if (!isReviewableOrder(order)) {
        return res.status(403).json({ error: 'Reviews are available after your paid order ships.' });
      }
      const item = (await orderReviewItems(order)).find((entry) => entry.slug === req.body.slug);
      if (!item) return res.status(404).json({ error: 'That product is not part of this order.' });
      if (!item.reviewable) return res.status(409).json({ error: 'That product is no longer listed, so it cannot be reviewed.' });
      if (item.review) return res.status(409).json({ error: 'You already reviewed this purchase.' });

      const review = await Review.create({
        product: item.productId,
        order: order._id,
        user: order.user?._id || undefined,
        displayName: orderFirstName(order) || 'Verified customer',
        rating: req.body.rating,
        title: req.body.title || undefined,
        body: req.body.body,
        verifiedPurchase: true,
        status: 'approved',
        source: 'email-link',
      });
      res.status(201).json({
        review: {
          slug: item.slug,
          rating: review.rating,
          title: review.title,
          body: review.body,
          createdAt: review.createdAt,
        },
      });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'You already reviewed this purchase.' });
      console.error('Review link create error:', err);
      res.status(500).json({ error: 'Failed to submit review' });
    }
  }
);

router.post('/request/unsubscribe', [tokenRule], validate, async (req, res) => {
  try {
    const order = await orderForToken(req.body.token);
    if (!order) return res.status(401).json({ error: INVALID_LINK });
    const email = orderEmail(order);
    if (!email) return res.status(409).json({ error: 'This order has no email address on file.' });
    await ReviewEmailOptOut.updateOne({ email }, { $setOnInsert: { email } }, { upsert: true });
    try {
      await cancelPendingReviewRequestsFor(email);
    } catch (err) {
      console.error('Pending review email cancel error:', err.message);
    }
    res.json({ unsubscribed: true, emailHint: emailHint(email) });
  } catch (err) {
    console.error('Review email unsubscribe error:', err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

module.exports = router;
