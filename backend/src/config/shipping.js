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

// Bigger orders ship in a bigger box. Owner's rule (2026-10-05): 1–2 sticks
// ship for the standard $14, 3 or more sticks for $25 (Canada Post, tracked).
const LARGE_ORDER_MIN_STICKS = 3;
const LARGE_ORDER_SHIPPING_PRICE = 25;

// A product may still carry its own rate (`shippingPrice`, set in the admin
// product form), which replaces the stick-count rate for that product.
// SECURITY: rates come from the product documents on the server, never from
// the client.
const STANDARD_SHIPPING_PRICE = SHIPPING_OPTIONS.standard.price;

const ownShippingPrice = (product) => {
  const raw = product?.shippingPrice;
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

// One stick on its own (the product page, the Google feed).
const shippingPriceForProduct = (product) => ownShippingPrice(product) ?? STANDARD_SHIPPING_PRICE;

// A whole cart, as [{ product, qty }]: 3+ sticks in total pay the large-order
// rate, a product with its own rate charges that instead, and the cart pays the
// HIGHEST of these, never the sum.
const resolveCartShippingPrice = (lines = []) => {
  if (!lines.length) return STANDARD_SHIPPING_PRICE;
  const sticks = lines.reduce((total, line) => total + Math.max(0, Number(line.qty) || 0), 0);
  const stickRate = sticks >= LARGE_ORDER_MIN_STICKS ? LARGE_ORDER_SHIPPING_PRICE : STANDARD_SHIPPING_PRICE;
  return lines.reduce((highest, line) => Math.max(highest, ownShippingPrice(line.product) ?? stickRate), 0);
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

// ─── Outside Canada ────────────────────────────────────────────────────────────
// Buyers pay what Canada Post charges for their country, quoted live by the
// Rating API (utils/internationalShipping.js). Only tracked services.
const INTERNATIONAL_SERVICES = {
  'INT.TP': 'Tracked Packet – International',
  'INT.XP': 'Xpresspost – International (guaranteed)',
  'INT.PW.PARCEL': 'Priority Worldwide',
};
// Countries website checkout ships to: where Canada Post quotes Tracked Packet
// or Xpresspost (both with delivery confirmation) at our commercial rate, from
// a live Rating API sweep of every country on 2026-10-05. Elsewhere Canada Post
// offers only services without delivery confirmation (International Parcel,
// Small Packet) or refuses parcels (error 9111: the EU parcel suspension in
// AT BE CZ DE DK FI FR LU PT, plus HT, LY, PS, SD, SO, SS, YE and others), so
// those buyers email us. Not listed on purpose: CA (flat rates) and the US
// (duties must be prepaid). Re-run the sweep when Canada Post changes service.
const INTERNATIONAL_COUNTRIES = [
  'AE', 'AL', 'AR', 'AU', 'BB', 'BR', 'BS', 'BZ', 'CH', 'CL', 'CN', 'CO', 'CR',
  'CW', 'CY', 'DZ', 'EC', 'EE', 'ES', 'ET', 'GB', 'GD', 'GR', 'GY', 'HK', 'HR',
  'HU', 'ID', 'IE', 'IL', 'IN', 'IS', 'IT', 'JM', 'JP', 'KE', 'KN', 'KR', 'KY',
  'LB', 'LC', 'LI', 'LK', 'LT', 'LV', 'MA', 'MC', 'MO', 'MT', 'MU', 'MX', 'MY',
  'NL', 'NO', 'NZ', 'PH', 'PL', 'RO', 'RS', 'SA', 'SE', 'SG', 'SI', 'SK', 'SM',
  'SV', 'SX', 'TH', 'TR', 'TT', 'TW', 'UA', 'VN',
];
// Parcel used for quotes, by stick count: modules in ESD bags in a padded box.
const parcelForSticks = (sticks) => {
  if (sticks <= 2) return { weight: 0.4, dimensions: { length: 23, width: 15, height: 5 } };
  if (sticks <= 6) return { weight: 0.9, dimensions: { length: 30, width: 23, height: 8 } };
  return { weight: Math.round((0.6 + 0.12 * sticks) * 10) / 10, dimensions: { length: 35, width: 25, height: 12 } };
};
// Postal code parcels are mailed from (Canada Post format, no space).
const SHIP_FROM_POSTAL_CODE = (process.env.CANADA_POST_ORIGIN_POSTAL_CODE || 'M5H2N2').replace(/\s+/g, '').toUpperCase();

// Build Stripe Checkout `shipping_options` from the same table the rest of
// the app uses, so display prices and charged prices can never diverge.
// tax_behavior 'exclusive': Stripe Tax adds tax on top of shipping where the
// destination province taxes shipping (most Canadian provinces do).
// `price` is the cart's rate from resolveCartShippingPrice; omit it for the
// standard rate.
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
  LARGE_ORDER_MIN_STICKS,
  LARGE_ORDER_SHIPPING_PRICE,
  getShippingOption,
  shippingPriceForProduct,
  resolveCartShippingPrice,
  CURRENCY,
  ALLOWED_SHIPPING_COUNTRIES,
  toStripeShippingOptions,
  INTERNATIONAL_SERVICES,
  INTERNATIONAL_COUNTRIES,
  parcelForSticks,
  SHIP_FROM_POSTAL_CODE,
};
