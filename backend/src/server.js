require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const adminWholesaleRoutes = require('./routes/adminWholesale');
const wholesaleRoutes = require('./routes/wholesale');
const uploadRoutes = require('./routes/upload');
const pageRoutes = require('./routes/pages');
const trackingRoutes = require('./routes/tracking');
const shippingRoutes = require('./routes/shipping');
const seedRoutes = require('./routes/seed');
const sitemapRoutes = require('./routes/sitemap');
const feedRoutes = require('./routes/feed');
const reviewRoutes = require('./routes/reviews');
const { createLeadRouter } = require('./routes/leads');
const { createDeviceRouter } = require('./routes/device');
const { createPaymentsRouter } = require('./routes/payments');
const { createAddressRouter } = require('./routes/address');
const { onlyWhenProvider, dailyLookupCap, photonDailyCap } = require('./utils/addressConfig');
const { sweepEtransferOrdersThrottled } = require('./utils/etransfer');
const { syncShippedOrdersThrottled } = require('./utils/trackingSync');
const { retryUntrackedShipmentNoticesThrottled } = require('./utils/shippingNotifications');
const { createErrorHandler } = require('./middleware/errorHandler');
const { createAdminDevicesRouter } = require('./routes/adminDevices');
const { createDeviceLimiter, createPairLimiter } = require('./middleware/phoneLimiters');
const { fixMerchantProductData } = require('./migrations/fixMerchantProductData');
const { ensureCartOwnershipIndexes } = require('./migrations/ensureCartOwnershipIndexes');
const { syncActiveProductPrices } = require('./migrations/syncStoreCurrency');
const WholesaleLot = require('./models/WholesaleLot');
const WholesaleMediaAsset = require('./models/WholesaleMediaAsset');
const Product = require('./models/Product');
const User = require('./models/User');
const Cart = require('./models/Cart');
const Order = require('./models/Order');
const Review = require('./models/Review');
const ReviewEmailOptOut = require('./models/ReviewEmailOptOut');
const PageContent = require('./models/PageContent');
const RateLimitEntry = require('./models/RateLimitEntry');
const AdminEvent = require('./models/AdminEvent');
const AdminDevice = require('./models/AdminDevice');
const DevicePairing = require('./models/DevicePairing');
const { MongoRateLimitStore } = require('./utils/mongoRateLimitStore');

// Stripe routes are only loaded when a real key is configured.
// This prevents a crash if STRIPE_SECRET_KEY is missing or empty.
const STRIPE_ENABLED =
  process.env.STRIPE_SECRET_KEY &&
  (process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') ||
    process.env.STRIPE_SECRET_KEY.startsWith('sk_live_'));
let stripeRoutes;
if (STRIPE_ENABLED) {
  stripeRoutes = require('./routes/stripe');
}

const app = express();

// Render/Railway sit behind one proxy hop. Without this, express-rate-limit
// keys every visitor to the proxy's IP — meaning ALL users share one rate
// bucket (20 auth requests / 15 min for the entire site = login lockout for
// everyone under light traffic). Verified against express-rate-limit v8.
app.set('trust proxy', 1);

// ─── Security Middleware ───────────────────────────────────────────────────────
app.use(helmet());

// CORS: merge configured origins with the known production frontends.
// This prevents a single missing environment entry from breaking secondary deploys.
// Keep this list intentionally closed. ALLOWED_ORIGINS is treated as a
// deployment assertion, not an escape hatch for arbitrary credentialed web
// origins. A stale or accidentally mistyped hostname must never receive a
// browser credential grant.
const ownedProductionOrigins = [
  'https://reflexityram.com',
  'https://www.reflexityram.com',
  'https://reflexity-ram-3rn.pages.dev',
];
const configuredAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter((origin) => ownedProductionOrigins.includes(origin));
const allowedOrigins = [...new Set([
  ...ownedProductionOrigins,
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://localhost:3000']),
  ...configuredAllowedOrigins,
])];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        const error = new Error('Request origin not allowed');
        error.status = 403;
        error.publicMessage = 'Request origin not allowed';
        callback(error);
      }
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id', 'x-order-email'],
    exposedHeaders: ['x-session-id'],
  })
);

// ─── Health Check ──────────────────────────────────────────────────────────────
// Keep liveness probes ahead of request rate limiting. Treating repeated
// platform probes as customer traffic can exhaust the global bucket and make a
// healthy instance report HTTP 429.
const healthHandler = (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    stripe: STRIPE_ENABLED ? 'enabled' : 'disabled (no valid key)',
  });
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// ─── Rate Limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MongoRateLimitStore({ prefix: 'global' }),
  // MemoryStore is intentionally fail-closed. A store error must reject the
  // request instead of silently disabling abuse protection.
  passOnStoreError: false,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MongoRateLimitStore({ prefix: 'auth' }),
  passOnStoreError: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

// The phone app's own limits (middleware/phoneLimiters.js), mounted BEFORE the site-wide limiter below.
const deviceLimiter = createDeviceLimiter();
const devicePairLimiter = createPairLimiter();

// An e-Transfer order holds stock without being paid for: a few per hour per IP is plenty for a real buyer.
const etransferLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MongoRateLimitStore({ prefix: 'etransfer' }),
  passOnStoreError: false,
  message: { error: 'Too many orders from this connection. Please try again later or email us.' },
});

// Address suggestions (routes/address.js): typing asks often, so it has its own budget and does not use up the buyer's site-wide one.
// Picking a finished address is the paid lookup: a few per IP per hour, and one daily cap for the whole site so a script cannot spend the credit.
const addressSuggestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MongoRateLimitStore({ prefix: 'addrfind' }),
  passOnStoreError: false,
  message: { error: 'Too many address searches, please type the address instead.' },
});
const addressPickLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MongoRateLimitStore({ prefix: 'addrpick' }),
  passOnStoreError: false,
  message: { error: 'Too many address lookups, please type the address instead.' },
});
const addressDayLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: dailyLookupCap(),
  keyGenerator: () => 'everyone',
  standardHeaders: false,
  legacyHeaders: false,
  store: new MongoRateLimitStore({ prefix: 'addrday' }),
  passOnStoreError: false,
  message: { error: 'Address suggestions are paused for today, please type the address instead.' },
});

// The free provider (Photon) is a public server run for "moderate use": one daily cap on searches for the whole site, so that a script
// cannot get the shop blocked. It only counts while Photon is the provider (the paid provider is capped on finished addresses above).
const photonSearchDayLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: photonDailyCap(),
  keyGenerator: () => 'everyone',
  standardHeaders: false,
  legacyHeaders: false,
  store: new MongoRateLimitStore({ prefix: 'photonday' }),
  passOnStoreError: false,
  message: { error: 'Address suggestions are paused for today, please type the address instead.' },
});

const leadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MongoRateLimitStore({ prefix: 'leads' }),
  passOnStoreError: false,
  message: { error: 'Too many quote requests, please try again later.' },
});

app.use('/api/address/suggest', addressSuggestLimiter, onlyWhenProvider('photon', photonSearchDayLimiter));
// The daily cap on finished addresses guards PAID lookups (Canada Post). A free pick (Photon) only reads our own memory, so it is not
// counted: otherwise anyone could use up the day's picks for every buyer with made-up ids.
app.use('/api/address/retrieve', addressPickLimiter, onlyWhenProvider('canadapost', addressDayLimiter));
app.use('/api/address', createAddressRouter());
app.use('/api/device/pair', devicePairLimiter);
// onPoll: the phone is the one thing that asks often, so it also sweeps unpaid e-Transfer orders (expire / remind).
app.use('/api/device', deviceLimiter, createDeviceRouter({ onPoll: () => sweepEtransferOrdersThrottled() }));

app.use(globalLimiter);

// ─── Body Parsing ──────────────────────────────────────────────────────────────
// Stripe webhook needs raw body — must be registered BEFORE express.json()
if (STRIPE_ENABLED) {
  app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
}
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ─── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/payments/etransfer', etransferLimiter);
app.use('/api/payments', createPaymentsRouter());
app.use('/api/orders', orderRoutes);
app.use('/api/admin/wholesale', adminWholesaleRoutes);
app.use('/api/admin/devices', createAdminDevicesRouter());
app.use('/api/admin', adminRoutes);
app.use('/api/wholesale', wholesaleRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/shipping', shippingRoutes);
app.use('/api/leads', leadLimiter, createLeadRouter());
app.use('/', sitemapRoutes);
app.use('/', feedRoutes);
// The HTTP seed route is development-only. Production data seeding remains an
// explicit operator script (`npm run seed`) and cannot be re-enabled merely by
// adding a secret to the normal web process environment.
if (process.env.NODE_ENV !== 'production' && process.env.SEED_SECRET) {
  app.use('/api/seed', seedRoutes);
}

if (STRIPE_ENABLED && stripeRoutes) {
  app.use('/api/stripe', stripeRoutes);
} else {
  // Stub: returns a clear 503 so the frontend can show a "payments unavailable" message
  // rather than a confusing 404 or crash.
  app.use('/api/stripe', (req, res) => {
    res.status(503).json({
      error: 'Payment processing is not yet configured. Please contact support.',
    });
  });
}

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Error Handler ─────────────────────────────────────────────────────────────
app.use(createErrorHandler());

// ─── Database & Server Start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const startupModels = [
  User,
  Product,
  Cart,
  Order,
  Review,
  ReviewEmailOptOut,
  PageContent,
  RateLimitEntry,
  WholesaleLot,
  WholesaleMediaAsset,
  AdminEvent,
  AdminDevice,
  DevicePairing,
];
const paymentProviderOrderIndexFields = new Set([
  'stripePaymentIntentId',
  'stripeCheckoutSessionId',
]);
const startupIndexDeclarations = (model) => (
  model === Order
    ? model.schema.indexes().filter(([keys]) => (
      Object.keys(keys).every((field) => !paymentProviderOrderIndexFields.has(field))
    ))
    : model.schema.indexes()
);

mongoose
  // Disable implicit index builds so the legacy cart indexes can be upgraded
  // before Mongoose attempts to enforce their new uniqueness options.
  .connect(process.env.MONGODB_URI, { autoIndex: false })
  .then(async () => {
    console.log('✅ MongoDB connected');
    // init() creates fresh collections while autoIndex is disabled. The cart
    // migration then converts legacy owner indexes without dropping them, and
    // ensureIndexes() installs every non-payment index before traffic is
    // accepted. Payment-provider indexes are intentionally managed separately
    // and must not be rewritten as a side effect of an unrelated release.
    await Promise.all(startupModels.map((model) => model.init()));
    await ensureCartOwnershipIndexes();
    await Promise.all(startupModels.map((model) => model.ensureIndexes({
      toCreate: startupIndexDeclarations(model),
    })));
    console.log(`✅ MongoDB indexes ready (${startupModels.length} models)`);
    // Read-only: the unique payment indexes are deliberately not built here (see above), but the duplicate-order guard depends on them, so say whether they exist.
    try {
      const orderIndexes = await Order.collection.indexes();
      const hasUnique = (field) => orderIndexes.some((ix) => ix.unique && Object.keys(ix.key || {}).length === 1 && ix.key[field] !== undefined);
      const missingUnique = [...paymentProviderOrderIndexFields].filter((field) => !hasUnique(field));
      if (missingUnique.length) console.error(`🚨 Order collection has NO unique index on: ${missingUnique.join(', ')} (duplicate-fulfilment protection relies on it)`);
      else console.log('✅ Order payment-id unique indexes present');
    } catch (indexErr) {
      console.warn('Order index check failed:', indexErr.message);
    }
    try {
      await fixMerchantProductData();
    } catch (err) {
      // Do not take the store offline for a non-critical data normalization.
      console.error('Merchant product normalization failed:', err.message);
    }
    if (STRIPE_ENABLED) {
      try {
        const currencySync = await syncActiveProductPrices();
        console.log(
          `Stripe currency sync: ${currencySync.synced}/${currencySync.matched} active listing(s) in ${currencySync.currency.toUpperCase()}`,
        );
        if (currencySync.failed.length > 0) {
          console.warn(`Stripe currency sync left ${currencySync.failed.length} listing(s) unsynced`);
        }
      } catch (err) {
        // Checkout still retries each item lazily through ensureStripePrice.
        console.error('Stripe currency sync failed:', err.message);
      }
    }
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`   Stripe: ${STRIPE_ENABLED ? 'enabled' : 'disabled'}`);
    });
    // The jobs that must not depend on GitHub's thinned-out schedule: expire/remind unpaid e-Transfer orders, follow tracked parcels
    // (mark shipped on Canada Post's first scan, mark delivered, email the buyer) and resend a failed "shipped" email for a parcel
    // sent without tracking. Each throttles itself to its own interval and never
    // throws; they run a minute after a start (a deploy restarts the server) and then every five minutes while the server is awake.
    if (process.env.NODE_ENV !== 'test') {
      const backgroundJobs = () => {
        sweepEtransferOrdersThrottled().catch(() => {});
        syncShippedOrdersThrottled().catch(() => {});
        retryUntrackedShipmentNoticesThrottled().catch(() => {});
      };
      setTimeout(backgroundJobs, 60 * 1000).unref();
      setInterval(backgroundJobs, 5 * 60 * 1000).unref();
    }
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

module.exports = app;
