const { Resend } = require('resend');
const { CURRENCY } = require('../config/shipping');
const { escapeHtml } = require('./htmlEscape');
const { orderAccessUrl } = require('./orderAccessLink');

const resend = new Resend(process.env.RESEND_API_KEY);
const DISPLAY_CURRENCY = CURRENCY.toUpperCase();

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
  const verifyUrl = `${FRONTEND_URL}/verify-email?token=${token}`;

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
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

  if (error) { console.error('Resend error detail:', JSON.stringify(error)); throw new Error(`Email send failed: ${error.message || JSON.stringify(error)}`); }
  return data;
};

/**
 * Send password reset email
 */
const sendPasswordResetEmail = async ({ email, firstName, token }) => {
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
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

  if (error) { console.error('Resend error detail:', JSON.stringify(error)); throw new Error(`Email send failed: ${error.message || JSON.stringify(error)}`); }
  return data;
};

/**
 * Send order confirmation email
 */
const sendOrderConfirmationEmail = async ({ email, firstName, order }) => {
  const orderUrl = orderAccessUrl(FRONTEND_URL, order, email);

  const itemsHtml = order.items.map(item => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:13px;color:#f5f5f7;">${escapeHtml(item.name)}</div>
        <div style="font-size:11px;color:#5a5a64;font-family:monospace;">${escapeHtml(item.sku)}</div>
      </td>
      <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);text-align:center;color:#a0a0aa;font-size:13px;">${item.qty}</td>
      <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);text-align:right;font-family:monospace;font-size:13px;">$${(item.price * item.qty).toFixed(2)} ${DISPLAY_CURRENCY}</td>
    </tr>
  `).join('');

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
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
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="color:#a0a0aa;font-size:13px;">Shipping</span>
                <span style="font-family:monospace;font-size:13px;">${order.shippingCost === 0 ? 'Free' : '$' + order.shippingCost.toFixed(2) + ' ' + DISPLAY_CURRENCY}</span>
              </div>
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
  });

  if (error) { console.error('Resend error detail:', JSON.stringify(error)); throw new Error(`Email send failed: ${error.message || JSON.stringify(error)}`); }
  return data;
};

/**
 * Send shipping notification email
 */
const sendShippingNotificationEmail = async ({ email, firstName, order }) => {
  const orderUrl = orderAccessUrl(FRONTEND_URL, order, email);

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
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
            ${order.trackingNumber ? `<p style="color:#a0a0aa;font-size:13px;">Tracking: <span style="font-family:monospace;color:#f5f5f7;">${escapeHtml(order.trackingNumber)}</span></p>` : ''}
            <a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:#f5f5f7;color:#050505;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:13px;margin-top:16px;">Track Order</a>
          </div>
        </div>
      </body>
      </html>
    `,
  });

  if (error) { console.error('Resend error detail:', JSON.stringify(error)); throw new Error(`Email send failed: ${error.message || JSON.stringify(error)}`); }
  return data;
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendOrderConfirmationEmail,
  sendShippingNotificationEmail,
};
