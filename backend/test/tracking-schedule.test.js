// GitHub's "every 15 minutes" tracking schedule really fires about four times a day (33 runs in 8 days, gaps of 3 to 10 hours), so a
// buyer's "shipped" and "delivered" emails would be hours late. The server therefore runs the same job itself while it is awake. These
// tests pin how that timer behaves: at most one run per 15 minutes, never two at once, never a throw, never a hammering retry.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { syncShippedOrdersThrottled, resetSyncThrottleForTest, SYNC_EVERY_MS } = require('../src/utils/trackingSync');

const MIN = 60 * 1000;
const fresh = () => { resetSyncThrottleForTest(); const calls = []; return { calls, run: async () => { calls.push(Date.now()); return { checked: 1, delivered: 0, emails: 0, errors: 0 }; } }; };

test('it runs once, then waits a full 15 minutes before the next run', async () => {
  const { calls, run } = fresh();
  const t0 = 1_000_000_000_000;
  assert.deepEqual(await syncShippedOrdersThrottled({ now: t0, run, configured: () => true }), { checked: 1, delivered: 0, emails: 0, errors: 0 });
  assert.equal(await syncShippedOrdersThrottled({ now: t0 + 5 * MIN, run, configured: () => true }), null, 'five minutes later: skipped');
  assert.equal(await syncShippedOrdersThrottled({ now: t0 + SYNC_EVERY_MS - 1, run, configured: () => true }), null, 'one millisecond early: skipped');
  assert.ok(await syncShippedOrdersThrottled({ now: t0 + SYNC_EVERY_MS, run, configured: () => true }), 'at 15 minutes: runs again');
  assert.equal(calls.length, 2);
  assert.equal(SYNC_EVERY_MS, 15 * MIN);
});

test('two overlapping calls run the job once (a slow Canada Post answer cannot start a second run)', async () => {
  resetSyncThrottleForTest();
  let release;
  let runs = 0;
  const run = () => new Promise((resolve) => { runs += 1; release = () => resolve({ checked: 0, delivered: 0, emails: 0, errors: 0 }); });
  const first = syncShippedOrdersThrottled({ now: 5_000_000_000_000, run, configured: () => true });
  // even a call far in the future is skipped while the first run is still going
  assert.equal(await syncShippedOrdersThrottled({ now: 5_000_000_000_000 + 99 * MIN, run, configured: () => true }), null);
  release();
  await first;
  assert.equal(runs, 1);
  // and once it has finished the next slot works normally
  const second = syncShippedOrdersThrottled({ now: 5_000_000_000_000 + 99 * MIN, run, configured: () => true });
  release();
  assert.ok(await second);
  assert.equal(runs, 2);
});

test('without Canada Post credentials it does nothing and does not use up the slot', async () => {
  const { calls, run } = fresh();
  const t0 = 2_000_000_000_000;
  assert.equal(await syncShippedOrdersThrottled({ now: t0, run, configured: () => false }), null);
  assert.equal(calls.length, 0);
  assert.ok(await syncShippedOrdersThrottled({ now: t0 + 1, run, configured: () => true }), 'configured a moment later: runs at once');
});

test('a failing run never throws, is logged, and the next try waits for the next slot', async () => {
  resetSyncThrottleForTest();
  const t0 = 3_000_000_000_000;
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    let runs = 0;
    const run = async () => { runs += 1; throw new Error('Canada Post is down'); };
    assert.equal(await syncShippedOrdersThrottled({ now: t0, run, configured: () => true }), null);
    assert.equal(await syncShippedOrdersThrottled({ now: t0 + MIN, run, configured: () => true }), null, 'a minute later: not retried');
    assert.equal(runs, 1);
    assert.match(logged.join('\n'), /Canada Post is down/);
    await syncShippedOrdersThrottled({ now: t0 + SYNC_EVERY_MS, run, configured: () => true });
    assert.equal(runs, 2, 'a failure does not block the next slot for good');
  } finally { console.error = original; }
});

test('the server starts the timer after it is listening, not in tests, and does not keep the process alive', async () => {
  const server = await readFile(path.join(__dirname, '../src/server.js'), 'utf8');
  assert.match(server, /if \(process\.env\.NODE_ENV !== 'test'\) \{\s*const backgroundJobs = \(\) => \{\s*sweepEtransferOrdersThrottled\(\)\.catch\(\(\) => \{\}\);\s*syncShippedOrdersThrottled\(\)\.catch\(\(\) => \{\}\);/);
  assert.match(server, /setTimeout\(backgroundJobs, 60 \* 1000\)\.unref\(\);/);
  assert.match(server, /setInterval\(backgroundJobs, 5 \* 60 \* 1000\)\.unref\(\);/);
  assert.ok(server.indexOf('app.listen(PORT') < server.indexOf('setInterval(backgroundJobs'), 'only after the server is listening');
});
