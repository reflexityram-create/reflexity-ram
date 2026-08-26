const express = require('express');
const { query: queryValidator, param, header: headerValidator } = require('express-validator');
const Order = require('../models/Order');
const { validate } = require('../middleware/validate');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { orderBelongsToUser } = require('../utils/orderAccess');
const { customerOrderResponse } = require('../utils/customerOrders');

const router = express.Router();

// ─── GET /api/orders ───────────────────────────────────────────────────────────
router.get(
  '/',
  authenticate,
  [
    queryValidator('page').optional().isInt({ min: 1 }).toInt(),
    queryValidator('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  ],
  validate,
  async (req, res) => {
    try {
      const page = req.query.page || 1;
      const limit = req.query.limit || 10;
      const skip = (page - 1) * limit;

      const [orders, total] = await Promise.all([
        Order.find({ user: req.user._id })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Order.countDocuments({ user: req.user._id }),
      ]);

      res.json({
        orders: orders.map(customerOrderResponse),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      console.error('Orders list error:', err);
      res.status(500).json({ error: 'Failed to fetch orders' });
    }
  }
);

// ─── GET /api/orders/:orderNumber ─────────────────────────────────────────────
router.get(
  '/:orderNumber',
  optionalAuth,
  [
    param('orderNumber').trim().notEmpty().isLength({ max: 80 }),
    headerValidator('x-order-email')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 254 })
      .isEmail()
      .toLowerCase(),
  ],
  validate,
  async (req, res) => {
    try {
      const { orderNumber } = req.params;
      const order = await Order.findOne({ orderNumber }).populate('user', 'email').lean();

      if (!order) return res.status(404).json({ error: 'Order not found' });

      // Access control:
      //  - admins can view any order
      //  - account orders are visible only to the owning account
      //  - guest orders require the matching email — even for logged-in
      //    users (previously any authenticated account could read any guest
      //    order's address and items by order number)
      const isAdmin = req.user?.role === 'admin';
      if (!isAdmin) {
        if (order.user) {
          if (!req.user || !orderBelongsToUser(order.user, req.user._id)) {
            return res.status(404).json({ error: 'Order not found' });
          }
        } else {
          const email = req.get('x-order-email');
          if (!email || !order.guestEmail || order.guestEmail !== email.toLowerCase().trim()) {
            return res.status(404).json({ error: 'Order not found' });
          }
        }
      }

      res.json({ order: customerOrderResponse(order) });
    } catch (err) {
      console.error('Order detail error:', err);
      res.status(500).json({ error: 'Failed to fetch order' });
    }
  }
);

module.exports = router;
