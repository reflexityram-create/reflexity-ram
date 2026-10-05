const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
  },
  slug: { type: String, required: true },
  sku: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  image: { type: String },
  qty: { type: Number, required: true, min: 1 },
  // How many units were actually taken from stock for this item. Normally
  // equals qty; can be lower if the item oversold (concurrent buyers of the
  // last units). Used by restoreStockForOrder so restores are exact.
  // Legacy orders without this field are treated as decrementedQty = qty.
  decrementedQty: { type: Number },
}, { _id: false });

const addressSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  line1: { type: String, required: true },
  line2: { type: String },
  city: { type: String, required: true },
  state: { type: String, required: true },
  zip: { type: String, required: true },
  country: { type: String, required: true, default: 'US' },
  phone: { type: String },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    sparse: true,
  },
  guestEmail: { type: String, lowercase: true, trim: true },
  items: [orderItemSchema],
  shippingAddress: { type: addressSchema, required: true },
  billingAddress: addressSchema,
  status: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
    default: 'pending',
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending',
  },
  paymentMethod: { type: String, default: 'stripe' },
  stripePaymentIntentId: { type: String },
  stripeCheckoutSessionId: { type: String },
  stripeChargeId: { type: String },
  subtotal: { type: Number, required: true },
  shippingCost: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  // Guard flag: stock is decremented exactly once per order (see utils/stock.js)
  stockDecremented: { type: Boolean, default: false },
  // Server-side GA4 purchase reporting (see utils/ga4.js, utils/purchaseAnalytics.js).
  // Client/session ids come from the buyer's browser at checkout; the sent-at stamp
  // is the exactly-once claim. select:false keeps them out of every default query.
  analyticsClientId: { type: String, select: false },
  analyticsSessionId: { type: String, select: false },
  analyticsPurchaseSentAt: { type: Date, default: null, select: false },
  // The one "how was your order?" email (see utils/reviewRequests.js).
  // claimedAt is the exactly-once claim; Resend holds the email until
  // scheduledFor, and emailId lets a full refund cancel it before then.
  reviewRequest: {
    claimedAt: { type: Date },
    scheduledFor: { type: Date },
    emailId: { type: String },
    cancelledAt: { type: Date },
    lastError: { type: String },
  },
  // Admins can archive orders to declutter the list without deleting the
  // financial record. Archived orders are hidden from the default view.
  archived: { type: Boolean, default: false },
  shippingMethod: { type: String },
  trackingNumber: { type: String },
  trackingUrl: { type: String },
  // Latest Canada Post scan for a shipped order (utils/trackingSync.js).
  trackingLatest: {
    code: String,
    description: String,
    date: String,
    time: String,
    timeZone: String,
    location: String,
    expectedDeliveryDate: String,
    checkedAt: Date,
  },
  // Each tracking email goes out once; set when it is sent.
  outForDeliveryEmailAt: { type: Date },
  pickupNoticeEmailAt: { type: Date },
  deliveredEmailAt: { type: Date },
  notes: { type: String },
  adminNotes: { type: String },
  estimatedDelivery: { type: Date },
  shippedAt: { type: Date },
  deliveredAt: { type: Date },
  cancelledAt: { type: Date },
  statusHistory: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    note: String,
  }],
}, {
  timestamps: true,
});

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
// UNIQUE: the DB enforces one order per PaymentIntent even if the app-level
// duplicate check races (two simultaneous submissions of the same PI).
// sparse: allows legacy/manual orders without a PI.
orderSchema.index({ stripePaymentIntentId: 1 }, { unique: true, sparse: true });
// UNIQUE: one order per Checkout Session — this is the duplicate-fulfillment
// guard. Both the webhook and the success-page fallback try to create the
// order; whichever loses the race gets a duplicate-key error and reuses the
// existing order instead.
orderSchema.index({ stripeCheckoutSessionId: 1 }, { unique: true, sparse: true });

// Generate order number before validation (required:true is checked during
// validation, which runs BEFORE pre('save') hooks — so this must be
// pre('validate'), not pre('save')). Uses crypto randomness: 6 random chars
// (~2.1 billion combinations) on top of a ms timestamp, so collisions are
// practically impossible even under concurrent checkouts.
const crypto = require('crypto');
orderSchema.pre('validate', function () {
  if (!this.orderNumber) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
    this.orderNumber = `RFX-${timestamp}-${random}`;
  }
});

module.exports = mongoose.model('Order', orderSchema);
