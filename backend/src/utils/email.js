const { Resend } = require('resend');
const { CURRENCY } = require('../config/shipping');
const { escapeHtml } = require('./htmlEscape');
const { orderAccessUrl } = require('./orderAccessLink');
const { trackingUrlFor } = require('./tracking');
const { SUPPORT_EMAIL, etransferAddressDiffersFromContact } = require('./contact');
const { isUnmatchedItem } = require('./unmatchedItems');

let resend;
const getResend = () => {
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
};
const DISPLAY_CURRENCY = CURRENCY.toUpperCase();

// One place for a Resend failure. Provider body text is never copied into logs or thrown errors because it may contain recipient data.
// Resend's documented error names are fixed provider categories. Keep the list explicit so arbitrary provider text or object fields never
// become part of a log or persisted lastError. The two local names cover SDK failures that never return a Resend error object.
const SAFE_RESEND_NAMES = new Set([
  'application_error', 'concurrent_idempotent_requests', 'daily_quota_exceeded', 'internal_server_error',
  'invalid_access', 'invalid_api_key', 'invalid_from_address', 'invalid_idempotent_request', 'invalid_parameter',
  'invalid_idempotency_key', 'invalid_attachment', 'invalid_region', 'method_not_allowed', 'missing_api_key',
  'missing_required_field', 'monthly_quota_exceeded', 'network_error',
  'not_found', 'rate_limit_exceeded', 'restricted_api_key', 'security_error', 'validation_error',
]);
const errorField = (error, field) => {
  try { return error?.[field]; } catch { return undefined; }
};
function failSend(error, action = 'send') {
  const rawName = errorField(error, 'name');
  const name = SAFE_RESEND_NAMES.has(rawName) ? rawName
    : ['AbortError', 'FetchError', 'TypeError'].includes(rawName) ? 'network_error'
      : !process.env.RESEND_API_KEY ? 'missing_api_key' : 'unknown';
  const rawStatus = errorField(error, 'statusCode');
  const statusCode = Number.isFinite(rawStatus) && Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : undefined;
  console.error(`Resend ${action} error detail:`, JSON.stringify({ name, ...(statusCode === undefined ? {} : { statusCode }) }));
  throw new Error('Email ' + action + ' failed (' + name + (statusCode === undefined ? '' : ', ' + statusCode) + ')');
}
const sendEmail = async (message, options) => {
  try {
    return await getResend().emails.send(message, options);
  } catch (error) {
    failSend(error);
  }
};
// IMPORTANT: onboarding@resend.dev is Resend's sandbox sender.
// It can ONLY send to the email address that owns the Resend account.
// For production you MUST set FROM_EMAIL to a verified domain sender,
// e.g. FROM_EMAIL=noreply@yourdomain.com  (domain verified in Resend dashboard)
const FROM_EMAIL = process.env.FROM_EMAIL || 'Reflexity RAM <onboarding@resend.dev>';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Send email verification
 */
const sendVerificationEmail = async ({ email, firstName, token }) => {
  // The token rides in the fragment: a browser never sends that part to a server, the edge, or its logs (the page reads both forms).
  const verifyUrl = `${FRONTEND_URL}/verify-email#token=${token}`;

  const { data, error } = await sendEmail({
    from: FROM_EMAIL,
    to: email,
    replyTo: SUPPORT_EMAIL,
    subject: 'Verify your Reflexity RAM account',
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="margin:0;padding:0;background:#0a0a0c;font-family:'Figtree',system-ui,sans-serif;color:#f5f5f7;">
        <div style="max-width:560px;margin:40px auto;padding:0 20px;">
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;">
            <div style="margin-bottom:32px;">
              <span style="font-size:20px;font-weight:700;letter-spacing:-0.5px;">Reflexity RAM</span>
            </div>
            <h1 style="font-size:24px;font-weight:700;margin:0 0 12px;letter-spacing:-0.5px;">Verify your email</h1>
            <p style="color:#a0a0aa;margin:0 0 32px;line-height:1.6;">Hi ${escapeHtml(firstName)}, welcome to Reflexity RAM. Please verify your email address to activate your account.</p>
            <a href="${escapeHtml(verifyUrl)}" style="display:inline-block;background:#f5f5f7;color:#050505;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:14px;">Verify Email Address</a>
            <p style="color:#5a5a64;font-size:12px;margin:32px 0 0;line-height:1.6;">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
            <p style="color:#5a5a64;font-size:11px;margin:16px 0 0;">Or copy this URL: <a href="${escapeHtml(verifyUrl)}" style="color:#8a8a92;">${escapeHtml(verifyUrl)}</a></p>
          </div>
        </div>
      </body>
      </html>
    `,
  });

  if (error) failSend(error);
  return data;
};

/**
 * Send password reset email
 */
const sendPasswordResetEmail = async ({ email, firstName, token }) => {
  const resetUrl = `${FRONTEND_URL}/reset-password#token=${token}`;

  const { data, error } = await sendEmail({
    from: FROM_EMAIL,
    to: email,
    replyTo: SUPPORT_EMAIL,
    subject: 'Reset your Reflexity RAM password',
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="margin:0;padding:0;background:#0a0a0c;font-family:'Figtree',system-ui,sans-serif;color:#f5f5f7;">
        <div style="max-width:560px;margin:40px auto;padding:0 20px;">
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;">
            <div style="margin-bottom:32px;">
              <span style="font-size:20px;font-weight:700;letter-spacing:-0.5px;">Reflexity RAM</span>
            </div>
            <h1 style="font-size:24px;font-weight:700;margin:0 0 12px;letter-spacing:-0.5px;">Reset your password</h1>
            <p style="color:#a0a0aa;margin:0 0 32px;line-height:1.6;">Hi ${escapeHtml(firstName)}, we received a request to reset your password. Click below to choose a new one.</p>
            <a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#f5f5f7;color:#050505;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:14px;">Reset Password</a>
            <p style="color:#5a5a64;font-size:12px;margin:32px 0 0;line-height:1.6;">This link expires in 1 hour. If you didn't request this, please ignore this email — your password won't change.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  });

  if (error) failSend(error);
  return data;
};

/**
 * Send order confirmation email
 */
const sendOrderConfirmationEmail = async ({ email, firstName, order, idempotencyKey }) => {
  const orderUrl = orderAccessUrl(FRONTEND_URL, order, email);

  const itemsHtml = order.items.map(item => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:13px;color:#f5f5f7;">${escapeHtml(item.name)}</div>
        ${isUnmatchedItem(item) ? '' : `<div style="font-size:11px;color:#5a5a64;font-family:monospace;">${escapeHtml(item.sku)}</div>`}
      </td>
      <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);text-align:center;color:#a0a0aa;font-size:13px;">${item.qty}</td>
      <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);text-align:right;font-family:monospace;font-size:13px;">$${(item.price * item.qty).toFixed(2)} ${DISPLAY_CURRENCY}</td>
    </tr>
  `).join('');

  const { data, error } = await sendEmail({
    from: FROM_EMAIL,
    to: email,
    replyTo: SUPPORT_EMAIL,
    subject: `Order confirmed — ${order.orderNumber}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="margin:0;padding:0;background:#0a0a0c;font-family:'Figtree',system-ui,sans-serif;color:#f5f5f7;">
        <div style="max-width:560px;margin:40px auto;padding:0 20px;">
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;">
            <div style="margin-bottom:32px;">
              <span style="font-size:20px;font-weight:700;letter-spacing:-0.5px;">Reflexity RAM</span>
            </div>
            <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px;padding:16px;margin-bottom:32px;">
              <span style="color:#34d399;font-weight:600;font-size:14px;">✓ Order confirmed</span>
            </div>
            <h1 style="font-size:22px;font-weight:700;margin:0 0 8px;letter-spacing:-0.5px;">Thanks, ${escapeHtml(firstName)}!</h1>
            <p style="color:#a0a0aa;margin:0 0 8px;font-size:13px;">Order <span style="font-family:monospace;color:#f5f5f7;">${escapeHtml(order.orderNumber)}</span></p>
            <p style="color:#a0a0aa;margin:0 0 32px;line-height:1.6;font-size:13px;">We're processing your order. You'll receive a shipping notification once it's on its way.</p>
            <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
              <thead>
                <tr>
                  <th style="text-align:left;font-size:11px;color:#5a5a64;text-transform:uppercase;letter-spacing:0.1em;padding-bottom:8px;">Item</th>
                  <th style="text-align:center;font-size:11px;color:#5a5a64;text-transform:uppercase;letter-spacing:0.1em;padding-bottom:8px;">Qty</th>
                  <th style="text-align:right;font-size:11px;color:#5a5a64;text-transform:uppercase;letter-spacing:0.1em;padding-bottom:8px;">Price</th>
                </tr>
              </thead>
              <tbody>${itemsHtml}</tbody>
            </table>
            <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="color:#a0a0aa;font-size:13px;">Subtotal</span>
                <span style="font-family:monospace;font-size:13px;">$${order.subtotal.toFixed(2)} ${DISPLAY_CURRENCY}</span>
              </div>
              ${order.discount > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="color:#a0a0aa;font-size:13px;">Discount</span>
                <span style="font-family:monospace;font-size:13px;">-$${order.discount.toFixed(2)} ${DISPLAY_CURRENCY}</span>
              </div>` : ''}
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="color:#a0a0aa;font-size:13px;">Shipping</span>
                <span style="font-family:monospace;font-size:13px;">${order.shippingCost === 0 ? 'Free' : '$' + (order.importDuties > 0 ? Math.round((order.shippingCost - order.importDuties) * 100) / 100 : order.shippingCost).toFixed(2) + ' ' + DISPLAY_CURRENCY}</span>
              </div>
              ${order.importDuties > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="color:#a0a0aa;font-size:13px;">US import duties and fees (prepaid)</span>
                <span style="font-family:monospace;font-size:13px;">$${order.importDuties.toFixed(2)} ${DISPLAY_CURRENCY}</span>
              </div>` : ''}
              ${order.tax > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="color:#a0a0aa;font-size:13px;">Tax</span>
                <span style="font-family:monospace;font-size:13px;">$${order.tax.toFixed(2)} ${DISPLAY_CURRENCY}</span>
              </div>` : ''}
              <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08);">
                <span style="font-weight:700;font-size:15px;">Total</span>
                <span style="font-family:monospace;font-weight:700;font-size:15px;">$${order.total.toFixed(2)} ${DISPLAY_CURRENCY}</span>
              </div>
            </div>
            <div style="margin-top:32px;">
              <a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:#f5f5f7;color:#050505;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:13px;">View Order Details</a>
            </div>
            <p style="color:#5a5a64;font-size:11px;margin:32px 0 0;">Questions? Email us at <a href="mailto:reflexityram@gmail.com" style="color:#8a8a92;">reflexityram@gmail.com</a></p>
          </div>
        </div>
      </body>
      </html>
    `,
  }, idempotencyKey ? { idempotencyKey } : undefined);

  if (error) failSend(error);
  return data;
};

/**
 * Send shipping notification email
 */
const sendShippingNotificationEmail = async ({ email, firstName, order, idempotencyKey }) => {
  const orderUrl = orderAccessUrl(FRONTEND_URL, order, email);
  const trackingUrl = trackingUrlFor(order);
  // Sent on purpose without a tracking number (the owner chose it): say so plainly, and let a reply reach the shop.
  const untracked = !order.trackingNumber;

  const { data, error } = await sendEmail({
    from: FROM_EMAIL,
    to: email,
    replyTo: SUPPORT_EMAIL,
    subject: `Your order has shipped — ${order.orderNumber}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="margin:0;padding:0;background:#0a0a0c;font-family:'Figtree',system-ui,sans-serif;color:#f5f5f7;">
        <div style="max-width:560px;margin:40px auto;padding:0 20px;">
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;">
            <div style="margin-bottom:32px;"><span style="font-size:20px;font-weight:700;">Reflexity RAM</span></div>
            <h1 style="font-size:22px;font-weight:700;margin:0 0 12px;">Your order is on its way!</h1>
            <p style="color:#a0a0aa;margin:0 0 24px;line-height:1.6;">Hi ${escapeHtml(firstName)}, your order <span style="font-family:monospace;color:#f5f5f7;">${escapeHtml(order.orderNumber)}</span> has been shipped.</p>
            ${trackingUrl && order.trackingNumber ? `<p style="color:#a0a0aa;font-size:13px;">Canada Post tracking number: <a href="${escapeHtml(trackingUrl)}" style="font-family:monospace;color:#f5f5f7;">${escapeHtml(order.trackingNumber)}</a></p>` : ''}
            ${untracked ? `<p style="color:#a0a0aa;font-size:13px;line-height:1.6;">This parcel was sent without a tracking number, so there is nothing to follow online. Delivery usually takes 3–6 business days after dispatch. If it has not arrived by then, reply to this email and we will look into it.</p>` : ''}
            <a href="${escapeHtml(trackingUrl || orderUrl)}" style="display:inline-block;background:#f5f5f7;color:#050505;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:13px;margin-top:16px;">${trackingUrl ? 'Track your package' : 'View your order'}</a>
            ${trackingUrl ? `<p style="margin:16px 0 0;font-size:13px;"><a href="${escapeHtml(orderUrl)}" style="color:#a0a0aa;">View your order</a></p>` : ''}
          </div>
        </div>
      </body>
      </html>
    `,
  }, idempotencyKey ? { idempotencyKey } : undefined);

  if (error) failSend(error);
  return data;
};

/**
 * Send (or schedule, with `scheduledAt`) the post-delivery review request.
 * Resend holds a scheduled email for up to 30 days and returns its id, which
 * cancelScheduledEmail() needs if the order is refunded before it goes out.
 */
const sendReviewRequestEmail = async ({ email, firstName, order, reviewUrl, unsubscribeUrl, scheduledAt }) => {
  const itemsHtml = order.items.map(item => `
    <li style="margin:0 0 6px;color:#f5f5f7;font-size:13px;">${escapeHtml(item.name)}</li>
  `).join('');

  const { data, error } = await sendEmail({
    from: FROM_EMAIL,
    to: email,
    replyTo: SUPPORT_EMAIL,
    subject: `How's your order? — ${order.orderNumber}`,
    ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="margin:0;padding:0;background:#0a0a0c;font-family:'Figtree',system-ui,sans-serif;color:#f5f5f7;">
        <div style="max-width:560px;margin:40px auto;padding:0 20px;">
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;">
            <div style="margin-bottom:32px;"><span style="font-size:20px;font-weight:700;letter-spacing:-0.5px;">Reflexity RAM</span></div>
            <h1 style="font-size:22px;font-weight:700;margin:0 0 12px;letter-spacing:-0.5px;">How did it go?</h1>
            <p style="color:#a0a0aa;margin:0 0 20px;line-height:1.6;">Hi ${escapeHtml(firstName || 'there')}, your order <span style="font-family:monospace;color:#f5f5f7;">${escapeHtml(order.orderNumber)}</span> should have arrived by now. Once you've had a chance to install it, would you leave a quick review? It helps other buyers pick the right memory. Every review is published, good or bad.</p>
            <ul style="margin:0 0 28px;padding-left:18px;">${itemsHtml}</ul>
            <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#f5f5f7;color:#050505;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:14px;">Leave a review</a>
            <p style="color:#a0a0aa;font-size:13px;margin:28px 0 0;line-height:1.6;">Something not right with the order? Reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#8a8a92;">${SUPPORT_EMAIL}</a> and we'll sort it out.</p>
            <p style="color:#5a5a64;font-size:11px;margin:32px 0 0;line-height:1.6;">Reflexity RAM · Toronto, Ontario, Canada · <a href="${escapeHtml(FRONTEND_URL)}" style="color:#8a8a92;">reflexityram.com</a><br>We send one review email per order because you bought from us. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#8a8a92;">Unsubscribe from review emails</a>.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  });

  if (error) failSend(error);
  return data;
};

const cancelScheduledEmail = async (id) => {
  let result;
  try {
    result = await getResend().emails.cancel(id);
  } catch (error) {
    failSend(error, 'cancel');
  }
  if (result?.error) failSend(result.error, 'cancel');
  return result?.data;
};

// ─── Canada Post tracking updates (utils/trackingSync.js) ─────────────────────
const TRACKING_EMAILS = {
  outForDelivery: {
    subject: (n) => `Out for delivery today — ${n}`,
    title: 'Your order is out for delivery',
    text: 'Canada Post has your parcel out for delivery today.',
  },
  pickup: {
    subject: (n) => `Your parcel is waiting at the post office — ${n}`,
    title: 'Your parcel is waiting for you',
    text: 'Canada Post could not leave your parcel and is holding it for pickup. The notice card and the tracking page show where to collect it.',
  },
  delivered: {
    subject: (n) => `Delivered — ${n}`,
    title: 'Your order was delivered',
    text: 'Canada Post shows your parcel as delivered. Thank you for shopping with Reflexity RAM.',
  },
};

const sendTrackingUpdateEmail = async ({ email, firstName, order, kind }) => {
  const copy = TRACKING_EMAILS[kind];
  if (!copy) throw new Error(`Unknown tracking email: ${kind}`);
  const orderUrl = orderAccessUrl(FRONTEND_URL, order, email);
  const trackingUrl = trackingUrlFor(order);
  const { data, error } = await sendEmail({
    from: FROM_EMAIL,
    to: email,
    replyTo: SUPPORT_EMAIL,
    subject: copy.subject(order.orderNumber),
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="margin:0;padding:0;background:#0a0a0c;font-family:'Figtree',system-ui,sans-serif;color:#f5f5f7;">
        <div style="max-width:560px;margin:40px auto;padding:0 20px;">
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;">
            <div style="margin-bottom:32px;"><span style="font-size:20px;font-weight:700;">Reflexity RAM</span></div>
            <h1 style="font-size:22px;font-weight:700;margin:0 0 12px;">${copy.title}</h1>
            <p style="color:#a0a0aa;margin:0 0 24px;line-height:1.6;">Hi ${escapeHtml(firstName || 'there')}, ${copy.text} Order <span style="font-family:monospace;color:#f5f5f7;">${escapeHtml(order.orderNumber)}</span>.</p>
            <a href="${escapeHtml(trackingUrl || orderUrl)}" style="display:inline-block;background:#f5f5f7;color:#050505;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:13px;">${trackingUrl ? 'Track your package' : 'View your order'}</a>
            ${trackingUrl ? `<p style="margin:16px 0 0;font-size:13px;"><a href="${escapeHtml(orderUrl)}" style="color:#a0a0aa;">View your order</a></p>` : ''}
            <p style="color:#a0a0aa;font-size:13px;margin:28px 0 0;line-height:1.6;">Something not right? Reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#8a8a92;">${SUPPORT_EMAIL}</a>.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  });
  if (error) failSend(error);
  return data;
};

// ─── Payment notices: bank debit and Interac e-Transfer orders ─────────────────
// These orders exist before the money has cleared, so the buyer hears about each step by email. Each notice has its own
// subject, headline and paragraphs; the shell and the "View your order" button are shared.
const torontoTime = (value) => new Date(value).toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' });
const cad = (value) => `$${Number(value || 0).toFixed(2)} ${DISPLAY_CURRENCY}`;
const mono = (text) => `<span style="font-family:monospace;color:#f5f5f7;">${escapeHtml(text)}</span>`;

// "Not our contact email": WHEN the e-Transfer address is a different mailbox from the one printed in the footer and at the foot of
// every email, a buyer who is about to send money should not have to guess which is which. Only said when it is true (since
// 2026-10-13 the owner receives e-Transfers at the contact address itself, so today this adds nothing).
const etransferAddressNote = (order) => (etransferAddressDiffersFromContact(order.etransfer?.recipientEmail)
  ? [`Send the e-Transfer only to ${mono(order.etransfer.recipientEmail)}. Our contact email, ${escapeHtml(SUPPORT_EMAIL)}, is for questions only: please do not send the e-Transfer there.`]
  : []);

const PAYMENT_NOTICES = {
  // Interac e-Transfer: placed, waiting for the buyer's transfer.
  etransferInstructions: {
    subject: (order) => `Send your e-Transfer to confirm order ${order.orderNumber}`,
    title: 'One more step: send your e-Transfer',
    paragraphs: (order) => [
      `We received your order ${mono(order.orderNumber)} and are holding your items. It is confirmed, and shipped, as soon as your Interac e-Transfer arrives.`,
      `<strong style="color:#f5f5f7;">Send exactly ${escapeHtml(cad(order.etransfer?.amountDue ?? order.total))}</strong> by Interac e-Transfer to ${mono(order.etransfer?.recipientEmail || '')}.`
        + ` You can put ${mono(order.orderNumber)} in the transfer's message: it is optional, but it helps us match your payment.`,
      ...etransferAddressNote(order),
      `Do it before <strong style="color:#f5f5f7;">${escapeHtml(order.etransfer?.expiresAt ? torontoTime(order.etransfer.expiresAt) : 'the deadline')}</strong> (Toronto time), or the items go back on sale and the order is cancelled.`,
      'Deposit is automatic: you do not need a security question or password. We check payments by hand during the day, so allow a little time for the confirmation email.',
      `Only pay the address above. We never ask you to send money anywhere else. If an email tells you to, do not pay it and write to ${escapeHtml(SUPPORT_EMAIL)}.`,
      `Did not place this order? Ignore this email and do not send anything: someone may have typed your address by mistake, and the order is cancelled by itself if no transfer arrives.`,
    ],
  },
  etransferReminder: {
    subject: (order) => `We have not received your e-Transfer yet: ${order.orderNumber}`,
    title: 'Still waiting for your e-Transfer',
    paragraphs: (order) => [
      `Your order ${mono(order.orderNumber)} is on hold, but we have not received the Interac e-Transfer yet.`,
      `Send exactly ${escapeHtml(cad(order.etransfer?.amountDue ?? order.total))} to ${mono(order.etransfer?.recipientEmail || '')}`
        + ` before ${escapeHtml(order.etransfer?.expiresAt ? torontoTime(order.etransfer.expiresAt) : 'the deadline')} (Toronto time).`
        + ` Putting ${mono(order.orderNumber)} in the message is optional, but it helps us match your payment.`,
      ...etransferAddressNote(order),
      `Already sent it? Thank you: we confirm payments by hand, so it can take a little while. Questions: ${escapeHtml(SUPPORT_EMAIL)}.`,
    ],
  },
  etransferExpired: {
    subject: (order) => `Order ${order.orderNumber} was cancelled: no e-Transfer received`,
    title: 'Your order was cancelled',
    paragraphs: (order) => [
      `We did not receive the Interac e-Transfer for order ${mono(order.orderNumber)} in time, so we released the items and cancelled the order. Nothing was charged.`,
      `Sent it just now, or still want the items? Write to ${escapeHtml(SUPPORT_EMAIL)} straight away and we will see if we can still help. Otherwise you are welcome to order again.`,
    ],
  },
  // Bank debit (pre-authorized debit through Stripe): the debit is submitted, the bank takes days to confirm it.
  bankDebitReceived: {
    subject: (order) => `We received your order ${order.orderNumber}: bank debit processing`,
    title: 'Order received: your bank is processing the payment',
    paragraphs: (order) => [
      `Thank you! Your order ${mono(order.orderNumber)} is placed and your items are held for you.`,
      `A bank debit takes up to 5 business days to clear. <strong style="color:#f5f5f7;">We ship as soon as it does</strong> and will email you right away.`,
      `If the debit does not go through we will email you, and nothing is shipped. Questions: ${escapeHtml(SUPPORT_EMAIL)}.`,
    ],
  },
  bankDebitFailed: {
    subject: (order) => `Your bank debit for order ${order.orderNumber} did not go through`,
    title: 'Your payment did not go through',
    paragraphs: (order) => [
      `Your bank did not complete the debit for order ${mono(order.orderNumber)} (for example, not enough funds, or the account details could not be confirmed), so the order was cancelled and nothing was shipped.`,
      `You are welcome to order again and pay another way. Questions: ${escapeHtml(SUPPORT_EMAIL)}.`,
    ],
  },
};

const sendPaymentNoticeEmail = async ({ email, firstName, order, kind, idempotencyKey }) => {
  const notice = PAYMENT_NOTICES[kind];
  if (!notice) throw new Error(`Unknown payment notice: ${kind}`);
  const orderUrl = orderAccessUrl(FRONTEND_URL, order, email);
  const { data, error } = await sendEmail({
    from: FROM_EMAIL,
    to: email,
    replyTo: SUPPORT_EMAIL,
    subject: notice.subject(order),
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="margin:0;padding:0;background:#0a0a0c;font-family:'Figtree',system-ui,sans-serif;color:#f5f5f7;">
        <div style="max-width:560px;margin:40px auto;padding:0 20px;">
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;">
            <div style="margin-bottom:32px;"><span style="font-size:20px;font-weight:700;">Reflexity RAM</span></div>
            <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;">${escapeHtml(notice.title)}</h1>
            <p style="color:#a0a0aa;margin:0 0 16px;line-height:1.6;">Hi ${escapeHtml(firstName || 'there')},</p>
            ${notice.paragraphs(order).map((paragraph) => `<p style="color:#a0a0aa;margin:0 0 16px;line-height:1.6;font-size:14px;">${paragraph}</p>`).join('')}
            <a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:#f5f5f7;color:#050505;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:13px;margin-top:8px;">View your order</a>
          </div>
        </div>
      </body>
      </html>
    `,
  }, idempotencyKey ? { idempotencyKey } : undefined);
  if (error) failSend(error);
  return data;
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendOrderConfirmationEmail,
  sendShippingNotificationEmail,
  sendTrackingUpdateEmail,
  sendReviewRequestEmail,
  cancelScheduledEmail,
  sendPaymentNoticeEmail,
  PAYMENT_NOTICES,
};
