import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { codeCountdown, isLive, lastSeenLabel } from '../src/lib/phoneApp.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-13T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('a phone that polled seconds ago reads "connected now", older ones read as time ago', () => {
  assert.equal(lastSeenLabel(null, NOW), 'never connected');
  assert.equal(lastSeenLabel(ago(20_000), NOW), 'connected now');
  assert.equal(lastSeenLabel(ago(89_000), NOW), 'connected now');
  assert.equal(lastSeenLabel(ago(5 * 60_000), NOW), '5 min ago');
  assert.equal(lastSeenLabel(ago(3 * 3600_000), NOW), '3 h ago');
  assert.equal(lastSeenLabel(ago(26 * 3600_000), NOW), 'yesterday');
  assert.equal(lastSeenLabel(ago(4 * 86400_000), NOW), '4 days ago');
  assert.equal(lastSeenLabel('not a date', NOW), 'unknown');
});

test('live means it polled within three minutes', () => {
  assert.equal(isLive(ago(30_000), NOW), true);
  assert.equal(isLive(ago(179_000), NOW), true);
  assert.equal(isLive(ago(181_000), NOW), false);
  assert.equal(isLive(null, NOW), false);
});

test('a pairing code counts down in m:ss and is gone once expired', () => {
  assert.equal(codeCountdown(new Date(NOW + 600_000).toISOString(), NOW), '10:00');
  assert.equal(codeCountdown(new Date(NOW + 65_000).toISOString(), NOW), '1:05');
  assert.equal(codeCountdown(new Date(NOW + 5_000).toISOString(), NOW), '0:05');
  assert.equal(codeCountdown(new Date(NOW).toISOString(), NOW), null);
  assert.equal(codeCountdown(new Date(NOW - 1000).toISOString(), NOW), null);
  assert.equal(codeCountdown('garbage', NOW), null);
});

test('the Security page shows the phone panel, which talks only to the device admin endpoints and confirms before removing', async () => {
  const [security, panel, api] = await Promise.all([
    read('../src/pages/admin/Security.jsx'), read('../src/components/admin/PhoneAppPanel.jsx'), read('../src/lib/api.js'),
  ]);
  assert.match(security, /import PhoneAppPanel from '@\/components\/admin\/PhoneAppPanel';/);
  assert.match(security, /<PhoneAppPanel \/>/);
  for (const call of ['listDevices', 'createPairingCode', 'revokeDevice', 'sendTestAlert']) assert.match(panel, new RegExp(`adminApi\\.${call}\\(`));
  assert.match(api, /listDevices: \(\) => api\.get\('\/admin\/devices'\)/);
  assert.match(api, /createPairingCode: \(\) => api\.post\('\/admin\/devices\/pairing'\)/);
  assert.match(api, /revokeDevice: \(id\) => api\.delete\(`\/admin\/devices\/\$\{id\}`\)/);
  assert.match(api, /sendTestAlert: \(\) => api\.post\('\/admin\/devices\/test-event'\)/);
  assert.match(panel, /window\.confirm\(`Remove "\$\{device\.label\}"\?/);
  assert.doesNotMatch(panel, /token/i, 'the panel never handles a device token');
});

test('a notification can open an order: /admin/orders?order=<24 hex> opens that order and closing clears the link', async () => {
  const orders = await read('../src/pages/admin/Orders.jsx');
  assert.match(orders, /\/\^\[a-f0-9\]\{24\}\$\/i\.test\(searchParams\.get\('order'\) \|\| ''\)/);
  assert.match(orders, /useState\(linkedOrder\)/);
  assert.match(orders, /setSearchParams\(\{\}, \{ replace: true \}\)/);
  assert.match(orders, /onClose=\{closeOrder\}/);
});
