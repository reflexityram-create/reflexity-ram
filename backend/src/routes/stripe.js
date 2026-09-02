const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { optionalAuth } = require('../middleware/auth');
const { sendOrderConfirmationEmail } = require('../utils/email');
const { toStripeShippingOptions, ALLOWED_SHIPPING_COUNTRIES, CURRENCY } = require('../config/shipping');
const { analyticsOrder } = require('../utils/analyticsOrder');
const { decrementStockForOrder, shouldDecrementStockForFulfillment } = require('../utils/stock');
const { ensureStripePrice } = require('../utils/stripeSync');
const { isDisposableEmail } = require('../utils/disposableEmail');
const { isFullyRefundedCharge } = require('../utils/refunds');

const router = express.Router();

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
    const sessionId = req.headers['x-session-id'] || req.cookies?.cartSessionId;
    const userId = req.user?._id;

    if (!userId && !sessionId) {
      return res.status(400).json({ error: 'Session ID required for guest checkout' });
    }

    const filter = userId ? { user: userId } : { sessionId };
    const cart = await Cart.findOne(filter);

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // ── Build line_items from DB-stored Stripe Price IDs ──────────────────────
    const lineItems = [];
    for (const item of cart.items) {
      const product = await Product.findOne({ slug: item.slug, isActive: true });
      if (!product) {
        return res.status(400).json({ error: `Product "${item.name}" is no longer available` });
      }
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
      const priceId = await ensureStripePrice(product);
      if (!priceId) {
        return res.status(503).json({ error: 'Payment processing is not configured.' });
      }

      lineItems.push({ price: priceId, quantity: item.qty });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://reflexityram.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,

      // ── Shipping: Canada + US only. Stripe renders the country-appropriate
      // address form (Province/Postal code vs State/ZIP) automatically. ──────
      shipping_address_collection: { allowed_countries: ALLOWED_SHIPPING_COUNTRIES },
      shipping_options: toStripeShippingOptions(),
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
      },

      success_url: `${frontendUrl}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/cart`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes
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
const ensureCriticalFulfillmentEffects = async (order) => {
  if (!order) return order;

  // Recovery path: if the order row exists but the process crashed before the
  // stock decrement, a Stripe retry or success-page check must still be able to
  // complete that critical side effect. decrementStockForOrder is idempotent and
  // atomically guarded by order.stockDecremented, so this is safe during races.
  if (shouldDecrementStockForFulfillment(order)) {
    await decrementStockForOrder(order);
  }

  return order;
};

const fulfillCheckoutSession = async (checkoutSessionId) => {
  // Fast path: order already exists. Still verify critical side effects so a
  // retry can recover if the first process crashed after Order.create().
  const existing = await Order.findOne({ stripeCheckoutSessionId: checkoutSessionId });
  if (existing) return ensureCriticalFulfillmentEffects(existing);

  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
    expand: ['line_items.data.price.product', 'payment_intent'],
  });

  // Only fulfill paid sessions (async payment methods stay 'unpaid' until later)
  if (session.payment_status !== 'paid') return null;

  // ── Map Stripe line items back to our products via stored Price IDs ────────
  const orderItems = [];
  for (const li of session.line_items.data) {
    const product = await Product.findOne({ stripePriceId: li.price.id });
    if (!product) {
      // Fallback: match by metadata slug set during sync
      const slug = li.price.product?.metadata?.slug;
      const bySlug = slug ? await Product.findOne({ slug }) : null;
      if (!bySlug) {
        console.error(`Fulfillment: no product for Stripe price ${li.price.id}`);
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
  const total = (session.amount_total || 0) / 100;
  const shippingMethodLabel =
    session.shipping_cost?.shipping_rate?.display_name || 'Standard Shipping';

  const pi = session.payment_intent;
  const userId = session.metadata?.userId !== 'guest' ? session.metadata?.userId : undefined;

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
      subtotal,
      tax,
      total,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: typeof pi === 'string' ? pi : pi?.id,
      stripeChargeId: typeof pi === 'object' ? pi?.latest_charge || undefined : undefined,
      paymentStatus: 'paid',
      status: 'processing',
      // Guest emails aren't seen until Stripe hands them back post-payment, so a
      // disposable address can't be blocked upfront — flag it for manual review.
      adminNotes: isDisposableEmail(customer.email)
        ? 'REVIEW: disposable email detected after Stripe Checkout. Confirm before fulfillment.'
        : undefined,
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
  await decrementStockForOrder(order);

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
          shippingCost: order.shippingCost,
          total: order.total,
        },
      });
    } catch (emailErr) {
      console.error('Confirmation email failed:', emailErr.message);
    }
  }

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

module.exports = router;
