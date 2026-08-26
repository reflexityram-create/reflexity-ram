const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  slug: { type: String, required: true },
  sku: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  image: { type: String },
  qty: { type: Number, required: true, min: 1, default: 1 },
}, { _id: false });

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  sessionId: { type: String }, // For guest carts
  items: [cartItemSchema],
  couponCode: { type: String },
  discount: { type: Number, default: 0 },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  },
}, {
  timestamps: true,
  // Reject stale read-modify-save writes instead of silently overwriting a
  // concurrent tab's cart mutation. Routes retry the bounded conflict.
  optimisticConcurrency: true,
});

// TTL index to auto-delete expired guest carts
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Exactly one cart may exist for each owner. Existing deployments must merge
// duplicate rows before these unique indexes can build (see the migration
// helper); failing closed is safer than allowing future duplicate carts.
cartSchema.index({ user: 1 }, { unique: true, sparse: true });
cartSchema.index({ sessionId: 1 }, { unique: true, sparse: true });

// Virtual for subtotal
cartSchema.virtual('subtotal').get(function () {
  return this.items.reduce((sum, item) => sum + item.price * item.qty, 0);
});

// Virtual for total items count
cartSchema.virtual('itemCount').get(function () {
  return this.items.reduce((sum, item) => sum + item.qty, 0);
});

module.exports = mongoose.model('Cart', cartSchema);
