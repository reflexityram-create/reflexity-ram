const express = require('express');
const { body } = require('express-validator');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { validate } = require('../middleware/validate');
const { optionalAuth } = require('../middleware/auth');
const { validGuestSessionId } = require('../utils/guestSession');
const { CartMutationError, mutateCartWithRetry } = require('../utils/cartConcurrency');
const { resolveCartShippingPrice, resolveFasterShippingPrice } = require('../config/shipping');
const { lineProductId, resolveCartLines } = require('../utils/cartLines');

const router = express.Router();
const guestSessionIdFrom = (req) => validGuestSessionId(req.headers['x-session-id'] || req.cookies?.cartSessionId);
const sendCartError = (res, err, fallback) => {
  if (err instanceof CartMutationError) return res.status(err.status).json({ error: err.message });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback.replace(/^Failed to /, 'Failed to ') });
};
// How many of a line the buyer could still hold, so the cart page can stop at the stock on hand.
const withAvailable = (item, product) => {
  const plain = typeof item.toObject === 'function' ? item.toObject() : { ...item };
  const stock = Number(product?.stockQuantity);
  return Number.isFinite(stock) ? { ...plain, available: Math.max(0, stock) } : plain;
};
const unitsMessage = (stock, inCart = 0) =>
  `Only ${stock} units available${inCart > 0 ? ` (${inCart} already in your cart)` : ''}`;
// What the cart page shows is exactly what checkout and the shipping quotes work from: utils/cartLines.js finds each line's product
// (by id, so a renamed slug cannot lose a line) and leaves out lines whose product is gone or inactive, the same way everywhere.
// The price shown is the product's current one; the line keeps its own stored slug, which is what the cart page sends back.
// `heal` also writes the product's current slug, sku, name and price into the stored lines, so slug-based code never meets a stale one.
const publicCartView = async (cart, { heal = false } = {}) => {
  const lines = await resolveCartLines(cart.items, { lean: true });
  let stale = false;
  const items = lines.map(({ item, product }) => {
    if (heal) {
      for (const [field, value] of [['slug', product.slug], ['sku', product.sku], ['name', product.name], ['price', product.price]]) {
        if (value !== undefined && item[field] !== value) { item[field] = value; stale = true; }
      }
    }
    return withAvailable({ ...(typeof item.toObject === 'function' ? item.toObject() : item), price: product.price }, product);
  });
  if (stale) await cart.save().catch(() => {}); // best effort: the next read heals it if a concurrent change won
  return {
    _id: cart._id || null,
    items,
    subtotal: items.reduce((sum, item) => sum + item.price * item.qty, 0),
    itemCount: items.reduce((sum, item) => sum + item.qty, 0),
    // The flat rate Stripe Checkout will charge for this cart (same function).
    shipping: items.length ? resolveCartShippingPrice(lines.map(({ product, item }) => ({ product, qty: item.qty }))) : 0,
    // What Faster shipping would cost for this cart, or null when it is not offered (more than 6 sticks).
    shippingFaster: resolveFasterShippingPrice(lines.map(({ product, item }) => ({ product, qty: item.qty }))),
    discount: cart.discount || 0,
    couponCode: cart.couponCode || null,
  };
};

// ─── GET /api/cart ─────────────────────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  try {
    const sessionId = guestSessionIdFrom(req);
    const userId = req.user?._id;

    if (!userId && !sessionId) {
      return res.json({ cart: await publicCartView({}) });
    }

    const filter = userId ? { user: userId } : { sessionId };
    const cart = await Cart.findOne(filter);

    if (!cart) {
      return res.json({ cart: await publicCartView({}) });
    }

    res.json({ cart: await publicCartView(cart, { heal: true }) });
  } catch (err) {
    console.error('Cart get error:', err);
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
});

// ─── POST /api/cart/add ────────────────────────────────────────────────────────
router.post(
  '/add',
  optionalAuth,
  [
    body('slug').notEmpty().withMessage('Product slug required'),
    body('qty').isInt({ min: 1, max: 99 }).withMessage('Quantity must be 1–99'),
  ],
  validate,
  async (req, res) => {
    try {
      const { slug, qty = 1 } = req.body;
      const sessionId = guestSessionIdFrom(req);
      const userId = req.user?._id;

      if (!userId && !sessionId) {
        return res.status(400).json({ error: 'Session ID required for guest cart' });
      }

      // Validate product exists and is in stock
      const product = await Product.findOne({ slug, isActive: true, line: 'Server' });
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      if (product.stock === 'out' || product.stockQuantity <= 0) {
        return res.status(400).json({ error: 'Product is out of stock' });
      }

      const filter = userId ? { user: userId } : { sessionId };
      const cart = await mutateCartWithRetry(filter, async (draft) => {
        const existingItem = draft.items.find((item) => item.slug === slug || String(lineProductId(item)) === String(product._id));
        if (existingItem) {
          const newQty = existingItem.qty + qty;
          if (newQty > product.stockQuantity) throw new CartMutationError(400, unitsMessage(product.stockQuantity, existingItem.qty));
          existingItem.qty = newQty;
          existingItem.price = product.price;
        } else {
          if (qty > product.stockQuantity) throw new CartMutationError(400, unitsMessage(product.stockQuantity));
          draft.items.push({
            product: product._id, slug: product.slug, sku: product.sku, name: product.name,
            price: product.price, image: product.images?.[0]?.url || '', qty,
          });
        }
      }, { create: true });

      const publicCart = await publicCartView(cart);

      res.json({
        message: 'Added to cart',
        cart: publicCart,
      });
    } catch (err) {
      sendCartError(res, err, 'Failed to add to cart');
    }
  }
);

// ─── PATCH /api/cart/update ────────────────────────────────────────────────────
router.patch(
  '/update',
  optionalAuth,
  [
    body('slug').notEmpty().withMessage('Product slug required'),
    body('qty').isInt({ min: 0, max: 99 }).withMessage('Quantity must be 0–99'),
  ],
  validate,
  async (req, res) => {
    try {
      const { slug, qty } = req.body;
      const sessionId = guestSessionIdFrom(req);
      const userId = req.user?._id;
      if (!userId && !sessionId) return res.status(401).json({ error: 'Authentication or valid guest session required' });

      const filter = userId ? { user: userId } : { sessionId };
      const cart = await mutateCartWithRetry(filter, async (draft) => {
        if (qty === 0) {
          draft.items = draft.items.filter(i => i.slug !== slug);
          return;
        }
        const item = draft.items.find(i => i.slug === slug);
        if (!item) throw new CartMutationError(404, 'Item not in cart');
        const product = await Product.findOne(
          lineProductId(item)
            ? { _id: lineProductId(item), isActive: true, line: 'Server' }
            : { slug, isActive: true, line: 'Server' },
        );
        if (!product) throw new CartMutationError(400, 'Product is no longer available');
        if (qty > product.stockQuantity) throw new CartMutationError(400, unitsMessage(product.stockQuantity));
        item.qty = qty;
        item.price = product.price;
      });
      if (!cart) {
        return res.status(404).json({ error: 'Cart not found' });
      }

      const publicCart = await publicCartView(cart);

      res.json({
        message: 'Cart updated',
        cart: publicCart,
      });
    } catch (err) {
      sendCartError(res, err, 'Failed to update cart');
    }
  }
);

// ─── DELETE /api/cart/remove/:slug ────────────────────────────────────────────
router.delete('/remove/:slug', optionalAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    const sessionId = guestSessionIdFrom(req);
    const userId = req.user?._id;
    if (!userId && !sessionId) return res.status(401).json({ error: 'Authentication or valid guest session required' });

    const filter = userId ? { user: userId } : { sessionId };
    const cart = await mutateCartWithRetry(filter, async (draft) => {
      draft.items = draft.items.filter(i => i.slug !== slug);
    });
    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    const publicCart = await publicCartView(cart);

    res.json({
      message: 'Item removed',
      cart: publicCart,
    });
  } catch (err) {
    sendCartError(res, err, 'Failed to remove item');
  }
});

// ─── DELETE /api/cart/clear ────────────────────────────────────────────────────
router.delete('/clear', optionalAuth, async (req, res) => {
  try {
    const sessionId = guestSessionIdFrom(req);
    const userId = req.user?._id;
    if (!userId && !sessionId) return res.status(401).json({ error: 'Authentication or valid guest session required' });

    const filter = userId ? { user: userId } : { sessionId };
    await Cart.findOneAndUpdate(filter, { items: [], discount: 0, couponCode: undefined });

    res.json({ message: 'Cart cleared' });
  } catch (err) {
    console.error('Cart clear error:', err);
    res.status(500).json({ error: 'Failed to clear cart' });
  }
});

module.exports = router;
