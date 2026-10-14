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

// Canadian and US addresses always have a city, province/state and postal
// code. Many other countries have no province or postal code (and a few no
// city), and Stripe leaves those empty, so a paid order must still save.
const requiredInNorthAmerica = function requiredInNorthAmerica() {
  return ['CA', 'US'].includes(this.country);
};

const addressSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  line1: { type: String, required: true },
  line2: { type: String },
  city: { type: String, required: requiredInNorthAmerica },
  state: { type: String, required: requiredInNorthAmerica },
  zip: { type: String, required: requiredInNorthAmerica },
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
  // 'stripe' = card and wallets through Stripe Checkout (the default and every order before 2026-10-13), 'bank_debit' =
  // Stripe pre-authorized debit (clears days later), 'etransfer' = Interac e-Transfer confirmed by the owner by hand.
  paymentMethod: { type: String, default: 'stripe' },
  // The percent discount the payment method gave on the goods (bank debit / e-Transfer); `discount` holds the dollars.
  paymentDiscountPct: { type: Number },
  // When the money actually arrived, for a method that clears after the order was placed (bank debit, e-Transfer). A card
  // order is paid when it is created, so it has none and everything that needs "when was it paid" falls back to createdAt.
  paidAt: { type: Date },
  // Interac e-Transfer orders only (utils/etransfer.js). The order is saved unpaid with its stock held; the owner marks
  // the transfer received, or the hold lapses at expiresAt and the stock goes back.
  etransfer: {
    recipientEmail: { type: String },   // the address the buyer was told to pay, kept so a later change cannot confuse an open order
    amountDue: { type: Number },
    expiresAt: { type: Date },
    reminderSentAt: { type: Date },
    expiredAt: { type: Date },
    receivedAt: { type: Date },
    receivedAmount: { type: Number },
    confirmation: { type: String },     // the bank's e-Transfer confirmation number, if the owner typed it in
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  stripePaymentIntentId: { type: String },
  stripeCheckoutSessionId: { type: String },
  stripeChargeId: { type: String },
  subtotal: { type: Number, required: true },
  shippingCost: { type: Number, default: 0 },
  // US orders: how much of shippingCost is the prepaid US import duties and fees (the rest is Canada Post). Zero elsewhere.
  importDuties: { type: Number, default: 0 },
  importDutiesQuoteId: { type: String },
  tax: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  // Guard flag: stock is decremented exactly once per order (see utils/stock.js)
  stockDecremented: { type: Boolean, default: false },
  // True from the moment a Stripe order is saved until the steps that follow it are done: the buyer's stock hold given back
  // (utils/stockHolds.js) and the cart that became this order emptied. A crash in between leaves it set, and the next retry of the
  // order (Stripe redelivers the event, the buyer reopens the success page) finishes the job.
  postOrderPending: { type: Boolean },
  // A dispute (chargeback) or a bank inquiry on this order's payment, kept up to date from Stripe's charge.dispute.* events
  // (utils/disputes.js). Only the owner sees it: the buyer's order shape (utils/customerOrders.js) is an explicit list without it.
  dispute: {
    id: { type: String },
    status: { type: String },          // Stripe's: needs_response, under_review, won, lost, warning_needs_response, warning_closed ...
    reason: { type: String },          // Stripe's reason code: fraudulent, product_not_received ...
    reasonText: { type: String },      // the same in words, for the admin page and the alert
    amount: { type: Number },          // dollars
    currency: { type: String },
    openedAt: { type: Date },
    evidenceDueBy: { type: Date },     // the owner's deadline to send evidence in Stripe
    closedAt: { type: Date },
    eventAt: { type: Date },           // when the newest Stripe event applied here was made: an older one arriving late is ignored
  },
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
  // Legacy: the old Archive button set this. Nothing reads it any more (the admin list shows every order); it stays so the
  // orders that were archived keep their record.
  archived: { type: Boolean, default: false },
  shippingMethod: { type: String },
  trackingNumber: { type: String },
  // Marked shipped by the owner on purpose without a tracking number (the Terms let the shop choose the service). The
  // shipping email says so and the buyer's order page shows it.
  untracked: { type: Boolean, default: false },
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
  // Created only for new shipped transitions; old shipments are not re-emailed.
  shippingNotification: {
    status: { type: String, enum: ['pending', 'sending', 'sent', 'failed', 'skipped'] },
    claimedAt: Date,
    sentAt: Date,
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
// The e-Transfer sweeper (expire / remind) looks only at unpaid e-Transfer orders.
orderSchema.index({ paymentMethod: 1, paymentStatus: 1, status: 1, 'etransfer.expiresAt': 1 });
// UNIQUE: the DB enforces one order per PaymentIntent even if the app-level
// duplicate check races (two simultaneous submissions of the same PI).
// Partial (only orders whose PaymentIntent is a string): e-Transfer and zero-total orders have none, and a sparse index would
// still hold an explicit null. It has its own name because production already holds a plain, non-unique `stripePaymentIntentId_1`
// and a unique index of that NAME failed a deploy. The server does not build it through Mongoose: the migration in
// migrations/ensureOrderPaymentIndexes.js does, from the same definition (a test checks the two agree).
orderSchema.index(
  { stripePaymentIntentId: 1 },
  { name: 'stripePaymentIntentId_unique', unique: true, partialFilterExpression: { stripePaymentIntentId: { $type: 'string' } } },
);
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
