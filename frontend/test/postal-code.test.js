import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { formatPostalCode, isPostalCode, normalizePostalCode } from '../src/lib/postalCode.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('postal codes are formatted as they are typed and judged without the space', () => {
  assert.equal(formatPostalCode('m5v'), 'M5V');
  assert.equal(formatPostalCode('m5v2'), 'M5V 2');
  assert.equal(formatPostalCode('m5v2t6'), 'M5V 2T6');
  assert.equal(formatPostalCode('M5V 2T6 and more'), 'M5V 2T6', 'anything past six characters is dropped');
  assert.equal(formatPostalCode(' k1a-0b1 '), 'K1A 0B1');
  assert.equal(formatPostalCode(''), '');
  assert.equal(normalizePostalCode('v6b 1a1'), 'V6B1A1');
});

test('only real Canadian postal codes pass', () => {
  for (const ok of ['M5V 2T6', 'v6b1a1', 'X1A 2P3', 'A1C-5S7']) assert.equal(isPostalCode(ok), true, ok);
  for (const bad of ['', 'M5V', 'M5V 2T', '90210', 'D1A 1A1', 'M5I 2T6', 'M5V 2U6', 'W1A 1A1', 'ABC DEF']) assert.equal(isPostalCode(bad), false, bad);
});

test('the server and the page use the same postal code rule', async () => {
  const [server, page] = await Promise.all([read('../../backend/src/config/shipping.js'), read('../src/lib/postalCode.js')]);
  const rule = (text) => text.match(/\/\^\[ABCEGHJ[^/]*\$\//)[0];
  assert.equal(rule(server), rule(page));
});
