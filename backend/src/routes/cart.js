const express = require('express');
const { body } = require('express-validator');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { validate } = require('../middleware/validate');
const { optionalAuth } = require('../middleware/auth');
const { validGuestSessionId } = require('../utils/guestSession');
const { CartMutationError, mutateCartWithRetry } = require('../utils/cartConcurrency');

const router = express.Router();
const guestSessionIdFrom = (req) => validGuestSessionId(req.headers['x-session-id'] || req.cookies?.cartSessionId);
const sendCartError = (res, err, fallback) => {
  if (err instanceof CartMutationError) return res.status(err.status).json({ error: err.message });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback.replace(/^Failed to /, 'Failed to ') });
};
const publicCartView = async (cart) => {
  const slugs = [...new Set(cart.items.map((item) => item.slug).filter(Boolean))];
  const products = slugs.length
    ? await Product.find({ slug: { $in: slugs }, isActive: true, line: 'Server' }).lean()
    : [];
  const publicSlugs = new Set(products.map((product) => product.slug));
  const items = cart.items.filter((item) => publicSlugs.has(item.slug));
  return {
    items,
    subtotal: items.reduce((sum, item) => sum + item.price * item.qty, 0),
    itemCount: items.reduce((sum, item) => sum + item.qty, 0),
  };
};

// ─── GET /api/cart ─────────────────────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  try {
    const sessionId = guestSessionIdFrom(req);
    const userId = req.user?._id;

    if (!userId && !sessionId) {
      return res.json({ cart: { items: [], subtotal: 0, itemCount: 0 } });
    }

    const filter = userId ? { user: userId } : { sessionId };
    const cart = await Cart.findOne(filter).populate('items.product', 'stock stockQuantity price name line');

    if (!cart) {
      return res.json({ cart: { items: [], subtotal: 0, itemCount: 0 } });
    }

    // Validate items against current product data
    let needsSave = false;
    const items = cart.items.filter((item) => item.product?.line === 'Server');
    for (const item of items) {
      if (item.product) {
        // Update price if changed
        if (item.price !== item.product.price) {
          item.price = item.product.price;
          needsSave = true;
        }
      }
    }
    if (needsSave) await cart.save();

    const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const itemCount = items.reduce((sum, i) => sum + i.qty, 0);

    res.json({
      cart: {
        _id: cart._id,
        items,
        subtotal,
        itemCount,
        discount: cart.discount,
        couponCode: cart.couponCode,
      },
    });
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
        const existingItem = draft.items.find(i => i.slug === slug);
        if (existingItem) {
          const newQty = existingItem.qty + qty;
          if (newQty > product.stockQuantity) throw new CartMutationError(400, `Only ${product.stockQuantity} units available`);
          existingItem.qty = newQty;
          existingItem.price = product.price;
        } else {
          if (qty > product.stockQuantity) throw new CartMutationError(400, `Only ${product.stockQuantity} units available`);
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
        const product = await Product.findOne({ slug, isActive: true, line: 'Server' });
        if (!product) throw new CartMutationError(400, 'Product is no longer available');
        if (qty > product.stockQuantity) throw new CartMutationError(400, `Only ${product.stockQuantity} units available`);
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
