const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { optionalAuth } = require('../middleware/auth');
const { sendOrderConfirmationEmail } = require('../utils/email');
const {
  toStripeShippingOptions,
  resolveCartShippingPrice,
  ALLOWED_SHIPPING_COUNTRIES,
  CURRENCY,
  SHIPPING_OPTIONS,
  FASTER_SHIPPING_LABEL,
  FASTER_SHIPPING_TRANSIT_DAYS,
  SIGNATURE_PRICE,
  resolveFasterShippingPrice,
} = require('../config/shipping');
const { analyticsOrder } = require('../utils/analyticsOrder');
const { INTERNATIONAL_COUNTRIES, US_SERVICE_CODE } = require('../config/shipping');
const { internationalOptions, optionLabel } = require('../utils/internationalShipping');
const { quoteUnitedStates, UsCheckoutError } = require('../utils/usCheckout');
const { isServerPurchaseTrackingEnabled, sanitizeAnalyticsIds } = require('../utils/ga4');
const { reportPaidOrderToGa4 } = require('../utils/purchaseAnalytics');
const { decrementStockForOrder, shouldDecrementStockForFulfillment } = require('../utils/stock');
const { ensureStripePrice } = require('../utils/stripeSync');
const { isDisposableEmail } = require('../utils/disposableEmail');
const { isFullyRefundedCharge } = require('../utils/refunds');
const { cancelReviewRequest } = require('../utils/reviewRequests');
const { estimateDeliveryDate } = require('../utils/deliveryEstimate');

const { validGuestSessionId } = require('../utils/guestSession');
const { resolveCartLines } = require('../utils/cartLines');

const router = express.Router();

// Stripe's hosted page takes its name from the Stripe account's public business
// name (Stripe dashboard > Settings > Public details, set to "ReflexityRam" on
// 2026-10-04), the same name receipts use. The account's own branding (icon,
// colours) is empty, so without these Stripe shows a generic icon and its
// default blue button.
const CHECKOUT_BRANDING = {
  button_color: '#ffcf24', // --brand-yellow in frontend/src/index.css
  icon: { type: 'url', url: 'https://reflexityram.com/brand/stripe-checkout-icon.png' },
};

let checkoutPriceEnsurer = ensureStripePrice;
let checkoutSessionCreator = (payload) => stripe.checkout.sessions.create(payload);
let checkoutSessionRetriever = (sessionId, options) => stripe.checkout.sessions.retrieve(sessionId, options);
let stockDecrementer = decrementStockForOrder;

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKOUT SESSIONS (primary checkout flow)
// Cart → line_items (Stripe Price IDs from the DB) → hosted Stripe Checkout.
// Stripe collects the shipping address (CA/US only — it renders the right
// form per country: Province/Postal for Canada, State/ZIP for the US), phone,
// and email, applies Stripe Tax, and the webhook fulfills the order.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/stripe/create-checkout-session ──────────────────────────────────
router.post('/create-checkout-session', optionalAuth, async (req, res) => {
  try {
    // Validated like cart.js and auth.js do: cookie-parser turns a `j:{...}` cookie into an OBJECT, which would reach the query below as operators.
    const sessionId = validGuestSessionId(req.headers['x-session-id'] || req.cookies?.cartSessionId);
    const userId = req.user?._id;

    if (!userId && !sessionId) {
      return res.status(400).json({ error: 'Session ID required for guest checkout' });
    }

    const filter = userId ? { user: userId } : { sessionId };
    const cart = await Cart.findOne(filter);

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // The same lines the cart page shows (found by product id, so a slug edit cannot drop one): utils/cartLines.js.
    const eligibleItems = await resolveCartLines(cart.items);
    if (eligibleItems.length === 0) {
      return res.status(400).json({ error: 'Cart has no purchasable Server RAM' });
    }

    // ── Build line_items from DB-stored Stripe Price IDs ──────────────────────
    const lineItems = [];
    // What the session actually charges for: the stick count and the products'
    // own rates (server-side, never anything the client sent) set the shipping.
    const shippingLines = [];
    for (const { item, product } of eligibleItems) {
      if (product.stockQuantity <= 0 || product.stock === 'out') {
        return res.status(400).json({ error: `"${product.name}" is out of stock` });
      }
      if (item.qty > product.stockQuantity) {
        return res.status(400).json({
          error: `Only ${product.stockQuantity} units of "${product.name}" available`,
        });
      }

      // Lazy sync: guarantees a current Price ID even if admin-time sync failed
      // or the price changed without a re-sync.
      const priceId = await checkoutPriceEnsurer(product);
      if (!priceId) {
        return res.status(503).json({ error: 'Payment processing is not configured.' });
      }

      lineItems.push({ price: priceId, quantity: item.qty });
      shippingLines.push({ product, qty: item.qty });
    }

    // ── Where it ships: Canada (flat rates), the United States (Tracked Packet USA plus the
    // prepaid import duties, both worked out here) or another country (the Canada Post
    // price for the service the buyer picked, re-quoted here, never taken from
    // the client). ──────────────────────────────────────────────────────────
    const country = String(req.body?.shipping?.country || 'CA').toUpperCase();
    let shippingOptions = toStripeShippingOptions(resolveCartShippingPrice(shippingLines));
    let allowedCountries = ALLOWED_SHIPPING_COUNTRIES;
    let internationalService;
    let usQuote;
    if (country === 'US') {
      try {
        usQuote = await quoteUnitedStates({ lines: shippingLines });
      } catch (err) {
        if (err instanceof UsCheckoutError) return res.status(err.status).json({ error: err.publicMessage });
        throw err;
      }
      if (req.body?.shipping?.serviceCode !== usQuote.service.serviceCode) return res.status(400).json({ error: 'Choose a shipping option again.' });
      // The duties ride inside the shipping rate: a promotion code only ever discounts goods, and the order's
      // subtotal stays the goods. The label spells it out because Stripe's page shows only this one line.
      shippingOptions = [{
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: `${optionLabel(usQuote.service)} + prepaid US import duties and fees`,
          fixed_amount: { amount: Math.round(usQuote.total * 100), currency: CURRENCY },
          tax_behavior: 'exclusive',
          metadata: {
            canadaPostService: usQuote.service.serviceCode,
            country: 'US',
            usShippingCad: usQuote.service.price.toFixed(2),
            usDutiesCad: usQuote.duties.total.toFixed(2),
          },
        },
      }];
      allowedCountries = ['US'];
    } else if (country !== 'CA') {
      if (!INTERNATIONAL_COUNTRIES.includes(country)) {
        return res.status(400).json({ error: 'Website checkout does not ship there. Email us for a quote.' });
      }
      const sticks = shippingLines.reduce((n, line) => n + line.qty, 0);
      const options = await internationalOptions({ country, sticks });
      internationalService = options.find((o) => o.serviceCode === req.body?.shipping?.serviceCode);
      if (!internationalService) return res.status(400).json({ error: 'Choose a shipping option again.' });
      shippingOptions = [{
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: optionLabel(internationalService),
          fixed_amount: { amount: Math.round(internationalService.price * 100), currency: CURRENCY },
          tax_behavior: 'exclusive',
          metadata: { canadaPostService: internationalService.serviceCode, country },
        },
      }];
      allowedCountries = [country];
    }

    // ── Inside Canada: the flat rate, optionally with Faster shipping (Xpresspost for a flat
    // extra) and/or a signature on delivery. Both are only yes/no choices: every price is
    // worked out here from the cart, never taken from the client. ─────────────────────────
    let canadaChoice;
    const requestedShipping = req.body?.shipping || {};
    if (country === 'CA') {
      // A page opened before the flat options went live still sends a postal code and a service.
      if (requestedShipping.serviceCode || requestedShipping.postalCode) {
        return res.status(400).json({ error: 'Delivery options were updated. Please reload the page and choose again.' });
      }
      const wantsFaster = requestedShipping.faster === true;
      const wantsSignature = requestedShipping.signature === true;
      if (wantsFaster || wantsSignature) {
        const fasterPrice = resolveFasterShippingPrice(shippingLines);
        if (wantsFaster && fasterPrice === null) {
          return res.status(400).json({ error: 'Faster shipping is not offered on an order this size. Email us and we will arrange it.' });
        }
        const amount = (wantsFaster ? fasterPrice : resolveCartShippingPrice(shippingLines)) + (wantsSignature ? SIGNATURE_PRICE : 0);
        const label = `${wantsFaster ? FASTER_SHIPPING_LABEL : SHIPPING_OPTIONS.standard.label}${wantsSignature ? ' + signature on delivery' : ''}`;
        shippingOptions = [{
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: label,
            fixed_amount: { amount: Math.round(amount * 100), currency: CURRENCY },
            tax_behavior: 'exclusive',
            metadata: { canadaPostService: wantsFaster ? 'DOM.XP' : 'STANDARD', signature: wantsSignature ? 'yes' : 'no', country: 'CA' },
          },
        }];
        canadaChoice = { faster: wantsFaster, signature: wantsSignature };
      }
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://reflexityram.com';
    // GA identifiers let the server attribute the purchase to the buyer's browsing
    // session. They are optional, untrusted, and validated before use.
    const gaIds = sanitizeAnalyticsIds(req.body?.analytics);

    const session = await checkoutSessionCreator({
      mode: 'payment',
      line_items: lineItems,
      // Not on US orders: the duties are priced on the goods' full value, and a discount would leave the buyer paying duty on money they never paid.
      allow_promotion_codes: !usQuote,
      branding_settings: CHECKOUT_BRANDING,

      // ── Shipping: Canada + US only. Stripe renders the country-appropriate
      // address form (Province/Postal code vs State/ZIP) automatically. ──────
      shipping_address_collection: { allowed_countries: allowedCountries },
      shipping_options: shippingOptions,
      ...(internationalService ? {
        custom_text: {
          shipping_address: { message: 'Import taxes and duties are charged by your country on delivery and are not included in this total.' },
        },
      } : {}),
      ...(usQuote ? {
        custom_text: {
          shipping_address: { message: 'US import duties and customs fees are prepaid in the shipping charge below. Nothing more to pay on delivery.' },
        },
      } : {}),
      phone_number_collection: { enabled: true },
      billing_address_collection: 'auto',

      // ── Stripe Tax ─────────────────────────────────────────────────────────
      // Canadian tax (HST/GST/PST by province) is calculated from the shipping
      // address — requires a Canada tax registration in the Stripe dashboard.
      // US customers: with no US registrations added, Stripe Tax charges $0.
      // To collect US tax later (if nexus is established), add the state
      // registrations in Stripe — no code change needed.
      automatic_tax: { enabled: true },

      customer_email: req.user?.email || undefined,
      client_reference_id: userId ? userId.toString() : sessionId,
      metadata: {
        userId: userId ? userId.toString() : 'guest',
        cartSessionId: sessionId || '',
        ...(internationalService ? {
          shippingCountry: country,
          canadaPostService: internationalService.serviceCode,
          ...(internationalService.transitDays ? { canadaPostTransitDays: String(internationalService.transitDays) } : {}),
        } : {}),
        ...(usQuote ? {
          shippingCountry: 'US',
          canadaPostService: usQuote.service.serviceCode,
          ...(usQuote.service.transitDays ? { canadaPostTransitDays: String(usQuote.service.transitDays) } : {}),
          usShippingCad: usQuote.service.price.toFixed(2),
          usDutiesCad: usQuote.duties.total.toFixed(2),
          ...(usQuote.duties.quoteId ? { zonosLandedCostId: usQuote.duties.quoteId.slice(0, 80) } : {}),
        } : {}),
        ...(canadaChoice ? {
          shippingCountry: 'CA',
          canadaPostService: canadaChoice.faster ? 'DOM.XP' : 'STANDARD',
          signature: canadaChoice.signature ? 'yes' : 'no',
          ...(canadaChoice.faster ? { canadaPostTransitDays: String(FASTER_SHIPPING_TRANSIT_DAYS) } : {}),
        } : {}),
        ...(gaIds.clientId ? { gaClientId: gaIds.clientId } : {}),
        ...(gaIds.sessionId ? { gaSessionId: gaIds.sessionId } : {}),
      },

      success_url: `${frontendUrl}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/cart`,
      // No expires_at: Stripe's default keeps the session open for 24 hours, its
      // maximum. Stock is only taken at fulfillment, so an open session holds
      // nothing; a 30-minute window cut off a real buyer mid bank verification.
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Checkout session error:', err);
    res.status(500).json({ error: 'Failed to start checkout' });
  }
});

// ─── Fulfillment: convert a paid Checkout Session into an Order, exactly once ──
// Called from BOTH the webhook (checkout.session.completed) and the success
// page fallback (GET /session-status). The unique index on
// stripeCheckoutSessionId makes this safe to call any number of times.
// The buyer paid for a specific Canada Post service (and maybe a signature). The label has to match what was
// charged, so say so on the order where the owner makes the label. Plain flat-rate orders need no note.
// Canada Post service codes the checkout can sell, as the owner knows them when making the label (an unknown code is shown as it is).
const SERVICE_NAMES = {
  'DOM.XP': 'Xpresspost',
  'USA.TP': 'Tracked Packet – USA', 'USA.EP': 'Expedited Parcel USA', 'USA.XP': 'Xpresspost USA',
  'INT.TP': 'Tracked Packet – International', 'INT.XP': 'Xpresspost International',
  'INT.IP.AIR': 'International Parcel Air', 'INT.SP.AIR': 'Small Packet International Air',
};
const shippingChoiceNote = (metadata = {}, label) => {
  const service = metadata.canadaPostService;
  const signature = metadata.signature === 'yes';
  if (!signature && (!service || service === 'STANDARD')) return null;
  const extras = [];
  if (service && service !== 'STANDARD') extras.push(`buy ${SERVICE_NAMES[service] || service}`);
  if (signature) extras.push('add the Signature option');
  return `SHIPPING: the buyer paid for "${label}". When you make the label, ${extras.join(' and ')}.`;
};

// A US order's shipping charge includes the prepaid import duties (see create-checkout-session). The session metadata says
// how much of it is duties; refuse anything that does not fit inside what was actually charged for shipping.
const usDutiesFrom = (metadata = {}, shippingCharged = 0) => {
  if (metadata.shippingCountry !== 'US') return null;
  const duties = Math.round(Number(metadata.usDutiesCad) * 100) / 100;
  if (!Number.isFinite(duties) || duties <= 0 || duties > shippingCharged + 0.005) return null;
  return { duties, quoteId: String(metadata.zonosLandedCostId || '').slice(0, 80) };
};
const usOrderNote = (usDuties) => (usDuties
  ? `US ORDER: the buyer prepaid US import duties and fees of $${usDuties.duties.toFixed(2)} CAD inside the shipping charge${usDuties.quoteId ? ` (Zonos quote ${usDuties.quoteId})` : ''}. Make the label in Snap Ship with the Zonos duties-paid option: Zonos pays US Customs and bills your card. Declare each item's country of origin and HS code (the customs panel on this order lists them).`
  : null);

const ensureCriticalFulfillmentEffects = async (order) => {
  if (!order) return order;

  // Recovery path: if the order row exists but the process crashed before the
  // stock decrement, a Stripe retry or success-page check must still be able to
  // complete that critical side effect. decrementStockForOrder is idempotent and
  // atomically guarded by order.stockDecremented, so this is safe during races.
  if (shouldDecrementStockForFulfillment(order)) {
    await decrementStockForOrder(order);
  }

  // Retry the GA4 purchase if an earlier attempt failed (no-op once reported).
  await reportPaidOrderToGa4(order, { currency: CURRENCY });

  return order;
};

const fulfillCheckoutSession = async (checkoutSessionId) => {
  // Fast path: order already exists. Still verify critical side effects so a
  // retry can recover if the first process crashed after Order.create().
  const existing = await Order.findOne({ stripeCheckoutSessionId: checkoutSessionId });
  if (existing) return ensureCriticalFulfillmentEffects(existing);

  // shipping_cost.shipping_rate is only an ID unless it is expanded; without it every order read "Standard Shipping" (the label below).
  const session = await checkoutSessionRetriever(checkoutSessionId, {
    expand: ['line_items.data.price.product', 'payment_intent', 'shipping_cost.shipping_rate'],
  });

  // Only fulfill paid sessions (async payment methods stay 'unpaid' until later)
  if (session.payment_status !== 'paid') return null;

  // ── Map Stripe line items back to our products via stored Price IDs ────────
  const orderItems = [];
  const unmappedPrices = [];   // paid line items no product could be found for: the buyer was charged, so the order must say so
  for (const li of session.line_items.data) {
    const product = await Product.findOne({ stripePriceId: li.price.id });
    if (!product) {
      // Fallback: match by metadata slug set during sync
      const slug = li.price.product?.metadata?.slug;
      const bySlug = slug ? await Product.findOne({ slug }) : null;
      if (!bySlug) {
        console.error(`Fulfillment: no product for Stripe price ${li.price.id}`);
        unmappedPrices.push(li.price.id);
        continue;
      }
      orderItems.push({
        product: bySlug._id, slug: bySlug.slug, sku: bySlug.sku, name: bySlug.name,
        price: li.price.unit_amount / 100, image: bySlug.images?.[0]?.url || '', qty: li.quantity,
      });
      continue;
    }
    orderItems.push({
      product: product._id, slug: product.slug, sku: product.sku, name: product.name,
      price: li.price.unit_amount / 100, image: product.images?.[0]?.url || '', qty: li.quantity,
    });
  }

  if (orderItems.length === 0) {
    console.error(`Fulfillment: session ${checkoutSessionId} produced no order items`);
    return null;
  }

  // ── Address + contact, exactly as Stripe collected them ────────────────────
  const shipping = session.collected_information?.shipping_details || session.shipping_details;
  const customer = session.customer_details || {};
  const fullName = (shipping?.name || customer.name || '').trim();
  const nameParts = fullName.split(/\s+/);
  const addr = shipping?.address || customer.address || {};

  const shippingAddress = {
    firstName: nameParts[0] || 'Customer',
    lastName: nameParts.slice(1).join(' ') || '—',
    line1: addr.line1 || '',
    line2: addr.line2 || undefined,
    city: addr.city || '',
    state: addr.state || '',       // province code for CA, state for US
    zip: addr.postal_code || '',   // postal code for CA, ZIP for US
    country: addr.country || 'CA',
    phone: customer.phone || undefined,
  };

  // ── Amounts straight from Stripe (authoritative) ────────────────────────────
  const subtotal = (session.amount_subtotal || 0) / 100;
  const tax = (session.total_details?.amount_tax || 0) / 100;
  const shippingCost = (session.total_details?.amount_shipping || 0) / 100;
  const discount = (session.total_details?.amount_discount || 0) / 100;
  const total = (session.amount_total || 0) / 100;
  const shippingMethodLabel =
    session.shipping_cost?.shipping_rate?.display_name || 'Standard Shipping';
  const usDuties = usDutiesFrom(session.metadata, shippingCost);

  const pi = session.payment_intent;
  const userId = session.metadata?.userId !== 'guest' ? session.metadata?.userId : undefined;
  const gaIds = sanitizeAnalyticsIds({
    clientId: session.metadata?.gaClientId,
    sessionId: session.metadata?.gaSessionId,
  });

  let order;
  try {
    order = await Order.create({
      user: userId || undefined,
      guestEmail: !userId ? (customer.email || '').toLowerCase() : undefined,
      items: orderItems,
      shippingAddress,
      billingAddress: shippingAddress,
      shippingMethod: shippingMethodLabel,
      shippingCost,
      ...(usDuties ? { importDuties: usDuties.duties, importDutiesQuoteId: usDuties.quoteId || undefined } : {}),
      subtotal,
      tax,
      discount,
      total,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: typeof pi === 'string' ? pi : pi?.id,
      stripeChargeId: typeof pi === 'object' ? pi?.latest_charge || undefined : undefined,
      analyticsClientId: gaIds.clientId,
      analyticsSessionId: gaIds.sessionId,
      paymentStatus: 'paid',
      status: 'processing',
      // Google Customer Reviews sends its survey after this date, so it is the late end of what we promise.
      estimatedDelivery: estimateDeliveryDate({
        country: session.metadata?.shippingCountry || shippingAddress?.country,
        transitDays: session.metadata?.canadaPostTransitDays,
      }),
      // Guest emails aren't seen until Stripe hands them back post-payment, so a
      // disposable address can't be blocked upfront — flag it for manual review.
      adminNotes: [
        isDisposableEmail(customer.email)
          ? 'REVIEW: disposable email detected after Stripe Checkout. Confirm before fulfillment.'
          : null,
        shippingChoiceNote(session.metadata, shippingMethodLabel),
        usOrderNote(usDuties),
        unmappedPrices.length
          ? `REVIEW: ${unmappedPrices.length} paid line item${unmappedPrices.length === 1 ? '' : 's'} could not be matched to a product and ${unmappedPrices.length === 1 ? 'is' : 'are'} NOT on this order (Stripe price ${unmappedPrices.join(', ')}). Check the Stripe payment before shipping.`
          : null,
      ].filter(Boolean).join('\n') || undefined,
      statusHistory: [{ status: 'processing', note: 'Payment confirmed via Stripe Checkout' }],
    });
  } catch (createErr) {
    if (createErr.code === 11000) {
      // Lost the race against the other fulfillment path — reuse its order,
      // but still let this retry recover the stock decrement if the other path
      // crashed after insert and before side effects.
      const existingAfterRace = await Order.findOne({ stripeCheckoutSessionId: session.id });
      return ensureCriticalFulfillmentEffects(existingAfterRace);
    }
    throw createErr;
  }

  // Exactly-once side effects (stock helper is itself idempotent via order flag)
  await stockDecrementer(order);

  // Clear the cart that produced this session
  const cartFilter = userId
    ? { user: userId }
    : { sessionId: session.metadata?.cartSessionId };
  if (userId || session.metadata?.cartSessionId) {
    await Cart.findOneAndUpdate(cartFilter, { items: [], discount: 0, couponCode: undefined });
  }

  // Confirmation email (non-blocking)
  const emailAddress = customer.email;
  if (emailAddress) {
    try {
      await sendOrderConfirmationEmail({
        email: emailAddress,
        firstName: shippingAddress.firstName,
        order: {
          orderNumber: order.orderNumber,
          items: order.items,
          subtotal: order.subtotal,
          discount: order.discount,
          shippingCost: order.shippingCost,
          importDuties: order.importDuties,
          tax: order.tax,
          total: order.total,
        },
      });
    } catch (emailErr) {
      console.error('Confirmation email failed:', emailErr.message);
    }
  }

  // GA4 purchase (server-side, fail-open, runs after every critical effect above).
  await reportPaidOrderToGa4(order, { currency: CURRENCY });

  console.log(`✅ Fulfilled checkout session ${session.id} → order ${order.orderNumber}`);
  return order;
};

// ─── GET /api/stripe/session-status?session_id=cs_... ──────────────────────────
// Success-page endpoint. Doubles as a fulfillment fallback: if the webhook
// hasn't landed yet (or failed), the order is created here instead — the
// unique session index guarantees no duplicates either way.
router.get('/session-status', async (req, res) => {
  try {
    const { session_id: checkoutSessionId } = req.query;
    if (!checkoutSessionId || !/^cs_[a-zA-Z0-9_]+$/.test(checkoutSessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    const order = await fulfillCheckoutSession(checkoutSessionId);
    if (!order) {
      return res.json({ status: 'pending' }); // not paid (yet) — client can retry
    }

    res.json({
      status: 'complete',
      orderNumber: order.orderNumber,
      email: order.guestEmail || undefined,
      ...analyticsOrder(order, CURRENCY),
      // When true the server reports the purchase to GA4, so the browser must not.
      serverPurchaseTracking: isServerPurchaseTrackingEnabled(),
    });
  } catch (err) {
    console.error('Session status error:', err);
    res.status(500).json({ error: 'Failed to check session status' });
  }
});

// ─── POST /api/stripe/webhook ──────────────────────────────────────────────────
// Raw body required — configured in server.js before express.json()
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook signature error: ${err.message}` });
  }

  // Process the event BEFORE acknowledging. If a handler throws, return 500
  // so Stripe retries delivery (exponential backoff, up to ~3 days). Acking
  // first would convert any processing crash into a silently lost order that
  // Stripe believes was delivered. Fulfillment is a few DB ops + one Stripe
  // retrieve — well within Stripe's webhook timeout (the confirmation email
  // inside fulfillCheckoutSession has its own try/catch and can't fail this).
  try {
    switch (event.type) {

      // ── Checkout Session paid: fulfill the order (idempotent) ────────────────
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        // completed fires even for async methods still pending — only fulfill paid
        if (session.payment_status === 'paid') {
          await fulfillCheckoutSession(session.id);
        }
        break;
      }

      // ── Async payment (e.g. bank debit) ultimately failed ────────────────────
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;
        console.warn(`❌ Async payment failed for checkout session ${session.id}`);
        break;
      }

      // ── Session expired without payment: nothing to undo ─────────────────────
      // (stock is only decremented at fulfillment, so abandonment costs nothing)
      case 'checkout.session.expired': {
        console.log(`Checkout session expired: ${event.data.object.id}`);
        break;
      }

      // ── Charge refunded ───────────────────────────────────────────────────────
      case 'charge.refunded': {
        const charge = event.data.object;
        const orderFilter = {
          $or: [
            { stripeChargeId: charge.id },
            ...(charge.payment_intent ? [{ stripePaymentIntentId: charge.payment_intent }] : []),
          ],
        };
        const order = await Order.findOne(orderFilter);

        if (order) {
          if (isFullyRefundedCharge(charge)) {
            order.paymentStatus = 'refunded';
            order.status = 'refunded';
            order.statusHistory.push({
              status: 'refunded',
              note: 'Fully refunded via Stripe; inventory unchanged pending return inspection',
              timestamp: new Date(),
            });
            await order.save();
            console.log(`💸 Full refund processed for order ${order.orderNumber}`);
            // Don't ask a refunded buyer how the order went.
            try {
              if (await cancelReviewRequest(order)) {
                console.log(`Cancelled the scheduled review email for order ${order.orderNumber}`);
              }
            } catch (reviewErr) {
              console.error('Review email cancel failed:', reviewErr.message);
            }
          } else {
            // A charge.refunded event also fires for partial refunds. Preserve
            // the order/payment state and leave inventory alone because the
            // refunded amount does not identify which item quantity returned.
            order.statusHistory.push({
              status: order.status,
              note: `Partial Stripe refund recorded (${charge.amount_refunded || 0} minor currency units); inventory unchanged`,
              timestamp: new Date(),
            });
            await order.save();
            console.log(`💸 Partial refund recorded for order ${order.orderNumber}`);
          }
        } else {
          // Fallback: try to find by PI if charge ID wasn't stored yet
          console.warn(`⚠️  No order found for charge ${charge.id} — charge ID may not be stored`);
        }
        break;
      }

      default:
        // Log unhandled events for debugging but don't error
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error(`Webhook handler error for event ${event.type}:`, err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

if (process.env.NODE_ENV === 'test') {
  router.setCheckoutDependenciesForTest = ({
    ensurePrice = ensureStripePrice,
    createSession,
    retrieveSession,
    decrementStock = decrementStockForOrder,
  } = {}) => {
    checkoutPriceEnsurer = ensurePrice;
    checkoutSessionCreator = createSession || ((payload) => stripe.checkout.sessions.create(payload));
    checkoutSessionRetriever = retrieveSession || ((sessionId, options) => stripe.checkout.sessions.retrieve(sessionId, options));
    stockDecrementer = decrementStock;
  };
}

module.exports = router;
