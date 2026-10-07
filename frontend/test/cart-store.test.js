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
