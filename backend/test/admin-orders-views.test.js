// The admin Orders page shows EVERY order (the owner archived a paid, unshipped order by accident and it vanished from his
// list). A view only narrows the list; the counts say what needs him. These are the pure rules; the real-database
// behaviour is in admin-orders.integration.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { VIEWS, VIEW_NAMES, isView, ordersFilter, orderCounts } = require('../src/utils/adminOrders');

test('there is no archive filter: with no view, no status and no search, the filter is empty', () => {
  assert.deepEqual(ordersFilter(), {});
  assert.deepEqual(ordersFilter({}), {});
  assert.deepEqual(ordersFilter({ view: 'all' }), {});
  assert.equal(Object.hasOwn(ordersFilter({ view: 'all' }), 'archived'), false);
  // an old open tab that still sends ?archived=false must not hide anything: the param is not even read
  assert.deepEqual(ordersFilter({ archived: 'false' }), {});
});

test('each view is exactly what its name says', () => {
  assert.deepEqual(VIEW_NAMES, ['all', 'awaiting', 'toship', 'shipped', 'delivered', 'closed']);
  assert.deepEqual(ordersFilter({ view: 'awaiting' }), { paymentStatus: 'pending', status: 'pending' });
  // "to ship" is PAID and not shipped yet; an unpaid order is never in it
  assert.deepEqual(ordersFilter({ view: 'toship' }), { paymentStatus: 'paid', status: { $in: ['pending', 'processing'] } });
  assert.deepEqual(ordersFilter({ view: 'shipped' }), { status: 'shipped' });
  assert.deepEqual(ordersFilter({ view: 'delivered' }), { status: 'delivered' });
  assert.deepEqual(ordersFilter({ view: 'closed' }), { status: { $in: ['cancelled', 'refunded'] } });
});

test('a view returns a fresh filter every time (Mongoose may rewrite the one it is given)', () => {
  const first = ordersFilter({ view: 'toship' });
  first.status.$in.push('INJECTED');
  first.extra = true;
  assert.deepEqual(ordersFilter({ view: 'toship' }), { paymentStatus: 'paid', status: { $in: ['pending', 'processing'] } });
});

test('only real view names count: prototype keys and junk fall back to the plain filter', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'ALL', 'to ship', '', undefined, null, 5, {}]) {
    assert.equal(isView(name), false, String(name));
    assert.deepEqual(ordersFilter({ view: name }), {}, `view ${String(name)} must not match anything`);
  }
  assert.ok(VIEW_NAMES.every(isView));
});

test('the older separate parameters still work when no view is given, and a view wins over them', () => {
  assert.deepEqual(ordersFilter({ status: 'shipped' }), { status: 'shipped' });
  assert.deepEqual(ordersFilter({ payment: 'awaiting' }), { paymentStatus: 'pending', status: 'pending' });
  assert.deepEqual(ordersFilter({ status: 'shipped', payment: 'awaiting' }), { paymentStatus: 'pending', status: 'pending' });
  assert.deepEqual(ordersFilter({ view: 'delivered', status: 'shipped', payment: 'awaiting' }), { status: 'delivered' });
});

test('search narrows any view by order number or guest email, with regex characters escaped', () => {
  const filter = ordersFilter({ view: 'shipped', search: 'a.b+c(d)' });
  assert.equal(filter.status, 'shipped');
  assert.equal(filter.$or.length, 2);
  assert.equal(filter.$or[0].orderNumber.$regex, 'a\\.b\\+c\\(d\\)');
  assert.equal(filter.$or[1].guestEmail.$regex, 'a\\.b\\+c\\(d\\)');
  assert.equal('$or' in ordersFilter({ view: 'all' }), false);
});

test('the counts ask the database about every view, each with its own untouched filter', async () => {
  const asked = [];
  const Order = { countDocuments: async (filter) => { asked.push(JSON.parse(JSON.stringify(filter))); filter.__consumed = true; return asked.length; } };
  const counts = await orderCounts(Order);
  assert.deepEqual(Object.keys(counts), VIEW_NAMES);
  assert.deepEqual(Object.values(counts).sort(), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(asked.map((f) => f.paymentStatus || null).sort(), [null, null, null, null, 'paid', 'pending']);
  // mutating what the model was handed must not leak into the next call
  for (const name of VIEW_NAMES) assert.equal('__consumed' in VIEWS[name](), false);
});
