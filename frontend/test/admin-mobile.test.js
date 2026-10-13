// The admin side on a phone. The owner's complaints are written down here as tests: the Archive button hid a paid order that still
// had to be shipped, the dropdown did not work in the phone app, "Manage" showed the info in a confusing order, and a manual
// "shipped" gave no hint whether the buyer is emailed. Pure rules first, then the structure of the screens.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  BUYER_EMAIL, ORDER_VIEWS, ageLabel, canCancel, countFor, customerName, isViewKey, nextStep, orderMoney, shipEmailLine, shipRequest,
} from '../src/lib/adminOrders.js';
import { handleBack, pushBackHandler } from '../src/lib/appBridge.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);

const order = (extra = {}) => ({ _id: 'o1', orderNumber: 'RFX-1', status: 'processing', paymentStatus: 'paid', paymentMethod: 'stripe', total: 100, ...extra });

// ── the views ─────────────────────────────────────────────────────────────────
test('the Orders screen offers the same views the server knows, All first, and counts only when the server sent them', () => {
  const { VIEW_NAMES } = require('../../backend/src/utils/adminOrders.js');
  assert.deepEqual(ORDER_VIEWS.map((view) => view.key), VIEW_NAMES, 'a view added on one side must exist on the other');
  assert.equal(ORDER_VIEWS[0].key, 'all');
  assert.deepEqual(ORDER_VIEWS.filter((view) => view.needsYou).map((view) => view.key), ['awaiting', 'toship']);
  assert.ok(ORDER_VIEWS.every((view) => view.label && isViewKey(view.key)));
  for (const junk of ['archived', 'constructor', '', undefined, null, 3]) assert.equal(isViewKey(junk), false, String(junk));
  assert.equal(countFor({ all: 4, toship: 0 }, 'all'), 4);
  assert.equal(countFor({ all: 4, toship: 0 }, 'toship'), 0, 'zero is a count, not "unknown"');
  assert.equal(countFor({ all: 4 }, 'shipped'), null);
  assert.equal(countFor(null, 'all'), null);
  assert.equal(countFor({ all: '4' }, 'all'), null, 'only numbers count');
});

// ── what to do next ───────────────────────────────────────────────────────────
test('each order has one next step, and an unpaid order is never offered "ship"', () => {
  const step = (extra) => nextStep(order(extra)).key;
  assert.equal(step({ status: 'processing', paymentStatus: 'paid' }), 'ship');
  assert.equal(step({ status: 'pending', paymentStatus: 'paid' }), 'ship');
  assert.equal(step({ status: 'shipped' }), 'deliver');
  assert.equal(step({ status: 'delivered' }), 'done');
  assert.equal(step({ status: 'cancelled', paymentStatus: 'pending' }), 'closed');
  assert.equal(step({ status: 'refunded', paymentStatus: 'refunded' }), 'closed');
  // money still to come
  assert.equal(step({ status: 'pending', paymentStatus: 'pending', paymentMethod: 'etransfer' }), 'collect');
  assert.equal(step({ status: 'cancelled', paymentStatus: 'pending', paymentMethod: 'etransfer', etransfer: { expiredAt: '2026-10-10' } }), 'collect', 'a late e-Transfer can still be recorded');
  assert.equal(step({ status: 'pending', paymentStatus: 'pending', paymentMethod: 'bank_debit' }), 'clearing');
  assert.equal(step({ status: 'pending', paymentStatus: 'pending' }), 'unpaid');
  for (const unpaid of [{ paymentMethod: 'etransfer' }, { paymentMethod: 'bank_debit' }, { paymentMethod: 'stripe' }]) {
    assert.notEqual(step({ status: 'pending', paymentStatus: 'pending', ...unpaid }), 'ship', JSON.stringify(unpaid));
  }
  assert.equal(nextStep(null).key, 'none');
});

test('only an unpaid order can be cancelled by hand (a paid one goes through a refund)', () => {
  assert.equal(canCancel(order({ status: 'pending', paymentStatus: 'pending' })), true);
  assert.equal(canCancel(order({ status: 'processing', paymentStatus: 'paid' })), false);
  assert.equal(canCancel(order({ status: 'shipped', paymentStatus: 'paid' })), false);
  assert.equal(canCancel(order({ status: 'cancelled', paymentStatus: 'pending' })), false);
});

// ── shipping ──────────────────────────────────────────────────────────────────
test('marking shipped needs a tracking number or an explicit "no tracking number", and a number always wins', () => {
  assert.deepEqual(shipRequest({ trackingNumber: ' CP123 ' }), { ok: true, payload: { status: 'shipped', trackingNumber: 'CP123' } });
  assert.deepEqual(shipRequest({ noTracking: true }), { ok: true, payload: { status: 'shipped', noTracking: true } });
  assert.deepEqual(shipRequest({ trackingNumber: 'CP123', noTracking: true }), { ok: true, payload: { status: 'shipped', trackingNumber: 'CP123' } });
  assert.deepEqual(shipRequest({ trackingNumber: 'CP1', note: ' sent today ' }).payload, { status: 'shipped', trackingNumber: 'CP1', note: 'sent today' });
  for (const empty of [{}, { trackingNumber: '' }, { trackingNumber: '   ' }, { trackingNumber: null }, { noTracking: false }, { noTracking: 'true' }, { noTracking: 1 }]) {
    const result = shipRequest(empty);
    assert.equal(result.ok, false, JSON.stringify(empty));
    assert.match(result.error, /tracking number/i);
  }
  assert.equal(shipRequest().ok, false);
});

test('the screen says what the buyer is emailed before each action, and never promises a tracking link it cannot give', () => {
  assert.match(shipEmailLine({ trackingNumber: 'CP1' }), /emailed right away, with the tracking link/);
  assert.match(shipEmailLine({ noTracking: true }), /saying it went without tracking/);
  assert.match(shipEmailLine({ trackingNumber: 'CP1', noTracking: true }), /with the tracking link/, 'a number wins');
  assert.equal(shipEmailLine({}), BUYER_EMAIL.ship);
  assert.equal(BUYER_EMAIL.deliver, 'No email is sent.');
  assert.equal(BUYER_EMAIL.cancel, 'No email is sent.');
  assert.match(BUYER_EMAIL.received, /payment confirmation/);
});

// ── how an order reads in a list ──────────────────────────────────────────────
test('a customer is named by account, else by the name it ships to, else by email', () => {
  assert.equal(customerName({ user: { firstName: 'Ann', lastName: 'Lee' } }), 'Ann Lee');
  assert.equal(customerName({ shippingAddress: { firstName: 'Bolanle', lastName: 'Odeleye' }, guestEmail: 'b@example.com' }), 'Bolanle Odeleye');
  assert.equal(customerName({ guestEmail: 'b@example.com' }), 'b@example.com');
  assert.equal(customerName({ user: { email: 'u@example.com' } }), 'u@example.com');
  assert.equal(customerName({}), 'Guest');
  assert.equal(customerName(null), 'Guest');
});

test('how long ago reads as today, yesterday, days, then the date', () => {
  const now = new Date('2026-10-13T15:00:00Z').getTime();
  assert.equal(ageLabel('2026-10-13T01:00:00Z', now), 'today');
  assert.equal(ageLabel('2026-10-12T05:00:00Z', now), 'yesterday');
  assert.equal(ageLabel('2026-10-10T14:00:00Z', now), '3 days ago');
  assert.match(ageLabel('2026-09-18T13:00:00Z', now), /Sep/);
  assert.equal(ageLabel('not a date', now), '');
  assert.equal(orderMoney(643), '$643.00');
  assert.equal(orderMoney(undefined), '$0.00');
});

// ── the phone's Back button ───────────────────────────────────────────────────
test('Back closes the sheet that is open first, the newest one first, and does nothing when none is open', () => {
  assert.equal(handleBack(), false);
  const closed = [];
  const dropFirst = pushBackHandler(() => closed.push('first'));
  const dropSecond = pushBackHandler(() => closed.push('second'));
  assert.equal(handleBack(), true);
  assert.deepEqual(closed, ['second']);
  dropSecond();
  assert.equal(handleBack(), true);
  assert.deepEqual(closed, ['second', 'first']);
  dropFirst();
  assert.equal(handleBack(), false);
  dropFirst(); // removing twice is harmless
});

// ── the owner's complaints, as structure ─────────────────────────────────────
test('the Orders screen has no archive, no dropdown and no browser dialog', async () => {
  const [orders, actions, sheet, api] = await Promise.all([
    read('../src/pages/admin/Orders.jsx'), read('../src/components/admin/OrderActions.jsx'), read('../src/components/admin/AdminSheet.jsx'), read('../src/lib/api.js'),
  ]);
  for (const [name, source] of [['Orders', orders], ['OrderActions', actions], ['AdminSheet', sheet]]) {
    assert.doesNotMatch(source, /<select/, `${name} has a dropdown`);
    assert.doesNotMatch(source, /window\.confirm|[^.\w]confirm\(/, `${name} depends on a browser dialog`);
    assert.doesNotMatch(source, /\barchive/i, `${name} mentions archiving`);
  }
  assert.doesNotMatch(api, /archiveOrder|\/archive`/);
  assert.doesNotMatch(orders, /archived/);
  // the list asks the server for a view, never for "not archived"
  assert.match(orders, /listOrders\(\{ page: p, limit: 20, view: v === 'all' \? undefined : v \}\)/);
  // one Manage button per order on the table, and the whole card on a phone
  assert.match(orders, /Manage\s*<\/button>/);
  assert.match(orders, /onClick=\{\(\) => onOpen\(order\._id\)\} className=\{`admin-card/);
});

test('every view is a button in one row, with what needs the owner counted', async () => {
  const orders = await read('../src/pages/admin/Orders.jsx');
  assert.match(orders, /ORDER_VIEWS\.map\(\(entry\) =>/);
  assert.match(orders, /aria-pressed=\{view === entry\.key\}/);
  assert.match(orders, /chip-count \$\{entry\.needsYou && count > 0 \? 'needs-you' : ''\}/);
  assert.match(orders, /data-testid=\{entry\.key === 'awaiting' \? 'orders-awaiting-filter'/);
  assert.match(orders, /latest\.current !== ticket/, 'a slow answer for an old view cannot overwrite the open one');
});

test('the order sheet leads with what to do, then who and what, and keeps the rare details folded', async () => {
  const orders = await read('../src/pages/admin/Orders.jsx');
  const at = (marker) => orders.indexOf(marker);
  assert.ok(at('data-testid="order-admin-notes"') < at('<OrderActions'), 'system notes first');
  assert.ok(at('<OrderActions') < at('{/* Customer */}'), 'then the next step');
  assert.ok(at('{/* Customer */}') < at('{/* Shipping */}') && at('{/* Shipping */}') < at('{/* Items */}'));
  assert.ok(at('{/* Items */}') < at('testId="order-history"'));
  assert.match(orders, /\{!shipped && order\.shippingPreparation && \(\s*<Fold[^>]*testId="order-label-details"/, 'label details only matter before the parcel has gone');
  assert.match(orders, /\{shipped && <ReviewEmailPanel/, 'the review email only matters after shipping');
  assert.match(orders, /<details className="glass rounded-xl text-\[13px\]"/, 'rare details are folded');
});

test('the ship card asks for a number or "no tracking number", says what the buyer gets, and confirms in the page', async () => {
  const actions = await read('../src/components/admin/OrderActions.jsx');
  assert.match(actions, /data-testid="order-no-tracking"/);
  assert.match(actions, /data-testid="order-ship-email-line">\{emailLine\}/);
  assert.match(actions, /const number = noTracking \? '' : trackingNumber;/, 'ticking "no tracking number" drops any number typed before');
  assert.match(actions, /shipRequest\(\{ trackingNumber: number, noTracking, note \}\)/);
  assert.match(actions, /<ConfirmButton[\s\S]*?label="Mark as shipped"[\s\S]*?disabled=\{!request\.ok\}/);
  assert.match(actions, /label="Mark as delivered"[\s\S]*?BUYER_EMAIL\.deliver/);
  assert.match(actions, /variant="danger"[\s\S]*?label="Cancel this order"[\s\S]*?BUYER_EMAIL\.cancel/);
  assert.match(actions, /updateOrderTracking\(order\._id, trackingNumber\.trim\(\)\)/, 'saving a number alone is still possible, under "More options"');
});

test('the confirm button asks in the page, so it works in the phone app web view', async () => {
  const confirm = await read('../src/components/admin/ConfirmButton.jsx');
  assert.doesNotMatch(confirm, /window\.confirm/);
  assert.match(confirm, /role="group"/);
  assert.match(confirm, /Go back/);
  assert.match(confirm, /finally \{ setAsking\(false\); \}/, 'it closes whether the action worked or not');
});

// ── the phone shell ───────────────────────────────────────────────────────────
test('an admin on a phone gets a bottom tab bar and no header; everyone else keeps the sidebar', async () => {
  const layout = await read('../src/components/AppLayout.jsx');
  assert.match(layout, /\$\{isAdmin \? 'max-md:hidden' : ''\}/, 'the admin sidebar is hidden on a phone');
  assert.match(layout, /\{isAdmin && \(\s*<nav className="admin-tabbar md:hidden"/);
  const tabs = layout.slice(layout.indexOf('const ADMIN_TABS'), layout.indexOf('];', layout.indexOf('const ADMIN_TABS')));
  assert.deepEqual([...tabs.matchAll(/label: '(\w+)'/g)].map((m) => m[1]), ['Orders', 'Products', 'Users', 'Security', 'Settings']);
  assert.match(tabs, /to: '\/admin\/security'/, 'the phone-app page can finally be reached from the menu');
  assert.match(layout, /\{ to: '\/admin\/security', label: 'Security', icon: Shield \}/, 'and from the desktop sidebar');
  assert.match(layout, /root\.dataset\.kbd = '1'/, 'the tab bar steps aside while the keyboard is open');
  assert.match(layout, /aria-current=\{active \? 'page' : undefined\}/);
});

test('products and users are cards on a phone and tables from the tablet width up', async () => {
  const [products, users] = await Promise.all([read('../src/pages/admin/Products.jsx'), read('../src/pages/admin/Users.jsx')]);
  assert.match(products, /<ul className="space-y-2\.5 md:hidden" data-testid="products-cards">/);
  assert.match(products, /<div className="glass rounded-2xl overflow-hidden hidden md:block">/);
  assert.match(users, /<ul className="space-y-2\.5 md:hidden" data-testid="users-cards">/);
  assert.match(users, /<div className="glass rounded-2xl overflow-hidden hidden md:block">/);
  // making someone an admin is the one thing here that is not reversible by accident: it asks
  assert.match(users, /label=\{u\.role === 'admin' \? 'Remove admin' : 'Make admin'\}/);
  assert.match(products, /action: \{ label: 'Undo'/, 'hiding a product from a card offers Undo');
});

test('every admin page gives the content room on a phone', async () => {
  for (const page of ['Orders', 'Products', 'Users', 'Security']) {
    const source = await read(`../src/pages/admin/${page}.jsx`);
    assert.match(source, /className="p-4 md:p-8/, `${page} still wastes 32px on each side of a phone`);
  }
});

test('the sheet is a full screen on a phone with its own back arrow, and the app Back button closes it', async () => {
  const [sheet, css] = await Promise.all([read('../src/components/admin/AdminSheet.jsx'), read('../src/index.css')]);
  assert.match(sheet, /pushBackHandler\(onClose\)/);
  assert.match(sheet, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(sheet, /<ArrowLeft size=\{20\} className="md:hidden"/);
  assert.match(sheet, /event\.key === 'Escape'/);
  assert.match(css, /\.sheet-panel \{ background: var\(--bg\); \}/);
  assert.match(css, /\.admin-tabbar \{/);
  assert.match(css, /html\[data-kbd\] \.admin-tabbar \{ display: none; \}/);
  assert.match(css, /\.chip\[aria-pressed="true"\]/);
});

test('the buyer is told plainly when an order went without tracking', async () => {
  const page = await read('../src/pages/OrderSuccess.jsx');
  assert.match(page, /if \(order\.untracked\) \{/);
  assert.match(page, /without a tracking number, so there is nothing to follow online/);
});
