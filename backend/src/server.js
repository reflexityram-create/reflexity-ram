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
const seedRoutes = require('./routes/seed');
const sitemapRoutes = require('./routes/sitemap');
const feedRoutes = require('./routes/feed');
const reviewRoutes = require('./routes/reviews');
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
const PageContent = require('./models/PageContent');
const RateLimitEntry = require('./models/RateLimitEntry');
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
app.use('/api/orders', orderRoutes);
app.use('/api/admin/wholesale', adminWholesaleRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/wholesale', wholesaleRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/pages', pageRoutes);
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
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({
    error: err.publicMessage
      || (process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message),
  });
});

// ─── Database & Server Start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const startupModels = [
  User,
  Product,
  Cart,
  Order,
  Review,
  PageContent,
  RateLimitEntry,
  WholesaleLot,
  WholesaleMediaAsset,
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
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

module.exports = app;
