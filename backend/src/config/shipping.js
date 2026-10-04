// ─── Shipping options — single source of truth ─────────────────────────────────
// SECURITY: Shipping prices must NEVER be accepted from the client.
// The frontend sends only the option `id`; the server looks up the price here.
// Keep the delivery wording in the storefront and saved shipping policy in sync.

const SHIPPING_OPTIONS = {
  standard: { id: 'standard', label: 'Flat-Rate Shipping (delivery 3–6 business days after dispatch)', price: 14, minDays: 3, maxDays: 6 },
};

const getShippingOption = (id) => SHIPPING_OPTIONS[id] || null;

// Business days between payment and dispatch. Keep in sync with the saved
// shipping policy ("processed and shipped within 1–3 business days") and with
// the Google Merchant Center shipping service.
const HANDLING_DAYS = { min: 1, max: 3 };

// Some lots cost more to ship than the standard flat rate (heavier, bulkier, or
// higher-value packaging). Those products carry a `shippingPrice` override; the
// rest ship at the standard rate. A cart is charged the HIGHEST rate it
// contains — never the sum — so adding a normal stick to an expensive lot can
// never increase the buyer's shipping.
// SECURITY: overrides come from the product documents on the server, never from
// the client.
const STANDARD_SHIPPING_PRICE = SHIPPING_OPTIONS.standard.price;

const shippingPriceForProduct = (product) => {
  const raw = product?.shippingPrice;
  if (raw === undefined || raw === null || raw === '') return STANDARD_SHIPPING_PRICE;
  const override = Number(raw);
  return Number.isFinite(override) && override >= 0 ? override : STANDARD_SHIPPING_PRICE;
};

const resolveCartShippingPrice = (products = []) => {
  if (!products.length) return STANDARD_SHIPPING_PRICE;
  return products.reduce((highest, product) => Math.max(highest, shippingPriceForProduct(product)), 0);
};

// Store currency for Stripe (lowercase ISO). CAD is the storefront default;
// deployments can still override it explicitly when required.
const CURRENCY = (process.env.STRIPE_CURRENCY || 'cad').toLowerCase();

// Countries website checkout ships to, enforced by Stripe's hosted checkout.
// US orders were paused 2026-10-04: every US parcel now needs a duties-paid
// customs label, and the US had no add-to-carts in 90 days. US buyers email
// for a quote, like other international orders. Re-adding 'US' here also needs
// the policy pages, the edge JSON-LD and the Merchant Center settings.
const ALLOWED_SHIPPING_COUNTRIES = ['CA'];

// Build Stripe Checkout `shipping_options` from the same table the rest of
// the app uses, so display prices and charged prices can never diverge.
// tax_behavior 'exclusive': Stripe Tax adds tax on top of shipping where the
// destination province taxes shipping (most Canadian provinces do).
// `price` overrides the standard rate for this session (see
// resolveCartShippingPrice); omit it for the standard rate.
// No `delivery_estimate`: the label already states the delivery time, and
// Stripe would print the estimate a second time after it ("... after
// dispatch) (3-6 business days)").
const toStripeShippingOptions = (price) =>
  Object.values(SHIPPING_OPTIONS).map((opt) => ({
    shipping_rate_data: {
      type: 'fixed_amount',
      display_name: opt.label,
      fixed_amount: {
        amount: Math.round((Number.isFinite(Number(price)) ? Number(price) : opt.price) * 100),
        currency: CURRENCY,
      },
      tax_behavior: 'exclusive',
      metadata: { optionId: opt.id },
    },
  }));

module.exports = {
  SHIPPING_OPTIONS,
  HANDLING_DAYS,
  STANDARD_SHIPPING_PRICE,
  getShippingOption,
  shippingPriceForProduct,
  resolveCartShippingPrice,
  CURRENCY,
  ALLOWED_SHIPPING_COUNTRIES,
  toStripeShippingOptions,
};
