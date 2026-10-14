// ─── Stripe Product/Price sync ─────────────────────────────────────────────────
// Every store product maps to one Stripe Product and one ACTIVE Stripe Price,
// stored on the document as stripeProductId / stripePriceId. Checkout Sessions
// are built from these Price IDs (never ad-hoc price_data), per store policy.
//
// Stripe Prices are immutable: when the product's price changes, we create a
// new Price, point the product at it, and archive the old one.
//
// tax_behavior 'exclusive': listed prices are pre-tax. The shop charges no tax today (the session sends no automatic_tax, see
// routes/stripe.js), so this only matters the day STRIPE_AUTOMATIC_TAX is switched on: Stripe Tax then adds the destination tax
// (e.g. Ontario HST 13%) on top at checkout.

const { CURRENCY } = require('../config/shipping');

const STRIPE_ENABLED =
  process.env.STRIPE_SECRET_KEY &&
  (process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') ||
    process.env.STRIPE_SECRET_KEY.startsWith('sk_live_'));

const stripe = STRIPE_ENABLED ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

/**
 * Ensure `product` (a Mongoose Product doc) has a Stripe Product and an
 * active Stripe Price matching its current price. Saves IDs back to the doc.
 * Returns the active stripePriceId, or null if Stripe isn't configured.
 */
const ensureStripePrice = async (product) => {
  if (!stripe) return null;

  const amount = Math.round(product.price * 100);

  // 1. Ensure the Stripe Product exists
  if (!product.stripeProductId) {
    const stripeProduct = await stripe.products.create({
      name: product.name,
      description: product.description || undefined,
      images: product.images?.[0]?.url ? [product.images[0].url] : undefined,
      metadata: {
        slug: product.slug,
        sku: product.sku,
        productId: product._id.toString(),
      },
    });
    product.stripeProductId = stripeProduct.id;
  }

  // 2. Ensure the active Price matches the current amount AND currency.
  // Currency matters: if STRIPE_CURRENCY flips (usd → cad), an old-currency
  // Price would remain active while shipping options use the new currency,
  // and Stripe rejects mixed-currency Checkout Sessions.
  const priceChanged = product.stripePriceAmount !== amount;
  const currencyChanged = product.stripePriceCurrency !== CURRENCY;
  if (!product.stripePriceId || priceChanged || currencyChanged) {
    const oldPriceId = product.stripePriceId;

    const stripePrice = await stripe.prices.create({
      product: product.stripeProductId,
      unit_amount: amount,
      currency: CURRENCY,
      tax_behavior: 'exclusive',
      metadata: { slug: product.slug },
    });

    product.stripePriceId = stripePrice.id;
    product.stripePriceAmount = amount;
    product.stripePriceCurrency = CURRENCY;

    // Archive the superseded price (non-fatal if it fails)
    if (oldPriceId) {
      try {
        await stripe.prices.update(oldPriceId, { active: false });
      } catch (err) {
        console.warn(`Could not archive old Stripe price ${oldPriceId}:`, err.message);
      }
    }
  }

  await product.save();
  return product.stripePriceId;
};

/**
 * Keep Stripe Product display fields (name/description/image) fresh after
 * an admin edit. Non-fatal — checkout works off the Price ID regardless.
 */
const syncStripeProductDetails = async (product) => {
  if (!stripe || !product.stripeProductId) return;
  try {
    await stripe.products.update(product.stripeProductId, {
      name: product.name,
      description: product.description || undefined,
      images: product.images?.[0]?.url ? [product.images[0].url] : undefined,
    });
  } catch (err) {
    console.warn(`Stripe product detail sync failed for ${product.slug}:`, err.message);
  }
};

// The coupon behind the bank-debit discount: one reusable percent-off coupon per percentage, created the first time it is
// needed (id rfx-bank-debit-1pct, 1.5% -> rfx-bank-debit-1p5pct). Stripe applies it to the goods only, never the shipping.
const bankDebitCouponId = (pct) => `rfx-bank-debit-${String(pct).replace('.', 'p')}pct`;

const ensureBankDebitCoupon = async (pct) => {
  if (!stripe) return null;
  const id = bankDebitCouponId(pct);
  try {
    const found = await stripe.coupons.retrieve(id);
    if (found?.valid !== false) return found.id;
  } catch (err) {
    if (err?.code !== 'resource_missing' && err?.statusCode !== 404) throw err;
  }
  try {
    const created = await stripe.coupons.create({
      id,
      percent_off: pct,
      duration: 'once',
      name: `Bank debit discount (${pct}%)`,
      metadata: { purpose: 'bank-debit-discount' },
    });
    return created.id;
  } catch (err) {
    if (err?.code === 'resource_already_exists') return id;   // another request made it first
    throw err;
  }
};

module.exports = { ensureStripePrice, syncStripeProductDetails, ensureBankDebitCoupon, bankDebitCouponId, STRIPE_ENABLED };
