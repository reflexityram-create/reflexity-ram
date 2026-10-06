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

// Countries the flat-rate (Canada) checkout ships to, enforced by Stripe's hosted checkout. Other countries have
// their own sessions: see INTERNATIONAL_COUNTRIES below and the United States block after it.
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
// ─── United States ─────────────────────────────────────────────────────────────
// Paused 2026-10-04, back 2026-10-06. Since 2025-08-29 every US parcel needs its duties prepaid before it crosses: Canada
// Post will not print a US label without a duties-paid Declaration ID. The shop's Zonos Verified Account pays US Customs
// when the label is made and bills the owner's card; the buyer reimburses exactly that at checkout (utils/zonos.js
// quotes it live: on 2026-10-06 a $135 stick came to $44.31, mostly the 25% Section 232 semiconductor tariff, and a
// China-made one twice that). It travels inside the shipping rate, never as a line item, so a promotion code cannot
// discount it and the order's subtotal stays the goods.
// Shipping is Canada Post Tracked Packet USA at the commercial rate. It costs the same to every ZIP (16 sampled ZIPs,
// Alaska and Hawaii included, 2026-10-06: $16.70 for the 0.4 kg box, $24.72 for 0.9 kg, $30.37 at 2 kg), so one live
// quote with a fixed ZIP prices any buyer, and it stops at 2 kg: 12 sticks in the boxes parcelForSticks picks.
const US_SERVICE_CODE = 'USA.TP';
const US_SERVICE_NAME = 'Tracked Packet – USA';
const US_RATING_ZIP = '10001';
const US_MAX_STICKS = 12;

// ─── Faster shipping inside Canada ─────────────────────────────────────────────
// The flat rate above stays the default. A buyer can pay a FLAT extra for Canada Post Xpresspost
// (tracked, typically 1–3 business days after dispatch): no postal code, no quote, instant.
// Owner's idea (2026-10-05): "pay more, faster ship, so I make more", and no live prices for Canadian
// buyers to pick from. Why +$12 and why only up to 6 sticks, from real Canada Post COMMERCIAL prices
// (2026-10-05, from M1P3T7 to 14 cities, population-weighted, before tax):
//   0.4 kg box (1-2 sticks): Xpresspost costs about $1.40 more than the Expedited Parcel the flat rate
//     ships with (worst city +$6): +$12 earns about $8 on average and loses on ~1% of buyers.
//   0.9 kg box (3-6 sticks): about $5 more (worst city +$21): +$12 earns about $13 on average but loses
//     up to $9 in BC, Newfoundland and the territories.
//   2 kg and up: Xpresspost to Vancouver is $52 (and $67 at 4 kg) against $25 for a parcel, so a flat
//     extra loses money in the west: Faster is not offered above 6 sticks (those buyers email us).
// The flat $25 itself stays profitable for big orders: Canada Post's parcel price barely moves with
// weight here (about $19 average at 1-2.5 kg, $21 at 4 kg), so no extra tier is needed for those.
const FASTER_SHIPPING_UPCHARGE = 12;
const FASTER_SHIPPING_MAX_STICKS = 6;
const FASTER_SHIPPING_LABEL = 'Faster shipping: Xpresspost, typically 1–3 business days after dispatch';
// The slowest Xpresspost standard seen in any lane (Yellowknife); used for the survey date Google emails from.
const FASTER_SHIPPING_TRANSIT_DAYS = 3;
// Canada Post's Signature option: $2.00 in every lane quoted (Toronto, Vancouver, St. John's, ...).
const SIGNATURE_PRICE = 2;

const stickCount = (lines) => lines.reduce((total, line) => total + Math.max(0, Number(line.qty) || 0), 0);

// Faster shipping for a cart, as [{ product, qty }]: the cart's flat rate plus the flat extra, or null
// when it is not offered (empty cart, or more than FASTER_SHIPPING_MAX_STICKS sticks).
const resolveFasterShippingPrice = (lines = []) => {
  if (!lines.length || stickCount(lines) > FASTER_SHIPPING_MAX_STICKS) return null;
  return resolveCartShippingPrice(lines) + FASTER_SHIPPING_UPCHARGE;
};

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
  US_SERVICE_CODE,
  US_SERVICE_NAME,
  US_RATING_ZIP,
  US_MAX_STICKS,
  parcelForSticks,
  SHIP_FROM_POSTAL_CODE,
  FASTER_SHIPPING_UPCHARGE,
  FASTER_SHIPPING_MAX_STICKS,
  FASTER_SHIPPING_LABEL,
  FASTER_SHIPPING_TRANSIT_DAYS,
  SIGNATURE_PRICE,
  resolveFasterShippingPrice,
};
