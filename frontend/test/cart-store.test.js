import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/lib/cartStore.js', import.meta.url), 'utf8');
let instance = 0;
const loadStore = async (cartApi) => {
  globalThis.__cartApi = cartApi;
  const executable = source
    .replace("import { create } from 'zustand';", `import { create } from '${import.meta.resolve('zustand')}';`)
    .replace("import { cartApi } from './api';", 'const cartApi = globalThis.__cartApi;');
  return (await import(`data:text/javascript,${encodeURIComponent(`${executable}\n// ${instance += 1}`)}`)).default;
};

const hynix = { slug: 'old-hynix-slug', name: 'SK hynix 16GB', price: 135, qty: 1 };
const samsung = { slug: 'samsung-64', name: 'Samsung 64GB', price: 585, qty: 1 };

test('removeItem keeps the other server-returned line', async () => {
  const store = await loadStore({
    remove: async () => ({ data: { cart: { items: [hynix], subtotal: 135, shipping: 14, shippingFaster: 26, itemCount: 1, discount: 10, couponCode: 'SAVE10' } } }),
  });
  store.setState({ items: [samsung, hynix], subtotal: 720, itemCount: 2 });
  await store.getState().removeItem(samsung.slug);
  assert.deepEqual(store.getState().items, [hynix]);
  assert.equal(store.getState().couponCode, 'SAVE10');
});

test('a failed removeItem leaves the in-memory cart intact', async () => {
  const store = await loadStore({ remove: async () => { throw new Error('network down'); } });
  store.setState({ items: [samsung, hynix], subtotal: 720, itemCount: 2 });
  const originalError = console.error;
  console.error = () => {};
  try {
    await store.getState().removeItem(samsung.slug);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(store.getState().items, [samsung, hynix]);
  assert.equal(store.getState().isLoading, false);
});

// ── Review of 2026-10-14: a failed read is not an empty cart, and a late answer cannot put an older cart back ──
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const quiet = async (fn) => {
  const originalError = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = originalError; }
};
const cartOf = (items) => ({ data: { cart: { items, subtotal: items.reduce((sum, i) => sum + i.price * i.qty, 0), itemCount: items.reduce((n, i) => n + i.qty, 0) } } });

test('before the first read the cart is "not loaded yet", so a page can show a spinner instead of "Your cart is empty"', async () => {
  const store = await loadStore({ get: async () => cartOf([]) });
  assert.equal(store.getState().loaded, false);
  assert.equal(store.getState().loadFailed, false);
  await store.getState().fetchCart();
  assert.equal(store.getState().loaded, true, 'an empty cart the server confirmed is a loaded, empty cart');
  assert.deepEqual(store.getState().items, []);
});

test('a failed read is reported as a failure (with nothing wiped), and a retry that works clears it', async () => {
  let fail = true;
  const store = await loadStore({ get: async () => { if (fail) throw Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' }); return cartOf([hynix]); } });
  await quiet(() => store.getState().fetchCart());
  assert.equal(store.getState().loadFailed, true);
  assert.equal(store.getState().loaded, false);
  assert.equal(store.getState().isLoading, false);
  fail = false;
  const retry = store.getState().fetchCart();
  assert.equal(store.getState().loadFailed, false, 'while the retry is on its way the page shows the spinner, not the error');
  assert.equal(store.getState().isLoading, true);
  await retry;
  assert.deepEqual(store.getState().items, [hynix]);
  assert.equal(store.getState().loadFailed, false);
});

test('a slow read that started before "Add to cart" does not put the older cart back when it arrives last', async () => {
  const slowRead = deferred();
  const store = await loadStore({ get: () => slowRead.promise, add: async () => cartOf([hynix, samsung]) });
  const reading = store.getState().fetchCart();
  const result = await store.getState().addItem(samsung.slug, 1);
  assert.equal(result.success, true);
  assert.equal(store.getState().itemCount, 2);
  slowRead.resolve(cartOf([hynix])); // the server's answer from BEFORE the add
  await reading;
  assert.deepEqual(store.getState().items.map((i) => i.slug), [hynix.slug, samsung.slug], 'the newer cart stays');
  assert.equal(store.getState().itemCount, 2);
  assert.equal(store.getState().isLoading, false);
});

test('a slow read that fails after a newer one worked does not show the failure', async () => {
  const slowRead = deferred();
  let calls = 0;
  const store = await loadStore({ get: () => (calls++ === 0 ? slowRead.promise : Promise.resolve(cartOf([hynix]))) });
  const first = store.getState().fetchCart();
  await store.getState().fetchCart();
  slowRead.reject(new Error('network down'));
  await quiet(() => first);
  assert.equal(store.getState().loadFailed, false);
  assert.deepEqual(store.getState().items, [hynix]);
});

test('after an order is placed, a read still on its way does not bring the bought items back', async () => {
  const slowRead = deferred();
  const store = await loadStore({ get: () => slowRead.promise });
  store.setState({ items: [hynix], itemCount: 1, subtotal: 135 });
  const reading = store.getState().fetchCart();
  store.getState().clearCartLocal();
  slowRead.resolve(cartOf([hynix]));
  await reading;
  assert.deepEqual(store.getState().items, []);
  assert.equal(store.getState().itemCount, 0);
  assert.equal(store.getState().isLoading, false, 'the dropped read does not leave the spinner on');
  assert.equal(store.getState().loaded, true);
});

test('two quick quantity changes: only the later answer is shown, whatever order they come back in', async () => {
  const first = deferred();
  const second = deferred();
  const answers = [first, second];
  const store = await loadStore({ update: () => answers.shift().promise });
  store.setState({ items: [{ ...hynix, qty: 1 }], itemCount: 1 });
  const a = store.getState().updateItem(hynix.slug, 2);
  const b = store.getState().updateItem(hynix.slug, 3);
  second.resolve(cartOf([{ ...hynix, qty: 3 }]));
  await b;
  first.resolve(cartOf([{ ...hynix, qty: 2 }]));
  const resultA = await a;
  assert.equal(resultA.success, true, 'the earlier change still reports that it worked');
  assert.equal(store.getState().items[0].qty, 3);
  assert.equal(store.getState().isLoading, false);
});
