const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

// Swap the Resend SDK out before email.js loads so no test can send a real email.
const sent = [];
const cancelled = [];
let failNextSend = null;
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath,
  filename: resendPath,
  loaded: true,
  exports: {
    Resend: class {
      constructor() {
        this.emails = {
          send: async (message) => {
            if (failNextSend) {
              const error = failNextSend;
              failNextSend = null;
              return { data: null, error };
            }
            sent.push(message);
            return { data: { id: `email_${sent.length}` }, error: null };
          },
          cancel: async (id) => {
            cancelled.push(id);
            return { data: { id }, error: null };
          },
        };
      }
    },
  },
};
process.env.FRONTEND_URL = 'https://reflexityram.com';
process.env.JWT_SECRET = 'review-request-test-secret';
delete process.env.REVIEW_REQUEST_DELAY_DAYS;

const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const Review = require('../src/models/Review');
const User = require('../src/models/User');
const ReviewEmailOptOut = require('../src/models/ReviewEmailOptOut');
const { createReviewToken, verifyReviewToken, reviewPageUrl } = require('../src/utils/reviewLinks');
const { sendReviewRequestEmail } = require('../src/utils/email');
const { scheduleReviewRequest, cancelReviewRequest } = require('../src/utils/reviewRequests');
const reviewsRouter = require('../src/routes/reviews');
const adminRouter = require('../src/routes/admin');

const ORDER_ID = '64b7f0c2a1b2c3d4e5f60718';
const PRODUCT_ID = '64b7f0c2a1b2c3d4e5f60719';
const OTHER_PRODUCT_ID = '64b7f0c2a1b2c3d4e5f6071a';
const DAY = 24 * 60 * 60 * 1000;
const SHIPPED_AT = new Date('2026-10-05T15:00:00Z');

const order = (overrides = {}) => ({
  _id: ORDER_ID,
  orderNumber: 'RFX-REVIEW-1',
  status: 'shipped',
  paymentStatus: 'paid',
  shippedAt: SHIPPED_AT,
  guestEmail: 'buyer@example.com',
  shippingAddress: { firstName: 'Sam', lastName: 'Buyer' },
  items: [
    { product: PRODUCT_ID, slug: 'samsung-64gb', name: 'Samsung 64GB DDR4', qty: 1, price: 585 },
    { product: OTHER_PRODUCT_ID, slug: 'lenovo-16gb', name: 'Lenovo 16GB <ECC>', qty: 2, price: 120 },
  ],
  ...overrides,
});

// A chainable stand-in for a Mongoose query (select/populate/lean/sort, then await).
const query = (value) => {
  const chain = {
    select: () => chain,
    populate: () => chain,
    lean: () => chain,
    sort: () => chain,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return chain;
};

// Replace model statics for one test and put the originals back afterwards.
function stub(t, model, methods) {
  for (const [name, impl] of Object.entries(methods)) {
    const original = model[name];
    model[name] = impl;
    t.after(() => { model[name] = original; });
  }
}

async function request(app, method, path, body, headers = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const mount = (path, router) => {
  const app = express();
  app.use(express.json());
  app.use(path, router);
  return app;
};

const tokenFromUrl = (url) => new URLSearchParams(new URL(url).hash.slice(1)).get('t');
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map(([, href]) => href.replaceAll('&amp;', '&'));

test.beforeEach(() => {
  sent.length = 0;
  cancelled.length = 0;
  failNextSend = null;
});

// ─── Signed review links ───────────────────────────────────────────────────

test('a review link names its order and rejects tampering, expiry and other secrets', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  const token = createReviewToken(ORDER_ID, { now });
  assert.deepEqual(verifyReviewToken(token, { now }), { orderId: ORDER_ID });

  const [version, id, expires, signature] = token.split('.');
  const otherOrder = `${id.slice(0, -1)}${id.endsWith('8') ? '9' : '8'}`;
  assert.equal(verifyReviewToken([version, otherOrder, expires, signature].join('.'), { now }), null);
  assert.equal(verifyReviewToken([version, id, expires, `${signature.slice(0, -1)}A`].join('.'), { now }), null);
  assert.equal(verifyReviewToken([version, id, (parseInt(expires, 36) + 1).toString(36), signature].join('.'), { now }), null);
  assert.equal(verifyReviewToken(token, { now: now + 366 * DAY }), null, 'links expire after a year');
  assert.equal(verifyReviewToken('not-a-token'), null);
  assert.equal(verifyReviewToken(undefined), null);

  const original = process.env.JWT_SECRET;
  try {
    process.env.JWT_SECRET = 'a-different-deployment-secret';
    assert.equal(verifyReviewToken(token, { now }), null);
  } finally {
    process.env.JWT_SECRET = original;
  }
});

test('a session JWT signed with the same secret is not a review link, and vice versa', () => {
  const sessionToken = jwt.sign({ id: ORDER_ID, av: 0 }, process.env.JWT_SECRET);
  assert.equal(verifyReviewToken(sessionToken), null);
  assert.throws(() => jwt.verify(createReviewToken(ORDER_ID), process.env.JWT_SECRET));
});

test('the review page URL keeps the token in the fragment so servers and analytics never see it', () => {
  const url = new URL(reviewPageUrl('https://reflexityram.com', 'r1.token', { unsubscribe: true }));
  assert.equal(url.origin + url.pathname, 'https://reflexityram.com/review');
  assert.equal(url.search, '');
  assert.equal(url.hash, '#t=r1.token&unsubscribe=1');
});

// ─── The email ─────────────────────────────────────────────────────────────

test('the review email links to the review page, can be scheduled, and escapes order data', async () => {
  const scheduledAt = new Date('2026-10-15T15:00:00Z');
  await sendReviewRequestEmail({
    email: 'buyer@example.com',
    firstName: '<Sam>',
    order: order(),
    reviewUrl: 'https://reflexityram.com/review#t=abc',
    unsubscribeUrl: 'https://reflexityram.com/review#t=abc&unsubscribe=1',
    scheduledAt,
  });
  assert.equal(sent.length, 1);
  const [message] = sent;
  assert.equal(message.to, 'buyer@example.com');
  assert.equal(message.replyTo, 'reflexityram@gmail.com');
  assert.equal(message.scheduledAt, '2026-10-15T15:00:00.000Z');
  assert.match(message.subject, /RFX-REVIEW-1/);
  assert.ok(hrefs(message.html).includes('https://reflexityram.com/review#t=abc'));
  assert.ok(hrefs(message.html).includes('https://reflexityram.com/review#t=abc&unsubscribe=1'));
  assert.match(message.html, /Unsubscribe from review emails/);
  assert.match(message.html, /Lenovo 16GB &lt;ECC&gt;/);
  assert.match(message.html, /Hi &lt;Sam&gt;/);
  assert.doesNotMatch(message.html, /<Sam>|<ECC>/);

  sent.length = 0;
  await sendReviewRequestEmail({ email: 'b@example.com', firstName: 'B', order: order(), reviewUrl: 'https://x.test/r', unsubscribeUrl: 'https://x.test/u' });
  assert.equal('scheduledAt' in sent[0], false, 'an immediate send carries no schedule');
});

// ─── Scheduling ────────────────────────────────────────────────────────────

const recordUpdates = (t, { claimWins = true } = {}) => {
  const updates = [];
  stub(t, Order, {
    updateOne: async (filter, update) => {
      updates.push({ filter, update });
      const isClaim = Object.hasOwn(filter, 'reviewRequest.claimedAt');
      return { modifiedCount: isClaim && !claimWins ? 0 : 1 };
    },
  });
  return updates;
};

test('marking an order shipped schedules one review email ten days later with a working link', async (t) => {
  stub(t, ReviewEmailOptOut, { exists: async () => null });
  const updates = recordUpdates(t);
  const now = new Date(SHIPPED_AT);

  const result = await scheduleReviewRequest(order(), { now });
  assert.equal(result.status, 'scheduled');
  assert.equal(result.scheduledFor.toISOString(), new Date(SHIPPED_AT.getTime() + 10 * DAY).toISOString());

  assert.equal(sent.length, 1);
  assert.equal(sent[0].scheduledAt, result.scheduledFor.toISOString());
  const reviewLink = hrefs(sent[0].html).find((href) => href.startsWith('https://reflexityram.com/review#') && !href.includes('unsubscribe'));
  assert.deepEqual(verifyReviewToken(tokenFromUrl(reviewLink)), { orderId: ORDER_ID });

  // Claimed first (only when unclaimed), then the Resend id and date are kept for cancelling.
  assert.deepEqual(updates[0].filter, { _id: ORDER_ID, 'reviewRequest.claimedAt': null });
  assert.equal(updates[0].update.$set['reviewRequest.claimedAt'], now);
  assert.deepEqual(updates[1].update.$set, {
    'reviewRequest.scheduledFor': result.scheduledFor,
    'reviewRequest.emailId': 'email_1',
  });
});

test('an order never gets a second review email', async (t) => {
  stub(t, ReviewEmailOptOut, { exists: async () => null });
  recordUpdates(t, { claimWins: false });
  const result = await scheduleReviewRequest(order(), { now: SHIPPED_AT });
  assert.deepEqual(result, { status: 'skipped', reason: 'already-requested' });
  assert.equal(sent.length, 0);
});

test('unpaid, unshipped, unsubscribed and email-less orders are skipped before anything is claimed', async (t) => {
  let optedOut = false;
  stub(t, ReviewEmailOptOut, { exists: async () => (optedOut ? { _id: 'opt-out' } : null) });
  const updates = recordUpdates(t);

  assert.equal((await scheduleReviewRequest(order({ paymentStatus: 'pending' }))).reason, 'not-reviewable');
  assert.equal((await scheduleReviewRequest(order({ status: 'processing' }))).reason, 'not-reviewable');
  assert.equal((await scheduleReviewRequest(order({ status: 'refunded', paymentStatus: 'refunded' }))).reason, 'not-reviewable');
  assert.equal((await scheduleReviewRequest(order({ guestEmail: undefined }))).reason, 'no-email');
  optedOut = true;
  assert.equal((await scheduleReviewRequest(order())).reason, 'opted-out');

  assert.equal(updates.length, 0);
  assert.equal(sent.length, 0);
});

test('a send failure releases the claim so the order screen can retry', async (t) => {
  stub(t, ReviewEmailOptOut, { exists: async () => null });
  const updates = recordUpdates(t);
  failNextSend = { message: 'Resend is down' };

  await assert.rejects(scheduleReviewRequest(order(), { now: SHIPPED_AT }), /Resend is down/);
  const release = updates.at(-1).update;
  assert.deepEqual(release.$unset, { 'reviewRequest.claimedAt': '' });
  assert.match(release.$set['reviewRequest.lastError'], /Resend is down/);
});

test('"send now" goes out immediately and late shipments are capped inside Resend\'s window', async (t) => {
  stub(t, ReviewEmailOptOut, { exists: async () => null });
  recordUpdates(t);
  const now = new Date('2026-10-20T12:00:00Z');

  const immediate = await scheduleReviewRequest(order(), { now, sendAt: now });
  assert.equal(immediate.status, 'sent');
  assert.equal('scheduledAt' in sent[0], false);

  const far = await scheduleReviewRequest(order(), { now, sendAt: new Date(now.getTime() + 60 * DAY) });
  assert.equal(far.scheduledFor.toISOString(), new Date(now.getTime() + 29 * DAY).toISOString());
});

test('a refund cancels a review email that has not gone out yet, and only that', async (t) => {
  const updates = recordUpdates(t);
  const now = new Date('2026-10-08T00:00:00Z');
  const pending = { _id: ORDER_ID, reviewRequest: { emailId: 'email_pending', scheduledFor: new Date('2026-10-15T00:00:00Z') } };

  assert.equal(await cancelReviewRequest(pending, { now }), true);
  assert.deepEqual(cancelled, ['email_pending']);
  assert.equal(updates[0].update.$set['reviewRequest.cancelledAt'], now);

  assert.equal(await cancelReviewRequest({ ...pending, reviewRequest: { ...pending.reviewRequest, scheduledFor: new Date('2026-10-01') } }, { now }), false);
  assert.equal(await cancelReviewRequest({ ...pending, reviewRequest: { ...pending.reviewRequest, cancelledAt: now } }, { now }), false);
  assert.equal(await cancelReviewRequest({ _id: ORDER_ID }, { now }), false);
  assert.deepEqual(cancelled, ['email_pending']);
});

// ─── The review page API ───────────────────────────────────────────────────

const products = [
  { _id: PRODUCT_ID, slug: 'samsung-64gb', name: 'Samsung 64GB DDR4', images: [{ url: 'https://cdn.test/samsung.jpg' }], isActive: true },
  { _id: OTHER_PRODUCT_ID, slug: 'lenovo-16gb', name: 'Lenovo 16GB', images: [], isActive: false },
];

function stubReviewPage(t, { orderValue = order(), existingReviews = [], optedOut = false } = {}) {
  const created = [];
  stub(t, Order, { findById: (id) => query(String(id) === ORDER_ID ? orderValue : null) });
  stub(t, Product, { find: () => query(products) });
  stub(t, Review, {
    find: () => query(existingReviews),
    create: async (values) => {
      created.push(values);
      return { ...values, createdAt: new Date('2026-10-16T00:00:00Z') };
    },
  });
  stub(t, ReviewEmailOptOut, { exists: async () => (optedOut ? { _id: 'opt-out' } : null) });
  return created;
}

const reviewsApp = () => mount('/api/reviews', reviewsRouter);
const token = () => createReviewToken(ORDER_ID);

test('a guest opens the link and sees what they can review, without the email address leaking', async (t) => {
  stubReviewPage(t, { existingReviews: [] });
  const response = await request(reviewsApp(), 'POST', '/api/reviews/request/lookup', { token: token() });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.order, { orderNumber: 'RFX-REVIEW-1', firstName: 'Sam' });
  assert.equal(response.body.eligible, true);
  assert.equal(response.body.unsubscribed, false);
  assert.deepEqual(response.body.items.map(({ slug, reviewable, review }) => ({ slug, reviewable, review })), [
    { slug: 'samsung-64gb', reviewable: true, review: null },
    { slug: 'lenovo-16gb', reviewable: false, review: null },
  ]);
  assert.equal(response.body.items[0].image, 'https://cdn.test/samsung.jpg');
  assert.equal(response.body.emailHint, 'b••••@example.com');
  assert.doesNotMatch(JSON.stringify(response.body), /buyer@example\.com|productId/);
});

test('a bad or expired link is refused', async (t) => {
  stubReviewPage(t);
  const expired = createReviewToken(ORDER_ID, { now: Date.now() - 400 * DAY });
  for (const value of [expired, `${token()}x`, 'r1.0000000000000000000000000.zz.sig']) {
    const response = await request(reviewsApp(), 'POST', '/api/reviews/request/lookup', { token: value });
    assert.equal(response.status, 401, value);
  }
  const missing = await request(reviewsApp(), 'POST', '/api/reviews/request/lookup', {});
  assert.equal(missing.status, 400);
});

test('a guest review is published as a verified purchase under their first name', async (t) => {
  const created = stubReviewPage(t);
  const response = await request(reviewsApp(), 'POST', '/api/reviews/request/reviews', {
    token: token(), slug: 'samsung-64gb', rating: 4, title: 'Works in my R740', body: 'Recognized at full speed on first boot.',
  });
  assert.equal(response.status, 201);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0], {
    product: PRODUCT_ID,
    order: ORDER_ID,
    user: undefined,
    displayName: 'Sam',
    rating: 4,
    title: 'Works in my R740',
    body: 'Recognized at full speed on first boot.',
    verifiedPurchase: true,
    status: 'approved',
    source: 'email-link',
  });
  assert.equal(response.body.review.slug, 'samsung-64gb');
});

test('an account order reviewed by link is tied to the account, so it cannot be reviewed twice', async (t) => {
  const created = stubReviewPage(t, {
    orderValue: order({ guestEmail: undefined, user: { _id: 'user-1', firstName: 'Alex', email: 'alex@example.com' } }),
  });
  const response = await request(reviewsApp(), 'POST', '/api/reviews/request/reviews', {
    token: token(), slug: 'samsung-64gb', rating: 5, body: 'Exactly as described, fast shipping.',
  });
  assert.equal(response.status, 201);
  assert.equal(created[0].user, 'user-1');
  assert.equal(created[0].displayName, 'Alex');
});

test('link reviews are refused for refunds, other products, delisted products and repeats', async (t) => {
  const submit = (slug) => request(reviewsApp(), 'POST', '/api/reviews/request/reviews', {
    token: token(), slug, rating: 5, body: 'A perfectly fine review body.',
  });

  await t.test('refunded order', async (st) => {
    stubReviewPage(st, { orderValue: order({ status: 'refunded', paymentStatus: 'refunded' }) });
    assert.equal((await submit('samsung-64gb')).status, 403);
  });
  await t.test('product not in the order', async (st) => {
    stubReviewPage(st);
    assert.equal((await submit('some-other-module')).status, 404);
  });
  await t.test('delisted product', async (st) => {
    stubReviewPage(st);
    assert.equal((await submit('lenovo-16gb')).status, 409);
  });
  await t.test('already reviewed', async (st) => {
    const created = stubReviewPage(st, {
      existingReviews: [{ product: PRODUCT_ID, rating: 5, body: 'Earlier review', createdAt: new Date() }],
    });
    const response = await submit('samsung-64gb');
    assert.equal(response.status, 409);
    assert.equal(created.length, 0);
  });
});

test('unsubscribing records the address and cancels review emails still waiting to go out', async (t) => {
  stubReviewPage(t);
  const optOuts = [];
  stub(t, ReviewEmailOptOut, {
    updateOne: async (filter, update, options) => { optOuts.push({ filter, update, options }); return { upsertedCount: 1 }; },
  });
  stub(t, User, { find: () => query([]) });
  const later = { _id: 'later-order', reviewRequest: { emailId: 'email_later', scheduledFor: new Date(Date.now() + 5 * DAY) } };
  stub(t, Order, {
    find: () => query([later]),
    updateOne: async () => ({ modifiedCount: 1 }),
  });

  const response = await request(reviewsApp(), 'POST', '/api/reviews/request/unsubscribe', { token: token() });
  assert.equal(response.status, 200);
  assert.equal(response.body.unsubscribed, true);
  assert.deepEqual(optOuts[0].filter, { email: 'buyer@example.com' });
  assert.deepEqual(optOuts[0].options, { upsert: true });
  assert.deepEqual(cancelled, ['email_later']);
});

// ─── Admin ─────────────────────────────────────────────────────────────────

function stubAdmin(t) {
  const admin = { _id: 'admin-1', role: 'admin', isActive: true, authVersion: 0 };
  stub(t, User, { findById: () => query(admin) });
  return { Authorization: `Bearer ${jwt.sign({ id: 'admin-1', av: 0 }, process.env.JWT_SECRET)}` };
}

test('marking an order shipped sends the shipping email now and schedules the review email', async (t) => {
  const headers = stubAdmin(t);
  const shipped = order({ shippedAt: new Date() });
  stub(t, Order, {
    findById: () => query({ ...shipped, status: 'processing' }),
    findOneAndUpdate: () => query(shipped),
  });
  recordUpdates(t);
  stub(t, ReviewEmailOptOut, { exists: async () => null });

  const response = await request(mount('/api/admin', adminRouter), 'PATCH', `/api/admin/orders/${ORDER_ID}/status`, {
    status: 'shipped', trackingNumber: 'CP123',
  }, headers);
  assert.equal(response.status, 200);
  assert.equal(sent.length, 2);
  const [shippingEmail, reviewEmail] = sent;
  assert.match(shippingEmail.subject, /has shipped/);
  assert.equal('scheduledAt' in shippingEmail, false);
  assert.match(reviewEmail.subject, /How's your order/);
  const delay = Date.parse(reviewEmail.scheduledAt) - shipped.shippedAt.getTime();
  assert.equal(Math.round(delay / DAY), 10);
});

test('the admin "send review email now" button sends once and explains a refusal', async (t) => {
  const headers = stubAdmin(t);
  stub(t, Order, { findById: () => query(order()) });
  let claimed = false;
  stub(t, Order, {
    updateOne: async (filter) => {
      const isClaim = Object.hasOwn(filter, 'reviewRequest.claimedAt');
      if (isClaim && claimed) return { modifiedCount: 0 };
      if (isClaim) claimed = true;
      return { modifiedCount: 1 };
    },
  });
  stub(t, ReviewEmailOptOut, { exists: async () => null });
  const app = mount('/api/admin', adminRouter);

  const first = await request(app, 'POST', `/api/admin/orders/${ORDER_ID}/review-request`, undefined, headers);
  assert.equal(first.status, 200);
  assert.equal(first.body.reviewRequest.status, 'sent');
  assert.equal(sent.length, 1);
  assert.equal('scheduledAt' in sent[0], false);

  const second = await request(app, 'POST', `/api/admin/orders/${ORDER_ID}/review-request`, undefined, headers);
  assert.equal(second.status, 409);
  assert.match(second.body.error, /already sent or scheduled/);
  assert.equal(sent.length, 1);
});

// ─── Refunds ───────────────────────────────────────────────────────────────

test('a full Stripe refund cancels the review email that is still waiting to go out', async (t) => {
  process.env.STRIPE_SECRET_KEY ||= 'sk_test_review_refund_unit_test';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_review_refund_unit_test';
  const stripeRouter = require('../src/routes/stripe');
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  const refunded = order({
    statusHistory: [],
    reviewRequest: { emailId: 'email_waiting', scheduledFor: new Date(Date.now() + 5 * DAY) },
    save: async () => undefined,
  });
  stub(t, Order, { findOne: async () => refunded, updateOne: async () => ({ modifiedCount: 1 }) });

  const payload = JSON.stringify({
    id: 'evt_review_refund',
    object: 'event',
    type: 'charge.refunded',
    data: { object: { id: 'ch_review', object: 'charge', refunded: true, payment_intent: 'pi_review', amount_refunded: 58500 } },
  });
  const app = express();
  app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
  app.use('/api/stripe', stripeRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stripe/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }),
      },
      body: payload,
    });
    assert.equal(response.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(refunded.status, 'refunded');
  assert.deepEqual(cancelled, ['email_waiting']);
});
