const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { optionalAuth } = require('../middleware/auth');
const { sendOrderConfirmationEmail, sendPaymentNoticeEmail } = require('../utils/email');
const {
  toStripeShippingOptions,
  resolveCartShippingPrice,
  ALLOWED_SHIPPING_COUNTRIES,
  CURRENCY,
  FASTER_SHIPPING_TRANSIT_DAYS,
} = require('../config/shipping');
const { analyticsOrder } = require('../utils/analyticsOrder');
const { INTERNATIONAL_COUNTRIES, US_SERVICE_CODE } = require('../config/shipping');
const { internationalOptions, optionLabel } = require('../utils/internationalShipping');
const { quoteUnitedStates, UsCheckoutError } = require('../utils/usCheckout');
const { isServerPurchaseTrackingEnabled, sanitizeAnalyticsIds } = require('../utils/ga4');
const { reportPaidOrderToGa4 } = require('../utils/purchaseAnalytics');
const { decrementStockForOrder, shouldDecrementStockForFulfillment, cancelOrderAndRestoreStock } = require('../utils/stock');
const { ensureStripePrice, ensureBankDebitCoupon } = require('../utils/stripeSync');
const { BANK_DEBIT, bankDebitEnabled, paymentMethodSettings } = require('../utils/paymentMethods');
const { isDisposableEmail } = require('../utils/disposableEmail');
const { isFullyRefundedCharge } = require('../utils/refunds');
const { cancelReviewRequest } = require('../utils/reviewRequests');
const { estimateDeliveryDate } = require('../utils/deliveryEstimate');
const { shippingChoiceNote } = require('../utils/shippingChoice');
const { resolveCanadaDelivery, DeliveryChoiceError } = require('../utils/canadaDelivery');
const { recordAdminEvent, describeOrder } = require('../utils/adminEvents');
const { removeNoteLines } = require('../utils/orderNotes');

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
let bankDebitCouponEnsurer = ensureBankDebitCoupon;
let checkoutSessionCreator = (payload) => stripe.checkout.sessions.create(payload);
let checkoutSessionRetriever = (sessionId, options) => stripe.checkout.sessions.retrieve(sessionId, options);
let stockDecrementer = decrementStockForOrder;
let orderCanceller = cancelOrderAndRestoreStock;

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

    // ── How it is paid: card and wallets (the default), or bank debit (Stripe pre-authorized debit), which gets its own
    // session so its discount and its delayed payment never mix with the card page. E-Transfer is not Stripe: routes/payments.js. ──
    const requestedMethod = req.body?.paymentMethod ?? 'card';
    if (requestedMethod !== 'card' && requestedMethod !== BANK_DEBIT) {
      return res.status(400).json({ error: 'Unknown payment method.' });
    }
    const bankDebit = requestedMethod === BANK_DEBIT;
    if (bankDebit && !bankDebitEnabled()) {
      return res.status(400).json({ error: 'Bank debit is not available right now. Please pay by card.' });
    }

    // ── Where it ships: Canada (flat rates), the United States (Tracked Packet USA plus the
    // prepaid import duties, both worked out here) or another country (the Canada Post
    // price for the service the buyer picked, re-quoted here, never taken from
    // the client). ──────────────────────────────────────────────────────────
    const country = String(req.body?.shipping?.country || 'CA').toUpperCase();
    if (bankDebit && country !== 'CA') {
      return res.status(400).json({ error: 'Bank debit is only available for orders shipped within Canada.' });
    }
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
    // worked out here from the cart, never taken from the client (utils/canadaDelivery.js,
    // shared with the e-Transfer order). ─────────────────────────────────────────────────
    let canadaChoice;
    if (country === 'CA') {
      let delivery;
      try {
        delivery = resolveCanadaDelivery(shippingLines, req.body?.shipping || {});
      } catch (err) {
        if (err instanceof DeliveryChoiceError) return res.status(err.status).json({ error: err.publicMessage });
        throw err;
      }
      if (delivery.choice) {
        shippingOptions = [{
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: delivery.label,
            fixed_amount: { amount: Math.round(delivery.amount * 100), currency: CURRENCY },
            tax_behavior: 'exclusive',
            metadata: { canadaPostService: delivery.faster ? 'DOM.XP' : 'STANDARD', signature: delivery.signature ? 'yes' : 'no', country: 'CA' },
          },
        }];
        canadaChoice = { faster: delivery.faster, signature: delivery.signature };
      }
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://reflexityram.com';
    // GA identifiers let the server attribute the purchase to the buyer's browsing
    // session. They are optional, untrusted, and validated before use.
    const gaIds = sanitizeAnalyticsIds(req.body?.analytics);

    // Bank debit passes part of what it saves on to the buyer: a percent coupon on the goods (Stripe never discounts the
    // shipping rate). A Checkout session cannot take a coupon AND let the buyer type a promotion code, so a bank debit
    // session has no promotion-code box.
    const bankDebitPct = bankDebit ? paymentMethodSettings()[BANK_DEBIT].discountPct : 0;
    const bankDebitCoupon = bankDebit && bankDebitPct > 0 ? await bankDebitCouponEnsurer(bankDebitPct) : null;

    const session = await checkoutSessionCreator({
      mode: 'payment',
      line_items: lineItems,
      // Not on US orders: the duties are priced on the goods' full value, and a discount would leave the buyer paying duty on money they never paid.
      // Stripe refuses a session that names allow_promotion_codes AT ALL (even false) next to discounts: found by creating a real
      // bank-debit session on the live account. So with the bank-debit coupon the key is left out and there is no promotion-code box.
      ...(bankDebitCoupon ? {} : { allow_promotion_codes: !usQuote }),
      branding_settings: CHECKOUT_BRANDING,
      ...(bankDebit ? {
        // Only this one method on this session (the dashboard's payment-method list is left alone so card sessions never show it).
        // A one-time debit the buyer authorizes now; "personal" is the PAD category for consumers (a 90-day window to dispute
        // an unauthorized debit under Payments Canada Rule H1), the safe default for a shop that also sells to individuals.
        payment_method_types: ['acss_debit'],
        payment_method_options: {
          acss_debit: {
            mandate_options: { payment_schedule: 'sporadic', transaction_type: 'personal' },
            verification_method: 'automatic',
          },
        },
        ...(bankDebitCoupon ? { discounts: [{ coupon: bankDebitCoupon }] } : {}),
      } : {}),

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
        ...(bankDebit ? { paymentMethod: BANK_DEBIT, paymentDiscountPct: String(bankDebitPct) } : {}),
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

// Tell the owner's phone about a new order: paid, or a bank debit that is still clearing. Safe to call again and again
// (dedupeKey), so the retry path below can repeat it: an alert lost the first time (a database blip, a restart mid-request)
// still gets sent.
const announceNewOrder = (order, { created = false } = {}) => {
  if (order.paymentMethod === BANK_DEBIT && order.paymentStatus === 'pending') {
    return recordAdminEvent({
      type: 'order.bank_debit_pending', title: 'Bank debit order: payment processing', body: `${describeOrder(order)} · do not ship until it clears`,
      priority: 'high', order, dedupeKey: `order.bank_debit_pending:${order._id}`,
    });
  }
  // A bank debit that has cleared since already told the owner "cleared" (settleBankDebitPaid): only one that was born paid is news here.
  if (order.paymentMethod === BANK_DEBIT && !created) return null;
  return recordAdminEvent({
    type: 'order.paid', title: 'New order, paid', body: describeOrder(order), priority: 'high', order, dedupeKey: `order.paid:${order._id}`,
  });
};

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

  // And the owner's alert, if the first attempt did not get through (no-op once recorded). Only for a fresh order: a buyer
  // reopening an old success link must not tell the owner about a months-old sale again.
  if ((order.paymentStatus === 'paid' || order.paymentMethod === BANK_DEBIT) && Date.now() - new Date(order.createdAt).getTime() < 60 * 60 * 1000) await announceNewOrder(order);

  return order;
};

// A bank-debit session is "complete" the moment the buyer has authorized the debit, but the money takes days to clear:
// Stripe keeps payment_status 'unpaid' until then and sends checkout.session.async_payment_succeeded (or _failed) later.
const isDelayedBankDebit = (session) => (
  session?.status === 'complete'
  && session?.payment_status === 'unpaid'
  && (session.payment_method_types || []).includes('acss_debit')
);
// "Complete and unpaid" is also how Stripe leaves a session after the bank REFUSED the debit (its PaymentIntent is back at
// requires_payment_method), and a buyer who typed their account numbers by hand has a PaymentIntent that is waiting for the
// BUYER to verify micro-deposits (requires_action), not for the bank. In those states (and a cancelled PaymentIntent) no debit
// is under way, so there is no order to hold stock for. Without this, a failure Stripe reported before our `completed` handler
// had run (it was being retried) was followed by an order that nothing would ever cancel. If the money does clear,
// async_payment_succeeded creates the order, already paid.
// Only the states where NOTHING is under way are listed. Anything else (`processing`, which is what a real debit shows, and any
// state Stripe may add) counts as in flight: wrongly leaving out a real debit would give a paying buyer no order, no email and
// no stock held, which is worse than the rare order for a debit that never started (the 8-day check and the owner's phone
// catch that one).
const NO_DEBIT_UNDER_WAY = new Set(['requires_payment_method', 'requires_action', 'canceled']);
const bankDebitInFlight = (session) => !NO_DEBIT_UNDER_WAY.has(session?.payment_intent?.status);
const AWAITING_BANK_DEBIT_NOTE = 'AWAITING bank debit: do not ship until this order shows as paid (the bank takes up to 5 business days).';

const fulfillCheckoutSession = async (checkoutSessionId) => {
  // Fast path: order already exists. Still verify critical side effects so a
  // retry can recover if the first process crashed after Order.create().
  const existing = await Order.findOne({ stripeCheckoutSessionId: checkoutSessionId });
  if (existing) return ensureCriticalFulfillmentEffects(existing);

  // shipping_cost.shipping_rate is only an ID unless it is expanded; without it every order read "Standard Shipping" (the label below).
  const session = await checkoutSessionRetriever(checkoutSessionId, {
    expand: ['line_items.data.price.product', 'payment_intent', 'shipping_cost.shipping_rate'],
  });

  // Paid sessions become paid orders. A bank debit that is really clearing (its PaymentIntent is `processing`) becomes a
  // PENDING order now (stock held, buyer told, owner alerted) and turns paid in settleBankDebitPaid. Anything else unpaid is
  // not an order yet.
  const delayed = isDelayedBankDebit(session) && bankDebitInFlight(session);
  if (session.payment_status !== 'paid' && !delayed) return null;
  const isBankDebit = delayed || session.metadata?.paymentMethod === BANK_DEBIT;
  const discountPct = isBankDebit ? Number(session.metadata?.paymentDiscountPct) : NaN;

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
      paymentStatus: delayed ? 'pending' : 'paid',
      status: delayed ? 'pending' : 'processing',
      paymentMethod: isBankDebit ? BANK_DEBIT : 'stripe',
      ...(Number.isFinite(discountPct) && discountPct > 0 ? { paymentDiscountPct: discountPct } : {}),
      // Google Customer Reviews sends its survey after this date, so it is the late end of what we promise. A debit that
      // is still clearing gets its date when it clears (settleBankDebitPaid), counted from then.
      ...(delayed ? {} : {
        estimatedDelivery: estimateDeliveryDate({
          country: session.metadata?.shippingCountry || shippingAddress?.country,
          transitDays: session.metadata?.canadaPostTransitDays,
        }),
      }),
      // Guest emails aren't seen until Stripe hands them back post-payment, so a
      // disposable address can't be blocked upfront — flag it for manual review.
      adminNotes: [
        delayed ? AWAITING_BANK_DEBIT_NOTE : null,
        isDisposableEmail(customer.email)
          ? 'REVIEW: disposable email detected after Stripe Checkout. Confirm before fulfillment.'
          : null,
        shippingChoiceNote(session.metadata, shippingMethodLabel),
        usOrderNote(usDuties),
        unmappedPrices.length
          ? `REVIEW: ${unmappedPrices.length} paid line item${unmappedPrices.length === 1 ? '' : 's'} could not be matched to a product and ${unmappedPrices.length === 1 ? 'is' : 'are'} NOT on this order (Stripe price ${unmappedPrices.join(', ')}). Check the Stripe payment before shipping.`
          : null,
      ].filter(Boolean).join('\n') || undefined,
      statusHistory: [delayed
        ? { status: 'pending', note: 'Order placed; bank debit submitted, waiting for the bank (up to 5 business days)' }
        : { status: 'processing', note: 'Payment confirmed via Stripe Checkout' }],
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

  await announceNewOrder(order, { created: true });

  // Exactly-once side effects (stock helper is itself idempotent via order flag)
  await stockDecrementer(order);

  // Clear the cart that produced this session
  const cartFilter = userId
    ? { user: userId }
    : { sessionId: session.metadata?.cartSessionId };
  if (userId || session.metadata?.cartSessionId) {
    await Cart.findOneAndUpdate(cartFilter, { items: [], discount: 0, couponCode: undefined });
  }

  // Confirmation email (non-blocking). A debit still clearing gets "received, processing" instead; the confirmation follows when it clears.
  const emailAddress = customer.email;
  if (emailAddress && delayed) {
    try {
      await sendPaymentNoticeEmail({ email: emailAddress, firstName: shippingAddress.firstName, order, kind: 'bankDebitReceived' });
    } catch (emailErr) {
      console.error('Bank debit received email failed:', emailErr.message);
    }
  } else if (emailAddress) {
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

// ─── Bank debit: the money cleared (or failed) days after the order was placed ──
// checkout.session.async_payment_succeeded: the pending order becomes a paid, shippable one. Safe to run twice and in any
// order with checkout.session.completed (the claim below only matches a still-pending order).
// A retry of an event whose work was already done must still be able to finish what a crash cut short: the alert has a
// dedupeKey, so repeating it is harmless, and it only counts while the change is fresh (never an old order reopened later).
const FRESH_MS = 60 * 60 * 1000;
const isFresh = (order) => Date.now() - new Date(order?.updatedAt || order?.createdAt || 0).getTime() < FRESH_MS;
const announceCleared = (order) => recordAdminEvent({
  type: 'order.bank_debit_paid', title: 'Bank debit cleared: ready to ship', body: describeOrder(order), priority: 'high', order, dedupeKey: `order.bank_debit_paid:${order._id}`,
});
const announceFailed = (order) => recordAdminEvent({
  type: 'order.payment_failed', title: 'Bank debit failed: order cancelled', body: describeOrder(order), priority: 'high', order, dedupeKey: `order.payment_failed:${order._id}`,
});

const settleBankDebitPaid = async (checkoutSessionId) => {
  // Normally the order exists already. If `completed` was missed the session is paid by now and this creates it as paid.
  const order = await fulfillCheckoutSession(checkoutSessionId);
  if (!order) return order;
  if (order.paymentStatus === 'paid') {
    // Settled already. If this order cleared through here a moment ago, make sure the owner's alert exists (a crash between the update and the alert).
    if (order.paymentMethod === BANK_DEBIT && isFresh(order) && (order.statusHistory || []).some((h) => /^Bank debit cleared/.test(h.note || ''))) await announceCleared(order);
    return order;
  }

  const session = await checkoutSessionRetriever(checkoutSessionId, { expand: ['payment_intent'] });
  if (session.payment_status !== 'paid') return order;               // an old event replayed: Stripe says it has not cleared
  const pi = session.payment_intent;
  const chargeId = typeof pi === 'object' ? pi?.latest_charge || undefined : undefined;
  const now = new Date();
  const notes = removeNoteLines(order.adminNotes, 'AWAITING bank debit');
  const paid = await Order.findOneAndUpdate(
    { _id: order._id, paymentMethod: BANK_DEBIT, paymentStatus: 'pending', status: 'pending' },
    {
      $set: {
        paymentStatus: 'paid',
        status: 'processing',
        paidAt: now,
        // Counted from the day it cleared, with the same transit time the card and e-Transfer paths use for Faster shipping.
        estimatedDelivery: estimateDeliveryDate({
          placedAt: now,
          country: session.metadata?.shippingCountry || order.shippingAddress?.country || 'CA',
          transitDays: session.metadata?.canadaPostTransitDays,
        }),
        ...(chargeId ? { stripeChargeId: chargeId } : {}),
        ...(notes ? { adminNotes: notes } : {}),
      },
      ...(notes ? {} : { $unset: { adminNotes: '' } }),
      $push: { statusHistory: { status: 'processing', note: 'Bank debit cleared; payment confirmed via Stripe', timestamp: now } },
    },
    { returnDocument: 'after' }
  );
  if (!paid) {
    // Not pending any more. The one case that needs a human: the order was cancelled by hand while the debit was still clearing.
    const current = await Order.findById(order._id);
    if (current && current.status === 'cancelled' && current.paymentStatus !== 'paid') {
      const note = 'REVIEW: the bank debit CLEARED after this order was cancelled. Refund it in Stripe (or reinstate the order by hand).';
      // Stripe may deliver the same event again (at-least-once, or a manual resend): the line goes on once.
      await Order.updateOne(
        { _id: current._id, adminNotes: { $not: /REVIEW: the bank debit CLEARED/ } },
        { $set: { adminNotes: [current.adminNotes, note].filter(Boolean).join('\n') } },
      );
      await recordAdminEvent({ type: 'order.payment_after_cancel', title: 'Bank debit cleared on a cancelled order', body: `${describeOrder(current)} · refund it`, priority: 'high', order: current, dedupeKey: `order.payment_after_cancel:${current._id}` });
    }
    return current;
  }

  const email = session.customer_details?.email;
  if (email) {
    try {
      await sendOrderConfirmationEmail({
        email,
        firstName: paid.shippingAddress?.firstName,
        order: {
          orderNumber: paid.orderNumber, items: paid.items, subtotal: paid.subtotal, discount: paid.discount,
          shippingCost: paid.shippingCost, importDuties: paid.importDuties, tax: paid.tax, total: paid.total,
        },
      });
    } catch (emailErr) {
      console.error('Confirmation email failed:', emailErr.message);
    }
  }
  await announceCleared(paid);
  await reportPaidOrderToGa4(paid, { currency: CURRENCY });
  console.log(`✅ Bank debit cleared for session ${checkoutSessionId} → order ${paid.orderNumber}`);
  return paid;
};

// checkout.session.async_payment_failed: the bank refused or reversed the debit. Nothing was shipped; cancel the order,
// give the stock back and tell the buyer.
const settleBankDebitFailed = async (checkoutSessionId) => {
  const order = await Order.findOne({ stripeCheckoutSessionId: checkoutSessionId }).populate('user', 'firstName email');
  if (!order) return null;                                            // the order was never created: nothing to undo
  const now = new Date();
  const cancelledId = await orderCanceller(order._id, {
    status: 'cancelled',
    paymentStatus: 'failed',
    cancelledAt: now,
    $push: { statusHistory: { status: 'cancelled', note: 'Bank debit failed; order cancelled and stock returned', timestamp: now } },
  }, { status: 'pending', paymentStatus: 'pending' });
  if (!cancelledId) {
    // Already paid or cancelled. If this debit failed through here a moment ago, make sure the owner's alert exists.
    const current = await Order.findById(order._id);
    if (current && current.status === 'cancelled' && current.paymentStatus === 'failed' && isFresh(current)) await announceFailed(current);
    return order;
  }
  const email = order.user?.email || order.guestEmail;
  if (email) {
    try {
      await sendPaymentNoticeEmail({ email, firstName: order.user?.firstName || order.shippingAddress?.firstName, order, kind: 'bankDebitFailed' });
    } catch (emailErr) {
      console.error('Bank debit failed email failed:', emailErr.message);
    }
  }
  await announceFailed(order);
  console.warn(`❌ Bank debit failed for session ${checkoutSessionId} → order ${order.orderNumber} cancelled`);
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

    // A bank debit that is still clearing: the order exists (and is held for them) but is not paid yet, so no purchase is reported.
    // Only bank-debit orders: a card order's success link answers exactly as it always did (a refunded one included).
    if (order.paymentMethod === BANK_DEBIT && order.paymentStatus !== 'paid') {
      return res.json({
        status: 'processing',
        orderNumber: order.orderNumber,
        email: order.guestEmail || undefined,
        paymentMethod: order.paymentMethod,
      });
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
      case 'checkout.session.completed': {
        const session = event.data.object;
        // completed also fires for a bank debit that is still clearing: that becomes a pending order (paid later)
        if (session.payment_status === 'paid' || isDelayedBankDebit(session)) {
          await fulfillCheckoutSession(session.id);
        }
        break;
      }

      // ── Bank debit cleared days later: the pending order becomes paid ────────
      case 'checkout.session.async_payment_succeeded': {
        await settleBankDebitPaid(event.data.object.id);
        break;
      }

      // ── Async payment (bank debit) ultimately failed: cancel, restock, tell the buyer ──
      case 'checkout.session.async_payment_failed': {
        await settleBankDebitFailed(event.data.object.id);
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
            await recordAdminEvent({ type: 'order.refunded', title: 'Order refunded', body: describeOrder(order), priority: 'normal', order, dedupeKey: `order.refunded:${order._id}` });
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
            await recordAdminEvent({ type: 'order.partial_refund', title: 'Partial refund recorded', body: describeOrder(order), priority: 'normal', order, dedupeKey: `order.partial_refund:${event.id}` });
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
    ensureCoupon = ensureBankDebitCoupon,
    createSession,
    retrieveSession,
    decrementStock = decrementStockForOrder,
    cancelAndRestore = cancelOrderAndRestoreStock,
  } = {}) => {
    checkoutPriceEnsurer = ensurePrice;
    bankDebitCouponEnsurer = ensureCoupon;
    orderCanceller = cancelAndRestore;
    checkoutSessionCreator = createSession || ((payload) => stripe.checkout.sessions.create(payload));
    checkoutSessionRetriever = retrieveSession || ((sessionId, options) => stripe.checkout.sessions.retrieve(sessionId, options));
    stockDecrementer = decrementStock;
  };
  // The settlement steps are not routes of their own, so tests reach them here.
  router.internalsForTest = { fulfillCheckoutSession, settleBankDebitPaid, settleBankDebitFailed, isDelayedBankDebit, bankDebitInFlight };
}

module.exports = router;
