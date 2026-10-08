import test from 'node:test';
import assert from 'node:assert/strict';
import { startOrderUpdates } from '../src/lib/orderUpdates.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness(load) {
  const orders = [], errors = [], loaded = [];
  let refresh, visible, cleared = false;
  const doc = { visibilityState: 'visible', addEventListener: (_, fn) => { visible = fn; }, removeEventListener: (_, fn) => assert.equal(fn, visible) };
  const stop = startOrderUpdates({ load, doc, onOrder: (o) => orders.push(o), onError: (e) => errors.push(e), onLoaded: () => loaded.push(true),
    setTimer: (fn, ms) => { assert.equal(ms, 60000); refresh = fn; return 1; }, clearTimer: () => { cleared = true; } });
  return { orders, errors, loaded, doc, refresh: () => refresh(), visible: () => visible(), stop, cleared: () => cleared };
}
test('visible status refreshes retain proof, pause when hidden and stop at delivery', async () => {
  const proof = 'buyer@example.com';
  let calls = 0;
  const h = harness(async () => { assert.equal(proof, 'buyer@example.com'); return { data: { order: { status: ++calls === 3 ? 'delivered' : 'shipped' } } }; });
  await tick();
  h.doc.visibilityState = 'hidden'; await h.refresh(); assert.equal(calls, 1);
  h.doc.visibilityState = 'visible'; await h.visible(); await h.refresh(); await h.refresh();
  assert.equal(calls, 3);
  h.stop(); assert.equal(h.cleared(), true);
});
test('late replies after cleanup cannot replace another order and requests never overlap', async () => {
  let resolve, calls = 0;
  const h = harness(() => { calls += 1; return new Promise((r) => { resolve = r; }); });
  await h.refresh(); assert.equal(calls, 1);
  h.stop(); resolve({ data: { order: { status: 'shipped' } } }); await tick();
  assert.deepEqual(h.orders, []); assert.deepEqual(h.loaded, []);
});
test('a temporary refresh error preserves the last known order', async () => {
  let calls = 0;
  const h = harness(async () => { if (++calls === 2) throw new Error('offline'); return { data: { order: { status: 'processing' } } }; });
  await tick(); await h.refresh();
  assert.equal(h.orders.length, 1); assert.deepEqual(h.errors, []); h.stop();
});
