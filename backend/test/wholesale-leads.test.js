const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const Product = require('../src/models/Product');

const { createLeadRouter, failureReason } = require('../src/routes/leads');
const { buildLeadEmail, sendLeadEmail } = require('../src/utils/leads');
const feedRouter = require('../src/routes/feed');
const { VALID_SLUGS } = require('../src/routes/pages');
const { STATIC_PAGES } = require('../src/config/sitemap');
const { resolveGoogleUser, oauthStateCookie, readOauthStateCookie } = require('../src/routes/auth');
const { createWholesaleRouter } = require('../src/routes/wholesale');

async function request(app, path, body) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, text: await response.text() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function leadApp(sendLead, WholesaleLotModel) {
  const app = express();
  app.use(express.json());
  app.use('/api/leads', createLeadRouter({ sendLead, WholesaleLotModel }));
  return app;
}

const validLead = {
  intent: 'buy',
  requestId: 'A8D4E8F1-87B1-4A49-9B2A-0123456789AB',
  name: '  Alex Buyer  ',
  company: '  Example Reseller  ',
  email: 'alex@example.test',
  productType: '  ECC RDIMM  ',
  sourceType: 'catalog-product',
  sourceId: 'product-123',
  sourceCode: 'samsung-32gb-ddr4',
  sku: 'SKU-32ECC',
  itemTitle: 'Samsung 32GB DDR4 ECC RDIMM',
  partNumber: 'M393A4K40CB2-CTD7Q',
  specification: '32GB DDR4 ECC RDIMM',
  quantity: '600',
  notes: '<stock request>',
};

function completePublishedWholesaleLot(id, overrides = {}) {
  return {
    _id: id, lotCode: 'WS-2026-DETAIL', title: 'Samsung 32GB Server Memory', brand: 'Samsung', mpn: 'M393A4K40DB3-CWE',
    generation: 'DDR4', formFactor: 'RDIMM', capacityLabel: '32GB', speedLabel: '3200 MT/s', condition: 'Used',
    testStatus: 'Individually tested', warranty: 'Terms confirmed by quote', shipFrom: 'Toronto, Canada',
    quantityAvailable: 12, minimumOrderQuantity: 1, orderIncrement: 1, quoteOnly: true,
    status: 'published', visibility: 'public', archivedAt: null, publishedAt: new Date('2026-09-11T00:00:00.000Z'),
    image: { url: 'https://res.cloudinary.com/fike/image/upload/v1/reflexity-ram/wholesale/lot.webp', publicId: 'reflexity-ram/wholesale/lot' },
    ...overrides,
  };
}

test('lead endpoint validates and sends only normalized wholesale enquiries', async () => {
  const sent = [];
  const response = await request(leadApp(async (lead) => sent.push(lead)), '/api/leads', validLead);

  assert.equal(response.status, 202);
  assert.deepEqual(JSON.parse(response.text), { success: true });
  assert.deepEqual(sent, [{
    intent: 'buy', requestId: 'a8d4e8f1-87b1-4a49-9b2a-0123456789ab', name: 'Alex Buyer', company: 'Example Reseller', email: 'alex@example.test',
    productType: 'ECC RDIMM', sourceType: 'catalog-product', sourceId: 'product-123',
    sourceCode: 'samsung-32gb-ddr4', sku: 'SKU-32ECC', itemTitle: 'Samsung 32GB DDR4 ECC RDIMM',
    partNumber: 'M393A4K40CB2-CTD7Q', specification: '32GB DDR4 ECC RDIMM', quantity: 600, notes: '<stock request>',
  }]);

  const invalid = await request(leadApp(async () => assert.fail('must not send')), '/api/leads', {
    ...validLead, intent: 'retail', requestId: 'not-a-uuid', email: 'not-an-email', quantity: 0,
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(JSON.parse(invalid.text), { error: 'Please check the required fields and try again.' });
});

test('wholesale lot source details are resolved server-side and cannot be spoofed', async () => {
  const id = '64b64c66a2d15e51234abcde';
  const lot = completePublishedWholesaleLot(id, {
    lotCode: 'WS-2026-CANONICAL', title: 'Canonical Samsung Server Memory', mpn: 'M393A4K40DB3-CWE',
  });
  const Model = {
    findOne(filter) {
      const matches = filter._id === id && filter.status === 'published' && filter.visibility === 'public'
        && filter.quoteOnly === true && filter.archivedAt === null;
      return { lean: async () => (matches ? { ...lot } : null) };
    },
  };
  const sent = [];
  const response = await request(leadApp(async (lead) => sent.push(lead), Model), '/api/leads', {
    ...validLead,
    sourceType: 'wholesale-lot', sourceId: id, sourceCode: 'WS-SPOOFED', sku: 'BUYER-REFERENCE',
    itemTitle: 'Spoofed item title', partNumber: 'SPOOFED-MPN',
  });
  assert.equal(response.status, 202);
  assert.equal(sent.length, 1);
  assert.deepEqual({
    sourceType: sent[0].sourceType, sourceId: sent[0].sourceId, sourceCode: sent[0].sourceCode,
    sku: sent[0].sku, itemTitle: sent[0].itemTitle, partNumber: sent[0].partNumber,
  }, {
    sourceType: 'wholesale-lot', sourceId: id, sourceCode: 'WS-2026-CANONICAL',
    sku: 'BUYER-REFERENCE', itemTitle: 'Canonical Samsung Server Memory', partNumber: 'M393A4K40DB3-CWE',
  });

  const rejected = await request(leadApp(async () => assert.fail('must not send'), Model), '/api/leads', {
    ...validLead, sourceType: 'wholesale-lot', sourceId: '64b64c66a2d15e51234abcdf',
  });
  assert.equal(rejected.status, 400);
  assert.deepEqual(JSON.parse(rejected.text), { error: 'The selected inventory is no longer available. Please refresh and try again.' });
});

test('lead honeypots acknowledge without validation or provider delivery', async () => {
  let sent = false;
  const response = await request(leadApp(async () => { sent = true; }), '/api/leads', {
    website: 'https://spam.example.test',
  });
  assert.equal(response.status, 202);
  assert.equal(sent, false);
  assert.deepEqual(JSON.parse(response.text), { success: true });
});

test('lead endpoint fails closed when the email provider does not accept the request', async () => {
  const { result: response } = await withQuietLog(() => request(leadApp(async () => { throw new Error('provider rejected'); }), '/api/leads', validLead));
  assert.equal(response.status, 502);
  assert.deepEqual(JSON.parse(response.text), { error: 'We could not submit your request. Please try again.' });
});

// ── a delivery that fails is visible to the owner without repeating anything personal ───────────────────────────────────────────────
function failingLeadApp(sendLead, { record, now } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/leads', createLeadRouter({ sendLead, record, now }));
  return app;
}
async function withQuietLog(fn) {
  const real = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  try { return { result: await fn(), lines }; } finally { console.error = real; }
}
const PERSONAL = ['Alex', 'alex@example.test', 'Example Reseller', 'M393A4K40CB2', '<stock request>', '600', 'product-123'];

test('a lead whose email cannot be sent is named in the log by kind, tells the owner once an hour, and repeats nothing the visitor typed', async () => {
  const alerts = [];
  let clock = new Date('2026-10-20T14:05:00Z');
  const record = async (alert) => { alerts.push(alert); return alert; };
  const timedOut = async () => { throw Object.assign(new Error('Lead delivery timed out'), { code: 'LEAD_TIMEOUT' }); };
  const { result, lines } = await withQuietLog(() => request(failingLeadApp(timedOut, { record, now: () => clock }), '/api/leads', validLead));
  assert.equal(result.status, 502);
  assert.deepEqual(JSON.parse(result.text), { error: 'We could not submit your request. Please try again.' });
  assert.deepEqual(lines, ['Quote request could not be sent (the email service did not answer in time)']);
  assert.equal(alerts.length, 1);
  const [alert] = alerts;
  assert.deepEqual([alert.type, alert.priority, alert.path], ['lead.failed', 'high', '/admin/orders']);
  assert.equal(alert.title, 'A quote request could not be sent');
  assert.equal(alert.body, 'A visitor saw an error (the email service did not answer in time). Check that the email service works; they may try again or email you.');
  assert.equal(alert.dedupeKey, 'lead.failed:2026-10-20T14');
  for (const secret of PERSONAL) assert.equal(`${lines.join(' ')} ${JSON.stringify(alert)}`.includes(secret), false, `leaks "${secret}"`);

  // another failure in the same hour carries the same key (the database keeps the first alert only); the next hour has its own
  await withQuietLog(() => request(failingLeadApp(timedOut, { record, now: () => clock }), '/api/leads', validLead));
  clock = new Date('2026-10-20T15:00:00Z');
  await withQuietLog(() => request(failingLeadApp(timedOut, { record, now: () => clock }), '/api/leads', validLead));
  assert.deepEqual(alerts.map((a) => a.dedupeKey), ['lead.failed:2026-10-20T14', 'lead.failed:2026-10-20T14', 'lead.failed:2026-10-20T15']);
});

test('a refusal by the email service and an unexpected failure are named too, and the provider\'s own words are not repeated', async () => {
  const alerts = [];
  const record = async (alert) => { alerts.push(alert); return alert; };
  const refused = async () => { throw Object.assign(new Error('Lead delivery was not accepted'), { code: 'LEAD_REJECTED' }); };
  const odd = async () => { throw new Error('provider says: alex@example.test is on the suppression list'); };
  const first = await withQuietLog(() => request(failingLeadApp(refused, { record }), '/api/leads', validLead));
  const second = await withQuietLog(() => request(failingLeadApp(odd, { record }), '/api/leads', validLead));
  assert.deepEqual([first.result.status, second.result.status], [502, 502]);
  assert.deepEqual(first.lines, ['Quote request could not be sent (the email service refused the message)']);
  assert.deepEqual(second.lines, ['Quote request could not be sent (unexpected error)']);
  for (const text of [...first.lines, ...second.lines, ...alerts.map((a) => a.body)]) {
    for (const secret of ['alex@example.test', 'suppression', ...PERSONAL]) assert.equal(text.includes(secret), false, `leaks "${secret}"`);
  }
});

test('a request that is refused, ignored or delivered raises no failure alert and writes no failure log', async () => {
  const alerts = [];
  const record = async (alert) => { alerts.push(alert); return alert; };
  const ok = async () => ({ id: 'email' });
  const { lines } = await withQuietLog(async () => {
    assert.equal((await request(failingLeadApp(ok, { record }), '/api/leads', { ...validLead, email: 'not-an-email' })).status, 400);
    assert.equal((await request(failingLeadApp(ok, { record }), '/api/leads', { website: 'https://spam.example.test' })).status, 202);
    assert.equal((await request(failingLeadApp(ok, { record }), '/api/leads', { ...validLead, sourceType: 'wholesale-lot', sourceId: 'not-a-lot-id' })).status, 400);
    assert.equal((await request(failingLeadApp(ok, { record }), '/api/leads', validLead)).status, 202);
  });
  assert.deepEqual(lines, []);
  assert.deepEqual(alerts.map((a) => a.type), ['lead.new'], 'only the delivered request tells the owner anything');
});

test('the two delivery failures carry a code the route can name', async () => {
  await assert.rejects(sendLeadEmail(validLead, { send: async () => ({ data: null, error: { message: 'x' } }) }), { code: 'LEAD_REJECTED' });
  await assert.rejects(sendLeadEmail(validLead, { timeoutMs: 5, send: () => new Promise(() => {}) }), { code: 'LEAD_TIMEOUT' });
  assert.equal(failureReason(new Error('anything else')), 'unexpected error');
  assert.equal(failureReason(undefined), 'unexpected error');
});

test('lead mail is escaped, replyable, and can use a fake sender', async () => {
  const message = buildLeadEmail({ ...validLead, name: '<Alex>', quantity: 2 }, {
    from: 'Reflexity <sales@example.test>', to: 'inbox@example.test',
  });
  assert.equal(message.replyTo, 'alex@example.test');
  assert.match(message.html, /&lt;Alex&gt;/);
  assert.doesNotMatch(message.html, /<Alex>/);
  assert.match(message.text, /Quantity: 2/);
  assert.match(message.text, /Source ID: product-123/);
  assert.match(message.html, /Item title/);

  const calls = [];
  const accepted = await sendLeadEmail({ ...validLead, name: 'Alex' }, {
    send: async (payload, options) => { calls.push({ payload, options }); return { data: { id: 'email-id' }, error: null }; },
    from: 'Reflexity <sales@example.test>', to: 'inbox@example.test',
  });
  assert.deepEqual(accepted, { id: 'email-id' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.idempotencyKey, 'reflexity-lead/A8D4E8F1-87B1-4A49-9B2A-0123456789AB');
  await assert.rejects(
    sendLeadEmail(validLead, { send: async () => ({ data: null, error: { message: 'rejected' } }) }),
    /not accepted/,
  );
});

test('lead send bounds provider waits and preserves the idempotency key on retry', async () => {
  const keys = [];
  await assert.rejects(
    sendLeadEmail(validLead, {
      timeoutMs: 5,
      send: async (_payload, options) => {
        keys.push(options.idempotencyKey);
        return new Promise(() => {});
      },
    }),
    /timed out/,
  );
  await sendLeadEmail(validLead, {
    send: async (_payload, options) => {
      keys.push(options.idempotencyKey);
      return { data: { id: 'retry-id' }, error: null };
    },
  });
  assert.deepEqual(keys, [
    'reflexity-lead/A8D4E8F1-87B1-4A49-9B2A-0123456789AB',
    'reflexity-lead/A8D4E8F1-87B1-4A49-9B2A-0123456789AB',
  ]);
});

test('server-only consumer feeds and old shop URLs remain available alongside wholesale routes', async () => {
  const originalFind = Product.find;
  const calls = [];
  Product.find = (filter) => {
    calls.push(filter);
    return { lean: async () => [{
      sku: 'SERVER-UDIMM', slug: 'server-udimm', name: 'Server UDIMM', line: 'Server', price: 49,
      generation: 'DDR4', formFactor: 'UDIMM', speedLabel: '3200 MT/s', condition: 'Used', images: [],
    }] };
  };
  const app = express();
  app.use(feedRouter);
  try {
    for (const path of ['/feed.xml', '/feed.csv']) {
      const response = await request(app, path);
      assert.equal(response.status, 200, path);
      assert.match(response.text, /https:\/\/reflexityram\.com\/shop\/server-udimm/);
    }
  } finally {
    Product.find = originalFind;
  }
  assert.deepEqual(calls, [
    { isActive: true, stock: { $ne: 'out' }, line: 'Server' },
    { isActive: true, stock: { $ne: 'out' }, line: 'Server' },
  ]);
  const paths = STATIC_PAGES.map(({ path }) => path);
  // The old /inventory URL keeps working as a permanent redirect to /shop, so only the
  // destination belongs in the sitemap (see the redirect guard in catalog-order-cart.test.js).
  assert.ok(!paths.includes('/inventory'));
  assert.ok(paths.includes('/shop'));
});

test('editable B2B legal slugs are available without removing legacy slugs', () => {
  for (const slug of ['shipping', 'returns', 'warranty', 'faq', 'international']) assert.ok(VALID_SLUGS.includes(slug));
  for (const slug of ['shipping-b2b', 'returns-b2b', 'warranty-b2b', 'faq-b2b', 'international-b2b']) assert.ok(VALID_SLUGS.includes(slug));
});

test('public wholesale lot detail returns only complete published quote-only inventory', async () => {
  const id = '64b64c66a2d15e51234abcde';
  const completeLot = completePublishedWholesaleLot(id);
  const Model = {
    findOne(filter) {
      const matches = filter._id === id && completeLot.status === filter.status && completeLot.visibility === filter.visibility;
      return { lean: async () => (matches ? { ...completeLot } : null) };
    },
  };
  const app = express();
  app.use('/api/wholesale', createWholesaleRouter(Model));
  const found = await request(app, `/api/wholesale/${id}`);
  assert.equal(found.status, 200);
  assert.equal(JSON.parse(found.text).lot.id, id);
  assert.equal((await request(app, '/api/wholesale/not-an-id')).status, 404);

  completeLot.quoteOnly = false;
  assert.equal((await request(app, `/api/wholesale/${id}`)).status, 404);
  const sitemapSource = await require('node:fs/promises').readFile(require.resolve('../src/routes/sitemap'), 'utf8');
  assert.match(sitemapSource, /WholesaleLot\.find\(/);
  assert.match(sitemapSource, /\/wholesale\/\$\{encodeURIComponent\(lot\.id\)\}/);
});

test('lead delivery is independently limited to eight requests per IP per hour', async () => {
  const source = await require('node:fs/promises').readFile(require.resolve('../src/server'), 'utf8');
  assert.match(source, /const leadLimiter = rateLimit\(\{[\s\S]*windowMs: 60 \* 60 \* 1000,[\s\S]*max: 8,[\s\S]*prefix: 'leads'/);
  assert.match(source, /app\.use\('\/api\/leads', leadLimiter, createLeadRouter\(\)\)/);
});

test('server mounts the cart and Stripe routers without reviving the retired interceptor', async () => {
  const source = await require('node:fs/promises').readFile(require.resolve('../src/server'), 'utf8');
  assert.match(source, /app\.use\('\/api\/cart', cartRoutes\)/);
  assert.doesNotMatch(source, /app\.use\('\/api\/cart', retiredRetailCommerce/);
  assert.doesNotMatch(source, /app\.post\('\/api\/stripe\/create-checkout-session', retiredRetailCommerce/);
  assert.match(source, /app\.use\('\/api\/orders', orderRoutes\)/);
  assert.match(source, /app\.use\('\/api\/stripe\/webhook', express\.raw/);
});

test('admin OAuth intent is HMAC-bound and never provisions a customer identity', async () => {
  const state = oauthStateCookie('state-token', 'admin', 'test-secret');
  assert.deepEqual(readOauthStateCookie(state, 'test-secret'), { state: 'state-token', purpose: 'admin' });
  assert.equal(readOauthStateCookie(`${state}x`, 'test-secret'), null);

  let created = false;
  const Unknown = {
    findOne: async (filter) => { assert.equal(filter.role, 'admin'); assert.equal(filter.isActive, true); return null; },
    create: async () => { created = true; },
  };
  const profile = { id: 'google-id', email: 'admin@example.test', picture: 'https://image.example/avatar' };
  assert.equal(await resolveGoogleUser(profile, 'admin', { UserModel: Unknown }), null);
  assert.equal(created, false);

  let saved = false;
  const admin = { _id: 'admin-id', email: profile.email, role: 'admin', isActive: true, googleId: null, isEmailVerified: false, save: async () => { saved = true; } };
  const Existing = { findOne: async (filter) => { assert.equal(filter.role, 'admin'); return admin; }, create: async () => assert.fail('must not create') };
  const resolved = await resolveGoogleUser(profile, 'admin', { UserModel: Existing, now: () => new Date('2026-09-11T00:00:00.000Z') });
  assert.equal(resolved, admin);
  assert.equal(admin.googleId, 'google-id');
  assert.equal(admin.isEmailVerified, true);
  assert.equal(saved, true);
  const source = await require('node:fs/promises').readFile(require.resolve('../src/routes/auth'), 'utf8');
  assert.match(source, /const user = await resolveGoogleUser\(profile, storedState\.purpose\);\s*if \(!user\) return fail\(storedState\.purpose === 'admin' \? 'admin_not_authorized'/);
  assert.match(source, /if \(!user\) return fail[\s\S]*?await mergeGuestCartForUser\(user\._id, sessionId\);[\s\S]*?const token = generateAccessToken\(user\._id/);
});
