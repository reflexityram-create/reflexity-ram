const crypto = require('crypto');

// Review links let a buyer review an order without an account (guest
// checkouts have none). The token names the order and an expiry, signed with
// a key derived from JWT_SECRET under its own label, so it can never be
// mistaken for a session token or forged without the server secret.
const TOKEN_VERSION = 'r1';
const DEFAULT_TTL_DAYS = 365;
const ORDER_ID = /^[a-f0-9]{24}$/;

function signingKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required to sign review links');
  return crypto.createHmac('sha256', secret).update('reflexity:order-review-link:v1').digest();
}

const sign = (payload) => crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');

function createReviewToken(orderId, { now = Date.now(), ttlDays = DEFAULT_TTL_DAYS } = {}) {
  const id = String(orderId);
  if (!ORDER_ID.test(id)) throw new Error('Review links need an order id');
  const expires = Math.floor(now / 1000) + Math.round(ttlDays * 86400);
  const payload = `${TOKEN_VERSION}.${id}.${expires.toString(36)}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns { orderId } for a genuine, unexpired token, otherwise null. */
function verifyReviewToken(token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [version, orderId, expires, signature] = parts;
  if (version !== TOKEN_VERSION || !ORDER_ID.test(orderId) || !/^[0-9a-z]{1,10}$/.test(expires)) return null;

  const expected = Buffer.from(sign(`${version}.${orderId}.${expires}`));
  const supplied = Buffer.from(signature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  if (parseInt(expires, 36) * 1000 <= now) return null;
  return { orderId };
}

// The token rides in the URL fragment, which browsers never send to a server
// or put in a Referer header, so it stays out of logs and analytics.
function reviewPageUrl(frontendUrl, token, { unsubscribe = false } = {}) {
  const url = new URL('/review', frontendUrl);
  const params = new URLSearchParams({ t: token });
  if (unsubscribe) params.set('unsubscribe', '1');
  url.hash = params.toString();
  return url.toString();
}

module.exports = { createReviewToken, verifyReviewToken, reviewPageUrl };
