const mongoose = require('mongoose');

// One row per thing the shop owner's phone should hear about (a paid order, an e-Transfer to watch for, a
// failed payment, a quote request ...). Written by utils/adminEvents.js, read by the phone app through
// GET /api/device/events. Rows carry NO customer contact details or addresses: the text is shown on a lock
// screen. Old rows expire on their own.
const adminEventSchema = new mongoose.Schema({
  type: { type: String, required: true, trim: true, maxlength: 40 },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  body: { type: String, default: '', trim: true, maxlength: 300 },
  // high = needs the owner (money arrived, something failed); normal = good to know; low = background progress.
  priority: { type: String, enum: ['high', 'normal', 'low'], default: 'normal' },
  // Where the app opens when the notification is tapped: a path on the storefront site.
  path: { type: String, default: '/admin/orders', trim: true, maxlength: 200 },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  orderNumber: { type: String, trim: true, maxlength: 80 },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'admin_events',
  versionKey: false,
});

// The phone only ever asks for rows newer than the last one it saw (by _id); two weeks is plenty for a phone that was off.
adminEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });

module.exports = mongoose.model('AdminEvent', adminEventSchema);
