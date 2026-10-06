import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const codes = (text) => [...text.matchAll(/'([A-Z]{2})'|"([A-Z]{2})"/g)].map((m) => m[1] || m[2]);

// Owner (2026-10-05): "dont say canada only since we ship basically everywhere now ... update the google data stuff too".
// The saved Returns policy has no country limit, so the page data and the Merchant Center policies must not stop at Canada.
test('the structured return policy covers Canada and the countries Merchant Center lists, all of which the site ships to', async () => {
  const [meta, backend] = await Promise.all([read('../functions-shared/productMetadata.js'), read('../../backend/src/config/shipping.js')]);
  const returnCountries = codes(meta.match(/const RETURN_POLICY_COUNTRIES = \[([\s\S]*?)\];/)[1]);
  const shipsTo = codes(backend.match(/const INTERNATIONAL_COUNTRIES = \[([\s\S]*?)\];/)[1]);
  assert.equal(returnCountries.length, 53, 'the 53 countries in the Merchant Center data source');
  assert.equal(new Set(returnCountries).size, 53);
  assert.ok(returnCountries.includes('CA'));
  for (const code of returnCountries.filter((c) => c !== 'CA')) assert.ok(shipsTo.includes(code), `${code} is a country website checkout ships to`);
  assert.match(meta, /applicableCountry: RETURN_POLICY_COUNTRIES/);
  // the shipping rate in the same markup is Canada's flat rate, so its destination stays Canada
  assert.match(meta, /const SHIPPING_COUNTRIES = \["CA"\];/);
});
