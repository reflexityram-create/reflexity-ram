const express = require('express');
const { body } = require('express-validator');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { validate } = require('../middleware/validate');
const { optionalAuth } = require('../middleware/auth');
const { validGuestSessionId } = require('../utils/guestSession');
const { CartMutationError, mutateCartWithRetry } = require('../utils/cartConcurrency');
const { resolveCartShippingPrice, resolveFasterShippingPrice } = require('../config/shipping');

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
const itemProductId = (item) => item?.product?._id || item?.product || null;
// All cart endpoints expose the same purchasable view. Product IDs survive a slug
// rename; the stored slug is only a fallback for legacy lines with no product ID.
// Gone, inactive, or non-Server products stay in the persisted cart but are omitted
// everywhere until they become purchasable again.
const publicCartView = async (cart) => {
  const cartItems = cart.items || [];
  const productIds = [...new Set(cartItems.map(itemProductId).filter(Boolean).map(String))];
  const legacySlugs = [...new Set(cartItems
    .filter((item) => !itemProductId(item))
    .map((item) => item.slug)
    .filter(Boolean))];
  const [productsById, legacyProducts] = await Promise.all([
    productIds.length
      ? Product.find({ _id: { $in: productIds }, isActive: true, line: 'Server' }).lean()
      : [],
    legacySlugs.length
      ? Product.find({ slug: { $in: legacySlugs }, isActive: true, line: 'Server' }).lean()
      : [],
  ]);
  const products = new Map(productsById.map((product) => [String(product._id), product]));
  const legacyProductsBySlug = new Map(legacyProducts.map((product) => [product.slug, product]));
  const lines = cartItems.map((item) => ({
    item,
    product: products.get(String(itemProductId(item))) || (!itemProductId(item) && legacyProductsBySlug.get(item.slug)),
  })).filter(({ product }) => product);
  const items = lines.map(({ item, product }) => withAvailable(item, product));
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

    res.json({ cart: await publicCartView(cart) });
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
        const existingItem = draft.items.find((item) => item.slug === slug || String(itemProductId(item)) === String(product._id));
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
          itemProductId(item)
            ? { _id: itemProductId(item), isActive: true, line: 'Server' }
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
