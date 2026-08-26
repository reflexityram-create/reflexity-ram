const express = require('express');
const { body, param, query: queryValidator } = require('express-validator');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const { validate } = require('../middleware/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sendShippingNotificationEmail } = require('../utils/email');
const { ensureStripePrice, syncStripeProductDetails } = require('../utils/stripeSync');
const { cancelOrderAndRestoreStock } = require('../utils/stock');
const { ORDER_STATUSES, canTransitionOrder } = require('../utils/orderTransitions');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// Prevent browser/CDN caching of all admin API responses
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// ─── Helper: validate MongoDB ObjectId ────────────────────────────────────────
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Keep stock status derived from stockQuantity even when using atomic updates.
const deriveStockState = (stockQuantity) => {
  const quantity = Number(stockQuantity);
  if (quantity === 0) return { stock: 'out', stockLabel: 'Out of stock' };
  if (quantity <= 5) return { stock: 'low', stockLabel: 'Low stock' };
  return { stock: 'in', stockLabel: 'In stock' };
};

// ─── DASHBOARD STATS ──────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [
      totalOrders,
      pendingOrders,
      totalRevenue,
      totalProducts,
      lowStockProducts,
      totalUsers,
      recentOrders,
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: { $in: ['pending', 'processing'] } }),
      Order.aggregate([
        { $match: { paymentStatus: 'paid' } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      Product.countDocuments({ isActive: true }),
      Product.countDocuments({ stock: 'low', isActive: true }),
      User.countDocuments({ role: 'customer' }),
      Order.find().sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    res.json({
      stats: {
        totalOrders,
        pendingOrders,
        totalRevenue: totalRevenue[0]?.total || 0,
        totalProducts,
        lowStockProducts,
        totalUsers,
      },
      recentOrders,
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── PRODUCT MANAGEMENT ───────────────────────────────────────────────────────

// GET /api/admin/products
router.get(
  '/products',
  [
    queryValidator('page').optional().isInt({ min: 1 }).toInt(),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    queryValidator('search').optional().trim().escape(),
    queryValidator('stock').optional().isIn(['in', 'low', 'out']),
    queryValidator('generation').optional().isIn(['DDR4', 'DDR5']),
  ],
  validate,
  async (req, res) => {
    try {
      const { page = 1, limit = 20, search, stock, generation } = req.query;
      const filter = {};
      if (search) filter.$text = { $search: search };
      if (stock) filter.stock = stock;
      if (generation) filter.generation = generation;

      const skip = (page - 1) * limit;
      const [products, total] = await Promise.all([
        Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Product.countDocuments(filter),
      ]);

      res.json({
        products,
        pagination: { page, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  }
);


// GET /api/admin/products/:id
router.get(
  '/products/:id',
  [param('id').custom((v) => isValidObjectId(v)).withMessage('Invalid product ID')],
  validate,
  async (req, res) => {
    try {
      const product = await Product.findById(req.params.id).lean();
      if (!product) return res.status(404).json({ error: 'Product not found' });
      res.json({ product });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch product' });
    }
  }
);

// POST /api/admin/products
router.post(
  '/products',
  [
    body('slug').trim().notEmpty().withMessage('Slug required')
      .matches(/^[a-z0-9-]+$/).withMessage('Slug must be lowercase alphanumeric with hyphens'),
    body('sku').trim().notEmpty().withMessage('SKU required'),
    body('name').trim().notEmpty().withMessage('Name required').isLength({ max: 200 }),
    body('line').isIn(['Desktop', 'Laptop', 'Server']).withMessage('Invalid line'),
    body('generation').isIn(['DDR4', 'DDR5']).withMessage('Invalid generation'),
    body('formFactor').isIn(['UDIMM', 'SO-DIMM', 'RDIMM', 'LRDIMM']).withMessage('Invalid form factor'),
    body('capacity').isNumeric().withMessage('Capacity must be a number'),
    body('capacityLabel').trim().notEmpty(),
    body('speed').isNumeric().withMessage('Speed must be a number'),
    body('speedLabel').trim().notEmpty(),
    body('condition').isIn(['New', 'Open Box — Tested', 'Refurbished — Tested', 'Used']).withMessage('Invalid condition'),
    body('warranty').trim().notEmpty().withMessage('Warranty required'),
    body('isActive').optional().isBoolean(),
    body('price').isFloat({ min: 0.01 }).withMessage('Price must be greater than 0'),
    body('stockQuantity').isInt({ min: 0 }).withMessage('Stock quantity must be non-negative'),
    body('description').optional().trim().isLength({ max: 5000 }),
    body('brand').optional().trim().isLength({ max: 100 }),
    body('mpn').optional().trim().isLength({ max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      // Whitelist allowed fields to prevent mass assignment
      const allowed = [
        'slug', 'sku', 'name', 'line', 'generation', 'formFactor', 'capacity',
        'capacityLabel', 'kit', 'speed', 'speedLabel', 'cas', 'timings', 'voltage',
        'ecc', 'rank', 'profile', 'heatspreader', 'rgb', 'condition', 'warranty',
        'price', 'stockQuantity', 'images', 'description', 'brand', 'mpn',
        'metaTitle', 'metaDescription',
      ];
      // Force new products to be active
      const data = { isActive: true };
      for (const key of allowed) {
        if (req.body[key] !== undefined) data[key] = req.body[key];
      }

      const product = await Product.create(data);

      // Sync to Stripe (Product + Price). Non-fatal: if Stripe is down or not
      // configured, the product still saves and sync retries lazily at checkout.
      try {
        await ensureStripePrice(product);
      } catch (stripeErr) {
        console.warn(`Stripe sync failed for new product ${product.slug}:`, stripeErr.message);
      }

      res.status(201).json({ product });
    } catch (err) {
      if (err.code === 11000) {
        const field = Object.keys(err.keyPattern)[0];
        return res.status(409).json({ error: `${field} already exists` });
      }
      console.error('Create product error:', err);
      res.status(500).json({ error: 'Failed to create product' });
    }
  }
);

// PATCH /api/admin/products/:id
router.patch(
  '/products/:id',
  [param('id').custom((v) => isValidObjectId(v)).withMessage('Invalid product ID')],
  validate,
  async (req, res) => {
    try {
      // Whitelist allowed update fields — prevent overwriting internal fields
      const allowed = [
        'name', 'line', 'generation', 'formFactor', 'capacity', 'capacityLabel',
        'kit', 'speed', 'speedLabel', 'cas', 'timings', 'voltage', 'ecc', 'rank',
        'profile', 'heatspreader', 'rgb', 'condition', 'warranty', 'price',
        'stockQuantity', 'images', 'description', 'brand', 'mpn',
        'metaTitle', 'metaDescription', 'isActive',
      ];
      // Validate line if provided
      if (req.body.line !== undefined && !['Desktop', 'Laptop', 'Server'].includes(req.body.line)) {
        return res.status(400).json({ error: 'Invalid line' });
      }
      // Validate condition if provided
      if (req.body.condition !== undefined && !['New', 'Open Box — Tested', 'Refurbished — Tested', 'Used'].includes(req.body.condition)) {
        return res.status(400).json({ error: 'Invalid condition' });
      }
      if (req.body.isActive !== undefined && typeof req.body.isActive !== 'boolean') {
        return res.status(400).json({ error: 'isActive must be boolean' });
      }
      const updates = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      if (updates.stockQuantity !== undefined) {
        Object.assign(updates, deriveStockState(updates.stockQuantity));
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const product = await Product.findByIdAndUpdate(
        req.params.id,
        { $set: updates },
        { returnDocument: 'after', runValidators: true }
      );
      if (!product) return res.status(404).json({ error: 'Product not found' });

      // Re-sync Stripe: price changes create a new Price (prices are immutable),
      // name/description/image changes update the Stripe Product. Non-fatal.
      try {
        await ensureStripePrice(product);
        await syncStripeProductDetails(product);
      } catch (stripeErr) {
        console.warn(`Stripe sync failed for ${product.slug}:`, stripeErr.message);
      }

      res.json({ product });
    } catch (err) {
      console.error('Update product error:', err);
      res.status(500).json({ error: 'Failed to update product' });
    }
  }
);

// DELETE /api/admin/products/:id (soft deactivate; preserve order/review history)
router.delete(
  '/products/:id',
  [param('id').custom((v) => isValidObjectId(v)).withMessage('Invalid product ID')],
  validate,
  async (req, res) => {
    try {
      const product = await Product.findByIdAndUpdate(
        req.params.id,
        { $set: { isActive: false } },
        { returnDocument: 'after' }
      );
      if (!product) return res.status(404).json({ error: 'Product not found' });
      res.json({ message: 'Product deactivated', product });
    } catch (err) {
      res.status(500).json({ error: 'Failed to deactivate product' });
    }
  }
);

// PATCH /api/admin/products/:id/stock
router.patch(
  '/products/:id/stock',
  [
    param('id').custom((v) => isValidObjectId(v)).withMessage('Invalid product ID'),
    body('stockQuantity').isInt({ min: 0 }).withMessage('Stock quantity must be non-negative'),
  ],
  validate,
  async (req, res) => {
    try {
      const stockUpdates = {
        stockQuantity: req.body.stockQuantity,
        ...deriveStockState(req.body.stockQuantity),
      };

      const product = await Product.findByIdAndUpdate(
        req.params.id,
        stockUpdates,
        { returnDocument: 'after', runValidators: true }
      );
      if (!product) return res.status(404).json({ error: 'Product not found' });
      res.json({ product });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update stock' });
    }
  }
);

// ─── ORDER MANAGEMENT ─────────────────────────────────────────────────────────

// GET /api/admin/orders
router.get(
  '/orders',
  [
    queryValidator('page').optional().isInt({ min: 1 }).toInt(),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    queryValidator('status').optional().isIn(['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']),
    queryValidator('search').optional().trim(),
    queryValidator('archived').optional().isIn(['true', 'false', 'all']),
  ],
  validate,
  async (req, res) => {
    try {
      const { page = 1, limit = 20, status, search, archived } = req.query;
      const filter = {};
      if (status) filter.status = status;
      // By default hide archived orders. ?archived=true shows only archived,
      // ?archived=all shows everything.
      if (archived === 'true') filter.archived = true;
      else if (archived === 'all') { /* no archived filter */ }
      else filter.archived = { $ne: true };
      if (search) {
        filter.$or = [
          { orderNumber: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
          { guestEmail: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        ];
      }

      const skip = (page - 1) * limit;
      const [orders, total] = await Promise.all([
        Order.find(filter)
          .populate('user', 'firstName lastName email')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Order.countDocuments(filter),
      ]);

      res.json({
        orders,
        pagination: { page, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch orders' });
    }
  }
);

// GET /api/admin/orders/:id
router.get(
  '/orders/:id',
  [param('id').custom((v) => isValidObjectId(v)).withMessage('Invalid order ID')],
  validate,
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.id)
        .populate('user', 'firstName lastName email phone')
        .lean();
      if (!order) return res.status(404).json({ error: 'Order not found' });
      res.json({ order });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch order' });
    }
  }
);

// PATCH /api/admin/orders/:id/status
router.patch(
  '/orders/:id/status',
  [
    param('id').custom((v) => isValidObjectId(v)).withMessage('Invalid order ID'),
    body('status')
      .isIn(ORDER_STATUSES.filter((status) => status !== 'refunded'))
      .withMessage('Invalid status'),
    body('trackingNumber').optional().trim().isLength({ max: 100 }),
    body('note').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { status, trackingNumber, note } = req.body;
      const current = await Order.findById(req.params.id).select('status paymentStatus');
      if (!current) return res.status(404).json({ error: 'Order not found' });
      if (!canTransitionOrder(current.status, status, current.paymentStatus)) {
        return res.status(409).json({ error: `Cannot change order from ${current.status} to ${status}` });
      }
      const updates = {
        status,
        $push: {
          statusHistory: {
            status,
            note: note || `Status updated to ${status}`,
            timestamp: new Date(),
          },
        },
      };

      if (trackingNumber) updates.trackingNumber = trackingNumber;
      if (status === 'shipped') updates.shippedAt = new Date();
      if (status === 'delivered') updates.deliveredAt = new Date();
      if (status === 'cancelled') updates.cancelledAt = new Date();

      let order;
      if (status === 'cancelled') {
        const cancelledId = await cancelOrderAndRestoreStock(req.params.id, updates, {
          status: current.status,
          paymentStatus: current.paymentStatus,
        });
        if (!cancelledId) return res.status(409).json({ error: 'Order changed while this update was being applied' });
        order = await Order.findById(cancelledId)
          .populate('user', 'firstName lastName email');
      } else {
        order = await Order.findOneAndUpdate({
          _id: req.params.id,
          status: current.status,
          paymentStatus: current.paymentStatus,
        }, updates, { returnDocument: 'after' })
          .populate('user', 'firstName lastName email');
      }

      if (!order) return res.status(409).json({ error: 'Order changed while this update was being applied' });

      // Send shipping notification
      if (status === 'shipped') {
        const email = order.user?.email || order.guestEmail;
        const firstName = order.user?.firstName || order.shippingAddress?.firstName;
        if (email) {
          try {
            await sendShippingNotificationEmail({ email, firstName, order });
          } catch (emailErr) {
            console.error('Shipping notification email failed:', emailErr.message);
          }
        }
      }

      res.json({ order });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update order status' });
    }
  }
);

// PATCH /api/admin/orders/:id/archive — toggle archived (declutter, not delete)
router.patch(
  '/orders/:id/archive',
  [body('archived').isBoolean()],
  validate,
  async (req, res) => {
    try {
      const order = await Order.findByIdAndUpdate(
        req.params.id,
        { archived: req.body.archived },
        { returnDocument: 'after' }
      );
      if (!order) return res.status(404).json({ error: 'Order not found' });
      res.json({ order });
    } catch (err) {
      res.status(500).json({ error: 'Failed to archive order' });
    }
  }
);

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────

// GET /api/admin/users
router.get(
  '/users',
  [
    queryValidator('page').optional().isInt({ min: 1 }).toInt(),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    queryValidator('search').optional().trim(),
    queryValidator('role').optional().isIn(['customer', 'admin']),
  ],
  validate,
  async (req, res) => {
    try {
      const { page = 1, limit = 20, search, role } = req.query;
      const filter = {};
      if (role) filter.role = role;
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
          { email: { $regex: escaped, $options: 'i' } },
          { firstName: { $regex: escaped, $options: 'i' } },
          { lastName: { $regex: escaped, $options: 'i' } },
        ];
      }

      const skip = (page - 1) * limit;
      const [users, total] = await Promise.all([
        User.find(filter)
          .select('_id email firstName lastName phone role isActive isEmailVerified createdAt')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(filter),
      ]);

      res.json({
        users,
        pagination: { page, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  }
);

// PATCH /api/admin/users/:id
router.patch(
  '/users/:id',
  [
    param('id').custom((v) => isValidObjectId(v)).withMessage('Invalid user ID'),
    body('role').optional().isIn(['customer', 'admin']).withMessage('Invalid role'),
    body('isActive').optional().isBoolean().withMessage('isActive must be boolean'),
  ],
  validate,
  async (req, res) => {
    try {
      // SECURITY: Prevent admin from demoting themselves
      if (req.params.id === req.user._id.toString() && req.body.role === 'customer') {
        return res.status(400).json({ error: 'You cannot remove your own admin role' });
      }
      // SECURITY: Prevent admin from deactivating themselves
      if (req.params.id === req.user._id.toString() && req.body.isActive === false) {
        return res.status(400).json({ error: 'You cannot deactivate your own account' });
      }

      const { role, isActive } = req.body;
      const updates = {};
      if (role !== undefined) updates.role = role;
      if (isActive !== undefined) updates.isActive = isActive;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const user = await User.findByIdAndUpdate(
        req.params.id,
        { $set: updates, $inc: { authVersion: 1 } },
        { returnDocument: 'after', runValidators: true },
      );
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json({ user });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

// GET /api/admin/users/:id/orders
router.get(
  '/users/:id/orders',
  [param('id').custom((v) => isValidObjectId(v)).withMessage('Invalid user ID')],
  validate,
  async (req, res) => {
    try {
      const orders = await Order.find({ user: req.params.id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
      res.json({ orders });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch user orders' });
    }
  }
);

module.exports = router;
